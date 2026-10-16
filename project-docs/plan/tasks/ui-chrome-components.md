# ui-chrome-components

wireframe `chrome/`와 `vendors/`의 공용 부품 코드를 `packages/design`으로 그대로 옮긴다. 보고 다시 그리지 않는다. 옮길 것은 `TabStrip`, design `Toast`(단추를 오른쪽에), `FileIcon`, `VendorIcon`과 아이콘 자료, 글 넣는 칸의 focus 모양, menu 아이콘 칸이다. 이 부품이 쓰는 token도 여기서 모두 더한다(top-bar 몫인 창 token 포함). gallery는 옮긴 부품을 import하게 바꾼다.

- 단위: ui-chrome (wave 2)
- 선행: 없음. 단 이 task를 열기 전에 lead가 `packages/design/deno.json`의 `imports`에 `"@iconify-json/catppuccin/": "npm:/@iconify-json/catppuccin@1.2.17/"`를 더하고 `deno.lock`을 갱신해 둔다(`tools/wireframes/deno.json`에 이미 같은 줄이 있다). 없으면 멈추고 보고한다.
- 소유(이 task만 고친다):
  - `packages/design/components/` (새 폴더 `tab-strip/`, `file-icon/`, `vendor-icon/`. 고칠 것 `toast/`, `input/`, `select/`, `menu/`, `mod.ts`, `css-modules.d.ts`)
  - `packages/design/tokens.ts`
  - `packages/design/generated/` (tokens를 고친 뒤 `generate.ts`로 다시 만든다. 손으로 고치지 않는다)
  - `packages/shell/renderer/build.ts` (svg를 글로 읽는 loader 한 줄)
  - `tools/wireframes/frames/chrome/` (옮긴 file을 지운다. `window-api.ts`와 `title-bar.*`는 ui-chrome-top-bar가 다룬다)
  - `tools/wireframes/frames/vendors/` (전부 지운다)
  - `tools/wireframes/frames/compositions/**`의 import 줄만 (아래 목록)
  - wording의 common 영역 file에 key 셋 더하기만 (wording-split이 정한 file)
- 읽을 것:
  - spec: 없음
  - inventory: `U6.1#4`, `U6.1#5`, `U6.1#6`, `U6.1#7`, `U6.1#8`, `U6.1#9`, `U6.3#2`, `U6.3#3` (`../assignment.md`의 ui-chrome 줄. `U6.1#4`는 탭 안 알림을 toast로 띄우는 규칙이고 부품은 `Toast`다)
  - 결정: `../README.md` 2.3장 K6(UI 쪽은 구현까지, wireframe 코드를 그대로 옮김), 2.5장("보고 다시 그리지 않는다"), `../../dev/stack.md`의 "화면 아이콘 자료" 표
  - 본보기(화면):
    - `tools/wireframes/frames/chrome/tab-strip.tsx`, `tab-strip.module.css`
    - `tools/wireframes/frames/chrome/file-icon.tsx`
    - `tools/wireframes/frames/chrome/chrome.css`의 `--ctp-*` 변수와 글 넣는 칸 focus 규칙
    - `tools/wireframes/frames/vendors/vendor-icon.tsx`, `vendor-icon.module.css`, `*.svg`, `LICENSE`
    - `tools/wireframes/frames/compositions/waiting/waiting-toast.tsx`, `app-space/toast.tsx`, `project-files/notices.tsx`(단추가 오른쪽 끝인 toast look-alike 셋)
    - `tools/wireframes/frames/compositions/project-files/menu-icons.tsx`(menu 아이콘 칸)
  - 지금 코드: `packages/design/components/toast/toast.tsx`·`toast.module.css`, `input/input.module.css`, `select/select.module.css`, `menu/menu.tsx`·`menu.module.css`, `tokens.ts`, `generate.ts`, `packages/shell/renderer/build.ts`, `tools/wireframes/build.ts`(svg loader 본보기)
- 계약:
  - 쓰는 것: 없음(design은 다른 package를 import하지 않는다)
  - 내놓는 것(`@lophn/design/components`에서 export):
    - `TabStrip`, `type TabItem`, `type TabDot`: props는 wireframe 그대로(`tabs`, `selected`, `focused`, `compact`, `onSelect`, `onClose`, `end`). `TabItem = { key, title, icon?: ReactNode, dot?: TabDot | null }`
    - `FileIcon({ name, folder?, open?, size? })`, `fileIconName`
    - `VendorIcon({ vendor, size?, label? })`, `vendorOf(name)`, `type Vendor`
    - `MenuIcon({ icon })`: menu 항목 앞에 놓는 아이콘 칸(`MenuItem.leading`에 넣는다)
    - `Toast`: 아래 새 props
    - token(CSS 변수): `--tab-strip-min`, `--tab-strip-max`, `--window-top-bar`(36px), `--window-control`(46px), `--window-close-hover`, `--window-close-text`, `--file-icon-*` 열여섯

