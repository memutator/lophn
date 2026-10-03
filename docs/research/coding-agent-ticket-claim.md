---
type: research
concerns: [coding-agent/tickets]
---
# coding agent ticket과 claim

## 질문
앱 하나의 immutable ticket을 사람이 지정한 외부 coding agent만 claim하게 하려면 어떤 필드·원자성·만료 경계가 필요한가?
완료 보고와 실제 acceptance check, 재시도와 늦은 옛 요청, 여러 agent/worktree의 충돌을 어떻게 구별할 것인가?
목록 발견·ready 판정·착수를 MCP·CLI·skill에서 어떻게 분리할 것인가?

## 프로젝트별

2026-10-04에 기존 clone의 `git rev-parse HEAD`로 확인한 revision을 기준으로 읽었다. 아래 경로는 각 저장소 root 기준이며 줄 범위도 해당 revision 기준이다. 기존 clone을 checkout·pull하거나 실행 중인 agent를 시작하지 않았다. `[확인]`은 코드에서 본 사실, `[문서]`는 저장소가 배포하는 공식 guide·skill의 설명, `[미확인]`은 읽은 범위에서 확인하지 못한 것으로 기능 부재를 뜻하지 않는다. lophn에 관한 선택은 `[제안]`으로 구별한다. 코드 경로에 구현이 남아 있는 것과 현재 외부 command가 그 경로를 호출하는 것은 따로 확인한다.

### Orca (fd030c404074f1100e5eedab59aec3dac7e6d1f5)

#### 일 단위와 준비 상태

- [확인] `TaskRow`는 `id, run_id, parent_id`, creator의 terminal/pane/process/run generation, `task_title, display_name, spec, status, deps, result`, 생성·완료 시각을 가진다. 상태는 `pending | ready | dispatched | completed | failed | blocked`다. 독립된 priority·typed acceptance·고정 문서 reference 필드는 이 타입에 없다. `spec`에 담는 계약과 runtime identity를 나눈다. 근거: `src/main/runtime/orchestration/types.ts:21-38,261-317`.
- [확인] `createTask`는 Run을 필수로 요구하고 parent·dependency가 같은 Run에 있는지 검사한다. SQL `CASE WHEN EXISTS`로 미완료 dependency가 있으면 `pending`, 없으면 `ready`를 넣으며 완료 dependency의 후속 task 승격은 상태 update transaction 안에서 한다. 이는 dependency readiness이지 사람의 채택 확인 여부가 아니다. 근거: `src/main/runtime/orchestration/db/tasks/task-store.ts:12-85,210-235`.
- [확인] 현재 CLI `task-update`는 status·result만 입력받는다. 조사한 create/update command에는 생성 뒤 spec/title/deps 수정 인자가 없다. immutable 계약을 모든 내부 API가 강제하는지는 [미확인]이다. 별도 draft/needs-info enum은 없고 `blocked` 및 question/decision gate가 있다. `gate-create`는 task·question·options를 받는다. 근거: `src/cli/specs/orchestration.ts:140-177,269-275`; gate 타입은 `src/main/runtime/orchestration/types.ts:319-329`.
- [문서] task spec의 필수 내용은 **Target, Change, Constraints, Ownership, Observable acceptance**다. 배포 orchestration skill은 discovery stub이고 설치 binary의 `skills get orchestration`으로 version-matched guide를 읽게 한다. 근거: `skill-guides/orchestration.md:151-159`; `skills/orchestration/SKILL.md:19-38`.

#### dispatch 원자성·담당자·liveness

- [확인] dispatch는 ready task만 받는다. 같은 handle 또는 remint 후에도 같은 stable pane에 `pending/dispatched` dispatch가 있으면 거절한다. `SAVEPOINT create_dispatch_context` 안에서 conditional insert와 task `ready → dispatched`를 함께 처리하고 실패 시 rollback한다. 사전 조회만으로 승자를 정하지 않는다. 근거: `src/main/runtime/orchestration/db/dispatch-context/dispatch-context-store.ts:14-109`.
- [확인] 핵심 insert는 `INSERT … SELECT … FROM tasks WHERE id = ? AND status = 'ready' AND NOT EXISTS (… active.assignee_handle = ? AND active.status IN ('pending','dispatched'))`와 pane guard다. caller가 write transaction/SAVEPOINT를 소유한다. insert의 `changes !== 1`이면 현재 task·담당자 상태를 다시 읽어 typed task-not-found/not-startable 또는 occupied terminal error로 돌려준다. 조사한 claim 경로의 근거는 unique 하나가 아니라 조건 SQL + 같은 transaction의 상태 전이다. 근거: `src/main/runtime/orchestration/db/dispatch-row-writer.ts:12-45`; `src/main/runtime/orchestration/db/dispatch-context/dispatch-context-store.ts:78-108`.
- [확인] `DispatchContextRow.id`가 Attempt identity이며 retry는 `retry_of_dispatch_id`로 이전 Attempt를 가리킨다. 담당자는 handle 외에 stable pane, Orca session, process incarnation으로 식별한다. reattach 때 `consumer_generation`을 올려 이전 consumer를 fence한다. 이는 lophn의 connection credential 하나만으로 작업 시도를 구별할 수 없다는 점에 유용하다. 근거: `src/main/runtime/orchestration/types.ts:279-317`.
- [확인] preamble은 heartbeat **5분** 간격을 지시하고 `check --wait`·`ask`도 liveness로 취급한다. 남아 있는 coordinator 구현의 hung threshold는 **10분**이지만 stale heartbeat는 warning일 뿐 자동 fail하지 않는다. 이 시간을 expiring claim TTL로 해석하면 안 된다. 근거: `src/main/runtime/orchestration/preamble.ts:41-45,104-126`; `src/main/runtime/orchestration/coordinator-task-dispatch.ts:15-52`.
- [확인] 현재 CLI의 `coordinator-start`, `coordinator-stop`은 **retired**, effects 없이 current skill을 읽으라는 recovery action을 반환한다. `run-create`도 namespace/inbox 생성일 뿐 scheduling하지 않는다고 명시한다. 위 coordinator 구현이 존재한다는 이유만으로 현재 제품의 자동 scheduler가 활성이라고 결론내리지 않는다. 현재 guide의 정상 경로는 coordinator agent가 `worker-start`로 명시적으로 dispatch하는 supervised loop다. 근거: `src/cli/specs/orchestration.ts:7-16,239-267`; `skill-guides/orchestration.md:95-115,147-149`.

#### 보고·검사·재시도·충돌

