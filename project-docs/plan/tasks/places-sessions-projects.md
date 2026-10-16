# places-sessions-projects

project registry를 새 모양으로 짠다. 등록은 이름, 목적, 폴더(하나 이상), 폴더 설명만 받고, 연결한 폴더 안 하위 폴더를 지정할 수 있고, tracking 규칙·미리보기·문서 목록은 모두 지운다. 폴더가 디스크에서 없어지면 "찾을 수 없음"으로 읽히고 사람이 새 위치로 이어 줄 수 있다. 등록 때 같은 tx에서 그 project의 Project Manager를 만든다(port).

- 단위: places-sessions (wave 3)
- 선행: 없음. 계약 고정 뒤 열린다. remove-documents(wave 1)가 merge된 상태에서 시작한다.
- 소유(이 task만 고친다):
  - `packages/core/projects/registry/` 전체
  - `packages/core/projects/mod.ts`
  - `packages/core/projects/register.ts`
- 읽을 것:
  - spec: S8 2·9장(Project Manager는 project마다 하나, project 등록 때 생김) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - spec: S4 6장 "place 정보"(폴더와 폴더 설명, 지정한 하위 폴더와 설명) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - inventory: `I1.10#9`(core 쪽: `register.ts`·`mod.ts`에 남은 문서 contract 연결), `I1.10#14`, `I2.10#1`, `I2.10#2`, `I2.10#3`, `I2.10#4`, `I2.10#5`, `I2.10#6`, `I2.10#7`, `I3.10#4`
  - 요구: req-1471~1473(등록, 보관, 폴더), req-1524(하위 폴더) — `/home/pyosechang/projects/lophn/project-docs/requirements/core-projects.yaml`
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code-map.md`(domain module끼리 직접 import하지 않는다)
  - 지금 코드: `registry/{commands,reads,schema,model,rules,store,rows,authorization,cursor}.ts`
- 계약:
  - 쓰는 것: `protocol/projects/project-folders.ts`·`project-api.ts`(`projectApi`, `projectRecordSchema`, `projectRegisterInputSchema`, `projectEditInputSchema`, `projectRelinkFolderInputSchema`, `PROJECT_API_ROUTES`), `core/projects/ports.ts`(`ProjectManagerProvisioning`, `FolderResolver`)
  - 내놓는 것: `registry/mod.ts`가 내놓는 `createProjectCommands()`·`createProjectReads(deps)`(새 계약대로), `core/lophn-agent/ports.ts`의 `ProjectDirectory`를 wiring이 채울 수 있는 `projectInfoOf(...)` 읽기

## 할 일

1. 표 (`registry/schema.ts`, 개발 data는 지우고 새로 만든다): `projects`에서 `tracking_enabled`, `use_gitignore`와 `project_tracking_patterns` 표를 지운다(`I1.10#14`). `project_folders`에 하위 폴더 표 `project_subfolders (project, folder_path, position, path, description, PRIMARY KEY (project, folder_path, path))`를 더한다(req-1524). 하위 폴더 경로는 연결 폴더 기준 상대 경로이다. schema step id는 `documents.projects.tables`에서 `projects.registry.tables`로 바꾼다.
2. 등록·수정 (`registry/commands.ts`, `I2.10#1`):
   - 입력은 이름(slug `name`), `title`, 목적, 폴더 목록(하나 이상, 폴더마다 설명과 하위 폴더 목록)이다. 폴더 없이 등록하면 `invalid_input`. `tracking` 입력과 `base_revision`·`preview` 짝은 없다.
   - 수정은 이름, 제목, 목적, 폴더(하위 폴더 포함)를 통째로 바꾼다. "folders 바꾸기는 tracking preview 필요" 규칙(`I1.10#15`의 core 쪽)을 없앤다. `set_tracking`, `preview_tracking`, `tracking_roots` command·route와 `ProjectTrackingChanged` 쓰임을 지운다.
   - 하위 폴더를 지정하거나 고치거나 뺄 수 있다. 연결한 폴더 밖의 경로는 거절한다(req-1524): `..`와 절대 경로는 `invalid_input`, 연결 폴더 밖으로 나가는 symlink는 `FolderResolver.resolveInside`가 realpath로 판정해 거절한다. 하위 폴더를 지정해도 project에 든 파일의 범위는 바뀌지 않는다.
   - 등록 command는 같은 tx 안에서 `ProjectManagerProvisioning.create(tx, project)`를 부른다(`I3.8` 쪽 규칙: 사람은 Project Manager를 더하거나 지울 수 없다). 이 port를 채우는 것은 agent-definition이고 이 task는 부르기만 한다.
3. 읽기 (`registry/reads.ts`, `I2.10#2`, `I2.10#3`):
   - `project.list`·`get`·`resolve`는 새 `projectRecordSchema` 하나의 모양을 돌려준다. `tracking`, `initial_tracking_proposal`, `document_count`, `documents`(고정 문서 참조), 사용자용·agent용 두 모양을 지운다.
   - 폴더마다 `found`: 등록 폴더가 디스크에 없으면 false("찾을 수 없음", `I2.10#3`). 짐작해서 잇지 않는다. `FolderResolver.exists`로 판정한다. 폴더 존재 확인이 옛 file-tracking worker(`worker/observers.ts`)에 있었다면 그 로직은 지워졌으므로 여기서 새로 짓는다.
   - `ProjectDirectory.project(id)`/`projectByName`/`list`가 쓰는 읽기를 내놓는다(`projectInfoOf`). 보관 여부, 폴더와 설명, 하위 폴더와 설명을 준다.
