---
name: mycl-router
description: "교사의 평문 요청을 마이클 도구로 고른다. TypeSafe Jev Choice로 tools/catalog.json의 id를 분류하고, 신뢰도가 기준 이상이면 해당 스킬로 넘긴다. 낮으면 상위 후보를 교사에게 묻는다. 키가 없거나 호출이 실패하면 카탈로그를 보고 직접 고른다. 가정통신문, 생기부, 세특, 평가계획, 한글 에디터처럼 어떤 도구인지 모를 때 쓴다."
allowed-tools: AskUserQuestion
---

# 마이클 도구 고르기

Codex 한 줄 설치에서는 보조 파일과 스크립트를 `~/.local/share/mycl-plugin`을 기준으로 읽거나 실행한다. 수동 설치는 클론 폴더를 기준으로 삼는다.

평문으로 문서 종류가 분명하지 않으면 이 스킬을 먼저 쓴다. 교사가 이미 카탈로그에 있는 도구 이름을 말했고 그 도구에 스킬이 있으면 그 스킬로 바로 간다.

## 절대 규칙

- 「저장」은 누르지 않는다. 「나이스 반영하기 →」도 누르지 않는다.
- 공유, 발송, 결제, 구독 변경, 가입, 삭제는 사용자가 대화에서 확인한 뒤에만 한다.
- 학생 실명과 민감정보를 폼, 문서, Jev 요청에 넣지 않는다. 주민등록, 주민번호, 계좌번호가 있으면 스크립트가 분류를 거절한다.
- 키 값은 채팅, 프롬프트, 로그, 저장소, 명령 인자에 넣지 않는다. `credentials` 파일과 키체인 값을 읽지 않는다. 상태는 `node scripts/mycl.mjs key status` 만 보고, 거기에는 끝 네 자리만 있다.
- 카탈로그에 없는 주소는 만들지 않는다. `url` 이 null 이면 `urlTodo` 를 전하고 그 도구 페이지를 열지 않는다.
- 실계정으로 로그인하지 않은 상태에서는 브라우저 작업을 시작하지 않는다. 도구가 정해진 뒤에만 `mycl-login-check` 를 따른다.

## 키가 없을 때

`node scripts/mycl.mjs key status` 가 `configured: false` 이면 분류 전에 묻는다. 키 값을 채팅에 붙여 달라고 하지 않는다.

Claude Code 는 `AskUserQuestion` 도구를 한 번 호출한다. 형식은 [도구 문서](https://code.claude.com/docs/en/tools)와 [Agent SDK 입력](https://code.claude.com/docs/en/agent-sdk/user-input)의 `questions` 배열이다. `header` 는 12자 이하이고, 선택지는 2개에서 4개다.

```json
{
  "questions": [
    {
      "question": "Jev API 키를 어떻게 할까요? 키 값은 채팅에 붙이지 않습니다.",
      "header": "Jev 키",
      "multiSelect": false,
      "options": [
        {
          "label": "지금 Jev 키 입력",
          "description": "이 컴퓨터의 브라우저에서만 키를 받습니다."
        },
        {
          "label": "키 없이 진행(Claude·Codex가 직접 선택)",
          "description": "Jev를 호출하지 않고 카탈로그를 보고 직접 고릅니다."
        },
        {
          "label": "키 발급 안내 열기",
          "description": "TypeSafe 콘솔 https://console.typesafe.ai/keys 를 엽니다."
        }
      ]
    }
  ]
}
```

Codex 에는 이 도구가 없다. 같은 질문과 같은 세 라벨만 대화로 묻는다.

- `지금 Jev 키 입력`: `node scripts/setup-key.mjs` 를 실행한다. 키를 인자로 넘기지 않는다.
- `키 없이 진행(Claude·Codex가 직접 선택)`: 아래 분류로 간다. 키가 없으면 결과가 `fallback` 이다.
- `키 발급 안내 열기`: https://console.typesafe.ai/keys 를 안내하고, 다시 같은 질문을 한다.

키를 지우거나 바꿀 때는 `node scripts/mycl.mjs key reset` 뒤에 다시 설정한다. 환경변수 `TYPESAFE_API_KEY` 가 남아 있으면 그것이 파일과 키체인보다 먼저 쓰인다.

## 순서

1. 교사 요청에서 실명과 민감정보를 빼 달라고 한 뒤, 남은 문장으로 분류한다.

```bash
node scripts/route.mjs --prompt "교사 요청"
```

기준값을 바꾸려면 `MYCL_ROUTER_MIN_CONFIDENCE` 또는 `--min-confidence` 를 쓴다. 기본은 0.8이다.

2. 표준 출력 JSON 의 `action` 만 따른다.

- `run`: `tool.skill` 의 `SKILL.md` 를 읽고 그 절차로 간다. 스킬이 있는 도구는 `mycl-gajeong-tongsin`, `mycl-haengbal`, `mycl-subject-comment` 다.
- `manual`: 자동 스킬이 없다. `tool.url` 이 있으면 그 주소만 안내한다. `url` 이 null 이면 `urlTodo` 를 알리고 주소를 추측하지 않는다. 브라우저를 열지 않는다.
- `ask`: `candidates` 의 이름, 쓰임새, 확률을 교사에게 보여주고 고르기를 기다린다. 고르기 전에는 스킬을 시작하지 않는다.
- `unmatched`: 선택지가 `none`(맞는 도구 없음)이다. 도구를 실행하지 않고, 마이클로 할 수 없는 일이라고 알린다.
- `fallback`: Jev 를 쓰지 못했다. `catalog` 를 읽고 사람이 도구를 고른다. Jev 가 골랐다고 말하지 않는다. 확신이 낮으면 `ask` 와 같이 교사에게 묻는다.
- `refused`: 요청이 비었거나 민감정보가 있다. 분류를 다시 보내지 않는다.

3. 스킬로 넘어간 뒤의 클릭은 `node scripts/check-click.mjs "접근 가능한 이름"` 을 먼저 실행한다. 저장과 나이스 반영은 확인해도 거절된다.

Jev 호출은 `POST https://api.typesafe.ai/v1/systemone` 이다. `model` 은 `jev-latest`, 질문은 `questions.tool` 의 Choice 이고 `criteria` 키는 카탈로그 id 와 `none` 이다. 응답은 `answers.tool.choice`, `confidence`, `probabilities` 를 쓴다. 한국어를 지원한다고 문서가 언어 이름으로 적지는 않았다. Jev 1.14 변경 기록의 다국어 개선과, state 가 자연어 문자열이라는 점만 확인됐다. 교사 요청은 그 문자열로 보낸다.