- [확인] `settleWorkerReport`는 transaction 안에서 task/dispatch 존재·짝·현재 상태·다른 active supervised worker를 검사한다. `succeeded` 보고는 Task와 Dispatch를 모두 `completed`, `failed`는 둘 다 `failed`로 만든다. 동일한 final 상태의 중복은 `duplicate: true`, 잘못된 보고는 `unknown_task | unknown_dispatch | task_dispatch_mismatch | inactive_dispatch | stale_dispatch`다. 이 접수 경로에서는 typed acceptance runner가 통과해야만 completed가 되는 단계가 확인되지 않았다. 근거: `src/main/runtime/orchestration/db/dispatch-context/worker-report-settlement.ts:60-164,172-287`.
- [확인] failure 처리 경로는 write transaction을 먼저 잡고, 살아 있는 supervised worker의 경우 positive exit/settlement 없이 fail하지 않는다. failure count는 retries에 누적되며 **3회**에 circuit break, 그 전 recoverable failure는 task를 `ready`로 돌린다. 옛 dispatch의 늦은 실패로 이미 완료·retry된 task를 다시 열지 않도록 guarded transition을 쓴다. 이 경로와 worker의 explicit failed report settlement는 구별해야 한다. 근거: `src/main/runtime/orchestration/db/dispatch-context/dispatch-completion.ts:95-218`; `src/main/runtime/orchestration/db/dispatch-context/dispatch-circuit-breaker.ts:1-2`.
- [문서] coordinator는 `worker_done`을 expected active Dispatch와 대조하고 모든 Dispatch settlement를 기다린다. 빈 wait·timeout·`unverifiable`은 stop/abandon/retry/release 근거가 아니다. `worker-release`는 settlement 이후 resource cleanup이며 업무 취소가 아니다. 근거: `skill-guides/orchestration.md:117-145,161-176`; `skill-guides/orchestration/references/worker-contract.md:19-80`.
- [확인] 현재 CLI의 취소 안내는 worker stop/abandon 뒤 `task-update --status failed --result cancelled`이며 나중에 `worker-start --retry-of`로 다시 열 수 있다. lophn의 terminal `cancelled`와 다른 계약이다. 근거: `src/cli/specs/orchestration.ts:167-176`.
- [확인] 남아 있는 coordinator dispatch 구현은 terminal census 실패 시 빈 목록으로 가장하지 않고 dispatch하지 않는다. worktree가 tracking base보다 **20 commits 초과** 뒤이고 `allow-stale-base`가 없으면 dispatch를 보류한다. worktree selector가 없으면 이 guard는 적용되지 않는다. 이것은 stale base 예방이지 여러 worker가 같은 파일을 수정하지 못하게 하는 lock은 아니다. 현재 retired command에서 이 자동 경로의 reachability는 [미확인]이다. 근거: `src/main/runtime/orchestration/coordinator-task-dispatch.ts:15-111`; `src/main/runtime/orchestration/coordinator-stale-base-flag.ts:1-30`.
- [미확인] 조사한 lifecycle/store/guide만으로 동일 파일 ownership의 DB unique나 자동 merge-conflict 해결을 확인하지 못했다. guide의 Ownership 경계와 runtime의 한 pane 한 dispatch는 source-level 독점과 다르다.

#### 지정 작업 원문과 외부 interface

- [문서] worker 규칙 원문은 **“Do only the current Task and use the preamble's `ask` command for a blocking coordinator question.”** 완료 뒤 **“do not poll or start new work.”**를 명시한다. `consumer_fenced`를 받으면 옛 process는 done/report를 재시도하지 않고 멈춘다. 근거: `skill-guides/orchestration.md:73-93`; `skill-guides/orchestration/references/worker-contract.md:19-45`.
- [확인] 실제 injected prompt는 `worker_done`·heartbeat 모두 **task ID + dispatch ID**를 요구한다. 완료 뒤 unrelated work 금지이나 새 direct user instruction은 새 user-owned work로 취급하고 settled lifecycle ID를 재사용하지 않는다. 이 direct-work 예외는 모든 coding 작업을 ticket으로 만드는 lophn에 그대로 가져올 수 없다. 근거: `src/main/runtime/orchestration/preamble.ts:78-154,173-212`.
- [확인] CLI는 `orchestration task-create --spec … --deps <json_array> --run …`, `task-list --ready/--status/--brief`, `dispatch --task … --to …`, `send --type worker_done --task-id … --dispatch-id … --outcome succeeded|failed`, `ask --question …/--resume …`를 제공한다. `--json`으로 읽으며 `--brief`는 spec을 160자로 줄인다. `task-list`는 limit/cursor가 없고 store가 `.all()`을 반환한다. 반면 run-list는 limit/cursor, guide의 worker-list는 기본 **100개**와 `page.hasMore/nextCursor`다. 근거: `src/cli/specs/orchestration.ts:37-40,49-122,140-237`; `src/main/runtime/orchestration/db/tasks/task-store.ts:132-159`; `skill-guides/orchestration.md:133-139`.
- [확인] `request-show --request …`는 effect를 다시 만들지 않고 mutation receipt를 읽는다. `completed`는 exact request replay, `pending`은 unknown outcome recovery에 쓰며 `absent`를 무효과의 증거로 보지 않는다. lophn의 idempotency key와 lost-response recovery에 참고할 수 있다. 근거: `src/cli/specs/orchestration.ts:198-206`.

### Beads (c1fc671fcf141457408b17ffbd8a25018fb3527b)

#### mutable issue와 ready

- [확인] `Issue`는 title, description, design, **AcceptanceCriteria string**, notes, SpecID, status, integer priority, issue type, assignee, owner, estimate, started/closed/close reason/ClosedBySession, defer/due, 외부 reference, metadata, labels/dependencies/comments 등을 가진다. hydrated lease 값과 equality-only `RowVersion`도 있다. owner는 사람 attribution, assignee는 작업 담당 문자열이며 session close attribution과 분리된다. 근거: `internal/types/types.go:20-193`.
- [확인] 기본 status는 `open`; built-in은 `open | in_progress | blocked | deferred | closed | pinned | hooked`이며 custom category는 active/wip/done/frozen이다. `ready`는 별도 status가 아니라 open + active blocker 없음의 조회다. ready에서는 in_progress/blocked/deferred/hooked를 제외한다. 근거: `internal/types/types.go:540-541,578-584,634-640`; `cmd/bd/ready.go:20-39`.
- [확인] description/design/acceptance/assignee 등은 update 가능하다. `--if-assignee`, `--if-status` 조건 불일치는 무변경으로 exit **13**이며 claim 자체 CAS와 함께 사용할 수 없다. `--force`로 살아 있는 assignee 변경을 덮는 경로도 있다. 이 mutable issue를 lophn immutable ticket으로 그대로 옮기면 계약 출처가 바뀐다. 근거: `cmd/bd/update.go:49-70,77-93,664-695,842-856,955-965`; 상세 Issue 타입은 `internal/types/types.go:20-193`.
- [문서] shipped guide는 `bd ready`를 **“Find unblocked work”**, `bd update <id> --claim`을 **“Claim and start work atomically”**, `bd close <id> --reason "..."`를 **“Complete task”**로 설명한다. 조사한 guide에서 사람 지정 ticket만 하라는 규칙은 확인하지 못했다. 근거: `plugins/beads/skills/beads/SKILL.md:45-81`; update 가능한 본문/acceptance 안내는 `AGENT_INSTRUCTIONS.md:194-200`.

