# use-events

다른 기계의 앱 event를 구독한다. job의 trigger와 앱 선언의 구독에 "어느 기계의"를 적고, 부르는 기계의 core가 그 선언들을 모아 그 기계의 link에 구독자 하나로 걸고, 온 event를 이 기계에서 난 기계를 실어 낸다. 받는 기계는 private이 아닌 앱이 낸 event만 내준다.

- 단위: use (wave 3)
- 선행: use-receive, use-send. 받는 쪽 `host.ts`와 보내는 쪽 `machineLinks` 위에 짓는다.
- 소유(이 task만 고친다):
  - `packages/protocol/jobs/{values,jobs}.ts`(`jobFireEvent`의 입력과 `jobEventTriggers`의 줄), `packages/protocol/apps/declaration/{read,value,types,validate_test}.ts`, `packages/protocol/events/transient.ts`(`AppEventPublished`만)
  - `packages/core/remote/subscriptions.ts`(새 file), `packages/core/remote/subscriptions_test.ts`(새 file), `packages/core/remote/{host,host_test,links}.ts`, `packages/core/events/gateway.ts`, `packages/core/events/gateway_test.ts`
  - `packages/core/main/daemon/wiring/{remote,apps,jobs,folder,context}.ts`
  - `packages/core/apps/events/publish.ts`, `packages/core/apps/events/publish_test.ts`
  - `packages/core/folder/ports.ts`, `packages/core/folder/import/events.ts`, `packages/core/folder/export/events.ts`(늦은 길과 한 번만 내는 자리를 맞춘다. 아래 "늦은 길과 만나는 곳")
  - `packages/core/jobs/{events,events_test,commands}.ts`, `packages/cli/commands/job.ts`(trigger 설명 글)
  - `packages/sdk/declaration/`, `packages/sdk/app-ui/package.json`, `packages/sdk/app-ui-native/package.json`, pin 자리(`sdk-note`의 grep으로 찾은 것만: 지금 `packages/core/apps/packages/template/app/{lophn.ts.tmpl,package.json.tmpl,AGENTS.md.tmpl}`, `tests/support/app/{sample,local}/lophn.ts.tmpl`, `tests/support/app/local/package.json.tmpl`, `packages/sdk/declaration/guide.md`, `package-lock.json`), `packages/core/agent-workspaces/skills/migrate-sdk/{declaration-4.11.0,app-ui-2.22.0,app-ui-native-1.9.0}.md`(새 file. 지금 판은 declaration 4.10.0, app-ui 2.21.0, app-ui-native 1.8.0이고 app-ui·app-ui-native는 declaration을 정확히 pin한다)
  - `project-docs/flows/areas/{automation,sdk,core-platform}.yaml`, `project-docs/flows/tests/{core-rest,core-apps,libs-tooling}.yaml`
- 읽을 것:
  - `project-docs/plan/remote-use/tasks/use-contract.md`(뒤 task가 더할 이름: trigger `machine`·`source_machine`, `jobEventSchema.machine`, `subscriptions[].machine`, event caller의 `machine`)
  - 계획 README "정한 것"의 "구독하는 주체가 있다", "받는 기계가 내주는 event는 앱이 밖에 낸 것뿐이다", "private은 기계 사이에도 선다"
  - architecture: `event.md`("앱 event", 지키는 것), `job.md`("event로 도는 job", "주인 기계"), `app-call.md`("앱 event", 지키는 것 "호출 경로" 10), `remote.md`
  - 변경 기록 `project-docs/products/change-log/0.23/one-screen.yaml`("core" 항목: `machines/watch`가 구독자마다의 조건을 합쳐 그 컴퓨터에 건다), `carry-paths.yaml`("기계를 건너는 event와 `data.changed`" 항목: `across_machines` event가 file로 가고 도착한 컴퓨터가 한 번 낸다), architecture `folder-sync.md`(event file)
  - 조사 `reports/multi-device/survey-n3-remote-use.md` 1.5, 8절 7·8
  - boundary·module: `event-stream`, `remote-protocol`, `sdk-api`; module `events`, `jobs`, `apps`, `remote`
  - skill: `.claude/skills/sdk-note/SKILL.md`
