# worktree

한 git project의 저장소 아래에 여러 git worktree를 만들어 agent session, harness GUI 탭, 터미널, project command, workflow step, team worker가 서로 파일 충돌 없이 병렬로 일하게 하는 메커니즘이다. worktree 정본과 설정은 core의 ledger가 소유하며, 사람의 저장소 안에 lophn 설정 파일을 쓰지 않는다.

## 문제

- 하나의 checkout에서 여러 agent session이나 workflow step을 병렬로 돌리면 같은 working tree를 덮어써 변경이 섞이고, 빌드·테스트가 서로 간섭한다.
- 사용자가 직접 `git worktree add`로 외부 경로를 만들면 lophn이 그 경로를 project 등록 폴더 밖으로 봐서 file tool·터미널·project command·workflow가 자연스럽게 이어지지 않는다.
- worktree 삭제·정리는 잘못 구현하면 사람의 main checkout이나 외부에서 만든 worktree, 커밋되지 않은 작업, 병합되지 않은 branch를 잃을 수 있어 강한 안전 경계가 필요하다.

## 목표와 비목표

- 목표:
  - project 등록 폴더(main checkout)를 기본으로 유지하면서, 필요한 만큼 managed worktree를 만들고 기존 외부 worktree를 안전하게 adopt한다.
  - worktree마다 격리된 작업 경로·환경 변수·file scope·터미널·project command 실행을 제공한다.
  - 3중 소유권 검증(`provenance`, managed root 경계, `git_common_dir`/`.git` 포인터), hard/soft remove 가드, 기동 시 crash 복구, per-repo 직렬화로 사용자 데이터 손실을 막는다.
  - 사람 전용 source control 기본 동작(`stage`, `unstage`, `commit`, `switch`, `pull`, `push`)을 core route로 제공한다.
  - workflow step(`worktree: "new" | "inherit"`)과 `team spawn --worktree`가 worktree를 1급 개념으로 다룬다.
- 비목표:
  - 저장소 안에 `.lophn*` 설정 파일 쓰기나 commit 유도.
  - 다른 컴퓨터로 worktree 레코드나 작업 디렉터리를 자동 동기화하기(worktree는 기계별 로컬 개념이다).
  - 강제 push(`--force`), interactive rebase/merge 충돌 편집기, 자동 squash/cherry-pick, PR/issue 관리.
  - workflow 종료·중단 또는 session archive 시 worktree 자동 삭제(삭제는 명시적 요청과 승인·가드 통과 때만 한다).
  - `desk_key`를 worktree 레코드에 묶기(desk 배치는 shell layout의 일이다).

## 모델

### 데이터와 상태 기계

```
ledger (기계별, 컴퓨터 사이 동기화 안 함)
  project_worktrees         : id(wkt_…), project(prj_…), provenance(managed|adopted),
                              path, repo_root, git_common_dir, base_branch,
                              created_branch, label, state, created_at, updated_at, removed_at
  project_worktree_settings : project(prj_…), copy_patterns_json, setup_command_id,
                              teardown_command_id, auto_branch_prefix, default_base_branch
```

```
creating ──(git worktree add + env prep 성공)──▶ ready ◀──(reconcile 재발견)── missing
    │                                              │
    │ (실패 / 기동 시 crash 복구)                    │ (remove 요청 + 가드 통과)
    ▼                                              ▼
 removed ◀────────(git worktree remove / 정리)── removing
```

- **ID와 provenance**: worktree ID 접두사는 `wkt`다. lophn이 managed root 아래에 만든 것은 `provenance: "managed"`, 이미 디스크에 있던 외부 worktree를 등록한 것은 `provenance: "adopted"`다. main checkout은 `project_worktrees` 행이 아니라 project의 첫 폴더(`worktree_id: null`)로 표현한다.
- **경로 배치**: 전역 설정 `projects.worktrees_folder`(`locked: true`, 기본 `<data root>/worktrees`) 아래 `<repo_slug>-<sha8(canonical_repo_root)>/<branch_prefix≤23B>-<id8>`로 배치한다.
  - `projects.worktrees_folder`는 홈 디렉터리 자체·상위 경로·파일시스템 루트·임의의 등록 project 저장소 내부를 금지한다.
  - Windows에서는 전체 경로 220자 예산을 지키기 위해 `<repo_slug>`과 `<branch_prefix>`를 동적으로 줄이고 예약 이름(`CON`, `PRN`, `AUX`, `NUL`, `COM1`~`9`, `LPT1`~`9`)을 피한다.
  - 브랜치 이름은 `git check-ref-format` 규칙과 제어문자·`..`·`@{`·leading `-` 검사를 통과해야 하며, 생략 시 `wt/<adj>-<noun>-<4hex>`(seed가 있으면 `wt/<seed>-<4hex>`)를 자동 생성한다.
