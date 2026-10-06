---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---

# 기술 스택과 개발 환경

판은 처음 뼈대를 만들 때 그때의 최신 안정판으로 정하고 lockfile로 고정한다. 정한
판은 contracts 팀이 skeleton 첫 작업(contracts#T1) PR에서 이 문서에 적는다(예:
Deno 2.9.7, zod 4.6.5). 판을 올리는 것은 별도 작업이다.

## 판

| 것          | 판      |
| ----------- | ------- |
| Deno        | 2.9.7   |
| zod         | 4.6.5   |
| @std/assert | 1.0.19  |
| Electron    | 44.5.1  |
| esbuild     | 0.28.2  |
| TypeScript  | 7.0.2   |
| @types/node | 24.19.1 |
| React       | 19.3.0  |
| react-dom   | 19.3.0  |

## 고른 것

| 영역                                      | 고른 것                                                             | 비고                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 언어                                      | TypeScript strict                                                   | 모든 코드                                                                                                                                                     |
| core, worker, agent runtime, 앱, CLI, MCP | Deno 2                                                              | Deno workspace 하나                                                                                                                                           |
| shell                                     | Electron, Node 24 LTS                                               | `apps/shell/main`만 npm과 package-lock. 이전 lophn은 Electron 44                                                                                              |
| ledger, 앱 DB, derived store              | SQLite (Deno의 `node:sqlite`), WAL, FTS5                            |                                                                                                                                                               |
| renderer, SDK UI                          | React, CodeMirror 6                                                 | 이전 lophn shell과 같다                                                                                                                                       |
| 터미널                                    | xterm.js 6.0.0, node-pty 1.1.0(POSIX PTY, Windows ConPTY)           | Electron 44.5.1(Node 24.21, NODE_MODULE_VERSION 149)용 linux prebuild는 없다. `@electron/rebuild` 4.2.0이 electron 헤더로 `node-pty`를 다시 빌드한다          |
| schema                                    | Zod 한 가지                                                         | contracts와 경계 검사. 예외: 앱이 import하는 blueprint 검증기는 의존성 없는 순수 TS(`packages/contracts/apps/blueprint.ts`, `@lophn/blueprint`가 다시 내보냄) |
| format, lint                              | `deno fmt`, `deno lint`                                             | 저장소 전체(npm 쪽 포함)                                                                                                                                      |
| 테스트                                    | `deno test`; shell main은 `node --test`; E2E는 Playwright(Electron) |                                                                                                                                                               |
| secret                                    | OS keychain                                                         | 평문 금지                                                                                                                                                     |

의존성을 더할 때는 이 표나 아래 목록에 이유와 함께 적는다. 같은 일을 하는
라이브러리를 둘 들이지 않는다.

