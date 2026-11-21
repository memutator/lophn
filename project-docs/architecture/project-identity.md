# project-identity

사람의 여러 컴퓨터에서 같은 project를 같은 project로 보이게 하는 설계다. 모든 project는 등록될 때 ledger에서 기계를 넘는 id(`pri_…`)를 받는다. lophn은 사람의 저장소에 아무것도 쓰지 않고, 누구에게도 file을 commit하라고 하지 않는다. git이 아닌 project는 사람이 다른 기계의 project와 잇는다. 다른 기계의 project를 이 기계에 받는 clone은 그 기계의 id를 들고 와 받자마자 같은 project다. 기계별 project id(`prj_…`)와 그것을 key로 쓰는 모든 기록은 그대로다. desktop의 창 하나는 모든 기계의 project를 같은 id로 묶어 보이고, 이 컴퓨터에 없는 것은 [Clone to this computer]로 받거나 [Link…]로 잇게 한다(아래 "한 창의 목록").

## 문제

- project id는 기계마다 다르다. 집 PC와 회사 PC에 같은 저장소를 등록해도 lophn에게는 두 project이고, 다른 기계를 보는 쪽(remote 보기, 폴더로 data를 맞추는 쪽, agent, 앱)은 "그 기계의 X가 이 기계의 Y와 같은 것"인지 알 길이 없다. 사람의 말: "내 lophn 프로젝트는 메인 머신에서도 맥북 머신에서도 같은 의미여야돼".
- 기계를 넘는 id를 저장소 안 file에 두면 public 저장소나 여럿이 쓰는 저장소에 한 사람의 도구 file을 commit해야 한다. 사람의 말(2026-11-21): "public하고 여러 명이서 쓰는 프로젝트면 지 혼자 쓰는 lophn 때문에 파일을 커밋하고 그러는 게 말이 되나?"

## 목표와 비목표

- 목표: 모든 project는 기계를 넘는 id 하나(`identity`)를 늘 갖는다. 앱처럼 project를 기계 사이에 가리키는 쪽은 git 여부와 상관없이 그 칸 하나를 본다.
- 목표: lophn은 사람의 저장소에 쓰지 않는다. git은 읽기만 한다(폴더가 git인지와 remote).
- 목표: 이 기계에 없는 project는 그 기계의 git 자격으로 묻는 창 없이 받아 등록하고, 받은 project는 다른 기계의 project와 같은 id다.
- 비목표: project에 딸린 지침과 설정을 기계 사이에 옮기기. session과 대화를 기계 사이에 옮기기. code를 옮기기(git이 한다. lophn은 commit, push, pull을 하지 않는다). 옛 `.lophn-project.json` file을 읽거나 지우기.

## 모델

```
ledger projects 줄 (기계별)
  id: prj_…  (모든 기록의 key, 그대로)
  identity: pri_…            ← 등록할 때 ledger에서 난다. clone은 다른 기계의 id를 들고 온다
  former_identities: pri_…[] (전에 가졌던 identity, 오래된 것이 앞, 16개까지)
  repo: git | none | null    remote: {key, url} | null   ← 첫 폴더를 읽은 값
```

