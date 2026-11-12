import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createKeyServer, runKeySetup, CONSOLE_KEYS_URL } from "../scripts/lib/key-server.mjs";
import { describeKey, last4, readApiKey, resetApiKey, saveApiKey } from "../scripts/lib/secrets.mjs";
import { MODELS_ENDPOINT } from "../scripts/lib/validate-key.mjs";
import { routeTeacherRequest } from "../scripts/lib/router.mjs";
import { loadCatalog } from "../scripts/lib/catalog.mjs";

const root = path.resolve(import.meta.dirname, "..");
const fakeKey = "fake-typesafe-key-abcd";
const otherKey = "fake-typesafe-key-9999";

function missingExec() {
  return { status: 127, stdout: "", stderr: "" };
}

function okModels(expectedKey) {
  return async (url, init) => {
    assert.equal(url, MODELS_ENDPOINT);
    assert.equal(init.method, "GET");
    assert.equal(init.headers.Authorization, `Bearer ${expectedKey}`);
    return {
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: "jev-latest", description: "General-purpose", release_date: "2026-09-15" }] }),
    };
  };
}

function requestOnce(url, { method = "GET", headers = {}, body = "" } = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("환경변수가 키체인과 파일보다 먼저 쓰이고 상태에는 끝 네 자리만 나온다", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mycl-key-"));
  const filePath = path.join(dir, "credentials");
  const calls = [];
  const exec = (file, args, input) => {
    calls.push({ file, args, input });
    return { status: 0, stdout: `${otherKey}\n`, stderr: "" };
  };
  await saveApiKey(otherKey, { filePath, platform: "linux", exec: missingExec });
  assert.equal(statSync(filePath).mode & 0o777, 0o600);
  const stored = await readApiKey({
    env: { TYPESAFE_API_KEY: fakeKey },
    filePath,
    platform: "linux",
    exec,
  });
  assert.equal(stored.source, "env");
  assert.equal(stored.key, fakeKey);
  assert.equal(calls.length, 0);
  const status = describeKey(stored);
  assert.equal(status.last4, "abcd");
  assert.equal(JSON.stringify(status).includes("fake-typesafe-key"), false);
  assert.equal(last4("short"), "••••");
});

test("키체인이 없으면 권한 600 파일에 저장하고 라우터 출력에는 키를 넣지 않는다", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mycl-file-"));
  const filePath = path.join(dir, "credentials");
  const saved = await saveApiKey(fakeKey, { filePath, platform: "linux", exec: missingExec });
  assert.equal(saved.source, "file");
  assert.equal(readFileSync(filePath, "utf8"), fakeKey);
  assert.equal(statSync(filePath).mode & 0o777, 0o600);
  const stored = await readApiKey({ env: {}, filePath, platform: "linux", exec: missingExec });
  let seen = "";
  const routed = await routeTeacherRequest({
    prompt: "가정통신문 써 줘",
    tools: loadCatalog().tools,
    apiKey: stored.key,
    fetchImpl: async (url, init) => {
      seen = init.headers.Authorization;
      return { ok: false, status: 500, json: async () => ({}) };
    },
  });
  assert.equal(seen, `Bearer ${fakeKey}`);
  assert.equal(JSON.stringify(routed).includes(fakeKey), false);
  const reset = await resetApiKey({ env: {}, filePath, platform: "linux", exec: missingExec });
  assert.equal(reset.removedFile, true);
  assert.equal(await readApiKey({ env: {}, filePath, platform: "linux", exec: missingExec }), null);
});

test("리눅스 키체인에는 키를 인자가 아니라 표준 입력으로 넘긴다", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mycl-chain-"));
  const filePath = path.join(dir, "credentials");
  let input = "";
  const exec = (file, args, stdin) => {
    assert.equal(file, "secret-tool");
    assert.equal(args.includes(fakeKey), false);
    input = stdin;
    return { status: 0, stdout: "", stderr: "" };
  };
  const saved = await saveApiKey(fakeKey, { filePath, platform: "linux", exec });
  assert.equal(saved.source, "keychain");
  assert.equal(input, fakeKey);
  assert.equal(statSync(filePath, { throwIfNoEntry: false }), undefined);
});

