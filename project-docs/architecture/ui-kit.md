# ui-kit

lophn이 내놓는 범용 UI component가 어디 있고 어떻게 화면(renderer)과 사용자 앱에 닿는지, 사람이 그것을 어디서 보고 승인하는지를 다룬다. 흐름은 token → design(`@lophn/ui`) → renderer·sdk → 앱 UI build → gallery다.

## 모양

```
packages/design  (package @lophn/ui)          범용 kit. 사용자 앱도 그대로 쓸 만한 것만
  tokens.ts → generate.ts → generated/tokens.css, generated/vars.ts
  presets.ts, appearance.ts                   사람이 고르는 색·글꼴·크기·밀도 preset과 그것을 token 덮어쓰기 CSS로 만드는 함수
  mod.ts                                      root export: tokens, tokenNames, vars, appearance(preset, appearanceCss)
  base.css                                    기본 글꼴과 바탕
  components/<분류>/<component>/              분류 8개: primitives input layout navigation
  components/<분류>/mod.ts                               data feedback overlay reading
  components/_shared/                         지원 export(componentMark, Clock, Timer, Clipboard, ResizeSource …)
  i18n/  (package @lophn/i18n)                문구 catalog와 t(), translator(locale). @formatjs/intl 위의 얇은 층
        │ workspace import (repo 안)
        ├──────────────────────────────▶ packages/shell/renderer   lophn 화면
        │                                   parts/<component>/      lophn 전용 부품(Avatar, VendorIcon, TabStrip)
        │ 판 고정 사본(file:)
        └──────────────────────────────▶ 사용자 앱 src/screens/    @lophn/ui/<분류>로 import
packages/sdk/app-ui  (package @lophn/app-ui)  앱 bridge를 쓰는 UI만: ToolButton, useTool, usePlace, AppErrorBoundary

tools/wireframes  (gallery)                   사람이 보고 승인하는 곳. 실제 component를 import만 한다
  pages/kit/<분류>/      분류마다 page 하나. 그 분류 mod.ts의 component를 상태별로 그린다
  pages/kit/tokens/, pages/kit/app-ui/
  pages/screens/<영역>.tsx + 하위 폴더       renderer 화면을 mock data로 고정한 page
  mock/                  가짜 data, mount 뒤 상태를 고정하는 drive(mock/drive.ts)
  drafts/                승인 전 실험. CSS는 여기서만
  pages/index.ts         GROUPS(Kit · Screens · Drafts > 영역 > page)
```

- package export(`packages/design/package.json`): `.`(token), `./primitives`, `./input`, `./layout`, `./navigation`, `./data`, `./feedback`, `./overlay`, `./reading`, `./shared`, `./base.css`, `./tokens.css`. 분류를 건너 한꺼번에 내는 barrel은 없다.
- chart(LineChart, BarChart, DistributionChart, ScatterChart, GraphDiagram)는 `components/data/chart/`이고 `@lophn/ui/data`로 나간다. d3는 design `package.json`의 의존이다.
- `GraphDiagram`의 node는 `status`(label, tone)와 짧은 `note`를 받는다. tone은 `tokens.status`의 key이고 아이콘에만 색을 쓴다. component는 상태 값의 뜻을 모른다. 뜻은 그리는 쪽(workflow artifact, domain)이 정한다.
- `GraphDiagram`의 되돌아가는 edge(도착 층이 출발 층보다 앞)는 node 줄 위 여백으로 돌려 그린다(`graph-layout.ts`). edge마다 여백에 줄 하나를 더하고, 출발 node 위에서 나가 그 줄을 지나 도착 node 위로 들어간다. 출발이나 도착 node 위에 같은 층의 다른 node가 있으면 그 끝은 옆 면에서 층 사이 틈으로 돈다. 사이 node 뒤로 지나면 첫 step으로 돌아가는지 사이 step으로 가는지 가르지 못한다.

## 무엇을 어디에 두나

기준은 범용성이다. "사용자 앱도 그대로 쓸 만한가."

