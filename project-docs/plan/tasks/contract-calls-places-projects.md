# contract-calls-places-projects

project, 하위 폴더, 키워드 검색, context의 초안 폴더·목차 저장·위반 route를 protocol에 새 모양으로 더하고, 안 쓰는 옛 파일 관측·문서 읽기 계약을 지우고, core projects의 port(`core/projects/ports.ts`)를 고정한다.

- 단위: contract-calls-places (wave 2)
- 선행: remove-documents (wave 1). `projects.ts`가 `address.ts`를, `read.ts`·`files.ts`가 문서 쪽 type을 import하므로 그쪽이 먼저 지워져야 이 task가 옛 export를 지울지 남길지 정확히 본다.
- 소유(이 task만 고친다):
  - `packages/protocol/projects/project-folders.ts` (새로)
  - `packages/protocol/projects/project-api.ts` (새로)
  - `packages/protocol/projects/project-search.ts` (새로)
  - `packages/protocol/projects/context-drafts.ts` (새로)
  - `packages/protocol/projects/context-outlines.ts` (새로)
  - `packages/protocol/projects/{projects,project-routes,places,search,values,files,file-values,read,read-values,outline-markdown}.ts` (고치거나 지우기. 아래 "할 일")
  - `packages/protocol/projects/{context-api,context-api-content,context-contract,context-work}.ts` (더하기와 지우기)
  - `packages/core/projects/ports.ts` (새로)
- 읽을 것:
  - spec: S8 2·9장(Project Manager는 project마다 하나, 폴더 범위) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - spec: S4 4장(context 줄, 목차)·6장(place 정보, context 글)·11장 14·15 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S1 5장(`ContextViolationFound`) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - 요구: req-1524(하위 폴더), req-1471~1473(project 등록·보관), req-1476~1480(검색), req-1484·1485(md 목차) — `/home/pyosechang/projects/lophn/project-docs/requirements/core-projects.yaml`
  - inventory: `I1.8#1`, `I1.10#15`, `I1.10#17`, `I2.4#21`, `I2.8#1`, `I2.10#23`, `I2.10#26`
  - 결정: `../README.md` 3장 #18·23·57(`project_manager`)
  - 지금 코드: `packages/protocol/projects/*.ts`, `packages/core/lophn-agent/agents/ports.ts`(port 본보기)
- 계약:
  - 쓰는 것: `protocol/base/*`, `protocol/projects/values.ts`(`absolutePathSchema`, `relativePathSchema`, `slugSchema`, `projectIdSchema`, `revisionSchema`), 이미 있는 context 값 schema(`context-api.ts`의 `ctxIdSchema`, `bundleIdSchema` 등). event 정의는 contract-events가 한다(아래 "넘기는 것").
  - 내놓는 것: 아래 "모양". wave 3 places-sessions(registry, contexts, search), agent-tools(tool 입력), agent-definition(place 정보)과 shell 화면(screens-project)이 import한다.

## 모양

새 이름은 lead가 `mod.ts`에 `export *`로 올리므로 옛 export와 겹치면 안 된다. 같은 route 이름(`project.create` 등)을 쓰는 새 정의는 `projectApi`라는 객체 하나에 담아 식별자가 겹치지 않게 한다. `registry`에는 올리지 않는다(옛 route와 이름이 같다. 등록은 lead가 places-sessions가 merge될 때 바꿔 끼운다).

### `project-folders.ts` (req-1524)

- `subfolderSchema`(와 output 짝): `{path: relativePathSchema, description: string}`. 연결한 폴더 안의 하위 폴더이다. 상대 경로이고 `..`와 절대 경로를 거절하는 것은 `relativePathSchema`가 이미 한다. 연결 폴더 밖으로 나가는 symlink는 core가 거절한다(places-sessions-projects 몫).
- `projectFolderSchema`(와 output 짝): `{path: absolutePathSchema, description, subfolders: subfolder[]}`. refine: 한 폴더 안에서 `subfolders.path`가 겹치지 않는다.
- `projectFoldersSchema`: `projectFolder[]`, `min(1)`, `path`가 겹치지 않는다(`I2.10#1`: 폴더 없이 등록하려 하면 거절).
- `projectFolderReadSchema`: output 전용. `projectFolder`에 `found: boolean`(디스크에 있는지, `I2.10#3` "찾을 수 없음")을 더한다.
- 하위 폴더를 지정해도 project에 든 파일의 범위는 바뀌지 않는다(req-1524). 이 schema에 범위를 바꾸는 칸을 두지 않는다.

### `project-api.ts` (req-1471~1473, 1524)

