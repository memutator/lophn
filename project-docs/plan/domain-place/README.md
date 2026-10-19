# domain-place: 앱을 project 안으로 넣고 place와 role을 하나로 합친다

- 목표:
  - 앱 하나를 project 하나에 묶는다(1:1). 앱 place와 App Engineer를 없애 PM 하나가 project의 문서와 앱을 맡는다.
  - Operator가 skill을 고르게 하고, PM이 project skill을 쓰게 한다.
  - lophn이 project들의 공개 면 지도를 보게 한다.
  - 공개 tool을 바꾸면 쓰는 쪽을 깨운다.
- 재료:
  - `project-docs/products/roadmap/domain.md`: "domain", "MCP server와 경계, 여러 domain을 쓰는 agent", "폴더", "role", "skill", "정한 것"
  - `project-docs/products/AGENT-ROLE.md`(P, A, C, O, L 줄), `architecture/place-session.md`, `architecture/agent-definition.md`, `architecture/app-call.md`, `architecture/annotation.md`, `architecture/coding-agent.md`
  - `project-docs/boundary-catalog.yaml`의 `projects`, `apps` 아래 경계. `module-catalog.yaml`의 `packages/core/agent-roles`, `packages/core/lophn-agent`, `packages/core/apps`
- 범위 밖:
  - 이름 바꾸기(project → domain, `project_manager` → Domain Engineer, 경로 `projects/` → `domains/`). 계획 `domain-rename`이 한다. 이 계획에서 PM의 role id는 `project_manager` 그대로 두고 App Engineer의 일을 더한다.
  - tool 선언 모양과 호출 길, project 범위(`project_scope`) 지우기. 계획 `domain-tools`가 한다.
  - context와 kind. 계획 `domain-kinds`가 한다.
  - artifact. 계획 `artifact`가 한다.
  - live view. e2e는 아래 "e2e" 절을 따른다.
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다. task id는 `dp-`로 시작한다.
- 단위와 순서: `tasks/*.md`가 정한다.
  - wave 1:
    - `dp-app-project`: 앱의 project 칸, 앱 만들기, 저장 자리 helper
    - `dp-project-folderless`: folder 0개 project
  - wave 2:
    - core: `dp-agents-core`, `dp-place-events`, `dp-agent-roles-scope`, `dp-agent-roles-prompt`, `dp-operator-skills`, `dp-storage-apps`, `dp-problems-core`
    - shell: `dp-shell-app-space`, `dp-shell-agents`, `dp-shell-launcher`
    - 그 밖: `dp-coding-text`, `dp-eval`
    - 마지막: `dp-place-protocol`(다른 wave 2 task 모두 뒤에 정리)
  - wave 3:
    - `dp-usage-read`, `dp-lophn-map`, `dp-package-owner`, `dp-public-event`
    - `dp-release-guard`, `dp-public-filter`, `dp-grants-public-ui`, `dp-roles-public`
- **계획 사이 문(status.py가 보지 않는다. lead가 planner의 말을 기다린다)**
  - **wave 3 전체:** `domain-tools` wave 1(`dt-decl`, `dt-call-route`)이 main에 land한 뒤 연다. `public` 칸과 invocation operation 모양을 읽는다.
  - **`dp-storage-apps`, `dp-problems-core`:** 위와 같은 때에 연다. `dt-call-route`가 preview adapter, runtime entrypoint, `wiring/apps.ts`, `control.ts`, `routes.ts`를 크게 고치므로 그 뒤에 자리를 옮기는 편이 충돌이 적다.
  - **`dp-shell-launcher`:** 사람이 folder 0개 등록을 허용으로 정했다. 문이 열렸다.
- 시작 조건: 없다. wave 3만 위의 조건이 있다. 계획 `domain-kinds`, `domain-tools`, `artifact`와 같이 돈다.

## 정한 것

roadmap "정한 것"(앱 place를 두지 않는다, 재사용은 package, home domain 하나, 경계를 넘는 판단은 lophn)은 다시 적지 않는다. 아래는 이 계획에서 새로 정한 것이다.

