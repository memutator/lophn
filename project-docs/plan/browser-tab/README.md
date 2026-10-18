# browser-tab: workspace pane에서 web page를 연다

- 목표: 탭 kind `browser`를 더한다. 인터넷 page를 `WebContentsView`로 띄우고, navigation·popup·permission·UA·download 규칙, toolbar, Settings의 Browser pane(Clear browsing data), DevTools, bookmark를 둔다. 크기를 준 popup은 floated 탭으로 연다.
- 재료:
  - `project-docs/products/roadmap/browser-tab.md`: 이 계획의 정본이다. "지금 코드", "무엇을 만드나" 1·4(지우기, DevTools)·5·6, "정한 것".
  - `../rea/project/desktop-embeded-browser`의 `src/main/policy.js`, `session.js`, `session-prefs.js`, `requests.js`, `tabs.js`(규칙을 TS로 옮겨 짠다. dependency로 넣지 않는다).
  - `project-docs/architecture/annotation.md`(app view identity), `project-docs/architecture/ui-kit.md`.
  - `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `shell/main`, `shell/renderer`, `shell/ipc`.
- 범위 밖:
  - `$BROWSER` bridge, terminal link, link를 열 곳 설정 둘. 계획 `browser-bridge`가 한다.
  - 로컬 HTML 미리 보기(roadmap 3), roadmap "하지 않는 것" 전부.
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다. task id는 `bt-`로 시작한다.
- 단위: `tasks/*.md`의 "단위"가 정한다.
- 순서: navigation·popup 결정 함수와 browser session(wave 1) → 탭 kind와 view·toolbar·새 탭 menu, Settings Browser pane·DevTools, bookmark(wave 2) → popup을 floated로(wave 3) → gallery(wave 4) → 문서(lead).
- 시작 조건: 없음. 계획 `workspace-float`과 같이 돈다. wave 3(popup을 floated로)은 `workspace-float`이 main에 land한 뒤에 연다. lead는 그때 main을 `plan/browser-tab`에 merge하고 그 brief를 실제 코드와 맞춘다.

## 정한 것

roadmap "정한 것"은 다시 적지 않는다. 아래는 이 계획에서 새로 정한 것이다.

- `workspace-float`을 기다리지 않고 같이 돈다(agent). popup을 floated로 여는 것만 floats 층에 기댄다. wave 1·2가 끝나도 float가 아직이면, 크기를 준 popup도 잠시 docked 탭으로 연다. 그 상태로 main에 land하지 않고 wave 3까지 기다린다.
- 규칙 코드는 `packages/shell/main/browser/`에 둔다(roadmap). `main/app-frame/`의 placement·visibility·overlay·crash는 고치지 않고 부른다. browser view가 app view registry에 들어가야 하면 넘길 줄로 최소로 맞춘다(agent).
- bookmark 파일 쓰기는 `main/workspace/layout-store.ts`의 atomic write를 함수로 나눠 같이 쓴다. 복사하지 않는다(agent).

- (2026-10-19, 사람) 보통 browser 탭은 `WebContentsView`가 아니라 shell renderer의 `<webview>`로 띄운다. native view는 DOM 위에 그려져서 menu·popover·floated 패널이 page 밑에 깔렸다(사람이 손으로 확인). `<webview>`는 DOM 안에 그려져 그 위에 DOM이 겹친다. 크기를 준 popup만 `window.opener`를 지키려고 지금의 native `WebContentsView` 길로 floated 패널에 띄우고, dock하면 같은 주소의 `<webview>`로 다시 연다. 크기 없는 popup(`target=_blank`, 크기 없는 `window.open`)은 거절하고 새 `<webview>` 탭으로 연다(opener 끊김). 표준 Electron에는 `createWindow`가 준 contents를 `<webview>`에 넣는 길이 없다(ChatGPT desktop은 고친 Electron의 `_createWebViewAdoptionLease`로 한다. rea `analysis/embedded-browser-reverse-engineering.md` 1.3).
- (2026-10-19, lead 실험) `<webview>`를 DOM에서 다른 부모로 옮기면 guest가 다시 만들어진다(page 다시 load, opener 끊김). 한 부모에 두고 CSS 위치·크기·z-index만 바꾸면 그대로다. 그래서 `<webview>`는 창마다 한 그릇에 탭 key당 한 번 만들고, 탭 자리는 사각형만 알린다.
- (2026-10-19, 사람) 탭과 bookmark에 page favicon을 보인다(roadmap의 "favicon 하지 않는다"를 뒤집음).

## lead가 할 일

- merge 때마다: wording 생성, gallery `tools/wireframes/pages/index.ts` 등록, core `shell-settings.ts`에 key가 더해지면 wording의 setting name·help key.
- 끝나면:
  - `project-docs/architecture/browser-tab.md`를 새로 쓴다: view 길, session, navigation·popup·permission 규칙, bookmark 저장, 지키는 것. `project-docs/context-component-registry.yaml`에 올린다.
  - `project-docs/products/change-log/`의 열린 판에 항목을 덧붙인다.
  - `project-docs/products/roadmap/browser-tab.md`에서 이 계획 몫을 지운다.
- 사람에게 묻는 것: Electron이나 browser를 띄우는 test를 새로 만들 때. 실제 인터넷 site로 확인하는 것은 lead가 손으로 한다(github.com 로그인, Google popup 로그인).