- **두 id.** `prj_…`는 기계별 id이고 session, 문서, 설정 같은 모든 기록이 이것을 key로 쓴다. `pri_…`는 기계를 넘는 id다. 한 기계에서 `identity`는 유일하다. 값이 바뀌어도 `prj_` 기록은 잃지 않는다. `prj_`는 기계 사이에 맞추지 않는다.
- **id가 나는 때.** `project.create`가 같은 transaction에서 `pri_`를 낸다. clone 자격(`machine:projects-clone`)만 다른 기계의 id를 입력으로 준다. 이 기계의 다른 project(보관 포함)가 그 id를 지금이나 옛 identity로 가지면 `conflict`(`identity_in_use`)다.
- **폴더 읽기.** 첫 폴더가 git인지와 대표 remote를 읽어 `project.record_identity`로 적는다. identity는 바꾸지 않는다. git이 work tree가 아니라고 답해도(git이 PATH에 없다, dubious ownership, 깨진 저장소) 폴더나 그 위 폴더에 `.git`(폴더든 file이든)이 있으면 읽지 못한 것이다. git이 저장소를 찾는 길처럼 위로 올라가 본다(monorepo의 project 폴더에는 `.git`이 없다). 그 읽기는 git timeout과 같이 `unavailable`이고 아무것도 쓰지 않는다. `.git`이 없을 때만 `repo: none`이다. 폴더가 없는 project는 `repo: none`이다.
- **다시 읽는 때.** core가 켜질 때(active project를 몇 개씩, 켜기를 기다리게 하지 않고), project 등록·폴더 변경·relink·보관 해제가 commit된 뒤, `project.identity`를 부를 때. 읽기는 git을 읽기만 하고(index lock을 잡지 않는다) 기록을 고쳐도 project `revision`은 오르지 않는다.
- **같은 저장소.** 같은 remote key를 가진 이 기계의 다른 active git project를 `project.identity`가 `same_repository`로 알리고 등록 dialog가 미리 보인다.
- **잇기.** `project.link_identity { project, identity }`(command, 사람만)가 git이 아닌 project(`repo: none`)의 `identity`에 다른 기계의 git이 아닌 project의 id를 적는다. 이 컴퓨터의 창 목록에서 다른 기계의 git이 아닌 project 줄의 [Link…]로 사람이 이 컴퓨터의 git이 아닌 project를 고른다. 이 기계에만 쓴다. `repo`가 `none`이 아니면(git이거나 아직 못 읽었다) `conflict`(`details.reason: "git_project"`)이고, 이 기계의 다른 project(보관 포함)가 그 id를 지금이나 옛 identity로 가지면 `conflict`(`identity_in_use`)다. 이미 그 id면 그대로 성공이다. `revision`은 오르지 않는다.
- **나누기.** `project.renew_identity { project }`(command, 사람만, [Separate project])가 새 `pri_`를 적는다. 사람의 저장소에 쓰지 않는다. git이 아닌 project는 이 기계의 잇기가 풀린다.
- **옛 identity.** `identity`가 바뀌는 모든 길(잇기, 나누기)이 ledger의 `identity`를 적는 한 자리를 지나고, 그 자리가 옛 값을 `former_identities` 끝에 더한다(같은 값은 한 번, 지금 `identity`는 빼고, 16개를 넘으면 오래된 것부터 버린다). 앱은 이 목록으로 옛 id로 key한 줄을 옮긴다.
- **remote key.** fetch remote 가운데 `origin`, `upstream`, 이름순으로 하나를 고르고, local remote(`file:`, 경로)는 버린다. scp 꼴과 URL을 한 꼴로 맞추고 host를 소문자로, 자격·기본 port·`.git`·끝 `/`를 떼고, github.com은 path도 소문자로 한 key를 낸다. 저장소 안 하위 폴더 project는 `#<상대 경로>`를 붙인다. `ssh -G`로 alias를 풀지 않는다. 등록 dialog가 "폴더를 잃은 project X를 여기로 relink"와 "같은 저장소의 X가 이 컴퓨터에 있다"를 보인다(`project.match`).
- **clone.** `project.clone`은 부모 폴더(입력 `parent`, 없으면 설정 `projects.folder`) 아래 `.lophn-clone-<random>`에 git clone하고 끝나면 이름을 바꿔 등록한다. `identity`를 주면 그 id로 등록한다. 그 기계의 git 자격(`gh`, credential helper, SSH key)만 쓰고 묻는 창을 띄우지 않으며, 자격이 없으면 바로 실패하고 사람이 실행할 명령(`gh auth login`, `ssh -T git@<host>`, 22가 아닌 port면 `ssh -T -p <port> git@<host>`)을 돌려준다. 자격이 박힌 URL은 거절한다. 대상 폴더가 있으면 쓰지 않는다. 그 id를 가진 project의 첫 폴더가 이 기계에 있으면 받지 않고 그 project를 돌려준다. 그 id를 이 기계의 project가 폴더를 잃은 채 갖거나 옛 identity로 가지면 git을 띄우지 않고 `conflict`(`identity_in_use`)다. 받은 저장소의 file을 읽지 않는다. `projects.folder`는 처음 clone할 때 한 번 묻는다: agent가 사람에게 묻거나, 목록의 [Clone to this computer]가 폴더 선택기를 연다. 묻고 받은 폴더는 `parent`로 오고, 설정이 비었거나 그 폴더가 없어졌으면 core가 그 `parent`를 설정에 기억한다. 나중에 바꾸는 길은 `lophn settings set projects.folder <path>`뿐이다.

### 한 창의 목록

이 컴퓨터의 창 하나의 왼쪽 sidebar와 Home의 Workspaces panel이 명단의 모든 기계의 project를 보인다(`remote.md`의 "desktop에서 다른 기계 보기"). 창은 기계마다 그 기계의 범위에서 `project.list`를 읽어 든다.

