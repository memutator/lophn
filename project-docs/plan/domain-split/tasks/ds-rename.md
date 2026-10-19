# ds-rename

지금 `project` entity(책임 경계를 이룬 것: 폴더, kind 파일, 앱, PM, Operator, skill, artifact, grant, 문제)의 이름을 저장소 전체에서 한 번에 `domain`으로 바꾼다. id `prj_` → `dom_`, Place `{kind:"project"}` → `{kind:"domain"}`, role `project_manager` → `domain_engineer`("Domain Engineer"), lophn 자리 `<data>/projects/<prj>/` → `<data>/domains/<dom>/`, 이 이름을 단 module·file·표·route·wording을 모두 바꾼다. 동작은 바꾸지 않는다. 이 task가 끝난 상태("R")에서 domain은 아직 폴더를 가진다. 가벼운 새 `project`와 domain의 필수 `project` 칸(1:N)은 다음 wave(`ds-project-registry`)가 만든다.

**나누는 방식(이 계획의 첫 brief라 여기에 정한다): 계약 먼저 + 영역별 task가 아니라 codemod task 하나다.**
- 이유 1: 바뀌는 이름이 계약 자체다. `Place["kind"]`는 zod literal이고(`packages/protocol/lophn-agent/places.ts`), role 표(`ROLES`)·`agentRefSchema`·id 접두(`idSchema("prj")`)·표 column(`sessions.project`, `apps.project`)·route resource(`projects`)가 모두 이름 하나다. 옛것과 새것을 나란히 둘 수 없다(호환 장치 금지). 영역마다 따로 바꾸면 어느 branch도 혼자서는 `check:full`을 통과하지 못해 merge할 수 없다.
- 이유 2: 일은 거의 기계적이다. 단어 치환 + 폴더 이동(`tools/move-files.ts`) + 타입 오류 따라가기다. 영역으로 나누면 사람이 같은 규칙을 여러 번 적용한다.
- 그래서 worker 하나가 script로 치환하고 `deno check`가 가리키는 곳을 고친다. 병렬은 이 task가 끝난 뒤 영역별로 연다(wave 2~4).

