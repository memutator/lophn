# event (S1) 구현 목록 (2026-10-15)

기준 코드: main `acfe4cc3`. 본 설계: `tmp/specs/event.md`(S1, 확인됨), docs-review "S1 event 핑퐁", req-0083, 0085, 0086, 1494, 1498. event는 요구 파일이 따로 없다(spec이 정본). 코드는 읽기만 했고 실행하지 않았다.

지금 코드를 한 줄로: ledger가 **모든 domain 변경의 event type 약 155개**를 쌓고(`packages/protocol/**`의 `defineEvent`), 그 ledger를 seq cursor로 읽는 구독이 core 안 반응(internal subscription)과 바깥 구독(WebSocket)을 모두 먹인다. 같은 `events` 표를 상태 조회로도 읽는 곳이 약 42개 파일이다. renderer는 event를 직접 받지 않고 3초 polling이다. 새 설계는 이것을 Ledger(domain event 10개, Reactor만 읽음) + Bus(메모리) + Gateway(조건 구독, snapshot 먼저)로 가른다.

## 덜어낼 것

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| 화면·외부가 ledger를 읽는 길 `events/list` read와 그 schema(`eventsList`, `after_seq`, `types`, `subjects`, 배치 한도) | S1 12장, 13장 "Ledger를 화면이나 외부 구독자가 읽는 것" | `packages/core/events/list.ts`, `packages/core/events/backend.ts`, `packages/protocol/events/events.ts`(eventsList 부분), `packages/core/storage/ledger/reader-registration.ts`(ListEvents gate) | 읽는 쪽은 Reactor와 안쪽 snapshot뿐. `actors: user, coding_agent, agent, app, machine`이 모두 읽을 수 있던 길이다 |
| event 공개 정책(visibility) 장치 전부 | S1 13장 (ledger를 사람·agent·app이 읽지 않음). 정책을 걸 대상이 없어진다 | `packages/core/events/visibility.ts`, `packages/core/events/operations.ts`(`eventOperations`), `packages/protocol/server/registration.ts`의 `EventVisibilityDefinition`, 각 module의 `createEventRegistration`(`core/apps/register.ts`, `core/projects/register.ts`, `core/problems/register.ts`, `core/apps/tickets/register.ts`, `core/lophn-agent/register.ts`, `core/main/daemon/platform-register.ts`), `core/storage/ledger/reader-worker.ts`·`reads.ts`의 registry 모음, `platform-register.ts`의 `notificationsOnlyVisibility`·`assignmentReactionsOnlyVisibility`·`userNotificationVisibility` | Gateway가 누구에게 무엇을 줄지는 새로 정한다(새로 만들 것 "Gateway 인증"). 이 정책 표는 안 쓴다 |
| 이름 있는 구독의 ack 저장(named subscriber, ack frame, `derived/api-subscriptions`) | S1 6장·4장 (agent event에 seq 없음, 놓치면 snapshot), 13장 "agent event의 저장과 replay" | `packages/core/events/subscription-store.ts`, `subscription-store-worker.ts`, `packages/core/events/subscriber-registration.ts`(`createSubscriberGate`), `packages/protocol/events/stream.ts`의 `ackFrameSchema`·`subscriber` 칸, `core/main/daemon/runtime.ts`(store 생성 ~231행) | renderer는 cursor를 저장하지 않는다 |
| core 안 구독자용 internal subscription(machine principal, WebSocket 대신 함수 sink) | S1 3장 (Reactor가 Ledger를 직접 이어 읽는다, 안쪽 반응이 외부 구독과 같은 session을 쓸 이유 없음) | `packages/core/events/internal-subscription.ts`와 그 시험, 쓰는 곳: `core/notifications/loop.ts`, `core/lophn-agent/assignments/reactions.ts`, `core/apps/tickets/checker/connection.ts`, `core/problems/grouping/connection.ts`, `core/problems/closing/connection.ts`, `core/projects/file-tracking/coordinator/feed.ts` | 쓰던 여섯 구독자의 대신은 "고칠 것" 각 줄에 있다 |
| 사람 token 자격으로 events 재생(from_seq 포함, catch-up replay) | S1 4장 (agent event는 메모리, 순서 보장은 한 연결 안), 8장 "놓친 toast는 다시 띄우지 않는다" | `packages/core/events/subscribe.ts`의 `resolveSubscriptionStart`, 재생 루프(`replay`), `createEventDispatcher`, `EVENT_BATCH_LIMITS` 쓰임 | Gateway를 새로 쓰면 이 session 상태 machine은 필요 없다. 재연결 정책(backoff)만 shell main 쪽에서 살린다 |
| ledger에 쓰는 agent 일생 event 정의와 emit | S1 12장 "agent 일생: `Run*`, `ToolCall*`, `ModelCall*`, `Message*`, `Session*`"; 6장 agent event는 메모리 | 정의: `protocol/lophn-agent/runs.ts`(RunAccepted/Started/Finished), `run-wait.ts`(RunWaited/Resumed/Recovered), `tool-calls.ts`(5), `model-calls.ts`(3), `messages.ts`(4), `sessions.ts`(11). emit: `core/lophn-agent/run-loop/commands.ts`, `tools/commands.ts`, `session/commands.ts`, `session/message-commands.ts`, `session/compact.ts`, `session/fork.ts`, `waiting-and-recovery/commands.ts` | 대화 기록 자체는 session 기록으로 옮긴다(그 저장은 S8·run-loop 영역). 여기서는 "ledger에 event로 쓰기"를 지운다 |
| 질문·되돌리기·assignment·provider·model·agent 정의의 ledger event | S1 12장 "150개 → 10개"; 5장 "domain event가 아닌 것" | `protocol/lophn-agent/questions.ts`(QuestionCreated/Answered/Expired/Cancelled), `reverts.ts`(7), `assignments.ts`(4), `providers.ts`(3), `models.ts`(2), `agents.ts`(3), `mcp-settings.ts`(1) 및 각 emit | `Question*`은 agent event `QuestionAsked/Resolved`로 대신한다(새로 만들 것). assignment는 S4가 지운다 |
| 지운 개념과 상태 일생 event: Document*, Series*, Snapshot*, Version*, FileWritten 등 | S1 12장 | `protocol/projects/document-events.ts`(9), `series.ts`(9), `files.ts`(3), `projects.ts`(5), `protocol/problems/snapshots.ts`, `fixes.ts`(ProblemFixRecorded), `tests.ts`(VerificationRecorded), `closing.ts`의 ProblemConfirmationRecorded, `problems.ts`(ProblemWork*, InterpretationLinked), `reports.ts`의 ReportRecorded·ProblemObserved | 이 event를 상태로 읽는 곳이 같이 바뀐다. "고칠 것"의 `events` 표 읽기 줄 참고 |
| 앱·release·ticket·context의 상태 event | S1 5장 "domain event가 아닌 것" (release 준비, activation 성공, 앱 시작·멈춤, 위반 고쳐짐, context 판 적용·되돌림, saved view, 용어집, claim 시작·갱신·반납) | `protocol/apps/apps.ts`(5), `grants.ts`, `invocations.ts`(4), `releases.ts`(ReleasePrepared, ActivationStarted, BackupRecorded, DataChanged, DataRestored, Activated, Superseded), `runtime.ts`(AppExecution*, AppStarted/Stopped/Unavailable), `package-routes.ts`, `protocol/coding-agent/ticket-claims.ts`(TicketClaimed/Renewed/Released/ChecksRecorded/CheckFailed/Cancelled), `ticket-routes.ts`, `protocol/projects/context-api.ts`(위반 둘 빼고 14), `secrets.ts`, `config/settings.ts`, `coding-agent/connections.ts` | `ReleaseActivated`·`GrantCreated/Revoked`는 shell main이 읽는다(`main.ts` `refreshAppViews`). "고칠 것" 참고. invocation 기록은 S5가 정한다 |
| `ApprovalRequest*` ledger event 다섯 | S1 12장 "상태 일생: ApprovalRequest* (→ 표, ApprovalRequested, ApprovalDecided)" | `protocol/approvals/approvals.ts`(Created/Granted/Rejected/Expired/Cancelled), emit `core/approvals/commands.ts` | Granted·Rejected·Expired·Cancelled 넷은 `ApprovalDecided` 하나로 모인다("고칠 것"). Created는 `ApprovalRequested`(남지 않는 event)로 바뀐다(02와 함께) |
| 옛 notification 모듈 전부: 계기 표, 엔진, 루프, 표, `NotificationCreated/Read`, Ask 값 | S1 13장 ("core가 toast를 정하는 것(`notice`)" 하지 않음), 8장 (toast는 renderer 정책), changes-by-topic platform/notifications 보류 | `packages/core/notifications/*`(commands, engine, loop, model, store, schema, reads, delivery, ask-agent, os-display), `packages/protocol/notifications/*`(`NOTIFICATION_TRIGGERS`가 `TicketConfirmed`·`AssignmentPaused`·`ProblemClosed`·`QuestionCreated`·`ApprovalRequestCreated`·`ContextViolationsRecorded` 같은 지울 event 이름을 가리킨다), `core/main/daemon/platform-register.ts`·`runtime.ts`의 notifications 조립, `notifications` 표(`source_seq references events`) | **보류의 뜻이 "코드도 지운다"인지 사람 확인이 없다**(아래 "문서끼리 어긋난 것" 5). 지우지 않아도 엔진이 읽는 event가 사라져 그대로는 못 돈다. 추천은 지운다. `notifications` 표는 개발 데이터라 schema step째 지운다 |
| OS notification 표시(shell main) | 요구에 없다(grep). S1에 없다. changes-by-topic platform/notifications 보류 | `packages/shell/main/desktop/os-notification.ts`(NotificationCreated만 본다), `packages/shell/main/desktop/main.ts`의 `osNotifications` 조립·`arrived` 연결, `packages/shell/ipc/notifications.ts`, `packages/core/config/shell-settings.ts`(`shell.os_notifications`), `core/notifications/os-display.ts`·`delivery.ts` | 위 줄과 같이 "보류=지운다"일 때. 아니면 toast와 별개로 따로 설계해야 한다(확인 못함) |
| `ContextViolationsHandedOff` event와 그것을 상태로 읽는 코드 | S1 5장 (위반이 생기면 `ContextViolationFound` → Reactor가 Project Manager를 부른다. 넘김 기록 event 없음), 13장 | `protocol/projects/context-api.ts`(contextViolationsHandedOffEvent), `core/projects/contexts/api/commands-violations.ts:112`, 읽는 곳: `contexts/api/reads-lists.ts:44`, `contexts/ledger/rows-events.ts`, `contexts/ledger/adapter-load.ts:59` | contexts 영역과 겹친다. "넘겼는지" 표시를 UI가 쓰는지 확인 못함 |
| 노출용 `events.run` 칸과 run 색인 | S1 4장 envelope(`seq, type, subject, actor, at, payload`)에 run이 없다 | `packages/core/storage/ledger/schema.ts`(`events.run`, `events_run_seq`), `protocol/events/events.ts`(envelope `run`), `core/storage/ledger/tx.ts`(emit의 run) | actor는 남는다. run은 session·turn 기록에 있다 |