- **앱과 project**
  - 앱 record에 project 칸이 생긴다. 필수이고, project 하나에 앱 하나다.
  - 앱을 만들 때 project를 고른다. 맞는 project가 없으면 lophn이 사람에게 project를 만들자고 묻는다(`ask`). project 등록은 지금처럼 사람만 한다(`project.create`의 actor는 `user`).
  - 근거: 앱 data의 경계를 core가 지키려면 앱이 어느 project 것인지가 data에 있어야 한다. 지금은 `source_path`가 project 폴더 안에 있는지로만 이어진다(`tools/context/visible.ts`의 `projectOfApp`).
- **folder 0개인 project:** 앱 data만 있는 project를 위해 사람의 폴더 없이 등록할 수 있게 한다(사람이 정했다, 2026-10-19). 그 project의 `LOPHN.md`는 lophn data 자리(`<data>/projects/<prj>/LOPHN.md`)에 둔다.
- **앱 저장 자리:** `<data>/apps/<app>/`를 `<data>/projects/<prj>/app/` 아래로 옮긴다. 대상은 data, release 사본, 기본 source 자리다. 사람이 이은 source 폴더는 그대로 둔다. 개발 data는 새로 만든다.
- **place:** `Place`는 project 하나다(`packages/protocol/lophn-agent/places.ts`). 앱 place, 앱 place의 Operator, App Engineer 정의 자리는 지운다.
- **PM이 App Engineer의 일을 맡는다**
  - 맡는 일: ticket, blueprint, release, problem 상태, package publish, source 연결, 앱 Operator 만들기.
  - AGENT-ROLE의 A 줄을 C 줄로 옮긴다.
  - 그래서 PM에게 붙는 것: role tool 목록, file 범위(project 폴더 + 앱 source + lophn data의 project 층 file), 지침(`roles/project-manager/prompt.md`에 `roles/app-engineer/prompt.md`를 합친다), reaction(problem 열림, activation 실패, ticket 완료, annotation)이 여는 session.
- **annotation:** 앱 화면 annotation을 받는 쪽은 그 앱의 project PM이다. artifact annotation은 계획 `artifact`가 맡는다. `core/apps/annotations/send.ts`를 두 계획이 고친다.
- **Operator skill**
  - agent 정의의 `skills_off`를 `skills`(고른 이름 목록)로 바꾼다. 비어 있으면 그 project의 skill을 다 받는다.
  - prompt의 skill 목록에는 받은 skill만 싣는다(roadmap "skill").
- **project skill 쓰기:** project 층 skill 폴더(`agent-roles/place/project-layer.ts`가 가리키는 자리)를 PM의 file 범위에 넣는다. 지금은 file tool이 닿지 않는다(`agent-roles/hooks.ts:7`).
- **lophn 지도**
  - lophn의 place 정보에 project마다 다음을 싣는다: 이름, 목적, 앱의 공개 tool(`public` 칸), 설치한 package, 다른 project가 쓰는 공개 tool(사용 관계).
  - program이 결정적으로 만든다.
  - 사용 관계는 grant와 invocation 기록(부른 session의 place)에서 뽑는다.
- **다른 project의 tool**
  - 다른 project의 agent에게는 `public` tool만 grant할 수 있고 보인다.
  - 같은 project의 agent는 다 본다.
- **공개 tool을 바꾸는 release**
  - 다른 project가 쓰는 공개 tool을 지운 release는 막는다.
  - 바꾼 것(input·output schema, effect)은 쓰는 project의 PM을 깨운다. 자기 project의 PM도 깨워 skill을 다시 보게 한다(roadmap "skill").
- **package 주인**
  - package를 publish한 앱의 project가 주인이다.
  - package 읽기에 주인 project를 싣는다. 다른 project에서 난 bug를 주인 PM에게 넘기는 것은 지침이다(program이 하지 않는다).
