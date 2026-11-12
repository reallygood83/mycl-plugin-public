import { clickVisible } from "./page-actions.mjs";
import { selectors } from "./selectors.mjs";

const spec = selectors.studentRecords;

export function footerNotice() {
  return spec.footer;
}

function recordsOf(kind) {
  if (kind === "haengbal") return spec.haengbal;
  if (kind === "subject-comment") return spec.subjectComment;
  throw new Error(`알 수 없는 학생 기록 도구입니다: ${kind}`);
}

export function validateRecords(kind, records) {
  const tool = recordsOf(kind);
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("학생별 기록이 필요합니다. 실명 대신 번호나 가명을 쓰세요.");
  }
  return records.map((record, index) => {
    const number = String(record.number ?? "").trim();
    const alias = String(record.alias ?? record.name ?? "").trim();
    if (number.length > 5) throw new Error(`번호는 5자까지입니다. ${index + 1}번째 행입니다.`);
    if (kind === "haengbal" && !String(record.note ?? "").trim()) {
      throw new Error(`누가기록은 필수입니다. ${index + 1}번째 행입니다.`);
    }
    if (kind === "subject-comment") {
      const level = String(record.level ?? "").trim();
      if (!level) throw new Error(`평가 수준은 필수입니다. ${index + 1}번째 행입니다.`);
      if (level.length > tool.levelMaxLength) throw new Error("평가 수준은 5자까지입니다.");
    }
    return {
      number,
      alias,
      note: String(record.note ?? ""),
      performance: String(record.performance ?? ""),
      level: String(record.level ?? ""),
    };
  });
}

async function choose(page, label, value) {
  if (!value) return;
  await page.getByLabel(label, { exact: true }).selectOption({ label: value });
}

async function fillAndCheck(locator, value) {
  await locator.fill(value);
  const actual = await locator.inputValue();
  if (actual !== value) {
    throw new Error("붙여넣은 값이 칸에 그대로 남지 않았습니다. 타이핑 대신 fill로 다시 넣으세요.");
  }
}

function columnControl(line, column) {
  return line.locator(`td:nth-child(${column})`).locator("input, textarea").first();
}

async function ensureRows(page, count) {
  const current = await page.locator("[data-row]").count();
  if (count <= current) return;
  const addButton = page.getByRole("button", { name: spec.addButton, exact: true });
  await addButton.locator("xpath=preceding-sibling::input[1]").fill(String(count - current));
  await clickVisible(page, spec.addButton);
  const next = await page.locator("[data-row]").count();
  if (next < count) throw new Error("학생 행을 늘리지 못했습니다.");
}

export async function fillStudentPage(page, kind, input) {
  const rows = validateRecords(kind, input.records);
  const tool = recordsOf(kind);
  if (input.schoolLevel && !tool.schoolLevels.includes(input.schoolLevel)) {
    throw new Error(`확인되지 않은 학교급입니다: ${input.schoolLevel}`);
  }
  await choose(page, "학교급", input.schoolLevel);
  await choose(page, "학년", input.grade);
  if (input.className) await fillAndCheck(page.getByLabel("반", { exact: true }), input.className);
  if (kind === "subject-comment") {
    if (!input.subject) throw new Error("교과는 필수입니다.");
    if (!tool.subjects.includes(input.subject)) throw new Error(`확인되지 않은 교과입니다: ${input.subject}`);
    await choose(page, "교과", input.subject);
  }
  await ensureRows(page, Math.max(rows.length, spec.defaultRowCount));
  for (const [index, row] of rows.entries()) {
    const line = page.locator(`[data-row="${index}"]`);
    const columns = tool.columns;
    await fillAndCheck(columnControl(line, columns.number), row.number);
    await fillAndCheck(columnControl(line, columns.alias), row.alias);
    if (kind === "haengbal") {
      await fillAndCheck(columnControl(line, columns.note), row.note);
    } else {
      await fillAndCheck(columnControl(line, columns.performance), row.performance);
      await fillAndCheck(columnControl(line, columns.note), row.note);
      await fillAndCheck(columnControl(line, columns.level), row.level);
    }
  }
  return rows;
}

export async function generateStudentSentences(page) {
  const kind = await page.locator("body").getAttribute("data-kind");
  const columns = recordsOf(kind).columns;
  await clickVisible(page, "전체 생성");
  const count = await page.locator("[data-row]").count();
  const students = [];
  for (let index = 0; index < count; index += 1) {
    const line = page.locator(`[data-row="${index}"]`);
    const aiSentence = (await columnControl(line, columns.ai).inputValue()).trim();
    if (!aiSentence) continue;
    students.push({
      number: await columnControl(line, columns.number).inputValue(),
      alias: await columnControl(line, columns.alias).inputValue(),
      aiSentence,
      bytes: Number((await line.locator(`td:nth-child(${columns.ai}) span`).textContent())?.trim() ?? "0"),
    });
  }
  return {
    students,
    studentCount: count,
    notice: ((await page.getByTestId("plan-notice").textContent()) ?? "").trim(),
  };
}
