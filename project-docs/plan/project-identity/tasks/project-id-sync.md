# project-id-sync

**opus high.**

core가 project 폴더의 id file을 읽고 쓰며 ledger를 file에 맞춘다. 폴더 읽기(git은 읽기만), file 만들기(없을 때만)와 덮기(사람이 고른 두 경우만), 기동·project 쓰기 뒤·묻는 route마다 다시 읽기, memory route 넷(`project.identity`, `project.create_identity`, `project.renew_identity`, `project.match`)의 handler를 짓는다.

- 단위: project-id-sync (wave 2)
- 선행: project-id-core
- 소유(이 task만 고친다):
  - `packages/core/projects/identity`(새 폴더 전체)
  - `packages/core/main/daemon/wiring/projects.ts`
  - `packages/protocol/projects/mod.ts`(`ROUTES`에 `...PROJECT_IDENTITY_MEMORY_ROUTES` 한 줄만)
- 읽을 것:
  - 계획: `project-docs/plan/project-identity/README.md`의 "정한 것"(만드는 때, 덮지 않음, Restore, 충돌, fork, 한 기계에 한 id, monorepo, 다시 읽는 때, git이 아닌 폴더)과 "다른 계획이 기대는 계약" 1~5
  - 앞 task의 결과: `packages/protocol/projects/identity.ts`(`PROJECT_IDENTITY_FILE`, `parseIdentityFile`, `serializeIdentityFile`, `remoteKeyOf`, `matchProjects`), `packages/protocol/projects/identity-api.ts`(`projectIdentityApi`, `PROJECT_IDENTITY_MEMORY_ROUTES`, `projectIdentityStatusSchema`, `projectMatchSchema`), `packages/core/projects/registry/contexts.ts`의 `PROJECT_IDENTITY_CONTEXT`, `packages/core/projects/lookups.ts`의 `projectByIdentity`, `ProjectRecord`의 `identity`·`repo`·`remote`
  - 조사: `/home/pyosechang/projects/lophn/reports/multi-machine/code-survey.md` F
  - 비교: `/home/pyosechang/projects/harness-lab/_report/multi-device/mixdog.md` 8.1(없을 때만 만들고 덮지 않음), `t3code.md` 8.2(`git remote -v`의 fetch 줄, `rev-parse --show-toplevel`)
  - architecture: `project-docs/architecture/platform.md`(기동 순서, wiring hook)
  - 본보기:
    - tx 밖에서 file·git을 하고 writer에 machine 자격으로 command를 내는 길: `packages/core/apps/registration/source-folder.ts`(`withSourceFolder`가 writer를 감싸 `app.create` 뒤에 일하고 `deps.writer().command(SOURCE_FOLDER_CONTEXT, …)`), `packages/core/main/daemon/wiring/apps.ts`의 `writer: (inner) => …`와 `records`, `memory`
    - argv만 쓰는 git 실행과 출력 상한: `packages/core/apps/releases/prepare/git-extract.ts`의 `gitCommandRunner`(`GIT_NOT_FOUND`)
    - ledger를 짧게 읽는 길: 지금 `wiring/projects.ts`의 `projectSearch.snapshot`(`openConnection(ctx.ledgerPath)`)과 `packages/core/projects/registry/store.ts`의 `loadProject`·`loadProjects`
    - temp에 쓰고 옮기는 file 쓰기: `packages/core/storage/migration/ledger-id.ts`
    - memory handler와 route 이름(`resource/method`): `wiring/apps.ts`의 `["apps/call_tool", async (who, body) => …]`, `core.ts`의 `memoryRouteMismatch`(route와 handler가 짝이어야 기동한다)
- 계약:
  - 쓰는 것: 위 "앞 task의 결과", `project.record_identity`(machine 자격 `PROJECT_IDENTITY_CONTEXT`)
  - 내놓는 것: memory route 넷의 동작(README 계약 3·4). `packages/core/projects/identity/mod.ts`의 `inspectFolder(folder, deps): Promise<FolderIdentity>`(`project-id-clone`이 쓰지 않아도 되게 순수한 꼴로 둔다), `createIdentityService(deps)`.