| 경우 | 위치 | 예 |
|---|---|---|
| 범용 | `packages/design/components/<분류>/` | Button, Dialog, DataTable, AppShell, Sidebar, FilterBar, ReadState, ToastProvider |
| lophn만의 뜻(session, agent, harness·provider, 대기 질문)이 이름이나 동작에 박힘 | `packages/shell/renderer/parts/` 또는 그 화면 폴더 | Avatar(agent character SVG와 profile 표시), VendorIcon, TabStrip(점이 session 상태), model picker |
| lophn과의 약속(tool 호출 `lophnApp.callTool`, 열린 자리·인자·workspace `lophnApp.place`, `lophn:render-error` event)을 앎 | `packages/sdk/app-ui` | ToolButton, useTool, usePlace, AppErrorBoundary |
| 쓰는 곳이 gallery뿐 | 두지 않는다 | (지운 것: Chip, AuthorMark, LauncherFrame, OverviewFrame) |

분류 안 component 폴더는 tsx, module.css, 보조 file을 같이 둔다(`components/overlay/dialog/dialog.tsx`). 분류 `mod.ts`의 `export { … } from` 문 하나가 component 하나(와 그 Props)이고, 값을 내보내는 문마다 바로 윗줄에 "언제 쓰나" 한 줄(`// …`)이 있다. 비슷한 것과 갈리는 지점을 쓴다(Popover와 Menu, Dialog와 Sheet, Table과 DataTable). 이 줄들이 kit의 목록이다. agent는 분류 이름 8개로 찾아 들어가 `mod.ts`를 읽는다.

## import 방향

- `tools/check-deps.ts`의 `PACKAGE_DEPENDENCIES`: `design: []`, `sdk: [protocol, design]`, `shell: [protocol, base, design]`. design은 renderer·sdk를 모르고, shell은 sdk를 모르고, sdk는 shell을 모른다.
- design 안 file끼리는 component file을 상대 경로로 직접 가리킨다. 분류 `mod.ts`나 package 이름(`@lophn/ui/...`)을 거치지 않는다. `data/mod.ts` → `chart/chart-frame.tsx` → `@lophn/ui/data` 같은 순환이 생기기 때문이다.
- CSS는 token 변수만 쓴다(`packages/design/style-check`가 `packages/design/`, `packages/shell/renderer/`, `packages/sdk/*/`를 본다).
- 사람이 고른 appearance는 같은 token 변수를 덮어써서 모든 문서와 사용자 앱에 닿는다. 흐름과 값은 `architecture/appearance.md`다.
- design이 모르는 능력은 React context로 받는다. reading의 `CodeBlock`은 highlighter를 `HighlighterProvider`에서 받아 token 배열(`CodeToken`)을 span으로 그린다. shell desktop 창이 Shiki Worker(`packages/shell/renderer/highlight/`)를 주고, context가 없는 곳(사용자 앱, gallery의 다른 Row)은 plain이다. 색은 design token `code.*`(Shiki css-variables theme의 `--code-*` 변수와 같은 이름)다. 그래서 design은 shiki를 import하지 않고 앱 template의 의존도 늘지 않는다.

## 사용자 앱에 닿는 길

