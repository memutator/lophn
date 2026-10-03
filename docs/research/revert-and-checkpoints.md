---
type: research
concerns: [lophn-agent/revert]
---
# revert와 checkpoint

## 질문

agent 변경을 어떤 단위로 언제 snapshot하고, 되돌리기 전에 무엇을 보여 주며, 이후 변경·일부 실패·외부 효과를 어떻게 처리하고, 같은 요청을 두 번 하면 어떻게 되는가.

lophn은 파일·git을 되돌리지 않는다. 비교 대상은 전부 작업 트리의 파일을 git snapshot으로 되돌리고, lophn은 ledger 변경을 새 version으로, 앱 변경을 앱의 revert command로 복원한다. 가져올 것은 미리보기, 충돌 검사, 부분 결과 표시다.

## 프로젝트별

### Codex (`3a69ec3ef8fb`)

- 파일 되돌리기는 제거됐다. `Feature::GhostCommit`(config key `undo`)은 `Stage::Removed`, `default_enabled: false`인 no-op이다. rollout의 `ghost_snapshot` 줄은 읽을 때 skip하고, `ThreadRolledBack` event는 "기존 rollout replay용, live rollback 미지원"이라고 적혀 있다. 근거: `codex:codex-rs/features/src/lib.rs` `Feature::GhostCommit`, `codex:codex-rs/rollout/src/recorder.rs` `fn strip_legacy_ghost_snapshot_rollout_line`, `codex:codex-rs/protocol/src/protocol.rs` `EventMsg::ThreadRolledBack`.
- 남은 revert는 대화 history만 대상이다. paginated thread에서 `revert_thread(before_turn_id)`가 turn 시작 경계 이전까지를 남기는 새 rollout 파일을 만들고, SQLite의 rollout 경로 pointer를 `replace_rollout_path_if_current`로 CAS 교체한다. 옛 파일은 지우지 않는다. 근거: `codex:codex-rs/thread-store/src/local/revert_thread.rs` `fn revert`.
- 진행 중 thread는 `ensure_live_recorder_absent`로 거절한다. pointer가 그 사이 바뀌었으면 `Conflict`를 내고 방금 만든 파일을 삭제한다. 그래서 두 번 동시에 되돌리면 하나만 성공한다. 근거: 같은 함수.
- 경계는 fork와 같다. `BeforeTurn`은 그 turn의 시작 ordinal·byte offset이고, 시작 경계가 없는 turn은 거절한다. 근거: `codex:codex-rs/thread-store/src/local/paginated_fork.rs` `fn history_base_at_boundary`.
- 미리보기·충돌(이후 파일 변경)·부분 되돌리기·외부 효과 표시는 없다. 대화만 잘라지므로 파일 변경은 그대로 남는다. unrevert도 없다. 옛 rollout이 남아 있어 수동으로는 가능하나 그 command는 찾지 못했다 [미확인].
- 현재 파일 변경 추적은 `TurnDiffTracker`가 patch delta를 메모리에서 모아 unified diff로 보여주는 것뿐이다. snapshot 저장이 아니다. 근거: `codex:codex-rs/core/src/turn_diff_tracker.rs` `struct TurnDiffTracker`.

### OpenCode (`907b3bc518fa`)