#### claim CAS·identity·lease·회수

- [확인] `ClaimIssueInTx(ctx, tx, id, actor)`의 actor는 `--actor/BEADS_ACTOR`로 정하는 문자열이며 최대 **255자**다. open 및 custom active status가 대상이며 assignee가 빈 값·같은 actor·설정된 pool alias일 때 허용한다. 실제 identity 비교는 normalization을 쓰지만 pool alias는 exact 문자열이다. 같은 actor가 이미 in_progress인 경우 idempotent success다. 근거: `internal/storage/issueops/claim.go:24-244`.
- [확인] 핵심 SQL은 `UPDATE <issues-or-wisps> SET assignee=?, status='in_progress', …, row_lock=<new> WHERE id=? AND row_lock=? AND status IN (…)`다. `RowsAffected == 0`이면 같은 transaction에서 다시 읽어 holder/status conflict를 구별한다. typed `ClaimConflictError`는 IssueID/Assignee/Status를 가진다. claim 상태·event·version·lease 변경을 transaction 안에서 기록한다. 이미 누가 가진다는 error에는 live claim을 빼앗으라는 안내를 넣지 않는다. 근거: `internal/storage/issueops/claim.go:24-244`.
- [확인] durable issue lease 기본 TTL은 **5분**이며 positive context override가 가능하다. lease table은 Dolt history/replication에서 제외한 node-local ephemeral state다. wisps는 lease 대상이 아니다. 현재 저장 abstraction의 concrete backend는 Dolt SQL/embedded Dolt이며 과거 Beads의 SQLite 설명을 이 revision에 적용하지 않는다. 근거: `internal/storage/issueops/lease.go:19-42,153-178,626-668`; `internal/storage/storage.go:1-160`.
- [확인] `HeartbeatIssueInTx`는 현재 holder의 expires/heartbeat를 갱신하며 issue updated_at/history/Dolt commit을 만들지 않는다. 주 SQL은 `UPDATE leases SET lease_expires_at=?, heartbeat_at=?, … WHERE issue_id=? AND holder=?`로 **기존 expires_at이 미래여야 한다는 조건이 없다**. 따라서 expired 이후라도 reaper가 회수하기 전 heartbeat가 lease를 살릴 수 있다. lease가 없고 assignee/in_progress가 같은 경우에도 re-arm한다. lophn의 `now < expires_at` 경계와 다르다. 근거: `internal/storage/issueops/lease.go:288-414`.
- [확인] `bd reclaim`은 explicit reaper다. 기본 grace `--older-than = 2 × DefaultLeaseTTL = 10분`, cutoff는 `now - grace`이며 **lease_expires_at < cutoff**만 회수한다. snapshot 뒤 실제 `DELETE FROM leases … WHERE issue_id=? AND lease_expires_at<?`에서도 조건을 재검사하여 중간 heartbeat가 이기면 skip한다. issue in_progress를 open으로, assignee/started_at을 비우고 fresh row_lock·recovery event/version을 기록한다. 기본 replica guard는 config node ID를 설정한 경우에 적용하며 `--any-replica`는 명시 override다. 근거: `cmd/bd/reclaim.go:16-78,90-135,226-230`; `internal/storage/issueops/lease.go:626-800`.
- [문서] CLI help는 supervisor timer에서 약 2×TTL grace로 reaper를 돌리라고 권한다. 제품 내부의 필수 주기 scheduler·restart sweep은 조사한 범위에서 [미확인]이다. **5분 TTL + 10분 grace**를 lophn의 60분 기한·60초 cleanup과 혼합하면 안 된다. 근거: `cmd/bd/reclaim.go:22-32,70-78`.
- [확인] unclaim은 owner만 허용하되 force override가 있으며 force에서도 row_lock CAS를 유지한다. assignee/started_at·lease를 지우고 open으로 돌린다. actor spelling은 authenticated connection/claim generation을 대체하지 않는다. 근거: `internal/storage/issueops/unclaim.go:13-137`.

#### 완료·interface·경쟁

- [확인] checked close는 동일 transaction에서 expected RowVersion 및 live direct blocker/open child 정책을 검사한다. force는 blocker/child를 우회하지만 version check는 우회하지 않는다. RowVersion은 lifecycle/ownership change detection이고 label/dependency/rename 등 모든 필드 변경을 포괄하지 않는다. 이 close 경로에서 AcceptanceCriteria 문자열을 실행·조건별 판정하는 runner는 확인되지 않았다. 근거: `internal/storage/issueops/close.go:31-107,118-155`.
- [확인] reopen은 done category만 open으로 돌리고 다른 category는 그대로 둔다. close metadata를 비우고 lease 삭제·reopen event·version·blocked 파생값 재계산을 한다. lophn confirmed/cancelled의 terminal 불변성과 다른 선택이다. 근거: `internal/storage/issueops/reopen.go:23-134`.
- [확인] `bd ready --json`은 read다. **`bd ready --claim --json`**은 첫 ready issue를 선택→CAS claim→hydrate하는 transaction이며 결과는 issue 하나의 배열, 없으면 `[]`다. 목록 발견과 claim은 옵션으로 분리되지만 이 command는 사람이 지정하지 않은 일의 자동 선택까지 제공한다. 근거: `cmd/bd/ready.go:120-174`.
- [확인] ready 기본 limit은 **100**, limit 0은 unlimited다. 잘린 JSON 목록에는 returned/total/truncated metadata를 붙인다. direct backend에서 offset >0은 거절하며 proxied-server만 offset을 허용한다. `--claim`과 `--gated/--mol/--explain` 조합도 거절한다. 근거: `internal/workapi/ready.go:12-16`; `cmd/bd/ready.go:81-109,176-214`.
- [확인] 지정 ID claim은 `bd update <id> --claim`, 갱신은 `bd heartbeat`, 회수는 `bd reclaim --older-than … --id/--assignee/--label … --json`이다. reclaim JSON은 `{reclaimed, count, scoped}`이며 음수 grace·내용 없는 scope flag를 error로 처리한다. 근거: `cmd/bd/update.go:955-965`; `cmd/bd/reclaim.go:90-135,156-230`; heartbeat 구현 `internal/storage/issueops/lease.go:288-414`.
- [미확인] 이 조사에서는 CLI와 core issueops를 정본 근거로 보았으며 별도 Beads MCP wrapper의 tool 이름·pagination을 CLI와 동일하다고 가정하지 않는다. issue claim 경쟁은 DB CAS가 처리하지만 여러 worktree의 source/merge 충돌 해결은 조사한 이 경로에서 확인하지 못했다.

### Vibe Kanban (d5cbb5380fa0b32e98ef9b8d987f63decce4be3a)

