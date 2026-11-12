import path from "node:path";
import { fileURLToPath } from "node:url";
import { startReset, startSetup } from "./setup-key.mjs";
import { describeKey, readApiKey } from "./lib/secrets.mjs";

async function main() {
  const [group, action] = process.argv.slice(2);
  if (group === "key" && action === "status") {
    console.log(JSON.stringify(describeKey(await readApiKey())));
    return;
  }
  if (group === "key" && action === "reset") {
    await startReset();
    return;
  }
  if (group === "key" && action === "setup") {
    await startSetup();
    return;
  }
  console.error("사용법: node scripts/mycl.mjs key status|setup|reset");
  process.exitCode = 2;
}

const isDirect =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirect) {
  main().catch(() => {
    console.error("키 명령을 끝내지 못했습니다.");
    process.exitCode = 1;
  });
}
