import { readFileSync } from "node:fs";

const raw = JSON.parse(
  readFileSync(new URL("../selectors.json", import.meta.url), "utf8"),
);

const modes = new Set(["never", "confirm"]);
for (const action of raw.actions) {
  if (!modes.has(action.mode)) {
    throw new Error(`selectors.json 의 동작 모드를 처리하지 못합니다: ${action.mode}`);
  }
  if (!Array.isArray(action.labels) || action.labels.length === 0) {
    throw new Error(`selectors.json 동작에 문구가 없습니다: ${action.id}`);
  }
}

export const selectors = raw;

export function loginEntryUrl() {
  return selectors.login.entryUrl;
}
