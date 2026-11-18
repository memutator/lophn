---
name: ui-design
description: lophn 화면 wireframe(tools/wireframes gallery)을 새로 만들거나 고칠 때, 화면 모양을 바꾸는 사람의 요청을 받았을 때, packages/design component를 더하거나 바꿔 화면에 반영할 때 쓴다.
---

# ui-design

wireframe gallery(`tools/wireframes`)는 화면 모양의 기준이고 UI 피드백 루프를 줄이려고 둔다. 사람이 gallery를 보고 모양을 고른다.

## 먼저 알아둘 것 (지금 코드)

- gallery는 묶음 셋이다. **Kit**은 design(`@lophn/ui`)의 component를 분류마다 page 하나에 상태별로 그리고, 사람이 여기서 component를 승인한다. **Screens**는 renderer를 import한 제품 화면을 영역별로, **Drafts**는 아직 renderer에 없는 실험을 그린다(지금은 page가 없어 gallery에 뜨지 않는다. shell 초안은 실제 shell을 그리는 Screens › Shell로 옮겼다). 범용 kit, lophn 전용 부품, app bridge UI를 어디에 두는지와 사용자 앱에 닿는 길은 `project-docs/architecture/ui-kit.md`다.
- gallery는 그림을 따로 그리지 않는다. renderer(`packages/shell/renderer`)의 실제 component를 fake source와 고정 data로 그린다. 그래서 **화면 모양을 고친다 = renderer나 design component를 고친다.** `tools/wireframes`에는 모양을 덮어쓰는 CSS나 gallery 전용 prop을 두지 않는다. CSS 파일은 `drafts/`(승인 전 실험) 안과 gallery 자신의 틀(`gallery.module.css`, `pages/kit/kit.module.css`)에만 둔다. 무대 배치처럼 몇 줄이면 token 변수를 쓴 inline style로 쓴다.
- 상태 하나를 고정하는 법: fake source의 설정으로 바탕을 정하고, mount 뒤 단추를 눌러 사람이 한 것처럼 만든다(`mock/drive.ts`의 `useDrive`와 `find`·`click`·`press`·`type`).

## 모든 화면의 규칙 (사람이 wireframe 리뷰에서 정함)

- 토글과 행동 단추는 줄 오른쪽 끝의 고정 열에 둔다. 이름 길이와 상관없이 같은 위치다. form의 Save·Cancel, 카드의 Open·Archive, toast 단추도 오른쪽 끝이다.
- 탭 본문은 최대 폭을 둔 기둥을 가로 가운데에 놓는다.
- 고른 탭과 탭 본문은 배경이 같다. 본문 안에 배경색이 다른 넓은 영역을 두지 않는다(image, pdf, terminal 바탕도 같다).
- 탭 안 알림은 그 탭 위쪽 toast(design `Toast`)로 띄운다. 색 다른 띠나 상자를 쓰지 않는다. toast를 새로 만들지 않는다.
- 글 넣는 칸(input, textarea, select)은 focus 때 바깥 outline 없이 테두리 색만 `--color-focus`로 바뀐다.
- 색은 역할로 쓴다. 주 행동·고른 것·켜진 것의 표시는 `--color-ink-background`, `--color-focus`는 focus ring·입력칸 focus 테두리·drop 자리에만, `--color-text-*`는 글자에만 쓴다(`project-docs/architecture/appearance.md`).
- 글자 단추에는 앞에 행동 아이콘을 붙인다(renderer `icons/action.ts`의 `actionIcons`, 같은 동사는 같은 아이콘). Cancel·Close 같은 닫기 단추만 글자뿐이다. 묶음에서 주 단추(primary·danger)가 오른쪽 끝이다.
- `danger`(채운 빨강)는 되돌릴 수 없는 일을 실제로 하는 단추에만 쓴다. 거절·건너뛰기처럼 부정이지만 파괴가 아닌 선택은 `secondary`다.
- harness와 provider 이름 옆에는 vendor 아이콘(`@lobehub/icons-static-svg`), 파일과 폴더에는 종류 아이콘(`@iconify-json/catppuccin`, light는 Latte, dark는 Macchiato), menu 항목에는 아이콘을 붙인다.

## 어디를 고치나

