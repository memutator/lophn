# ds-project-registry

가벼운 새 `project`(id `prj_`, 이름, 제목, 폴더·하위 폴더)를 등록 표로 다시 세우고, domain ↔ project N:M 연결 표를 만든다. `ds-rename`이 끝낸 상태(R)에서 domain은 폴더를 가진다. 이 task는 폴더 쪽(표, command, read, 검색)을 project로 떼어 내고, domain에서 폴더 칸을 지우고, 연결·끊기 command(사람만)와 "domain의 폴더 = 연결된 active project의 폴더"를 내는 lookup을 만든다. 이 계약이 서야 wave 3의 영역별 task(scope, kinds, shell)가 병렬로 돈다. 아래 "계약"이 그 모양이다.

- 단위: registry (wave 2)
- 선행: ds-rename
- 소유(이 task만 고친다):
  - `packages/protocol/domains/domain-api.ts`
  - `packages/protocol/domains/domain-folders.ts`
  - `packages/protocol/domains/domain-routes.ts`
  - `packages/protocol/domains/domain-search.ts`
  - `packages/protocol/domains/domains.ts`
  - `packages/protocol/domains/mod.ts`
  - `packages/protocol/projects`
  - `packages/protocol/mod.ts`
  - `packages/protocol/deno.json`
  - `packages/core/domains/lookups.ts`
  - `packages/core/domains/ports.ts`
  - `packages/core/domains/register.ts`
  - `packages/core/domains/registry`
  - `packages/core/domains/projects`
  - `packages/core/domains/search`
  - `packages/core/domains/kinds/host/watch/service.ts`
  - `packages/core/main/daemon/assembly.ts`
  - `packages/core/main/daemon/wiring/domains.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-registration.ts`
  - `packages/core/main/daemon/place-folders-glue.ts`
  - `packages/core/main/daemon/place-folders-glue_test.ts`
  - `packages/core/agent-roles/place/place-data.ts`
  - `packages/core/lophn-agent/instructions/read_test.ts`
  - `packages/shell/main/desktop/wiring/coding.ts`
  - `packages/shell/main/desktop/wiring/editor.ts`
  - `packages/shell/renderer/workspace/core-source.ts`
  - `packages/shell/renderer/workspace/search/core-source.ts`
  - `packages/shell/renderer/desktop/launcher/projects`
  - `packages/shell/renderer/desktop/launcher/register-dialog.tsx`
  - `packages/shell/renderer/desktop/palette/core-catalog.ts`
  - `tests/support/core/human.ts`
  - `tests/e2e/session_test.ts`
  - `tests/e2e/turn-fate_test.ts`
  - `tests/eval/restore/projects.ts`
- 읽을 것:
  - 계획: `project-docs/plan/domain-split/README.md`("정한 것"의 나누는 선, 연결, file 범위), `tasks/ds-rename.md`의 "R 상태"
  - roadmap: `project-docs/products/roadmap/domain.md`의 "project와 domain (2026-10-19 다시 정함)", "폴더"
  - architecture: `project-docs/architecture/place-session.md`("file tool의 범위는 place가 정한다"), `kinds.md`, `layers.md`("domain module" 규칙)
  - 코드(R 이름. 옛 이름 `packages/core/projects/registry`): `packages/core/domains/registry/{schema,model,store,rows,commands,reads,authorization,cursor,record,ports,folder-resolver,rules,registry_test}.ts`, `packages/core/domains/lookups.ts`, `packages/core/domains/search/`, `packages/protocol/domains/domain-api.ts`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `projects`, `project-docs/module-catalog.yaml`의 `packages/core/domains`(path)
- 계약:
  - 쓰는 것: R 상태의 `domainApi`(`domain.create` 등), 표 `domains`·`domain_folders`·`domain_subfolders`.
  - 내놓는 것(아래 모양을 그대로 만든다. 다른 task가 이 이름을 쓴다):

### protocol

`packages/protocol/projects/`(새 dir, `mod.ts`가 `ROUTES`와 export를 낸다)와 `packages/protocol/domains/`가 나눠 가진다.

