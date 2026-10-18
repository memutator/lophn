# ex-assembly

prompt assembly를 바꾼 experiment가 진짜 model을 부르기 전에 prefix 유지를 재게 한다. 녹화한 run의 model 답을 fake provider로 되돌려 주며 variant checkout에서 같은 대화를 다시 돌리고, 요청마다 layer별 cache 경계의 prefix hash가 앞 call과 같은 비율을 baseline(녹화 쪽)과 variant 쪽에서 낸다. 같은 대화로 재생이 안 되면 숫자를 내지 않고 이유를 낸다.

- 단위: ex-assembly (wave 2)
- 선행: ex-spec
- 소유(이 task만 고친다):
  - `tests/eval/experiment/assembly/**`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/eval.md`의 "공통 수치" 끝 단락(assembly를 바꾼 experiment), "지켜야 할 것"(녹화 재생은 판단 재기에는 안 쓰고 조립 재기에만 쓴다)
  - 계획: `project-docs/plan/eval-experiment/README.md`("정한 것"의 assembly의 prefix 재기)
  - architecture: `project-docs/architecture/agent-definition.md`(prompt 조립, cache 경계), `project-docs/architecture/testing.md`(fake server)
  - eval-base: `ev-collect.md`("기대하는 모양"의 `CollectedModelCall.request`, 그리고 `request` body를 data root의 blob file에서 읽는 이유), `ev-runner.md`(trial 순서, full record를 `.dev-data/eval/<run>/trial-<index>.json`에 `{ trial, judge, source }`로 쓴다, trial이 끝나면 `run.remove()`), `ev-provider.md`(`attachRealModels`의 `endpoint`), `ev-restore.md`(`beginRestore`/`endRestore`), `ev-versions.md`("알아 둘 코드 사실"의 Anthropic body 꼴)
  - 코드: `packages/core/lophn-agent/prompt-assembly/turn-prompt.ts`(`assembleTurnPrompt`, `cache_boundaries`의 hash 만드는 법), `packages/core/lophn-agent/prompt-assembly/layers.ts`(`anthropicSystem`, `anthropicTools`), `packages/core/lophn-agent/models/binding.ts`(`anthropicPacker`: wire body는 tools → system → messages이고 system 블록의 `cache_control`이 경계 표시, messages에는 경계 표시가 없다), `packages/core/lophn-agent/run-loop/core-ports.ts`(`modelAttempt`: `context_basis` blob의 내용), `tests/support/fake-server/{mod,types}.ts`(`startFakeServer`, `Reply`, `Step`, `JournalEntry`)
- 계약:
  - 쓰는 것:
    - `tests/eval/experiment/spec/mod.ts`(ex-spec): `type AssemblyReport`, `LayerStat`, `SideStat`.
    - eval-base가 만든 것:
      - `tests/eval/types.ts`: `TrialRecord`, `SessionRecord`, `CollectedModelCall`(`call: ModelCallRecord`, `request: unknown | null`), `Scenario`, `Settle`.
      - `packages/base/mod.ts`: `canonicalize`, `sha256Hex`, `Result`, `ok`, `err`.
      - `tests/support/fake-server/mod.ts`: `startFakeServer`, 그리고 type `FakeServer`, `Reply`, `Step`, `JournalEntry`.
      - `packages/core/lophn-agent/prompt-assembly/mod.ts`(test에서만): `assembleTurnPrompt`, `anthropicSystem`, `anthropicTools`.
  - 내놓는 것(ex-cli가 부른다), `tests/eval/experiment/assembly/mod.ts`:
    - `loadRecordedTrial(dir: string, run: string, index: number): Promise<Result<TrialRecord>>`. `<dir>/<run>/trial-<index>.json`(`{ trial, ... }`)의 `trial`을 읽는다. 없으면 `not_found`.
    - `type ReplayPort = { run(args: { scenario: Scenario; checkout: string | null; model: string; endpoint: string }): Promise<{ settle: Settle }> }`. ex-cli가 구현한다: 새 data root에 `checkout`(null이면 지금 checkout)의 core를 띄우고(ex-variant), `beginRestore` → `restoreWorld` → `scenario.setup` → `endRestore`, `attachRealModels(core, { key: "replay", model, real, endpoint })`로 `real` 참가자의 model이 `endpoint`(fake provider)를 향하게 하고, 시나리오의 `steps`를 runner와 똑같이 돌려 쉴 때까지 기다리고, core를 끄고 root를 지운다. judge와 program check는 돌리지 않는다.
    - `type AssemblyReport`(와 그 안의 `LayerStat`, `SideStat`): 이 task가 정의하지 않는다. ex-spec이 `tests/eval/experiment/spec/`에 정의하고(`ExperimentResult.assembly?: AssemblyReport[]`가 쓴다) 이 task는 거기서 import해 다시 내보낸다. 모양은 아래 코드 블록 그대로다(ex-spec이 이 칸 그대로 옮긴다). `Boundary`는 이 task 안에서만 쓴다.
    - `measureAssembly(deps: { port: ReplayPort; startFake?: () => Promise<FakeServer> }, args: { run: string; trial: TrialRecord; scenario: Scenario; model: string; checkout: string | null }): Promise<AssemblyReport>`. `startFake` 기본은 `startFakeServer`. 던지지 않는다: 재생할 수 없거나 어긋나면 `status`와 `reason`으로 낸다. 포트가 던지면 `status: "not_replayable"`, `reason: "replay failed: <message>"`.
    - `formatAssembly(report: AssemblyReport): string[]`. stdout과 report에 넣을 줄.
    - `prefixBoundaries(body: unknown): Boundary[]`, `scriptOf(trial: TrialRecord): Result<ReplayScript>`. 다른 task가 부르지 않지만 test가 부른다.

```ts
// 아래 셋 가운데 LayerStat, SideStat, AssemblyReport는 ex-spec이 정의한다. 여기는 그 모양이다.
type Boundary = { layer: string; prefix_hash: string; text: string };   // text는 그 system 블록의 글
type LayerStat = {
  layer: string;
  pairs: number;       // 앞 call과 견준 쌍의 수 (calls - 1)
  stable: number;      // 앞 call과 hash가 같은 쌍의 수
  rate: number | null; // stable / pairs. pairs가 0이면 null
  first_break: { call: number; before: string; after: string } | null; // call은 1부터, 처음 깨진 call. before/after는 그 블록 글에서 처음 달라진 줄 160자까지. 층이 없어졌거나 새로 생긴 경우 "(absent)"
};
type SideStat = { calls: number; layers: LayerStat[] };   // layers는 처음 나온 순서
type AssemblyReport = {
  run: string; trial: number; session: string | null;
  status: "ok" | "diverged" | "not_replayable";
  reason: string | null;
  diverged_at: number | null;   // 대화가 처음 어긋난 call 번호(1부터). 이 앞까지만 견준다
  compared_calls: number;
  identical_calls: number;      // variant call k의 경계 hash가 baseline call k와 모두 같은 수
  baseline: SideStat | null;    // 녹화한 요청에서 잰 값
  variant: SideStat | null;     // 다시 조립한 요청에서 잰 값
};
```

## 먼저 정리한 코드 사실(brief를 쓸 때 확인함)

- model call이 `context_basis` blob에 남기는 것은 `{ seen, diff, cache_boundaries, input_budget, measured_tokens }`다(`core-ports.ts`의 `modelAttempt`). `cache_boundaries[].prefix_hash`는 `sha256Hex(canonicalize(tools))`에서 시작해 system 블록마다 ``sha256Hex(`${prefix}\n${block.text}`)``로 이은 값이고, 경계 표시(`cache_control`)가 달린 블록(role, instructions, place. skills는 안 단다)에서만 기록한다(`turn-prompt.ts`).
- **`context_basis`를 읽는 길은 없다.** `ReadTurnBody`(`turnBody`)의 kind는 `turn_basis`, `turn_resolved`, `model_call_output`, `tool_call_output`뿐이고, `blob.read`는 `model_call/context_basis`를 `general_read: false`로 막는다(`packages/core/lophn-agent/usage/commands.ts`). data root의 blob file(`<home>/blobs/sha256/<앞 2자>/<나머지>`)로만 읽히는데, 그 root는 trial이 끝나면 지워지고(`run.remove()`), eval-base의 collect는 `request`만 full record에 남긴다. 그래서 이 task는 `context_basis`를 쓰지 않는다.
- **대신 보낸 요청 body에서 같은 hash를 다시 계산한다.** Anthropic wire body는 `tools`(정렬된 `{name, description, input_schema}`), `system`(`{type:"text", text, cache_control?}` 블록들), `messages`이고, 위 hash 식이 쓰는 입력이 이 `tools`와 `system`뿐이다(`anthropicPacker`는 `boundaries`를 모두 끈다). 그래서 body에서 `canonicalize(body.tools ?? [])`로 시작해 system 블록을 이어 계산하면 `cache_boundaries`와 같은 값이 나온다. fake provider가 받는 body도 같은 wire body라 variant 쪽도 이 함수 하나로 잰다. 제품의 식이 바뀌면 어긋나므로 그 일치를 test로 지킨다(아래).
- **model 답(output)도 full record에 없다.** `CollectedModelCall`에는 `request`뿐이고 root가 지워진다. 대신 call k의 답은 같은 session의 call k+1 요청의 마지막 assistant message에 들어 있다(history에 붙는다). text 조각과 `tool_use`(id, name, input)에서 fake `Reply`를 다시 만든다. 마지막 call의 답은 알 수 없어 `{ kind: "text", text: "done" }`을 준다(그 요청은 이미 재생에서 받으므로 재는 데는 지장이 없다).
- 제품이 보내는 요청에서 경계 표시는 system 블록에만 있다(`final_user`, `tools`는 꺼짐). 그래서 prefix 유지는 system 블록 hash로 충분하고 messages는 재지 않는다.

## 할 일

1. `prefix.ts`: `prefixBoundaries(body)`.
   - `body.tools ?? []`를 `canonicalize`해 `sha256Hex`, 이어 `body.system`(배열)의 블록마다 ``sha256Hex(`${prefix}\n${text}`)``. 블록에 `cache_control`이 있으면 `Boundary`를 낸다. `system`이 문자열이거나 없으면 `[]`.
   - layer 이름은 body만으로 붙인다: 첫 블록 `role`, 글이 `# Instructions`로 시작하면 `instructions`, `# Skills`로 시작하면 `skills`, 그 밖에 마지막 블록은 `place`, 나머지는 `block<i>`. 같은 이름이 둘이면 뒤에 `#2`를 붙인다. 이유: 새 assembly가 층을 더하거나 순서를 바꿔도 이름이 겹치지 않고 어긋남이 보이게 하려는 것이다.
