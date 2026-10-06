---
type: plan
concerns: [shell]
---
# shell 계획

최상위 concern `shell`의 leaf 8개(desktop, workspace, terminal, confirmation-window, app-frame, editor, wording, design-system)를 만든다. 코드 자리는 `apps/shell/`(main, preload, ipc, renderer, renderer/overlay, renderer/confirmation, terminal-host), `packages/design/`(token, 컴포넌트, 읽기 스타일, wording catalog), `packages/sdk/tokens`, `packages/sdk/ui-*`다.

- 화면은 화면마다의 명세 없이 `docs/ui-ux/README.md`의 전역 규칙, shell requirements, 각 flow의 사람 단계로 만든다. 화면에는 지금 필요한 것만 보이고 나머지는 펼쳐 본다(G1, G2). 화면 문구는 wording key와 en 값으로만 쓴다.
- 화면 작업은 frontend 등급이다. main·terminal host·보안 경계는 기본 등급이다.
- slice의 flow E2E는 `docs/plan/README.md`의 E2E 담당 팀이 쓴다. shell 작업은 그 E2E의 선행이다. shell 작업의 완료는 단위 테스트(`deno test`, `node --test`)와 `e2e/` harness의 Playwright 동작 검사(`e2e/shell/`)다.
- 이전 lophn(`/home/pyosechang/projects/lophn-legacy`)은 `docs/dev/legacy.md`대로 골라서 가져온다. 작업마다 "가져올 것"에 적었다. `v2-*` 파일, `bridge.ts`, 구 daemon client·token, permit·lease·execution 계약, 접근성 전용 코드, 테스트는 가져오지 않는다. 이름과 storage key의 판 표시(`v1`, `5.0` 같은 주석)는 지운다.
- 이름은 apps와 맞춘다: 앱 화면은 `screen`(+`size`), main이 view마다 만드는 식별은 `view_session`이다. `docs/architecture/shell.md`의 `surface`·`viewId`·`packages/shell/design-system`·`renderer/wording` 표기는 T1에서 code-map과 이 이름으로 고친다.

## 공통 테스트 방식