#### task/issue와 현재의 attempt 구조

- [확인] local legacy `Task`는 UUID, project, title, nullable description, `Todo | InProgress | InReview | Done | Cancelled`(기본 Todo), parent_workspace_id, 시각이다. 이 타입과 current remote Issue를 같은 entity로 합치지 않는다. 근거: `crates/db/src/models/task.rs:14-58`.
- [확인] remote MCP issue 입력은 project/title/description/priority(`urgent | high | medium | low`)/parent다. update로 title/description/project status name/priority/parent를 바꿀 수 있다. detail에 PR/tags/blocking·related·duplicate relationships/subissue/planned dates가 있으나 조사한 schema에 구조화된 acceptance·고정 채택 문서 판은 없다. project별 status ID/name을 쓰므로 모든 project의 전체 상태 enum을 hardcode하면 안 된다. 근거: `crates/mcp/src/task_server/tools/remote_issues.rs:18-75,129-219,253-316`.
- [확인] migration에서 **task_attempts → workspaces**로 rename했고 sessions에 workspace/executor를, execution_processes에 session/status(`running | completed | failed | killed`)/exit code/시각을 둔다. coding_agent_turns는 process/agent session/prompt/summary, merge는 workspace에 연결된다. filename의 `task_attempts`나 analytics 이름이 남았다고 옛 attempt 구조를 현재 모델로 쓰면 안 된다. 근거: `crates/db/migrations/20251216142123_refactor_task_attempts_to_workspaces_sessions.sql:1-136`.
- [확인] 현재 Workspace는 branch/container ref/optional task_id/setup 시각/archive/pin/name/worktree_deleted를 가지며 is_running/is_errored는 별도 조회 값이다. assignee user와 executor/process identity가 분리된다. 근거: `crates/db/src/models/workspace.rs:18-165`; `crates/services/src/services/container.rs:1047-1130`.

#### 시작·여러 workspace·완료 판정

- [확인] MCP `start_workspace` input은 name, optional prompt, executor, optional variant, repositories의 repo_id/branch 배열, optional issue_id다. output은 workspace_id다. 빈 repositories·executor·prompt, unknown executor를 거절한다. prompt가 없으면 연결 issue의 title + description을 사용한다. ticket claim/base revision/lease identity 입력은 없다. 근거: `crates/mcp/src/task_server/tools/task_attempts.rs:15-48,68-221`.
- [확인] `/api/workspaces/start`는 새 UUID/branch/workspace를 만들고 repositories/attachments를 연결한 후 `container.start_workspace`를 호출한다. container는 Session을 새로 만들고 executor config/prompt를 `CodingAgentInitialRequest`로 넘긴다. setup script가 모두 parallel이면 각 setup 시작 뒤 coding agent를 시작하고 그렇지 않으면 sequential chain이다. 조사한 start 경로에는 issue 독점 claim 검사가 없다. 근거: `crates/server/src/routes/workspaces/create.rs:1-245,237-347`; `crates/services/src/services/container.rs:1047-1130`.
- [확인] MCP는 workspace/process 생성 뒤 remote issue link를 다시 수행하며 link failure에서 tool_error를 반환할 수 있다. **error가 이미 시작한 process가 없다는 뜻은 아니다.** 실패 뒤 같은 start를 맹목 retry하면 다른 workspace가 생길 수 있는 partial-outcome 경계다. 근거: `crates/mcp/src/task_server/tools/task_attempts.rs:195-221`.
- [확인] remote issue의 workspace 생성 처리에서 `count_by_issue_id == 1`인 첫 workspace일 때 Backlog/To do를 In progress로 바꾸고 assignee가 없으면 creator user를 지정한다. 여러 workspace를 같은 issue에 연결하는 것을 예상한 구조이지 여러 agent 중 하나만 issue를 claim하는 구조가 아니다. local workspace DB는 SQLite, 조사한 remote issue DB는 PgConnection/PgPool이다. 근거: `crates/remote/src/db/issues.rs:520-690`; `crates/remote/src/db/workspaces.rs:88-130,230-237`.
- [확인] review signal은 status name In review, WorkMerged는 연결 PR가 전부 merged이면 Done으로 전이한다. 해당 project status가 없으면 no-op이며 local merge도 WorkMerged를 알린다. PR 목록이 빈 경우 `.all()`은 true다. 이 workflow 완료는 typed acceptance별 Verification 확인과 다르다. 근거: `crates/remote/src/db/issues.rs:520-605`.
- [확인] direct merge는 open PR가 있거나 target이 remote branch이면 BadRequest, 아니면 workspace worktree의 `merge_changes` 뒤 merge record를 만들고 remote sync한다. rebase conflict는 `MergeConflicts {message, op: Rebase, conflicted_files, target_branch}` 또는 `RebaseInProgress`로 내보내며 abort/continue route가 있다. workspace isolation은 결과 integration conflict까지 제거하지 않으므로 merge 상태를 별도로 남긴다. 근거: `crates/server/src/routes/workspaces/git.rs:179-265,694-815,819-829`.
- [미확인] issue별 expiring lease·명시 renew·abandoned claim 회수·typed machine acceptance·사람 확인 acceptance engine은 조사한 create/start/status 경로에서 확인하지 못했다. workspace/process stop과 issue의 담당 변경을 같은 claim release로 간주하지 않는다.

#### MCP·pagination·prompt 경계

- [확인] `create_issue → {issue_id}`, `get_issue → {issue}`, `update_issue → {issue}`, `delete_issue → {deleted_issue_id}`, `list_issues → {issues, total_count, returned_count, limit, offset, project_id}`다. list는 project/status/priority/parent/search/simple_id/assignee user/tag/sort를 받으며 기본 **limit 50, offset 0**, 음수 limit/offset은 0으로 normalize한다. 값 parse·HTTP failure는 `CallToolResult`의 tool_error/err 경로다. 근거: `crates/mcp/src/task_server/tools/remote_issues.rs:18-75,191-246,253-430`.
- [확인] issue read/list와 `start_workspace`는 별도 operation이다. 그러나 issue_id 자체도 optional이므로 “읽었다” 또는 “workspace를 띄웠다”가 immutable ticket의 claim 성공이라는 계약은 아니다. 근거: `crates/mcp/src/task_server/tools/task_attempts.rs:23-43,94-221`.
- [미확인] 조사한 start prompt builder에는 “사람이 지정한 이 issue만 수행하라”는 공통 원문이 없다. title/description 전달은 확인했으나 저장소 전체의 다른 AGENTS/skill에 같은 경계가 있는지는 확인하지 않았다. 따라서 없는 기능으로 단정하지 않는다.

### Claude Task Master (c0c98d367c55296bfe69e65680625b6db437af02)

#### mutable 계획 task·상태·선택