- **brief를 쓰며 정한 것**(brief worker, planner 검토)
  - **PM 자격의 `conditions.app`**
    - PM 자격에 `conditions.app`(그 project의 앱)을 싣는다. turn마다 자격을 낼 때 wiring이 정한다.
    - 지금 "자기 앱" 검사(ticket, problem, annotation, publish, source 연결)가 모두 이 칸을 본다.
    - 그래서 PM이 `target-authorization.ts`의 app-bound 제한(context·document 대상)을 받는다. `domain-kinds`가 context를 지우기 전에 이것이 land하면 그 사이 PM의 context 읽기가 막힌다. 받아들인다(context는 지워진다).
  - **앱 만들기:** `apps`는 `projects`를 import하지 못한다(`architecture/layers.md`). 그래서 project 확인은 lead가 잇는 tx port로 한다.
  - **project unique:** 보관한 앱도 포함한다.
  - **저장 자리:** helper는 `packages/protocol/apps/app-storage.ts` 하나다. 보호 root는 `<data>/projects`가 된다. agent runtime sandbox의 `draftRoot`(`<data>/projects`)는 앱 data를 덮게 되므로 좁힌다(`dp-agent-roles-scope`).
  - **coding agent:** app으로 가리키는 target(`{role: "coding_agent", app}`)을 그대로 쓴다. coding session의 place는 앱의 project다.
  - **Operator `skills`:** `skills_off`를 `skills`로 바꾸는 것은 공용 agent 정의 schema다. 그래서 lophn과 PM 정의도 쓴다. 전역과 project 층의 `skills_off`는 그대로 둔다.
  - **지우는 순서:** `Role`과 `Place`는 마지막 정리(`dp-place-protocol`)까지 넓게 둔다. 그 전 task는 `app_engineer` stub을 둔다.
  - **project skill 폴더:** PM 범위에 들어간다. `ensureProjectManager`가 폴더를 만든다. folder 0개 project의 `LOPHN.md`는 PM 범위 밖이다. 사람이 editor로 고친다.
  - **release guard**
    - `judge`와 `activationStart`에서 본다.
    - 막는 것은 새 machine command `activation.block`이다. 오류를 내는 command는 event를 되돌리기 때문이다.
  - **`PublicToolsChanged` event:** project마다 하나이고 `new_work`다. 대상은 아래다.
    - 자기 project: tool이 바뀔 때
    - 쓰는 project: 공개 tool이 바뀌거나 지워질 때
    - 막혔을 때: 자기 project만
  - **package 주인:** 처음 publish한 앱의 project다. 다른 project의 다음 판 publish는 거절한다.
  - **launcher 앱 카드:** project 이름을 보인다.
- **test(AGENTS.md "속도")**
  - 위험 test: PM의 file 범위가 자기 project 밖(다른 project의 앱 source, data)으로 나가지 않는다. 다른 project의 비공개 tool이 agent tool 목록에 없다. 다른 project가 쓰는 공개 tool을 지운 release가 막힌다.
  - 지운 role과 place의 test는 지운다.

## e2e

- 이 계획은 e2e를 돌리지 않고 새로 쓰지 않는다. `check:full`이 `tests/e2e`도 type check한다. 그래서 type check를 막는 곳만 입력 모양을 기계적으로 고친다. 돌리지는 않는다.
- land는 `LOPHN_LAND_SKIP_E2E=1 project-docs/plan/tools/lead/land.sh domain-place`로 돈다.

## 같이 도는 계획

`domain-kinds`(`dk-`), `domain-tools`(`dt-`), `artifact`(`af-`)가 같이 돈다. 겹치는 file은 아래 표와 같다.
- running task끼리는 `status.py ready`가 가른다.
- land의 rebase 충돌은 두 쪽을 다 남긴다.
- 계획 사이 순서나 계약이 걸리면 planner session `lophn-7e`에게 SendMessage로 묻는다.

