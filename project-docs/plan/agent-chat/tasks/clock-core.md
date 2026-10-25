# clock-core

"Worked for"가 쓸 active(사람 기다림 제외) 시간을 core가 낸다: turn이 끝날 때 active를 끝난 순간까지 마감해 저장하고(`TurnEnded.active_ms`), 기다림에서 다시 도는 순간 `TurnResumed`를 내며, session snapshot의 도는 turn에 `elapsed`를 싣는다. `assembleTrace`의 `wall_ms`는 진짜 wall(`finished_at − started_at`)로 고친다.

정한 것(planner): 멈춤·실패·끊김으로 끝나는 turn도 active를 끝난 순간까지 마감한다. 사람이 멈춰 core가 turn을 끝내는 길도 같다. 일하던 중이면 `마지막 checkpoint의 active + (끝난 때 − checkpoint 때)`, 기다리던 중이면 checkpoint의 active다.

정한 것: `FinishTurn` 입력은 바꾸지 않고 끝내기 직전 `CheckpointTurn`으로 active를 마감한다(`chat-protocol`의 "바꾸지 않는 것").

- 단위: clock (wave 2)
- 선행: reasoning-core. `run-loop`의 같은 file과 `stream-core`가 만든 `live-turns.ts`를 고친다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/{turn,loop,limits,ports,core-ports,driver,prepare,commands}.ts`
  - `packages/core/lophn-agent/run-loop/live-turns.ts` (`stream-core`가 만든다)
  - `packages/core/lophn-agent/run-loop/live-turns_test.ts` (`stream-core`가 만든다)
  - `packages/core/main/daemon/wiring/session-snapshots.ts`
  - `packages/core/lophn-agent/observability/model.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/event.md`(Bus는 commit 뒤, core 안 command는 `ctx.writer`, snapshot으로 맞춘다, 꺼졌다 켜지면 돌던 turn은 interrupted), `project-docs/architecture/approval.md`(turn 안 request가 열리고 닫히는 때), `project-docs/architecture/run.md`(runs가 `StopTurn`을 보내는 길)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 element `run-loop`, `events`, `approvals`와 interface `event-stream`, `core-api`. `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/main`
  - 제품 결정: `project-docs/plan/agent-chat/README.md` "정한 것"의 "Worked for" 절과 뼈대 검토 "멈춤·실패·끊김으로 끝나는 turn도 active를 끝난 순간까지 마감한다", `project-docs/products/roadmap/agent-chat.md` 6
  - 계약: `project-docs/plan/agent-chat/tasks/chat-protocol.md`(`TurnResumed`, `TurnEnded.active_ms`는 `turn-events.ts`가 같은 tx에서 행을 다시 읽어 싣는다, snapshot `elapsed`), `project-docs/plan/agent-chat/tasks/stream-core.md`(`live-turns.ts`의 `createLiveTurns`·`withLiveTurns`, `session-snapshots.ts`의 구독과 `LIVE_TURNS_CONTEXT`)
  - skill: `.claude/skills/write-test/SKILL.md`(시간은 test하지 않는다)
  - 코드:
    - child: `packages/core/lophn-agent/run-loop/limits.ts`(`TurnLimiter`: `enterWait`·`leaveWait`, `snapshot`), `packages/core/lophn-agent/run-loop/loop.ts`(`pause`), `packages/core/lophn-agent/run-loop/core-ports.ts`(`paused()`는 Gate를 거치는 call마다 기다림을 건다, `checkpoint`), `packages/core/lophn-agent/run-loop/turn.ts`(`finishWith`, `limitEnd`, `afterModel`의 checkpoint)
    - core의 끝내기: `packages/core/lophn-agent/run-loop/commands.ts`(`stop`, `checkpoint`의 검사: active는 줄지 않고 checkpoint 시각은 뒤로 가지 않는다, `finishRow`), `packages/core/lophn-agent/run-loop/interrupt.ts`(`interruptRunningTurns`, `interruptTurnsCommand`), `packages/core/lophn-agent/run-loop/turn-events.ts`(`publishTurnEnded`), `packages/core/lophn-agent/places/lifecycle.ts`의 `endSession`(archive·지움이 같은 tx에서 turn을 닫는다), `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`(child가 사라지면 `ctx.writer`로 `InterruptTurns`)
    - 사람 기다림 event: `packages/core/approvals/turn-requests.ts`(`TurnRequestOpened`·`TurnRequestClosed`), `packages/core/lophn-agent/tools/questions/wait.ts`(`QuestionAsked`·`QuestionResolved`), `packages/protocol/events/agent.ts`(payload: request의 `turn`, 질문의 `group`), `packages/protocol/approvals/tool-gate.ts`(`CheckToolGate`의 `run`은 사람에게 물었는지 싣지 않는다)
    - coding agent도 `TurnStarted`·`TurnRequestOpened`를 낸다: `packages/core/apps/coding/hook.ts`
    - snapshot: `packages/core/main/daemon/wiring/session-snapshots.ts`(state `waiting`은 turn request나 질문이 있을 때), `packages/core/lophn-agent/session/model.ts`(`loadSession`으로 lophn session을 가른다), `packages/core/lophn-agent/run-loop/schema.ts`(turns 표의 `elapsed_*` 열)
    - trace: `packages/core/lophn-agent/observability/model.ts`(`assembleTrace` 157줄, `mergeTraces`), `packages/protocol/lophn-agent/traces.ts`(`wall_ms: durationMsSchema`)
- 계약:
  - 쓰는 것: `chat-protocol`의 `TurnResumed`, `TurnEnded.active_ms`(turn 행의 `elapsed_active_ms`를 싣는다), snapshot `elapsed`; `CheckpointTurn`(`packages/protocol/lophn-agent/turns.ts`); `TurnLimiter`의 active(`run-loop/limits.ts`); `stream-core`의 `live-turns.ts`.
  - 내놓는 것: `TurnEnded.active_ms`는 끝난 순간까지 센 active다. 사람 기다림 뒤에 `TurnResumed`가 온다. snapshot `elapsed`가 도는 turn의 active와 그 기준 시각을 싣는다. trace의 `wall_ms`는 wall이다. `clock-shell`이 기댄다.

## 할 일

정한 것(살 단계):
- **사람 기다림을 아는 곳은 core다.** approvals가 `TurnRequestOpened`·`TurnRequestClosed`를, 질문이 `QuestionAsked`·`QuestionResolved`를 Bus에 낸다. child는 모른다: `core-ports.ts`의 `paused()`는 Gate를 거치는 call마다 `pause.begin/end`를 부르고, `CheckToolGate`의 답 `run`은 사람에게 물었는지 싣지 않는다. 그래서 `TurnResumed`는 core가 낸다. `live-turns.ts`가 session마다 열린 기다림을 세고 마지막 기다림이 닫히는 event를 접을 때 `TurnResumed`를 만들며, `at`은 그 event의 `at`이다. 계약 글("agent runtime이 낸다")과 내는 쪽이 다르다(보고의 계약 바꾸기 요청). 모양은 같다.
- **도는 turn의 active는 core 메모리로 센다.** `live-turns.ts`가 lophn turn마다 `{turn, active_ms, at, waiting}`을 든다: `TurnStarted`에서 `{0, event.at}`, 첫 기다림이 열리면 `active_ms += 열린 at − at`이고 센 것을 멈춘다, 마지막 기다림이 닫히면 `at = 닫힌 at`. planner가 말한 "마지막 checkpoint"가 여기서는 이 메모리다. turn 행의 checkpoint(child가 model 응답·tool 묶음 뒤에 쓴다)는 기다림이 열린 때에 찍히지 않아 그대로 쓸 수 없다. 기다림마다 child가 `CheckpointTurn`을 두 번 쓰는 길(ledger 쓰기)은 버렸다. child의 limiter와 같은 것을 재고 차이는 ms다.
- **끝나는 길마다:**
  - completed·failed(child의 `FinishTurn`): `turn.ts`의 `finishWith`가 `FinishTurn` 바로 앞에서 `ports.checkpoint(limiter.snapshot())`. 이때 child는 기다리는 중이 아니다.
  - 멈춤(`StopTurn`): `withLiveTurns`가 `StopTurn` 앞에서 core 메모리로 마감한 active를 machine `CheckpointTurn`으로 쓴다. 일하는 중이면 `active_ms + (지금 − at)`, 기다리는 중이면 `active_ms`이고, 행의 `elapsed_active_ms`보다 작으면 행의 값이다(command가 줄어드는 값을 거절한다). handler는 writer Worker에서 돌아 core 메모리를 읽지 못하므로 command 앞에서 한다.
  - child가 사라져 끊김(`InterruptTurns`): 같은 앞 처리기가 core 메모리에 있는 도는 turn마다 먼저 `CheckpointTurn`을 쓴다.
  - 켤 때 닫는 turn(`restarted`)과 session archive·지움(`session_ended`)은 마지막 checkpoint 그대로다. 켤 때는 끝난 순간을 모른다. session 끝은 `endSession`이 `ArchiveSession`·`DeleteSession` 같은 tx 안에서 닫아 감쌀 command가 여럿이다.
  - `TurnEnded.active_ms`는 `turn-events.ts`가 행을 다시 읽어 싣으므로(`chat-protocol`) 위 checkpoint 뒤 값이다. `run-loop/commands.ts`, `interrupt.ts`는 고치지 않는다.
- **coding session은 세지 않는다.** coding agent도 `TurnStarted`를 낸다(`apps/coding/hook.ts`). `session-snapshots.ts`가 lophn session 표(`loadSession`)에 있는 session의 `TurnStarted`만 시간 접기에 넘긴다. 계약도 coding agent는 `TurnResumed`를 내지 않는다.
- **`wall_ms`**: 끝난 turn은 `finished_at − started_at`(0 아래면 0)이다. 끝나지 않았거나 turn 행이 없으면 지금처럼 active다. 함수에 시계가 없다.
- 고치지 않는 소유 file: `run-loop/{loop,limits,ports,core-ports,driver,prepare,commands}.ts`. 위 길이 이 file들을 건드리지 않는다.

1. `packages/core/lophn-agent/run-loop/turn.ts` (근거: 계약 "`FinishTurn` 입력은 바꾸지 않고 끝내기 직전 `CheckpointTurn`으로 active를 마감한다", element `run-loop`)
   - `finishWith`(119줄)에서 `ports.finish` 앞에 `await state.deps.ports.checkpoint(state.limiter.snapshot())`. `limitEnd`도 `finishWith`를 지나므로 따로 고치지 않는다. 행이 이미 끝났으면 `checkpoint`가 조용히 넘어간다(`core-ports.ts`). 주석: 끝난 순간까지의 active를 `TurnEnded`가 싣게 한다.
2. `packages/core/lophn-agent/run-loop/live-turns.ts` (근거: 계약 "`clock-core`가 같은 module에 `elapsed`를 더한다", "사람 기다림 뒤에 `TurnResumed`가 온다", README "Worked for")
   - `createLiveTurns`에 session마다 시간 상태 `{ turn, active_ms, at, open: Set<string> }`를 더한다. `at`은 ms로 들고 내보낼 때 `formatAt`으로 바꾼다.
     - `TurnStarted`: `{ turn, active_ms: 0, at: event.at, open: 비었다 }`. lophn session만 넘어온다(아래 3).
     - `TurnRequestOpened`(`payload.request.turn`이 지금 turn일 때 `request.id`), `QuestionAsked`(`payload.turn`이 지금 turn일 때 `group`): open이 비어 있었으면 `active_ms += event.at − at`, `at = event.at`. id를 open에 넣는다.
     - `TurnRequestClosed`(`request`), `QuestionResolved`(`group`): open에서 뺀다. 그래서 비면 `at = event.at`이고 `TurnResumed { turn, active_ms }`(envelope `session`, `at`은 그 event의 `at`)를 `apply`의 돌려준 값으로 낸다. 모르는 id는 무시한다.
     - `TurnEnded`: 지운다.
   - `elapsed(session): { turn, active_ms, at } | null`. 기다리는 중이면 열린 때의 값 그대로다(화면은 state `waiting`일 때 세지 않는다).
   - 끝낼 때의 값: `closingActive(turn, nowMs): number | null`. 기다리는 중이면 `active_ms`, 아니면 `active_ms + max(0, nowMs − at)`.
   - `withLiveTurns`의 deps에 `turnRow(turn): { state, state_seq, elapsed_active_ms, elapsed_stall_ms } | null`을 더한다.
     - `StopTurn`이면 `stream-core`의 답 저장 뒤, `StopTurn` 앞에 그 turn을 마감한다: 행이 `running`이고 `closingActive`가 있으면 `CheckpointTurn { turn, elapsed: { active_ms: max(행 값, 마감 값), stall_ms: 행 값, checkpoint_at: clock.now() } }`, compare `{ state_seq: 행 값 }`, 자격 `deps.context`. 실패해도 `StopTurn`은 간다.
     - `interruptTurns.name`이면 시간 상태가 있는 turn마다 같은 `CheckpointTurn`을 먼저 쓴다.
   - `stream-core`의 멈춤 test가 envelope 순서를 index로 보므로 `CheckpointTurn`이 끼어도 그대로 통과해야 한다. 목록 전체를 비교하고 있으면 그 줄만 맞춘다.
3. `packages/core/main/daemon/wiring/session-snapshots.ts` (근거: 계약 "snapshot `elapsed`", `event.md`)
   - `LIVE_TURNS_CONTEXT`의 operations에 `checkpointTurn.name`을 더한다.
   - Bus 구독 type에 `TurnRequestOpened`, `TurnRequestClosed`, `QuestionAsked`, `QuestionResolved`를 더한다. `TurnStarted`는 `loadSession(lookup, event.session)`이 있을 때만 시간 접기에 넘긴다(쓰는 중인 글을 비우는 것은 그대로).
   - `apply`가 `TurnResumed`를 돌려주면 `queueMicrotask(() => ctx.bus.publish(resumed))`. 구독 안에서 바로 내면 같은 event를 받는 다른 구독자보다 먼저 닿는다.
   - `snapshotsOf`의 lophn 행에 `elapsed: live.elapsed(row.id)`.
   - `withLiveTurns`에 `turnRow`를 준다: 이 wiring의 읽기 연결(`sql`)로 `select state, state_seq, elapsed_active_ms, elapsed_stall_ms from turns where id = ?`.
4. `packages/core/lophn-agent/observability/model.ts` (근거: README "`assembleTrace`의 `wall_ms`는 진짜 wall이다", roadmap 6)
   - `assembleTrace`(157줄)의 `times.wall_ms`를 위 정한 것대로 고친다(`Date.parse`로 두 시각을 읽는다). `active_ms`는 그대로다.
   - 161줄 주석("turn 전체 경과는 단조 누적값(active)이다. 시작·종료 시각의 차이는 쓰지 않는다.")을 고친다: active는 사람 기다림을 뺀 누적값이고 wall은 시작부터 끝까지다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 시간은 test하지 않는다(README "위험 test", AGENTS.md "속도"). `stream-core`의 `live-turns_test.ts` 셋과 loop harness(`tests/harness/loop`)가 그대로 통과한다.
- 남지 않음: `grep -n "시작·종료 시각의 차이는 쓰지 않는다" packages/core/lophn-agent/observability/model.ts`가 0줄이다. `grep -n "TurnResumed" packages/core/lophn-agent/run-loop/live-turns.ts packages/core/main/daemon/wiring/session-snapshots.ts`와 `grep -n "checkpoint" packages/core/lophn-agent/run-loop/turn.ts`가 각 한 줄 이상이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없을 것이다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다. 이미 있는 것: `TurnResumed`는 core가 낸다(`packages/protocol/events/agent.ts` 머리 주석과 `chat-protocol` 계약 글의 "agent runtime이 낸다"를 고칠 것).
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 이 task 뒤에도 남는 것:
  - 켤 때 닫힌 turn과 session archive·지움으로 닫힌 turn의 `active_ms`는 마지막 checkpoint 값이다.
  - 도는 동안의 `elapsed`(core, `TurnStarted`부터)와 끝난 뒤의 `active_ms`(child limiter, loop 시작부터)는 시작점이 조금 달라 끝날 때 숫자가 몇백 ms 줄 수 있다.
