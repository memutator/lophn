# git worktree: 한 project 안에서 여러 작업이 서로의 파일과 브랜치를 덮어쓰지 않게 lophn이 worktree를 만들고 관리한다

상태: 로드맵 초안. 2026-11-28 사람이 조사를 요청했고 조사(`feature-cleanroom` workflow, harness-lab `_report/git-worktree/`)를 바탕으로 planner가 정리했다. 제품 결정은 2026-11-28 사람이 내렸다("정한 것"; 6~12는 planner 추천을 사람이 "전부 추천대로"로 받았다). 1단계(화면 밖, builder-neon)는 0.23.190으로 main에 올라갔다. 2단계(화면, builder-opus)는 화면 추가 조사(같은 `_report/git-worktree/` spec 4·5절) 뒤 제품 결정 13~17과 함께 "구현 범위" 2단계에 적었다. "(agent)"라고 적은 것은 planner의 기술 결정이다.
배경 문서: `project-docs/architecture/{project-identity,workspace-session,workspace-layout,coding-agent,terminal-agent,project-command,approval,remote}.md`, `project-docs/products/roadmap/{a2a-access,agent-surface,app-place,project-commands}.md`, `project-docs/PRODUCT.md`.

## 사람의 말 (원문)

2026-11-28:

> 다른 멀티 하네스들에서 git worktree 관련 기능들 분석하고 와줘

design 첫 답 (2026-11-28):

> 1. desk랑 worktree랑 1:1 아님;;; desk는 사람의 작업 공간이라는 개념이라서
> 2. 그리고 오른쪽 사이드 바에 explorer 있는데 거기서 폴더 추가로 등록하고 볼 수 있고한데 그거랑 워크트리랑 또 연계해야하고
> 3. project api 그 sdk 뭐시기 그거랑 연계도 해야하고
> 4. 오른쪽 사이드 바에다가 변경이력이나 브랜치 보고 막 커밋하고 그런 ui적 기능들도 레퍼런스들 참고해서 만들어야하고

그리고 물은 것: Orca·Paseo 같은 제품은 worktree 만들기 규칙을 agent에게 어떻게 알려 주는가. 답: 가르치지 않는다. 규칙은 앱이 갖고 agent에게는 인자 적은 도구 하나(Paseo `create_workspace(isolation: "worktree")`, Orca `orca worktree create`·worker `--worktree new-child`, T3 `t3_thread_launch(workspaceStrategy)`)만 준다.

design 둘째 답 (2026-11-28):

> 화면 조사 한 번 더 시켜 그리고 전부 다 추천대로 진행하고 화면 조사 오면 그건 claude code, opus 5.5로 시키면 될 듯

> 아니 프론트 화면만 opus 쓰고 builder는 그대로 neon으로 쓰겠다고그리고 화면과 상고나 없는 builder neon은 지금 바로 시작하고

## 왜

지금 한 project에서 coding agent 둘, 또는 workflow step 둘이 같이 코드를 고치면 같은 폴더·같은 브랜치를 쓴다. 서로의 변경을 덮어쓰거나, 한쪽이 브랜치를 바꾸면 다른 쪽이 깨진다. 다른 multi-harness 제품은 거의 모두 작업마다 git worktree(같은 저장소의 두 번째 작업 폴더)를 만들어 이것을 푼다. lophn 저장소 자체도 `feature-cleanroom` workflow가 `lophn-worktrees/<topic>`에 worktree를 손으로(agent 지침으로) 만들어 쓰고 있다.

## 지금 코드 (main `225322d4a`, 조사 기준 `0b4ad2600`과 해당 부분이 같다)

- worktree 생성·조회·제거는 core route·CLI·화면 어디에도 없다. `project.add`는 있는 폴더 등록, `project.clone`은 새 저장소 clone만 한다.
- git은 읽기만 한다(`project-identity.md` 지키는 것 1: commit, add, checkout, stash를 하지 않는다).
- 사람이 이미 정한 것과 부딪힌다: "worktree는 lophn이 하지 않는다"(사람, 2026-11-08·09; `a2a-access.md` 기술 결정 4, `agent-surface.md` 만들지 않는 것), `project-command.md`는 worktree 훅을 일부러 빼 두었다.
- 손으로 만든 worktree를 project로 따로 등록하면 같은 remote의 git project가 둘이 되어 다른 컴퓨터와 자동으로 묶이지 않는다(`project-identity.md`).
- project의 폴더 목록에 worktree를 더해도 격리가 안 된다: lophn agent의 file 도구는 project의 모든 폴더를 읽고 쓰고(`workspace-session.md`), harness agent의 cwd는 늘 첫 폴더다(`coding-agent.md`).
- 내장 harness GUI는 CLI 자신의 worktree 기능을 막아 두었다(Claude GUI `includeWorktrees: false`, Codex GUI의 `--worktree` 불가 안내).
- 폰 앱과 디자인 kit은 desk 묶음 머리글을 이미 `WorktreeLabel`이라 부른다(이름만 그렇고 worktree와는 관계가 없다).

### 이미 있는 기반 (다시 쓴다)

