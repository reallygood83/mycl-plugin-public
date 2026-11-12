import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { classifyLocation, waitForManualLogin } from "../scripts/lib/login-status.mjs";
import { buildReplacements } from "../scripts/lib/replacements.mjs";
import { clickVisible, dismissSaveDialog, downloadDocument, generateGajeong, replaceAll } from "../scripts/lib/page-actions.mjs";

const fixtureDir = path.join(import.meta.dirname, "fixtures");
let browser;

async function launchBrowser() {
  const attempts = [{}, { args: ["--no-sandbox", "--disable-dev-shm-usage"] }];
  let lastError;
  for (const options of attempts) {
    try {
      return await chromium.launch({ headless: true, ...options });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

before(async () => {
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
});

async function htmlPage(url, fileName) {
  const page = await browser.newPage();
  const body = await readFile(path.join(fixtureDir, fileName), "utf8");
  await page.route("**/*", (route) => {
    if (route.request().url() !== url) return route.abort();
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body,
    });
  });
  await page.goto(url);
  return page;
}

test("가짜 편집기에서 학교와 연락처를 바꾸고 저장은 누르지 않는다", async () => {
  const page = await htmlPage("https://mycl.io/v2/edit?seq=6&librarySeq=15", "editor.html");
  try {
    const documentText = await page.locator("#document-root").innerText();
    const plan = buildReplacements({
      schoolName: "한빛초등학교",
      documentText,
      phone: "02-111-2222",
      fax: "02-333-4444",
    });
    await clickVisible(page, "Replace");
    assert.equal(await page.getByRole("button", { name: "Find Next", exact: true }).isDisabled(), true);
    assert.equal(await page.getByLabel("Search").inputValue(), "Whole Document");
    assert.equal(await page.getByRole("checkbox", { name: "Ignore white-space charcters" }).count(), 1);
    const counts = [];
    for (const pair of plan.pairs) {
      counts.push((await replaceAll(page, pair)).count);
    }
    assert.deepEqual(counts, [2, 1, 1]);
    const text = await page.locator("#document-root").innerText();
    assert.match(text, /한빛초등학교/);
    assert.match(text, /한빛초등학교장 \[직인생략\]/);
    assert.match(text, /02-111-2222/);
    assert.match(text, /02-333-4444/);
    assert.doesNotMatch(text, /박달초등학교/);
    assert.doesNotMatch(text, /02-3442-7783/);
    assert.doesNotMatch(text, /02-3442-7793/);
    await assert.rejects(() => clickVisible(page, "저장"), /저장/);
    await assert.rejects(() => clickVisible(page, "나이스 반영하기 →"), /나이스 반영하기/);
    assert.equal((await page.getByTestId("save-clicks").textContent())?.trim(), "0");
    assert.equal((await page.getByTestId("neis-clicks").textContent())?.trim(), "0");
  } finally {
    await page.context().close();
  }
});

test("연락처가 없으면 기본 번호만 지우고 저장하지 않는다", async () => {
  const page = await htmlPage("https://mycl.io/v2/edit?seq=6&librarySeq=15&blank=1", "editor.html");
  try {
    const documentText = await page.locator("#document-root").innerText();
    const plan = buildReplacements({ schoolName: "한빛초등학교", documentText });
    for (const pair of plan.pairs) await replaceAll(page, pair);
    const text = await page.locator("#document-root").innerText();
    assert.match(text, /한빛초등학교장 \[직인생략\]/);
    assert.doesNotMatch(text, /02-3442-7783/);
    assert.doesNotMatch(text, /02-3442-7793/);
    assert.equal((await page.getByTestId("save-clicks").textContent())?.trim(), "0");
  } finally {
    await page.context().close();
  }
});

test("내려받기는 HWP를 고르고 없으면 PDF를 out에 둔다", async () => {
  const hwpPage = await htmlPage("https://mycl.io/v2/edit?seq=6&librarySeq=15&formats=hwp,pdf", "editor.html");
  const dest = await mkdtemp(path.join(tmpdir(), "mycl-out-"));
  try {
    const hwp = await downloadDocument(hwpPage, dest);
    assert.equal(hwp.format, "hwp");
    assert.equal(hwp.label, "HWP");
    assert.equal(await readFile(hwp.dest, "utf8"), "fake-hwp");
    assert.equal((await hwpPage.getByTestId("save-clicks").textContent())?.trim(), "0");
  } finally {
    await hwpPage.context().close();
  }

  const pdfPage = await htmlPage("https://mycl.io/v2/edit?seq=6&librarySeq=16&formats=pdf", "editor.html");
  try {
    const pdf = await downloadDocument(pdfPage, dest);
    assert.equal(pdf.format, "pdf");
    assert.equal(await readFile(pdf.dest, "utf8"), "fake-pdf");
    assert.equal((await pdfPage.getByTestId("save-clicks").textContent())?.trim(), "0");
  } finally {
    await pdfPage.context().close();
    await rm(dest, { recursive: true, force: true });
  }
});

test("가정통신문 폼은 한글을 유지하고 자동 생성 뒤에도 저장하지 않는다", async () => {
  const page = await htmlPage("https://mycl.io/tool/create?seq=6", "form.html");
  try {
    await assert.rejects(
      () => generateGajeong(page, { greeting: "안녕", message: "주민등록번호를 확인하세요" }),
      /민감정보/,
    );
    await assert.rejects(
      () => generateGajeong(page, { title: "가".repeat(51), greeting: "안녕", message: "안내" }),
      /50자/,
    );
    assert.equal(new URL(page.url()).searchParams.get("librarySeq"), null);
    await generateGajeong(page, {
      title: "현장학습 안내",
      greeting: "안녕하십니까. 가정통신문입니다.",
      message: "3학년은 10월 12일에 박물관에 갑니다.",
    });
    assert.equal(
      await page.locator("#greeting").inputValue(),
      "안녕하십니까. 가정통신문입니다.",
    );
    const url = new URL(page.url());
    assert.equal(url.pathname, "/tool/create");
    assert.equal(url.searchParams.get("seq"), "6");
    assert.equal(url.searchParams.get("librarySeq"), "15");
    assert.equal(await page.getByRole("button", { name: "재생성", exact: true }).isVisible(), true);
    assert.equal(await page.getByTestId("preview").isVisible(), true);
    assert.equal(await page.getByRole("checkbox", { name: "영어", exact: true }).isChecked(), false);
    assert.equal(await page.getByRole("radio", { name: "미포함", exact: true }).isChecked(), true);
    assert.equal(await page.getByRole("radio", { name: "신청", exact: true }).isChecked(), true);
    await assert.rejects(() => clickVisible(page, "문서 저장"), /저장/);
    await page.locator("#save-dialog").evaluate((dialog) => dialog.showModal());
    assert.equal(await dismissSaveDialog(page), true);
    assert.equal(await page.getByRole("dialog", { name: "저장하기" }).isVisible(), false);
    assert.equal((await page.getByTestId("save-clicks").textContent())?.trim(), "0");
  } finally {
    await page.context().close();
  }
});

test("가입과 요금제로 튕기면 로그인 실패이고 버튼을 누르지 않는다", async () => {
  const page = await browser.newPage();
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("https://www.teacherville.co.kr/")) {
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><meta charset=\"utf-8\"><title>login</title><label>비밀번호 <input type=\"password\" name=\"password\"></label><script>location.replace('https://mycl.io/signup?key=test-key');</script>",
      });
    }
    if (url.startsWith("https://mycl.io/signup")) {
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><meta charset=\"utf-8\"><title>signup</title><button type=\"button\">가입하기</button><script>location.replace('https://mycl.io/landing#pricing');</script>",
      });
    }
    if (url.startsWith("https://mycl.io/landing")) {
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><meta charset=\"utf-8\"><title>요금제</title><button type=\"button\" id=\"pay\">결제하기</button><button type=\"button\" id=\"sub\">구독</button><button type=\"button\" id=\"signup\">가입하기</button><script>window.__clicks={pay:0,sub:0,signup:0}; for (const id of ['pay','sub','signup']) document.getElementById(id).onclick=()=>{window.__clicks[id]+=1};</script>",
      });
    }
    if (url.startsWith("https://mycl.io/tool/")) {
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><meta charset=\"utf-8\"><title>도구</title><p>로그인됨</p>",
      });
    }
    return route.abort();
  });

  try {
    await page.goto(
      "https://www.teacherville.co.kr/portal/memship/loginSSL.edu?svcType=8&isMyclApp=false&envType=op",
    );
    await page.waitForURL(/\/landing/);
    assert.equal(classifyLocation(page.url()).kind, "failed");
    assert.equal(classifyLocation(page.url()).reason, "pricing");
    await assert.rejects(() => clickVisible(page, "결제하기"), /결제/);
    await assert.rejects(() => clickVisible(page, "구독"), /구독/);
    await assert.rejects(() => clickVisible(page, "가입하기"), /가입/);
    assert.deepEqual(await page.evaluate(() => window.__clicks), { pay: 0, sub: 0, signup: 0 });

    const logs = [];
    const pending = waitForManualLogin(page, {
      timeoutMs: 4000,
      intervalMs: 30,
      log: (message) => logs.push(message),
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await page.goto("https://mycl.io/tool/list");
    const outcome = await pending;
    assert.equal(outcome.ok, true);
    assert.equal(outcome.reason, "mycl");
    assert.ok(logs.length >= 1);
  } finally {
    await page.context().close();
  }
});
