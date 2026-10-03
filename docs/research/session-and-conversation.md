---
type: research
concerns: [lophn-agent/conversation]
---
# 세션 저장과 이어가기

## 질문

세션과 확정 메시지를 어디에 어떤 형식으로 남기고, 실행 중 들어온 입력을 어느 turn에 연결하며, 재시작·resume·fork·이어가기에서 무엇을 복제하고 무엇을 버리는가.

## 프로젝트별

### Codex (`3a69ec3ef8fb`)

- 세션은 thread 하나다. 정본은 append-only JSONL rollout이고, SQLite(`state_db`)는 thread 목록·rollout 경로·ordinal projection의 index다. 한 줄은 `RolloutLine { timestamp, ordinal?, item }`이고 item은 `SessionMeta`, `ResponseItem`(user/assistant/tool call/tool output), `TurnContext`, `Compacted`, `EventMsg`, `TokenUsageRecord`, `RetainedContext` 등이다. 근거: `codex:codex-rs/history/src/lib.rs` `enum RolloutItem`, `struct RolloutLine`.
- 메시지와 turn의 연결은 item에 stamp되는 turn id다. `record_conversation_items`가 history에 넣을 때 없는 turn id를 채우고 이미 있는 것은 보존한다. 근거: `codex:codex-rs/core/src/session/mod.rs` `fn record_conversation_items`, `codex:codex-rs/core/src/session/tests.rs` `record_conversation_items_stamps_missing_turn_id_and_preserves_existing_turn_id`.
- 실행 중 입력은 메모리 큐다. `TurnInput`은 `UserInput`(client_id, `acceptance_order`, `origin`), `FunctionCallOutput`, `ResponseItem`, `InterAgentCommunication`다. steer는 진행 중 turn의 다음 model request 직전에 drain되어 `PersistContext::SteeredUserInput`으로 같은 turn에 기록되고, turn 시작 직후에는 fresh 입력을 먼저 sampling한다. 근거: `codex:codex-rs/core/src/session/input_queue.rs` `enum TurnInput`, `codex:codex-rs/core/src/session/turn.rs`의 pending_input drain, `codex:codex-rs/core/src/session/turn_input.rs` `fn steer`.
- steer는 user input만 가능하다. review·수동 compact 같은 `NonSteerableTurnKind`는 `ActiveTurnNotSteerable`로 거절한다. 거절된 steer가 다음 turn으로 넘어가는지는 [미확인]. 근거: `codex:codex-rs/protocol/src/protocol.rs` `enum NonSteerableTurnKind`, `codex:codex-rs/core/src/session/turn_input.rs` `fn steer`.
- 재시작은 rollout replay다. `InitialHistory`는 `New`, `Cleared`, `Resumed(history, history_revision, rollout_path)`, `Forked`다. 메모리 큐의 미처리 입력은 정본이 아니므로 재시작 뒤 다시 입력해야 한다 [확인: 큐가 메모리 구조]. 근거: `codex:codex-rs/history/src/lib.rs` `enum InitialHistory`.
- fork는 원본을 복사하지 않는다. `prepare_fork`가 lineage를 materialize하고 `HistoryPosition { thread_id, end_ordinal_exclusive, end_byte_offset }`로 경계만 잡는다. 경계는 `Latest`, `ThroughTurn`(진행 중 turn은 거절), `BeforeTurn`(시작 경계가 없으면 거절)다. 새 rollout은 그 prefix를 참조하고 원본 파일은 그대로다. 근거: `codex:codex-rs/thread-store/src/local/paginated_fork.rs` `fn prepare`, `fn history_base_at_boundary`.
- 같은 thread의 revert도 새 immutable rollout 파일을 만들고 SQLite의 rollout 경로 pointer만 CAS로 바꾼다. 진행 중이면 거절, pointer가 바뀌었으면 `Conflict`로 새 파일을 지운다. 근거: `codex:codex-rs/thread-store/src/local/revert_thread.rs` `fn revert`.
- cwd는 `SessionMeta.cwd`로 생성 때 고정된다. 세션 중 바꾸는 command는 찾지 못했다 [미확인]. `runtime_workspace_roots`는 "없으면 모름, 빈 배열은 root 없음"으로 구별한다. 근거: `codex:codex-rs/protocol/src/protocol.rs` `struct SessionMeta`.
- 비텍스트는 `UserInput`의 `Image`, `LocalImage`, `Audio`, `LocalAudio`와 text 안의 `text_elements`(byte range marker)다. local 경로는 요청 직렬화 때 data URL로 바뀐다. 근거: `codex:codex-rs/protocol/src/user_input.rs` `enum UserInput`.
- 질문 대기 복제: fork는 history prefix만 가져오므로 진행 중 turn의 미결정 상태는 복제되지 않는다. 대기 상태 자체의 저장 형식은 [미확인].
- 파일 되돌리기용 ghost commit은 제거됐다. `Feature::GhostCommit`(key `undo`)은 `Stage::Removed` no-op이고, rollout의 `ghost_snapshot` 줄은 읽을 때 skip한다. `ThreadRolledBack` event도 "기존 rollout replay용, live rollback 미지원"이다. 근거: `codex:codex-rs/features/src/lib.rs` `Feature::GhostCommit`, `codex:codex-rs/rollout/src/recorder.rs` `fn strip_legacy_ghost_snapshot_rollout_line`, `codex:codex-rs/protocol/src/protocol.rs` `EventMsg::ThreadRolledBack`.