1. project 정체성(`pri_`)과 `inspectFolder`(git 최상위·remote 읽기), `project.clone`의 비대화형 git 실행.
2. Project Command(`project-command.md`): core 소유 명령 전용 PTY, 프로세스 트리 멈추기, 로그 꼬리, 다른 도구 설정 파일의 읽기 전용 `detect`, 승인 카드.
3. desk와 workflow instance desk 자동 투영(`workspace-layout.md`).
4. core 소유 PTY host, `terminal_view`, 기기별 터미널 입력 허락(`remote_grants`).
5. 단일 CLI 명령 표와 `folderOfCwd` 실경로 검사.

## 다른 제품은 (조사 요지, 7종)

Orca·Paseo·Emdash(가장 넓음), T3 Code·Happy(수명주기 중심), herdr(최소), GooeyPi(고르기만).

- **진짜 `git worktree`를 앱이 정한 중앙 폴더에 만든다**(6/7). 경로에 짧은 해시를 넣어 Windows 경로 길이와 같은 이름 저장소 충돌을 피한다.
- **worktree 하나에 대화·터미널 여럿이 붙고, 폴더 경로는 만든 뒤 바뀌지 않는다**(7/7).
- **브랜치 이름은 앱이 자동으로 짓고**(5/7), 넷은 첫 메시지 뒤 AI가 뜻 있는 이름으로 브랜치만 바꾼다.
- **만드는 때는 갈린다**: 사람이 명시적으로(5/7), 작업을 만들 때마다 자동(Emdash), 첫 메시지를 보낼 때(T3 Code).
- **`.env` 같은 git이 무시하는 파일을 새 worktree로 복사**(4/7), **setup/teardown 스크립트**(6/7). 설정은 대개 저장소 파일(`orca.yaml`, `paseo.json` 등)에 있다. setup이 실패해도 worktree는 지우지 않는다.
- **git 화면은 크게 갈린다**: diff·commit·push·PR·merge까지 앱이 하는 곳(4/7)과 읽기 전용·agent에 맡기는 곳(3/7).
- **지우기는 보수적이다**: 앱이 만든 것만 디스크에서 지우고, 바깥에서 만든 것은 목록에서만 뺀다. 변경이 남았으면 막고, 브랜치는 기본으로 남긴다(7/7).
- **agent 도구**: worktree 만들기·목록·상태를 agent에게 여는 곳이 다섯(MCP 또는 CLI).
- **원격 컴퓨터의 worktree는 그 컴퓨터가 직접 만든다**(원격이 있는 6/6).

## 표준을 그대로 가져올 수 없는 곳

1. **사람이 정한 "worktree는 lophn이 하지 않는다"(2026-11-08·09)를 바꿔야 한다.** 들인다면 그 결정을 대체한다는 것을 `a2a-access.md`·`agent-surface.md`에 적는다.
2. **"git은 읽기만 한다"(`project-identity.md`)에 예외가 든다.** worktree 만들기·지우기(그리고 브랜치 만들기)는 git 쓰기다. 소스 컨트롤 화면(정한 것 5)은 commit까지 쓰므로, 바뀐 원칙을 `project-identity.md`에 다시 적어야 한다.
3. **저장소에 lophn 파일을 쓰지 않는다.** 다른 제품은 복사 규칙·훅을 저장소 파일에 둔다. lophn은 Project Command처럼 lophn 안(ledger)에 두고 저장소 파일은 읽어서 가져오기만 할 수 있다.
4. **lophn에는 이미 desk가 있다.** 사이드바에 `Project → Worktree → Session` 층을 그대로 넣으면 `Project → Desk → Session`과 겹친다.
5. **세션의 파일 범위와 cwd를 좁혀야 한다.** 지금 file 도구는 project의 모든 폴더, harness는 첫 폴더라서, worktree에 묶인 세션은 그 worktree 폴더 안으로만 좁히는 core 경계가 새로 든다.
6. **worktree는 컴퓨터마다 따로다.** 정의·기록을 옮기지 않고(`project-identity.md`), 다른 컴퓨터 것은 그 컴퓨터의 route를 터미널 입력 허락 아래 부른다(Project Command와 같은 길).
7. **lophn은 IDE나 coding agent가 아니다**(`PRODUCT.md`). 소스 컨트롤 화면은 들이되(정한 것 5·9) forge(GitHub 등) PR 리뷰·merge 플랫폼은 하지 않는다.

## 정한 것

### 제품 (사람)