## 할 일

### 1. token (`packages/design/tokens.ts`)

색과 길이는 token으로만 쓴다(`packages/design/style-check`가 CSS의 raw 색·길이를 거절한다). 아래를 `tokens`에 더하고 `packages/design`에서 `deno task generate`로 `generated/`를 다시 만든다.

- `tabStrip: { min: "96px", max: "240px" }` — `tab-strip.module.css`의 `min-width: 96px`, `max-width: 240px`가 쓴다.
- `window: { topBar: "36px", control: "46px", closeHover: { light: "#c42b1c", dark: "#c42b1c" }, closeText: { light: "#ffffff", dark: "#ffffff" } }` — ui-chrome-top-bar가 쓴다.
- `fileIcon`: wireframe `chrome.css`의 `--ctp-*` 열여섯 색. light는 Catppuccin Latte, dark는 Macchiato 값을 `{ light, dark }`로 그대로 옮긴다. 키는 `text`, `blue`, `yellow`, `green`, `overlay1`, `peach`, `red`, `mauve`, `sky`, `sapphire`, `pink`, `teal`, `maroon`, `lavender`, `rosewater`, `flamingo`(변수는 `--file-icon-<키>`).
- `theme.ts`의 override 검사(`allowedValues`)가 새 group 때문에 깨지면 새 group은 override 대상이 아니라는 쪽으로 고친다.

### 2. TabStrip (`components/tab-strip/`) — `U6.3#2`, `U6.3#3`

- `chrome/tab-strip.tsx`와 `tab-strip.module.css`를 `components/tab-strip/tab-strip.tsx`, `tab-strip.module.css`로 옮긴다.
- 고칠 곳은 셋뿐이다: (a) `workspaceIcons.close` 대신 `lucide-react`의 `X`를 쓴다(`Toast`가 이미 그렇게 한다). (b) `Icon`, `iconPixels`는 `../icon.tsx`, `../shared.ts`에서 가져온다. (c) 영어 문자열(`"Close tab"`, 상태 점 이름 셋)을 wording key로 바꾼다: 닫기는 기존 `common.button.close`, 점은 `common.label.tab-waiting`("Waiting for you"), `common.label.tab-working`("Working"), `common.label.tab-ended`("Session ended")를 wording common 영역 file에 더한다.
- css의 `min-width: 96px`, `max-width: 240px`는 `var(--tab-strip-min)`, `var(--tab-strip-max)`로 바꾼다. 나머지는 이미 token이다.
- 탭 아이콘은 호출자가 `icon`으로 준다(파일 탭은 `FileIcon`, agent 탭은 agent profile, coding 터미널 탭은 `VendorIcon`). TabStrip은 종류 글자를 그리지 않는다.

### 3. FileIcon (`components/file-icon/file-icon.tsx`) — `U6.1#8`

- `chrome/file-icon.tsx`를 옮긴다. `var(--ctp-<x>)`를 `var(--file-icon-<x>)`로 바꾼다(`themed()` 안 한 곳). 나머지(확장자 표, 폴더 표, `fileIconName`)는 그대로다.
- `@iconify-json/catppuccin/icons.json`을 `with { type: "json" }`로 import하는 줄은 그대로 둔다.

### 4. VendorIcon (`components/vendor-icon/`) — `U6.1#7`

- `vendors/`의 `vendor-icon.tsx`, `vendor-icon.module.css`, `*.svg` 열여섯과 `LICENSE`를 `components/vendor-icon/`로 옮긴다(`@lobehub/icons-static-svg` 1.95.1, MIT. LICENSE를 같이 둔다).
- svg는 글로 import한다(`import x from "./x.svg"`). `components/css-modules.d.ts`에 `declare module "*.svg" { const markup: string; export default markup; }`를 더한다(`tools/wireframes/css-modules.d.ts` 본보기).
- renderer bundle이 svg를 읽도록 `packages/shell/renderer/build.ts`의 `assetPlugin`을 고친다: `onResolve` filter를 `/\.(css|woff2|svg)$/`로, loader 선택에 `.svg`면 `"text"`를 더한다(`tools/wireframes/build.ts`의 같은 부분 그대로).

### 5. Toast (`components/toast/`) — `U6.1#4`, `U6.1#5`

gallery에는 단추를 오른쪽 끝에 둔 look-alike가 셋(`waiting/waiting-toast.tsx`, `app-space/toast.tsx`, `project-files/notices.tsx`) 있다. 이 셋이 필요로 한 것을 design `Toast` 하나로 합친다.

