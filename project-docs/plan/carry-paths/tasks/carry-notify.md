# carry-notify

들어온 변경을 그 기계의 앱에 알린다: 폰의 push, 폴더 길의 읽기(이름 붙인 폴더와 `computers` 폴더. link, 폰, 거울로 온 file도 여기로 든다)가 앱 DB에 변경을 적용하면 앱 process와 앱 화면이 `lophn`의 `data.changed`를 받는다. 앱이 다른 기계에도 알리겠다고 선언한 event는 그 앱의 event file로 같은 길을 가서 도착한 기계에서 한 번 난다(만든 기계를 싣고, 7일이 지난 것은 내지 않는다). private인 workspace의 앱의 event는 기계를 건너지 않는다. SDK 선언 칸과 앱 agent 지침, `migrate-sdk` 메모를 같이 고친다.

- 단위: carry (wave 2)
- 선행: carry-contract
- 소유(이 task만 고친다):
  - `packages/core/apps/calls/service.ts`, `packages/core/apps/calls/calls_test.ts`
  - `packages/core/apps/events/`
  - `packages/protocol/apps/events.ts`, `packages/protocol/apps/calls/caller.ts`
  - `packages/protocol/apps/declaration/`
  - `packages/core/main/daemon/wiring/apps.ts`
  - `packages/sdk/declaration/`, `packages/sdk/app-ui/package.json`, `packages/sdk/app-ui-native/package.json`
  - `packages/core/apps/packages/template/app/`, `tests/support/app/`, `tools/wireframes/package.json`(SDK pin 줄만)
  - `packages/core/agent-workspaces/skills/design-app/`, `packages/core/agent-workspaces/skills/migrate-sdk/`(새 메모 file)
