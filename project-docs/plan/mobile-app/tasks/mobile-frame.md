# mobile-frame

폰 앱의 뼈대를 처음부터 다시 쓴다: 앱 root, 화면 이동(sidebar와 stack, 넓은 화면의 고정 sidebar), sidebar, 연결 흐름(Welcome부터 Paired까지와 실패), 컴퓨터 고르기, 설정. 옛 폰 화면과 WebView 길을 `packages/mobile/`에서 지운다.

- 단위: mobile-app (wave 2)
- 선행: mobile-kit, mobile-data
- 소유(이 task만 고친다):
  - `packages/mobile/App.tsx`
  - `packages/mobile/index.ts`
  - `packages/mobile/app.json`
  - `packages/mobile/package.json`
  - `packages/mobile/package-lock.json`
  - `packages/mobile/metro.config.js`
  - `packages/mobile/README.md`
  - `packages/mobile/src/app`
  - `packages/mobile/src/parts`
  - `packages/mobile/src/screens`
  - `packages/mobile/src/remote`
  - `packages/mobile/src/webview`
  - `packages/mobile/src/bundle`
  - `packages/mobile/modules`
  - `packages/design/i18n/catalog/mobile-app.ts`
- 읽을 것:
  - 기준: `tools/wireframes/drafts/phone/start.tsx`(연결 흐름 7장), `shell.tsx`(sidebar, Computers sheet), `more.tsx`의 `SettingsFlow`와 `WideFlow`, `phone.module.css`. 그림: `/home/pyosechang/projects/lophn/screenshot/phone-wireframes/{1-start-and-pair,2-home-and-sidebar,8-settings,9-wide-screens}.png`
  - kit: `packages/design/native/mod.ts`(export마다 윗줄이 쓰임새), kit gallery `packages/mobile/src/gallery`
  - data: `packages/mobile/src/data/mod.ts`(컴퓨터 store, workspace 목록, sample 컴퓨터)
  - mascot과 vendor 아이콘: `packages/shell/renderer/parts/avatar/character.tsx`, `packages/shell/renderer/parts/vendor-icon/`(svg와 LICENSE)
  - 계획 `README.md`의 "정한 것"과 "돌리기 전에", `packages/mobile/README.md`
- 계약:
  - 쓰는 것: `@lophn/ui-native`, `packages/mobile/src/data/mod.ts`
  - 문구: `@lophn/i18n`의 `t()`로 쓴다. desktop catalog(`packages/design/i18n/catalog/*.ts`)에 같은 문장이 있으면 그 key를 쓰고, 없을 때만 자기 catalog file에 `mobile.`으로 시작하는 key를 더한다. 문장 조각을 이어 붙이지 않는다(ICU 한 문장). 지어낸 예시 data는 그대로 둔다.
  - 내놓는 것(wave 3의 화면 task가 기댄다):
    - `packages/mobile/src/app/nav.ts`: 갈 곳의 type(`home`, `inbox`, `jobs`, `job(id)`, `agents`, `agent(id)`, `workspace(id)`, `session(id)`, `new-session(workspace?)`, `search`, `settings` 등)과 `useNav()`(`open(place)`, `back()`, `openSidebar()`)
    - 화면 자리: `packages/mobile/src/screens/<영역>/index.tsx`가 그 영역의 화면 component를 export한다. 이 task가 `home`, `session`, `inbox`, `workspace`, `jobs`, `agents`, `search` 영역의 자리를 제목만 있는 빈 화면으로 만들어 두고, wave 3의 task는 자기 영역 폴더만 고친다(등록 file을 건드리지 않는다)
    - `packages/mobile/src/parts`: `Face`(lophn agent의 character나 coding agent의 vendor 아이콘), workspace 표식에 쓰는 아이콘

## 할 일

1. 화면 이동: React Navigation 7(`@react-navigation/native`, `native-stack`, `drawer`, `react-native-screens`)을 판을 고정해 더한다. sidebar는 왼쪽 drawer이고 폭 600 이상에서는 늘 열려 있다(`WideFlow`). 뒤로 gesture와 Android back이 맞게 돈다. native module을 더했으니 `packages/mobile/README.md`대로 dev build를 다시 짓는다.
2. `App.tsx`를 새로 쓴다: `UiProvider`, data store 연결, 이동 root. 컴퓨터가 하나도 없으면 연결 흐름, 있으면 Home. 옛 `App.tsx`의 state는 wave 1이 store로 옮겼다.
3. 연결 흐름을 wireframe대로 짓는다: Welcome, Scan(camera 권한은 이 화면에 들어올 때), Pairing(단계 세 줄), Paired, Code expired, Cannot reach, Enter a pairing code. Paired는 알림을 묻지 않는다(push는 다음 계획). 컴퓨터 이름을 확인시키고 Home으로 간다. pairing 로직은 `packages/mobile/src/pairing`의 것을 data store로 부른다.
4. sidebar를 wireframe대로 짓는다: 상표 줄과 검색 단추, 컴퓨터 고르기 줄(누르면 Computers sheet), Inbox(수)·Jobs·Agents, Workspaces와 그 아래 session(worktree label, 상태 점), 설정. 줄을 누르면 그 곳이 열리고 sidebar가 닫힌다. 고른 곳이 표시된다.
5. Computers sheet(상태, 길, 기다리는 수, 고르기, Pair another computer)와 Settings(Computers 목록, 컴퓨터 상세와 Remove, This phone의 이름, Appearance: theme과 글자 크기, About)를 짓는다. Notifications는 짓지 않는다.
6. `packages/mobile/src/parts`에 `Face`와 표식을 짓는다. mascot은 `character.tsx`의 path·색·눈 위치를 그대로 react-native-svg로 옮긴다. vendor 아이콘은 `packages/shell/renderer/parts/vendor-icon/`의 svg를 그대로 쓴다(사본을 만들지 않고 Metro가 읽게 한다. 안 되면 필요한 것만 생성 단계 없이 옮기는 가장 단순한 길을 고르고 보고한다).
7. 옛것을 지운다: `packages/mobile/src/screens/{pair-screen,computers-screen}.tsx`, `packages/mobile/src/remote`, `packages/mobile/src/webview`, `packages/mobile/src/bundle`, `packages/mobile/modules/lophn-webview`, 그것들의 test와 `app.json`·`package.json`의 흔적. kit gallery는 dev에서 Settings 맨 아래 줄로 들어가게 둔다.
8. emulator(port 5564, Metro 8204)에서 sample 컴퓨터로 화면마다 그림을 찍어 `.dev-data/mobile-frame/shots/`에 둔다(연결 흐름 7장, sidebar, Computers, Settings 셋, 가로로 넓힌 화면 한 장, dark 둘). 개발 core(`tools/remote-dev.ts`)에 실제로 pairing해 Welcome에서 Home 자리까지 가는 것을 한 번 확인한다.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check:full`이 통과한다.
- 위험 test: 없음(연결과 store의 test는 wave 1의 것이 그대로 통과한다)
- 남지 않음: `grep -rn "webview\|WebView\|remote_ui\|bundle/cache" packages/mobile/src packages/mobile/App.tsx packages/mobile/app.json packages/mobile/package.json`가 0줄이다.
- 그림이 wireframe과 같은 구조·크기·색이다(lead가 대조한다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `nav.ts`의 갈 곳 목록, 영역 자리 file 목록, 더한 의존성과 판, 그림 목록, dev build를 짓는 데 바뀐 것.
