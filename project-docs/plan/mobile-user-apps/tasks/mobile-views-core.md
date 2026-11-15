# mobile-views-core

앱 화면(view)이 어느 앱·release의 것인지, 어떤 operation을 부를 수 있는지, 어떤 event를 받는지, release가 바뀌면 어떻게 다시 묶이는지를 shell main에서 core로 옮긴다. core에 view 표를 두고 route `app_views/{open,call,close}`와 event `AppViewEvent`를 낸다. 이 task는 core 쪽만 짓는다. shell main의 옛 로직은 그대로 두고(`mobile-shell-views`가 지운다) 그 둘이 같이 있어도 서로 부딪치지 않는다(core의 view 표는 아무도 안 열면 비어 있다).

- 단위: app-views (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/views`(새 폴더 전체: `mod.ts`, `ports.ts`, `table.ts`, `call.ts`, `events.ts`와 `*_test.ts`)
  - `packages/protocol/apps/views.ts`(새 file)
  - `packages/core/events/gateway.ts`
  - `packages/core/events/gateway_test.ts`
  - `packages/core/server/socket.ts`
  - `project-docs/architecture/app-call.md`
  - `project-docs/architecture/event.md`
- 공유 줄 허락(한 줄씩만 더하고 보고의 "넘길 줄"에 적는다):
  - `packages/protocol/apps/mod.ts`(`export * from "./views.ts"`), `packages/protocol/apps/registry.ts`(route 셋을 목록에)
  - `packages/protocol/events/transient.ts`(event 정의 하나와 목록의 줄 하나. `mobile-attention-core`가 이 file 전체를 소유하니 더하기만 한다)
  - `packages/core/apps/register.ts`(`memoryRoutes`에 route 셋)
  - `packages/core/main/daemon/wiring/apps.ts`(view module 만들기, memory handler 셋, 시작할 때 Bus 구독)
  - `project-docs/flows/`(`areas/app-surface.yaml` 또는 check가 요구하는 area, `areas.yaml`, `tests/core-apps.yaml`와 `tests/core-rest.yaml` 중 맞는 것)
- 읽을 것:
  - 옮길 로직(지금 shell main. 이 task가 core로 새로 쓰는 것의 본보기이고 `mobile-shell-views`가 지운다): `packages/shell/main/app-frame/app-connection.ts`(`connect`, `currentLive`, `currentPreview`, `screenParams`), `app-call.ts`(`checkCall`, `outcomeOf`, `coreFailure`, `DENIAL_CODES`, `NOT_AVAILABLE`), `app-events.ts`, `registry.ts`의 `refreshEntry`(release 따르기, card 고정), `view-model.ts`의 `checkOpen`
  - core의 재료: `packages/core/apps/ports.ts`(`AppToolCallPath`, `AppToolLookup`: operation 선언과 effect를 `find`(live, release 고정)와 `findPreview`(nonce)로 읽는다), `core/apps/calls/service.ts`(`createAppCalls`), `core/apps/preview/service.ts`(`PreviewService.current`, `declared`, `bundleHashOf`), `core/apps/releases/store.ts`(`loadRelease`, `loadStoredDeclaration`, `loadActiveDeclaration`), `core/main/daemon/wiring/apps.ts`(`apps/call_tool` handler, `appsControl.client.observe`, `announce`로 `AppEventPublished`를 내는 곳, `AppViewSignal`로 `AppViewChanged`를 내는 곳), `core/events/{gateway,ports}.ts`의 Bus와 `bus.subscribe`(본보기: `core/main/daemon/wiring/session-snapshots.ts:65`), 입력 검사 `protocol/apps/declaration/schema.ts`의 `validateInput`
  - architecture: `project-docs/architecture/app-call.md`("앱 화면", "지키는 것"의 호출 경로 4·화면), `event.md`(Gateway, 앱 event 길), `remote.md`(폰 자격은 principal `device:<id>`)
  - 이슈: `project-docs/issues/preview-screen-cannot-call-operation.yaml`(이 task가 닫는다)
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/app-place-survey.md`의 1.3, 2의 4, 3.3~3.4
- 계약:
  - 쓰는 것: `apps/call_tool`의 호출 경로(`AppToolCallPath.call`, `kind: "operation"`, caller `{kind: "person", view_session}`)는 바꾸지 않는다. view 표는 그것을 부르는 한 호출자다
  - 내놓는 것: 아래 route 셋, event 하나, Gateway session의 `owner` 옵션. `mobile-shell-views`, 폰 gate, 폰 host가 이것을 쓴다. 이 계약을 바꿔야 하면 고치지 말고 보고한다

### route (`packages/protocol/apps/views.ts`, memory, actor `user`)

owner는 요청을 보낸 credential의 principal이다(`RequestContext.principal`: shell main과 CLI는 `user`, 폰은 `device:<id>`). 표의 key는 `(owner, view)`다. 다른 owner의 view는 없는 view와 같게 답한다.

```
app_views/open   input  {view: string(8..64, 제어 문자 없음, host가 만든 불투명 id),
                         mode: "live" | "preview",
                         app: AppId,
                         release: ReleaseId | null,
                         screen: string(비지 않음),
                         place: string(비지 않음),
                         params?: JsonObject,
                         workspace?: {kind: "project"|"home"|"app", id: string, folders: string[]}}
                 output {view, release: ReleaseId | null, bundle_hash: sha256, process_nonce: string,
                         params: JsonObject | null}
                 errors invalid_input, not_found, forbidden, conflict, unavailable
app_views/call   input  {view, operation: string, input: Json}
                 output {outcome: {ok: true, value: Json} | {ok: false, error: {code: string, message: string}}}
                 errors invalid_input, not_found, unavailable
app_views/close  input  {view}
                 output {closed: boolean}
                 errors invalid_input
```

- `open`:
  - live: `release`가 null이면 지금 활성 release에 묶는다(따라간다). 값이 있으면 지금 활성 release와 같아야 하고 다르면 `conflict`. 앱이 안 돌면 `unavailable`, 앱이 없으면 `not_found`. 보관한 앱은 `unavailable`이다(`DENIAL_CODES`의 `app_archived`와 같은 이유).
  - preview: 그 앱의 지금 preview process에 묶는다(ready가 아니면 `unavailable`). `release`가 값이면 preview의 release와 같아야 하고 다르면 `conflict`, null이면 어떤 preview든 받는다.
  - 선언을 읽을 수 있으면(live, 그리고 release가 있는 preview) `screen`이 그 선언에 있어야 하고 `place`가 그 화면의 `places`에 들어야 한다(아니면 `invalid_input`). release 없는 preview는 읽을 선언이 없어 이 검사를 건너뛴다(지금과 같다). 지금 desktop에서 열리는 view가 선언에 없는 자리로 열리는 곳이 있으면(어느 renderer·shell 호출이 그런지 코드를 열어 본다) 그 호출을 고치지 말고 이 검사를 `place == "phone"`일 때만 걸고 보고한다.
  - `params`가 있으면 그 화면 선언의 `params` schema로 `validateInput`한다. schema 없는 화면에 주거나 맞지 않으면 `invalid_input`. release 없는 preview에 `params`를 주면 `unavailable`(지금과 같다). 통과한 값(정규화)을 표에 두고 output `params`로 돌려준다. `params`를 안 줬으면 null이다.
  - 같은 `(owner, view)`로 같은 인자(`app, mode, release, screen, place, params, workspace`가 모두 같다. 표는 처음 받은 인자를 그대로 쥔다)를 다시 보내면 새 view를 만들지 않고 지금 binding을 다시 읽어 돌려준다(resume. host가 끊겼다 돌아올 때, asset이 낡았을 때, 표에서 내보내진 view를 되살릴 때 부른다). card가 아닌 view는 `conflict` 없이 지금 활성 release(preview는 지금 preview process)로 갱신하고, card view는 묶인 release가 지금 활성과 다르면 `conflict`다. 표에 없으면 새로 연다. 인자가 다르면 `conflict`.
  - owner마다 view 64개까지다. 65번째를 열면 가장 오래 쓰지 않은 view(open·call·event가 마지막으로 닿은 순서를 세는 counter로 센다. 시각을 쓰지 않는다)를 내보내고 그 view에 `lost`(`evicted`) event를 낸다. 이유: core가 shell보다 오래 살아 shell이 다시 뜨면 옛 view가 남고, 실패로 하면 core 재시작까지 열 수 없다.
- `call`: 표의 binding으로 부른다. 호출 대상은 live면 `{mode: "live", app, release: <묶인 release>}`, preview면 `{mode: "preview", app, process_nonce: <묶인 nonce>}`다. 입력 검사(`checkCall`과 같다): `operation`은 비지 않고 앞뒤 공백이 없고 제어 문자와 `*`가 없다, `input`은 JSON 왕복이 같은 값이고 64 KiB 이하(`invalid_input`). operation이 묶인 release(preview는 preview bundle)의 선언에 없으면(command 이름, 없는 이름, 다른 앱의 이름 모두) 같은 답 `outcome: {ok: false, error: {code: "forbidden", message: "operation is not available"}}`. 선언에 있으면 `AppToolLookup.find`/`findPreview`로 effect를 얻어 `apps/call_tool` 경로를 `kind: "operation"`, caller `{kind: "person", view_session: <view id>}`로 부르고 결과를 지금 shell의 `outcomeOf`와 같은 규칙으로 outcome에 옮긴다: succeeded는 value(8 MiB `CALL_RESULT_MAX_BYTES`를 넘으면 `unavailable` "result is too large"), failed는 앱이 낸 code와 message를 그대로(이 code는 일곱 오류 code가 아니다. outcome 안에만 있다), denied는 `DENIAL_CODES` 표대로, unknown은 `unavailable` "result unknown". 호출 경로 자체가 실패하면 `coreFailure`와 같다(write·external이고 끊겼으면 "result unknown", read면 "app is not available"). 이 task는 preview도 부른다(이슈 `preview-screen-cannot-call-operation`).
- `close`: 없는 view와 다른 owner의 view는 `{closed: false}`다(있는지 새지 않는다).

### event (`packages/protocol/events/transient.ts`)

```
AppViewEvent (transient, subject: AppId)
 payload: {owner: string, view: string} 와 아래 중 하나(kind로 가른다):
   {kind: "event",   source: string, event: string, payload: Json}
   {kind: "rebound", release: ReleaseId | null, bundle_hash: sha256, process_nonce: string}
   {kind: "lost",    reason: "app_stopped" | "app_archived" | "conflict" | "evicted"}
```

- `event`: core가 낸 `AppEventPublished`(`announce`)를 view 표가 받아, 그 `audience`(null이면 모두, 아니면 그 앱들만)에 view의 앱이 들고, 묶인 release의 선언 `subscriptions`에 `(source, event)`가 있는 live view마다 한 번 낸다. 선언은 release마다 고정이라 한 번 읽어 둔다. preview view는 event를 받지 않는다(지금과 같다).
- `rebound`: `AppViewChanged`가 오면 그 앱의 모든 view를 다시 묶고(live: 활성 release를 따른다. place가 `card`인 view는 따르지 않고 묶인 release 그대로) 묶음이 있으면 그 view마다 `rebound`를 낸다. binding이 그대로여도 낸다(grant가 바뀌어 host가 CSP를 다시 읽을 때가 있다).
- `lost`: 다시 묶지 못했다. 앱이 안 돈다 `app_stopped`, 보관했다 `app_archived`, card가 묶인 release와 다른 release가 활성이다 `conflict`, 내보냈다 `evicted`. lost가 된 view는 표에 남고 다음 `AppViewChanged`나 `open` 다시 부르기로 되살아난다.
- Gateway: `createGatewaySession(socket, bus, {events?, owner?})`의 `owner`가 있으면 `AppViewEvent`는 `payload.owner === owner`일 때만 session에 간다. `owner`가 없으면 `AppViewEvent`는 어느 session에도 가지 않는다(기본이 막기). 사람 token session(`packages/core/server/socket.ts`의 `attachSession`)은 `owner: ctx.principal`을 준다. 폰 쪽(`packages/core/remote/host.ts`와 `REMOTE_ALLOWED_EVENTS`)은 이 task가 고치지 않는다. 뒤의 `mobile-remote-gate`가 한다.

## 할 일

1. `packages/protocol/apps/views.ts`에 위 route 셋과 입력·출력 schema를, `transient.ts`에 `AppViewEvent`를 정의한다. route는 `defineMemory`로, actor `user`, 오류는 위 목록(일곱 code만)이다. `mod.ts`, `registry.ts`, `register.ts`의 `memoryRoutes`에 한 줄씩 더한다.
2. `packages/core/apps/views/`에 view module을 짓는다. 표는 메모리에만 있다(ledger step도 새 wiring도 없다). 의존은 port로 받는다(`ports.ts`): 활성 live 관측(앱 process의 release·nonce·ready와 release의 bundle hash)과 preview 관측(`PreviewService.current`가 release를 안 주면 `previews/get`의 관측이 주는 것을 쓴다), release의 선언(screens·operations·subscriptions)과 operation lookup, `AppToolCallPath.call`, 앱 상태(보관 여부). 시각과 id는 받지 않는다(view id는 host가 주고 LRU는 counter다).
   - `table.ts`: `open`(위 규칙 전부), `close`, 내보내기, `AppViewChanged` 처리.
   - `call.ts`: 위 `call`. 지금 `app-call.ts`의 `checkCall`·`outcomeOf`·`coreFailure`·`DENIAL_CODES`를 옮겨 쓴다.
   - `events.ts`: `AppEventPublished`를 받아 `AppViewEvent`를 낸다.
3. `packages/core/main/daemon/wiring/apps.ts`에서 module을 만들고 memory handler 셋을 붙이고, `start`에서 Bus의 `AppViewChanged`·`AppEventPublished`를 구독해 module에 넘긴다(`stop`에서 푼다). `AppViewEvent`는 `ctx.peek.bus?.publish`로 낸다(`announce`와 같은 길). 새 ledger schema step이나 새 wiring file이 필요해 보이면 만들지 말고 보고한다.
4. `core/events/gateway.ts`에 `owner` 옵션과 위 거르기를, `core/server/socket.ts`의 `attachSession`에 `owner: ctx.principal`을 더한다. shell main의 `coreInternal` 호출과 Gateway 연결이 같은 principal(`user`)인지 `core/main/daemon/control.ts`의 `connect`를 열어 확인하고, 다르면 고치지 말고 보고한다.
5. test(아래 "끝남"의 위험 test만)와 문서를 쓴다. `architecture/app-call.md`: "앱 화면"에 view binding이 core의 view 표라는 것, 신원은 host가 붙인 view id와 owner이고 page가 낸 값은 신원이 아니라는 것, "지키는 것"에 "operation은 묶인 release의 선언에 있는 것만"과 owner 거르기를 더하고 "shell main이 ... 정한다"로 적힌 곳은 `mobile-shell-views`가 지울 때까지 core의 것으로 고친다(shell이 지금 하는 일은 shell-views가 옮길 때 문서도 맞춘다는 줄을 한 줄 남긴다). `event.md`: `AppViewEvent`와 Gateway `owner` 거르기. 300행 부근의 알려진 한계 "preview 화면은 operation을 부르지 못한다"는 지운다(이 task가 고친다). 선언의 자리 목록(35행)은 `mobile-place-decl`이 고친다.
6. flows catalog(`project-docs/flows/`, `flows` skill): 새 route 셋의 입구와 outcome, 새 test file의 줄. 옛 flow `app-operation-call`(shell의 `ipc:app:call-operation`)과 `app-event-view-deliver`는 shell이 아직 하므로 그대로 둔다(`mobile-shell-views`가 고친다).

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 통과한다(core가 새 route와 event를 등록하고 뜬다).
- 위험 test(몇 개로 충분하다. 모두 fake port를 쓰는 단위 test이고 server나 subprocess를 띄우지 않는다):
  - "view의 operation 호출은 묶인 release가 선언한 operation만 부른다: 선언에 없는 이름, command 이름, 다른 앱의 이름은 같은 forbidden outcome이고 core 호출 경로까지 가지 않으며, 호출 대상(앱, release, nonce)과 caller는 표의 binding에서만 온다"
  - "다른 owner가 연 view는 call과 close에서 없는 view와 같고, `AppViewEvent`는 같은 owner의 Gateway session에만 가고 owner를 주지 않은 session에는 가지 않는다"(Gateway 쪽은 `gateway_test.ts`에 한 case)
  - "앱 event는 묶인 release가 구독을 선언했고 audience에 든 live view에만 `AppViewEvent`로 가고, card view는 release가 바뀌면 따라가지 않고 `lost`(`conflict`)가 되며, owner당 64개를 넘으면 가장 오래 안 쓴 view가 `evicted`로 나간다"
  - (유지) 지금 shell의 `registry_test.ts`가 보던 "params가 그 화면 선언의 schema에 맞지 않으면 열기가 거절된다"를 core의 `open` test에 한 case로 옮긴다. shell 쪽 test는 `mobile-shell-views`가 지운다
- 남지 않음: 없음(shell의 옛 로직과 test는 `mobile-shell-views`가 지운다).
- `project-docs/flows/`가 check를 통과한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 세 route의 입력·출력 예 하나씩, 등록할 것·넘길 줄(위 공유 줄을 각각 어디에 어떻게 더했는지), shell main과 Gateway의 principal 확인 결과, 지금 desktop이 선언에 없는 자리로 view를 여는 곳이 있었는지, 이슈 `preview-screen-cannot-call-operation`이 이 task로 닫히는지(preview 호출을 test로 확인한 근거), 새 ledger step·wiring이 필요했는지.
