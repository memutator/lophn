---
type: domain-model
concerns: [problems/grouping]
---
# problems/grouping

운영 Report의 불변 묶음 키, Problem 상태, 해석 참조를 정의한다.

## Problem (`prb`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `prb` ID | 아니오 | PK; 닫힘·재발에도 유지 | 문제 식별자 |
| `app` | `app` ID | 아니오 | → apps/registration | 보고 앱 |
| `group_key` | GroupKey | 아니오 | 불변; `(app, canonical key)` unique | 같은 문제 찾기 |
| `status` | enum | 아니오 | `open` / `fixing` / `closed` | 유일한 진행 상태 |
| `work` | `tkt` ID | 예 | 같은 앱의 열린 repair ticket 하나; → coding-agent/tickets | 현재 수리 티켓 |
| `interpretation` | InterpretationLink | 예 | 읽을 수 있는 고정 판·절 | 최신 문제 해석 참조 |
| `closure` | Closure 값 참조 | 예 | `closed`일 때만 필수; → problems/closing | 현재 닫힘 근거 |

### 상태

| 상태 | 뜻 |
|---|---|
| `open` | 닫히지 않았고 유효한 열린 repair ticket claim 없음 |
| `fixing` | `work`의 열린 repair ticket에 유효한 claim 있음 |
| `closed` | 닫힘 근거 있음; 보관 상태 아님 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `open` | machine | 첫 유효 운영 Report | `ProblemOpened` |
| `open` | `fixing` | machine | `work`의 현재 유효 claim 확인 | `ProblemWorkStarted` |
| `fixing` | `open` | machine | claim 해제·만료·완료 보고·취소; 닫힘 근거 없음 | `ProblemWorkEnded` |
| `open` 또는 `fixing` | `closed` | machine 또는 보호된 user 결정 | 판정 → problems/closing | `ProblemClosed` → problems/closing |
| `closed` | `open` | machine 또는 보호된 user 결정 | 현재 활성 release에서 같은 key의 보고 또는 “아직입니다” | `ProblemReopened` → problems/closing |
| `open` 또는 `fixing` | 동일 | machine | 같은 key Report 추가 | `ProblemObserved` |
| `closed` | `closed` | machine | 늦은 이전 release Report | `ProblemObserved` |

### 불변 조건

- 최소 1개 운영 Report가 있어야 한다. 가설·ticket만으로 만들지 않는다.
- 보관·보관 해제 상태와 event는 없다. 닫힌 목록 표시는 필터다.
- 보고 수·처음/마지막 시각·대표 보고·제목·최신 변경 seq는 Report와 event에서 읽는다. 별도 정본 필드로 복제하지 않는다.
- `work`는 문제당 0..1개다. 한 ticket은 여러 문제를 가리킬 수 있으므로 `work`에 unique를 걸지 않는다. ticket이 끝나면 비운다.
- ticket 이벤트 뒤 현재 ticket 상태·claim을 읽는다. `TicketClaimed`, `TicketClaimReleased`, `TicketCompletionReported`, `TicketCheckFailed`, `TicketCancelled`, `TicketConfirmed`를 받으며 `TicketCheckFailed`는 새 claim이 아니다.
- ticket 이벤트는 닫힌 문제를 다시 열거나 닫지 않는다. ticket 없는 수리·고친 기록·test 요청은 상태를 바꾸지 않는다.

## GroupKey (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | enum | 아니오 | `declared` / `exception` / `invalid_report` / `feedback` | key 가지 |
| `code` | 문자열 | 아니오 | 선언 code 또는 예약 code | 보고 분류 |
| `discriminator` | 문자열 | 예 | 아래 가지별 조건 | code 안의 구별 값 |