## 고칠 것

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| ledger `events` 표 역할 | 모든 변경의 사실 + 상태 조회 근거 → domain event 10개만, Reactor만 읽는다. append-only 유지 | S1 3장 Ledger, 5장 | `packages/core/storage/ledger/schema.ts`(`events`, `command_results.first_seq/last_seq`) |
| `events` 표를 상태로 읽는 곳을 domain 표 읽기로 | "type이 X인 마지막 행"으로 현재 상태를 알던 것 → 각 concern의 표를 읽는다 | S1 11장 "domain 상태: 각 concern의 표", 13장 | 약 42개 파일이 `from events`를 쓴다. 영역별: `core/apps/{runtime,tickets,permissions,releases/activation,invocations}`, `core/problems/{grouping,closing,repairs,reporting,snapshots,tests}`, `core/lophn-agent/{session,run-loop,tools,waiting-and-recovery,assignments,models,observability}`, `core/projects/contexts/ledger`, `core/approvals/apply.ts`, `core/config/question-evidence.ts`, `core/storage/{ledger/approval-use.ts,ledger/command-outcome.ts,migration/{restart,backup,backup-reads}.ts}` | 각 영역이 자기 표로 옮긴다. 여기서는 이 목록을 넘기는 것까지가 일이다. 하나라도 남으면 event를 지울 수 없다 |
| `blob_refs.registered_seq`와 `notifications.source_seq`의 `references events (seq)` | 모든 소유 변경이 event를 쓴다는 가정 → event 없는 변경에도 blob 참조를 등록할 수 있게 | S1 5장(대부분의 변경은 event 없음) | `packages/core/storage/ledger/schema.ts`(blob-refs step), `core/storage/ledger/tx-ports.ts`·`erase.ts` |
| 반응 cursor와 반응 idempotency | 이름 있는 구독자가 `AdvanceSubscriberCursor` command로 올림 → Reactor 하나의 cursor와 "처리 결과" 표. `reactionKey = (subscriber, cause_seq, reaction)`은 handler 단위 키로 살린다 | S1 3장 Reactor, 4장 보장 | `protocol/events/events.ts`(`advanceSubscriberCursor`, `reactionKeySchema`), `core/storage/ledger/reaction.ts`, `commands.ts`, `tx.ts`(`advanceSubscriberCursor`), `subscriber_cursors` 표, `writer-registration.ts` |
| WebSocket 구독 frame과 route | `subscribe`(from_seq/types/subjects/subscriber/limit), `events`(seq 범위), `ack` → 조건(session, 종류)을 거는 `subscribe`, snapshot 읽기는 read API, 서버가 Bus event를 보낸다. 서브프로토콜 이름과 버전도 바꾼다 | S1 3장 Gateway, 4장 구독 | `packages/protocol/events/stream.ts`(`lophn.events.1`, `subscribeFrameSchema`, `eventsFrameSchema`), `packages/core/server/socket.ts` |
| shell main의 event 구독 | main이 ledger를 `events.list`로 따라잡고(cursor) 이어 WebSocket으로 받아 `arrived`로 OS notification과 app view만 먹인다 → renderer가 쓸 event client로 바꾼다. 끊김 backoff·`stale` 상태·epoch·generation 처리는 살린다. cursor와 catch-up read는 뺀다 | S1 8장 | `packages/shell/main/desktop/core/events.ts`, `core/connection.ts`(`arrived` 연결), `main.ts:347` |
| 앱 frame 새로고침 신호 `refreshAppViews` | `GrantCreated/GrantRevoked/ReleaseActivated` ledger event를 main이 읽고 `appFrame.refresh` → 이 event들이 사라지므로 다른 신호 | S1 5장(없는 event), S5 | `packages/shell/main/desktop/main.ts:946-957` |
| `ContextViolationsRecorded`(앞뒤 count) → `ContextViolationFound`(새로 생김) | "위반 수가 늘었을 때만" 계기이던 것을 "계약 위반이 새로 생김" 한 건으로. payload에 project·context·위반 근거를 싣는다 | S1 5장 | `protocol/projects/context-api.ts`(contextViolationsRecordedEvent), `core/projects/contexts/api/commands-violations.ts:49`, `core/projects/file-tracking/coordinator/events.ts:142` |
| `TicketConfirmed` → `TicketVerified`, `TicketCheckFailed`는 event에서 뺀다 | 확인됨은 App Engineer가 정한다. 확인됨 tx가 `TicketVerified`를 남기고 activation handler가 연다 | S1 5장, S7 5장, req-1507 | `protocol/coding-agent/ticket-claims.ts`, `core/apps/tickets/checks.ts:484`, `core/apps/tickets/register.ts` |
| `TicketClaimReleased(reason=expired)` → `TicketClaimExpired` | claim 시작·갱신·반납은 event가 아니다. 기한이 지나 정리됨만 call 닫음 사실로 남긴다. `returned`, `connection_revoked`는 event가 아니다 | S1 5장 | `protocol/coding-agent/ticket-claims.ts:258-266`, `core/apps/tickets/claims.ts`, `core/apps/tickets/expiry.ts` |
| `ApprovalRequestGranted/Rejected/Expired/Cancelled` → `ApprovalDecided` | 결정과 같은 tx에 하나의 event. 그 request 종류의 handler가 다시 검사하고 실행한다 | S1 5장, 9장 6번, S2 | `protocol/approvals/approvals.ts`, `core/approvals/commands.ts`(02와 겹침) |
| `ProblemOpened`/`ProblemReopened`의 emit 조건과 payload | 앱·report 정보를 싣고 있다 → Reactor handler가 "그 앱의 App Engineer 새 session"을 만들 수 있는지(app이 payload나 subject로 닿는지) 확인하고 맞춘다 | S1 5장 | `protocol/problems/reports.ts:301`, `closing.ts:167`, `core/problems/grouping/commands.ts`, `core/problems/closing/commands.ts` |
| `ReleaseActivationFailed`, `TicketCompletionReported` | 이름은 그대로 두고 payload가 handler 필요(그 release의 App Engineer, 맡긴 call)를 채우는지 확인 | S1 5장 | `protocol/apps/releases.ts:632`, `protocol/coding-agent/ticket-claims.ts:279`, `core/apps/releases/activation/*`, `core/apps/tickets/report.ts` |
| command 층의 event 쓰기 | 모든 command가 `tx.emit`(약 200곳, 약 55개 파일)으로 사실을 쌓음 → domain event 10개의 command만 emit한다. 나머지 `tx.emit`는 지운다 | S1 3장 command 층 | `packages/core/**/commands*.ts` 전반(`grep "\.emit("`). 예: `series/commands.ts` 9, `lophn-agent/tools/commands.ts` 9, `versions/commands.ts` 8 |
| commit 뒤 Bus 배포 | 지금 writer가 commit 뒤 `wake`를 돌려주고 dispatcher가 reader로 다시 읽는다 → commit 뒤 그 tx의 domain event를 Bus로 낸다 | S1 3장 | `packages/core/storage/ledger/writer-message.ts`(`wake`), `core/main/daemon/runtime.ts:484`(`dispatcher.wake`) |
| run 출처 `message`, `handoff` → Router 입력의 보낸 쪽(사람, program과 근거 seq, agent session) | 03과 겹친다. S1 12장은 지울 옛 것으로, S3가 봉투를 정한다 | S1 12장, 9장 2번 | `packages/protocol/lophn-agent/run-values.ts:42-60`, `core/storage/ledger/run-admission.ts`, `core/lophn-agent/run-loop/prepare.ts` |
| 트레이스 읽기·내보내기(observability) | `runs/events/model_calls/tool_calls/messages`에서 trace를 조립(event seq·type·`RunWaited` 시각 포함) → agent event를 저장하지 않으니 조립 근거를 session 기록에서 가져온다. 어디에 남길지는 정하지 않았다 | changes-by-topic 7장 "trace 저장", S1 6장, 13장 | `packages/core/lophn-agent/observability/{reads,model,work,export,trace-export,retention}.ts`, `protocol/lophn-agent/traces.ts` |
| waiting-and-recovery의 "복구" 반쪽 | 중단된 run을 ledger의 run·model call·tool call 사실로 경계를 재구성해 같은 run을 잇는다 → 켤 때 돌던 turn을 interrupted로 닫고 대기 권한 요청·질문은 cancelled로 둔다. 다시 잇지 않는다 | S1 10장, changes-by-topic waiting-and-recovery | `packages/core/lophn-agent/waiting-and-recovery/{recovery.ts,recovery-work.ts}`(약 1190줄), `run-loop/prepare.ts:849`, `protocol/lophn-agent/run-wait.ts`(`recoverRun`, `RunRecovered`) |
| notification 계기 trigger 목록과 겹친 domain event 정의 위치 | event 정의가 소유 concern마다 흩어짐(`defineEvent` 155곳) → 남는 10개를 정의한 곳이 어디인지 code-map이 정한다 | S1 8장 "모듈 이름과 위치는 code-map이 정한다" | `packages/protocol/**`(현재 소유 concern별 파일) |
| Gateway가 받는 principal | 구독자가 user, coding_agent, app, machine을 가리지 않음 → renderer(사람)만 | S1 3장 Gateway | `core/server/socket.ts`, `core/events/subscribe.ts`의 `current()` 재검사 |
| internal subscription 쓰던 구독자 여섯의 대체 | 각각 깨움 신호를 ledger의 지울 event에서 받음 → 새 구조에서 받을 곳을 정한다. (1) `assignments/reactions.ts`(AppCreated 등): assignment 상태 machine 자체가 사라짐(S4)이라 지움. (2) `tickets/checker/connection.ts`(TicketCompletionReported·ReleaseActivated·Problem* 신호): 새 `TicketVerified` 흐름과 맞춘다(06·07). (3) `problems/grouping/connection.ts`·`closing/connection.ts`(`problems.work`·`problems.closing` cursor): problem 영역에서 필요한지 결정. (4) `file-tracking/coordinator/feed.ts`(Project*, Document* event를 깨움으로 씀): domain event 10개에 이 event들이 없으므로 깨움 신호를 Bus의 남지 않는 event로 둘지, 직접 호출로 둘지 정한다(spec에 없음, 확인 못함 참고) | S1 5장, 7장, 13장 | 위 파일들 |
| `ProblemOpened` 열림이 notification 대상이던 조건 `operational_report` | notification 쪽 조건 필터였다 → handler는 reaction grant(S2)만 본다 | S1 5장 | `core/notifications/model.ts`의 `conditionMet` |

