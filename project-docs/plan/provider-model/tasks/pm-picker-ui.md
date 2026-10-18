# pm-picker-ui

model을 고르는 세 곳(대화의 picker, Settings → Agents의 Default model, Operator 정의와 project의 Model 칸)이 같은 picker component를 쓰게 한다. 붙인 provider만 보이고, 맨 아래에 "Connect provider" 줄이 있고, 이름을 직접 적는 길이 하나로 합쳐지고, custom provider에는 "Refresh models"가 있고, 지금 model이 어느 층에서 왔는지 보인다.

**먼저 지금 코드를 다시 읽는다**: 계획 `ui-fixes`(main에 land됨)와 이 계획의 `pm-picker-data`, `pm-connect-flow`가 들어온 뒤의 `packages/shell/renderer/conversation/model-picker/**`, `workspace/agents/{model-picker-data.ts,editor/model-field.tsx,editor/definition-form.tsx,agents-tab.tsx}`, `desktop/settings/agents/agents-panel.tsx`를 읽고 시작한다. `ui-fixes`가 이미 만든 것(아래 "합칠 것")을 복사하지 말고 공유 picker 안으로 합친다.

- 단위: pm-screens (wave 4)
- 선행: pm-picker-data, pm-connect-flow
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/model-picker/**`
  - `packages/shell/renderer/conversation/use-model-picker.ts`
  - `packages/shell/renderer/conversation/composer/agent-composer.tsx`
  - `packages/shell/renderer/workspace/agents/editor/{model-field,definition-form}.tsx`
  - `packages/shell/renderer/workspace/agents/agents-tab.tsx`
  - `packages/shell/renderer/workspace/agents/model-picker-data.ts`(`customProvidersOf`와 `custom` 칸 지우기만)
  - `packages/shell/renderer/desktop/settings/agents/agents-panel.tsx`
  - `packages/shell/renderer/desktop/settings/providers/connect-host.tsx`(기본 model 대화창 본문을 새 picker로 바꾸는 줄만)
  - `packages/design/wording/catalog/{conversation,agents}.ts`(key만)
- 읽을 것:
  - README: `project-docs/plan/provider-model/README.md`의 "정한 것"과 `research/ux-opencode.md`의 3절(model picker 맨 아래 connect, 연결 뒤 그 provider의 model로 돌아오기), `research/ux-hermes.md`
  - 화면 규칙: `.claude/skills/ui-design/SKILL.md`(모든 화면의 규칙: 행동 단추는 줄 오른쪽 끝 고정 열, 탭 알림은 Toast, provider 이름 옆에는 vendor 아이콘, menu 항목에는 아이콘), `.claude/skills/wording/SKILL.md`
  - 본보기(화면): `tools/wireframes/pages/screens/agent.tsx`의 `new-agent-model-picker`, `agent-settings.tsx`의 `new-operator-editor`, `settings.tsx`의 `new-settings-agents`
  - 지금 component: `model-picker.tsx`의 `ModelPicker`(Popover, 검색, Favorites, provider 묶음, option 축, Change defaults), 같은 file의 `ModelField`(Select + 따르기 + Changed + Reset), `custom-model.tsx`(`ui-fixes`가 만든 "Model name on <provider>" 입력과 [Use]), `model-picker.module.css`의 `.custom`/`.customList`
  - 계획 `ui-fixes`가 land한 것: catalog 읽기는 `cursor`로 이어 읽는다(renderer 호출 자리가 cursor를 따른다. 이 task는 읽기 자리를 건드리지 않는다), catalog에 목록이 없는 provider의 model은 core가 기본 한계로 돌린다
- 계약:
  - 쓰는 것: `pm-picker-data`가 내놓은 `ModelPickerProps`의 `layer`, `typed`, `onRefreshModels`, `PickerProviderGroup.refreshable`, `modelsOf`(`SelectableModel[]`), 그리고 `pm-connect-flow`의 `useConnectProvider()`
  - 내놓는 것: 없음(마지막 화면 task)

## 합칠 것 (ui-fixes가 이미 만든 것)

- "Model name on <provider>" 입력과 [Use]는 지금 provider마다 한 줄(`CustomModelInput`, `.customList`/`.custom`)이고 기본 model 칸, Operator 편집, 대화 picker 세 곳에 따로 붙어 있다. 이것을 공유 picker 안의 줄 하나로 합친다(아래 "이름 직접 적기"). 세 곳에서 따로 부르던 `CustomModelInput`과 css를 지운다.
- `ui-fixes`가 정한 `OptionAxes`는 model을 골랐고 목록을 읽었을 때만 그린다는 규칙을 유지한다(`axesReady`).
- catalog를 못 읽었을 때 모든 provider가 "목록 없음"으로 보이지 않게 하던 판정(`customProvidersOf`의 빈 catalog 처리)은 `pm-picker-data`의 `refreshable`이 이어받았다. 이 task는 그 값을 쓰기만 한다.

## 정한 것

- 하나의 picker: Popover 안 목록이다(검색칸, 따르기 줄(있을 때), Favorites, provider 묶음, 이름 직접 적기, 고른 model의 option 축, 맨 아래 줄들). trigger만 자리에 따라 둘이다: 대화 composer는 작은 단추(지금), Settings와 Operator는 칸 모양(고른 model 이름과 provider, vendor 아이콘). 목록 component는 한 곳이고 세 자리가 같은 것을 쓴다. 지금 `Select` 둘(`DefaultModelField`, 대화 `ModelField`)을 대체한다.
- 따르기: Operator 정의와 project의 Model 칸은 목록 맨 위에 "Use project default — X"/"Use Workspace default — X" 줄이 있다(지금 `agents.label.model-inherit` 문구를 쓴다). 고르면 `onChange(null)`. 바꾸면 Changed와 [Reset]이 붙는 것은 그대로다(`ModelField`의 동작을 새 picker 위에서 유지한다).
- 층 보이기: 대화의 picker 머리와 Operator Model 칸에 "Using: this conversation / this agent / project default / Workspace default" 한 줄을 보인다(`layer`의 `session`/`agent`/`project`/`global`). 지금 따르기 줄의 "(from project)" 문구와 겹치지 않게 정리한다. 층이 null이면 줄을 숨긴다.
- 붙인 provider만: 목록은 `ModelsView.providers`(연결된 것)에서만 만든다. 연결된 provider가 없으면 "No providers connected" 안내와 Connect 줄만 남는다.
- 맨 아래 줄: `useConnectProvider()`가 null이 아닐 때 "Connect provider" 줄을 보인다(host 밖이면 줄이 없다). 누르면 `open({ onConnected })`를 부르고, 연결이 끝나 picker가 다시 열리면 그 provider의 묶음이 맨 위로 보이고 강조된다(새 provider id를 못 찾았으면 그냥 연다). "Change defaults…"는 대화 picker에만 있고 Connect 줄 아래다.
- Refresh models: `refreshable` 묶음(custom provider)의 머리 오른쪽 끝에 작은 단추. 누르는 동안 비활성이고 실패(`onRefreshModels`가 false)면 popover 안 한 줄로 알린다(popover 안이라 탭 Toast가 닿지 않는다. 문구는 wording key). 실패해도 앞 목록은 그대로 보인다.
- 이름 직접 적기: `typed.providers`에 든 provider(= `typedNameAllowed`가 참인 provider. 허락 목록이 있는 구독 OAuth provider만 빠진다)에 열려 있다. 그 목록이 비면 줄을 숨긴다. picker 아래 줄 하나로, provider를 고르는 작은 select(후보가 하나면 숨김)와 입력 칸과 [Use]. 기본 provider는 지금 model의 provider 또는 마지막 묶음이다. 안내 문구(`conversation.notice.custom-model`)는 "목록에 없는 model도 이름으로 쓸 수 있다"는 뜻으로 고친다.
- reasoning effort는 지금처럼 picker 안의 option 축이다. 따로 묻는 단계를 더하지 않는다.
- 즐겨찾기는 지금처럼 맨 위다.

## 할 일

1. `conversation/model-picker/`를 위 모양으로 고친다: `model-picker.tsx`(목록 component와 두 trigger), `custom-model.tsx`(provider select + 입력 한 줄로 합침), `types.ts`는 `pm-picker-data`가 정한 칸을 쓰되 이 task가 component props에 필요한 칸을 더할 수 있다(`custom` 칸은 지운다), css는 `model-picker.module.css`(token 변수만. 값을 직접 쓰지 않는다. `.custom`/`.customList`는 합친 줄에 맞게 고치거나 지운다).
2. `workspace/agents/editor/model-field.tsx`: `ModelField`와 `DefaultModelField`를 새 picker 위의 얇은 감싸기로 바꾼다. `choicesOf`, 직접 만든 `Select`, 자리마다 붙인 `CustomModelInput`을 지운다. `DefaultModelField`의 props(`models`, `value`, `onChange`)는 유지한다(`pm-connect-flow`의 대화창이 쓴다).
3. 자리에 연결: `agents-tab.tsx`(project의 Model), `editor/definition-form.tsx`(Operator의 Model), `desktop/settings/agents/agents-panel.tsx`(Default model), 대화 composer와 `use-model-picker.ts`. 각각 `layer`와 refresh를 source에서 받아 넘긴다.
4. 문구는 wording key로 쓴다(`conversation.*`, `agents.*`). 같은 뜻의 key를 먼저 찾는다(`common.*`, 기존 `conversation.label.favorites` 등). 직접 문구를 `.tsx`에 쓰지 않는다. `deno task wording`으로 placeholders를 만든다.
5. 옛 코드를 지운다: `customProvidersOf`, `custom` 칸, 쓰지 않는 css, 쓰지 않게 된 key.
6. gallery(`tools/wireframes`)가 컴파일되지 않으면 그 줄만 최소로 맞추고 보고의 "넘길 줄"에 적는다. 새 page와 gallery 문구 갱신은 다음 task(`pm-wireframes`)가 한다.

## 끝남

- `deno task check`, `deno run -A packages/shell/renderer/build.ts`, `deno task wording --check`, `deno task wireframes`가 통과한다.
- 위험 test: 없음(화면. 고르는 규칙은 `selectableModels` 표 test와 core의 표 test가 본다).
- 남지 않음: `grep -rn "customProvidersOf\|CustomModelView\|CustomModelInput" packages tools --include=*.ts --include=*.tsx`가 0줄이다(합친 줄의 새 이름은 달라도 된다). wording에 쓰는 곳 없는 옛 key가 없다(key 앞부분으로 grep해서 template 호출을 확인한 뒤 지운다).
- 손 확인: `deno task dev:mock`에서 세 자리의 picker가 열리고, Connect 줄이 정의 고르기 대화창을 열고, 이름을 적어 고를 수 있다.

## 보고

- 바꾼 file, 통과한 check
- 등록할 것: wording 생성물
- 지운 key와 export
- 정한 것(층 한 줄의 자리와 문구, 실패 알림 자리) / 넘길 줄 / 계약 바꾸기 요청
- **무겁게 짠 것** / **알려진 미완 동작**: 없으면 "없음"
