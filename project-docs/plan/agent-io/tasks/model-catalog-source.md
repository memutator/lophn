# model-catalog-source

models.dev의 `api.json`을 lophn catalog 항목으로 바꾸는 함수 하나를 두고, 실행 때 갱신(`parseCatalogBody`)과 build 때 snapshot 만들기(`tools/models-snapshot.ts`)가 같은 함수를 쓰게 한다. 손으로 쓴 `snapshot.json` 4개를 그 script의 결과로 바꾼다.

- 단위: model-catalog (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/models/adapters/models-dev.ts`
  - `packages/core/lophn-agent/models/adapters/models-dev_test.ts`(새로 만든다)
  - `packages/core/lophn-agent/models/snapshot.json`
  - `tools/models-snapshot.ts`(새로 만든다)
- 읽을 것:
  - 계획: `project-docs/plan/agent-io/README.md`의 정한 것 5(사람: OpenCode 꼴), 6
  - 이슈: `project-docs/issues/agent-definition.md`의 "model catalog가 models.dev에서 갱신되지 않고…"
  - 지금 꼴: `packages/core/lophn-agent/models/model.ts`(`CatalogEntry`, `LAYER_ORDER`), `snapshot.json`의 지금 항목 4개(목표 꼴의 본보기), `snapshot-catalog.ts`, `work.ts`의 `validateCatalogBody` 뒤 항목 검증, `options.ts`·`wire.ts`(option 축과 wire 번역), `resolve.ts`(catalog를 어디에 쓰나: 한도, option, 이미지 지원)
  - provider 정의: `protocol/lophn-agent`의 내장 provider 정의 7개(`anthropic`, `openai`, `xai`, `openrouter`, `groq`, `deepseek`, `google-gemini`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `models`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `tools`
  - test: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `https://models.dev/api.json`(key 없는 공개 GET). 꼴은 `{ <provider id>: { id, name, models: { <model id>: { limit{context,input?,output}, modalities{input,output}, tool_call, reasoning, reasoning_options[], cost, … } } } }`이다(2026-10-17에 받은 판: provider 232개).
  - 내놓는 것: `parseCatalogBody(body)`가 models.dev 응답을 받아 lophn `CatalogEntry` 꼴의 배열을 돌려준다(이름은 그대로 두거나 바꾸면 `work.ts`·`mod.ts`의 import를 "넘길 줄"로 적는다). 같은 file에서 순수 함수 `modelsDevEntries(apiJson: unknown): Result<unknown[]>`를 export해 script가 쓴다.

## 할 일

1. `adapters/models-dev.ts`에 변환 함수를 둔다. 근거: 실행 때 갱신이 지금 `api.json`을 항목 배열로 읽어 늘 `invalid_input`으로 실패한다(planner가 실제 응답으로 확인. 응답은 object다).
   - provider 대응표: lophn 정의 key → models.dev provider id. `google-gemini` → `google`, 나머지 여섯은 이름이 같다. 표에 없는 models.dev provider는 버린다.
   - 칸 대응: `limit.context` → `context_limit`, `limit.input` → `input_limit`(없으면 null), `limit.output` → `output_limit`, `tool_call` → `supports_tools`, `modalities.input/output` → `input_media`/`output_media`(lophn이 아는 값만), `reasoning`·`reasoning_options` → option 축, `cost` → `price_basis`(지금 꼴에 맞춰), `source: "models_dev"`.
   - option 축은 지금 `snapshot.json`의 4개 항목이 가진 축과 값(예: openai `gpt-5`의 `effort` minimal/low/medium/high, anthropic의 thinking 예산 축)이 **변환 결과에서 그대로 나오게** 규칙을 정한다. 규칙을 못 정하는 꼴(모르는 `reasoning_options.type`)은 option 없이(`options: null`) 둔다. 정한 규칙은 brief의 보고 "정한 것"에 적는다.
   - 한도가 0이거나 없는 model, text 입력·출력이 없는 model은 버린다.
2. `parseCatalogBody`가 이 변환을 거친 배열을 돌려주게 한다. `work.ts`의 뒤쪽 항목 검증은 그대로 탄다.
3. `tools/models-snapshot.ts`: `api.json`을 받아(또는 `--from <file>`로 읽어) `modelsDevEntries`로 바꾸고 `packages/core/lophn-agent/models/snapshot.json`에 쓴다. 정렬해 결과가 결정적이게 한다. models.dev에 없는 정의(예: 지금 snapshot의 `ollama` 항목)는 지금 `snapshot.json`의 그 항목을 그대로 옮긴다. 실행: `deno run --allow-net=models.dev --allow-read --allow-write tools/models-snapshot.ts`. 머리 주석에 "판을 낼 때 돌린다"를 쓴다.
4. script를 한 번 돌려 `snapshot.json`을 새로 만든다. 지금 4개 항목이 새 결과 안에서 같은 값(한도는 models.dev 값이 다르면 models.dev 값)으로 남는지 본다.
5. `deno task check`로 `snapshot-catalog.ts`의 JSON import와 `work.ts`의 snapshot 읽기가 그대로 도는지 본다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "models.dev 꼴 응답(작은 fixture)이 lophn 항목으로 바뀌고, 지금 snapshot 4개 항목의 option 축이 그대로 나온다"(`models-dev_test.ts`, network 없음).
- 남지 않음: `parseCatalogBody`가 배열 응답만 받는 길.
- 새 E2E·subprocess·서버 test를 쓰지 않는다. 실제 model provider를 부르지 않는다(models.dev는 provider가 아닌 공개 catalog다). core를 띄워 손으로 확인하지 않는다(확인은 unit test와 `deno task check`까지).

## 지켜야 할 것(계획 README에서 그대로)

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.
- protocol을 바꾸면 쓰는 쪽(shell, coding agent CLI)을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- secret 값은 보호 메모리와 전송 직전 attach 밖으로 나가지 않는다(log, event, ledger, model 입력 금지).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `deno.json` task로 올릴지(올리지 않아도 된다)
- 안 쓰게 된 export
- 정한 것: option 축 대응 규칙, 버린 model의 기준, 새 snapshot의 항목 수
- 넘길 줄: `work.ts`·`mod.ts`에 맞춘 곳(`model-catalog` task의 소유다)
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
