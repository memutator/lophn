# project-identity

git 저장소인 project가 어느 기계에서도 같은 project로 보이게 하는 설계다. 저장소 안 file `.lophn-project.json`이 기계를 넘는 id(`pri_…`)를 갖고, git이 code와 함께 그 file을 다른 기계로 옮긴다. 다른 기계에서 clone이나 pull로 file이 오면 lophn은 그 저장소를 같은 project로 알아본다. 기계별 project id(`prj_…`)와 그것을 key로 쓰는 모든 기록은 그대로다. 이 기계에 없는 project는 agent가 `lophn project clone`으로 받아 등록한다. desktop이 다른 기계를 볼 때 그 기계의 창은 그 기계의 project 가운데 이 컴퓨터에도 있는 것을 같은 id로 알아보고, 없는 것은 [Clone here]로 받게 한다(아래 "다른 기계의 창").

## 문제

- project id는 기계마다 다르다. 집 PC와 회사 PC에 같은 저장소를 등록해도 lophn에게는 두 project이고, 다른 기계를 보는 쪽(remote 보기, 폴더로 data를 맞추는 쪽, agent)은 "그 기계의 X가 이 기계의 Y와 같은 것"인지 알 길이 없다. 사람의 말: "내 lophn 프로젝트는 메인 머신에서도 맥북 머신에서도 같은 의미여야돼".
- git remote로 식별하면 fork가 원본과 한 project로 합쳐지고, origin을 바꾸거나 SSH alias·mirror를 쓰면 신분이 바뀐다.
- 저장소 file은 사람의 저장소에 생긴다. lophn이 말없이 file을 뿌리거나 commit하거나 덮으면 사람이 `git status`에 놀라고, branch 바꾸기가 막히고, 남의 저장소를 등록한 경우 그 저장소를 더럽힌다.
- 두 기계가 pull 전에 각자 file을 만들면 merge 충돌이 나고, 같은 저장소를 한 기계에 두 번 clone하거나 worktree를 두면 한 id를 두 project가 주장한다.

## 목표와 비목표

- 목표: 같은 저장소는 어느 기계에서도 같은 기계를 넘는 id를 갖는다. file은 사람이나 agent가 고른 때에만 생기고 lophn은 git 쓰기를 하지 않는다. 충돌과 중복은 사람이 무엇을 누르든 같은 값으로 모인다. 이 기계에 없는 project는 그 기계의 git 자격으로 묻는 창 없이 받아 등록한다.
- 비목표: project에 딸린 지침과 설정을 저장소 file로 옮기기(사람이 정할 것으로 남았다). session과 대화를 기계 사이에 옮기기. code를 옮기기(git이 한다. lophn은 commit, push, pull을 하지 않는다). git이 아닌 폴더를 기계 사이에 잇기. git remote로 말없이 합치기. id file의 watcher.

## 모델

```
저장소 폴더(첫 등록 폴더)
  .lophn-project.json  { "lophn_project": 1, "id": "pri_<ULID>" }   ← git이 기계 사이로 옮긴다
        │ 읽기(기동, 등록·폴더 변경·relink·보관 해제 뒤, identity·match·clone route)
        ▼
ledger projects 줄 (기계별)
  id: prj_…  (모든 기록의 key, 그대로)
  identity: pri_… | null   repo: git | none | null   remote: {key, url} | null
```