1. **lophn core에 들인다. 2026-11-08·09의 "worktree는 lophn이 하지 않는다"를 대체한다.** worktree를 Explorer·앱 SDK·소스 컨트롤 화면과 엮으라는 답에서 나온 결론이다. `project-identity.md`의 "git은 읽기만 한다"도 worktree 수명과 소스 컨트롤 화면의 git 쓰기만큼 바뀐다. (사람, 2026-11-28)
2. **desk와 worktree는 묶지 않는다.** desk는 사람의 작업 공간(화면 배치)이고 worktree는 그것과 다른 축이다. 한 desk에 여러 worktree의 탭이 섞일 수 있다. (사람, 2026-11-28)
3. **오른쪽 사이드바 Explorer와 엮는다.** Explorer는 지금 project 폴더를 더해 등록하고 본다. worktree도 거기서 보이고 다뤄야 한다. (사람, 2026-11-28; 모양은 "사람이 정할 것" B)
4. **앱 SDK의 project API와 엮는다.** 앱이 project의 worktree를 알 수 있어야 한다. (사람, 2026-11-28; 범위는 "사람이 정할 것" C)
5. **오른쪽 사이드바에 소스 컨트롤 화면을 만든다.** 변경 내역(히스토리), 브랜치 보기, 커밋 같은 기능을 다른 제품을 참고해 만든다. 화면 모양은 추가 조사로 채운다. (사람, 2026-11-28)
6. **세션·터미널은 열 때 worktree를 고른다.** 기본은 원래 폴더. 한 worktree에 세션·터미널이 여럿 붙는다. 탭과 왼쪽 사이드바 세션 줄에 브랜치 꼬리표가 선다. (사람, 2026-11-28)
7. **Explorer에서 worktree는 그것이 난 폴더 아래 가지로 선다.** 브랜치 이름과 바뀐 파일 수를 보인다. 폴더 오른쪽 클릭 "New worktree…", worktree 오른쪽 클릭 "Open agent here / Open terminal here / Remove…". worktree는 project 폴더 목록(`folders[]`)에 넣지 않는다. (사람, 2026-11-28)
8. **앱 SDK로 앱은 읽기만 한다.** worktree 목록·상태·바뀜 알림. 만들기·지우기·커밋은 사람과 agent가 한다. (사람, 2026-11-28)
9. **소스 컨트롤 범위**: 바뀐 파일(stage/unstage/버리기, diff), 커밋, 히스토리, 브랜치 목록·만들기·바꾸기, push·pull. GitHub 등 PR 만들기·리뷰·merge는 이번에 하지 않는다. (사람, 2026-11-28)
10. **worktree는 사람이 명시적으로 만든다.** + 메뉴, Ctrl+K, Explorer, CLI, agent 도구, workflow step·`team spawn` 옵션. 새 세션마다 자동으로 만들지 않는다. (사람, 2026-11-28)
11. **`.env` 복사와 setup/teardown은 lophn 안 project별 설정이다.** 저장소에 있는 다른 도구 설정 파일(`.worktreeinclude` 등)은 읽어서 사람이 골라 가져오기만 한다. setup·teardown은 Project Command를 고른다. (사람, 2026-11-28)
12. **agent는 목록·상태·만들기를 한다. 지우기는 사람 승인 카드를 거친다.** workflow step과 `team spawn`에 "새 worktree에서" 옵션을 둔다. agent에게는 규칙을 가르치지 않고 lophn이 규칙을 갖는다(경로·브랜치 이름·기준 브랜치·준비). (사람, 2026-11-28)
13. **stage·버리기는 파일 단위와 일괄(Stage All·Unstage All·Discard All)까지.** 한 파일 안 일부(hunk) 고르기는 하지 않는다. (사람, 2026-11-28)
14. **AI 커밋 메시지는 넣는다. 만든 글을 입력 칸에 채우고 사람이 고쳐 커밋한다(저절로 커밋하지 않는다). `--amend`는 넣지 않는다.** (사람, 2026-11-28)
15. **히스토리는 패널 아래 접는 `Commits` 섹션이다.** 커밋을 누르면 바뀐 파일, 파일을 누르면 diff 탭. 큰 브랜치 그래프 화면은 하지 않는다. (사람, 2026-11-28)
16. **저장소 hook과 서명은 설정대로 돈다.** 건너뛰기(`--no-verify`) 단추는 없다. 실패하면 이유(stderr)를 펼쳐 보인다. (사람, 2026-11-28)
17. **충돌은 배너 + `Conflicts` 묶음 + 편집기로 열기 + `Mark as Resolved` + `Abort` + "Ask agent to resolve"까지.** 우리 쪽/상대 쪽 한 번에 고르기(3-way 뷰어)는 하지 않는다. (사람, 2026-11-28)

## 기술 결정 (agent)

