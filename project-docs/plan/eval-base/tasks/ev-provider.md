# ev-provider

진짜 provider를 product 길로 연결하는 helper와, session마다 model을 정하는 helper, 긴 turn을 기다릴 수 있는 timeout 인자를 `tests/support/core/`에 더한다. 전역 기본 model은 정하지 않는다.

- 단위: ev (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/support/core/human.ts`
  - `tests/support/core/provider.ts`
- 읽을 것:
  - 계획: `project-docs/plan/eval-base/README.md`(정한 것 4·7), `project-docs/products/roadmap/eval.md`의 "지켜야 할 것", "정할 것" 5·8
  - 조사: `project-docs/plan/eval-base/research/infra.md` 2절(Real-provider equivalent 1~6), 3절(model은 role별이 아니라 session > 정의 > project > 전역 순), "What an eval runner needs" 1·6
  - architecture: `project-docs/architecture/testing.md`("`tests/support`", "가짜 셋")
  - 본보기: `tests/support/core/human.ts`의 `connectFakeProvider`, `packages/shell/renderer/desktop/settings/providers/core-source.ts:220-260`(UI가 같은 길을 가는 모양, 실패 때 secret을 지우는 것), `tests/e2e/secret_test.ts`(key가 있는 연결)
  - protocol: `providerDefinitions`, `connectProvider`(`packages/protocol/lophn-agent/providers.ts`, `provider-inputs.ts:54-67`), `changeSessionModel`(`packages/protocol/lophn-agent/sessions.ts:340`, compare는 `{state: "open", state_seq}`), `agentSessionRead`
- 계약:
  - 쓰는 것: 위 route들. `Core.upload`(= `secrets/put`)
  - 내놓는 것:
    - `connectRealProvider(core, { definition: "anthropic" | "openai", key: string, model_name: string, option_values?: Record<string,string>, endpoint?: string }): Promise<{ provider: string; model: ModelChoice }>`. `endpoint`는 `--fake` 모드가 같은 길로 fake server(loopback)를 가리키려고 쓴다. 주지 않으면 정의에서 파생한다.
    - `connectFakeProvider(core, fake, options)`에 선택 인자 `default?: boolean`(기본 true)을 더한다. false면 `modelDefaultChange`를 부르지 않고, 반환에 `model: ModelChoice`(fake 쪽 model)를 더한다.
    - `changeModel(core, session, model: ModelChoice): Promise<void>`
    - `waitTurnEnd(core, session, index?, timeoutMs?)`, `waitPermission(core, session, timeoutMs?)`, `waitQuestion(core, session, timeoutMs?)`에 선택 `timeoutMs`(기본은 지금의 30초)

## 할 일

1. `tests/support/core/provider.ts`에 `connectRealProvider`와 `changeModel`을 쓴다(근거: `infra.md` 2절 Real-provider equivalent).
   - `providerDefinitions`로 정의를 받아 `key`가 같은 것을 고른다. endpoint는 `models_endpoint`에서 끝의 `/models`를 뗀 것, protocol은 `protocols[0]`, `auth_kind: "api_key"`다(UI와 같은 파생).
   - id는 `core.ids.newId("pvd")`, secret 이름은 `provider.<id의 pvd_ 뒤>`다. key는 `core.upload`로만 올린다. core env, 인자 로그, 오류 메시지에 key를 싣지 않는다.
   - 연결 뒤 새 host면 agent runtime child가 다시 뜬다. `connectFakeProvider`처럼 `runtimePids`를 먼저 읽고 `settle`로 기다린다.
   - `connectProvider`가 실패하면 올린 secret을 지운다(UI의 `core-source.ts:255-258`와 같은 route). `modelDefaultChange`는 부르지 않는다. 전역 기본이 없어야 model을 정하지 않은 agent의 turn이 `model_required`로 시작하지 않는다.
   - 반환의 `model`은 `{ provider, model_name, option_values }`다. model이 catalog에 없으면 `changeModel`이 `invalid_input`으로 막는다. 여기서 미리 보지 않는다.
   - `changeModel`은 `agentSessionRead`로 `state_seq`를 읽어 `changeSessionModel`에 compare로 준다.
2. `tests/support/core/human.ts`:
   - `connectFakeProvider`에 `default` 선택 인자를 더한다. 기본 동작은 그대로여야 한다(E2E가 쓴다). 지금 `MODEL_NAME` 상수를 export하지 않고 반환의 `model`로 준다.
   - `waitTurnEnd`, `waitPermission`, `waitQuestion`이 `timeoutMs`를 받아 `until`에 넘긴다. `until`의 인자는 이미 있다.
3. E2E가 쓰는 시그니처를 깨지 않았는지 `grep -rn "connectFakeProvider\|waitTurnEnd\|waitPermission\|waitQuestion" tests`로 확인한다. 호출 쪽 file은 고치지 않는다(선택 인자라 안 고쳐도 된다).
4. 실제 provider는 부르지 않는다. 확인은 fake로만 한다: scratch script(`.dev-data/ev-provider/check.ts`, commit하지 않는다)에서 `startFakeServer` + `bootCore` + `connectFakeProvider(core, fake, {default:false})` + `openSession(lophn)` + `changeModel` + `say`를 해서 turn이 끝나고(fake가 text로 답), 전역 기본이 없는 다른 session은 `configuration_unavailable`로 끝나는 것을 본다. `connectRealProvider`는 `endpoint: fake.url`, `definition: "anthropic"`, 가짜 key로 불러 api_key 연결이 되고 turn이 도는 것을 본다(loopback이라 https 규칙을 피한다). 진짜 endpoint는 부르지 않는다.

## 끝남

- `deno task check`가 통과한다(`tests/support`는 check에 든다).
- 위험 test: 없음. 진짜 provider를 부르지 않고는 `connectRealProvider`를 test로 지킬 수 없고, 남은 두 변경은 선택 인자라 기존 E2E 호출이 그대로 도는 것이 확인이다.
- 남지 않음: scratch script를 commit하지 않았다. 확인 뒤 `/tmp/lophn-e2e-*`와 core process가 남지 않았다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 정한 것: `connectRealProvider`가 정의를 못 찾을 때의 오류 문구 등
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: 진짜 endpoint로는 확인하지 못했다는 것을 적는다(첫 진짜 호출은 lead가 한다)