- `projectRecordSchema`(output), `type ProjectRecord`: `{id, name: slug, title, purpose, revision, status: archiveStateSchema, folders: projectFolderRead[]}`. 하나의 모양이다. 옛 `userProjectSchema`와 `agentProjectSchema`가 가르던 `tracking`, `documents`, `document_count`, `initial_tracking_proposal`은 없다(`I2.10#2`).
- `projectRegisterInputSchema`: `{id, name: slug, title, purpose, folders: projectFolders}`. `tracking` 칸이 없다(`I2.10#1`).
- `projectEditInputSchema`: `{project, name?, title?, purpose?, folders?: projectFolders}`. 하나 이상 바꾼다는 refine은 옛 것과 같다. `preview` 칸과 "folders 바꾸기는 tracking preview 필요" refine은 없다(`I1.10#15`). 하위 폴더는 `folders`에 담겨 통째로 바꾼다.
- `projectRelinkFolderInputSchema`: `{project, folder_path: abs, new_path: abs}`. 찾을 수 없게 된 등록 폴더를 사람이 새 위치로 이어 줄 때 쓴다(`I3.10#4`). compare는 `base_revision`.
- `projectApi`: `{register, edit, relinkFolder, archive, unarchive, list, get, resolve}`. 이름은 옛 route와 같게 쓴다(`project.create`, `project.update`, `project.relink_folder`, `project.archive`, `project.unarchive`, `project.list`, `project.get`, `project.resolve`). 입력·compare·actors는 옛 `project-routes.ts`를 따르고 위 schema로 바꾼다. `project.resolve`의 output은 `{project: projectRecord, folder_path}`. `PROJECT_API_ROUTES`로 묶는다.
- 옮기지 않는 것: `set_tracking`, `preview_tracking`, `tracking_roots`, `trackingRuleSet*`, `trackingPreview*`, `INITIAL_TRACKING_PROPOSAL`(`I1.10#14`의 contract 몫). `project.resolve_cwd`는 새 `projectApi`에 두지 않는다. 쓰는 곳은 coding agent CLI뿐이다(`I2.10#7`). 옛 route는 지우지 말고 coding-agent task가 판정하게 보고에 적는다.
- 이름 칸: slug `name`과 `title`을 모두 둔다. call의 `place: {project: 이름}`이 정확히 맞춰 쓰는 key가 slug `name`이다(S4 3장). 둘 중 무엇을 남길지는 문서에 답이 없다(`I2.10#6`). 이 선택을 보고 "정한 것"에 적는다.

### `project-search.ts` (req-1476~1480, `I3.10#1`의 route 몫)

- `projectSearchInputSchema`: `{project, folder?: absolutePath(등록 폴더 하나로 좁힌다), query: string(min 1, max 200), cursor?, limit?}`.
- `projectSearchMatchSchema`: `{folder_path, path: relativePath, line: int(1부터), text: string(그 줄의 snippet), start: int, end: int}`. 일치 부분은 `text` 안의 위치다. 경로 순서 다음 줄 순서로 내보낸다는 약속은 schema가 아니라 route 설명 주석 한 줄로 적는다.
- `projectSearch`: `defineRead`(core가 `apiReads`로 등록해 snapshot 없이 async로 파일을 훑는다. worker process를 새로 띄우지 않는다), `projects.search`, name `project.search`, actors `["user"]`. output `{matches, next_cursor | null}`. place·format·score·summary·건너뛴 파일 알림은 없다.
- `PROJECT_SEARCH_ROUTES`로 묶는다.

### `context-drafts.ts` (S4 4장 `context.draft`·`context.test`·`context.submit`, `I2.4#21`)

- `contextDraftOpenInputSchema`: 새 판의 초안 폴더를 연다. `z.union([{context: ctx}, {new: {id: ctx, project: prj, title, purpose}}])`. 새 context면 첫 판과 함께 context를 만든다.
- `contextDraftOpenOutputSchema`: `{context, bundle: bundleId, folder: absolutePath}`. 폴더는 lophn data 안 그 project context 아래에 있고, 판이 제출되거나 버려질 때까지만 있다. 계약과 검색 script는 Project Manager가 file tool로 그 폴더에 쓴다.
- `bundleOpenDraftRoute`: command `contexts.open_draft` (`bundle.open_draft`), actors `["agent"]`. 이미 열린 초안이 있으면 그 폴더를 돌려준다.
- `bundleTestDraftRoute`: read `contexts.test_draft` (`bundle.test_draft`), actors `["agent"]`. input `{bundle}`. output `checkReportSchema`(옛 `context-api.ts`의 것)와 같은 모양. 초안 폴더를 격리 test로 돌린다.
- `bundleSubmitRoute`는 옛 `bundle.submit`을 그대로 쓰되 input이 초안 폴더를 가리킨다(`{bundle}`뿐). 옛 `bundleSaveDraftRoute`(JSON `content`를 tool 인자로 통째로 저장)는 새 흐름에 없다.
- `bundleDiscardDraft`는 옛 것을 그대로 쓴다.
- `CONTEXT_DRAFT_ROUTES`로 묶는다.
- `I2.10#26`: actors를 정리한다. `context.create`는 agent·user, 초안 열기는 agent만, `view.save`는 user만이다. Project Manager가 saved view를 두는 것(req-0026)은 판의 `saved_views` 선언 안이다. 옛 route 정의를 바꾸지 않고 새 정의에서 이렇게 쓴다.

