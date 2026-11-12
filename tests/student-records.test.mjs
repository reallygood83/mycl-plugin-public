import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { clickVisible } from "../scripts/lib/page-actions.mjs";
import { footerNotice, fillStudentPage, generateStudentSentences } from "../scripts/lib/student-records.mjs";
import { decideClick } from "../scripts/lib/safety.mjs";

const fixtureDir = path.join(import.meta.dirname, "fixtures");
let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

async function openFixture(fileName) {
  const page = await browser.newPage();
  const body = readFileSync(path.join(fixtureDir, fileName), "utf8");
  await page.setContent(body, { waitUntil: "domcontentloaded" });
  return page;
}

test("행발은 열 순서로 채우고 금지 버튼을 거절한다", async () => {
  const page = await openFixture("haengbal.html");
  try {
    const number = page.locator("[data-row='0'] td:nth-child(1) input");
    await number.click();
    await page.keyboard.type("A1 ");
    assert.equal(await number.inputValue(), "");
    await fillStudentPage(page, "haengbal", {
      schoolLevel: "초등",
      grade: "1학년",
      className: "1",
      records: [{ number: "1", alias: "가명", note: "협동\n배려" }],
    });
    assert.equal(await number.inputValue(), "1");
    const result = await generateStudentSentences(page);
    assert.equal(result.students[0].aiSentence, "협동 배려");
    assert.equal(result.students[0].bytes, new TextEncoder().encode("협동 배려").length);
    assert.equal(result.notice, footerNotice());
    assert.match(await page.locator("#count").textContent(), /5명/);
    await page.locator("input[type='number']").fill("2");
    await clickVisible(page, "+ 신규 학생 추가");
    assert.match(await page.locator("#count").textContent(), /7명/);
    for (const label of ["저장", "나이스 반영하기 →", "일괄 등록", "유사도 검사"]) {
      assert.equal(decideClick(label).allowed, false);
      await assert.rejects(() => clickVisible(page, label), /누르지 않습니다|누르지 않는다/);
    }
    await assert.rejects(() => clickVisible(page, "내려받기"), /요청한 뒤/);
    await clickVisible(page, "내려받기", { confirmed: true });
    assert.equal((await page.getByTestId("alert").textContent()) ?? "", "");
    const empty = await browser.newPage();
    await empty.setContent(readFileSync(path.join(fixtureDir, "haengbal.html"), "utf8"));
    await clickVisible(empty, "내려받기", { confirmed: true });
    assert.match(await empty.getByTestId("alert").textContent(), /유효한 학생 데이터/);
    await empty.close();
  } finally {
    await page.context().close();
  }
});

test("교과 세특은 학교급으로 중학을 고르고 문장을 읽는다", async () => {
  const page = await openFixture("subject-comment.html");
  try {
    await fillStudentPage(page, "subject-comment", {
      schoolLevel: "중학",
      grade: "2학년",
      subject: "국어",
      records: [{ number: "2", alias: "가명", performance: "발표", note: "질문", level: "상" }],
    });
    assert.equal(await page.getByLabel("학교급").inputValue(), "중학");
    const result = await generateStudentSentences(page);
    assert.equal(result.students[0].aiSentence, "발표 질문");
    assert.equal(result.notice, footerNotice());
    assert.equal(decideClick("전체 붙여넣기").allowed, false);
    assert.equal(decideClick("전체 붙여넣기", { confirmed: true }).allowed, true);
    await assert.rejects(() => clickVisible(page, "저장"));
    await assert.rejects(() => clickVisible(page, "유사도 검사"));
  } finally {
    await page.context().close();
  }
});