1. 앱 template(`packages/core/apps/packages/template/app/`)이 `@lophn/ui`(root와 sub-path 11개)와 `@lophn/app-ui`, `@lophn/declaration`을 `package.json`의 `file:.lophn/<설치 경로>`(`appSdkDependency`)로 적는다. 사본 안 component가 bare import하는 npm 의존(react, radix, lucide, `@lezer/markdown`, catppuccin icon json, d3)은 그 사본의 `package.json`이 정확한 판으로 갖고 있다.
2. 설치 사본은 data root의 `sdk/<이름 뒤쪽>/<판>`(`packageInstallPath`, 예: `sdk/ui/1.0.0`)에 있고 file 0444·폴더 0555다. `syncAppSdk`가 앱 `package.json`이 거는 사본을 앱 폴더의 `.lophn/sdk`로 복사한 뒤, lock이 있으면 `npm ci`, 없으면 `npm install`로 의존을 받는다. npm은 `node_modules/@lophn/*`를 `.lophn/sdk` 사본으로 잇는 symlink로 깔고, Node는 symlink의 실제 경로가 `node_modules` 밖일 때만 그 `.ts`를 돌린다. 사본의 npm 의존과 사본끼리의 `file:` 의존은 앱 `node_modules`에서 풀린다. release 준비는 staging에서 같은 일을 한다. agent shell의 `npm`은 의존을 까기 전에 사본을 먼저 맞춘다(`packages/core/apps/packages/npm-entry.ts`). 그래서 agent가 SDK 의존을 더한 뒤 바로 `npm install`이 그 사본을 찾는다.
3. 화면 build(`releases/ui-build/build.ts`)는 `FIXED_UI_DEPENDENCIES`(`@lophn/declaration`, `@lophn/ui`, `@lophn/app-ui`, `@lophn/agent`, `@lophn/i18n`, `react`, `react-dom`)를 esbuild `external`로 둔다. `@lophn/ui/overlay` 같은 sub-path도 같이 external이다. 이 밖의 package는 build가 거절한다.
4. release 준비(`releases/prepare/from-source.ts`)가 staging의 `.lophn/sdk` 사본과 `node_modules`(symlink는 `node_modules/.lophn-links.json` 목록)를 release bundle에 굳힌다. 실행 중인 앱은 그 bundle의 사본만 본다.
5. 앱을 고치는 agent는 template의 `AGENTS.md`(lophn-managed 절)에서 화면 component는 `@lophn/ui/<분류>`, 앱 bridge component는 `@lophn/app-ui`, 앱 CSS는 `tokens.css`의 변수만 쓰라고 안내받는다. 앱 화면 문구는 앱 코드에 그대로 쓴다. 앱은 사용자 한 사람이 쓰므로 번역 catalog가 없다.
6. `@lophn/ui`와 `@lophn/app-ui` 사본 안의 문구는 `@lophn/i18n`(그 의존으로 따라오는 사본)의 catalog에서 나온다. `@lophn/app-ui`는 앱 view 문서의 `<html data-lophn-locale>`(main이 dom-ready마다 적는다, `architecture/appearance.md`)로 locale을 고른다. 값이 없거나 그 locale의 catalog가 없으면 en이다.

이 길이 지키는 것은 "사용자가 고친 것이 shell을 깨지 않고, lophn의 UI update가 사용자 앱을 깨지 않는다"다.
- 사용자 변경 → shell: shell은 repo의 design만 import하고 sdk·앱을 모른다. 설치 사본은 read-only다.
- lophn update → 실행 중인 앱: 앱은 판을 고정하고, release bundle에 굳힌 사본으로 돈다.
- 사용자가 component를 고치려면 그 file을 앱 `src/`로 복사해 쓴다. 복사한 file은 앱 것이라 lophn의 UI update가 닿지 않는다. 별도 eject 도구는 없다.

설치 사본과 앱 template은 core 기동(`main/daemon/wiring/sdk-install.ts`)이 repo의 `packages/`에서 깐다. 같은 byte면 그대로 두고 다르면 지우고 다시 쓴다. 사본 밖 protocol을 가리키는 sdk(declaration, cap-store, cap-problem)는 그 file을 사본 안 `vendor/`에 담고 specifier를 바꾼다. vendor로 담은 package(`@lophn/protocol`)는 사본 `package.json`의 의존에서 뺀다. release bundle은 npm package의 `node_modules/<이름>` symlink를 따라 복사하지 않고 목록(`node_modules/.lophn-links.json`)으로 굳히며, bundle 사본을 봉인할 때 연결을 다시 만든다.