### `context-outlines.ts` (S4 4장 `outline.*`, req-0012)

- `contextOutlineSchema`: pdf, docs 파일의 목차. `{path: relativePath, format: "pdf" | "docs", entries: [{level: int, title: string, locator: string}]}`.
- `outlineGet`(read, `outline.get`, 모든 role), `outlineSet`(command, `outline.set`, Project Manager만), `outlineDelete`(command, `outline.delete`, Project Manager만). resource는 `contexts`. input은 모두 `{context, path}`가 기본이고 `set`은 `entries`를 더한다. compare는 `optionalBaseRevisionSchema`. 이름 `outline.*`은 옛 `outline.root` 등 wave 1이 지우는 route와 같은 접두사이므로 wave 1이 merge된 뒤 등록한다.
- `context-contract.ts`의 `OUTLINE_FORMATS`에 pdf·docs 같은 저장 목차를 더하는 것은 `contextOutlineSourceFormats`처럼 새 상수로 두고 옛 `OUTLINE_FORMATS = ["markdown"]`은 남긴다(`I2.8#2`의 contract 몫: 파일 하나의 목차 전체가 개체 하나, `min_level`·`max_level`은 깊이 제한).
- `CONTEXT_OUTLINE_ROUTES`로 묶는다.

## 할 일

1. 위 새 file 다섯과 `core/projects/ports.ts`를 만든다.
2. 지우기(쓰는 곳을 `grep -rn`로 센다. 소유 밖 file이 쓰면 지우지 말고 보고의 "안 쓰게 된 export"에 적는다. 소유 안이거나 쓰는 곳이 없으면 지운다):
   - `files.ts`의 `files.watch`, `files.status`, `file.record_result`, 이벤트 `FileWritten`·`FileRenamed`·`FileDeleted`와 `file-values.ts`의 `fileStatus*`, `filePlacement*`, `FILE_VERSION_RESULTS`, 이벤트 payload(`I1.8#1`). `files.list`·`read`·`write`·`rename`·`delete`는 편집기가 쓰는 통로이다. 형태 바꾸기("디스크 파일 경로 하나를 읽고 쓰기", hash 비교 쓰기·version 요청·placement·unlink 제거)는 screens-project와 shell main editor의 task가 쓰는 쪽에서 정하므로 이 task는 `files.ts`를 더 고치지 않고 `I2.10#8`을 보고에 적는다.
   - 문서 읽기 계약 `read.ts`·`read-values.ts`(`document.read`, `document.file`)와 `search.ts`의 옛 `search.query`·`search.status`(`I1.10#9`의 protocol 몫). 먼저 `outline-markdown.ts`는 지우지 않는다(`I2.8#1`).
   - `places.ts`의 `placeNameReservation`(문서 주소 이름 공간). 앱 등록(`core/apps/registration`)이 쓰는 동안은 남긴다.