- [확인] 새 `@tm/core` Task는 id/title/description/status/priority/dependencies/details/testStrategy/subtasks, optional effort/time/tags/assignee/databaseId/metadata다. metadata에 relevant files/actions, scope included/excluded, approach/constraints, `acceptanceCriteria: string[]`, skills/category가 있다. category는 research/design/development/testing/documentation/review까지 포괄한다. lophn의 implementation/repair 두 종류와 다르다. 근거: `packages/tm-core/src/common/types/index.ts:20-166`.
- [확인] 상태 union은 `pending | in-progress | done | deferred | cancelled | blocked | review | completed`, priority는 low/medium/high/critical이다. deferred/blocked는 있지만 needs-info라는 별도 확인 gate는 조사한 타입에 없다. file storage의 일반 status update는 task를 load해 enum 값을 넣고 save하며 동일 상태는 idempotent success, missing ID는 error다. 이 경로에 done 전 acceptance runner는 확인되지 않았다. 근거: `packages/tm-core/src/common/types/index.ts:20-35`; `packages/tm-core/src/modules/storage/adapters/file-storage/file-storage.ts:448-493`.
- [확인] **legacy JS와 새 TS가 공존**한다. legacy `findNextTask`는 done/completed dependency를 만족한 pending/in-progress subtask를 in-progress parent 아래에서 먼저 고르고, 아니면 top-level을 priority(high>medium>low)·dependency 개수·numeric ID로 정렬한다. 새 TaskService는 critical을 포함하고 completed set에는 **done만** 넣는다. enum에 completed가 있다는 사실로 두 selector가 같은 완료 판정을 쓴다고 가정하면 안 된다. 두 함수 모두 선택 결과/null만 반환하며 atomic claim은 아니다. 근거: `scripts/modules/task-manager/find-next-task.js:24-135`; `packages/tm-core/src/modules/tasks/services/task-service.ts:295-417`.

#### 착수·담당자·저장 경쟁

- [확인] 새 execution service의 startTask는 force가 아니면 unrelated in-progress 작업을 precheck한다. 같은 target이 이미 in-progress인 경우나 in-progress parent의 subtask는 허용한다. owner/CAS 검사나 task lease는 아니다. `updateStatus`가 true이고 dryRun이 아니면 in-progress를 기록하지만 write failure는 warning 후 execution 준비를 계속한다. 기본 options `{}`만으로 status가 반드시 기록되는 것도 아니다. 실행 파일은 `claude`, task prompt를 argv로 만들고 cwd는 process.cwd()다. 근거: `packages/tm-core/src/modules/tasks/services/task-execution-service.ts:48-280`; facade는 `packages/tm-core/src/modules/tasks/tasks-domain.ts:245-317`.
- [확인] file operation은 proper-lockfile + steno, stale lock **10초**, retry **5회**, factor 2, delay 100~1,000ms다. `modifyJson`은 lock 안에서 re-read/modify/atomic Writer로 쓴다. 이것은 **storage lock**이며 작업의 10초 claim TTL이 아니다. 근거: `packages/tm-core/src/modules/storage/adapters/file-storage/file-operations.ts:1-179`.
- [확인] 그런데 `updateTaskStatus`는 lock 전에 task array를 load하고 `saveTasks(tasks)`에 넘긴다. save는 lock 안에서 current JSON의 해당 tag array를 전달받은 normalized array로 대체한다. 다른 tag 보존·완전한 파일 교체와 **같은 tag의 동시 load/change/save가 lost update를 막는 것**은 다르다. 같은 tag에 A/B가 옛 array를 읽고 각각 save하는 경우 다른 수정이 덮일 수 있는 경로이며 실제 race 테스트는 이 조사에서 실행하지 않았다. 근거: `packages/tm-core/src/modules/storage/adapters/file-storage/file-storage.ts:219-293,448-493`; `packages/tm-core/src/modules/storage/adapters/file-storage/file-operations.ts:91-179`.
- [미확인] concrete owner/session 기반 exclusive claim, lease/renew/expiry/reaper, worktree별 task lock은 조사한 file/execution 경로에서 확인하지 못했다. assignee metadata나 “다른 in-progress task가 있나” 사전 조회로 이를 대신할 수 없다.

#### MCP·완료·shipped next prompt

- [확인] legacy MCP `next_task`는 required projectRoot 및 optional file/complexityReport/tag를 받아 한 task/null을 돌리고 `readOnlyHint: true`다. complexity report 로드 failure는 이 선택을 반드시 실패시키지 않는다. 근거: `mcp-server/src/tools/next-task.js:23-100`.
- [확인] 새 TS MCP `get_tasks`는 projectRoot/status CSV/withSubtasks/tag를 받아 tasks + stats/total/filtered를 돌린다. `readOnlyHint: true`, limit/offset/cursor 인자가 없다. `set_task_status`는 ID(comma/dotted ID), status enum, absolute projectRoot, tag를 받고 순서대로 update하여 각 task의 success/oldStatus/newStatus/taskId를 출력한다. 실패는 error message이며 `destructiveHint: true`다. owner·lease·base revision·claim seq 입력은 없다. 여러 ID를 받는 것이 batch 전체의 atomic claim이라는 뜻은 아니다. 근거: `apps/mcp/src/tools/tasks/get-tasks.tool.ts:15-161`; `apps/mcp/src/tools/tasks/set-task-status.tool.ts:12-111`.
- [확인] file adapter는 상태를 직접 바꾸는 경로를 제공하고 acceptanceCriteria/testStrategy는 지시 자료다. 조사한 set status 경로에서 reported/confirmed/check_failed 분리, condition별 machine Verification 정본, 사람 확인 event 연결은 확인되지 않았다. retry/reopen도 그 enum 값을 바꾸는 것과 lophn terminal-state 정책이 같다고 볼 수 없다. 근거: `packages/tm-core/src/modules/storage/adapters/file-storage/file-storage.ts:448-493`.
- [문서] 배포 next command 원문은 **“If no in-progress tasks: … Unblocked high-priority tasks? → Start highest”**, 목적은 **“Zero friction from decision to implementation.”**이며 `/project:workflows:auto-implement`와 연결한다. read-only next tool와 이 prompt가 유도하는 착수는 따로 봐야 한다. 이 자동 선택 문구는 lophn에 가져오지 않는다. 근거: `packages/claude-code-plugin/commands/next-task.md:22-32,58-66`.

### Paseo (0d05584d044f5a72212d509ead7af0532dd105e2)

#### file task와 runtime agent를 분리해서 본다

