import { inflateSync } from "node:zlib";

const ZIP_LOCAL = 0x04034b50;
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);

function decodeXmlText(xml) {
  const parts = [];
  const pattern = /<hp:t[^>]*>([^<]*)<\/hp:t>/g;
  let match = pattern.exec(xml);
  while (match) {
    parts.push(match[1]);
    match = pattern.exec(xml);
  }
  if (parts.length > 0) return parts.join("");
  return xml
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/&lt;/g, "<")
    .replaceAll(/&gt;/g, ">")
    .replaceAll(/&amp;/g, "&");
}

function readZipEntries(buffer) {
  const texts = [];
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== ZIP_LOCAL) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data = compressed;
    if (method === 8) data = inflateSync(compressed);
    else if (method !== 0) throw new Error(`압축 방식을 처리하지 못합니다: ${method}`);
    if (name.endsWith(".xml")) texts.push(decodeXmlText(data.toString("utf8")));
    offset = dataStart + compressedSize;
  }
  return texts.join("\n");
}

function utf16Runs(buffer) {
  const runs = [];
  let current = "";
  for (let index = 0; index + 1 < buffer.length; index += 2) {
    const code = buffer.readUInt16LE(index);
    if (code === 0) {
      if (current.length >= 2) runs.push(current);
      current = "";
      continue;
    }
    if (code === 10 || code === 13 || (code >= 32 && code !== 0xfffe)) {
      current += String.fromCharCode(code);
      continue;
    }
    if (current.length >= 2) runs.push(current);
    current = "";
  }
  if (current.length >= 2) runs.push(current);
  return runs.join("\n");
}

function inflateEmbedded(buffer) {
  const texts = [];
  for (let index = 0; index < buffer.length - 2; index += 1) {
    if (buffer[index] !== 0x78) continue;
    const flag = buffer[index + 1];
    if (flag !== 0x01 && flag !== 0x9c && flag !== 0xda) continue;
    try {
      const inflated = inflateSync(buffer.subarray(index));
      texts.push(utf16Runs(inflated));
    } catch {
      // 다음 위치에서 다시 찾는다.
    }
  }
  return texts.join("\n");
}

export function extractDocumentText(buffer) {
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === ZIP_LOCAL) {
    return readZipEntries(buffer);
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(OLE_MAGIC)) {
    return `${utf16Runs(buffer)}\n${inflateEmbedded(buffer)}`;
  }
  throw new Error("HWP 또는 HWPX 파일이 아닙니다.");
}