| 하는 일 | 위치 |
|---|---|
| 화면 모양 | `packages/shell/renderer/...` 해당 component와 `.module.css` |
| 여러 화면이 쓰는 조각 | 사용자 앱도 쓸 범용이면 `packages/design/components/<분류>/<이름>/` (tsx, module.css), 그 분류의 `mod.ts`에 export. 분류는 primitives, input, layout, navigation, data, feedback, overlay, reading이고 지원 export는 `_shared`다. import는 `@lophn/ui/<분류>`(`_shared`는 `@lophn/ui/shared`, token은 `@lophn/ui`). lophn만의 뜻(session, agent, harness)이 박힌 것이면 `packages/shell/renderer/parts/<이름>/` (Avatar, VendorIcon, TabStrip) |
| token(색, 간격, 글자) | `packages/design/tokens.ts`. 값을 CSS에 직접 쓰지 않고 token(var)을 쓴다 |
| fake data | renderer 영역마다 `fake-source.ts`와 `testdata/`(예: `workspace/fake-source.ts`, `desktop/settings/providers/testdata/`), `desktop/dev-mock/`. gallery의 예시 data는 `tools/wireframes/mock/`(예: `mock/phroner-data.ts`, 짝지은 컴퓨터가 여럿인 화면은 `mock/machines-data.ts`). 어떤 사용자의 상황을 나타내는 data(여러 page가 같이 쓰는 것)는 `mock/scenarios/<scenario id>.ts`에 두고 `project-docs/flows/scenarios/<group>.yaml`에 그 scenario를 쓴다(file 이름이 id, `check`가 본다). component 견본용 순수 data는 그대로 `mock/`이나 kit page에 둔다 |
| kit page | `tools/wireframes/pages/kit/<분류>/` (분류마다 `page.tsx` 하나가 그 분류 `mod.ts`의 component를 실제 component로 상태별로 그린다), token은 `pages/kit/tokens/`, `@lophn/app-ui`는 `pages/kit/app-ui/` |
| page 목록과 화면 연결 | 영역 file 하나가 자기 page를 낸다: `pages/kit/<분류>/index.tsx`, `pages/screens/<영역>.tsx`, `drafts/index.tsx`. `pages/index.ts`의 `GROUPS`(Kit · Screens · Drafts > 영역 > page)가 모은다 |

## 새 화면(page) 만들기

1. 필요한 component가 `packages/design/components/<분류>/mod.ts`에 있는지 본다. `mod.ts`의 `export { … } from` 문마다 윗줄 `//` 한 줄이 "언제 쓰나"라서 그 줄이 목록이다. 새 export를 더하면 그 줄도 단다. 없고 여러 화면이 쓸 것이면 **design에 먼저** 더한다(분류 안 component 폴더, 그 분류 `mod.ts` export, `tools/wireframes/pages/kit/<분류>/page.tsx`에 견본). 한 화면만 쓰는 조각은 renderer 그 화면 폴더에 둔다.
2. 아이콘은 lucide를 직접 import하지 않는다. renderer는 `icons/*.ts` 묶음, design은 `Icon`을 쓴다. harness와 provider 이름 옆에는 renderer `parts/vendor-icon`의 `VendorIcon`, 파일과 폴더에는 design `FileIcon`이다.
3. 화면 문구는 직접 쓰지 않고 `packages/design/i18n/catalog/<영역>.ts`의 message key(`<screen>.<part>.<name>`, 값은 ICU 문장 하나)로 쓴다. `t("key", { name })`(`import { t } from "@lophn/i18n"`). template literal로 만드는 key가 있으니 key를 지울 때는 앞부분으로 grep한다.
4. 알맞은 영역 file의 `pages`에 `{ id, title, description, render }`를 더한다. renderer를 import한 진짜 화면이면 Screens의 `pages/screens/<영역>.tsx`, 아직 renderer에 없는 실험이면 `drafts/index.tsx`다. 영역이 새로 필요하면 영역 file 하나를 만들고 `pages/index.ts`의 `GROUPS`에 더한다. 구현 여부는 묶음 위치가 말하고 badge는 없다. title은 영어, description은 한국어 한두 문장이다.
5. id는 주소(`#/<id>`)라 한 번 정하면 바꾸지 않는다.
6. 화면 component는 `pages/screens/<영역>/`에 둔다(가짜 data와 고정 도구는 `mock/`, 승인 전 실험은 `drafts/`). 인자 없이 한 상태를 그리게 하고, 상태는 fake source 설정과 drive로 건다.
7. 화면은 journey의 `screen`이나 outcome의 `observe: [screen:<id>]`로 catalog가 가리킨다. `node tools/flows.ts frames --unused`가 가리키는 곳이 없는 page를 보인다(막지는 않는다).
8. 버린 화면은 영역 file에 올리지 않는다(버린 목록은 `pages/index.ts` 머리 주석).

## 확인

```
npm run wireframes     # tools/wireframes/dist/ 에 bundle (1초 안팎, dist는 git 무시)
npm run check
```

