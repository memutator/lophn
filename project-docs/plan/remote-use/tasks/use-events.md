# use-events

다른 기계의 앱 event를 구독한다. job의 trigger와 앱 선언의 구독에 "어느 기계의"를 적고, 부르는 기계의 core가 그 선언들을 모아 그 기계의 link에 구독자 하나로 걸고, 온 event를 이 기계에서 난 기계를 실어 낸다. 받는 기계는 private이 아닌 앱이 낸 event만 내준다.

- 단위: use (wave 3)
- 선행: use-receive, use-send. 받는 쪽 `host.ts`와 보내는 쪽 `machineLinks` 위에 짓는다.
- 소유(이 task만 고친다):
  - `packages/protocol/jobs/values.ts`, `packages/protocol/apps/declaration/{read,value,types,validate_test}.ts`, `packages/protocol/events/transient.ts`(`AppEventPublished`만)
  - `packages/core/remote/subscriptions.ts`(새 file), `packages/core/remote/subscriptions_test.ts`(새 file), `packages/core/remote/{host,host_test,links}.ts`, `packages/core/events/gateway.ts`, `packages/core/events/gateway_test.ts`
  - `packages/core/main/daemon/wiring/{remote,apps,jobs}.ts`
  - `packages/core/apps/events/publish.ts`, `packages/core/apps/events/publish_test.ts`
  - `packages/core/jobs/{events,events_test,commands}.ts`
  - `packages/sdk/declaration/`, `packages/sdk/app-ui/package.json`, `packages/sdk/app-ui-native/package.json`, pin 자리(`sdk-note`의 grep으로 찾은 것만: `packages/core/apps/packages/template/app/{lophn.ts.tmpl,package.json.tmpl}`, `tests/support/app/sample/lophn.ts.tmpl`, `tools/wireframes/package.json`, `package-lock.json`), `packages/core/agent-workspaces/skills/migrate-sdk/{declaration,app-ui,app-ui-native}-<판>.md`(새 file)
  - `project-docs/flows/areas/{automation,sdk,core-platform}.yaml`, `project-docs/flows/tests/{core-rest,core-apps,libs-tooling}.yaml`
- 읽을 것:
  - `project-docs/plan/remote-use/tasks/use-contract.md`(뒤 task가 더할 이름: trigger `machine`·`source_machine`, `jobEventSchema.machine`, `subscriptions[].machine`, event caller의 `machine`)
  - 계획 README "정한 것"의 "구독하는 주체가 있다", "받는 기계가 내주는 event는 앱이 밖에 낸 것뿐이다", "private은 기계 사이에도 선다"
  - architecture: `event.md`("앱 event", 지키는 것), `job.md`("event로 도는 job", "주인 기계"), `app-call.md`("앱 event", 지키는 것 "호출 경로" 10), `remote.md`
  - 계획 `project-docs/plan/one-screen/README.md`("다른 기계의 event는 보는 것마다 따로 구독한다"), `project-docs/plan/carry-paths/README.md`("앱이 낸 event는 data처럼 간다")
  - 조사 `reports/multi-device/survey-n3-remote-use.md` 1.5, 8절 7·8
  - boundary·module: `event-stream`, `remote-protocol`, `sdk-api`; module `events`, `jobs`, `apps`, `remote`
  - skill: `.claude/skills/sdk-note/SKILL.md`
- 계약:
  - 쓰는 것: `ctx.machineLinks`(`computers`, `resolve`), `isPrivate`, `MachineFrameReceived`, `one-screen`의 구독자마다의 watch(이름은 시작 전에 본다), `ctx.eventDelivery`, `InternalSubscriber`, event caller의 `machine`
  - 내놓는 것: trigger 입력 `machine?: MachineRef`, 저장 `source_machine?: mch_`, `jobEventSchema.machine?: mch_`, 선언 `subscriptions[].machine?: <컴퓨터 이름>`, `AppEventPublished` payload의 `publication`·`trace_id`·`chain`, allowlist에 더할 `REMOTE_COMPUTER_EVENTS = ["AppEventPublished"]`

## 할 일

1. 받는 기계(내주기):
   - `host.ts`: 컴퓨터의 Gateway session은 `REMOTE_ALLOWED_EVENTS`에 `REMOTE_COMPUTER_EVENTS`를 더해 받는다(폰은 그대로).
   - `gateway.ts`: session 선택지에 event를 거르는 함수 하나.
   - 거르기는 `wiring/remote.ts`가 준다: `AppEventPublished`는 subject(앱)가 있고, audience가 null이고, 그 앱의 workspace `{kind:"app", id}`가 이 기계의 call 정책에서 private이 아닐 때만 간다. `lophn`이 낸 것은 가지 않는다.
