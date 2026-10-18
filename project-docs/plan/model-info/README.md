# model-info: custom model 정보를 catalog 모양으로 적고, output 상한을 고친다

- 목표: custom provider model의 정보(한도, tool 지원, modality, effort, 가격)를 사람이 catalog 항목과 같은 모양으로 적는다. 적은 effort를 picker에서 고르고, 적은 한도·image 허용·가격이 turn과 비용 기록에 쓰이게 한다. 모든 OpenAI 계열 model에 걸린 output 4096 상한을 고친다.
- 재료: `project-docs/products/roadmap/model-info.md`(지금 코드, 선례, 무엇을 만드나의 1·2·4), `project-docs/architecture/agent-definition.md`(catalog, Manage models), `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
- 범위 밖: 비용 계산(cache 요율)과 비용 합 화면은 다음 계획 `model-cost`다. roadmap의 "하지 않는 것" 전부.
- 돌리는 방식: brief 없이 worker를 바로 띄운다. task 파일은 할 일과 소유를 담는다. orchestrate skill대로 한다.
- 단위: `tasks/*.md`. task id는 `mi-`로 시작한다.
- 순서: wave 1 core(`mi-core`) → wave 2 shell(`mi-shell`) → wave 3 gallery(`mi-wireframes`) → 사람이 gallery로 확인 → land.
- 시작 조건: 없음.

## 정한 것

roadmap "정한 것"을 그대로 따른다. 계획에서 더 정한 것:

- output 상한은 32000이다(사람). 보내는 `max_tokens`는 OpenAI 계열 `min(output_limit, 32000)`, Anthropic `min(output_limit, 32000 + thinking 예산)`이다. 입력 예산이 남기는 output 몫(`run-loop/prepare.ts`, `session/compactor.ts`)도 `min(32000, output_limit)`이다. 상수는 하나만 둔다(agent).
- 목록 밖 model의 기본 output 한도 4096은 그대로다(agent). 모르는 server에 큰 값을 보내 거절당하지 않게 하고, 더 쓰려면 사람이 적는다.
- 저장 열쇠는 catalog와 같은 (provider definition key, model 이름)이다(agent). custom 정의 key는 연결 form의 Provider ID라 provider 하나에 하나다. provider를 끊었다 같은 ID로 다시 붙이면 적은 정보가 다시 보인다. 지우는 것은 사람의 [Remove model]뿐이다.
- 받는 정의는 custom 정의뿐이다(agent). 내장 정의나 구독 OAuth 정의의 key로 오면 `invalid_input`이다.
- effort는 effort 축 하나다(agent). 사람이 고른 값(고정 이름 7개 중, 약한 것부터)과 기본 값(null이면 model에 맡김)만 적는다. label, `wire: null`, `budget: null`은 core가 채운다. 기존 effort 축 검사(`option-axes.ts`, `models.ts`)를 그대로 쓴다. reasoning을 끄면 `options: []`(option 없음 확인)다.
- 가격은 `price_basis` 요율 하나(`rates[0]`)다(agent). input, output, cache read, cache write 넷이고 USD per 1M, 비우면 null(모름), 0은 무료다. 넷이 다 비면 `price_basis: null`이다.
- 안 적은 한도는 null로 저장한다. turn은 칸마다 목록 밖 기본값(context 131072, input = context, output 4096, tool 지원)으로 채운다(agent). 화면은 기본값을 회색 placeholder로 보인다.
- 고를 목록: custom provider는 provider가 알려 준 목록과 user 정보가 있는 model의 합이다(agent, `selectableModels`). Manage models의 이름 더하기는 user 정보를 만든다. `reported_models`에 덧붙이지 않는다.
- form은 Manage models 창 위의 Dialog 하나다(agent). [Add model]은 빈 form, 행의 [Edit]은 채운 form을 연다. provider가 알려 준 model에도 [Edit]으로 정보를 더할 수 있다.
- Manage models 행: 모든 model에 입력 modality icon과 context(아는 경우)를 보인다. catalog model은 읽기만 한다(agent).

## 사람이 정할 것

- 화면 모양: wave 3가 끝나면 gallery(`deno task wireframes`)의 page를 사람이 보고 고른다. lead는 page 주소와 여는 법을 준다.

## lead가 할 일

- merge 때마다 renderer build(`deno run -A packages/shell/renderer/build.ts`)와 `deno task wireframes`를 돌린다.
- 끝나면 고친다:
  - `project-docs/architecture/agent-definition.md`: catalog 절(user 층, 고를 목록, 목록 밖 model 기본값, output 상한), Manage models 문단.
  - `project-docs/products/change-log/0.3.0.md`: 항목을 덧붙인다.
  - `project-docs/products/roadmap/model-info.md`: 이 계획 몫(무엇을 만드나 1·2·4, 단계 1)을 지운다.