1. **core 소유, 저장소 무쓰기.** ledger 표 `project_worktrees`(불변 `wkt_` id, `project_id`, `repo_root`, `git_common_dir`, `path`, `git_admin_name`, `label`, `branch`, `base_ref`, `base_commit`, `provenance: managed|adopted`, `status`, 시각; `desk_key`는 두지 않는다). 저장소 안에는 아무것도 쓰지 않는다(`.git/worktrees/<admin>`은 git 자신이 쓴다). (agent: spec 3.1, `project-identity.md`)
2. **경로**: `<data>/worktrees/<repo_slug>-<sha256(git_common_dir)[:8]>/<branch_prefix≤23B>-<id 끝 8자>`. 지운 worktree의 경로를 다시 쓰지 않아, 경로로 기록을 묶는 coding agent의 대화·신뢰가 새 worktree에 섞이지 않는다. 루트는 설정으로 바꿀 수 있고 홈·저장소 안·파일시스템 루트는 금지. Windows는 220자 예산. (agent: spec 3.2.2)
3. **git 실행**: 셸 없는 고정 argv, `LC_ALL=C`·`GIT_TERMINAL_PROMPT=0`·`GCM_INTERACTIVE=never`·`GIT_OPTIONAL_LOCKS=0`, `-`로 시작하는 이름 거부와 `--`, 새 브랜치는 `--no-track`, fetch는 `--no-write-fetch-head --no-auto-maintenance` 비대화형·실패 시 로컬 ref로 폴백. `git_common_dir`마다 mutex로 add/remove/prune/branch 변경을 줄 세운다. (agent: spec 3.2.3–3.2.4)
4. **세션 격리**: session과 terminal에 선택 `worktree_id`(열 때 고정, 세션 정체성 불변식 유지). desk와는 묶지 않는다(정한 것 2). 있으면 file 도구 범위는 project 폴더 목록에서 그 worktree가 난 폴더를 worktree로 바꾼 것 + project 데이터 폴더(workflows·artifacts·skills), harness·터미널·Project Command cwd는 그 worktree, env `PROJECT_ROOT`·`WORKTREE_PATH`·`WORKTREE_ID`·`WORKTREE_BRANCH`. harness의 자체 `--worktree`에 기대지 않는다. (agent: spec 3.3.1)
5. **지우기 가드**: 3중 소유권 증명(managed ∧ 관리 루트 안 실경로 ∧ `git_common_dir`/`gitdir:` 재검증). adopted는 목록에서만 뺀다. preflight 뒤 실행, spec 3.5.3의 가드 표(중첩·lock·위험 경로는 무조건, 도는 세션은 `stop_sessions`, 변경·submodule은 `force`). 브랜치는 기본으로 남기고, 지우라고 해도 `git branch -d`만, 못 지우면 남기고 알린다. (agent: spec 3.5)
6. **복구와 OS 방어**: `creating|removing` 저널로 재시작 때 정리, 반쯤 지워진 폴더는 `gitdir:` 확인 뒤에만 지움, Windows는 `core.longpaths`·터미널 먼저 끄기, WSL prune 보호, 저장소 루트까지 안 보이면 `unmounted`로 두고 정리하지 않음. (agent: spec 3.5.5)
7. **상태 감시**: 홈·상위 폴더 감시 금지. `.git/HEAD`·`worktrees/<admin>/HEAD`·`packed-refs`만 좁게 보고, 보이는 worktree만 디바운스해 `git --no-optional-locks status --porcelain=v2 -z`. (agent: spec 3.4.1)
8. **원격**: worktree는 그 컴퓨터 core 소유. 다른 컴퓨터의 목록·상태는 `machines/call`로 읽고, 만들기·지우기는 받는 컴퓨터의 터미널 입력 허락이 있어야 한다. agent의 `--on` 변경은 `forbidden`. (agent: `project-command.md`의 원격과 같은 길, Project Command에서 사람이 정한 "원격 실행은 사람만"을 그대로 따른다)

## 구현 범위

구현은 두 단계다. **1단계(화면 밖)는 builder-neon(Antigravity)이 지금 한다. 2단계(화면)는 화면 추가 조사 뒤에 builder-opus(Claude Code Opus 5.5)가 한다.** (사람, 2026-11-28) 둘 다 `feat/git-worktree`에 쌓는다.

구현자는 이 파일과 `../harness-lab/_report/git-worktree/spec.md`만 읽는다. 다른 제품의 source와 harness-lab의 다른 파일은 열지 않는다. 데이터 모양·상태 기계·git 명령과 플래그·경로 규칙·가드 표·복구·감시 규칙은 spec 3절을 따르고, 이 파일이 spec과 다르면 이 파일이 이긴다(특히 spec의 `desk_key`는 두지 않는다).

### 1단계: 화면 밖 (builder-neon, 지금)

#### 만드는 것

1. **protocol 계약** (`packages/protocol`)
   - `WorktreeRecord`(spec 3.1.1에서 `desk_key` 뺀 것), `WorktreeGitStatus`(spec 3.4.1), route `worktrees/{list,get,create,adopt,rename,remove_preflight,remove}`(spec 3.6.1), event `WorktreesChanged`·`WorktreeStatusChanged`.
   - session과 terminal 여는 입력과 snapshot에 선택 `worktree_id`. 세션 정체성(agent, workspace)은 그대로이고 `worktree_id`는 열 때 고정, 뒤에 바꾸지 않는다.
   - GateCall `worktree_remove`(아래 4).
   - CLI group 이름 `worktree`를 `RESERVED_APP_SLUGS`에 더한다.
