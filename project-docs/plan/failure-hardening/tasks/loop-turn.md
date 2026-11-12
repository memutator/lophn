# loop-turn

turn loop 안의 실패 갈래를 고친다: 잘린 응답 hint, 빈 응답, provider 밖 실패의 이유, model retry의 jitter와 연결 끊김 사다리, 고정 prompt가 예산을 넘을 때의 헛 Compact, 없는 tool 이름 hint, 같은 실패 호출의 반복, 기록하지 못한 tool 호출.

- 단위: loop (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/{turn,ports,loop,retry,tool-batch,core-ports}.ts`
  - `packages/core/lophn-agent/run-loop/core-ports_test.ts`
  - `tests/harness/loop/loop_test.ts`
  - `tests/support/loop/{harness,model}.ts`
- 읽을 것:
  - 계획 README `project-docs/plan/failure-hardening/README.md` "정한 것"(같은 tool 호출 반복, 빈 응답, 기록하지 못한 tool 호출)
  - architecture: `project-docs/architecture/agent-definition.md` 지키는 것 31(틀린 입력 알리기), 37(결과 줄이기), 40·43(입력 예산과 compact), 42(turn 이력 checkpoint)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `run-loop`, `models`. `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 결정 기록: `project-docs/products/change-log/0.14/drop-turn-work-time-limit.yaml`(기본 호출 상한을 두지 않는다. 이 task는 진행하는 turn을 건드리지 않는다)
- 계약:
  - 쓰는 것: `packages/protocol/lophn-agent/turn-values.ts`의 `TURN_OUTCOME_REASONS.failed`(`no_answer`, `repeated_tool_failure`가 이미 있다. turns 표의 `outcome_reason`에는 CHECK가 없어 migration이 없다), `packages/protocol/lophn-agent/model-call-values.ts`의 `VERDICT_PATHS`(`connection_failed`).
  - 내놓는 것: `packages/core/lophn-agent/run-loop/retry.ts`의 `isTransientFailure(outcome)`, `MODEL_RETRY_MAX`, `modelRetryDelayMs(retryNumber, retryAt, nowMs)`는 이름과 지금 인자를 그대로 두고, 세 인자로 부르면 지금처럼 2초·4초(서버 시각이 있으면 그 시각)를 돌려준다. 같은 wave의 `loop-driver`가 compactor의 요약 retry에서 이 세 이름을 이 꼴로 쓴다. jitter와 연결 사다리는 뒤에 optional 인자나 새 함수로 더한다.
  - 내놓는 것: `turn.ts`와 `core-ports.ts`는 wave 2의 `loop-stop`이 이어 고친다(Stop 뒤 이력, image 거절). 이 task가 바꾼 모양을 보고에 적는다.

## 할 일

1. **잘린 응답 hint(loop #19).** 지금 `runTurn`의 partial 갈래는 `max_tokens`로 잘려도 "Continue from what is confirmed." 하나만 붙여, model이 같은 큰 tool 호출(큰 file 쓰기)을 다시 보내 세 번 잘린 뒤 `model_error`로 끝난다. `finish_reason`이 길이 한도(`max_tokens`, `length`, `max_output_tokens`, `MAX_TOKENS`)이면 같은 `[machine]` 문장 끝에 "Split the work into smaller tool calls (for example write a large file in parts)."를 붙인다. 깨진 JSON과 길이 한도를 따로 가리는 것은 하지 않는다(`Collected`에 새 칸이 필요하다).

2. **빈 응답(loop #20).** 지금 `afterModel`은 tool call도 글도 없는 완전한 응답을 빈 답으로 남기고(`ports.answer("")`) `answer_completed`로 끝내, 사람은 빈 대답을 받는다. `LoopState`에 연속 빈 응답 수(`emptyRun`)를 두고 `loop.ts`의 `startTurnLoop`에서 0으로 시작한다.
   - `toolCalls.length === 0 && text.trim() === ""`이면 답을 남기지 않는다. 첫 번째면 `appendUser`로 `[machine] The previous response was empty. Answer the request or call a tool.`을 붙이고 `continueTurn`이다. 두 번째면 `failWith(state, "no_answer")`.
   - 글이나 tool call이 있는 응답이 오면 0으로 돌린다(`partialRun`과 같은 꼴).
   - `ports.ts`의 `LoopFailureReason`에 `"no_answer"`를 더한다.
   - 이제 `answer()`는 빈 글로 불리지 않는다. `core-ports.ts`의 `recordReply`의 `emptyTextPart` 인자와 그 주석, `ports.ts` `TurnPorts.answer` 주석의 "마지막 응답은 글이 비어도 남기고"를 지운다(죽은 코드).
   - run 쪽 결과가 바뀐다: 빈 답으로 끝난 run은 지금 `no_answer` 오류였고 이제 `turn_failed`(reason `no_answer`)다(`packages/core/runs/service.ts`의 `settleFromTurn`). 고치지 않고 보고에 적는다.

3. **provider 밖 실패의 이유(loop #41).** 지금 `callModel`은 `ports.model.call`이 `ok:false`로 돌아오면 무엇이든 `configuration_unavailable`("model을 쓸 수 없다")로 끝낸다. lophn 안의 오류(본문 만들기 실패, blob 저장 실패, state-free 계속 불가)도 사람에게 model 설정 문제로 보인다. `error.code`가 `internal`이나 `conflict`이면 `failWith(state, "internal")`, 그 밖(`forbidden`, `unauthorized`, `unavailable`, `not_found`: secret 부착 거절 등)은 지금처럼 `configuration_unavailable`이다. `providers/invoke.ts`의 `conflict`를 `internal`로 바꾸는 것은 하지 않는다(이 task의 file이 아니고 turn.ts에서 같은 결과가 난다).

4. **model retry jitter(loop #8, jitter만).** 지금 `modelRetryDelayMs`는 서버 시각이 없으면 늘 정확히 2000·4000ms라 동시에 실패한 turn들이 같은 순간에 다시 보낸다. 서버 시각이 없는 기본 사다리에만 ±20% jitter를 넣는다. 꼴은 `toolRetryDelayMs`와 같게 `(random() * 2 - 1) * 0.2`이고 `turn.ts`는 `deps.random`을 넘긴다. 서버 `retry_at`은 그대로 지킨다. test harness의 `random`은 `() => 0.5`라 spread가 0이고 `loop_test.ts` 9·10·11의 `[2000, 4000]`·`[10_000]`이 그대로 맞는다. retry 대기를 화면에 보이는 것은 하지 않는다.

5. **연결 끊김 사다리(loop #11).** 지금 연결 실패(`outcome.evidence?.verdict_path === "connection_failed"`)도 2초·4초 두 번 뒤 `model_error`라, 6초 남짓 네트워크가 끊기면 turn이 끝난다. 연결 실패면 5초·15초·30초로 세 번까지 다시 보낸다(jitter는 4와 같다). `callModel`의 `retries >= MODEL_RETRY_MAX` 판정을 outcome에 따른 한도로 바꾼다. `MODEL_RETRY_MAX`의 값과 뜻은 그대로 둔다(계약). `idle_timeout`은 지금 사다리 그대로다.

6. **고정 prompt가 예산을 넘을 때 헛 Compact(tools #9).** 지금 `blockedEnd`는 `input_over_budget`이면 언제나 `state.compactNext = true`로 해, 이전 대화가 작고 system·tool 목록이 큰 경우에도 다음 turn 전에 쓸데없는 요약 call을 한다. `prepare()`의 blocked 갈래에서 `context`와 `assembled.over`를 `blockedEnd`에 넘기고, `sessionTokens(context) >= over.input_budget * COMPACT_SESSION_SHARE`일 때만 `compactNext`를 켠다. 새 `LoopFailureReason`은 만들지 않는다(그대로 `context_limit`).

7. **없는 tool 이름 hint(tools #10).** 지금 `tool-batch.ts`의 `one()`은 `info === undefined`면 "tool is not available"만 답해 model이 같은 틀린 이름을 되풀이한다(`tools/work.ts`의 not_found 갈래는 이 길에서 닿지 않는다. 이슈 `missing-tool-reason-unreachable`). `ToolPort`에 `names(): readonly string[]`(이 turn이 model에 준 wire 이름)을 더하고, `core-ports.ts`는 `deps.tools.listed`를 `toWireToolName`(`packages/protocol/lophn-agent/tool-catalog.ts`)으로 옮긴 이름을, `tests/support/loop/harness.ts`는 harness tool 이름을 돌려준다. not_found summary는 ``"`<name>` is not a tool in this session. Tools: a, b, c."``이다. 목록은 이름 순이고 summary가 300자를 넘으면 그 앞에서 자르고 `, …`를 붙인다.

8. **같은 실패 호출의 반복(tools #12 = loop #31).** 지금 같은 tool을 같은 입력으로 불러 같은 실패를 받아도 막는 것이 없고, 실패한 호출도 진입했으면 `limiter.toolResult()`가 stall 시계를 0으로 돌려 사람이 멈출 때까지 돈다. README "정한 것"대로 한다.
   - `LoopState`에 `repeat: { key: string; code: string; count: number } | null`을 두고 `loop.ts`에서 `null`로 시작한다. key는 호출의 실행 이름과 입력(`CallResult.name`, `CallResult.input`, `lophn`이면 푼 명령)을 `canonicalize`(`packages/base/mod.ts`)한 것이다.
   - batch를 기록한 뒤(`record` 옆) 결과를 요청 순서로 본다: `status === "failure"`이고 key와 code가 `repeat`과 같으면 `count += 1`, 다른 실패면 `{key, code, count: 1}`, 이 반복으로 막힌 결과(아래 code)는 key가 같으면 `count += 1`, 그 밖의 결과는 `repeat = null`.
   - `BatchControl`에 `refuse(name, input): string | null`을 더하고 `one()`이 gate 다음에 부른다. `repeat.count >= 3`이고 key가 같으면 `"repeated_call"`을 돌려주고 `notExecuted(index, "repeated_call")`로 닫는다. `REASON_TEXT`에 `repeated_call: "This exact call already failed the same way three times in a row, so it was not run again. Change the approach: different input, a different tool, or ask the person."`을 더한다.
   - batch 기록 뒤 `repeat.count >= 6`이면 그 batch의 이력과 checkpoint는 남기고 `failWith(state, "repeated_tool_failure")`. `LoopFailureReason`에 `"repeated_tool_failure"`를 더한다.
   - 바로 이어진 똑같은 호출만 본다. A·B·A·B 같은 꼴은 보지 않는다. 진행하는 turn(성공이 섞이는 turn)에는 상한이 없다.

9. **기록하지 못한 tool 호출(tools #22 = rt #30).** 지금 `attemptTool`은 `record`(`RecordToolRequest`, 입력 blob 저장)가 실패해도 handler를 돌린다(`recorded.ok ? await enter(...) : ok(undefined)`). disk가 차거나 writer가 죽었을 때 `file.write`·`shell.run`이 기록 없이 돌고 rewind 기록도 남지 않는다. README "정한 것": 읽기만 돌린다. `record` 바로 뒤에서 `!recorded.ok && definition !== undefined && definition.effect !== "read"`이면 handler를 부르지 않고 `done(id, "not_executed", "unrecorded", "The call could not be recorded, so it did not run.")`을 돌려준다. 기록 행이 없으니 닫는 command는 없다. 읽기는 지금처럼 돈다. 파일 머리 주석("기록을 못 해도 turn은 간다")과 `record` 위 주석("어느 쪽이든 못 남겨도 호출은 그대로 간다")을 새 규칙에 맞춘다.

## 정한 것

- 빈 응답 수는 연속으로 센다(완전한 응답이 오면 0). `partialRun`과 같은 꼴이라 한 turn 안에서 떨어져 나온 빈 응답 둘이 turn을 끝내지 않는다.
- 반복의 "같은 실패"는 같은 status `failure`와 같은 `code`다. summary 글은 비교하지 않는다: 시각·경로가 섞여 같은 실패도 글이 다를 수 있다.
- 반복 key는 dispatch한 실행 이름과 입력이다. `lophn` wrapper로 부른 다른 명령이 같은 key가 되지 않는다.
- 연결 사다리는 `connection_failed`에만 쓴다. idle timeout은 응답을 받던 중이라 지금 사다리가 맞다.
- 기록하지 못한 쓰기는 `not_executed`다. 돌지 않은 것이 확정 사실이라 `uncertain`(효과 불명)이 아니다.
- #41에서 `conflict`도 `internal`로 본다. loop에 오는 `conflict`는 state-free 계속 불가와 이미 닫힌 turn뿐이고, 닫힌 turn이면 `finishWith`가 멈춤으로 끝낸다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`tests/harness/loop/loop_test.ts` 행으로):
  - "같은 입력으로 같은 실패를 세 번 낸 tool 호출은 네 번째부터 돌지 않고, 여섯 번째에 turn이 repeated_tool_failure로 끝난다"
  - "빈 응답은 한 번 되묻고 또 비면 turn이 no_answer로 끝난다"
  - "연결 실패는 5초·15초·30초 뒤 세 번까지 다시 보낸다"(`tests/support/loop/model.ts`의 `failed`가 `verdict_path`를 받게 한다)
- 위험 test(`packages/core/lophn-agent/run-loop/core-ports_test.ts`): "요청을 기록하지 못한 쓰기 tool 호출은 handler가 돌지 않고 읽기 tool은 돈다"
- 남지 않음: `grep -rn "emptyTextPart" packages tests`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴(바꾼 file, 통과한 check, 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청, **무겁게 짠 것**, **알려진 미완 동작**).

- 등록할 것: lead가 `project-docs/flows/areas/turns.yaml`의 `unclear`(loop가 내지 않는 reason 목록)에서 `no_answer`, `repeated_tool_failure`를 빼고 outcome으로 올리고, 위 test 행을 `project-docs/flows/tests/lophn-agent.yaml`의 covers에 맞춘다. runs 쪽 결과 변화(빈 답 run이 `turn_failed`)는 `project-docs/flows/areas/` runs 영역에 적는다.
- `retry.ts`에서 더한 이름과 인자 모양, `ToolPort.names`, `BatchControl.refuse`, `LoopState`의 새 칸을 적는다(`loop-stop`이 이어 쓴다).