```
projectIdSchema = idSchema("prj")                              // packages/protocol/projects/values.ts (새 file)
projectRecord  = { id: prj, name: slug, title, revision, status,
                   folders: [{path, description, found, subfolders:[{path, description}]}],
                   domains: [{id: dom, name, title, status}] }   // 이 project에 이은 domain 요약. purpose 칸은 없다
domainRecord   = { id: dom, name: slug, title, purpose, revision, status,
                   projects: [{id: prj, name, title, status,
                               folders: [{path, description, found, subfolders:[...]}]}] }  // folders 칸은 없다. 연결 순서대로

project.create / update / relink_folder / archive / unarchive   // 사람(user)만. 입력은 옛 domain 것에서 purpose만 뺀 것
project.list / get / resolve                                     // read. resource "projects"
project.search                                                   // 옛 domain.search를 옮김. 입력 `project`
domain.create {id,name,title,purpose} / update {name,title,purpose} / archive / unarchive   // 사람만. folders 입력 없음
domain.link_project {domain, project} / domain.unlink_project {domain, project}            // 사람(user)만. compare는 {}
domain.list / get                                                 // read
```
- `domain.link_project`가 이미 이은 쌍이면 `conflict`, `domain.unlink_project`가 없는 쌍이면 `not_found`다(조용히 넘기지 않는다). 보관된 project·domain은 잇지 못한다(`conflict`).
- `project.resolve_cwd`(`domainResolveCwd`)는 CLI·core 어디서도 부르지 않는다. 지운다(route, handler, 등록, `register.ts`의 reader 목록).
- 읽는 쪽 모양: agent도 `domain.get/list`를 읽는다. domain agent는 이 읽기로 연결된 project의 이름·폴더를 본다.

### core 표

schema step은 R의 `domains.registry.tables`(domain 몫만 남긴다)와 새 `projects.registry.tables`(`packages/core/domains/projects/schema.ts`), 새 `domains.registry.links`(`registry/schema.ts`)로 나눈다. 새 step을 덧붙이는 migration이 아니라 정의를 그 자리에서 고친다.

- `domains`(R 그대로, `domain_folders`·`domain_subfolders`는 지운다).
- `projects`, `project_folders`, `project_subfolders`: 옛 `projects*` 표 정의(schema step)를 되살린다. `purpose` 칸은 뺀다. trigger 이름은 `projects_no_delete` 식.
- `domain_projects(domain TEXT REFERENCES domains(id), project TEXT REFERENCES projects(id), position INTEGER, PRIMARY KEY(domain, project))` + `INDEX (project, domain)`. `position`은 연결한 차례로 늘어나는 정렬 key다(끊어서 비어도 다시 채우지 않는다). 첫 project = 가장 작은 position.

### lookup(`packages/core/domains/lookups.ts`)

```
domainExists(sql, id) / domainIds(sql)                      // 있던 것
domainFolderPaths(sql, domain): string[]                    // 연결된 active project의 폴더. 연결 순서 → 폴더 position 순. 보관된 project는 뺀다
domainRootsOf(sql, domain): string[] | null                 // active domain이면 위와 같다. 없거나 보관됐으면 null
activeDomainRoots(sql): {domain, roots: string[]}[]          // active domain마다 위와 같다 (kinds worker가 훑을 root)
domainProjects(sql, domain): {id, name, folders: string[]}[]   // 새. 연결 순서. active project만
domainProjectOfPath(sql, domain, path): string | null          // 새. path가 든 폴더가 있는 연결된 project 중 가장 안쪽 폴더의 project
projectExists(sql, id) / projectIds(sql)                     // 새 (project 표)
activeProjectFolderPaths(sql): string[]                      // 이름이 바뀐다(R의 activeDomainFolderPaths). active project 전체 폴더 (연결 여부 상관없음). lophn의 읽기 범위와 runtime 권한이 쓴다
```
- `innermostDomainOfPath`는 지운다(부르는 곳이 없다). `domainInfoOf`/`domainInfoList`(`registry/reads.ts`, `lophn-agent-registration.ts`가 부른다)의 `folders`는 연결된 active project 폴더의 합으로 채운다. 모양은 그대로다.
- 연결이 없는 domain의 `domainFolderPaths`는 `[]`다. 이 경우 상대 경로 base는 `<data>/domains/<dom>`이다(`ds-scope`가 정한다. 이 task는 넣지 않는다).

## 할 일