2. `script.ts`: `scriptOf(trial)`. 재생할 수 있는 trial인지 보고 fake에 줄 `Reply`를 만든다. 재생 못 하면 `err({ code: "invalid_input", message: <이유> })`(보고서의 `reason`이 된다). 재생 조건:
   - `trial.settle.kind === "idle"`.
   - model call이 있는 session이 정확히 하나. 이유: 요청에 session을 가르는 값이 없어 fake가 어느 session의 요청인지 모른다. 순서로 줄 세우려면 session 하나여야 한다.
   - 그 session의 모든 model call이 `call.purpose === "judgment"`, `state === "finished"`, `outcome.kind === "complete"`, `attempt_kind === "initial"`이고 `request`가 null이 아니다. 아니면 이유와 call id. 이유: compaction(`conversation_compression`) 요청과 재시도가 끼면 요청 순서가 바뀐다.
   - call이 2개 이상. 하나뿐이면 앞 call과 견줄 것이 없다.
   - 반환 `ReplayScript = { session: string; requests: unknown[]; replies: Reply[] }`. `replies`는 call k(0부터, 마지막 제외)에 대해 `requests[k+1].messages`의 마지막 assistant message에서 만든다: content가 문자열이면 text, 배열이면 `text` 블록을 이은 글과 `tool_use` 블록 `{ id, name, arguments: JSON.stringify(input) }`. `thinking` 블록은 버린다. `tool_use`가 있으면 `{ kind: "tool", calls, text? }`, 없으면 `{ kind: "text", text }`(빈 글이면 `"(empty)"`). 마지막 call은 `{ kind: "text", text: "done" }`.