- snapshot은 세션 DB와 별개의 shadow git이고 commit을 만들지 않는다. `track()`은 `git add` 뒤 `write-tree`로 tree hash만 반환한다. gitdir은 `data/snapshot/<project id>/<worktree hash>`이고, `core.autocrlf=false`, `core.longpaths=true`, `index.version=4`, `feature.manyFiles=true`를 켜고, `gc --prune=7.days`로 정리한다. 근거: `opencode:packages/opencode/src/snapshot/index.ts` `fn track`, `fn cleanup`.
- 시점은 assistant 응답 경계다. stream 시작 전에 `snapshot.start`, 응답 완료 뒤 `snapshot.end`를 assistant message에 남긴다. tool 실행 뒤에는 `patch(startHash)`로 바뀐 파일 목록을 patch part로 메시지에 붙인다. 근거: `opencode:packages/opencode/src/session/processor.ts`, `opencode:packages/schema/src/session-message.ts` `Assistant.snapshot`.
- revert 단위는 메시지 또는 part다. `revert(sessionID, messageID, partID?)`는 그 지점부터 뒤의 patch part를 모아 파일별로 `git checkout <hash> -- <file>`을 실행한다. snapshot에 파일이 없으면 삭제한다. part 지정인데 그 part 앞에 text·tool part가 있으면 그 part부터, 아니면 앞 user message부터 자른다. 근거: `opencode:packages/opencode/src/session/revert.ts` `fn revert`, `snapshot/index.ts` `fn revert`.
- 미리보기는 `snap.diff(hash)`의 전체 diff다. revert 전에 `session.revert.diff`와 summary(additions, deletions, files)를 저장하고 `Session.Event.Diff`로 알린다. 근거: `opencode:packages/opencode/src/session/revert.ts`.
- 충돌 처리는 없다. checkout이 실패하면 "snapshot에 있던 파일은 유지, 없으면 삭제"만 한다. 사람이 그 사이 고친 내용은 덮어쓴다. 근거: `opencode:packages/opencode/src/snapshot/index.ts` `fn revert`의 `single`.
- 적용 전 tree를 `rev.snapshot`에 남긴다. `unrevert`는 그 tree를 `read-tree` + `checkout-index -a -f`로 복원하고 `revert` 필드를 지운다. 두 번째 revert는 첫 revert의 snapshot을 유지한 채 파일을 다시 되돌린다. 근거: `opencode:packages/opencode/src/session/revert.ts` `fn unrevert`, `snapshot/index.ts` `fn restore`.
- 대화 기록은 revert 때 지우지 않는다. `session.revert`가 잘린 지점을 가리키고, 실제 메시지·part 삭제는 `cleanup`에서 한다. cleanup은 대상 메시지 뒤의 메시지를 지우고 partID가 있으면 그 part부터 뒤를 지운다. 근거: `opencode:packages/opencode/src/session/revert.ts` `fn cleanup`.
- 외부 효과 표시는 없다. shell 실행은 `shell` 메시지로 남지만 revert가 그것을 "되돌릴 수 없음"으로 분류하지 않는다. 근거: `opencode:packages/schema/src/session-message.ts` `Shell`.
- 실패 처리: git 명령은 exit code를 보고 로그 후 계속한다. 중간 실패를 모아 보여주는 결과 구조는 없다. 진행 중 세션은 `SessionBusyError`로 revert·unrevert를 거절한다. 근거: `opencode:packages/opencode/src/snapshot/index.ts` `fn git`, `opencode:packages/opencode/src/session/revert.ts`.
- 같은 파일은 첫 patch만 처리한다(`seen` set). 인접 파일 100개까지 묶어 checkout하고, 경로가 서로 포함 관계면 나눠서 처리한다. 근거: `snapshot/index.ts` `fn revert`.

### Pi (`83692682f095`)

- 파일 checkpoint는 없다. revert에 해당하는 것은 세션 tree의 `branch`다. entry를 지우지 않고 leaf pointer만 이전 entry로 옮기면 다음 append가 거기서 갈라진다. 근거: `pi:packages/coding-agent/src/core/session-manager.ts` `fn branch`.
- 미리보기는 없다. 대신 `branchWithSummary`가 버린 경로를 요약해 새 경로의 첫 entry로 넣는다. 요약은 model context에 user 메시지로 들어간다. 근거: 같은 파일 `fn branchWithSummary`, `pi:packages/coding-agent/src/core/messages.ts` `BRANCH_SUMMARY_PREFIX`.
- 부분 수정은 `context_edit`다. 이전 entry의 content를 바꾸거나 null로 context에서 빼되 원본 entry는 남는다. active branch 위의 editable entry(user, assistant, toolResult, custom_message)만 대상이다. 근거: `session-manager.ts` `fn appendContextEdit`.
- 새 세션으로 고정하는 `createBranchedSession(leafId)`는 root부터 그 leaf까지를 새 파일로 쓴다. 원본 파일은 유지된다. 근거: 같은 파일 `fn createBranchedSession`.
- 외부 효과·충돌·unrevert 개념이 없다. 같은 자리로 다시 branch하면 이전 갈래가 그대로 남아 있어 돌아갈 수 있다.

### Gemini CLI (`fb972b2f87fe`)