## 할 일

1. `identity/git.ts`: 읽기만 하는 `GitReader` type과 실제 구현. type에 쓰기 동작을 두지 않는다.
   - `topLevel(dir): Promise<string | null>`: `git -C <dir> rev-parse --show-toplevel`. work tree가 아니면 null. git이 없으면 null이고 log 한 줄(`GIT_NOT_FOUND`).
   - `remotes(dir): Promise<{ name, url }[]>`: `git -C <dir> remote -v`의 `(fetch)` 줄.
   - `fileState(dir, file): Promise<"tracked" | "changed" | "untracked" | "ignored" | "conflict">`: `git -C <dir> status --porcelain=v1 --ignored=matching -- <file>`. 빈 출력은 `tracked`, `??`는 `untracked`, `!!`는 `ignored`, 두 칸이 `U`이거나 `AA`·`DD`면 `conflict`, 나머지는 `changed`.
   - env는 부모 env에 `GIT_OPTIONAL_LOCKS=0`(status가 사람의 index를 고쳐 쓰지 않게), `GIT_TERMINAL_PROMPT=0`을 더한다. 사람의 git 설정은 그대로 읽는다. argv 배열만, 10초 timeout, 출력 64 KiB 상한.
2. `identity/file.ts`:
   - `readIdentityFile(folder): Promise<"absent" | ParsedIdentityFile>`(`parseIdentityFile` 결과).
   - `createIdentityFile(folder, id): Promise<Result<"created" | "exists">>`: `<folder>/.lophn-project.json.<random>.tmp`에 `serializeIdentityFile(id)`을 쓰고 datasync한 뒤 `link(tmp, target)`. `EEXIST`면 `exists`이고 target을 건드리지 않는다. tmp는 어느 경우든 지운다. 이 함수가 사람의 저장소에 file을 만드는 유일한 길이다.
   - `replaceIdentityFile(folder, id)`: tmp에 쓰고 `rename`. 부르는 곳은 아래 `renew`와 충돌 `create`뿐이다.
3. `identity/inspect.ts`의 `inspectFolder(folder, { git, fs })`: 폴더가 없으면 `{ found: false, … }`. `topLevel`이 null이면 `repo: "none"`, file은 보지 않는다. git이면 `subpath`(top-level에서 folder까지 상대 경로, `/`로), `remote = remoteKeyOf(remotes, subpath)`, file을 읽어 `file: "none" | "committed" | "uncommitted" | "ignored" | "conflict" | "unreadable"`와 `file_identity`(충돌이면 가장 작은 id, 못 읽으면 null)를 낸다. `committed`는 `fileState`가 `tracked`일 때, `uncommitted`는 `untracked`·`changed`, `ignored`는 `.gitignore`가 빼는 것(README 계약 3의 file 상태에 `ignored`를 더한다. 화면이 ".gitignore excludes it"을 보인다). 위로 올라가 다른 폴더의 file을 찾지 않는다.
4. `identity/service.ts`의 `createIdentityService({ git, fs, ids, writer, snapshot, logger })`:
   - `reconcile(project)`: 첫 폴더를 `inspectFolder`로 읽고 `project.record_identity`를 `PROJECT_IDENTITY_CONTEXT`로 낸다(폴더가 없으면 `found: false`). project에 폴더가 없으면 하지 않는다.
   - `status(project)`: reconcile 뒤 README 계약 3의 모양. file이 `none`이고 ledger에 id가 있으면 `missing`이다. file의 id가 이 project의 `identity`와 다르고 다른 project가 그 id를 가졌으면 `duplicate_of`.
   - `create(project)`: 폴더가 없으면 `not_found`, git이 아니면 `invalid_input`("not a git repository"). 읽을 수 있는 file이 있으면 쓰지 않는다. `unreadable`이면 `conflict`("<path> cannot be read; fix or delete it")이고 쓰지 않는다. `conflict`면 이긴 id로 `replaceIdentityFile`. 없으면 ledger의 id(Restore), 없으면 `ids.newId("pri")`로 `createIdentityFile`(`exists`면 다시 읽기만). 끝에 `status`를 돌려준다.
   - `renew(project)`: 폴더가 있고 git이어야 한다. 새 id로 `replaceIdentityFile` 뒤 `status`.
   - `match(path)`: `inspectFolder(path)`로 읽고(쓰지 않는다) 이 기계의 project 목록을 `ProjectKeys`로 바꿔 `matchProjects([target], locals)`. `same`은 file의 id를 가진 project, `suggestions`는 remote key로 짝이 된 project(폴더를 잃었거나 id가 없는 것). README 계약 4.
