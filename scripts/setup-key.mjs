import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runKeySetup } from "./lib/key-server.mjs";
import { resetApiKey } from "./lib/secrets.mjs";

export function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  return new Promise((resolve) => {
    const child = spawn(command, [url], { stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

export function readHidden(promptText) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error("터미널 입력을 쓸 수 없습니다."));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(promptText);
    rl._writeToOutput = () => {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

export async function startSetup() {
  const result = await runKeySetup({ openBrowser, readHidden });
  if (!result.ok) {
    console.error(result.reason === "timeout" ? "시간이 지나 키 입력 창을 닫았습니다." : "키를 저장하지 못했습니다.");
    process.exitCode = 1;
    return;
  }
  console.log(`저장했습니다. 끝 네 자리는 ${result.last4} 입니다.`);
}

export async function startReset() {
  const result = await resetApiKey();
  console.log(
    JSON.stringify({
      reset: true,
      removedFile: result.removedFile,
      keychain: result.keychain,
      envStillSet: result.envStillSet,
    }),
  );
}

const isDirect =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirect) {
  const run = process.argv.includes("--reset") ? startReset : startSetup;
  run().catch(() => {
    console.error("키 입력을 끝내지 못했습니다.");
    process.exitCode = 1;
  });
}