## 새로 만들 것

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| Bus | core 안 메모리 pub/sub. agent event, commit 뒤 domain event, 남지 않는 event를 싣는다. topic 없이 event 칸(session, 종류) 조건으로 구독. 느린 구독자는 끊는다. 지금 코드에는 pub/sub이 없다(`grep`로 확인) | S1 3장 Bus | `packages/core/events/`(code-map이 정한다) |
| agent event 정의와 envelope | `SessionStarted`, `MessageReceived`, `TurnStarted`, `TurnEnded(completed/failed/interrupted)`, `ToolCallStarted/Ended`, `PermissionRequested/Resolved`, `QuestionAsked/Resolved`, `CompactStarted/Ended`, `SessionEnded(reason)`. envelope: `session, type, at, payload`. 되살림은 `SessionStarted` payload에 적는다 | S1 4장, 6장 | `packages/protocol/events/` (지금은 ledger envelope 하나뿐) |
| lophn agent run-loop이 agent event를 Bus에 내기 | turn 시작·끝, tool call, compact, 사람 메시지(steer면 도는 turn 안 `MessageReceived`), 대기 물음을 Bus에 낸다. 대화 기록은 session 기록에 쓴다 | S1 3장 Run-loop, 6장, 9장 1·5·7번, req-1509, 1510 | `packages/core/lophn-agent/run-loop/` |
| `QuestionAsked`/`QuestionResolved` 흐름 | 묻는 tool 호출 때 snapshot에 질문을 두고 event를 낸다. 답, 그 session에 온 사람 메시지, turn의 끝으로 풀린다. 풀리면 답이나 메시지가 tool 결과로 간다 | S1 6장, 9장 7번, req-1510 | `core/lophn-agent/tools/questions/`(S4 몫 tool과 맞물림) |
| `PermissionRequested`/`PermissionResolved` | turn gate에서 물음을 받으면 snapshot에 대기 요청을 두고 event를 낸다. 사람이 답하면 turn이 이어 간다 | S1 9장 5번, S2 | run-loop + Gate(02) |
| session snapshot | 지금 상태(running, waiting, idle, unknown)와 대기 중인 권한 요청·질문을 담는 read. core가 agent event에서 계산한다. coding agent는 harness가 알려 준 것만 바꾸고 없으면 unknown | S1 4장, 6장 | `core/lophn-agent/session/` 읽기 쪽. 지금은 coding agent 상태를 shell main 메모리(`ObservationStore`)가 가진다(06과 맞춘다) |
| Gateway | WebSocket 입구. 연결 때 인증하고 renderer가 건 조건(session, 종류)으로 Bus를 걸러 보낸다. 끊겼다 붙으면 renderer가 snapshot부터 다시 읽는다. 같은 event를 두 번 내지 않는다 | S1 3장, 4장 구독 | `packages/core/server/socket.ts`를 고쳐 쓴다(위 "고칠 것") |
| Reactor | Ledger를 cursor로 이어 읽고 event 종류마다 handler를 부른다. idempotency key로 두 번 반응하지 않는다. 꺼졌다 켜지면 cursor 뒤부터 | S1 3장, 10장 | `packages/core/events/`(code-map이 정한다) |
| 새 일 handler(다섯 event 공통) | reaction grant(S2)를 본다. 꺼짐이면 부르지 않음, 열고 묻지 않음이면 Router에 call(`from` program과 근거 seq, `to` 새 session의 role과 place, `reply` none), 물음이면 보류 request. 받는 곳: ProblemOpened/Reopened, AppRestartHalted, ReleaseActivationFailed → 그 앱의 App Engineer, ContextViolationFound → 그 project의 Project Manager | S1 5장, req-1494 | Reactor handler. Gate는 02, Router 입력 꼴은 03 |
| call 닫음 handler(세 event 공통) | `TicketCompletionReported`, `TicketClaimExpired`, `CodingSessionEndedUnreported`: 맡긴 App Engineer session(열린 session, 없으면 새 session)에 call을 보내고 같은 일 안에서 그 call 상태를 닫는다. 끌 수 없다 | S1 5장, S3, req-1494 | Reactor handler. `agent_calls`는 03 |
| 새 domain event `AppRestartHalted` | 짧은 시간에 거듭 죽어 자동 재시작을 멈출 때 한 번 낸다. 지금은 crash loop를 problem 관측으로만 보낸다 | S1 5장 | `packages/core/apps/runtime/supervisor/supervisor.ts`(`runtime.held = CRASH_LOOP`, ~550·605행)와 `observations/crash.ts`. 새 event 정의는 `protocol/apps/runtime.ts` |
| 새 domain event `CodingSessionEndedUnreported` | 완료 보고 없이 coding agent session이 끝났을 때. lophn이 꺼져 터미널 탭이 끝난 경우도 시작 때 낸다(token 회수, claim 반납 후) | S1 5장, 10장 | coding-agent 세션 끝 처리(06과 겹침). 지금 코드에 같은 event 없음 |
| `ApprovalRequested`(남지 않는 event) 배포 | 보류 request를 표에 쓰고 commit한 뒤 Bus에 낸다. envelope: `type, subject, at, payload` | S1 7장, 9장 6번 | `core/approvals/commands.ts` commit 지점(02와 겹침) |
| 시작 때 정리 | 켤 때 돌던 lophn agent turn을 interrupted로 닫고 그 turn의 대기 권한 요청·질문을 cancelled로 둔다. coding agent는 unknown으로 시작 | S1 10장 | run-loop 시작 경로. 지금의 `recoverRunFromLedger`를 대신한다 |
| 비교적 작은 시험 도구: Bus·Reactor·Gateway 시험용 fake | 구독 조건, 순서(한 연결 안), 중복 반응 없음, 재시작 뒤 cursor 이어짐을 시험한다 | S1 4장 보장, S1 4장 보장 | `packages/core/events/testing/`, `packages/core/testing/` |