### OpenCode (`907b3bc518fa`)

- 정본은 SQLite다. `session`(id, project_id, directory, path, parent_id, revert JSON, permission JSON, time_archived), `message`+`part`(본문은 JSON blob, 시각 정렬), 그리고 새 `session_message`(session_id, seq unique, type, data JSON)가 공존한다. 근거: `opencode:packages/core/src/session/sql.ts` `SessionTable`, `MessageTable`, `PartTable`, `SessionMessageTable`.
- 메시지 종류는 tagged union이다. `user`(text, files, agents), `assistant`(content 배열: text, reasoning, tool), `system`, `synthetic`, `shell`(command, output, callID), `compaction`, `agent-switched`, `model-switched`. tool은 part가 아니라 assistant content의 `tool` item이고 status는 `pending`, `running`, `completed`, `error`다. 근거: `opencode:packages/schema/src/session-message.ts` `Message`, `ToolState`.
- 실행 중 입력은 durable하다. `session_input`은 prompt, `delivery`(`steer` | `queue`), `admitted_seq`(unique), `promoted_seq`(unique, null이면 미반영)다. steer는 cutoff 이하를 admitted 순서로, queue는 그 다음으로 승격한다. 접수(admitted)와 반영(promoted)이 컬럼으로 갈린다. 근거: `opencode:packages/core/src/session/sql.ts` `SessionInputTable`, `opencode:packages/schema/src/session-delivery.ts` `Delivery`, `opencode:packages/core/src/session/input.ts`.
- 세션 종료는 자동이 아니다. `time_archived`를 사람이 찍고, 음수 timestamp도 받는다(legacy). parent는 `parent_id`로 남는다. 근거: `opencode:packages/opencode/src/session/session.ts` `ArchivedTimestamp`, `setArchived`.
- fork는 메시지 복제다. 원본을 `messageID` 직전까지(없으면 전부) 새 id로 복사하고 assistant의 parentID와 compaction의 tail_start_id를 id map으로 다시 잇는다. 제목은 ` (fork #n)`을 붙인다. 질문·승인 대기 복제는 코드에서 찾지 못했다 [미확인]. 근거: `opencode:packages/opencode/src/session/session.ts` `fn fork`.
- 작업 자리는 `directory`(절대)와 `path`(worktree 상대)다. `setWorkspace`로 workspace만 바꿀 수 있고 directory를 세션 중 갱신하는 함수는 없다 [미확인]. 근거: `opencode:packages/opencode/src/session/session.ts` `fn sessionPath`, `fn setWorkspace`.
- 비텍스트는 user message의 `files`(FileAttachment)와 tool state의 `attachments`, `content`(ToolContent)다. 근거: `opencode:packages/schema/src/session-message.ts` `User`, `ToolStateCompleted`.
- 파일 snapshot은 세션 DB와 별개의 shadow git이다. `track()`이 `git add` 후 `write-tree`로 tree hash만 남긴다(commit 없음). assistant message는 `snapshot.start`(stream 전)와 `snapshot.end`(완료 후)를 갖고, tool 실행 뒤 `patch(hash)`로 바뀐 파일 목록을 patch part로 남긴다. gitdir은 `data/snapshot/<project>/<worktree hash>`다. 근거: `opencode:packages/opencode/src/snapshot/index.ts` `fn track`, `opencode:packages/opencode/src/session/processor.ts`.

