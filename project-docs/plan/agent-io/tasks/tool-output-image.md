# tool-output-image

한 turn 안의 history에서 오래된 이미지 조각(`tool_result_image`)을 빼고 짝이던 `tool_result` 글 끝에 `[image omitted]`를 붙인다. 최신 이미지 둘만 model 요청에 실려서, 이미지를 여러 번 읽는 turn에서 `model_call_input` blob이 16 MiB 상한(`storage/blobs/child-prepare.ts`)을 넘지 않는다. 또 입력 예산(`measureWire`)이 이미지 base64를 byte로 세지 않고 이미지 하나당 고정 token 값으로 세게 해서, 보통 크기 screenshot 하나로 `context_limit`이 나지 않게 한다.

- 단위: tool-output (wave 1)
- 선행: tool-output-untrusted. 둘 다 `run-loop/history.ts`를 고친다(untrusted는 import 줄 하나). 그쪽이 merge된 뒤 시작한다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/history.ts`
  - `packages/core/lophn-agent/run-loop/history_test.ts`(새로 만든다)
  - `packages/core/lophn-agent/run-loop/turn.ts`(`historyOf` 한 곳)
  - `packages/core/lophn-agent/prompt-assembly/budget.ts`
  - `packages/core/lophn-agent/prompt-assembly/budget_test.ts`(새로 만든다)
  - `packages/core/lophn-agent/prompt-assembly/turn-prompt.ts`(`measureWire` 호출 한 줄)
  - `packages/core/lophn-agent/session/compactor.ts`(`measureWire` 호출 두 줄)
- 읽을 것:
  - 이슈: `project-docs/issues/agent-definition.md`의 "이미지 tool 결과의 base64가 ledger와 blob에 그대로 쌓인다"(추천: 둘째를 먼저. 계획 README 정한 것 2)
  - architecture: `project-docs/architecture/agent-definition.md`의 "`document.*`를 file tool로 대신한다"(이미지 결과는 `tool_result_image` 조각), "compact는 사람이 부를 때만 한다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `run-loop`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 코드: `prompt-assembly/budget.ts`의 `measureWire`와 그 호출 셋(`turn-prompt.ts` 245번 줄 근처, `session/compactor.ts`의 `summarizeOnce` 두 곳), `run-loop/turn.ts`의 `historyOf`와 `state.history`를 쌓는 곳(`runTurn`의 tool 결과 단계), `models/binding.ts`의 `tool_result_image` 처리(Anthropic은 같은 `tool_use_id`의 `tool_result` 안에 이미지를 합친다), `prompt-assembly/model.ts`의 `HistoryPart`
  - test: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `prompt-assembly/model.ts`의 `HistoryMessage`, `HistoryPart`(`tool_result` / `tool_result_image`는 `id`가 같은 짝이다. 이 type은 고치지 않는다)
  - 내놓는 것: `run-loop/history.ts`의 `omitOldImages(history: readonly HistoryMessage[], keep: number): HistoryMessage[]`와 `KEEP_IMAGES = 2`. 입력을 바꾸지 않고 새 배열을 돌려준다. 같은 입력이면 같은 출력이다. `prompt-assembly/budget.ts`의 `measureWire(pack: WirePack, request: PromptRequest): number`(두 번째 인자를 더한다. 호출 셋이 모두 `PromptRequest`를 이미 쥐고 있다)와 `IMAGE_TOKENS = 4096`.

## 지킬 것(계획 README "지켜야 할 것")

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.
- protocol을 바꾸면 쓰는 쪽(shell, coding agent CLI)을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- secret 값은 보호 메모리와 전송 직전 attach 밖으로 나가지 않는다(log, event, ledger, model 입력 금지).

## 정한 것(코드를 보고 정했다. 바꾸려면 보고에 적는다)

1. **자리: `historyOf`(`run-loop/turn.ts`)가 `state.history`를 이어 붙이는 곳. 순수 함수는 `run-loop/history.ts`.** 이슈는 "compact와 같은 자리"라 했지만 코드는 다르다. 이전 turn의 history는 `sessionMaterial`(`prompt-assembly/summary.ts`)이 text만 만들어서 이미지가 없고, 이미지 조각은 이번 turn의 `state.history`(`historyResultParts`가 쌓는다)에만 있다. compact는 사람이 부를 때만 하고 요약 재료도 text라 그 자리에서는 못 막는다. 매 model call마다 `historyOf`가 새로 조립하므로 거기서 `state.history`에만 `omitOldImages`를 적용한다. `state.history` 자체는 건드리지 않는다(메모리에 원본이 남고, 같은 입력이면 같은 출력이라 prefix가 흔들리지 않는다).
2. **남길 개수: 최신 2개(`KEEP_IMAGES = 2`).** 이미지 하나는 `MAX_IMAGE_BYTES` 5 MiB(`tools/file/image.ts`), base64로 약 6.99 MB다(annotation screenshot은 `ANNOTATION_SCREENSHOT_MAX_BYTES` 2 MiB, 약 2.8 MB). blob 상한은 16 MiB(16.78 MB). 최대 크기 이미지 3개는 20.97 MB라 넘고, 2개는 13.98 MB라 본문 text에 2.8 MB가 남는다. 1개만 두면 앞뒤 화면을 견주는 일(고치기 전/후 screenshot)을 못 한다. 그래서 2다.
3. **omit 표시는 별도 text 조각이 아니라 짝 `tool_result`의 글 끝에 `\n[image omitted]`를 붙인다.** `models/binding.ts`의 Anthropic 번역은 user message 안에서 `tool_result`를 앞에 두고, 이미지를 같은 `tool_use_id`의 `tool_result` 안에 합친다. 이미지 자리에 text 조각을 끼우면 `tool_result` 사이에 text가 들어가 순서가 깨질 수 있다. 짝 `tool_result`가 없는 이미지(방어)는 그냥 뺀다.
4. **입력 예산은 이미지 base64를 byte로 세지 않고 이미지 하나당 `IMAGE_TOKENS = 4096`으로 센다.** `measureWire`는 wire body JSON의 UTF-8 byte를 token 예산과 1:1로 견준다(token 수는 byte 수 이하라는 보수 상한). 이미지에는 이 가정이 맞지 않는다. base64 수백 KB의 screenshot 하나가 200k `input_limit`을 넘겨 blob 상한(16 MiB)보다 먼저 turn을 `context_limit`으로 죽인다. 그래서 `request`의 `tool_result_image` 조각마다, 그 base64가 직렬화한 body에 실제로 들어 있으면(이미지 입력을 못 받는 model은 `IMAGE_OMITTED` 글로 바뀌어 안 들어 있다) base64 길이만큼 빼고 `IMAGE_TOKENS`를 더한다. 4096인 이유: provider별 공식은 쓰지 않는다(가장 단순하게). 알려진 이미지 비용은 대략 Anthropic 약 1.6k token(긴 변 1568 px 안), OpenAI high detail 약 1.1k~1.9k, Gemini tile당 258이라 4096이면 둘 이상 여유가 있는 보수 값이다. 남기는 이미지가 최대 2개(`KEEP_IMAGES`)라 이미지로 쓰는 예산은 8192 token 안이다. `session/compactor.ts`도 같은 `measureWire`를 쓰지만 compact 요약 요청(`compactSummaryRequest`)은 text뿐이라 값은 달라지지 않는다. 두 번째 인자를 필수로 받아 이 함수를 쓰는 곳이 이미지를 빠뜨리지 않게 한다.
5. **`tool_calls.result`와 `tool_call_output` blob의 base64는 이 task에서 건드리지 않는다.** 계획 README 정한 것 2. 이슈의 첫째 길(metadata만 남기기)은 실제로 막히면 한다.

## 할 일

근거: 이슈 "이미지 tool 결과의 base64가…" 영향 절과, 코드에서 찾은 `measureWire`의 byte=token 가정(정한 것 4. planner가 이 task에서 고치기로 했다). 이미지 여러 개가 history에 있으면 요청 body 전체를 저장하는 `model_call_input` blob이 model call마다 커지고, 16 MiB를 넘으면 `core-ports.ts`가 그 model call을 보내지 못한다.

1. `run-loop/history.ts`에 `KEEP_IMAGES = 2`와 `omitOldImages`를 더한다. `history` 전체를 앞에서 뒤로 훑어 `tool_result_image` 조각의 순서를 센다. 뒤에서 `keep`개를 넘는 오래된 것은 그 조각을 빼고, 같은 `id`의 `tool_result` 조각의 `text` 끝에 `\n[image omitted]`를 붙인 새 조각으로 바꾼다. 나머지 message·조각은 그대로(같은 객체를 써도 된다)다. `keep`보다 이미지가 적으면 입력과 같은 내용을 돌려준다.
2. `run-loop/turn.ts`의 `historyOf`에서 `for (const message of state.history)`를 `omitOldImages(state.history, KEEP_IMAGES)`를 훑게 바꾼다. 이 한 곳만 고친다. `runTurn`의 쌓는 단계(`state.history.push`)는 그대로다.
3. `run-loop/history.ts` 위 주석("이미지는 text에 base64로 싣지 않고 tool_result_image 조각으로 따로 싣는다")에 "오래된 이미지는 `omitOldImages`가 뺀다. 요청 body 전체를 blob으로 저장하므로 이미지가 쌓이면 상한을 넘는다"는 왜를 한 줄 더한다.
4. `prompt-assembly/budget.ts`: `IMAGE_TOKENS = 4096`을 두고 `measureWire(pack, request)`로 바꾼다. `JSON.stringify(pack.body)`를 한 번 만들고, `request.messages`의 `tool_result_image` 조각마다 `json.includes(part.data_base64)`이면 UTF-8 byte로 센 base64 길이를 빼고 `IMAGE_TOKENS`를 더한다(base64는 ASCII라 글자 수가 byte 수다). 반환은 `bytes(json) - 뺀 것 + 더한 것 + pack.opaque_bytes`. 위 "정한 것 4"의 이유를 주석 한 줄("왜")로 남긴다.
5. 호출을 맞춘다: `prompt-assembly/turn-prompt.ts`의 `measureWire(deps.pack(request))`는 `deps.pack`을 한 번만 부르고 `measureWire(packed, request)`로, `session/compactor.ts`의 `summarizeOnce` 두 곳은 `measureWire(packed, prompt)`로 한다. `prompt-assembly/mod.ts`는 이미 `measureWire`를 내보내므로 고치지 않는다. `grep -rn "measureWire" packages`로 위 셋 말고 부르는 곳이 없음을 다시 확인한다(지금은 없다).
6. 이미 있는 `run-loop/mod.ts`의 `historyResultParts` export는 그대로 둔다. `omitOldImages`는 `turn.ts`가 `./history.ts`에서 직접 import하므로 `mod.ts`를 고치지 않는다(`mod.ts`는 `tool-output-untrusted`가 고친다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test 둘:
  - "이미지 하나가 있어도 예산은 base64 길이가 아니라 고정 값으로 는다". `prompt-assembly/budget_test.ts`에 하나, 순수 함수에. 이미지 없는 요청의 `measureWire` 값 + (`IMAGE_TOKENS` ± body 모양에 따른 작은 차)와 비교한다. base64를 10배로 늘려도 값이 같고, 이미지 입력을 못 받아 body에 base64가 없으면 `IMAGE_TOKENS`가 더해지지 않는다. 이 규칙이 틀리면 이미지를 연 session이 `context_limit`으로 막힌다.
  - "이미지 조각이 2개를 넘으면 오래된 것부터 빠지고 짝 tool_result 글에 `[image omitted]`가 붙으며, 최신 2개와 tool_use·tool_result 짝은 그대로다". `run-loop/history_test.ts`에 하나, 순수 함수에 표로(이미지 0·2·3·5개). 이 규칙이 틀리면 이미지를 연 session이 blob 상한으로 진행하지 못하므로 쓴다. 입력 배열을 바꾸지 않았음도 같은 test에서 한 번 본다. 새 E2E·subprocess·서버 test는 쓰지 않는다.
- 남지 않음: 없음(지울 옛 이름이 없다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 위에서 정한 것을 바꿨으면 이유와 함께
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 아래는 이 task가 일부러 안 한다. 맞는지만 확인해서 적는다.
  - ledger의 `tool_calls.result`와 `tool_call_output` blob에는 base64가 그대로 쌓인다(이슈의 첫째 길, 막히면 한다).
