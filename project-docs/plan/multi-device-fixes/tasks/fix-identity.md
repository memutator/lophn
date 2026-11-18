# fix-identity

git을 읽지 못한 project에 ledger id를 만들지 않는다: 폴더(와 그 위)에 `.git`이 있는데 git이 답하지 않으면 그 읽기는 "git이 아니다"가 아니라 읽지 못한 것이다. data step `projects.born-identity`에도 같은 규칙을 걸고 그 step을 실제 ledger로 test한다. 앱이 받는 id가 바뀌는 경우를 문서에 적고, review가 찾은 낡은 문서와 작은 것을 고친다.

- 단위: fix (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/projects/identity/{inspect.ts,file.ts,identity_test.ts}`
  - `packages/core/projects/registry/store.ts`
  - `packages/core/main/daemon/wiring/projects.ts`, `packages/core/main/daemon/wiring/projects_test.ts`(새 file)
  - `packages/core/storage/migration/{data-steps.ts,data-steps_test.ts}`
  - `project-docs/architecture/project-identity.md`
  - `project-docs/products/roadmap/multi-device.md`
  - `project-docs/flows/areas/projects.yaml`, `project-docs/flows/tests/core-rest.yaml`
  - `project-docs/issues/project-identity-agent-project-scope.yaml`, `project-docs/issues/project-born-identity-before-git-read.yaml`(새 file)
- 읽을 것:
  - 계획 README "정한 것 › data"의 첫 줄, "위험 test"
  - review `reports/multi-device/review-project-address.md` 전부(finding 1~7, "Docs and catalog pieces checked", "Issues")
  - change-log `project-docs/products/change-log/0.23/project-address.yaml`의 결정 1~4
  - architecture: `project-docs/architecture/project-identity.md`(지키는 것 12, 결정 "git이 아닌 project도 `pri_`", "id를 내는 자리는 `project.record_identity` 하나")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `projects`
- 계약:
  - 쓰는 것: `GitReader.topLevel`(`packages/core/projects/identity/git.ts`. 못 읽으면 null), `IdentityFs`(`file.ts`), `DataStep`·`DataStepDeps`·`applyDataSteps`(`packages/core/storage/migration/data-steps.ts`), `assignBornIdentities`(`store.ts`)
  - 내놓는 것: `IdentityFs.hasGit(folder): Promise<boolean>`, `DataStep.run(root, deps: DataStepDeps)`(deps가 꼭 있다)

시작 전에 다시 볼 것: `core-browser`의 `page-host`가 `project-docs/flows/tests/core-rest.yaml`을 소유한다. `status.py ready`가 거르는 대로 띄우고, 띄울 때 그 file을 merge된 것으로 다시 본다.

## 할 일

1. git을 읽지 못한 것(finding 1, README "git을 읽지 못한 것은 'git이 아니다'가 아니다").
   - `file.ts`의 `IdentityFs`에 `hasGit(folder)`를 더한다: 폴더나 그 위 폴더 가운데 `.git`(폴더든 file이든)이 있으면 true다. 위로 올라가는 것은 git이 저장소를 찾는 길과 같아서다(monorepo의 project 폴더에는 `.git`이 없다).
   - `inspect.ts`의 `inspectFolder`: `topLevel`이 null이고 `hasGit`이 true면 결과를 내지 않고 던진다. `service.ts`의 `guarded`가 그것을 `unavailable`로 바꾸고 아무것도 쓰지 않는다(git timeout과 같은 길). `hasGit`이 false일 때만 지금처럼 `repo: "none"`이다.
   - `store.ts`의 `assignBornIdentities(sql, ids, hasGit)`: `repo = 'none'`으로 남은 행 가운데 폴더 하나라도 `hasGit`이 true인 project는 건너뛴다(앞서 git을 못 읽어 `none`으로 남은 행일 수 있다). 폴더가 없는 project는 지금처럼 준다. `wiring/projects.ts`의 step이 동기 fs 판정(`existsSync`로 위로 올라가며)을 넘긴다.
2. 이미 잘못 붙었을 수 있는 id(README "이미 잘못 붙은 id가 있는지는 고칠 수 없다. 이슈로 남긴다"). `issue` skill대로 새 이슈 `project-born-identity-before-git-read`(kind bug, topic `project-identity`)를 쓴다: 이 고침 전에 git이 실패한 기계에서 git project가 ledger id를 받았을 수 있고 ledger는 "git이 아니다"와 "git이 실패했다"를 구별할 기록이 없다. 그 id는 [Restore]가 file에 써 안정하다는 것(`service.ts:171`)과 고치는 안(사람이 [Separate project]로 새 id)을 적는다.
3. data step(finding 2). `data-steps.ts`의 `DataStep.run(root, deps?)`의 `deps`를 꼭 받게 한다(인자가 적은 함수는 그대로 맞는다). `data-steps_test.ts`의 부르는 곳을 맞춘다. `wiring/projects.ts:88-93`의 `catch {}`는 던진 원인을 message에 싣는다(finding 7).
4. 앱이 받는 id가 바뀌는 경우(finding 3). `project-identity.md:83` 둘레의 "git이 아닌 project의 id는 `git init` 뒤에도 바뀌지 않는다"를 고친다: 폴더에 id file이 생기면(clone이 들여오거나 pull) file id가 ledger id를 대신하고(`commands.ts:343-360` `recordedIdentity`), [Separate project]는 새 id를 쓴다. 그때 앱이 옛 id로 key한 행은 어느 project에도 속하지 않는다. 아직 폴더를 읽지 않은 보관 project는 `identity`가 null이다(finding 7). SDK guide(`packages/sdk/app-ui/guide.md`)는 고치지 않는다(정한 것).
5. 문서(finding 4): `multi-device.md`의 순서 표 1번 줄을 끝남으로, "순서 1" 아래에 "git project는 id를 file에서만 얻는다(change-log 결정 2)"를 더하고, `:156`, `:180-182`와 "지금 code" 묶음에서 git이 아닌 project에 id가 없다는 글을 지금에 맞춘다. `project-identity.md:114` 둘레(git project는 ledger에서 id를 내지 않는다)에 git을 읽지 못하면 아무것도 쓰지 않는다를 더한다.
6. 작은 것(finding 7): 이슈 `project-identity-agent-project-scope`의 `now`에 "`project.identity`가 git이 아닌 project에 id를 낸다"를 한 줄 더한다. CLI `project.identity`의 `effect: "read"`는 그대로 둔다.
7. 확인만(finding 6, PLAUSIBLE): 프로젝트 창의 앱 탭이 `loaded.project`가 오기 전에 열려 `place.workspace.identity`가 null로 굳는지 `packages/shell/renderer/workspace/workspace-window.tsx:3248-3251`과 앱 view 여는 순서로 본다(그 file은 `core-browser`가 고치고 있어 고치지 않는다). 맞으면 `issue` skill "올릴지"를 거쳐 bug 이슈로 쓰고, 아니면 보고에 적는다.
8. finding 5(손으로 베낀 workspace 모양의 test)는 test를 더하지 않는다(정한 것).
9. flows(`flows` skill): `projects.yaml`의 `project-identity-read`·`project-identity-record`에 "`.git`이 있는데 git이 답하지 않음 → unavailable, 쓰지 않음" outcome, `projects-born-identity`에 건너뛰는 행, 그 step의 covers를 새 test로. `tests/core-rest.yaml`에 `packages/core/main/daemon/wiring/projects_test.ts`를 더하고 `identity_test.ts`의 covers를 맞춘다. 다른 task가 보고로 넘긴 `projects.yaml`·`core-rest.yaml` 글(`fix-terminals`: `projects.yaml:2044-2069`의 `shell-<pid>`, core-rest의 터미널 test note)은 lead가 합친 뒤 넣는다.

정한 것:
- SDK guide와 `migrate-sdk` 메모는 이 task에서 쓰지 않는다: guide를 고치면 SDK 판과 pin과 메모가 따라오는데, 두 project를 잇는 일(`one-screen`)이 id가 바뀌는 규칙을 다시 정하고 그때 guide를 한 번 고친다. 지금은 architecture 문서에 적는다.
- finding 5의 test는 쓰지 않는다: 틀리면 화면이 place를 못 받는 것이라 사용자 data를 잃거나 권한이 열리지 않는다(AGENTS.md "속도"의 테스트 기준).
- `realHome()`(`wiring/projects.ts`)의 `process.env` 읽기는 그대로다: wiring이 전역 값을 인자로 바꾸는 가장자리다(`fix-setup`이 같은 기준으로 정한다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`packages/core/projects/identity/identity_test.ts`): "git이 실패하는 project에 id가 생기지 않는다". 가짜 git의 `topLevel`이 null이고 폴더에 `.git`이 있으면 `reconcile`이 `unavailable`이고 ledger의 `identity`·`repo`가 그대로다. `.git`이 없는 폴더는 지금처럼 `pri_`를 받는다. `assignBornIdentities`는 `.git`이 있는 `repo = 'none'` 행에 id를 주지 않는다.
- test(`packages/core/main/daemon/wiring/projects_test.ts`): 임시 data root의 `lophn.db`에 git이 아닌 것, 폴더 없는 것, 보관한 것, git인 것, 이미 id가 있는 것을 넣고 `projectsWiring`의 `dataSteps`로 `applyDataSteps`를 두 번 돌린다. 첫 번에 맞는 행만 id를 받고, 둘째는 아무것도 바꾸지 않고, `fresh` root는 step을 돌리지 않는다.
- subprocess(git)를 띄우는 test를 새로 만들지 않는다. git은 가짜 `GitReader`다.
- 남지 않음: `grep -rn "deps?: DataStepDeps" packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). `boundary-catalog.yaml:39-41`(`projects`: git이 아닌 project는 ledger 값이 원본이고, 앱이 `identity`를 받는다)에 넣을 글도 여기 적는다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