내장 sdk는 package catalog에 등록하지 않는다. 모든 workspace 종류의 `package.read` 목록은 `builtin` 칸에 설치 사본의 `@lophn/*` 이름과 판을 싣고, `@lophn/` 이름을 주면 설치 사본의 판과 guide를 읽는다(route `packages.builtin`). `@lophn/ui`는 `guide.md`가 없어 분류 `mod.ts`의 export 이름과 "언제 쓰나" 줄을 분류별로 모으고, 그 줄마다 props를 붙여 guide로 준다(`apps/packages/builtin.ts`). props는 같은 export 문이 내보내는 type(`SelectProps` 등)의 정의를 component source에서 주석째 옮긴 것이고, `extends`가 가리키는 같은 file의 type(`NativeInput` 등)도 붙인다. 내보낸 type이 없는 component는 `export function`의 인자 type이다. 쓰는 예는 싣지 않는다. 앱을 고치는 agent는 설치 사본을 file tool로 읽지 못해 이 guide가 props를 아는 길이다.

props는 guide 예산(`GUIDE_BUDGET_BYTES`, 20 KiB) 안에서만 붙고, 분류마다 한 번에 하나씩 돌아가며 배분한다. 그래서 컴포넌트가 늘어도 앞 알파벳 분류가 props를 다 가져가 뒤 분류가 사라지지 않는다. 예산 밖으로 밀린 props가 있는 분류에는 `- props 정의는 예산 밖이라 뺐다; ...` 한 줄이 남고, 이름·"언제 쓰나" 줄과 `import from` 줄은 분류마다 늘 있다. 뺀 props는 앱 폴더의 사본(`.lophn/sdk/ui/<판>/components/<분류>/**`)에서 읽는다. 예산은 `package.read` 한 창(`TEXT_MAX_BYTES`, 24 KiB)보다 작아 guide 색인과 예산 안의 props가 한 번에 온다. 그보다 긴 guide(`guide.md`를 쓰는 SDK)는 `package.read`가 창을 나눠 주고 `continuation.read_next`의 `offset_bytes`로 이어 받는다.

판이 바뀔 때 앱이 옮길 곳은 내장 skill `migrate-sdk`(`packages/core/agent-workspaces/skills/migrate-sdk/`)의 메모 file `<패키지 이름에서 @lophn/를 뺀 것>-<판>.md`에 쌓는다(예: `declaration-4.0.0.md`). 판 하나가 file 하나이고 무엇이 바뀌었나, `Breaking:`, 앞 판에서 옮기는 code before/after, `Previous:`(앞 판)를 적으며 지우지 않는다. SKILL.md는 절차 하나라 판이 늘어도 길어지지 않고, 앱 agent는 고정 판 뒤부터 지금 판까지의 메모만 `Previous:`를 따라 `skill.read`로 읽는다. 각 SDK와 지원 소스의 `package.json`에는 `lophn.supported_from`(lophn이 아직 돌리는 가장 옛 판)이 있다. 설치 사본은 `package.json`을 의존 경로만 바꿔 그대로 담으므로 이 칸도 사본에 남는다. 고정 판이 하한보다 옛것이면 앱은 못 뜨거나 곧 못 뜬다. 하한은 그 판으로 봉인한 bundle이 지금 core에서 뜨는지와 사본이 기대는 판이 설치돼 있는지로 정한다(예: `@lophn/declaration` 4.0.0은 `sizes`로 봉인한 bundle이 안 떠서, `@lophn/app-ui`는 4.0.0에 기대는 2.3.0부터다). 옛 판 사본은 data root에 따로 싣지 않으므로 하한 아래의 앱은 처음 다시 release할 때 옮긴다. `tools/check-sdk-notes.ts`(check의 `sdk notes` 단계)가 지금 판과 하한의 메모, 하한이 판보다 높지 않은 것, 메모 사슬을 본다. SDK 판을 올리면 메모를 같이 써야 check가 통과한다.

### SDK 상태와 감지

