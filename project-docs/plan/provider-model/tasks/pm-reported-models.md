# pm-reported-models

`credential.account_models`를 두 쓰임(ChatGPT 계정 목록, custom provider가 알려 준 목록)에 맞는 이름 `reported_models`로 바꾸고, 새로 붙일 계약(`RefreshProviderModels` route, 고를 수 있는 model을 정하는 순수 함수 `selectableModels`)을 세운다. 동작은 바꾸지 않는다: 이름 바꾸기와 계약 추가다.

- 단위: pm-contract (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{provider-values,provider-inputs,providers,model-picker}.ts`
  - `packages/protocol/lophn-agent/model-picker_test.ts`
  - `packages/core/lophn-agent/providers/{account-models,account-models_test,reported-models,reported-models_test,schema,model,commands,login,login_test,oauth-refresh,oauth-refresh_test}.ts`
  - `packages/core/lophn-agent/models/{resolve,resolve_test}.ts`(이름 바꾸기만)
  - `packages/core/lophn-agent/register.ts`(provider 명령 목록 줄만)
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`(이름 바꾸기만)
  - `packages/shell/renderer/workspace/agents/{source,core-source,fake-source,model-picker-data}.ts`(이름 바꾸기만)
  - `packages/shell/renderer/conversation/agent-tab-core-source-model.ts`(이름 바꾸기만)
  - `tests/support/wire/binding.ts`
  - `tests/live/{chatgpt_test,login,suite}.ts`(이름 바꾸기만)
- 읽을 것:
  - README: `project-docs/plan/provider-model/README.md`의 "정한 것"
  - architecture: `project-docs/architecture/agent-definition.md`(구독 provider 로그인, 계정 model 목록, 발급자 대기열 절)
  - 본보기: 로그인 명령이 "경로만 열어 두는" 등록 방식 `packages/core/lophn-agent/providers/commands.ts`의 `beginLogin`
  - 지금 이름이 쓰인 곳 전부: `grep -rn "account_models\|accountModels\|AccountModels\|accountAllows\|account-models" packages tests tools --include=*.ts --include=*.tsx`(dist 제외)
- 계약:
  - 쓰는 것: `packages/protocol/lophn-agent/providers.ts`의 `defineCommand` 꼴, `providerOutput`
  - 내놓는 것: 아래 "계약 모양"

## 계약 모양

- 칸 이름: `ProviderCredential.account_models` → `reported_models: string[] | null`. 뜻은 "provider가 알려 준 model 이름. null은 못 읽었다는 뜻이고 그때는 거르지 않는다". SQL 열도 `reported_models`다(`providers/schema.ts`의 기존 step을 고친다. 옛 개발 data는 지우고 새로 만든다. migration을 만들지 않는다).
- 명령: `RecordProviderAccountModels` → `RecordProviderModels`(resource `provider-credentials`, method `record-models`). 입력 schema는 `recordProviderModelsInputSchema`(`provider`, `models`). 동작은 그대로다(revision은 provider revision을 올리고 credential revision은 올리지 않는다).
- 새 명령 `RefreshProviderModels`: resource `providers`, method `refresh-models`, 입력 `{ provider: idSchema("pvd") }`, 출력 `providerOutput`, actors `["user"]`, errors `[...userErrors, "not_found"]`, compare 없음. `PROVIDER_ROUTES`에 넣는다. 실제 일은 writer queue 앞에서 도는 async 처리기가 한다(다음 task `pm-custom-list`). 이 task는 `providers/commands.ts`에 `beginLogin`처럼 `unavailable`("runs outside the ledger writer")만 돌려주는 등록을 두고 `register.ts` 명령 목록에 넣는다.
- 순수 함수(`model-picker.ts`):
  ```ts
  export type SelectableModel = { model_name: string; entry: CatalogEntry | null };
  export function selectableModels(input: {
    definition: string;                    // provider.definition.key
    catalog: readonly CatalogEntry[];      // catalog 전체(여러 provider 정의가 섞여 있다)
    reported: readonly string[] | null;    // credential.reported_models
  }): SelectableModel[];
  ```
  규칙: `reported`가 있고 비어 있지 않으면 그 목록이 고를 수 있는 model 전부다(목록 순서, 중복 제거). 이름이 같은 catalog 항목(`provider_definition === definition`)이 있으면 `entry`로 붙이고 없으면 `entry: null`. catalog에만 있고 목록에 없는 model은 나오지 않는다. `reported`가 null이거나 빈 목록이면 그 정의의 catalog 항목 전부(catalog 순서, `entry` 채움)다. 다른 정의의 항목은 절대 섞지 않는다. 빈 목록을 "전부 숨김"으로 읽지 않는다(잘못 읽어 model을 전부 숨기는 쪽이 나쁘다. README "정한 것").
  catalog는 고를 수 있는지를 정하지 않고 정보(`entry`)만 준다.
- 허락 목록 규칙(README "정한 것": 직접 적은 이름은 받되, 목록이 계정의 허락 목록이면 목록 밖 이름은 받지 않는다). 허락 목록은 구독 OAuth provider(`credential.kind === "oauth"`)의 `reported_models`다. custom provider와 API key provider의 목록은 찾기 위한 것이다. 순수 함수 둘을 `model-picker.ts`에 둔다:
  ```ts
  // 허락 목록일 때만 의미가 있다. kind가 "oauth"이고 reported가 null이 아니면 reported에 있어야 true. 그 밖에는 항상 true.
  export function entitlementAllows(kind: string, reported: readonly string[] | null, modelName: string): boolean;
  // 직접 적은 이름을 받을 수 있는가(= 허락 목록이 없는가). kind가 "oauth"이고 reported가 null이 아니면 false.
  export function typedNameAllowed(kind: string, reported: readonly string[] | null): boolean;
  ```
  기존 `accountAllows`는 `entitlementAllows`로 바꾼다(core resolver가 쓴다). renderer `modelsOf`의 옛 `accountAllows` 쓰임은 다음 wave(`pm-picker-data`)가 `selectableModels`로 바꾼다. 이 task에서는 같은 동작의 인라인 거름(`reportedModels === null || includes`)으로 바꿔 컴파일만 맞춘다.
- helper: `providers/account-models.ts`를 `reported-models.ts`로 옮기고(`git mv`) 이름을 `parseReportedModels`, `readReportedModels(http, endpoint, access)`, `reportedModelsEndpoint(definition)`으로 바꾼다. 동작은 그대로(ChatGPT 정의만 읽는다). `access`를 `string | null`로 받게 하는 것은 다음 task가 한다.

## 할 일

1. 위 계약대로 protocol(`provider-values.ts`, `provider-inputs.ts`, `providers.ts`, `model-picker.ts`)을 고친다. 새 route의 입력 schema는 `provider-inputs.ts`에 둔다.
2. core를 새 이름에 맞춘다: `providers/{schema,model,commands,login,oauth-refresh}.ts`, 둘레 test, `models/resolve.ts`와 test, `register.ts` 명령 목록, `lophn-agent-runtime.ts`. 주석과 오류 메시지에 남은 옛 이름도 고친다.
3. renderer의 읽는 곳을 새 이름에 맞춘다(`ProviderChoice.accountModels` → `reportedModels`와 `credential.reported_models`). 화면 동작은 바꾸지 않는다.
4. `tests/support/wire/binding.ts`, `tests/live/*`를 맞춘다.
5. `model-picker_test.ts`에 `selectableModels` 표 test 하나를 쓴다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "provider가 알려 준 목록이 있으면 그 목록이 고를 수 있는 model이고(catalog와 겹치면 `entry`가 붙고 안 겹치면 `entry: null`), 목록이 없거나 비면 그 정의의 catalog 항목이며, 다른 정의의 항목은 섞이지 않는다." 한 표 test(경우: null / 일부만 catalog와 겹침 / 빈 목록 / 중복 이름 / 같은 model 이름이 다른 정의에 있음). 같은 file에 `typedNameAllowed`의 세 경우(oauth + 목록 → false, oauth + null → true, api_key/none + 목록 → true)를 표 한 줄씩 더한다.
- 남지 않음: `grep -rn "account_models\|AccountModels\|accountModels\|accountAllows\|account-models" packages tests tools --include=*.ts --include=*.tsx`가 0줄이다(dist 제외).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `register.ts` 줄은 이 task가 고친다. lead가 마지막에 맞출 문서: `architecture/agent-definition.md`의 `account_models`·`RecordProviderAccountModels` 문장(칸 `reported_models`, 명령 `RecordProviderModels`, 새 명령 `RefreshProviderModels`), changelog. `boundary-catalog.yaml`과 `module-catalog.yaml`에는 route 이름 항목이 없다(`grep`으로 확인). 있으면 위 세 이름을 올린다
- 안 쓰게 된 export: 없음(`entitlementAllows`는 core resolver가 계속 쓴다)
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것** / **알려진 미완 동작**: 없으면 "없음"
