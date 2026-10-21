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
  wording/  (package @lophn/wording)          문구 catalog와 t()
        │ workspace import (repo 안)
        ├──────────────────────────────▶ packages/shell/renderer   lophn 화면
        │                                   parts/<component>/      lophn 전용 부품(Avatar, VendorIcon, TabStrip)
        │ 판 고정 사본(lophn-sdk:)
        └──────────────────────────────▶ 사용자 앱 src/screens/    @lophn/ui/<분류>로 import
packages/sdk/app-ui  (package @lophn/app-ui)  앱 bridge를 쓰는 UI만: ToolButton, useTool, AppErrorBoundary

tools/wireframes  (gallery)                   사람이 보고 승인하는 곳. 실제 component를 import만 한다
  pages/kit/<분류>/      분류마다 page 하나. 그 분류 mod.ts의 component를 상태별로 그린다
  pages/kit/tokens/, pages/kit/app-ui/
  pages/screens/<영역>.tsx + 하위 폴더       renderer 화면을 mock data로 고정한 page
  mock/                  가짜 data, mount 뒤 상태를 고정하는 drive(mock/drive.ts)
  drafts/                승인 전 실험. CSS는 여기서만
  pages/index.ts         GROUPS(Kit · Screens · Drafts > 영역 > page)
```

- package export(`packages/design/deno.json`): `.`(token), `./primitives`, `./input`, `./layout`, `./navigation`, `./data`, `./feedback`, `./overlay`, `./reading`, `./shared`, `./base.css`, `./tokens.css`. 분류를 건너 한꺼번에 내는 barrel은 없다.
- chart(LineChart, BarChart, DistributionChart, ScatterChart, GraphDiagram)는 `components/data/chart/`이고 `@lophn/ui/data`로 나간다. d3는 design `deno.json`의 의존이다.

## 무엇을 어디에 두나

기준은 범용성이다. "사용자 앱도 그대로 쓸 만한가."

| 경우 | 위치 | 예 |
|---|---|---|
| 범용 | `packages/design/components/<분류>/` | Button, Dialog, DataTable, AppShell, Sidebar, FilterBar, ReadState, ToastProvider |
| lophn만의 뜻(session, agent, harness·provider, 대기 질문)이 이름이나 동작에 박힘 | `packages/shell/renderer/parts/` 또는 그 화면 폴더 | Avatar(agent profile icon 집합의 정본), VendorIcon, TabStrip(점이 session 상태), model picker |
| lophn과의 약속(tool 호출 `lophnApp.callTool`, `lophn:render-error` event)을 앎 | `packages/sdk/app-ui` | ToolButton, useTool, AppErrorBoundary |
| 쓰는 곳이 gallery뿐 | 두지 않는다 | (지운 것: Chip, AuthorMark, LauncherFrame, OverviewFrame) |

분류 안 component 폴더는 tsx, module.css, 보조 file을 같이 둔다(`components/overlay/dialog/dialog.tsx`). 분류 `mod.ts`의 `export { … } from` 문 하나가 component 하나(와 그 Props)이고, 값을 내보내는 문마다 바로 윗줄에 "언제 쓰나" 한 줄(`// …`)이 있다. 비슷한 것과 갈리는 지점을 쓴다(Popover와 Menu, Dialog와 Sheet, Table과 DataTable). 이 줄들이 kit의 목록이다. agent는 분류 이름 8개로 찾아 들어가 `mod.ts`를 읽는다.

## import 방향

- `tools/check-deps.ts`의 `PACKAGE_DEPENDENCIES`: `design: []`, `sdk: [protocol, design]`, `shell: [protocol, base, design]`. design은 renderer·sdk를 모르고, shell은 sdk를 모르고, sdk는 shell을 모른다.
- design 안 file끼리는 component file을 상대 경로로 직접 가리킨다. 분류 `mod.ts`나 package 이름(`@lophn/ui/...`)을 거치지 않는다. `data/mod.ts` → `chart/chart-frame.tsx` → `@lophn/ui/data` 같은 순환이 생기기 때문이다.
- CSS는 token 변수만 쓴다(`packages/design/style-check`가 `packages/design/`, `packages/shell/renderer/`, `packages/sdk/*/`를 본다).
- 사람이 고른 appearance는 같은 token 변수를 덮어써서 모든 문서와 사용자 앱에 닿는다. 흐름과 값은 `architecture/appearance.md`다.

## 사용자 앱에 닿는 길

1. 앱 template(`packages/core/apps/packages/template/app/deno.json.tmpl`)이 `@lophn/ui`(root와 sub-path 11개)와 `@lophn/app-ui`, `@lophn/wording`, `@lophn/blueprint`를 `lophn-sdk:<name>@1.0.0/<경로>`로 적는다. 사본 안 component가 bare import하는 npm 의존(react, radix, lucide, `@lezer/markdown`, catppuccin icon json, d3)도 같은 판으로 적는다. 앱의 import map이 사본 안 bare import까지 풀기 때문이다.
2. `lophn-sdk:` 값은 data root의 설치 사본 `sdk/<이름 뒤쪽>/<판>`(`packageInstallPath`, 예: `sdk/ui/1.0.0`)을 가리킨다. 사본은 read-only다(file 0444, 폴더 0555).
3. 화면 build(`releases/ui-build/build.ts`)는 `FIXED_UI_DEPENDENCIES`(`@lophn/blueprint`, `@lophn/ui`, `@lophn/app-ui`, `@lophn/wording`, `react`, `react-dom`)를 esbuild `external`로 둔다. `@lophn/ui/overlay` 같은 sub-path도 같이 external이다. 이 밖의 package는 build가 거절한다.
4. release 준비(`releases/prepare/from-source.ts`)가 잠근 import의 설치 사본을 `readSdkCopies`로 읽어 release bundle에 굳힌다. 실행 중인 앱은 그 bundle의 사본만 본다.
5. 앱을 고치는 agent는 template의 `AGENTS.md`(lophn-managed 절)에서 화면 component는 `@lophn/ui/<분류>`, 앱 bridge component는 `@lophn/app-ui`, 앱 CSS는 `tokens.css`의 변수만 쓰라고 안내받는다.