- checkpoint는 기본 꺼져 있다. `general.checkpointing.enabled` 기본값 `false`, 켜려면 재시작이 필요하고 git이 없으면 시작을 실패시킨다. 근거: `gemini-cli:packages/cli/src/config/settingsSchema.ts` `checkpointing.enabled`, `gemini-cli:packages/core/src/services/gitService.ts` `fn initialize`.
- snapshot은 shadow git의 commit이다. history dir를 `GIT_DIR`, project root를 `GIT_WORK_TREE`로 두고 `git add .` 후 변경이 있을 때만 commit한다. 사용자 gitconfig를 물려받지 않도록 전용 `.gitconfig`(gpgsign false, 고정 author `Gemini CLI <gemini-cli@google.com>`)를 쓴다. 같은 repository의 snapshot은 `withPathLock`으로 직렬화한다. 근거: `gitService.ts` `fn createFileSnapshot`, `fn setupShadowGitRepository`.
- 시점은 tool 실행 전이다. `AwaitingApproval` 상태이고 `EDIT_TOOL_NAMES`에 드는 tool call마다 `processRestorableToolCalls`가 snapshot을 만들고, commit hash·history·tool 인자를 `<timestamp>-<file>-<tool>.json`으로 temp checkpoint dir에 쓴다. tool 인자에서 파일 경로를 뽑지 못하면 skip한다. 근거: `gemini-cli:packages/cli/src/ui/hooks/useGeminiStream.ts`, `gemini-cli:packages/core/src/utils/checkpointUtils.ts` `fn processRestorableToolCalls`.
- 복원은 `git restore --source <hash> .` 뒤 `git clean -f -d`다. snapshot 이후 생긴 untracked 파일도 지운다. 사람이 그 사이 한 변경은 검사 없이 덮어쓴다. 근거: `gitService.ts` `fn restoreProjectFromSnapshot`.
- 대화 되돌리기는 별도다. `rewindTo(messageId)`는 `$rewindTo` 줄을 append하고 그 메시지부터 뒤를 화면에서 뺀다. 원본 줄은 파일에 남으므로 다시 읽으면 복원 전을 재구성할 수 있다. 근거: `gemini-cli:packages/core/src/services/chatRecordingService.ts` `fn rewindTo`.
- 미리보기는 확인 화면의 누적 diff다. `calculateRewindImpact`가 대상 user 메시지 뒤의 tool result에 남은 file diff를 합쳐 줄 수·파일 수·파일별 diff를 보여 준다. 실제 작업 트리와 비교하지 않으므로 사람이 나중에 고친 내용은 반영되지 않는다. 근거: `gemini-cli:packages/cli/src/ui/utils/rewindFileOps.ts` `fn calculateRewindImpact`, `gemini-cli:packages/cli/src/ui/hooks/useRewind.ts`.
- 부분 되돌리기와 외부 효과 표시는 없다. snapshot 실패는 debug message로만 남고 tool 실행은 계속된다. 근거: `useGeminiStream.ts`의 `saveRestorableToolCalls`.

### Hermes (`343500b3547e`)

- 파일 checkpoint는 없다. `/undo`, `/retry`는 대화만 되돌린다. 구현은 `rewind_user_turn` 하나고 CLI·gateway·TUI가 같이 쓴다. 근거: `hermes-agent:hermes_state_rewind.py` `class SessionRewindMixin`.
- 단위는 user turn이다. `user_ordinal`은 0이 가장 오래되고 음수는 끝에서 센다. 대상 행부터 뒤를 `active=0`으로 soft delete하고 `sessions.rewind_count`를 올린다. 행은 지우지 않는다. 근거: `hermes-agent:hermes_state_messages.py` `fn rewind_to_message`.
- 대상은 user role만이다. 그 사이 행이 바뀌었으면 `expected_active_ids` 비교로 `RuntimeError`를 내고 아무것도 쓰지 않는다. 진행 중 turn lease나 compression lock이 있으면 거절한다. 근거: 같은 함수의 `_check_transcript_write_guards`.
- 미리보기는 없다. 반환값 `RewindOutcome`에 잘린 개수와 되돌려질 user text가 있어 호출자가 보여 줄 수는 있다. 근거: `hermes_state_rewind.py` `class RewindOutcome`.
- 외부 효과는 `effect_disposition`으로 남는다. `none`(side effect 없음), `unknown`(실행됐을 수 있음), `blocked`를 확인했다. resume 때 interrupt marker(`[Command interrupted]`, exit 130)가 있으면 읽기 전용 tool 블록은 통째로 버리고, side effect 가능성이 있으면 결과를 "효과 불명, 재시도 전에 현재 상태를 확인하라"는 고정 문장으로 바꿔 유지한다. 근거: `hermes-agent:agent/replay_cleanup.py` `fn strip_interrupted_tool_tails`, `hermes-agent:agent/tool_executor.py`.
- 대화는 되돌린다. soft delete라 원본 행이 남고 active 집합만 바뀐다. unrevert command는 없다. compaction carrier(요약 + 실제 질문이 한 행)는 요약 scaffold를 새 행으로 다시 넣어 head를 유지한다. 근거: `hermes_state_messages.py` `fn rewind_to_message`.
- 두 번 요청: 첫 rewind가 active 집합을 바꾸므로 같은 ordinal의 두 번째는 `RewindTargetUnavailableError` 또는 `RuntimeError`가 된다. 부분 적용은 없다. 한 transaction에서 행 update와 counter 갱신이 같이 끝난다. 근거: 같은 함수.