| file | 겹치는 계획 |
|---|---|
| `packages/core/agent-roles/place/place-data.ts`, `place-info.ts` | `domain-kinds`(kind 글), `artifact`(artifact 목록) |
| `packages/core/agent-roles/place/place-folders.ts` | `domain-kinds`(`kinds.yaml`), `artifact`(`artifacts/`) |
| `packages/core/agent-roles/tool-lists.ts` | `domain-kinds`, `domain-tools` |
| `packages/protocol/lophn-agent/agent-values.ts`, `operators.ts`, `packages/core/lophn-agent/agents/*` | `domain-kinds`(`contexts` 칸 지움) |
| `packages/core/events/reactor/session-opening.ts` | `domain-kinds`(위반 reaction) |
| `packages/core/apps/annotations/send.ts` | `artifact` |
| `packages/core/lophn-agent/tools/app-tools.ts`, `app-toolkit.ts` | `domain-tools`가 소유한다. 공개 tool 거르기는 이 file 밖에서 하거나 `domain-tools` 뒤로 미룬다 |
| `packages/protocol/apps/blueprint/*` | `domain-tools`가 소유한다. 이 계획은 `public`을 읽기만 한다 |
| shell sidebar·launcher·`renderer/app-frame/agent-select.tsx`·`app-agents.ts`·agents editor | `domain-kinds`(contexts 화면 지움), `artifact`(artifact 목록), `domain-tools`(app-frame bridge 쪽) |
| `packages/core/agent-roles/roles/*/prompt.md`, guides | `domain-kinds`(내장 skill, prompt의 kind 글), `artifact`(`af-guide`) |
| `packages/core/apps/agent-tools/app.ts` | `domain-tools`(`dt-agent-tools`) |
| `packages/core/apps/{preview,releases,control.ts,routes.ts}`, `core/main/daemon/wiring/{apps,router,coding-sessions}.ts` | `domain-tools`(`dt-call-route`, `dt-preview-call`, `dt-mcp-endpoint`), `artifact`(`af-annotation-receiver`) |
| `packages/core/problems/**` | `domain-kinds`(kind 위반 problem), `domain-tools`(`dt-examples`) |
| `packages/protocol/events/domain.ts`, `protocol/approvals/grants.ts`(reaction 목록) | `domain-kinds`(위반 event). rebase 때 두 쪽을 다 남긴다 |
| `packages/design/wording/catalog/*` | 모두 |
| `tests/eval/*`, `tests/support/*` | 모두. App Engineer와 PM 시나리오는 이 계획이 고친다 |

- **`dt-invocation-project`:** invocation의 `session` 칸을 남겨야 한다. `dp-usage-read`가 그 칸을 읽는다.
- **context를 지우는 순서:** `dp-place-protocol`과 `dp-agent-roles-scope`는 `domain-kinds`가 지우는 file(`tool-lists.ts`, `credentials.ts`, `tools/context*`)을 고친다. `domain-kinds`가 먼저 land했으면 그 위에서 고친다.

- **runtime 쓰기 권한:** `domain-kinds`와 `domain-place`가 agent runtime의 `<data>/projects` 쓰기(`draftRoot`)를 좁힌다. 그러니 그 넓은 권한에 기대지 않는다. 이 계획의 자리(`artifacts/`, project skill 폴더)는 runtime 쓰기 목록에 따로 더한다. 먼저 land한 쪽 위에서 맞춘다.

## lead가 할 일

- **wave 2를 띄우기 전에:** 앱 record의 project 칸과 앱 만들기 흐름이 brief와 같은지 본다.
- **wave 3를 띄우기 전에:** planner(`lophn-7e`)에게 `domain-tools`의 계약 task가 land했는지 묻는다.
- **merge 때마다:** wording 생성과 등록 file(`protocol/**/mod.ts`, core wiring)을 고친다.
- **다 끝나면**
  - `architecture/place-session.md`를 고친다. place는 project 하나이고, role 수, file 범위 표가 바뀐다.
  - `architecture/agent-definition.md`를 고친다. Operator `skills`와 lophn 지도를 적는다.
  - `architecture/app-call.md`와 `annotation.md`의 받는 쪽을 고친다.
  - AGENT-ROLE을 고친다. A 줄을 C 줄로 옮기고, P 줄과 L 줄을 고친다.
  - PRODUCT의 role 표를 고친다.
  - `architecture/eval.md`(`scenarios/app-engineer/`가 없어진다), `.claude/skills/eval-run`, `.claude/skills/eval-experiment`의 App Engineer 문구를 고친다.
  - changelog 열린 판에 항목을 덧붙인다.
  - worker 보고의 "무겁게 짠 것"과 "알려진 미완 동작"은 `issue` skill대로 올린다.
- **사람에게 묻는 것:** 사람이 project를 만드는 흐름(화면)을 바꿔야 할 때. subprocess·Electron test를 새로 만들 때.