| kind | code | discriminator |
|---|---|---|
| `declared` | 선언 code | null |
| `exception` | `_exception` | 오류 지문 sha256; 앱 frame이 0개면 `rpt` ID |
| `invalid_report` | `_invalid_report` | redaction된 잘못된 code; 원문이 안전하지 않으면 원래 Report ID |
| `feedback` | `_feedback` | 최초 Report ID |

### 불변 조건

- key는 `(app, kind, code, discriminator)`의 canonical JSON 문자열이다. release·업무 대상·message·시각을 넣지 않는다.
- 기존 문제를 명시적으로 선택한 feedback은 새 key가 아니라 그 문제 key를 쓴다.
- 오류 지문은 수집기가 오류 이름과 상위 최대 3개 앱 source frame의 상대 path·function을 정규화한 canonical JSON의 전체 sha256으로 만든다. 줄·열·절대 path·message·업무 값·SDK/runtime frame은 제외한다.
- 당시 release의 source map만 사용한다. 경로는 묶음 밖 파일을 열 수 없다. 앱 frame이 0개면 Report별 key이며 오류 이름만으로 합치지 않는다.
- 닫힌 문제도 같은 key로 찾는다. 지문은 같은 원인의 증명이 아니며 자동 원인 추정·글 유사도 묶기는 없다.

## InterpretationLink (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `version` | `ver` ID | 아니오 | 읽을 수 있는 고정 판; → documents/versions | 해석 문서 판 |
| `section` | 문자열 | 예 | 해당 판에 존재하는 section key; null은 문서 전체 | 해석 절 |

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Problem | 보고 | → problems/reporting | 1:N | 관측 사실 삭제 금지 |
| Problem | 열린 수리 일 | → coding-agent/tickets | N:0..1 | 종료 시 work null, event 이력 보존 |
| Problem | 해석 고정 판 | → documents/versions | N:0..1 | 참조된 판 보존 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `problems` | Problem; group key·closure는 JSON, 해석은 version·section 열 | `id` PK | `(app, group_key)`; 상태와 무관 | `(app, status)`, `(work)`, `(interpretation_version)` | `app → apps.id`, `work → tickets.id`, `interpretation_version → versions.id`; 삭제 RESTRICT |

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `ReconcileProblemWork` | machine | problem, ticket, 받은 ticket event seq | 문제 최신 seq·현재 work; 현재 ticket 상태·claim; 문제당 열린 ticket 1개 | 상태 변화면 `ProblemWorkStarted` / `ProblemWorkEnded` | `not_found`, `conflict`, `forbidden` |
| `LinkProblemInterpretation` | 담당 App Engineer 또는 user | problem, 새 참조 또는 null | 문제 최신 seq·현재 참조; 앱 scope·판 읽기 권한 | `ProblemInterpretationLinked` | `invalid_input`, `not_found`, `forbidden`, `conflict` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `ProblemOpened` | Problem ID | `app`, `group_key`, 최초 `report` | platform/notifications, coding-agent/repair-context |
| `ProblemObserved` | Problem ID | `report`, `release?`, `active_release_at_acceptance?`, `previous_status` | problems/closing, coding-agent/repair-context |
| `ProblemWorkStarted` | Problem ID | `ticket`, `claim_seq`, 근거 ticket event seq | coding-agent/tickets, coding-agent/repair-context |
| `ProblemWorkEnded` | Problem ID | `ticket`, 종료 사유, 근거 ticket event seq | coding-agent/tickets, coding-agent/repair-context |
| `ProblemInterpretationLinked` | Problem ID | `previous` 참조?, `current` 참조? | coding-agent/repair-context, lophn-agent/roles/app-engineer |

## 정책

- **해석 연결.** 참조 설정·해제는 상태를 바꾸지 않는다. 이전 참조를 event에 남기며 같은 CAS로 되돌릴 수 있다. Report·Snapshot·Verification은 되돌려 지우지 않는다.
- **재발 key 기간.** 기간 상한 없이 같은 key·ID를 유지한다. 별도 episode entity는 없다.
