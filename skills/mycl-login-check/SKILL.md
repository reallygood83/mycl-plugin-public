---
name: mycl-login-check
description: "마이클(mycl.io)에 로그인돼 있는지 확인한다. 입구는 티처빌 통합로그인이다. 저장된 세션이 /signup?key= 또는 /landing#pricing 으로 튕기면 실패로 보고, 사람에게 scripts/login.mjs 로 직접 로그인해 달라고 한다. 가입·결제·구독 화면은 누르지 않는다. 가정통신문 등 마이클 작업을 시작하기 전에 쓴다."
---

# 마이클 로그인 확인

공식 표기는 마이클 / MyClass 이고 도메인은 mycl.io 다. 공개 배포, 마켓플레이스 등록, 저장소 공개 전환은 하지 않는다.

문구의 기준 파일은 `scripts/selectors.json` 이다. 화면과 다르면 그 파일을 고치고, 맞는 문구를 확인하기 전에는 추측해서 가입·결제 버튼을 누르지 않는다.

## 절대 규칙

- 비밀번호를 묻거나 입력하거나 저장하지 않는다. `browser_storage_state` 로 세션을 워크스페이스에 쓰지 않는다.
- 프로필, storageState, 쿠키, `.env`, `out/` 의 파일을 커밋하지 않는다.
- 「저장」은 누르지 않는다. 문서함 저장 창은 전체 공개가 기본이다.
- 「나이스 반영하기 →」는 누르지 않는다.
- 공유, 발송, 결제, 구독 변경, 가입, 삭제는 사용자가 대화에서 확인하기 전에는 하지 않는다.
- 학생 실명과 민감정보를 넣지 않는다.
- `browser_click` 전에 `node scripts/check-click.mjs "접근 가능한 이름"` 을 실행한다. 종료 코드가 0이 아니면 누르지 않는다. 이 검사는 금지 목록이라서, 목록에 없다고 절차에 없는 버튼을 눌러도 된다는 뜻이 아니다.
- 저장과 나이스 반영은 `--confirmed` 를 붙여도 거절된다.

## 순서

1. Playwright MCP 가 `~/.mycl-profile` 을 `--user-data-dir` 로 쓰는지 본다. 같은 프로필은 브라우저 하나에서만 연다. 로그인 창이 열려 있으면 닫힌 뒤에 진행한다.
2. `browser_navigate` 로 `https://mycl.io/tool/list` 를 연다. 로그인 입구 자체는 `https://www.teacherville.co.kr/portal/memship/loginSSL.edu?svcType=8&isMyclApp=false&envType=op` 이다. 그 주소의 비밀번호 칸은 채우지 않는다.
3. 주소창의 최종 URL 을 읽는다. 중간에 `/signup?key=…` 를 지나 `/landing#pricing` 에 멈춰도 실패다.
4. 실패로 보는 주소
   - 호스트가 mycl.io 이고 경로가 `/signup` 으로 시작한다.
   - 호스트가 mycl.io 이고 경로가 `/landing` 으로 시작한다. `#pricing` 이 붙어 있으면 요금제 화면이다.
5. 실패이거나 티처빌 로그인 페이지에 머무르면 아무 버튼도 누르지 않는다. 가입, 결제, 구독, 요금제 시작을 누르지 않는다. 사용자에게 화면이 있는 컴퓨터에서 아래를 실행해 직접 로그인해 달라고 한다.

```bash
npm install
npx playwright install chromium
npm run login
```

6. 호스트가 mycl.io 이고 위의 실패 경로가 아니면 로그인된 것으로 보고한다. 비밀번호는 다루지 않는다.

`scripts/lib/login-status.mjs` 의 `classifyLocation` 이 이 판정과 같다. 가짜 페이지 테스트가 그 함수를 고정한다.