## UI 덜어낼 것

| 항목 | 근거 | 지금 코드 | 비고 |
|---|---|---|---|
| notification chip(창 오른쪽 아래, 읽지 않은 notification 목록) | notification 기록 보류, S1 13장 | `packages/shell/renderer/desktop/notification-chip/notification-chip.tsx`, `notification-chip.module.css`, `notification-chip_test.tsx`, 마운트 `desktop/main.tsx:307` | 대기 목록(req-1498)이 사람을 부르는 일을 맡는다 |
| notification Ask toast(`AskAgentToast`)와 `NoticeAsk`, `AskView`·`AskRequest` 값 | notification의 [Ask]는 notification 행 값으로 만든 것. toast의 agent 부르기는 반응 층이 대신한다(req-0085) | `renderer/desktop/notification-chip/ask-agent-toast.tsx`(+`_test.tsx`), `renderer/workspace/notice-ask.tsx`(+`_test.tsx`), `renderer/workspace/ask-view.ts`, `renderer/workspace/testdata/ask-agent.ts` | 둘 다 시험 밖에서 부르는 곳이 없다(grep) |
| `things-to-confirm`의 notification 읽음·chip 쪽 | notification 보류 | `renderer/desktop/lophn-space/things-to-confirm/source.ts`(`NotificationRow`, `unread`, `markRead`, `Overview.notifications`), `model.ts`의 `chipQueue`, `labels.ts`의 `noticeTitle`·event 이름 문구, `core-source.ts`의 notification 읽기 | 질문·approval 쪽은 02·대기 목록 영역. 화면 자체의 운명은 넘김 |

