import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadCatalog } from "../scripts/lib/catalog.mjs";
import {
  JEV_ENDPOINT,
  JEV_MODEL,
  buildJevRequest,
  decideRoute,
  routeTeacherRequest,
} from "../scripts/lib/router.mjs";

const root = path.resolve(import.meta.dirname, "..");
const catalog = loadCatalog();
const tools = catalog.tools;

function answer(choice, confidence, probabilities) {
  return {
    model: "jev-1.14.0",
    answers: {
      tool: { type: "choice", choice, confidence, probabilities },
    },
  };
}

test("카탈로그는 확인된 6개만 두고 모르는 주소는 비워 둔다", () => {
  assert.match(catalog.todo, /^TODO:/);
  assert.deepEqual(
    tools.map((tool) => tool.id),
    [
      "gajeong-tongsin",
      "middle-eval-plan",
      "hangeul-editor",
      "record-haengbal",
      "subject-comment",
      "record-similarity",
    ],
  );
  const byId = Object.fromEntries(tools.map((tool) => [tool.id, tool]));
  assert.equal(byId["gajeong-tongsin"].url, "https://mycl.io/tool/create?seq=6");
  assert.equal(byId["gajeong-tongsin"].skill, "mycl-gajeong-tongsin");
  assert.equal(byId["hangeul-editor"].url, "https://mycl.io/hceditor?seq=45");
  assert.equal(byId["record-haengbal"].url, "https://mycl.io/tool/create-no-modal?seq=108&levelSelect=1");
  assert.equal(byId["record-haengbal"].skill, "mycl-haengbal");
  assert.equal(byId["record-haengbal"].aliases[0].seq, 107);
  assert.equal(byId["middle-eval-plan"].url, "https://mycl.io/tool/create?seq=30");
  assert.equal(byId["subject-comment"].url, "https://mycl.io/tool/create-no-modal?seq=46");
  assert.equal(byId["subject-comment"].skill, "mycl-subject-comment");
  assert.equal(byId["subject-comment"].aliases[0].seq, 82);
  assert.match(byId["subject-comment"].summary, /교과 세특/);
  assert.match(byId["subject-comment"].summary, /과목별 세특/);
  assert.match(byId["subject-comment"].requiredInputsNote, /학교급/);
  assert.equal(byId["record-similarity"].url, "https://mycl.io/tool/create-no-modal?seq=74");
  assert.match(byId["record-similarity"].requiredInputsNote, /저장된 생기부/);
  for (const id of ["middle-eval-plan", "record-similarity", "hangeul-editor"]) {
    assert.match(byId[id].requiredInputsTodo, /^TODO:/);
    assert.equal(byId[id].skill, null);
  }
  for (const tool of tools) {
    if (tool.skill) assert.equal(existsSync(path.join(root, "skills", tool.skill, "SKILL.md")), true);
    if (tool.requiredInputs.length === 0) assert.match(tool.requiredInputsTodo, /^TODO:/);
  }
});

test("Jev 요청은 문서의 Choice 형태만 쓴다", () => {
  const request = buildJevRequest("가정통신문 써 줘", tools);
  assert.equal(request.model, JEV_MODEL);
  assert.equal(request.state, "가정통신문 써 줘");
  assert.equal(request.questions.tool.type, "choice");
  assert.equal(request.questions.tool.criteria["gajeong-tongsin"], tools[0].summary);
  assert.equal(typeof request.questions.tool.criteria.none, "string");
  assert.equal(Object.keys(request.questions.tool.criteria).length, tools.length + 1);
  assert.equal(JEV_ENDPOINT, "https://api.typesafe.ai/v1/systemone");
});