### Claude Code (CHANGELOG 근거, 코드 없음)

- `/rewind`(Esc 두 번)는 이전 지점을 고르는 목록이다. 요약 옵션의 추가 context는 선택 사항이고, 빈 입력으로 Enter가 거절되던 문제가 고쳐졌다. 근거: `claude-code:CHANGELOG.md` 5732, 124번 근처 항목.
- rewind 이후의 artifact publish가 되감긴 turn에서만 읽은 파일을 덮어쓰지 못하도록 거절하고 다시 읽게 한다. 이후 변경 보호의 한 사례다. 근거: 같은 파일 332번 근처 항목.
- resume 때 결과를 모르는 tool call은 "결과 불명"으로 보여 준다. 근거: 같은 파일 739번 근처 항목.

## 비교

| | snapshot 시점 | 저장 | 단위 | 미리보기 | 이후 변경 | 대화도 되돌리나 | 외부 효과 | 두 번 요청 |
|---|---|---|---|---|---|---|---|---|
| Codex | 없음(제거됨) | 새 rollout 파일 | turn 경계 | 없음 | 해당 없음 | 예, 옛 파일 보존 | 표시 없음 | CAS conflict |
| OpenCode | 응답 시작·끝 | shadow git tree hash | 메시지·part | diff, 줄 수 | 덮어씀 | 표시만, cleanup 때 삭제 | 표시 없음 | 첫 snapshot 유지 |
| Pi | 없음 | JSONL tree | entry | 없음 | 해당 없음 | 아니오, leaf만 이동 | 없음 | 갈래가 남음 |
| Gemini CLI | tool 승인 전(기본 off) | shadow git commit + JSON | tool call | 누적 diff | 덮어씀, untracked 삭제 | 예, `$rewindTo` append | 표시 없음 | 새 checkpoint |
| Hermes | 없음 | SQLite soft delete | user turn | 없음 | active 집합 비교로 거절 | 예, 행 보존 | `unknown`/`none` | 두 번째는 거절 |

## lophn에 가져올 것과 버릴 것

lophn의 revert는 종료한 run 하나의 확정 변경 전체를 새 변경으로 되돌린다. 문서 내용은 이전 내용의 새 version이고, 앱 write는 저장한 receipt로 앱의 revert command를 역순 호출한다. 파일·git·디스크 원본은 대상이 아니다.