4. 폴더 다시 잇기 (`I3.10#4`): `project.relink_folder` command. 찾을 수 없는 등록 폴더의 경로를 사람이 고른 새 경로로 바꾼다. 하위 폴더와 설명은 그대로 따라간다. 새 경로가 이미 다른 등록 폴더와 겹치면 `conflict`.
5. 폴더 겹침 규칙 (`I2.10#4`, `registry/model.ts`): 옛 `overlappingEnabledRoots`는 tracking이 켜진 root끼리만 겹침을 막았다. 추적이 없어졌으므로 규칙을 새로 정한다. 추천: 같은 project 안에서만 폴더가 중복되거나 겹치면 거절하고(`validateFolderRoots`가 이미 같은 project 안 중복을 막는다), project끼리 폴더가 겹치는 것은 허용한다(VS Code가 겹쳐도 연다). `deepestRegisteredRoot`가 tie에서 `conflict`를 돌려주는 것은 `project.resolve`가 한 경로에 project 여럿이 닿을 때의 처리로 남긴다. 이 결정을 보고 "정한 것"에 적는다.
6. 보관 (`I2.10#5`, `registry/commands.ts` 353행): `unarchive`가 tracking이 켜짐을 확인하던 분기를 지운다. 보관해도 폴더의 파일은 그대로다. 보관한 project의 session은 열린 채 남고 새 입력만 받지 않는다(places-sessions-session의 `acceptsInput`이 `ProjectDirectory`로 본다).
7. `name`/`title` (`I2.10#6`): 두 칸을 모두 둔다(contract-calls-places-projects가 정했다). slug `name`의 유일 제약은 call의 `place: {project: 이름}`이 정확히 맞춰 쓰는 key라서 남는다. `projects_no_name_collision` trigger는 그대로 둔다.
8. `project.resolve_cwd` (`I2.10#7`): 쓰는 쪽이 coding agent CLI뿐이다. coding-agent task가 앱 source가 project 폴더 안에 있을 때 앱 쪽에서 쓰는지 판정한다. 이 task는 route와 읽기(`registry/reads.ts:307` 근처)를 지우지 말고 새 읽기 모양에 맞춘다. 판정 결과는 coding-agent의 보고를 받아 lead가 정한다.
9. 문서 contract 정리 (`I1.10#9`의 core 쪽): `projects/mod.ts`와 `register.ts`에 남은 `addressing`·`file-tracking`·`versions`·`formats`·`series`·`outline-and-search` import와 등록(`createDocumentsEventRegistration`, `createFileCommands`, `createVersionCommands`, `SERVED_ROUTES`, `DOCUMENT_DISPATCHABLE_COMMANDS`, `READ_ROUTES`, `UPLOAD_ROUTES`, `filesWatch` 등)을 모두 걷어낸다. wave 1(remove-documents)이 폴더를 지우면서 이미 일부를 걷었을 수 있다. 남은 것만 걷고, 남지 않았으면 바꿀 것이 없다고 보고한다. `register.ts`가 맡던 project command·read·schema step·context 등록(`createContextsRegistration`)은 새 이름으로 이어 놓는다. 소유 밖의 `core/main/daemon/` import는 고치지 않고 보고에 적는다.
10. `registry/authorization.ts`, `cursor.ts`, `visibility.ts`: 새 읽기 모양과 event 정리(`ProjectCreated`·`Updated`·`Archived`는 domain event 10개 밖이라 ledger에 쓰지 않는다. S1 12장)에 맞춰 지운다. 소유 밖이 쓰는 export는 남긴다.
11. 지우기 목록: `registry/{scan,tracking-apply,placement,work}.ts`(tracking preview와 파일 훑기), `rules.ts`에서 tracking 일치(`matchTrackingPatterns`, `decideTracking`, `hardExclusion`)는 지우고 `gitignoreExcludes`와 `symlinkEscapesRoot`는 남긴다(places-sessions-search가 쓴다).
12. test: `registry_test.ts` 한 파일, 저장소만(SQLite 하나)으로 표를 돈다.
    - "하위 폴더는 연결 폴더 밖 경로(`..`, 절대 경로, 밖으로 나가는 symlink)를 거절한다"
    - "폴더 없이 등록하면 거절되고, 보관해도 폴더의 파일은 그대로다"

- (lead가 더함, screens-project-search가 넘긴 것) `project.search`의 `folder`는 등록 폴더뿐 아니라 그 하위 폴더의 절대 경로도 받는다(화면이 하위 폴더를 고를 수 있다). 연결 폴더 밖이면 거절한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "하위 폴더는 연결한 폴더 밖을 거절한다", "폴더 없는 등록은 거절된다"
- 남지 않음: `grep -rn "tracking\|Tracking\|use_gitignore\|document_count\|initial_tracking" packages/core/projects/registry packages/core/projects/register.ts packages/core/projects/mod.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/projects/mod.ts`·`registry.ts`의 `PROJECT_ROUTES`를 `PROJECT_API_ROUTES`로 바꾼다(lead). `core/projects/register.ts`가 내는 새 등록. `wiring/projects.ts`에 `ProjectManagerProvisioning`·`FolderResolver` 구현을 끼운다. `core/main/daemon/` 쪽 남은 import 목록
- 안 쓰게 된 export: `protocol/projects/projects.ts`의 `projectSchema`·`userProjectSchema`·`agentProjectSchema`·`projectCreateInputSchema`·tracking 계열, `project-routes.ts` 전체, `registry/mod.ts`의 옛 export
- 정한 것: 폴더 겹침 규칙, 하위 폴더 표 모양, `found` 판정, `project.resolve_cwd` 처리
- 계약 바꾸기 요청(wave 3): `FolderResolver`에 모자란 것
