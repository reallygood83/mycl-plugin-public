import { selectors } from "./selectors.mjs";

function normalize(value) {
  return String(value ?? "")
    .replaceAll(/\s+/g, " ")
    .replaceAll("→", "")
    .trim();
}

function assertNever(mode) {
  throw new Error(`처리하지 않은 동작 모드: ${String(mode)}`);
}

export function decideClick(visibleText, options = {}, actions = selectors.actions) {
  const confirmed = options.confirmed === true;
  const text = normalize(visibleText);
  if (!text) {
    return { allowed: false, id: "empty", reason: "버튼 문구가 비어 있습니다." };
  }

  for (const action of actions) {
    for (const label of action.labels) {
      if (normalize(label) !== text) continue;
      switch (action.mode) {
        case "never":
          return { allowed: false, id: action.id, reason: action.reason };
        case "confirm":
          if (!confirmed) {
            return {
              allowed: false,
              id: action.id,
              reason: `${action.reason} 사용자가 확인하기 전에는 누르지 않습니다.`,
            };
          }
          return { allowed: true, id: action.id, reason: action.reason };
        default:
          return assertNever(action.mode);
      }
    }
  }

  return { allowed: true, id: "unknown", reason: "금지 목록에 없습니다." };
}

export function findSensitive(text) {
  const value = String(text ?? "");
  return selectors.sensitiveTokens.find((token) => value.includes(token)) ?? null;
}

export function assertNoSensitive(text, field) {
  const token = findSensitive(text);
  if (!token) return;
  throw new Error(`${field}에 민감정보(${token})가 있어 넣지 않습니다.`);
}
