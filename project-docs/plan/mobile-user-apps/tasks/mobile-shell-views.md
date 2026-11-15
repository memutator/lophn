# mobile-shell-views

shell main이 앱 view의 연결, operation 호출, 앱 event 받기, release가 바뀔 때 다시 묶기를 core의 `app_views/*`와 `AppViewEvent`로 바꾸고, 같은 일을 하던 shell main의 옛 로직과 test를 지운다. desktop 사람이 보는 동작은 그대로이고(preview 화면에서 operation이 불린다는 것만 새로 된다), 신원을 호스트(shell main)가 view id로 붙이는 구조가 된다.

- 단위: app-views (wave 2)
- 선행: mobile-views-core, mobile-place-decl
- 소유(이 task만 고친다):
  - `packages/shell/main/app-frame/app-connection.ts`
  - `packages/shell/main/app-frame/app-call.ts`
  - `packages/shell/main/app-frame/app-call_test.ts`
  - `packages/shell/main/app-frame/app-events.ts`
  - `packages/shell/main/app-frame/binding.ts`
  - `packages/shell/main/app-frame/declaration-source.ts`
  - `packages/shell/main/app-frame/registry.ts`
  - `packages/shell/main/app-frame/registry_test.ts`
  - `packages/shell/main/app-frame/view-model.ts`
  - `packages/shell/main/desktop/wiring/app-views.ts`
  - `packages/shell/main/desktop/wiring/app-calls.ts`
  - `project-docs/architecture/app-call.md`
  - `project-docs/architecture/event.md`