## UI 고칠 것

| 항목 | 지금 → 바뀔 모양 | 근거 | 지금 코드 |
|---|---|---|---|
| context 목록 감시 hook | 30초마다 목록을 읽어 `violation_mark`가 늘면 toast를 부름 → 위반 알림은 `ContextViolationFound`를 반응 층이 받는다. 이 hook에서는 toast 판정(`onViolations`)을 뺀다. 목록 읽기(`list`)와 `onDrafting`은 contexts 영역이 정한다 | S1 8장 반응 표, 12장, req-0086 | `packages/shell/renderer/workspace/contexts/context-watch.ts`, 쓰는 곳 `workspace/workspace.tsx:211-229` |
| 계약 위반 toast | 작업대가 state(`toasts`)로 들고 inline으로 그림, "context당 하나", `data-violation-toasts` → overlay toast. [Ask]는 위반을 붙여 **그 project의 Project Manager**를 연다. 문구 key는 그대로 쓸 수 있다 | S1 8장, req-0083, 0085 | `renderer/workspace/contexts/violation-toast.tsx`, `workspace/workspace.tsx:919-960`(`openRole("context_engineer"` 포함) |
| 결정 대기 개수 pill과 공간 크롬 | 3초마다 `overview()`를 읽어 질문·approval 수를 센다 → 대기 목록 store에서 센다. core 끊김 안내(`connection`)는 그대로 | S1 8장, req-1498 | `renderer/desktop/notification-chip/space-decisions.tsx`(`useRequestOverview`, `WaitingPill`, `SpaceDecisions`), 쓰는 곳 `desktop/launcher/launcher.tsx`, `launcher/project-card.tsx`, `workspace/workspace.tsx`, `app-frame/app-space.tsx` |
| Agent 화면 데이터 읽기 | 3초 polling으로 agent·sessions·thread·notices를 다시 읽음 → 열린 대화 탭은 그 session의 agent event를 받고, 처음과 다시 붙을 때만 snapshot을 읽는다. "다시 붙으면 놓친 진행을 하나씩 다시 보이지 않고 현재 기록으로 맞춘다"는 동작은 그대로다 | S1 4장, 8장 구독 | `renderer/conversation/agent-view-data.ts`(`POLL_MS`, `useAgentData`), `agent-view.tsx`, `window-deps.tsx`, `agent-source.ts` |
| 대기 목록 데이터 읽기 | `ticks`(3초)로 `overview`를 읽음 → store | 위와 같음 | `renderer/desktop/lophn-space/things-to-confirm/context.tsx`(`POLL_MS`, `intervalTicks`), `core-source.ts`(`events.list`로 seq·시각을 읽는 부분 ~362행) |
| 연결 상태를 renderer에 밀어 주는 IPC | main이 `connection state`만 민다(`CORE_STATE_CHANNEL`). event는 renderer에 안 간다 → event를 renderer에 전달하는 길을 더한다 | S1 8장 | `packages/shell/ipc/core.ts`, `ipc/core-api.ts`, `preload/core-api.ts`, `renderer/desktop/connection/connection.ts` |
| overlay의 `notification` 표면 | toast를 그리는 표면이 이미 있고 부르는 곳이 없다 → 반응 층이 연다. "toast는 overlay가 그린다"에 쓴다 | S1 8장 | `renderer/overlay/surfaces/surface.tsx`(`ToastStack`), `overlay/registry.ts`, `shell/ipc/overlay.ts`(`"notification"` kind), `main/app-frame/overlay.ts` |