5. `wiring/projects.ts`:
   - `records: () => [PROJECT_IDENTITY_CONTEXT]`.
   - `writer`: `project.create`, `project.update`(input에 `folders`가 있을 때), `project.relink_folder`, `project.unarchive`가 commit되고 replay가 아니면 그 project를 `reconcile`한 뒤 원래 결과를 돌려준다(reconcile 실패는 log만, 결과는 그대로). `withSourceFolder`의 꼴.
   - `memory`: `projects/identity`, `projects/create_identity`, `projects/renew_identity`, `projects/match`. 입력은 route schema로 이미 검사된다.
   - 기동: `start`(또는 `afterReady`)에서 active project 전부를 4개씩 `reconcile`한다. 기동을 막지 않는다. 실패는 project마다 log 한 줄.
   - `protocol/projects/mod.ts`의 `ROUTES`에 `...PROJECT_IDENTITY_MEMORY_ROUTES`를 펼친다.
6. 사람의 저장소에서 `.lophn-project.json` 밖의 path를 쓰는 코드, git의 쓰기 명령(`add`, `commit`, `checkout`, `config`, `stash`, `reset`, `merge`)을 부르는 코드를 두지 않는다(README "정한 것", program 2).

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`packages/core/projects/identity/identity_test.ts`, 임시 폴더와 가짜 `GitReader`. subprocess 없음):
  - "`create`는 폴더에 `.lophn-project.json` 하나만 더하고 다른 file은 byte 그대로이며, file이 있으면(읽을 수 있든 없든) 그 byte를 바꾸지 않는다"
  - "`renew`와 충돌의 `create`만 file을 덮고, 충돌 file은 양쪽 순서와 상관없이 작은 id로 쓰인다"
  - "폴더가 없거나 git이 아닌 폴더에서 `create`는 아무 file도 만들지 않는다"
- 남지 않음: 없음.
- flows catalog: 새 flow `project-identity-read`, `project-identity-create`(갈래: created, restored, resolved, already, not-git, unreadable), `project-identity-renew`, `project-match`, 그리고 `project-register`·`project-edit`·`project-relink-folder`·`project-unarchive`의 "commit 뒤 file을 다시 읽는다" step, `core-boot`의 다시 읽기 step을 `project-docs/flows/`에서 고치고 test file 줄을 `project-docs/flows/tests/core-rest.yaml`에 더한다(자기 줄만. area `projects`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서:

- 실제 git으로 해 본 것(개발 core 없이 `node`로 `inspectFolder`를 임시 저장소에 돌려 본 결과: 깨끗한 저장소, untracked, `.gitignore`가 뺀 것, merge 충돌, 하위 폴더 project의 remote key). test로 남기지 않는다.
- Windows에서 `link`가 안 되는 file system(FAT, 일부 network drive)일 때의 동작(대신 `open(…, "wx")`로 떨어지는지)과 그 판단.
- lead가 고칠 목록: 새 `architecture/project-identity.md`의 재료(file 상태 표, 다시 읽는 때).
