---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# 기술 스택과 개발 환경

판은 처음 뼈대를 만들 때 그때의 최신 안정판으로 정하고 lockfile로 고정한다. 정한 판은 contracts 팀이 skeleton 첫 작업(contracts#T1) PR에서 이 문서에 적는다(예: Deno 2.9.7, zod 4.6.5). 판을 올리는 것은 별도 작업이다.

## 판

| 것 | 판 |
|---|---|
| Deno | 2.9.7 |
| zod | 4.6.5 |
| @std/assert | 1.0.19 |
| Electron | 44.5.1 |
| esbuild | 0.28.2 |
| TypeScript | 7.0.2 |
| @types/node | 24.19.1 |
| React | 19.3.0 |
| react-dom | 19.3.0 |

## 고른 것

| 영역 | 고른 것 | 비고 |
|---|---|---|
| 언어 | TypeScript strict | 모든 코드 |
| core, worker, agent runtime, 앱, CLI, MCP | Deno 2 | Deno workspace 하나 |
| shell | Electron, Node 24 LTS | `apps/shell/main`만 npm과 package-lock. 이전 lophn은 Electron 44 |
| ledger, 앱 DB, derived store | SQLite (Deno의 `node:sqlite`), WAL, FTS5 | |
| renderer, SDK UI | React, CodeMirror 6 | 이전 lophn shell과 같다 |
| 터미널 | xterm.js, node-pty(ConPTY) | |
| schema | Zod 한 가지 | contracts와 경계 검사. 예외: 앱이 import하는 blueprint 검증기는 의존성 없는 순수 TS(`packages/contracts/apps/blueprint.ts`, `@lophn/blueprint`가 다시 내보냄) |
| format, lint | `deno fmt`, `deno lint` | 저장소 전체(npm 쪽 포함) |
| 테스트 | `deno test`; shell main은 `node --test`; E2E는 Playwright(Electron) | |
| secret | OS keychain | 평문 금지 |

의존성을 더할 때는 이 표나 아래 목록에 이유와 함께 적는다. 같은 일을 하는 라이브러리를 둘 들이지 않는다.

| 의존성 | 쓰는 곳 | 이유 |
|---|---|---|
| picomatch | documents/file-tracking | tracking 규칙의 glob |
| ignore | documents/file-tracking | `.gitignore` 모양 제외 규칙 |
| QuickJS WASM (sync 빌드 하나) | documents/formats | format 검사 코드를 격리해 돌린다 |
| parse5 | documents/formats의 HTML format 묶음 안 | HTML 문서 해석 |
| electron 44.5.1 | apps/shell/main | shell 창과 sandbox preload. 이전 lophn과 같은 판 |
| esbuild 0.28.2 | apps/shell/main, apps/shell/renderer | main과 preload 세 개를 CJS 한 파일로 묶고, renderer entry 세 개를 브라우저 bundle로 묶는다. sandbox preload의 외부 require는 `electron`만 남기고, renderer의 CSS Modules는 `local-css` loader가 클래스 맵으로 바꾼다 |
| typescript 7.0.2 | apps/shell/main | `erasableSyntaxOnly`로 main과 preload를 typecheck한다. Deno 쪽은 Deno가 품은 TypeScript를 쓴다 |
| @types/node 24.19.1 | apps/shell/main | Node 24 타입. shell main만 Node에서 돈다 |
| zod 4.6.5 | apps/shell/main | Deno workspace와 같은 판. `packages/contracts`·`packages/base`의 `.ts` 원본이 import한 zod를 main bundle이 이 node_modules에서 resolve한다 |
| react 19.3.0, react-dom 19.3.0 | apps/shell/renderer | shell·overlay·confirmation renderer. Deno workspace에서 `npm:`으로 고정한다 |
| @types/react 19.3.0 | apps/shell/renderer | React 19는 타입을 함께 싣지 않는다. JSX 타입은 `jsxImportSourceTypes`로 이 패키지를 가리킨다 |
| @luca/esbuild-deno-loader 0.11.1 | apps/shell/renderer | renderer bundle이 Deno import map과 `npm:`·`jsr:`를 esbuild로 resolve한다. CSS Modules를 만들려면 esbuild loader가 필요하고, deno bundle은 클래스 맵을 만들지 않는다 |
| intl-messageformat 12.1.2 | packages/design/wording | en 문구의 ICU MessageFormat, placeholder와 plural |
| postcss 8.5.28 | packages/design/style-check | CSS AST와 source 줄을 읽어 token-only 검사를 `deno test`에서 돌린다. stylelint는 들이지 않는다 |
| postcss-value-parser 4.2.0 | packages/design/style-check | 선언과 media 값의 함수·단위·token 참조를 검사하여 regex만으로 CSS 값을 해석하지 않는다 |
| @radix-ui/react-select 2.3.7, @radix-ui/react-tabs 1.1.21, @radix-ui/react-checkbox 1.3.11, @radix-ui/react-switch 1.3.7 | packages/design/components | 선택·탭·checkbox·switch의 열고 닫기, 키보드, focus 복귀를 검증된 primitive로 둔다(shell/design-system#R43). React는 renderer와 같은 19.3.0 한 벌로 묶는다 |
| @radix-ui/react-tooltip 1.2.16, @radix-ui/react-popover 1.1.23, @radix-ui/react-dropdown-menu 2.1.24, @radix-ui/react-dialog 1.1.23 | packages/design/components | tooltip·popover·menu·dialog·sheet·palette의 열고 닫기, 바깥 click·Escape·focus 이동 닫기, focus 복귀를 검증된 primitive로 둔다(shell/design-system#R33, R43). tooltip 지연과 toast 시간은 주입한 timer로 재고 Radix 내부 timer를 쓰지 않는다. toast는 끌 수 없는 live region과 내부 timer 때문에 Radix Toast를 들이지 않고 직접 그린다 |
| lucide-react 1.51.0 | packages/design/components | 한 벌의 아이콘을 선 1.5, 14·16·20px로 쓴다(shell/design-system#R43) |
| @lezer/markdown 1.7.2 (@lezer/common 1.5.3, @lezer/highlight 1.2.5를 함께 끌어온다) | packages/design/reading | Markdown 읽기 renderer의 parser. 편집기(CodeMirror 6)와 같은 Lezer Markdown 하나로 읽기·편집 위치 차이를 줄이고 parser를 둘 들이지 않는다. tree를 React 글과 element로만 그려 HTML을 실행하지 않는다. marked·HTML parser는 들이지 않는다 |
| d3-scale 4.0.2, d3-shape 3.2.0 | packages/sdk/ui-chart | 여섯 차트의 scale·tick·선 경로 계산만 맡긴다(shell/design-system#R12, apps/sdk#R17). DOM은 React SVG로 그리고 script·HTML renderer는 들이지 않는다 |
| @types/d3-scale 4.0.9, @types/d3-shape 3.2.0 | packages/sdk/ui-chart | 고정한 d3 계산 API의 TypeScript 타입 |
| happy-dom 20.14.5 | packages/design/component-tests.ts, apps/shell/renderer/build_test.ts | 공통 컴포넌트·SDK 옆 `*_test.tsx`와 실제 공개 예제 bundle을 DOM·event·keyboard·computed style로 `deno test` 안에서 돌린다 |
| esbuild 0.28.2, @luca/esbuild-deno-loader 0.11.1 | packages/design/component-tests.ts, apps/shell/renderer | Deno가 CSS Modules를 읽지 못해 공통 UI·SDK 테스트를 renderer와 같은 `local-css` loader로 한 bundle에 묶어 happy-dom에서 돌린다. 공개 token CSS·로컬 woff2와 string·subpath package exports도 함께 resolve한다 |

## check 명령 하나

저장소 루트의 `deno task check`가 모든 관문이다. 모든 작업은 이것을 통과해야 끝난다. skeleton slice가 이 명령을 만들기 전까지는 `deno check`, `deno test`, `node tools/check-docs.ts`를 직접 돌린다.

1. `deno fmt --check`, `deno lint` (대상은 코드다. `docs/`의 Markdown은 check-docs가 맡아 빼고 둔다)
1. 의존 규칙 검사(code-map의 import 방향, 이름 금지 규칙). 나중에 contract coverage도 더한다
2. `deno check` (Deno workspace 전체)
3. `deno test` (단위·통합)
4. `npm --prefix apps/shell/main run check` (tsc --noEmit, node --test)
5. `node tools/check-docs.ts`

E2E는 `deno task e2e`로 따로 돈다. Playwright의 Electron 실행이 Deno에서 안 되면 `e2e/`에만 Node `package.json`을 두는 예외를 쓴다. slice를 끝낼 때 돈다([tasks.md](tasks.md)).

## 개발 환경

- `deno task dev`: core, agent runtime, app supervisor, shell을 개발 데이터 root(`.dev-data/`)로 함께 띄운다. 실제 `~/.lophn`을 건드리지 않는다.
- `tools/fake-provider/`: Anthropic Messages, OpenAI Responses, Chat Completions의 필요한 부분을 흉내 내는 로컬 HTTP server. `fixtures/model/`의 녹화 응답이나 script로 답한다. 테스트와 E2E는 실제 provider를 부르지 않는다.
- `fixtures/projects/`: 예시 project 폴더(Markdown 문서, 하위 폴더, 바깥에서 고친 파일 경우).
- `fixtures/apps/`: 예시 앱. 할 일 앱, 캘린더 앱(command를 다른 앱과 agent가 씀), rate limit 대시보드 앱(패널·카드), 일부러 깨지는 앱(문제 보고와 수리).
- 실제 provider로 확인할 때만 `LOPHN_LIVE_PROVIDER=1`과 사람의 계정을 쓴다. key를 저장소나 fixture에 넣지 않는다.