### Pi (`83692682f095`)

- 세션 파일 하나는 append-only JSONL이고 첫 줄이 `SessionHeader { version, id, timestamp, cwd, parentSession }`다. 현재 버전은 3. 이후 줄은 모두 `id`, `parentId`, `timestamp`를 가진 entry라 파일이 곧 tree다. 근거: `pi:packages/coding-agent/src/core/session-manager.ts` `CURRENT_SESSION_VERSION`, `interface SessionHeader`, `interface SessionEntryBase`.
- entry 종류: `message`(user, assistant, toolResult, bashExecution, custom), `thinking_level_change`, `model_change`, `usage`, `compaction`, `branch_summary`, `custom`(extension 상태, context 밖), `custom_message`(context 안), `context_edit`, `label`, `session_info`. 근거: 같은 파일 `type SessionEntry`.
- leaf pointer가 현재 대화다. `append*`는 항상 현재 leaf의 자식으로 붙이고 leaf를 전진시킨다. `branch(id)`는 entry를 지우지 않고 leaf만 옮긴다. 다음 append가 그 자리에서 갈라진다. `branchWithSummary`는 버린 경로의 요약을 `branch_summary`로 새 경로 첫 entry에 넣는다. 근거: `pi:packages/coding-agent/src/core/session-manager.ts` `fn branch`, `fn branchWithSummary`.
- context는 leaf에서 root까지 걷되 compaction을 반영하고, `context_edit`가 이전 entry의 content를 바꾸거나 null로 빼며 원본 entry는 그대로다. 근거: 같은 파일 `fn appendContextEdit`, `fn buildSessionProjection`.
- 실행 중 입력은 메모리 배열이다. `streamingBehavior`는 `steer`(interrupt) 또는 `followUp`(대기)이고, UI용 `_steeringMessages`, `_followUpMessages`에서 실제 user message가 시작될 때 제거한다. durable queue는 없다. 근거: `pi:packages/coding-agent/src/core/agent-session.ts` `interface PromptOptions`, `_steeringMessages`.
- 재시작은 파일을 다시 읽어 leaf를 복원한다. 메모리 큐는 사라진다 [확인: 필드가 메모리]. 세션을 닫는 조건은 파일에 없다.
- 새 세션으로 꺼내기: `createBranchedSession(leafId)`가 root부터 그 leaf까지의 경로만 담은 새 파일을 만든다. fork의 출처는 header의 `parentSession` 경로다. 근거: `pi:packages/coding-agent/src/core/session-manager.ts` `fn createBranchedSession`.
- cwd는 header에 한 번 적는다. 오래된 세션은 빈 문자열. 바꾸는 entry 종류는 없다. 근거: 같은 파일 `interface SessionInfo`.
- 비텍스트는 `custom_message.content`의 `ImageContent`와 user message content의 image part다. 근거: `pi:packages/coding-agent/src/core/messages.ts` `interface CustomMessage`.
- 파일 되돌리기는 없다. 대화만 tree로 갈라진다.

### Gemini CLI (`fb972b2f87fe`)