test("신뢰도가 기준 이상이면 스킬로 가고 없으면 주소만 안내한다", () => {
  const high = decideRoute({
    answer: answer("gajeong-tongsin", 0.91, { "gajeong-tongsin": 0.91 }).answers.tool,
    tools,
    threshold: 0.8,
  });
  assert.equal(high.action, "run");
  assert.equal(high.tool.skill, "mycl-gajeong-tongsin");

  const manual = decideRoute({
    answer: answer("record-similarity", 0.9, { "record-similarity": 0.9 }).answers.tool,
    tools,
    threshold: 0.8,
  });
  assert.equal(manual.action, "manual");
  assert.equal(manual.tool.skill, null);
  assert.equal(manual.tool.url, "https://mycl.io/tool/create-no-modal?seq=74");
  assert.equal(manual.tool.urlTodo, null);

  const lowerThreshold = decideRoute({
    answer: answer("gajeong-tongsin", 0.6, { "gajeong-tongsin": 0.6 }).answers.tool,
    tools,
    threshold: 0.5,
  });
  assert.equal(lowerThreshold.action, "run");
});

test("기준보다 낮거나 카탈로그 밖이면 후보를 묻고 주소를 만들지 않는다", () => {
  const probabilities = {
    "gajeong-tongsin": 0.42,
    "middle-eval-plan": 0.3,
    "hangeul-editor": 0.2,
    "record-haengbal": 0.04,
    "subject-comment": 0.02,
    "record-similarity": 0.01,
    none: 0.01,
  };
  const asked = decideRoute({
    answer: answer("gajeong-tongsin", 0.79, probabilities).answers.tool,
    tools,
    threshold: 0.8,
  });
  assert.equal(asked.action, "ask");
  assert.deepEqual(
    asked.candidates.map((candidate) => candidate.id),
    ["gajeong-tongsin", "middle-eval-plan", "hangeul-editor"],
  );
  assert.equal(asked.candidates.some((candidate) => candidate.id === "none"), false);

  const unmatched = decideRoute({
    answer: answer("none", 0.95, { none: 0.95, "gajeong-tongsin": 0.05 }).answers.tool,
    tools,
    threshold: 0.8,
  });
  assert.equal(unmatched.action, "unmatched");
  assert.match(unmatched.message, /마이클로 할 수 없는 일/);
  assert.equal(unmatched.candidates[0].id, "gajeong-tongsin");
  assert.equal(unmatched.tool, undefined);
  const lowNone = decideRoute({
    answer: answer("none", 0.2, { none: 0.5, "hangeul-editor": 0.3 }).answers.tool,
    tools,
    threshold: 0.8,
  });
  assert.equal(lowNone.action, "unmatched");
  assert.equal(lowNone.tool, undefined);

  const unknown = decideRoute({
    answer: answer("not-a-tool", 0.99, { "not-a-tool": 0.99 }).answers.tool,
    tools,
    threshold: 0.8,
  });
  assert.equal(unknown.action, "fallback");
  assert.equal(unknown.reason, "unexpected-choice");
});

test("키가 없거나 호출이 실패하면 네트워크 없이 카탈로그 대체로 간다", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("network");
  };
  const missing = await routeTeacherRequest({
    prompt: "생기부 써 줘",
    tools,
    apiKey: "",
    fetchImpl,
  });
  assert.equal(missing.action, "fallback");
  assert.equal(missing.reason, "missing-key");
  assert.equal(missing.catalog.length, tools.length);
  assert.equal(calls, 0);

  const secret = "typesafe-test-key";
  const failed = await routeTeacherRequest({
    prompt: "세특 써 줘",
    tools,
    apiKey: secret,
    fetchImpl,
  });
  assert.equal(failed.reason, "request-failed");
  assert.equal(JSON.stringify(failed).includes(secret), false);
  assert.equal(calls, 1);

  const rejected = await routeTeacherRequest({
    prompt: "세특 써 줘",
    tools,
    apiKey: secret,
    fetchImpl: async (url, init) => {
      assert.equal(url, JEV_ENDPOINT);
      assert.equal(init.headers.Authorization, `Bearer ${secret}`);
      assert.equal(JSON.parse(init.body).model, JEV_MODEL);
      return { ok: false, status: 401, json: async () => ({ error: secret }) };
    },
  });
  assert.equal(rejected.reason, "request-failed");
  assert.equal(JSON.stringify(rejected).includes(secret), false);
  assert.equal(rejected.message.includes("401"), true);
});

