import { publicTool, loadCatalog } from "./catalog.mjs";
import { findSensitive } from "./safety.mjs";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
export const NONE_CHOICE = "none";
export const DEFAULT_MIN_CONFIDENCE = 0.8;
const CANDIDATE_LIMIT = 3;

export function resolveMinConfidence(value) {
  if (value == null || value === "") {
    return { value: DEFAULT_MIN_CONFIDENCE, warning: null };
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    return {
      value: DEFAULT_MIN_CONFIDENCE,
      warning: "기준값이 0에서 1 사이가 아니어서 0.8을 씁니다.",
    };
  }
  return { value: number, warning: null };
}

export function buildJevRequest(prompt, tools) {
  const criteria = {};
  for (const tool of tools) criteria[tool.id] = tool.summary;
  criteria[NONE_CHOICE] = "맞는 도구 없음. 마이클 도구로 할 수 없는 요청이다.";
  return {
    model: JEV_MODEL,
    state: prompt,
    questions: {
      tool: {
        type: "choice",
        instructions: "교사 요청에 가장 알맞은 도구를 하나 고른다. 맞는 도구가 없으면 none.",
        criteria,
      },
    },
  };
}

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function isChoiceAnswer(value) {
  if (!value || typeof value !== "object") return false;
  if (value.type !== "choice" || typeof value.choice !== "string") return false;
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) {
    return false;
  }
  return (
    value.probabilities !== null &&
    typeof value.probabilities === "object" &&
    !Array.isArray(value.probabilities)
  );
}

export function topCandidates(probabilities, tools, limit = CANDIDATE_LIMIT) {
  return tools
    .map((tool, index) => ({ tool, index, probability: numberOrZero(probabilities[tool.id]) }))
    .sort((left, right) => right.probability - left.probability || left.index - right.index)
    .slice(0, limit)
    .map(({ tool, probability }) => ({ ...publicTool(tool), probability }));
}

function baseResult(fields) {
  return {
    source: fields.source,
    action: fields.action,
    reason: fields.reason ?? null,
    confidence: fields.confidence ?? null,
    minConfidence: fields.minConfidence,
    tool: fields.tool ?? null,
    candidates: fields.candidates ?? [],
    catalog: fields.catalog ?? null,
    message: fields.message,
    warning: fields.warning ?? null,
  };
}

export function decideRoute({ answer, tools, threshold }) {
  const tool = tools.find((item) => item.id === answer.choice) ?? null;
  if (!tool && answer.choice !== NONE_CHOICE) {
    return {
      action: "fallback",
      reason: "unexpected-choice",
      confidence: answer.confidence,
      catalog: tools.map(publicTool),
      message: "분류 결과가 카탈로그에 없어 사람이 카탈로그를 보고 고릅니다.",
    };
  }
  if (answer.choice === NONE_CHOICE) {
    return {
      action: "unmatched",
      confidence: answer.confidence,
      candidates: topCandidates(answer.probabilities, tools),
      message: "마이클로 할 수 없는 일입니다. 도구를 실행하지 않습니다.",
    };
  }
  if (tool && answer.confidence >= threshold && tool.skill) {
    return {
      action: "run",
      confidence: answer.confidence,
      tool: publicTool(tool),
      message: `${tool.name} 스킬 ${tool.skill} 로 진행합니다.`,
    };
  }
  if (tool && answer.confidence >= threshold) {
    return {
      action: "manual",
      confidence: answer.confidence,
      tool: publicTool(tool),
      message: tool.url
        ? `${tool.name}: 아직 자동 스킬이 없습니다. 주소만 안내합니다.`
        : `${tool.name}: 아직 자동 스킬이 없고 주소도 확인되지 않았습니다.`,
    };
  }
  return {
    action: "ask",
    confidence: answer.confidence,
    candidates: topCandidates(answer.probabilities, tools),
    message: "신뢰도가 기준보다 낮습니다. 상위 후보를 교사에게 확인합니다.",
  };
}

function fromAnswer(source, payload, tools, threshold) {
  const answer = payload?.answers?.tool;
  if (!isChoiceAnswer(answer)) {
    return baseResult({
      source,
      action: "fallback",
      reason: "unexpected-response",
      minConfidence: threshold.value,
      catalog: tools.map(publicTool),
      message: "분류 응답 형식이 달라 사람이 카탈로그를 보고 고릅니다.",
      warning: threshold.warning,
    });
  }
  const decision = decideRoute({ answer, tools, threshold: threshold.value });
  return baseResult({
    source,
    minConfidence: threshold.value,
    warning: threshold.warning,
    ...decision,
  });
}

export async function routeTeacherRequest(options = {}) {
  const prompt = String(options.prompt ?? "").trim();
  const tools = options.tools ?? loadCatalog().tools;
  const threshold = resolveMinConfidence(options.minConfidence);
  if (!prompt) {
    return baseResult({
      source: "refused",
      action: "refused",
      reason: "empty-prompt",
      minConfidence: threshold.value,
      message: "요청 문장이 필요합니다.",
      warning: threshold.warning,
    });
  }
  const sensitive = findSensitive(prompt);
  if (sensitive) {
    return baseResult({
      source: "refused",
      action: "refused",
      reason: "sensitive",
      minConfidence: threshold.value,
      message: `민감정보(${sensitive})가 있어 분류하지 않습니다.`,
      warning: threshold.warning,
    });
  }
  if (options.mockResponse) {
    return fromAnswer("mock", options.mockResponse, tools, threshold);
  }
  if (!options.apiKey) {
    return baseResult({
      source: "fallback",
      action: "fallback",
      reason: "missing-key",
      minConfidence: threshold.value,
      catalog: tools.map(publicTool),
      message: "저장된 Jev 키가 없어 사람이 카탈로그를 보고 고릅니다.",
      warning: threshold.warning,
    });
  }
  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(JEV_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildJevRequest(prompt, tools)),
    });
    if (!response.ok) {
      return baseResult({
        source: "fallback",
        action: "fallback",
        reason: "request-failed",
        minConfidence: threshold.value,
        catalog: tools.map(publicTool),
        message: `분류 호출이 실패했습니다 (${response.status}). 사람이 카탈로그를 보고 고릅니다.`,
        warning: threshold.warning,
      });
    }
    return fromAnswer("jev", await response.json(), tools, threshold);
  } catch {
    return baseResult({
      source: "fallback",
      action: "fallback",
      reason: "request-failed",
      minConfidence: threshold.value,
      catalog: tools.map(publicTool),
      message: "분류 호출이 실패했습니다. 사람이 카탈로그를 보고 고릅니다.",
      warning: threshold.warning,
    });
  }
}
