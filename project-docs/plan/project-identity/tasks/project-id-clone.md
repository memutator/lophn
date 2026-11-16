# project-id-clone

이 기계에 없는 project를 core가 clone하고 등록한다(memory route `project.clone`). project를 둘 폴더는 처음 한 번 사람에게 묻고 설정 `projects.folder`에 둔다. clone은 그 기계의 git 자격만 쓰고 묻는 창 없이 바로 실패하며 실행할 명령을 돌려준다. 임시 폴더에 받고 끝나면 rename한다. agent가 쓰는 CLI `lophn project clone`, `lophn project share`, `lophn project identity`를 더한다.

- 단위: project-id-clone (wave 2)
- 선행: project-id-core
- 소유(이 task만 고친다):
  - `packages/protocol/projects/clone-api.ts`(새 file)
  - `packages/protocol/mod.ts`(`ALL_ROUTES`에 한 줄과 import만)
  - `packages/core/projects/clone`(새 폴더 전체)
  - `packages/core/main/daemon/wiring/project-clone.ts`(새 file)
  - `packages/core/main/daemon/assembly.ts`(`WIRINGS`에 한 줄과 import만)
  - `packages/core/main/daemon/wiring/setting-declarations.ts`(설정 한 줄과 import만)
  - `packages/cli/commands/project.ts`(새 file)
  - `packages/cli/commands/mod.ts`(import와 `COMMANDS` 한 줄만)