- **두 id.** `prj_…`는 기계별 id이고 session, 문서, 설정 같은 모든 기록이 이것을 key로 쓴다. `pri_…`는 기계를 넘는 id로 저장소 file에 있고 ledger의 `identity` 칸은 그 cache다. 한 기계에서 `identity`는 유일하다. 값이 바뀌거나 지워져도 `prj_` 기록은 잃지 않는다.
- **file.** project의 첫 등록 폴더 바로 아래 `.lophn-project.json`이다. 꼴은 `{ "lophn_project": 1, "id": "pri_<ULID>" }`뿐이고 2칸 들여쓰기와 끝 줄바꿈이다. 이름, 폴더 이름, remote, 경로, 기계 id를 넣지 않는다. 읽을 때 모르는 칸은 무시한다. `lophn_project`가 1보다 크거나, 비었거나, JSON이 아니거나, 꼴이 틀리면 읽지 못한 것이다. git merge 충돌 표지가 있으면 양쪽에서 읽은 id 가운데 가장 작은 것이 id다. 위 폴더로 올라가 찾지 않는다: monorepo는 project 폴더마다 자기 file이 있다.
- **file 상태.** `project.identity`가 돌려주는 `file`은 다음 가운데 하나다.
  - `none`: file이 없고 ledger에도 id가 없다. [Set up]이 만든다.
  - `uncommitted`: file이 있고 아직 commit되지 않았다(새로 만듦, 바뀜, 충돌을 풀었지만 merge commit 전).
  - `committed`: file이 commit되어 있다. 다른 기계로 간다.
  - `ignored`: `.gitignore`가 file을 빼 다른 기계로 가지 않는다.
  - `conflict`: file 안에 merge 충돌 표지가 있다. id는 가장 작은 것이다. [Resolve]가 그 값으로 덮는다.
  - `missing`: ledger에 id가 있는데 file이 없다(지웠거나 file이 없는 branch). [Restore]가 같은 id를 다시 쓴다.
  - `unreadable`: file을 읽지 못한다(더 새 판 포함). 덮지 않고 고치거나 지우라고 알린다.
  같이 오는 `repo`(`git`, `none`, 아직 못 읽었으면 null), `found`(첫 폴더가 이 기계에 있나), `remote`, `duplicate_of`(같은 id를 먼저 가진 이 기계의 다른 project)가 화면과 agent가 고를 단추를 정한다.