- **기계마다 따로.** 줄은 기계를 건너 합치지 않는다. sidebar는 Workspaces 아래 이 컴퓨터의 Home·project·앱을 두고, 그 밑에 다른 기계마다 접히는 묶음(머리에 기계 이름과 상태)이 그 기계의 Home·project·앱을 든다. 묶음은 접힌 채 시작하고 창이 그 기계의 workspace를 보이면 펼친다. session은 자기 기계의 workspace 줄에 선다.
- **같은 project.** 기계마다의 `project.list`에서 `identity`가 같은 project를 같은 project로 안다(줄의 `also`). composer의 project 표시가 이것으로 새 session의 기계를 고르고, Home의 Workspaces panel이 "also on"과 이 컴퓨터에 없는 project를 보인다. 기계 하나 안의 `prj_`는 그 기계의 workspace key로만 쓰고 다른 기계의 기록을 가리키지 않는다.
- **이 컴퓨터에 없다.** 다른 기계의 project 줄에 같은 project가 이 컴퓨터에 없으면 오른쪽 클릭 menu가 가져오는 길이다. git project(remote가 있다)는 [Clone to this computer]이고 진행과 결과가 그 줄 아래 한 줄로 선다(누르면 걷힌다). git이 아닌 project는 [Link to a project on this computer…]가 잇기 dialog를 연다. 후보는 이 컴퓨터의 git이 아닌 project 가운데 보관하지 않았고 아직 그 id가 아닌 것이다. 줄 아래에 늘 서는 "Not on this computer" 줄은 두지 않는다.
- **[Clone to this computer].** `shell:machines-clone-here { url, identity, title }`이 이 컴퓨터의 `project.clone`을 사람 자격으로 부른다. 어느 desktop 창이든 부른다. 답이 `projects_folder_unset`이면 shell main이 그 창에 붙은 OS 폴더 선택기를 열고 고른 폴더를 `parent`로 다시 부른다. 선택기를 닫으면 아무 일도 없다. `git_auth`면 "Run `<command>` in a terminal on this computer, then try again"을 보인다.
- **꺼진 기계.** 그 기계의 줄은 이 실행 동안 마지막으로 본 대로 흐리게 남고 열리지 않는다. 다시 붙으면 새로 읽는다.
- **등록.** 이 컴퓨터의 창 등록 dialog는 연결되어 사람의 route를 허락한 다른 기계를 맨 위에서 고를 수 있고, 그 기계의 `project.add`를 부르며 폴더는 그 기계의 폴더 목록 dialog(`project.browse`)에서 고른다.

## 지키는 것

1. lophn은 사람의 저장소에 쓰지 않는다. git은 읽기만 한다: commit, add, checkout, stash, index를 고치는 status를 하지 않는다. clone은 새 폴더를 만들 뿐 있는 폴더에 쓰지 않는다. 옛 판이 만든 `.lophn-project.json`은 읽지도 쓰지도 지우지도 않는다.
2. 모든 project는 `identity`를 갖는다. 등록할 때 ledger에서 나고, clone 자격만 다른 기계의 id를 준다.
3. 한 기계에서 한 id는 project 하나만 지금이나 옛 identity로 갖는다. 등록, clone, 잇기는 그 id를 적지 않는다.
4. 기록은 `prj_` key 그대로다. 기계를 넘는 id가 바뀌어도 session, 문서, 설정, 다른 표의 줄은 옮겨지거나 지워지지 않는다. 기존 data root의 project는 id가 없으면 판을 올릴 때 data step이 주고, 가진 id(옛 판에서 저장소 file에서 온 것 포함)는 그대로 원본이 된다.
5. 나누기(`project.renew_identity`)와 잇기(`project.link_identity`)는 사람만 한다. agent는 읽기(`project.identity`)와 clone만 한다.
6. clone은 묻는 창을 띄우지 않고 자격을 저장하지 않으며, 자격이 박힌 URL을 받지 않는다. 받다가 실패하면 임시 폴더를 지운다. 받은 뒤 등록이 실패해도 받은 폴더는 지우지 않는다.
7. 다른 기계의 project를 이 컴퓨터로 가져오는 길은 `project.clone`(`shell:machines-clone-here`) 하나이고, 그 기계에는 아무것도 쓰지 않는다. 어느 desktop 창이든 부르고 `remote.md` 지키는 것 24가 따른다.
8. 기계마다의 session 목록은 합치지 않는다. 각자의 core에서 읽고 줄 안에 기계 꼬리표로 나란히 보일 뿐이며, 한 기계의 `prj_`는 그 기계의 workspace key로만 쓰고 다른 기계의 기록을 가리키지 않는다.
9. 잇기는 git project의 정체를 바꾸지 못한다. 아직 폴더를 읽지 못한 project(`repo` null)도 git일 수 있어 잇지 않는다.
10. 옛 identity는 `identity`가 다른 값으로 바뀔 때만 남고, 그 project의 지금 `identity`를 담지 않으며 16개를 넘지 않는다. 남기는 자리는 ledger의 `identity`를 적는 한 곳이라 바뀌는 길이 늘어도 빠지지 않는다.