- 세션은 `session-<id>` JSONL이다. 줄 종류는 `MessageRecord`, `MessagePatchRecord`(`$patch`), `MetadataUpdateRecord`(`$set`), `RewindRecord`(`$rewindTo`)다. 메시지 type은 `user`, `gemini`(toolCalls, thoughts, tokens, model), `info`, `error`, `warning`이다. 근거: `gemini-cli:packages/core/src/services/chatRecordingTypes.ts`.
- 메시지 id가 있고 patch는 id로 content·toolCalls·순서·삭제를 고친다. 예전 `$set.messages` 전체 교체는 deprecated로 남아 있다. tool 출력 저장 상한은 50KB(`MAX_TOOL_OUTPUT_SIZE`), 한 화면 window는 최근 50개(`MAX_HISTORY_MESSAGES`)이며 넘는 분은 evict하고 rewind 때는 파일을 다시 읽는다. 근거: 같은 파일, `gemini-cli:packages/core/src/services/chatRecordingService.ts` `fn rewindTo`.
- resume는 같은 파일을 다시 읽는 것이다. `/resume save <tag>`는 logger checkpoint(대화 JSON)를 태그로 저장하고 `/resume resume <tag>`로 불러온다. auth method가 다르면 거절한다. 근거: `gemini-cli:packages/cli/src/ui/commands/chatCommand.ts` `resumeCheckpointCommand`.
- 실행 중 입력의 durable queue는 찾지 못했다 [미확인]. 세션 종료 조건도 명시되어 있지 않고, 내용 없는 시작 세션만 `deleteCurrentSessionIfNotResumableAsync`로 지운다. 근거: `gemini-cli:packages/core/src/services/chatRecordingService.ts`.
- rewind는 대화만 되돌린다. `$rewindTo: messageId`를 append하고 그 메시지부터 뒤를 화면에서 뺀다. 원본 줄은 파일에 남는다. 확인 화면은 그 메시지 뒤의 파일 변경 합계(줄 수, 파일 수, diff)를 tool result에 남은 diff로 계산한다. 근거: `gemini-cli:packages/cli/src/ui/hooks/useRewind.ts`, `gemini-cli:packages/cli/src/ui/utils/rewindFileOps.ts` `fn calculateRewindImpact`.
- 작업 자리는 `directories`(session 중 `/dir add`로 추가)로 누적한다. cwd 고정 필드는 없다. 근거: `chatRecordingTypes.ts` `ConversationRecord.directories`.

### Hermes (`343500b3547e`)

- 정본은 SQLite다. `sessions`는 source, parent_session_id, cwd, git_branch, git_repo_root, ended_at, end_reason, archived, rewind_count를 갖고, `messages`는 autoincrement id, role, content, tool_call_id, tool_calls, tool_name, `effect_disposition`, reasoning 계열, `active`, `compacted`, message_uid를 갖는다. 근거: `hermes-agent:hermes_state_common.py` `SCHEMA_SQL`.
- 역할은 role 문자열이다. `user`, `assistant`, `tool`을 코드에서 확인했다. 시스템 사실은 `system_prompt`가 session 행에 있고 message role로는 보지 못했다 [미확인]. 근거: `hermes-agent:hermes_state_messages.py`.
- 실행 중 입력의 별도 큐 테이블은 없다. 메시지는 `append_message`로 바로 들어가고, 이어가기는 active 행을 다시 읽는 것이다. 근거: 같은 파일 `fn append_message`.
- 세션은 `end_session(end_reason)`으로 닫고 `reopen_session`으로 다시 연다. 자동 만료가 아니라 명시 종료다. parent metadata는 자식이 상속한다. 근거: `hermes-agent:hermes_state_sessions.py` `fn end_session`, `fn reopen_session`.
- 끊긴 turn은 지우지 않고 표시한다. resume 때 dangling `assistant(tool_calls)`나 interrupt marker(`[Command interrupted]`, exit 130)가 있으면, 읽기 전용은 통째로 버리고 side effect 가능성이 있으면 결과를 `effect_disposition: "unknown"`과 "효과 불명, 재시도 전 상태를 확인하라"는 고정 문장으로 바꾼다. 근거: `hermes-agent:agent/replay_cleanup.py` `fn strip_interrupted_tool_tails`, `fn strip_dangling_tool_call_tail`.
- cwd는 세션 컬럼이고 `update_session_cwd`로 갱신한다. git root는 별도 컬럼으로 backfill한다. 근거: `hermes-agent:hermes_state_sessions.py` `fn update_session_cwd`.
- 비텍스트는 content JSON 안에 들어간다. `_encode_content`가 JSON으로 저장한다. 근거: `hermes-agent:hermes_state_messages.py` `fn _encode_content`.

