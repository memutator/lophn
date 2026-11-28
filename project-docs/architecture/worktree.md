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
  - 사람 전용 source control 동작(`stage`, `unstage`, `discard`, `commit`, 브랜치 만들기·바꾸기·이름 바꾸기·지우기, `fetch`, `pull`, `push`, 충돌 `abort`·`mark_resolved`)과 AI 커밋 메시지를 core route로 제공하고, 오른쪽 sidebar Source Control 패널과 Explorer worktree 가지가 그 위에 선다.
  - workflow step(`worktree: "new" | "inherit"`)과 `team spawn --worktree`가 worktree를 1급 개념으로 다룬다.
- 비목표:
  - 저장소 안에 `.lophn*` 설정 파일 쓰기나 commit 유도.
  - 다른 컴퓨터로 worktree 레코드나 작업 디렉터리를 자동 동기화하기(worktree는 기계별 로컬 개념이다).
  - 강제 push(`--force`), `--amend`, `--no-verify`, hunk·줄 단위 stage, 3-way 충돌 뷰어, interactive rebase, 자동 squash/cherry-pick, PR/issue 관리, 큰 브랜치 그래프 화면.
  - workflow 종료·중단 또는 session archive 시 worktree 자동 삭제(삭제는 명시적 요청과 승인·가드 통과 때만 한다).
  - `desk_key`를 worktree 레코드에 묶기(desk 배치는 shell layout의 일이다).

## 모델

### 데이터와 상태 기계

```
ledger (기계별, 컴퓨터 사이 동기화 안 함)
  project_worktrees         : id(wkt_…), project_id(prj_…), repo_root, git_common_dir, path,
                              git_admin_name, label, branch, base_ref, base_commit,
                              provenance(managed|adopted), status(creating|ready|missing|removing|removed),
                              idempotency_key, created_branch, managed_root, created_at, updated_at
  project_worktree_settings : project_id(prj_…), copy_patterns_json, setup_command,
                              teardown_command, run_setup
```

```
creating ──(git worktree add + env prep 성공)──▶ ready ◀──(reconcile 재발견)── missing
    │                                              │
    │ (실패 / 기동 시 crash 복구 → 행 삭제)          │ (remove 요청 + 가드 통과)
    ▼                                              ▼
 (삭제)                     removed ◀──(git worktree remove / 정리)── removing
```

- **ID와 provenance**: worktree ID 접두사는 `wkt`다. lophn이 managed root 아래에 만든 것은 `provenance: "managed"`, 이미 디스크에 있던 외부 worktree를 등록한 것은 `provenance: "adopted"`다. main checkout은 `project_worktrees` 행이 아니라 project의 등록 폴더(`worktree_id: null`)로 표현한다.
- **경로 배치**: 전역 설정 `projects.worktrees_folder`(`locked: true`, 기본 `<data root>/worktrees`) 아래 `<repo_slug>-<sha256(git_common_dir)[:8]>/<branch_prefix≤23B>-<id8>`로 배치한다.
  - `projects.worktrees_folder`는 홈 디렉터리 자체·상위 경로·파일시스템 루트·모든 활성 project 등록 폴더의 내부/상위·임의의 git working tree 내부를 금지한다.
  - 생성 시점의 검증된 관리 루트를 행의 `managed_root`에 영속화해, 이후 `projects.worktrees_folder`를 바꾸고 core를 재기동해도 기존 `managed` worktree의 소유권 검증과 정리가 이어진다.
  - Windows에서는 전체 경로 220자 예산을 지키기 위해 `<branch_prefix>`를 동적으로 줄이고(그래도 넘으면 거부) 예약 이름(`CON`, `PRN`, `AUX`, `NUL`, `COM1`~`9`, `LPT1`~`9`)을 피한다.
  - 브랜치 이름은 `git check-ref-format` 규칙과 제어문자·`..`·`@{`·leading `-` 검사를 통과해야 하며, 생략 시 `wt/<adj>-<noun>-<4hex>`(seed가 있으면 `wt/<seed>-<4hex>`)를 자동 생성한다.
