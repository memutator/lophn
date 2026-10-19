# domain-split: 지금 project를 domain으로 바꾸고, 가벼운 project를 새로 두어 N:M으로 잇는다

- **목표:** 앞 계획 넷이 "project"에 붙여 만든 책임 경계를 domain으로 바꾼다. 붙어 있던 것은 kind 파일, 앱, PM, Operator, skill, artifact, grant다.
  - project는 폴더·창·terminal·coding agent·project 지침(`LOPHN.md`)만 가진 가벼운 entity로 새로 둔다.
  - 둘을 N:M 연결로 잇는다.
  - `project_manager`를 Domain Engineer로 바꾼다.
  - 앞 계획들이 남긴 이름(`app_api` 계열, context 말)을 정리하고, domain 문서를 모은다.
- **재료:**
  - `project-docs/products/roadmap/domain.md`: 특히 "project와 domain (2026-10-19 다시 정함)", "폴더", "정한 것"
  - `project-docs/architecture/`의 `kinds.md`, `artifact.md`, `place-session.md`, `agent-definition.md`, `app-call.md`, `coding-agent.md`, `annotation.md`, `workspace-layout.md`, `layers.md`
  - `project-docs/products/AGENT-ROLE.md`, `project-docs/PRODUCT.md`
  - `project-docs/boundary-catalog.yaml`의 `projects`, `kinds`, `apps`
- **범위 밖:**
  - 새 제품 동작. 예외는 project와 domain을 나누는 데 필요한 것뿐이다(연결, 화면, 지침 층).
  - live view
  - e2e 다시 쓰기, eval 자료 다시 만들기. 이 계획 뒤에 따로 연다.
- **돌리는 방식:** worker를 쓴다. orchestrate skill대로 한다. task id는 `ds-`로 시작한다.
- **시작 조건:** 앞 계획 넷과 `rewind-check`가 모두 main에 land하고 닫혔다(main `ecda3b15e` 이후). brief는 지금 main을 보고 쓴다.

## 정한 것

roadmap "정한 것"은 다시 적지 않는다. 아래는 이 계획을 위해 새로 정한 것이다.

- **나누는 선:** 지금 `projects` 한 entity를 둘로 나눈다.

  | domain(지금 project entity의 대부분) | project(새, 가벼움) |
  |---|---|
  | id `dom_`, 이름, 제목, 목적, model 층 | id `prj_`, 이름, 폴더 root·하위 폴더 |
  | kind 파일, 앱(1:1), Domain Engineer, Operator, skill, MCP 설정 층(`extensions.json`), artifact, grant, problem(kind 위반) | 창(workspace layout), terminal, coding agent의 작업 위치, `LOPHN.md` |
  | lophn의 자리 `<data>/domains/<dom>/`(`kinds.yaml`, `DOMAIN.md`, `skills/`, `artifacts/`, `agents/`, `app/`) | 사람의 폴더 |

  - `prj_`를 domain에 다시 쓰지 않는다. 예전 project는 새 project와 뜻이 다르다.
  - 근거: AGENTS.md "호환성"(헷갈리지 않는 깔끔함이 먼저다). 개발 data는 새로 만든다.
- **연결**
  - domain ↔ project는 N:M 표 하나다. 연결과 끊기는 사람만 한다. 권한 결정이기 때문이다(roadmap "project와 domain").
  - domain에 project가 0개여도 된다. 앱 data만 있는 domain이다.
- **file 범위(placeScope)**
  - domain agent는 연결된 project의 폴더(폴더 단위)와 lophn의 자리 가운데 자기 몫을 쓴다. 자기 몫은 Domain Engineer가 `kinds.yaml`·`DOMAIN.md`·`skills/`·`artifacts/`, Operator가 `artifacts/`다.
  - 앱 source는 Domain Engineer가 쓴다. 지금 PM이 쓰는 것과 같다.
  - domain마다 재료 path 목록은 두지 않는다.
  - 상대 경로의 base는 연결된 첫 project의 첫 폴더다. 없으면 `<data>/domains/<dom>`이다.
- **kind glob:** 연결된 project가 하나면 지금처럼 그 project의 폴더 기준이다. 둘 이상이면 `<project 이름>:<glob>`으로 쓴다. project를 붙이지 않은 glob은 첫 project 기준이다.
- **지침 층:** 전역 → 연결된 project의 `LOPHN.md`(여럿이면 차례로) → `DOMAIN.md` → agent 정의 본문이다.
  - `DOMAIN.md`는 Domain Engineer가 file tool로 쓴다. 지식 글이라 Gate에 묻지 않고 rewind로 되돌린다.
  - `LOPHN.md` 쓰기는 지금처럼 설정 고치기로 Gate에 묻는다.
