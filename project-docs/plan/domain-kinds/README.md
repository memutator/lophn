# domain-kinds: context를 지우고 kind 파일과 내장 tool로 바꾼다

- 목표: project의 context(계약 bundle, 선언 search, 판, 위반)를 지운다. 그 자리에 다음을 둔다.
  - project마다 kind 파일(`kinds.yaml`) 하나
  - 그 파일로 문서를 읽는 pipeline(추출, 검사, index, watch)
  - 내장 tool `list`·`check`, file tool `file.outline`
  - 문서 위반은 problem으로 올린다
- 재료:
  - `project-docs/products/roadmap/domain.md`: "재료 schema: kind와 item", "내장 tool", "outline", "context에서 무엇이 어디로 가나", "정한 것"
  - `project-docs/issues/contexts.md`(이 계획에서 닫는다)
  - `project-docs/architecture/agent-definition.md`(prompt 조립, context 글), `architecture/event.md`, `architecture/place-session.md`(file 범위)
  - `project-docs/boundary-catalog.yaml`의 `projects`, `contexts`. `project-docs/module-catalog.yaml`의 `packages/core/projects`
- 범위 밖:
  - 이름 바꾸기(project → domain, `project_manager` → Domain Engineer). 계획 `domain-rename`이 한다. 이 계획은 지금 이름을 쓴다.
  - kind 파일의 자리를 `<data>/domains/…`로 옮기기. 지금은 `<data>/projects/<prj>/kinds.yaml`이다.
  - 다른 project의 kind를 가리키는 `ref`. pdf에서 값이나 목차를 뽑기.
  - e2e. 아래 "e2e" 절을 따른다.
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다. task id는 `dk-`로 시작한다.
- 단위와 순서: `tasks/*.md`가 정한다. 큰 줄기는 아래와 같다.
  - wave 1: 계약. kind 파일 schema, `list`·`check` 입출력, kind 위반 problem의 모양
  - wave 2: 셋을 같이 한다.
    - core pipeline(context worker의 추출·검사·index·watch를 줄여 옮긴다)
    - agent tool과 prompt
    - problem 연결
  - wave 3: context 지우기(core, protocol, shell, wording, eval 자료), 내장 skill, 문서
- 시작 조건: 없다. 계획 `domain-tools`, `domain-place`, `artifact`와 같이 돈다.

## 정한 것

roadmap "정한 것"은 다시 적지 않는다. 아래는 이 계획에서 새로 정한 것이다.

- **자리:** kind 파일은 `<data>/projects/<prj>/kinds.yaml`이다. 지금 project 층 file(`extensions.json`, skills)이 있는 lophn data 자리다. PM이 `file.write`로 고치고, rewind된다.
  - PM의 file 범위에 이 파일 하나를 더한다(`agent-roles/place/place-folders.ts`의 `placeScope`).
  - Deno 권한 목록도 같은 표로 만든다(`architecture/place-session.md`).
- **판 없음:**
  - 파일이 바뀌면 검사한다. 맞으면 바로 쓴다. 틀리면 problem을 올리고 앞의 맞던 것을 쓴다.
  - context의 draft·bundle·check·rollback 표와 route는 옮기지 않고 지운다.
- **kind 파일이 없는 project:** kind가 없다. `list`는 `not_found`를 낸다. prompt에는 kind 절이 없다.
- **Operator:** 그 project의 kind를 다 받는다. agent 정의의 `contexts` 칸과 그 검사(`validate.ts`의 `missing_reference`/`archived_reference`)를 지운다.
- **prompt:** context 글 자리에 kind 글(kind 이름, 한 줄, glob, key, 칸 이름과 type)을 싣는다. 판이 바뀐 notice(`contexts_changed`)는 kind 파일이 바뀐 notice로 바꾼다.
- **위반:** 위반은 problem이다. 지금 problem은 app 칸이 필수다(`packages/protocol/problems/problem-record.ts:44`). project의 kind 위반을 담는 모양은 wave 1 계약 task가 정한다.
  - 새 위반이 생기면 지금처럼 그 project의 PM session을 열고 toast로 알린다(AGENT-ROLE E5).