- **환경 준비(env prep)**:
  - `copy_patterns`에 일치하고 `git check-ignore`로 확인된 무시 파일만 `repo_root`에서 새 worktree로 복사한다. 대상에 이미 파일이 있으면 덮어쓰지 않는다. 가능한 파일시스템에서는 CoW(`COPYFILE_FICLONE`) + 임시 파일 원자적 rename을 쓰고, 총 2 GiB / 50,000개 엔트리 상한을 둔다.
  - 저장소 루트의 `.worktreeinclude`는 읽기 전용으로만 감지해 안내한다(lophn이 쓰지 않는다).
  - `setup_command_id`가 설정되어 있으면 worktree 생성 직후 해당 Project Command를 새 `worktree_id`로 1회 실행한다(실패해도 worktree 생성 자체는 rollback하지 않고 `setup_warning`으로 알린다).

### git 실행, 직렬화, 감시

- **비대화형 하드닝 `runGit`**: 모든 git 호출은 `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, `GIT_ASKPASS=""`, `GIT_OPTIONAL_LOCKS=0`, Windows `core.longpaths=true`로 실행하고 타임아웃·출력 상한을 둔다. 인증 실패 시 자격 창을 띄우지 않고 `unauthorized` 오류와 사람이 터미널에서 실행할 1줄 `git -C <path> ...` 명령을 돌려준다.
- **per-repo mutex와 lock retry**: 같은 `git_common_dir`을 공유하는 mutating git 작업은 저장소 단위 직렬 mutex를 거친다. `.git/index.lock` 등 일시적 락 충돌은 `[50, 150, 400]`ms 백오프로 재시도한다.
- **좁은 watcher와 `unmounted` 방어**: 전체 working tree를 재귀 감시하지 않고 `.git/HEAD`, `.git/packed-refs`, `.git/worktrees/<admin>/HEAD`만 좁게 감시해 `WorktreeStatusChanged`를 발행한다. 외장 디스크 분리나 네트워크 마운트 해제처럼 `repo_root` 또는 관리 루트가 보이지 않으면 `presence: "unmounted"`로 표시하고 절대 삭제·정리하지 않는다. Windows/WSL 교차 OS 경로의 worktree가 감지되면 `git worktree prune`을 차단한다.

### 3중 소유권 검증과 삭제 가드

- **`adopted` 불변 원칙**: `provenance === "adopted"`인 worktree는 삭제 요청 시 ledger 행만 제거(`untrack_only: true`)하며 디스크 디렉터리와 git branch를 절대 지우지 않는다.
- **`managed` 3중 검증**: 디스크를 지우기 전 반드시 세 조건을 모두 만족해야 한다: (1) ledger의 `provenance === "managed"`, (2) realpath가 managed root 엄격 하위이며 symlink나 `repo_root`가 아님, (3) 대상 `.git` 포인터가 해당 저장소의 `git_common_dir`을 가리킴. 하나라도 어긋나면 `forbidden`(`unsafe_path`)으로 즉시 차단한다.
- **Hard block / Soft block**:
  - Hard block(우회 불가): `unsafe_path`, `nested_worktree`(하위에 다른 worktree 중첩), `worktree_locked`(git worktree lock 설정됨).
  - Soft block(명시적 플래그로만 통과): `dirty_worktree`(`force: true`), `active_sessions`(`stop_sessions: true`로 연결된 session/터미널/command 정리 후 진행), teardown command 실패(`allow_failed_teardown: true`, teardown은 삭제 직전 최대 60초 동기 실행).
- **브랜치 보존과 CAS 삭제**: 기본 브랜치(`default_base_branch`, `main`/`master`)와 다른 worktree가 checkout한 브랜치, 미병합 브랜치(`git branch -d` 실패)는 기본적으로 보존한다(`preserved_branch`). 명시적 강제 브랜치 삭제가 요청된 경우에도 삭제 직전 읽은 OID와 비교하는 CAS `git update-ref -d <ref> <expected_oid>`만 사용해 그 사이 새 커밋이 쌓인 브랜치를 지우지 않는다.

### 기동 시 복구(Crash Recovery)

core 기동 시 `creating` 또는 `removing` 상태로 남은 행을 정산한다:
- `creating`: git worktree가 정상 등록되고 경로가 유효하면 `ready`로 승격한다. 그렇지 않으면 등록된 반쪽 worktree를 정리하고, 아직 `.git` 포인터도 쓰이지 않은 채 `managed` 루트 엄격 하위에 생성된 빈/부분 디렉터리를 안전하게 치운 뒤 `removed`로 닫는다.
- `removing`: 디스크가 이미 사라졌거나 정리 가능하면 마저 정리해 `removed`로 닫고, 잠겨 있거나 제거할 수 없으면 `ready`로 복원한다.

### 격리(Session, Harness, Terminal, Project Command)

- **session 바인딩**: `sessions.worktree_id`는 session 생성 시 결정되며 바뀌지 않는다(ledger 불변). `removing`·`removed`·`missing` 상태의 worktree에는 새 session이나 터미널을 열 수 없다(`conflict`).
- **lophn agent**: worktree가 묶인 project session은 file tool 읽기/쓰기 범위에서 원래 `repo_root`를 `worktree.path`로 치환하고, shell cwd와 환경 변수(`PROJECT_ROOT`, `WORKTREE_ID`, `WORKTREE_PATH`, `WORKTREE_BRANCH`, `WORKTREE_BASE_BRANCH`)를 주입한다.
- **harness agent & GUI 탭**: background 실행과 GUI 탭 팀원 모두 묶인 `worktree_id`의 경로를 cwd로 쓰고 같은 worktree 환경 변수를 받는다.
- **터미널 & TUI**: `terminals/open`이 선택 `worktree_id`를 받으며 `TerminalRuntime.worktree_id`에 실린다. `folderOfCwd`는 project 등록 폴더뿐 아니라 해당 project의 `ready` worktree 경로도 허용한다.
- **Project Command**: `project_commands/run`과 `restart`가 선택 `worktree_id`를 받아 해당 worktree 경로에서 전용 PTY로 실행하며, worktree setup/teardown 훅도 같은 실행 길을 쓴다.

### Source Control (core route)

- `source_control/status`, `branches`, `stage`, `unstage`, `commit`, `switch`, `pull`, `push`를 제공하며 대상은 `{ project, worktree_id? }`(생략 시 main checkout)이다.
- **사람 전용 쓰기**: 모든 변경 route(`stage`, `unstage`, `commit`, `switch`, `pull`, `push`)는 user 자격 전용이며 agent 호출은 `forbidden`이다.
- **안전 가드**:
  - `commit`: `MERGE_HEAD`/`REBASE_HEAD`/`CHERRY_PICK_HEAD`/`REVERT_HEAD` 존재, unmerged 인덱스 엔트리, 또는 staged diff 내 충돌 마커(`<<<<<<<`/`=======`/`>>>>>>>`)가 있으면 `conflict`로 거절한다.
  - `switch`: 대상 worktree(또는 main checkout)에 실행 중인 agent turn이 있으면 `conflict`로 거절한다.
  - `pull`: 항상 `--ff-only`로만 실행한다.
  - `push`: force push 플래그를 노출하지 않으며 upstream 미설정 시 `-u origin <branch>`를 사용한다.

### 권한, Workflow, 팀, 앱 SDK, 원격

- **권한과 승인**:
  - agent는 자기 project에 한해 `worktrees/list`, `get`, `status`, `create`, `rename`을 호출할 수 있다.
  - `worktrees/adopt`, `worktrees/settings_set`, 그리고 `source_control/*` 쓰기는 user 전용이다.
  - agent의 `worktrees/remove`는 GateCall `worktree_remove`를 거친다(`approval.md`): `read_only`에서는 `mode` 거부, `attended`에서는 `once | reject`(`outside_rewind: true`), `team_child`에서는 부모에게 `once | reject`, `unattended`에서는 `deny`(`no_person`).
- **Workflow & Team Spawn**:
  - YAML `steps.<name>.worktree`, `participants.<key>.worktree`, `@lophn/flow` `agent({ worktree })`는 `"new" | "inherit"`을 지원한다. `"new"`는 instance 제목 slug를 seed로 새 managed worktree를 만들고(실패 시 step을 `not_handed`/`worktree_failed`로 `blocked`), `"inherit"`은 직전 step session의 `worktree_id`를 이어받는다. workflow 종료·중단은 worktree를 자동 삭제하지 않는다.
  - `team spawn --worktree new | inherit | <wkt_id>`(기본 `"inherit"`): 같은 project 내에서 부모의 `worktree_id`를 기본 상속하거나 새 worktree 또는 지정 worktree에 자식을 연다.
- **App View SDK**: 앱 화면에 읽기 전용 `lophnApp.projects.worktrees(project)`와 `onWorktreesChanged` 이벤트, `@lophn/app-ui`의 `useWorktrees` hook을 제공한다. 보안 경계상 앱 SDK 응답에는 로컬 파일시스템 절대 경로를 싣지 않는다.
- **원격(Remote)**: `worktrees/*`와 `source_control/*`는 기기 route allowlist에 포함된다. 읽기는 명단의 기기에 열리고, 변경 route는 `terminal_input` 허락("Allow controlling this computer")이 켜진 기기에서만 허용된다. agent의 `--on` 원격 호출은 차단된다.

## 지키는 것

1. **저장소에 lophn 파일을 쓰지 않는다.** worktree 메타데이터, 설정, copy 패턴은 모두 ledger에만 저장한다. `.worktreeinclude`는 읽기만 한다.
2. **adopted worktree는 절대 디스크·브랜치를 삭제하지 않는다.** `remove`는 ledger 추적 해제(`untrack_only`)로만 끝낸다.
3. **managed worktree 삭제는 3중 소유권 검증과 hard/soft 가드를 모두 통과해야 한다.** managed root 밖 경로나 symlink, `repo_root` 자체는 어떤 플래그로도 지우지 못한다.
4. **브랜치 강제 삭제는 CAS OID 대조를 거친다.** 기본 브랜치와 미병합 브랜치는 기본 보존한다.
5. **unmounted 경로와 cross-OS worktree는 파괴적 정리를 하지 않는다.** 마운트 해제를 삭제로 오판하지 않는다.
6. **git 호출은 항상 비대화형이며 저장소 단위로 직렬화된다.** 자격 팝업을 띄우지 않고, 인증 실패 시 사람이 실행할 1줄 명령을 돌려준다.
7. **session의 `worktree_id`는 불변이다.** `removing`·`removed`·`missing` 상태의 worktree에는 새 session·터미널을 열지 않는다.
8. **agent의 worktree 삭제는 항상 승인을 거친다.** 무인(`unattended`) 실행에서는 삭제가 차단된다.
9. **source control 쓰기는 사람 전용이며 충돌 커밋·턴 중 브랜치 전환·비-ff pull·force push를 허용하지 않는다.**
10. **worktree는 workflow 종료나 session archive로 자동 삭제되지 않는다.**

## 경계와 계약

- **ID 접두사**: `wkt`. 예약 앱 slug: `worktree`.
- **route**:
  - `worktrees/list`, `worktrees/get`, `worktrees/remove_preflight`, `worktrees/create`, `worktrees/adopt`, `worktrees/rename`, `worktrees/remove`, `worktrees/settings_get`, `worktrees/settings_set`, `worktrees/detect_include`.
  - `source_control/status`, `source_control/diff`, `source_control/log`, `source_control/show`, `source_control/branches`, `source_control/stage`, `source_control/unstage`, `source_control/discard`, `source_control/commit`, `source_control/branch_create`, `source_control/switch`, `source_control/pull`, `source_control/push`.
- **event(남지 않음, `REMOTE_ALLOWED_EVENTS` 포함)**: `WorktreesChanged { project }`, `WorktreeStatusChanged { project, worktree_id, status }`.
- **CLI**: `lophn worktree list|get|status|create|adopt|rename|remove`, `lophn team spawn --worktree new|inherit|<wkt_id>`.
- **SDK**: `@lophn/flow` `2.2.0`(`agent({ worktree })`), `@lophn/app-ui` `2.27.0`(`useWorktrees`), `@lophn/agent` `1.21.0`(`worktree_remove` GateCall).
- **저장(ledger)**: schema step `projects.worktrees`(`project_worktrees`, `project_worktree_settings`, `sessions.worktree_id`).
- **설정**: `projects.worktrees_folder`(`locked: true`, 기본 `<data root>/worktrees`).

## 결정

- **기존 "worktree를 관리하지 않는다" 결정을 뒤집고 core 1급 기능으로 들인다.** 이유: 병렬 agent·workflow·harness 실행이 일상화되면서 같은 checkout 충돌과 수동 worktree 관리 비용이 제품 핵심 병목이 되었다. (`git-worktree.md` 로드맵, 2026-11-28)
- **`WorktreeRecord`에 `desk_key`를 두지 않는다.** 이유: desk·탭 배치는 shell layout의 관심사이고 core ledger에 UI 배치 키를 섞지 않는다. (`git-worktree.md` 로드맵)
- **worktree 메타데이터는 컴퓨터 사이 동기화하지 않는다.** 이유: worktree 경로·브랜치·로컬 작업 상태는 기계마다 고유하다.
- **`team spawn --worktree new`는 writer Worker tx 바깥에서 먼저 worktree를 생성하고, 뒤따르는 spawn command가 실패하면 즉시 롤백한다.** 이유: git subprocess와 파일 복사를 SQLite writer tx 안에서 실행할 수 없으며, 실패 시 고아 worktree가 남지 않아야 한다.
- **1단계(화면 밖)와 2단계(renderer/폰 화면 UI)를 분리해 구현한다.** 이유: core·protocol·CLI·SDK 계약과 안전 경계를 먼저 고정하고, 화면 조사가 끝난 뒤 같은 branch에 UI를 얹는다.