3. `compare.ts`:
   - `traceOf(body): string[]`: `messages`를 순서대로 훑어 assistant의 `tool_use`는 `use:<name>`, user의 `tool_result`는 `result:ok` 또는 `result:error`(`is_error === true`)로 모은다. 글 message는 넣지 않는다. 이유: assembly를 바꾸면 notice와 message 배치가 달라질 수 있어, 대화가 같은지는 tool 흐름으로만 본다.
   - `firstDivergence(recorded: unknown[], replayed: unknown[]): { at: number; reason: string } | null`: 요청 수가 다르면 `min+1` 번째에서, 아니면 `traceOf`가 처음 다른 call(1부터)에서. 이유 글에 두 trace의 다른 자리를 한 줄로 담는다.
   - `sideStat(calls: Boundary[][]): SideStat`: 위 `LayerStat` 정의대로. 한 call에 어떤 layer가 없으면 그 쌍은 안 같다(깨짐)로 센다.
4. `replay.ts`: `measureAssembly`, 순서:
   1. `scriptOf(trial)` 실패면 `not_replayable` 보고서.
   2. baseline = 녹화한 `requests`에서 `prefixBoundaries`로 잰 `SideStat`.
   3. `fake = await startFake()`, `fake.script(replies.map((reply) => ({ reply })))`. 줄이 모자라면 fake가 400으로 답하고 journal에 `mismatch`가 남는다. 이것이 "더 많은 요청이 왔다"는 어긋남이다. `fallback`은 주지 않는다.
   4. `await port.run({ scenario, checkout, model, endpoint: fake.url })`. `finally`에서 `fake.close()`. `settle.kind === "timeout"`이면 `diverged`로 두되 이유에 timeout을 적는다.
   5. `fake.journal()`에서 요청 body를 순서대로 모은다(`mismatch`가 있는 것도 요청 수에 센다). `firstDivergence`로 `diverged_at`을 정한다. 어긋나면 그 앞 call까지만 견준다.
   6. variant = 다시 조립한 요청에서 잰 `SideStat`(같은 앞 부분까지). `identical_calls`와 `compared_calls`를 채운다.
   7. `status`: 어긋남이 없으면 `ok`, 있으면 `diverged`(`compared_calls`가 2 미만이면 rate는 null이 되고 `reason`에 "견줄 call이 모자란다"를 적는다).