- 읽을 것:
  - 계획 README "정한 것"의 "들어온 변경은 그 기계의 앱에 알린다", "앱이 낸 event는 data처럼 간다", roadmap `multi-device.md`의 "주고받는 것 네 가지"(data에 딸린 event), "사람이 정한 것"(private과 data 맞추기)
  - `carry-contract` brief의 "고정할 모양"(`APP_DATA_CHANGED_EVENT`, event file 꼴, `CROSS_EVENT_MAX_AGE_MS`, `crossEvents`, `eventArrived`, `apps.event-publications.machine`, `across_machines`라는 이름, `COMPUTERS_DESTINATION`)
  - architecture: `project-docs/architecture/event.md`("앱 event", 지키는 것 27~35), `folder-sync.md`(carry-contract가 고친 판), `agent-call.md`(call 정책의 `private`), `app-call.md`(caller)
  - 이슈 `project-docs/issues/phone-write-events-not-delivered.yaml`
  - 본보기: 앱 하나에 내는 `lophn` event `call.settled`(`packages/core/main/daemon/wiring/router.ts`, `packages/protocol/lophn-agent/app-calls.ts`), 전달 `createEventDelivery`(`packages/core/apps/events/publish.ts`의 `audience`), call 정책 설정 `callPolicySetting`(`packages/core/config/setting-declarations.ts`)
  - `.claude/skills/sdk-note/SKILL.md`(전부), `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: carry-contract의 이름, `ctx.peek.eventDelivery`, `ctx.peek.crossEvents`
  - 내놓는 것: `ctx.eventArrived`의 구현, 선언 칸 `events[].across_machines`(boolean, 기본 false)와 `@lophn/declaration`의 새 판

시작 전에 다시 볼 것: 같이 도는 다른 계획(`one-screen` 등)이 SDK 판(`packages/sdk/*/package.json`)이나 `migrate-sdk` 메모를 올렸는지 main에서 본다. 올렸으면 그 판 다음 판을 쓴다. carry-folder가 "넘길 줄"로 `calls/service.ts`에 고칠 것을 적었으면 lead가 알려 준다.

## 할 일

1. `data.changed`: `calls/service.ts`의 받은 것 적용(`applyPhone`, `applyChanges`, `mergeSnapshot`)이 끝나고 적용된 변경이 하나라도 있거나 합치기가 바꾼 것이 있으면, 적용 묶음 하나에 한 번 그 앱에 `data.changed`(발행자 `lophn`, payload `{}`, audience 그 앱)를 낸다. `AppCallsDeps`에 내는 함수를 받고 `wiring/apps.ts`에서 `eventDelivery`로 꽂는다(`call.settled`와 같은 길). private과 상관없다(앱 자기 data다).
2. 선언 칸: `packages/protocol/apps/declaration/`의 `EventDeclaration`에 `across_machines?: boolean`. `true`인데 선언에 `sync_to`가 없으면 영어 한 줄로 거절한다("an event that goes to other machines needs sync_to: it travels with the app's data"). 모르는 칸 규칙과 hash 규칙은 다른 선택 칸과 같다.
3. 내는 쪽(`apps/events/publish.ts`): 발행 앱의 활성 선언이 그 event에 `across_machines: true`이고 이 기계의 call 정책 `private`에 그 앱의 workspace(`{kind: "app", id}`)가 없으면, 이 기계에서 전달한 뒤 `ctx.peek.crossEvents.write(app, release, {name, payload, at})`를 부른다. 실패해도 발행 결과는 바꾸지 않는다(log 한 줄).
4. 받는 쪽: `wiring/apps.ts`가 `eventArrived`를 provide한다. 이 기계에 그 앱이 있고, 이 기계의 call 정책에서 그 앱 workspace가 private이 아니고, `at`이 나이 한도 안이고, payload가 이 기계 활성 선언의 그 event schema에 맞으면 이 기계에서 낸다: 발행자 그 앱, source 그 앱의 slug, chain `[그 앱]`, 같은 전달 길(구독 앱의 handler, 앱 화면, 안 구독자 job). 발행 기록 한 줄에 `machine`(origin)을 적고 구독자 호출의 event caller에 `machine?`을 싣는다(`caller.ts`). 아니면 내지 않는다(log 한 줄). 한 번만인 것은 carry-folder의 표가 지킨다.
5. 읽기 `app.event_publications`의 행에 `machine`을 싣는다(`packages/protocol/apps/events.ts`, `apps/events/reads.ts`·`store.ts`).
6. SDK와 지침(`sdk-note` skill 그대로): `@lophn/declaration`을 minor로 올리고(시작할 때의 판에서 하나, 지금은 4.9.0 → 4.10.0), 그 판을 고정한 `@lophn/app-ui`·`@lophn/app-ui-native`도 올리고 skill 2절의 grep이 내는 모든 pin과 `package-lock.json`(`npm install`)을 고친다.
   - `packages/sdk/declaration/guide.md`: `sync_to: "computers"`(내 컴퓨터들. 옮기는 길은 lophn이 고르고 사람이 같이 보는 폴더를 Settings에서 더할 수 있다), `across_machines`, lophn event 목록(99줄 근처)에 `data.changed`.
   - design-app `SKILL.md`·`folder-sync.md`(영어 그대로): 기계 사이로 보낼 앱은 먼저 `computers`를 고른다, 이름 붙인 폴더는 사람이 따로 정한 경우다, 다른 기계와 폰에서 온 변경은 `data.changed`로 안다. "There is no Settings screen for destinations yet" 줄은 사람이 Settings에서도 폴더를 둔다는 한 줄로. `phone-apps.md` 82줄 근처에 폰의 write가 컴퓨터에 닿으면 그 앱에 `data.changed`가 난다는 한 줄(폰에서 event 발행이 안 되는 것은 그대로다).
   - 메모 `declaration-<새 판>.md`(Instruction diff 포함), `app-ui-<새 판>.md`, `app-ui-native-<새 판>.md`. 지원 하한(`lophn.supported_from`)은 더하기라 그대로다.
7. 이슈 `phone-write-events-not-delivered`는 lead가 닫는다. 보고에 닫을 근거(폰 write가 닿으면 그 앱에 `data.changed`가 나고, 폰에서 앱 event 발행은 여전히 없다)를 적는다.

### 정한 것
- "data가 바뀌었다"는 새 SDK API가 아니라 `lophn` core event `data.changed`다: `subscribe`와 `useEvent`가 이미 받는 자리이고 core event의 schema는 protocol에 둔다(`event.md` 지키는 것 33). 앱은 선언 `subscriptions`에 `{source: "lophn", event: "data.changed"}`를 적는다.
- 만든 기계는 payload가 아니라 caller와 발행 기록에 싣는다: payload는 발행 앱이 선언한 schema라 core가 칸을 더할 수 없다. handler의 인자를 늘리지 않아 `@lophn/cap-tool`과 화면 SDK의 API가 그대로다.
- private 판단은 내는 기계와 받는 기계가 각자 자기 call 정책으로 한다(roadmap "각자 자기 workspace의 설정으로 본다").

## 끝남

- `npm run check`가 통과한다(check의 sdk notes 단계 포함).
- 위험 test(`publish_test.ts`에): "private인 workspace의 앱이 낸 `across_machines` event는 `crossEvents.write`에 닿지 않고, private인 기계에 도착한 event(`eventArrived`)는 그 기계에서 나지 않는다."
- subprocess·서버 test와 E2E는 만들지 않는다.
- 남지 않음: `grep -rn "no Settings screen for destinations" packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## (lead가 더함)

`carry-contract`가 review를 거치며 계약이 바뀌었다. 아래가 위 글보다 앞선다.

- event file의 난 기계, 앱, id는 path에서 온다. `carry-folder`가 `readEventFile`을 통과한 file만 넘긴다. `eventArrived`의 `origin`은 path의 기계다.
- 도착한 event는 7일보다 오래된 것뿐 아니라 `at`이 5분 넘게 앞선 것(`CLOCK_AHEAD_MAX_MS`)도 내지 않는다.
- 내는 쪽: event file의 `id`는 ULID 그대로이고 file 이름과 같아야 한다.
- 그대로인 것: `data.changed`, `CrossEvents.write(app, release, {name, payload, at})`, step `apps.event-publications.machine`.
