# domain-entity: domain을 project와 app 안의 entity로 두고, role과 place를 예전대로 되돌린다

- **목표:** 계획이 할 일은 넷이다.
  - domain을 project나 app 하나에 속하는 entity(`dom_`)로 둔다. 지금 project에 붙은 kind 파일, skill, artifact를 domain으로 옮기고 `DOMAIN.md`를 더한다.
  - 계획 `domain-place`가 합친 것을 되돌린다. App Engineer를 PM에서 다시 나누고, app place를 되살리고, 앱과 project의 1:1을 푼다.
  - Operator가 domain을 골라 좁히게 한다. 앱 tool에 domain을 적게 한다. domain 사이 장치(공개 tool, release guard, 깨우기, lophn 지도)의 단위를 "project 사이"에서 "domain 사이"로 맞춘다.
  - 앞 계획들이 남긴 이름(`app_api` 계열, context 말)을 정리하고 문서를 모은다.
- **재료:**
  - `project-docs/products/roadmap/domain.md`(이 계획의 근거. "모양"과 "정한 것")
  - architecture: `kinds.md`, `artifact.md`, `app-call.md`, `place-session.md`, `agent-definition.md`, `annotation.md`, `coding-agent.md`, `activation.md`, `layers.md`, `workspace-layout.md`
  - 되돌릴 것의 본보기: 계획 `domain-place` 전의 코드. main `ecda3b15e` 이전 기록의 `packages/core/agent-roles/roles/app-engineer/`, app place, App Engineer 정의·tool 목록·reaction, `<data>/apps/<app>/` 자리. 그 계획의 changelog 항목은 `project-docs/products/change-log/0.5.0.md`의 "앱을 project 하나에 묶고…"다.
  - `project-docs/products/AGENT-ROLE.md`, `project-docs/PRODUCT.md`
- **범위 밖:**
  - 새 제품 동작. 예외는 domain을 두고 되돌리는 데 필요한 것뿐이다.
  - e2e 다시 쓰기, eval 자료 다시 만들기. 이 계획 뒤에 연다.
- **돌리는 방식:** worker를 쓴다. orchestrate skill대로 한다. task id는 `de-`로 시작한다.
- **시작 조건:** 열린 다른 계획이 없다. brief는 지금 main을 보고 쓴다.

## 정한 것

roadmap "정한 것"은 다시 적지 않는다. 아래는 이 계획을 위해 새로 정한 것이다.

- **domain entity**
  - id `dom_`, 이름, 제목, 목적, owner(`{kind: "project" | "app", id}`) 하나다. owner를 바꾸는 길은 두지 않는다.
  - lophn의 자리는 `<data>/domains/<dom>/`(`kinds.yaml`, `DOMAIN.md`, `skills/`, `artifacts/`)다.
  - 지금 `<data>/projects/<prj>/`에 있는 `kinds.yaml`, skill 폴더, `artifacts/`는 domain 자리로 옮긴다. project 자리에는 `LOPHN.md`(폴더 0개 project), agent 정의, `extensions.json`이 남는다.
- **domain을 만드는 쪽:** PM과 App Engineer가 자기 그릇 안에 만들고, 사람도 만든다. route 이름은 `domain.create`·`domain.list`·`domain.get`이다(정확한 꼴은 brief가 지금 route 관례에 맞춘다).
- **앱의 domain:** 앱을 만들 때 앱 이름의 domain을 하나 같이 만든다. 앱의 domain이 0개가 되는 길은 두지 않는다. 마지막 domain은 보관하지 못한다.
- **되돌리기(예전 모양으로)**
  - role: `app_engineer`를 되살린다. 지침(`roles/app-engineer/prompt.md`), tool 목록, 자격, reaction(problem 열림, activation 실패, ticket 완료, 앱 annotation), coding 보고 받는 쪽이 대상이다. PM에서는 App Engineer 일을 뺀다.
  - place: `Place`를 project | app으로 되돌린다. app Operator, app 화면의 agent 고르기(title bar), app 층 지침을 되살린다.
  - 앱: `app.project` 칸과 1:1 규칙을 지운다. 저장 자리를 `<data>/apps/<app>/`로 되돌린다. 계획 `domain-tools`의 preview 고침(폴더 안 쓰기만, `..` 거절)은 살린다.
  - coding: session place는 app이다. terminal은 app space에 열린다(예전대로).
  - **되살리되 예전과 다른 점:** 이번 계획들이 바꾼 것은 그대로 둔다. 예를 들어 App Engineer 지침의 app-api 말은 tool로, examples 안내는 "write tool은 examples check로"로 둔다. `git show`로 옛 코드를 보되 그대로 붙이지 않는다.
- **Operator 좁히기**
  - agent 정의에 `domains`(그 그릇의 domain id 목록, 비면 전부)를 둔다.
  - `skills`는 고른 domain의 skill 가운데서 고른다(비면 전부).
  - prompt에는 고른 domain의 `DOMAIN.md`, kind 글, skill만 싣는다. tool 목록에는 고른 domain의 앱 tool과 grant 받은 다른 domain의 공개 tool만 싣는다.
- **PM·App Engineer prompt:** 자기 그릇의 domain을 모두 싣는다(`DOMAIN.md`, kind 글). 예산을 넘으면 이름과 한 줄로 줄인다(지금 context 글 예산과 같은 방식).
- **지침 층:** 전역 → project의 `LOPHN.md`(app 그릇이면 없다) → domain의 `DOMAIN.md`(맡은 domain만) → agent 정의 본문이다. `DOMAIN.md`는 맡은 agent(PM·App Engineer·그 domain을 고른 Operator 가운데 쓰기 권한이 있는 쪽)가 file tool로 쓰고, Gate에 묻지 않는다.
- **앱 tool의 domain**
  - blueprint tool 선언에 `domain`(그 앱의 domain 이름) 칸을 더한다. 필수다.
  - release 준비 검사는 없는 domain을 거절한다.
