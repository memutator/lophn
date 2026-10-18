# ev-provider

`.env`의 Anthropic key를 읽어 새 data root에 진짜 provider를 붙이고, 시나리오의 `real` 참가자에게만 model을 붙인다. 나머지 참가자는 model이 없어 turn이 시작되지 않는다(`model_required`). 비용 장치로 core 설정 `lophn-agent.run.model_attempts`를 낮춘다.

- 단위: ev-provider (wave 2)
- 선행: ev-contract
- 소유(이 task만 고친다):
  - `tests/eval/provider/**`
- 읽을 것:
  - 이 계획: `project-docs/plan/eval-base/README.md`(자리, 정한 것), `project-docs/products/roadmap/eval.md`의 "참가자"(`real`에 없는 agent는 `model_required`), "지켜야 할 것"(core는 env를 비우고 key는 runner가 `secrets/put`으로 넣는다), "정한 것"(core의 provider는 API key만, 비용 장치)
  - architecture: `project-docs/architecture/agent-definition.md`(model 층: 전역 → project → agent → session, provider credential은 `secrets.json`의 `provider.<id>`), `project-docs/architecture/testing.md`(`tests/support/core`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `models`, `agents`, `secrets`; `project-docs/module-catalog.yaml`의 `tests`
  - 본보기(import해서 쓴다): `tests/support/core/mod.ts`의 `Core`(`call`, `tryCall`, `upload`, `ids`, `run`), `tests/support/core/human.ts`의 `settle`, `tests/support/core/process.ts`의 `runtimePids`
  - 본보기(읽고 같은 순서로 쓴다):
    - `tests/support/core/human.ts`의 `connectFakeProvider`: key 올리기 → `connectProvider` → runtime이 다시 뜰 때까지 `settle`
    - `packages/shell/renderer/desktop/settings/providers/core-source.ts`의 `routeOf`·`connectWithKey`: 제품이 내장 Anthropic 정의로 연결하는 길(endpoint는 정의의 `models_endpoint`에서 `/models`를 뗀 값, protocol은 정의의 첫 protocol, secret 이름은 `provider.<id의 pvd_ 뒤>`)
    - `tests/live/root.ts`: 같은 설정 key를 `bootCore({ settings })`로 넣는 본보기
- 계약:
  - 쓰는 것:
    - `tests/support/core/mod.ts`의 `bootCore(run, { settings })`가 settings를 받는다(root에 `settings.json`이 아직 없을 때만 쓴다). 이 task는 settings 값만 내놓고 core를 띄우지 않는다.
    - protocol(고정 route, 사람 자격): `connectProvider`, `providerDefinitions`, `modelDefaultRead`(`packages/protocol/lophn-agent/providers.ts`, `models.ts`), `agentDefinitionRead`, `builtinAgentChange`, `operatorChange`(`packages/protocol/lophn-agent/agent-definitions.ts`), 값 type `AgentRef`(`places.ts`), `ModelChoice`(`models.ts`)
    - `tests/eval/types.ts`는 쓰지 않는다. 입력은 이미 풀린 `AgentRef` 목록이다. 시나리오의 `real`(Participant)을 `AgentRef`로 푸는 일은 ev-runner가 `WorldIds`(`tests/eval/types.ts`, 이름 키: 앱은 app.name, project는 project.name, Operator는 name)와 ev-restore의 `agentRefOf`로 한다.
  - 내놓는 것(ev-runner가 기댄다), `tests/eval/provider/mod.ts`:
    - `readAnthropicKey(env: { get(name: string): string | undefined }): string | undefined`: `ANTHROPIC_API_KEY`를 읽고, 없거나 공백뿐이면 `undefined`.
    - `evalCoreSettings(): Record<string, unknown>`: `bootCore(run, { settings: evalCoreSettings() })`에 넣는 값. `{ "lophn-agent.run.model_attempts": EVAL_MODEL_ATTEMPTS }`. `EVAL_MODEL_ATTEMPTS`도 export한다.
    - `attachRealModels(core: Core, input: { key: string; model: string; real: AgentRef[]; endpoint?: string }): Promise<{ provider: string; model: ModelChoice }>`: 아래 "할 일" 3. `endpoint`는 임시 확인에서 loopback fake를 가리킬 때만 준다. 평소에는 안 준다.
  - 기대하는 상태(ev-restore가 보장한다): `attachRealModels`를 부를 때 전역 기본 model은 `null`이다(`endRestore`가 되돌린다). 아니면 이 task는 던진다.

## 할 일

근거: `project-docs/architecture/agent-definition.md`("model을 고르는 세 자리", "provider credential"), `packages/core/lophn-agent/agents/resolve.ts`의 `resolveAgent`(model은 session → agent → project → 전역 순서의 첫 값이고, 어느 층에도 없으면 turn이 `model_required`로 시작하지 못한다).

1. **key** (`key.ts`): `readAnthropicKey`. 값은 이 task 안에서 로그, 오류 message, 반환 객체에 넣지 않는다.
2. **설정** (`settings.ts`): `EVAL_MODEL_ATTEMPTS = 15`와 `evalCoreSettings()`. 설정 key는 문자열 `"lophn-agent.run.model_attempts"`를 그대로 쓴다(core의 `TURN_LIMIT_SETTING_KEYS`를 import하지 않는다. variant checkout의 core 코드에 eval이 기대지 않게 한다). 이유: model 호출 한 turn의 기본 한도 30은 판단 case에 너무 넉넉하다. 판단 case는 turn 하나에 호출이 4~6번이다. 15는 도는 turn이 돈을 계속 쓰는 것을 막는 상한이다.
3. **붙이기** (`attach.ts`) `attachRealModels`, 이 순서로:
   1. `modelDefaultRead`가 `null`이 아니면 던진다(전역 기본이 남아 있으면 `real`이 아닌 참가자도 model을 받아 비용과 채점이 틀어진다).
   2. `providerDefinitions`를 읽어 key가 `anthropic`인 내장 정의를 찾는다. endpoint는 `input.endpoint ?? models_endpoint에서 "/models"를 뗀 값`(`https://api.anthropic.com/v1`), protocol은 정의의 첫 protocol(`anthropic-messages`).
   3. `runtimePids`로 앞 pid를 잡고, provider id `core.ids.newId("pvd")`, secret 이름 `provider.${id.slice("pvd_".length)}`로 `core.upload(secret, new TextEncoder().encode(key))`. 실패하면 오류 code만 담아 던진다(key는 안 담는다). 그 뒤 `connectProvider({ id, name: "anthropic", definition, endpoint, protocol, auth_kind: "api_key", credential: { secret } })`. provider 목적지가 새로 생기면 core가 agent runtime을 새 권한으로 다시 띄우므로 `settle(core, before)`를 기다린다(`connectFakeProvider`와 같다).
   4. `model: ModelChoice = { provider: id, model_name: input.model, option_values: {} }`.
   5. `input.real`의 각 `AgentRef`에 agent 층 model을 붙인다. 먼저 `agentDefinitionRead({ agent })`로 지금 정의와 `hash`(파일이 없으면 `null`)를 읽고, 정의 전체를 다시 쓴다(정의는 파일 전체의 새 내용이라 읽은 칸을 그대로 두고 `model`만 바꾼다. `body`는 필수라 정의가 없으면 `""`).
      - `lophn`, `project_manager`, `app_engineer`: `builtinAgentChange({ agent, definition: { model, skills_off?, mcp_off?, body } }, { hash })`
      - `operator`: `operatorChange({ agent: ref.agent, definition: { ...읽은 definition, model } }, { hash })`(Operator는 정의가 있어야 agent다. 없으면 던진다).
   6. `settle(core)`로 runtime이 ready인지 확인한 뒤 `{ provider: id, model }`을 돌려준다.
   - `real`에 없는 참가자에는 아무것도 하지 않는다. 전역도 project 층도 비어 있으므로 그들의 turn은 `failed / configuration_unavailable`로 끝나고 provider를 부르지 않는다. 이것이 "call을 받아도 그쪽 비용은 0"의 근거다.
4. `mod.ts`에서 위 셋(`readAnthropicKey`, `evalCoreSettings`/`EVAL_MODEL_ATTEMPTS`, `attachRealModels`)을 export한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 이유: 이 task의 위험(`real`이 아닌 참가자가 model을 받는 것)은 core를 띄워야 보이고, core를 띄우는 test는 새로 만들기 전에 사람에게 묻는다. key가 ledger, log, model 입력에 새지 않는 것은 제품의 secret 경계가 지키고 `tests/e2e/secret_test.ts`가 이미 본다.
- 대신 임시 script(scratchpad, commit하지 않는다)로 한 번 확인한다. fake server만 쓰고 진짜 provider는 부르지 않는다:
  1. `createRun` → `bootCore(run, { settings: evalCoreSettings() })`, `startFakeServer()`를 띄운다(fake는 `/messages`를 말하는 loopback이다).
  2. `attachRealModels(core, { key: "test-key", model: "claude-sonnet-5-5", real: [{ role: "lophn" }], endpoint: fake.url })`.
  3. lophn session과 `projectApi.register`로 만든 project의 PM session에 각각 `say`한 뒤 `waitTurnEnd`. 기대: lophn turn은 fake에 요청 1개 이상(요청 header에 `x-api-key`가 `test-key`)을 보내고 끝나며, PM turn은 `outcome`이 `{ kind: "failed", reason: "configuration_unavailable" }`이고 그 사이 fake에 PM의 요청이 없다(`fake.journal()`의 요청 수가 lophn 것뿐).
  4. Operator를 `real`에 둔 경우(`operatorCreate`로 만든 것)와 App Engineer(`appCreate`로 등록한 앱)도 한 번씩 붙어 turn이 fake에 닿는지 본다.
  - 이 script를 `tests/e2e`의 정식 test로 올리자는 제안은 보고에 적는다. 올리는 일은 사람이 허락한다.
- 주석과 test 이름에 task id·요구 ID를 쓰지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`deno.json`의 `eval` task는 lead가 한다)
- 안 쓰게 된 export: 없음
- 정한 것: `EVAL_MODEL_ATTEMPTS` 값과 이유, 임시 확인에서 본 것(특히 `x-api-key` header, `configuration_unavailable` 확인 결과)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 없으면 "없음". ev-runner에게 알릴 것: `real`이 아닌 참가자의 turn은 `failed / configuration_unavailable`로 끝나는 것이 정상이다(오류가 아니다).
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음". 구독 OAuth provider와 OpenAI 등 다른 provider는 이 계획 밖이다(API key만).