### Claude Code (CHANGELOG 근거, 코드 없음)

- `--resume`은 실행 중인 background 세션을 거절하지 않고 그 세션을 열고, 프롬프트가 있으면 다음 turn으로 보낸다. resume 중 같은 세션이 파일을 다시 쓰면 transcript가 잘릴 수 있어 고친 기록이 있다. 근거: `claude-code:CHANGELOG.md` 376, 16번 근처 항목.
- 끊긴 tool call로 끝난 세션을 resume하면 그 호출을 보여 주고 결과를 알 수 없다고 알린다. 수동 resume는 숨은 "Continue" 메시지를 넣지 않는다. 근거: 같은 파일 739번 근처 항목.
- `/rewind`와 Esc 두 번은 대화 선택 UI다. 요약 옵션의 추가 context는 선택 사항이다. 근거: 같은 파일 5732, 124번 근처 항목.

## 비교

### 저장

| | 정본 | 메시지 구분 | 실행 중 입력 | 접수와 반영 |
|---|---|---|---|---|
| Codex | JSONL rollout + SQLite index | ResponseItem role, EventMsg | 메모리 큐, `acceptance_order` | drain 때 기록, 반영 turn은 stamp |
| OpenCode | SQLite | tagged message type + part | `session_input` 테이블 | `admitted_seq`와 `promoted_seq` |
| Pi | JSONL tree | entry type + message role | 메모리 배열 둘 | 다음 user message 시작 때 제거 |
| Gemini CLI | JSONL append + patch | message type | 없음 [미확인] | patch로 사후 수정 |
| Hermes | SQLite | role 문자열 | 없음, 즉시 append | 행 삽입이 접수 |

### 이어가기

| | 원본 | 가져오는 것 | 진행 중 경계 | 대기 상태 |
|---|---|---|---|---|
| Codex | 유지, 새 rollout이 prefix 참조 | ordinal·byte offset까지 | 진행 중 turn은 fork 거절 | 복제 안 함 |
| OpenCode | 유지 | messageID 직전까지 복제 | 없음 | [미확인] |
| Pi | 유지(같은 파일 leaf 이동 또는 새 파일) | 경로 전체 | leaf면 포함 | 없음 |
| Gemini CLI | 같은 파일, `$rewindTo` append | 태그 checkpoint는 대화 JSON | 없음 | 없음 |
| Hermes | 유지, `active=0` | parent metadata 상속 | rewind는 user turn 단위 | 없음 |

## lophn에 가져올 것과 버릴 것

lophn은 세션·메시지를 ledger(`sessions`, `messages`)와 blob에 두고, 접수와 반영을 `MessageReceived`·`MessageApplied`로 나누며, 이어가기는 복제 없이 원문 구간 참조다. 아래는 그 계약 기준이다.

