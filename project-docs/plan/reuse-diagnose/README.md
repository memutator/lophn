# reuse-diagnose: 재사용할 것을 찾는 길과 진단 근거를 여는 길

- 목표:
  - lophn과 App Engineer가 재사용할 것(내장 SDK, 다른 앱의 app-api)을 찾을 수 있게 한다.
  - 앱이 외부 network, secret, 허락된 경로의 file을 쓸 수 있게 한다(cap 셋).
  - agent가 problem의 근거 본문을 읽을 수 있게 한다.
  - agent가 고치지 않은 problem을 닫지 못하게 한다.
  - ticket을 App Engineer가 쓴 app-api 예시로 검증하게 한다.
- 재료:
  - `project-docs/issues/reuse.md`: 세 이슈 모두
  - `project-docs/issues/problems.md`
    - "agent가 보고의 message, details, stack, log 본문을 읽을 길이 없다"
    - "고친 release 없이 resolved로 바꾸면 같은 release의 새 발생이 묻힌다"의 program 쪽
  - `research/reuse-and-materials.md` Part 1, `research/observations-and-diagnosis.md`
  - `project-docs/architecture/app-call.md`, `project-docs/architecture/activation.md`, `project-docs/architecture/agent-definition.md`
- 범위 밖:
  - eval의 재사용·진단 시나리오. 그것은 `project-docs/products/roadmap/eval.md`의 다음 계획이다.
  - observation 지침과 template의 `withStore`. 계획 `prompt-text`가 한다.
  - `package.publish`와 앱끼리 call(`app_connections`)의 첫 E2E. 이번에 고치는 길이 아니다.
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다.
- 단위: `tasks/*.md`의 "단위"가 정한다. task id는 `rd-`로 시작한다.
- 순서: brief의 wave가 정한다.
- 시작 조건: 계획 `prompt-text`가 main에 land한 뒤. 둘이 같은 file을 고친다: role 지침(`packages/core/agent-roles/roles/**`), coding agent skill(`packages/coding-agent/guides/**`), 앱 template(`packages/core/apps/packages/template/**`).

## 정한 것

- 내장 SDK:
  - `package.list`와 `package.get`이 catalog 뒤에 설치 사본의 내장 SDK도 돌려준다(이름, 판, `guide.md`).
  - catalog에는 등록하지 않는다. 앞서 정한 "catalog는 @me 몫, 내장 sdk는 설치 사본이 정본"과 맞추려는 것이다(agent, 이슈 추천).
- 다른 앱의 app-api:
  - `app.app_api`를 감싼 read tool 하나를 lophn과 App Engineer의 tool 목록에만 넣는다(사람).
  - lophn과 App Engineer 지침에 이 tool을 쓰라는 줄을 더한다.
  - App Engineer의 자격은 자기 앱으로 묶여 있어 다른 앱의 목록도 app-api도 못 읽는다. 사람의 결정대로, 모든 앱의 목록(이름, 설명)과 각 앱의 app-api 목록만 읽게 넓힌다. 다른 앱의 source, problem, ticket은 넓히지 않는다(agent).
- cap 셋을 살린다(사람). 다만 셋의 core 쪽 사정이 다르다(`project-docs/issues/reuse.md`).
  - fs: `deno.json`(판 1.0.0)을 두고 coding agent skill의 SDK 목록에 더한다. 바로 한다.
  - net과 secret도 이번에 한다(사람). 구현은 `project-docs/issues/reuse.md`의 정한 것대로 한다: supervisor에 host 없는 net, 목적지 검사는 broker, loopback 목적지는 http, secret 전달 adapter. 확인은 앱 E2E 한 행이다.
- 보고 본문: 이슈의 넷을 다 한다(agent, 이슈 추천).
  - `problem.get`의 latest에 보고 message 앞부분을 싣는다.
  - log 본문을 `problems.report_body`로 읽는 길을 App Engineer tool과 coding agent의 `problem more`에 더한다.
  - details field를 더한다.
  - tool 설명을 고친다.
- resolved(사람):
  - agent 자격으로 resolved로 바꾸려면, 마지막 발생의 release보다 뒤에 activate된 active release가 있어야 한다.
  - 사람은 지금처럼 바꿀 수 있다.
  - 고친 release 없이 닫을 일(예: 설정을 바꿔 고친 것)은 agent가 사람에게 묻는다.

- ticket 검증(사람, `project-docs/issues/coding-agent.md`의 "`test_command` check…"):
  - App Engineer가 ticket에 app-api 입력과 기대 결과의 예시를 적는다.
  - program이 준비된 release에 그 예시를 불러 비교한다. 맞아야 `ticket.verify`가 통과한다.
  - coding agent는 예시를 고치지 못한다.
  - `test_command`는 protocol, core, skill에서 지운다.
  - App Engineer 지침과 coding agent skill을 이에 맞춘다.
  - 새 runner를 만들지 않는다. app test runner가 앱을 격리 사본에서 부르는 길을 다시 쓴다.

## 사람이 정할 것

없음.

## lead가 할 일

- merge 때마다 다음을 한다.
  - 새 tool이 생기면 `packages/core/agent-roles/tool-lists.ts`의 role 목록과 tool 수를 확인한다.
  - SDK가 늘면 `packages/core/apps/packages/install.ts`가 boot 때 까는지 core 기동(`lead/boot.sh`)으로 본다.
- 끝나면 다음을 한다.
  - 닫은 이슈를 `project-docs/issues/archived/`로 옮긴다.
  - `project-docs/products/change-log/0.3.0.md`에 항목 하나를 덧붙인다.
  - `project-docs/architecture/app-call.md`(cap 셋)와 `project-docs/architecture/agent-definition.md`(tool 목록)를 맞춘다.
  - `project-docs/products/roadmap/eval.md`의 "찾은 빈틈"에서 고친 줄을 지운다.
