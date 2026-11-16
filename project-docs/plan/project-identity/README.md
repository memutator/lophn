# project-identity: 같은 저장소는 어느 기계에서도 같은 project다

- 목표: roadmap `multi-machine.md` "모양" 4. git 저장소인 project는 저장소 안 file `.lophn-project.json`에 기계를 넘는 id(`pri_…`)를 갖고, ledger는 지금의 기계별 id(`prj_…`) 옆에 그 id를 둔다. code는 git이 옮기므로 다른 기계에서 clone이나 pull로 file이 오면 같은 project로 알아본다. agent가 이 기계에 없는 project를 clone해 등록한다. 마지막 task는 desktop이 다른 기계를 볼 때 같은 id의 project를 한 project로 묶는다. 사람의 말: "내 lophn 프로젝트는 메인 머신에서도 맥북 머신에서도 같은 의미여야돼".
- 재료: `/home/pyosechang/projects/lophn/reports/multi-machine/program.md`(계획 사이 경계와 정책 1~4·16. roadmap과 다르면 이것이 새것이다), `project-docs/products/roadmap/multi-machine.md`("모양" 4·5), 코드 조사 `/home/pyosechang/projects/lophn/reports/multi-machine/code-survey.md`(F, G, (1)·(2)의 project 줄), harness 비교 `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 9절·10절·14절과 같은 폴더의 `mixdog.md` 8절, `paseo.md` 8·9절, `t3code.md` 8절, `orca.md` 8·9절, `open-code.md` 8절, `emdash.md` 8.5절, 바탕 계획 `project-docs/plan/machine-identity/README.md`("다른 계획이 기대는 계약").
- 범위 밖(가는 곳):
  - project에 딸린 지침과 설정을 저장소 file로 옮기기: 정하지 않았다(아래 "사람이 정할 것").
  - session과 대화를 기계 사이에 옮기거나 맞추기: 하지 않는다(사람, roadmap).
  - code 옮기기: git이 한다. lophn은 commit, push, pull을 스스로 하지 않는다.
  - 폴더 교환, 앱 source bundle, agent가 읽는 환경 도구: `app-folder-sync`(아래 "다른 계획에 넘기는 것").
  - agent가 다른 기계에 일을 보내기: 보류(roadmap "보류").
  - 다른 기계 보기 자체(desktop pairing, 기계 고르기): `desktop-remote`.

## 정한 것

- id file은 사람의 저장소 안에 있고 git remote는 힌트로만 쓴다: remote로 식별하면 fork가 합쳐지고 origin을 바꾸면 신분이 바뀐다 (planner, program 1).
- lophn은 그 file 하나만 쓰고 사람의 저장소에 commit, add, checkout 같은 git 쓰기를 하지 않는다. commit은 사람이나 agent가 한다 (planner, program 2).
- file 자리는 project의 첫 등록 폴더 바로 아래 `.lophn-project.json`이다: app 저장소의 `.lophn/`(lophn이 채우는 `.lophn/sdk/`, 앱의 `.lophn/skills/`, `.lophn/`을 통째로 빼는 `.gitignore`가 흔하다)와 섞이지 않고, 첫 폴더는 `LOPHN.md`를 읽는 자리와 같다 (planner).
- file 내용은 `{ "lophn_project": 1, "id": "pri_<ULID>" }`뿐이다. 폴더 이름, remote, 경로, 기계 id, 이름을 넣지 않는다: 폴더 이름 기본값이 다른 저장소를 섞은 mixdog의 구멍을 피하고, 이름을 넣으면 rename마다 file을 다시 써 merge 충돌을 만든다. 이름(title)은 기계마다 ledger에 그대로 있다 (planner).
- file을 만드는 때: git 폴더를 등록하는 dialog의 "Same project on my other computers"(기본 켬)와, project 상세의 [Set up](이미 있는 project, 끈 project), agent의 `lophn project share`. 판을 올릴 때 이미 등록된 저장소에 file을 뿌리지 않는다: 사람이 고른 그 자리에서 file이 생겨 `git status`에 놀라지 않고, 남의 저장소를 등록한 경우 file이 생기지 않는다 (planner).
- file이 이미 있는 저장소(다른 기계가 만들어 commit한 것)는 등록이나 pull 때 읽기만 해서 그 id를 받는다. 쓰지 않는다 (planner).
- file은 없을 때만 만들고(temp에 쓰고 hard link, 있으면 실패) 덮지 않는다. 덮는 것은 사람이 고른 [Separate project]와 충돌 [Resolve] 둘뿐이다 (planner, 조사 불변식 18).
- ledger에 id가 있는데 file이 없으면(지운 것, file이 없는 branch로 옮긴 것) id를 지우지도 다시 쓰지도 않는다. [Restore]가 같은 id를 다시 쓴다: 저절로 쓰면 branch를 바꿀 때 untracked file이 checkout을 막는다 (planner).
- 두 기계가 pull 전에 각자 만들어 merge 충돌이 나면 양쪽 id 중 작은 것(ULID라 먼저 만든 것)이 그 project의 id다. 읽기는 file을 고치지 않고 바로 그 값을 쓰고, [Resolve]나 agent가 이긴 값을 쓴다. 누가 풀어도 같은 값이라 두 기계가 하나로 모인다. session과 모든 기록은 `prj_` id에 달려 있어 id가 바뀌어도 잃는 것이 없다 (planner).
- fork는 같은 id를 들고 가므로 같은 project다. 사람이 project 상세의 [Separate project]로 그 폴더에 새 id를 쓰고 commit해 나눈다(사람만): lophn은 fork와 clone을 remote로 가를 수 없고(mirror, SSH alias, origin 변경) 조사한 harness끼리도 갈린다(Orca 합침, T3·Paseo 나눔) (planner).
- 한 기계에서 한 id는 project 하나만 갖는다(worktree, 두 번째 clone). 먼저 가진 project가 갖고, 같은 file을 읽은 다른 project는 id 없이 "another copy of <title>"로 보이며 [Separate project]로 나눈다. 보관한 project는 같은 id를 읽은 active project에 넘긴다: 합치면 두 폴더의 session이 한 project로 섞인다(Paseo) (planner).
- monorepo는 project 폴더마다 자기 file이 있다. 위로 올라가 찾지 않는다. remote key에는 저장소 안 상대 경로를 붙인다(`#apps/web`): 하위 폴더 project가 저장소 root project로 제안되지 않게 (planner, Paseo `#subdir`).
- 기존 data root: schema step이 칸만 더하고(값 null) 모든 project, `prj_` id, 그것을 key로 쓰는 표가 그대로다. id는 file을 읽을 때 생긴다 (planner, AGENTS.md "호환성").
- ledger 값은 file의 cache다. 기동 때, project 등록·폴더 변경·relink·보관 해제 뒤, 그리고 id를 묻는 route(`project.identity`, `project.match`, `project.clone`)마다 다시 읽는다. watcher는 두지 않는다: pull 뒤 다음 읽기에서 따라온다 (planner).
- 기록을 고쳐도 project `revision`을 올리지 않는다: 열려 있는 편집 form의 CAS와 부딪치지 않게(`project.set_icon`과 같다) (planner).
- git이 아닌 폴더는 기계를 넘지 않는다. 등록 dialog에 켬 줄이 없고 상세에 "Not in git, so this project stays on this computer"를 보인다 (planner, program 3).
- remote는 힌트다: fetch remote만, `origin` > `upstream` > 이름순, local remote(`file:`, 경로) 버림, scp와 URL을 한 꼴로, host 소문자, 자격·기본 port·`.git`·끝 `/` 뗌, github.com은 path도 소문자. `ssh -G`로 alias를 풀지 않는다. origin이 먼저인 것은 같은 사람의 clone끼리는 origin이 같고 fork를 그 upstream으로 제안하지 않기 위해서다 (planner, T3·Paseo 규칙의 합).
- 힌트는 제안만 하고 말없이 합치지 않는다. 이 계획에서는 이 기계 안(등록 dialog: "폴더를 잃은 project X를 여기로 relink", "이미 project X로 등록됨")만 쓰고, 다른 기계의 목록은 `desktop-remote`의 remote 보기와 `app-folder-sync`가 같은 순수 함수에 넣는다 (planner, program 1).
- clone: 사람에게 project를 둘 폴더를 한 번 묻고 설정 `projects.folder`에 둔다. 폴더가 없어졌으면 다시 묻는다. 값에 기계 id를 붙이지 않는다: 이 기계에 그 경로가 있으면 이 기계에서 맞는 답이다 (planner, program 4).
- clone은 그 기계의 git 자격(`gh`, credential helper, SSH key)만 쓰고 묻는 창을 띄우지 않는다(`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, SSH `BatchMode=yes`). 자격이 없으면 바로 실패하고 실행할 명령(`gh auth login`, `ssh -T git@<host>`)을 돌려준다. 자격이 박힌 URL은 거절한다 (planner, program 16).
- clone은 `<parent>/.lophn-clone-<random>`에 받고 끝나면 rename한다. 대상 폴더가 있으면 `conflict`이고 쓰지 않는다. 받은 저장소의 id가 기대한 것과 다르면 지우고 `conflict`, file이 아직 없으면(commit·push 전) 남겨 등록하고 알린다: pull로 file이 오면 따라온다 (planner, 조사 Paseo·Happy).
- agent는 `project.clone`, `project.share`(file 만들기와 Restore·Resolve)를 부를 수 있고 [Separate project]는 사람만이다: 나누기는 다른 기계에서 무엇이 같은 project인지를 바꾼다 (planner).
- 위험 test는 subprocess 없이 쓴다(git은 주입한 runner와 임시 폴더). 실제 git을 띄우는 test는 AGENTS.md대로 사람에게 묻고 이 계획에는 두지 않는다 (planner).
- worker는 `sonnet-high`, `project-id-core`와 `project-id-sync`는 opus high다(brief 머리에 적었다) (planner).

## 다른 계획이 기대는 계약

1. **file.** project의 첫 등록 폴더 바로 아래 `.lophn-project.json`(`PROJECT_IDENTITY_FILE`). 꼴 `{ "lophn_project": 1, "id": "pri_<ULID>" }`, 2칸 들여쓰기와 끝 줄바꿈. 읽을 때 모르는 칸은 무시하고, `lophn_project`가 1보다 크면 읽지 못한 것(`unreadable`)으로 보고 덮지 않는다. git merge 충돌 표지(`<<<<<<<`, `=======`, `>>>>>>>`)가 있으면 양쪽에서 읽은 id 중 가장 작은 것이 id다. 순수 함수는 `packages/protocol/projects/identity.ts`(`parseIdentityFile`, `serializeIdentityFile`).
2. **두 id.** `prj_…`(기계별, 지금 것, 모든 key가 그대로)와 `pri_…`(기계를 넘음, 접두사 `pri`는 `packages/protocol/base/ids.ts`). `ProjectRecord`에 `identity: pri | null`, `repo: "git" | "none" | null`(null은 아직 못 읽음), `remote: { key, url } | null`이 더해진다. 읽기: project → id는 `ProjectRecord.identity`, id → project는 `project.list { identity }`(core 안에서는 `packages/core/projects/lookups.ts`의 `projectByIdentity(sql, identity)`). 한 기계에서 `identity`는 유일하다(null 아닌 값에 unique index).
3. **file의 지금 상태**(memory route `project.identity { project }`, actors user·agent): `{ project, identity, file: "none" | "committed" | "uncommitted" | "ignored" | "conflict" | "missing" | "unreadable", repo, folder: path | null, found: boolean, remote, duplicate_of: prj | null }`. `missing`은 ledger에 id가 있고 file이 없다는 뜻, `ignored`는 `.gitignore`가 file을 빼 다른 기계로 가지 않는다는 뜻이다.
4. **쓰기 route**(memory. 정의는 `packages/protocol/projects/identity-api.ts`, clone만 `clone-api.ts`): `project.create_identity { project }`(user·agent. file이 없으면 ledger 값이나 새 id를 쓰고, 충돌이면 이긴 값을 쓰고, 읽을 수 있는 file이 있으면 쓰지 않는다), `project.renew_identity { project }`(user. 새 id로 덮는다), `project.clone { url, parent?, name?, title?, identity? }`(user·agent. 실패의 `details.reason`으로 `projects_folder_unset`, `git_auth`와 `details.command`를 돌려준다), `project.match { path }`(user. 등록 전 폴더를 읽고 아래 힌트를 돌린다).
5. **힌트 함수.** `matchProjects(local: ProjectKeys[], other: ProjectKeys[]): { same: [ProjectKeys, ProjectKeys][]; suggested: [ProjectKeys, ProjectKeys][] }`, `ProjectKeys = { id: string; identity: string | null; remote_key: string | null }`(`id`는 부르는 쪽이 정하는 열쇠다. 다른 기계의 것이면 `<machine>:<prj>`처럼). `same`은 identity가 같은 짝, `suggested`는 identity로 짝이 되지 않았고 remote key가 같으며 둘 중 하나 이상 identity가 없는 짝이다. 한쪽 목록 안에서 같은 remote key가 둘 이상이면 제안하지 않는다. `remoteKeyOf(remotes: { name, url }[], subpath: string): { key, url } | null`도 같은 file이다. 둘 다 순수 함수라 renderer, remote 보기, `app-folder-sync`가 import한다.
6. **ledger step**: `projects.registry.identity`(칸 넷과 index 하나). 낸 목록 끝에 붙는다.

## 다른 계획에 넘기는 것

- `app-folder-sync`(agent가 읽는 환경 도구): project마다 `identity`, 이 기계에 있는지(`found`), `remote.url`. 도구가 이 계획보다 먼저 land하면 planner가 그 계획에 이 칸을 넘긴다.

## 계약 바꾸기 요청

- `desktop-remote`에: 그 계획은 한 창이 한 기계만 보고 renderer가 기계를 주장하지 못한다. 다른 기계(M)의 창이 "이 컴퓨터에도 있는 project"와 이 컴퓨터의 session 목록을 보이려면 shell main을 거치는 좁은 IPC 둘이 필요하다: `shell:machines-this-read { route: "project.list" | "ListSessions", input }`(다른 기계 창에서만, 이 두 read만 이 컴퓨터의 core로)와 `shell:machines-clone-here { url, identity, title }`(이 컴퓨터의 `project.clone`, 폴더가 정해지지 않았으면 main이 폴더 선택기). 추천: `desktop-remote`가 짓지 않고 이 계획의 `project-id-remote-view`가 그 계획 land 뒤에 짓는다(그 계획의 범위를 늘리지 않는다). planner가 그 계획에 "다른 기계 창의 IPC 거절 목록에 이 둘이 뒤에 들어온다"만 알린다.

## 사람이 정할 것

1. **project에 딸린 지침과 설정을 저장소 file로 두나**(roadmap "사람이 정할 것" 2). (a) 두지 않는다: 지금처럼 기계마다 다시 정한다(`LOPHN.md`는 이미 저장소에 있어 git을 탄다). (b) Emdash 층: 기계 값 > 저장소 file 값 > 기계 기본 > 내장, 칸마다 출처를 보이고 [Share]가 기계 값을 저장소 file에 쓴다. 얻는 것은 모델·agent 고르기 같은 project 설정이 모든 기계에 같다는 것, 잃는 것은 해석기와 출처 화면, 그리고 사람 저장소에 file이 하나 더 생긴다. (c) id file에 칸을 더한다: file 하나로 끝나지만 설정을 바꿀 때마다 file을 다시 써 merge 충돌이 잦다. 추천 (a)로 시작하고 요구가 생기면 (b). 이 계획은 어느 쪽도 짓지 않는다.

## task

| wave | id | 단위 | 한 줄 |
|---|---|---|---|
| 1 | `project-id-core` | project-id-core | 접두사 `pri`, file 꼴과 순수 함수(충돌, remote key, 힌트), `ProjectRecord`의 새 칸, schema step, `project.record_identity`와 한 기계 안 유일 규칙, memory route 정의. migration·충돌 위험 test |
| 2 | `project-id-sync` | project-id-sync | 폴더 읽기(git 읽기만)와 file 쓰기, 기동·쓰기 뒤 다시 읽기, `project.identity`·`create_identity`·`renew_identity`·`match` handler. 덮지 않음·한 file만 위험 test |
| 2 | `project-id-clone` | project-id-clone | `project.clone`(임시 폴더, fail-fast 자격, rename, 등록), 설정 `projects.folder`, CLI `lophn project clone·share·identity`. 덮지 않음 위험 test |
| 2 | `project-id-screens` | project-id-screens | 등록 dialog의 켬 줄과 힌트, project 상세의 "Other computers" 줄(상태마다 단추), gallery page |
| 3 | `project-id-remote-view` | project-id-remote-view | `desktop-remote`가 land된 뒤: 다른 기계의 창에서 같은 id의 project를 묶고 기계마다 session 목록을 나란히, M에만 있는 project의 [Clone here], 이를 위한 shell main IPC 둘. 권한 경계 위험 test |

## lead가 할 일

- 돌리기 전에: `machine-identity`가 main에 land된 뒤 연다(`ids.ts`, `wiring/remote.ts`, `schema-steps.lock.json`, `assembly.ts`, `shell/main/desktop/core/allowlist.ts`를 그 계획도 고친다). 같은 때 도는 `desktop-remote`·`app-folder-sync`·`always-on`·`browser-vault`와 공유하는 file(`schema-steps.lock.json`과 마지막 wiring의 step 목록, `packages/cli/commands/mod.ts`, `wiring/setting-declarations.ts`, `allowlist.ts`, i18n catalog)은 `status.py ready`가 막는다. 막힌 task는 그 task가 끝난 뒤 띄운다.
- 공유 줄: schema step은 `project-id-core`가 마지막 wiring(`remote`)의 `schemaStepsAfterTeams` 끝과 lock 끝에 한 줄씩 붙인다. 다른 계획이 먼저 land해 마지막 wiring이나 끝 항목이 바뀌었으면 rebase 때 맨 끝으로 옮긴다. `assembly.ts`의 `WIRINGS`는 `project-id-clone`이 한 줄만 더한다.
- `project-id-screens`의 gallery page를 사람에게 보이고 문구와 자리를 고친다(사람이 고르면 renderer를 고친다).
- wave 2 뒤: 개발 core(`boot.sh`, `.dev-data`)로 임시 git 저장소 둘을 만들어 본다. 등록과 [Set up] 뒤 `git status`가 `?? .lophn-project.json` 하나뿐인지, 두 저장소에 각자 file을 만들고 하나를 다른 쪽에 merge해 충돌을 낸 뒤 상세가 작은 id를 보이고 [Resolve]가 그 값을 쓰는지, 같은 저장소를 두 번째 폴더로 clone해 등록하면 "another copy"인지, `lophn project clone`이 자격 없는 private URL에서 묻지 않고 명령을 돌려주는지. 사람의 `~/.lophn`과 사람의 저장소는 쓰지 않는다.
- wave 3은 `desktop-remote`가 main에 land된 뒤 연다. 그 README의 "다른 계획이 기대는 계약"과 `remote-desk-windows`·`remote-desk-renderer`의 결과로 `project-id-remote-view` brief의 "lead가 확인할 path"를 채워 소유 줄에 더하고 띄운다. 먼저 wave 1~2를 `land.sh`로 올린다(중간 land). `tools/wireframes/pages/screens/shell.tsx`는 `desktop-remote`의 `remote-desk-screens`도 고친다.
- 끝에(문서): 새 `project-docs/architecture/project-identity.md`(문제: 기계마다 다른 project id, 모델: 두 id와 저장소 file, 상태와 다시 읽는 때, 지키는 것: file 하나만 쓰고 git 쓰기 없음, 없을 때만 만들고 덮지 않음, 충돌은 작은 id, 한 기계에 한 id, 기록은 `prj_` key 그대로, 결정: 자리와 꼴, 만드는 때, fork, remote는 힌트), `project-docs/boundary-catalog.yaml`의 `projects` 설명, `project-docs/flows/`(`flows` skill로 마지막 대조), roadmap `multi-machine.md`(순서 3 끝남, "사람이 정할 것" 2는 그대로), `reports/multi-machine/program.md`의 project 줄, change-log `0.<판>/project-identity.yaml`(file 자리와 꼴, 만드는 때, 충돌·fork·중복 규칙, 기존 data root는 id 없이 이어짐). SDK와 앱 선언은 바뀌지 않는다. `sdk-note`가 필요 없다.