3. `I2.8#1`(md 목차 parser): `outline-markdown.ts`에서 `key`(slug, `-2`), `anchor`(`{#id}` 꼬리), `estimated_tokens`, `body_hash`, `children_count`, HTML `<pre>` 제외를 뺀 새 함수 `parseMarkdownOutline(text)`를 더한다. 반환은 `{level, title, own_range: {start_line, end_line}, subtree_range}`의 제목 tree이다. ATX와 setext 제목만, front matter와 fenced code 안은 제외, level을 건너뛰면 가장 가까운 위 level 아래, section은 다음 같거나 적은 level 직전까지(req-1484·1485). 쓰는 곳(`contexts/extract/document.ts`, `types.ts`)은 `level`·`title`·`subtree_range`만 쓴다. 옛 `parseOutline`과 `outline-markdown-sha256.ts`(wave 1이 지움)는 건드리지 않는다. 이 순수 함수는 core와 shell이 같이 쓰므로 protocol에 둔다(code-map "여러 package가 같이 쓰는 순수 함수").
4. `I1.10#17`: 위반 넘김 route `context.hand_off_violations`와 event `ContextViolationsHandedOff`는 새 흐름에 없다(위반이 생기면 Reactor가 Project Manager를 부른다). 옛 정의는 core가 쓰는 동안 남기고 안 쓰게 되는 것으로 보고에 적는다. `ContextViolationFound`(위반이 새로 생김) event는 contract-events가 정의한다. 이 task는 만들지 않는다.
5. `I2.10#23`: 용어집 `set_by`와 route 이름을 S4 4장(`glossary.set` 하나, 읽기는 context 글에 포함)과 맞춘다. `GLOSSARY_SET_BY = ["user", "agent"]`가 이미 맞으면 바꾸지 않는다. `glossary.remove`는 사람 화면용으로 남는다. 판단을 "정한 것"에 적는다.
6. saved view의 `origin`(`SAVED_VIEW_ORIGINS`)은 core·renderer가 `"engineer"`를 쓰는 동안 바꾸지 않는다. 새 상수 `SAVED_VIEW_AUTHORS = ["user", "project_manager"] as const`를 `context-api.ts`에 더하고 옛 것은 안 쓰게 된 export로 보고한다.
7. `core/projects/ports.ts`(아래)를 만든다.
8. `protocol/projects/mod.ts`의 `export *` 줄(새 file 추가, 지운 file 제거)과 `ROUTES`·`EVENTS` 목록은 lead 몫이다. 고치지 않고 보고에 적는다. 지운 file을 `mod.ts`가 아직 export하면 type check가 깨지므로, 그 줄 제거만은 이 task가 한다(그 한 줄 외에는 `mod.ts`를 고치지 않는다).
9. (lead가 맞추며 더함) 편집기는 contract-shell의 file IPC(#93, shell main이 직접 읽고 쓴다)를 쓴다. 이 계약에 사람용 file 읽기·쓰기 route가 있으면 뺀다. agent의 file tool은 agent runtime에서 돈다.

## port: `packages/core/projects/ports.ts`

projects가 **바깥에서 받는 것**을 선언한다. type-only, 구현 없음. 구현은 wave 3 `main/daemon/wiring`이 끼운다.

```ts
// project를 등록하는 command가 같은 tx 안에서 그 project의 Project Manager를 만들어 둔다(S8 2장).
export interface ProjectManagerProvisioning {
  create(tx: Tx, project: string): Result<void>;
}
// context를 만들고 고치고 판을 올릴 수 있는 쪽을 판정한다. 그 project의 Project Manager이거나 사람이다.
export interface ContextAuthority {
  canWrite(actor: string, project: string): boolean;
}
// 초안·목차 폴더가 놓이는 lophn data 아래 위치. 파일 IO는 구현이 한다.
export interface ContextFolders {
  draftFolder(project: string, context: string, bundle: string): string;
  outlineFolder(project: string, context: string): string;
}
// 하위 폴더가 연결 폴더 밖으로 나가지 않는지 realpath로 검사한다(req-1524). 순수 함수가 못하므로 port다.
export interface FolderResolver {
  resolveInside(folderPath: string, subfolder: string): Result<string>;
  exists(folderPath: string): boolean;
}
```

- `actor` 문자열 모양은 `protocol/base/actor.ts`를 따른다. agent의 actor가 `agent:ses_…`처럼 session을 가리키는지, role과 place를 어떻게 얻는지는 places-sessions가 구현에서 푼다.
- 이름은 바꿔도 되지만 `ProjectManagerProvisioning.create`, `ContextAuthority.canWrite`의 의미는 지킨다. 바꾸면 "정한 것"에 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(type과 schema, 순수 함수 `parseMarkdownOutline`뿐이다). `parseMarkdownOutline`은 front matter·fenced code·setext 규칙이 틀리면 context 계약이 조용히 틀어진다. 이것은 결정적 판정이므로 표로 도는 test 하나를 `outline-markdown_test.ts`에 둔다: "front matter와 fenced code 안의 제목은 목차에 없고 setext 제목은 있다".
- 남지 않음: `grep -n "tracking\|Tracking" packages/protocol/projects/{project-folders,project-api,project-search}.ts`가 0줄이다. 옛 file은 쓰는 곳이 있으면 남는다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/projects/mod.ts`의 `ROUTES`에 `PROJECT_API_ROUTES`(옛 `PROJECT_ROUTES`는 places-sessions-projects가 merge될 때 뺀다), `PROJECT_SEARCH_ROUTES`, `CONTEXT_DRAFT_ROUTES`, `CONTEXT_OUTLINE_ROUTES`. 옛 `SEARCH_ROUTES`·`READ_ROUTES`·`FILE_EVENTS`를 지웠다면 목록에서 뺀다.
- 안 쓰게 된 export: 지우지 못한 것을 파일별로
- 정한 것: slug `name`과 `title`을 둘 다 둔 것, `found` 칸, `project.resolve_cwd`를 새 `projectApi`에서 뺀 것, 초안 폴더 route 이름, 목차 entry 칸
- 넘기는 것: 위반 알림 event(`ContextViolationFound`) 정의는 contract-events가 한다. 이 task는 건드리지 않았다.
- 계약 바꾸기 요청: 없음(wave 2)