- 공유 줄 허락: `project-docs/flows/`(`areas/ipc.yaml`, `areas/app-surface.yaml`, `areas/app-runtime.yaml`의 옛 flow 줄, `tests/shell.yaml`의 지운 test file 줄. 충돌은 lead가 푼다)
- 읽을 것:
  - 이 task가 바꾸는 로직: `packages/shell/main/app-frame/{app-connection,app-call,app-events,binding,declaration-source,registry,view-model}.ts`, `desktop/wiring/{app-views,app-calls}.ts`
  - 새로 쓰는 core 쪽: `mobile-views-core`의 brief(`project-docs/plan/mobile-user-apps/tasks/mobile-views-core.md`)의 계약, 그것이 지은 `packages/protocol/apps/views.ts`와 `packages/core/apps/views/`
  - 그대로 두는 shell 쪽(건드리지 않는다): asset handler와 CSP(`app-protocol.ts`, `session-policy.ts`, `network-policy.ts`), guest 붙이기와 crash(`registry.ts`의 `acceptGuest`·`bindGuest`·health), overlay, annotate, capture, external link, tab head와 keep-alive IPC, `app-ipc.ts`와 `view-ipc.ts`의 IPC 모양
  - architecture: `project-docs/architecture/app-call.md`("앱 화면"), `event.md`
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/app-place-survey.md`의 1.3, 2의 4
- 계약:
  - 쓰는 것: `app_views/open|call|close`와 `AppViewEvent`(`mobile-views-core`의 계약 그대로). 이 계약을 바꿔야 하면 고치지 말고 보고한다
  - 내놓는 것: desktop 앱 화면의 IPC(view 열기·닫기·다시 열기, `app:call-operation`, `app:event`)와 `lophnApp`은 모양이 그대로다. 이 task 뒤 `desktop/wiring/context.ts`의 `ctx.appConnector`는 `hosts`만 내는 slim한 것이다(`context.ts`를 고치지 않는다)

## 할 일

1. `registry.ts`의 `open`: `checkOpen`의 모양 검사는 남기고(IPC 입력은 renderer가 보낸 것이라 shell main이 한 번 본다), view id(`deps.ids.viewSession()`)를 먼저 정해 core `app_views/open`을 `{view, mode, app, release, screen, place, params?, workspace?}`로 부른다. 연결(release, bundle hash, process nonce)과 정규화된 `params`는 core의 output을 쓴다. `connector.connect`와 `screenParams`, `validateParams` 의존은 없앤다(선언 검사와 `params` 검사는 core가 한다). core의 오류는 지금 `mapped`와 같게 좁힌다: `invalid_input`·`forbidden`·`conflict`는 그대로, 나머지(`not_found` 포함)는 `unavailable` "app is not available". 그 뒤 `connector.hosts`로 CSP host를 읽는다. hosts가 실패하면 `app_views/close`로 방금 연 view를 닫고 실패를 돌려준다. entry는 처음 보낸 요청 인자를 그대로 쥔다(resume이 같은 인자여야 하므로).
2. `refreshEntry`: `bind` 대신 core `app_views/open`을 entry가 쥔 처음 인자로 다시 불러(resume) 새 binding을 받고, hosts를 다시 읽어 `sameConnection`으로 견주고 다르면 `remount`한다. 실패(`conflict`, `unavailable`)는 지금처럼 `connectionState: "unavailable"`이다. 외부에서 부르는 `appFrame.refresh(app?)`는 asset이 낡았을 때(`stale`)를 위해 남긴다.
3. `close`와 `closeWindow`와 `dispose`: view를 지울 때 core `app_views/close`를 부른다(실패는 무시한다. 기다리지 않는다).
4. 앱 event와 다시 묶기를 `AppViewEvent` 하나로 받는다: `desktop/wiring/app-views.ts`의 relay 조건을 `AppViewChanged`에서 `AppViewEvent`로 바꾸고(`AppViewChanged` 구독과 `appFrame.refresh(event.subject)` 줄은 지운다. core가 `rebound`를 낸다. 같은 event를 쓰는 `wiring/agent.ts:282-294`의 일은 그대로다), `registry`에 `viewEvent(payload)`를 더한다: `kind: "event"`이고 그 view가 있으면 page에 `APP_EVENT_CHANNEL`로 `{source, event, payload}`를 보낸다(지금 `app-events.ts`가 보내던 것과 같다. view가 없거나 page가 안 붙었으면 버린다). `kind: "rebound"`와 `"lost"`는 그 view의 `refreshEntry`를 부른다. 알 수 없는 view의 event는 버린다. `registry`는 protocol을 import하지 못하므로 payload는 구조 type으로 받는다(wiring이 넘긴다).
5. `app-call.ts`: `createAppCall`을 core 전달 하나로 줄인다(`{call: CoreCaller}`). IPC에서 온 값에서 `operation`과 `input`만 꺼내 core `app_views/call {view: view.view_session, operation, input}`을 부른다(page가 view·app·release·caller 같은 칸을 실어도 쓰지 않는다. 값이 객체가 아니거나 `operation`·`input` 말고 다른 칸이 있으면 `invalid_input` "call is invalid"로 로컬에서 거절한다). core가 ok면 `value.outcome`을 그대로 `CallOutcome`으로 돌려주고(앱 오류 code는 일곱 code가 아니라 그대로 간다), Result 오류는 `invalid_input`이면 "call is invalid", `not_found`(core가 view를 모른다)와 그 밖은 `unavailable` "app is not available"로 바꾸고 `not_found`일 때는 그 view의 `refreshEntry`도 부른다(resume이 다시 연다). `CallOutcome` type은 다른 file(`app-agent.ts`, `app-agents.ts`, `app-projects.ts`, `app-sessions.ts`, `external-link.ts`, `app-ipc.ts`)이 import하므로 그대로 내놓는다. `checkCall`, `outcomeOf`, `coreFailure`, `DENIAL_CODES`, `AppDeclaration`, `DeclarationSource`는 없앤다.
6. `app-connection.ts`: `connect`, `screenParams`, `currentLive`, `currentPreview`와 그 보조(`mapped`, `Process`)를 지우고 `createAppConnector`는 `hosts`만 남긴다(`declaredHosts`, `fetchScope` 포함). `CoreCaller`, `CallResult`, `Outcome`, `failure`, `ConnectTarget`, `AppBinding`, `Place`, `PlaceWorkspace`, `ViewMode` type은 다른 file(`browser/*`, `desktop/app-window-ipc.ts`, `view-error.ts` 등)이 import하므로 남긴다. `binding.ts`는 새 구조에 맞게 줄이거나(core output과 hosts로 `Bound`를 만드는 한 함수) 쓰는 곳이 없으면 지운다. `declaration-source.ts`는 `createEntryScreen`만 남기고 `createDeclarationSource`를 지운다. `app-events.ts`는 지운다. `app-call_test.ts`는 지운다(core의 test로 옮겨졌다). `registry.ts`의 `liveViews()`는 쓰는 곳이 없으면 지운다.
7. `registry_test.ts`: connector 대신 `CoreCaller`를 흉내 내어 core의 `app_views/*` 답을 돌려주게 고친다. `validateParams`를 쓰던 case("선언의 params schema에 맞지 않는 인자…")는 core가 하므로 지우고, core가 돌려준 정규화된 `params`만 화면 주소 query로 가는 것을 보는 한 case는 남긴다. 나머지 case(guest 붙이기 1회, 신원 묶기, crash 뒤 reopen, 다른 창은 못 닫기)는 새 모양에 맞춰 둔다.
8. 문서와 flows: `architecture/app-call.md`에서 shell main이 연결·호출·`params` 검사·event 거르기를 한다고 적힌 곳(`shell main`을 `grep -n`으로 찾는다. 78·80·100·175행 부근과 "화면 bridge" 줄)을 core가 binding을 쥐고 shell main은 view id를 붙이는 호스트라고 고친다. `event.md`의 `AppEventPublished → shell main → 열린 앱 화면` 그림과 문장(47·64행 부근)을 `AppEventPublished → core view 표 → AppViewEvent(owner 거르기) → shell main → 화면`으로 고친다. flows catalog: `ipc:app:call-operation`의 flow `app-operation-call`(preview에서 operation이 불린다는 갈래가 생겼고 "live만 다룬다"는 `unclear`가 사라진다), `ipc:app:event`의 flow `app-event-view-deliver`, 지운 test file의 줄(`tests/shell.yaml`).
9. 손으로 확인한다(`npm run dev`, `.dev-data/` 안): 앱 화면이 열리고 operation이 불리고, 앱을 다시 release하면 화면이 새 판으로 다시 뜨고, 앱 event를 구독한 화면이 event를 받고, 앱 preview 탭에서 operation이 불리는지 본다. 사람의 `~/.lophn`과 실제 model provider를 쓰지 않는다. 안 되는 것이 있으면 고치지 말고 어디서 어긋나는지 보고한다.

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 통과한다.
- 위험 test: 없음(옛 `app-call_test.ts`가 보던 두 규칙은 core의 `mobile-views-core` test가 본다. 이 task는 새 test를 더하지 않는다. `registry_test.ts`는 위 7대로 고친다).
- 남지 않음: `grep -rn "createDeclarationSource\|createAppEvents\|DENIAL_CODES\|screenParams\|validateParams\|connector.connect" packages tools tests --include=*.ts --include=*.tsx`가 0줄이다. `grep -rn "AppEventPublished" packages/shell`이 0줄이다(core가 거르므로 shell은 이 event를 받지 않는다).
- `project-docs/flows/`가 check를 통과한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 지운 file과 줄인 file의 목록(줄 수 전후), 9번 손 확인의 결과(되는 것과 안 되는 것), `lost`·`rebound`를 받았을 때 view가 어떻게 움직이는지 한 문단, 이슈 `preview-screen-cannot-call-operation`이 desktop에서도 풀렸는지.