- [확인] task subsystem의 Task는 id/title/body/acceptanceCriteria[]/deps/parent/notes/created/priority/assignee/raw와 `draft | open | in_progress | done | failed`를 가진다. assignee는 concrete agent/session ID가 아니라 **AgentType 문자열 override**다. comment는 criteria를 immutable checklist라고 부르지만 `update` signature는 id/created를 제외한 모든 필드 변경을 받으며 `addAcceptanceCriteria`도 있다. 근거: `packages/server/src/tasks/types.ts:1-65`.
- [확인] FileTaskStore는 `<id>.md` 파일, 기본 create status open·빈 body/criteria/deps, 전체 .md 파일 read와 created 정렬이다. generic update는 read→spread→write이며 revision/CAS/transaction lock은 이 class에 없다. start는 status open만 검사하고 dependency readiness를 다시 검사하지 않는다. open/close/fail은 기존 task에 open/done/failed를 쓴다. interface의 draft→open 주석보다 구현이 넓다. close에서 test runner를 호출하지 않는다. 근거: `packages/server/src/tasks/task-store.ts:1-240,260-324`.
- [확인] graph의 ready는 open + deps 전부 done + children 전부 done이다. priority는 작은 숫자 먼저, 명시 priority 없는 것은 뒤, 다음 created다. blocked는 draft/done이 아니면서 unresolved deps가 있는 task를 골라 별도 list로 표현한다. 이는 persisted blocked enum이 아니다. 근거: `packages/server/src/tasks/task-graph.ts:14-130`.
- [확인] task document는 Markdown frontmatter와 `- [ ]` criteria를 serialize하고 checked/unchecked 입력을 parse해도 Task에는 criterion 문자열만 남긴다. writeFileAtomic은 파일 replace를 보장할 뿐 store의 두 동시 read→modify→write에 CAS를 주지 않는다. 근거: `packages/server/src/tasks/task-document.ts:5-135`.
- [미확인] FileTaskStore/getReady의 production scheduler·runtime MCP로의 연결을 확인하지 못했다. task subsystem 코드가 있다는 사실과 live agent 배정에 그것을 사용한다는 주장은 다르다. 이 조사에서는 아래 runtime의 prompt assignment가 직접 확인된 배정 통로다.

#### runtime 배정·MCP·handoff

- [확인] MCP `create_agent`는 provider/model/initial prompt/title/cwd/workspaceId/config/worktree로 agent를 만든다. agent-scoped 기본은 같은 workspace의 subagent/background, top-level에서 workspaceId가 없으면 local workspace를 만든다. 결과는 agentId/type/status/cwd/workspaceId/mode/lastMessage/permission을 포함한다. 조사한 schema에는 task ID·claim seq·lease input이 없다. 근거: `packages/server/src/server/agent/tools/paseo-tools.ts:1420-1528`.
- [확인] `list_agents`는 includeArchived 기본 false, sinceHours 기본 **48/최대720**, limit 기본 **50/최대200**, cwd/status filter다. slice로 limit만 적용하고 조사한 schema에는 다음 page cursor가 없다. `cancel_agent`는 현재 run을 abort하되 agent 자체는 살아 있게 두는 operation이며 agentId→success다. task의 done/failed나 claim return을 대신하지 않는다. 근거: `packages/server/src/server/agent/tools/paseo-tools.ts:2036-2127`.
- [확인] agent MCP server는 catalog tool 등록과 structuredContent/isError 전달을 한다. file task operation을 이 server의 live claim tool로 노출한다는 연결은 [미확인]이다. 근거: `packages/server/src/server/agent/mcp-server.ts:17-51`.
- [문서] `paseo-handoff`는 현재 task/context/결정/실패 시도/제약을 self-contained initial prompt로 옮기고 Acceptance criteria/Constraints를 넣는다. 원문은 **“Preserve task semantics. Investigate-only → \"DO NOT edit files.\" Fix → \"implement the fix.\" Refactor → \"refactor, not rewrite.\" Carry the user's exact intent.”**다. 이것은 scope 보존 guide이지 exclusive claim lease가 아니다. 근거: `skills/paseo-handoff/SKILL.md:9-53`.
- [문서] profile을 읽은 뒤 create_agent를 호출하고 worktree isolation은 사용자가 요청한 경우 선택한다. 독립 detach는 사용자 gesture이며 CLI detach하지 않는다. 근거: `skills/paseo-handoff/SKILL.md:13-21,55-65`.
- [미확인] runtime의 agent 완료를 file task machine acceptance로 확정하는 연결, owner 기반 claim CAS·TTL·명시 renew·reaper·reassign 정책은 조사한 경로에서 확인하지 못했다. 여러 agent 생성과 workspace isolation은 확인했지만 같은 Task를 둘이 start할 때 exclusive 승자를 만드는 runtime 연결은 확인하지 않았다.

## 비교

| 프로젝트 | 일 계약·ready | exclusive claim 근거·identity | 만료·회수 | 완료의 의미 | 발견/착수·큰 목록 |
|---|---|---|---|---|---|
| Orca | spec task + deps; pending/ready; typed acceptance는 spec 안내 | conditional INSERT + SAVEPOINT 상태 전이; task/dispatch/pane/process/generation; pane당 active 하나 | heartbeat 5분; 남은 coordinator stale 10분 warning, TTL 아님; positive stop/settlement와 cleanup 분리 | worker_done outcome으로 task+dispatch completed/failed; coordinator는 active Dispatch 비교 | task-list와 worker-start 분리; current coordinator-start retired; task-list unpaged, worker-list 100/cursor |
| Beads | mutable Issue; acceptance string; open+blocker 없는 ready | row_lock CAS + RowsAffected; actor 문자열/assignee, durable lease | TTL 5분; expired 이후 heartbeat 가능; reclaim default grace 10분, guarded delete | checked close는 blocker/child/version 정책; 조건별 test 확정은 조사 경로에서 미확인; done reopen | ready read와 ready --claim 분리; 후자는 자동 선택+claim; 기본100/truncation, direct offset 제한 |
| Vibe Kanban | mutable remote Issue; project status; local legacy Task와 분리 | start workspace는 exclusive issue claim 아님; user/executor/session/process 분리; 여러 workspace 허용 | 조사한 start에 lease 없음; process/workspace cleanup과 issue 상태는 별개 | PR/local merge workflow가 In review/Done 변경; acceptance check 아님 | list_issues와 start_workspace 분리; list 50/offset/count; link 실패도 이미 process 시작 가능 |
| Task Master | mutable 계획 Task/subtask; dependency·priority selector; JS/TS 완료 판정 차이 | execution precheck + file lock; task owner CAS 아님; same-tag lost update 가능 | 10초는 file lock stale, claim TTL 아님; task lease 경로 미확인 | set_task_status 직접 done 등 지정; machine acceptance 분리는 조사 경로에서 미확인 | next read와 shipped Start highest prompt를 구별; get_tasks unpaged |
| Paseo | file Task draft/open/deps/criteria; runtime 연결 미확인 | FileTaskStore atomic replace는 CAS 아님; runtime agentId와 AgentType assignee 구별 | claim lease/회수 연결 미확인; cancel_agent는 현재 run abort | file close 직접 done, checkbox state도 문자열로 축소; runtime completion 연결 미확인 | task ready graph와 create_agent prompt는 별도; agent list 기본50/최대200, cursor 미확인 |