## 경계와 계약

- boundary `projects`(폴더 읽기, record, clone, 등록 dialog와 상세의 줄), `core-api`(route), `coding-agent-cli-interface`(`lophn project clone|identity`).
- `ProjectRecord`의 칸 `identity`(pri), `former_identities`(pri[], 오래된 것이 앞, 16개까지), `repo`(`git` | `none` | null), `remote`(`{ key, url }` | null). `project.list { identity }`가 id로 이 기계의 project를 찾는다(많아야 하나). 접두사 `pri`.
- route: `project.create`의 입력 `identity?`(clone 자격만. 거절의 `details.reason`: `identity_in_use`), `project.identity`(memory, user·agent. `{project, identity, repo, folder, found, remote, same_repository}`), `project.renew_identity`(command, user), `project.match { path }`(memory, user. 등록 전 폴더를 읽고 `{found, repo, remote, same_repository}`를 돌린다), `project.clone { url, parent?, name?, title?, identity? }`(memory, user·agent. 실패의 `details.reason`: `projects_folder_unset`, `git_auth`와 `details.command`, `git_not_found`, `timeout`, `git_failed`, `target_exists`, `identity_in_use`), `project.record_identity`(core 안 machine 자격만. 읽은 git 여부와 remote를 ledger에 적는다), `project.link_identity { project, identity }`(command, user. 거절의 `details.reason`: `git_project`, `identity_in_use`). 더하기는 `project.add { title, purpose, folders }`(memory, user. core가 `prj_` id와 title의 slug를 만들어 `project.create`를 부른 사람의 자격으로 보내고 slug가 겹치면 `-2`부터 다섯 번까지 한다. clone도 같은 함수다)이고, 다른 기기가 그 기계의 폴더를 고를 때는 `project.browse { path? }`(memory, user. 사람의 home 아래 폴더만 realpath로 판정해 읽는다. home 밖과 home 밖을 가리키는 symlink는 `forbidden`, 500개까지)다.
- CLI: `lophn project clone <url>`, `lophn project identity`(`--project`가 없으면 그 session의 project).
- shell IPC(`remote.md`): `shell:machines-clone-here { url, identity, title }`(모든 desktop 창. 답은 core의 `project.clone` 답 그대로).
- 설정: `projects.folder`(이 기계에서 clone한 project를 두는 폴더. 값에 기계 id를 붙이지 않는다).
- 순수 함수: remote key는 protocol에 있다.
- 저장: ledger schema step `projects.registry.identity`(projects 표에 칸 넷과 `identity` unique index), `projects.registry.former-identities`(`former_identities`, JSON 배열, 기본 `[]`). data step `projects.born-identity`(앞 판의 것)와 `projects.identity-for-all`이 id가 없는 모든 project에 새 id를 준다. 한 data root에서 아직 돌지 않은 것만 돈다.
- 앱 slug `project`는 예약 이름이다(`lophn project` 명령과 겹치지 않게).
- 앱: 앱 화면이 받는 project(`lophnApp.projects.list()`의 project, project workspace의 `place.workspace`)에 `identity`와 `formerIdentities`가 실린다. 앱은 기계 사이에 맞추는 data를 `identity ?? id`로 key한다(`app-call.md` "앱 화면의 project 읽기").
- 앱이 받는 `identity`는 바뀔 수 있다(잇기, [Separate project]). 그때 옛 id는 `formerIdentities`에 남고, 앱은 `id`로 붙은 줄을 옮기는 같은 write operation으로 옛 id로 붙은 줄을 `identity`로 옮긴다(SDK `@lophn/app-ui` guide "project에 붙는 앱").

## 결정

