# model 비용: cache 요율까지 세고 대화 화면에 합을 보인다

상태: 로드맵. 아직 계획으로 열지 않았다. 2026-10-18 planner와 사람이 정했다. 계획 `model-info`(사람이 custom model 정보와 가격을 적는다)의 뒤를 잇는다.
배경 문서: `project-docs/architecture/agent-definition.md`(catalog와 user 층), AGENTS.md "속도".

## 왜

- 가격은 이제 두 곳에서 온다. catalog model은 models.dev 가격(`price_basis`)을 갖고, custom model은 사람이 Manage models의 정보 form에 적는다(input, output, cache read, cache write, USD per 1M, user 층).
- 그런데 계산이 cache 요율을 쓰지 않고, 계산한 비용을 보이는 화면이 없다. 사람은 얼마를 쓰는지 모른다.

## 지금 코드

- call이 끝날 때 `estimatedCost(usage, price_basis)`(`packages/core/lophn-agent/usage/cost.ts`)가 USD 추정 금액을 `model_calls`에 남긴다(`run-loop/core-ports.ts`, `session/compactor.ts`). 가격이나 token이 없으면 cost kind는 `unknown`이다.
- `chargedTokens`는 cache read·write token을 새 입력과 합쳐 `input` 요율로 센다. `price_basis.rates[].cache_read`·`cache_write`는 쓰지 않는다. context 구간 요율은 무시하고 `rateFor`가 `rates[0]`만 쓴다.
- session·agent별 합은 `ReadAgentUsage`(`packages/protocol/lophn-agent/traces.ts`, `session` filter, 결과 `totals[].costs`는 kind·currency별 합)가 준다. 이것을 읽는 화면은 없다(shell, design에 쓰는 곳 없음. `tests/eval`만 쓴다).

## 선례

opencode(v1.18.35), omp(18.8.7), hermes(v0.21.6)를 소스로 읽었다.

- 셋 다 input, output, cache read, cache write를 각자 요율로 곱해 더한다(opencode `Session.getUsage`, omp `pi-catalog/src/models.ts`, hermes `estimate_usage_cost`).
- hermes는 요율이 없으면 `unknown`과 "n/a"로 두고 합에서 뺀다. opencode와 omp는 0과 모름을 섞어 모르는 model이 "free"로 보인다.
- hermes는 1센트 미만을 소수 넷째 자리(`~$0.0046`)로 보인다. opencode와 omp는 footer에 session 비용을 보인다.

## 무엇을 만드나

- `estimatedCost`가 cache read·write token을 각자 요율로 곱한다. 그 요율이 null이면 지금처럼 input 요율로 센다.
- 대화 tab composer 아래 한 줄에 그 session의 추정 비용 합을 보인다: `$0.0123 · 가격 모름 2`.
  - `ReadAgentUsage`의 `session` filter로 읽는다.
  - 가격을 모르는 call이 있으면 그 수를 함께 보인다(합에서 빠졌다는 뜻).
  - 1센트 미만은 소수 넷째 자리까지 보인다.
  - 구독 call(`subscription`)과 무료 call(`free`)은 합에 넣지 않는다. 보일지는 계획이 화면을 보고 정한다.
- wireframes gallery: 비용 합 한 줄(가격 모름 call 포함, 없음).

## 정한 것

- 비용 합은 대화 tab composer 아래 한 줄이다(사람).
- cache 요율이 없으면 input 요율로 센다(agent). 지금 계산과 같아 옛 기록과 어긋나지 않는다.
- 가격 빈칸은 모름, 0은 무료다(계획 `model-info`).

## 정할 것

없음.

## 단계

계획 하나 `model-cost`로 연다. 끝에 고칠 것: `project-docs/architecture/agent-definition.md`(비용을 적는 곳이 생기면), changelog 열린 판, 이 문서를 지운다.

## 끝남 기준

- 가격을 적은 model의 call은 cache read·write를 각자 요율로 센 추정 비용을 남긴다.
- 대화 화면에 그 session의 합이 보인다. 가격이 빈 model의 call은 "가격 모름"으로 세고 합에 넣지 않는다.

## 하지 않는 것

- context 구간 요율, 시간대 요율, 요청당 요금.
- 기간·agent별 사용량 화면(Settings). `ReadAgentUsage`가 filter를 이미 받으니 필요해지면 만든다.
