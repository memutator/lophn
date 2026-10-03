---
type: domain-model
concerns: [lophn-agent/scheduling]
---
# lophn-agent/scheduling

Operator의 고정 간격 Schedule, 예정 회차 접수·skip과 마지막 처리 시점을 정의한다.

## Schedule (값)

Assignment 안의 값이며 독립 ID·상태는 없다. → lophn-agent/assignments.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `first_at` | UTC 시각 | 아니오 | ISO 8601 밀리초; 변경 시 적용 시각보다 미래 | 첫 예정 시점 |
| `every_ms` | integer | 아니오 | 양수 밀리초; 0 이하 `invalid_input`; 기본값 없음 | 회차 간격 |

예정 시점은 `first_at + n × every_ms`(`n`은 0 이상 정수)다. 시간대·cron은 현재 값에 없다.

## ScheduleOccurrence (값)

회차별 불변 처리 기록이다. 독립 entity·ID·대기열은 없다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `assignment` | Assignment ID | 아니오 | enabled Operator; → lophn-agent/assignments | 책임 |
| `assignment_revision` | integer | 아니오 | 양수; 처리 명령이 확인한 현재 판 | 회차 중복 방지 기준 |
| `previous_due_at` | UTC 시각 | 예 | 명령 전 `last_due_at`와 동일 | 이전 처리 시점 CAS |
| `due_at` | UTC 시각 | 아니오 | 현재까지의 미처리 예정 시점 중 가장 최근 하나; `previous_due_at`보다 뒤 | 처리한 예정 시점 |
| `outcome` | enum | 아니오 | `accepted`, `skipped` | 접수 여부 |
| `run` | Run ID | 예 | accepted이면 필수, skipped이면 null; → lophn-agent/harness/run-loop | 새로 접수한 Run |
| `skip_reason` | enum | 예 | skipped면 `unfinished_run`, accepted면 null | skip 사유 |
| `blocking_runs` | Run ID[] | 아니오 | skipped면 1개 이상, accepted면 `[]`; 명령 시 미종료 Run | 겹친 근거 |
| `missed_first_at` | UTC 시각 | 예 | 이번 due_at 앞의 미처리 회차가 있을 때 필수 | 몰아서 접수하지 않은 구간 시작 |
| `missed_last_at` | UTC 시각 | 예 | missed_first_at와 함께 null 또는 존재 | 구간 마지막 |
| `missed_count` | integer | 아니오 | 0 이상; 0이면 구간 두 시각 null, 양수면 Schedule로 검증 | 앞 회차 skip 수 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `assignment_schedule_occurrences` | ScheduleOccurrence와 event seq | PK `(assignment_id, assignment_revision, due_at)` | `run_id` WHERE NOT NULL; `event_seq` | `(assignment_id, due_at)`, `(outcome, due_at)` | `(assignment_id, assignment_revision)` → assignment_revisions; run·blocking_runs → lophn-agent/harness/run-loop; event_seq → platform/ledger |

승인·상태 변경으로 Assignment revision이 늘어도 `last_due_at`을 유지하므로 같은 예정 시점을 새 revision으로 재접수하지 못한다. 주기 자체를 바꿀 때만 초기화한다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `ProcessAssignmentOccurrence` | machine | assignment, 현재 revision, 이전 last_due_at, due_at, missed 구간, 중복 방지 키 `(assignment, revision, due_at)` | 현재 판·enabled Operator·Schedule·이전 시점·명령 시 미종료 Run; 같은 키·같은 입력 재전송은 기존 결과 | `AssignmentScheduleAdvanced`와 accepted일 때 Run 접수 event → lophn-agent/harness/run-loop | `invalid_input`, `not_found`, `conflict`, `forbidden` |

- 빈 Assignment면 Run 접수·회차 기록·last_due_at 이동을 같은 transaction에서 처리한다.
- `accepted`, `running`, `waiting_user` 중 하나라도 있으면 새 Run 없이 skipped 기록과 last_due_at 이동만 같은 transaction에서 처리한다. 질문·approval 대기도 포함한다.
- paused·withdrawn·역할 불일치는 skip 회차로 바꾸지 않고 명령을 거절한다. 낡은 판·시점은 conflict다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `AssignmentScheduleAdvanced` | Assignment → lophn-agent/assignments | assignment_revision, previous_due_at, due_at, outcome, run 또는 null, skip_reason 또는 null, blocking_runs, missed 구간·count | lophn-agent/scheduling, shell/desktop |

이 event 자체가 새 agent Run을 만들지 않는다. accepted Run은 회차 처리 transaction이 직접 접수한 것이다.

## 정책

- **최근 회차 하나.** 기동·절전 복귀·사람 resume 때 현재까지의 가장 최근 미처리 회차 하나만 처리한다. 그 앞 회차는 missed 구간으로 기록한다. 과거 회차별 Run을 만들지 않는다.
- **대기 중 skip.** 미종료 Run이 있는 매 회차도 last_due_at을 옮긴다. 답을 기다리는 동안 별도 회차 대기열을 쌓지 않는다.
- **사람 요청.** 직접 요청 Run은 last_due_at을 옮기지 않는다. Operator는 사람 요청과 승인한 주기만 접수하며 event·handoff는 계기가 아니다.
- **주기 변경.** 승인 적용 시 새 first_at은 적용 시각보다 미래이며 last_due_at을 null로 한다. 상태 변경·책임만 변경은 last_due_at을 유지한다. paused 상태의 승인 변경은 resume가 아니다.
- **계산 주체.** 예정 시점은 machine이 ledger 밖에서 계산하고 명령에서 현재 Schedule과 일치하는지 검사한다. model 선택을 쓰지 않는다.
- **실패 소유.** Run 결과를 받아 Assignment를 반복 실패로 pause하는 규칙은 → lophn-agent/assignments만 소유한다.