앱이 고정한 판과 지금 판의 차이는 read `app.sdk_status {app?}`(`lophn app sdk-status [<앱>]`, home·앱 workspace, 사람·agent·machine)가 낸다. 보관하지 않은 앱 중 켜진 release가 있는 앱마다 그 release에 봉인된 선언의 `sdk_dependencies`(정확한 판) 가운데 `@lophn/*`를 `{sdk, pinned, current(설치 사본의 가장 높은 판), supported_from, level, notes}`로 싣는다(계약 `packages/protocol/apps/sdk-status.ts`, 계산 `packages/core/apps/sdk-status/status.ts`). `level`은 `required`(고정 판 < 그 SDK 설치 사본 `package.json`의 `lophn.supported_from`), `available`(하한 이상이지만 지금 판보다 옛것), `current`다. `notes`는 `migrate-sdk` 메모 file 이름 가운데 고정 판 다음부터 지금 판까지를 판 순으로 낸 것이다(`Previous:` 사슬을 따르지 않고 file 이름으로 거른다). 설치 사본에 없는 SDK 이름은 견줄 수 없어 뺀다. 파일을 읽으므로 reader Worker가 아니라 메인 스레드 read다(`app.icon`·`app.skills`와 같다). 앱 범위와 archived는 다른 앱 read와 같은 `authorizeApp`이 거른다: 앱 workspace의 agent는 자기 앱만, archived 앱은 agent에게 없는 앱(`not_found`)이고 목록에서 빠진다.

감지는 core가 새 제품 판으로 켜질 때, 또는 설치된 SDK 판의 묶음이 지난 기동과 달라졌을 때(제품 판이 같아도) 한 번이다(`ctx.productStartListeners`의 `changed`·`sdksChanged`, `architecture/app-notice.md`의 "제품 판 marker"). 기동 중에 쓴 줄은 toast가 없다(`issues/shell.md`). 필수(`required`)나 가능(`available`) SDK가 있는 앱이 하나라도 있으면 앱 없는 program 줄 `sdk_update_needed` 하나를 쓴다(params `{required, available}`: 옮겨야 하는 앱 수와 필수는 없고 새 판만 있는 앱 수, 글은 "3 apps must update, 2 can use new SDK features."). key가 `sdk_update_needed`라 되풀이되는 기동이 줄을 늘리지 않고 그 줄을 새 개수로 바꿔 안 읽음으로 되돌린다. action은 `{kind: "open_home_skill", skill: "update-apps", args: ""}`다(전체). 앱마다 줄·단추를 두지 않는다: 각 앱을 두고 갈지 올릴지, 새 SDK 기능을 쓸지 보는 숲의 일은 home lophn이 하고 사람은 그 계획만 고른다. 앱마다 있던 옛 줄은 ledger에 남고 단추도 그대로 동작하지만 새로 쓰지 않는다. 지금 상태는 SDK 상태 read와 앱 상세 Version 탭이 말한다(줄을 닫는 일이 앱이 release를 끝내는 순간과 이어지지 않으면 어긋나므로, 어긋나지 않는 길을 둘 때까지 일부러 가만히 둔다). `lophn_updated` 줄에는 SDK 갱신 수를 싣지 않는다(이 줄과 겹친다). 맡기기는 Inbox 단추가 home lophn 대화를 `/update-apps`로 열고(앱 이름을 붙이면 그 앱만), home lophn이 `app.sdk_status`, 앱의 목적·공개 command(`app read`), 지나는 판의 메모로 앱마다 (a) 필수 migration, (b) 새 SDK 기능 중 이 앱에 쓸 만한 것(예: 한도를 넘으면 휘발 알림), (c) 그대로 두기를 정해 추천하고, 사람이 고른 앱에만 그 앱의 lophn에게 `reply: none`으로 넘긴다. 고른 기능은 앱 대화에서 사람과 확인하고 `design-app`으로 설계해 migration 뒤에 넣는다. home은 앱 source를 못 읽어 목적·command·메모로만 판단하고 자세한 것은 앱 lophn에게 맡긴다(내장 skill `update-apps`, `architecture/agent-call.md`의 private 예외).

## artifact에 닿는 길

봉한 artifact view는 모듈을 import하지 못하고 바깥 library도 받지 않는다(`architecture/artifact.md`). 그래서 kit을 판을 고정한 browser build 하나로 묶어 가상 path로 준다. 사용자 앱의 `.lophn/sdk` 사본과 상관없는 길이다.

