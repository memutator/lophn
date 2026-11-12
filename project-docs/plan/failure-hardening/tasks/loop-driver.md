# loop-driver

turn을 돌리는 바깥쪽의 실패를 고친다: `FinishTurn`이 실패해 `running`에 남는 turn, 되풀이되는 Compact 실패, 요약 call의 retry, 재시작 때 열린 tool call 닫기와 다음 turn에 알리기.

- 단위: loop (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/{driver,prepare,interrupt}.ts`
  - `packages/core/lophn-agent/run-loop/{driver_test,harness-turn_test,prepare_test}.ts`
  - `packages/core/lophn-agent/session/compactor.ts`
- 읽을 것:
  - 이슈 `project-docs/issues/failed-finish-leaves-turn-running.yaml`
  - architecture: `project-docs/architecture/agent-definition.md` 지키는 것 42(turn 이력 checkpoint), 43(compact는 다음 turn 전과 turn 안. "이 판단은 runtime 메모리에 있어 runtime이 다시 뜨면 잊는다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `run-loop`, `agent-sessions`. `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 지금 열린 tool call을 닫는 SQL 본보기: `packages/core/lophn-agent/tools/model.ts`의 `toolsCloseStuckSteps`(이미 낸 schema step이라 고치지 않는다)
- 계약:
  - 쓰는 것: `packages/core/lophn-agent/run-loop/retry.ts`의 `isTransientFailure(outcome)`, `MODEL_RETRY_MAX`, `modelRetryDelayMs(retryNumber, retryAt, nowMs)`, `abortableWait(ms, signal)`. 같은 wave의 `loop-turn`이 retry.ts를 고치지만 이 이름들과 세 인자 꼴은 지킨다. 이 task는 retry.ts를 고치지 않는다.
  - 쓰는 것: machine route `turnList`, `toolCallList`(`packages/core/lophn-agent/run-loop/runtime-access.ts`의 `RUNTIME_MACHINE_ROUTES`에 이미 있다).
  - 고치지 않는 것: `turn.ts`·`core-ports.ts`·`ports.ts`(`loop-turn`), `packages/core/main/agent-runtime/main.ts`(`runtime-children`. driver에 `compact`를 꽂는 곳이고 고치지 않아도 된다: 아래 2).

## 할 일

1. **`FinishTurn` 실패로 `running`에 남는 turn(loop #2b).** 지금 loop가 `{kind: "finish_failed"}`를 값으로 돌려주면 `driver.ts`의 `done` 사슬은 `.catch`(던진 경우만 `closeStarted("loop_threw")`)를 지나지 않고 `.finally`에서 session만 푼다. turns 행은 `running`이라 새 입력은 `StartTurn`이 `conflict`로 거절하고 메시지는 아무도 읽지 않는 steer로 쌓인다. core를 다시 켤 때까지 session이 멈춘다.
   - `startNext`의 `done` 사슬에서 `.catch` 앞에 `.then`을 둔다: `end.kind === "finish_failed"`이면 `deps.report?.(...)`로 원인(`end.error.message`)을 남기고 `await turn.closeStarted("finish_failed").catch(() => {})`. 값은 그대로 돌려준다. 던진 경우의 `.catch`가 만든 `finish_failed`가 다시 닫히지 않게 순서를 지킨다.
   - `prepare.ts`의 `PreparedTurn.closeStarted`의 `why`에 `"finish_failed"`를 더하고, 닫는 이유는 `loop_threw`처럼 `internal`이다(그 위 주석도 고친다). `closeStarted`는 이미 행을 읽어 `running`이 아니면 아무것도 하지 않는다.
   - 닫는 command도 실패하면 지금처럼 남는다(이슈의 추천안: 재시작에 맡긴다).

2. **Compact 실패 되풀이(tools #3).** 지금 끝난 turn이 `compactNext()`를 켜면 driver가 다음 turn 전에 늘 `compact(session)`을 돌리고, 결과(`failed`)를 보지 않는다. 요약 model이 계속 실패하면 turn마다 헛 요약 call 하나가 붙는다.
   - `DriveDeps.compact`의 결과 type을 `Promise<{ kind: string }>`로 좁힌다(`main.ts`가 넘기는 `compactor.compactNow`의 `CompactResult`가 이미 이 꼴이라 `main.ts`는 고치지 않는다. `driver_test.ts`의 가짜는 맞춘다).
   - `compactBefore` 옆에 session마다 연속 실패 수 `Map<string, number>`를 둔다. 결과가 `failed`이거나 던지면 1 올리고, `compacted`면 지운다. `idle`은 그대로다. `endSession`에서도 지운다.
   - `.finally`에서 `compactBefore`에 다시 올리기 전에 실패 수가 3 이상이면 올리지 않는다. 3이 되는 순간 `deps.report?.(...)`로 한 번 남긴다.
   - 메모리에만 둔다: runtime이 다시 뜨면 잊는다(지키는 것 43과 같다). 표에 칸을 더하지 않는다. turn 안 Compact(`turn.ts`의 `MID_TURN_COMPACT_MAX`)는 turn마다 이미 상한이 있어 건드리지 않는다.

3. **요약 call retry(tools #4).** 지금 `compactor.ts`의 `summarizeOnce`는 결과가 complete가 아니면 무엇이든 `Failure("model_failed")`로 던지고 다시 하지 않아, 일시 실패(5xx, 연결 끊김) 하나로 Compact 전체가 실패한다.
   - `Failure`에 그 시도의 `ModelOutcome`(있으면)을 싣는다. `summarize`가 `summarizeOnce`를 부르다 `isTransientFailure(outcome)`인 `Failure`를 받으면 `MODEL_RETRY_MAX`번까지 `modelRetryDelayMs(n, outcome.retry_at, clock.nowMs())`만큼 기다렸다가 다시 부른다. 시도마다 새 model call 행이다(`attempt.order`가 이미 오른다). 다시 보내는 행은 `attempt_kind: "retry"`, `retry_of`에 앞 call id를 싣는다.
   - 대기는 `request.signal`로 끊긴다. `CompactorDeps`에 `wait?(ms, signal)`을 더하고 없으면 `abortableWait`를 쓴다(`packages/core/main/agent-runtime/product-driver.ts`는 고치지 않는다).
   - 일시 실패가 아닌 실패(`too_large`, `summary_too_long`, 거절, 인증)는 지금처럼 바로 끝난다.

4. **재시작 때 열린 tool call 닫기(tools #23 a).** 지금 `interrupt.ts`의 `interruptRunningTurns`는 turns 행만 `interrupted`로 닫고 그 turn의 `tool_calls` 가운데 `requested`·`started` 행은 그대로 둔다. ACP 화면이 그 call을 영원히 실행 중으로 그리고, 닫는 SQL은 한 번 돈 schema step(`toolsCloseStuckSteps`)뿐이다.
   - 같은 tx에서 turn마다 `toolsCloseStuckSteps`의 SQL과 같은 값으로 닫는다: `update tool_calls set state = 'finished', outcome = '{"kind":"uncertain","code":"uncertain"}', result = <같은 uncertain 결과 JSON>, finished_at = <그 turn의 finished_at>, state_seq = state_seq + 1 where turn = ? and state in ('requested', 'started')`. 결과 summary는 "The call was cut off when its turn ended; its outcome is not confirmed."처럼 지금 step 글과 같은 뜻으로 쓴다. 닫기 전에 그 id들을 읽어 turn 결과 facts에 `unknown_effects`로 싣는다(`facts = {turn, session, outcome, unknown_effects}`).
   - runtime SQL이라 migration이 아니다. 표 모양은 그대로다.
   - `interruptRunningTurns`는 `session_ended`(archive·지움)와 child가 사라질 때(`interruptTurnsCommand`)도 같은 함수를 지나므로 셋 모두 닫힌다.
   - `harness-turn_test.ts`의 `setup`은 `tool_calls` 표가 없다. `toolsSchemaSteps`(`packages/core/lophn-agent/tools/model.ts`)를 더해 지금 test가 깨지지 않게 한다. 같은 함수를 부르는 다른 test(`packages/core/lophn-agent/workspaces/`, `packages/core/router/`)를 돌려 `tool_calls`가 없는 test DB가 있는지 본다. 있으면 그 test file에 schema step 한 줄을 더하고 보고의 "넘길 줄"에 적는다.

5. **다음 turn에 알리기(tools #23 b).** 지금 재시작으로 끊긴 turn의 진행 중 batch는 이력에 없고 다음 turn은 그 call이 돌았는지 모른다. model이 이미 한 `file.write`·`shell.run`을 다시 할 수 있다.
   - `prepare.ts`의 `build()`에서 `notices`를 만들 때 이 session의 바로 앞 turn을 본다: `turnList({session, state: "finished"})`를 끝 page까지 읽어(`packages/core/lophn-agent/session/history.ts`의 `MAX_PAGES` 꼴) `started_at`이 가장 늦은 행(같으면 id가 큰 것)을 고른다. 그 outcome이 `interrupted`/`restarted`이면 `toolCallList({turn})`에서 outcome이 `uncertain`인 call을 고른다.
   - 있으면 notice 한 줄을 더한다: `[machine] The previous turn was cut off before it finished. These tool calls may or may not have taken effect: <tool> (<id>), …. Check their results before repeating them.` 고정 글과 tool 이름·id만 싣는다(앱이 쓴 글은 넣지 않는다).
   - notice는 `TurnContext.notices`로 그 turn의 call마다 붙고 이력에는 남지 않는다. 다음 turn에서는 앞 turn이 이 turn이라 다시 나오지 않는다.
   - 읽기가 실패하면 notice 없이 turn을 시작한다(turn을 막지 않는다).
   - `NoticeKind`(`packages/protocol/lophn-agent/input-tags.ts`)에 새 값을 더하지 않는다. loop의 `[machine]` 글과 같은 꼴로 둔다.

## 정한 것

- 연속 Compact 실패의 상한은 3이고 메모리에만 둔다. 이유: 다시 뜬 runtime이 한 번 더 해 보는 것은 싸고, 칸을 더하면 migration이 든다.
- 요약 retry는 run-loop의 retry 규칙(`isTransientFailure`, 2초·4초)을 그대로 쓴다. 같은 provider 실패에 같은 판정을 쓰려는 것이다.
- 재시작 notice는 `prepare.ts` 안에서 앞 turn을 읽어 만든다. 이유: core가 interrupt tx 안에서 session에 메시지를 쓰는 길은 Router 입력과 queue를 건드려 훨씬 크다. `prompt-assembly/turn-prompt.ts`는 고칠 일이 없다.
- 닫는 tool call은 `requested`도 `started`와 같이 `uncertain`이다. 이미 낸 step과 같은 값이라 화면과 기록이 하나의 규칙을 따른다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "끝내는 기록이 실패한 turn은 driver가 failed(internal)로 닫고 같은 session의 다음 turn이 시작된다"(`driver_test.ts`. 이미 있는 `loop_threw` test 옆)
  - "재시작이 turn을 닫으면 그 turn의 requested·started tool call이 uncertain으로 닫힌다"(`harness-turn_test.ts`)
  - "Compact가 세 번 이어 실패한 session은 다음 turn 전에 다시 Compact하지 않는다"(`driver_test.ts`의 `compactSetup`)
- 남지 않음: 없음(이름을 지우거나 바꾸지 않는다).

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴(바꾼 file, 통과한 check, 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청, **무겁게 짠 것**, **알려진 미완 동작**).

- 등록할 것: lead가 `project-docs/flows/areas/turns.yaml`의 outcome `finish-failed`와 그 `unclear`를 고치고(driver가 닫는다), 재시작 때 tool call 닫기를 restart flow에 적고, 위 test를 `project-docs/flows/tests/lophn-agent.yaml`의 covers에 맞춘다. 이슈 `failed-finish-leaves-turn-running`을 닫는다.