## UI 새로 만들 것

| 항목 | 하는 일 | 근거 | 붙을 곳 |
|---|---|---|---|
| event client | renderer당 연결 하나. 아래 층들이 선언한 구독 조건을 합쳐 Gateway에 건다. 끊기면 다시 붙고 snapshot부터 읽는다 | S1 8장 | `packages/shell/renderer/`의 새 모듈(위치는 code-map이 정한다) + main의 중계(token이 main에 있다) |
| store 층 | event로 상태를 고친다. 처음과 다시 붙을 때 read API로 snapshot을 읽는다. 세 store: session 목록과 상태, 대기 목록(권한 요청, 질문, 보류 허락 요청 한 목록, 종류 구별), 열린 대화 탭의 session별 agent event | S1 8장, req-1498 | 새 모듈 |
| UI용 hook | component는 hook으로 store만 읽는다(event도 연결도 모른다) | S1 8장 | 새 모듈 |
| 반응 층 | event를 넣으면 반응 목록이 나오는 순수 함수. 표: `PermissionRequested`·`ApprovalRequested`·`QuestionAsked`→대기 목록+toast, `PermissionResolved`·`QuestionResolved`→대기 목록에서 뺌, `SessionStarted/Ended`·상태→session 목록, `AppRestartHalted`→toast, `ContextViolationFound`→toast(누르면 Project Manager 부름), 그 밖 domain event→반응 없음 | S1 8장, req-0083, 0085, 0086 | 새 모듈 |
| 대기 목록 항목 종류와 coding agent 항목 | coding agent의 `PermissionRequested`는 대기 목록에서 누르면 그 session의 터미널 탭으로 focus를 옮긴다 | S1 8장, S6 2장 5, req-1498 | store는 이 영역, focus 동작은 06 |
| toast 문구 | 위 반응 표의 toast(권한 요청, 허락 요청, 질문, 앱 재시작 멈춤)용 wording catalog key. 지금 있는 것은 위반 toast key(`contexts.title.toast-violations`)뿐이다 | S1 8장 | `packages/design/wording/` |
| "눌러서 agent 부르기" 동작 | 사건(위반)을 붙여 Project Manager의 새 session을 연다. 눌러야만 간다 | req-0085, 0086 | 반응 층의 부수 효과. `openRole` 호출은 workspace에서 |
| 반응 층 시험 | 순수 함수라 event 입력에 반응 목록을 비교한다. 놓친 사이의 toast는 다시 띄우지 않는 규칙 포함 | S1 8장 | 같은 모듈 |