- 기계를 넘는 id는 lophn의 ledger에 두고 사람의 저장소에 두지 않는다. 이유: public 저장소나 여럿이 쓰는 저장소에 한 사람의 도구 file을 commit하라는 것은 말이 안 된다. 그 설계 때는 git만 기계를 건넜고 지금은 컴퓨터 사이 link와 `computers` 폴더가 있다. 버린 안: 저장소 안 `.lophn-project.json`(0.23, 계획 `project-identity`). (사람, 2026-11-21)
- 모든 project가 등록할 때 ledger에서 id를 받는다. 이유: 앱과 mail이 project를 가리킬 칸이 git 여부와 상관없이 늘 있어야 한다. (lead)
- 옛 file 길을 모두 지우고 호환 장치를 두지 않는다. 이미 commit된 file은 읽지도 쓰지도 지우지도 않는다. 이유: AGENTS.md "호환성". file에서 왔던 ledger id는 그대로 원본이 되므로 이미 같은 id인 기계들은 그대로 같다. (lead)
- clone은 id를 들고 가 받자마자 같은 project다. 들고 온 id를 이 기계의 project가 옛 identity로 가지면 받지 않는다. 이유: 사람이 나눈 id를 다시 받으면 앱의 옛 id 옮기기가 두 project로 갈린다. (lead, agent)
- 옛 identity를 남기는 곳은 ledger의 `identity`를 적는 store 함수 하나다. 이유: 잇기, 나누기가 모두 그 함수를 지나 빠지는 길이 없다. 16개 상한은 사람이 정체를 바꾸는 일이 드물고 상한이 있어야 schema가 모양을 거절할 수 있어서다. 이름은 ledger와 route가 protocol의 snake case(`former_identities`), 앱에 가는 값이 SDK의 camel case(`formerIdentities`)다. (planner)
- git을 읽지 못하면(폴더나 그 위에 `.git`이 있는데 git이 답하지 않는다) "git이 아니다"로 적지 않고 아무것도 쓰지 않는다. 이유: git project가 git이 아닌 것으로 적히면 잇기 후보가 된다. (agent)
- git이 아닌 project의 잇기는 이 기계의 ledger에 쓰는 command route다. 다른 기계에 쓰는 길은 두지 않는다: 사람은 이 컴퓨터의 project를 다른 기계의 id에 맞춘다. agent는 잇지 못한다: 나누기처럼 다른 기계에서 무엇이 같은 project인지를 바꾼다. (planner)
- remote key는 origin이 먼저다. 이유: 같은 사람의 clone끼리는 origin이 같고, fork를 그 upstream과 같은 저장소로 보지 않는다. `ssh -G`로 alias를 풀지 않는다(기계마다 설정이 달라 key가 갈린다). (planner, T3 Code·Paseo 규칙의 합)
- clone은 그 기계의 git 자격만 쓰고 묻지 않으며, 자격이 없으면 실행할 명령을 돌려준다. 이유: 자격은 기계를 넘지 않는다. 묻는 창은 agent가 부른 git을 멈춰 세운다. (planner)
- clone 부모 폴더는 처음 한 번 묻고 설정 `projects.folder`에 둔다. 값에 기계 id를 붙이지 않는다: 이 기계에 그 경로가 있으면 이 기계에서 맞는 답이다. 설정 화면은 두지 않는다. 처음 clone의 폴더는 shell이 폴더 선택기로 받아 `parent`로 넘기고 기억은 core가 한다. (planner, agent)
- clone은 임시 폴더에 받고 이름을 바꾼다. 이유: 반쯤 받은 폴더가 project 자리에 남지 않는다. (planner, Paseo·Happy 조사)
- 위험 test는 git을 띄우지 않고 주입한 runner와 임시 폴더로 쓴다. (planner)
- 다른 기계를 보는 desktop은 폰과 같은 권한이다. 그 창에서 M의 project의 설정을 바꾸지 않는다. (사람)
- 한 창의 목록은 기계마다 따로 세우고 다른 기계는 접히는 묶음이다. 이유: 같은 project를 한 줄로 합치면 어느 기계의 것을 여는지 숨고 다른 기계의 session이 이 컴퓨터의 workspace 사이에 끼어 목록이 어지러웠다(사람, 2026-11-19). 버린 안: id로 한 줄에 합치고 줄 안에 기계 꼬리표(0.23.9x).
- 이 컴퓨터에 없는 project를 가져오는 길은 줄 아래 늘 서는 줄이 아니라 줄의 menu다. 이유: 가져올 일이 드물고 늘 서는 줄이 목록을 길게 했다. (사람)
- 꺼진 기계의 마지막으로 본 목록은 창의 메모리에만 둔다. 이유: 저장하면 새 shell data file과 그 옮기기가 생긴다. 대가: lophn을 다시 켜면 한 번도 붙지 않은 기계의 project는 줄이 없다. (planner)
- 기록을 고쳐도 project `revision`을 올리지 않는다. 이유: 열려 있는 편집 form의 비교와 부딪치지 않게(project 아이콘과 같다). (planner)

## 열린 것

- 한 창의 목록의 같은 project 알아보기와 clone은 한 컴퓨터의 개발 core 둘과 headless Electron으로 보았다. 설치본 둘과 실제 원격 저장소는 보지 못했다.
