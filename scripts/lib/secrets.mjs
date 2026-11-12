import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const SERVICE = "mycl-plugin";
const ACCOUNT = "typesafe-api-key";

export function credentialsPath(env = process.env) {
  if (env.MYCL_CREDENTIALS_PATH) return path.resolve(env.MYCL_CREDENTIALS_PATH);
  return path.join(os.homedir(), ".config", "mycl-plugin", "credentials");
}

export function last4(key) {
  const value = String(key ?? "");
  if (value.length < 8) return "••••";
  return value.slice(-4);
}

export function keychainPlan(platform) {
  if (platform === "darwin") {
    return {
      read: { file: "security", args: ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"] },
      write(key) {
        return {
          file: "security",
          args: ["add-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w", key, "-U"],
        };
      },
      delete: { file: "security", args: ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT] },
    };
  }
  if (platform === "linux") {
    return {
      read: { file: "secret-tool", args: ["lookup", "service", SERVICE, "account", ACCOUNT] },
      write(key) {
        return {
          file: "secret-tool",
          args: ["store", "--label", "mycl-plugin TypeSafe", "service", SERVICE, "account", ACCOUNT],
          input: key,
        };
      },
      delete: { file: "secret-tool", args: ["clear", "service", SERVICE, "account", ACCOUNT] },
    };
  }
  return null;
}

function defaultExec(file, args, input) {
  const result = spawnSync(file, args, { input, encoding: "utf8", timeout: 3000 });
  if (result.error?.code === "ENOENT") return { status: 127, stdout: "", stderr: "" };
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: "" };
}

function run(exec, command) {
  try {
    return exec(command.file, command.args, command.input);
  } catch (error) {
    if (error?.code === "ENOENT") return { status: 127, stdout: "", stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  }
}

function readFileKey(filePath) {
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf8").trim();
}

export async function readApiKey(options = {}) {
  const env = options.env ?? process.env;
  const fromEnv = String(env.TYPESAFE_API_KEY ?? "").trim();
  if (fromEnv) return { source: "env", key: fromEnv };

  const plan = keychainPlan(options.platform ?? process.platform);
  if (plan) {
    const result = run(options.exec ?? defaultExec, plan.read);
    const value = result.status === 0 ? String(result.stdout ?? "").trim() : "";
    if (value) return { source: "keychain", key: value };
  }

  const filePath = options.filePath ?? credentialsPath(env);
  const fromFile = readFileKey(filePath);
  if (fromFile) return { source: "file", key: fromFile };
  return null;
}

function writeCredentialFile(filePath, key) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, key, { mode: 0o600 });
  chmodSync(filePath, 0o600);
}

export async function saveApiKey(key, options = {}) {
  const filePath = options.filePath ?? credentialsPath(options.env);
  const plan = keychainPlan(options.platform ?? process.platform);
  if (plan) {
    const result = run(options.exec ?? defaultExec, plan.write(key));
    if (result.status === 0) {
      if (existsSync(filePath)) rmSync(filePath, { force: true });
      return { source: "keychain" };
    }
  }
  writeCredentialFile(filePath, key);
  return { source: "file" };
}

export async function resetApiKey(options = {}) {
  const env = options.env ?? process.env;
  const filePath = options.filePath ?? credentialsPath(env);
  const plan = keychainPlan(options.platform ?? process.platform);
  let keychain = "unavailable";
  if (plan) {
    const result = run(options.exec ?? defaultExec, plan.delete);
    keychain = result.status === 0 ? "cleared" : "unavailable";
  }
  const hadFile = existsSync(filePath);
  if (hadFile) rmSync(filePath, { force: true });
  return {
    keychain,
    removedFile: hadFile,
    envStillSet: Boolean(String(env.TYPESAFE_API_KEY ?? "").trim()),
  };
}

export function describeKey(stored) {
  if (!stored) return { configured: false, source: null, last4: null };
  return { configured: true, source: stored.source, last4: last4(stored.key) };
}