- **환경 준비(env prep)**:
  - `copy_patterns`에 일치하고 `git check-ignore`로 확인된 무시 파일만 `repo_root`에서 새 worktree로 복사한다. 대상에 이미 파일이 있으면 덮어쓰지 않는다. 가능한 파일시스템에서는 CoW(`COPYFILE_FICLONE`) + 임시 파일 원자적 rename을 쓰고, 총 2 GiB / 50,000개 엔트리 상한을 둔다.
  - 저장소 루트의 `.worktreeinclude`는 읽기 전용으로만 감지해 안내한다(lophn이 쓰지 않는다).
  - `setup_command`가 설정되어 있고 `run_setup`이 켜져 있으면 worktree 생성 직후 해당 Project Command를 새 `worktree_id`로 1회 실행한다(실패해도 worktree 생성 자체는 rollback하지 않고 `warnings`와 `setup` 결과로 알린다).

### git 실행, 직렬화, 감시

- **비대화형 하드닝 `runGit`**: 모든 git 호출은 셸 없는 고정 argv로 `LANGUAGE=C`, `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, `GIT_ASKPASS=""`, `SSH_ASKPASS=""`, `SSH_ASKPASS_REQUIRE=never`, `GIT_PAGER=cat`, `NO_COLOR=1`, `GIT_OPTIONAL_LOCKS=0`, `-c core.fsmonitor=false -c diff.external=`, Windows `core.longpaths=true`로 실행하고, 사람 shell에서 물려받은 `GIT_DIR`·`GIT_WORK_TREE`·`GIT_INDEX_FILE` 등을 지운다. `LC_ALL=C`가 아니라 `LANGUAGE=C`인 것은 hook이 물려받는 사람의 `LC_CTYPE`(UTF-8)을 지키면서 git 진단 글만 영어로 고정하려는 것이다. POSIX는 process group으로 띄워 시간이 넘으면 hook·ssh 손자까지 끝낸다. 타임아웃은 기본 30초, commit 5분, push·pull·fetch 2분이다. push·pull·fetch는 사람이 ssh 명령을 정하지 않았으면 `ssh -o BatchMode=yes`로 passphrase 물음에서 멈추지 않는다. 경로 인자는 `--literal-pathspecs`와 `--` 뒤로 넘긴다. `stderr`의 HTTP(S) URL 자격증명(`https://user:token@...`)은 반환 전에 `[REDACTED]@`로 마스킹한다(SSH `git@host`는 유지). 인증 실패 시 자격 창을 띄우지 않고 `unauthorized` 오류와 사람이 터미널에서 실행할 1줄 `git -C <path> ...` 명령을 돌려준다.
- **per-repo mutex와 lock retry**: 같은 `git_common_dir`을 공유하는 mutating git 작업은 저장소 단위 직렬 mutex를 거친다. `.git/index.lock` 등 일시적 락 충돌은 `[50, 150, 400]`ms 백오프로 재시도한다.
- **좁은 watcher와 `unmounted` 방어**: 전체 working tree를 재귀 감시하지 않고 `.git/HEAD`, `.git/packed-refs`, `.git/worktrees/<admin>/HEAD`만 좁게 감시해 `WorktreeStatusChanged`를 발행한다. 외장 디스크 분리나 네트워크 마운트 해제처럼 `repo_root`가 보이지 않으면 `presence: "unmounted"`로 표시하고 절대 삭제·정리하지 않는다. Windows/WSL 교차 OS 경로의 worktree가 감지되면 타 OS 항목에 임시 `locked` 파일을 배타 생성(`wx`)해 보호한 뒤 `git worktree prune`을 실행하고 `locked` 파일을 치운다.

### 3중 소유권 검증과 삭제 가드

- **`adopted` 불변 원칙**: `provenance === "adopted"`인 worktree는 삭제 요청 시 ledger 행만 제거(`untrack_only: true`)하며 디스크 디렉터리와 git branch를 절대 지우지 않는다.
- **`managed` 3중 검증**: 디스크를 지우기 전 반드시 세 조건을 모두 만족해야 한다: (1) ledger의 `provenance === "managed"`, (2) realpath가 현재 또는 생성 시점의 검증된 관리 루트(`managed_root`) 엄격 하위이며 symlink나 `repo_root`가 아님, (3) 대상 `.git` 포인터가 해당 저장소의 `git_common_dir`을 가리킴. 하나라도 어긋나면 `forbidden`(`unsafe_path`)으로 즉시 차단한다.
- **Hard block / Soft block**:
  - Hard block(우회 불가): `unsafe_path`, `nested_worktree`(하위에 다른 worktree 중첩), `worktree_locked`(git worktree lock 설정됨).
  - Soft block(명시적 플래그로만 통과): `dirty_worktree`(`force: true`), `active_sessions`(`stop_sessions: true`로 연결된 session/터미널/command 정리 후 진행), teardown command 실패(`allow_failed_teardown: true`, teardown은 삭제 직전 최대 60초 동기 실행).
