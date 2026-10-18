# cs-models-picker

model을 고르는 화면 둘(대화의 model picker, agent 편집의 Model 칸)이 연결된 provider의 계정 model 목록(`credential.account_models`)에 있는 model만 보이게 한다. 규칙은 `cs-models-account`가 내놓은 `accountAllows` 하나를 쓴다.

- 단위: cs-models (wave 2)
- 선행: cs-models-account
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/agents/source.ts`
  - `packages/shell/renderer/workspace/agents/model-picker-data.ts`
  - `packages/shell/renderer/workspace/agents/editor/model-field.tsx`
  - `packages/shell/renderer/workspace/agents/core-source.ts`
  - `packages/shell/renderer/workspace/agents/fake-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-model.ts`
- 읽을 것:
  - 제품 결정: `project-docs/issues/platform.md`의 "ChatGPT로 로그인한 provider가 그 계정이 못 쓰는 model도 고르게 둔다"
  - 본보기: 위 소유 file들. 화면 모양은 바꾸지 않는다(wireframe 변경 없음, 새 문구 없음).
- 계약:
  - 쓰는 것: `packages/protocol/lophn-agent/model-picker.ts`의 `accountAllows(accountModels, modelName)`, `providerList`/`providerRead` 출력의 `provider.credential.account_models: string[] | null`
  - 내놓는 것: `ProviderChoice`에 `accountModels: readonly string[] | null` 칸. 화면 밖에 내놓는 계약은 없다.

## 할 일

1. `workspace/agents/source.ts`: `ProviderChoice`에 `readonly accountModels: readonly string[] | null`을 더한다.
2. provider를 읽어 `ModelsView.providers`를 만드는 두 곳이 `accountModels: provider.credential.account_models`를 채운다.
   - `workspace/agents/core-source.ts`의 `models()`: `providers()` 안의 local row type(`{ id; name; definition: { key } }`)에 `credential: { account_models: string[] | null }`을 더한다.
   - `conversation/agent-tab-core-source-model.ts`의 `readModels()`: `providerList` 출력이 이미 typed라 칸만 더한다.
3. `workspace/agents/model-picker-data.ts`: 지금 `pickerProps`와 `editor/model-field.tsx`의 `choicesOf`가 각자 `catalog.filter(entry.provider_definition === provider.definition)`을 쓴다. 이 거름을 이 file의 export 하나로 모은다: `modelsOf(models: ModelsView, provider: ProviderChoice)` → 그 provider의 catalog 항목 중 `accountAllows(provider.accountModels, entry.model_name)`인 것. 두 곳이 그것을 쓴다. (모은 이유: 거름이 두 곳에 따로 있으면 한 곳이 목록을 빠뜨린다.)
   - `entryOf`(고른 model의 축·한계를 찾는 함수)는 거르지 않는다. 이미 고른 model의 이름·option 표시는 목록 밖이어도 보여야 한다.
4. `workspace/agents/fake-source.ts`(가짜 source)의 `providers: [...]`에 `accountModels: null`을 더한다. `deno task check`가 가리키는 다른 가짜(`desktop/dev-mock/**`의 provider data 등)는 `account_models: null` 한 칸씩만 맞춘다.
5. 위험 test는 따로 쓰지 않는다. 규칙(`accountAllows`)은 `cs-models-account`의 test가 본다. 화면은 test하지 않는다(write-test).

## 끝남

- `deno task check`가 통과한다. 끝내기 전에 `deno task check:full`과 renderer build(`deno run -A packages/shell/renderer/build.ts`)도 돌린다(check:full은 renderer build를 보지 않는다).
- 위험 test: 없음
- 남지 않음: `grep -rn "provider_definition === provider.definition" packages/shell/renderer`가 `model-picker-data.ts` 한 곳(`modelsOf`와 `entryOf`)만 가리킨다.
- 손으로 확인(lead): `deno task dev`(fake provider)로 model picker가 전과 같이 모든 catalog model을 보인다(fake는 `account_models`가 `null`). 목록 있는 provider를 화면에서 보는 것은 진짜 로그인이 필요해 cs-live의 사람 단계에서 한다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 없음
- 넘길 줄: 가짜 data 한 칸씩
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없음
- **알려진 미완 동작**: 이미 목록 밖인 model이 기본값으로 저장돼 있으면 picker는 그 이름을 현재 값으로 보이되 고를 목록에는 없다.
