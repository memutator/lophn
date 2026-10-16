# router-waiting

`waiting-and-recovery/`를 새 설계로 줄인다. 켤 때 ledger 사실로 turn을 이어 하는 복구(약 1,190줄)와 ledger 기반의 사람 기다림(`waiting_user` 상태, 질문·approval 판정, 정정)을 지운다. 남기는 것은 "turn이 Gate의 물음을 메모리에서 기다렸다가 결정으로 이어 가는" 얇은 어댑터와, turn 본문을 읽는 두 read뿐이다. 폴더 이름은 복구가 없어졌으므로 `waiting/`으로 바꾼다.

- 단위: router (wave 3)
- 선행: `router-run-loop-turn`(`run-loop/`를 같이 고친다), router-run-loop-input (`turns` 표와 `StartTurn`으로 바뀐 뒤여야 한다)
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/waiting-and-recovery/` (지우기)
  - `packages/core/lophn-agent/waiting/` (새로. 소유 바꾸기: router)
  - `packages/core/lophn-agent/run-loop/turn-body-reads.ts` (새로)
- 읽을 것:
  - spec: S1 4·9·10장(session snapshot, turn gate, 꺼졌다 켜질 때) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - spec: S2 5·6장(Gate, turn 안 request와 보류 request) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - spec: S4 3장 "사람에게 묻기" — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - inventory: `I2.1#16`, `I2.2#19`, `I2.4#35`
  - 결정: `../README.md` 3장 #3(Gate는 core 한 곳), #4
  - 지금 코드: `waiting-and-recovery/{model,work,commands,reads,recovery,recovery-work,wait-request,app-lookup,schema,erase}.ts`
- 계약:
  - 쓰는 것: `core/approvals/ports.ts`(turn 안 request를 만들고 결정을 기다리는 port. 이름은 contract-approvals가 정한 것을 본다), `core/events/ports.ts`(Bus), `protocol/lophn-agent/{turns,turn-reads,turn-values}.ts`, 질문 tool의 `QuestionAsked`·`QuestionResolved`(contract-agent-tools, contract-events)
  - 내놓는 것: `waiting/mod.ts`의 `createTurnWaiter(deps)`(아래), `run-loop/turn-body-reads.ts`의 `turnBodyRead`·`turnBodyViewRead`

## 모양

### 지우는 것

- 복구(`I2.1#16`): `recovery.ts`, `recovery-work.ts`, `RunRecovered`·`planRecovery`·`rebuildResume`·`recoverRunFromLedger`·`recoverCompactionSummaries`·`advanceElapsed`·`confirmedFactsOf`·`boundaryOf`. 켤 때 돌던 turn을 interrupted로 닫는 것은 router-run-loop-turn의 `interruptRunningTurns`가 한다(S1 10장). 이어 하지 않는다.
- ledger 기다림(`I2.2#19`): `commands.ts`의 `createWaitCommands`(`waitRun`, `resolveRunWait`, `correctWaitingRun`), `model.ts`의 `WaitKind`·`ApprovalStatus`·`approvalVerdict`·`endOfApproval`·`loadApproval`·`retryWait`·`waitCountsAsFailure`·`WaitView`, `work.ts`의 `createWaitResolver`(정정으로 기다림을 푸는 `CorrectionStep`, `SUPERSEDED_TEXT`), `schema.ts`의 `waitSchemaSteps`, `erase.ts`의 `deleteSessionWaitResolutions`. approval request는 `approval_requests` 표(보류)와 session snapshot(turn 안)에 있다(S2 6장).
- `wait-request.ts`, `app-lookup.ts`: 쓰는 곳을 센 뒤 소유 밖(`tools/questions`, `tools/app-toolkit.ts`)이 쓰고 있으면 그 단위가 합칠 때까지 `waiting/`으로 옮겨 남기고 보고에 적는다. 쓰는 곳이 없으면 지운다.

### 남기는 것: `createTurnWaiter` (`I2.2#19`, `I2.4#35`)

- turn이 Gate에서 "묻는다"를 받으면 turn은 `running`인 채로 멈춰 기다린다. 기다리는 요청은 session snapshot의 대기 권한 요청(메모리)이다(S1 9장 5, S2 6장). 기다림의 상태는 `turns` 표에 쓰지 않는다. 이 어댑터는 run-loop와 approvals 사이의 접점이다.
- 모양(이름은 contract-approvals가 `core/approvals/ports.ts`에 정한 것에 맞춘다):

```ts
interface TurnWaiter {
  // 권한 물음. 결정이 나면 Gate의 결과(허락 한 번, 이 session 동안, 항상, 거절+이유)를 돌려준다.
  // turn이 끝나거나 interrupted로 닫히면 그 request는 cancelled이고 이 호출은 cancelled를 돌려준다.
  waitPermission(session: string, turn: string, request: string): Promise<PermissionOutcome>;
  // 사람에게 묻기. 답이 오거나 그 session에 사람 메시지가 오면 풀리고, 꺼졌다 켜지거나 turn이 끊기면 cancelled다.
  waitQuestion(session: string, turn: string, question: string): Promise<QuestionOutcome>;
  // turn이 끝날 때 그 turn의 대기를 모두 cancelled로 푼다.
  cancelAll(session: string, turn: string): void;
}
```