| 의존성                                                                                                                              | 쓰는 곳                                                               | 이유                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| picomatch 4.0.7                                                                                                                     | documents/file-tracking, documents/projects                           | tracking 규칙의 glob. OS locale과 무관하게 대소문자를 구분한다                                                                                                                                                                                                                                                                         |
| ignore 7.0.12                                                                                                                       | documents/file-tracking, documents/projects                           | `.gitignore` 모양 제외 규칙. 중첩 파일은 깊은 쪽부터 적용한다                                                                                                                                                                                                                                                                          |
| quickjs-emscripten 0.32.0 sync release (`@jitl/quickjs-wasmfile-release-sync`)                                                      | documents/formats                                                     | format 검사 코드를 격리해 돌린다. 호출마다 새 runtime·context. debug·asyncify 빌드는 쓰지 않는다                                                                                                                                                                                                                                       |
| parse5                                                                                                                              | documents/formats의 HTML format 묶음 안                               | HTML 문서 해석                                                                                                                                                                                                                                                                                                                         |
| electron 44.5.1                                                                                                                     | apps/shell/main                                                       | shell 창과 sandbox preload. 이전 lophn과 같은 판                                                                                                                                                                                                                                                                                       |
| esbuild 0.28.2                                                                                                                      | apps/shell/main, apps/shell/renderer                                  | main과 preload 세 개를 CJS 한 파일로 묶고, renderer entry 세 개를 브라우저 bundle로 묶는다. sandbox preload의 외부 require는 `electron`만 남기고, renderer의 CSS Modules는 `local-css` loader가 클래스 맵으로 바꾼다                                                                                                                   |
| typescript 7.0.2                                                                                                                    | apps/shell/main                                                       | `erasableSyntaxOnly`로 main과 preload를 typecheck한다. Deno 쪽은 Deno가 품은 TypeScript를 쓴다                                                                                                                                                                                                                                         |
| @types/node 24.19.1                                                                                                                 | apps/shell/main                                                       | Node 24 타입. shell main만 Node에서 돈다                                                                                                                                                                                                                                                                                               |
| zod 4.6.5                                                                                                                           | apps/shell/main                                                       | Deno workspace와 같은 판. `packages/contracts`·`packages/base`의 `.ts` 원본이 import한 zod를 main bundle이 이 node_modules에서 resolve한다                                                                                                                                                                                             |
| react 19.3.0, react-dom 19.3.0                                                                                                      | apps/shell/renderer                                                   | shell·overlay·confirmation renderer. Deno workspace에서 `npm:`으로 고정한다                                                                                                                                                                                                                                                            |
| @types/react 19.3.0                                                                                                                 | apps/shell/renderer                                                   | React 19는 타입을 함께 싣지 않는다. JSX 타입은 `jsxImportSourceTypes`로 이 패키지를 가리킨다                                                                                                                                                                                                                                           |
| @luca/esbuild-deno-loader 0.11.1                                                                                                    | apps/shell/renderer                                                   | renderer bundle이 Deno import map과 `npm:`·`jsr:`를 esbuild로 resolve한다. CSS Modules를 만들려면 esbuild loader가 필요하고, deno bundle은 클래스 맵을 만들지 않는다                                                                                                                                                                   |
| intl-messageformat 12.1.2                                                                                                           | packages/design/wording                                               | en 문구의 ICU MessageFormat, placeholder와 plural                                                                                                                                                                                                                                                                                      |
| postcss 8.5.28                                                                                                                      | packages/design/style-check                                           | CSS AST와 source 줄을 읽어 token-only 검사를 `deno test`에서 돌린다. stylelint는 들이지 않는다                                                                                                                                                                                                                                         |
| postcss-value-parser 4.2.0                                                                                                          | packages/design/style-check                                           | 선언과 media 값의 함수·단위·token 참조를 검사하여 regex만으로 CSS 값을 해석하지 않는다                                                                                                                                                                                                                                                 |
| @radix-ui/react-select 2.3.7, @radix-ui/react-tabs 1.1.21, @radix-ui/react-checkbox 1.3.11, @radix-ui/react-switch 1.3.7            | packages/design/components                                            | 선택·탭·checkbox·switch의 열고 닫기, 키보드, focus 복귀를 검증된 primitive로 둔다(shell/design-system#R43). React는 renderer와 같은 19.3.0 한 벌로 묶는다                                                                                                                                                                              |
| @radix-ui/react-tooltip 1.2.16, @radix-ui/react-popover 1.1.23, @radix-ui/react-dropdown-menu 2.1.24, @radix-ui/react-dialog 1.1.23 | packages/design/components                                            | tooltip·popover·menu·dialog·sheet·palette의 열고 닫기, 바깥 click·Escape·focus 이동 닫기, focus 복귀를 검증된 primitive로 둔다(shell/design-system#R33, R43). tooltip 지연과 toast 시간은 주입한 timer로 재고 Radix 내부 timer를 쓰지 않는다. toast는 끌 수 없는 live region과 내부 timer 때문에 Radix Toast를 들이지 않고 직접 그린다 |
| lucide-react 1.51.0                                                                                                                 | packages/design/components                                            | 한 벌의 아이콘을 선 1.5, 14·16·20px로 쓴다(shell/design-system#R43)                                                                                                                                                                                                                                                                    |
| @lezer/markdown 1.7.2 (@lezer/common 1.5.3, @lezer/highlight 1.2.5를 함께 끌어온다)                                                 | packages/design/reading                                               | Markdown 읽기 renderer의 parser. 편집기(CodeMirror 6)와 같은 Lezer Markdown 하나로 읽기·편집 위치 차이를 줄이고 parser를 둘 들이지 않는다. tree를 React 글과 element로만 그려 HTML을 실행하지 않는다. marked·HTML parser는 들이지 않는다                                                                                               |
| @codemirror/state 6.7.6, @codemirror/view 6.43.13, @codemirror/commands 6.11.1, @codemirror/language 6.12.4, @codemirror/lang-markdown 6.5.2 | apps/shell/renderer/editor | 문서 편집기(shell/editor#R7). Markdown 언어는 읽기와 같은 @lezer/markdown 1.7.2를 쓰고, live preview는 syntax tree로 표지만 숨기며 문법 강조는 켜지 않는다. 이전 lophn 편집기와 같은 판이다. editor 폴더 밖과 SDK에는 공개하지 않는다(editor/boundary_test.ts) |
| d3-scale 4.0.2, d3-shape 3.2.0                                                                                                      | packages/sdk/ui-chart                                                 | 여섯 차트의 scale·tick·선 경로 계산만 맡긴다(shell/design-system#R12, apps/sdk#R17). DOM은 React SVG로 그리고 script·HTML renderer는 들이지 않는다                                                                                                                                                                                     |
| @types/d3-scale 4.0.9, @types/d3-shape 3.2.0                                                                                        | packages/sdk/ui-chart                                                 | 고정한 d3 계산 API의 TypeScript 타입                                                                                                                                                                                                                                                                                                   |
| hash-wasm 4.12.0                                                                                                                    | packages/platform/secrets                                             | 머신 이전 보호 파일의 Argon2id. WebCrypto에는 Argon2가 없고 AES-256-GCM은 WebCrypto를 쓴다(platform/secrets#R9)                                                                                                                                                                                                                        |
| @std/toml 1.0.2                                                                                                                     | packages/platform/settings                                            | settings 교환 TOML의 parse·stringify. TOML 1.0만 해석하고 YAML·JSON5·null을 거절하며 환경 치환·include·command 실행 경로가 없다. export는 null 값을 거절한다(TOML 1.0에 null이 없다)                                                                                                                                                   |
| happy-dom 20.14.5                                                                                                                   | packages/design/component-tests.ts, apps/shell/renderer/build_test.ts | 공통 컴포넌트·SDK 옆 `*_test.tsx`와 실제 공개 예제 bundle을 DOM·event·keyboard·computed style로 `deno test` 안에서 돌린다                                                                                                                                                                                                              |
| esbuild 0.28.2, @luca/esbuild-deno-loader 0.11.1                                                                                    | packages/design/component-tests.ts, apps/shell/renderer               | Deno가 CSS Modules를 읽지 못해 공통 UI·SDK 테스트를 renderer와 같은 `local-css` loader로 한 bundle에 묶어 happy-dom에서 돌린다. 공개 token CSS·로컬 woff2와 string·subpath package exports도 함께 resolve한다                                                                                                                          |
| node-pty 1.1.0                                                                                                                      | apps/shell/terminal-host                                              | 사람 shell의 POSIX PTY와 Windows ConPTY. 1.1.0 prebuild는 darwin·win32뿐이고 linux와 Electron 44(Node 24.21, modules 149)용은 없다. install이 현재 Node용으로 node-gyp하고 `npm run rebuild`(`@electron/rebuild` 4.2.0)가 Electron 헤더로 다시 만든다. renderer는 이 모듈을 부르지 않는다                                              |
| @xterm/xterm 6.0.0, @xterm/addon-fit 0.11.0 | apps/shell/renderer/terminal | 터미널 탭 표시와 칸 크기 맞춤. 링크·clipboard addon은 쓰지 않고 OSC 8·52는 parser에서 먹는다. xterm.css는 desktop entry가 묶고 license 주석은 bundle 옆 `.LEGAL.txt`로 간다. shell CSP가 inline style을 막아 xterm이 넣는 `<style>`은 constructable stylesheet로 옮긴다 |
| @electron/rebuild 4.2.0                                                                                                             | apps/shell/main                                                       | node-pty native module을 Electron 44.5.1 ABI로 다시 빌드한다. 그 판의 prebuild가 없기 때문이다                                                                                                                                                                                                                                         |
| js-tiktoken 1.0.21                                                                                                                  | packages/coding-agent/mcp-server                                      | discovery schema의 token 수를 cl100k_base로 재측정한다(coding-agent/mcp-server#R4). Sentry MCP가 같은 encoding을 쓴다. 순수 JS라 npm 반입이 가볍다                                                                                                                                                                                     |

MCP discovery schema의 token 재측정(coding-agent/mcp-server#R4)은
`npm:js-tiktoken@1.0.21`의 cl100k_base encoding으로 잰다. Sentry MCP가 JSON
schema를 model이 읽는 token 수로 재는 것이 원 기준이고, lockfile이 frozen이라
판을 `deno.lock`으로 고정했다. 배포 테스트
`packages/coding-agent/mcp-server/measure_tokens_test.ts`가 이 encoding으로
전·후 token 수를 남긴다.

## check 명령 하나

저장소 루트의 `deno task check`가 모든 관문이다. 모든 작업은 이것을 통과해야
끝난다. skeleton slice가 이 명령을 만들기 전까지는 `deno check`, `deno test`,
`node tools/check-docs.ts`를 직접 돌린다.

1. `deno fmt --check`, `deno lint` (대상은 코드다. `docs/`의 Markdown은
   check-docs가 맡아 빼고 둔다)
1. 의존 규칙 검사(code-map의 import 방향, 이름 금지 규칙)
1. contract coverage(architecture 5장의 경로·event가 contracts에 있는지,
   `deno task contracts:coverage`)
1. `deno check` (Deno workspace 전체)
1. `deno test` (단위·통합)
1. `npm --prefix apps/shell/main run check` (tsc --noEmit, node --test)
1. `node tools/check-docs.ts`

E2E는 `deno task e2e`로 따로 돈다. flow는 `deno task e2e`가 켠 `LOPHN_E2E=1`과
화면이 있을 때만 돌고, `deno task check`의 test 단계에서는 건너뛴다.
`deno task check`의 test 단계는 `e2e/flows`를 빼고 돈다(Electron 실행 파일과
화면이 필요해서다). Playwright의 Electron 실행이 Deno에서 안 되면 `e2e/`에만
Node `package.json`을 두는 예외를 쓴다. E2E harness는 shell을 기본으로
`LOPHN_SHELL_HEADLESS=1`(창 숨김·offscreen)로 띄워 사람 화면에 창을 올리지 않는다.
사람이 직접 보려면 `LOPHN_SHELL_HEADLESS=0`을 준다. slice를 끝낼 때
돈다([tasks.md](tasks.md)).

메모리 상한이 자식 프로세스를 실제로 죽이는지 보는 테스트(`packages/platform/security/memory_limit_test.ts`)는
`LOPHN_MEMORY_KILL=1`일 때만 돈다. 커널이 fixture를 죽일 때마다 데스크톱에 메모리 부족 알림이 떠서
`deno task check`에서는 건너뛴다. 상한을 바꾼 PR은 `LOPHN_MEMORY_KILL=1 deno test --allow-all
packages/platform/security/memory_limit_test.ts`로 따로 돌린다.

응답 측정(`packages/platform/responsiveness/measure-scenario_test.ts`)은 실제 core를
임시 LOPHN_HOME으로 띄우고 warm-up 30초 뒤 대상별 1,000개 요청을 보내므로
무겁고, 사람 장치에서 여러 worker가 도는 동안엔 측정이 흔들린다.
`LOPHN_MEASURE=1`일 때만 돌고 `deno task check`의 test 단계에서는 건너뛴다.
측정 문서(responsiveness R8)를 고치거나 응답 목표·측정 방법을 바꾼 PR은
`LOPHN_MEASURE=1 deno test --allow-all
packages/platform/responsiveness/measure-scenario_test.ts`로 따로 돌려 보고를 본다.
harness 자체의 통계·목표 판정 논리는 빠른 단위 테스트
(`packages/platform/responsiveness/measure_test.ts`)가 맡아
`deno task check`에서 매번 돈다.

부하 측정(`packages/platform/responsiveness/measure-load_test.ts`)은 100,000파일
root scan·hash와 512MiB 묶음 준비, 10개 동시 승인 접수, 정체 대리를 각각·함께 걸고
같은 자료의 무부하 측정과 비교하므로 같은 `LOPHN_MEASURE=1` opt-in이다.
`LOPHN_MEASURE=1 deno test --allow-all
packages/platform/responsiveness/measure-load_test.ts`로 따로 돌린다.
앱 command가 core·invocation 기록을 기다리지 않는다는 R2 확인은 빠른 정적 테스트
(`tools/invocation-wait_test.ts`)가 맡아 `deno task check`에서 매번 돈다.

## 개발 환경

- `deno task dev`: core, agent runtime, app supervisor, shell을 개발 데이터
  root(`.dev-data/`)로 함께 띄운다. 실제 `~/.lophn`을 건드리지 않는다.
- `tools/fake-provider/`: Anthropic Messages, OpenAI Responses, Chat
  Completions의 필요한 부분을 흉내 내는 로컬 HTTP server. `fixtures/model/`의
  녹화 응답이나 script로 답한다. 테스트와 E2E는 실제 provider를 부르지 않는다.
- `fixtures/projects/`: 예시 project 폴더(Markdown 문서, 하위 폴더, 바깥에서
  고친 파일 경우).
- `fixtures/apps/`: 예시 앱. 할 일 앱, 캘린더 앱(command를 다른 앱과 agent가
  씀), rate limit 대시보드 앱(패널·카드), 일부러 깨지는 앱(문제 보고와 수리).
- 실제 provider로 확인할 때만 `LOPHN_LIVE_PROVIDER=1`과 사람의 계정을 쓴다.
- shell을 화면에 띄우지 않고 확인할 때는 `LOPHN_SHELL_HEADLESS=1`을 준다. main이
  만드는 창, 앱·overlay WebContentsView, confirmation window가 모두
  `show: false`와 `offscreen: true`로 만들어지고 show·focus와 tray는 건너뛴다.
  OS 전역 단축키(전역 팔레트)는 등록하지 않아 사용 불가가 되고, OS notification은
  올리지 않고 `headless os-notification not shown`만 log에 남긴다(`headless.ts`의 guard).
  `LOPHN_SHELL_SHOT_DIR`도 주면 창마다 첫 paint(`window-<n>-first.png`)와
  paint가 1.5초 멈춘 뒤 그림(`window-<n>-settled.png`)을 그 폴더에 쓴다.
  offscreen에서는 `capturePage()`가 실패하고 `--ozone-platform=headless`는
  Electron 44에서 segfault하므로 둘 다 쓰지 않는다. 변수는 main만 읽고 renderer에는
  넘기지 않는다. 데이터 root는 core 권한 검사를 지나도록 `mktemp -d`(0700)로 만든다.
  `LOPHN_SHELL_START=lophn`을 더 주면 첫 창이 런처 대신 lophn 공간(documents)부터 연다.
  `LOPHN_SHELL_START=conversation`은 같은 자리에서 대화 도크까지 열어 둔다.
  `LOPHN_SHELL_START=things-to-confirm`은 lophn 공간의 things-to-confirm부터 연다.
  `LOPHN_SHELL_START=contexts`(또는 `contexts:<ctx id>`)는 contexts부터(그 Focus까지) 연다.
  `LOPHN_SHELL_START=project:<prj id>`는 그 프로젝트 작업대부터 연다. headless에서는
  프로젝트 등록의 OS 폴더 선택기를 띄우지 않고, `LOPHN_SHELL_PICK_FOLDER`(temp 폴더)를
  주면 그 폴더만 고른 것으로 돌려준다.

  ```sh
  npm --prefix apps/shell/main run build && (cd apps/shell/renderer && deno task build)
  home=$(mktemp -d) shots=$(mktemp -d)
  LOPHN_HOME=$home LOPHN_SHELL_HEADLESS=1 LOPHN_SHELL_SHOT_DIR=$shots \
    apps/shell/main/node_modules/.bin/electron apps/shell/main/dist/main.cjs
  ```
  key를 저장소나 fixture에 넣지 않는다.
