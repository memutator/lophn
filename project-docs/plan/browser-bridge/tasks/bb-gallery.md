# bb-gallery

wireframes gallery에 bridge가 연 browser 탭과 Settings Browser pane의 Links 구역을 더한다. gallery는 새로 그리지 않고 renderer의 실제 component를 fake data로 그린다. bridge가 연 탭은 "terminal 탭이 있는 pane 옆에 browser 탭이 열려 있는" 배치일 뿐이라 layout(`panes`)으로 만들고, Links 구역은 `fakeBrowserSettings`의 `links`로 채운다.

- 단위: bb-gallery (wave 3)
- 선행: bb-renderer, bb-settings
- 소유(이 task만 고친다):
  - `tools/wireframes/pages/screens/browser/pages.tsx`
  - `tools/wireframes/pages/screens/project-workspace.tsx`
  - `tools/wireframes/pages/screens/settings.tsx`
  - `tools/wireframes/pages/screens/settings-pages.tsx`
  - `tools/wireframes/pages/screens/settings-frame.tsx`
- 읽을 것:
  - 계획: `project-docs/plan/browser-bridge/README.md`
  - skill: `.claude/skills/ui-design/SKILL.md`("새 화면(page) 만들기", "함정": `deno task wireframes`와 `dev:mock`)
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 6(gallery)
  - 본보기(layout page): `tools/wireframes/pages/screens/browser/pages.tsx`의 `BrowserTabPage`(`MockDesktop`에 `panes`와 `openTerminal`을 주는 꼴), `tools/wireframes/mock/mock-desktop.tsx`의 `PaneSpec`·`TabSpec`·`PROJECT_GROCERY`, `tools/wireframes/mock/fake-terminal.ts`(terminal 탭의 출력)
  - 본보기(Settings): `tools/wireframes/pages/screens/settings-pages.tsx`의 `SettingsBrowser`, `settings-frame.tsx`의 `SettingsFrame`(`browser` prop → `fakeBrowserSettings(browser)`), `settings.tsx`의 `settings-browser` page
  - 이 task가 그리는 component: `packages/shell/renderer/desktop/settings/browser/browser-panel.tsx`·`link-rows.tsx`, `testdata/fake-source.ts`(`fakeBrowserSettings`의 `links`)
  - 겹침: 계획 `workspace-detach`의 `wd-gallery`도 `project-workspace.tsx`에 page를 더한다. page 목록 끝에 항목을 더하는 일이라 충돌은 두 쪽을 다 남긴다.
- 계약:
  - 쓰는 것: `MockDesktop`의 `panes`·`openTerminal`, `fakeBrowserSettings(options)`(bb-settings가 `links` 옵션을 받게 한 것), `SettingsFrame`의 `browser` prop.
  - 내놓는 것: gallery page id(한 번 정하면 바꾸지 않는다). `browser-bridge-pane`, `browser-bridge-one-pane`, `settings-browser-links`, `settings-browser-links-system`.

## 할 일

1. `browser/pages.tsx`에 component 둘을 더하고 `project-workspace.tsx`의 `pages`에 항목을 더한다(title 영어, description 한국어 한두 문장).
   - `browser-bridge-pane`: 왼쪽 pane에 terminal 탭(선택), 오른쪽 pane에 browser 탭(`http://localhost:5173/`, 탭 이름 예: `Vite + React`)이 열려 있다. description은 "terminal에서 `vite`가 낸 주소를 Ctrl/Cmd-click하거나 `$BROWSER`가 불러서 반대쪽 pane에 열린 모양"이다.
   - `browser-bridge-one-pane`: pane이 하나이고 같은 pane에 terminal 탭 바로 뒤에 browser 탭이 선택되어 있다. description은 "pane이 하나면 terminal 바로 뒤에 열고 그 탭을 고른다"는 것이다.
2. `settings-pages.tsx`와 `settings.tsx`, `settings-frame.tsx`: `SettingsFrame`의 `browser` prop에 `links`(처음 값)를 받게 하고(fake source의 옵션이다. 화면에 gallery 전용 prop을 두지 않는다) page 둘을 더한다. page 목록에서 `settings-browser-clear-data` 앞에 둔다.
   - `settings-browser-links`: 기본(web, local 둘 다 Browser tab). 
   - `settings-browser-links-system`: web은 System browser, local은 Browser tab이다(`gh auth login`은 OS browser로, `vite`는 browser 탭으로 가는 설정). Select가 열린 상태로 그리지 않고 값만 보인다.
3. `deno task wireframes`로 bundle을 만들고 `index.html?frame=<page id>&theme=dark`로도 light·dark를 본다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음.
- `deno task wireframes`가 되고 위 page 넷이 renderer의 실제 component로 그려진다. gallery 쪽에 모양을 덮어쓰는 CSS를 두지 않았다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(page는 `project-workspace.tsx`와 `settings.tsx`가 자기 영역에 낸다)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
