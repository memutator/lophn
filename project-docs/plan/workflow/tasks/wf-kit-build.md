# wf-kit-build

kit의 판을 고정한 browser build를 만든다. artifact HTML이 `<script>` 한 줄로 불러 node 도표를 그린다. build 결과의 이름과 전역 API가 계약이다.

- 단위: kit (wave 3)
- 선행: wf-kit-graph
- 소유(이 task만 고친다):
  - `packages/shell/renderer/build.ts`
  - `packages/shell/renderer/artifact-kit/entry.tsx`(새 file)
- 읽을 것:
  - architecture: `project-docs/architecture/ui-kit.md`("사용자 앱에 닿는 길"은 이 build와 다른 길이다), `project-docs/architecture/artifact.md`("지키는 것"의 응답 CSP `script-src 'self'`, artifact 문서에는 token CSS만 insertCSS로 들어간다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - 코드:
    - `packages/shell/renderer/build.ts`(`entries`, `defaultEntries`, `build`, `assetPlugin`, `addPackage`, `mergeImports`. `mergeImports`는 `tools/wireframes/build.ts`도 import한다)
    - `packages/shell/renderer/desktop/entry.tsx`(entry 한 file의 모양)
    - `packages/design/components/data/chart/chart-frame.tsx`와 `data-table/data-state.tsx`(`GraphDiagram`이 요구하는 `onRetry`, `empty`)
    - `packages/design/wording/catalog/common.ts`의 `common.empty.not-ready`, `common.button.reload`
    - `packages/shell/main/desktop/wiring/appearance.ts`(artifact 문서에 token을 넣는 길)
  - 계약 task: `wf-kit-graph.md`(props), `wf-artifact-serve.md`(이 build를 `_lophn/kit.js`·`kit.css`로 내주는 쪽), `wf-role-text.md`(PM이 이 API를 쓰는 글)
- 계약:
  - 쓰는 것: `wf-kit-graph`의 `GraphDiagram`, renderer `build.ts`의 import map(deno-loader, CSS Modules 처리)
  - 내놓는 것(`wf-artifact-serve`와 `wf-role-text`가 기대는 것):
    - `build()`가 `<dist>/artifact-kit/entry.js`와 `entry.css`를 만든다. 형식은 IIFE(다른 entry는 esm이라 entry마다 format을 고를 수 있게 고친다). `entry.css`에는 component CSS만 있다(token은 artifact 문서에 이미 들어간다).
    - 전역 `window.LophnKit = { renderGraph(element: HTMLElement, props: { nodes: GraphNode[]; edges: GraphEdge[]; locale?: string; timeZone?: string }): void }`. 같은 element에 다시 부르면 갱신한다. `onRetry`, `empty` 같은 상태 prop은 entry가 기본값을 채운다. 다른 component는 내놓지 않는다(필요해지면 그때 더한다).
    - 판 고정: react와 d3 등은 repo가 잠근 판으로 묶인다. 사용자 앱의 `lophn-sdk:` 사본과 상관없다.
    - 제품 build(`deno run -A packages/shell/renderer/build.ts`)가 이 entry를 같이 만든다. 이름이 `desktop`·`overlay`·`secret-input` 폴더와 겹치지 않는다.

## 정한 것

실제로 한 번 돌려 보고 정했다(scratch에서 이 `build.ts`의 설정 그대로 `GraphDiagram`을 감싼 entry를 IIFE로 묶음).

- **새 bundler와 새 의존을 들이지 않는다.** 지금 `build.ts`의 esbuild와 `@luca/esbuild-deno-loader`, 그리고 design·renderer의 `deno.json`이 잠근 판(react 19.3.0, d3 등)을 그대로 쓴다. `entry`가 `@lophn/ui/data`를 import하면 import map이 풀어 준다. 판 고정은 repo의 `deno.lock`이 한다.
- **IIFE에서도 CSS는 `entry.css`로 나온다.** esbuild가 component의 `*.module.css`(`local-css`)를 JS와 같은 이름의 CSS로 낸다. `:root`나 `body` 같은 전역 규칙은 들어가지 않는다(`@lophn/ui/base.css`, `tokens.css`를 import하지 않으므로). 한 번 돌려서 확인했다.
- **minify하지 않는다.** CSS Modules의 class 이름이 `.chart_diagram` 꼴로 남아야 한다. minify하면 `.c` 같은 짧은 이름이 되어 AI가 쓴 artifact의 CSS와 부딪힌다. 크기는 JS 약 1.5 MB, CSS 약 23 KB다(wording catalog 전체와 react-dom이 대부분). 디스크에서 읽는 로컬 file이고 일반 file 상한(4 MiB) 안이다.
- **entry는 props에서 네 칸만 고른다**(`nodes`, `edges`, `locale`, `timeZone`). 나머지 키(`failed`, `loading` 등)는 넘길 수 없다. 근거: 계약의 API가 그렇고, 넘어온 값은 AI가 쓴 page에서 온다.
- **기본 상태 prop.** `onRetry`는 `() => globalThis.location.reload()`, `empty`는 `{ message: t("common.empty.not-ready"), action: { label: t("common.button.reload"), onSelect: 같은 reload } }`. 새 wording key를 만들지 않는다.
- **`window.LophnKit`은 `globalThis`에 건다.** 같은 element에 다시 부르면 `WeakMap<HTMLElement, Root>`의 root로 `render`를 다시 부른다(React가 갱신한다).

## 할 일

1. `packages/shell/renderer/build.ts`
   - `entries`(이름 배열)와 `defaultEntries`를 `{ in, out, dir, format }` 목록으로 바꾼다. 셋은 지금과 같다(`in: "<name>/entry.tsx"`, `out: <name>`, `dir: <name>`, `format: "esm"`). 넷째가 `{ in: "artifact-kit/entry.tsx", out: "entry", dir: "artifact-kit", format: "iife" }`다. `esbuild.build`는 `outdir: join(outdir, entry.dir)`, `format: entry.format`을 쓴다.
   - `build(outdir, entryPoints)`의 둘째 인자는 아무도 넘기지 않는다. 지우고 `entryPoints === defaultEntries` 분기도 같이 지운다.
   - 끝의 `index.html` 복사 루프는 shell 화면 셋(`desktop`, `overlay`, `secret-input`)만 돈다. kit에는 html이 없다.
   - `mergeImports`는 그대로 export한다(`tools/wireframes/build.ts`가 쓴다).
   - 이유: 다른 entry는 `<dir>/<name>.js`로 나가는데 계약은 `artifact-kit/entry.js`·`entry.css`라서 entry마다 dir·파일 이름·format을 고를 수 있어야 한다.
2. `packages/shell/renderer/artifact-kit/entry.tsx`(새 file)
   - `GraphDiagram`(`@lophn/ui/data`), `GraphNode`·`GraphEdge` type, `createRoot`(`react-dom/client`), `t`(`@lophn/wording`)를 import한다. 위 "정한 것"대로 `renderGraph`를 만들어 `globalThis.LophnKit`에 건다. 파일 위쪽 주석에 "왜"만 쓴다: 봉한 artifact view는 kit을 import하지 못해서 판을 고정한 build를 가상 path로 받는다(`architecture/artifact.md`).
   - CSS import는 두지 않는다. component가 import하는 CSS Modules가 `entry.css`가 된다.
3. 돌려서 확인한다
   - `deno run -A packages/shell/renderer/build.ts`가 선다.
   - `ls packages/shell/renderer/dist/artifact-kit`에 `entry.js`와 `entry.css`가 있고, `dist/desktop/desktop.js`·`dist/overlay`·`dist/secret-input`은 이전과 같은 이름으로 있다.
   - `node --check packages/shell/renderer/dist/artifact-kit/entry.js`가 통과하고 `grep -c LophnKit`가 1 이상이다. `entry.js`가 `(() => {`로 시작하는 IIFE이고 최상위 `import`·`export`가 없는지 본다.
   - `entry.css`에 `:root`, `body`, `html`, `*` 선택자가 없다.
   - 브라우저로 띄워 보는 확인은 하지 않는다(사람에게 묻는 일이다). 실제 화면은 `wf-artifact-serve`가 land한 뒤 lead가 본다.
4. gallery는 건드리지 않는다. 이 task는 design component를 더하지 않고 `GraphDiagram`의 gallery는 `wf-kit-graph`가 고쳤다.

## 끝남

- `deno task check`가 통과한다(renderer `deno check`에 `artifact-kit/entry.tsx`가 든다).
- `deno run -A packages/shell/renderer/build.ts`가 통과하고 위 "돌려서 확인한다"가 모두 맞다. `check:full`은 이 build를 보지 않는다.
- 위험 test: 없음(build 결과와 전역 API다. 판 고정은 `deno.lock`이, artifact 경계는 `wf-artifact-source`·`wf-artifact-serve`가 지킨다).
- 남지 않음: `grep -n "entryPoints ===" packages/shell/renderer/build.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(예상). 있으면 적는다.
- 안 쓰게 된 export: `build()`의 둘째 인자(지움)
- 정한 것: 문서에 답이 없어 worker가 정한 것, 그리고 build 결과 크기(`entry.js`, `entry.css`)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 실제 artifact 안에서 그려 보지 않았다. 없으면 "없음"