- 질문을 기다리는 중에 사람이 그 session에 메시지를 보내면 기다림을 끝내고 그 메시지를 tool 결과로 넘긴다. 그것이 답인지는 LLM이 읽는다(S4 3장). 답의 꼴은 contract-agent-tools가 정한 질문 결과를 쓴다.
- 질문 묶음 상태·기한·skip·action 적용(옛 `questionVerdict`, `QuestionFacts`)은 없다. 질문은 대기 목록에 남고 기한이 없다(S4 3장). 질문 tool 자체와 대기 목록은 agent-tools·approvals가 짓는다. 이 task는 기다림 어댑터만 만든다.
- 이 어댑터는 메모리다. 구현은 Promise 맵 하나이면 충분하다. 사람이 결정을 내리면 approvals가 `resolve`를 부른다(`TurnWaiter`에 `resolvePermission`, `resolveQuestion`을 더해 approvals가 부르게 한다. approvals의 쪽 port는 approvals가 선언한다).

### turn 본문 읽기

- `reads.ts`의 `runBodyRead`/`runBodyViewRead`(`RUN_BODY_MAX_BYTES`)는 기다림이 아니라 turn·model call·tool call 본문을 읽는 read이다. `run-loop/turn-body-reads.ts`로 옮기면서 `turnBodyRead`/`turnBodyViewRead`로 이름을 바꾸고 `protocol/lophn-agent/turn-reads.ts`의 `ReadTurnBody`·`ReadTurnBodyView`를 따른다. 종류 `handoff_content`는 없다.

## 할 일

1. `waiting/`을 만들고 `createTurnWaiter`를 짓는다(`mod.ts`, `waiter.ts`).
2. `run-loop/turn-body-reads.ts`로 두 read를 옮긴다.
3. `waiting-and-recovery/`를 지운다. 소유 밖에서 이 폴더를 import하는 곳(`register.ts`, `core.ts`, `tools/`, `run-loop/`)은 고치지 않고 보고의 "남은 import"에 파일과 줄을 적는다.
4. `I2.4#35`: 질문 상태의 core 쪽 저장(`tools/questions/*`의 묶음 모델)은 agent-tools가 새 ask tool로 바꾼다. 이 task는 기다림이 "꺼졌다 켜지면 cancelled"라는 규칙을 어댑터에 구현하고(프로세스가 사라지면 Promise 맵도 사라지므로 켤 때 snapshot이 비어 있는 것으로 충분하다), 나머지는 건드리지 않는다.
5. test는 만들지 않는다. 어댑터는 Promise 맵이다. 결정 규칙은 approvals의 test가 본다.

- (lead가 더함, screens-conversation-composer가 넘긴 것) 입력함 route `session_inputs/steer_now`(`SteerQueuedNow`)와 `session_inputs/remove`(`RemoveQueued`)의 handler를 짓는다(`protocol/lophn-agent/inputs.ts`의 `QUEUED_INPUT_ROUTES`, lead `bc22b518`). 올리기는 그 메시지를 도는 turn에 steer로 접수하고, 빼기는 아직 turn이 가져가지 않은 것만 지운다. 이미 가져갔거나 도는 turn이 없으면 conflict다.

- (lead가 더함, router-run-loop-turn이 넘긴 것) `waiting-and-recovery/recovery.ts`에 컴파일용 한 줄(`historyResultPart`)과 `rebuildResume`의 lint 무시가 있다. 폴더를 지울 때 같이 간다. 별칭 `finishRunRow`, `loadRun`, `RunRow`, `ResumeState`를 쓴다. 도중에 들어간 steer를 `messages.turn`에 적는 주인이 없어 `hasUnappliedSteering`(session/model.ts)이 그대로면 steer가 있던 session의 정상 종료를 막는다. 입력함 기반으로 바꾼다(추가 소유, lead 승인: `session/model.ts`의 그 함수).