- 계약:
  - 쓰는 것: `ctx.machineLinks`(`computers`, `resolve`), `isPrivate`, `Links.watch(subscriber, machine, conditions)`(`core/remote/links.ts`. 구독자는 `MachineSubscriber = {capability: string | null, watcher: string}`이고 core 안 구독자는 `capability: null`이다. 기계의 합은 구독자 조건의 합에 나르기의 `StateChanged`를 더한 것), `MachineFrameReceived`(`protocol/events/transient.ts`, payload `{machine, frame, watcher?}`. `watcher`는 `ready`에만 실린다), `ctx.eventDelivery`(`addInternal`, `publish`), `InternalSubscriber`, event caller의 `machine`(`carry-paths`가 이미 두었다), `EventArrived`·`createEventArrival`·`readArrivedEvents`·`folder_events_seen`(늦은 길)
  - 내놓는 것: trigger 입력 `machine?: MachineRef`, 저장 `source_machine?: mch_`, `jobEventSchema.machine?: mch_`, 선언 `subscriptions[].machine?: <컴퓨터 이름>`, `jobFireEvent` 입력과 `jobEventTriggers` 줄의 `machine`, `AppEventPublished` payload의 `publication`·`trace_id`·`chain`·`cross_id`, `EventDelivery.receive(machine, event)`, `machineLinks.watch`, allowlist에 더할 `REMOTE_COMPUTER_EVENTS = ["AppEventPublished"]`

## 할 일

1. 받는 기계(내주기):
   - `host.ts`: 컴퓨터의 Gateway session은 `REMOTE_ALLOWED_EVENTS`(지금 `createGatewaySession(..., {events: REMOTE_ALLOWED_EVENTS, owner})`. 폰과 컴퓨터가 같은 목록)에 `REMOTE_COMPUTER_EVENTS`를 더해 받는다(폰은 그대로). host는 기기의 kind를 모르므로 dep에 `kind(principal)`(`ctx.deviceKind`)을 더한다.
   - `gateway.ts`: session 선택지에 event를 거르는 함수 하나.
   - 거르기는 `wiring/remote.ts`가 준다: `AppEventPublished`는 subject(앱)가 있고, audience가 null이고, 그 앱의 workspace `{kind:"app", id}`가 이 기계의 call 정책에서 private이 아닐 때만 간다. `lophn`이 낸 것은 가지 않는다.
2. `AppEventPublished` payload(지금 `{source, event, payload, audience}`의 strictObject. `protocol/events/transient.ts` 166줄)에 그 발행의 `publication`, `trace_id`, `chain`과 `across_machines` event의 `cross_id`(optional)를 더한다(`wiring/apps.ts` 572줄의 `announce`, `publish.ts`의 `createEventDelivery.publish`가 `deps.announce`를 부르는 자리). 받는 쪽이 event caller를 만든다.
3. 부르는 기계(구독 걸기), 새 `packages/core/remote/subscriptions.ts`. 원하는 기계는 둘의 합이다.
   - 이 기계가 주인이고 승인되고 켜진 event job 가운데 `source_machine`이 있는 것(`jobEventTriggers`의 줄에 `machine`과 만든 workspace를 더해 읽는다). 만든 workspace가 private이면 뺀다.
   - active 앱의 active release 선언 `subscriptions[].machine`을 `resolve`로 푼 것. 그 앱 workspace가 private이면 뺀다. 이름을 못 풀거나 후보가 여럿이면 걸지 않고 log를 남긴다.
   - 기계마다 core 구독자 하나(`{capability: null, watcher: "core:app-events"}`, 조건 `[{types:["AppEventPublished"]}]`)를 `Links.watch`로 건다(`machineLinks`에 `watch(machine, conditions)`를 더해 remote wiring이 낸다). 화면의 구독은 구독자 키가 달라 덮이지 않는다. 합은 link가 만든다.
   - 다시 계산하는 때: core가 설 때, job과 release·앱이 바뀐 `StateChanged`, 명단이 바뀔 때. 끊겼다 붙으면 link가 합을 다시 건다. 저장하지 않는다(README "구독은 선언에서 온다").
   - link가 이 구독자의 event를 어떻게 받는가(lead 결정: 아래대로 한다): 지금 `links.ts`는 구독자들의 합에 든 event를 모두 `MachineFrameReceived`로 bus에 싣고, shell main(`desktop/wiring/machines.ts`의 `deliver`)은 그 기계를 보는 모든 창에 그대로 보낸다(창마다 조건으로 다시 거르지 않는다). 그대로 두면 core 구독자만 원한 `AppEventPublished`가 창에 간다. 그래서 `LinksDeps`에 `onPeerEvent(machine, event)`를 더해(`onPeerCarry`와 같은 꼴) 구독자 가운데 `capability === null`의 조건에 맞는 event는 그 callback으로 받고, bus의 `MachineFrameReceived`는 화면 구독자(`capability !== null`)의 조건에 맞을 때만 낸다. 그러면 4의 `receive`는 bus를 보지 않는다(모든 frame을 창에 싣지 않는다).
