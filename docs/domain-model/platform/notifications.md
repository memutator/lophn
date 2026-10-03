---
type: domain-model
concerns: [platform/notifications]
---
# platform/notifications

Notification의 원래 event 참조·읽음과 notification을 만드는 계기 표를 정의한다.

## Notification (`ntf`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `ntf` ID | 아니오 | PK | notification |
| `source_seq` | event seq | 아니오 | unique; 실제 event FK; 계기 표 통과; → platform/ledger | 원래 사실 |
| `read_at` | UTC ISO 8601 밀리초 문자열 | 예 | 읽음 command의 서버 시각; 한 번 설정 뒤 불변 | 명시적 읽음 |

수신자는 이 컴퓨터의 사람 한 명이다. 수신자·채널·우선순위·복사한 본문·업무 상태·OS 배달 상태 필드는 없다. 제목·원래 시각·대상·결과 링크는 source event와 그 대상에서 읽는다.

### 상태

| 상태 | 뜻 |
|---|---|
| 읽지 않음 | read_at=null |
| 읽음 | read_at≠null |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | 읽지 않음 | `machine` | 원래 event가 계기 표의 조건을 만족; source_seq 미등록 | `NotificationCreated` |
| 읽지 않음 | 읽음 | `user` | notification ID를 명시하여 읽음 표시 | `NotificationRead` |

### 불변 조건

- source event 하나당 notification은 최대 1개다. 재전달·재시작·다른 세션의 표시로 늘지 않는다. 서로 다른 event를 종류·미읽음이 같다는 이유로 덮어쓰지 않는다.
- 원래 event와 notification 참조는 삭제하지 않는다. 당시 사실과 현재 대상 상태는 다를 수 있으며 현재 상태를 원래 문구로 대체하지 않는다.
- notification 수신·읽음·클릭·결과 열기는 승인·질문 답·문제 닫힘·티켓 확인이 아니다. 읽음은 revert 대상이 아니다.
- 다른 concern은 자기 event만 내보낸다. 생성 command는 이 concern의 전용 machine 구독자만 낸다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Notification | 원래 사실 | → platform/ledger | 0..1:1 | event 삭제 금지 |
| Notification | 원래 event의 대상 | → source event의 소유 concern | N:1 | 고정 참조·원래 사실 유지; 현재 대상의 종료/보관 상태를 별도 조회 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `notifications` | Notification | `id` PK | `source_seq` | `(source_seq)`; `(source_seq) WHERE read_at IS NULL` | source_seq FK → `events.seq`(platform/ledger) |

이 concern의 구독자 이름은 `notifications`다. 진행은 → platform/ledger의 `subscriber_cursors`에서 `subscriber='notifications'`인 행으로 보관한다. cursor는 이 concern의 entity나 별도 표가 아니다.

## command

인증·idempotency·공통 오류는 → platform/identity, platform/ledger.

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `create_notification` | 전용 `machine` 구독자 | id, source_seq, processed_through_seq | 실제 source event·계기 조건·이 구독자의 현재 cursor; 진행 역행 금지 | `NotificationCreated` | `forbidden`, `not_found`, `invalid_input`, `conflict` |
| `mark_notification_read` | `user` | notification | read_at=null; 이미 읽음이면 원래 읽음 값을 반환 | `NotificationRead` 또는 unchanged | `forbidden`, `not_found` |

생성과 cursor 갱신은 같은 짧은 transaction이다. 이미 source_seq가 있으면 그 notification을 반환하며 새 event를 만들지 않는다. 계기 없는 구간의 진행은 → platform/ledger의 cursor command만 쓴다. idempotency 기준은 `(notifications, source_seq, create)`다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `NotificationCreated` | notification | `source_seq` | shell/desktop |
| `NotificationRead` | notification | `read_at` | shell/desktop |

Created actor는 machine, Read actor는 user다. 두 event의 envelope run은 null이며 source event의 run을 복사하지 않는다.

## 정책

### notification 계기

이 표의 event만 notification을 만든다. 각 소유 concern은 조건을 판정할 근거를 자기 event payload 또는 고정 참조로 제공한다.

| event | 소유 concern | 조건 | notification |
|---|---|---|---|
| `ProblemOpened` | → problems/grouping | 운영 보고에서 생긴 문제 | source_seq 하나당 1개 |
| `ProblemReopened` | → problems/grouping | 운영 보고의 재발 | source_seq 하나당 1개 |
| `ProblemClosed` | → problems/closing | 운영 보고의 문제 | source_seq 하나당 1개 |
| `ApprovalRequestCreated` | → platform/approvals | 항상 | source_seq 하나당 1개 |
| `QuestionCreated` | → lophn-agent/questions | 항상 | source_seq 하나당 1개 |
| `TicketConfirmed` | → coding-agent/tickets | 항상 | source_seq 하나당 1개 |
| `TicketCheckFailed` | → coding-agent/tickets | 항상 | source_seq 하나당 1개 |
| `AssignmentPaused` | → lophn-agent/assignments | actor=machine; 원인=반복 실패 또는 대상 보관 | source_seq 하나당 1개 |
| `ContextWatchedItemChanged` | → documents/contexts | machine이 watch 변화 또는 section 소실을 확정한 event | source_seq 하나당 1개 |
| `ReleaseActivationFailed` | → apps/releases | 항상 | source_seq 하나당 1개 |

- **표 밖 계기 금지.** 같은 문제의 추가 report·TicketCreated/Claimed/ClaimReleased/CompletionReported/Cancelled·handoff 종료·RunFinished·일반 문서 저장은 notification을 만들지 않는다.
- **agent 비기동.** 생성·배달·읽음은 새 agent run이나 닫힌 세션 재개의 계기가 아니다. 기존 질문·approval 대기 해제는 해당 concern의 결정 event로만 처리한다.
- **내용 비복제.** 열린 세션에 보여 줄 때도 같은 notification을 참조한다. role 발언·Message로 원래 사실을 다시 저장하지 않는다. → lophn-agent/conversation
- **OS 표시.** OS notification은 같은 notification을 표시하는 경로다. domain 상태·새 계기·배달 성공 표를 만들지 않는다. secret·원문을 내보내지 않으며 실제 OS 표시와 tray는 → shell/desktop, platform/redaction.
- **보존.** OS 배달 실패·창 닫기 때문에 ledger notification을 버리지 않는다. 다시 조회·구독해 원래 notification을 표시한다. 배달에 model call을 쓰지 않는다.

## 정할 것

- OS notification 기본 제공·opt-in·창 안만 중 어떤 정책을 쓸지, 표시 정보의 최소 범위. 실제 OS 동작은 → shell/desktop.
- OS 배달 retry 간격과 실패 표시 시점은 미정이며 첫 domain model에는 배달 상태·retry ledger 표를 추가하지 않는다.
- 닫힌 세션 이후 여러 notification을 묶어 표시할지의 선정 기준은 → shell/desktop, lophn-agent/conversation. 계기·source_seq별 근거와 읽음은 합치지 않는다.
