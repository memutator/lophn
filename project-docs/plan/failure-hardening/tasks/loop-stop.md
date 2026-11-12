# loop-stop

사람이 Stop한 turn의 마지막 tool round를 이력에 남겨 다음 turn의 model이 방금 한 일을 알게 하고, provider가 거절한 image를 이력에서 빼고 한 번 다시 보낸다.

- 단위: loop (wave 2)
- 선행: loop-turn, provider-failures. 둘이 `turn.ts`·`core-ports.ts`·`failures.ts`를 먼저 고친다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/{turn,loop,commands,core-ports}.ts`
  - `packages/core/lophn-agent/run-loop/harness-turn_test.ts`
  - `packages/core/lophn-agent/providers/failures.ts`
  - `packages/protocol/lophn-agent/provider-values.ts`
  - `packages/protocol/lophn-agent/turns.ts`(`checkpointTurn` 출력의 `state`만)
  - `tests/harness/loop/loop_test.ts`
  - `tests/support/loop/{harness,model}.ts`
  - `tests/harness/wire/http_test.ts`
- 읽을 것:
  - 계획 README "정한 것"의 Stop 줄
  - architecture: `project-docs/architecture/agent-definition.md` 지키는 것 42(turn 이력 checkpoint와 다음 turn이 잇는 규칙), 지키는 것 40 아래(provider가 입력이 크다고 거절했을 때 줄여 다시 보내는 규칙)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `run-loop`, `models`. `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - wave 1 `loop-turn`, `provider-failures` 보고(바뀐 `LoopState`·`retry.ts`·`failures.ts` 모양)
- 계약:
  - 쓰는 것: `TurnPorts.checkpoint(elapsed, history)`(`packages/core/lophn-agent/run-loop/ports.ts`, 고치지 않는다), `omitOldImages`·`KEEP_IMAGE_BYTES`(`packages/core/lophn-agent/run-loop/history.ts`, 고치지 않는다).
  - 내놓는 것: `CheckpointTurn`은 사람이 멈춘 turn(`interrupted`/`user_stopped`)에 이력만 싣는 checkpoint를 받는다. 출력 `state`는 `"running" | "finished"`다. 이 route를 쓰는 곳은 `core-ports.ts` 하나다(`grep -rn checkpointTurn packages`로 확인한다).
  - 내놓는 것: `PROVIDER_FAILURES`에 `image_rejected`. model_calls의 `outcome`은 `json_valid`만 보는 JSON 칸이고 실패 code를 CHECK하는 SQL이 없어 migration이 없다. 화면 문구도 없다: 이 code로 turn이 끝나면 지금처럼 `model_error`다.

## 할 일