test("키 입력 서버는 127.0.0.1만 받고 토큰, 출처, 재제출을 거절하며 로그에 키를 남기지 않는다", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mycl-http-"));
  const filePath = path.join(dir, "credentials");
  let release = () => {};
  let validationStarted = false;
  const session = createKeyServer({
    filePath,
    platform: "linux",
    exec: missingExec,
    timeoutMs: 5000,
    fetchImpl: () =>
      new Promise((resolve) => {
        validationStarted = true;
        release = () =>
          resolve({
            ok: true,
            status: 200,
            json: async () => ({ models: [{ name: "jev-latest" }] }),
          });
      }),
  });
  const address = await session.listen();
  assert.equal(address.address, "127.0.0.1");
  const url = session.url();
  const page = await requestOnce(url);
  assert.equal(page.status, 200);
  assert.match(page.body, /type="password"/);
  assert.match(page.body, /붙여넣기/);
  assert.match(page.body, new RegExp(CONSOLE_KEYS_URL.replaceAll(".", "\\.")));
  assert.match(page.body, /<dialog/);
  assert.equal(page.body.includes(fakeKey), false);

  const wrong = await requestOnce(url.replace(session.token, "wrong-token"));
  assert.equal(wrong.status, 403);
  const foreignHost = await requestOnce(url, { headers: { host: "evil.example" } });
  assert.equal(foreignHost.status, 403);
  const saveUrl = session.url().replace("/?", "/save?");
  const foreignOrigin = await requestOnce(saveUrl, {
    method: "POST",
    headers: {
      host: `127.0.0.1:${address.port}`,
      origin: "https://evil.example",
      "content-type": "application/json",
    },
    body: JSON.stringify({ key: fakeKey }),
  });
  assert.equal(foreignOrigin.status, 403);

  const first = requestOnce(saveUrl, {
    method: "POST",
    headers: {
      host: `127.0.0.1:${address.port}`,
      origin: `http://127.0.0.1:${address.port}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ key: fakeKey }),
  });
  for (let attempt = 0; attempt < 50 && !validationStarted; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(validationStarted, true);
  const duplicate = await requestOnce(saveUrl, {
    method: "POST",
    headers: {
      host: `127.0.0.1:${address.port}`,
      origin: `http://127.0.0.1:${address.port}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ key: fakeKey }),
  });
  assert.equal(duplicate.status, 409);
  release();
  const saved = await first;
  assert.equal(saved.status, 200);
  assert.equal(saved.body.includes("fake-typesafe-key"), false);
  assert.match(saved.body, /abcd/);
  assert.equal(session.logs.join("\n").includes(fakeKey), false);
  assert.equal(session.logs.includes("saved"), true);
  await session.done;
});

test("검증이 거절되면 저장하지 않고 브라우저가 없으면 숨김 입력으로 받는다", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mycl-fallback-"));
  const filePath = path.join(dir, "credentials");
  const logs = [];
  const rejected = await runKeySetup({
    filePath,
    platform: "linux",
    exec: missingExec,
    timeoutMs: 1000,
    log: (message) => logs.push(message),
    openBrowser: async () => false,
    readHidden: async () => fakeKey,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ detail: fakeKey }) }),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "unauthorized");
  assert.equal(statSync(filePath, { throwIfNoEntry: false }), undefined);
  assert.equal(logs.join("\n").includes(fakeKey), false);
  assert.equal(JSON.stringify(rejected).includes(fakeKey), false);

  const accepted = await runKeySetup({
    filePath,
    platform: "linux",
    exec: missingExec,
    openBrowser: async () => false,
    readHidden: async () => fakeKey,
    fetchImpl: okModels(fakeKey),
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.last4, "abcd");
  assert.equal(accepted.source, "file");
});

test("시간이 지나면 키 입력 서버가 꺼진다", async () => {
  const session = createKeyServer({
    timeoutMs: 30,
    filePath: path.join(mkdtempSync(path.join(tmpdir(), "mycl-timeout-")), "credentials"),
    platform: "linux",
    exec: missingExec,
    fetchImpl: okModels(fakeKey),
  });
  await session.listen();
  const result = await session.done;
  assert.equal(result.reason, "timeout");
  assert.equal(session.logs.includes("timeout"), true);
});

test("key status와 key reset은 키 전체를 출력하지 않는다", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mycl-cli-"));
  const filePath = path.join(dir, "credentials");
  const env = { ...process.env, MYCL_CREDENTIALS_PATH: filePath, TYPESAFE_API_KEY: fakeKey };
  const status = spawnSync(process.execPath, ["scripts/mycl.mjs", "key", "status"], {
    cwd: root,
    encoding: "utf8",
    env,
  });
  assert.equal(status.status, 0);
  assert.equal(JSON.parse(status.stdout).last4, "abcd");
  assert.equal(`${status.stdout}${status.stderr}`.includes("fake-typesafe-key"), false);

  const resetEnv = { ...env };
  delete resetEnv.TYPESAFE_API_KEY;
  const reset = spawnSync(process.execPath, ["scripts/mycl.mjs", "key", "reset"], {
    cwd: root,
    encoding: "utf8",
    env: resetEnv,
  });
  assert.equal(reset.status, 0);
  assert.equal(`${reset.stdout}${reset.stderr}`.includes(fakeKey), false);
  assert.equal(JSON.parse(reset.stdout).envStillSet, false);
});