## lophn에 가져올 것과 버릴 것

### 가져올 것

1. [제안] **작업 계약과 현재 권리의 분리.** Orca의 Task/Dispatch 분리에서 identity 원칙만 가져온다. lophn은 별도 attempt entity 없이 `connection + TicketClaimed event seq`를 사용하고 renew로 seq를 바꾸지 않는다. 같은 connection의 재claim 뒤 옛 report/renew/release 준비가 모두 conflict여야 한다. connection 인증과 ticket 권리는 같은 검사가 아니다.
2. [제안] **claim과 repair 예약은 DB transaction에서 승자를 만든다.** UI read→write 사전 조회를 correctness로 삼지 않는다. lophn의 `ticket_claims` PK ticket·repair 예약 PK problem, ticket revision CAS·현재 상태 조건, event/projection 변경을 같은 transaction으로 묶는다. Beads처럼 affected-row 0에서 current state를 읽어 conflict를 구별하고, Orca처럼 lost-response는 idempotency receipt를 읽어 새 effect 없이 recovery한다.
3. [제안] **기한은 쓰기 조건이다.** renew/report/release 준비에 현재 connection·claim_seq·`now < expires_at`를 검사한다. default `3,600,000ms`, 60초/restart sweep을 유지한다. sweep이 아직 안 돌았다는 이유로 expired 권리를 쓰지 못한다. cleanup도 snapshot의 seq와 expiry를 SQL에서 다시 비교하여 중간 renew·재claim을 제거하지 않는다.
4. [제안] **prompt는 발견과 착수를 따로 지시한다.** Orca의 current-task-only와 done 뒤 idle를 lophn guide에 맞춰 쓴다. 예: “사람의 터미널 지시 또는 Start 첫 prompt가 지정한 ticket만 읽고 MCP claim한다. 목록·priority·ready 표시는 착수 지시가 아니다. claim 실패·만료·취소 뒤 다른 ticket을 골라 작업하지 않는다. 완료 보고 뒤 새 사람 지시를 기다린다.” 이 문구는 prompt 보조이며 서버 권한·CAS를 대신하지 않는다.
5. [제안] **scope와 observable acceptance를 완전하게 전달한다.** Orca의 Target/Change/Constraints/Ownership/Observable acceptance, Paseo의 사용자 intent 보존을 lophn title/what/why/inspect/preserve/고정 reference/typed conditions에 대응시킨다. reproduction을 만들 수 없으면 사실대로 human confirmation을 선택하며 빈 test나 가짜 채택 답을 만들지 않는다.
6. [제안] **완료 주장과 검사 정본을 분리한다.** 외부 agent report 접수는 claim 종료 + reported까지만 한다. `app_test/test_command/reproduction_test`는 실제 Verification, activation/문제 닫힘은 현재 정본 revision, human confirmation은 그 자신의 근거를 비교한다. 전부 pass→confirmed, 실제 fail 하나→check_failed, 나머지 inconclusive→reported다. 테스트 성공 문장·agent exit 0·PR merge는 이를 대신하지 않는다.
7. [제안] **list/show와 bounded pagination.** lophn list 최대20 요약·show 전체 계약·조건별 checks를 유지한다. 큰 산문을 기본 목록에 넣지 않고 filter가 cursor에 고정되며 truncated/next cursor를 드러내야 한다. Orca task-list·Task Master get_tasks의 full array와 Paseo slice-only 목록은 큰 목록의 모범으로 가져오지 않는다.
8. [제안] **claim 상실과 process 종료를 구별한다.** Vibe의 workspace/process/issue 분리, Orca의 settlement 이후 cleanup을 참고하되 lophn claim은 source lock이나 외부 process custody가 아니다. 취소 직후 새 플랫폼 write를 막고 이미 만들어진 release/test/report를 보존한다. UI에 “외부 agent를 종료했다”는 미확인 표시를 만들지 않는다.
9. [제안] **partial outcome을 먼저 조회한다.** Vibe의 start 후 issue-link failure처럼 error 뒤 effect가 남을 수 있다. lophn Start launch, claim, completion 접수에서 transport 실패와 실제 effect를 구별하고 exact operation key/현재 ticket read로 확인한 뒤 처리한다. timeout 자체로 새 agent를 띄우거나 재claim하지 않는다.
10. [제안] **경쟁 테스트를 acceptance로 둔다.** 동일 ticket 두 connection 동시 claim에서 하나만 성공; 같은 connection 재claim 후 old seq 거절; 정확한 expiry에서 renew 거절; cleanup snapshot 뒤 renew/reclaim; completion 뒤 old worker write 거절; latest completion 검사와 target revision 변경 경쟁; repair 문제 중복 생성에서 unique 충돌을 검증한다. file atomic replace 성공 테스트만으로 이 조건을 통과했다고 보지 않는다.

### 버릴 것

- [제안] Beads ready --claim, Task Master Start highest, coordinator의 작업 자동 fan-out를 lophn 기본 정책으로 옮기지 않는다. ready/dependency/priority는 선택 가능성일 뿐 사용자의 exact ticket 지시가 아니다.
- [제안] Beads/Vibe/Task Master/Paseo의 mutable 계획 본문·acceptance 수정을 가져오지 않는다. lophn은 생성 뒤 불변이며 변경은 사람 취소 + 이전 ticket을 참조한 새 ticket이다. Orca guide의 새 direct user work 예외도 ticket 없는 coding 예외로 가져오지 않는다.
- [제안] Beads의 5분 heartbeat lease·10분 grace, Orca의 liveness warning을 lophn claim 정책으로 가져오지 않는다. read·test·preview·release 준비는 명시 renew가 아니다.
- [제안] Orca pane당 active dispatch 하나, Task Master unrelated in-progress task 충돌을 lophn connection당 claim 하나로 강화하지 않는다. 요구는 ticket당 하나이며 한 connection의 여러 ticket을 허용한다.
- [제안] Vibe 여러 workspace/attempt를 동일 ticket의 여러 유효 claim으로 가져오지 않는다. worktree isolation을 제공하더라도 ticket 독점과 merge conflict는 별개다.
- [제안] completed/closed/done/merge를 lophn confirmed로 바로 매핑하지 않는다. Beads reopen·Orca cancelled-as-failed/retry·임의 status update도 confirmed/cancelled 재오픈에 사용하지 않는다.
- [제안] dependency graph·subtask·task category research/design/review를 ticket 범위에 넣지 않는다. 현재 requirements가 dependency를 버렸고 lophn ticket은 앱 하나 구현/수리다. 앞 결과가 있어야 다음 작업이 정의되면 그 결과를 reference로 새 ticket을 만든다.

## requirements와 다른 점

아래는 외부 프로젝트와의 **의도된 차이**, 현 문서의 **불일치/빠진 계약**, **구체화 제안**을 구별한다. requirements/domain model/architecture와 open-issues는 수정하지 않았다.