- main(npm): Electron API는 작은 adapter interface 뒤에 두고 `node --test`에서 가짜를 끼운다. 시각·id·무작위 값은 주입한다.
- renderer와 `packages/design`: `deno test`와 happy-dom으로 컴포넌트 동작을 본다. 실제 화면의 동작은 Playwright E2E로 검사한다.
- 실제 Electron(native view, overlay, modal, sandbox, PTY): `e2e/` harness(contracts#T10)의 `e2e/shell/*_test.ts`. `deno task e2e`로 돈다. harness를 기다리는 확인을 별도 작업으로 나눈 경우 구현 작업의 단위 테스트를 실제 Electron 확인으로 세지 않고, 그 확인 작업의 선행과 완료 기준에 남긴다.
- 테스트 이름은 요구 번호로 시작한다: `shell/terminal#R7: 숨긴 탭의 출력이 10,000줄을 넘으면 오래된 줄부터 뺀다`.

## skeleton

### T1 shell 작업 공간, build, check 연결

- 상태: 완료 (#11)
- 등급: 기본
- concern: shell/desktop, shell/design-system
- 요구: shell/desktop#R17
- 자리: apps/shell/main/(package.json, package-lock.json, tsconfig.json, build.ts), apps/shell/main/desktop/main.ts, apps/shell/preload/, apps/shell/renderer/(deno.json, build.ts, build_test.ts, desktop/, overlay/, confirmation/), docs/architecture/shell.md, docs/dev/stack.md
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: skeleton
- 선행: contracts#T1
- 완료: 아래 확인이 통과한다
  - `apps/shell/main`은 npm·TypeScript strict(`erasableSyntaxOnly`, `allowImportingTsExtensions`, `noEmit`)로 typecheck하고 esbuild로 main과 preload 세 개(shell, confirmation, app)를 각각 한 파일로 묶는다. sandbox preload는 `electron` 말고 아무것도 require하지 않는다. main은 `packages/contracts`·`packages/base`의 `.ts` 원본과 같은 판의 `zod`(4.6.5)를 쓴다.
  - `npm --prefix apps/shell/main run check`가 `tsc --noEmit`과 `node --test`를 돌고 `deno task check` 4단계에서 돈다.
  - `apps/shell/renderer`는 Deno workspace member이고 esbuild로 빈 React root의 shell·overlay·confirmation entry를 만든다. Deno import map은 esbuild-deno-loader가 resolve하고, 작은 `*.module.css`는 `local-css` loader의 클래스 맵으로 CSS Modules bundle을 확인한다. design과 글꼴 복사는 T4, 공유 IPC schema는 T2에서 더한다.
  - main과 renderer는 서로의 실행 코드를 import하지 않는다.
  - `desktop_build_test`와 renderer의 `build_test`: `shell/desktop#R17` main build가 main과 preload 세 파일을, renderer build가 entry 세 개를 만든다. main 밖 `.ts` 테스트 fixture의 `zod` import를 `apps/shell/main/node_modules`에서 resolve해 묶는다.
  - `docs/architecture/shell.md`의 코드 자리와 이름을 code-map·apps와 맞춘다(packages/design, packages/design/wording, apps/shell/ipc, screen, view_session).
  - 더한 의존성(electron, esbuild, typescript, @types/node, zod, react, react-dom, @types/react)을 판과 이유와 함께 `docs/dev/stack.md`에 적는다.
- 가져올 것: legacy `apps/desktop/renderer/build.ts`(deno bundle 방식), `apps/desktop/main/tsconfig.json`. `build-v2-client.ts`는 가져오지 않는다.

### T2 Electron main: 창, single instance, 보안 기본값, shell scheme

- 상태: 완료 (#15)
- 등급: 기본
- concern: shell/desktop, shell/app-frame
- 요구: shell/desktop#R11(창), R12, R16, R22(최소 창), R23, shell/app-frame#R3, R4, R23
- 자리: apps/shell/main/desktop/(window.ts, single-instance.ts, security.ts, shell-protocol.ts, ipc-guard.ts), apps/shell/preload/shell.ts
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: skeleton
- 선행: shell#T1
- 완료: 아래 확인이 통과한다
  - 데이터 root별 `requestSingleInstanceLock`. 두 번째 시작은 등록된 창 열기 intent만 기존 main에 넘기고 argv의 URL·파일·명령은 실행하지 않는다.
  - session을 만들기 전에 `app.setPath('userData', '<home>/shell/browser')`.
  - 모든 BrowserWindow·WebContentsView에 `sandbox`, `contextIsolation`, `webSecurity`, Node integration 셋 끔, `webviewTag: false`, `allowRunningInsecureContent: false`. packaged build에서는 devtools를 열지 않는다.
  - 시스템 제목 표시줄 없음. macOS 신호등 자리 80px, Windows·Linux 창 버튼 자리 138px. 최소 창 960×600px. 창 제목은 main이 검증한 공간 이름 + ` — lophn`.
  - `lophn-shell://` handler는 설치 파일만 safe join으로 내주고 CSP를 붙인다.
  - IPC guard: sender가 registry의 살아 있는 webContents인지, main frame인지, URL의 scheme·host·path를 각각 비교한다. subframe·다른 origin·모르는 필드·큰 입력은 거절한다.
  - `window_test`, `security_test`, `ipc_guard_test`(node --test)에 위 요구 테스트.
- 가져올 것: legacy `main/src/main/app.ts`의 창·single instance·bounds 부분, `security.ts`, `shell-protocol.ts`, `ipc.ts`의 `requireShell` 검사 원리.

### T3 core 시작과 연결: 감독 pipe, 사람 token, read·command·event client

- 등급: 기본
- concern: shell/desktop, shell/app-frame
- 요구: shell/desktop#R7(마지막 화면과 확인 시각), R15, R19, R20, R21(창 닫기는 중지가 아님), shell/app-frame#R23
- 자리: apps/shell/main/desktop/core/(supervise.ts, client.ts, events.ts, allowlist.ts), apps/shell/ipc/core.ts, apps/shell/main/package.json(`dev` script)
- 쓰는 contract: contracts#T5(RPC client·envelope), contracts#T6(감독 pipe hello `{user_token, api_port, core_epoch}`·platform/status·identity/current), contracts#T7(event 구독)
- 내놓는 contract: 없음
- slice: skeleton
- 선행: shell#T2, contracts#T5, contracts#T6, contracts#T7, platform#T9
- 완료: 아래 확인이 통과한다
  - 창부터 열고 준비 상태를 보인다. main이 `deno run <flags> apps/core/main.ts`를 `LOPHN_HOME`과 함께 띄우고(개발: `deno`, packaged: bundle된 Deno) core의 stdin·stdout 위 길이 prefix frame(contracts#T6 codec)으로 hello를 보내 실제 port·core epoch·user token을 한 번 받는다. 같은 root의 두 번째 main은 single instance로 막히므로 두 번째 core가 생기지 않는다.
  - 사람 token은 main 메모리에만 있다. renderer·argv·URL·cookie·환경·log에 없다.
  - renderer가 부를 수 있는 read·command는 contract schema에서 만든 allowlist뿐이다. 임의 credential 발급·daemon 종료 통로는 없다.
  - event는 seq cursor로 구독하고 끊기면 renderer에 "최신 확인 못함 + 마지막 확인 시각"을 push한다. 다시 붙으면 인증·core epoch 확인 뒤 cursor 따라잡기와 현재 read로 맞춘다. epoch가 바뀌면 옛 응답을 generation으로 버린다.
  - 마지막 창을 닫아도 main과 core는 남는다.
  - `npm run dev -- --home <dir>`로 개발 데이터 root를 받는다(인자 이름은 platform과 맞춘다).
  - `core_client_test`, `allowlist_test`, `supervise_test`(가짜 core)에 위 요구 테스트.
- 가져올 것: legacy `daemon-lifecycle.ts`의 시작·대기 순서 원리만. `daemon-client.ts`, `paths.ts`의 token·port 파일 방식은 가져오지 않는다.
- 상태: 완료 (#119)

### T4 design token 원본과 생성

- 상태: 완료 (#14)
- 등급: 기본
- concern: shell/design-system
- 요구: shell/design-system#R7, R8, R9, R10, R11, R14, R15, R16, R17, R18, R19, R20, R24, R36(생성과 불일치 검사), R38, R45
- 자리: packages/design/(deno.json, mod.ts, tokens.ts, tokens_test.ts, generate.ts, base.css), packages/design/generated/(tokens.css, vars.ts, values.json), packages/design/fonts/, apps/shell/renderer/(build.ts, build_test.ts, entry.tsx)
- 쓰는 contract: 없음
- 내놓는 contract: 없음(shell 안쪽과 SDK가 쓰는 token 모듈)
- slice: skeleton
- 선행: shell#T1
- 완료: 아래 확인이 통과한다
  - `tokens.ts` 하나가 light·dark 색, 상태 색과 아이콘 이름, 차트 계열 8색과 기타 회색, diff 색, 글꼴, 크기·줄높이, 간격, radius, 테두리, 그림자, 움직임, 쌓임 순서, breakpoint, floating 표면 값을 갖는다. 값은 요구의 숫자 그대로다.
  - `generate.ts`가 CSS 변수, TS 타입, 문서값을 만들고 `--check`는 생성물이 원본과 다르면 실패한다.
  - Pretendard Variable과 JetBrains Mono woff2와 OFL license를 저장소에 둔다. 외부 font 요청이 없다.
  - renderer build가 `packages/design` token을 묶고 글꼴 woff2를 bundle 옆으로 복사한다.
  - `tokens_test`: 요구마다 값 검사, light·dark 쌍이 모두 있음, 차트 palette validator(light #ffffff·dark #161615 표면)를 돌린다.
- 가져올 것: legacy `packages/sdk/tokens`(tokens.ts, generate.ts, fonts, fonts.css, license). 값은 지금 요구로 다시 맞춘다.

### T5 theme override 검증과 token-only style 검사

- 상태: 완료 (#24)
- 등급: 기본
- concern: shell/design-system
- 요구: shell/design-system#R3, R4, R36(token 밖 스타일 검사), R40, R44
- 자리: packages/design/(deno.json, theme.ts, theme_test.ts, mod.ts), packages/design/style-check/(mod.ts, model.ts, work.ts, testdata/), packages/design/style-check_test.ts, docs/dev/stack.md, deno.lock
- 쓰는 contract: 없음(settings 등록과 session 적용은 후속 작업이 순수 theme 함수를 부른다)
- 내놓는 contract: 없음
- slice: skeleton
- 선행: shell#T4
- 완료: 아래 확인이 통과한다
  - theme override는 있는 token 이름의 값만 바꾼다. 이름 추가·삭제는 거절하고, 검증에 실패한 값만 기본값으로 돌아간다. 강조색 override도 같은 검증을 거친다. 같은 결과 CSS 변수 집합을 shell·앱 session에 쓸 수 있게 낸다.
  - style 검사는 `apps/shell/renderer`, `packages/design`, `packages/sdk/ui-*`의 CSS에서 token 밖 색·길이·시간·굵기·z-index·breakpoint와 없는 token 참조를 거절한다. `deno test` 안에서 돈다(check 단계를 늘리지 않는다).
  - `theme_test`, `style-check_test`에 위 요구 테스트. 임의 hex·px·ms를 넣은 fixture가 실패한다.
- 가져올 것: legacy `packages/sdk/tokens/stylelint.ts`, `lint_styles.ts`의 token-only 규칙만. postcss와 postcss-value-parser를 쓰고 stack.md에 판과 이유를 적는다.

### T6 wording catalog, ICU, Intl, 문구 검사

- 상태: 완료 (#19)
- 등급: 기본
- concern: shell/wording
- 요구: shell/wording#R1, R3, R6, R7, R11, R13, R14
- 자리: packages/design/wording/(mod.ts, en.ts, placeholders.ts, generate.ts, format.ts, intl.ts, check.ts, check_test.ts, format_test.ts, rules.ts)
- 쓰는 contract: contracts#T32·T39·T40(problems가 소유한 문구 상수 key)
- 내놓는 contract: 없음(shell renderer, overlay, confirmation, main, SDK UI가 쓰는 catalog 모듈)
- slice: skeleton
- 선행: shell#T1
- 완료: 아래 확인이 통과한다
  - key는 `<screen>.<part>.<name>`이고 en 값은 ICU MessageFormat이다. 날짜·숫자·상대 시각은 `Intl.DateTimeFormat`, `Intl.NumberFormat`, `Intl.RelativeTimeFormat`으로만 만든다. 문장 조각을 이어 붙이지 않는다.
  - `t(key, values)`의 key와 placeholder가 타입으로 묶인다.
  - 검사: 화면 코드의 직접 문구, 없는 key, 빠진 en 값, placeholder 불일치는 오류. 사용자 문구의 snake_case·ID 접두사·원시 enum·ledger·release·invocation·assignment 같은 안쪽 말은 경고. 문서·코드·개발자 diagnostics는 제외. contracts/problems의 문구 상수 key는 알려진 key로 받고 다시 정의하지 않는다.
  - Baseline, Reference, Follow changes, For decisions, For summaries, Agent activity, App activity key가 catalog에 있다.
  - 버튼·제목은 마침표 없음, 문장은 마침표를 검사한다.
  - `check_test`, `format_test`에 위 요구 테스트.
- 가져올 것: legacy `renderer/src/i18n`의 typed key 방식만. ko dictionary와 조사 처리는 가져오지 않는다. ICU 구현 라이브러리(추천 intl-messageformat)를 stack.md에 더한다.

### T8 공통 컴포넌트: 조작과 상태

- 상태: 완료 (#43)
- 등급: frontend
- concern: shell/design-system
- 요구: shell/design-system#R1, R2, R5, R6, R26, R27, R28, R29, R34, R43
- 자리: packages/design/components/(button, icon-button, input, textarea, select, checkbox, switch, kbd, field, tabs, skeleton, empty-state, error-state, stale-note, author-mark, status-mark)
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: skeleton
- 선행: shell#T4, shell#T6
- 완료: 아래 확인이 통과한다
  - CSS Modules, Radix Primitives, Lucide(16/20px, 선 1.5, 정한 14px 유지)만 쓴다.
  - 버튼 primary·secondary·ghost·danger, sm·md·lg 28/32/36px, 내용 너비, 같은 크기 조작의 높이·기준선 일치. 입력은 라벨 위, 도움말·오류 아래, placeholder를 라벨로 쓰지 않음. 일반 탭은 활성 2px 밑줄.
  - 첫 조회 300ms 전에는 아무것도 없고 그 뒤 자리를 지킨 skeleton. empty는 아이콘 20px·한 문장·행동 하나, error는 실패 대상·다시 불러오기, stale은 마지막 갱신 나이, agent 작성 표식.
  - 상태와 diff는 색 말고 글·표지로도 구별한다. 닫은 레이어의 focus는 연 자리로 돌아간다.
  - 모든 컴포넌트는 금지 목록과 간격 리듬을 지키며, 조작과 상태를 컴포넌트 테스트로 확인한다.
  - 컴포넌트 옆 `*_test.tsx`(happy-dom)에 위 요구 테스트.
- 가져올 것: legacy `packages/sdk/ui-control`, `ui-state`(presented.ts, reportError.ts 빼고), `ui-layout`의 Tabs. 접근성 전용 announcer는 빼고 ARIA는 Radix가 주는 만큼만 둔다.

### T9 launcher 첫 창

- 상태: 완료 (#141)
- 등급: frontend
- concern: shell/desktop, shell/wording
- 요구: shell/desktop#R7(core 단절 표시), R22(상단 바 48px), R24(새 창은 런처, 창 제목), R25(48px 끌기 바, 고정 lophn 진입점 자리), shell/wording#R1, R10
- 자리: apps/shell/renderer/desktop/(main.tsx, router.ts, launcher/, top-bar/, connection/)
- 쓰는 contract: contracts#T6(platform/status read)
- 내놓는 contract: 없음
- slice: skeleton
- 선행: shell#T3, shell#T8
- 완료: 아래 확인이 통과한다
  - 새 기본 창은 언제나 런처로 연다. 런처는 최대폭 1040px 가운데 기둥, 48px 끌기 바, 바 오른쪽 lophn 진입점(카드가 아님)을 둔다. 카드 자리는 실제 read 결과로만 채운다(skeleton에서는 비었음 상태).
  - core 준비 전·실패·단절을 화면 말(en key)로 구별하고 다음 행동 하나를 보인다. 단절 때 마지막 화면과 확인 시각을 남긴다.
  - `launcher_test`, `router_test`에 위 요구 테스트. contracts#T10의 skeleton smoke가 이 창을 쓴다.
- 가져올 것: legacy `renderer/src/spaces/Launcher.tsx`, `shell/Shell.tsx`의 골격. 구 data store와 router의 v2 symbol은 가져오지 않는다.

## documents

### T10 shell overlay view

- 상태: 완료 (#54)
- 등급: 기본
- concern: shell/app-frame, shell/design-system
- 요구: shell/app-frame#R24, R29(경계 drag 중 pointer, 16ms 묶기), shell/design-system#R2(focus 복귀), R20
- 자리: apps/shell/main/app-frame/overlay.ts, apps/shell/main/app-frame/view-order.ts, apps/shell/renderer/overlay/, apps/shell/ipc/overlay.ts
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: documents
- 선행: shell#T2, shell#T8
- 완료: 아래 확인이 통과한다
  - 창마다 투명 WebContentsView 하나(`lophn-shell://overlay/index.html`, 배경 `#00000000`)를 contentView 맨 위에 둔다. view를 붙일 때마다 overlay를 다시 맨 위로 올리고 z-order는 main의 한 모듈만 바꾼다.
  - `shell:overlay-open {kind, anchorRect, model}` → overlay가 그리고 결과는 `shell:overlay-result`로 연 쪽에 돌아온다. overlay는 command를 보내지 않는다. menu·popover·tooltip은 그 사각형만, dialog·palette·경계 drag는 창 본문 전체를 bounds로 쓴다.
  - 조작 표면만 keyboard focus를 가져가고 닫히면 연 요소로 돌린다. tooltip·drag·notification은 focus를 옮기지 않는다. 같은 창의 표면은 sibling DOM으로 쌓임 순서를 지킨다.
  - 경계 drag 중 overlay가 pointer capture로 받은 validated pointer DTO를 연 쪽에 16ms마다 한 번 relay한다. 창 resize 때 overlay 자신의 bounds 갱신도 16ms마다 묶는다. pane·sidebar layout 연결은 T14, 실제 앱 native bounds 적용은 T39가 맡는다.
  - overlay crash 때 다시 만들어 맨 위에 두고 열려 있던 표면은 닫힘으로 알린다.
  - `overlay_test`(가짜 view), IPC caller·schema·generation 테스트와 renderer 컴포넌트 테스트에 위 요구 테스트. build 테스트는 sandbox preload에 `electron` 외 require가 없는지 검사한다.
- 실제 Electron 확인: 아래 T61이 `contracts#T10` harness로 overlay·sandbox를 검사한다. T10의 단위 테스트 통과는 native view·sandbox E2E 완료가 아니다.
- 가져올 것: 없음(legacy는 view를 숨겼다). legacy `viewHost.ts`의 hold coalescing은 쓰지 않는다.

### T61 shell overlay·sandbox 실제 Electron 확인

- 등급: 기본
- concern: shell/app-frame, shell/desktop, shell/design-system
- 요구: shell/app-frame#R24, R29(경계 drag 중 pointer, 16ms 묶기), shell/desktop#R16, shell/design-system#R2(focus 복귀), R20
- 자리: e2e/shell/overlay_test.ts, e2e/shell/sandbox_test.ts
- 쓰는 contract: contracts#T10(Electron·Playwright E2E harness)
- 내놓는 contract: 없음
- slice: documents
- 선행: shell#T10, shell#T11, contracts#T10
- 완료: 아래 확인이 통과한다
  - 실제 Electron에서 menu·dialog를 연 동안과 닫은 뒤 아래 native view가 보이며 attach·crash 재생성 뒤에도 overlay가 맨 위에 있다. dialog 안 menu는 같은 overlay의 sibling으로 그 위에 보인다.
  - 경계 drag의 pointer를 overlay가 창 본문 전체에서 받고 앱 view는 숨기거나 detach하지 않는다. 연속 resize의 bounds 적용은 16ms마다 한 번으로 묶인다.
  - 조작 표면만 focus를 옮기고 닫으면 연 요소로 돌아온다. tooltip·drag·notification은 원래 focus를 유지한다.
  - shell·overlay renderer에서 `require`·`process`·Node·DB·사람 token을 직접 읽을 수 없고 임의 IPC channel·method를 호출할 수 없다. sandbox를 끄는 우회 없이 검사한다.
  - 요구 번호로 시작하는 테스트가 `deno task e2e`에서 통과하고 `deno task check`도 통과한다. gallery·screenshot baseline 회귀는 만들지 않는다.
- 상태: 완료 (#165)
- 분리 이유: T10·T11의 구현은 harness가 준비되기 전에도 단위 테스트로 검증하고 병합한다. 실제 Electron 보장은 취소하지 않고 harness와 떠 있는 표면이 main에 든 뒤 이 작업에서 확인한다.

### T11 공통 컴포넌트: 떠 있는 표면

- 상태: 완료 (#61)
- 등급: frontend
- concern: shell/design-system
- 요구: shell/design-system#R20, R33, R35(chip 모양), R38, R45
- 자리: packages/design/components/(tooltip, popover, menu, dialog, sheet, toast, palette, chip), apps/shell/renderer/overlay/surfaces/
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: documents
- 선행: shell#T8, shell#T10
- 완료: 아래 확인이 통과한다
  - tooltip 400ms 지연, menu·popover 행 32px, dialog 480/640px·안 여백 24px, toast 360px·5초·짧은 조작 2초·hover·focus 중 멈춤·행동 최대 2개·error는 유지, palette 640px·위 20%, sheet는 backdrop 없이 Escape·바깥 click으로 닫음.
  - popover·dialog 그림자와 floating 표면·backdrop 색은 token 값이다. 카드에는 그림자가 없다.
  - 사람의 답을 기다리는 chip은 360px 하나와 나머지 개수, 저절로 사라지지 않음, 보기·닫기.
  - 컴포넌트 옆 테스트에 위 요구 테스트.
- 가져올 것: legacy `packages/sdk/ui-overlay`(Tooltip, Popover, Menu, Dialog, Toast, CommandPalette). CommandPalette의 항상 보이는 scrollbar 처리도 가져온다.

### T12 공통 컴포넌트: 표, 트리, 목록, 카드, 수치, 페이지 틀, 읽기

- 상태: 완료 (#50)
- 등급: frontend
- concern: shell/design-system
- 요구: shell/design-system#R16(읽기 글자), R21, R22, R23, R30, R31, R32, R39, R42
- 자리: packages/design/components/(table, tree, list, card, stat-tile, page-frames), packages/design/reading/(markdown, toc, code-block, diff-view, reading.module.css)
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: documents
- 선행: shell#T8
- 완료: 아래 확인이 통과한다
  - 페이지 틀 5종(읽기 600/680/800px와 목차 220px, dashboard 1440px/12열, 목록 360px+상세, 전체 폭 표, 폼 640px). 최대폭 기둥은 가운데이고 800·1280·1920px에서 검증한다. 런처 1040px, 프로젝트 개요 800px.
  - 목차는 container 폭 868·948·1068px에서 본문 오른쪽 48px, 부족하면 머리 dropdown. 1280px 창의 520px 칸은 읽기 폭 488px.
  - 표: 행 36/44px, 숫자 오른쪽·tabular, 글자 말줄임 tooltip, sticky 머리, 1,000행 넘으면 가상 scroll, 상대 시각과 절대 시각 tooltip, ID는 개발자 diagnostics에서만.
  - 트리 행 28px, 깊이당 12px, 8단부터 더 들이지 않음. 카드는 독립 객체만, 그림자 없음, 수치 타일 한 줄 최대 4개.
  - Markdown 읽기 renderer는 HTML을 실행하지 않는다. parser는 편집기와 같은 Lezer Markdown을 쓴다(읽기·편집 위치 차이를 줄이고 parser를 둘 들이지 않는다). 제목 1단 20px, 2단 16px/600/위 40px, 3단 16px/600/secondary, 4단 14px, palette 항목 36px.
  - 컴포넌트 옆 테스트.
- 소비 연결: R23의 읽기 폭은 controlled frame과 주입한 setting interface까지 검증한다. 전역 선택 저장·문서 메뉴·다른 문서와 재시작 반영은 shell#T16이 platform settings에 연결해 검증하며 localStorage를 별도 정본으로 만들지 않는다.
- 가져올 것: legacy `ui-layout`(page frames, Tree, ScrollArea), `ui-table`, `ui-stat`, `ui-reading`(Markdown, TocTree, CodeBlock, DiffView). `marked` 의존은 가져오지 않는다.

### T13 workspace layout 저장과 복원

- 상태: 완료 (#146)
- 등급: 기본
- concern: shell/workspace, shell/desktop
- 요구: shell/workspace#R6, R7, R8, shell/desktop#R24(이어서)
- 자리: apps/shell/main/workspace/(layout.ts, layout-store.ts, restore.ts), apps/shell/ipc/workspace.ts
- 쓰는 contract: contracts#T14(project), contracts#T15(document·version), contracts#T20(App)
- 내놓는 contract: 없음
- slice: documents
- 선행: shell#T3
- 완료: 아래 확인이 통과한다
  - `WorkspaceLayout`(domain-model/shell/workspace)을 Zod로 검증하고 `<home>/shell/layout.json`에 원자 교체로 쓴다. 폴더 0700, 파일 0600(Windows는 동등 ACL). 미지원 schema·손상은 빈 layout과 안전한 오류.
  - 창 bounds, 마지막 공간, 프로젝트별 탭·칸·선택·분할 비율·읽던 위치·정보 패널 선택만 담는다. 본문·초안·출력·credential·승인·앱 업무 상태·preview는 없다.
  - 복원은 현재 대상과 권한을 다시 읽어 없거나 못 쓰는 대상은 이유와 닫기를 가진 자리표시로 둔다. 터미널은 종료된 자리표시로만 복원하고 PTY를 만들지 않는다.
  - [이어서]는 마지막 공간의 layout으로 탭을 만든다. 새 창은 그래도 런처다.
  - `layout_test`, `restore_test`에 위 요구 테스트.
- 가져올 것: legacy `renderer/src/workbench/persist.ts`의 모양만. localStorage `lophn.workbench.v1` key 방식은 가져오지 않는다.

### T14 project-workspace 틀: sidebar, 상단 경로, 탭 줄, 두 칸

- 등급: frontend
- concern: shell/workspace, shell/desktop, shell/editor, shell/design-system
- 요구: shell/workspace#R1, R2, R3, R4, shell/desktop#R22, R26(런처 복귀), R28(작업대 탐색), shell/editor#R3, R5, shell/design-system#R24, R25
- 자리: apps/shell/renderer/workspace/(workspace.tsx, tab-strip/, panes/, sidebar/, info-panel-slot/), apps/shell/renderer/desktop/top-bar/
- 쓰는 contract: documents#T7(projects list·get), documents#T6(문서 목록)
- 내놓는 contract: 없음
- slice: documents
- 선행: shell#T9, shell#T11, shell#T12, shell#T13, documents#T7, documents#T6
- 완료: 아래 확인이 통과한다
  - sidebar 240px(drag 200~400px)·접힘 56px·행 32px, 상단 바 48px, 본문 여백 좌우 32px·위 24px, 창 1024px 미만 16px. 640px 미만 sidebar 숨김, 640~1023px 기본 접힘. 사람이 고른 폭은 자동으로 다시 접지 않는다.
  - 모든 공간 왼쪽 위에 런처 복귀, sidebar 접힘 때는 상단 바로 옮긴다.
  - 작업대 sidebar는 프로젝트 폴더·문서·연관 컨텍스트만. 없어진 거처·분류 전·컨텍스트 계층은 없다.
  - 탭 줄 36px, 탭 120~220px·고정 탭 36px·닫기 20px, 넘치면 줄 안 scroll로 선택 탭을 보임, 페이지 가로 scroll 없음. 종류를 글자로 구별한다(문서 편집기, 뷰어, 터미널, 앱 패널 자리).
  - 좌우 1칸 또는 2칸, 경계 1px·잡는 영역 8px, 두 번 누르면 50:50. drag와 키보드로 다른 칸으로 옮기기. 칸마다 탭 순서·선택과 focus 하나.
  - 칸 하나가 480px 아래가 되면 분할 비율·탭 소속을 보존한 한 칸 보기, 넓어지면 원래 배치. 정보 패널은 본문 720px 또는 두 칸과 경계를 남길 때만 붙이고 아니면 overlay.
  - T10의 validated pointer DTO를 pane·sidebar의 shell layout에 연결한다. drag-end의 마지막 DTO를 적용한 뒤 완료하고 drag-cancel 때 취소한다. 실제 앱 native bounds 적용은 T39가 맡는다.
  - 상단 경로는 focus 칸 활성 탭을 따른다.
  - `tab-strip_test`, `panes_test`에 위 요구 테스트.
- 가져올 것: legacy `renderer/src/workbench`(model, pane·tab·split UI), `spaces/ProjectSpace.tsx` 골격, `ui-layout`의 SplitPane·Resizer·TabBar. 구 target·address 계약은 가져오지 않는다.
- 상태: 완료 (#172)

### T15 launcher: 프로젝트 등록과 추적 미리보기

- 상태: 완료 (#290) — 이어보냄: 실제 core의 추적 미리보기·켜기와 팔레트 파일 묶음 확인(documents#T12가 `/v1/projects/preview_tracking`·`/v1/files/list`를 서빙한 뒤) → shell#T17. 제품 작업대의 layout 저장·복원 통로(main·preload)는 아직 없다. Q18
- 등급: frontend
- concern: shell/desktop, shell/wording
- 요구: shell/desktop#R25(프로젝트 카드, 프로젝트 등록), R26(카드), shell/wording#R2, R4, R10, R12
- 자리: apps/shell/renderer/desktop/launcher/, apps/shell/renderer/workspace/tracking/, apps/shell/main/desktop/folder-picker.ts
- 쓰는 contract: documents#T7(projects.create·list), documents#T10(preview_tracking, set_tracking), documents#T11(files.status)
- 내놓는 contract: 없음
- slice: documents
- 선행: shell#T9, shell#T14, documents#T7, documents#T10, documents#T11
- shell#T28에서 넘어온 것: 런처 카드의 approval 대기 개수 글자 pill(desktop#R26). 모양은 `apps/shell/renderer/desktop/notification-chip/space-decisions.tsx`의 `WaitingPill`, 수는 `things-to-confirm/model.ts`의 `placeWaiting(requests, place, "approvals")`다. 카드가 생기면 그 카드의 프로젝트·앱 자리로 센다
- shell#T21에서 넘어온 것: 제품 core 통로의 `WorkspaceSource`(지금은 dev seed만)를 만들 때 팔레트 파일 묶음의 `files(project)`를 documents `files.list`로 채운다. 그 전까지 lophn 팔레트의 프로젝트 행은 project route로 가도 작업대 통로가 없어 런처가 보인다.
- 완료: 아래 확인이 통과한다
  - 런처 카드는 사람이 지은 이름·목적·상태만 보인다. 내부 slug·ID·경로는 펼친 상세에만 둔다.
  - 등록: 이름·목적과 OS 폴더 선택(main의 dialog, 폴더 없이도 등록). 등록과 추적 켜기를 구별한다. 추적 미리보기의 포함·제외 이유·겹침을 보고 켠다.
  - 오류는 실패한 대상·영향·다음 행동 하나(폴더 겹침, 접근 불가, 미리보기 뒤 바뀜).
  - flow first-project 1~4단계 화면. `launcher-register_test`에 위 요구 테스트.
- 가져올 것: legacy `spaces/projectDialogs.tsx`, `Onboarding.tsx`의 배치만.

### T16 문서 읽기와 편집기

- 상태: 완료 (#238) — 이어보냄: 저장 상태 줄(editor#R11)·형식 문제 입력·`QuitWork.pendingSaves`, `e2e/shell/read-edit_test.ts` 실제 실행(headless harness)과 읽기 E2E의 재시작 반영(제품 core의 settings route·`/v1/outline/document`·`/v1/documents/read` 서빙 뒤, Q13) → shell#T17
- 등급: frontend
- concern: shell/editor, shell/design-system
- 요구: shell/editor#R4, R7, R8, R9, R10, R11, R16, shell/design-system#R23(전역 읽기 폭·문서 메뉴)
- 자리: apps/shell/renderer/editor/(markdown-editor.tsx, live-preview.ts, preview.ts, commands.ts, find/, link-picker/, problems-gutter/, document-head.tsx)
- 쓰는 contract: documents#T14(outline·본문 읽기), documents#T6(문서·판), documents#T9(address), contracts#T24(settings registry), platform#T25–T27(settings definitions·get·apply)
- 내놓는 contract: 없음
- slice: documents
- 선행: shell#T12, shell#T14, documents#T14, documents#T6, contracts#T24, platform#T25, platform#T26, platform#T27
- 완료: 아래 확인이 통과한다
  - CodeMirror 6은 `apps/shell/renderer/editor/`에만 있고 SDK에 공개하지 않는다.
  - 읽기와 편집이 같은 기둥·읽기 폭·16px/28px와 같은 제목·목록·인용·코드 스타일을 쓴다. 전환 전후 첫 블록 위치 차이 4px 이하(`e2e/shell/read-edit_test.ts`로 잰다).
  - 문서 메뉴에서 600/680/800px 읽기 폭을 바꾸면 platform settings의 전역 선택을 저장한다. T12의 setting interface로 다른 문서와 재시작 뒤 같은 폭을 적용하고 모르는 저장값은 기본 폭으로 읽는다. `editor_test`와 읽기 E2E에서 메뉴·다른 문서·재시작 반영을 검증한다.
  - 편집 mode는 머리의 편집/읽기 버튼과 커서만 바뀐다. Markdown 표지는 커서가 그 요소 안일 때만 muted로 보인다.
  - 코드는 고정폭·muted 배경·문법 강조 없음, 인용 막대 2px, 체크박스 16px, 이미지 실패에 아이콘과 alt, 16:9 skeleton, frontmatter 두 열.
  - 찾기 줄 36px·입력 28px, 형식 문제 gutter 24px·아이콘 14px·목록 최대 200px, 링크 고르기 320px popover(overlay).
  - 탭 제목은 파일 이름, tooltip은 문서 제목과 상대 경로, 좌우 화살표·Enter·Delete, 제목이 사라지면 32px sticky 머리. 문서 머리는 제목 20px·메타 12px·편집 ghost·CommandOrControl+E·정보 패널·메뉴, 읽기 화면에 primary 없음.
  - `editor_test`(happy-dom)에 위 요구 테스트.
- 가져올 것: legacy `renderer/src/editor`(MarkdownEditor.tsx, livePreview.ts, preview.ts, markdownCommands.ts, find, link picker, CSS). `usePickerDocs.ts`의 구 query store, autosave·format 계약, `SaveStatus.tsx`의 announcer는 가져오지 않는다.

### T17 저장 흐름: 파일 통로, 저장 상태, 충돌, 닫기 guard

- 상태: 진행 (#306) — 한 것: main 파일 adapter(`files/read` stream·`documents/upload`·`files/write` base_hash CAS·편집 종료의 `version_request`·`latest_version`·결과 불명 조회·형식 검사), 창 닫기 guard와 `QuitWork.pendingSaves`, 저장 상태 줄·상세·notice·충돌 해결 화면·닫기 dialog, 실제 core 테스트, headless E2E(`e2e/shell/save_test.ts`, `read-edit_test.ts` 실제 실행), T15에서 넘어온 추적 미리보기·켜기·파일 목록 실제 core 확인. 남은 것: T19에서 넘어온 series 새 멤버 쓰기 길(새 파일·series draft), 읽기 폭 재시작 E2E와 version 충돌의 최신 판 비교(제품 core의 worker `documents/read`가 unavailable, Q19(6)). Q19
- 등급: 기본
- concern: shell/editor
- 요구: shell/editor#R1, R2, R12, R15
- 자리: apps/shell/main/editor/(file-adapter.ts, close-guard.ts), apps/shell/ipc/editor.ts, apps/shell/renderer/editor/(save-state.ts, save-status.tsx, notice-bar.tsx, conflict/)
- 쓰는 contract: documents#T12(/v1/files/read·write·status·watch, 409·503, FileOperationResult), documents#T8(documents prepare·save), contracts#T16(파일 쓰기)
- 내놓는 contract: 없음
- slice: documents
- 선행: shell#T16, documents#T12, documents#T8
- T16에서 넘어온 것: `e2e/shell/read-edit_test.ts`를 headless harness로 실제 실행하고, 제품 core가 settings route·`shell.reading_width`·outline/document·documents/read를 서빙하면 읽기 폭의 재시작 반영 확인을 더한다(#238, Q13)
- shell#T16에서 넘어온 것: `apps/shell/renderer/editor/document-view.tsx`의 초안(`draft`)을 파일 통로로 보내고, 저장 상태 변경을 머리 메타 줄(상태 줄, editor#R11)에 보인다. 준비 결과의 `FormatDiagnostic`을 `problems-gutter/problems.ts`의 `editorProblems`로 바꿔 `DocumentView`의 `problems`에 넘긴다.
- shell#T55에서 넘어온 것: 저장 중 변경 수를 끄기 확인(`apps/shell/main/desktop/quit.ts`의 `QuitWork.pendingSaves`, 지금 main은 0)에 잇는다(tray Quit 확인과 터미널 수는 #233)
- shell#T15에서 넘어온 것: documents#T12가 `/v1/projects/preview_tracking`과 `/v1/files/list`를 서빙하면 temp LOPHN_HOME 실제 core 테스트(`apps/shell/renderer/desktop/launcher/core-source-real-core_test.ts`)에 temp 폴더의 추적 미리보기(포함·제외 이유)와 `set_tracking` 켜기, 작업대 팔레트 파일 묶음(`coreWorkspaceSource.files`)을 더한다(Q18).
- shell#T19에서 넘어온 것: flow write-series 2·5단계의 새 멤버 쓰기. documents 화면(`apps/shell/renderer/desktop/lophn-space/series/series-detail.tsx`)은 이미 있는 같은 자리·format 문서에 key를 붙여 멤버로 더한다. 다음 key 제안으로 새 문서를 만들어 쓰는 길(편집기 저장과 `series.set_draft`·`clear_draft`의 draft 보존, 저장 상태와 판 확정 구별)은 파일 통로와 함께 잇는다.
- 완료: 아래 확인이 통과한다
  - 저장 버튼 없이 고침을 main의 파일 adapter로 보낸다(target, base_hash, request_key, 바이트). main이 파일 통로를 부르고 renderer는 경로·port를 모른다.
  - 탭 닫기·파일 전환·읽기 전환·창 닫기·CommandOrControl+S는 마지막 변경을 flush하고 documents의 편집 종료에 잇는다. 유휴 종료는 documents 결과만 반영하고 shell에 timer를 두지 않는다.
  - 디스크 저장, 기록 확인, version 확정, format 검사 실패를 따로 기억한다. 머리 메타 줄에는 지금 결과나 다음 행동 하나만, 단계별 사실과 관측 시각은 상세에서 펼친다. 뒤 단계 실패를 이미 성공한 파일 저장 실패로 바꾸지 않는다.
  - 문서 옆 notice는 32px, 가장 높은 우선순위 하나. 충돌 막대는 해결까지 남고 해결 화면(현재 파일과 비교)으로 간다. 디스크 재읽기 안내만 3초 뒤 사라진다. 초안을 새 원본으로 덮지 않는다.
  - 쓰기 실패·불명·충돌이 남으면 탭·창 닫기를 잠시 막고 계속 편집·명시 폐기·접수 확인을 고르게 한다(이 선택은 overlay dialog이며 confirmation window가 아니다).
  - 결과 불명은 자동으로 다시 쓰지 않고 documents의 결과 조회부터 한다.
  - `file-adapter_test`, `close-guard_test`, `save-state_test`에 위 요구 테스트.
- 가져올 것: legacy `main/src/main/close-guard.ts`(중복 질문 억제, timeout).

### T18 정보 패널, 버전 이력, 비교, 복원

- 상태: 완료 (#310) — 정보 패널 탭 본문(정보·버전·컨텍스트, 절 이력), 비교 화면(접기·나란히·절 고르기·같은 판·누락), main 복원 통로(원문 참조 준비·`document.restore` CAS, 원본 연결 문서는 파일 CAS 쓰기 뒤 그 관측으로 확정, 1 MiB 넘는 명시 format 판 포함), overlay 닫기·CommandOrControl+Alt+B, 실제 core 테스트. 제품 core에서 비교·절 이력은 documents#T21(파생 consumer 조립) 뒤에 보인다. 그 전에는 비교 화면이 불러오지 못했다고 답한다(Q20 (3)).
- 등급: frontend
- concern: shell/editor
- 요구: shell/editor#R6, R13, R14
- 자리: apps/shell/renderer/editor/info-panel/, apps/shell/renderer/editor/versions/, apps/shell/renderer/editor/compare/
- 쓰는 contract: documents#T16(section 이력·diff·restore), documents#T6
- 내놓는 contract: 없음
- slice: documents
- 선행: shell#T14, shell#T16, documents#T16
- 완료: 아래 확인이 통과한다
  - 정보 패널 320px, 머리 36px, 안 여백 16px, 행 32px, 절 간격 20px, 정보·버전·컨텍스트 탭, 기본 닫힘, 공간별 열림·마지막 탭 기억, CommandOrControl+Alt+B. overlay일 때 Escape·바깥 click으로 닫힘.
  - 비교: 도구 줄 44px, 바뀐 절 목록 220px, 원문 13px/20px, 줄 번호 40px씩, 기호 16px, 바뀌지 않은 7줄 넘는 구간은 앞뒤 3줄만, 나란히 보기는 본문 1,100px 이상, 5,000줄 넘으면 절 선택. 좁으면 한 줄 보기와 이유.
  - +·− 기호와 색을 함께, 같으면 `These versions are identical`(en key). 복원은 secondary이고 primary 버튼이 없다. 복원 결과(새 판, 같아서 변경 없음, 충돌)를 그대로 보인다.
  - flow restore-document 화면. `compare_test`에 위 요구 테스트.

### T19 documents 화면: 검색, saved view, series

- 상태: 완료 (#265) — 이어보냄: write-series의 새 멤버 쓰기(편집기 저장·series draft) → shell#T17. series 정렬은 key 순만 고른다(format 정렬 값 필드를 선언한 format이 아직 없다). Q14
- 등급: frontend
- concern: shell/desktop
- 요구: shell/desktop#R1(문서 탐색이 기본), R28(lophn 공간 탐색)
- 자리: apps/shell/renderer/desktop/lophn-space/(sidebar, documents/, series/)
- 쓰는 contract: documents#T13(검색), documents#T14, documents#T15(saved view), documents#T17·T18(series), documents#T9(address)
- 내놓는 contract: 없음
- slice: documents
- 선행: shell#T12, shell#T14, documents#T13, documents#T15, documents#T17, documents#T18
- 완료: 아래 확인이 통과한다
  - lophn 공간은 projects, documents, contexts, apps, things-to-confirm, roles, settings 일곱 형제다. 중간 계층이 없다.
  - 조건(프로젝트, 앱, context, format) 검색과 짧은 근거, 보관 포함, 색인 지연·누락 표시. 빈 결과를 원본 부재로 단정하지 않는다.
  - saved view 저장·열기. 목차에서 section을 고르고 같은 고정 판의 다음 범위만 더 읽는다. 옛 참조·지정 판·최신 여부.
  - series: 등록(자리·이름·제목·format·정렬·다음 이름 규칙), 첫 key, 다음 key 제안과 근거, 순서대로 읽기, 가족 보관·해제. 제안 조회는 문서를 만들지 않는다.
  - flow find-documents, write-series 화면. 화면 테스트.

### T20 projects 화면과 정리: 이름, 자리, 보관, export, 파일로 두기와 빼기

- 등급: frontend
- concern: shell/desktop
- 요구: shell/desktop#R28(projects), shell/wording#R10
- 자리: apps/shell/renderer/desktop/lophn-space/projects/, apps/shell/renderer/desktop/lophn-space/organize/
- 쓰는 contract: documents#T7(update·archive), documents#T9(이동·이름 변경), documents#T19(파일로 두기·빼기), documents#T20(export)
- 내놓는 contract: 없음
- slice: documents
- 선행: shell#T19, shell#T23, documents#T9, documents#T19, documents#T20
- documents#T19에서 넘어온 것: 파일로 두기와 빼기는 `files.write`·`files.delete`의 선택 의도다. 두기는 `files.write`에 `base_hash: null`, `content: { kind: "existing", reference }`(그 문서 최신 판의 유일한 파일 원본 참조), `place: { document, version }`을 싣고, 빼기는 `files.delete`에 `unlink: { document }`를 더한다(확인 handle 묶음은 request_key·target·base_hash 그대로). 결과의 `placement`(source, tracking, move)·`unlinking`(source, move) 단계를 파일 결과와 따로 보이고, 실패한 단계 뒤는 "not_attempted"다. 사람 자격에 `document.set_source`·`document.move`·`project.set_tracking` 범위가 있어야 연결 단계가 선다. 따로 이을 command는 없다.
- 완료: 아래 확인이 통과한다
  - 프로젝트 목록·이름·목적·보관. 보관은 소속 문서 삭제가 아니다.
  - 문서 이름·자리 이동은 묻지 않고 하고 결과를 보인다. 파일에서 빼며 지우기는 confirmation window의 owner decision으로 보낸다(T23).
  - export: 문서·고정 판 선택, 포함·제외·반환 불가 이유와 실제 결과.
  - 이름 충돌·대상 변경은 "This changed since you opened it" 패턴.
  - flow organize-documents의 사람 갈래 화면. 화면 테스트.

### T21 명령 팔레트와 창 안 shortcut

- 등급: frontend
- concern: shell/desktop
- 요구: shell/desktop#R18(CommandOrControl+K, CommandOrControl+Shift+L), R30
- 자리: apps/shell/renderer/desktop/palette/, apps/shell/main/desktop/shortcuts.ts
- 쓰는 contract: documents#T13(검색), documents#T7
- 내놓는 contract: 없음
- slice: documents
- 선행: shell#T11, shell#T14, shell#T19
- 완료: 아래 확인이 통과한다
  - 창 안 팔레트 CommandOrControl+K, 런처 복귀 CommandOrControl+Shift+L. 전역 Ctrl+K를 등록하지 않는다(전역 팔레트는 T56).
  - 묶음 순서: 작업대는 열린 탭·문서·파일·컨텍스트·행동, lophn 공간은 프로젝트·컨텍스트·문서·앱·행동. 결과는 현재 탐색 대상으로만 간다.
  - palette는 overlay에 그린다. `palette_test`에 위 요구 테스트.
- 가져올 것: legacy `renderer/src/palette`, `main/src/shared/shortcuts.ts`.
- 상태: 완료 (#274). 문서 묶음은 documents 검색으로 찾고 overlay protocol에 검색 palette의 query·update를 더했다. 런처에는 R30 묶음이 없어 팔레트 키가 아무것도 열지 않는다.

### T22 confirmation window 기반: child modal, 보호 preload, 일회 handle

- 등급: 기본
- concern: shell/confirmation-window, shell/app-frame
- 요구: shell/confirmation-window#R1, R4, R5, R6, R7, R9, shell/app-frame#R30
- 자리: apps/shell/main/confirmation/(coordinator.ts, handle.ts, window.ts, submit.ts), apps/shell/preload/confirmation.ts, apps/shell/renderer/confirmation/(main.tsx, frame/)
- 쓰는 contract: contracts#T13(confirmation window, handle 등록 message, `CommandEnvelope.confirmation`), platform#T56(handle 발급·검증·소비), contracts#T22(approval)
- 내놓는 contract: confirmation window(contracts#T13 먼저)
- slice: documents
- 선행: shell#T3, shell#T8, contracts#T13, platform#T56
- 완료: 아래 확인이 통과한다
  - 열기 계기: main이 `ApprovalRequestCreated`·`QuestionCreated`를 구독하거나 사람이 [Review]를 누른 intent. 자동으로 창을 띄우지 않고 요청한 창의 사람이 연다.
  - 요청한 shell 창의 child modal BrowserWindow(`parent`, `modal: true`), 전용 메모리 session, `lophn-shell://confirmation/index.html` 설치 코드만. 일반 shell preload·앱 preload 없음. 탐색·새 창·download·network 막음. 앱 전용 창에서 요청해도 앞으로 가져온다.
  - 열린 동안 부모 창의 앱 view는 숨기지 않고 모든 앱 webContents에 `before-input-event` 차단을 건다.
  - main이 독립 read로 대상 정본·CAS·허용 결정을 얻고 일치 검사가 끝날 때까지 제출을 막는다. 대상 변경·다른 결정·조회 실패·단절에는 옛 버튼을 없애고 이유와 최신 내용 열기만 남긴다.
  - handle 원문은 main에만 있고 renderer는 displayId만 안다. 32 bytes, 120초와 대상 기한 중 이른 시각, core epoch·main 연결·window·대상·내용 기준·허용 결정에 결합. 닫힘·취소·crash·연결 종료·core 재시작·다른 대상 표시에 무효화. 같은 handle의 두 번째 제출은 새 결정을 만들지 않는다. 제출 결과 불명이면 새 handle 없이 receipt부터 조회한다.
  - 첫 focus는 설명, 기본 선택 없음, Enter 즉시 제출 없음, 닫기·Escape는 결정이 아님. 2차 확인은 영향과 scope를 다시 보이는 별도 단계.
  - 사용자 theme은 T5가 검증한 token 값만, slot·fork는 읽지 않는다.
  - `coordinator_test`, `handle_test`(가짜 core)와 `e2e/shell/confirmation_test.ts`(부모 앱 view가 보이지만 click·키가 가지 않음, CLI·MCP 동의가 결정이 안 됨)에 위 요구 테스트.
- 가져올 것: 없음(legacy는 native message box와 view 숨김을 썼다).
- 상태: 완료 (#145). desktop/main.ts·supervise 연결은 다음 작업. 창을 실제로 띄우는 IPC 등록은 아직 없다.

### T23 confirmation window 화면: 배치, 상세, 전후 비교, owner decision

- 등급: frontend
- concern: shell/confirmation-window, shell/wording
- 요구: shell/confirmation-window#R2, R3, shell/wording#R12
- 자리: apps/shell/renderer/confirmation/(layout/, details/, before-after/, kinds/owner-decision/)
- 쓰는 contract: contracts#T13(owner_decision `{concern, decision, targets, input, comparison}`), documents#T12·T19(files.delete 표시 자료)
- 내놓는 contract: 없음
- slice: documents
- 선행: shell#T12, shell#T22
- 완료: 아래 확인이 통과한다
  - 최대 640px, 좁으면 창 안에 맞춤. 기본 순서 대상·변경 → 영향·위험 → revert 가능 → 결정. 주체·시각·이유·근거·상세 전후는 Details에 접는다. 제목이 결정 자체를 문장으로 말한다(예: "Delete this file?").
  - 전후는 현재·바뀐 뒤 세로, 문서는 바뀐 문단과 앞뒤 1문단에 +/− 표지, 설정은 항목과 값, 전체·code diff는 펼침. 긴 줄은 자르지 않는다. 색 없이 추가·삭제·생략·자료 없음을 구별한다.
  - 정확한 경로·대상은 숨기지 않고 고정폭 원문으로 보인다. 그 밖의 내부 식별자·hash는 Details.
  - 첫 owner decision: documents의 파일 지우기.
  - `layout_test`에 위 요구 테스트.
- 상태: 완료 (#154). desktop/main.ts·supervise 연결과 IPC 등록은 아직 없다(T22가 넘긴 것).

### T24 터미널 host와 PTY

- 상태: 완료 (#160, #232) — 이어보냄: Windows Job Object 종료 확인 → shell#T57
- 등급: 기본
- concern: shell/terminal
- 요구: shell/terminal#R1, R2, R3, R4(일반 shell), R5(일반 shell 비주입), R7, R8, R9, R10, R11
- 자리: apps/shell/terminal-host/(main.ts, pty.ts, ring-buffer.ts, child-group.ts, env.ts), apps/shell/main/terminal/(supervisor.ts, ipc.ts), apps/shell/ipc/terminal.ts
- 쓰는 contract: documents#T7(등록 폴더)
- 내놓는 contract: 없음
- slice: documents
- 선행: shell#T3, shell#T13, documents#T7
- 완료: 아래 확인이 통과한다
  - main이 Electron 실행당 terminal host 하나를 상속 private pipe로 띄우고 감독한다. host가 node-pty(POSIX PTY, Windows ConPTY)·child group·출력 ring buffer를 갖는다. node-pty native module rebuild를 build에 넣는다.
  - `shell:terminal-open({project, folder_ref})`: 등록 폴더가 하나면 그것, 여럿이면 선택 전 시작 안 함, 없거나 디렉터리가 아니거나 못 읽으면 이유와 함께 거절하고 다른 폴더로 대신 시작하지 않는다.
  - Linux·macOS는 사용자 login shell, Windows는 PowerShell 7, 없으면 표시한 5.1을 실행 파일과 argv 배열로 직접 spawn한다. 환경에서 플랫폼 token·connection·handle·내부 endpoint를 뺀다. host 제어 pipe는 child에 상속하지 않는다.
  - 입력은 살아 있는 shell renderer main frame의 그 터미널 focus와 generation을 main이 확인한 뒤에만 보낸다.
  - ring buffer 터미널마다 10,000줄과 5,242,880 bytes 중 먼저 닿는 쪽, 오래된 chunk부터 빼고 dropped 표시. disk·ledger·blob·log·세션 문맥에 쓰지 않는다. renderer가 다시 생기면 살아 있는 host의 buffer만 다시 보인다.
  - 종료: 시작 실패, 확인된 exit code, 결과 불명(host crash)을 구별한다. 다시 시작은 사람이 누를 때만 새 generation으로, 옛 입력 재생 없음. 닫기·Electron 종료의 사람 확인 뒤 process group(Windows Job Object)의 종료를 확인하고, 확인 실패는 결과 불명.
  - OSC 52 clipboard, OSC 8 자동 링크, 임의 escape 기반 host 동작을 막는다. output flood는 chunk 단위로 양보한다.
  - `ring-buffer_test`, `env_test`, `start_test`, `child-group_test`와 `e2e/shell/terminal_test.ts`(secret 모양 출력이 저장소·진단에 없음, host crash 표시)에 위 요구 테스트.
- 가져올 것: 없음(legacy에 터미널이 없다). xterm.js와 node-pty를 stack.md에 더한다.

### T25 터미널 탭 화면

- 상태: 완료 (#235). E2E가 찾은 T24 결함 둘(묶인 host의 node-pty 불러오기, 닫기 종료 확인 대기)을 함께 고쳤다. 제품 경로의 등록 폴더 read와 host 재기동은 Q12.
- 등급: frontend
- concern: shell/terminal, shell/workspace
- 요구: shell/terminal#R1(폴더 선택), R6, R7(다시 보이기), R9(종료 표시와 다시 시작), R10(닫기 확인), R11(xterm handler), shell/workspace#R1(터미널 탭), R7(종료 자리표시)
- 자리: apps/shell/renderer/terminal/(terminal-tab.tsx, xterm-view.ts, folder-choice.tsx, exit-banner.tsx)
- 쓰는 contract: 없음(T24의 IPC)
- 내놓는 contract: 없음
- slice: documents
- 선행: shell#T14, shell#T24
- 완료: 아래 확인이 통과한다
  - 여러 등록 폴더 중 고르는 화면, 첫 열기 안내에 "OS 사용자 권한으로 돈다, lophn 앱 sandbox가 아니다"와 "시작 위치는 프로젝트 폴더"를 다른 뜻으로 보인다.
  - xterm.js에는 OSC clipboard, 자동 링크, 파일·앱·플랫폼 동작 handler를 등록하지 않는다.
  - 출력 옆에 종료 상태·exit code·결과 불명, 출력 일부 없음 표시, [Start again]은 새 shell. 탭 전환·공간 이동·숨김은 shell을 유지한다.
  - 살아 있는 터미널 닫기는 overlay dialog로 확인하고 취소하면 유지한다.
  - `terminal-tab_test`, 그리고 flow project-workspace의 터미널 단계 E2E `e2e/shell/project-workspace-terminal_test.ts`(documents 팀의 `e2e/flows/project-workspace_test.ts`는 문서 단계만 돈다).

## agent

### T26 현재 보기 상태 수집과 relay publish

- 상태: 완료 (#178)
- 등급: 기본
- concern: shell/workspace
- 요구: shell/workspace#R9, R10
- 자리: apps/shell/main/workspace/(current-view.ts, view-publish.ts)
- 쓰는 contract: contracts#T25(CurrentViewState와 relay publish·bind·unpublish·read message), platform#T57(현재 보기 relay), contracts#T12(redaction)
- 내놓는 contract: 현재 보기 상태(contracts#T25 먼저)
- slice: agent
- 선행: shell#T13, shell#T14, contracts#T25, platform#T57
- 완료: 아래 확인이 통과한다
  - main이 renderer의 layout 힌트를 실제 view registry·현재 scope와 대조해 `CurrentViewState`를 만든다. 문서 선택은 판·절·줄 범위만, 앱은 app·release·mode·screen·view generation만. 본문·초안·터미널 출력·DOM·screenshot은 없다.
  - 창의 보기 generation이 바뀔 때 relay에 publish하고, 사람 요청·steering을 보낼 때 그 창 window_ref와 session 결합을 함께 보낸다. 요약 2048 bytes, 탭 page 20개, 생략·잘림·관측 시각 표시. redaction 실패는 omission.
  - 창 닫힘·단절에는 unavailable·disconnected를 publish하고 다른 창의 상태를 대신 쓰지 않는다.
  - `current-view_test`에 위 요구 테스트(두 창에서 각자의 탭과 선택만 묶임).

### T27 대화 도크

- 상태: 완료 (#272) — 이어보냄: 메시지 본문 읽기(lophn 답·machine 사실·다른 창이 보낸 말의 글), lophn 답 streaming 임시 글, 사람 말 본문의 prepared blob 전달(lophn-agent#T26 Q29 뒤) → shell#T35(Q15), 앱 공간의 도크 토글 → shell#T42. 새 데이터 root의 lophn 역할 assignment 생성은 lophn-agent 쪽(Q15)
- 등급: frontend
- concern: shell/desktop, shell/workspace
- 요구: shell/desktop#R1, R2, R3, R7(대화의 단절), R8, R29, shell/workspace#R13(새 답이 focus·scroll을 빼앗지 않음)
- 자리: apps/shell/renderer/conversation/(dock.tsx, message-list/, composer/, delivery-state.ts, result-links.tsx, drafts.ts)
- 쓰는 contract: contracts#T26(run·session·message), lophn-agent#T11(세션·전송·접수 조회·steering), lophn-agent#T10·T12(멈춤·다시 시작·run 상태), lophn-agent#T25(기다림 표시), lophn-agent#T28(세션 이어가기)
- 내놓는 contract: 없음
- slice: agent
- 선행: shell#T11, shell#T14, shell#T26, contracts#T26, lophn-agent#T10, lophn-agent#T11, lophn-agent#T12
- 완료: 아래 확인이 통과한다
  - 모든 공간에서 오른쪽 400px 도크로 토글한다. 본문을 밀고 320px 정보 패널 자리를 임시로 쓰며, 본문 480px를 남길 수 없으면 overlay. 닫으면 이전 정보 패널 상태로 돌아간다. 닫거나 한 번도 열지 않아도 문서·앱 탐색은 그대로다.
  - 결과 링크는 답 아래, 4개 이상이면 첫 3개·남은 개수·나머지 보기.
  - 작성 중 말·선택 답·커서를 세션 전환·confirmation window·전송 실패·단절에 세션별 메모리로 보존한다. 보내는 중·접수됨·못 보냄·접수 확인 안 됨을 구별하고 불명이면 재전송보다 접수 조회를 먼저 보인다.
  - streaming 글은 임시 표시이고 확정 메시지로 바꾼다. 새 답·세션 전환이 사람의 scroll 위치와 입력 focus를 빼앗지 않는다.
  - 현재 수정과 다음 요청을 구별해 보내고 멈추기를 둔다(flow steer-agent-work).
  - `dock_test`, `delivery-state_test`에 위 요구 테스트.

### T28 질문 칸, things-to-confirm, notification chip

- 상태: 완료 (#282) — 이어보냄: [Review]의 preload `openConfirmation`·main `shell:confirmation-open` 연결과 action 답(`questions/answer-action`) 제출 → shell#T29, 런처 카드의 대기 pill → shell#T15, 앱 공간 크롬 → shell#T42. Q16의 막힌 것(일반 답 경로, 질문 글, approval·notification 목록)은 #288·#286 뒤 Q16 후속(#291)에서 풀었다
- 등급: frontend
- concern: shell/desktop, shell/design-system
- 요구: shell/desktop#R6, R9, R10(창 안 chip), R26(대기 개수 글자 pill), R27, shell/design-system#R35
- 자리: apps/shell/renderer/conversation/question-strip/, apps/shell/renderer/desktop/lophn-space/things-to-confirm/, apps/shell/renderer/desktop/notification-chip/
- 쓰는 contract: contracts#T22(approval·notification), contracts#T28(question), platform#T17(notification 생성·읽음), platform#T21(approval 조회), lophn-agent#T24(답·미루기·취소)
- 내놓는 contract: 없음
- slice: agent
- 선행: shell#T11, shell#T22, shell#T27, contracts#T22, contracts#T28, platform#T17, lophn-agent#T24
- 완료: 아래 확인이 통과한다
  - 질문·approval 칸은 대화 입력 위 하나, blocking 먼저·나머지 접수 순, 현재 번호/전체와 앞뒤. action 없는 질문의 선택 답·자유 답·미루기·취소는 일반 답 경로로 보낸다. option action·approval은 [Review]로 confirmation window를 연다.
  - things-to-confirm은 기다리는 것(종류별 개수와 다음 행동)과 지난 일(최신순 링크), 역할·기간 filter. 목록을 읽는 것만으로 답·승인이 제출되지 않는다. 세션 없는 요청도 여기서 연다. 사람이 notification을 명시적으로 읽음·읽지 않음으로 남기고, 그것이 답·승인·문제 닫힘이 아님을 지킨다. 항목이 많아도 종류나 개수로 버리지 않는다.
  - notification chip은 창 오른쪽 아래 360px 하나와 외 n건, 보기·닫기, 자동 표시가 focus나 현재 문서를 바꾸지 않는다. 클릭은 things-to-confirm으로 갈 뿐 읽음·결정이 아니다.
  - 런처 카드의 approval 대기 개수는 글자 pill. 프로젝트·앱 공간의 lophn 크롬은 그 공간의 결정 대기와 daemon 장애 안내만.
  - 화면 테스트.

### T29 confirmation window 종류: approval, option action, revert, secret 입력

- 등급: frontend
- concern: shell/confirmation-window
- 요구: shell/confirmation-window#R2(종류별 배치), R5(바뀜 표시)
- 자리: apps/shell/renderer/confirmation/kinds/(approval/, option-action/, revert/, secret-input/), apps/shell/main/confirmation/kinds/
- 쓰는 contract: contracts#T22(approval), contracts#T23(secret), contracts#T28(question option action·revert), contracts#T29(provider credential 입력), lophn-agent#T29(option action 적용), lophn-agent#T34(revert preview·revert_run). OAuth 쪽 lophn-agent#T16은 이 작업을 선행으로 두므로 여기서는 contracts#T29 모양으로만 테스트한다
- 내놓는 contract: 없음
- slice: agent
- 선행: shell#T22, shell#T23, contracts#T22, contracts#T23, contracts#T28, contracts#T29, platform#T21, platform#T22, lophn-agent#T29, lophn-agent#T34
- shell#T28에서 넘어온 것: 질문 칸·things-to-confirm의 [Review]는 `lophnShell.openConfirmation({request, parentWindow})`(contracts shell confirmation)을 부른다(`apps/shell/renderer/desktop/lophn-space/things-to-confirm/core-source.ts`의 `windowConfirmation`). shell preload에 `openConfirmation`과 main의 `shell:confirmation-open` 등록·coordinator 연결이 아직 없어 지금은 "The review window can't open here yet."를 보인다. main은 renderer가 보낸 `parentWindow` 값이 아니라 IPC를 보낸 창을 부모로 쓴다
- platform#T19 후속(#294)에서 넘어온 것: secret 입력 창의 main 쪽 길이 core에 열렸다. 값이 있는 곳은 창의 보호 입력과 main 메모리뿐이다. main은 (1) `POST /v1/secrets/input`(`content-type: application/octet-stream`, `x-lophn-input`에 `{purpose, owner, bytes}`의 base64url JSON, body는 값의 바이트, 상한 64KiB)으로 값을 보내 값 없는 준비 증거 `{preparation, sealed_ref, purpose, owner}`를 받고, (2) 그 증거가 들어간 `SetSecret` 입력(앱 secret은 `purpose: app_secret`, `owner == name`)의 binding으로 confirmation handle을 main↔core 비공개 연결에 등록하고(handle은 증거를 받은 뒤에만 만들 수 있다), (3) `SetSecret`(교체는 `compare: {sealed_ref, revision}`, 처음은 null 둘)을 보내고, (4) 결과로 창에는 안전 이름·저장 결과만 돌려준다. 제거는 `RemoveSecret`이다. 표시용 `/v1/secrets/list`(이름·설정 여부·판)도 열렸다. 실패는 keychain 잠김이면 `unavailable`(값은 어디에도 남지 않음), 크기 불일치면 `invalid_input`이다. provider credential(`RegisterProviderCredential`·`ChangeProviderCredentials`)은 같은 route에 `purpose: provider_credential`로 값을 보내 증거를 받고 소유 command를 부른다(T31). 제출·취소·창 종료 때 값을 지운다. core가 값을 쥐는 곳은 없으므로 main이 값을 로그·오류·IPC 결과에 넣지 않는 것이 이 작업의 시험이다.
- platform Q29(#305)에서 넘어온 것: approval 결정 창은 `approvals/get`(exact 동작·대상·입력·기한·상태)과 함께 `ReadApprovalText`(`/v1/approvals/text`, 입력 `{approval}`)로 이유·변경·외부 영향·되돌림 글을 읽어 문장으로 보인다. 글은 core가 redaction한 값이고 blob 하나라도 읽지 못하면 `unavailable`이라 일부만 보이지 않는다. 거절 창은 선택 입력인 거절 이유를 `closed_reason` 글 값(없으면 `null`, 글 하나 32KiB 이하, 공백뿐인 글은 보내지 않는다)으로 `approvals/reject`에 싣는다. hash를 만들거나 blob을 준비하지 않고 core가 한다. 이유는 handle binding(approval·created_seq·binding_hash)에 들어가지 않는다. 종료된 request의 `ReadApprovalText.closed_reason`이 적은 거절·취소 이유이고 만료는 null이다(상태가 이유다).
- lophn-agent#T34(Q44)에서 넘어온 것: revert 창의 main은 (1) `reverts/preview`로 본 묶음(`groups`)을 보이고, (2) 복원 가능한 묶음마다 문서의 이전 판을 사람 자격의 `documents/prepare`(`existing` 원문 참조와 그 판의 FormatRef)로 준비해 `buildRevertInput`(packages/lophn-agent/revert/work.ts)으로 `RevertRun` 입력의 `groups`(준비 결과는 `comparison.prepared`, `prepared_ref`는 그 hash)를 만들고 준비 참조를 요청의 `prepared`에 싣는다. (3) 확인 handle은 binding(`id, run, allow_partial, preview_hash`)으로 발급하고 결정 이름은 command 이름 `RevertRun`(= contract의 `REVERT_RUN_DECISION`)이다. (4) 이유(`reason`)는 고정 코드(`revertReasonSchema`)이므로 코드로 wording을 고른다. 결과 event는 사람이 `events/list`로 따라 볼 수 있다(payload는 run·지문·결과별 수). 준비 결과가 없으면 문서 내용 복원은 blocked(복원 준비 불충족)로 끝난다
- 상태: 완료 (#350)
- 정한 것(T29): shell#T23(#154)은 계획만 완료로 적히고 코드가 main에 없어 이 PR이 그 branch를 merge해 함께 싣는다(layout·details·before-after·owner decision 화면, 화면 테스트는 `apps/shell/renderer/confirmation/screens_test.ts`로 등록). T28이 넘긴 길을 이었다: shell preload `lophnShell.openConfirmation`, main의 `shell:confirmation-open`(부모는 IPC를 보낸 desktop 창)·`confirmation:display`(무효면 다시 읽는 최신 내용 열기)·`confirmation:submit`·`confirmation:cancel`, coordinator 조립, 비공개 pipe의 handle 등록(응답에 짝 id가 없어 한 번에 하나, 5초 안에 답이 없으면 unavailable). contract는 additive로 늘렸다(contracts shell confirmation): owner decision 열기의 `targets`, secret 입력 열기의 provider `credential`(값 아닌 등록 정보), 표시의 `view`·`state`·`decisions`·`second`, 제출의 `confirmedSecond`, 결과의 `result`(accepted는 결정 접수, applying·applied·partial·uncertain·blocked는 RevertRun의 실제 결과), 보호 preload의 `subscribe`. approval은 `approvals/get`·`ReadApprovalText`로 그리고 허락·거절은 handle로, 대기 요청의 명시 취소는 handle 없는 `cancel_approval_request`로 보낸다. 거절·취소 이유는 같은 선택 입력칸이다. option action은 `questions/read`·`questions/text`로 그리고 `AnswerQuestionAction`(evidence 포함)을 보낸다. revert 열기는 `{kind: owner_decision, concern: lophn-agent/revert, decision: RevertRun, targets: [run]}`이다. revert id는 창마다 main이 만든다. 복원 불가·유지·충돌이 섞이면 `allow_partial: true`로 결합하고 남는 묶음을 다시 보이는 2차 확인 뒤에만 보내며, 복원 가능한 묶음이 없으면 결정이 없다. 문서 준비는 binding 밖이라 제출 때 `documents/get`·`documents/prepare`(existing 참조)로 하고 `buildRevertInput`과 같은 규칙으로 groups와 `prepared`를 싣는다(shell main은 packages를 import하지 않아 규칙을 `apps/shell/main/confirmation/kinds/revert.ts`에 옮겼다). secret 입력은 열 때 handle을 만들지 않고 제출 때 upload→증거→증거를 넣은 binding으로 handle→command 순서이며 창에는 안전 이름(앱 secret 이름, provider credential label)과 저장 결과만 돌려준다. 이미 값이 있는 앱 secret은 교체 비교 기준이 없어 결정 없이 이유만 보인다
- 남긴 것(T29): T23의 `delete_file` owner decision은 main 정본 read·제출이 없다(열면 not_found). 실제 core로 네 종류 창을 끝까지 연 확인은 seed가 없어 하지 못했고 화면은 offscreen probe로 보았다
- 완료: 아래 확인이 통과한다
  - approval request: 결정을 문장으로 묻고 exact 대상·입력·영향·되돌릴 범위. 허락·거절·명시 취소. 승인 접수와 실제 적용을 구별해 돌려준다.
  - question option action: concern·command·대상·정확한 입력·비교 기준·영향을 고르기 전에 그대로 보인다.
  - revert: 복원 가능·불가·충돌·남을 영향. 안전하지 않은 부분은 기본 적용에서 뺀다.
  - secret 입력: 보호 입력칸, 값은 main에서 secret contract(또는 provider credential command)로 바로 가고 어디에도 남지 않는다. 결과는 안전 참조와 저장 결과만. OAuth code·최종 URL 붙여넣기도 이 입력이다(provider 인증 방식은 lead 결정을 따른다).
  - 종류별 테스트.

### T30 roles 화면: 하는 일, 만든 것, 대화, 작업 검토, Preset

- 등급: frontend
- concern: shell/desktop
- 요구: shell/desktop#R3, R4, R5, lophn-agent/observability#R16, R17, R20, R21, R22(화면)
- 자리: apps/shell/renderer/desktop/lophn-space/roles/(list/, detail/, work/, made/, review/, preset/)
- 쓰는 contract: contracts#T26(run·session), contracts#T27(preset·assignment), contracts#T30(tool call·trace·usage), contracts#T28(revert), lophn-agent#T7·T8(preset 편집·기본 preset), lophn-agent#T9(멈춤·재개·회수), lophn-agent#T6(사용량), lophn-agent#T39·T40(trace read·export), lophn-agent#T37(MCP tool의 preset 선택)
- 내놓는 contract: 없음
- slice: agent
- 선행: shell#T12, shell#T27, contracts#T26, contracts#T27, contracts#T30, lophn-agent#T7, lophn-agent#T9, lophn-agent#T39
- shell#T29에서 넘어온 것: revert 진입은 `lophnShell.openConfirmation({request: {kind: "owner_decision", concern: "lophn-agent/revert", decision: "RevertRun", targets: [run]}, parentWindow})`이다. 창이 `reverts/preview`를 다시 읽고 문서 준비·`RevertRun` 제출까지 한다. 결과(접수·실제 복원 결과)는 창이 말하고 목록은 `reverts/list`·`events/list`로 다시 읽는다
- 완료: 아래 확인이 통과한다
  - 역할 목록은 같은 열 배치. 상세는 하는 일·만든 것·대화 탭. 회수된 담당은 지난 대화만 보이고 입력창이 없다. 멈춘 담당의 입력은 소유 concern의 허용 결과를 그대로 따른다.
  - 하는 일은 In progress / Waiting / Stopped / Done 순, 다시 시작과 다시 시키기는 다른 버튼.
  - 작업 검토: 기본은 대상·결과·다음 행동, 상세에 시각·역할·이유·근거·영향 링크. 도구 활동은 단계 수로 접고 펼침. 판단은 요약만. 호출별 사용량과 실제 청구·구독 포함·무료·모름을 구별한다. export는 내용 종류를 고르고 결과 수를 보인다.
  - Preset: 역할마다 기본 Preset과 사람이 고친 판, 계정 순서·model·context·skill·MCP·개별 tool 선택, 새 판 저장과 명시 적용. 내부 구성(prompt, capability)은 펼친 자리에만.
  - flow review-agent-work, resume-agent-session(roles 쪽), add-agent-extension(Preset 쪽) 화면. 화면 테스트.
- shell#T35에서 넘어온 것: lophn 답의 streaming 임시 글(shell#T27 → T35에서 이어온 것, Q15 (3)). 대화 탭과 도크가 같은 `conversation/message-list`를 쓰므로 여기서 함께 한다. 임시 글을 보이고 같은 id의 확정 메시지가 오면 바꾸며, 그 동안에도 입력 focus와 읽던 위치를 지킨다(shell/workspace#R13). stream 조각은 시각 블록으로 그리지 않는다(lophn-agent/conversation#R13). renderer로 오는 streaming 통로(core event → main → renderer)가 아직 없으니 먼저 그 통로가 있는지 보고, 없으면 lead에게 올린다.

### T31 settings: provider 연결과 계정, 확장, 전역 Instructions 진입

- 등급: frontend
- concern: shell/wording, shell/desktop, shell/app-frame
- 요구: shell/wording#R10, R13(For decisions·For summaries), shell/app-frame#R7(shell 크롬 외부 링크)
- 자리: apps/shell/renderer/desktop/lophn-space/settings/(providers/, accounts/, extensions/, general/), apps/shell/main/desktop/open-external.ts
- 쓰는 contract: contracts#T29(provider·credential·catalog), contracts#T24(settings registry), contracts#T23(secret), platform#T25–T27(settings definitions·get·history·apply), lophn-agent#T3(provider 등록·순서), lophn-agent#T4·T5(catalog·model 기본값), lophn-agent#T6(사용량), lophn-agent#T15(연결 테스트), lophn-agent#T16(OAuth), lophn-agent#T35·T36·T38(skill·MCP·MCP OAuth)
- 내놓는 contract: 없음
- slice: agent
- 선행: shell#T12, shell#T29, contracts#T24, contracts#T29, platform#T25, lophn-agent#T3, lophn-agent#T15, lophn-agent#T35, lophn-agent#T36
- platform#T19 후속(#294)에서 넘어온 것: provider key·로그인 응답의 값은 T29의 secret 입력 창이 `/v1/secrets/input`(`purpose: provider_credential`)으로 보내 증거를 받은 뒤 `RegisterProviderCredential`·`ChangeProviderCredentials`를 부른다(순서는 T29의 넘어온 것을 따른다). 확정 뒤 core가 그 credential의 값을 알려진 값 registry에 등록하므로(documents 읽기·메시지 본문에서 가려진다) 화면이 따로 할 일은 없다.
- shell#T29에서 넘어온 것: provider key는 `openConfirmation({request: {kind: "secret_input", owner: <provider id>, purpose: "provider_credential", credential: {key, kind, label, account, organization, plan, dedup_fingerprint}}})`로 연다. 창은 `providers/read`의 revision을 비교 기준으로 `RegisterProviderCredential`까지 보낸다. 교체·회수(`ChangeProviderCredentials`)와 앱 secret 제거(`RemoveSecret`)는 창 종류가 아직 없다(열기 모양을 정해 `apps/shell/main/confirmation/kinds/secret-input.ts`에 더한다)
- 완료: 아래 확인이 통과한다
  - provider 연결: contract가 알려 준 인증 방식(API key, 공식 로그인, 로컬)만 보이고 과금·한도·금액 모름을 구별한다. key와 로그인 응답은 confirmation window의 secret 입력으로만 받는다.
  - 계정: 같은 provider의 계정 순서, 사용 가능·인증 문제·사용량 한도·확인된 리셋 시각, 다음 행동 하나. 교체·삭제·재로그인은 confirmation window.
  - 연결 테스트는 사람이 누를 때만, 결과와 모르는 비용을 0으로 채우지 않는다.
  - model 선택 라벨은 For decisions, For summaries. 설정 값은 정의·현재 적용값·효력 시점과 기본/펼침을 나눈다.
  - 확장: 로컬 skill 폴더 등록, MCP server(stdio, Streamable HTTP, 인증 방식) 추가, 실패와 다음 행동. MCP credential은 secret 입력.
  - 전역 [Instructions] 진입(T32).
  - shell 크롬의 외부 링크와 provider 공식 로그인 버튼은 확인 창 없이 OS browser로 연다(D21, lead 결정). main이 HTTP·HTTPS·userinfo 없음·8,192자 이하를 검사하고 기록에는 origin·path만 남긴다. 앱 링크 경로(T38)와 caller를 섞지 않는다. 이 PR에서 shell/app-frame#R7을 그렇게 고친다.
  - flow connect-provider, manage-provider-accounts, ask-lophn-help(settings 쪽), add-agent-extension 화면. 화면 테스트.

### T32 [Instructions]: 지침 파일을 같은 편집기로

- 등급: 기본
- concern: shell/editor
- 요구: shell/editor#R17
- 자리: apps/shell/main/editor/instructions.ts, apps/shell/renderer/editor/instructions-entry.tsx
- 쓰는 contract: documents#T28(지침 파일), lophn-agent#T18(instructions)
- 내놓는 contract: 없음
- slice: agent
- 선행: shell#T17, shell#T18, documents#T28, lophn-agent#T18
- 완료: 아래 확인이 통과한다
  - 전역(settings), project(project-workspace), app(app-detail) [Instructions]는 main이 exact 지침 파일 대상만 resolve해서 같은 편집기로 연다. 없으면 빈 초안이고 사람의 첫 저장으로 만든다.
  - 초안 보존, 외부 변경 충돌, version 비교, 복원은 일반 문서와 같다. 경로와 안쪽 version 식별자는 기본 화면에 없다. agent 제안은 저장하지 않는다.
  - flow edit-instructions 화면. `instructions_test`에 위 요구 테스트.

### T33 격리 문서 view

- 상태: 완료 (#144)
- 등급: 기본
- concern: shell/app-frame
- 요구: shell/app-frame#R1(문서), R2(문서), R8, R10, R11(문서 host), R14, R17
- 자리: apps/shell/main/app-frame/(document-view.ts, session-policy.ts, document-protocol.ts), apps/shell/renderer/app-frame/document-view-slot.tsx
- 쓰는 contract: contracts#T11(blob 읽기), contracts#T15(version)
- 내놓는 contract: 없음
- slice: agent
- 선행: shell#T2, shell#T3, shell#T10
- 완료: 아래 확인이 통과한다
  - 실행 가능한 문서 format(HTML 등)은 `lophn-document://ver-<ULID 소문자>/...` view로 연다. host는 소문자 DNS label이고 main registry가 고정 version으로 해석한다.
  - partition `document-<version>-<view_session>` 메모리 session. 닫으면 webContents를 파괴하고 `clearStorageData`·cache 정리. 쿠키·localStorage·IndexedDB·cache가 shell·다른 판과 섞이지 않는다.
  - CSP `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'`, network 기본 차단, 자기 고정 판 자원만 proxy, worker에도 같은 경계.
  - preload 없음, 원본 파일 수정 통로 없음.
  - session 정책은 한 모듈에 등록한다(T37이 앱 session을 같은 모듈에 더한다).
  - `document-view_test`, `session-policy_test`와 `e2e/shell/document-isolation_test.ts`에 위 요구 테스트.
- 가져올 것: legacy `views.ts`의 `#artifactSession` 분리 원리만. `/v1/artifact/file` 계약은 가져오지 않는다.

### T34 SDK: @lophn/tokens, @lophn/ui-table, @lophn/ui-chart

- 등급: frontend
- concern: shell/design-system
- 요구: shell/design-system#R11(차트 낮은 대비 보조), R12, R13, R41, apps/sdk#R4(@lophn/tokens·ui-table·ui-chart 1.0.0), R16(ui-table), R17, R20, R38
- 자리: packages/sdk/tokens/, packages/sdk/ui-table/, packages/sdk/ui-chart/
- 쓰는 contract: 없음(packages/design을 고정 SDK package로 낸다)
- 내놓는 contract: @lophn/tokens, @lophn/ui-table, @lophn/ui-chart 1.0.0
- slice: agent
- 선행: shell#T4, shell#T12
- 완료: 아래 확인이 통과한다
  - 각 package는 deno.json(정확한 1.0.0), mod.ts, 예제를 갖고 `packages/design`의 token·컴포넌트를 쓴다. contracts는 import하지 않는다.
  - ui-table: 정렬, 페이지, 열 선택, 숫자 정렬, 가상 scroll, component 안 scroll.
  - ui-chart: 시계열(선), 막대, 누적 막대, 분포, 그리고 visuals가 요구하는 산점과 node·edge 도표(Q5). d3-scale·d3-shape 계산과 React SVG. 선 2px, 막대 최대 24px·끝 radius 4px·간격 2px, 점 radius 4px, subtle 격자, 선·영역은 십자선 tooltip, 막대·점은 항목 tooltip, 색은 엔티티에 고정·순환 없음, 이중 축 없음, 9번째부터 기타 회색, light aqua·yellow·magenta에 직접 라벨 또는 표 보기, 10만 이상 축은 compact, 날짜 `Sep 26`·tooltip `Sep 26, 2026 (Sat)`(Intl).
  - 같은 입력 계약을 앱 화면과 세션 시각 블록이 쓴다. loading·empty·error 표시가 있고 임의 script를 실행하지 않는다.
  - package 옆 테스트.
- 가져올 것: legacy `packages/sdk/ui-chart`(LineChart, BarChart, geometry, palette), `ui-table`. d3-scale·d3-shape를 stack.md에 더한다.
- 상태: 완료 (#64)

### T35 세션 시각 블록 renderer

- 상태: 완료 (#338) — 이어보냄: lophn 답의 streaming 임시 글 → T30, 세션 앱 카드 갈래 → T44, 블록 하나만 output schema를 못 지날 때 메시지 전체 읽기 실패(contracts 판단, Q23 (2))
- 등급: frontend
- concern: shell/workspace
- 요구: shell/workspace#R12, R13
- 자리: apps/shell/renderer/workspace/visuals/(registry.ts, block-frame.tsx, table-block.tsx, chart-block.tsx, diagram-block.tsx, document-block.tsx)
- 쓰는 contract: contracts#T30(VisualBlock), lophn-agent#T33(블록 schema·문서로 남기기)
- 내놓는 contract: 없음
- slice: agent
- 선행: shell#T27, shell#T33, shell#T34, contracts#T30, lophn-agent#T33
- lophn-agent#T33에서 넘어온 것: 블록 틀의 [Save as document]는 별도 visuals 저장 contract를 부르지 않는다(그런 contract는 없다). 누르면 "이 블록을 문서로 남겨 달라"는 요청을 대화 입력(`ReceiveMessage`)으로 보내고, agent가 `visual.prepare_document`와 문서 tool로 준비·저장한다(visuals#R6, lophn-agent 질문 Q45 (6), lead 승인). 저장 뒤 고정 문서 링크는 그 답 메시지의 링크에서 온다. → 했다(Q23 (4)): 버튼은 요청 글을 일반 request로 보내고, 요청 말이 맡긴 run의 lophn 답에 문서·판 결과 링크가 오면 그 블록 틀에 고정 문서 링크를 보인다.
- lophn-agent#Q29에서 넘어온 것(#281, 계약이 정해졌다): (1) 보내기는 `ReceiveMessage` 입력의 `body`(hash)를 `content`(`{schema_version: 1, parts: [{kind: "text", text}]}`, 정규 직렬화 64KiB 이하)로 바꾼다. renderer·main은 hash도 blob도 만들지 않고 core가 redaction·준비·영구 참조를 한다. 같은 id·같은 idempotency key의 재전송은 이전 결과다. 본문 hash는 응답의 `message.body`에서 온다. (2) 읽기는 `ReadMessageBody`(`/v1/messages/body`, 입력 `{message}`, 출력 `{message, session, body, size_bytes, content, as_of_seq, next_cursor}`)이고 `content.parts`는 글·시각 블록이다. 사람·그 assignment의 agent·machine만 읽으며 없는 메시지와 다른 assignment의 것은 같은 `not_found`, 본문 blob을 못 읽으면 `unavailable`이다. (3) 새 데이터 root에도 lophn assignment가 있다(core 기동이 만든다, lophn-agent Q37). model이 미준비라 run은 provider를 고르기 전까지 시작하지 못한다. → (1)·(2)는 #285에서 했다: 도크가 `content`를 보내고(보내기 전에 64KiB 상한을 보고 넘으면 보내지 않고 이유를 둔다) 확정 메시지 본문을 `ReadMessageBody`로 읽는다. 블록 renderer만 이 작업에 남는다
- shell#T27에서 넘어온 것: 메시지 본문(MessageContent) 읽기와 그 글·블록 표시. → 읽기와 글 표시는 #285에서 했다: 도크(`apps/shell/renderer/conversation/`)는 사람 말·lophn 답·machine 사실·다른 창이 보낸 말의 본문을 모두 읽어 글 part를 그리고, 읽은 본문은 창 메모리(`DraftStore`)에 둔다. 이 창이 보낸 말은 읽기 전까지 보낸 글로 자리를 채운다. 시각 블록 part는 지금 제목과 "Charts, tables, and diagrams can't be shown in the conversation yet."만 글로 보이는 자리 표시다(`message-list.tsx`의 `VisualPending`). 이 작업의 블록 renderer가 그 자리를 바꾼다. 남은 것: 블록 그리기, lophn 답의 streaming 임시 글(확정 메시지로 바꾸기, renderer로 오는 streaming 통로가 아직 없다, Q15 (3)) → 블록 그리기는 이 작업에서 했다(Q23): `VisualPending`을 없애고 본문 순서대로 블록 renderer가 그린다. streaming 임시 글은 통로가 아직 없어 T30으로 넘겼다
- 완료: 아래 확인이 통과한다
  - 검증된 선언형 블록(표, 막대·선·산점 차트, node·edge 도표, 고정 문서)만 설치 SDK의 허용 registry로 그린다. 앱 카드 갈래는 T44. schema를 통과하지 못하면 그 자리에 오류와 안전한 설명만.
  - agent의 JS·HTML·CSS·URL을 import·eval·innerHTML로 실행하지 않고 label·text를 escape한다. script 입력은 실행 없이 거절된다.
  - 블록 틀: 제목·출처·관측 시각·내용 또는 실패 이유·[Save as document](visuals 저장 contract), 저장 뒤 고정 문서 링크. 문서 블록은 T33 view로 연다.
  - loading·error·empty·접근 불가는 다른 블록과 입력을 막지 않는 그 자리 상태. focus와 읽던 위치를 지킨다.
  - flow view-agent-visuals의 표·차트·도표 갈래 화면. `registry_test`(script 거절)에 위 요구 테스트.

## context

### T36 contexts 화면

- 등급: frontend
- concern: shell/desktop, shell/editor, shell/wording
- 요구: shell/desktop#R28(contexts), shell/editor#R6(정보 패널 컨텍스트 탭), shell/wording#R13(Baseline·Reference·Follow changes)
- 자리: apps/shell/renderer/desktop/lophn-space/contexts/(list/, detail/, meanings/, watch/), apps/shell/renderer/editor/info-panel/contexts-tab.tsx
- 쓰는 contract: contracts#T21(context·term), documents#T22, T23, T24, T25, T26
- 내놓는 contract: 없음
- slice: context
- 선행: shell#T18, shell#T19, shell#T27, shell#T29, documents#T22, documents#T25
- documents#T26에서 넘어온 것: context export(`/v1/contexts/export`, JSON)를 사람이 저장할 때 Markdown으로 그려 내보낸다. contract는 JSON만 돌려준다(documents Q20, #278)
- shell#T21에서 넘어온 것: lophn 공간 팔레트의 Focus 행은 지금 contexts 형제 화면으로만 간다(`apps/shell/renderer/desktop/palette/lophn-scope.ts`의 context target). contexts 화면이 생기면 그 Focus 상세를 연다.
- 완료: 아래 확인이 통과한다
  - Focus(사람이 지은 이름과 목적), 기준·참고·watch 항목을 Baseline·Reference·Follow changes로 보인다. 근거와 부족한 자료는 펼친다.
  - watch의 확인된 변화·소실·미확인을 구별한다. 보관은 원자료 변경이 아니다.
  - Meaning: context별 사람 정의와 미정 후보, 출현 근거 최대 5개, 사람이 이름·뜻을 정하거나 미룸. 추천을 정의로 만들지 않는다.
  - 문서 정보 패널의 컨텍스트 탭에서 그 문서가 속한 Focus로 간다.
  - flow build-context, define-terms 화면(대화·질문·revert는 T27·T28·T29). 화면 테스트.

## apps

### T37 앱 view registry, scheme proxy, session, network 정책

- 상태: 완료 (#323) — 이어보냄: preload·IPC·`shell:view-state` 연결 → shell#T39, view 연결의 command 범위 → shell#T38, 앱 entrypoint의 화면 자원(`screenBytes`) → apps#T22. 진단 payload의 앱·release는 Q21
- 등급: 기본
- concern: shell/app-frame, shell/desktop
- 요구: shell/app-frame#R1(앱), R2, R3, R4, R8, R9, R11, R12, R16, R18, R19, R20, R22, shell/desktop#R13
- 자리: apps/shell/main/app-frame/(registry.ts, app-protocol.ts, app-connection.ts, session-policy.ts, network-policy.ts, diagnostics.ts)
- 쓰는 contract: contracts#T38(앱 화면 틀), contracts#T34(앱 통로 wire, `AppScreenRequest{screen, size, view_session}`), apps#T10(`POST /v1/apps/connect`), apps#T7(`/screens/…`, `/_lophn/commands/invoke`), apps#T4(network grant host), platform#T8(diagnostic 메시지)
- 내놓는 contract: 앱 화면 틀(contracts#T38 먼저)
- slice: apps
- 선행: shell#T2, shell#T3, shell#T33, contracts#T38, apps#T10, apps#T7
- 완료: 아래 확인이 통과한다
  - `appFrame.open({app, mode, release?, screen, size, parentWindow, bounds})`·`replace`·`close`. main이 앱 통로로 연결을 얻고 view에 묶는다. 페이지가 주장한 앱·release·actor는 쓰지 않는다.
  - `lophn-app://app-<ULID 소문자>/<screen>/…` 요청을 main의 Node client가 앱 socket(`socketPath`)으로 넘기고 응답을 stream으로 돌려준다. socket 경로·port·인증 header는 view와 preload에 없다. redirect·CSP·MIME 검사, 다른 연결로의 redirect 거절, 취소는 upstream도 중단.
  - partition `persist:app-<app>:live`, `persist:app-<app>:preview-<bundle hash>`. 앱·preview·문서·shell의 cookie·localStorage·IndexedDB·cache가 섞이지 않는다. release·연결·권한이 바뀌면 옛 view와 연결을 버리고 cache를 지운 뒤 다시 연다.
  - network 기본 차단, 자기 scheme과 apps/permissions의 fetch host만 통과(port·redirect·WebSocket·subframe 포함). 새 창·camera·location·download·scheme 밖 탐색 거절.
  - view 생성·교체·숨김·폐기·실제 attach를 같은 view_session과 generation으로 core 감독 통로의 diagnostic 메시지(platform#T8)에 남긴다(query·본문·token 없음).
  - 앱 UI 코드를 shell renderer에 import하지 않는다. view가 있다고 권한이 생기지 않는다.
  - `registry_test`, `app-protocol_test`, `network-policy_test`와 `e2e/shell/app-isolation_test.ts`(앱 사이·preview 사이 저장 교차 읽기 실패, 미부여 host 차단)에 위 요구 테스트.
- 가져올 것: legacy `views.ts`의 `#appSession` 분리 원리. 앱 resolver·socket grant·capture lease·receipt 계약은 가져오지 않는다.

### T38 앱 preload: command 호출, 외부 링크, view 예외 전달

- 상태: 완료 (#334) — 이어보냄: main 조립의 blueprint read(`/v1/apps/blueprint`)·confirm gate → shell#T45, view 오류의 collector view binding 통로와 main.ts `viewErrors.send` 연결 → problems#T16, SDK 루트 render 오류 event → shell#T40, 화면 검사 host의 view 오류 관측 → shell#T46. 자리와 판단은 Q22
- 등급: 기본
- concern: shell/app-frame
- 요구: shell/app-frame#R5, R6, R13, R15, problems/reporting#R5, R6(view 예외 귀속)
- 자리: apps/shell/preload/app.ts, apps/shell/main/app-frame/(app-call.ts, external-link.ts, view-error.ts)
- 쓰는 contract: contracts#T38(`lophnApp` bridge), apps#T7(`/_lophn/commands/invoke`), apps#T12(confirm의 accept_confirm·proof), contracts#T39(문제 보고), problems#T3(collector `POST /v1/problems/observe-exception`)
- 내놓는 contract: 앱 preload bridge(contracts#T38 먼저)
- slice: apps
- 선행: shell#T37, apps#T12, problems#T3
- 완료: 아래 확인이 통과한다
  - 앱 preload는 `lophnApp.call(command, input)`과 `lophnApp.openExternal(url)`만 공개한다. 별도 query API, 다른 앱 호출, shell API, token, 임의 method·경로·파일 접근은 없다.
  - `app:call`은 main이 실제 view의 앱·release·mode·연결과 blueprint schema를 검사해 고정 socket의 `/_lophn/commands/invoke`로 보낸다. 일반 읽기는 ledger 기록을 기다리지 않는다. confirm command는 approval(T44의 confirmation)로 간다.
  - 외부 링크: HTTP·HTTPS, userinfo 없음, 8,192자 이하만 확인 없이 OS browser로 연다(live·preview 같음). view 안에서는 열지 않는다. 기록에는 origin·path만.
  - `app:view-error`: main이 view registry의 `{view_session, generation, app, release, mode, binding}`을 붙여 인증된 client로 collector에 보낸다. 페이지가 주장한 값은 버린다.
  - `app-call_test`, `external-link_test`(8,193자·다른 scheme·userinfo 거절), `view-error_test`에 위 요구 테스트.
- 가져올 것: legacy `preload/app-preload.ts`의 contextBridge 모양, `security.ts`의 외부 URL 검사 원리. `lophnApp.action`·permit 계약은 가져오지 않는다.
- shell#T37에서 넘어온 것: view 연결은 지금 화면만 열려고 `commands: []`로 얻는다(`main/app-frame/app-connection.ts`의 `connect`). `app:call`은 그 view의 blueprint command를 연결 범위에 넣어 얻어야 한다(core는 요청한 것 중 프로세스가 등록한 command만 넣는다). 인증 header·endpoint는 registry entry의 `binding`에 있고 view·preload에는 없다. 연결 만료·회수는 registry의 `refresh`가 다시 얻는다

### T39 native view 배치: 동시 표시, focus, bounds, 좁은 창

- 등급: 기본
- concern: shell/app-frame
- 요구: shell/app-frame#R25, R26(좁은 창 bounds), R27, R28, R29(탭 전환 때 옛 view 먼저 숨김), R35, R36
- 자리: apps/shell/main/app-frame/visibility.ts, apps/shell/renderer/app-frame/(embedded-view.tsx, bounds.ts)
- 쓰는 contract: 없음(T37의 registry)
- 내놓는 contract: 없음
- slice: apps
- 선행: shell#T10, shell#T14, shell#T37
- 완료: 아래 확인이 통과한다
  - renderer가 ResizeObserver로 칸·카드의 사각형을 보내고 붙이기·숨기기·폐기는 main 한 모듈만 한다. 창 본문·칸·카드 경계와 교차를 검사하고 view가 경계 밖에 보이는 frame이 없다. 스크롤 밖 카드는 떼어 낸다.
  - 프로젝트 두 칸에 보이는 native view를 동시에 붙이고 키보드 focus는 한 view 또는 shell에만 둔다. 다른 공간으로 가면 그 공간에서 안 보이는 view만 숨긴다.
  - 탭 전환은 옛 view를 먼저 숨기고 새 view가 준비되면 붙인다. T10 pointer DTO로 갱신된 T14 pane·sidebar layout과 resize를 받아 실제 앱 native view의 bounds 적용을 16ms마다 한 번으로 묶는다.
  - 좁은 창에서 대화·정보 패널·운영 패널이 본문을 덮으면 앱 view를 숨기지 않고 덮이지 않는 영역으로 bounds를 줄인다. 닫으면 원래 bounds.
  - 앱 view는 배정된 경계 안에서 자기 페이지 머리부터 그리고 바깥 크롬은 shell이 그린다.
  - apps#T16에서 넘어온 것: view를 폐기하거나 교체할 때 옛 `view_session`이 닫혔음을 앱 runtime에 알린다. runtime 쪽은 끝났다(`POST /_lophn/control/view-closed {process_nonce, view_session}`, 플랫폼 machine 연결만 부른다). shell은 machine 연결이 없으므로 폐기 → core(apps control 어댑터가 그 앱의 현재 live nonce로 중계하는 command) → 앱 순서로 보낸다. 그 command의 contract는 contracts 팀에 먼저 요청한다. 이것이 오기 전에는 앱이 닫힌 view의 context를 내보낼 수 있다(shell#T37의 registry가 view를 닫은 뒤에도)
  - `visibility_test`와 `e2e/shell/native-view_test.ts`(두 view 동시 표시, drag 중 view가 보임, 전환 중 겹친 frame 없음, 1024px 미만 bounds 축소)에 위 요구 테스트.
- 가져올 것: legacy `views.ts`의 `#mount`·`setBounds`·`toDip`·latest requested bounds 처리, `renderer/src/shell/EmbeddedView.tsx`의 ResizeObserver+rAF.
- shell#T37에서 넘어온 것: main.ts에 `appFrame`(`main/app-frame/registry.ts`의 `createAppFrame`)이 조립돼 있다. shell preload의 `openApp`·`setViewBounds`·`setViewsHidden`·`closeView`와 IPC(`shell:view-open-app` 등, sender 검사)를 registry의 `open`·`setBounds`·`hide`·`close`·`state`에 잇고 `shell:view-state` push를 더한다. 붙이기는 `electron-app-frame.ts`가 하고 붙일 때 overlay를 맨 위로 다시 둔다(`electronOverlays().raise`). `setBounds`는 실제 attach일 때만 generation을 올리고 진단을 남긴다

### T40 SDK UI: ui-control, ui-overlay, ui-layout, ui-state

- 상태: 완료 (#343) — 이어보냄: 설치 사본·템플릿 화면 build가 ui-*의 `@lophn/design`·`@lophn/wording` import를 푸는 일 → apps#T22
- 등급: frontend
- concern: shell/design-system
- 요구: apps/sdk#R4(ui-control·ui-overlay·ui-layout·ui-state 1.0.0), R14, R15, R18(ui-state), R21, R29(AppErrorBoundary component), R37, R41(공용 UI SDK)
- 자리: packages/sdk/ui-control/, packages/sdk/ui-overlay/, packages/sdk/ui-layout/, packages/sdk/ui-state/
- 쓰는 contract: contracts#T38(`lophnApp` bridge 타입은 SDK 쪽 사본으로 두고 contracts를 import하지 않는다), problems의 view error 경로(T38)
- 내놓는 contract: @lophn/ui-control, @lophn/ui-overlay, @lophn/ui-layout, @lophn/ui-state 1.0.0
- slice: apps
- 선행: shell#T8, shell#T11, shell#T12, shell#T38
- 완료: 아래 확인이 통과한다
  - ui-control: 28·32·36px 버튼·입력·선택·체크박스·스위치·키 표시. ui-overlay: tooltip·popover·메뉴·dialog·toast·palette(앱 안에서는 앱 view 안에 그린다). ui-layout: 앱 shell·tab·sidebar·grid·card·5가지 페이지 틀, container 크기 반응(패널 320px·카드 240px부터 가로 scroll 없음). ui-state: loading·empty·error·freshness와 AppErrorBoundary(root 오류를 app preload의 오류 수집으로 넘김).
  - shell 화면이 같은 package를 쓴다(첫 소비자). 고정 문구는 wording key·en·ICU·Intl을 쓰고 package의 문구 검사를 기본 test에 잇는다. message key와 command·screen key를 섞지 않는다.
  - 예제와 package 옆 테스트. apps#T22·T23–T26보다 먼저 main에 들어간다.
- 가져올 것: legacy `ui-control`, `ui-overlay`, `ui-layout`, `ui-state`(presented.ts, reportError.ts 빼고).
- shell#T38에서 넘어온 것: 앱 preload는 main world에서 `lophn:render-error` DOM event(`detail: {name, message}`)를 `render_error`로 view 오류 통로에 보낸다(`apps/shell/preload/app-api.ts`의 `RENDER_ERROR_EVENT`·`watchMainWorldErrors`). ui-state의 AppErrorBoundary는 루트 render 오류를 잡으면 이 event를 `window`에 dispatch한다. `lophnApp`에 새 이름을 더하지 않는다(Q22)
- 정한 것: 네 package는 lophn 화면과 같은 packages/design component를 다시 내보내고(R21) 새로 짠 것은 ui-layout의 `AppShell`·`Sidebar`·`Grid`·`containerSpace`, ui-overlay의 `ToastProvider`·`useToast`, ui-state의 `ReadState`·`AppErrorBoundary`다. 패널·카드 최소 폭은 token `layout.container`(320·240px)로 두고, 칸 640px 미만에서 design의 `ListDetailFrame`은 `active` 한 쪽과 [Back](`onBack`), `DashboardFrame`은 한 줄 한 칸, 탭 줄은 가로 scroll, toast 쌓임은 view 폭 안으로 바꿨다. `Checkbox`·`Switch`에 `size`(28·32·36px)를 더했다. AppErrorBoundary는 `document.defaultView`에 event를 보내고 화면에는 `common.error.show-failed`와 [Try again]만 둔다. shell 첫 소비자는 overlay surface(ui-overlay·ui-control), 연결 상태(ui-control·ui-state), 시리즈 등록 폼(ui-layout·ui-control)이다

### T41 SDK UI: ui-reading, ui-filter, ui-stat, ui-action

- 등급: frontend
- concern: shell/design-system
- 요구: apps/sdk#R4(ui-reading·ui-filter·ui-stat·ui-action 1.0.0), R16(ui-reading), R18(ui-filter·ui-stat), R19, R41(공용 UI SDK)
- 자리: packages/sdk/ui-reading/, packages/sdk/ui-filter/, packages/sdk/ui-stat/, packages/sdk/ui-action/
- 쓰는 contract: @lophn/blueprint 1.0.0(apps#T2, peer import)
- 내놓는 contract: @lophn/ui-reading, @lophn/ui-filter, @lophn/ui-stat, @lophn/ui-action 1.0.0
- slice: apps
- 선행: shell#T12, shell#T40, apps#T2
- 완료: 아래 확인이 통과한다
  - ui-reading: Markdown·목차 tree·code block·문서 주소 표시. ui-filter: 기간·다중 선택·검색. ui-stat: 수치·변화량. ui-action: 명령 버튼과 확인 표시, blueprint의 사람 확인 선언(confirm)을 따르고 확인 호출은 `lophnApp.call`로만.
  - 예제, package 옆 테스트. apps#T23–T26보다 먼저 main에 들어간다.
- 가져올 것: legacy `ui-reading`, `ui-filter`, `ui-stat`, `ui-action`의 버튼 pending·error 표현만(구 invoker 계약은 빼고).

### T42 app-space 화면과 apps 화면

- 등급: frontend
- concern: shell/app-frame, shell/desktop, shell/wording
- 요구: shell/app-frame#R26(운영 패널 720px), shell/desktop#R27, shell/wording#R4
- 자리: apps/shell/renderer/app-frame/(app-space.tsx, app-bar.tsx, ops-panel-frame.tsx), apps/shell/renderer/desktop/lophn-space/apps/
- 쓰는 contract: contracts#T20(App 등록·실행 상태), apps#T9(실행 상태), apps#T1(이름·보관)
- 내놓는 contract: 없음
- slice: apps
- 선행: shell#T37, shell#T39, apps#T9
- shell#T28에서 넘어온 것: 앱 공간 바의 lophn 크롬은 `apps/shell/renderer/desktop/notification-chip/space-decisions.tsx`의 `SpaceDecisions`(place `{kind: "app", id}`, 열기는 things-to-confirm)를 둔다. 프로젝트 작업대 바에는 T28에서 두었다
- shell#T21에서 넘어온 것: lophn 공간 팔레트의 앱 행은 지금 apps 형제 화면으로만 간다(`apps/shell/renderer/desktop/palette/lophn-scope.ts`의 app target). 앱 공간이 생기면 그 앱 공간으로 간다.
- shell#T47에서 넘어온 것: 앱 공간 바(또는 운영 패널)에 [Open in new window]와 OS 바로가기 추가·제거를 둔다. 새 창은 main의 `appWindows.open(app)`(`main/desktop/app-window.ts`)을, 바로가기는 `installOsEntry`·`removeOsEntry`(`main/desktop/os-entry/entry.ts`)를 sender 검사한 IPC로 부른다. renderer는 앱 ID만 보내고 이름은 main이 `apps/get`으로 읽는다. 실제 writer(`EntryFiles`의 원자 쓰기·mode, macOS 폴더 제거, Windows `shell.writeShortcutLink`)와 `OsEntryEnv`(XDG_DATA_HOME, APPDATA, home) 조립은 main.ts에 아직 없다. headless와 개발 실행은 쓰지 않는다
- shell#T27에서 넘어온 것: 앱 공간 바의 대화 도크 토글(`DockToggle`)과 본문 오른쪽 `DockSlot`(새 세션 작업 자리 `{kind: "app"}`). 도크가 앱 view를 덮거나 밀 때의 native bounds는 T39를 따른다
- 완료: 아래 확인이 통과한다
  - 앱 공간은 얇은 바와 앱 view 전체 본문. 바에 런처 복귀, 앱 이름·연결 상태, [Report a problem] 자리(T52), 운영 패널 진입, 문서 작업대 전환. 운영 패널 720px, 1024px 미만이면 overlay이되 앱 view는 남은 영역으로 줄어든다.
  - 프로젝트·앱 공간의 lophn 크롬은 그 앱의 결정 대기와 daemon 장애 안내만.
  - lophn 공간 apps 화면: 사람이 지은 이름, 상태, 보관, 이름 바꾸기. 원시 enum·ID 없음.
  - 화면 테스트.
- 후속: 앱 이름 변경 command app.rename(#354). apps 화면의 행 동작은 이 command를 부른다.
- 가져올 것: legacy `spaces/AppSpace.tsx`의 얇은 chrome 배치, `screens/Apps.tsx`.

### T43 app-detail: Version, Access, Automations, Connections, Activity, Data

- 등급: frontend
- concern: shell/desktop, shell/wording
- 요구: shell/wording#R4, R10, R12
- 자리: apps/shell/renderer/app-frame/app-detail/(versions/, access/, automations/, connections/, activity/, data/)
- 쓰는 contract: apps#T19(release list·get·compare), apps#T18(activation 진행), apps#T4(grants.list), apps#T20(automations), apps#T15(앱 쌍 연결), apps#T11(invocation read), apps#T28(앱 export)
- 내놓는 contract: 없음
- slice: apps
- 선행: shell#T42, apps#T19, apps#T4, apps#T20
- 완료: 아래 확인이 통과한다
  - Version(release는 화면에서 Version): 현재·다른 version, 바뀐 것의 요약, 그 version의 실제 Test result(당시 테스트는 지금 앱의 증명이 아님), 운영과 분리된 preview 열기(preview partition의 앱 view), 고르기는 confirmation window(T45). 준비·적용·시작 확인·ticket 확인을 서로 다른 결과로 보인다.
  - Access(grant): 이 앱이 읽을 수 있는 파일·보낼 수 있는 host·쓰는 secret 이름, 조합 경고, 바꾸기는 confirmation window. 회수 요청 접수와 실제 정리(프로세스 종료·재시작, secret 참조 차단·OS 값 삭제)를 구별해 보인다.
  - Automations: 선언(command, 고정 입력, 주기), 켜기는 confirmation window(승인되면 grant `automation.run`), 끄기는 확인 창 없이 grant.revoke, 지난 실행.
  - Connections(다른 앱 command), Activity(invocation은 기본에서 숨기고 펼치면 Activity), Data(export).
  - app [Instructions] 진입(T32), Issues·Tasks 탭 자리(T53, T50).
  - flow change-app, restore-app-release, run-app-automation, manage-app-permissions, connect-apps, use-app-command(app-detail 쪽) 화면. 화면 테스트.

### T44 앱 패널 탭과 세션 앱 카드

- 등급: frontend
- concern: shell/workspace, shell/app-frame
- 요구: shell/workspace#R5, R11, shell/app-frame#R33, R34(패널·카드 크롬), R35
- 자리: apps/shell/renderer/workspace/app-panel-tab.tsx, apps/shell/renderer/workspace/visuals/app-card-block.tsx, apps/shell/main/workspace/app-view-context.ts
- 쓰는 contract: apps#T2·T19(blueprint screens[].sizes), apps#T16(agent-context는 앱의 일반 command), contracts#T30(VisualBlock 앱 카드), lophn-agent#T47(앱 카드 블록)
- 내놓는 contract: 없음
- slice: apps
- 선행: shell#T35, shell#T37, shell#T39
- shell#T35에서 넘어온 것: 세션 앱 카드 갈래. 블록 틀(`workspace/visuals/block-frame.tsx`)은 `app_card` 블록을 검사한 뒤 지금 설명·출처와 "App cards can't be shown in the conversation yet."만 둔다(`data-visual-app-card`). `app-card-block.tsx`가 그 자리를 앱 frame 카드로 바꾼다. registry(`registry.ts`의 `AppCardContent`)는 app·release·view만 옮기고 카드 입력(`input`)은 버린다. 카드가 입력을 쓰면 registry가 그 값을 옮기게 고친다(그리지 않고 앱 view 계약에 넘길 값이다). 저장된 release가 지금과 다르면 `contract_changed`, 사라지면 `unavailable`이고 다른 release로 바꾸지 않는다(lophn-agent/visuals domain model). 카드 블록도 [Save as document]가 있다(agent 준비에서 snapshot은 지금 unavailable, lophn-agent#T47).
- 완료: 아래 확인이 통과한다
  - blueprint가 panel 크기를 선언한 screen만 프로젝트 탭에 연다. 아니면 앱 공간으로 열기를 안내하고 조용히 줄이지 않는다. 카드도 card 크기 선언만.
  - 패널·카드는 전체 앱 view와 같은 앱·release·mode 신원과 session·scheme·preload·network 격리. size class는 screen 요청에, 폭·높이는 앱이 viewport에서 읽는다.
  - 패널·카드마다 앱 이름·모드·연결 상태와 그 view에 묶인 [Report a problem]을 shell 크롬에 둔다.
  - 앱 탭의 현재 보기 상태는 app·release·mode·screen 참조만. 상세 상태·힌트·주석은 앱이 선언한 command로만. DOM·screenshot을 보내지 않는다.
  - 카드는 message·block 표시 참조와 generation에 묶이고 보이는 사각형만 main에 보낸다. 카드를 열어도 command 권한이 늘지 않는다.
  - flow view-agent-visuals의 앱 카드 갈래, project-workspace의 앱 패널 단계, ask-app-hint 화면. `e2e/shell/app-card_test.ts`(카드 scroll bounds).

### T45 confirmation window: 앱 결정 4종

- 등급: frontend
- concern: shell/confirmation-window
- 요구: shell/confirmation-window#R8, R10
- 자리: apps/shell/renderer/confirmation/kinds/(release-activation/, grant/, confirm-command/, automation/), apps/shell/main/confirmation/kinds/apps.ts
- 쓰는 contract: apps#T19(`/v1/releases/compare`, `/v1/apps/blueprint`), apps#T4(`/v1/grants/list`), apps#T20(`/v1/apps/automations`), apps#T18(start_activation), apps#T12(accept_confirm), contracts#T37(grant), apps/preview(안전 preview가 있을 때)
- 내놓는 contract: 없음
- slice: apps
- 선행: shell#T23, shell#T29, apps#T19, apps#T4, apps#T20
- 완료: 아래 확인이 통과한다
  - 넷 다 platform approval request로 오고 main이 apps read를 독립 재조회해 표시한다. 결정은 approvals 결정 command에 handle·CAS를 붙인다.
  - release activation: 바뀐 화면·command 입력·effect·confirm·automation·permission 추가/축소·data change와 손실, "검토 필요" 표시.
  - grant: 경로·host·port·secret 이름 원문 전체를 고정폭으로, 줄이지 않는다. fs.read+net.fetch 조합 경고와 Deno 한계 문구(apps 소유 key). 앱 쌍 연결(부르는 앱 → 대상 앱의 방향·command 범위)도 이 종류로 보인다(flow connect-apps).
  - confirm command: label·설명·effect·revert와 정규 입력. diff로 못 보이는 동작은 현재·바뀐 뒤 설명을 세로로, 안전 preview는 apps/preview 결과로만, 없으면 없다고.
  - automation 켜기: command·고정 입력·주기를 한 번 승인하면 apps가 grant kind `automation.run`(automation key·command·input_hash·주기)을 만든다(grant.create). 끄기는 사람의 grant.revoke이고 확인 창이 없다(T43).
  - 종류별 테스트.
- shell#T38에서 넘어온 것: (1) main.ts의 `appCall`(`apps/shell/main/app-frame/app-call.ts`) `blueprint` source를 apps#T19의 `/v1/apps/blueprint`로 잇는다. 입력은 view의 app·release·mode·bundle_hash이고 같은 bundle은 app-call이 cache한다. 지금은 unavailable이라 실제 shell에서 `lophnApp.call`은 `unavailable: app is not available`이다. (2) confirm command의 `confirm` gate(`ConfirmGate`): app-call이 넘기는 view의 app·release·process nonce, 검사·default 적용한 정규 입력과 `input_hash`로 approval request(concern `apps/invocations`, command `invocation.accept_confirm`, requester user, caller direct)를 만들고 confirm-command 종류의 confirmation window로 사람 결정을 받은 뒤 accept_confirm의 서명 proof envelope `{payload, signature}`를 돌려준다. 거절·만료·취소는 실패로 돌려주고 app-call은 앱을 부르지 않는다. 지금 main은 unavailable이다. release 없는 preview의 confirm은 accept_confirm 입력에 release가 있어야 해서 받을 수 없다고 답한다
- shell#T47에서 넘어온 것: main.ts `appWindows`의 `entryScreen`(앱 전용 창에 여는 screen)을 같은 `/v1/apps/blueprint` read로 잇는다. 그 release blueprint가 `sizes`에 `full`을 선언한 첫 screen이다. 지금은 unavailable이라 실제 shell에서 `--open-app`은 전용 창 대신 가장 최근 창을 앞으로 가져온다

### T46 앱 화면 검사 host

- 등급: 기본
- concern: shell/app-frame
- 요구: problems/tests#R7(view 예외·깨진 view의 feedback 화면 검사), R19(관측 private IPC)
- 자리: apps/shell/main/app-frame/screen-test-host.ts, apps/shell/main/entry-screen-test.ts
- 쓰는 contract: contracts#T38(화면 검사 host 입력·관측 타입과 설치 경로 규칙, contracts에 요청함)
- 내놓는 contract: 앱 화면 검사 host(같은 Electron 실행 파일의 `--app-screen-test`)
- slice: apps
- 선행: shell#T37, shell#T38
- 완료: 아래 확인이 통과한다
  - `--app-screen-test`로 시작하면 사람 token·core 연결 없이 임시 userData, `app-test-<run>` 메모리 partition, offscreen rendering으로만 돈다. 창을 OS에 보이지 않는다.
  - 상속 pipe(fd 3)의 JSON lines로 입력(고정 bundle 화면 위치, screen key 목록, test용 앱 socket 경로, 기한)을 받고 관측(load 결과, error·unhandledrejection·루트 render 오류, 깨진 view에서 feedback binding·캡처·dialog 결과, 막힌 network 시도)을 돌려준다. stdout은 쓰지 않는다.
  - 운영 view session·credential·DB와 공유하지 않고 collector로 직접 보내지 않는다.
  - 상속 fd 3이 실제로 되는지 먼저 확인한다(Node 부모의 fd 3을 Deno 자식이 EBADF로 못 쓴 사례가 있다. 여기는 Deno 부모, Electron 자식이다). 안 되면 감독 통로와 같은 stdin·stdout 길이 prefix frame(contracts#T6 codec)으로 바꾸고 contracts 팀에 알린다.
  - `screen-test-host_test`와 problems#T11이 쓰는 fixture 하나로 확인한다.
- 가져올 것: legacy `app.ts`의 offscreen option 기록(hidden window는 첫 frame 뒤 capture가 멈춘다).
- shell#T38에서 넘어온 것: 앱 preload가 main world의 error·unhandledrejection·`lophn:render-error`를 내부 `app:view-error`로 보낸다(`apps/shell/preload/app-api.ts`). 화면 검사 host는 같은 preload를 쓰고 `registerAppIpc`(`main/app-frame/app-ipc.ts`)의 viewError를 collector 대신 관측 frame으로 바꿔 끼운다

### T47 앱 전용 창, OS 앱 바로가기, 창 열기 intent

- 등급: 기본
- concern: shell/desktop, shell/app-frame
- 요구: shell/desktop#R13(앱 전용 새 창), R14, shell/app-frame#R18
- 자리: apps/shell/main/desktop/(app-window.ts, os-entry/linux.ts, os-entry/macos.ts, os-entry/windows.ts, open-intent.ts)
- 쓰는 contract: contracts#T20(App), contracts#T13(`lophn://things-to-confirm/<id>` 링크 모양, contracts에 요청함)
- 내놓는 contract: 창 열기 intent `lophn-desktop --open-app <app ID>`, `lophn://things-to-confirm/<id>`
- slice: apps
- 선행: shell#T2, shell#T37
- 완료: 아래 확인이 통과한다
  - 앱 전용 새 창은 본문 view와 같은 session·scheme·preload 경계를 쓴다.
  - Linux `.desktop`, macOS app bundle, Windows shortcut은 고정 앱 ID를 `--open-app` intent로만 넘긴다. 앱 코드·source path·token·port를 실행하지 않는다.
  - `lophn://things-to-confirm/<id>`는 OS URL scheme으로 등록하고 single instance로 받아 엄격히 parse한 뒤 그 대상 화면을 창에 연다. confirmation window를 자동으로 띄우지 않는다(사람이 그 화면에서 누를 때 그 창을 부모로 연다).
  - `open-intent_test`, `os-entry_test`와 세 표시 방식에서 같은 격리 spec(`e2e/shell/app-isolation_test.ts` 확장).
- 정한 것: (1) 앱 전용 창(`main/desktop/app-window.ts`)은 시스템 제목 표시줄이 있는 빈 BrowserWindow(preload 없음)이고 본문 전체를 앱 view 하나가 채운다. view는 본문 view와 같은 `appFrame`·`electronAppViews`로 열어 session·scheme·preload가 같다. main이 `apps/get`으로 보관되지 않았고 채택된 release가 있는지 보고 그 release를 live·full로 연다. 앱 하나에 전용 창은 하나이고 다시 요청하면 그 창을 앞으로 가져온다. 열지 못하면 창을 남기지 않고 가장 최근 창(없으면 새 기본 창)을 앞으로 가져온다. 전용 창은 shell 창이 아니라 shortcut·intent·core 상태를 받지 않는다. (2) 창 열기 intent(`main/desktop/open-intent.ts`)는 `--quit`, 정확히 한 번의 `--open-app <app ID>`(바로 뒤 값만, `=` 형식 거절), 정확히 하나의 `lophn://things-to-confirm/<apr|qst ID>`만 읽고 나머지·둘이 섞인 것은 기본 창이다. 첫 시작 argv, second-instance argv, macOS `open-url`이 같은 parser를 쓴다. node test가 zod를 풀지 못해 contracts/shell/launch.ts와 같은 모양을 정규식으로 본다. URL scheme은 packaged·headless 아님일 때만 `setAsDefaultProtocolClient("lophn")`로 등록한다. (3) 링크는 shell renderer에 `{kind: "things-to-confirm", request}` intent로 가 그 요청을 고른 things-to-confirm을 열 뿐이고 결정 창은 사람이 [Review]를 누를 때 그 창을 부모로 연다. (4) OS 바로가기(`main/desktop/os-entry/`)는 packaged 실행 파일의 검증된 경로(autostart와 같은 검사에 shell 특수 글자 거절)와 `--open-app <app ID>`만 담는다. 자리는 앱 ID로 정한다: Linux `$XDG_DATA_HOME/applications/lophn-<app>.desktop`, macOS `~/Applications/lophn-<app>.app`(Info.plist와 exec 두 줄 script, LSUIElement), Windows 시작 메뉴 `lophn\lophn-<app>.lnk`(`shell.writeShortcutLink`). headless·개발 실행은 쓰지 않는다
- 상태: 완료 (#344) — 이어보냄: 등록 버튼·IPC와 실제 writer → shell#T42, 전용 창 screen의 blueprint read → shell#T45, 설치 묶음의 lophn scheme 등록 → shell#T57

### T48 깨진 앱 격리 확인

- 등급: 기본
- concern: shell/app-frame
- 요구: shell/app-frame#R21, R32(깨진 view에서도 크롬 동작)
- 자리: e2e/shell/broken-app_test.ts, apps/shell/main/app-frame/crash.ts
- 쓰는 contract: apps#T26(일부러 깨지는 fixture 앱)
- 내놓는 contract: 없음
- slice: apps
- 선행: shell#T37, shell#T39, shell#T42, apps#T26
- 완료: 아래 확인이 통과한다
  - 앱 UI의 무한 loop, 큰 렌더링, crash에서 shell 크롬·다른 탭·다른 앱을 조작한다. platform/responsiveness 기준(shell 첫 반응 p95 100ms)을 잰다. WebContents 분리만으로 자원 격리 완료라고 표시하지 않는다.
  - crash·멈춤에 연결 상태를 보이고 자동 재호출 없이 현재 연결로 새 view를 여는 행동을 준다.

## coding-agent

### T49 ticket [Start]: coding TUI 시작과 관측

- 등급: 기본
- concern: shell/terminal
- 요구: shell/terminal#R4(coding TUI), R5(coding TUI credential), R12, R13
- 자리: apps/shell/main/terminal/coding-start.ts, apps/shell/terminal-host/(launch-plan.ts, prompt-delivery.ts, observe-socket.ts)
- 쓰는 contract: contracts#T42(CodingAgentLaunchPlan, human_start_handle, operation_id, HarnessSessionObservation), coding-agent#T38(`lophn session plan --json`), coding-agent#T39(관측), platform#T34(coding credential loader)
- 내놓는 contract: 없음
- slice: coding-agent
- 선행: shell#T24, shell#T25, coding-agent#T38, coding-agent#T39, platform#T34
- 완료: 아래 확인이 통과한다
  - 사람 클릭으로 main이 one-use human_start_handle과 operation_id를 만들고, core로 ticket·connection·등록 폴더를 다시 검사한 뒤 `lophn session plan --json`(child)으로 LaunchPlan을 받는다. 다른 harness·cwd로 대체하지 않는다.
  - host는 executable·분리 argv·cwd·env·credential handle로 shell 없이 PTY를 직접 연다. token 원문은 argv·prompt·PTY·출력·공통 환경에 없다. 일반 shell 환경은 그대로다.
  - prompt_delivery: argv면 할 일 없음, stdin_after_ready면 readiness를 최대 10,000ms 기다려 정확히 한 번 쓰고 delivered·not_delivered·unknown. 재전송·재spawn·resume 없음. 같은 operation_id는 같은 runtime_ref.
  - 관측 socket: lophn이 연 TUI마다 host가 0700 폴더의 무작위 Unix socket(Windows named pipe)을 만들고 `LOPHN_TERMINAL_OBSERVE`로 그 경로만 준다. host가 자기 runtime_ref·generation을 붙이고 payload의 주장은 쓰지 않는다. 끝나면 지운다. Electron 재시작 뒤는 unknown이고 자동 spawn·resume이 없다.
  - `coding-start_test`, `prompt-delivery_test`, `observe-socket_test`에 위 요구 테스트.

### T50 Connection 화면과 Tasks

- 등급: frontend
- concern: shell/desktop
- 요구: shell/desktop#R19(고정 연결 intent 검증)
- 자리: apps/shell/renderer/desktop/lophn-space/settings/connections/, apps/shell/renderer/app-frame/app-detail/tasks/, apps/shell/main/desktop/coding-connection.ts
- 쓰는 contract: contracts#T41(connection·ticket), contracts#T43(CLI 출력), coding-agent#T27(사람 화면 ticket read), coding-agent#T36(연결 생성·설치), coding-agent#T40(회수)
- 내놓는 contract: 없음
- slice: coding-agent
- 선행: shell#T29, shell#T43, shell#T49, coding-agent#T27, coding-agent#T36, coding-agent#T40
- 완료: 아래 확인이 통과한다
  - Connection: 감지된 harness(예: "Claude Code")를 고르기만 한다. renderer는 "이 harness로 연결" 고정 intent만 보내고 main이 따로 검증한다. main이 `lophn harness detect|refresh|install --json`, `lophn doctor --json`을 child로 부른다(refresh는 사람 클릭만). 감지 기록·MCP·skill 위치는 펼친 자리에만. 회수만 confirmation window.
  - Tasks(ticket): 목록·상세, 상태, 복사할 요청 문장, [Start](누르는 것이 허락, 확인 창 없음, 등록 project 폴더가 여럿이면 고른 뒤 누른다), TUI 상태(starting/ready/working/waiting_input/ended/unknown)를 Task 상태와 구별. 한 줄 사유로 취소, claim이 풀린 일을 다시 맡기기, 완료 주장과 실제 검사(통과·실패·미확인)와 남은 확인을 구별한다.
  - coding-agent#T27이 내놓는 화면 상태 값(여섯 상태와 readiness)과 다음 행동 값([Start] 가능, 확인 필요, 결과 확인, 승인 대기)을 shell이 en wording key로 바꾼다. claim·기한·connection ID는 기본 화면에 없다(coding-agent/tickets#R27).
  - flow connect-coding-agent, manage-coding-access, start-coding-agent, manage-tickets 화면. 화면 테스트.

### T51 창 없는 시작과 종료 intent

- 상태: 완료 (#140)
- 등급: 기본
- concern: shell/desktop
- 요구: shell/desktop#R21(창 없는 tray mode, 명시 중지)
- 자리: apps/shell/main/desktop/(launch-mode.ts, quit.ts), apps/shell/main/desktop/single-instance.ts
- 쓰는 contract: contracts#T6(감독 통로 종료 순서), platform#T55(`lophn daemon start|stop`이 부르는 모양)
- 내놓는 contract: Electron 실행 intent `--tray`(창 없이 main과 core만), second-instance 종료 요청 `--quit`
- slice: coding-agent
- 선행: shell#T3
- 완료: 아래 확인이 통과한다
  - `--tray`로 시작하면 main이 core만 띄우고 창을 열지 않는다. 같은 데이터 root에 이미 main이 있으면 두 번째 instance를 열지 않고 실행 중이라고 알린 뒤 끝난다.
  - 실행 중인 main에 second-instance argv `--quit`이 오면 진행 중 터미널·저장을 확인할 창이 없을 때는 그 사실을 log에 남기고 core 정상 종료 순서를 밟는다. 창이 있으면 T55의 끄기 확인과 같은 경로를 쓴다.
  - argv의 다른 값은 실행하지 않는다.
  - `launch-mode_test`, `quit_test`에 위 요구 테스트. platform#T55의 선행.

## problems

### T52 문제 알리기

- 등급: frontend
- concern: shell/app-frame, shell/wording
- 요구: shell/app-frame#R31, R32, R34(버튼이 그 view에 묶임), shell/wording#R8, R9, problems/feedback#R5, R6, R10, R11, R12, R13
- 자리: apps/shell/main/app-frame/feedback.ts, apps/shell/renderer/overlay/feedback/, apps/shell/renderer/app-frame/report-button.tsx
- 쓰는 contract: contracts#T38(feedback IPC), contracts#T39(문제 보고), problems#T15(submit-feedback), contracts#T12(redaction)
- 내놓는 contract: 없음
- slice: problems
- 선행: shell#T10, shell#T37, shell#T42, shell#T44, problems#T15
- 완료: 아래 확인이 통과한다
  - [Report a problem]은 앱 공간 바·패널·카드의 독립 버튼이다. 누르면 main이 버튼 시점 `{view_session, generation, app, release, mode, screen path, observedAt}`를 고정하고 그 앱 view의 `capturePage`를 먼저 요청한 뒤 overlay에 dialog를 연다. 앱 view는 그대로 보인다. 앱 view가 가려졌거나 다른 창이면 캡처하지 않고 이유만 남긴다. 캡처는 1500ms까지, 늦으면 버린다.
  - capture한 PNG를 가리지 않고 그대로 dialog 미리보기에 보인다. 글·화면 상태·screenshot을 미리 보고 각각 뺄 수 있다. screenshot 기본은 꺼짐, 미리보기를 본 뒤 켬. 미선택·화면 없음·수집 실패·저장 실패의 이유를 보이고 첨부 없이 글만 보낼 수 있다.
  - 미제출·접수 대기·접수 완료를 구별하고, 실패에는 복사 가능한 글과 이유. 초안은 메모리에만. 취소는 저장하지 않고 이미 접수한 것은 닫아도 지우지 않는다. 기존 문제 선택 여부를 보이고 접수 뒤 묶인 Issue로 갈 수 있다.
  - 앱 view가 crash·무한 loop여도 버튼과 dialog가 동작한다. 안내에 stack·log·원문 오류가 없고 문제 문구는 problems가 정한 값 그대로.
  - contracts/problems 문구 상수 key를 wording 검사의 알려진 key로 잇는다.
  - `feedback_test`와 `e2e/shell/report-problem_test.ts`(깨진 view에서 dialog 열림, 캡처 동안 view가 보임)에 위 요구 테스트. problems#T23의 선행.

### T53 app-detail Issues: 문제, 수리 결과, 사람 결정

- 등급: frontend
- concern: shell/wording, shell/confirmation-window
- 요구: shell/wording#R5, R9
- 자리: apps/shell/renderer/app-frame/app-detail/issues/, apps/shell/renderer/confirmation/kinds/problem-decision/
- 쓰는 contract: contracts#T40(problem command·read), problems#T6(목록·상세), problems#T21(ApplyProblemDecision), problems#T22(수리·결과·닫힘 표시)
- 내놓는 contract: 없음
- slice: problems
- 선행: shell#T23, shell#T43, problems#T6, problems#T21
- 완료: 아래 확인이 통과한다
  - Issue 목록·상세: 사람이 겪는 영향 한 문장, 보고 수, 수리 주장과 실제 테스트·사람 확인("I checked")·미확인 범위를 구별한다. report·claim·snapshot은 이름으로 보이지 않는다(Details we collected).
  - 사람 결정(fixed, not fixed, not visible, dismiss + 한 줄 이유)은 confirmation window의 owner decision이다. main이 problem·basis_seq·release·last_report에 묶인 handle로 `ApplyProblemDecision`을 보낸다.
  - "직접 해 봤지만 안 됩니다"는 새 feedback(T52)으로 간다.
  - flow app-broken, verify-app-repair 화면. 화면 테스트.

## operator

### T54 Operator: 붙이기, Repeating check, 보고, 멈춤과 회수

- 등급: frontend
- concern: shell/desktop
- 요구: shell/desktop#R4(회수된 담당), R5
- 자리: apps/shell/renderer/desktop/lophn-space/roles/operator/, apps/shell/renderer/workspace/operator-entry.tsx
- 쓰는 contract: contracts#T27(preset·assignment), lophn-agent#T52(Operator 붙이기), lophn-agent#T9(멈춤·재개·회수)
- 내놓는 contract: 없음
- slice: operator
- 선행: shell#T29, shell#T30, lophn-agent#T52
- 완료: 아래 확인이 통과한다
  - Operator를 project나 app에 여럿 붙인다. Preset, 읽을 자료, 출력, 주기(Repeating check)를 정하고 붙이기는 confirmation window의 보호 승인이다.
  - 보고 결과는 roles의 만든 것에서 문서로 열고, 사람 결정이 필요한 질문만 things-to-confirm으로 간다.
  - 멈춤·다시 시작·회수, 회수된 담당은 지난 대화만. 답을 기다리는 동안 주기를 건너뛴 사실을 보인다.
  - flow set-up-operator, receive-operator-report, manage-operator 화면. 화면 테스트.

## operations

### T55 tray, 로그인 자동 시작, 종료

- 상태: 완료 (#233)
- 등급: 기본
- concern: shell/desktop
- 요구: shell/desktop#R11(tray·자동 시작), R21
- 자리: apps/shell/main/desktop/(tray.ts, autostart.ts, quit.ts)
- 쓰는 contract: contracts#T6(감독 pipe 종료), contracts#T45(install-and-update)
- 내놓는 contract: 없음
- slice: operations
- 선행: shell#T3, shell#T24, shell#T51
- 완료: 아래 확인이 통과한다
  - tray: 창 열기, 런처, Quit을 둔다. 모든 창을 닫아도 tray main과 그 아래 core가 남아 앱 automation과 주기 일이 계속된다. Quit은 진행 중 터미널·저장을 확인한 뒤 main과 core를 모두 멈춘다(Q1, lead 결정).
  - 로그인 자동 시작은 검증된 실행 경로와 `--tray`만 등록하고 창을 열지 않는다(Linux XDG autostart, 그 외 login item).
  - `tray_test`, `autostart_test`, `quit_test`에 위 요구 테스트. Q1 결정대로 shell/desktop#R21과 architecture/shell 2.1·OS 통합 절을 같은 PR에서 고친다.
- 가져올 것: legacy `app.ts`의 `#installTray`, `autostart.ts`.

### T56 OS notification과 전역 팔레트

- 상태: 완료 (#287) — 이어보냄: OS notification opt-in 켜고 끄는 화면 → shell#T58, OS 표시 경로를 쓰는 전달 실패 안내 → platform#T46. 막힌 것(Q17(6)): 제품 core가 platform notifications를 조립하지 않아 `NotificationCreated`가 오지 않는다(platform)
- 등급: 기본
- concern: shell/desktop
- 요구: shell/desktop#R7(놓친 notification 재생 없음), R10(OS 표시), R18(전역 CommandOrControl+Shift+K)
- 자리: apps/shell/main/desktop/(os-notification.ts, global-shortcut.ts)
- 쓰는 contract: contracts#T22(notification), contracts#T24(OS notification opt-in 설정), platform#T17
- 내놓는 contract: OS 표시 경로(platform#T46이 쓴다)
- slice: operations
- 선행: shell#T3, shell#T21, shell#T28
- 완료: 아래 확인이 통과한다
  - opt-in일 때만 지금 도착한 `NotificationCreated`를 제목 `lophn`, 본문 en key `Something needs your attention`으로 표시한다. 이름·내용·secret·원문 오류는 OS에 넘기지 않는다. 재연결 backlog는 표시하지 않고 표시 ID 중복을 메모리에서 막는다. 클릭은 해당 things-to-confirm·결과를 열 뿐 읽음·결정이 아니다. OS 실패는 그 기능만 안내하고 retry 루프가 없다.
  - 전역 팔레트 CommandOrControl+Shift+K는 창 안 팔레트와 다른 동작이다. 등록 실패는 사용 불가로 안내하고 다른 key를 차지하지 않는다. 종료 때 해제한다.
  - `os-notification_test`, `global-shortcut_test`에 위 요구 테스트. flow catch-up-notifications의 shell 쪽.
- 가져올 것: legacy `app.ts`의 `#installShortcut`.

### T57 Electron 패키징과 설치 실패 안내

- 등급: 기본
- concern: shell/desktop
- 요구: shell/desktop#R11(패키징), R12, R20(bundle된 Deno)
- 자리: apps/shell/main/electron-builder.yml, apps/shell/main/packaging/, apps/shell/main/scripts/stage.ts, apps/shell/renderer/desktop/launcher/start-failure/
- 쓰는 contract: contracts#T45(install-and-update), platform#T48·T49(설치 묶음)
- 내놓는 contract: shell build 산출물(platform#T48·T49가 묶는다)
- slice: operations
- 선행: shell#T3, shell#T24, shell#T47
- shell#T24에서 넘어온 것: Windows terminal child의 Job Object 종료 확인(POSIX group 종료와 fail-closed unknown은 #232)
- shell#T55에서 넘어온 것: tray 아이콘 `apps/shell/main/desktop/icon.png`를 packaged resources의 `icon.png`로 넣기, packaged Linux XDG autostart 실제 등록과 macOS·Windows login item(macOS `wasOpenedAtLogin` tray mode 포함)·tray의 실제 OS 확인(주입 adapter 단위 테스트와 개발 실행 Linux `--tray`·`--quit` smoke는 #233)
- shell#T47에서 넘어온 것: electron-builder `protocols`로 `lophn` URL scheme을 설치 묶음에 넣는다(Linux `.desktop`의 `MimeType=x-scheme-handler/lophn;`과 `%u`, macOS `CFBundleURLTypes`). main은 packaged 실행에서 `setAsDefaultProtocolClient("lophn")`도 부른다(`main/desktop/open-intent.ts`의 `registerUrlScheme`). packaged smoke에서 링크·`--open-app`이 실행 중 main의 second-instance로 들어와 앱 전용 창·things-to-confirm을 여는지 본다
- 완료: 아래 확인이 통과한다
  - electron-builder로 Linux .deb(먼저), macOS·Windows 설정. shell build, preload, renderer, 로컬 글꼴, 고정 의존성, bundle된 Deno, node-pty native 모듈을 staging에 넣는다. sandbox를 끄지 않는다(Ubuntu AppArmor userns는 chrome-sandbox 권한으로 맞추고 `--no-sandbox` 우회 없음).
  - packaged main은 bundle된 Deno로 core를 띄운다. 시작 실패·sandbox 실패·schema 비호환은 런처의 실패 갈래로 정상처럼 보이지 않게 안내하고 다음 행동 하나를 준다.
  - `stage_test`와 지원 OS의 packaged smoke(`e2e/shell/packaged_test.ts`)에 위 요구 테스트.
- 가져올 것: legacy `electron-builder.yml`, `packaging/linux/after-install.sh`의 chrome-sandbox 처리. 구 runtime payload·CLI/MCP 링크·afterPack은 가져오지 않는다.

### T58 settings: backup과 restore, update 안내, 진단, OS notification 선택

- 등급: frontend
- concern: shell/wording
- 요구: shell/wording#R5, R10
- 자리: apps/shell/renderer/desktop/lophn-space/settings/(backup/, update/, diagnostics/, notifications/)
- 쓰는 contract: contracts#T45(backup·diagnostics·install-and-update), contracts#T24(settings), contracts#T23(secret), platform#T41·T42(backup·restore), platform#T45(secret export·import), platform#T47(doctor), platform#T50(update)
- 내놓는 contract: 없음
- slice: operations
- 선행: shell#T31, platform#T41, platform#T50
- 완료: 아래 확인이 통과한다
  - backup: 복원 가능한 묶음·제외된 자료·다시 준비할 항목, 만들기·검증 결과·보존, restore는 잃을 최신 기록 범위를 보이는 confirmation window. 복원 성공·확인 못한 부분·다시 준비할 연결을 구별한다. credential 다시 준비와 secret의 암호 보호 export·import는 confirmation window의 secret 입력으로만(platform#T45). 앱별 export는 app-detail(T43).
  - update: 새 version·지원 OS·schema 호환·정상 정지·재시작 필요만 보인다. 자동 다운로드·설치·재시작 없음.
  - 진단: 보안 상태 점검과 doctor 결과는 영향 한 문장과 다음 행동, 원문은 개발자 diagnostics 펼침에만.
  - OS notification opt-in.
  - flow backup-and-restore, update-lophn 화면. 화면 테스트.

### T59 offline: provider 끊김과 core 끊김

- 등급: frontend
- concern: shell/desktop, shell/editor
- 요구: shell/desktop#R7, shell/editor#R12(연결 끊김)
- 자리: apps/shell/renderer/desktop/connection/, apps/shell/renderer/editor/save-status.tsx
- 쓰는 contract: contracts#T29(provider 상태), contracts#T6(platform/status)
- 내놓는 contract: 없음
- slice: operations
- 선행: shell#T17, shell#T27, shell#T31
- 완료: 아래 확인이 통과한다
  - provider 끊김에서는 로컬 문서·앱·터미널 작업을 그대로 두고 대화에만 필요한 행동 한 줄을 보인다(설정 도움·provider 연결로 잇는다).
  - core 끊김에서는 초안·마지막 read·터미널을 유지하고 새 파일 쓰기·결정 제출 gate를 닫으며 "최신 확인 못함"과 확인 시각을 보인다.
  - flow work-offline, install-lophn(실패 갈래) 화면에서 두 끊김 상태의 동작을 테스트한다.

## 요구 덮기

shell 최상위의 요구는 8개 leaf에 177개이고 모두 위 작업의 `요구:`에 들어 있다.

| concern | 요구 수 | 덮은 수 | 작업 |
|---|---|---|---|
| shell/desktop | 30 | 30 | T1–T3, T9, T13–T15, T19–T21, T27, T28, T30, T36, T37, T42, T47, T50, T51, T54–T57, T59, T61 |
| shell/workspace | 13 | 13 | T13, T14, T25–T27, T35, T44 |
| shell/terminal | 13 | 13 | T24, T25, T49 |
| shell/confirmation-window | 10 | 10 | T22, T23, T29, T45 |
| shell/app-frame | 36 | 36 | T2, T3, T10, T22, T31, T33, T37–T39, T42, T44, T47, T48, T52, T61 |
| shell/editor | 17 | 17 | T14, T16–T18, T32, T36, T59 |
| shell/wording | 14 | 14 | T6, T9, T15, T20, T23, T31, T36, T42, T43, T52, T53, T58 |
| shell/design-system | 44 | 44 | T4, T5, T8, T10–T12, T14, T28, T34, T61 |

다른 최상위의 요구 가운데 소유 팀과 합의해 shell 작업이 구현하는 것:

| 요구 | shell 작업 | 합의 |
|---|---|---|
| apps/sdk#R4(tokens·ui-*), R14–R21, R29(component), R37, R38, R41(공용 UI SDK) | T34, T40, T41 | apps 팀(나머지 R29·R41 템플릿 연결, R4 catalog는 apps) |
| problems/feedback#R5, R6, R10, R11, R12, R13 | T52 | problems 팀(접수·검증·redaction·snapshot은 problems#T15) |
| problems/reporting#R5, R6(view 예외 귀속) | T38 | problems 팀(collector는 problems#T3·T16) |
| problems/tests#R7(화면 검사), R19 | T46 | problems 팀(runner는 problems#T11) |
| lophn-agent/observability#R16, R17, R20, R21, R22(화면) | T30 | lophn-agent 팀 |

## 질문

- **Q1 Electron 종료와 core 수명(lead 결정).** core는 Electron main 아래에서 돈다. 창을 다 닫아도 tray main이 살아 있어 앱 automation과 주기 일은 계속되고, tray의 Quit은 전부 멈춘다. T55 PR에서 shell/desktop#R21과 architecture/shell을 고친다.
- **Q2 CLI의 daemon 시작과 중지(정함).** user token은 Electron main이 띄운 core의 통로로만 받는다. 그래서 `lophn daemon start|stop`(coding-agent/cli#R8, platform#T55)은 Electron main을 `--tray`로 띄우거나 `--quit`을 second-instance로 보낸다(T51). core는 언제나 main의 child다.
- **Q3 현재 보기 상태 relay(lead 승인).** shell main이 core 메모리 relay에 `CurrentViewState`를 publish하고 사람 요청 때 session↔window를 bind하며, runtime은 자기 run의 session만 읽는다. platform#T57이 route를 더하고 architecture/platform 5.1을 고친다.
- **Q4 앱 화면 검사 host(lead 결정, 추천대로).** problems 팀과 합의한 `--app-screen-test` host(T46)로 하고 shell requirements를 늘리지 않는다. T46 PR에서 architecture/shell 5.2에 한 단락을 더한다. fd 3 통로를 먼저 확인한다.
- **Q5 산점 차트와 node·edge 도표(정함).** apps 팀이 apps/sdk#R17에 산점 차트와 node·edge 도표를 더했고(누적 면만 첫 판 밖) shell#T34가 ui-chart에 만든다.
- **Q6 shell 크롬 외부 링크(lead가 다르게 정함).** 승인 원칙(D21)에 따라 shell 크롬의 외부 링크와 공식 로그인 버튼은 확인 없이 OS browser로 연다. T31 PR에서 shell/app-frame#R7을 고친다. confirmation window의 열기 종류에서 shell 외부 링크는 빠진다.
- **Q7 의존성(lead 승인).** electron, esbuild, react·react-dom, happy-dom, Radix Primitives, lucide-react, CodeMirror 6과 Lezer Markdown, @xterm/xterm, node-pty, d3-scale·d3-shape, intl-messageformat, stylelint, electron-builder. 각 작업 PR에서 판과 이유를 stack.md에 적는다. node-pty native rebuild는 T24에서 먼저 확인한다.
- **Q8 보호 창이 아닌 확인(lead 결정, 추천대로).** 살아 있는 터미널 닫기, 저장 안 된 초안 버리기는 shell overlay dialog로 묻는다.
- **Q9 project-workspace flow의 앱 패널 단계(정함).** apps slice E2E에서 돈다. lead가 plan README의 갈래 목록에 넣었다.
- **Q10 confirmation window의 slice(정함).** platform이 handle 발급·검증·소비를 documents slice의 platform#T56으로 떼었다. shell#T22는 platform#T56에, approval 종류(shell#T29)는 platform#T22에 기댄다.
- **Q11 chip의 polite 전달(정함).** 접근성을 범위 밖에 둔 D22와 맞지 않아 shell/design-system#R35에서 "polite로 전달"을 뺐다. T11은 live region·announcer를 만들지 않고 키보드·Escape·focus 복귀만 둔다.
- **Q13 문서 읽기 통로와 링크 고르기 자리(T16, 추천안으로 진행).** (1) outline·본문 읽기는 core read queue를 막지 않으려 worker route다. renderer allowlist는 read·command만 받았으므로 `worker:outline/document`·`worker:documents/read` 두 읽기만 더 열었다(준비·파일 쓰기 worker는 막힌 채). (2) 제품 core는 아직 settings route를 서빙하지 않고 settings registry도 조립하지 않는다. shell은 `apps/core/shell.ts`에 `shell.reading_width` 정의만 두었다. core 조립(정의 등록·route)은 platform 작업이 필요하다. lead가 배정한다. (3) 링크 고르기는 편집기에 치는 `[[` 글을 query로 쓰고 편집기가 focus와 화살표·Enter를 지킨다. overlay view로 열면 focus가 옮겨 가므로 편집 칸 위 popover 층(z 230)에 그린다. 문서 메뉴는 overlay view menu로 연다.
- **Q12 터미널 열기의 제품 경로(정함).**
  - 상태: 완료 (#240)
  - 제품 core의 reader 등록(apps/core/documents.ts `createReaderRegistration`)에 project read를 더했다: shell main의 `read projects list`가 reader Worker에서 답하고 apps/core `documents/projects#R8` 테스트가 사람 token으로 만든 프로젝트의 등록 폴더 목록을 본다. terminal 폴더 read는 개발 시드 폴백을 빼고 documents#T7 read만 쓴다(LOPHN_DEV_SEED는 개발에 남는다). 제품 user token(apps/core/parent.ts)은 처음에 `platform/status`·`platform/health`만 있어 실제 창의 프로젝트 만들기가 ledger scope gate에서 `forbidden`이었다. 지금은 user token이 조립된 route 표에서 user actor를 허용하는 operation 전부를 발급 시점에 계산해 지니므로(platform/identity R4·R14) 창에서 `project.create`와 `projects/list`가 통한다. machine·app·worker 전용 operation은 빠지고, 확인 창 handle이 필요한 grant/reject는 그대로 handle이 있어야 하며 user token은 renderer에 가지 않고 사람이 직접 눌렀다는 증거도 아니다. 제품 core는 아직 settings route를 서빙하지 않는다(Q13). terminal host가 죽은 뒤에는 사람이 누른 열기·[Start again]만 supervisor가 새 host를 하나 띄우고 그 host에서 등록 폴더 터미널을 새로 연다(shell/terminal#R9). 자동 재시작·옛 입력 재생 금지는 그대로다(shell/terminal#R13).
- **Q14 documents 화면의 series 말·보관 포함 검색·worker 읽기(T19, 추천안으로 진행).**
  - (1) ui-ux 3절은 series를 "보이지 않음"으로 두었지만 shell#T19 완료와 flow write-series는 documents 화면에서 사람이 가족을 등록·보관하게 한다. 등록 화면에 이름이 필요해 documents 화면 안 탭과 등록 화면에만 **Series**를 쓰고 sidebar 목적지로는 두지 않는다(desktop R30·버린 것 그대로). ui-ux 3절 표의 series 줄을 이렇게 고쳤다. 사람이 다른 말을 정하면 wording key 값만 바꾼다.
  - (2) 검색 index는 보관 문서를 넣지 않는다(outline-and-search#R17). "보관 포함"은 같은 조건의 보관 문서 목록(`documents/list` status archived)에서 제목이 맞는 것을 따로 보이고 그 마지막 판을 연다. 본문 일치는 보관 해제 뒤 index에 반영되어야 찾는다.
  - (3) Q13과 같은 이유로 renderer allowlist에 `worker:search/query`·`worker:views/open` 두 읽기를 더 열었다. `search/status`·export·준비·파일 쓰기 worker는 막힌 채다.
  - (4) headless 확인용으로 main이 `LOPHN_SHELL_START=lophn`이면 첫 창을 런처 대신 lophn 공간으로 연다(개발 전용, stack.md).
- **Q15 대화 도크의 메시지 본문과 대화 상대(T27, 추천안으로 진행).**
  - (1) ReceiveMessage 입력은 본문 hash만 받고 사람 입력이 blob을 올리는 길은 lophn-agent Q29가 막아 두었다. 도크는 글 part 하나의 MessageContent(schema_version 1, key 순서 고정 JSON)의 SHA-256을 body로 보내고 글은 창 메모리(`DraftStore`)에만 둔다. 그래서 지금 core와 agent는 사람 말의 글을 받지 못한다. → lophn-agent Q29가 정해졌다(#281): 본문 값을 `content`로 보내면 core가 준비한다. → 했다(#285): 도크는 `content`(글 part 하나)를 보내고 hash를 만들지 않는다. 다시 보내기는 같은 id·같은 key·같은 글이다. 상한(정규 직렬화 64KiB)은 보내기 전에 renderer가 보고 넘으면 보내지 않고 입력칸에 "This message is too long to send. Shorten it, or split it into parts."를 둔다. renderer는 contract schema를 bundle에 싣지 않아 상한 값을 `delivery-state.ts`에 두고 테스트가 contract 값·직렬화와 맞춰 본다.
  - (2) 메시지 본문 blob의 owner(blobs/read의 owner_kind·field)가 아직 없다. 도크는 이 창이 보낸 말만 글로 보이고 나머지는 "This message's text can't be shown here yet."로 둔다. 빈 말이나 지어낸 글로 보이지 않는다. → 했다(#285): 확정 메시지마다 `ReadMessageBody`로 읽어 글을 보인다. 읽는 중은 "Loading this message.", 못 읽으면 "Couldn't load this message."다. `not_found`는 다시 묻지 않고 `unavailable` 같은 결과를 모르는 실패만 다음 박자에 다시 읽는다. renderer allowlist는 contract read를 모두 통과시키므로 `read:messages/body`를 따로 열지 않았고 allowlist 테스트가 그 이름을 본다. 시각 블록은 shell#T35 블록 renderer 전까지 자리 표시다. 같이 고친 것: 도크의 command 응답 처리가 `{result}` 포장을 기대해 실제 core에서 새 대화 열기가 깨져 있었다. HTTP 성공 응답은 route output 그대로다(platform/api#R3). 같은 `.result` 읽기를 쓰던 `desktop/lophn-space/core-source.ts`의 command(views save, series create·add_instance·archive·unarchive)와 `editor/reading-width.ts`의 settings apply도 같은 PR에서 고쳤고, fake core 테스트의 `{result}` 응답도 실제 모양으로 바꿨다. reading-width apply는 compare에 `defaults_revision`도 빠져 있어 실제 core가 `invalid_input`으로 거절했다. 이제 get에서 읽은 기본값 판을 함께 싣는다. 실제 core 테스트(`renderer/testdata/real-core.ts`)가 saved view 저장(`desktop/lophn-space/core-source-real-core_test.ts`)과 읽기 폭 저장(`editor/reading-width-real-core_test.tsx`)을 본다. series create는 project 자리가 있어야 해 실제 core 테스트에 넣지 않았다. main의 confirmation 제출(`main/confirmation/submit.ts`)은 두 모양을 다 받아 그대로 둔다.
  - (3) renderer로 오는 streaming 통로가 없다. 임시 표시에서 확정 메시지로 바꾸는 것은 보내는 사람 말에만 지금 돈다(같은 id의 확정 메시지가 오면 바꾼다).
  - (4) 새 데이터 root에는 lophn 역할 assignment가 없다(CreateBuiltinAssignment는 machine 전용이고 부르는 자리가 없다). 도크는 "lophn isn't set up for conversations yet."를 보인다. 만드는 쪽은 lophn-agent다. → core 기동이 만든다(lophn-agent Q37, #281). 새 temp 데이터 root에서도 도크가 새 대화를 열고 보낸다(실제 core round trip 테스트).
  - (5) headless 확인용으로 main이 `LOPHN_SHELL_START=conversation`이면 lophn 공간을 도크를 연 채로 연다(개발 전용, stack.md).
- **Q16 질문 칸·things-to-confirm의 답 경로와 읽을 수 없는 자료(T28, 추천안으로 진행).**
  - (2026-10 lophn-agent Q38, #288로 닫힘) (1), (2), (5)는 core 쪽이 닫혔다. 일반 답 route `AnswerQuestion`(`questions/answer`)은 `{question, created_seq, answer}`이고 answer는 `{kind:"option", option_key}` 또는 `{kind:"text", text}`이며 확인 handle 없이 받는다(action이 있는 선택지는 forbidden). action 답은 `AnswerQuestionAction`(`questions/answer-action`) `{question, created_seq, answer:{kind:"option", option_key}, binding_hash, evidence:{question, option}}`+confirmation handle(binding: question·created_seq·answer·binding_hash). 취소는 `closed_reason_text`(글). 질문 글은 `ReadQuestionText`(`questions/text`, 입력 `{question}`)로 읽는다. shell은 이 모양으로 바꾸고 칸의 자리표 글과 hash 계산을 걷어낸다.
  - (2026-10 Q16 후속, #291) 칸과 things-to-confirm을 새 모양으로 바꿨다. action 없는 선택지 답과 자유 답은 `questions/answer`에 `{question, created_seq, answer}`로 보내고 확인 handle을 싣지 않는다. 자유 답은 `{kind:"text", text}`, 취소는 `closed_reason_text`로 글을 값으로 싣는다. renderer는 글의 hash를 만들지 않는다(같은 답이면 같은 idempotency key가 되도록 key 꼬리에만 줄인 값을 쓴다). 글 하나가 contract 상한(UTF-8 32768 bytes)을 넘으면 보내기 전에 막고 "This is too long to send. Shorten it."를 보이며 쓴 글은 그대로 둔다. 질문 글(본문·이유·선택지 설명·추천 이유, 닫힌 질문의 자유 답·취소 이유)은 `questions/text`로 읽어 React 글로만 그린다. 읽는 동안 "Loading this question.", 읽지 못하면 "Couldn't load this question's text."이고 선택지 답은 그대로 보낼 수 있다. 예전 "can't be shown here yet" 자리표 글은 없앴다.
  - (Q16 후속) action 있는 선택지는 여전히 [Review]로 보호 창을 열 뿐 칸이 `questions/answer-action`을 보내지 않는다. handle(binding: question·created_seq·answer·binding_hash)은 보호 창이 받아 제출하는 몫이고(shell#T29), main에 `openConfirmation`이 아직 없어 칸은 "The review window can't open here yet."를 그대로 보인다.
  - (Q16 후속) approval·notification 목록은 제품 core(#286)에서 읽혀 결정 개수·목록·notification 탭·chip에 보인다. "Couldn't load decisions/notifications right now."는 실제로 읽지 못했을 때만 남는다. 실제 core에서 드러난 것: core reader는 한 principal의 대기 읽기를 8개까지만 받고 넘으면 `unavailable`로 답한다. 칸·chip·도크·things-to-confirm이 같은 사람 token을 쓰므로, `overview()`와 `pending()`은 읽기를 하나씩 보내고 things-to-confirm은 읽는 중의 다시 읽기를 하나로 합친다. 전에는 6개를 한꺼번에 두 번 보내 approval 읽기가 거절돼 "Couldn't load decisions"가 떴다.
  - (Q16 후속) 실제 core 테스트는 `apps/shell/renderer/testdata/question-core.ts`를 띄운다. main.ts와 같은 팀 등록의 core를 temp LOPHN_HOME으로 띄우고 test credential 입구를 열어, 사람이 연 세션의 run을 machine이 시작하고 그 run의 agent가 글 있는 질문을, coding agent가 세션 없는 approval request를 실제 HTTP route로 만든 뒤 hello를 넘긴다(model은 부르지 않는다). `--seed-only`로 심고 멈추면 그 root로 shell을 headless로 띄워 볼 수 있다.
  - (1) (닫힘, 위 후속) T28 완료 기준은 action 없는 질문의 선택 답·자유 답을 일반 답 경로로 보내라고 하지만, contracts의 AnswerQuestion은 모든 답에 `confirmation: "required"`를 둔다. 그래서 지금 제품 core는 칸에서 보낸 일반 답을 거절하고 칸은 "This answer can't be sent from here."를 보인다. 미루기·취소·읽음 표시는 그대로 된다. 추천: lophn-agent/contracts가 domain model("action option이면 confirmation window 증거 소비")대로 confirmation을 action 선택지의 답에만 요구하게 route를 나눈다(일반 답 route와 action 답 route). 그 전까지 칸은 다른 길로 답을 보내지 않는다.
  - (2) (닫힘, 위 후속) 질문의 본문·이유·선택지 설명·추천 이유 blob은 `general_read: false`라 어느 actor도 읽지 못한다. 칸은 선택지 이름(inline)과 추천·기한만 보이고 본문 자리에 "This question's text can't be shown here yet."를 둔다. 추천: lophn-agent가 사람(user) 화면 읽기용 field를 연다(secret 판정 답은 그대로 막는다).
  - (3) (닫힘, #286과 위 후속) 제품 core(`apps/core`)는 platform approvals·notifications 모듈을 조립하지 않아 `approvals/list`·`notifications/list`가 없다. 화면은 질문만 보이고 결정 개수 자리에 "Couldn't load decisions right now.", notification 탭에 "Couldn't load notifications right now."를 둔다. 0건이나 빈 목록으로 말하지 않는다. chip은 읽은 것이 없어 뜨지 않는다. core 조립은 platform 작업이 필요하다. lead가 배정한다.
  - (4) 완료 기준의 "읽음·읽지 않음으로 남기고"는 domain model과 다르다. notification의 `read_at`은 한 번 정하면 불변이고 읽지 않음으로 되돌리는 command가 없다. 화면은 읽음과 읽지 않음을 구별해 보이고 명시한 읽음 표시만 낸다(platform/notifications#R5).
  - (5) (닫힘, 위 후속) 자유 답과 취소 이유는 대화 도크(Q15)와 같이 글의 hash만 보낸다. 사람 글을 blob으로 올리는 길이 생기면 같은 hash로 보낸다.
  - (6) "blocking"은 그 요청을 `waiting_on`으로 기다리며 멈춘 run이 있는 요청으로 읽는다. 기간 filter의 시각은 생성·닫힘 event의 `at`(events.list)이고, 읽지 못한 요청은 기간으로 빼지 않는다. 역할은 run의 assignment 역할이다.
  - (7) headless 확인용으로 main이 `LOPHN_SHELL_START=things-to-confirm`이면 lophn 공간의 things-to-confirm부터 연다(개발 전용, stack.md).
- **Q17 전역 팔레트의 동작, OS 기능 실패 안내 자리, notification 원천(T56, 추천안으로 진행).**
  - (1) 전역 팔레트 CommandOrControl+Shift+K는 가장 최근에 focus를 받은 창(없으면 새 기본 창)을 앞으로 가져와 지금 공간과 상관없이 lophn 전체 팔레트(프로젝트·컨텍스트·문서·앱·행동)를 연다. 이미 열린 팔레트는 닫지 않는다. 창 안 팔레트 CommandOrControl+K는 지금 공간의 행을 여닫고 런처에서는 아무것도 열지 않는다. main이 창에 시키는 것은 `shell:intent` channel의 이름(`global-palette`, `things-to-confirm`)뿐이고, 막 연 창에서는 preload가 마지막 하나를 들고 있다가 첫 구독에 넘긴다.
  - (2) 전역 팔레트 등록 실패와 OS notification 실패는 tray menu의 누를 수 없는 안내 줄 하나씩으로 보이고 log에 남긴다. 다른 key를 대신 잡거나 다시 시도하지 않는다. settings의 OS notification 항목(T58)이 생기면 같은 상태를 거기서도 보일 수 있다.
  - (3) OS notification 클릭은 things-to-confirm을 연다. notification별 결과로 바로 가지 않고 things-to-confirm의 행이 결과를 연다. 읽음·결정 command는 보내지 않는다.
  - (4) opt-in 정의 `shell.os_notifications`(boolean, 기본 false)는 `apps/core/shell.ts`에 두었다. main은 새 notification이 도착할 때마다 settings.get으로 지금 값을 읽고, 읽지 못하면 꺼짐으로 본다. 켜고 끄는 화면은 T58이다.
  - (5) 재연결 backlog 판정: main 구독은 붙을 때 `events.list`의 `head_seq`를 기억하고 socket으로 온 event 중 그 뒤의 것만 "지금 도착"으로 넘긴다. 한 page로 다 따라잡지 못한 나머지도 socket으로 오기 때문이다.
  - (6) 제품 core가 platform notifications를 조립하지 않아(Q16(3)) 지금은 `NotificationCreated`가 오지 않는다. main은 실제 event 구독에 붙어 있으므로 core 조립이 들어오면 추가 연결 없이 표시된다. 그 확인은 platform 조립 작업과 platform#T46(flow catch-up-notifications)이 한다.
  - (7) `apps/shell/renderer/editor/reading-width.ts`의 settings.apply compare에 `defaults_revision`이 없던 버그는 #285가 고쳤다(실제 core 시험 포함).
- **Q18 프로젝트 등록과 추적 켜기의 제품 경로(T15, 추천안으로 진행).**
  - (1) 제품 core는 아직 `/v1/projects/preview_tracking`과 `/v1/files/list`를 서빙하지 않는다(둘 다 `not_found` "route not found"). shell 쪽은 contract대로 이었다: 추적 켜기 창은 worker `projects/preview_tracking`을 끝 page까지 모으고, 켜기는 미리 본 폴더·규칙과 complete인 마지막 page를 `projects/set_tracking`에 `compare.base_revision`과 함께 보낸다. 이 모양은 가짜 core 통로 테스트(`workspace/tracking/core-source_test.ts`)가 보고, 화면은 주입한 통로로 테스트한다. 실제 core의 등록·목록·작업대 읽기는 temp LOPHN_HOME core 테스트(`desktop/launcher/core-source-real-core_test.ts`)가 본다. 미리보기·켜기와 팔레트 파일 묶음의 실제 core 확인은 documents#T12 뒤 shell#T17로 넘긴다. 그 전까지 미리보기는 "The file check for … didn't finish"를 보이고 추적을 켜지 않는다.
  - (2) Q13과 같은 이유로 renderer allowlist에 `worker:projects/preview_tracking`을 더 열었다. 폴더를 scan해 포함·제외만 돌려주는 읽기다. 적용은 command `projects/set_tracking`이다.
  - (3) 등록 창은 이름·목적·폴더만 묻는다. 안쪽 짧은 이름(slug)은 이름에서 만들고 이미 쓰는 이름이면 번호를 붙이며 펼친 상세에만 보인다. 등록은 `tracking {enabled:false, patterns:[], use_gitignore:false}`로 만들고, 규칙을 고른 적 없는 프로젝트의 첫 켜기는 read의 `initial_tracking_proposal`(Markdown과 .gitignore)을 보인다.
  - (4) 겹침(documents/projects#R7)은 켜기 전에 다른 활성 프로젝트의 켜진 폴더(`projects/list`)와 경로로 비교해 켜기를 막는다. 켜기가 `conflict`면 오류 글을 읽지 않고 현재 판과 켜진 폴더를 다시 읽어 "미리보기 뒤 바뀜"과 "겹침"을 가른다. 미리보기 실패는 `unavailable`·`forbidden`만 폴더를 읽지 못함으로 말하고 다른 실패는 원인을 추측하지 않는다.
  - (5) 연관 컨텍스트를 프로젝트로 묻는 read가 없어(contexts.related는 문서·앱 command 대상) 제품 작업대는 그 프로젝트 문서를 하나라도 담은 활성 컨텍스트를 보인다. main은 아직 layout 저장·복원 통로를 renderer에 열지 않았다(`ipc/workspace.ts`의 channel만 있다). 그래서 제품 작업대는 빈 배치로 시작하고 배치를 저장하지 않는다. main·preload 연결은 lead가 배정한다.
  - (6) 창 시작 공간이 프로젝트여도 core 연결이 준비되기 전에는 런처의 연결 화면을 보이고, 준비되면 작업대를 열어 읽는다(실패한 첫 읽기로 "Couldn't load this project."를 남기지 않는다).
  - (7) headless 확인용으로 main이 `LOPHN_SHELL_START=project:<prj id>`면 그 작업대부터 연다. headless에서는 OS 폴더 선택기를 띄우지 않고 `LOPHN_SHELL_PICK_FOLDER`만 고른 것으로 돌려준다(개발 전용, stack.md).
- **Q19 편집기 저장 흐름의 통로와 제품 core에서 드러난 것(T17, 추천안으로 진행).**
  - (1) renderer는 문서 id와 main이 준 session handle만 안다(`ipc/editor.ts`, preload `lophnEditor`). main 파일 adapter(`main/editor/file-adapter.ts`)가 `documents/get`의 `file_source`로 목표를 정한다: project 파일, 지침 파일, 원본이 없으면 working copy. 편집 글은 판 본문이 아니라 `files/read` stream으로 읽은 지금 디스크 바이트이고(working copy가 아직 없으면 연 판의 주 파일, base_hash null), 쓰기는 바이트를 `documents/upload`로 준비한 뒤 `files/write`에 준비 참조로 보낸다. 파일 쓰기·upload·stream 읽기는 renderer allowlist 밖이고 main만 부른다(`CoreSession.internal`·`readStream`·`upload`).
  - (2) 자동 저장(입력 멈춤 800ms)은 파일만 쓴다. version 준비(`version_request`)는 편집 종료에만 싣는다: CommandOrControl+S, 읽기 전환, 탭 닫기, 탭 전환(화면이 사라질 때), 창 닫기. 고침이 없으면 종료를 다시 보내지 않는다. 유휴 종료는 shell timer 없이 `files/watch`가 알린 상태(쓴 hash가 `tracked`이고 `compared_version`이 있음)로만 반영한다.
  - (3) 결과를 모르는 쓰기(응답 유실, `unverified`)는 다시 쓰지 않고 `files/read`로 지금 바이트의 hash를 본다. `files/status`는 추적을 끈 폴더에 hash가 없어 가릴 수 없다. 형식 검사는 종료 쓰기 뒤 같은 준비 blob으로 `formats/validate`를 부른다(주 파일 하나인 document·data 형식만).
  - (4) 창 닫기 guard: renderer가 창마다 저장 중(쓰는 중·대기·실패·불명·충돌)과 종료가 남은 문서 수를 main에 알리고, main은 그 수가 있으면 닫기를 막고 묻는다. renderer는 모두 종료로 보내고 남으면 overlay dialog(Keep editing, Check again, Discard changes)를 연다. 답이 없으면 15초 뒤 닫고, 묻는 중이라고 답하면 기한을 멈추며, 묻는 동안 온 닫기는 삼킨다(legacy close-guard). 앱 끄기(OS·app.quit)가 부른 닫기는 허락 뒤 끄기를 다시 잇는다. tray Quit은 `QuitWork.pendingSaves`(저장 중 문서 수)로 native 확인을 띄운다.
  - (5) 실제 Electron의 CSP(`style-src 'self'`)가 CodeMirror(style-mod)의 <style>을 막아 편집기 기본 모양이 빠져 있었다(gutter가 글 위에 쌓여 첫 블록이 294px 밀림). 그 글을 constructable stylesheet의 cascade layer로 옮긴다(`editor/adopt-styles.ts`). `e2e/shell/read-edit_test.ts`를 headless로 처음 실제로 돌려 통과한다. 시드의 plan 탭을 `document_editor`로 바꿨다(test가 편집 탭을 연다).
  - (6) 제품 core의 worker `documents/read`가 "worker가 사용할 수 없다"(unavailable)로 답해 읽기 본문이 "Couldn't load this document."다. 파일 통로가 있으면 편집은 디스크 글로 열 수 있게 했다(판 본문을 기다리지 않는다). 읽기 폭의 재시작 반영 E2E와 version 충돌의 "최신 판과 비교"(최신 판 본문 읽기)는 그 뒤에 확인한다. documents에 알린다.
  - (7) 추적 관측으로 생긴 문서는 자리(place)가 없어 프로젝트 작업대의 문서 목록·팔레트 파일 묶음에 오지 않는다. 저장 E2E(`e2e/shell/save_test.ts`)는 `documents/move`로 그 문서를 프로젝트 자리에 둔 뒤 연다. 추적 문서의 자리를 누가 정하는지 documents와 shell/workspace가 정한다.
- **Q20 버전 이력·비교·복원의 통로와 제품 core에서 드러난 것(T18, 추천안으로 진행).**
  - (1) 이력(`documents/history`)·문서 정보(`documents/get`)·컨텍스트(`contexts/list`에서 이 문서를 담은 것)는 read, 줄 diff(`documents/diff`)·절 이력(`documents/section_history`)·절(`outline/document`)·본문(`documents/read`)은 worker 읽기다. renderer allowlist에 `worker:documents/diff`·`worker:documents/section_history` 두 읽기를 더 열었다(준비·파일 쓰기 worker는 막힌 채). 복원은 준비(`documents/prepare`)와 파일 쓰기가 renderer allowlist 밖이라 main의 편집 통로(`shell:editor-restore`, `main/editor/restore.ts`)가 한다.
  - (2) 복원: 고른 판의 경로별 원문 blob 참조(`existing`, owner_key `<판>/<경로>`)와 정확한 FormatRef로 준비하고 `document.restore`에 최신 판·revision CAS를 싣는다. 원본 연결 문서는 먼저 고른 판의 대표 파일 바이트(`documents/file`)를 지금 디스크 hash로 CAS해 `files/write`로 쓰고, 그 쓰기 결과의 관측(`observed_hash`·`observed_at`)과 `documents/get`·`projects/get`의 revision으로 `source`·`file_basis`를 만들어 준비한다. 관측 loop가 같은 바이트로 판을 먼저 만들어 복원 명령이 conflict·unchanged가 되면, 최신 판이 고른 판과 같은 내용·형식일 때 그 판을 이 복원의 결과로 보인다(DocumentRestored event는 그때 없다). 디스크와 최신 판이 이미 고른 판이면 쓰지 않고 unchanged다. 지침 파일은 관측 loop가 판을 정하므로 파일만 쓰고 pending으로 답한다(지침 revision read가 없다). 검사 한도(1 MiB)를 넘는 명시 format 판도 원문 참조 준비라 그대로 되살아난다(documents Q30 (5)). 판 바이트는 main 메모리에 64 MiB까지 둔다.
  - (3) 제품 core에는 파생 store를 쓰는 consumer가 아직 없어(documents#T21) `documents/diff`·`section_history`·`outline/document`·`documents/read`가 모두 unavailable이다. 그래서 제품에서 비교 화면은 "Couldn't load this comparison"과 다시 시도로 답하고, 버전 탭의 절 고르기는 나오지 않는다. 이력·정보·복원은 파생 store 없이 돈다. 실제 core 테스트(`editor/versions/versions-real-core_test.ts`)는 이력·연결 문서 복원·1 MiB 넘는 명시 format 복원을 보고, 비교 화면은 documents.diff 모양의 통로로 component test(`editor/compare/compare_test.tsx`)가 본다. headless 확인은 documents의 실제 core 시험처럼 실제 format module로 두 판을 추출해 파생 store에 심은 뒤 비교·복원을 돌렸다. documents#T21이 consumer를 조립하면 심지 않고도 같은 화면이 나와야 한다. documents에 알린다.
  - (4) 정보 패널 틀(폭·머리·탭·열림 기억)은 shell#T14의 작업대 자리(`workspace/info-panel-slot`)가 그대로 두고, 탭 본문만 `editor/info-panel`이 그린다. overlay일 때 Escape·바깥 click 닫기와 CommandOrControl+Alt+B는 작업대 자리에 더했다(창 shortcut 표가 아니라 renderer keydown이라 앱 view에 focus가 있으면 오지 않는다). 비교는 정보 패널 버전 탭에서 열어 focus 칸 문서 탭 본문 자리(읽기 기둥 밖, 칸 전체 폭)에 그리고, 복원은 비교 화면의 secondary 아이콘과 확인 줄로만 한다.
- **Q21 view 수명 진단의 앱·release(T37, contracts 팀 판단 대기).** `shell_view_lifetime` 진단 payload에는 app·release가 없다(contracts#T6). main은 view_session·generation·개수를 감독 pipe로 보내고 core가 `<데이터 root>/logs/shell-view.jsonl`에 그 field만 쓴다(`apps/core/parent.ts`). shell/app-frame#R22의 "어떤 앱·release가 표시됐는지"는 main log 줄(view_session·generation·app·release·mode, URL·token 없음)에 함께 남겼다. payload에 app·release를 더할지는 contracts 팀이 정한다.
- **Q22 앱 preload 통로의 자리와 아직 없는 core 통로(T38, 추천안으로 진행).**
  - (1) `app:call`은 view의 화면 연결(`commands: []`)을 넓히지 않고 같은 view 대상(app·mode·release·screen·size)에 blueprint의 모든 command를 범위로 한 연결을 따로 얻는다(`app-connection.ts`의 `connectCommands`). 처음 부를 때 얻고 view의 프로세스·bundle·release가 바뀌거나 만료가 30초 안이면 다시 얻는다. 화면 열기가 blueprint read에 묶이지 않게 하려는 것이다. 앱이 401을 주면 handler 전 거절이라 같은 request_key로 한 번만 다시 보낸다. 보낸 뒤 끊긴 쓰기는 다시 부르지 않고 `command result is unknown`이다.
  - (2) 선언 밖 command와 core가 연결에 넣지 않은 command는 같은 `invalid_input: command is not available`이다. 앱 handler 실패(500)는 페이지에 `unavailable: command failed`로 보인다. 페이지에서 실패는 `Error("<code>: <message>")`로 reject된다.
  - (3) shell tsc는 contracts의 `blueprint-schema.ts`를 `noUncheckedIndexedAccess`로 검사하면 실패한다. 그래서 `validateInput`·`canonicalInputHash`는 deno가 검사하는 main.ts 조립이 app-call에 넘긴다(`InputRules`). app-call 테스트는 같은 contracts 함수를 쓴다.
  - (4) context isolation 때문에 페이지의 error·unhandledrejection은 preload(isolated world) listener에 오지 않는다(e2e에서 확인). 감시 함수를 `contextBridge.executeInMainWorld`로 main world에서 돌리고 보고 함수는 인자로만 넘겨 `window`에 이름을 더하지 않는다. SDK 루트 render 오류는 `lophn:render-error` DOM event로 받는다(→ T40).
  - (5) 아직 core 통로가 없는 것: blueprint read(apps#T19 `/v1/apps/blueprint`)와 confirm gate(→ T45), view 오류의 collector 전달 binding과 main 조립 연결(→ problems#T16, contracts 판단 필요). 그 전까지 main은 각각 unavailable·unsent다. headless 확인(`LOPHN_SHELL_HEADLESS=1`)에서는 외부 링크를 OS browser로 열지 않고 log만 남긴다. 앱 view의 `<a target=_blank>`·main frame 탐색은 지금처럼 막히고 OS browser로 넘기지 않는다. 링크는 `lophnApp.openExternal`로만 연다.
- **Q23 세션 시각 블록 renderer의 검사, 문서로 남기기, 남은 갈래(T35, 추천안으로 진행).**
  - (1) renderer 검사. renderer는 contracts를 bundle에 싣지 않는다(zod와 core 쪽 graph, `editor/core-source.ts`와 같은 이유). 그래서 VisualBlock(contracts#T30)의 모양·상한과 owner 검사의 markup·URL 규칙(lophn-agent Q45 (1))을 `workspace/visuals/registry.ts`에 옮겨 적었고 `registry_test.ts`가 같은 fixture를 contract schema로도 통과시켜 맞춰 본다. 그릴 수 있는 종류는 frozen registry(`table`·`chart`·`diagram`, 앱 카드는 T44)뿐이다. 지금 검사를 지나지 못하는 저장 블록(규칙이 바뀌었거나 판·종류가 다른 것)은 그리지 않고 이유(모양·종류·markup·그릴 수 없음)와, 따로 검사해 안전한 제목·설명·출처만 둔다. 문자열은 React text node로만 그리고 SDK에는 문자열·숫자 props만 넘긴다. 블록마다 error boundary를 둬 SDK 그리기 예외도 그 블록의 "그릴 수 없음"에 그친다.
  - (2) 막지 못하는 것(lead 판단). main의 contract client가 `messages/body` 출력을 route output schema로 검사하므로 저장 블록이 output schema(비엄격)조차 지나지 못하면 메시지 전체가 "Couldn't load this message."다. 블록 하나만 이용 불가로 두려면 output schema가 visual part를 블록별로 느슨하게 받아야 하고 그것은 contracts 몫이다. 지금은 owner가 저장 때 더 엄격한 검사를 하므로 생기지 않는다.
  - (3) SDK 매핑. 막대는 `BarChart`(x를 처음 나온 순서의 범주로), 선은 `LineChart`(시간 축만, 시각 순 정렬), 산점은 `ScatterChart`(숫자 축, y가 null인 점은 자리가 없어 찍지 않는다), 도표는 `GraphDiagram`(node 설명은 아래 목록 글). SDK가 그리지 못하는 조합(범주·숫자 축의 선, 시간 축의 산점, 한 계열의 같은 x)은 값을 바꾸거나 버리지 않고 같은 데이터를 표로 보이며 "This chart is shown as a table."를 둔다. 자기 자신을 가리키는 edge는 contract가 받지만 SDK 도표가 받지 않아 "그릴 수 없음"이다. SDK가 이 조합을 그리게 되면 표 대신 차트로 바꾼다(shell/design-system 몫). 빈 표·차트의 한 가지 다음 행동은 "Read the description"(설명으로 focus)이다. 설명이 빈 값·결측을 말하기 때문이다(lophn-agent/visuals domain model).
  - (4) 문서로 남기기(lophn-agent Q45 (6), lead 결정). 별도 저장 contract는 없다. 버튼은 "Save the visual “{title}” (block {block} in message {message}) as a document."를 일반 request로 보낸다. 글에 메시지 id와 block key를 싣는 것은 agent가 `visual.prepare_document`의 `message`·`block_keys`를 틀리지 않게 하기 위함이고, 그래서 사람 말 글에 id가 보인다. 작성 중 글·focus·읽던 위치는 건드리지 않는다(`DraftStore.sent`가 요청 말은 보낸 말만 지운다). 다른 말을 보내는 중이거나 연결이 끊기면 버튼만 잠근다. 진행은 창 메모리의 요청 id와 기록에서 계산한다(`conversation/model.ts`의 `visualSaveState`): 보내는 중, 요청됨, 못 보냄(다시 누를 수 있다), 저장 안 함(요청 말이 맡긴 run이 끝났는데 결과 링크가 없다, 이유는 답이 말한다), 저장됨(그 run의 lophn 답의 문서·판 결과 링크, 그 블록 틀에 고정 문서 링크로 보인다). 요청 기억은 창 메모리라 창을 다시 열면 블록 틀에는 링크가 없고 답 아래 결과 링크로만 보인다.
  - (5) 고정 문서 블록. VisualBlock에는 문서 종류가 없다. 계획의 "고정 문서"는 출처의 문서 판과 저장 뒤 고정 문서 링크로 했다(`document-block.tsx`). 이름은 `documents/get`으로 읽고 not_found·forbidden이면 "Document you can't open"으로 두며 다른 판으로 바꾸지 않는다. 누르면 host의 `onOpenResult(document, version)`가 연다(실행 가능한 format은 T33 view).
  - (6) 확인: `workspace/visuals/registry_test.ts`(script 거절, contract와 같은 모양), `workspace/visuals/visuals_test.tsx`(SDK 그리기, escape, 그 자리 상태, 출처 문서, 저장 진행), `conversation/dock_test.tsx`(본문 순서, 저장 요청과 focus·읽던 위치·작성 중 글). headless offscreen probe(`BrowserWindow({show:false, offscreen:true})`의 paint)로 도크의 막대·표·선·도표·이용 불가 블록과 저장 뒤 링크를 확인했다.
