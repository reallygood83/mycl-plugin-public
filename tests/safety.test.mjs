import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pickDownloadLabel } from "../scripts/lib/download.mjs";
import { classifyLocation } from "../scripts/lib/login-status.mjs";
import { profileDir } from "../scripts/lib/paths.mjs";
import {
  applyReplacements,
  buildReplacements,
  detectAccountSchool,
  parseChangedMessage,
} from "../scripts/lib/replacements.mjs";
import { assertNoSensitive, decideClick } from "../scripts/lib/safety.mjs";
import { selectors } from "../scripts/lib/selectors.mjs";

const root = path.resolve(import.meta.dirname, "..");
const documentText = [
  "박달초등학교",
  "교무실·행정실 02-3442-7783",
  "FAX 02-3442-7793",
  "현장학습을 안내합니다.",
  "박달초등학교장 [직인생략]",
].join("\n");

test("로그인 주소와 튕김을 실패로 본다", () => {
  assert.equal(
    selectors.login.entryUrl,
    "https://www.teacherville.co.kr/portal/memship/loginSSL.edu?svcType=8&isMyclApp=false&envType=op",
  );
  assert.deepEqual(classifyLocation("https://mycl.io/signup?key=abc"), {
    kind: "failed",
    reason: "signup",
  });
  assert.deepEqual(classifyLocation("https://mycl.io/landing#pricing"), {
    kind: "failed",
    reason: "pricing",
  });
  assert.equal(classifyLocation("https://mycl.io/landing").reason, "pricing");
  assert.equal(classifyLocation("https://mycl.io/tool/create?seq=6").kind, "authenticated");
  assert.equal(classifyLocation("https://mycl.io/v2/edit?seq=6&librarySeq=15").kind, "authenticated");
  assert.equal(classifyLocation(selectors.login.entryUrl).kind, "pending");
  assert.equal(classifyLocation("https://evilmycl.io/tool/list").kind, "pending");
  assert.equal(classifyLocation("https://not.example/mycl.io").kind, "pending");
});

test("계정 기본 학교와 연락처를 바꾸고 없으면 비운다", () => {
  const plan = buildReplacements({
    schoolName: "한빛초등학교",
    documentText,
    phone: "02-111-2222",
    fax: "02-333-4444",
  });
  const applied = applyReplacements(documentText, plan.pairs);
  assert.equal(applied.results[0].count, 2);
  assert.equal(applied.results[0].message, "2 items have been changed.");
  assert.equal(parseChangedMessage(applied.results[0].message), 2);
  assert.match(applied.text, /한빛초등학교장 \[직인생략\]/);
  assert.match(applied.text, /02-111-2222/);
  assert.match(applied.text, /02-333-4444/);
  assert.doesNotMatch(applied.text, /박달초등학교/);
  assert.doesNotMatch(applied.text, /02-3442-7783/);
  assert.doesNotMatch(applied.text, /02-3442-7793/);

  const blanked = buildReplacements({ schoolName: "한빛초등학교", documentText });
  assert.ok(blanked.notes.some((note) => note.includes("전화번호") && note.includes("비웠습니다")));
  assert.ok(blanked.notes.some((note) => note.includes("팩스") && note.includes("비웠습니다")));
  const removed = applyReplacements(documentText, blanked.pairs);
  assert.doesNotMatch(removed.text, /02-3442-7783/);
  assert.doesNotMatch(removed.text, /02-3442-7793/);
  assert.match(removed.text, /한빛초등학교장 \[직인생략\]/);
});

test("계정 학교가 박달초등학교가 아니면 서명에서 찾는다", () => {
  const text = "별빛초등학교\n교무실·행정실 02-0000-0000\n별빛초등학교장 [직인생략]\n";
  assert.equal(detectAccountSchool(text), "별빛초등학교");
  const plan = buildReplacements({
    schoolName: "한빛초등학교",
    documentText: text,
    phone: "02-111-2222",
  });
  assert.equal(plan.pairs[0].find, "별빛초등학교");
  assert.ok(plan.notes.some((note) => note.includes("02-3442-7783")));
  assert.equal(detectAccountSchool("노을초등학교 교무실·행정실 02-9999-0000"), "노을초등학교");
});

