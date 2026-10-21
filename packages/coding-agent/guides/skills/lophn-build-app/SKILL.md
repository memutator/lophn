---
name: lophn-build-app
description: "맡겨진 구현이나 수리 ticket 하나로 lophn 앱을 만들거나 고치는 절차. lophn CLI로 ticket 읽기와 claim, 구현, release 준비, 실제 테스트, preview, release 확인, 결과 보고 순서를 따른다. 맡겨지지 않은 ticket은 claim하지 않는다."
---

# lophn 앱 제작

맡겨진 구현(implementation)이나 수리 ticket 하나로 앱을 만들거나 고치는 절차다.
모든 작업은 ticket 하나의 현재 claim 아래에서만 한다. 통로는 `lophn` CLI 하나다.
이 터미널의 working directory가 앱 source 폴더이고 CLI는 그 앱 하나만 본다.

## 시작 조건

- 맡겨진 ticket만 claim한다. `lophn ticket list`로 열린 ticket이 보이는 것은
  착수 지시가 아니다. 목록에서 일을 골라 claim하지 않는다.
- 사람이 ticket 없이 "이 앱을 만들어 줘"나 "고쳐 줘"라고만 했으면 code를
  시작하지 않는다. lophn의 App Engineer가 요청을 ticket으로 정리해 맡길 것이라고
  안내한다.

## 명령

모든 명령은 `lophn <명령> --input '<JSON>'`이고 입력 칸은
`lophn <명령> --help`로 본다.

- ticket: `ticket list`, `ticket show`, `ticket claim`, `ticket renew`,
  `ticket report`
- 앱: `app show`, `app status`, `app blueprint`, `app invocations`, `app logs`,
  `app test`, `app test status`, `app test result`, `app preview start`,
  `app preview stop`
- release: `release prepare`, `release status`
- 사용자 package 안내(읽기만): `package list`, `package show`. 내장 SDK는 여기에
  없다(아래 4)
- App Engineer에게 청하기: `message send`

입력에 `app`이 필수인 명령(`app show`, `release prepare` 등)에는 앱 id를 넣는다.
core가 token에서 채워 주지 않는다. 값은 `ticket show` 출력의 `app`이다.

## 순서

1. 맡겨진 ticket을 읽는다. `ticket show`로 목표, 근거(annotation의 메모,
   component 겹, 요소 글자, screenshot 파일 경로), acceptance 조건, 보고할 실패
   분기와 이름, 볼 곳과 지킬 것을 읽는다. 목표에 App Engineer의 설계(재사용,
   모델, journey, 화면, tool)가 있으면 그대로 만든다. 화면은 적힌 배치, 조작,
   상태대로 짓는다. 설계와 다르게 해야 하면 먼저 `message send`로 App
   Engineer에게 청한다. acceptance 조건이 예시(`examples`)이면 tool과 입력, 기대
   결과를 그대로 읽는다. 예시는 고치지 않는다. 틀린 것 같으면 `message send`로
   App Engineer에게 청한다. 작업 가능하지 않다고 나오면 claim하지 않고
   `message send`로 알린다.
2. claim한다. `ticket claim`에 ticket과 읽은 revision(`base_revision`)을 준다.
   응답의 `claim_seq`와 `expires_at`을 기억한다. 기한 안에 끝나지 않으면 기한
   전에 `ticket renew`를 부른다.
3. 현재 앱을 읽는다. `app show`, `app blueprint`로 선언된 tool(blueprint의
   `tools`)과 화면을 보고, ticket이 가리킨 source를 읽는다(component 겹과 요소
   글자, 화면 이름으로 source를 검색해 찾는다). 앱 root의 안내 파일이 있으면
   먼저 읽는다. 고치는 ticket이면 `app status`, `app logs`, `app invocations`로
   증상의 근거를 읽는다.
4. 쓸 package를 찾는다. 새 code를 쓰기 전에 이 앱이 의존으로 선언한 package의
   API와 예제를 읽는다. 내장 SDK(`@lophn/app-ui`, `@lophn/blueprint`,
   `@lophn/cap-tool`, `@lophn/cap-store`, `@lophn/cap-problem`, `@lophn/cap-fs`,
   `@lophn/cap-net`, `@lophn/cap-secret`)는 앱 `.lophn/import-map.json`이
   가리키는 설치 사본 폴더의 `guide.md`를, 사용자 package는 `package show`를
   읽는다. 외부 network(`cap-net`, 사람이 켠 host·port와 같은 컴퓨터의 loopback
   서비스), 앱에 값이 없는 secret(`cap-secret`, `cap-net` 요청에 lophn이
   붙인다), 허락된 경로의 file(`cap-fs`)은 이 셋으로만 한다. 쓰려면 blueprint에
   `permissions`와 `sdk_dependencies`가 있어야 하므로 5번처럼 App Engineer에게
   청한다. 앱 `deno.json`의 `imports`에도 같은 이름과 판을 더한다(예:
   `"@lophn/cap-net": "lophn-sdk:@lophn/cap-net@1.0.0/mod.ts"`). 둘이 다르면
   release 준비가 거절한다. 선언되지 않은 package는 쓸 수 없다. UI는
   `@lophn/ui/<분류>`에서 import한다.
   - primitives: Button, Icon 등 기본 조작
   - input: form 칸과 filter
   - layout: AppShell, Grid, Card 같은 페이지 틀
   - navigation: Tabs, Sidebar
   - data: Table, DataTable, Tree, List, StatTile, 차트
   - feedback: Skeleton, EmptyState, ErrorState, ReadState
   - overlay: Dialog, Menu, Popover, Toast 등
   - reading: Markdown, CodeBlock, Toc

   어떤 component가 있는지는 분류의 `mod.ts`가 목록이고 export마다 "언제 쓰나"
   한 줄이 있다. 위치는 앱 `.lophn/import-map.json`의 `@lophn/ui/<분류>` 값이
   가리키는 설치 사본이다. token과 기본 글꼴은 `@lophn/ui/tokens.css`,
   `@lophn/ui/base.css`로 받고, 앱 CSS는 token 변수만 쓴다. 사람이 고른 accent,
   배경, 글꼴이 token 변수로 앱에 들어오니 색과 글꼴 값을 직접 쓰지 않는다. 앱
   bridge를 쓰는 ToolButton, useTool, AppErrorBoundary는
   `@lophn/app-ui`다(guide는 그 설치 사본의 `guide.md`). 고치고 싶은 component는
   그 파일을 앱 `src/`로 복사해 쓴다. 복사한 파일은 앱 것이라 이후 lophn의 UI
   update가 닿지 않는다.
