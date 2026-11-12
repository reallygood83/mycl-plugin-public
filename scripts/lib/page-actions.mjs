import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pickDownloadLabel } from "./download.mjs";
import { parseChangedMessage } from "./replacements.mjs";
import { assertNoSensitive, decideClick } from "./safety.mjs";
import { selectors } from "./selectors.mjs";

export function assertWithinLimit(label, value, maxLength) {
  const length = Array.from(String(value ?? "")).length;
  if (length > maxLength) {
    throw new Error(`${label}은 ${maxLength}자를 넘습니다. 지금 ${length}자입니다.`);
  }
}

export async function clickVisible(page, visibleText, options = {}) {
  const decision = decideClick(visibleText, options);
  if (!decision.allowed) {
    const error = new Error(decision.reason);
    error.code = "MYCL_FORBIDDEN_CLICK";
    throw error;
  }
  await page.getByRole("button", { name: visibleText, exact: true }).click();
}

async function setLabeled(page, label, value) {
  assertNoSensitive(value, label);
  const field = page.getByLabel(label, { exact: true });
  if ((await field.count()) === 0) {
    throw new Error(`라벨을 찾지 못했습니다: ${label}`);
  }
  const tag = await field.evaluate((element) => element.tagName.toLowerCase());
  if (tag === "select") {
    await field.selectOption({ label: value });
    return;
  }
  if (tag === "input") {
    const type = await field.getAttribute("type");
    if (type === "checkbox") {
      if (value) await field.check();
      return;
    }
  }
  await field.fill(String(value));
}

export async function fillGajeongForm(page, values) {
  const fields = selectors.gajeongTongsin.fields;
  for (const [label, value] of [
    [fields.title.label, values.title],
    [fields.greeting.label, values.greeting],
    [fields.message.label, values.message],
    [fields.notes.label, values.notes],
  ]) {
    if (value) assertNoSensitive(value, label);
  }
  if (!String(values.title ?? "").trim() || !String(values.greeting ?? "").trim() || !String(values.message ?? "").trim()) {
    throw new Error("제목, 인사말, 전달사항은 필수입니다.");
  }
  assertWithinLimit(fields.title.label, values.title, fields.title.maxLength);
  assertWithinLimit(fields.greeting.label, values.greeting, fields.greeting.maxLength);
  assertWithinLimit(fields.message.label, values.message, fields.message.maxLength);
  if (values.notes) assertWithinLimit(fields.notes.label, values.notes, fields.notes.maxLength);

  const type = values.type ?? fields.type.defaultOption;
  await page.getByRole("radio", { name: type, exact: true }).check();
  await setLabeled(page, fields.title.label, values.title);
  await setLabeled(page, fields.greeting.label, values.greeting);
  await setLabeled(page, fields.message.label, values.message);
  if (values.notes) await setLabeled(page, fields.notes.label, values.notes);
  for (const language of values.languages ?? []) {
    if (!fields.multilingualQr.options.includes(language)) {
      throw new Error(`확인되지 않은 다국어 QR 언어입니다: ${language}`);
    }
    await page.getByRole("checkbox", { name: language, exact: true }).check();
  }
  if (values.privacyConsent === true) {
    await page.getByRole("radio", { name: "포함", exact: true }).check();
  }
}

export async function generateGajeong(page, values) {
  await fillGajeongForm(page, values);
  await clickVisible(page, selectors.gajeongTongsin.buttons.generate.visibleText);
}

async function fillFirstField(page, labels, value) {
  for (const label of labels) {
    const field = page.getByLabel(label, { exact: true });
    if ((await field.count()) === 0) continue;
    const tag = await field.evaluate((element) => element.tagName.toLowerCase());
    if (tag !== "input" && tag !== "textarea") continue;
    await field.fill(value);
    return;
  }
  throw new Error(`찾기/바꾸기 입력 칸을 찾지 못했습니다: ${labels.join(", ")}`);
}

export async function replaceAll(page, pair) {
  if (!pair.find) throw new Error("찾을 문자열이 비어 있습니다.");
  const findReplace = selectors.editor.findReplace;
  const replaceAllButton = page.getByRole("button", {
    name: findReplace.replaceAllVisibleText,
    exact: true,
  });
  if (!(await replaceAllButton.isVisible())) {
    await clickVisible(page, findReplace.openVisibleText);
  }
  await fillFirstField(page, findReplace.findField.labels, pair.find);
  await fillFirstField(page, findReplace.replaceField.labels, pair.replace);
  await clickVisible(page, findReplace.replaceAllVisibleText);
  const message = (await page.getByTestId("replace-message").textContent()) ?? "";
  const count = parseChangedMessage(message);
  if (count == null) {
    throw new Error(`바꾸기 결과 문구를 확인하지 못했습니다: ${message.trim()}`);
  }
  return { message: message.trim(), count };
}

export async function downloadDocument(page, destDir) {
  const download = selectors.editor.download;
  await clickVisible(page, download.openAccessibleName);
  const menu = page.getByTestId("download-menu");
  await menu.waitFor({ state: "visible" });
  const labels = (await menu.getByRole("button").allInnerTexts())
    .map((label) => label.trim())
    .filter(Boolean);
  const picked = pickDownloadLabel(labels);
  if (!picked) {
    throw new Error("HWP와 PDF 항목을 찾지 못했습니다.");
  }
  const suggested = picked.format === "hwp" ? "gajeong-tongsin.hwp" : "gajeong-tongsin.pdf";
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    clickVisible(page, picked.label),
  ]);
  await mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, suggested);
  await file.saveAs(dest);
  return { dest, format: picked.format, label: picked.label };
}

export async function dismissSaveDialog(page) {
  const dialog = page.getByRole("dialog", { name: selectors.editor.saveDialog.title });
  if (!(await dialog.isVisible())) return false;
  await clickVisible(page, selectors.editor.saveDialog.cancelVisibleText);
  return true;
}