## 문서끼리 어긋난 것

1. `tmp/changes.md` 2장 event 줄: 앞에서는 "domain event 10개"인데 같은 줄 끝에서 "event type 약 150개를 9개로 줄인다"라 적었다. spec 12장은 10개다(S7이 `TicketVerified`를 더했다).
2. `tmp/changes-by-topic.md` waiting-and-recovery 줄은 근거를 "event.md 7"로 적었으나 재시작 때 일은 S1 10장이다(7장은 남지 않는 event).
3. S1 12장은 `workspace/notice-card.tsx`를 "기능마다 따로 띄우는 것"으로 지목했으나 코드의 `NoticeCard`는 event를 쓰지 않는다(읽기 실패, tracking 꺼짐 안내). 같은 문장의 `ask-agent-toast.tsx`는 부르는 곳이 없다. 목록이 코드와 어긋난다.
4. S1 3장은 Gateway를 "renderer의 WebSocket"이라 쓰나 token이 main에만 있어 지금 구독 socket은 shell **main**에 있다(`main/desktop/core/events.ts`). renderer가 직접 붙을지 main이 중계할지 spec이 말하지 않는다.
5. platform/notifications는 "보류"인데(removed.md 2, changes-by-topic) code-map은 `packages/core/notifications/`를 그대로 두고, 코드는 지울 event 이름(`TicketConfirmed`, `AssignmentPaused`, `QuestionCreated` 등)에 묶여 있다. "보류=코드를 지운다"인지 "예전 코드를 놔둔다"인지 문서가 말하지 않는다.
6. S1 8장 구독 표는 "모든 session의 상태를 바꾸는 event"를 session 목록 조건으로 쓴다. 6장은 상태 계산을 core가 한다고만 적었고, 어떤 event가 상태를 바꾸는지의 표(running↔waiting↔idle 전이)는 없다.
7. `docs-review` S1 핑퐁은 새 domain event를 "AppRestartHalted, ContextViolationFound, TicketClaimExpired, CodingSessionEndedUnreported"라 했고 spec 5장은 여기에 `ApprovalDecided`, `TicketVerified`를 포함해 10개다. 둘은 어긋나지 않지만, 핑퐁의 "9개"를 따라 쓴 문서(changes.md)가 남아 있다(1번).

