import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { waitForManualLogin } from "./lib/login-status.mjs";
import { profileDir } from "./lib/paths.mjs";
import { loginEntryUrl } from "./lib/selectors.mjs";

const usage = `사용법
  node scripts/login.mjs
  node scripts/login.mjs --print-profile

브라우저 창을 열고 티처빌 통합로그인으로 이동합니다.
비밀번호는 묻지 않고, 저장하지 않습니다. 창에서 직접 로그인하면
세션이 프로필 디렉터리에 남습니다.

로그인 입구
  ${loginEntryUrl()}
`;

export function parseArgs(argv) {
  const allowed = new Set(["--help", "-h", "--print-profile"]);
  if (argv.some((arg) => !allowed.has(arg))) {
    return {
      error: "이 스크립트는 비밀번호와 로그인 정보를 받지 않습니다. 브라우저 창에서 직접 로그인하세요.",
    };
  }
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    printProfile: argv.includes("--print-profile"),
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
  if (parsed.printProfile) {
    console.log(profileDir());
    return;
  }

  const dir = profileDir();
  console.log("브라우저 창에서 티처빌 계정으로 직접 로그인하세요.");
  console.log("이 스크립트는 비밀번호를 묻지 않고 저장하지 않습니다.");
  console.log(`프로필: ${dir}`);
  const context = await chromium.launchPersistentContext(dir, {
    headless: false,
    viewport: null,
    locale: "ko-KR",
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(loginEntryUrl(), { waitUntil: "domcontentloaded" });
    const outcome = await waitForManualLogin(page);
    if (!outcome.ok) {
      console.error("로그인이 끝나기 전에 대기가 끝났습니다. 비밀번호는 저장하지 않았습니다.");
      process.exitCode = 1;
      return;
    }
    console.log("로그인 세션을 브라우저 프로필에 저장했습니다.");
  } finally {
    await context.close();
  }
}

const isDirect =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirect) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "로그인 창을 열지 못했습니다.";
    console.error(message);
    process.exitCode = 1;
  });
}
