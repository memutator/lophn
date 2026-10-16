# contract-calls-places-turns

`run`을 `turn`으로 바꾼 새 계약을 protocol에 더한다. turn 기록, 시작·checkpoint·끝·멈춤 command, 읽기 route, blob 용도 이름이다. 입력함과 대기, 복구, `handoff` 출처는 새 모양에서 뺀다. 옛 `runs.ts`, `run-values.ts`, `run-reads.ts`, `run-wait.ts`, `run-blobs.ts`는 지우지 않고 옆에 새것을 더한다.

- 단위: contract-calls-places (wave 2)
- 선행: contract-calls-places-places(`AgentRef`, `Place`를 import한다). `protocol/base/ids.ts`에 접두사 `trn`(Turn)이 먼저 들어 있어야 한다. lead가 이 task를 띄우기 전에 더해 둔다. 없으면 고치지 말고 멈춰서 보고한다.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/turns.ts` (새로)
  - `packages/protocol/lophn-agent/turn-values.ts` (새로)
  - `packages/protocol/lophn-agent/turn-reads.ts` (새로)
  - `packages/protocol/lophn-agent/turn-blobs.ts` (새로)
- 읽을 것:
  - spec: S1 3·4·6·9·10장(Run-loop, agent event `TurnStarted`·`TurnEnded`, 꺼졌다 켜질 때) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - spec: S3 4·5장(입력은 받는 session이 돌면 다음 turn까지 기다린다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-call.md`
  - spec: S8 3장(꺼졌다 켜지면 돌던 turn은 interrupted) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - inventory: `I1.3#6`, `I1.3#7`
  - 결정: `../README.md` 3장 #18·23·57(`run` → turn. protocol과 코드에서 끝까지 바꾼다), #4(입력함은 메모리, 재시작하면 기다리던 call은 failed)
  - 지금 코드: `packages/protocol/lophn-agent/{runs,run-values,run-reads,run-wait,run-blobs}.ts`
- 계약:
  - 쓰는 것: `protocol/lophn-agent/places.ts`의 `AgentRef`·`Place`, `agent-values.ts`의 `resolvedSourcesSchema`, `resolved-model.ts`, `run-values.ts`의 `positiveSafeIntegerSchema`·`positiveRevisionSchema`·`readCursorSchema`·`runLimitsFields`·`DEFAULT_RUN_LIMITS`·`runElapsedSchema`(import해 쓰고 복사하지 않는다), `run-blobs.ts`의 `blobSizeSchema`·`registerPreparedBlob`·`AGENT_RUNTIME_PRINCIPAL`. agent event `TurnStarted`·`TurnEnded`의 payload는 contract-events가 `protocol/events`에 둔다. 이 task는 정의하지 않고 `turnOutcomeSchema`를 export해 그쪽이 가져다 쓰게 한다.
  - 내놓는 것: 아래 "모양". wave 3 router(run-loop), places-sessions(session), agent-tools, agent-definition이 import한다.

## 모양

모든 새 이름은 lead가 `mod.ts`에 `export *`로 올리므로 옛 export와 겹치면 안 된다. `Turn`은 겹치지 않는다(확인함. 쓰기 전에 `grep -rn "export .*Turn" packages/protocol`로 한 번 더 본다).

### `turn-values.ts`

- `ID`: `trn`.
- `turnOutcomeSchema`와 output 짝, `TURN_OUTCOME_REASONS`: S1 6장 `TurnEnded`의 `completed`, `failed`, `interrupted`.
  - `completed`: `["answer_completed"]`
  - `failed`: 옛 `RUN_OUTCOME_REASONS.failed`에 `no_answer`를 더한 것(`model_error`, `tool_error`, `context_limit`, `model_attempt_limit`, `stall_limit`, `active_limit`, `repeated_tool_failure`, `effect_unknown`, `clock_uncertain`, `configuration_unavailable`, `target_unavailable`, `no_answer`)
  - `interrupted`: `["user_stopped", "restarted", "session_ended"]` (사람이 멈춤, lophn이 꺼졌다 켜짐(S1 10장), session을 archive하거나 지움(S8 3장))