2. **core worktree 관리** (`packages/core/projects/worktrees/` 같은 자리, 구현자가 고른다)
   - ledger 표 `project_worktrees`와 data step. 기술 결정 1~3, 5~7 그대로: 경로·이름, 하드닝 git 실행과 `git_common_dir` mutex, 생성 파이프라인과 롤백(spec 3.2.4), `new_branch`·`existing_branch`·`adopt`, `rename`(label, 선택 `git branch -m`, 경로 불변), 브랜치 자동 이름 `wt/<adj>-<noun>-<4hex>`(AI 이름 바꾸기는 하지 않는다), base ref 해석과 비대화형 fetch 폴백, preflight와 가드 표, 3중 소유권, 브랜치 보존, 재시작 복구, 반쯤 지운 폴더 정리, Windows·WSL·언마운트 방어, 좁은 상태 감시.
   - non-git 폴더, bare, unborn 저장소는 spec 3.2.1대로 거절한다. project 폴더가 여럿이면 만들 때 어느 폴더(git 최상위)에서 날지 받는다(`folder`, 하나뿐이면 생략 가능).
   - worktree는 project의 `folders[]`에 넣지 않는다(정한 것 7).
   - 관리 루트 설정 `projects.worktrees_folder`(비면 `<data>/worktrees`, 홈·파일시스템 루트·저장소 안 금지).
3. **세션·터미널·명령 격리** (기술 결정 4)
   - `worktree_id`가 있는 lophn agent session: file 도구 범위 = project 폴더 목록에서 그 worktree가 난 폴더를 worktree 경로로 바꾼 것 + project 데이터 폴더. shell 도구 cwd 기본도 worktree.
   - harness agent(background·GUI 탭)와 터미널: cwd = worktree 경로(`folders[0]` 대신). TUI 열기도 같다.
   - Project Command 실행에 선택 `worktree_id`: 기준 폴더가 worktree가 난 폴더면 cwd를 worktree 안의 같은 상대 경로로.
   - env `PROJECT_ROOT`(원래 저장소 루트), `WORKTREE_PATH`, `WORKTREE_ID`, `WORKTREE_BRANCH`.
   - `folderOfCwd`가 worktree 경로를 그 project의 것으로 인정한다(관리 루트 안의 ready 레코드만).
   - worktree가 `removing`·`removed`·`missing`이면 그 worktree로 새 session·터미널을 열 수 없다(`conflict`).
4. **agent와 승인** (정한 것 12)
   - agent: `list`·`get`·`status`·`create`·`rename` 허용(자기 project만). `adopt`는 사람만.
   - `remove`는 GateCall `worktree_remove`로 사람 승인 카드: 대상 경로, 브랜치, preflight 결과(바뀐 파일 수, untracked, 앞선 커밋 수, submodule), `force`·`stop_sessions`·`delete_branch` 여부. attended는 카드(`once | reject`), 팀 자식은 부모에게, unattended는 `deny no_person`. 사람이 부르면 카드 없이 preflight만.
   - agent는 다른 컴퓨터(`--on`)의 worktree를 바꾸지 못한다(`forbidden`).
5. **workflow와 팀**
   - workflow step 선언(YAML `steps.<name>.worktree`, flow `agent({ worktree })`)과 participant에 `worktree: "new" | "inherit"`. `new`면 그 step session을 열기 전에 core가 새 worktree를 만들어 `worktree_id`로 연다(브랜치 이름에 instance 제목 slug를 쓴다). `inherit`면 앞 step session의 `worktree_id`를 그대로 쓴다. 없으면 지금처럼 원래 폴더. 실패하면 그 step을 `blocked`로 두고 이유를 남긴다. `@lophn/flow` 선언 타입에 칸을 더하고 `flow_sdk` 판을 올린다(`migrate-sdk` 메모 포함).
   - `lophn team spawn --worktree new|inherit|<wkt_id>`: 같은 규칙. 기본은 부모의 `worktree_id`를 물려받는다(없으면 원래 폴더).
   - instance가 끝나도 worktree를 저절로 지우지 않는다.
6. **환경 준비** (정한 것 11)
   - ledger에 project별 worktree 설정: `copy_patterns: string[]`(gitignored 파일 복사 규칙), `setup_command: <project command id> | null`, `teardown_command: <project command id> | null`, `run_setup: boolean`(기본 true). 사람만 쓴다(agent가 쓰면 `forbidden`, Project Command의 agent 설정과 같은 이유).
   - 복사는 spec 3.3.2 안전 규칙 그대로(`git check-ignore`, 덮어쓰기 금지, CoW 우선, 2 GiB/50,000개 상한, 넘으면 경고만).
   - setup은 worktree가 ready 된 뒤 Project Command 전용 PTY로 그 worktree cwd에서 돈다. 실패해도 worktree는 남기고 상태와 로그 꼬리를 낸다. teardown은 지우기 직전 60초 아래 동기 실행, 실패면 지우기를 멈추고 `allow_failed_teardown`만 통과.
   - 가져오기: Project Command `detect`처럼 등록 폴더의 `.worktreeinclude`를 읽기만 해서 복사 규칙 후보로 돌려준다. 저절로 쓰지 않는다.
7. **소스 컨트롤 core route (화면이 쓸 바탕)** (정한 것 9)
   - `source_control/{status,diff,stage,unstage,discard,commit,log,show,branches,branch_create,switch,push,pull}`. 대상은 project 폴더(git) 또는 worktree. 쓰기 route는 사람 자격만(agent는 터미널의 git을 쓴다). spec 3.4.2 불변식 셋(충돌 상태 커밋 거부, 그 checkout에서 도는 turn이나 쓰기가 있으면 switch 거부, pull은 `--ff-only`, force push 없음)을 지킨다. 모든 git 실행은 기술 결정 3의 하드닝을 쓰고, push·pull의 인증 실패는 묻는 창 없이 `unauthorized`와 사람이 칠 명령 한 줄로 돌려준다.
   - 2단계 화면 조사에서 칸이 더 필요하면 2단계에서 더한다.