- 읽을 것:
  - 계획: `project-docs/plan/project-identity/README.md`의 "정한 것"(clone 넷, agent가 부를 수 있는 것)과 "다른 계획이 기대는 계약" 2·4
  - 앞 task의 결과: `packages/protocol/projects/identity.ts`(`PROJECT_IDENTITY_FILE`, `parseIdentityFile`), `packages/protocol/projects/identity-api.ts`(`projectIdentityApi.identity`·`createIdentity`, 출력 schema), `packages/core/projects/registry/contexts.ts`의 `PROJECT_CLONE_CONTEXT`(`project.create`를 machine 자격으로 낸다), `packages/core/projects/lookups.ts`의 `projectByIdentity`
  - program: `/home/pyosechang/projects/lophn/reports/multi-machine/program.md` 정책 4·16
  - 비교: `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 10.2(fail-fast env, 자격 떼기, 무인 clone 안전), `paseo.md` 9.1(임시 폴더에 clone 뒤 rename, 대상 밖 경로·이미 있는 대상 거절, sign-in 명령을 data로), `happy.md` 9절(staging clone, 신분 확인 뒤 rename)
  - 본보기:
    - git 실행: `packages/core/apps/releases/prepare/git-extract.ts`의 `gitCommandRunner`(argv만, `GIT_NOT_FOUND`). 이 clone은 사람의 git 설정(credential helper)을 그대로 써야 하므로 `packages/core/apps/registration/source-folder.ts`의 `git()`처럼 `GIT_CONFIG_GLOBAL`을 비우지 않는다.
    - tx 밖에서 일하고 machine 자격으로 command를 내는 memory handler: `source-folder.ts`의 `deps.writer().command(SOURCE_FOLDER_CONTEXT, …)`, `wiring/apps.ts`의 `records`·`memory`
    - 설정 선언: `packages/core/config/shell-settings.ts`의 `remoteRelaySetting`(`locked: true`), `wiring/setting-declarations.ts`, wiring의 `ctx.settings`·`ctx.settingsUpdate`(`wiring/context.ts`)
    - slug 만들기와 겹칠 때 번호 붙여 다시: `packages/shell/renderer/desktop/workspaces/projects/core-source.ts`의 `slugOf`·`slugAttempt`(core에 작은 사본을 둔다. 이슈 `project-docs/issues/project-create-slug-retry.yaml`)
    - CLI 명령: `packages/cli/commands/app.ts`의 `defineCommand`(`effect`, `routes`, `workspaces`, `ctx.core.read`로 memory route 부르기, `ctx.workspace`), `packages/cli/commands/types.ts`
- 계약:
  - 쓰는 것: 위 "앞 task의 결과", `project.create`(machine 자격 `PROJECT_CLONE_CONTEXT`), `project.identity`·`project.create_identity`(CLI가 부른다. handler는 `project-id-sync`)
  - 내놓는 것:
    - `clone-api.ts`의 `projectClone`: `defineMemory`, resource `projects`, method `clone`, name `project.clone`, input `z.strictObject({ url: z.string().min(1).max(2048), parent: absolutePathSchema.optional(), name: z.string().min(1).max(255).optional(), title: z.string().min(1).optional(), identity: projectIdentitySchema.optional() })`, 출력 `z.object({ project: projectRecordSchema, path: absolutePathSchema, cloned: z.boolean(), note: z.string().nullable() })`, actors `["user","agent"]`, errors `invalid_input`·`conflict`·`forbidden`·`unavailable`, changes `projects`. `PROJECT_CLONE_ROUTES = [projectClone] as const`.
    - 실패의 `details.reason`: `projects_folder_unset`, `git_auth`(`details.command`에 실행할 명령), `git_not_found`, `timeout`, `git_failed`, `different_project`(`details.identity`), `target_exists`(`details.path`).
    - 설정 `projects.folder`: `z.union([z.literal(""), absolutePathSchema])`, 기본 `""`, `locked: true`.
    - CLI `project.clone`, `project.share`, `project.identity`.

## 할 일

1. `clone-api.ts`를 위 계약대로 짓고 `packages/protocol/mod.ts`의 `ALL_ROUTES`에 펼친다(이 task의 handler와 같은 merge에 들어가야 기동한다).
2. `core/projects/clone/setting.ts`: `projectsFolderSetting`(description: "The folder where lophn puts projects it clones on this computer. lophn asks the first time it clones a project."). `setting-declarations.ts`의 목록에 더한다.
3. `core/projects/clone/clone.ts`의 `cloneProject(input, deps)`. deps: `{ git: CloneRunner, fs, ids, random, writer, snapshot, settings: { folder(): string; remember(path): Promise<void> }, logger }`. 순서:
   1. URL에 자격(`https://user:token@…`, `user:pass@`)이 있으면 git을 띄우기 전에 `invalid_input`(remote 설정에 token이 남는다).
   2. `identity`를 주었고 그 id를 가진 project의 첫 폴더가 이 기계에 있으면 clone하지 않고 `{ project, path, cloned: false, note: "already on this computer" }`.
   3. 부모 폴더: `parent ?? 설정`. 없거나 빈 글이거나 디렉터리가 아니면, `parent`를 주지 않았을 때는 `invalid_input`(`details.reason: projects_folder_unset`, message "Ask the person which folder to keep projects in on this computer, then pass it as parent"), 주었으면 `invalid_input`. 설정이 비었거나 그 폴더가 없어졌고 `parent`가 있는 디렉터리면 설정에 기억한다.
   4. 폴더 이름: `name ?? URL 마지막 조각에서 .git을 뗀 것`. `/`, `\`, `..`, 빈 글은 `invalid_input`. 대상 `<parent>/<name>`이 있으면 `conflict`(`target_exists`)이고 아무것도 쓰지 않는다.
   5. `<parent>/.lophn-clone-<random>`에 `git clone --quiet -- <url> <tmp>`. env는 부모 env에 `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, `GIT_ASKPASS=""`, `GIT_SSH_COMMAND`(있으면 뒤에 ` -o BatchMode=yes`, 없으면 `ssh -o BatchMode=yes`). 10분 timeout. 실패하면 tmp를 지우고 stderr로 가른다: 자격(`Authentication failed`, `could not read Username`, `terminal prompts disabled`, `Permission denied (publickey)`, `Repository not found`) → `unavailable`(`git_auth`, command: github.com의 https면 `gh auth login`, ssh·scp면 `ssh -T git@<host>`, 그 밖은 `git clone <url>`을 terminal에서), git 없음 → `unavailable`(`git_not_found`), 시간 넘김 → `unavailable`(`timeout`), 그 밖 → `unavailable`(`git_failed`, stderr 끝 줄. URL의 자격은 이미 거절했다).
   6. tmp의 `.lophn-project.json`을 `parseIdentityFile`로 읽는다. `identity`를 주었는데 file의 id(충돌이면 작은 것)가 다르면 tmp를 지우고 `conflict`(`different_project`). file이 없으면 남기고 note "This repository has no .lophn-project.json yet. Commit and push it on the other computer, then pull here; lophn links the project when the file arrives."
   7. rename 바로 앞에 대상이 아직 없는지 다시 보고 `rename(tmp, target)`. 있으면 tmp를 지우고 `conflict`.
   8. 등록: `project.create`를 `PROJECT_CLONE_CONTEXT`로 낸다(id `ids.newId("prj")`, title `title ?? name`, slug는 title에서 만들고 이름이 겹치면 번호를 붙여 다섯 번까지, purpose `""`, 폴더 `[{ path: target, description: "" }]`). id file은 등록 뒤 `project-id-sync`의 writer가 읽는다. 등록이 실패하면 clone한 폴더는 남기고(지우면 받은 것을 잃는다) 오류에 path를 싣는다.