- 보기: bundle은 module script라 `file://`로 열면 빈 화면이다. `PYTHONUNBUFFERED=1 timeout 900 python3 -m http.server 0 -d tools/wireframes`로 띄운다. port 0이면 빈 port를 골라 첫 줄에 찍고(출력이 pipe면 `PYTHONUNBUFFERED` 없이는 그 줄이 buffer에 남는다), 15분 뒤 저절로 끝나서 끄는 손잡이를 잃어도 남지 않는다. 그 port의 `http://localhost:<port>/dist/index.html`을 연다(dist를 root로 띄우면 다시 build할 때 폴더가 지워져 server가 빈다). 한 화면만 보려면 `index.html?frame=<page id>&theme=dark`. 위쪽에서 Light·Dark를 바꾼다. headless Chrome의 `--screenshot`으로 같은 주소를 찍어 볼 수 있다.
- 실제 앱에서 보기: `npm run dev:mock` (core 없이 메모리 fake data, renderer를 먼저 build한다).
- `npm run check`가 type check로 component API 어긋남을 잡는다. tools는 design, sdk, shell을 쓰는 package라서 그중 하나가 바뀌면 tools의 `tsc --noEmit`이 돈다. design component의 props를 바꾸고 wireframe 쪽을 안 맞추면 여기서 걸린다. 같이 도는 것: fmt, lint, deps, style(CSS 구조), kit.
- step `kit`(`tools/check-kit.ts`)이 kit 동기화를 본다. (1) `tools/wireframes`의 CSS는 `drafts/` 안과 `gallery.module.css`, `pages/kit/kit.module.css`에만 있다. (2) 분류 `mod.ts`가 값으로 내보내는 PascalCase 이름(component)마다 `pages/kit/` 아래에 한 번은 나온다. (3) design의 `.tsx`는 분류 폴더(8개와 `_shared`) 안에만 있고, 값을 내보내는 `export { … } from` 문마다 윗줄에 `//` 한 줄 문서가 있다. design에 component를 더하면 그 분류 kit page에 견본을 같이 더한다.
- renderer를 바꿨으면 `node packages/shell/renderer/build.ts`로 bundle이 서는지도 본다.

## 함정

- gallery는 iframe 안 고정 크기 창이다. 화면 root는 `position: absolute; inset: 0`이고 `100vh`와 fixed 배치가 그대로 맞는다. root 높이를 body에 기대면 Radix modal(Select, Menu, Dialog)이 열릴 때 접혀 보인다(`main.tsx`).
- Radix modal은 열리면 page 전체를 inert로 만든다. 디자인 시스템 page에서는 modal 견본을 같이 열어 두지 말고 따로 둔다(`pages/kit/overlay`는 단추로 연다).
- dialog와 menu는 portal로 열리므로 drive에서 `global`로 document 전체에서 찾는다.
- 앱 화면(사용자 앱이 그리는 부분)은 shell 창의 `<webview>` guest라 gallery에 없다. 자리에 고정 그림(`mock/app-space/orders-view.tsx`, CSS는 `drafts/app-space/`)을 넣는다. browser 탭의 page(`<webview>`)도 gallery에 없다. `renderer/app-frame/webview-host.tsx`가 `<webview>`가 정의되지 않은 곳에서 빈 자리를 그린다. page 상태와 bookmark는 fake browser 통로(`renderer/browser/testdata/fake-browser-api.ts`)가 준다.
- gallery는 Electron이 아니라서 맞게 보여도 앱에서 깨지는 것이 있다. 이것들은 `npm run dev:mock`으로 본다.
  - shell CSP는 `style` 속성을 허용하고(`style-src-attr 'unsafe-inline'`) inline `<style>` 요소는 막는다(`style-src 'self'`). CodeMirror·xterm이 넣는 `<style>`은 constructable stylesheet로 옮겨 붙인다(`editor/adopt-styles.ts`, `terminal/xterm-view.ts`). 새 library가 `<style>`을 넣으면 같은 일을 해야 앱에서 모양이 산다.
  - 위쪽 바는 창 끌기 영역이고 `-webkit-app-region`은 자식에게 이어진다. 바 안에서 absolute로 내려오는 panel은 `no-drag`를 주지 않으면 클릭과 scroll이 창 끌기로 먹힌다.
  - 팔레트와 dialog는 overlay라는 다른 문서다. desktop 창의 `data-theme`이 닿지 않고, top bar는 overlay 밖이라 scrim이 덮지 않는다(`chrome.css`의 `data-overlay-modal` 띠가 덮는다).
- 모양이 위 "모든 화면의 규칙"과 부딪히면 임의로 정하지 말고 사람에게 묻는다.
