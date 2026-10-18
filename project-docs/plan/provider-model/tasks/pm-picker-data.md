# pm-picker-data

세 model 고르기 자리(Settings → Agents의 Default model, Operator 정의의 Model, 대화의 model picker)가 같은 자료를 읽게 한다. 고를 수 있는 model은 `selectableModels`로 정하고, 이름을 직접 적는 길은 모든 provider에 열고, custom provider의 "model 목록 다시 읽기"(`RefreshProviderModels`)를 source에 붙이고, 지금 model이 어느 층에서 왔는지를 화면 자료에 싣는다. 화면 component는 고치지 않는다(`pm-picker-ui`가 한다).

**먼저 지금 코드를 다시 읽는다**: 계획 `ui-fixes`가 들어온 뒤의 `packages/shell/renderer/workspace/agents/{model-picker-data,core-source,fake-source,source}.ts`, `packages/shell/renderer/conversation/{agent-tab-core-source-model,agent-tab-source,agent-tab-fake-source,use-model-picker}.ts`, `conversation/model-picker/types.ts`를 읽고 시작한다.

- 단위: pm-screens (wave 3)
- 선행: pm-custom-list, pm-model-rules
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/agents/{model-picker-data,source,core-source,fake-source,views}.ts`
  - `packages/shell/renderer/conversation/{agent-tab-source,agent-tab-core-source-model,agent-tab-fake-source,use-model-picker}.ts`
  - `packages/shell/renderer/conversation/model-picker/types.ts`
- 읽을 것:
  - README: `project-docs/plan/provider-model/README.md`의 "정한 것"
  - `packages/protocol/lophn-agent/model-picker.ts`의 `selectableModels`, `SelectableModel`
  - 화면 규칙: `.claude/skills/ui-design/SKILL.md`(gallery는 renderer의 진짜 component를 fake source로 그린다)
- 계약:
  - 쓰는 것: `selectableModels`, `RefreshProviderModels`, `agentDefinitionRead`의 `effective.model.source`, `ProviderCredential.reported_models`
  - 내놓는 것(다음 task `pm-picker-ui`가 기대는 모양):
    - `ProviderChoice`: `reportedModels`(이미 이름만 바뀜), 새 칸 `refreshable: boolean`(catalog에 그 정의의 model이 하나도 없는 provider = custom. `customProvidersOf`가 쓰던 판정을 그대로 쓰되 catalog를 못 읽었으면 false)
    - `modelsOf(models, provider): SelectableModel[]`(이름이 `model_name`이라 `editor/model-field.tsx`가 그대로 컴파일된다)
    - `ModelPickerProps`/`ModelView`에 더하는 칸: `layer: AgentValueLayer | null`(지금 model이 온 층. `session`은 대화 source가 안다), `typed: { providers: {id,name}[]; onUse(provider, modelName) }`(연결된 provider 가운데 `typedNameAllowed(kind, reportedModels)`가 참인 것. 허락 목록이 있는 구독 OAuth provider는 뺀다. 그래서 `ProviderChoice`에 `kind`(credential.kind)도 싣는다. 모두 빠지면 `providers`가 빈 배열이고 화면은 입력 줄을 숨긴다), `PickerProviderGroup.refreshable: boolean`, `ModelPickerProps.onRefreshModels(provider: string): Promise<boolean>`(성공하면 true)
    - 기존 `custom`(catalog에 model이 없는 provider만)은 이 task에서 남긴다. `pm-picker-ui`가 component를 `typed`로 옮긴 뒤 지운다.
    - source 쓰임새: workspace agents source에 `refreshModels(provider: string): Promise<boolean>`, 대화 source의 `ModelPart`에 같은 이름. 성공하면 model 자료 기억(`MODEL_TTL_MS` memo)을 비운다. Settings Agents는 `source.editor`를 그대로 쓰므로 따로 늘리지 않는다.
    - `PickerBinding`에 `layer`와 `refreshModels`를 더한다.

## 할 일

1. `modelsOf`를 `selectableModels({ definition: provider.definition, catalog: models.catalog, reported: provider.reportedModels })` 결과로 바꾼다. `entryOf`는 그대로(고른 model의 option 축을 찾는다).
2. `pickerProps`: `available` 목록이 새 `modelsOf`를 쓰게 하고, `typed`, `layer`, `refreshable`, `onRefreshModels`를 채운다. 목록에 없는 이름을 적어 고르면 `entry`가 없으니 `option_values: {}`, 있으면 `fitOptionValues`로 맞춘다(지금 `choiceOf`와 같다).
3. 층: 대화 source(`agent-tab-core-source-model.ts`)의 `context()`는 session record의 `model_selection`이 있으면 `session`, 대기 중 `pending`이어도 `session`, 아니면 `agentDefinitionRead`의 `effective.model.source`(`agent`/`project`/`global`)다. workspace의 Operator/lophn 정의 읽기도 `inheritedModel`과 own 값의 층을 `AgentDetail`에 그대로 싣고 있는지 확인하고, own 값(정의에 model이 있음)은 `agent`로 읽히게 한다.
4. 새 command 호출: `RefreshProviderModels`를 부르는 `refreshModels`를 두 source에 만든다(`link.command`/`env.command`가 `compare` 봉투를 요구하는지 `command-call.ts`를 보고 따른다. 이 명령은 compare가 없다).
5. fake source(`workspace/agents/fake-source.ts`, `conversation/agent-tab-fake-source.ts`)를 설정으로 상태를 정할 수 있게 한다: provider 0개, 내장 provider만, custom provider(목록 있음/없음), project 층 model 있음. 다음 wave의 gallery가 이 설정으로 상태를 만든다. 기본 상태는 지금 gallery 그림이 그대로 나오게 둔다.
6. `modelsOf`에서 옛 `accountAllows`(임시로 남겨 둔 거름)를 걷는다. 목록은 `selectableModels`가 정한다.
7. gallery(`tools/wireframes`)가 컴파일되지 않으면 그 줄만 최소로 맞추고 보고의 "넘길 줄"에 적는다.

## 끝남

- `deno task check`와 `deno run -A packages/shell/renderer/build.ts`가 통과한다.
- 위험 test: 없음(고르는 규칙은 `selectableModels` 표 test와 core가 이미 본다. 여기는 연결이다).
- 남지 않음: `grep -rn "accountAllows" packages tools --include=*.ts --include=*.tsx`가 0줄이다.

## 보고

- 바꾼 file, 통과한 check
- 등록할 것: 없음(`entitlementAllows`는 core가 쓰므로 남는다)
- 안 쓰게 된 export: `customProvidersOf`와 `custom` 칸(`pm-picker-ui`가 지운다)
- 정한 것 / 넘길 줄 / 계약 바꾸기 요청
- **무겁게 짠 것** / **알려진 미완 동작**: 없으면 "없음"