- **R2 재시작.** OpenCode의 durable 입력 큐와 Hermes의 active 행 재읽기를 가져온다. Codex·Pi의 메모리 큐는 재시작에 죽으므로 버린다. 끊긴 turn 표시는 Hermes의 "효과 불명" 문장을 가져오되, 원문 결과를 고쳐 쓰지 말고 별도 표시로 남긴다. lophn은 메시지 본문이 불변이다.
- **R3, R5 접수와 반영.** OpenCode의 `admitted_seq`/`promoted_seq`가 lophn의 접수·`applied_at_call`과 가장 가깝다. Codex의 `acceptance_order`는 반영 순서를 입력에 고정하는 방식으로 가져온다. Pi의 메모리 배열 제거 방식은 버린다.
- **R6, R7 다음 요청과 종료 경합.** OpenCode의 `delivery: steer|queue` 구분을 가져온다. steer는 현재 run, queue는 다음 run이라는 점이 lophn의 `correction`/`request`와 같다. 종료 경합을 DB 제약으로 막는 구현은 다섯 프로젝트 모두에서 찾지 못했다. lophn의 "정확히 한 run"은 writer transaction으로 직접 만들어야 한다.
- **R8 종료.** Hermes의 명시 `end_session`과 OpenCode의 `time_archived`처럼 자동 만료가 없는 쪽을 가져온다. 다섯 프로젝트 모두 유휴 자동 종료가 없다.
- **R9 이어가기.** Codex의 "원본 유지 + 경계 참조"와 Pi의 "경로만 새 파일"이 lophn의 `Continuation(session, through_seq)`와 같다. OpenCode의 메시지 복제는 버린다. 질문·승인 대기를 복제하는 프로젝트는 없었다.
- **R14 paused 보존.** 입력만 저장하고 run을 만들지 않는 형태는 없다. OpenCode의 `promoted_seq = null`이 가장 가까운 재료다. 재개 자동 실행은 어느 쪽에도 없다.
- **R16, R17 작업 자리.** 다섯 프로젝트 모두 cwd를 세션 값으로 갖고, 세션 중 바꾸는 API는 Hermes의 `update_session_cwd`뿐이다. lophn의 "다음 call부터" 적용과 과거 call 불변은 어느 쪽에도 없다. `SessionWorkPlaceChanged`를 call snapshot과 따로 남기는 현재 계약이 맞다.
- **R12, R13 비텍스트.** 본문 배열에 순서대로 넣는 점은 OpenCode의 assistant content, Pi의 content 배열과 같다. Gemini의 사후 patch로 본문을 고치는 방식은 불변 계약과 맞지 않아 버린다.

### open-issues 후보

없음. 확인한 범위에서 requirements와 반대로 동작해야 할 근거는 없었다.

## 구현 메모

### 자료

- `sessions`: id, assignment, work_place, work_place_revision, state, continued_from_session, continued_from_through_seq, closed_reason, closed_at.
- `messages`: id, session, created_seq, actor, body(blob), run, mode, applied_at_call. 본문 blob은 `{schema_version, parts: [{kind: text|visual, ...}]}`.
- 입력 한 건의 수명: 접수(`MessageReceived`, run 연결) → 반영(`MessageApplied`, call 하나) → 담당 변경(`MessageAssigned`, 종료 경합 또는 paused 실행 선택). 각 전이는 한 번이다.

### 상태

| 사건 | 세션 | 메시지 |
|---|---|---|
| OpenSession | open | |
| ReceiveMessage enabled | | run 확정, applied null |
| ReceiveMessage paused request | | run null |
| StartModelCall | | applied_at_call 설정 |
| 종료 경합 | | AssignMessage로 run 하나 확정 |
| CloseSession | closed | 새 입력 거절 |
| ExecuteStoredRequest | | 같은 message에 run 하나 |

### 경계

- 같은 message id 재전송: 같은 본문이면 기존 결과, 다르면 conflict.
- 종료 직전·직후 두 입력: 서로 다른 run 하나씩, 어느 쪽도 유실 없음.
- paused 입력 두 번 실행 선택: message 하나, run 하나.
- 이어가기: 새 세션의 메시지 수가 0이고 continued_from만 채워져 있다. 원본 세션의 질문·approval은 그대로다.
- 작업 자리 변경: 진행 중 call의 context_basis는 옛 자리, 다음 call부터 새 자리.
- visual part가 포함된 답: 재시작 뒤 parts 순서와 출처가 같다. stream 조각은 행이 없다.

## 미확인 범위

- Codex에서 거절된 steer가 다음 turn 큐로 남는지는 turn_input.rs의 `NotSubmitted` 처리 이후를 끝까지 보지 못했다.
- OpenCode fork가 질문·승인 대기를 복제하는지는 session.ts `fn fork`의 메시지 복사만 확인했다.
- Gemini CLI의 실행 중 입력 큐는 chatRecordingService와 slash command에서 찾지 못했다.
- Hermes의 system role 메시지 존재는 schema의 role TEXT만 확인했다.
