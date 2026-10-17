# harness-loop

`startTurnLoop`를 core 없이 돌리는 scripted model과 port 묶음을 `tests/support/loop/`에 만들고, loop의 안전 규칙을 `tests/harness/loop/`의 table test로 본다. 의심 D(같은 잘림의 되풀이)를 정한 동작으로 고친다.

- 단위: harness-loop (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/support/loop/`
  - `tests/harness/loop/`
  - `packages/core/lophn-agent/run-loop/turn.ts`
  - `packages/core/lophn-agent/run-loop/retry.ts`
- 읽을 것:
  - `project-docs/products/roadmap/testing.md`("fake 셋"의 scripted model, "첫 case"의 harness loop 표)
  - `project-docs/plan/testing/research/survey-cases.md` 1-3절의 port 표(어디까지 가짜로 채우는지)와 2-2절(loop가 outcome마다 하는 일). 2-3절은 옛 fake 기준이라 쓰지 않는다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `run-loop`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - `packages/core/lophn-agent/run-loop/{ports,loop,turn,limits,retry,tool-batch}.ts`
  - `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `startTurnLoop(deps: LoopDeps, input: TurnInput): TurnLoopHandle`(`run-loop/loop.ts`), `TurnPorts`·`LoopDeps`·`ModelAttempt`·`ModelCallRequest`·`ToolPort`·`ToolDone`·`FinishRequest`·`LoopEnd`(`run-loop/ports.ts`, `run-loop/mod.ts`가 내보낸다). `ModelPort`는 export되지 않았다. `TurnPorts["model"]`로 쓴다. `manualClock`(`packages/base/clock.ts`), `DEFAULT_TURN_LIMITS`(`protocol/lophn-agent/turn-values.ts`).
  - 내놓는 것: `tests/support/loop/`의 `scriptedModel`, `loopHarness`, `assertRequestInvariants`(아래 모양). 다른 task가 쓰지 않는다. 제품 쪽은 `run-loop/retry.ts`의 `PARTIAL_RUN_MAX = 3`.

## 지켜야 할 것(계획 공통)

- `~/.lophn`, OS keychain, 사람의 전역 harness 설정을 건드리지 않는다. E2E data root는 `.dev-data/e2e/<run>/home`뿐이다.
- 진짜 model provider는 `deno task test:live`에서만, 사람이 key를 줄 때만 부른다. worker와 lead는 live를 돌리지 않는다(key 없는 실행으로 gate만 확인한다).
- 전역 mutable 상태를 두지 않는다. 고정 port와 고정 path를 쓰지 않는다. 병렬로 돌아야 한다. sanitizer를 끄지 않는다. sleep으로 기다리지 않는다(gate, 가짜 clock, 신호).
- `tests/support`에는 띄우기와 연결만 둔다. flow의 단계는 test file에 그대로 쓴다. 공통 불변식은 함수 하나로 둔다.
- case 하나는 단계 6, fake 대답 3, 단정 3 이하다. 화면 문구는 단정하지 않는다.
- 의심 A~D를 고칠 때는 먼저 그 행이 고치기 전 코드에서 실패하는 것을 확인하고 보고에 적는다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.

## 정한 것

- aux 줄(요약, 제목)은 만들지 않는다. 이유: `startTurnLoop`의 model 호출은 `turn.ts`의 judgment 하나뿐이고 요약·제목·압축(organizing)은 loop 밖(`session/compactor.ts`)에서 부른다. loop port에 aux가 닿는 곳이 없다. compact 행이 생기면 그때 더한다. README "brief를 쓰며 바뀐 것"에 적혀 있다.
- 의심 D의 제품 변경은 이 task의 `turn.ts`·`retry.ts`에 둔다. 이유: 연속 partial을 세는 곳은 loop(`turn.ts`의 partial 분기)다. adapter는 한 호출만 안다.
- 끝난 이유는 새 값을 만들지 않고 지금 있는 `model_error`(`LoopFailureReason`)를 쓴다. 이유: 모델이 같은 잘림을 되풀이해 일을 못 하는 것은 "모델 쪽 실패"라는 뜻이 `model_error`와 같다. 사람이 다른 값을 원하면 그 한 줄만 바꾼다.
- 연속 partial은 `PARTIAL_RUN_MAX = 3`이다. 세 번째 partial을 받으면 tool을 시작하지 않고(어차피 partial은 tool을 시작하지 않는다) 곧바로 `model_error`로 끝낸다. 센 값은 complete 응답(답이든 tool 묶음이든)이 오면 0으로 돌아간다. temporary 실패와 그 retry는 세지도 되돌리지도 않는다. 이 값은 제품 동작이라 사람이 바꿀 수 있다. README "정한 것" 6의 추천값이다.
- 위 값을 설정 key(`lophn-agent.run.*`)로 열지 않는다. 상수다.

## 할 일

1. (순서: 3~6의 support와 test를 먼저 만들고, 2번으로 변경 전 실패를 확인한 뒤, 이 변경을 넣는다.) `run-loop/retry.ts`에 `export const PARTIAL_RUN_MAX = 3`을 더하고 `run-loop/turn.ts`의 `LoopState`에 연속 partial 수를 둔다. `runTurn`에서 `step.kind === "partial"` 분기가 수를 올리고 한도면 `failWith(state, "model_error")`로 끝낸다(`checkpoint`와 cut-off 안내 추가는 한도에 닿지 않았을 때만). complete를 받으면 0으로 되돌린다. 근거: README "정한 것" 6, `run-loop` boundary.
2. 3~6을 만든 뒤, 1번의 변경을 넣기 전에 아래 table의 4행(D)을 돌려 **실패하는 것을 확인**하고(변경 전 loop는 세 번째 partial 뒤에도 model을 다시 부른다. scripted queue에는 step이 3개뿐이라 4번째 호출이 queue 초과로 실패하거나 끝난 이유가 `model_error`가 아니다) 그 출력 요약을 보고에 적는다. 그 다음 1번의 변경을 넣어 초록으로 만든다.
3. `tests/support/loop/model.ts`: `scriptedModel(steps)`가 `TurnPorts["model"]`을 낸다.
   - step 종류: `answer(text, usage?)`, `tools(calls: {id, name, args: string}[], text?)`(complete + tool), `partial({text?, finish_reason?, calls?})`(partial. `calls`는 실제 adapter가 내지 않는 모양이지만 loop가 무시하는지 보려고 허용한다), `failed({code, retry_at?})`(`code`는 `temporary|credential_unavailable|model_unavailable|context_exceeded|invalid_request|unknown|refused`), `hang()`(signal이 abort될 때만 `cancelled` outcome으로 돌아온다).
   - queue는 엄격하다. `finish()`를 부르면 남은 step이 있을 때, 호출이 step보다 더 오면(그 호출은 오류 `Result`로 돌려주고 기록한다) 실패한다.
   - 받은 `ModelCallRequest`를 깊은 복사로 기록한다(`requests`). 접근자는 `toolNames(i)`, `systemText(i)`, `lastToolResult(i)`, `userTexts(i)` 정도만 둔다.
   - `arrived(n)`: n번째 호출이 들어온 때 풀리는 promise. 무응답 중 멈춤을 재울 때 쓴다(sleep 대신).
   - `pack`은 `{body: request, opaque_bytes: 0}`를 내는 단순 packer다. `available()`은 켜고 끌 수 있다.
4. `tests/support/loop/harness.ts`: `loopHarness({steps, tools, limits?, answerReads?})`가 나머지 `TurnPorts` 일곱(stop, inputs, context, tools, checkpoint, answer, finish)과 `LoopDeps`를 꾸며 `{run(): handle, done, model, clock, waits, answers, finishes, checkpoints}`를 낸다.
   - `clock`은 `manualClock`, `wait(ms, signal)`은 요청한 ms를 `waits`에 기록하고 즉시 `"elapsed"`(signal이 먼저 중단되면 `"aborted"`), `deadline`은 test가 풀 수 있는 promise(`fireDeadline()`), `random`은 0.5(tool retry 대기가 정확히 1000ms), `abortGraceMs`는 작게.
   - `inputs()`는 `{request: "go", steering: []}`, `stop()`은 `{stopped:false}`(멈춤은 `handle.stop(reason)`으로 건다), `context()`는 작은 `TurnContext`(role prompt 글 한 줄, tool 목록은 harness tool 이름, 빈 지침·skill·place). `finish()`는 받은 `FinishRequest`를 기록하고 `{finished: true}`.
   - tools: `HarnessTool = {name, effect: "read"|"write"|"external", run(args): {status, code, summary}}` 목록을 받아 `ToolPort`를 만든다. `info`는 effect를, `attempt`는 `run`을 부르고 `ToolDone`(`tool_call` id, status, code, `ToolResult` 모양은 `protocol/lophn-agent` 쪽)을 낸다. `close`는 `not_executed`/`failure` `ToolDone`을 만든다. 쓰기 tool `write_file`은 임시 폴더에 진짜 file을 쓴다(실행 여부를 disk로 본다). `unavailable`을 내는 tool은 호출 횟수를 센다.
5. `tests/support/loop/invariants.ts`: `assertRequestInvariants(requests)`. 기록한 모든 요청에서 (a) 대화의 `tool_use` id와 `tool_result` id가 짝이다(결과 없는 tool_use, 호출 없는 결과가 없다), (b) 다음 요청의 대화는 앞 요청의 대화를 접두로 가진다. 모든 table 행 끝에서 부른다.
6. `tests/harness/loop/loop_test.ts`: 준비(임시 폴더)는 file당 한 번, 아래 table을 한 줄씩 돈다. 행마다 새 `loopHarness`다. 아래 "바깥 결과"가 단정이다(행당 3 이하).

| # | 규칙 | scripted model이 내는 것 | 바깥 결과(단정) |
|---|---|---|---|
| 1 | 기본 | `answer("hi")` | `LoopEnd`가 finished/completed(`answer_completed`). model 호출 1. `answers == ["hi"]` |
| 2 | 기본 | `tools([read_file t1])` → `answer` | 읽기 tool 실행 1번. 2번째 요청의 `lastToolResult`에 t1 결과가 있다. 호출 2. 끝 completed |
| 3 | 1 | `partial({calls:[write_file a.md], finish_reason:"max_tokens"})` → `answer` | `a.md`가 disk에 없다. 2번째 요청의 대화 끝에 user 글이 하나 더 붙고 그 글에 `max_tokens`가 들어 있다(문구 전체는 단정하지 않는다). tool_result는 없다. 끝 completed |
| 4 | 3(D) | `partial` ×3 (그중 하나는 `write_file` 포함) | 끝 failed/`model_error`. 호출 3(30이 아니다). tool 실행 0. `facts.unexecuted` 비어 있다 |
| 4b | 3(D) | `partial`, `partial`, `tools([read_file])`, `partial`, `partial`, `answer` | 끝 completed. 호출 6. **예외: 대답 6개**(complete가 연속 수를 되돌리는 것은 이 길이가 아니면 안 보인다). 이 한 행만 규칙을 넘는다 |
| 5 | 3 | `hang()` + `limits.stall_ms`를 작게, test가 clock을 `stall_ms`만큼 가게 한 뒤 `fireDeadline()` | 끝 failed/`stall_limit`. model이 abort를 봤다(signal.aborted). 호출 1 |
| 6 | 4 | `hang()`, `await model.arrived(1)` 뒤 `handle.stop("user_stopped")` | `LoopEnd`가 stopped(`user_stopped`). model이 abort를 봤다. `finishes`가 비어 있다(core가 이미 닫는다) |
| 7 | 2 | `tools([write_file])`(tool이 `unavailable` 실패) → `answer` | write 실행 정확히 1번(retry 없음). `finishes[0].facts.changes` 비어 있다. 2번째 요청에 그 id의 tool_result가 있다 |
| 8 | 2 | `tools([read_file])`(tool이 늘 `unavailable`) → `answer` | read 실행 정확히 2번(처음 + retry 1). `waits`에 1000이 한 번. 끝 completed |
| 9 | 5 | `failed(temporary)`, `failed(temporary)`, `answer` | 호출 3. `waits == [2000, 4000]`. 둘째·셋째 요청이 `kind:"retry"`이고 `retry_of`가 앞 시도 id. 요청의 prompt가 첫 요청과 같다. 끝 completed |
| 10 | 5 | `failed(temporary)` ×3 | 호출 3. `waits == [2000, 4000]`. 끝 failed/`model_error` |
| 11 | 5 | `failed(temporary, retry_at = clock.now() + 10초)`, `answer` | `waits == [10000]`. 호출 2. 끝 completed |
| 12 | 5 | `failed(credential_unavailable)` / `failed(refused)` / `failed(context_exceeded)` / `failed(unknown)` 각각 따로 | 호출 1, `waits` 비어 있다. 끝난 이유가 각각 `configuration_unavailable` / `model_error` / `context_limit` / `model_error` |

   (규칙 번호는 roadmap "첫 case": 1 불완전한 대답의 tool은 실행하지 않는다, 2 쓰기 tool은 자동 retry하지 않는다, 3 되풀이는 반드시 끝난다, 4 멈춤은 진행 중인 요청을 끊는다, 5 오류 종류가 retry 여부를 맞게 가른다.)
7. test 머리 주석에 세 질문의 답을 한 줄씩 남긴다.
8. 의심 C의 "호출당 idle timeout"은 이 task가 아니다. 이유: 그 변경은 `providers/invoke.ts`(model 호출 하나의 HTTP 실행)에 들어가 loop는 `temporary` 실패로만 본다(table 10행이 이미 본다). `harness-wire-idle` task다.

## 세 질문

- contract: boundary ID `run-loop`(retry 한도, 한도 도달, 멈춤, 불완전 응답의 tool 미실행). 규칙 5는 `models`(provider 실패 종류)와 맞물린다.
- 현실적 회귀: partial의 tool을 실행하는 수정, 쓰기 tool에 retry를 붙이는 수정, 한도 계산을 건드려 되풀이가 끝나지 않는 수정, `stop()`이 진행 중인 요청을 끊지 않는 수정. D는 지금 같은 partial을 30번 부르는 실제 동작이다.
- 왜 지금 test로 못 잡나: `run-loop/`에는 `history`·`inbox`·`input-text`·`untrusted` 단위 test뿐이고 loop를 돌리는 test가 없다.

## 끝남

- `deno task check`가 통과한다.
- `deno fmt --check tests`, `deno lint tests`, `deno check <내가 만든 tests/ file>`이 통과한다(이 worktree에 test-tasks가 아직 없으면 fast check는 `tests/`를 보지 않는다. 그래서 직접 돌린다).
- `deno test --no-check --allow-all tests/harness/loop`가 통과하고 5초 안에 끝난다.
- 의심 D: table 4행이 변경 전 코드에서 실패하는 것을 확인했고(출력 요약을 보고에 적는다) 변경 뒤 통과한다.
- 위험 test: "같은 잘림이 되풀이되면 3번째에서 끝나고, partial의 쓰기 tool은 실행되지 않는다"
- 남지 않음: `grep -rn "aux" tests/support/loop tests/harness/loop`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