- `TURN_STATES = ["running", "finished"] as const`, `turnStateSchema`. `accepted`와 `waiting_user`는 없다. 입력은 메모리 입력함에 있다가 turn이 시작되면서 행이 생기고(#4), 권한·질문을 기다리는 것은 turn이 `running`인 채 session snapshot이 가진다(S2 6장, S1 4장).
- `turnBasisSchema`와 output 짝, `type TurnBasis`: 옛 `runBasisSchema`에서 아래만 바꾼다.
  - `assignment`(`runBasisAssignmentSchema`)를 `agent: AgentRef`로 바꾼다.
  - `initial_work_place`를 `place: Place | null`로 바꾼다.
  - 나머지(`agent`의 hash와 sources → 이름이 겹치므로 `resolved: {hash, sources}`로 옮긴다, `tools`, `extensions`, `models`, `limits`, `tool_result_limits`)는 옛 것을 그대로 쓴다.
- `turnRecordSchema`(output)와 `type TurnRecord`, `type Turn`: 칸은 `id: trn`, `session: ses`(null 없음), `input_message: msg`(이 turn을 시작한 입력의 메시지), `state`, `basis: sha256`, `started_at`, `limits`, `elapsed`, `finished_at | null`, `outcome | null`, `result: sha256 | null`, `state_seq`. refine: `state === "finished"`일 때만 `finished_at`·`outcome`·`result`가 있다. 옛 칸 `assignment`, `source`, `continued_from`, `start_after`, `start_confirmed_seq`, `waiting_on`, `accepted_seq`는 옮기지 않는다. 근거: 이어 하기(`continued_from`)는 복구를 지우면서 없어졌고(S1 10장), 줄 순서는 입력함이 맡는다(S3 4장).
- `readCursorSchema`는 옛 것을 재사용한다.

### `turns.ts`

- `startTurn`: command `turns.start` (`StartTurn`), actors는 옛 `startRun`과 같다. input `{id: trn, session: ses, input_message: msg, basis: sha256, basis_size?, resolved?: sha256, resolved_size?, limits}`. 옛 `startRun`의 `scope`(app 호출 범위)는 없다. app-api tool 목록은 session을 시작할 때 고정하고 grant가 정한다(S4 4장). output은 turn record의 요약.
- `checkpointTurn`: command `turns.checkpoint` (`CheckpointTurn`). 옛 `checkpointRun`과 같고 이름만 turn이다.
- `finishTurn`: command `turns.finish` (`FinishTurn`). input `{turn, outcome: turnOutcome, result: sha256, result_size?}`.
- `stopTurn`: command `turns.stop` (`StopTurn`). input `{turn, request_key, reason: "user_stopped"}`. 사람이 멈추는 것만 남는다.
- `TURN_COMMANDS`로 묶는다.
- 옮기지 않는 것: `acceptRun`(새 입구는 `calls.ts`·`inputs.ts`), `confirmNextRun`, `RunAccepted`·`RunStarted`·`RunFinished` ledger event(S1 12장이 지운다. agent event `TurnStarted`·`TurnEnded`는 contract-events), `run-wait.ts` 전부(`waitRun`, `resolveRunWait`, `correctWaitingRun`, `recoverRun`, `RunWaited`·`RunResumed`·`RunRecovered`, `RECOVERY_*`). 대기와 질문은 session snapshot(S1 4장)과 대기 목록이 맡고, 복구는 "켤 때 돌던 turn을 interrupted로 닫는다"뿐이다(S1 10장).

### `turn-reads.ts`

- 옛 `RUN_READS`와 같은 읽기들을 turn으로 옮긴다: `turnRead`(`ReadTurn`), `turnList`(`ListTurns`), `turnResult`(`ReadTurnResult`), `turnBody`(`ReadTurnBody`), `turnBodyView`(`ReadTurnBodyView`).
- `turnList` 입력: `{session?: ses, state?, cursor?}`. 옛 `assignment` 필터는 `session`으로 바꾼다.
- `TURN_BODY_KINDS = ["turn_basis", "turn_resolved", "model_call_output", "tool_call_output"]`. 옛 `handoff_content`는 뺀다(`I1.3#6`: 맡긴 글은 받는 session 기록의 메시지 본문이다). `run_agent`는 `turn_resolved`로 이름을 바꾼다. `TURN_BODY_VIEW_KINDS`는 `turn_basis`, `tool_call_input`, `tool_call_output`.
- `TURN_READS`로 묶는다.

### `turn-blobs.ts`

- `TURN_BLOB_PURPOSES`: 옛 `RUN_BLOB_PURPOSES`의 `run_basis`·`run_agent`·`run_result`를 `turn_basis`·`turn_resolved`·`turn_result`로 바꾸고 나머지는 그대로 둔다.
- `blobSizeSchema`, `registerPreparedBlob`, `AGENT_RUNTIME_PRINCIPAL`은 `run-blobs.ts`에 있다. 다시 export하지 않는다(겹친다). wave 3이 `run-blobs.ts`를 지울 때 옮긴다고 보고에 적는다.

## 할 일

1. `turn-values.ts`, `turns.ts`, `turn-reads.ts`, `turn-blobs.ts`를 위 이름 그대로 만든다. 옛 file에서 복사하되 위에서 뺀다고 한 칸과 command를 옮기지 않는다.
2. `I1.3#7`(run 출처 `handoff` 가지와 그 열·제약·index): 새 `TurnRecord`에 `source` 칸이 없으므로 `handoff` 가지도 없다. 옛 `run-values.ts`의 `runSourceSchema`는 지우지 않는다.
3. `I1.3#6`(handoff 내용 blob): `turnBody`의 종류에서 `handoff_content`를 뺀 것으로 protocol 쪽은 끝이다. blob field 등록(`handoffBodyFields`)과 준비기는 router가 core에서 지운다.
4. `protocol/lophn-agent/mod.ts`의 `export *` 줄과 `registry.ts`는 lead 몫이다. 고치지 않고 보고에 적는다.
5. 옛 `runs.ts`·`run-*.ts`는 쓰는 곳이 많아 건드리지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(type과 schema뿐이다).
- 남지 않음: 없음(옛 계약은 wave 3과 cleanup이 지운다). 새 file 넷에서 `grep -n "Run\b\|run_\|handoff\|assignment\|waiting_user\|accepted" packages/protocol/lophn-agent/turn*.ts`가 0줄이다(`turn-values.ts`가 옛 `run-values.ts`에서 import하는 줄은 예외로 보고에 적는다).

## 보고

- 바꾼 file
- 등록할 것: `protocol/lophn-agent/registry.ts`의 `ROUTES`에 `TURN_COMMANDS`·`TURN_READS`를 올린다. 옛 `RUN_COMMANDS`·`RUN_READS`·`RUN_WAIT_COMMANDS`와 resource 이름이 달라(`runs` 대 `turns`) 둘이 같이 있을 수 있다. 옛 event(`RunAccepted` 등)는 contract-events가 지울 때 같이 뺀다. `protocol/base/ids.ts`의 `trn`.
- 안 쓰게 된 export: `runs.ts`, `run-values.ts`, `run-reads.ts`, `run-wait.ts`, `run-blobs.ts`의 `RUN_BLOB_PURPOSES` 전부(`blobSizeSchema` 등 helper는 옮긴다)
- 정한 것: `TurnRecord`의 칸(뺀 칸과 이유), `interrupted` 이유 셋, `no_answer`를 failed로 옮긴 것, `StartTurn`이 `AcceptRun`과 `StartRun`을 합친 것, 복구 command를 하나도 두지 않은 것
- 계약 바꾸기 요청: 없음(wave 2)
