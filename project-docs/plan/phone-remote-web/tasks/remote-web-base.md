# remote-web-base

remote 화면의 entry와 bridge, 화면 틀, session 목록, Inbox를 만든다.

- 단위: web (wave 2)
- 선행: remote-bytes, touch-density.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/remote/`(새 폴더. `chat/`은 빼고)
  - `packages/shell/renderer/build.ts`
  - `packages/design/i18n/catalog/`에 새 file 하나
  - `tools/wireframes/pages/screens/`에 새 file 하나
- 읽을 것:
  - 계획 README "정한 것"
  - `packages/shell/renderer/desktop/connection/{connection.ts,core-read.ts,events/}`, `tools/wireframes/mock/mock-desktop.tsx`(fake source로 띄우는 본보기)
  - `packages/shell/renderer/desktop/connection/waiting/`(Inbox의 page와 card), `packages/shell/renderer/shell/use-left-sidebar.ts`(session을 agent와 workspace로 묶는 법)
  - `tools/remote-client.ts`(개발용 bridge가 할 일)
  - `ui-design` skill
- 계약:
  - 쓰는 것: `CoreSource`, `EventsProvider`, `useCoreRead`, density `touch`, `@lophn/protocol/remote/client`
  - 내놓는 것: `globalThis.lophnRemote`의 type(`CoreSource`), entry `remote`(`dist/remote/remote.js|css`, `index.html`), 화면 틀의 route(목록, 대화, Inbox)와 대화 자리에 꽂을 component의 props

## 할 일

1. wireframe 먼저: 폰 폭(390px)의 화면 셋. 목록(workspace마다 session, 상태 점, 기다리는 것 표시), Inbox(기다리는 것과 지난 알림), 아래 탭 둘, 대화로 들어가고 나오기. gallery에 page를 더한다.
2. `build.ts`에 entry `remote`를 더한다. `tokens.css`, `base.css`를 싣고 density `touch`를 건다. desktop의 `chrome.css`(`user-select: none` 등)는 싣지 않는다.
3. bridge: page는 `globalThis.lophnRemote`를 `CoreSource`로 쓴다. 없으면 "폰 앱에서 연다"는 글을 보인다. 개발 build에서는 QR 내용을 붙여 넣는 화면과 `@lophn/protocol/remote/client`로 붙는 bridge를 쓴다(key는 `localStorage`. 개발용이다).
4. `EventsProvider`를 `lophnTerminal`, `lophnNotice` 없이 세운다. 연결 상태(붙는 중, 끊김)를 화면 위에 한 줄로 보인다.
5. session 목록: `sessions-store`의 snapshot에서 agent와 workspace 쌍을 뽑고 `sessions/list`로 제목을 읽는다. project와 앱의 이름은 `projects/list`, 앱 목록으로 읽는다.
6. Inbox: `waiting-store`와 `waiting/`의 card를 쓴다. desktop router에 기대는 것(`runToastAction`, `notice-action.ts`, `InboxNamesProvider`)은 폰의 화면 이동으로 바꿔 꽂는다. 끝난 터미널 줄은 없다.
7. 글은 i18n catalog에 넣는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음
- `npm run wireframes`가 되고 gallery에 remote 화면이 fake source로 그려진다.
- 개발 build를 browser에서 열어 QR 내용으로 pairing하면 목록과 Inbox가 실제 core의 것으로 보인다(보고에 확인한 것을 적는다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 부르려는데 기기 목록에 없던 route를 "계약 바꾸기 요청"에 적는다.