5. `record.ts`: `loadRecordedTrial`. `format.ts`: `formatAssembly`(layer마다 `baseline rate → variant rate`, `first_break`, `diverged`/`not_replayable` 이유). `mod.ts`가 "내놓는 것"을 내보낸다.
6. test(아래).

## 정한 것

- **재는 것은 layer별로 "앞 call과 prefix hash가 같은 쌍의 비율"이다.** 위 `LayerStat.rate`. 가장 깊은 층(보통 `place`)의 rate가 전체 prefix 유지다(hash가 앞 층을 이어 만든 값이라 깊은 층이 같으면 앞 층도 같다). 통과·기각 기준을 두지 않는다. 숫자와 깨진 자리를 낼 뿐이고, 판정은 experimenter가 읽는다. 이유: roadmap이 "어느 layer에서 prefix가 깨지는지 보인다"까지만 정했다.
- **baseline도 녹화한 요청에서 다시 계산한다.** 같은 함수로 양쪽을 재야 견줄 수 있고, 녹화 root가 없어도 된다.
- **재생할 수 있는 trial은 model을 받은 session이 하나인 판단 case다.** 여러 session이 model을 받는 trial과 compaction·재시도가 낀 trial은 `not_replayable`로 이유와 함께 낸다. 이유: 요청에서 session을 가르는 값이 없고, 순서로 줄 세우는 것이 가장 단순하다. 사람이 정할 것이 아니고 첫 experiment에서 얼마나 걸리는지 본 뒤에 넓힌다.
- **대화가 같은지는 tool 흐름(`traceOf`)으로 본다.** message 글은 assembly가 바꾸는 대상이라 같은 기준이 될 수 없다. tool 흐름이 어긋나면 그 앞 call까지만 견주고 `diverged`로 낸다(가짜로 같은 대화인 척 숫자를 내지 않는다).
- **`ReplayPort`는 ex-cli가 구현한다.** 이 task의 소유가 `tests/eval/runner/**`가 아니라서 runner의 trial 순서를 복사하지 않고 포트로 받는다. ex-cli가 runner의 trial 단계를 "model 붙이기"만 갈아 끼울 수 있게 나눠야 한다(`attachRealModels`의 진짜 key 대신 `endpoint`를 준다).
- **진짜 cache hit은 이 task가 재지 않는다.** 그 뒤 작은 진짜 run으로 본다(roadmap).