1. **protocol.** 위 모양대로 `packages/protocol/projects/`를 만든다: `values.ts`(`projectIdSchema`), `project-api.ts`(R의 `domain-api.ts`에서 폴더·register·edit·relink·archive·read를 옮기고 `purpose` 제거), `project-folders.ts`(`domain-folders.ts`를 옮김), `project-search.ts`(`domain-search.ts`를 옮김), `mod.ts`. `packages/protocol/domains/domain-api.ts`는 `folders`를 빼고 `projects` 요약과 `linkProject`·`unlinkProject`를 더한다. 같은 이름 중복인 옛 read 정의(`domains.ts`의 schema, `domain-routes.ts`의 `domainList`·`domainGet`)는 `domainApi.list/get`과 같은 schema를 쓰게만 맞추고 지우지 않는다(쓰는 곳이 `ds-tool-rename` 등과 겹친다. `ds-leftover`가 지운다). `packages/protocol/mod.ts`·`packages/protocol/deno.json`의 export·`ALL_ROUTES`에 `projects`를 더한다(근거: orchestrate 병렬 규칙 3의 등록 file이지만 이 wave에 병렬 task가 없어 직접 고친다. 보고에 적는다).
2. **core 표와 코드.** `packages/core/domains/`에서 폴더 쪽을 `packages/core/domains/projects/`(새 dir)로 옮긴다: `registry/{model,store,rows,commands,reads,authorization,cursor,record,ports,folder-resolver,rules,schema}.ts`의 project 몫과 `search/`. `registry/`에는 domain(이름·제목·목적·보관) 몫과 연결 command가 남는다. 근거: `layers.md`의 "domain module끼리 import 금지"와 "다른 module의 표를 SQL로 직접 읽지 않는다" 때문에 연결 표를 읽는 lookup과 두 표는 한 module(`packages/core/domains`)에 둔다. 새 core module을 만들지 않으므로 `tools/check-deps.ts`·`module-catalog.yaml`을 고치지 않는다.
3. **command.** `domain.link_project`/`unlink_project`: `requireUser`(사람만), `TargetAuthorization`(fail-closed)으로 domain과 project 둘을 판정, 표에 쓴다. agent·coding agent·app은 `forbidden`이고 아무것도 쓰지 않는다. `domain.create`는 같은 tx에서 Domain Engineer를 만드는 port(`DomainEngineerProvisioning`)를 그대로 부른다. `project.create`는 Domain Engineer를 만들지 않는다.
4. **read.** `domain.get/list`는 `projects`를 싣고(연결 순서), `project.get/list`는 `domains`를 싣는다. agent의 `project.get/list/resolve` 읽기: 자격 조건 `domain`이 있는 agent(Domain Engineer, Operator)는 그 domain에 이은 project만 보고 나머지는 `not_found`다. 조건이 없는 agent(lophn)는 모든 project를 본다. 근거: AGENTS.md "속도"가 막으려는 것은 agent의 실수이고, domain agent가 이어 주지 않은 폴더의 경로를 아는 것도 실수의 재료다.
5. **lookup.** 위 목록대로 `lookups.ts`를 고친다(SQL은 `domain_projects`와 `projects`·`project_folders` join). `activeDomainFolderPaths` → `activeProjectFolderPaths`로 바뀌는 `place-folders-glue.ts`의 import 한 줄과 `place-folders-glue_test.ts`, `instructions/read_test.ts`의 fixture(raw `insert into domains/projects/domain_projects …`)를 새 표에 맞춘다(이 두 test의 규칙은 `ds-scope`가 새로 쓴다. 지금은 통과만 시킨다).
6. **watch.** `packages/core/domains/kinds/host/watch/service.ts`가 command 이름으로 감시를 다시 정하는 목록(`domainApi.register/edit/relinkFolder/archive/unarchive`)을 `projectApi.update/relinkFolder/archive/unarchive`와 `domainApi.archive/unarchive/linkProject/unlinkProject`로 바꾼다(컴파일을 맞추는 줄만. kinds의 나머지는 `ds-kinds-projects`다).
7. **place-data.** `packages/core/agent-roles/place/place-data.ts`가 `domainApi.get`으로 폴더를 읽는 곳을 `domain.projects`의 폴더 합으로 바꾼다(컴파일을 맞추는 줄만. 범위 규칙은 `ds-scope`다).
8. **shell 연결부(문자열 route는 type check가 못 본다).** `grep -rn '"domains"' packages/shell`로 찾아 project 쪽 호출을 `projects`로 돌린다: `main/desktop/wiring/coding.ts`(터미널 폴더), `main/desktop/wiring/editor.ts`, `renderer/workspace/core-source.ts`, `renderer/workspace/search/core-source.ts`, `renderer/desktop/launcher/projects/core-source.ts`(목록, 등록, 수정, 보관, 폴더 다시 잡기), `renderer/desktop/palette/core-catalog.ts`. 런처 등록은 지금 동작을 이어 가게 `project.create` 뒤에 같은 이름의 `domain.create`와 `domain.link_project`를 부른다(등록한 project마다 domain이 하나 생긴다). 화면 모양은 바꾸지 않는다. 이 임시 흐름은 `ds-shell-launcher`가 없앤다. agent·artifact·앱 쪽 호출(`workspace/agents/core-source.ts`, `core-grants.ts`)은 domain이므로 두고, project 창이 연 id를 domain id로 쓰는 어긋남은 `ds-shell-window`가 푼다.
9. **test 도우미.** `tests/support/core/human.ts`(`projectApi.register` 호출), `tests/e2e/turn-fate_test.ts`, `tests/e2e/session_test.ts`, `tests/eval/restore/projects.ts`가 project와 domain을 따로 만들고 잇게 한다. 도우미 하나(`tests/support/core/human.ts`)에 모으고 나머지는 그것을 쓴다. e2e는 type을 맞출 뿐 돌리지 않는다.
10. **test.** 위험 test만:
    - 연결·끊기는 사람만 한다: agent(`parseActor` agent), coding agent, app 자격으로 `domain.link_project`·`unlink_project`를 부르면 `forbidden`이고 `domain_projects`에 행이 생기거나 사라지지 않는다.
    - `domainFolderPaths`·`activeDomainRoots`·`domainProjectOfPath`는 그 domain에 이은 active project의 것만 낸다: domain 둘이 서로 다른 project에 이어졌을 때 섞이지 않고, 보관된 project와 이어지지 않은 project의 폴더는 없다(`domainProjectOfPath`는 이어지지 않은 project의 폴더 안 path에 `null`). 연결이 없으면 `[]`다.
    - domain agent의 `project.get`은 이어지지 않은 project에 `not_found`다.
    - 폴더 쪽 옛 test(`registry_test.ts`의 하위 폴더, 보관, 폴더 없는 등록)는 `projects/` 쪽으로 옮긴다. domain에 폴더가 있다는 것을 전제로 한 test는 지운다.