4. 온 event 내기: link가 준 `AppEventPublished`를 `ctx.eventDelivery`의 새 입구 `receive(machine, event)`로 넘긴다(`publish.ts`). 받는 쪽은 둘이다.
   - 안 구독자(jobs)에게 `machine`을 실어 준다(`EventToDeliver.machine`이 이미 있다. 늦은 길이 같은 칸으로 낸다).
   - 앱 구독자는 아래 "구독자 가리기"대로 받는다. caller는 `{kind:"event", publisher, event, publication, trace_id, chain, parent_invocation: null, machine}`(`publication`·`trace_id`·`chain`은 payload가 싣는다). chain에 구독자가 있으면 넘기지 않는다(기계를 건넌 고리도 끊긴다. 앱 id는 기계 사이 같다).
   - 이 기계에 발행 기록 줄을 쓰지 않는다(그 기계에 있다). 지금 `delivery.publish`는 늘 `insertPublication`을 하므로(`machine` 칸이 있는 줄) `receive`는 기록 없이 전달만 하는 갈래를 `publish`에 더하거나 `machine`이 있는 줄로 남긴다. 늦은 길은 후자를 쓴다(`app_event_publications.machine`). 둘 중 하나로 같게 하고 보고한다.
   - 구독자 가리기는 한 곳이 두 길에 같이 쓴다. 지금 `subscribersOf`(`publish.ts` 97줄)는 `source`와 `event`로만 맞춘다. 난 기계(`machine`)를 인자로 받아 고친다. event에 `machine`이 없으면(이 기계의 event) `machine`이 있는 구독은 넘기지 않는다. event에 `machine`이 있으면 (a) 선언의 `machine`을 풀어 그 기계인 구독, (b) 선언에 `machine`이 없고 발행 앱이 이 기계에도 있는(이 기계의 active release가 그 event를 `across_machines`로 선언한) 구독에 넘긴다. (b)는 늦은 길이 지금 하는 것이다(같은 앱의 event는 같은 구독자가 받는다). 그래야 같은 event가 어느 길로 먼저 와도 같은 구독자가 받는다. 다른 기계에만 있는 앱의 event는 (a)와 안 구독자(jobs의 `source_machine`)만 받는다.
   - 늦은 길의 `createEventArrival`은 이 기계에 그 앱·같은 bundle·`across_machines` 선언이 있어야 낸다(`sync_to`로 같이 든 앱). `receive`는 앱이 없어도 (a)와 안 구독자에게 낸다.