- **domain 사이 장치:** 계획 `domain-place`가 "project 사이"로 만든 것의 단위를 "domain 사이"로 바꾼다. 다른 domain의 비공개 tool 거르기, 공개 tool을 지운 release 막기(`activation.block`), `PublicToolsChanged`, lophn 지도(`app.usage`), package 주인이 대상이다.
  - 사용 관계는 부른 agent가 고른 domain(또는 그릇)과 tool의 domain으로 센다.
- **kind 파일:** domain마다 하나다. glob은 그 domain 그릇의 폴더 기준이다. app 그릇이면 그 앱 source 폴더 기준이다. 내장 tool `kind.list`·`kind.check`는 부른 agent가 맡은 domain의 kind만 본다. domain이 여럿이면 입력으로 domain을 받는다.
- **artifact:** 신원은 `{domain, name}`, 자리는 `<data>/domains/<dom>/artifacts/`다. 받는 쪽 fallback은 그 domain 그릇의 PM이나 App Engineer다.
- **넘겨받은 이름 정리(앞 계획들이 넘김)**
  - `domain-tools`가 넘긴 이름은 tool로 바꾼다.
    - approval intent kind `app_api`
    - grant 칸 `app_apis`·`apis`
    - attestation·desired·probe의 `app_api`
    - `app_connections[].app_api`
    - process-wire·broker의 `api`
    - SDK package `@lophn/cap-app-api`
    - file 이름 `app-api.ts`·`tools/app-api/`
    - session `tool_calls.app_api`
    - 읽기 route `app.app_api`·`app.app_api_index`
  - agent tool 접두 `app__<app>__<tool>`은 domain이 보이는 이름으로 바꾼다(MCP 이름 규칙 1..64자 `[A-Za-z0-9_.-]`). 꼴은 brief가 정한다.
  - `domain-kinds`가 넘긴 것: PRODUCT의 context 말, `.claude/skills/issue/SKILL.md` 주제 목록의 `contexts`, `packages/protocol/lophn-agent/tool-values.ts`의 `context_binding`(eval fixture만 쓴다)
  - `artifactNameSchema`는 `packages/protocol/projects/values.ts`에 있다.
- **화면**
  - project 창과 app space에서 그 그릇의 domain을 보이고 만드는 곳
  - Operator 편집에서 domain 고르기
  - artifact 목록이 domain 단위가 되는 것
  - ui-design skill대로 Drafts를 먼저 그리고, 사람이 고른 뒤 renderer로 옮긴다.
- **나누는 법:** 되돌리기(role, place, 앱 자리)와 domain entity(protocol, registry)는 계약이 얽힌다. 계약을 먼저 고정하고 영역별로 나눌지, 큰 task 하나로 할지는 brief가 실제 코드를 보고 정한다. 병렬을 최대로 한다.

## e2e

- 이 계획은 e2e를 돌리지 않고 새로 쓰지 않는다. `check:full`이 `tests/e2e`도 type check하므로 type을 막는 곳만 기계적으로 고친다.
- land는 `LOPHN_LAND_SKIP_E2E=1 project-docs/plan/tools/lead/land.sh domain-entity`로 돈다.
- 손 확인은 일회용 script로 한다(앞 계획들과 같은 방식). 확인할 것은 아래다.
  - project에 domain 둘을 두고 Operator가 하나만 고르면, prompt와 tool 목록에 그 domain 것만 실린다.
  - 앱 ticket → coding agent(app space) → preview → MCP → activation이 된다. 보고는 App Engineer가 받는다.
  - 다른 그릇 domain의 공개 tool을 grant로 부를 수 있고, 비공개 tool은 보이지 않는다.

## lead가 할 일

- **화면 task 전에:** Drafts를 사람에게 보이고 모양을 고르게 한다.
- **merge 때마다:** wording 생성, 등록 file을 고친다.
- **다 끝나면**
  - `project-docs/architecture/domain.md`를 새로 쓴다. 그릇과 domain, owner, 지침 층, Operator 좁히기, 앱 tool의 domain, domain 사이 장치를 적는다. `kinds.md`, `artifact.md`를 가리킨다.
  - place-session, agent-definition, app-call, coding-agent, annotation, kinds, artifact, activation, layers를 고친다. `layers.md`의 core 층 이름 "domain"(projects·apps·problems)이 새 domain과 부딪히면 다른 말로 고친다.
  - PRODUCT 2절·3절·6절과 AGENT-ROLE를 고친다. A 줄을 되살리고, domain을 적는다.
  - `boundary-catalog.yaml`, `module-catalog.yaml`, `context-component-registry.yaml`을 고친다.
  - changelog `0.5.0`에 항목을 덧붙인다.
  - worker 보고의 "무겁게 짠 것"과 "알려진 미완 동작"은 `issue` skill대로 올린다.
- **사람에게 묻는 것:** 화면 모양, subprocess·Electron test를 새로 만들 때.

## 이 계획 뒤에 할 일

- e2e 다시 쓰기 계획을 연다. 앞 계획들은 e2e를 돌리지 않았고 type만 맞췄다. `issues/agent-call.md`의 "e2e의 PM 줄이 PM 요청을 옛 ae 줄로 보낸다"는 App Engineer가 되살아나며 바뀐다. 다시 본다.
- eval materials(calendar-app, calendar-app-bug, notify-app)를 새 판으로 다시 만든다. 옛 `app_api` 선언·SDK 이름이 남아 있다(`project-docs/issues/eval.md`).