## 끝남

- `deno task check`가 통과한다(`check:full`은 lead 몫). core 기동은 `project-docs/plan/tools/lead/boot.sh`로 본다.
- 위험 test: "연결·끊기는 user만 한다", "domain의 폴더와 project 찾기는 이은 active project 것뿐이다", "domain agent는 이어지지 않은 project를 읽지 못한다".
- 남지 않음:
  - `grep -rn "resolve_cwd\|ResolveCwd" packages tests tools`가 0줄이다.
  - `grep -rn "innermostDomainOfPath\|activeDomainFolderPaths" packages tests tools`가 0줄이다.
  - `grep -rnE "domain_folders|domain_subfolders" packages tests tools`가 0줄이다.
  - `grep -rnE 'idSchema\("prj"\)' packages`의 결과는 `packages/protocol/projects/`와 project 창 가족(shell)뿐이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 직접 고친 등록 줄(`packages/protocol/mod.ts`, `packages/protocol/deno.json`, `assembly.ts`)
- 안 쓰게 된 export: 중복 read 정의(`domainList`/`domainGet`)와 그것을 쓰는 곳 목록(`ds-leftover`에 넘긴다)
- 정한 것: 연결 command의 `conflict`/`not_found` 규칙, `domain.get`에 project 폴더를 싣는 것, project에서 `purpose`를 뺀 것, `project.resolve_cwd` 삭제, 연결 표를 한 module에 둔 것
- 넘길 줄: 컴파일을 맞추려고 남의 file을 고친 곳(`place-data.ts`, `place-folders-glue*.ts`, `read_test.ts`, `watch/service.ts`, shell 연결부)
- 계약 바꾸기 요청: 있으면 적는다
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 이 task 뒤 shell UI는 반쯤 옮겨진 상태다(project 창에서 agent 줄과 artifact 줄이 비거나 어긋난다. 창이 여는 id가 project id가 되었기 때문이다). `ds-shell-agents`, `ds-shell-window`가 잇는다. 그 밖에 안 되는 동작을 적는다.