test("가짜 Choice 응답으로 기준값 분기를 확인한다", async () => {
  const routed = await routeTeacherRequest({
    prompt: "가정통신문 하나 만들어 줘",
    tools,
    mockResponse: answer("gajeong-tongsin", 0.88, { "gajeong-tongsin": 0.88 }),
    apiKey: "should-not-be-sent",
    fetchImpl: () => {
      throw new Error("mock must not call the network");
    },
  });
  assert.equal(routed.source, "mock");
  assert.equal(routed.action, "run");
  assert.equal(routed.minConfidence, 0.8);

  const refused = await routeTeacherRequest({
    prompt: "주민등록번호를 넣어 줘",
    tools,
    mockResponse: answer("gajeong-tongsin", 1, {}),
  });
  assert.equal(refused.action, "refused");
  assert.match(refused.message, /민감정보/);
});

test("실측 문장은 고정 응답으로 후보를 확률순으로 묻고 none은 실행하지 않는다", async () => {
  const subjectDraft = await routeTeacherRequest({
    prompt: "국어 교과 세특 초안 부탁해",
    tools,
    mockResponse: answer("hangeul-editor", 0.23, {
      "hangeul-editor": 0.34,
      "subject-comment": 0.26,
      "gajeong-tongsin": 0.05,
    }),
  });
  assert.equal(subjectDraft.action, "ask");
  assert.equal(subjectDraft.confidence, 0.23);
  assert.deepEqual(
    subjectDraft.candidates.slice(0, 2).map((candidate) => [candidate.id, candidate.probability]),
    [
      ["hangeul-editor", 0.34],
      ["subject-comment", 0.26],
    ],
  );
  assert.ok(
    subjectDraft.candidates.every(
      (candidate, index) => index === 0 || candidate.probability <= subjectDraft.candidates[index - 1].probability,
    ),
  );

  const parentMeeting = await routeTeacherRequest({
    prompt: "학부모 상담 일정 짜줘",
    tools,
    mockResponse: answer("hangeul-editor", 0.77, {
      "hangeul-editor": 0.13,
      "gajeong-tongsin": 0.07,
    }),
  });
  assert.equal(parentMeeting.action, "ask");
  assert.equal(parentMeeting.confidence, 0.77);
  assert.notEqual(parentMeeting.action, "run");
  assert.deepEqual(
    parentMeeting.candidates.slice(0, 2).map((candidate) => [candidate.id, candidate.probability]),
    [
      ["hangeul-editor", 0.13],
      ["gajeong-tongsin", 0.07],
    ],
  );

  const none = await routeTeacherRequest({
    prompt: "학부모 상담 일정 짜줘",
    tools,
    mockResponse: answer("none", 0.91, {
      none: 0.8,
      "hangeul-editor": 0.13,
      "gajeong-tongsin": 0.07,
    }),
  });
  assert.equal(none.action, "unmatched");
  assert.equal(none.tool, null);
  assert.match(none.message, /마이클로 할 수 없는 일/);
  assert.match(buildJevRequest("요청", tools).questions.tool.criteria.none, /맞는 도구 없음/);
});

test("라우터 스크립트는 키 인자를 거절하고 가짜 응답으로 분기한다", () => {
  const secret = "cli-key-must-not-appear";
  const rejected = spawnSync(process.execPath, ["scripts/route.mjs", "--api-key", secret], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(rejected.status, 2);
  assert.equal(`${rejected.stdout}${rejected.stderr}`.includes(secret), false);

  const dir = mkdtempSync(path.join(tmpdir(), "mycl-jev-"));
  const mockPath = path.join(dir, "response.json");
  writeFileSync(
    mockPath,
    JSON.stringify(answer("hangeul-editor", 0.93, { "hangeul-editor": 0.93 })),
  );
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  const routed = spawnSync(
    process.execPath,
    ["scripts/route.mjs", "--prompt", "자유롭게 한글 문서 써 줘", "--mock", mockPath],
    { cwd: root, encoding: "utf8", env },
  );
  assert.equal(routed.status, 0);
  const body = JSON.parse(routed.stdout);
  assert.equal(body.action, "manual");
  assert.equal(body.tool.url, "https://mycl.io/hceditor?seq=45");
  assert.equal(body.tool.skill, null);

  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /TYPESAFE_API_KEY/);
  assert.doesNotMatch(readme, /Bearer [A-Za-z0-9]/);
});