8. **CLI** (`packages/cli/commands/worktree.ts`)
   - `lophn worktree list|get|create|adopt|status|rename|remove`(spec 3.6.2의 옵션, `--folder` 더함). 다른 컴퓨터는 `--on`(사람만). `--json`.
   - 소스 컨트롤과 worktree 설정 쓰기는 CLI 명령으로 두지 않는다.
9. **앱 SDK 읽기** (정한 것 8)
   - 앱 view bridge `lophnApp.projects`에 `worktrees(project)`(목록 + 상태)를 더하고 바뀜 알림을 준다. SDK에 `useWorktrees(project)` hook. 쓰기는 없다. `@lophn/app-ui` 판 올림과 `migrate-sdk` 메모.
10. **원격** (기술 결정 8)
    - `worktrees/*`·`source_control/*`를 기기 route 목록에 넣는다. 읽기는 연결된 사람 기기에 허용, 바꾸기는 받는 컴퓨터의 터미널 입력 허락("Allow controlling this computer")이 있어야 한다.

#### 1단계에서 만들지 않는 것

- 모든 renderer 화면: Explorer 가지와 메뉴, 소스 컨트롤 패널, 세션·터미널 열 때 worktree 고르기, 탭·세션 줄 브랜치 꼬리표, Project settings의 worktree 설정 칸, 폰 화면. 2단계다.
- AI 브랜치 이름 바꾸기, PR, 포트 할당·역프록시, 자동 정리(sweep), 상시 파일 동기화, 저장소 파일 쓰기, content-hash 신뢰 게이트.
- 내장 harness의 자체 worktree 기능 풀기(Claude GUI `includeWorktrees`, Codex `--worktree`는 그대로 막아 둔다).

#### 바뀌는 architecture 문서

- 새 `project-docs/architecture/worktree.md`: 모델, 상태 기계, 경로, git 실행, 가드와 소유권, 복구, 격리, 승인, workflow·팀, 원격, 지키는 것, 결정.
- `project-identity.md`: "git은 읽기만 한다"를 worktree 수명과 소스 컨트롤(사람 자격) 쓰기 예외로 고친다. 저장소에 lophn 파일을 쓰지 않는 것은 그대로.
- `workspace-session.md`(file 범위), `coding-agent.md`·`harness-gui.md`(cwd), `terminal-agent.md`, `project-command.md`(worktree cwd와 setup/teardown이 이제 있다), `approval.md`(GateCall `worktree_remove`), `workflow.md`(step `worktree`), `agent-call.md`(spawn `--worktree`), `remote.md`(기기 route), `settings.md`(`projects.worktrees_folder`).
- 로드맵 `a2a-access.md` 기술 결정 4, `agent-surface.md` 만들지 않는 것: 이 결정으로 대체됐다고 적는다.
- `project-docs/flows/`, change-log 항목.

#### 1단계 끝나면

- git project에서 `lophn worktree create`가 관리 루트 아래 새 브랜치 worktree를 만들고 `list`·`status`에 브랜치·바뀐 파일 수·앞섬/뒤짐이 나온다. 지운 뒤 같은 이름으로 다시 만들어도 경로가 겹치지 않는다.
- 바깥에서 만든 worktree를 `adopt`하고 `remove`하면 목록에서만 빠지고 디스크와 브랜치는 그대로다.
- 바뀐 파일이 있으면 `remove`가 `dirty_worktree`로 막히고 `--force`로 지워진다. 브랜치는 남는다. lophn agent의 `remove`는 승인 카드가 뜬다.
- `worktree_id`로 연 lophn agent는 원래 폴더의 파일을 쓰지 못하고, harness agent와 터미널은 worktree에서 시작한다.
- workflow step `worktree: new`가 새 worktree에서 step을 돌리고, 다음 step `inherit`이 같은 worktree를 쓴다. `team spawn --worktree new`도 같다.
- 복사 규칙의 `.env`가 새 worktree에 들어오고, setup 명령이 worktree에서 돌며 실패해도 worktree는 남는다.
- 생성 도중 core를 죽였다 켜면 `creating` 레코드가 정리된다.
- 앱 view에서 `useWorktrees`가 목록을 읽는다.
- `npm run check`가 통과한다.

### 2단계: 화면 (builder-opus)

1단계는 main(0.23.190)에 있다. 2단계는 같은 branch `feat/git-worktree`(main과 같은 곳에서 이어 간다)에 쌓는다. 화면 계약은 spec 5절(5.1~5.5)이 정본이고, 아래가 spec과 다르면 아래가 이긴다. 1단계가 만든 route(`worktrees/*`, `source_control/*`)와 event를 쓰고, 화면에 모자란 칸은 core·protocol에 더한다.

