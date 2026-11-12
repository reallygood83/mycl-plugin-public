import { readFileSync } from "node:fs";
import { buildReplacements } from "./lib/replacements.mjs";

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1] ?? "";
}

const argv = process.argv.slice(2);
const schoolName = option(argv, "--school");

if (argv.includes("--help") || schoolName === undefined) {
  console.error(
    "사용법: node scripts/plan-replacements.mjs --school 학교명 [--phone 번호] [--fax 번호] [--document-file 경로]",
  );
  console.error("문서 텍스트는 --document-file 또는 표준 입력으로 줍니다.");
  process.exitCode = argv.includes("--help") ? 0 : 1;
} else {
  const file = option(argv, "--document-file");
  const documentText = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
  try {
    const plan = buildReplacements({
      schoolName,
      documentText,
      phone: option(argv, "--phone"),
      fax: option(argv, "--fax"),
    });
    console.log(JSON.stringify(plan));
  } catch (error) {
    const message = error instanceof Error ? error.message : "바꾸기 계획을 만들지 못했습니다.";
    console.error(message);
    process.exitCode = 1;
  }
}
