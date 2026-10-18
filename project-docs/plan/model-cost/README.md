# model-cost: 추정 비용을 cache까지 바르게 세고 대화 화면에 합을 보인다

- 목표: call마다 남기는 추정 비용이 cache read·write를 각자 요율로, 두 번 세지 않고 센다. 대화 tab composer 아래에 그 session의 추정 비용 합을 한 줄로 보인다.
- 재료: `project-docs/products/roadmap/model-cost.md`(지금 코드, 선례, 정한 것), `project-docs/architecture/agent-definition.md`(catalog와 user 층), `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
- 범위 밖: roadmap "하지 않는 것"(context 구간 요율, 시간대 요율, 요청당 요금, 기간·agent별 사용량 화면).
- 돌리는 방식: brief 없이 worker 하나를 바로 띄운다. orchestrate skill대로 한다.
- 단위: `tasks/*.md`. task id는 `mc-`로 시작한다.
- 순서: wave 1 `mc-cost` → 사람이 gallery와 `deno task dev`로 확인 → land.
- 시작 조건: 없음. 계획 `model-info`는 main에 land했다.

## 지금 모양

- `estimatedCost`(`packages/core/lophn-agent/usage/cost.ts`)의 `chargedTokens`는 `usage.input + cache_read + cache_write`를 input 요율로 센다. `price_basis.rates[].cache_read`·`cache_write`는 쓰지 않는다.
- OpenAI 계열 adapter(`providers/adapters/chat-completions.ts`, `responses.ts`)는 `cache_in_input: true`로 적는다. `input`에 cache read가 이미 들어 있다는 뜻이다. Anthropic(`messages.ts`)은 `false`다. 그래서 OpenAI 계열은 지금 cache read를 두 번 센다.
- `ReadAgentUsage`(`packages/protocol/lophn-agent/traces.ts`)는 `session` filter와 기간(`from_at`, `through_at`)을 받는다. 결과 `totals[].costs`는 `{ kind, currency, amount, calls }`의 목록이라, 가격 모르는 call 수는 `kind: "unknown"`의 `calls`다. protocol을 바꿀 일이 없다.

## 정한 것

- 비용 합은 대화 tab composer 아래 한 줄이다(사람, roadmap): `$0.0123 · 가격 모름 2`.
- 새 입력 token은 `cache_in_input`이 true면 `input - cache_read - cache_write`(0 아래로 내려가지 않음), false나 null이면 `input` 그대로다(agent). null일 때는 지금과 같이 둔다.
- cache read·write는 각자 요율로 센다. 그 요율이 null이면 input 요율로 센다(agent, roadmap). 지금 계산과 같아 요율이 없는 옛 기록과 어긋나지 않는다.
- 합에 넣는 것은 `kind`가 `estimated`와 `reported`인 USD 금액이다. `subscription`과 `free`는 금액에 넣지 않는다. `unknown`은 "가격 모름 N"으로 센다(agent). 금액이 없고 모르는 call도 없으면 줄을 보이지 않는다.
- 1센트 미만은 소수 넷째 자리까지, 그 위는 둘째 자리까지 보인다(agent, hermes 선례).
- 줄은 그 session의 turn이 끝날 때마다 다시 읽는다. 기간은 session이 열린 때부터 지금까지다(agent).
- 위험 test는 하나다: OpenAI 계열(`cache_in_input: true`)과 Anthropic(`false`)의 같은 usage가 cache를 두 번 세지 않고 각자 요율로 계산된다(agent). 돈 숫자가 사람에게 보이므로 두 번 세기가 다시 생기면 곤란하다.

## 사람이 정할 것

- 화면 모양: gallery page와 `deno task dev`로 사람이 본다.

## lead가 할 일

- merge 때 renderer build와 `deno task wireframes`를 돌린다.
- 끝나면 고친다: `project-docs/architecture/agent-definition.md`(비용을 세는 규칙을 적을 자리가 있으면 그곳, 없으면 catalog 절 끝에 한 줄), `project-docs/products/change-log/0.3.0.md` 항목, `project-docs/products/roadmap/model-cost.md` 지우기.