#### 만드는 것

1. **소스 컨트롤 패널** (spec 5.1)
   - 오른쪽 사이드바 Explorer 다음 패널 `source-control`(project에만). 대상 고르기(원래 폴더와 그 밑 worktree, 활성 탭 따라가기 + 고정), 상태 영속(대상별 커밋 초안·flat/tree·접힘).
   - 바뀐 파일: `Conflicts`·`Staged Changes`·`Changes` 묶음, flat/tree, 필터, 파일 줄 구성, 파일·디렉터리·일괄 stage/unstage/discard, discard 확인(tracked 되돌리기와 untracked 지우기 구분), 우클릭 메뉴. hunk 단위는 없다(정한 것 13).
   - diff: 새 탭 종류 `git_diff`(preview 규칙은 `document_editor`와 같다), inline 기본 + side-by-side 토글(설정 영속), 다음/이전 변경, 공백 무시, 줄 바꿈, Open File, 빠른 stage/unstage/discard, 대용량·바이너리·이미지·untracked 처리, 원격 읽기 전용.
   - 커밋: 입력 칸, 검증(빈 메시지, staged 0, 충돌, 다른 쓰기 중), `Commit`(Mod+Enter)과 `Commit & Push`, hook 실행 중 표시. `--amend` 없음(정한 것 14).
   - **AI 커밋 메시지**(정한 것 14): core route `source_control/suggest_message`(사람 자격). staged diff(120~200 KB 상한, 파일별 공평 분배)를 모델 한 번 호출로 요약해 글만 돌려준다. 모델은 lophn agent의 기본 모델 설정을 쓰고(provider 호출 길은 lophn agent와 같은 것), 모델이 없으면 단추를 끄고 이유를 툴팁에 보인다. 취소할 수 있다. 커밋하지 않는다. 저장소의 최근 커밋 몇 개의 제목을 문체 참고로 넣는다. (agent)
   - 히스토리: 접는 `Commits` 섹션(정한 것 15), 50개씩 `Load more`, 줄 구성(push 여부 점, 제목, sha7, 작성자, 상대 시각, ref 배지), 펼치면 파일 목록, 파일은 `git_diff`(parent..commit), 우클릭 Copy SHA·Copy Message·Create Branch from Commit.
   - 브랜치: 브랜치 바 팝오버(검색, Local/Remote, 다른 worktree가 쓰는 브랜치는 그 worktree로 점프, 바깥 worktree가 쓰면 끄기), 만들기, 바꾸기(도는 agent 턴·dirty 막기, 저절로 stash 하지 않음), 이름 바꾸기·지우기(`-d`만). 그래프 화면 없음.
   - push·pull·fetch: ↑N ↓M, Fetch/Pull(`--ff-only`)/Push(없으면 Publish Branch), force push 메뉴 없음.
   - 충돌(정한 것 17): 배너, `Conflicts` 묶음, 편집기로 열기, Mark as Resolved, Complete Merge, Abort, "Ask agent to resolve"(그 worktree의 새 lophn agent 세션을 열고 충돌 파일 목록과 진행 중 연산을 첫 메시지로 준다).
   - 빈 상태·오류 문구 표와 단축키(Mod+Shift+G 패널, Mod+Enter 커밋, F7/Shift+F7). 단축키는 `keybindings.md`의 command로 등록한다.
2. **git 쓰기 안전** (spec 5.5, 정한 것 16)
   - 1단계 `source_control/*`이 spec 5.5의 다섯 계약을 다 지키는지 보고 모자란 것을 채운다: 커밋 전 검사(unmerged, 충돌 마커, 빈 staged·메시지, 중첩 저장소), stderr 자격증명 가리기, 구조화 오류 코드와 화면의 복구 안내, 전 경로 비대화형 하드닝(`LANGUAGE=C`로 hook의 UTF-8을 지킨다), hook·서명 존중과 hook 이름 표시·stderr 16 KiB 펼치기·타임아웃·`gpg_failed`, 원격 권한.
   - 1단계 route에 없는 쓰기(`abort`, `mark_resolved`, `branch_rename`, `branch_delete`, `fetch`)를 더한다. 모두 사람 자격만.
3. **Explorer × worktree** (spec 5.2, 정한 것 7)
   - 등록 폴더 아래 worktree 가지(브랜치·label, 바뀐 파일 수, 이상 상태 표시), 펼치면 그 worktree의 파일, 열린 파일이 worktree 안이면 자동 드러내기.
   - 파일·폴더 줄 git 상태 문자와 색(worktree마다 따로), 폴더 전파(`deleted` 빼고), `.gitignore` 흐림.
   - 우클릭: 폴더 `New worktree…`, worktree `Open agent here`(lophn agent + 즐겨찾기 coding agent)·`Open terminal here`·`View in Source Control`·Copy path·Copy branch name·Reveal in OS·Rename…·`Remove…`(managed는 preflight 결과 확인 창, adopted는 Untrack 확인), 파일 `Open Diff`·`Discard Changes…`.
   - 다른 컴퓨터 project의 Explorer도 같은 가지를 보이고 쓰기 허락이 없으면 읽기 전용.
