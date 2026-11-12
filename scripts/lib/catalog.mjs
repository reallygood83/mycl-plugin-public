import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function catalogPath() {
  return fileURLToPath(new URL("../../tools/catalog.json", import.meta.url));
}

function assertTodo(value, label) {
  if (typeof value !== "string" || !value.startsWith("TODO:")) {
    throw new Error(`${label}는 TODO로 남겨야 합니다.`);
  }
}

export function loadCatalog(path = catalogPath()) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw.tools) || raw.tools.length === 0) {
    throw new Error("도구 카탈로그가 비어 있습니다.");
  }
  const ids = new Set();
  for (const tool of raw.tools) {
    if (typeof tool.id !== "string" || !/^[a-z0-9-]+$/.test(tool.id)) {
      throw new Error("도구 id는 영문 소문자, 숫자, 하이픈만 씁니다.");
    }
    if (ids.has(tool.id)) throw new Error(`도구 id가 중복됩니다: ${tool.id}`);
    ids.add(tool.id);
    if (typeof tool.name !== "string" || typeof tool.summary !== "string") {
      throw new Error(`도구 이름과 쓰임새가 필요합니다: ${tool.id}`);
    }
    if (tool.skill !== null && typeof tool.skill !== "string") {
      throw new Error(`스킬은 문자열이거나 null이어야 합니다: ${tool.id}`);
    }
    if (tool.url === null) assertTodo(tool.urlTodo, `${tool.id} 주소`);
    else if (typeof tool.url !== "string" || !tool.url.startsWith("https://mycl.io/")) {
      throw new Error(`확인된 주소만 https://mycl.io/ 로 둡니다: ${tool.id}`);
    } else if (tool.urlTodo !== null) {
      throw new Error(`주소가 있으면 urlTodo는 null입니다: ${tool.id}`);
    }
    if (!Array.isArray(tool.requiredInputs)) {
      throw new Error(`필수 입력은 배열이어야 합니다: ${tool.id}`);
    }
    if (tool.requiredInputs.length === 0) assertTodo(tool.requiredInputsTodo, `${tool.id} 필수 입력`);
    else if (tool.requiredInputsTodo !== null) {
      throw new Error(`필수 입력을 아는 도구의 TODO는 null입니다: ${tool.id}`);
    }
  }
  return raw;
}

export function publicTool(tool) {
  return {
    id: tool.id,
    name: tool.name,
    summary: tool.summary,
    seq: tool.seq,
    url: tool.url,
    urlTodo: tool.urlTodo,
    requiredInputs: tool.requiredInputs,
    requiredInputsTodo: tool.requiredInputsTodo,
    requiredInputsNote: tool.requiredInputsNote ?? null,
    skill: tool.skill,
    aliases: tool.aliases ?? [],
    fieldsTodo: tool.fieldsTodo ?? tool.requiredInputsNote ?? null,
  };
}