5. blueprint나 의존을 바꿔야 하면 직접 고치지 않는다. 무엇을 왜 바꿔야 하는지
   `message send`로 App Engineer에게 청하고 답을 기다린다. tool 선언에는
   tool마다 `domain`이 필요하다: 이 앱의 domain 이름. 앱 이름의 domain이 있다.
   다른 domain이 필요하면 App Engineer에게 청한다.
6. 구현한다. 화면과 tool(`src/tools.ts`의 `tool(name, handler)` 등록, 화면에서는
   `lophnApp.callTool(tool, input)`)은 blueprint 선언과 맞게 쓰고, 생성물은
   손으로 고치지 않는다. 기존 fixture와 ticket의 지킬 것을 보존한다. ticket이
   적은 실패 분기마다 `@lophn/cap-problem`의 `reportProblem(name,
   message)`을
   그 자리에 둔다. 앱 log에 error 한 줄이 남는다. 원인이 다른 실패는 이름을
   나눈다. 진입점이 앱 log에 쓰는 잡히지 않은 예외와 handler가 던진 `Error`는
   따로 보고하지 않는다. 대상은 거절로 끝나는 업무 분기, 외부 호출 실패, 조용히
   넘어가는 fallback이다. ticket에 보고 자리가 없는데 필요해 보이면
   `message send`로 App Engineer에게 청한다. 규칙은 cap-problem `guide.md`를
   읽는다.
7. release를 준비한다. 구현을 commit한 뒤 `release prepare`를 부르고
   `release status`로 `status`가 `completed`가 될 때까지 읽는다. claim이
   만료되었으면 준비하지 않고 먼저 `ticket show`로 claim을 확인한다. 준비가
   끝나면 `bundle_hash`와 `test`(고정 시험 hash)가 나온다. test는 이 bundle에
   대해서만 돌므로 source가 바뀌면 다시 준비한다. 준비는 activation이 아니다.
8. 실제 테스트를 돌린다. `app test`는 플랫폼 검사다. 입력은
   `{"kind":"app_test","request_key":"<새 key>","app":"<app>"}` 뿐이다. bundle과
   test는 core가 7에서 마지막으로 끝난 준비 값으로 채운다. `app test status`에
   `request_key`를 주어 접수와 `result_ref`를 읽고, `app test result`에
   `result_ref`를 주어 통과·실패와 이유를 읽는다. 결과는 runner가 낸 test
   result다. 실패·timeout· 미실행이면 원인을 고쳐 다시 준비하고 요청한다. 통과
   전에 보고하지 않는다. source가 바뀌면 이전 통과를 쓰지 않는다. 직접 돌린
   shell 결과는 test result가 아니다. 예시는 보고한 뒤 program이 보고한
   release로 돌린다. 예시의 tool을 그 입력으로 불렀을 때 기대 결과가 나오도록
   만든다.
9. preview로 확인한다. `app preview start`로 fixture 격리 preview를 열고 화면과
   tool을 확인한 뒤 `app preview stop`으로 닫는다. preview 결과는 운영이
   정상이라는 증거가 아니다. harness에 MCP server `lophn`이 연결돼 있으면
   preview를 연 뒤 이 앱의 tool을 MCP로 부를 수 있다. preview가 없으면
   `unavailable`이다. 운영 앱은 부를 수 없다. MCP가 안 보이면
   `lophn app preview start` 뒤 harness에서 MCP를 다시 연결한다.
10. release를 확인한다. 테스트가 통과한 뒤 `release status`를 다시 읽으면 core가
    release를 확정하고 `release`(id)를 준다. 새 release를 운영에 켜는 일은
    사람이 한다.
11. 결과를 보고한다. `ticket report`에 확정된 release와 summary(변경 내용,
    수행한 확인, 미실행 확인, 한계)를 담는다. 접수되면 claim이 끝난다.

## 결과를 쓸 때

다음을 서로 다른 말로 쓴다. 하나로 뭉치지 않는다.

- 완료 주장: 내가 끝냈다고 보는 것
- preview: fixture에서 본 동작
- 실제 test result: runner가 낸 통과·실패·미실행(이유 포함)
- release 준비: 준비된 release가 있다는 것
- activation: 사람이 운영에 켠 것

실패하거나 돌리지 못한 확인, 알려진 한계를 그대로 적는다. test result는
machine이 낸다. 보고서에서 만들어 내지 않는다.

## 하지 않는 것

- 맡겨지지 않은 ticket을 claim하거나 claim 없이 source를 바꾸지 않는다.
- 테스트 기대값을 낮춰 통과시키지 않는다.
- ticket의 목표를 바꾸지 않는다. 바꿔야 하면 `message send`로 App Engineer에게
  청한다.
- 운영 앱 시작·중지, release activation, secret 값은 요청하지 않는다. 사람이
  화면에서 한다.
