import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractDocumentText } from "./lib/document-text.mjs";
import { selectors } from "./lib/selectors.mjs";

function optionValues(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("-")) {
      throw new Error(`${name} 값이 필요합니다.`);
    }
    values.push(value);
    index += 1;
  }
  return values;
}

export function parseArgs(argv) {
  const positional = argv.filter((arg, index) => {
    if (arg.startsWith("-")) return false;
    const previous = argv[index - 1];
    return previous !== "--school" && previous !== "--forbid";
  });
  return {
    file: positional[0],
    school: optionValues(argv, "--school")[0] ?? selectors.editor.defaults.schoolName,
    forbidden: optionValues(argv, "--forbid"),
  };
}

export function inspectText(text, { school, forbidden }) {
  const schoolFound = school ? text.includes(school) : false;
  const forbiddenFound = forbidden.filter((word) => word && text.includes(word));
  return {
    school,
    schoolFound,
    forbiddenFound,
    ok: !schoolFound && forbiddenFound.length === 0,
  };
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "인자를 읽지 못했습니다.");
    process.exitCode = 2;
    return;
  }
  if (!parsed.file) {
    console.error("사용법: node scripts/check-download.mjs <파일> [--school 학교명] [--forbid 금지어]");
    process.exitCode = 2;
    return;
  }
  const buffer = readFileSync(parsed.file);
  const text = extractDocumentText(buffer);
  const result = inspectText(text, parsed);
  console.log(JSON.stringify({ file: parsed.file, ...result }));
  if (!result.ok) process.exitCode = 1;
}

const isDirect =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirect) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "문서를 점검하지 못했습니다.");
    process.exitCode = 2;
  }
}