- 단위: rename (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/base`
  - `packages/coding-agent`
  - `packages/core`
  - `packages/design`
  - `packages/protocol`
  - `packages/sdk`
  - `packages/shell`
  - `tests/e2e`
  - `tests/eval`
  - `tests/fixtures`
  - `tests/harness`
  - `tests/live`
  - `tests/support`
  - `tools/check.ts`
  - `tools/check-deps.ts`
  - `tools/check-docs.ts`
  - `tools/check-modules.ts`
  - `tools/context-review.ts`
  - `tools/dev.ts`
  - `tools/wireframes/pages`
  - `tools/wireframes/mock`
  - `tools/wireframes/drafts/app-space`
  - `deno.json`
  - `deno.lock`
  - `project-docs/module-catalog.yaml`
  - `project-docs/boundary-catalog.yaml`
  - `project-docs/context-component-registry.yaml`
  - `project-docs/architecture`
  - `project-docs/issues/activation.md`
- 읽을 것:
  - 계획: `project-docs/plan/domain-split/README.md` ("정한 것"의 나누는 선, place, role)
  - roadmap: `project-docs/products/roadmap/domain.md`의 "project와 domain (2026-10-19 다시 정함)", "폴더", "role"
  - architecture: `project-docs/architecture/place-session.md`, `kinds.md`, `agent-definition.md`, `layers.md`
  - 도구: `tools/move-files.ts` 머리 주석(mapping.json 꼴 `moves`, `--dry-run`, `--report`), `tools/check-docs.ts`, `tools/check-modules.ts`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `projects`, `project-docs/module-catalog.yaml`의 `packages/core/projects`
- 계약:
  - 쓰는 것: 없다(고정된 계약을 바꾸는 task다).
  - 내놓는 것: 아래 "R 상태" 표. 다음 task들이 이 이름을 전제로 쓴다.

## R 상태(이 task가 끝났을 때 이름)

| 옛 | 새 | 비고 |
|---|---|---|
| id 접두 `prj`(`idSchema("prj")`, `Id<"prj">`, `prj_…` 정규식·fixture) | `dom` | `projectIdSchema` → `domainIdSchema`(`packages/protocol/projects/values.ts` → `packages/protocol/domains/values.ts`) |
| `Place` `{kind:"project", id}` | `{kind:"domain", id}` | `packages/protocol/lophn-agent/places.ts`, `AgentPlace`, `rolePlaceFits`의 `ROLE_PLACES` |
| role `project_manager`, `BUILTIN_ROLE_NAMES` "Project Manager" | `domain_engineer`, "Domain Engineer" | `ROLES`, `agentRefSchema`(`{role:"domain_engineer", domain}`), `agentRefOfColumns`, `agentIdentityOf`(column `domain`), `ROLE_TABLE`, tool 목록, credential, prompt |
| module·폴더 `packages/core/projects` | `packages/core/domains` | `registry/`, `kinds/`, `search/`, `lookups.ts`, `ports.ts`, `register.ts` 그대로 이름만 |
| `packages/core/problems/project` | `packages/core/problems/domain` | 표 `project_problems` → `domain_problems`, `problemSyncProject` → `problemSyncDomain`, route `problem.sync_project` → `problem.sync_domain` |
| `packages/protocol/projects` (+ `project-api.ts`, `project-folders.ts`, `project-routes.ts`, `project-search.ts`, `projects.ts`) | `packages/protocol/domains` (+ `domain-api.ts`, `domain-folders.ts`, `domain-routes.ts`, `domain-search.ts`, `domains.ts`) | `packages/protocol/deno.json`의 export `./projects`, `packages/protocol/mod.ts`의 `documents` 이름공간도 `domains`로 |
| `packages/protocol/problems/project-problems.ts` | `domain-problems.ts` | |
| `agent-roles/roles/project-manager/`, `place/project-layer.ts`, `lophn-agent/extensions/project-{servers,settings}.ts`, `main/daemon/wiring/projects.ts`, `shell/renderer/workspace/reactions/project-manager.ts` | `…/domain-engineer/`, `domain-layer.ts`, `domain-{servers,settings}.ts`, `domains.ts`, `domain-engineer.ts` | `PROJECT_LAYER` → `DOMAIN_LAYER` |
| route resource `projects`, 이름 `project.*`(`create`, `update`, `relink_folder`, `archive`, `unarchive`, `list`, `get`, `resolve`, `search`, `resolve_cwd`) | resource `domains`, `domain.*` | 이름만. 모양은 그대로다(폴더도 domain이 가진다) |
| route 입력·출력의 `project` 칸(`kind.*`, `app.*`, `problem.*`, `instructions.get`, `models.*`, 확장·skill 설정, call `place: {project: 이름}`, annotation 등) | `domain` | 칸 이름. agent credential 조건 key `project`도 `domain` |
| 표·column: `projects`, `project_folders`, `project_subfolders`, `apps.project`, `annotation_batches.project`, `packages.owner_project`, `sessions.project`·`place_kind` check, kinds index 표의 `project`, models 층 scope | `domains`, `domain_folders`, `domain_subfolders`, `apps.domain`, … `owner_domain`, … | schema step을 그 자리에서 고친다. migration step을 더하지 않는다 |
| data 경로 `<data>/projects/<prj>/…`(`projectsDataArea`, `placeDataFolder`, `kindsFilePath`, 앱 `app/source`, `app/…`, `artifacts/`, `skills/`, `agents/`, `extensions.json`, `LOPHN.md` 대체 자리) | `<data>/domains/<dom>/…` | `projectsDataArea` → `domainsDataArea`, `projectIdOfFolder` → `domainIdOfFolder`(`/^dom_/`). shell main도 같은 경로를 쓴다(`packages/shell/main/artifact/{list,source}.ts`, `packages/shell/main/editor/instructions.ts`) |
| 사람 말 "Project Manager", "PM", "project"(경계 뜻) | "Domain Engineer", "domain" | prompt(`roles/*`), guide, wording 표시 문구, 오류 메시지, 주석 |
| artifact 신원 `{project, name}` | `{domain, name}` | `packages/shell/ipc/artifact.ts`, `packages/shell/main/artifact/**`, `packages/shell/main/workspace/kinds/artifact.ts`, annotation target, `deliverArtifact`(`packages/core/main/daemon/wiring/router.ts`) |

## 바꾸지 않는 것

- `project-docs`(폴더 이름), `project-docs/…` path 문자열. 단어 경계 치환이 `project-docs`까지 먹지 않게 한다.
- 이미 있던 "domain" 뜻: `DomainEvent`(`packages/protocol/events/domain.ts`), ledger의 domain event(`packages/core/storage/ledger/domain-event_test.ts`, `commit-publisher.ts`), chart의 axis `domain`(`packages/design/components/data/chart/`), `tools/check-deps.ts`의 "domain module"(core 안 층 이름, `CORE_DOMAINS`는 안의 `projects` 항목만 `domains`로). 새 `domain` 식별자가 이것들과 겹치면(같은 scope의 변수, import 이름) 새 쪽을 `domainId` 같이 풀어 쓴다.
- `projection`, `projected`, `project_spend_limit_exceeded`처럼 단어 일부가 같은 것은 뜻을 보고 정한다(경계 뜻이 아니면 둔다).
- **wording key 이름과 catalog 묶음 이름**(`project-workspace.*`, `catalog/project.ts`)은 그대로 둔다. 화면 영역 이름이다. 단 role을 이름에 넣은 key(`waiting.label.agent-project-manager` 등)는 바꾼다.
- `tests/eval/runs/`(기록된 run), eval material의 data file 내용(`tests/eval/materials/**`의 `projects.json` 등). eval 자료는 이 계획 뒤에 새로 만든다. 코드(`tests/eval/**/*.ts`)와 type check에 걸리는 것만 고친다. 이름이 role·route에 묶인 registry file(`tests/eval/registry/instruction/project_manager.json` 등)은 check나 test가 대조하면 새 이름으로 옮기고, 대조하지 않으면 둔다.
- **shell의 "project 창" 가족**은 단어 `project`를 둔다(아래 규칙). 이 가족은 이 계획 끝에 가벼운 `project`의 것이 된다.

## shell: 어디가 project로 남고 어디가 domain이 되나

이 계획 끝의 뜻이 기준이다. 사람이 여는 창과 폴더에 관한 것은 `project`이고, agent·앱·kind·문제·skill·MCP·model·artifact·권한에 관한 것은 `domain`이다.
- **`project`로 둔다(식별자·파일·폴더 이름 그대로):** 폴더·하위 폴더·폴더 선택기, layout(`layout.json`, panes·floats·detached), Explorer와 파일 작업, editor 탭, browser, terminal 탭(cwd), `LOPHN.md` 편집, 키워드 검색(`project.search`), launcher의 project 카드·등록 dialog, palette의 project 행, 창을 연 project id를 나르는 IPC.
  - 대표 위치: `packages/shell/main/workspace`(layout schema), `main/terminal`, `main/editor`, `main/browser`, `main/desktop/detached`, `main/desktop/wiring/{detached,editor,layout,browser,desktop-window,coding}.ts`, `main/desktop/core/layout-ipc.ts`, `ipc/{detached,terminal,folder-picker,browser,overlay,app-window,workspace}.ts`, `preload/layout-api.ts`, `terminal-host/`, renderer의 `workspace/`(window 틀·sidebar의 Explorer·kinds 중 terminal/browser/editor/search), `terminal/`, `editor/`, `browser/`, `desktop/launcher/`, `desktop/palette/`, `desktop/router.ts`.
  - 이 id의 접두 검사(`/^prj_…/` 정규식: `packages/shell/main/workspace/schema.ts`, `main/desktop/core/layout-ipc.ts`, `ipc/detached.ts`, `ipc/app-window.ts`, `main/desktop/wiring/desktop-window.ts`)는 이 상태에서 실제 id인 `dom_`을 받게 고친다. 가벼운 project가 생기면 `ds-shell-window`가 `prj_`로 돌린다.
  - 이 가족이 core를 부르는 곳(`core-source.ts`, `main/desktop/wiring/{coding,editor}.ts`)은 route를 `domains`/`domain.*`로 바꾸되 안의 지역 이름은 `project`로 둔다.
- **`domain`으로 바꾼다:** place·role·agent·session 표시, Operator, 앱 목록·앱 panel의 앱, kind, problem, skill, MCP·model 설정, artifact(`packages/shell/main/artifact/**`, `renderer/artifact/`, `sidebar/artifact-panel.tsx`), 승인·waiting 카드의 place 문구, `workspace/agents/**`, `workspace/kinds/{agent,agents}.tsx`, `workspace/reactions/**`, `conversation/**`, `app-frame/**`, `apps/**`, `desktop/connection/**`, `desktop/settings/**`.
- 한 파일에 둘이 섞인 곳(`workspace/workspace.tsx`: agent place `{ kind: "project", id: projectId }` → `{ kind: "domain", … }`, `props.projectManager` → `domainEngineer`, artifact 열기)은 줄마다 이 규칙으로 가른다. 섞인 줄에서 창 id 변수 `projectId`는 그대로 두고 domain 쪽 자리에 넘긴다(이 상태에서는 한 id다).
- 판단이 서지 않으면 `domain`으로 하지 말고 `project`로 둔 채 보고의 "정한 것"에 적는다.

## 할 일

1. **기준선.** worktree에서 `deno task check`가 통과하는지 본다. 바꿀 단어의 수를 센다: `grep -rnwE "project|projects|Project|project_manager|prj" packages tools tests --include=*.ts --include=*.tsx | wc -l`. 임시 file(mapping, script, 보고서)은 `.dev-data/ds-rename/`에 둔다.
2. **이동.** `.dev-data/ds-rename/mapping.json`을 만들어 `deno run --allow-read --allow-write --allow-run tools/move-files.ts <mapping> --dry-run --report <file>` → 보고서를 읽고 실제로 돌린다. 옮길 것은 위 표의 폴더와 file(`moves`). 이름에 `project`가 든 file 가운데 shell·wireframes·wording catalog는 옮기지 않는다(위 "바꾸지 않는 것"). `tests/eval/scenarios/project-manager`는 test나 check가 role 이름과 대조할 때만 옮긴다.
3. **치환 script.** 단어 경계 규칙으로 식별자를 바꾸는 script를 짠다(camelCase 안의 `project` → `domain`, `Project` → `Domain`, `PROJECT` → `DOMAIN`, `projects` → `domains`, `project_` → `domain_`, `prj` → `dom`, `project_manager` → `domain_engineer`, `ProjectManager` → `DomainEngineer`, `projectManager` → `domainEngineer`, `Project Manager` → `Domain Engineer`, `PM`은 문장이면 `Domain Engineer`로). 규칙:
   - `project-docs`, `projection`, `projected`, 위 "바꾸지 않는 것"의 file·폴더는 건너뛴다.
   - shell의 project 가족 file은 script에 넣지 않고 사람 손(또는 별도 규칙)으로 한다. core·protocol·coding-agent·sdk·design의 `.ts`·`.md`·`.tmpl`에 적용한다.
   - SQL 문자열, zod key, route 이름 문자열, `resource: "projects"`, `"project"` 문자열 literal도 같이 바뀌는지 확인한다(type check가 못 본다). 바꾼 뒤 `grep -rnE '"project"|"projects"|project\.' packages tools tests`로 남은 것을 읽는다.
4. **schema.** 표·column·index·trigger 이름(`projects_no_delete` 등)과 오류 메시지를 새 이름으로 고친다. 새 schema step을 더하지 않는다(AGENTS.md "호환성"). 개발 data(`.dev-data/`)는 지우고 새로 만든다.
5. **data 경로.** `projectsDataArea`·`placeDataFolder`·`kindsFilePath`·`appDefaultSource`(`packages/protocol/apps/app-storage.ts`)·shell main의 경로 조립이 모두 `domains/<dom>`을 가리키는지 grep한다: `grep -rn '"projects"\|/projects' packages`.
6. **타입 오류 따라가기.** 순서: `packages/protocol` → `packages/core` → `packages/coding-agent`·`packages/sdk` → `packages/design` → `packages/shell` → `tools` → `tests`. 각 단계에서 `deno task check`(또는 package별 check)를 돌려 오류를 고친다. 오류 없이 깨지는 것은 문자열이다: route 이름, SQL, 정규식, 경로, wording 표시 문구. `packages/shell/renderer`는 `deno run -A packages/shell/renderer/build.ts`로 build도 본다.
7. **wording.** 표시 문구 가운데 Project Manager와 경계 뜻의 "project"를 새 말로 고친다("Domain Engineer", "Domain", "this domain's agents" 같은 식). 폴더·창·Explorer·launcher 카드에 관한 문구는 `project`로 둔다. `packages/design/wording/catalog/*.ts`를 고친 뒤 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 생성물을 다시 만든다(`*.placeholders.ts`는 손으로 고치지 않는다).
8. **role prompt·guide.** `packages/core/agent-roles/roles/domain-engineer/prompt.md`와 `roles/{operator,lophn}`, `skills/kinds-yaml/SKILL.md`, `packages/coding-agent/guides/`의 문장을 새 말로 읽히게 고친다. 동작을 설명하는 문장을 새로 쓰지 않는다(다음 task들이 한다).
9. **catalog·docs의 path만.** `deno task check`의 `modules`·`docs` 단계가 막는 옛 path를 새 path로 바꾼다: `project-docs/module-catalog.yaml`의 `path:`(boundary id `projects`는 그대로 둔다. lead가 문서 정리 때 바꾼다), `project-docs/context-component-registry.yaml`, `project-docs/architecture/*.md`와 `project-docs/issues/activation.md` 안의 backtick path 문자열. 문장은 고치지 않는다. 같은 변경에서 `tools/check-deps.ts`(`CORE_DOMAINS`의 `projects` → `domains`, `ROLE_NAMES`, `HARNESS_LEFTOVERS` 안의 path)도 맞춘다.
10. **등록 file.** 이 task는 병렬 task가 없어 `packages/protocol/deno.json`, `packages/protocol/mod.ts`, `packages/core/main/daemon/assembly.ts`의 등록 줄과 `deno.lock`(workspace 이름이 바뀔 때만)을 직접 고친다. 고친 줄을 보고에 적는다.
11. **테스트.** 옛 이름에 묶인 test는 새 이름으로 옮긴다. 설계와 안 맞는 test는 고치지 말고 지운다. 새 test는 만들지 않는다(이름 바꾸기라 동작이 같다). `tests/e2e`와 `tests/eval`은 type check를 막는 곳만 기계적으로 고친다. 돌리지 않는다.
12. **확인.** `deno task check:full` → `project-docs/plan/tools/lead/boot.sh`(core 기동 두 번) → `deno run -A packages/shell/renderer/build.ts` → `deno task wireframes`.

## 끝남

- `deno task check:full`이 통과하고 `boot.sh`가 `boot N exit 0`을 찍고 renderer build와 `deno task wireframes`가 된다.
- 위험 test: 없음(새 test 없음). 단 이름만 바뀐 기존 위험 test(`placeFoldersOf`, `hooks_test`, `instruction` read, kinds)가 새 이름으로 그대로 통과한다.
- 남지 않음(0줄이어야 한다. `tests/eval/runs`, `tests/eval/materials`, `.claude/worktrees`는 뺀다):
  - `grep -rnE "project_manager|ProjectManager|projectManager|Project Manager|PM\b" packages tools tests --include=*.ts --include=*.tsx --include=*.md --include=*.tmpl`
  - `grep -rnE 'idSchema\("prj"\)|Id<"prj">|projectIdSchema' packages tools tests`
  - `grep -rnE "protocol/projects|core/projects|problems/project|/projects/|projectsDataArea|projectIdOfFolder" packages tools tests --include=*.ts --include=*.tsx`
  - `grep -rnE 'kind: "project"' packages/core packages/protocol packages/coding-agent packages/sdk`
  - `grep -rnE "\bproject\b" packages/core packages/protocol packages/coding-agent`는 `project-docs`·주석 속 "사람의 project"가 아닌 것이 없어야 한다(남은 줄은 보고에 이유를 적는다).
- shell project 가족 밖에서 `"project"`·`prj_`가 남지 않았다: `grep -rnE "prj_|\"project\"" packages/shell/renderer/workspace/agents packages/shell/renderer/conversation packages/shell/renderer/app-frame packages/shell/renderer/apps packages/shell/main/artifact packages/shell/ipc/artifact.ts`.

## 보고

- 바꾼 file(폴더 단위로 요약), 옮긴 file 표
- 통과한 check
- 등록할 것: 직접 고친 등록 줄 목록(`packages/protocol/deno.json`, `packages/protocol/mod.ts`, `assembly.ts`, `deno.lock`)
- 안 쓰게 된 export: `project.resolve_cwd`(`projectResolveCwd`)는 CLI·core 어디서도 부르지 않는다. 지우지 말고 이름만 바꾸고 보고한다(`ds-project-registry`가 지운다).
- 정한 것: shell에서 `project`로 남긴 file과 `domain`으로 바꾼 file의 경계에서 판단한 곳, 단어 충돌(`domain` 기존 뜻)을 푼 곳, eval registry file을 옮긴 이유
- 넘길 줄: 남의 file을 최소로 맞춘 곳(없음이 정상. 병렬 task가 없다)
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없음이 정상. 있으면 `무엇 / 왜 / 줄인다면 / 어디`
- **알려진 미완 동작**: 이 상태에서 예상되는 것은 "domain이 아직 폴더를 가진다"뿐이다. 그 밖에 안 되는 동작을 적는다.