4. **worktree 만들기 창**: 원래 폴더(폴더가 여럿이면), 기준 ref(기본은 1단계의 해석), 브랜치 이름(비우면 자동), label, 이 project의 복사 규칙·setup 요약. 진행과 실패를 보인다. 들어오는 곳: Explorer, 탭 + 메뉴·왼쪽 사이드바 +의 `+ New worktree…`, Ctrl+K `New worktree…`(정한 것 10).
5. **세션·터미널 열 때 worktree 고르기와 꼬리표** (spec 5.3, 정한 것 6)
   - ready worktree가 0개면 지금과 똑같다. 1개 이상이면 탭 + 메뉴와 왼쪽 사이드바 + 팝오버에 대상 고르기 줄(Main 기본, worktree 목록, `+ New worktree…`). 고른 대상의 `worktree_id`로 연다.
   - 탭 헤더 `BranchTag`(MachineTag 옆), 왼쪽 사이드바 세션 줄과 coding agent 줄 `BranchTag`. 원래 폴더 탭은 그 project에 worktree가 있을 때만 보인다. 폭 줄이기와 툴팁. 탭 우클릭 `Show in Source Control`.
6. **Project settings › Worktrees**: 1단계의 project별 설정(`copy_patterns`, setup·teardown Project Command 고르기, `run_setup`)을 사람이 쓰는 칸, `.worktreeinclude` 감지 결과를 보이고 골라 가져오기. 관리 루트 설정(`projects.worktrees_folder`)은 Settings 화면의 일반 설정 칸에 선다.
7. **승인 카드**: GateCall `worktree_remove` 카드가 대상·브랜치·preflight 결과를 읽기 쉽게 보이는지 확인하고 모자라면 고친다.
8. **앱 SDK 알림** (spec 5.4.2): 1단계에 `("lophn", "worktree.changed")` 이벤트가 없거나 spec 5.4.2의 페이로드·디바운스·구독 선언과 다르면 맞춘다. 앱의 쓰기 route 호출은 `forbidden`. 판 올림이 있으면 `migrate-sdk` 메모.

#### 2단계에서 만들지 않는 것

- hunk·줄 단위 stage/discard, `--amend`, `--no-verify` 단추, force push 메뉴.
- 큰 Git Graph 탭, cherry-pick·revert GUI.
- 3-way 충돌 뷰어(Accept Ours/Theirs).
- PR 만들기·리뷰·merge, forge 연동.
- AI 브랜치 이름 바꾸기, 자동 정리.
- 폰 화면(route는 기기 목록에 있다).

#### 바뀌는 architecture 문서

- `workspace-layout.md`: 오른쪽 사이드바 Source Control 패널, Explorer worktree 가지와 git 상태, `git_diff` 탭 종류, + 메뉴·사이드바 + 의 worktree 고르기, `BranchTag`.
- `keybindings.md`: Mod+Shift+G, 커밋, F7.
- `worktree.md`(1단계가 만든 것): 화면 절, AI 커밋 메시지, 더한 route.
- `project-identity.md`: 소스 컨트롤 쓰기 목록이 늘어난 만큼.
- `settings.md`(diff 표시 모드 같은 새 설정이 있으면), `project-docs/flows/`, change-log 항목.

#### 2단계 끝나면

- worktree가 있는 project에서 Explorer에 그 폴더 아래 worktree 가지가 브랜치·바뀐 파일 수와 함께 서고, 펼쳐 파일을 열 수 있고, 파일 줄에 M/A/U/D 표시가 선다.
- Explorer나 + 메뉴에서 worktree를 만들고 그 worktree에서 agent·터미널을 열면 탭과 세션 줄에 브랜치 꼬리표가 선다. worktree가 없는 project의 + 메뉴는 지금과 같다.
- Source Control 패널에서 파일을 stage·unstage·버리고, diff 탭을 inline/side-by-side로 보고, AI 메시지를 채워 고친 뒤 커밋하고, 히스토리에서 커밋의 파일 diff를 열고, 브랜치를 만들고 바꾸고, push·pull한다.
- pre-commit hook이 실패하면 커밋이 안 되고 stderr가 펼쳐 보인다. 충돌 마커가 남은 파일은 커밋이 거절된다. pull이 갈라지면 merge하지 않고 안내한다.
- merge 충돌 때 배너와 Conflicts 묶음이 서고 Mark as Resolved·Abort·Ask agent가 된다.
- Explorer의 Remove…가 preflight 결과를 보이고 지운다. adopted는 목록에서만 빠진다.
- 다른 컴퓨터 project에서 쓰기 허락이 없으면 패널과 Explorer가 읽기 전용이다.
- `npm run check`가 통과한다.

## 조사 문서

- `../harness-lab/_report/git-worktree/README.md`: 범위, 판정 표, 업계 표준과 갈리는 축, 실전 함정
- `../harness-lab/_report/git-worktree/lophn.md`: 지금 lophn과의 대조, "lophn에 들일 때"
- `../harness-lab/_report/git-worktree/spec.md`: clean-room 명세(구현자가 읽는 유일한 조사 문서)
