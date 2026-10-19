# dp-project-folderless

사람의 폴더 없이 project를 등록할 수 있게 한다(앱 data만 있는 project). 그 project의 `LOPHN.md`는 lophn data 자리 `<data>/projects/<prj>/LOPHN.md`를 읽는다. 등록과 지침 읽기의 core 쪽만 한다. 화면은 wave 2의 `dp-shell-folderless`가 한다.

- 단위: app-binding (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/projects/project-folders.ts`
  - `packages/core/projects/registry/`
  - `packages/core/lophn-agent/instructions/`
  - `packages/core/main/daemon/wiring/instructions-registration.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`(지침 층), `project-docs/architecture/place-session.md`(file 범위)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `projects`, `agents`, `project-docs/module-catalog.yaml`의 `packages/core/projects`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > folder 0개인 project", `project-docs/products/roadmap/domain.md`의 "폴더"
- 계약:
  - 쓰는 것: `packages/core/agent-roles/place/data-folder.ts`의 `projectsDataArea(root)`(`<root>/projects`). core 사이 import를 피하려고 이 task는 값을 wiring에서 건네받는다.
  - 내놓는 것:
    - `project.create`·`project.update`의 `folders`가 빈 배열을 받는다. 중복·겹침 검사는 그대로다.
    - 지침 읽기 `GetInstructions`의 project 층: 등록 폴더가 있으면 첫 폴더의 `LOPHN.md`, 없으면 `<data>/projects/<prj>/LOPHN.md`.

## 할 일

1. `packages/protocol/projects/project-folders.ts`: `projectFoldersSchema`의 `.min(1)`과 "폴더 없이 등록할 수 없다" 주석을 지운다.
2. `packages/core/projects/registry/model.ts`의 `validateFolderRoots`(152째 줄): 폴더가 0개면 거절하는 분기를 지운다(빈 목록은 통과). `commands.ts`의 `register`·`edit`은 빈 `folders`로도 돈다. `registry_test.ts`에서 "폴더 필요"를 단언한 것을 새 규칙으로 고친다.
3. `packages/core/lophn-agent/instructions/files.ts`의 `InstructionReadDeps.projectFirstFolder`가 폴더 없는 project에 null을 돌려 `readInstruction`(177째 줄)이 `ok(null)`을 내는 것을 고친다. deps에 `projectDataFolder(root, project): string`을 더해, 첫 폴더가 없으면 `${projectDataFolder}/LOPHN.md`를 연다. `read_test.ts`를 맞춘다.
4. `packages/core/main/daemon/wiring/instructions-registration.ts`: `projectDataFolder`를 `agent-roles/place/data-folder.ts`의 `placeDataFolder`(project place)로 꽂는다.
5. 위험 test는 두지 않는다(화면·문구가 아니면서 이미 registry_test와 read_test가 보는 동작이다). 위 두 test만 새 규칙에 맞춘다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "a project needs a folder\|폴더 없이 등록할 수 없다" packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(wiring file은 소유에 든다)
- 안 쓰게 된 export
- 정한 것: 폴더가 0개인 project의 지침 file 위치
- 넘길 줄: 화면의 등록 form과 편집기 경로는 `dp-shell-folderless`가 맞춘다
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 폴더 없는 project의 `LOPHN.md`는 PM의 file 범위 밖이라 PM이 쓰지 못한다(범위는 `dp-agent-roles-scope`가 정한다. 같은 문제를 `domain-kinds`의 `kinds.yaml`·`artifact`의 `artifacts/`도 갖는다)
