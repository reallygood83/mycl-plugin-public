import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline";

const [launcher] = process.argv.slice(2);
const home = process.env.USERPROFILE;
const installDir = realpathSync(path.join(home, ".local", "share", "mycl-plugin"));
const workDir = path.join(home, "Unrelated project");
const skills = ["mycl-router", "mycl-login-check", "mycl-gajeong-tongsin", "mycl-haengbal", "mycl-subject-comment"];
const clientInfo = { name: "mycl-windows-install", version: "1.0.0" };
const require = createRequire(path.join(installDir, "package.json"));
const { chromium } = require("playwright");

function rpc(command, args) {
  const child = spawn(command, args, { cwd: workDir, stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map();
  let id = 0;
  const send = (method, params, requestId) => child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method, params, id: requestId }) + "\n",
  );
  createInterface({ input: child.stdout }).on("line", line => {
    const response = JSON.parse(line);
    const pending = waiting.get(response.id);
    if (!pending) return;
    waiting.delete(response.id);
    if (response.error) pending.reject(new Error(JSON.stringify(response.error)));
    else pending.resolve(response.result);
  });
  const fail = error => {
    for (const pending of waiting.values()) pending.reject(error);
    waiting.clear();
  };
  child.on("error", fail);
  child.on("exit", code => fail(new Error(`RPC process exited: ${code}`)));
  return {
    call(method, params) {
      const requestId = ++id;
      return new Promise((resolve, reject) => {
        waiting.set(requestId, { resolve, reject });
        send(method, params, requestId);
      });
    },
    notify: send,
    close() { child.stdin.end(); child.kill(); },
  };
}

mkdirSync(workDir);
const servers = JSON.parse(execFileSync(process.execPath, [launcher, "mcp", "list", "--json"]));
assert.ok(servers.some(server => server.name === "existing-check"));
const browser = servers.find(server => server.name === "mycl-browser");
assert.equal(browser?.enabled, true);
const profile = path.join(home, ".mycl-profile");
assert.equal(browser.transport.args.at(-1), profile);
for (const name of skills) {
  const link = path.join(home, ".agents", "skills", name);
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.equal(realpathSync(link), path.join(installDir, "skills", name));
}

const watchdog = setTimeout(() => { throw new Error("Timed out verifying Windows installation"); }, 90_000);
try {
  const codex = rpc(process.execPath, [launcher, "app-server"]);
  try {
    await codex.call("initialize", { clientInfo, capabilities: null });
    codex.notify("initialized");
    const result = await codex.call("skills/list", { cwds: [workDir], forceReload: true });
    const discovered = result.data[0].skills.filter(skill => skill.enabled && skill.scope === "user");
    for (const name of skills) {
      assert.ok(discovered.some(skill => realpathSync(skill.path) === path.join(installDir, "skills", name, "SKILL.md")), name);
    }
    console.log("Codex discovered all five MyClass skills from an unrelated folder.");
  } finally { codex.close(); }

  let sawCookie = false;
  const site = createServer((request, response) => {
    if (request.headers.cookie?.includes("mycl_fixture=yes")) sawCookie = true;
    response.end("<title>MyCL Windows smoke test</title><h1>MyCL Windows smoke test</h1>");
  });
  try {
    await new Promise(resolve => site.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${site.address().port}`;
    const context = await chromium.launchPersistentContext(profile, { headless: false });
    try {
      await context.addCookies([{ name: "mycl_fixture", value: "yes", url, expires: Date.now() / 1000 + 3600 }]);
    } finally { await context.close(); }
    const mcp = rpc(browser.transport.command, browser.transport.args);
    try {
      await mcp.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo });
      mcp.notify("notifications/initialized");
      const result = await mcp.call("tools/call", { name: "browser_navigate", arguments: { url } });
      assert.ok(!result.isError, JSON.stringify(result));
      assert.ok(sawCookie, "Playwright MCP must reuse the same persistent profile as login.");
      await mcp.call("tools/call", { name: "browser_close", arguments: {} });
      console.log("Registered MCP opened headed Chromium and reused the login profile.");
    } finally { mcp.close(); }
  } finally { site.close(); }
} finally { clearTimeout(watchdog); }
