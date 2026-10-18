# provider-model: provider 붙이기와 model 고르기를 한 흐름으로 잇는다

- 목표: opencode·hermes처럼 provider를 붙이는 일과 model을 고르는 일을 한 흐름으로 잇는다. 저장은 지금처럼 따로 둔다(사람).
- 재료:
  - `research/ux-opencode.md`, `research/ux-hermes.md`(두 도구가 한 것, 따라 할 것과 하지 않을 것)
  - 계획 `ui-fixes`가 land한 뒤의 코드: model catalog 읽기, Agents 탭 scroll, catalog에 없는 model 이름 직접 적기
  - 계획 `chatgpt-subscription`이 만든 계정 model 목록(`credential.account_models`, 발급자 요청 대기열로 `GET /v1/models`)
  - `project-docs/architecture/agent-definition.md`(model을 정하는 순서), `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
- 범위 밖:
  - provider 연결 자체의 보안 규칙(endpoint, key 보관)은 바꾸지 않는다.
  - 최근 쓴 model 목록, fallback provider, 보조 model 칸은 만들지 않는다. 필요해지면 그때 만든다(AGENTS.md "속도").
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다.
- 단위: `tasks/*.md`. task id는 `pm-`로 시작한다.
- 순서: core와 계약 → renderer 화면 → wireframe page → 사람이 gallery로 확인.
- 시작 조건: 계획 `ui-fixes`가 main에 land한 뒤. model picker, model 칸, custom provider 대화창, `packages/core/lophn-agent/models/**`를 같이 고친다.

## 지금 모양

- 붙이는 곳과 고르는 곳이 떨어져 있다.
  - 붙이기: Settings → Providers. 내장 provider 7개와 Custom provider(OpenAI 호환 base URL)가 있다.
  - 고르기: 세 곳이 따로 있다. Settings → Agents의 Default model, Operator 정의의 Model, 대화의 model picker.
- 고를 수 있는 model은 catalog(models.dev snapshot)가 provider 정의 key로 정한다(`packages/shell/renderer/workspace/agents/model-picker-data.ts`의 `modelsOf`). 그래서 custom provider에는 고를 것이 없다. `ui-fixes`가 이름을 직접 적는 길을 임시로 둔다.
- ChatGPT 구독 provider는 계정이 쓸 수 있는 model 목록을 `GET /v1/models`로 읽어 credential에 둔다(`account_models`). 그 목록이 catalog를 거른다.
- model을 정하는 순서: session → agent 정의 → project → 전역 기본값(`packages/core/lophn-agent/agents/resolve.ts`). 화면은 지금 쓰는 model이 어디서 정해졌는지 보여 주지 않는다.
- provider를 처음 붙여도 기본 model을 고르라고 이어 주지 않는다. 기본값이 없으면 turn은 `model_required`로 시작하지 않는다.

## 정한 것

- 저장은 따로, 흐름은 하나다(사람: "opencode, hermes 식으로").
- provider가 알려 주는 model 목록:
  - custom provider는 붙일 때와 사람이 "model 목록 다시 읽기"를 누를 때 `GET {provider endpoint}/models`를 읽어 그 provider의 credential에 저장한다. 실패하면 앞 목록을 둔다. 정의의 `models_endpoint`는 https만 받으므로 local http 주소는 endpoint에서 만든다.
  - ChatGPT 계정 model 목록과 같은 칸, 같은 길(발급자 요청 대기열)을 쓴다. 칸 이름은 두 쓰임에 맞게 바꾼다. 옛 이름은 남기지 않는다(AGENTS.md "호환성").
  - local http 주소도 같다.
- 고를 수 있는 model:
  - provider가 알려 준 목록이 있으면 그 목록이다(catalog와 겹치면 catalog의 정보를 붙인다).
  - 목록이 없으면 지금처럼 catalog다.
  - 이름을 직접 적을 수 있다. 예외는 provider가 알려 준 목록이 계정의 허락 목록일 때(구독 OAuth provider, 예: ChatGPT)다. 그때는 목록 밖 이름을 받지 않는다. 계획 `chatgpt-subscription`이 지킨 것이다(agent).
  - custom provider의 목록은 찾기 위한 것이라 목록 밖 이름도 받는다(agent).
  - catalog는 고를 수 있는지를 정하지 않고 정보(context, output 한도, effort 축, vision)만 준다(agent, hermes 방식).
- model picker:
  - model을 고르는 세 곳은 같은 picker를 쓴다.
  - 붙인 provider만 보인다.
  - 맨 아래에 "provider 붙이기" 줄을 둔다. 누르면 연결 대화창이 열리고, 붙인 뒤에는 그 provider의 model 목록으로 돌아온다(agent, opencode 방식).
  - 즐겨찾기는 지금처럼 맨 위다.
- 처음 붙일 때: 전역 기본값이 없는 채로 provider를 붙이면, 붙인 직후 기본 model을 고르게 한다(agent).
- 어디서 정해졌나: 대화의 model 표시와 Operator 정의의 Model 칸은, 지금 model이 어느 층(이 대화, agent 정의, project, 전역 기본값)에서 왔는지 보여 준다(agent). 정의 read(`effective.model.source`)가 이미 층을 내므로, project 층을 더하는 것만 한다.
- reasoning effort는 지금처럼 picker 안의 option 축으로 둔다. 따로 묻는 단계를 더하지 않는다(agent: 이미 고르는 자리에 있다).
- 하지 않는 것: 설정 file로만 기본값을 정하기, 인증과 설정을 두 file로 나누기, 겹치는 여러 명령.

## 사람이 정할 것

- 화면 모양: renderer를 고친 뒤 gallery(`deno task wireframes`)의 해당 page를 사람이 보고 고른다. lead는 그때 사람에게 page 주소를 준다.

## lead가 할 일

- merge 때마다 renderer build(`deno run -A packages/shell/renderer/build.ts`)와 `deno task wireframes`를 돌린다.
- 끝나면 `project-docs/architecture/agent-definition.md`(model 목록과 고르는 규칙)를 맞추고, `project-docs/products/change-log/0.3.0.md`에 항목을 덧붙이고 land한다.