2. `AppEventPublished` payload에 그 발행의 `publication`, `trace_id`, `chain`을 더한다(`wiring/apps.ts`의 `announce`, `publish.ts`). 받는 쪽이 event caller를 만든다.
3. 부르는 기계(구독 걸기), 새 `packages/core/remote/subscriptions.ts`. 원하는 기계는 둘의 합이다.
   - 이 기계가 주인이고 승인되고 켜진 event job 가운데 `source_machine`이 있는 것. 만든 workspace가 private이면 뺀다.
   - active 앱의 active release 선언 `subscriptions[].machine`을 `resolve`로 푼 것. 그 앱 workspace가 private이면 뺀다. 이름을 못 풀거나 후보가 여럿이면 걸지 않고 log를 남긴다.
   - 기계마다 core 구독자 하나(조건 `[{types:["AppEventPublished"]}]`)를 `one-screen`의 구독자마다 watch로 건다. 화면의 구독을 덮지 않는다.
   - 다시 계산하는 때: core가 설 때, job과 release·앱이 바뀐 `StateChanged`, 명단이 바뀔 때. 끊겼다 붙으면 link가 다시 건다. 저장하지 않는다(README "구독은 선언에서 온다").
4. 온 event 내기: 그 기계의 `MachineFrameReceived`(event `AppEventPublished`)를 `ctx.eventDelivery`의 새 입구 `receive(machine, event)`로 넘긴다(`publish.ts`). 받는 쪽은 둘이다.
   - 안 구독자(jobs)에게 `machine`을 실어 준다.
   - 앱 구독자는 선언의 `source`가 같고 `machine`을 풀면 그 기계인 것만 받는다. caller는 `{kind:"event", publisher, event, publication, trace_id, chain, parent_invocation: null, machine}`. chain에 구독자가 있으면 넘기지 않는다(기계를 건넌 고리도 끊긴다. 앱 id는 기계 사이 같다).
   - 이 기계에 발행 기록 줄을 쓰지 않는다(그 기계에 있다).
   - 지금의 `subscribersOf`는 `machine`이 있는 구독을 이 기계 event에 넘기지 않게 고친다.
5. job: `values.ts`에 trigger 입력 `machine`, 저장 `source_machine`, `jobEventSchema.machine`.
   - `jobs/create`가 `machine`을 저장 전에 `mch_`로 푼다. 명단은 main thread에만 있으므로 jobs wiring의 writer 앞 처리에서 푼다(`wiring/apps.ts`의 `withSourceFolder`가 같은 꼴이다). 못 풀면 `not_found`, 여럿이면 후보와 `invalid_input`.
   - `events.ts`의 `fire`는 `source_machine`과 event의 `machine`이 같은 job만 연다(둘 다 없으면 이 기계).
   - JSON 칸이고 새 칸은 optional이라 ledger step이 없다(옛 행은 이 기계의 job이다).
6. 선언과 SDK: `read.ts`·`value.ts`(`exactKeys`에 optional `machine`, 1~64자)·`types.ts`. handler 이름은 그대로 `on.<source>.<event>`라 같은 source·event는 기계 하나만 고른다. `@lophn/declaration`의 type과 `guide.md`. `sdk-note`대로 declaration 판(minor), 그것을 정확히 pin하는 `@lophn/app-ui`·`@lophn/app-ui-native` 판, pin, 메모, Instruction diff.
7. flows: `automation.yaml`(다른 기계 event로 도는 job), `sdk.yaml`(구독 선언의 `machine`), `core-platform.yaml`(core의 원격 구독), tests yaml의 새 file과 covers.

정한 것:
- 받는 기계가 내주는 것은 private이 아닌 앱이 선언해 낸 event 전부다: 선언한 event는 발행 앱이 내놓은 것이다(`event.md`). `carry-paths`가 "다른 기계에도 알린다"는 표시를 발행에 두었으면 그 표시가 있는 것만으로 좁힌다(시작 전에 본다).
- 선언의 기계는 이름이고 job의 기계는 `mch_`다: 선언은 사람의 기계 id를 모르는 앱 code이고, job은 만들 때 풀어 둘 수 있어 이름이 바뀌어도 이어진다.
- private workspace의 job과 앱은 다른 기계에 구독을 걸지 않는다: README "private인 workspace의 agent와 앱은 다른 기계를 부르지 못한다"를 구독에도 쓴다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "private인 workspace의 앱 event는 다른 기계의 구독자에게 가지 않는다." (`host_test.ts`나 `gateway_test.ts`, 컴퓨터 session이 private 앱의 `AppEventPublished`를 받지 않는다)
- 입구부터 실행기까지 한 번 잇는다: 가짜 link의 `MachineFrameReceived` → `receive` → 그 기계를 trigger로 가진 job만 `fire`(`subscriptions_test.ts`나 `events_test.ts`).
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

- `one-screen`의 `screen-base`가 낸 구독자마다 watch의 이름과 `MachineFrameReceived`의 모양(구독자 key가 실리는지).
- `carry-paths`의 `carry-notify`·`carry-contract`가 정한 "data처럼 가는 event": 도착한 기계에서 한 번만 내는 함수와 묶음 이름. 같은 event가 link와 늦은 길로 둘 다 오면 그 함수와 이름으로 한 번만 낸다. 그 함수가 있으면 4의 `receive`는 그것을 쓴다.
- 그때의 `AppEventPublished` payload, `subscribersOf`, `jobEventTriggers`, 선언의 `subscriptions` 검사, `@lophn/declaration`과 그것을 pin하는 SDK의 판.
