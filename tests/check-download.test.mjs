import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { inspectText } from "../scripts/check-download.mjs";
import { extractDocumentText } from "../scripts/lib/document-text.mjs";

const root = path.resolve(import.meta.dirname, "..");

function storeZip(name, xml) {
  const data = Buffer.from(xml);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  return Buffer.concat([local, nameBuf, data]);
}

function fakeHwp(text) {
  return Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
    deflateSync(Buffer.from(`${text}\0`, "utf16le")),
  ]);
}

function sectionXml(text) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p>
</hs:sec>`;
}

function writeSample(dir, filename, contents) {
  const file = path.join(dir, filename);
  writeFileSync(file, contents);
  return file;
}

function runCheck(file, args = []) {
  return spawnSync(process.execPath, ["scripts/check-download.mjs", file, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

test("점검 결과는 학교명과 금지어가 없으면 통과한다", () => {
  const clean = inspectText("한빛초등학교 안내", { school: "박달초등학교", forbidden: ["홍길동"] });
  assert.equal(clean.ok, true);
  assert.equal(clean.schoolFound, false);
  assert.deepEqual(clean.forbiddenFound, []);
});

test("가짜 HWP와 HWPX에서 계정 학교명과 금지어를 찾는다", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mycl-hwp-"));
  const dirtyHwpx = writeSample(
    dir,
    "notice.hwpx",
    storeZip("Contents/section0.xml", sectionXml("박달초등학교 가정통신문")),
  );
  const dirtyHwp = writeSample(dir, "notice.hwp", fakeHwp("안내 박달초등학교"));
  const namedHwpx = writeSample(
    dir,
    "named.hwpx",
    storeZip("Contents/section0.xml", sectionXml("한빛초등학교 홍길동 안내")),
  );
  const cleanHwpx = writeSample(
    dir,
    "clean.hwpx",
    storeZip("Contents/section0.xml", sectionXml("한빛초등학교 안내")),
  );

  const schoolHit = runCheck(dirtyHwpx);
  assert.equal(schoolHit.status, 1);
  assert.equal(JSON.parse(schoolHit.stdout).schoolFound, true);
  assert.equal(JSON.parse(schoolHit.stdout).school, "박달초등학교");

  const hwpHit = runCheck(dirtyHwp, ["--school", "박달초등학교"]);
  assert.equal(hwpHit.status, 1);
  assert.equal(JSON.parse(hwpHit.stdout).schoolFound, true);

  const nameHit = runCheck(namedHwpx, ["--school", "박달초등학교", "--forbid", "홍길동"]);
  assert.equal(nameHit.status, 1);
  assert.deepEqual(JSON.parse(nameHit.stdout).forbiddenFound, ["홍길동"]);
  assert.equal(JSON.parse(nameHit.stdout).schoolFound, false);

  const clean = runCheck(cleanHwpx, ["--forbid", "홍길동"]);
  assert.equal(clean.status, 0);
  assert.equal(JSON.parse(clean.stdout).ok, true);
});

test("HWP 금지어 검사는 UTF-8로 잘못 읽은 글자에 걸리지 않는다", () => {
  const marker = "ZZFORBID";
  const markerBytes = Buffer.from(marker, "latin1");
  const realText = markerBytes.toString("utf16le");
  const fileBytes = fakeHwp(realText);
  const inflated = inflateSync(fileBytes.subarray(4));
  assert.equal(inflated.toString("utf8").includes(marker), true);
  assert.equal(realText.includes(marker), false);

  const extracted = extractDocumentText(fileBytes);
  assert.equal(extracted.includes(marker), false);
  const checked = inspectText(extracted, { school: "박달초등학교", forbidden: [marker] });
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.forbiddenFound, []);
});
