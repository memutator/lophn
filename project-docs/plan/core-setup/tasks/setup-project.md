# setup-project

project 더하기(id 만들기, 이름에서 slug 만들기, slug가 겹치면 번호를 붙여 다시)를 core route 하나로 옮기고, 다른 기기가 그 기계의 폴더를 고를 수 있게 사람의 home 아래만 읽는 폴더 목록 route를 더한다. desktop의 등록 dialog가 새 route를 쓰고 화면의 사본을 지운다.

- 단위: setup (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/projects/add-api.ts`(새 file)
  - `packages/core/projects/`(`clone/clone.ts`, `register.ts`, 새 file)
  - `packages/core/main/daemon/wiring/projects.ts`
  - `packages/shell/renderer/desktop/workspaces/{register-dialog.tsx,source.ts}`, `packages/shell/renderer/desktop/workspaces/projects/`
  - `packages/shell/renderer/shell/workspaces-panel.tsx`
  - `project-docs/flows/areas/{projects,shell-workspace}.yaml`
- 읽을 것:
  - 계획 README "정한 것"의 순서, 폴더
  - architecture: `project-docs/architecture/project-identity.md`("모델"의 만드는 때·clone, "경계와 계약"의 route, "지키는 것" 1), `project-docs/architecture/agent-definition.md` 20(경로를 realpath로 판정하는 규칙. 같은 방법을 쓴다)
  - 조사: `reports/multi-device/survey-s4-setup-tabs.md` 1.2의 "Add a project" 줄, G5
  - 지금 순서: `packages/shell/renderer/desktop/workspaces/projects/core-source.ts`(`createProject`, `slugOf`, `slugAttempt`), `packages/shell/renderer/desktop/workspaces/register-dialog.tsx`(`newProjectId`), `packages/core/projects/clone/clone.ts`(`register`, 같은 `slugOf`·`slugAttempt`의 core 사본)
- 계약:
  - 쓰는 것: `project.create`(`projectApi.register`, `packages/protocol/projects/project-api.ts`. core가 부르는 ledger command로 남는다), `projectFoldersSchema`, `projectRecordSchema`, `absolutePathSchema`, `homeOf`(`packages/base/os/home.ts`)
  - 내놓는 것(`setup-scope`, `setup-viewer`가 이 이름으로 쓴다). route는 `add-api.ts`의 `PROJECT_ADD_ROUTES`에 둔다:
    - `projects/add`: memory, name `project.add`, actors user. input `{title: string(1..), purpose: string, folders: projectFoldersSchema}`. 결과 `projectRecordSchema`. core가 `prj_` id를 만들고 title에서 slug를 만들어 `project.create`를 부른 사람의 context로 보낸다. slug가 겹치면(`conflict`) `-2`부터 번호를 붙여 5번까지 하고, 다 겹치면 `conflict`다. changes `projects`(id는 결과의 id).
    - `projects/browse`: memory, name `project.browse`, actors user. input `{path?: absolutePath}`(없으면 home). 결과 `{home, path, parent: string | null, entries: [{name, path}], truncated: boolean}`. entries는 폴더만, 이름순, 500개까지(넘으면 `truncated: true`). home에서는 `parent`가 null이다.
    - 읽는 범위: home은 core가 `homeOf(process.env, process.platform)`을 realpath한 값이다. 요청 path의 realpath가 home과 같거나 home 아래(`path.relative(home, target)`이 `..`로 시작하지 않고 절대 path가 아니다)일 때만 읽고, 아니면 `forbidden`이다. 없는 path는 `not_found`, 폴더가 아니면 `invalid_input`. 목록의 symlink는 realpath가 home 아래인 폴더만 싣는다. 결과의 path는 모두 realpath다.

## 정한 것

- identity file 만들기("Same project on my other computers")는 `projects/add`에 넣지 않는다. 지금처럼 등록한 뒤 화면이 `projects/create_identity`를 부른다. 이미 route 하나가 그 일을 쥐고 있다.
- 폴더 목록은 숨은 폴더(`.`으로 시작)도 싣는다. 거르면 사람이 `~/.config` 아래 project를 고르지 못한다.
- 폴더 목록 handler는 home과 file system을 인자로 받는다(AGENTS.md "코드"). wiring이 home을 한 번 읽어 준다.
- 이 기계의 창은 OS 폴더 고르기 창(`pickFolder`)을 그대로 쓴다. 폴더 목록 route는 다른 기기의 창이 쓴다(`setup-viewer`).

## 할 일

1. `packages/protocol/projects/add-api.ts`에 두 route와 `PROJECT_ADD_ROUTES`를 둔다.
2. `packages/core/projects/`에 이름 규칙(`slugOf`, `slugAttempt`, 시도 5번)을 한 곳에 두고 `clone/clone.ts`의 사본을 지운다. 같은 곳에 "id를 만들고 slug를 바꿔 가며 `project.create`를 보내는" 함수를 두고 clone의 `register`와 `projects/add`가 같이 쓴다(clone은 `PROJECT_CLONE_CONTEXT`, add는 부른 사람의 context).
3. 폴더 목록 함수를 `packages/core/projects/` 안 새 file에 둔다(위 범위 규칙).
4. `wiring/projects.ts`에 두 handler를 붙이고 `packages/core/projects/register.ts`의 `memoryRoutes`에 route를 더한다. id는 `createIdSource({clock, random})`로 만든다(이미 그 wiring에 있다).
5. renderer: `coreProjectsSource.register`가 `projects/add`를 부르고 `createProject`, `slugOf`, `slugAttempt`, `NAME_ATTEMPTS`, `SLUG_MAX`를 지운다. `ProjectDraft.id`, `register-dialog.tsx`의 `newProjectId`와 `newId("prj")`, `workspaces-panel.tsx`의 `newProjectId` prop을 지운다. `projects/testdata/fake-projects.ts`를 맞춘다. 화면 모양은 바뀌지 않는다(gallery `home-register`가 그대로 그려진다).
6. flows: 새 route 두 줄과 등록 flow의 순서(`projects.yaml`, `shell-workspace.yaml`)를 고친다(`flows` skill).

## 끝남

- `npm run check`가 통과하고 `node packages/shell/renderer/build.ts`가 선다. `npm run wireframes`가 되고 gallery `home-register`가 그려진다.
- 위험 test: "폴더 목록 읽기가 정한 범위 밖을 읽지 못한다" — 임시 폴더를 home으로 주고 `..`, home 밖 절대 path, home 밖을 가리키는 symlink를 열면 `forbidden`이고, home 밖을 가리키는 symlink는 home 목록에 실리지 않는다(`packages/core/projects/` 안 `*_test.ts`, 표 하나로).
- subprocess나 core를 띄우는 test, E2E는 만들지 않는다.
- 남지 않음: `grep -rn "newProjectId\|slugAttempt\|NAME_ATTEMPTS" packages/shell tools tests`가 0줄, `grep -rn "function slugOf" packages`가 1줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 이 task는 다음을 적는다: `packages/protocol/projects/mod.ts`의 `ROUTES`에 `PROJECT_ADD_ROUTES`, renderer allowlist(`packages/shell/main/desktop/core/allowlist.ts`, `setup-provider` 소유)에 `memory:projects/add`, 기기의 사람 route 목록(`setup-scope`)에 `projects/add`·`projects/browse`(`projects/add`가 안에서 부르는 `projects/create`는 부른 기기의 자격으로 가므로 `setup-scope`가 이미 목록에 둔다), `project-docs/flows/tests/core-rest.yaml`에 새 test file과 덮는 outcome(이 file은 같은 wave의 `setup-scope` 소유다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
