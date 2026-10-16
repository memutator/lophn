# ui-chrome-top-bar

wireframe의 창 위쪽 바(36px, 창 단추 46px, 닫기 단추의 빨간 hover)와 명령 palette 단추(⌘ 아이콘)를 실제 `TopBar`로 그대로 옮긴다. wireframe은 실제 `TopBar`를 감싸 CSS로 덮어 그렸으므로, 앱에서는 감싸개를 없애고 `TopBar` 자체를 고친다. gallery는 고친 `TopBar`를 import한다.

- 단위: ui-chrome (wave 2)
- 선행: ui-chrome-components (`--window-top-bar`, `--window-control`, `--window-close-hover`, `--window-close-text` token을 거기서 더한다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/top-bar/`
  - `tools/wireframes/frames/chrome/` (남은 file 전부를 지운다. `window-api.ts`만 남긴다)
  - `tools/wireframes/main.tsx` (chrome.css import 줄 하나 지우기)
  - `tools/wireframes/frames/compositions/**`의 `title-bar` import 줄, `--wire-title-bar` 두 곳
  - wording의 common 영역 file (palette 단추 key는 이미 있다: `common.button.palette-open`. 더할 key 없음)
- 읽을 것:
  - inventory(lead가 맞추며 더함): `U6.2#1`, `U6.2#2`
  - spec: 없음
  - inventory: `U6.2#1`, `U6.2#2` (`../assignment.md`의 ui-chrome 줄. `U6.2#3` sidebar 머리 높이는 token만 공급하고 쓰는 일은 넘긴다)
  - 결정: `../README.md` 2.3장 K6, 2.5장("보고 다시 그리지 않는다")
  - 본보기(화면):
    - `tools/wireframes/frames/chrome/title-bar.tsx`, `title-bar.module.css`(36px, 46px, 닫기 hover, 왼쪽이 남는 폭을 차지)
    - `tools/wireframes/frames/chrome/window-api.ts`(gallery용 가짜 창 통로. 남긴다)
  - 지금 코드: `packages/shell/renderer/desktop/top-bar/top-bar.tsx`, `top-bar.module.css`, `window-controls.tsx`, `packages/shell/ipc/window-controls.ts`
- 계약:
  - 쓰는 것: `--window-top-bar`(36px), `--window-control`(46px), `--window-close-hover`, `--window-close-text` (ui-chrome-components), `packages/shell/ipc/window-controls.ts`의 `WindowControlsApi`(바꾸지 않았다)
  - 내놓는 것: `TopBar`(props 그대로 `leading`, `trailing`, `platform`), `PaletteButton({ onClick })`. 위쪽 바 높이를 쓰는 다른 화면은 `--window-top-bar`를 쓴다.

## 할 일

1. `top-bar.module.css`를 wireframe 모양으로 고친다. 값은 모두 token이다(style-check가 raw 길이·색을 거절한다).
   - `.bar`의 `height`를 `var(--window-top-bar)`로, `gap`을 `var(--space-3)`로 바꾼다. 주석 "48px"를 36px로 고친다.
   - `.leading`에 `flex: 1; min-width: var(--space-0)`을 더한다. 남는 폭을 왼쪽이 차지해서 오른쪽 묶음(`.trailing`)이 창 단추 바로 옆에 붙는다.
   - `.controls > button[data-window-action]`의 `width`를 `var(--window-control)`(46px)로 바꾼다.
   - `.controls > button[data-window-action="close"]:hover`에 `background: var(--window-close-hover); color: var(--window-close-text);`를 더한다.
2. `top-bar.tsx`의 주석("48px 끌기 바", "창 단추 셋(144px)")을 36px와 46px 셋(138px)으로 고친다. 동작은 바꾸지 않는다.
3. `PaletteButton`을 `top-bar.tsx`에 더한다: `frames/chrome/title-bar.tsx`의 것을 옮긴다. 아이콘은 `lucide-react`의 `Command`, 이름은 `t("common.button.palette-open")`(영어 문자열 "Command palette" 대신), `variant="ghost"`. 화면이 lucide를 직접 들이지 않는다는 규칙(`renderer/icons/mod.ts`)은 그 폴더가 screens-workspace 소유라 못 건드리므로 `top-bar` 폴더 안에서 `Command`를 직접 import한다(보고의 "정한 것").
4. gallery를 옮긴 `TopBar`로 바꾼다.
   - `frames/chrome/title-bar.tsx`의 `WireTopBar`는 `<TopBar platform="linux" {...props}/>` 감싸개일 뿐이다. 지우고 아래 composition file이 `TopBar`를 직접 쓴다: `compositions/workspace-page.tsx:9`, `compositions/project-app.tsx:6`, `compositions/workspace/launcher-pages.tsx:22`, `compositions/workspace/start-failure-page.tsx:10`, `compositions/app-space/space.tsx:28`. import는 `../../../../packages/shell/renderer/desktop/top-bar/top-bar.tsx`(깊이는 file마다 맞춘다). `WireTopBar`를 쓰던 곳은 `<TopBar platform="linux" ...>`, `PaletteButton`은 같은 file에서 가져온다.
   - `frames/chrome/`에서 `title-bar.tsx`, `title-bar.module.css`, `chrome.css`를 지운다. `window-api.ts`는 gallery 전용 가짜 통로라 남긴다.
   - `tools/wireframes/main.tsx`의 `import "./frames/chrome/chrome.css";` 줄을 지운다.
   - `--wire-title-bar`를 쓰는 두 곳(`compositions/workspace-page.tsx:77`의 `height: "var(--wire-title-bar)"`, `compositions/compose.module.css:666`)을 `var(--window-top-bar)`로 바꾼다. sidebar 머리가 위쪽 바와 같은 높이를 쓰는 규칙(`U6.2#3`)을 token으로 잇는 것이다.
5. 위쪽 바 높이 상수 48은 이 task가 고치지 않는다. 아래는 wave 3 단위가 36으로 바꾼다(보고에 적는다): shell main `desktop/window.ts`의 `TOP_BAR_HEIGHT`와 `main/desktop/main.ts`의 쓰는 곳(platform-desktop), `main/app-frame/electron-overlay.ts`(screens-app-space), renderer `workspace/model.ts`의 `TOP_BAR_HEIGHT`(screens-project).
6. (lead가 맞추며 더함 (`U6.2#1`, `U6.2#2`)) 창 위쪽 바는 36px다(지금 48px). 창 단추는 46px이고, 닫기 단추는 올리면 빨간 바탕(#c42b1c)에 흰 아이콘이다 / 위쪽 바 오른쪽 묶음은 창 단추 바로 옆에 붙는다. 명령 palette 단추는 돋보기 대신 ⌘ 아이콘이다

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(화면이다)
- 남지 않음: `grep -rn "wire-title-bar\|WireTopBar\|chrome/title-bar\|chrome/chrome.css" packages tools`가 0줄이다.
- `deno task wireframes`가 되고, gallery의 Lophn Workspace(`workspace-page`), project 앱 창(`project-app`), 앱 공간(`app-space/space`), 시작 실패(`start-failure-page`)가 고친 `TopBar`(36px)와 `PaletteButton`으로 그려진다. 닫기 단추를 올리면 빨간 바탕에 흰 아이콘이다.

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: `frames/chrome/title-bar.tsx`의 `WireTopBar`, `PaletteButton`(gallery 것. 지웠다)
- 정한 것: 문서에 답이 없어 정한 것(`Command` 아이콘을 top-bar 폴더에서 직접 import, palette 단추 이름 key)
- 넘기는 일: `TOP_BAR_HEIGHT` 48 상수 셋(위 5번), sidebar 머리 높이를 `--window-top-bar`로 맞추기(`U6.2#3`)는 screens-project(project sidebar)와 screens-workspace(Workspace sidebar)