이 길이 지키는 것은 "사용자가 고친 것이 shell을 깨지 않고, lophn의 UI update가 사용자 앱을 깨지 않는다"다.
- 사용자 변경 → shell: shell은 repo의 design만 import하고 sdk·앱을 모른다. 설치 사본은 read-only다.
- lophn update → 실행 중인 앱: 앱은 판을 고정하고, release bundle에 굳힌 사본으로 돈다.
- 사용자가 component를 고치려면 그 file을 앱 `src/`로 복사해 쓴다. 복사한 file은 앱 것이라 lophn의 UI update가 닿지 않는다. 별도 eject 도구는 없다.

설치 사본과 앱 template은 core 기동(`main/daemon/wiring/sdk-install.ts`)이 repo의 `packages/`에서 깐다. 같은 byte면 그대로 두고 다르면 지우고 다시 쓴다. 사본 밖 protocol을 가리키는 sdk(blueprint, cap-store, cap-problem)는 그 file을 사본 안 `vendor/`에 담고 specifier를 바꾼다. release bundle은 npm package의 `node_modules/<이름>` symlink를 따라 복사하지 않고 목록(`node_modules/.lophn-links.json`)으로 굳히며, bundle 사본을 봉인할 때 연결을 다시 만든다.

내장 sdk는 package catalog에 등록하지 않는다. coding agent는 import map이 가리키는 설치 사본의 `guide.md`를 읽는다. coding agent의 `package list`·`package show`는 사용자 package 몫이다. 모든 role의 `package.list`는 `builtin` 칸에 설치 사본의 `@lophn/*` 이름과 판을 싣고, `package.get`은 `@lophn/` 이름이면 설치 사본의 판과 guide를 읽는다(route `packages.builtin`). `@lophn/ui`는 `guide.md`가 없어 분류 `mod.ts`의 export 이름과 "언제 쓰나" 줄을 분류별로 모아 guide로 준다.

## gallery가 정본이다

- gallery는 실제 component를 import만 한다. renderer 화면은 fake source와 `mock/` data로 상태 하나를 고정해 그린다(`mock/drive.ts`가 mount 뒤 단추를 눌러 사람이 한 것처럼 만든다). 그래서 화면 모양을 고친다는 것은 design이나 renderer component를 고친다는 뜻이다.
- 사람은 Kit 묶음(분류마다 page 하나)을 보고 component 모양과 분류를 승인한다. 다르게 보면 그 component만 옮긴다.
- 묶음 셋이 구현 여부를 말한다. Kit은 design의 실제 component, Screens는 renderer를 import한 화면, Drafts는 아직 renderer에 없는 실험이다. 구현 여부를 손으로 적는 badge는 없다.
- page 목록은 영역 file 한 곳에 적는다. 영역 file(`pages/kit/<분류>/index.tsx`, `pages/screens/<영역>.tsx`, `drafts/index.tsx`)이 자기 page의 `{ id, title, description, render }`를 내고 `pages/index.ts`의 `GROUPS`가 모은다. Kit은 본문에 바로 그리고 Screens·Drafts는 iframe(`?frame=<id>`)에 그린다.

## 지키는 check

`deno task check`의 step `kit`(`tools/check-kit.ts`)이 셋을 본다.

1. `tools/wireframes`의 CSS file은 `drafts/` 안과 gallery 자신의 틀 둘(`gallery.module.css`, `pages/kit/kit.module.css`)에만 있다. 스타일을 새로 쓰는 순간이 component를 새로 만드는 순간이라 복사본 금지를 가장 단순하게 잡는다. 무대 배치처럼 몇 줄이면 token 변수를 쓴 inline style로 쓴다.
2. 분류 `mod.ts`가 값으로 내보내는 PascalCase 이름(component, Context, Provider)마다 `pages/kit/` 아래 file에 한 번은 나온다. 상수, helper 함수, hook, type(`export type { … }` 문 포함)은 세지 않는다.
3. design의 `.tsx`는 분류 폴더(8개와 `_shared`) 안에만 있고, `components/` 바로 아래에는 분류 폴더와 `css-modules.d.ts`뿐이다. 분류 `mod.ts`의 값을 내보내는 문마다 윗줄이 `//` 한 줄이다.

check가 못 잡는 것: 이름이 kit page의 import나 주석에만 있어도 "나온다"로 센다. 상태별로 다 그렸는지는 사람이 승인 때 본다.

## 하지 않는 것

preview, slot, eject CLI, 앱 CSS 검사. (shell theme과 token override는 appearance로 했다: `architecture/appearance.md`. 사람이 고르는 preset만 있고 사용자가 token을 직접 쓰는 길은 없다.) 사용자가 복사해 간 file은 사용자 것이다.