늦은 길과 만나는 곳(같은 event가 연결과 늦은 길 둘로 와도 한 번만 낸다):
- 늦은 길: 폴더·연결·폰이 나른 event file(`machines/<mch>/apps/<app>/events/<id>.json`, id는 `writeEventFile`이 `ids.newId("evt")`로 만든 ULID. `packages/core/folder/export/events.ts` 41줄)을 `readArrivedEvents`(`packages/core/folder/import/events.ts`)가 읽는다. 그 함수가 한 transaction에서 `folder_events_seen`(ledger step `folder.events-seen`, 칸 `machine, origin, app, event, seen_at`. 이 기계·난 기계·앱·file id)에 `INSERT ... ON CONFLICT DO NOTHING`을 해 새 줄이 생긴 file만 `EventArrived`(`folder/ports.ts` 156줄, Late 칸 `eventArrived`)로 넘긴다. 그 port를 `createEventArrival`(`apps/events/publish.ts` 422줄. 앱 있음, private 아님, 나이, 같은 bundle, `across_machines`, payload를 본다)이 받아 `delivery.publish({... machine: origin})`로 낸다. 같은 file이 여러 길로 와도 행 하나라 한 번이다.
- 연결로 오는 event에는 그 file id가 없다(발행 기록의 `pub_` id와 file의 `evt` ULID는 따로 만들어진다). 그래서 두 길이 만나려면 같은 key가 있어야 한다(lead 결정: 아래대로 한다). 낸 기계가 `across_machines` event일 때 file id를 먼저 만들어(`createEventPublisher`) `crossEvents.write`에 주고(`writeEventFile`이 `ids.newId("evt")` 대신 받은 id를 쓴다) `AppEventPublished` payload에 `cross_id`(optional)로 싣는다. 받는 기계의 `receive`는 `cross_id`가 있으면 `readArrivedEvents`의 `INSERT ... ON CONFLICT DO NOTHING` 부분을 뺀 함수(예: `markEventSeen(tx, {me, origin, app, id, at})`, 새 줄이면 true)로 같은 표에 적고 새 줄일 때만 전달한다. 늦은 길의 file이 그 뒤에 닿으면 이미 있는 줄이라 건너뛴다. `cross_id`가 없으면(`across_machines`가 아닌 event) file이 없으므로 한 번만 내는 일은 없다. 표를 이 기계 밖의 `app` 열로 키하므로 앱이 이 기계에 없어도 적힌다. 이 길이 가장 작다: 표와 함수가 이미 있다. 더 작은 길(`across_machines` event는 file로만 받는다)은 이 기계에 앱이 없으면 못 받고 file 길이 늦어 live의 뜻이 없어 고르지 않았다.
- 접근: `markEventSeen`은 folder의 file이라 `receive`가 직접 부르지 못하고 Late 칸(예: `crossSeen`)으로 읽는다(`wiring/folder.ts`가 낸다. 이 task가 `wiring/context.ts`에 한 줄 더한다).
- 한계(이 계획에서 고치지 않는다, 보고의 "알려진 미완 동작"에 적는다): 이 컴퓨터를 끈 동안이나 닿지 않는 동안 낸 다른 컴퓨터만의 앱 event는 남지 않는다. 연결은 그 순간의 event만 나르고 저장하지 않는다(구독도 저장하지 않는다). 늦게 오는 것은 두 컴퓨터가 다 가진 앱(`sync_to`)의 `across_machines` event뿐이다. 대기열을 만들지 않는다.

5. job: `values.ts`에 trigger 입력 `machine`, 저장 `source_machine`, `jobEventSchema.machine`. `jobs.ts`(protocol)에 `jobFireEvent`의 입력 `machine?: mch_`와 `jobEventTriggers`의 줄 `machine`·만든 workspace.
   - `jobs/create`(actor는 agent뿐이다. `core/jobs/commands.ts` 235줄)가 `machine`을 저장 전에 `mch_`로 푼다. 명단은 main thread에만 있으므로 jobs wiring의 writer 앞 처리(`wiring/jobs.ts`의 `writer: (inner) => ...` 자리. 같은 꼴이 `wiring/apps.ts` 738줄의 `withSourceFolder`, 정의는 `apps/registration/source-folder.ts`)에서 푼다. 못 풀면 `not_found`, 여럿이면 후보와 `invalid_input`.
   - `resolveTrigger`(`commands.ts` 109줄)는 지금 앱을 id로 풀고 그 active release 선언에 event가 있는지 본다. `machine`이 있으면 그 앱이 이 기계에 없으므로 그 확인을 건너뛴다(없는 event는 돌지 않을 뿐이다). `source`는 그 기계 앱의 id(`app_`)여야 한다(추천. slug는 기계마다 달라 푸는 데 그 기계를 읽어야 하고 닿지 않을 수 있다). id는 agent가 `machines/app_tools` 출력이나 `lophn <slug> --help --on <기계>`에서 얻는다. 다르게 하면 보고한다.
   - `events.ts`의 `fire`는 `source_machine`과 event의 `machine`이 같은 job만 연다(둘 다 없으면 이 기계). `wiring/jobs.ts`의 `triggers` 표(`jobEventTriggers`)와 `deliver`의 `triggers.some(...)` 거르기에도 `machine`을 넣는다. `eraseJobsOfApp`(`commands.ts`)의 `$.app` 맞춤은 앱 id가 같으면 다른 기계의 앱을 가리키는 job도 지운다: `source_machine`이 있는 줄은 빼는 조건을 건다.
   - JSON 칸이고 새 칸은 optional이라 ledger step이 없다(옛 행은 이 기계의 job이다. `jobs.trigger` step은 `trigger`에 `json_valid`만 건다).
