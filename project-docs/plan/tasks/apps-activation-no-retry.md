# apps-activation-no-retry

activation의 앱별 Promise 줄(메모리)과 30초 재시도를 없앤다. 앱 하나에 activation이 돌고 있으면 새 요청은 `conflict`로 거절하고, 끝내지 못한 시도를 시간이 지나 다시 하지 않는다. 허락한 비교와 시작 때 비교가 달라졌으면 다시 묻는 검사는 남긴다.

- 단위: apps (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/activation/{queue,assembly,handler}.ts`
  - `packages/core/apps/releases/commands.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/activation.md` ("지키는 것"의 마지막 두 문장: 허락한 비교가 달라지면 다시 묻기, 앱마다 한 번에 하나와 줄). 문서는 lead가 고친다.
  - 이슈: `project-docs/issues/activation.md`의 "앱별 activation 줄(메모리)과 30초 재시도"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 코드: `packages/core/events/reactor/reactor.ts`의 `react` (handler가 `unavailable`이 아닌 오류를 내면 로그만 남기고 끝난 것으로 본다. 재시도하지 않는다).
- 계약:
  - 쓰는 것: `activation.start`(ledger)가 이미 앱 하나에 `activating`이 둘이면 `conflict`로 거절한다(`commands.ts`의 `activatingOf`). 바꾸지 않는다.
  - 내놓는 것: protocol은 바꾸지 않는다. `ActivationPhase`의 `queued`와 `activations.queue` read는 그대로다.

## 할 일

1. `queue.ts`의 `enqueue`
   - `lanes`(앱마다 이어 붙인 Promise)를 앱마다 "돌고 있는 job 하나"를 가리키는 `Map<string, Promise<void>>`로 바꾼다. `enqueue(app, release, approved, job)`는 그 앱에 돌고 있는 job이 있거나 이 release가 이미 `waiting_approval`이 아닌 entry로 있으면 `false`를 돌려주고, 아니면 곧바로 job을 시작하고 `true`. entry의 phase는 바로 `running`이다(`queued`로 머무는 시간이 없다). job이 끝나면(성공이든 throw든) entry, running, 앱 칸을 지운다.
   - `settled()`는 지금처럼 돌고 있는 job이 모두 끝날 때까지 기다린다. `has`, `waitApproval`, `dropWaiting`, `update`, `list`, `size`, `running`은 그대로다. 머리 주석("줄에 세워 진행")을 "앱마다 하나만 돈다"로 고친다.
2. `assembly.ts`
   - 머리 주석(2번 항목)과 `ACTIVATION_RETRY_MS` 상수·주석, `unsettled` Map을 지운다.
   - `enqueue(app, release, approved)`는 `queue.enqueue`가 `false`면 `err({ code: "conflict", message: "an activation is already running for the app" })`를 돌려주는 `Result<void>`가 된다.
   - `runOne` 끝: `outcome.status === "unavailable"`이면 아무것도 하지 않는다(앱은 붙든 채로 둔다. 이전 코드를 시작하지 않는다는 지금 주석은 남긴다). 나머지는 지금처럼 `activationResume`. `unsettled.set/delete` 줄만 지운다. 허락한 비교와 달라졌으면 `handlers.reconsider`로 다시 묻는 부분(`entry.approved`)은 **그대로 둔다**.
   - `sweep()`:
     - `activatingRows()`로 끊긴 시도를 이어받는 일은 매 sweep 그대로 한다. 이것은 남기기로 한 "끊긴 activation 이어받기"(`project-docs/issues/archived/activation.md`)의 일이라 없애지 않는다. `retryAt`·`unsettled`의 30초 시각 표만 지우고, 그 앱에 돌고 있는 job이 있으면 건너뛴다. sweep 간격이 짧아 같은 시도를 너무 자주 두드리면 보고한다.
     - `requestedRows()`(이전 release로 돌아가기 요청)는 매 sweep 그대로 읽어 `enqueue`한다. 앱이 바쁘면 conflict가 나오고 요청 행은 남는다(complete가 지우거나 다음 sweep이 다시 본다). `enqueue`의 Result는 무시한다.
3. `handler.ts`: `ActivationHandlerDeps.enqueue`의 type을 `Result<void>`로 바꾸고 `judge`, `ticketVerified`, `approvalDecided`가 그 결과를 그대로 돌려준다(conflict는 Reactor가 로그만 남기고 넘어간다. release는 `prepared`로 남는다). 나머지는 건드리지 않는다. 머리 주석의 "그 앱의 줄에 세운다"를 맞춘다.
4. `commands.ts`의 `activatePrevious`: 그 앱에 이미 `activating`이 있으면 `conflict("an activation is in progress for the app")`로 거절한다(`activatingOf(tx, release.app)`, `start`가 이미 쓰는 것과 같은 검사. 사람이 보낸 요청이 몰래 줄에 서 있지 않게 한다). 주석("줄에 세우는 일은 driver가 한다")을 맞춘다.

## 정한 것

- 이슈의 "정한 것"대로 줄과 30초 재시도를 없앤다. 겹치면 `conflict`, 실패는 실패로 끝낸다.
- 끝내지 못한 시도(종료 확인·복원이 `unavailable`)는 다음 sweep이 이어받는다. 이어받기는 이미 켜진 새 판의 데이터를 복구본으로 덮지 않게 남기기로 한 장치다. 없애는 것은 시작 요청의 줄과 재시도뿐이다.
- `ActivationPhase`의 `queued`와 renderer의 `app-detail.note.applying-queued` 문구는 이제 닿지 않는다. protocol·renderer·wording에 번지므로 이 task가 아니라 `cleanup-leftovers`가 지운다.
- `conflict`로 거절된 `prepared` release는 자동으로 다시 시작되지 않는다(새 ticket 확인이나 App Engineer의 새 release가 계기다).

## 끝남

- `deno task check`가 통과한다. activation 관련 기존 test(`orchestrator_test.ts` 등)는 고치지 않고 통과해야 한다.
- 위험 test: 없음(앱마다 하나만 도는 보장은 ledger의 `activation.start`가 이미 지키고 test도 그쪽에 있다. 메모리 guard는 내부 구현이다).
- 남지 않음: `grep -rn "ACTIVATION_RETRY_MS\|unsettled\|retryAt\|lanes" packages/core/apps/releases/activation`이 0줄.
- core가 뜬다: `mkdir -m 700 -p $PWD/.dev-data/apps-activation-no-retry && export LOPHN_HOME=$PWD/.dev-data/apps-activation-no-retry` 뒤 core를 띄워 오류 없이 sweep이 도는지 보고 `$!`로 받은 PID만 끈다.

## 보고

- 바꾼 file
- 통과한 check
- 안 쓰게 된 export
- 정한 것
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: conflict로 거절된 prepared release
