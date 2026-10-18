# model-manage: picker는 고르기만 하고, 보일 model과 provider 연결은 Manage models 창에서 한다

- 목표: model picker에서 등록(provider 붙이기, model 이름 적기)을 빼고, opencode처럼 picker 맨 아래 "Manage models" 한 줄이 여는 창에서 보일 model을 켜고 끄고 provider를 붙인다. Settings에서 앞 화면으로 돌아가는 길을 만든다.
- 재료:
  - 사람이 보인 opencode 화면 셋:
    - picker: 검색, provider별 묶음, 고른 model에 체크, 맨 아래 "모델 관리" 한 줄
    - 모델 관리 창: "모델 선택기에 표시할 모델 사용자 지정", 검색, provider마다 머리 줄 toggle과 model마다 toggle, 오른쪽 위 "+ 공급자 연결"
    - 공급자 연결 창: 검색, 인기·기타 묶음, "OpenAI 호환 사용자 지정 공급자"
  - 계획 `provider-model`이 land한 코드: 공유 picker(`packages/shell/renderer/conversation/model-picker/`), `ConnectProviderHost`(`desktop/settings/providers/connect-host.tsx`), `RefreshProviderModels`, `credential.reported_models`, `selectableModels`
  - `project-docs/architecture/agent-definition.md`(model 목록과 고르는 규칙), `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
- 범위 밖: provider 연결 창 자체, provider 보안 규칙, core의 model 이름 규칙(직접 적은 이름은 지금처럼 받는다)은 바꾸지 않는다.
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다.
- 단위: `tasks/*.md`. task id는 `mm-`로 시작한다.
- 순서: 저장(보일 model)과 Settings 돌아가기 → renderer 자료 → 화면 → gallery page → 사람이 gallery로 확인.
- 시작 조건: 없음. 계획 `provider-model`은 main에 land했다.

## 지금 모양

- picker(대화, Settings → Agents의 Default model, Operator·project의 Model 칸이 같은 component)에 고르기 말고도 줄이 넷 있다: 즐겨찾기(별표와 맨 위 Favorites 묶음), 이름 직접 적기("Model name on <provider>" + [Use]), "Connect provider", 대화 picker의 "Change defaults…".
- 즐겨찾기는 core의 model 저장소(`packages/core/lophn-agent/models/{schema,store,commands,reads}.ts`)와 protocol(`packages/protocol/lophn-agent/models.ts`의 favorites 계약)에 있다.
- custom provider의 목록은 연결 직후와 "Refresh models"로 `GET {endpoint}/models`를 읽어 `reported_models`에 둔다. 사람이 이름을 더하는 길은 picker의 이름 직접 적기뿐이고 저장되지 않는다.
- Settings는 화면 전체를 바꾸는 route다(`packages/shell/renderer/desktop/main.tsx`의 `openSettings`). 열기 전 자리를 기억하지 않아 돌아가는 단추가 없다.

## 정한 것

- picker는 고르기만 한다(사람).
  - 남는 것: 검색, 지금 model이 온 층 한 줄, 보이게 켠 model의 provider별 묶음, 고른 model의 option 축.
  - 지금 고른 model은 꺼져 있어도 보인다. 안 보이면 지금 무엇을 쓰는지 모른다(agent).
  - 맨 아래는 "Manage models" 한 줄이다. 누르면 Manage models 창이 열린다.
  - 지우는 것: 즐겨찾기 별표와 Favorites 묶음, 이름 직접 적기 줄, "Connect provider" 줄, "Change defaults…" 줄. 기본 model은 Settings → Agents에서 정한다(agent: opencode처럼 한 줄만 둔다).
  - 처음 provider를 붙일 때 뜨는 기본 model 창의 picker에는 "Manage models" 줄이 없다(창 위에 창을 겹치지 않는다).
- Manage models 창(사람: opencode 방식):
  - 머리: "Manage models", 설명 한 줄(picker에 보일 model을 고른다), 오른쪽 위 "+ Connect provider".
  - 검색 칸 하나. provider마다 묶음이다. 묶음 머리는 vendor 아이콘, provider 이름, provider toggle(그 provider의 model 전부 켜기·끄기)이다. 그 아래 model마다 toggle이다.
  - custom provider 묶음 머리에는 "Refresh models"가 있다. 실패하면 앞 목록이 그대로이고 창 안에 한 줄로 알린다.
  - custom provider가 목록을 주지 않으면(`reported_models`가 null이거나 빈 목록) 그 묶음에 model 이름을 더하는 칸이 있다. 더한 이름은 그 provider의 `reported_models`에 들어간다(사람 자격의 `RecordProviderModels`, compare `revision`). 새 저장 칸을 만들지 않는다(agent). 목록을 주는 provider에는 이 칸이 없다.
  - "+ Connect provider"는 지금의 provider 연결 창(`ConnectProviderDialog`)을 연다. 붙이고 나면 Manage models 창으로 돌아와 그 provider 묶음이 맨 위에 보인다.
- 보일 model:
  - 즐겨찾기를 없애고 켜기·끄기 하나로 둔다(사람). 저장된 즐겨찾기는 옮기지 않고 버린다(AGENTS.md "호환성").
  - provider를 처음 붙이면 그 model이 모두 켜져 있다(사람).
  - 저장은 끈 model 목록(provider id, model 이름)이다. 기본이 "켬"이라 끈 것만 적으면 새 model과 새 provider가 따로 쓰지 않아도 켜져 나온다(agent). 즐겨찾기가 있던 자리(전역 하나)에 둔다.
  - provider toggle은 그 provider의 지금 model을 하나씩 끄거나 켜서 적는다. provider 단위 칸을 따로 두지 않는다(agent).
- 이름 직접 적기: core는 지금처럼 어떤 이름이든 받는다(계획 `provider-model`). 화면에서 이름을 적는 길은 위의 custom provider 이름 더하기뿐이다. 내장 provider의 새 model은 catalog 갱신(24시간)을 기다린다(agent).
- Settings 돌아가기(사람):
  - Settings 머리에 "Back" 단추를 둔다. 누르면 Settings를 열기 전 화면(같은 project·앱·session)으로 돌아간다.
  - 앞 화면이 없으면(처음부터 Settings였으면) launcher로 간다(agent).

## 사람이 정할 것

- 화면 모양: renderer를 고친 뒤 gallery(`deno task wireframes`)의 해당 page를 사람이 보고 고른다. lead는 그때 page 주소와 여는 법을 준다.

## lead가 할 일

- merge 때마다 renderer build(`deno run -A packages/shell/renderer/build.ts`)와 `deno task wireframes`를 돌린다.
- 끝나면 `project-docs/architecture/agent-definition.md`(model picker 문단)를 맞추고, `project-docs/products/change-log/0.3.0.md`에 항목을 덧붙이고 land한다.
