import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readApiKey } from "./lib/secrets.mjs";
import { routeTeacherRequest } from "./lib/router.mjs";

const usage = `사용법
  node scripts/route.mjs --prompt "교사 요청"

키는 TYPESAFE_API_KEY, OS 키체인, ~/.config/mycl-plugin/credentials 순서로 읽는다.
키가 없거나 호출이 실패하면 카탈로그를 출력하고, 사람이 고른다.
기준값은 MYCL_ROUTER_MIN_CONFIDENCE 또는 --min-confidence 이고 기본은 0.8이다.
API 키는 인자로 받지 않는다.
`;

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1] ?? "";
}

export function parseArgs(argv) {
  const allowed = new Set(["--help", "-h", "--prompt", "--min-confidence", "--mock"]);
  if (argv.some((arg) => arg.startsWith("-") && !allowed.has(arg))) {
    return {
      error: "API 키는 인자로 받지 않습니다. TYPESAFE_API_KEY 환경변수만 사용합니다.",
    };
  }
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    prompt: option(argv, "--prompt"),
    minConfidence: option(argv, "--min-confidence"),
    mock: option(argv, "--mock"),
  };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    console.error(parsed.error);
    process.exitCode = 2;
    return;
  }
  if (parsed.help) {
    console.log(usage);
    return;
  }
  const prompt = parsed.prompt === undefined ? readFileSync(0, "utf8") : parsed.prompt;
  const mockResponse = parsed.mock ? JSON.parse(readFileSync(parsed.mock, "utf8")) : undefined;
  const minConfidence = parsed.minConfidence ?? process.env.MYCL_ROUTER_MIN_CONFIDENCE;
  const stored = mockResponse ? null : await readApiKey();
  const result = await routeTeacherRequest({
    prompt,
    minConfidence,
    mockResponse,
    apiKey: stored?.key,
  });
  console.log(JSON.stringify(result));
  if (result.action === "refused") process.exitCode = 1;
}

const isDirect =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirect) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "도구를 고르지 못했습니다.";
    console.error(message);
    process.exitCode = 1;
  });
}
