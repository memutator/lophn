# phone-remote-web

- 목표: 폰에 띄울 remote 화면(session 목록, 대화, Inbox)을 web bundle로 짓고, core가 그 bundle을 기기에 내려주게 한다. 폰 앱 없이 desktop browser에서 개발용 bridge로 실제 core에 붙어 확인한다. 폰 껍데기는 계획 `phone-shell`이다.
- 재료: `project-docs/products/roadmap/mobile.md`(설계안 "폰 앱의 모양", 단계 2), `project-docs/products/change-log/0.23/{remote-core,screen-sync}.yaml`, `project-docs/architecture/{event,acp,agent-chat,approval,ui-kit}.md`
- 범위 밖: 폰 껍데기와 native 코드, push, harness GUI 중계, 사용자 앱 화면, relay. 폰에서 secret 넣기(보호 입력 창은 desktop의 것이다).

## 정한 것

- **bridge는 `CoreSource` 모양이다.** page는 network를 쓰지 않고 `globalThis.lophnRemote`(`subscribe`, `current`, `call`, `watch`, `onEvent`. `packages/shell/renderer/desktop/connection/connection.ts`의 `CoreSource`)만 쓴다. 연결, 다시 붙기, `watch` 다시 보내기는 bridge 뒤(폰 껍데기)의 일이다. (agent: renderer의 event 층과 `useCoreRead`가 그대로 돈다)
- **개발용 bridge.** browser에서 열면 `packages/protocol/remote`의 client로 core에 직접 붙는 bridge를 쓴다(`tools/remote-client.ts`가 하는 일). 개발 build에만 든다. (agent: 폰 도구 없이 화면을 실제 core로 확인한다)
- **화면 셋.** session 목록은 폰용으로 새로 그린다(desktop sidebar는 탭과 끌기의 모양이다). 대화는 `AgentView`를 폰 host로 쓴다. Inbox는 `waiting/`의 page와 card를 쓴다. (agent)
- **폰에서 안 되는 것은 숨긴다.** file 끌어 넣기와 OS path, 터미널에서 돌리기, file 열기, 단축키, 찾기 bar, bookmark, artifact link. secret 입력 요청 card는 "컴퓨터에서 넣는다"는 글만 보인다. (agent)
- **route 목록을 넓힌다.** 대화와 목록이 읽는 것(`agents/read`, `sessions/read`, `turns/read|list|body-view`, `messages/body`, `session_messages/read|search`, `calls/read`, `rewind/preview`, `apps/rewind_plan`, `providers/read`, `agent_assignments/get`, `apps/get|list`, `projects/get|list`, `input_request/read`)과 일하는 쓰기(`sessions/open`, `sessions/archive`, `calls/cancel`, `input_request/cancel`)를 더한다. `sessions/delete`는 넣지 않는다(되돌릴 수 없다). 이름은 task가 실제 route로 확인한다. (agent: "폰은 일하는 창")
- **byte는 base64로 싣는다.** 기기의 `call`이 file route를 부르면 답은 `{content_type, base64}`이고 upload route는 body에 `base64`를 싣는다. frame 종류를 늘리지 않는다. 대상은 `message-images/read|upload`와 remote 화면 bundle의 file이다. (agent: 한 file 8 MiB, frame 16 MiB 안이다)
- **화면 bundle.** renderer build에 entry `remote`를 더해 `dist/remote/`를 낸다. core가 route `remote_ui/manifest`(bundle hash와 file마다 path, hash, 크기)와 `remote_ui/file`(file route)로 내준다. 둘 다 기기 목록에 넣는다. 설치본에서는 `platform/` 아래에 두고 core가 자기 source 기준으로 찾는다(내장 skill과 같은 길). (agent)
- **touch 크기.** `packages/design`의 density에 `touch`를 더한다(control 높이 44px 이상). remote 화면이 이것으로 그린다. (agent)

## task

| wave | id | 선행 | 한 줄 |
|---|---|---|---|
| 1 | `remote-bytes` | 없음 | 기기 route 목록 넓히기, file·upload route를 base64로, 폰이 import할 좁은 protocol 입구 |
| 1 | `touch-density` | 없음 | UI kit의 `touch` density |
| 2 | `remote-web-base` | `remote-bytes`, `touch-density` | entry `remote`, bridge와 개발용 bridge, 화면 틀, session 목록, Inbox |
| 3 | `remote-web-chat` | `remote-web-base` | 대화 화면(`AgentView`의 폰 host, 무거운 import 끊기, 사진 붙이기) |
| 3 | `remote-ui-bundle` | `remote-web-base` | core가 화면 bundle을 내주는 route와 설치 묶음 |

## 위험 test (task brief에 있다)

- 넓힌 뒤에도 목록 밖 route(`sessions/delete`, secret, provider 쓰기, 설정 쓰기, `devices/*`, `pairing/*`)는 `forbidden`이다.
- `remote_ui/file`은 bundle 폴더 밖의 file을 내주지 않는다.

## lead가 할 일

- merge마다 `npm run check`. flows는 각 task가 고친다.
- 끝나면: `architecture/approval.md`(기기 route 목록), `ui-kit.md`(touch density), remote 화면의 architecture 절(새 topic이 필요하면 `architecture/remote.md`), change-log, roadmap `mobile.md` 단계 2의 web 쪽을 끝남으로.
- 사람에게: 끝난 뒤 browser에서 remote 화면을 열어(개발용 bridge) QR 내용으로 pairing하고 대화, 승인 답하기를 해 보는 확인을 부탁한다. 실제 model provider 호출은 묻는다.
