import { selectors } from "./selectors.mjs";

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function changedMessagePattern() {
  const template = selectors.editor.findReplace.changedMessage;
  const source = escapeRegExp(template).replace("\\{count\\}", "(\\d+)");
  return new RegExp(`^${source}$`);
}

export function parseChangedMessage(message) {
  const match = String(message ?? "").trim().match(changedMessagePattern());
  if (!match) return null;
  return Number(match[1]);
}

export function detectAccountSchool(documentText, defaults = selectors.editor.defaults) {
  const text = String(documentText ?? "");
  if (text.includes(defaults.schoolName)) return defaults.schoolName;

  const signature = text.match(/(\S+?)장 \[직인생략\]/);
  if (signature) return signature[1];

  const lines = text.split(/\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.includes(defaults.officeLabel)) continue;
    const sameLine = line.split(defaults.officeLabel)[0].trim();
    if (sameLine) return sameLine;
    if (index > 0) {
      const previous = lines[index - 1].trim();
      if (previous) return previous;
    }
  }
  return null;
}

export function buildReplacements(input) {
  const schoolName = String(input.schoolName ?? "").trim();
  if (!schoolName) throw new Error("학교명이 필요합니다.");

  const documentText = String(input.documentText ?? "");
  const defaults = selectors.editor.defaults;
  const pairs = [];
  const notes = [];
  const accountSchool = detectAccountSchool(documentText, defaults);

  if (!accountSchool) {
    notes.push("문서에서 계정 기본 학교명을 찾지 못했습니다.");
  } else if (accountSchool === schoolName) {
    notes.push("학교명이 이미 요청한 이름입니다.");
  } else {
    pairs.push({ find: accountSchool, replace: schoolName });
  }

  pushContact(pairs, notes, documentText, {
    found: defaults.phone,
    given: input.phone,
    label: "전화번호",
  });
  pushContact(pairs, notes, documentText, {
    found: defaults.fax,
    given: input.fax,
    label: "팩스",
  });

  return { pairs, notes };
}

function pushContact(pairs, notes, documentText, contact) {
  const given = contact.given == null ? "" : String(contact.given).trim();
  if (!documentText.includes(contact.found)) {
    if (given) {
      notes.push(`기본 ${contact.label} ${contact.found} 이 문서에 없어 바꾸지 못했습니다.`);
    }
    return;
  }
  pairs.push({ find: contact.found, replace: given });
  if (!given) {
    notes.push(`${contact.label}를 주지 않아 기본 ${contact.label} ${contact.found} 를 비웠습니다.`);
  }
}

export function applyReplacements(text, pairs) {
  let current = String(text);
  const results = [];
  for (const pair of pairs) {
    if (!pair.find) throw new Error("찾을 문자열이 비어 있습니다.");
    const parts = current.split(pair.find);
    const count = parts.length - 1;
    current = parts.join(pair.replace);
    results.push({
      find: pair.find,
      replace: pair.replace,
      count,
      message: selectors.editor.findReplace.changedMessage.replace("{count}", String(count)),
    });
  }
  return { text: current, results };
}