- **context worker의 쓸 수 있는 코드:** 추출(frontmatter, yaml, path capture), 칸 검사, index, watch, 조건·정렬(`contexts/search/where.ts`, `sort-page.ts`), worker process. 이것들은 지우지 않고 kind module로 옮겨 줄인다. 무엇을 남길지는 brief가 실제 코드를 보고 정한다.
- **`file.outline`:** `packages/protocol/projects/outline-markdown.ts`의 `parseOutline`을 쓴다. file tool 묶음(`packages/core/lophn-agent/tools/bundles/file.ts`)에 더한다.
- **화면:** context 화면(contexts tab, context tab, search tab, document의 "이 문서를 담은 context", 위반 chip)은 지운다. kind 파일은 editor로 연다. 위반은 problem 화면에 보인다.
  - kind를 보는 새 화면은 만들지 않는다(roadmap에 없다).
- **test(AGENTS.md "속도"):**
  - 위험 test는 사용자 data와 권한 경계만이다. 예: PM 밖의 role이 `kinds.yaml`을 쓰지 못한다. 틀린 kind 파일이 앞의 맞던 kind를 지우지 않는다.
  - 지운 기능의 test는 지운다.

## e2e

- 이 계획은 e2e를 돌리지도 고치지도 않는다.
- 지운 기능의 e2e file(`tests/e2e/pm-context_test.ts`, `pm-tools_test.ts`의 context 부분)은 그 기능을 지우는 task가 지운다.
- land는 `LOPHN_LAND_SKIP_E2E=1 project-docs/plan/tools/lead/land.sh domain-kinds`로 돈다.

## 같이 도는 계획

`domain-tools`(`dt-`), `domain-place`(`dp-`), `artifact`(`af-`)가 같이 돈다. 겹치는 file은 아래다.
- running task끼리는 `status.py ready`가 가른다.
- land의 rebase 충돌은 두 쪽을 다 남긴다.
- 계획 사이 순서나 계약이 걸리면 planner session `lophn-7e`에게 SendMessage로 묻는다.

| file | 겹치는 계획 |
|---|---|
| `packages/core/agent-roles/place/place-data.ts`, `place-info.ts` | `domain-place`(앱 place, 지도), `artifact`(artifact 목록) |
| `packages/core/agent-roles/place/place-folders.ts` | `domain-place`(앱 place, skill 자리), `artifact`(`artifacts/`) |
| `packages/core/agent-roles/tool-lists.ts` | `domain-tools`, `domain-place` |
| `packages/protocol/lophn-agent/agent-values.ts`, `operators.ts`, `packages/core/lophn-agent/agents/*` | `domain-place`(skill 고르기, 앱 place) |
| `packages/core/events/reactor/session-opening.ts` | `domain-place`(App Engineer reaction을 PM으로) |
| `packages/protocol/shell/workspace.ts`(tab kind), shell sidebar·add-tab menu·palette·`use-tab-host-slices.ts` | `artifact`(artifact tab), `domain-place`(앱 place 화면) |
| `packages/protocol/problems/*`, `packages/core/problems/*` | `domain-place`는 건드리지 않는 것으로 나눴다. 이 계획만 고친다 |
| `packages/design/wording/catalog/*` | 모두 |
| `tests/eval/*` | 모두 |

## lead가 할 일

- **wave 2를 띄우기 전에:** 계약 task가 merge되면 kind 파일 schema, `list`·`check` 입출력, problem 모양이 brief와 같은지 본다.
- **merge 때마다:** wording 생성과 등록 file(`protocol/**/mod.ts`, core wiring)을 고친다.
- **다 끝나면**
  - `project-docs/architecture/kinds.md`를 새로 쓴다. 다음을 지금 코드 기준으로 적는다.
    - kind 파일과 그 자리
    - 바뀔 때 검사
    - pipeline
    - `list`·`check`
    - 위반 problem
    - prompt의 kind 글
  - `architecture/agent-definition.md`의 context 글 줄을 kind 글로 고친다.
  - `boundary-catalog.yaml`의 `contexts`를 `kinds`로 바꾸고 `module-catalog.yaml`을 맞춘다.
  - `issues/contexts.md`를 닫는다(`issue` skill).
  - changelog 열린 판에 항목을 덧붙인다.
  - worker 보고의 "무겁게 짠 것"과 "알려진 미완 동작"은 `issue` skill대로 올린다.
- **사람에게 묻는 것:** 제품 동작이 roadmap과 달라져야 할 때. subprocess·Electron test를 새로 만들 때.