- **다시 읽는 때.** ledger 값은 file의 cache다. core가 켜질 때(active project를 몇 개씩, 켜기를 기다리게 하지 않고), project 등록·폴더 변경·relink·보관 해제가 commit된 뒤, 그리고 `project.identity`·`project.create_identity`·`project.renew_identity`·`project.clone`이 부를 때 다시 읽는다. pull로 file이 바뀌면 다음 읽기에서 따라온다. 읽기는 git을 읽기만 하고(index lock을 잡지 않는다) file이 없어졌을 때 ledger의 id를 지우지 않는다. 기록을 고쳐도 project `revision`은 오르지 않는다.
- **한 기계에 한 id.** 같은 file을 읽은 project가 둘이면 먼저 가진 project가 id를 갖고, 나중 것은 id 없이 "Another copy of <title>"(`duplicate_of`)로 보인다. 먼저 가진 project가 보관되어 있고 나중 것이 active면 id를 active project에 넘긴다.
- **만드는 때.** git 폴더를 등록하는 dialog의 "Same project on my other computers"(id file이 없는 git 폴더에서만 서고 기본 켬), project 상세(Workspaces panel의 dialog와 project 설정 page의 General) "Other computers" 줄의 [Set up], agent의 `lophn project share`. 판을 올리거나 core가 켜질 때 이미 등록된 저장소에 file을 만들지 않는다.
- **쓰는 길 셋.** 만들기(`project.create_identity`: file이 없으면 ledger의 id(Restore)나 새 id, 충돌이면 이긴 id, 읽을 수 있는 file이 있으면 쓰지 않음, 읽지 못하는 file이면 `conflict`), 나누기(`project.renew_identity`, [Separate project]: 새 id로 덮는다. 사람만), 그 밖에는 쓰지 않는다. 없을 때 만들기는 temp file에 쓰고 hard link로 거는 것이라 그 사이 생긴 file을 덮지 않는다. 덮기는 temp file에 쓰고 rename한다.
- **remote 힌트.** fetch remote 가운데 `origin`, `upstream`, 이름순으로 하나를 고르고, local remote(`file:`, 경로)는 버린다. scp 꼴과 URL을 한 꼴로 맞추고 host를 소문자로, 자격·기본 port·`.git`·끝 `/`를 떼고, github.com은 path도 소문자로 한 key를 낸다. 저장소 안 하위 폴더 project는 `#<상대 경로>`를 붙인다. `ssh -G`로 alias를 풀지 않는다. 힌트는 제안만 한다: 등록 dialog가 "폴더를 잃은 project X를 여기로 relink"와 "이미 project X로 등록됨"을 보이고(`project.match`), 다른 기계의 목록과 짝을 짓는 쪽(remote 보기, 폴더 sync)이 같은 순수 함수를 쓴다.
- **clone.** `project.clone`은 부모 폴더(입력 `parent`, 없으면 설정 `projects.folder`) 아래 `.lophn-clone-<random>`에 git clone하고 끝나면 이름을 바꿔 등록한다. 그 기계의 git 자격(`gh`, credential helper, SSH key)만 쓰고 묻는 창을 띄우지 않으며, 자격이 없으면 바로 실패하고 사람이 실행할 명령(`gh auth login`, `ssh -T git@<host>`, 22가 아닌 port면 `ssh -T -p <port> git@<host>`)을 돌려준다. 받은 저장소의 id file을 읽지 못하면(더 새 판 포함) 결과에 note를 싣고, `identity`를 주었으면 맞는 project인지 확인하지 못했다고 말한다. 자격이 박힌 URL은 거절한다. 대상 폴더가 있으면 쓰지 않는다. `identity`를 주었는데 받은 저장소의 id가 다르면 받은 것을 지우고 등록하지 않는다. 그 id를 가진 project가 이미 이 기계에 있으면 받지 않는다. 받은 저장소에 file이 없으면 등록하고 다른 기계에서 commit·push한 뒤 pull하라고 알린다. `projects.folder`는 처음 clone할 때 한 번 묻는다: agent가 사람에게 묻거나, 다른 기계의 창의 [Clone here]가 폴더 선택기를 연다. 묻고 받은 폴더는 `parent`로 오고, 설정이 비었거나 그 폴더가 없어졌으면 core가 그 `parent`를 설정에 기억한다. 나중에 바꾸는 길은 `lophn settings set projects.folder <path>`뿐이다.

### 다른 기계의 창

desktop이 다른 기계(M)를 보는 창(`remote.md`의 "desktop에서 다른 기계 보기")의 왼쪽 sidebar에서 M의 project 줄 아래에 이 컴퓨터와의 관계를 한 줄로 보인다. 이 컴퓨터의 창에는 이 줄이 없다.

```
M의 창 renderer ── 창의 core 통로 ──────────▶ M의 core       project.list, ListSessions (기기 자격)
               └─ shell:machines-this-read ─▶ 이 컴퓨터의 core  project.list, ListSessions (사람 자격, 읽기 둘만)
               └─ shell:machines-clone-here ▶ 이 컴퓨터의 core  project.clone (사람 자격)
               └─ shell:machines-open ──────▶ 이 컴퓨터의 창    { machine: 이 컴퓨터, session }
```

- **묶기.** M의 `project.list`(그 창의 core)와 이 컴퓨터의 `project.list`(shell main을 거친다)를 각각 통째로 받아 같은 순수 함수 `matchProjects`에 넣는다. 열쇠는 이 컴퓨터의 것이 `this:<prj>`, M의 것이 `<M의 mch>:<prj>`라 두 기계의 `prj_`가 섞이지 않는다. `identity`·`remote` 칸이 없는 옛 판 M의 기록은 null로 본다. 묶음은 M의 project마다 셋 가운데 하나이고, id도 짝도 없는 project에는 줄이 없다.
  - **같은 project**(id가 같다): "Also on this computer"(이 컴퓨터의 title이 다르면 "Also on this computer as <title>"). 누르면 popover에 기계마다 session 목록을 나란히 보인다.
  - **M에만 있다**(id가 있고 이 컴퓨터에 짝이 없다): "Not on this computer"와 [Clone here]. M의 기록에 remote가 없으면 단추 없이 "It has no git remote to clone from".
  - **remote만 같다**(`suggested`): "Looks like <이 컴퓨터의 title>"과 한 기계에서 id file을 만들어 commit하면 다른 기계가 pull 뒤 따라온다는 안내. 단추는 없다: M의 저장소에는 쓰지 못하고, 이 컴퓨터 쪽 [Set up]은 이 컴퓨터의 창에서 한다.