## 다른 영역에 넘긴 것

- Gate, reaction grant 판정, `approval_requests` 표, `ApprovalDecided`의 handler, `ApprovalRequested` 발행 지점: 02.
- Router 봉투, `agent_calls`, run 출처 `message`·`handoff`를 보낸 쪽으로 바꾸기, call 닫음의 call 상태 닫기: 03.
- tool 정의(묻는 tool, 질문 UI의 질문 본문), assignment 상태 machine 삭제: S4 영역.
- harness hook → agent event 변환(adapter), 터미널 탭 focus, coding agent 상태 관측(`ObservationStore`): 06.
- activation handler(`TicketVerified` → release activate), `ReleaseActivated`를 읽는 app frame 새로고침: 07, S5.
- 대화 기록(message, tool call, compact 경계)을 session 기록에 쓰는 저장과 읽기, session rewind: S8·run-loop 영역.
- `things-to-confirm` 화면 자체(질문 묶음 카드, approval 카드, 확인 창): 02·shell. 이 영역은 데이터 읽기 방식만 말했다.
- `blob_refs`와 erase(session delete가 ledger를 지우던 길): blob-store·session 영역.
- context 영역: `ContextViolationsHandedOff`를 상태로 읽는 코드, `context-watch`의 `onDrafting`.
- problems 영역: `problems.work`·`problems.closing` cursor 구독자(`ProblemFixRecorded` 등)를 남길지.

## 확인 못함

- **documents(file-tracking)의 깨움 신호**: `file-tracking/coordinator/feed.ts`는 `Project*`·`Document*`·`ContextViolationsRecorded` event를 신호로 root 집합과 관측 근거를 다시 맞춘다. domain event 10개에는 이것들이 없다. Bus의 남지 않는 event로 둘지, command 안에서 직접 부를지 spec에 없다. 추천은 직접 호출(같은 core 안이라 event가 필요 없다).
- 앱 data 바뀜 신호가 남지 않는 event 꼴이 될 수 있다는 S1 7장 문장의 결말(S5가 정한다).
- 사람 token으로 Gateway에 붙는 인증과 한 번에 몇 연결인지(spec에 없음). 지금은 `current()`가 연결 때와 보낼 때마다 자격을 다시 본다.
- 느린 구독자 처리(지금은 1MB 넘으면 1013으로 끊음)를 Bus에서 어떻게 이을지.
- trace(관측)를 어디에 남기는지(changes-by-topic 7장 열린 물음, 미결).
- `OS notification`을 어떻게 할지(요구 없음, spec 침묵). 위에서는 "보류=지운다"로 쳐 덜어낼 것에 넣었다.
- shell main이 렌더러에 event를 중계할지 renderer가 WebSocket을 직접 열지(어긋난 것 4번).
- `events` 표를 읽는 약 42개 파일의 파일별 상세. 목록은 `grep "from events|join events"`로 뽑은 영역 단위이고, 각 줄이 "상태 근거인지 시험 보조인지"는 읽지 않았다.
- `ProblemOpened`, `ReleaseActivationFailed`, `TicketCompletionReported`의 payload가 Reactor handler에 충분한지는 payload 정의를 열어 보지 않았다.