1. **Stop 뒤 마지막 tool round(loop #26).** 지금 `commands.ts`의 `stop`이 turn 행을 바로 끝내고(`interrupted`), `checkpoint`는 `row.state !== "running"`이면 거절하며, `core-ports.ts`의 `checkpoint`는 행이 running이 아니면 보내지도 않는다. 이력(tool_use·tool_result)은 checkpoint blob에만 남으므로, `file.write` 같은 tool round 도중이나 직후에 Stop하면 그 round가 이력에서 빠지고 다음 turn의 model이 방금 쓴 file을 모르고 다시 쓴다.
   - `commands.ts` `checkpoint`: 행이 `finished`이고 `outcome_kind = 'interrupted'`, `outcome_reason = 'user_stopped'`이며 `input.history`·`history_size`가 있고 compare `state_seq`가 맞으면, 이력 참조(`blob_refs`의 `field = 'history'`)만 지금 코드와 같은 길로 바꾼다. elapsed 칸은 바꾸지 않고 출력의 `elapsed`는 행의 값이다. 같은 session에 이 turn보다 늦게 시작한 turn이 있으면 `conflict`다(다음 turn이 이미 옛 이력을 읽었다). 그 밖의 끝난 turn은 지금처럼 거절한다.
   - `packages/protocol/lophn-agent/turns.ts`: `checkpointTurn` 출력 `state`를 `z.enum(["running", "finished"])`로 넓힌다.
   - `core-ports.ts` `checkpoint`: 읽은 행이 running이거나, finished이면서 `interrupted`/`user_stopped`이면 보낸다. 그 밖에는 지금처럼 보내지 않는다.
   - `turn.ts`·`loop.ts`: loop가 `{kind: "stopped", reason: "user_stopped"}`로 끝날 때 이력을 한 번 남긴다. `turn.ts`에서 `keptHistory`를 쓰는 작은 함수(예: `keepStopped(state)`)를 export하고 `loop.ts`의 `run()`이 그 end를 돌려주기 전에 부른다. `state.history`에 assistant message가 없으면(tool round도 답도 없었다) 보내지 않는다. 결과는 기다리되 실패해도 end는 그대로다.
   - `restarted`·`session_ended`는 하지 않는다: 그때는 loop가 없거나 session이 끝났다.

2. **server가 거절한 image(tools #8).** 지금 provider가 image 크기·꼴을 이유로 요청을 거절하면 분류가 `invalid_request`나 `unknown`이라 `model_error`로 끝나고, image는 이력에 남아 다음 turn도 같은 image를 보내 또 거절된다. `image.read`는 5 MiB만 보고 provider마다 다른 한도(px, 꼴)는 모른다.
   - `provider-values.ts`: `PROVIDER_FAILURES`에 `"image_rejected"`.
   - `failures.ts`: image 거절 문구 목록을 둔다. 예: `/image (exceeds|is too large|dimensions)/i`, `/(invalid|unsupported|could not process) image/i`, 구조화 code `invalid_image`, `invalid_image_format`, `image_parse_error`, `invalid_image_url`. 400·413과 `invalid_request_error`(Anthropic이 image 크기 거절도 이 type으로 보낸다)에서 overflow 문구보다 먼저 보고 맞으면 `image_rejected`다. 문구는 provider 문서나 이미 있는 fixture(`tests/fixtures/provider/`)에서 확인한 것만 넣는다. 확인하지 못한 것은 보고에 적는다.
   - `turn.ts`: `LoopState`에 `dropImages: boolean`(`loop.ts`에서 `false`). `callModel`의 실패 갈래에서 `outcome.code === "image_rejected"`이고 아직 `dropImages`가 꺼져 있고 보낸 요청에 image가 있었으면 `{ kind: "image_rejected" }`(새 `ModelStep`)을 돌려주고, `runTurn`이 `dropImages = true`, `anchor = null`로 하고 `continueTurn`이다. `historyOf`와 `keptHistory`는 `dropImages`면 `omitOldImages(…, 0)`로 모든 image를 고정 글로 바꾼다. image가 없었거나 이미 뺐으면 지금처럼 `failWith(state, failureReason(code))`(`model_error`)다.
   - 다음 turn은 사람이 보낸 image를 session 메시지에서 다시 읽으므로 처음 한 번 거절된 뒤 같은 길로 뺀다. 메시지 자체는 고치지 않는다.

## 정한 것

- Stop 뒤 이력은 새 command가 아니라 `CheckpointTurn`의 갈래다. README가 "멈춘 turn에 이력만 싣는 checkpoint"로 정했고, route·자격 목록(`runtime-access.ts`)·flow를 새로 더하지 않는다.
- "한 번"은 loop가 멈춘 끝에서 한 번 보내는 것과, 다음 turn이 시작한 뒤에는 core가 거절하는 것으로 지킨다. 표에 칸을 더하지 않는다.
- image를 뺄 때는 이 turn의 남은 call 전부와 남기는 이력에서 모두 뺀다. 어느 image가 거절됐는지 provider가 알려 주지 않는다.
- image 거절 뒤 다시 보내기는 `OVERFLOW_RECOVERY_MAX`·일시 retry와 따로 한 번이다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`tests/harness/loop/loop_test.ts` 행으로. harness의 `checkpoint`가 받은 history를 기록하게 고친다):
  - "tool round 도중에 멈춘 turn은 멈춘 뒤 그 round의 tool_use와 결과를 이력으로 한 번 남긴다"
  - "image_rejected면 image를 뺀 같은 요청을 한 번 다시 보내고, image가 없으면 model_error로 끝난다"
- 위험 test(`packages/core/lophn-agent/run-loop/harness-turn_test.ts`의 SQLite setup으로): "멈춘 turn은 이력만 싣는 checkpoint를 받고, 같은 session의 다음 turn이 시작한 뒤에는 거절한다". checkpoint의 blob 등록(`registerPreparedBlob`)이 그 setup의 가짜 context로 돌지 않으면 handler 대신 loop test만 두고 보고에 적는다.
- 위험 test(`tests/harness/wire/http_test.ts`): image 거절 본문 한 행이 `image_rejected`다.
- 남지 않음: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴(바꾼 file, 통과한 check, 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청, **무겁게 짠 것**, **알려진 미완 동작**).

- 등록할 것: lead가 `project-docs/flows/areas/turns.yaml`에 checkpoint 규칙(멈춘 turn의 이력)을, `project-docs/architecture/agent-definition.md` 지키는 것 42에 "Stop한 turn도 마지막 tool round까지 이력으로 남는다"를 고친다.