- **session은 나란히, 합치지 않는다.** 두 목록은 각자의 core에서 읽는다(M의 것은 그 창의 core, 이 컴퓨터의 것은 `shell:machines-this-read`). M의 session은 그 창에서 열고, 이 컴퓨터의 session을 누르면 `shell:machines-open { machine: 이 컴퓨터, session }`이 이 컴퓨터의 알림을 누른 것과 같은 길로 이 컴퓨터의 창을 앞으로 가져와 그 session을 연다. session과 대화는 기계 사이에 옮기지 않는다.
- **[Clone here].** `shell:machines-clone-here { url, identity, title }`이 이 컴퓨터의 `project.clone`을 사람 자격으로 부른다. 답이 `projects_folder_unset`이면 shell main이 그 창에 붙은 OS 폴더 선택기를 열고 고른 폴더를 `parent`로 다시 부르며, core가 그 폴더를 `projects.folder`로 기억한다(다음 clone은 묻지 않는다). 선택기를 닫으면 아무 일도 없다. `git_auth`면 "Run `<command>` in a terminal on this computer, then try again"을 보인다. 받은 뒤 이 컴퓨터의 목록을 다시 읽어 그 줄이 "Also on this computer"가 된다.
- **M에는 쓰지 않는다.** 다른 기계의 창은 폰과 같은 권한이다. 이 줄들은 M에 아무것도 쓰지 않고(id file도, 설정도), 이 컴퓨터에는 두 읽기와 clone만 한다.
- **읽기가 실패해도 지우지 않는다.** 어느 쪽 읽기가 실패하거나 M이 끊기면 그쪽의 마지막 목록과 묶음, session 목록을 그대로 보인다. 이 컴퓨터의 core는 이 창에 event를 보내지 않으므로 이 컴퓨터 쪽은 창이 앞으로 올 때와 clone 뒤에 다시 읽는다.

## 지키는 것

1. lophn이 사람의 저장소에 쓰는 것은 project 첫 폴더 바로 아래 `.lophn-project.json` 하나뿐이다. git은 읽기만 한다: commit, add, checkout, stash, index를 고치는 status를 하지 않는다. clone은 새 폴더를 만들 뿐 있는 폴더에 쓰지 않는다.
2. file은 없을 때만 만들고 읽을 수 있는 file을 덮지 않는다. 덮는 것은 사람이 고른 [Separate project]와 충돌 [Resolve] 둘뿐이고, 읽지 못하는 file(더 새 판 포함)은 [Resolve]·[Set up]·agent가 덮지 않는다.
3. merge 충돌이면 양쪽 id 가운데 가장 작은 것이 id다. 읽기는 file을 고치지 않고 그 값을 쓰고, 누가 어느 기계에서 풀어도 같은 값이라 두 기계가 하나로 모인다.
4. 한 기계에서 한 id는 project 하나만 갖는다. 같은 저장소의 두 번째 copy는 id 없이 "another copy"로 보이고 사람이 나누기 전에는 합쳐지지 않는다.
5. 기록은 `prj_` key 그대로다. 기계를 넘는 id가 생기거나 바뀌거나 사라져도 session, 문서, 설정, 다른 표의 줄은 옮겨지거나 지워지지 않는다. 기존 data root는 id 없이 이어지고 id는 file을 읽을 때 생긴다.
6. ledger에 id가 있는데 file이 없으면 id를 지우지도 file을 다시 쓰지도 않는다. [Restore]나 agent가 쓸 때만 같은 id가 다시 생긴다.
7. remote는 제안에만 쓴다. remote가 같다는 것만으로 project를 합치거나 id를 옮기지 않는다.
8. 나누기(`project.renew_identity`)는 사람만 한다. agent는 만들기·Restore·Resolve(`project.share`)와 clone만 한다.
9. clone은 묻는 창을 띄우지 않고 자격을 저장하지 않으며, 자격이 박힌 URL을 받지 않는다. 받다가 실패하면 임시 폴더를 지운다. 받은 뒤 등록이 실패해도 받은 폴더는 지우지 않는다.
10. 다른 기계의 창은 그 기계에 쓰지 않는다. 이 컴퓨터의 core에는 `project.list`·`ListSessions` 읽기와 `project.clone`만 부르고, 그 둘은 이 컴퓨터의 창에서 부르면 거절된다(`remote.md` 지키는 것 24).
11. 두 기계의 session 목록은 합치지 않는다. 각자의 core에서 읽고 나란히 보일 뿐이며, 묶기의 열쇠는 기계가 붙은 `this:<prj>`·`<mch>:<prj>`라 한 기계의 `prj_`가 다른 기계의 기록을 가리키지 않는다.