- **브랜치 보존과 CAS 삭제**: 기본은 `delete_branch: false`로 브랜치를 보존한다. `delete_branch: true`일 때도 `created_branch === false`(기존 브랜치)는 `force_delete_branch: true` 없이는 보존(`preserved_branch.reason: "existing_branch"`)하고, 새로 만든 브랜치는 `git branch -d`로 병합 확인 뒤에만 삭제하며 미병합이면 보존(`reason: "unmerged"`)한다. 명시적 `force_delete_branch: true`가 요청된 경우에도 삭제 직전 읽은 OID와 비교하는 CAS `git update-ref -d <ref> <expected_oid>`만 사용해 그 사이 새 커밋이 쌓인 브랜치를 지우지 않는다(불일치 시 `reason: "cas_mismatch"`로 보존).

### 기동 시 복구(Crash Recovery)

core 기동 시 `creating` 또는 `removing` 상태로 남은 행을 정산한다:
- `creating`: git worktree가 정상 등록되고 경로가 유효하면 `ready`로 승격한다. 그렇지 않으면 등록된 반쪽 worktree와 아직 `.git` 포인터가 쓰이기 전 관리 루트 엄격 하위의 부분 디렉터리·미사용 임시 브랜치를 안전하게 치운 뒤 미완성 `creating` 행을 삭제한다(`deleteRow`).
- `removing`: 디스크가 이미 사라졌거나 정리 가능하면 마저 정리해 `removed`로 닫고, 잠겨 있거나 제거할 수 없으면 `ready`(경로가 없으면 `missing`)로 복원한다.

### 격리(Session, Harness, Terminal, Project Command)

- **session 바인딩**: `sessions.worktree_id`는 session 생성 시 결정되며 바뀌지 않는다(ledger 불변). `removing`·`removed`·`missing` 상태의 worktree에는 새 session이나 터미널을 열 수 없다(`conflict`).
- **lophn agent**: worktree가 묶인 project session은 file tool 읽기/쓰기 범위에서 원래 `repo_root`를 `worktree.path`로 치환하고, shell cwd와 환경 변수(`PROJECT_ROOT`, `WORKTREE_PATH`, `WORKTREE_ID`, `WORKTREE_BRANCH`)를 주입한다.
- **harness agent & GUI 탭**: background 실행과 GUI 탭 팀원 모두 묶인 `worktree_id`의 경로를 cwd로 쓰고 같은 worktree 환경 변수를 받는다.
- **터미널 & TUI**: `terminals/open`이 선택 `worktree_id`를 받으며 `TerminalRuntime.worktree_id`에 실린다. `folderOfCwd`는 project 등록 폴더뿐 아니라 해당 project의 `ready` worktree 경로도 허용한다.
- **Project Command**: `project_commands/run`과 `restart`가 선택 `worktree_id`를 받아 해당 worktree 경로에서 전용 PTY로 실행하며, 실행 슬롯과 `terminal_ref` 재사용을 `(project, command_id, worktree_id)` 단위로 분리해 병렬 worktree setup·명령 실행이 서로 충돌하지 않게 한다. worktree setup/teardown 훅도 같은 실행 길을 쓴다.

### Source Control (core route)

- 대상은 `{ project, worktree?, folder? }`(생략 시 project의 첫 git 등록 폴더)이다.
  - 읽기: `status`(바뀐 파일과 파일별 줄 증감, 진행 중 연산, unborn, remote 유무, 커밋 hook 이름, 10,000개 상한, AI 메시지 가능 여부), `diff`(working·staged·커밋 하나 `parent..commit`, 공백 무시, untracked는 빈 tree 대비), `log`, `show`, `branches`, `ignored`(`git check-ignore`), `file_at`(그림 diff의 앞뒤 blob, `HEAD`·`index`·`worktree`·sha, 5 MiB 상한).
  - 쓰기(사람 자격만): `stage`, `unstage`, `discard`, `commit`, `branch_create`, `switch`, `branch_rename`, `branch_delete`, `fetch`, `pull`, `push`, `abort`, `mark_resolved`, `suggest_message`, `suggest_cancel`.