## 끝남

- `deno task check`가 통과한다. `tests/eval`의 `*_test.ts`는 check에서 돈다. test는 순수하다(core, 서버, 네트워크, subprocess 없음). `measureAssembly`는 core를 띄우므로 test하지 않는다.
- 위험 test(2개):
  - `prefix_test.ts`: "`prefixBoundaries`가 같은 입력에서 제품 `assembleTurnPrompt`가 낸 `cache_boundaries`(layer 이름과 `prefix_hash`)와 같다." `assembleTurnPrompt`에 role, instruction, skills, place가 모두 있는 입력을 주고, `pack`은 `{ body: { model, max_tokens, system: anthropicSystem(request), messages: [], tools: anthropicTools(request) }, opaque_bytes: 0 }`로 넘겨 얻은 body를 `prefixBoundaries`에 먹인다. 제품의 hash 식이 바뀌면 이 task의 숫자가 조용히 틀어지므로 일치를 지킨다.
  - `replay_test.ts`: "`scriptOf`가 다음 요청의 마지막 assistant message에서 답(text, `tool_use`)을 되살리고, model을 받은 session이 둘이거나 compaction·재시도 call이 끼면 이유와 함께 거절하며, `firstDivergence`가 tool 흐름이 처음 다른 call을 짚고, `sideStat`이 prefix가 깨진 call과 layer를 짚는다." 손으로 만든 `TrialRecord`와 body 표.
- 새 subprocess·서버·진짜 provider 호출 test는 없다.
- 남지 않음: `grep -rn "context_basis" tests/eval/experiment/assembly`는 주석에만 나온다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 위 "정한 것" 밖에서 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳(없어야 한다)
- 계약 바꾸기 요청: `AssemblyReport`가 ex-spec과 달라 막히는 곳. `CollectedModelCall`에 `output`을 담게 하면 답을 다음 요청에서 되살리지 않아도 된다(eval-base ev-collect). 필요하면 여기 적는다.
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 재생은 모델이 만든 id(trial 안에서 `app.create` 등이 낸 id)를 뒤 call의 인자에 쓴 trial에서 어긋난다(root마다 id가 달라 tool이 실패한다). 재료의 고정 id(`manifest.ids`)는 같아서 괜찮다. 이 경우 `diverged`로 낸다. session이 둘 이상 model을 받는 trial과 coding agent trial은 재생하지 않는다. `ReplayPort`를 실제 core로 돌려 본 확인은 ex-cli와 lead의 몫이다.