## 경계와 계약

- boundary `projects`(file 읽기·쓰기, 다시 읽기, record, clone, 등록 dialog와 상세의 줄), `core-api`(route), `coding-agent-cli-interface`(`lophn project clone|share|identity`).
- file: `.lophn-project.json`, 꼴 `{ "lophn_project": 1, "id": "pri_<ULID>" }`. 접두사 `pri`.
- `ProjectRecord`의 칸 `identity`(pri | null), `repo`(`git` | `none` | null), `remote`(`{ key, url }` | null). `project.list { identity }`가 id로 이 기계의 project를 찾는다(많아야 하나).
- route: `project.identity`(memory, user·agent), `project.create_identity`(memory, user·agent), `project.renew_identity`(memory, user), `project.match { path }`(memory, user. 등록 전 폴더를 읽고 `same`과 `suggestions`를 돌린다), `project.clone { url, parent?, name?, title?, identity? }`(memory, user·agent. 실패의 `details.reason`: `projects_folder_unset`, `git_auth`와 `details.command`, `git_not_found`, `timeout`, `git_failed`, `different_project`, `target_exists`), `project.record_identity`(core 안 machine 자격만. 읽은 값을 ledger에 적는다).
- CLI: `lophn project clone <url>`, `lophn project share`, `lophn project identity`(`--project`가 없으면 그 session의 project).
- shell IPC(다른 기계의 창, `remote.md`): `shell:machines-this-read { route: "project.list" | "ListSessions", input }`, `shell:machines-clone-here { url, identity, title }`(답은 core의 `project.clone` 답 그대로), `shell:machines-open { machine, session? }`(session은 이 컴퓨터의 id에만).
- 설정: `projects.folder`(이 기계에서 clone한 project를 두는 폴더. 값에 기계 id를 붙이지 않는다).
- 순수 함수: file 꼴 읽기·쓰기, remote key, 힌트 짝짓기(identity가 같은 짝 `same`, identity로 짝이 되지 않았고 remote key가 같으며 하나 이상 identity가 없는 짝 `suggested`. 한 목록에 같은 key가 둘 이상이면 제안하지 않는다)는 protocol에 있어 renderer, remote 보기, 폴더 sync가 같이 쓴다.
- 저장: ledger schema step `projects.registry.identity`(projects 표에 칸 넷과 `identity` unique index). 칸만 더하고 값은 null이다.
- 앱 slug `project`는 예약 이름이다(`lophn project` 명령과 겹치지 않게).

## 결정