- **place:** `Place`는 `{kind: "domain", id}`다. agent의 home domain이다.
- **role:** id는 `domain_engineer`이고 화면 말은 "Domain Engineer"다. 지침 file 자리(`roles/project-manager/`)도 바꾼다.
- **coding agent:** 맡는 일은 domain의 앱 ticket이다. 그러니 session place는 domain이다. terminal과 작업 폴더는 앱 source가 든 project에 열린다. MCP target은 지금처럼 그 앱이다.
- **화면 말:** "Domain", "Domain Engineer", "Project", "App"이다(사람 결정, roadmap "정한 것").
- **화면 모양(사람이 고른다):** project 창에서 연결된 domain과 그 agent를 어떻게 보이는지, project가 없는 domain을 어디서 여는지, 연결 화면이다.
  - ui-design skill대로 Drafts를 먼저 그리고, 사람이 고른 뒤 renderer로 옮긴다.
- **넘겨받은 이름 정리:** 다음 이름을 정리한다.
  - `domain-tools`가 넘긴 이름은 `tool`로 바꾼다. approval intent kind `app_api`, grant 칸 `app_apis`·`apis`, attestation·desired·probe의 `app_api`, `app_connections[].app_api`, process-wire·broker의 `api`, SDK package `@lophn/cap-app-api`, file 이름 `app-api.ts`·`tools/app-api/`, session `tool_calls.app_api`, 읽기 route `app.app_api`·`app.app_api_index`가 그것이다.
  - agent tool 접두는 `app__<app>__<tool>`에서 `<domain 이름>__<tool>` 꼴로 바꾼다. 정확한 꼴은 brief가 MCP 이름 규칙(1..64자 `[A-Za-z0-9_.-]`)에 맞춰 정한다.
  - `domain-kinds`가 넘긴 것도 정리한다. PRODUCT의 context 말, `.claude/skills/issue/SKILL.md` 주제 목록의 `contexts`, `protocol/lophn-agent/tool-values.ts`의 `context_binding`이 그것이다.
  - artifact 신원은 `{domain, name}`, 자리는 `<data>/domains/<dom>/artifacts/`다. `artifactNameSchema`는 `packages/protocol/projects/values.ts`에 있다.
- **나누는 법:** id·place·role 이름 바꾸기는 package를 건너 type check가 한 번에 맞아야 한다. 계약(protocol)을 먼저 고정할지, codemod task 하나로 할지는 brief가 실제 코드를 보고 정한다. project를 새로 두는 일(registry, 연결, 화면)은 이름 바꾸기 뒤에 영역별로 나눠 병렬로 돈다.

## e2e

- 이 계획은 e2e를 돌리지 않고 새로 쓰지 않는다. `check:full`이 `tests/e2e`도 type check하므로 type을 막는 곳만 기계적으로 고친다.
- land는 `LOPHN_LAND_SKIP_E2E=1 project-docs/plan/tools/lead/land.sh domain-split`로 돈다.
- 손 확인은 일회용 script로 한다(앞 계획들과 같은 방식). 확인할 것은 아래다.
  - project 하나에 domain 둘을 이으면, 각 domain agent의 prompt에 자기 글·kind·skill만 실린다.
  - 두 domain이 같은 폴더를 쓴다.
  - 앱 preview → MCP → activation이 된다.

## lead가 할 일

- **화면 task 전에:** Drafts를 사람에게 보이고 모양을 고르게 한다.
- **merge 때마다:** wording 생성, 등록 file을 고친다.
- **다 끝나면**
  - `project-docs/architecture/domain.md`를 새로 쓴다. project와 domain, N:M 연결, file 범위, 지침 층, place, role을 적는다. `kinds.md`, `artifact.md`를 가리킨다.
  - place-session, agent-definition, app-call, coding-agent, annotation, workspace-layout, kinds, artifact, layers를 고친다.
  - PRODUCT 2절·3절·6절과 AGENT-ROLE 전체(PM → Domain Engineer, project와 domain)를 고친다.
  - `boundary-catalog.yaml`, `module-catalog.yaml`, `context-component-registry.yaml`을 고친다.
  - `products/roadmap/domain.md`는 남은 몫(live view, activation 때 알리기 등)만 남기고 줄인다.
  - changelog 열린 판에 항목을 덧붙인다.
- **사람에게 묻는 것:** 화면 모양, subprocess·Electron test를 새로 만들 때.

## 이 계획 뒤에 할 일

- e2e 다시 쓰기 계획을 연다. 앞 계획들은 e2e를 돌리지 않았고 type만 맞췄다. `issues/agent-call.md`의 "e2e의 PM 줄이 PM 요청을 옛 ae 줄로 보낸다"를 같이 본다.
- eval materials(calendar-app, calendar-app-bug, notify-app)를 새 판으로 다시 만든다. 옛 `app_api` 선언·SDK 이름과 `AGENTS.md.tmpl`의 "App Engineer"가 남아 있다(`project-docs/issues/eval.md`).
- `shell.run`이 file 범위를 거치지 않는 문제를 이슈로 본다(아래 이슈).