- **R1 단위.** 다섯 프로젝트 모두 turn·메시지·tool call 단위로 중간 지점을 고른다. lophn은 run 전체만 대상으로 하므로 중간 선택(OpenCode의 part, Gemini의 tool call, Hermes의 user ordinal)은 버린다. "종료한 것만"은 Codex의 live recorder 거절, Hermes의 turn lease 거절과 같다.
- **R3 미리보기.** OpenCode의 적용 전 diff와 Gemini의 `calculateRewindImpact`를 가져온다. 다만 둘 다 저장된 diff를 합칠 뿐 현재 상태와 비교하지 않는다. lophn은 owner CAS를 preview에 넣어 현재와 비교해야 한다. Pi의 branch summary는 복원 내용이 아니라 요약이라 버린다.
- **R4 충돌.** 어느 프로젝트도 이후 변경을 막지 않는다. OpenCode·Gemini는 덮어쓰고, Hermes만 active 집합이 바뀌었으면 전체를 거절한다. lophn의 "하나라도 충돌이면 아무것도 시작하지 않음"은 Hermes의 전체 거절 쪽에 있고, 파일 덮어쓰기는 버린다.
- **R5 새 변경.** 대화 쪽에서 가장 가까운 것은 Hermes의 soft delete와 Gemini의 `$rewindTo` append다. 둘 다 원본을 지우지 않는다. OpenCode의 cleanup 삭제와 Pi의 leaf 이동(원본은 남지만 복원 사실이 없음)은 버린다. 내용을 새 version으로 남기는 방식은 파일 계열에 없다.
- **R6 복원 불가.** Hermes의 `effect_disposition: unknown`과 고정 경고 문장을 가져온다. 읽기 전용은 `none`으로 지워도 된다고 보는 쪽은 버린다. lophn은 외부 효과·activation·secret 사용을 irreversible로 남긴다. Codex·OpenCode·Gemini는 이 구분이 없다.
- **R7 부분 동의.** 해당하는 구현이 없다. 모두 전부 되돌리거나 전부 거절이다. `allow_partial`은 lophn이 새로 만드는 계약이다.
- **R8 한 번만.** Hermes의 "active 집합이 바뀌면 거절"과 Codex의 pointer CAS가 가깝다. lophn은 run당 applied revert 하나와 command 재전송 결과 반환으로 더 강하다. OpenCode의 unrevert는 원본 삭제가 아니라 적용 전 tree 복원이라, 새 변경을 쌓는 lophn에는 해당하지 않는다.
- **R10, R11 앱 revert.** 앱 command를 역순으로 부르는 구현은 없다. Gemini의 "snapshot 실패해도 tool은 계속"은 버린다. lophn은 시작 전 실패는 blocked, 시작 후 실패는 partial·uncertain으로 구별한다. 이 구분을 가진 프로젝트가 없어 결과 표시는 새로 만들어야 한다.

### open-issues 후보

없음. 파일 snapshot 방식은 requirements가 이미 범위 밖으로 정했고, 확인한 동작 중 그 결정을 뒤집어야 할 것은 없었다.

## 구현 메모

### 상태

`reverts.outcome`: `applying`, `applied`, `partial`, `uncertain`, `blocked`.

| 조건 | 결과 |
|---|---|
| 사전 검사에서 conflict 하나 | blocked, 변경 없음 |
| irreversible 있고 동의 없음 | blocked |
| ledger만, 전부 성공 | applied, 한 transaction |
| 앱 단계 있음 | applying 기록 후 역순 호출 |
| 앱 단계 중 실패·응답 유실 | partial 또는 uncertain, 이미 복원된 것은 유지 |
| 앱 성공 뒤 ledger CAS 실패 | partial, ledger는 미적용 |

### 미리보기

`RevertPreview`는 저장하지 않는다. `groups`에 run의 event 전체를 owner별로 넣고 `capability`는 `reversible`, `retained`, `irreversible`, `conflict` 중 하나다. `binding_hash`에 run, source seq, owner CAS, 남는 영향을 담아 적용 때 다시 비교한다. hash가 다르면 내용을 고치지 않고 blocked로 확정한다.

### 앱 단계

`AppRevertBinding`은 원래 invocation, receipt, expected_revision, revert_command, `step_key = (revert id, invocation id)`를 가진다. 호출 전 `step_key`로 기존 invocation을 조회해 중복 호출을 피한다. receipt 원문은 preview에 넣지 않는다.

### 테스트 경계

- failed run과 stopped run의 변경이 목록에 있고, 진행 중 run은 거절된다.
- 문서 둘 중 하나만 이후 version이 있어도 둘 다 그대로다.
- 외부 전송이 있는 run은 동의 전 변경이 없고, 동의 후에도 그 효과는 irreversible로 남는다.
- 같은 command 재전송은 두 번째 version을 만들지 않고 저장된 결과를 반환한다.
- 앱 write 둘: 첫 revert command 성공, 둘째 응답 유실이면 첫째는 restored, 둘째는 uncertain, 문서는 미적용이다.
- 값이 같아도 seq가 다르면 conflict다.

## 미확인 범위

- Codex의 옛 rollout로 되돌리는 command는 찾지 못했다. 파일은 남는다.
- OpenCode `cleanup`의 호출 시점(다음 메시지 접수 때인지 명시 command인지)은 revert.ts 밖이다.
- Gemini의 `EDIT_TOOL_NAMES` 목록은 import 위치만 확인했고 어떤 tool 이름이 드는지 보지 못했다.
- Hermes `effect_disposition`의 전체 값 집합은 `none`, `unknown`, `blocked`만 확인했다.