6. 선언과 SDK: `read.ts`·`value.ts`(`exactKeys`에 optional `machine`, 1~64자)·`types.ts`. handler 이름은 그대로 `on.<source>.<event>`라 같은 source·event는 기계 하나만 고른다. `@lophn/declaration`의 type과 `guide.md`. `sdk-note`대로 declaration 판(minor), 그것을 정확히 pin하는 `@lophn/app-ui`·`@lophn/app-ui-native` 판, pin, 메모, Instruction diff.
7. flows: `automation.yaml`(다른 기계 event로 도는 job), `sdk.yaml`(구독 선언의 `machine`), `core-platform.yaml`(core의 원격 구독), tests yaml의 새 file과 covers.

정한 것:
- 받는 기계가 내주는 것은 private이 아닌 앱이 선언해 낸 event 전부다: 선언한 event는 발행 앱이 내놓은 것이다(`event.md`). `carry-paths`의 "다른 기계에도 알린다" 표시(선언 `across_machines: true`)는 `sync_to`가 있는 앱의 event를 file로도 쓰라는 뜻이라 이 길을 좁히는 데 쓰지 않는다. 그 표시는 `cross_id`로 두 길을 잇는 데만 쓴다.
- 선언의 기계는 이름이고 job의 기계는 `mch_`다: 선언은 사람의 기계 id를 모르는 앱 code이고, job은 만들 때 풀어 둘 수 있어 이름이 바뀌어도 이어진다.
- private workspace의 job과 앱은 다른 기계에 구독을 걸지 않는다: README "private인 workspace의 agent와 앱은 다른 기계를 부르지 못한다"를 구독에도 쓴다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "private인 workspace의 앱 event는 다른 기계의 구독자에게 가지 않는다." (`host_test.ts`나 `gateway_test.ts`, 컴퓨터 session이 private 앱의 `AppEventPublished`를 받지 않는다)
  - "같은 event가 연결과 늦은 길로 둘 다 와도 구독자는 한 번만 받는다." (job이 둘 열리거나 앱 handler가 둘 도는 일이다. `folder_events_seen` 하나로 두 길을 세우는 자리의 표 test, 두 순서(연결 먼저, file 먼저)와 `cross_id`가 없는 event)
- 입구부터 실행기까지 한 번 잇는다: 가짜 link가 받은 `AppEventPublished` → `receive` → 그 기계를 trigger로 가진 job만 `fire`(`subscriptions_test.ts`나 `events_test.ts`).
- SDK: `node tools/check-sdk-notes.ts`(`sdk-note` skill)가 통과한다.
- 새로 subprocess·서버·relay를 띄우는 test와 E2E는 만들지 않는다.
- 남지 않음: 없음(지우는 것이 없다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 이 task는: `allowlist.ts`에 `REMOTE_COMPUTER_EVENTS`
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## 시작 전에 다시 볼 것

- 없음(이 brief를 쓴 날 code로 확인했다. 위 "늦은 길과 만나는 곳"과 3의 link 받는 법은 그 확인에서 나온 정할 것이다). 시작할 때 `AppEventPublished`의 payload(`transient.ts` 166줄)와 `subscribersOf`(`publish.ts` 97줄)와 `@lophn/declaration`(4.10.0)·`app-ui`(2.21.0)·`app-ui-native`(1.8.0)의 판이 이 brief가 쓴 값 그대로인지만 한 번 본다.