- **권한 경계**: 쓰기는 user 자격 전용이며 agent 호출은 `forbidden`이다(agent는 터미널의 git을 쓴다). 다른 컴퓨터의 기기는 받는 컴퓨터의 터미널 입력 허락이 있어야 쓴다. 읽기는 agent가 부를 때 자기 project 범위를 검사한다.
- **커밋 전 검사**(spec 5.5):
  - 미해결 unmerged 항목, staged diff에 같은 파일의 `<<<<<<<`와 `>>>>>>>`가 함께 있음(경로·줄을 돌려준다, 단독 `=======`은 보지 않는다), `.gitmodules`에 없는 새 gitlink(미추적 중첩 저장소를 `git add`한 것)를 `conflict`로 거절한다.
  - staged가 0이면 거절한다. 다만 merge·cherry-pick·revert 진행 중이고 미해결이 0이면 커밋으로 마무리한다(화면의 Complete Merge). rebase 진행 중에는 커밋으로 잇지 않는다.
  - hook과 서명은 저장소 설정대로 돈다(`--no-verify`·`--no-gpg-sign`을 붙이지 않는다). `--amend`는 없다.
- **실패 분류**: 실패는 `details.reason`(`auth_failed`, `host_key_unverified`, `non_fast_forward`, `push_rejected`, `remote_unreachable`, `no_remote`, `no_upstream`, `diverged`, `merge_conflict`, `dirty_worktree`, `active_agent`, `hook_failed`, `gpg_failed`, `timeout`, `git_error` 등)과 자격증명을 가린 출력 `details.stderr`(stdout을 이어 붙인 끝 16 KiB, hook은 stdout에 쓰는 일이 많다)를 싣는다. 인증 실패는 사람이 터미널에서 칠 명령 한 줄 `details.command`를 준다.
- **안전 가드**:
  - `switch`·`branch_create(checkout: true)`·전체 `discard`: 그 체크아웃에 도는 agent turn이 있으면 `conflict`(`active_agent`). switch는 자동 stash 하지 않는다.
  - `pull`은 늘 `--ff-only`다. 갈라졌으면 merge·rebase를 하지 않고 `diverged`로 멈춘다. `push`는 force를 노출하지 않고 처음 올리는 브랜치는 `set_upstream`으로 `-u`를 붙인다. `fetch`는 `--no-write-fetch-head --no-auto-maintenance --prune`이다.
  - `branch_delete`는 `git branch -d`뿐이다. 병합되지 않았으면 남기고 `unmerged`로 알린다. 어느 worktree가 쓰는 브랜치는 지우지 않는다.
  - `mark_resolved`는 마커가 남은 파일을 거절한다(`conflict_markers`). `keep: "deletion"`은 삭제 충돌에서 지운 쪽을 고른다.
- **AI 커밋 메시지**(`suggest_message`): core는 staged diff를 파일별로 공평하게 나눠 160 KB 안에 자르고 최근 커밋 제목 10개를 붙여 메모리 queue에 둔다. core에는 외부 fetch가 없어 agent-runtime의 pump가 요청을 가져가 lophn agent의 전역 기본 model 한 번 호출로 글을 짓고 돌려준다(workflow 제목과 같은 길). 사람의 호출은 답·취소(`suggest_cancel`)·60초 시간 넘김까지 열려 있다. 글만 돌려주고 커밋하지 않는다. 기본 model이 없으면 `status.suggest`가 이유를 싣고 화면이 단추를 끈다.

### 화면