- **coding-agent/tickets#R5, coding-agent/tickets#R11, coding-agent/tickets#R24 — 불일치: 조사 지시의 readiness가 현재 정본에 없다.** 조사 지시는 `needs_confirmation | ready` 및 ready만 claim을 설명하지만 requirements R5는 별도 공개 단계 없이 즉시 open, domain Ticket은 readiness 필드 없이 open/check_failed→claimed, architecture claim도 open/check_failed만 검사한다. 근거: `docs/requirements/coding-agent/tickets.md:33-40,67-74,136-139`; `docs/domain-model/coding-agent/tickets.md:13-30,45-46,155-160`; `docs/architecture/coding-agent.md:194-198`. [제안] readiness가 여전히 필요한 제품 결정이라면 진행 state와 분리하고 어느 확인이 ready로 만드는지·생성의 open과 관계·Start/claim 검사·needs_confirmation에서 가능한 operation을 명시해야 한다. 새 draft progress state나 agent의 자동 확인으로 보충하지 않는다. 반대로 현재 immediate-open 정본을 유지한다면 조사 지시의 ready-only 설명을 정정해야 한다. 본 문서는 둘 중 하나를 확정하지 않는다.
- **coding-agent/tickets#R7, coding-agent/tickets#R9, coding-agent/tickets#R26 — 불일치: 문제별 human confirmation coverage.** R9는 각 repair problem마다 reproduction 또는 만들 수 없을 때 human confirmation을 허용하지만 domain 불변 조건은 app_test + 각 reproduction_test + problems_closed만 적는다. human_confirmation 설명은 있으나 추가 필드가 없어서 여러 problem 중 어떤 problem의 reproduction 대신인지 explicit mapping이 없다. 근거: `docs/domain-model/coding-agent/tickets.md:60,81-90,192`; requirements `:45-57,148-150`. [제안] domain invariant를 R9와 맞추고 human_confirmation에 대상 problem 또는 immutable coverage mapping을 정의한다. 하나의 확인으로 다른 problem의 필수 검사가 조용히 제외되지 않도록 생성 validation과 condition별 check 근거에 포함한다. 가짜 reproduction/Verification은 만들지 않는다.
- **coding-agent/tickets#R11, coding-agent/tickets#R16, coding-agent/tickets#R24 — 의도된 차이: ready 선택·직접 start.** Beads ready --claim은 자동 선택, Task Master prompt는 Start highest, Vibe start_workspace/Paseo create_agent는 ticket claim을 필수로 하지 않는다. Orca의 current guide는 coordinator가 지정한 Task만 하지만 supervisor가 fan-out를 선택한다. [제안] lophn은 exact ticket 지정→MCP claim을 유지하고 hook/list는 발견으로만 표시한다. 현재 architecture의 common guide·Start first prompt 계약과 일치하며 이것을 자동 next scheduler로 넓힐 필요는 없다. 근거: `docs/architecture/coding-agent.md:266-268,332-349`.
- **coding-agent/tickets#R4, coding-agent/tickets#R11, coding-agent/tickets#R13 — 구체화: SQL 경합과 old-claim fencing.** lophn domain은 repair 예약 PK problem, claim PK ticket, revision/current seq transaction을 정한다. [제안] spec/구현 테스트에서 조건 update/insert의 affected-row 0, unique 충돌, 같은 connection 재claim 후 old seq, cleanup의 현재 seq·expiry 재검사를 명시한다. Task Master/Paseo의 file replacement를 이 CAS와 같은 보장이라고 쓰지 않는다. Orca식 한 pane 하나는 lophn의 connection 동시 ticket 상한으로 옮기지 않는다. 근거: `docs/domain-model/coding-agent/tickets.md:92-98,135-161,183-185`.
- **coding-agent/tickets#R12, coding-agent/tickets#R13, coding-agent/tickets#R14 — 의도된 차이: lease 경계.** Beads는 TTL 5분·grace 10분·expired heartbeat recovery, Orca는 heartbeat 5분/stale 10분 warning이다. lophn은 `3,600,000ms`, 정확한 expiry에서 `now < expires_at` 실패, 60초/restart cleanup, 무호출 5분만으로 회수하지 않음을 유지한다. [제안] 만료 직후 sweep 전 write 거절을 반드시 race 테스트로 확인한다. 기한을 늦은 reaper 시각이나 외부 session liveness로 재정의하지 않는다.
- **coding-agent/tickets#R17, coding-agent/tickets#R18, coding-agent/tickets#R19, coding-agent/tickets#R20 — 의도된 차이: 보고와 확정.** 조사한 다른 completion 경로는 outcome/close/status/merge를 완료로 쓴다. lophn `reported | confirmed | check_failed` 및 `pass | fail | inconclusive`를 유지해야 한다. [제안] completion_seq/condition/hash/release/target revision CAS와 restart 재검사를 구현의 별도 machine 단계로 두고 worker report의 succeeded를 pass로 import하지 않는다. 현 architecture의 접수 transaction + checker worker와 맞는다. 근거: `docs/architecture/coding-agent.md:401-422`; `docs/domain-model/coding-agent/tickets.md:100-121,187-188`.
- **coding-agent/tickets#R6, coding-agent/tickets#R19, coding-agent/tickets#R22 — 의도된 차이: 수정·재오픈·취소.** mutable issue/task update 및 Beads done→open/Orca failed-result-cancelled retry는 lophn에 맞지 않는다. 변경은 사람 cancel reason 1~200자 + 새 immutable ticket, confirmed/cancelled는 terminal로 유지한다. 부활한 문제는 problems/grouping, 새 작업은 이전 ticket reference로 구별한다.
- **coding-agent/tickets#R14, coding-agent/tickets#R23, coding-agent/tickets#R25 — 의도된 차이: 업무 권리와 source/process 권한.** worktree/process orchestration을 claim 권한으로 해석하지 않는다. [제안] 취소/회수는 플랫폼 후속 write를 막는 fact로만 표시하고 외부 파일 편집 종료·process killed·source lock 해제를 보장했다고 표시하지 않는다. 기존 release/test/report는 보존하며 inspect/reference는 grant가 아니다.
- **coding-agent/tickets#R2, coding-agent/tickets#R24, coding-agent/tickets#R27 — 유지·구체화: 작은 계약과 bounded list.** 외부 모델의 대형 priority/dependency/subtask 필드는 현 ticket 입력에 추가하지 않는다. architecture list 최대20·본문 없음·cursor를 유지하고 show/checks에서 exact 계약·실제 근거를 펼친다. [제안] truncated·next cursor·filter mismatch error를 contract 테스트로 확인하고 unpaged 전체 배열을 hidden default로 쓰지 않는다. 근거: `docs/architecture/coding-agent.md:194-200`; `docs/requirements/coding-agent/tickets.md:18-21,153-155,164`.