- (lead가 더함, fix-turns가 넘긴 것) `waiting-and-recovery/`의 `runs`·`assignments` 조회는 없는 표를 본다. 폴더를 지울 때 같이 간다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "recoverRun\|planRecovery\|rebuildResume\|waitRun\|resolveRunWait\|correctWaitingRun\|waiting_user" packages/core/lophn-agent/waiting packages/core/lophn-agent/run-loop`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: core 조립 목록에서 `createWaitCommands`·`waitSchemaSteps`·`createWaitResolver`를 뺀다(소유 밖 import 목록), `createTurnWaiter`를 run-loop와 approvals에 끼우는 `wiring`, `run-loop/mod.ts`에 `turnBodyRead`·`turnBodyViewRead`
- 안 쓰게 된 export: `protocol/lophn-agent/run-wait.ts` 전체, `RUN_RECOVERY`류, `waiting-and-recovery`의 모든 export
- 정한 것: 폴더 이름 `waiting/`, `TurnWaiter`의 모양, `wait-request.ts`·`app-lookup.ts`의 처리
- 계약 바꾸기 요청(wave 3): `core/approvals/ports.ts`에 turn 안 request를 기다리는 port가 모자라면 여기에 적는다

- (lead가 더함, router-calls가 넘긴 것) `SessionDirectory.listOpen()`에 `place`와 `state`가 없어 wiring `describe`(`wiring/router-registration.ts`)가 sessions·turns 표에서 읽고 `waiting`은 못 낸다. 기다림 상태를 만들면 `describe`가 `waiting`을 내게 한다. `AgentCallRecord`에 `options`가 없어 앱 줄에 선 coding 맡기기의 옵션은 transport 메모리에만 있다(MVP 밖).
- (lead가 더함, approvals-tool-judgment가 넘긴 것. 추가 소유, lead 승인: `run-loop/`의 tool 실행 직전 판정 줄) run-loop가 tool을 실행하기 전에 `createToolGate({approvals, resolve})`의 `ToolGate.check`를 부른다(`core/lophn-agent/tool-judgment/tool-gate.ts`). 결과 `denied`·`changed`면 실행하지 않는다. 옛 `createToolJudgment`는 지워졌다. `waiting-and-recovery/{work,recovery-work}.ts`가 쓰는 `CoreCall`·`Admission`·`CallRequest`는 tool-judgment `work.ts`에 남아 있다. 안 쓰게 되면 지운다.
- (lead가 더함, annotation-core가 넘긴 것. 추가 소유, lead 승인: wiring의 `annotationDelivery` 칸 채우기) `WiringContext.annotationDelivery`를 채운다: 새 session을 열거나 열린 session에 annotation 메시지를 넣고, 보관한 앱이면 `conflict`. 비어 있으면 `annotations/send`가 `unavailable`이다.
- (lead가 더함, agent-tools-app-api가 넘긴 것. 추가 소유, lead 승인: run-loop의 app-api tool 연결 줄) run-loop가 `createAppApiToolkit({machine, grants})`의 `define(agent, place)`로 app-api tool 정의를 얻고, 없는 tool 오류에 `appApiMissingReason`을 `executeToolCall`의 `missingReason`으로 끼운다. `run-loop/scope.ts`의 `AppOffer`·`computeAgentAppScope`(옛 command 모양)를 지운다. toolkit이 machine loopback으로 `apps/app_api`를 읽는데 `core/apps/control.ts`가 이 route를 machine "command" 종류로 적어 두었다. 실제로 읽히지 않으면 view 읽기를 port로 바꾼다.
- (lead가 더함, coding-agent-session이 넘긴 것. 추가 소유, lead 승인: `core/router/`와 `wiring/router-registration.ts`의 coding 줄) Router에 `CodingTransport`를 넣는다(writer는 `tx.port(CodingTransport)`, 읽기는 `codingLines(snapshot.sql)`). `queued_coding` 읽기를 `codingLines(snapshot.sql)`로 바꾼다(지금은 메모리라 빈다). 줄에서 나중에 열린 coding call의 `receiver_session`이 null로 남는다: `CallStore.setReceiver(tx, call, session)`을 더해 `CodingStartResult.started.session`을 적는다(계약 고침 승인). 새 coding session을 여는 `SessionDirectory.open` 분기(지금 `places/directory.ts`가 coding agent를 거절)를 transport `start`로 잇는다.
- (lead가 더함, events-reactor가 넘긴 것. 추가 소유, lead 승인: `wiring/events.ts`의 그 호출 줄) 새 일 handler(`registerNewWorkHandlers(ctx.reactor, { approvals, router, events })`)는 Router에 program call을 보내는 길이 없어 걸리지 않았다(`callSend`는 agent actor만). `ReactionRouter.send(call, idempotencyKey)`를 Router 안 함수로 짓고(machine 자격, tx 안에서 Router.send), 그 호출 줄을 넣는다. `events`에는 `createEventsReader(sql).at`을 넘긴다. 이 호출이 reaction applier도 등록한다.
- (lead가 더함, agent-tools-context가 넘긴 것) `run-loop/prepare.ts`(46-49, 119, 302, 690행 근처)와 `tools/toolkit.ts`가 아직 옛 `tools/context-search.ts`·`context-search-tools.ts`·`context-route-shapes.ts`를 import한다. 새 `CONTEXT_TOOLS`(builtin)로 바뀌었으니 그 import와 `listTools`의 `contexts` 칸, `registry.ts`의 `origin: "context"`를 걷는다(추가 소유, lead 승인).