- **Source Control 패널**: 오른쪽 sidebar Explorer 다음 panel이다. 대상은 원래 폴더와 그 밑 worktree이고 기본은 활성 탭을 따라간다(탭의 worktree, 아니면 탭 경로가 든 폴더). 사람이 고르면 고정되고 고정한 worktree가 지워지면 그 원래 폴더로 돌아간다. 바뀐 파일(Conflicts·Staged Changes·Changes), 커밋 입력과 AI 메시지, Commits 섹션, 브랜치 바, ↑↓와 Fetch·Pull·Push, 충돌 배너가 한 패널에 선다. 체크아웃별 커밋 초안·보기 방식·접힘은 창이 들고 있어 패널을 닫아도 남는다.
- **`git_diff` 탭**: 바뀐 파일·커밋 파일을 누르면 메인 영역에 연다(한 번 누름은 preview). layout에 저장하지 않는다(다시 켜면 지운 worktree를 가리키는 탭이 남지 않게). inline·side-by-side(설정 `shell.diff_view`), 다음/이전 변경, 공백 무시, 줄 바꿈, 빠른 stage·unstage·discard, 대용량·바이너리·그림·untracked 처리.
- **Explorer 가지**: 지금 루트 폴더에서 난 worktree가 그 폴더의 파일 위에 가지 줄로 선다. 펼치면 그 worktree의 파일이고, 파일 줄에 체크아웃별 git 상태 글자와 `.gitignore` 흐림이 선다. worktree는 `folders[]`에 넣지 않는다. shell main의 파일 adapter와 다른 컴퓨터의 `project_files/*`는 ready worktree 경로를 연결 폴더처럼 받는다(`worktrees/roots`).
- **세션·터미널 열기와 꼬리표**: ready worktree가 있으면 + 메뉴와 왼쪽 sidebar +에 대상 고르기가 서고, worktree에 묶인 탭과 세션 줄에 브랜치 꼬리표가 선다. worktree가 없는 project는 지금과 같다.
- **만들기·지우기·이름 바꾸기 창**: 만들기는 Explorer·+ 메뉴·Ctrl+K(`worktree.new`)에서 연다. 지우기는 managed면 preflight 결과를 보이고 adopted면 Untrack만 한다.

### 권한, Workflow, 팀, 앱 SDK, 원격

- **권한과 승인**:
  - agent는 자기 project에 한해 `worktrees/list`, `get`, `status`, `create`, `rename`을 호출할 수 있다.
  - `worktrees/adopt`, `worktrees/settings_set`, 그리고 `source_control/*` 쓰기는 user 전용이다.
  - agent의 `worktrees/remove`는 GateCall `worktree_remove`를 거친다(`approval.md`): `read_only`에서는 `mode` 거부, `attended`에서는 `once | reject`(`outside_rewind: true`), `team_child`에서는 부모에게 `once | reject`, `unattended`에서는 `deny`(`no_person`).
- **Workflow & Team Spawn**:
  - YAML `steps.<name>.worktree`, `participants.<key>.worktree`, `@lophn/flow` `agent({ worktree })`는 `"new" | "inherit"`을 지원한다. `"new"`는 instance 제목 slug를 seed로 새 managed worktree를 만들고(실패 시 step을 `not_handed`/`worktree_failed`로 `blocked`), `"inherit"`은 직전 step session의 `worktree_id`를 이어받는다. workflow 종료·중단은 worktree를 자동 삭제하지 않는다.
  - `team spawn --worktree new | inherit | <wkt_id>`(기본 `"inherit"`): 같은 project 내에서 부모의 `worktree_id`를 기본 상속하거나 새 worktree 또는 지정 worktree에 자식을 연다.
- **App View SDK**: 앱 화면에 읽기 전용 `lophnApp.projects.worktrees(project)`와 `@lophn/app-ui`의 `useWorktrees` hook을 제공한다. 바뀜은 앱 event `("lophn", "worktree.changed")`(payload `{projectId, projectIdentity, worktreeId, reason, at}`)이고 선언의 `subscriptions`에 적은 앱만 받는다. core는 status를 (project, worktree)마다 150ms 묶고 앞 snapshot과 다를 때만 내며, 만들기·지우기·브랜치 바뀜은 바로 낸다. 앱의 쓰기는 없다(core 경계가 `forbidden`). 보안 경계상 앱 SDK 응답에는 로컬 파일시스템 절대 경로를 싣지 않는다.
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
9. **source control 쓰기는 사람 전용이며 충돌 커밋·턴 중 브랜치 전환과 전체 버리기·비-ff pull·force push·미병합 브랜치 지우기를 허용하지 않는다.** hook과 서명을 건너뛰지 않는다.
10. **worktree는 workflow 종료나 session archive로 자동 삭제되지 않는다.**

