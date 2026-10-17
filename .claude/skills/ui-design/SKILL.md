---
name: ui-design
description: lophn 화면 wireframe(tools/wireframes gallery)을 새로 만들거나 고칠 때, 화면 모양을 바꾸는 사람의 요청을 받았을 때, packages/design component를 더하거나 바꿔 화면에 반영할 때 쓴다. 화면 문구만 다루면 wording skill을 쓴다.
---

# ui-design

wireframe gallery(`tools/wireframes`)는 화면 모양의 기준이고 UI 피드백 루프를 줄이려고 둔다. 사람이 gallery를 보고 모양을 고른다.

## 먼저 알아둘 것 (지금 코드)

- gallery는 그림을 따로 그리지 않는다. renderer(`packages/shell/renderer`)의 실제 component를 fake source와 고정 data로 그린다. 그래서 **화면 모양을 고친다 = renderer나 design component를 고친다.** `tools/wireframes`에는 모양을 덮어쓰는 CSS나 gallery 전용 prop을 두지 않는다.
- 상태 하나를 고정하는 법: fake source의 설정으로 바탕을 정하고, mount 뒤 단추를 눌러 사람이 한 것처럼 만든다(`frames/compositions/*/drive.ts`, `demo-steps.ts`).

## 모든 화면의 규칙 (사람이 wireframe 리뷰에서 정함)

- 토글과 행동 단추는 줄 오른쪽 끝의 고정 열에 둔다. 이름 길이와 상관없이 같은 위치다. form의 Save·Cancel, 카드의 Open·Archive, toast 단추도 오른쪽 끝이다.
- 탭 본문은 최대 폭을 둔 기둥을 가로 가운데에 놓는다.
- 고른 탭과 탭 본문은 배경이 같다. 본문 안에 배경색이 다른 넓은 영역을 두지 않는다(image, pdf, terminal 바탕도 같다).
- 탭 안 알림은 그 탭 위쪽 toast(design `Toast`)로 띄운다. 색 다른 띠나 상자를 쓰지 않는다. toast를 새로 만들지 않는다.
- 글 넣는 칸(input, textarea, select)은 focus 때 바깥 outline 없이 테두리 색만 `--color-focus`로 바뀐다.
- harness와 provider 이름 옆에는 vendor 아이콘(`@lobehub/icons-static-svg`), 파일과 폴더에는 종류 아이콘(`@iconify-json/catppuccin`, light는 Latte, dark는 Macchiato), menu 항목에는 아이콘을 붙인다.

## 어디를 고치나

| 하는 일 | 위치 |
|---|---|
| 화면 모양 | `packages/shell/renderer/...` 해당 component와 `.module.css` |
| 여러 화면이 쓰는 조각 | 사용자 앱도 쓸 범용이면 `packages/design/components/<이름>/` (tsx, module.css), `components/mod.ts`에 export. lophn만의 뜻(session, agent, harness)이 박힌 것이면 `packages/shell/renderer/parts/<이름>/` (Avatar, VendorIcon, TabStrip) |
| token(색, 간격, 글자) | `packages/design/tokens.ts`. 값을 CSS에 직접 쓰지 않고 token(var)을 쓴다 |
| fake data | renderer의 `testdata/fake-source.ts`, `workspace/fake-source.ts`, `desktop/dev-mock/`. 예시 project data는 `frames/compositions/phroner-data.ts` |
| 디자인 시스템 page | `frames/design/` (design component를 그대로 나열) |
| page 목록과 화면 연결 | `tools/wireframes/pages.ts`, `frames/screens.tsx` |

## 새 화면(page) 만들기

1. 필요한 component가 `packages/design/components/mod.ts`에 있는지 본다. 없고 여러 화면이 쓸 것이면 **design에 먼저** 더한다(component 폴더, `mod.ts` export, `frames/design/components-pages.tsx`에 견본). 한 화면만 쓰는 조각은 renderer 그 화면 폴더에 둔다.
2. 아이콘은 lucide를 직접 import하지 않는다. renderer는 `icons/*.ts` 묶음, design은 `Icon`을 쓴다. harness와 provider 이름 옆에는 renderer `parts/vendor-icon`의 `VendorIcon`, 파일과 폴더에는 design `FileIcon`이다.
3. 화면 문구는 직접 쓰지 않고 wording key로 쓴다. → wording skill.
4. `pages.ts`의 `PAGES`에 `fresh(id, title, description, screen)` 항목을 더하고, `ScreenId`에 이름을 더한다.
5. `frames/screens.tsx`의 `SCREENS`에 그 화면을 그리는 component를 더한다. `SCREENS`가 `Record<ScreenId, ...>`라 빠뜨리면 type error다.
6. 화면 component는 `frames/compositions/<영역>/`에 둔다. 인자 없이 한 상태를 그리게 하고, 상태는 fake source 설정과 drive로 건다.
7. 버린 화면은 `PAGES`에 올리지 않는다.

## 확인

```
deno task wireframes     # tools/wireframes/dist/ 에 bundle (1초 안팎, dist는 git 무시)
deno task check
```

- 보기: `tools/wireframes/dist/index.html`을 browser로 연다. 한 화면만 보려면 `index.html?frame=<page id>&theme=dark`. 위쪽에서 Light·Dark를 바꾼다.
- 실제 앱에서 보기: `deno task dev:mock` (core 없이 메모리 fake data, renderer를 먼저 build한다).
- `deno task check`가 type check로 component API 어긋남을 잡는다. tools는 design, sdk, shell을 쓰는 package라서 그중 하나가 바뀌면 tools의 `deno check`가 돈다. design component의 props를 바꾸고 wireframe 쪽을 안 맞추면 여기서 걸린다. 같이 도는 것: fmt, lint, deps, style(CSS 구조), wording.
- renderer를 바꿨으면 `deno run -A packages/shell/renderer/build.ts`로 bundle이 서는지도 본다.

## 확정된 화면을 앱에 옮기기

gallery가 이미 renderer component를 그리므로 따로 옮기는 단계는 없다. 6장 한 줄을 처리하는 순서:

1. "옮길 곳" 칸의 폴더에서 component를 연다.
2. component 자체를 고친다. gallery에서만 덮어쓰던 CSS나 look-alike가 남아 있으면 component로 합치고 gallery 쪽은 지운다(예: Toast 단추 위치).
3. `deno task wireframes`로 gallery가 그 모양인지 본다.
4. `deno task check`.
5. 6장 그 줄을 지우거나 "옮김"으로 고치지 않는다. 문서는 사람이 정한다. 옮긴 줄은 보고에 적는다.

## 함정

- gallery는 iframe 안 고정 크기 창이다. 화면 root는 `position: absolute; inset: 0`이고 `100vh`와 fixed 배치가 그대로 맞는다. root 높이를 body에 기대면 Radix modal(Select, Menu, Dialog)이 열릴 때 접혀 보인다(`main.tsx`).
- Radix modal은 열리면 page 전체를 inert로 만든다. 디자인 시스템 page에서는 modal 견본을 같이 열어 두지 말고 따로 둔다(`components-pages.tsx` 주석).
- dialog와 menu는 portal로 열리므로 drive에서 `global`로 document 전체에서 찾는다.
- 앱 view(사용자 앱이 그리는 부분)는 main의 native view라 gallery에 없다. 자리에 고정 그림(`app-space/orders-view.tsx`)을 넣는다.
- 모양이 6장 규칙과 부딪히면 임의로 정하지 말고 사람에게 묻는다.