- 기계를 넘는 id는 사람의 저장소 안 file에 두고 git remote는 힌트로만 쓴다. 이유: remote로 식별하면 fork가 합쳐지고 origin을 바꾸면 신분이 바뀐다. 버린 안: remote를 id로(T3 Code·Paseo의 일부), lophn의 바깥 목록에 두기(git을 타지 않는다). (planner)
- lophn은 그 file 하나만 쓰고 git 쓰기를 하지 않는다. commit은 사람이나 agent가 한다. 이유: 사람의 저장소 기록은 사람의 것이다. 대가: file이 commit되기 전에는 다른 기계로 가지 않고, 상세 줄이 "Not committed yet"을 보인다. (planner)
- file 자리는 첫 등록 폴더 바로 아래 `.lophn-project.json`이다. 이유: app 저장소의 `.lophn/`(lophn이 채우는 sdk 사본, 앱 skill)은 `.gitignore`가 통째로 빼는 일이 흔해 섞이면 file이 git을 타지 않는다. 첫 폴더는 `LOPHN.md`를 읽는 자리와 같다. (planner)
- file에는 판과 id만 둔다. 이유: 폴더 이름 기본값은 다른 저장소를 섞고(mixdog), 이름을 넣으면 rename마다 file을 다시 써 merge 충돌을 만든다. 이름(title)은 기계마다 ledger에 있다. (planner)
- file은 등록 dialog의 켬 줄(기본 켬), 상세의 [Set up], agent의 `lophn project share`로만 만든다. 판을 올릴 때 이미 등록된 저장소에 뿌리지 않는다. 이유: 사람이 고른 자리에서 file이 생겨 `git status`에 놀라지 않고, 남의 저장소를 등록한 경우 file이 생기지 않는다. (planner)
- 충돌은 작은 id(ULID라 먼저 만든 것)가 이긴다. 읽기는 file을 고치지 않고 [Resolve]나 agent가 이긴 값을 쓴다. 이유: 누가 풀어도 같은 값이라 두 기계가 따로 풀어도 하나로 모인다. 기록은 `prj_`에 달려 있어 id가 바뀌어도 잃는 것이 없다. (planner)
- merge가 끝나지 않은 file이라도 충돌 표지가 없으면 `uncommitted`다. 이유: [Resolve]가 file을 이긴 값으로 쓴 뒤에도 git index는 merge commit 전까지 충돌로 남는데, 그것을 `conflict`로 보이면 [Resolve]가 계속 서고 남은 일(commit)을 말하지 않는다. (agent, 개발 core 확인에서)
- fork는 같은 id를 들고 가므로 같은 project다. 나누는 것은 사람이 [Separate project]로 새 id를 쓰고 commit하는 것이다. 이유: lophn은 fork와 clone을 remote로 가를 수 없고(mirror, SSH alias, origin 변경) 조사한 harness끼리도 갈린다(Orca 합침, T3 Code·Paseo 나눔). (planner)
- 한 기계에서 한 id는 먼저 가진 project가 갖고, 두 번째 copy는 id 없이 보인다. 보관한 project는 같은 id를 읽은 active project에 넘긴다. 이유: 합치면 두 폴더의 session이 한 project로 섞인다(Paseo). (planner)
- ledger에 id가 있는데 file이 없으면 저절로 다시 쓰지 않는다. 이유: 저절로 쓰면 file이 없는 branch로 옮길 때 untracked file이 checkout을 막는다. (planner)
- watcher를 두지 않고 정해진 때에 다시 읽는다. 이유: pull 뒤 다음 읽기에서 따라오면 충분하고 저장소마다 watcher를 두는 비용이 크다. (planner)
- 기록을 고쳐도 project `revision`을 올리지 않는다. 이유: 열려 있는 편집 form의 비교와 부딪치지 않게(project 아이콘과 같다). (planner)
- git이 아닌 폴더는 기계를 넘지 않는다. 등록 dialog에 켬 줄이 없고 상세에 "Not in git, so this project stays on this computer"를 보인다. (planner)
- remote key는 origin이 먼저다. 이유: 같은 사람의 clone끼리는 origin이 같고, fork를 그 upstream으로 제안하지 않는다. `ssh -G`로 alias를 풀지 않는다(기계마다 설정이 달라 key가 갈린다). (planner, T3 Code·Paseo 규칙의 합)
- clone은 그 기계의 git 자격만 쓰고 묻지 않으며, 자격이 없으면 실행할 명령을 돌려준다. 이유: 자격은 기계를 넘지 않는다(roadmap 원칙). 묻는 창은 agent가 부른 git을 멈춰 세운다. (planner)
- clone 부모 폴더는 처음 한 번 묻고 설정 `projects.folder`에 둔다. 값에 기계 id를 붙이지 않는다: 이 기계에 그 경로가 있으면 이 기계에서 맞는 답이다. 설정 화면은 두지 않는다. (planner)
- clone은 임시 폴더에 받고 이름을 바꾼다. 받은 저장소의 id가 기대와 다르면 지우고 `conflict`, file이 아직 없으면 남겨 등록하고 알린다. 이유: 반쯤 받은 폴더가 project 자리에 남지 않고, commit·push 전인 저장소도 pull로 file이 오면 따라온다. (planner, Paseo·Happy 조사)
- 위험 test는 git을 띄우지 않고 주입한 runner와 임시 폴더로 쓴다. 실제 git으로는 개발 core에서 손으로 확인했다. (planner)
- 다른 기계를 보는 desktop은 폰과 같은 권한이다. 그 창에서 M의 project에 id file을 만들거나 설정을 바꾸지 않는다. (사람)
- 다른 기계의 창이 이 컴퓨터를 읽는 길은 shell main을 거치는 좁은 IPC 둘(읽기 둘, clone)이다. 이유: 한 창은 한 기계만 보고 renderer는 기계를 주장하지 못한다(`remote.md`). 버린 길: 그 창에 이 컴퓨터의 core 통로를 하나 더 열기(guard 하나로 막던 경계가 둘로 갈린다). (planner)
- 묶기는 등록 dialog와 같은 `matchProjects`를 쓰고 열쇠에 기계를 붙인다. remote만 같은 짝은 제안 한 줄뿐이다(지키는 것 7). (planner)
- 이 컴퓨터의 session을 popover에서 누르면 `shell:machines-open`에 session을 실어 이 컴퓨터의 알림을 누른 것과 같은 길로 연다. 이 컴퓨터의 창이 하나도 없으면 새 창이 load된 뒤 그 session을 고른다. 버린 길: 새 IPC channel이나 desktop intent에 session을 싣기(창을 고르는 규칙이 두 벌이 된다). (agent)
- 처음 clone의 폴더는 shell이 폴더 선택기로 받아 `parent`로 넘기고 기억은 core가 한다(설정이 비었거나 폴더가 없어졌을 때). 이유: agent의 clone과 [Clone here]가 같은 규칙 하나를 탄다. (agent)

## 열린 것

- 다른 기계의 창의 나란한 session 목록은 그 project lophn agent의 session만 보인다. 같은 project에 둔 다른 agent의 session은 빠진다(이슈 `remote-group-sessions-only-project-lophn`).

- 다른 기계의 창의 묶기와 [Clone here]는 한 컴퓨터의 개발 core 둘과 headless Electron으로 보았다. 설치본 둘과 실제 원격 저장소는 보지 못했다.

- agent가 identity route를 부를 때 그 agent가 그 project에 닿는지 보지 않는다. 다른 memory route와 같고 쓰는 것은 등록된 project 폴더의 file 하나라 그대로 둔다(이슈 `project-identity-agent-project-scope`, kept).

- 실제 원격(GitHub 등)에서 file이 다른 기계로 가는 것과 두 기계 사이의 충돌은 보지 못했다. 개발 core와 임시 저장소(local clone과 merge)로 확인했고 network는 자격 없는 private URL 하나만 시도했다.