test("저장과 나이스 반영은 확인해도 거절하고 결제는 확인 뒤에만 허용한다", () => {
  assert.equal(decideClick("저장").allowed, false);
  assert.equal(decideClick("저장", { confirmed: true }).allowed, false);
  assert.equal(decideClick("문서 저장", { confirmed: true }).allowed, false);
  assert.equal(decideClick("취소").allowed, true);
  assert.equal(decideClick("닫기").allowed, true);
  assert.equal(decideClick("일괄 등록").allowed, false);
  assert.equal(decideClick("유사도 검사", { confirmed: true }).allowed, false);
  assert.equal(decideClick("전체 붙여넣기").allowed, false);
  assert.equal(decideClick("내려받기").allowed, false);
  assert.equal(decideClick("내려받기", { confirmed: true }).allowed, true);
  assert.equal(decideClick("나이스 반영하기 →", { confirmed: true }).allowed, false);
  assert.equal(decideClick("결제하기").allowed, false);
  assert.equal(decideClick("구독").allowed, false);
  assert.equal(decideClick("가입하기").allowed, false);
  assert.equal(decideClick("결제하기", { confirmed: true }).allowed, true);
  assert.equal(decideClick("자동 생성").allowed, true);
  assert.equal(decideClick("저장소").allowed, true);
  assert.throws(() => assertNoSensitive("주민등록번호를 적지 마세요", "전달사항"), /민감정보/);
  assert.throws(
    () =>
      decideClick("가끔", {}, [
        { id: "x", mode: "sometimes", labels: ["가끔"], reason: "알 수 없는 모드" },
      ]),
    /처리하지 않은 동작 모드/,
  );
});

test("내려받기는 보이는 문구에서 HWP를 우선하고 없으면 PDF를 고른다", () => {
  assert.deepEqual(pickDownloadLabel(["문서 내려받기 (PDF)", "문서 내려받기 (HWP)"]), {
    format: "hwp",
    label: "문서 내려받기 (HWP)",
  });
  assert.deepEqual(pickDownloadLabel(["안내문 PDF"]), { format: "pdf", label: "안내문 PDF" });
  assert.equal(pickDownloadLabel(["저장", "공유"]), null);
  assert.deepEqual(pickDownloadLabel(["PDF", "HWP"]), { format: "hwp", label: "HWP" });
  assert.equal(selectors.editor.download.menuItems.hwp, "HWP");
  assert.equal(selectors.editor.download.menuItems.pdf, "PDF");
  assert.equal(selectors.editor.findReplace.findField.labels[0], "Find what:");
  assert.equal(selectors.editor.findReplace.replaceField.labels[0], "Replace with:");
  assert.equal(selectors.editor.findReplace.searchOptions.at(-1), "Ignore white-space charcters");
});