## 경계와 계약

- **ID 접두사**: `wkt`. 예약 앱 slug: `worktree`.
- **route**:
  - `worktrees/list`, `worktrees/get`, `worktrees/remove_preflight`, `worktrees/create`, `worktrees/adopt`, `worktrees/rename`, `worktrees/remove`, `worktrees/settings_get`, `worktrees/settings_set`, `worktrees/detect_include`.
  - `source_control/{status,diff,log,show,branches,ignored,file_at}`(읽기), `source_control/{stage,unstage,discard,commit,branch_create,switch,branch_rename,branch_delete,fetch,pull,push,abort,mark_resolved,suggest_message,suggest_cancel}`(사람 쓰기), `source_control/{message_request_take,message_request_done}`(agent-runtime 전용).
  - `worktrees/roots`(shell main의 파일 adapter가 읽는 ready worktree 경로).
- **event(남지 않음, `REMOTE_ALLOWED_EVENTS` 포함)**: `WorktreesChanged { project, worktree? }`, `WorktreeStatusChanged { project, status }` (`status.worktree_id` 포함).
- **CLI**: `lophn worktree list|get|status|create|adopt|rename|remove`, `lophn team spawn --worktree new|inherit|<wkt_id>`.
- **앱 event**: `("lophn", "worktree.changed")`.
- **SDK**: `@lophn/flow` `2.2.0`(`agent({ worktree })`), `@lophn/app-ui` `2.28.0`(`useWorktrees`가 `worktree.changed`로 다시 읽음), `@lophn/agent` `1.21.0`(`worktree_remove` GateCall).
- **저장(ledger)**: schema step `projects.worktrees`(`project_worktrees`, `project_worktree_settings`, `sessions.worktree_id`).
- **설정**: `projects.worktrees_folder`(`locked: true`, 기본 `<data root>/worktrees`).

## 결정

- **기존 "worktree를 관리하지 않는다" 결정을 뒤집고 core 1급 기능으로 들인다.** 이유: 병렬 agent·workflow·harness 실행이 일상화되면서 같은 checkout 충돌과 수동 worktree 관리 비용이 제품 핵심 병목이 되었다. (`git-worktree.md` 로드맵, 2026-11-28)
- **`WorktreeRecord`에 `desk_key`를 두지 않는다.** 이유: desk·탭 배치는 shell layout의 관심사이고 core ledger에 UI 배치 키를 섞지 않는다. (`git-worktree.md` 로드맵)
- **worktree 메타데이터는 컴퓨터 사이 동기화하지 않는다.** 이유: worktree 경로·브랜치·로컬 작업 상태는 기계마다 고유하다.
- **`team spawn --worktree new`는 writer Worker tx 바깥에서 먼저 worktree를 생성하고, 뒤따르는 spawn command가 실패하면 즉시 롤백한다.** 이유: git subprocess와 파일 복사를 SQLite writer tx 안에서 실행할 수 없으며, 실패 시 고아 worktree가 남지 않아야 한다.
- **AI 커밋 메시지는 workflow 제목처럼 agent-runtime pump가 짓는다.** 이유: core에는 외부 fetch가 없고 provider 호출 길(model 묶기, redaction)은 lophn agent의 것 하나다. 요청은 메모리 queue라 재시작하면 잃지만 사람이 다시 누르면 된다.
- **앱의 worktree 바뀜은 전용 bridge 알림이 아니라 앱 event `("lophn", "worktree.changed")`다.** 이유: 다른 lophn event(`call.settled`)와 같은 구독 선언·전달·수명 모델을 쓰고, 다른 컴퓨터에 묶인 view도 그 컴퓨터의 event 전달로 받는다.
- **`LC_ALL=C` 대신 `LANGUAGE=C`.** 이유: hook이 물려받는 locale을 C로 만들면 hook의 UTF-8 출력과 커밋 메시지가 깨진다.
- **1단계(화면 밖)와 2단계(renderer/폰 화면 UI)를 분리해 구현한다.** 이유: core·protocol·CLI·SDK 계약과 안전 경계를 먼저 고정하고, 화면 조사가 끝난 뒤 같은 branch에 UI를 얹는다.