- `.actions`를 오른쪽 끝에 정렬한다(`justify-content: flex-end`).
- `ToastAction`에 `variant?: "primary"`를 더하고 `actions`를 최대 셋으로 넓힌다(`notices.tsx`의 충돌 toast가 단추 셋을 쓴다). 마지막 단추를 primary로 줄 수 있다.
- `lead?: ReactNode`를 더한다: 제목 앞의 작은 그림(`app-space/toast.tsx`의 VendorIcon). 제목과 같은 줄에서 `gap: var(--space-3)`로 놓는다.
- `role?: "status" | "alert"`를 더한다. 기본은 error 어조면 `alert`, 아니면 `status`.
- 탭 위쪽에 가운데 놓는 배치(위치, 넓은 폭)는 화면의 몫이라 Toast에 넣지 않는다.
- 이 task에서 look-alike 셋 file은 고치지 않는다. 그 file들은 wave 3 screens 단위가 `Toast`로 바꾼다.

### 6. 글 넣는 칸 focus (`input/`, `select/`) — `U6.1#6`

- `input/input.module.css`의 `.control:focus-visible`(Input과 Textarea가 같이 쓴다)와 `select/select.module.css`의 `.trigger:focus-visible`에서 바깥 `outline`을 없애고 `border-color: var(--color-focus)`만 바뀌게 한다(`chrome/chrome.css` 마지막 규칙의 뜻). 칸에 `border` 색 속성이 실제로 있는지 확인하고, 없으면 `border`를 이미 가진 selector에 건다.
- 편집 중인 CodeMirror 같은 칸은 화면 몫이다.

### 7. menu 아이콘 (`components/menu/`) — `U6.1#9`

- `menu-icons.tsx`의 `menuIcon`/`menuLead`가 하는 일(항목 앞 아이콘을 `--icon-size-base` 폭의 칸에 놓고 색은 `--color-text-muted`)을 `MenuIcon({ icon })`로 `components/menu/menu.tsx`에 둔다. 칸 css는 `menu.module.css`에 둔다. `Menu`는 이미 `MenuItem.leading`을 그린다.
- `FileIcon` 같은 요소를 칸에 맞춰 감싸는 쓰임은 `MenuIcon`에 `children`을 받는 꼴로 허용한다(`icon` 대신 `children`).

### 8. export와 gallery

- `components/mod.ts`에 위 "내놓는 것"을 export한다.
- `tools/wireframes/frames/chrome/`에서 `tab-strip.tsx`, `tab-strip.module.css`, `file-icon.tsx`를 지운다. `chrome.css`에서는 `--ctp-*` 변수 전부와 마지막 focus 규칙을 지우고 `--wire-title-bar` 줄만 남긴다(top-bar task가 이어서 지운다). `title-bar.tsx`, `title-bar.module.css`, `window-api.ts`는 건드리지 않는다.
- `tools/wireframes/frames/vendors/`를 통째로 지운다.
- 아래 import 줄만 `@lophn/design/components`로 바꾼다(이 줄들 말고는 composition file을 고치지 않는다). 쓰는 이름은 `FileIcon`, `TabStrip`, `type TabDot`, `VendorIcon`, `vendorOf`, `type Vendor`다.
  - `compositions/model-picker.tsx:26`, `compositions/workspace-settings.tsx:10`, `compositions/project-pages.tsx:8`, `compositions/project-window.tsx:39,41`
  - `compositions/project-files/explorer.tsx:14,15`, `project-files/pages.tsx:11`
  - `compositions/agent-tab/sender.tsx:8`, `agent-setup/parts.tsx:30`
  - `compositions/waiting/waiting-list.tsx:17`, `waiting/waiting-data.ts:5`
  - `compositions/workspace/coding-pane.tsx:16`
  - `compositions/app-space/space.tsx:29`, `app-space/side-pane.tsx:7,11`
- 같은 file이 `import ... from "@lophn/design/components"`를 이미 가지면 이름만 합친다.

## 끝남

- `deno task check`가 통과한다. (style-check가 새 css의 raw 색·길이를 거절하지 않고, `generate.ts --check`가 통과한다.)
- 위험 test: 없음(화면 부품이다)
- 남지 않음: `grep -rn "chrome/tab-strip\|chrome/file-icon\|vendors/vendor-icon\|--ctp-" packages tools`가 0줄이다.
- `deno task wireframes`가 되고, gallery의 project 창(`project-window`), 앱 공간(`app-space/space`), Settings(Providers·Coding agents)가 옮긴 `TabStrip`, `FileIcon`, `VendorIcon`으로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: `packages/design/deno.json` import와 `deno.lock`(이미 더했는지), wording 생성 결과(common 영역에 더한 key 셋), 쓰지 않게 된 `tools/wireframes/deno.json`의 `@iconify-json/catppuccin/` 줄 지우기
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 정한 것(token 이름, Toast의 `lead`·`role`·단추 셋, `MenuIcon` 모양)
- 넘기는 일: toast look-alike 셋을 `Toast`로 바꾸기는 `waiting/`이 screens-data, `app-space/`가 screens-app-space, `project-files/`가 screens-project. menu 항목에 `MenuIcon` 쓰기는 각 화면 단위