test("클릭 가드 스크립트는 비밀번호 인자를 받지 않고 저장을 거절한다", () => {
  const secret = "super-secret-password";
  const rejected = spawnSync(process.execPath, ["scripts/login.mjs", secret], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(rejected.status, 2);
  assert.doesNotMatch(`${rejected.stdout}${rejected.stderr}`, new RegExp(secret));
  assert.match(rejected.stderr, /비밀번호/);

  const missing = path.join(tmpdir(), `mycl-missing-${process.pid}`);
  assert.equal(existsSync(missing), false);
  const printed = spawnSync(process.execPath, ["scripts/login.mjs", "--print-profile"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, MYCL_PROFILE_DIR: missing },
  });
  assert.equal(printed.status, 0);
  assert.equal(printed.stdout.trim(), missing);
  assert.equal(existsSync(missing), false);

  const save = spawnSync(process.execPath, ["scripts/check-click.mjs", "저장", "--confirmed"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(save.status, 1);
  const saveName = spawnSync(process.execPath, ["scripts/check-click.mjs", "문서 저장", "--confirmed"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(saveName.status, 1);
  const pay = spawnSync(process.execPath, ["scripts/check-click.mjs", "결제하기", "--confirmed"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(pay.status, 0);
  const planned = spawnSync(
    process.execPath,
    ["scripts/plan-replacements.mjs", "--school", "한빛초등학교"],
    { cwd: root, encoding: "utf8", input: documentText },
  );
  assert.equal(planned.status, 0);
  const plan = JSON.parse(planned.stdout);
  assert.equal(plan.pairs[0].replace, "한빛초등학교");
  const picked = spawnSync(
    process.execPath,
    ["scripts/pick-download.mjs", "문서 내려받기 (HWP)", "문서 내려받기 (PDF)"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(picked.status, 0);
  assert.equal(JSON.parse(picked.stdout).format, "hwp");
});

test("프로필 기본 경로는 홈 아래 .mycl-profile 이다", () => {
  const previous = process.env.MYCL_PROFILE_DIR;
  delete process.env.MYCL_PROFILE_DIR;
  try {
    assert.equal(path.basename(profileDir()), ".mycl-profile");
  } finally {
    if (previous === undefined) delete process.env.MYCL_PROFILE_DIR;
    else process.env.MYCL_PROFILE_DIR = previous;
  }
});

test("저장소 설정에 세션 파일과 공개 배포 경로를 넣지 않는다", () => {
  const ignored = spawnSync(
    "git",
    ["check-ignore", "--stdin"],
    {
      cwd: root,
      encoding: "utf8",
      input: [
        "out/gajeong-tongsin.hwp",
        ".env",
        ".mycl-profile/Default/Cookies",
        "session-storageState.json",
        "cookies.json",
        "notice.hwpx",
        "credentials",
        ".config/mycl-plugin/credentials",
      ].join("\n"),
    },
  );
  assert.equal(ignored.status, 0);
  for (const line of [
    "out/gajeong-tongsin.hwp",
    ".env",
    ".mycl-profile/Default/Cookies",
    "session-storageState.json",
    "cookies.json",
    "notice.hwpx",
    "credentials",
    ".config/mycl-plugin/credentials",
  ]) {
    assert.match(ignored.stdout, new RegExp(line.replaceAll(".", "\\.")));
  }
  const kept = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd: root,
    encoding: "utf8",
    input: "scripts/selectors.json\n",
  });
  assert.equal(kept.status, 1);

  const mcp = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8"));
  const args = mcp.mcpServers.playwright.args;
  assert.deepEqual(args.slice(0, 3), ["-y", "@playwright/mcp@latest", "--user-data-dir"]);
  assert.equal(args[3], "${HOME}/.mycl-profile");
  assert.equal(args.some((arg) => /headless|isolated|storage-state|save-session/.test(arg)), false);

  const toml = readFileSync(path.join(root, "codex/config.toml.example"), "utf8");
  const argsLine = toml.split("\n").find((line) => line.startsWith("args "));
  assert.match(argsLine, /REPLACE_WITH_ABSOLUTE_HOME\/\.mycl-profile/);
  assert.doesNotMatch(argsLine, /headless|isolated|storage-state|save-session/);

  const plugin = JSON.parse(readFileSync(path.join(root, ".claude-plugin/plugin.json"), "utf8"));
  assert.equal(plugin.name, "mycl-plugin");
  assert.equal(existsSync(path.join(root, ".claude-plugin/marketplace.json")), false);

  for (const relative of [
    "AGENTS.md",
    "skills/mycl-gajeong-tongsin/SKILL.md",
    "skills/mycl-login-check/SKILL.md",
    "skills/mycl-router/SKILL.md",
    "skills/mycl-haengbal/SKILL.md",
    "skills/mycl-subject-comment/SKILL.md",
  ]) {
    const text = readFileSync(path.join(root, relative), "utf8");
    assert.match(text, /저장/);
    assert.match(text, /나이스 반영하기/);
    assert.match(text, /민감정보|실명/);
  }
  assert.equal(readlinkSync(path.join(root, ".agents/skills/mycl-login-check")), "../../skills/mycl-login-check");
  assert.equal(
    readlinkSync(path.join(root, ".agents/skills/mycl-gajeong-tongsin")),
    "../../skills/mycl-gajeong-tongsin",
  );
  assert.equal(readlinkSync(path.join(root, ".agents/skills/mycl-router")), "../../skills/mycl-router");
  assert.equal(readlinkSync(path.join(root, ".agents/skills/mycl-haengbal")), "../../skills/mycl-haengbal");
  assert.equal(
    readlinkSync(path.join(root, ".agents/skills/mycl-subject-comment")),
    "../../skills/mycl-subject-comment",
  );
  const skill = readFileSync(path.join(root, "skills/mycl-login-check/SKILL.md"), "utf8");
  const description = skill.split("---")[1].match(/description: "(.*)"/)[1];
  assert.ok(description.length <= 500);
  assert.ok(skill.includes(selectors.login.entryUrl));
});