1. 제품 build(`packages/shell/renderer/build.ts`)가 화면 셋(esm)과 함께 `artifact-kit/entry.tsx`를 IIFE로 묶어 `dist/artifact-kit/entry.js`와 `entry.css`를 낸다. 판은 repo의 lock이 잠근 그대로다. minify하지 않는다: CSS Modules의 class 이름이 `.chart_diagram` 꼴로 남아야 AI가 쓴 page의 CSS와 부딪히지 않는다. `entry.css`에는 component CSS만 있다. token은 artifact 문서에 appearance가 이미 넣는다.
2. 전역은 `LophnKit.renderGraph(element, {nodes, edges, locale?, timeZone?})` 하나다. 같은 element에 다시 부르면 갱신한다. 그 네 칸만 받고 상태 prop(`onRetry`, `empty`)은 entry가 채운다. 다른 component는 내놓지 않는다.
3. shell main의 봉한 scheme이 이 둘을 모든 artifact view에 `_lophn/kit.js`, `_lophn/kit.css`로 준다. artifact HTML은 plain `<script>`와 stylesheet로 부른다. 쓰는 법은 skill `write-artifact`에 있고, workflow artifact에만 걸린 것은 project workspace skill `write-workflow`에 있다.

check:full은 renderer build를 돌리지 않는다. kit을 바꾸면 `node packages/shell/renderer/build.ts`로 이 entry가 서는지 본다.

## gallery가 정본이다

- gallery는 실제 component를 import만 한다. renderer 화면은 fake source와 `mock/` data로 상태 하나를 고정해 그린다(`mock/drive.ts`가 mount 뒤 단추를 눌러 사람이 한 것처럼 만든다). 그래서 화면 모양을 고친다는 것은 design이나 renderer component를 고친다는 뜻이다.
- 사람은 Kit 묶음(분류마다 page 하나)을 보고 component 모양과 분류를 승인한다. 다르게 보면 그 component만 옮긴다.
- 묶음 셋이 구현 여부를 말한다. Kit은 design의 실제 component, Screens는 renderer를 import한 화면, Drafts는 아직 renderer에 없는 실험이다. 구현 여부를 손으로 적는 badge는 없다.
- page 목록은 영역 file 한 곳에 적는다. 영역 file(`pages/kit/<분류>/index.tsx`, `pages/screens/<영역>.tsx`, `drafts/index.tsx`)이 자기 page의 `{ id, title, description, render }`를 내고 `pages/index.ts`의 `GROUPS`가 모은다. Kit은 본문에 바로 그리고 Screens·Drafts는 iframe(`?frame=<id>`)에 그린다.

## 지키는 check

`npm run check`의 step `kit`(`tools/check-kit.ts`)이 셋을 본다.

1. `tools/wireframes`의 CSS file은 `drafts/` 안과 gallery 자신의 틀 둘(`gallery.module.css`, `pages/kit/kit.module.css`)에만 있다. 스타일을 새로 쓰는 순간이 component를 새로 만드는 순간이라 복사본 금지를 가장 단순하게 잡는다. 무대 배치처럼 몇 줄이면 token 변수를 쓴 inline style로 쓴다.
2. 분류 `mod.ts`가 값으로 내보내는 PascalCase 이름(component, Context, Provider)마다 `pages/kit/` 아래 file에 한 번은 나온다. 상수, helper 함수, hook, type(`export type { … }` 문 포함)은 세지 않는다.
3. design의 `.tsx`는 분류 폴더(8개와 `_shared`) 안에만 있고, `components/` 바로 아래에는 분류 폴더와 `css-modules.d.ts`뿐이다. 분류 `mod.ts`의 값을 내보내는 문마다 윗줄이 `//` 한 줄이다.

check가 못 잡는 것: 이름이 kit page의 import나 주석에만 있어도 "나온다"로 센다. 상태별로 다 그렸는지는 사람이 승인 때 본다.

## 하지 않는 것

preview, slot, eject CLI, 앱 CSS 검사. (shell theme과 token override는 appearance로 했다: `architecture/appearance.md`. 사람이 고르는 preset만 있고 사용자가 token을 직접 쓰는 길은 없다.) 사용자가 복사해 간 file은 사용자 것이다.