4. `wiring/project-clone.ts`: `records: () => [PROJECT_CLONE_CONTEXT]`, `memory: [["projects/clone", …]]`(`who`의 actor는 route가 이미 검사했다). 설정 읽기와 기억은 `ctx.settings`·`ctx.settingsUpdate`로 짓는다. `assembly.ts`의 `WIRINGS`에서 `projectsWiring` 바로 뒤에 둔다(schema step이 없다).
5. `packages/cli/commands/project.ts`의 `PROJECT_COMMANDS`(`mod.ts`의 `COMMANDS`에 더한다). 셋 다 `workspaces: ["home", "project"]`, `project` 칸이 없으면 `ctx.workspace`의 project이고 Home이면 `invalid_input`.
   - `project.clone`(`effect: "external"`, positional `url`, routes `[projectClone]`). description에 agent가 지킬 것: 이 기계에 없는 project를 사람이 쓰려 할 때 부른다. `projects_folder_unset`이면 사람에게 폴더를 한 번 묻고 `--parent`로 준다. `git_auth`면 `details.command`를 사람에게 보이고 기다린다(token을 URL에 넣지 않는다). note가 오면 사람에게 그대로 전한다.
   - `project.share`(`effect: "write"`, routes `[projectIdentityApi.createIdentity]`). description: `.lophn-project.json`을 만들어 이 저장소가 다른 기계에서도 같은 project가 되게 한다. file이 merge 충돌이면 lophn이 작은 id를 쓴다. 사람이 commit을 맡겼을 때만 그 file을 commit한다.
   - `project.identity`(`effect: "read"`, routes `[projectIdentityApi.identity]`). summary 한 줄에 id와 file 상태(예: "pri_… · not committed").

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`packages/core/projects/clone/clone_test.ts`, 임시 폴더, 가짜 `CloneRunner`(tmp에 file을 만들거나 stderr로 실패한다), 가짜 writer. subprocess 없음):
  - "대상 폴더가 있으면 그 안에 아무것도 쓰지 않고 `conflict`이며, 실패한 clone은 부모 폴더에 아무것도 남기지 않는다"
  - "기대한 id와 다른 저장소는 지워지고 등록되지 않으며, 자격이 박힌 URL은 git을 띄우기 전에 거절된다"
- 남지 않음: 없음.
- flows catalog: 새 flow `project-clone`(갈래: cloned, already-here, folder-unset, target-exists, auth, different-project, no-identity-file), CLI 명령 셋(area `cli`), 설정 `projects.folder` 줄, test file 줄을 `project-docs/flows/`에서 고친다(자기 줄만. `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서:

- 넘길 줄: `assembly.ts`, `setting-declarations.ts`, `packages/protocol/mod.ts`, `packages/cli/commands/mod.ts`에 더한 줄(다른 계획도 이 file들을 고친다).
- 실제 git으로 해 본 것: 공개 저장소 하나를 임시 부모 폴더에 clone(test로 남기지 않는다). 자격이 필요한 저장소는 띄우지 않는다.
- 사람이 폴더를 바꾸는 길이 `lophn settings set projects.folder <path>`뿐인 것(화면 없음)을 lead가 사람에게 알릴지.
