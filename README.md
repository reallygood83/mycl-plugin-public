# 마이클 문서 플러그인

**만든 사람 · 배움의 달인** — [X (@reallygood83)](https://x.com/reallygood83) · [Threads (@learning.masters)](https://www.threads.com/@learning.masters) · [YouTube (배움의 달인)](https://www.youtube.com/@%EB%B0%B0%EC%9B%80%EC%9D%98%EB%8B%AC%EC%9D%B8-p5v)

마이클(MyClass, [mycl.io](https://mycl.io))에서 하는 교사용 문서 작업을 Claude Code와 Codex로 돕는 비공식 로컬 플러그인이다. 테크빌교육의 공식 제품이 아니며, 사용자는 자신의 티처빌 계정으로 직접 로그인한다. GitHub에서 받아 설치하며 ChatGPT 웹이나 공식 플러그인 디렉터리에는 등록되어 있지 않다.

마이클에는 공개 API 가 없다. 브라우저는 [Playwright MCP](https://github.com/microsoft/playwright-mcp) 로 다루고, 로그인 세션은 `~/.mycl-profile` 에만 남긴다.

로그인 확인, 가정통신문(`seq=6`), 그리고 평문 요청을 도구로 고르는 라우터까지 있다. 이 저장소의 테스트는 가짜 HTML 과 가짜 Jev 응답으로 돌리고, 실계정과 실제 Jev 에는 접속하지 않는다.

## Codex 한 줄 설치

**macOS**에서 Codex CLI, Node.js 20 이상, Git이 필요하다. 터미널에서 `codex --version`이 실행되지 않으면 [Codex CLI 설치 안내](https://learn.chatgpt.com/docs/cli)를 먼저 따른다. Codex 데스크톱 앱을 쓰는 경우에도 이 설치 명령에는 CLI가 필요하다.

터미널에 이 한 줄을 붙여 넣는다.

```bash
installer="$(curl -fsSL https://raw.githubusercontent.com/reallygood83/mycl-plugin-public/main/install.sh)" && bash -c "$installer"
```

1. 설치가 끝나면 열린 Chromium 창에서 **본인 티처빌 계정으로 직접 로그인**한다. 비밀번호는 채팅에 입력하지 않는다.
2. 로그인 창이 닫힌 뒤 Codex에서 새 세션을 시작한다. 데스크톱 앱이 설치 중 열려 있었다면 앱을 다시 연다.
3. Codex에 **“마이클 로그인 확인해 줘”**라고 입력한다. 로그인이 확인되면 **“마이클로 현장체험학습 가정통신문 초안을 만들어 줘”**로 시작할 수 있다.

업데이트할 때는 같은 명령을 다시 실행한다. 이미 로그인했다면 위 명령의 끝에 ` -- --no-login`을 붙여 로그인 창을 건너뛸 수 있다. 세션이 만료되면 기존 Codex 세션에서 마이클 브라우저를 닫고 `npm --prefix "$HOME/.local/share/mycl-plugin" run login`으로 다시 로그인한다.

설치 파일은 `~/.local/share/mycl-plugin`, Codex 스킬은 `~/.agents/skills`, 티처빌 로그인은 `~/.mycl-profile`에 둔다. 다른 MCP 설정은 유지한다. `codex mcp list`에서 `mycl-browser` 등록을 확인할 수 있다. 마이클의 문서 도구는 계정 권한에 따라 이용 범위가 달라질 수 있다.

## 들어 있는 것

| 경로 | 역할 |
| --- | --- |
| `.claude-plugin/plugin.json` | Claude Code 플러그인 매니페스트 |
| `.mcp.json` | 플러그인이 켜는 Playwright MCP. 프로필을 `~/.mycl-profile` 로 고정한다 |
| `skills/` | Claude Code 가 읽는 스킬 원본 |
| `.agents/skills/` | Codex 가 읽는 같은 스킬. `skills/` 로 연결된다 |
| `codex/config.toml.example` | `~/.codex/config.toml` 에 합칠 MCP 예시 |
| `scripts/login.mjs` | 사람이 직접 로그인하는 창. 비밀번호는 받지 않는다 |
| `scripts/selectors.json` | 화면 문구와 선택자. 아직 모르는 문구는 TODO |
| `tools/catalog.json` | 확인된 마이클 도구. 모르는 주소와 필수 입력은 TODO |
| `scripts/route.mjs` | 교사 요청을 도구로 고른다. 키는 `TYPESAFE_API_KEY` 환경변수만 읽는다 |
| `AGENTS.md` | Codex 가 항상 따르는 규칙 |

## Claude Code

형식은 [플러그인 만들기](https://code.claude.com/docs/en/plugins/create), [매니페스트](https://code.claude.com/docs/en/plugins/manifest-reference), [구성 요소](https://code.claude.com/docs/en/plugins/components), [MCP](https://code.claude.com/docs/en/mcp) 를 따른다. 스킬은 `skills/<이름>/SKILL.md` 이고, MCP 는 플러그인 루트의 `.mcp.json` 이다. `.claude-plugin/` 안에는 `plugin.json` 만 둔다.

마켓플레이스에는 등록하지 않는다. 클론한 디렉터리를 세션에 직접 붙인다.

```bash
claude --plugin-dir /절대경로/mycl-plugin
```

이 컴퓨터의 모든 세션에서 쓰려면 클론을 개인 스킬 디렉터리로 연결한다. `plugin.json` 이 있는 폴더는 세션이 시작될 때 읽힌다.

```bash
ln -s /절대경로/mycl-plugin ~/.claude/skills/mycl-plugin
```

스킬 명령은 `/mycl-plugin:mycl-login-check`, `/mycl-plugin:mycl-gajeong-tongsin`, `/mycl-plugin:mycl-haengbal`, `/mycl-plugin:mycl-subject-comment` 이다. `.mcp.json` 의 `${HOME}` 은 Claude Code 가 펼친다. `HOME` 이 없는 환경이면 그 값을 먼저 설정한다.

Playwright MCP 는 헤드 모드가 기본이다. `--headless`, `--isolated`, `--storage-state`, `--save-session` 은 넣지 않는다. 세션을 메모리에만 두거나 워크스페이스에 쿠키를 쓰면 안 된다.

## Claude Code 수동 설치와 로그인

에이전트는 비밀번호를 받지 않는다. 화면이 있는 컴퓨터에서 한 번만 직접 로그인한다.

```bash
git clone https://github.com/reallygood83/mycl-plugin-public.git
cd mycl-plugin-public
npm install
npx playwright install chromium
npm run login
```

창이 티처빌 통합로그인으로 열린다.

`https://www.teacherville.co.kr/portal/memship/loginSSL.edu?svcType=8&isMyclApp=false&envType=op`

그 창에서 직접 로그인하면 mycl.io 로 돌아오고, 세션은 `~/.mycl-profile` 에 저장된다. 저장된 세션이 `/signup?key=…` 를 거쳐 `/landing#pricing` 으로 가면 로그인 실패다. 가입, 결제, 구독 버튼은 누르지 않는다. 그 창에서 다시 로그인하면 스크립트가 성공할 때까지 기다린다. 같은 프로필을 쓰는 다른 브라우저는 미리 닫는다.

## 가정통신문

`/mycl-plugin:mycl-gajeong-tongsin` 또는 Codex 에서 가정통신문을 만들어 달라고 하면 된다. 순서는 `skills/mycl-gajeong-tongsin/SKILL.md` 에 있다.

1. `https://mycl.io/tool/create?seq=6` 폼을 채우고 「자동 생성」을 누른다.
2. 주소는 `/tool/create?seq=6&librarySeq=N` 으로 바뀌고 편집기로 자동 이동하지 않는다. 편집은 `/v2/edit?seq=6&librarySeq=N` 에서 툴바 Replace 의 `Replace All` 로 한다.
3. 결과의 기본 학교는 계정 학교다. 확인된 문구는 박달초등학교, 교무실·행정실 02-3442-7783, FAX 02-3442-7793, 서명 `박달초등학교장 [직인생략]` 이다.
4. 연락처를 주지 않으면 그 번호를 비우고, 비웠다고 알린다.
5. 접근성 이름 「내려받기 옵션 열기」로 메뉴를 열고, 항목 「HWP」가 없으면 「PDF」를 `./out` 에 둔다. 「저장」(접근성 이름 「문서 저장」)은 누르지 않는다. 저장하기 창이 뜨면 「취소」로 닫는다.

한글이 깨지면 한 글자씩 치지 말고 붙여넣는다.

## 도구 고르기

교사가 평문으로 요청하면 `mycl-router` 가 `tools/catalog.json` 의 도구 id 를 TypeSafe Jev Choice 질문으로 보낸다. 호출은 `POST https://api.typesafe.ai/v1/systemone`, 모델은 `jev-latest`, 인증은 `Authorization: Bearer` 와 환경변수 `TYPESAFE_API_KEY` 다. 키 값은 이 문서에 적지 않는다.

```bash
node scripts/route.mjs --prompt "학부모 안내문 만들어 줘"
```

신뢰도 기본 기준은 0.8이고 `MYCL_ROUTER_MIN_CONFIDENCE` 또는 `--min-confidence` 로 바꾼다. 기준 이상이고 스킬이 있으면 그 스킬로 간다. 스킬이 없으면 확인된 주소만 안내한다. 기준보다 낮으면 상위 3개 후보를 교사에게 묻는다. 키가 없거나 호출이 실패하면 카탈로그를 보고 사람이 고른다.

키를 넣는 순서는 다음과 같다.

1. 키가 없으면 Claude Code 는 `AskUserQuestion` 으로, Codex 는 같은 세 가지를 묻는다. 「지금 Jev 키 입력」, 「키 없이 진행(Claude·Codex가 직접 선택)」, 「키 발급 안내 열기」.
2. 입력을 고르면 `node scripts/setup-key.mjs` 가 `127.0.0.1` 에서만 열리는 일회용 페이지를 띄운다. [TypeSafe 콘솔](https://console.typesafe.ai/keys)에서 키를 만들어 가림 칸에 붙여 넣고 저장한다. 채팅에는 붙이지 않는다.
3. 저장 전에 `GET https://api.typesafe.ai/v1/models` 로 키를 확인한다. 화면과 `node scripts/mycl.mjs key status` 에는 끝 네 자리만 나온다.
4. 찾는 순서는 환경변수 `TYPESAFE_API_KEY`, OS 키체인, `~/.config/mycl-plugin/credentials`(권한 600)이다. 지우거나 바꿀 때는 `node scripts/mycl.mjs key reset` 이다.

Jev 1.14 변경 기록은 다국어 지원이 나아졌다고만 한다. 한국어라는 언어 이름은 문서에 없다. 교사 요청은 문서가 허용하는 자연어 `state` 문자열로 보낸다.

## 안전 수칙

- 「저장」은 누르지 않는다. 문서함 저장은 전체 공개가 기본이다.
- 「나이스 반영하기 →」는 누르지 않는다.
- 공유, 발송, 결제, 구독 변경, 가입, 삭제는 사용자가 확인한 뒤에만 한다.
- 학생 실명과 민감정보를 넣지 않는다.
- 비밀번호, 세션, storageState, 쿠키, 프로필, 내려받은 파일을 커밋하지 않는다.

클릭 전에는 `node scripts/check-click.mjs "버튼 문구"` 를 실행한다. 저장, 나이스 반영, 일괄 등록, 유사도 검사는 확인 플래그를 줘도 거절한다.

## 테스트

```bash
npx playwright install chromium
npm test
```

가짜 편집기에서 학교명·연락처 바꾸기와, 「저장」「나이스 반영하기」를 누르지 않는 가드를 확인한다. mycl.io 에는 접속하지 않는다.

## 실계정으로 나중에 볼 것

가정통신문 화면 문구, 내려받기 항목 「HWP」「PDF」, 찾기/바꾸기 라벨, 저장하기 창, 카탈로그 경로는 확인됐다. 아직 남은 것은 다음이다.

- 중학 평가계획서, 유사도 검사, AI 한글 에디터의 필수 입력. 행발과 교과 세특의 칸과 주소는 확인됐다. 목록 카드 seq=107·82는 각각 108·46으로 넘어가는 별칭이다
- 나머지 약 45개 도구
- 계정 기본 학교가 박달초등학교가 아닐 때의 머리글 문구
- 헤드 모드 브라우저가 사용자 화면에서 열리는지
