---
type: domain-model
concerns: [problems/closing]
---
# problems/closing

Problem의 닫힘 근거, 보호된 사람 확인, 재발 판정 규칙을 정의한다.

## Closure (값)

→ problems/grouping의 `Problem.closure`와 `ProblemClosed` payload에 담는 값이다. 별도 entity·ID·표는 없다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `reason` | enum | 아니오 | `verified` / `user_confirmed` / `recovered` / `dismissed` | 닫힘 이유 |
| `basis_seq` | event seq 정수 | 아니오 | 양의 정수; 닫힘 직전 비교한 문제 변경 seq | 낡은 판정 방지 |
| `release` | `rel` ID | 예 | verified/user_confirmed/recovered는 필수; 판정 때 현재 활성 release; → apps/releases | 확인한 release |
| `verification` | `vrf` ID | 예 | verified에서만 필수; → problems/tests | 실제 reproduction 결과 |
| `confirmation` | 보호된 확인 참조 | 예 | verified는 null; 나머지는 필수; → shell/confirmation-window | 사람 결정의 일회 근거 |
| `last_report` | `rpt` ID | 예 | recovered에서 필수; 해당 problem; → problems/reporting | 증상이 없다고 확인한 마지막 발생 |
| `note` | 문자열 | 예 | dismissed에서 공백 외 한 줄 필수; redaction; 나머지는 선택 | 더 다루지 않는 이유·사람 메모 |

### 불변 조건

- `verified`만 자동 수리 확인이다. `recovered`·`dismissed`는 수리 성공을 뜻하지 않는다.
- 현재 closure는 closed일 때만 존재한다. reopen은 현재 closure를 비우되 이전 `ProblemClosed` payload를 보존한다.
- agent·앱·일반 CLI의 user 주장은 사람 확인을 대신하지 못한다. 보호된 확인은 problem·basis seq·정확한 선택·release·입력에 묶고 한 번만 사용한다.
- 닫힘 actor·시각은 event envelope다. 별도 payload 시각으로 순서를 판단하지 않는다.

## UserProblemDecision (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `choice` | enum | 아니오 | `fixed` / `not_fixed` / `not_visible` / `dismiss` | 사람의 확인 |
| `problem` | `prb` ID | 아니오 | → problems/grouping | 정확한 대상 |
| `basis_seq` | event seq 정수 | 아니오 | 보호 화면이 보여 준 문제 최신 seq | 비교 기준 |
| `release` | `rel` ID | 예 | fixed/not_visible 필수; not_fixed/dismiss도 활성 release가 있으면 필수; 없으면 null에 결속; 적용 때 현재 값과 일치 | 사람이 본 활성 release |
| `last_report` | `rpt` ID | 예 | not_visible 필수; 해당 problem의 보호 화면이 보여 준 마지막 Report | 현상이 안 보임의 확인 대상 |
| `confirmation` | 보호된 확인 참조 | 아니오 | 현재 입력에 묶인 일회 handle; → shell/confirmation-window | 사람 결정 근거 |
| `note` | 문자열 | 예 | dismiss는 한 줄 필수; redaction | 이유 |

## 판정 조건

| 판정 | 조건 |
|---|---|
| `verified` | 같은 problem의 `reproduction` 종류 `pass`; before에서 원래 증상 재현·after에서 같은 기대 충족; 선언/보고/기대 약화 없음; after가 현재 활성 release; Verification.basis_seq 뒤 새 운영 Report 없음 |
| `user_confirmed` | 보호된 `fixed`; 확인한 release가 현재 활성 release; basis seq 일치 |
| `recovered` | 보호된 `not_visible`; 현재 release·마지막 Report·basis seq 일치; 자동 quiet 판정 금지 |
| `dismissed` | 보호된 `dismiss`와 한 줄 이유; basis seq 일치 |
| 재발 | 닫힌 key로 현재 활성 release에서 운영 Report가 접수되거나 보호된 `not_fixed` |
| 과거 보고 | 이전 release의 늦은 운영 Report는 기존 문제에 붙이되 reopen하지 않음 |

## 상태

Problem 상태 정의와 ticket 전이는 → problems/grouping이다. 이 concern이 적용하는 닫힘 전이는 다음뿐이다.

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| `open` / `fixing` | `closed` | machine | verified 조건 모두 충족 | `ProblemClosed` |
| `open` / `fixing` | `closed` | user 결정 적용 | user_confirmed / recovered / dismissed 조건 충족 | `ProblemClosed` |
| `closed` | `open` | machine | 현재 활성 release에서 같은 key 운영 Report | `ProblemReopened` |
| `closed` | `open` | user 결정 적용 | 보호된 not_fixed; 현재 basis seq 일치 | `ProblemReopened` |
| `open` / `fixing` | 동일 | user 결정 적용 | 보호된 not_fixed | `ProblemConfirmationRecorded` |

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `CloseProblemVerified` | machine 판정기 | problem, Verification ID, 예상 문제 seq·활성 release | 현재 최신 문제 seq·status·활성 release; 결과 basis 뒤 Report 없음 | `ProblemClosed` | `not_found`, `forbidden`, `conflict`, `invalid_input` |
| `ApplyProblemDecision` | user(보호된 결정 적용) | UserProblemDecision | 문제 seq·status; 필요한 release·last Report; handle 일회성·입력 binding | `ProblemClosed` / `ProblemReopened` / `ProblemConfirmationRecorded` | `invalid_input`, `unauthorized`, `forbidden`, `not_found`, `conflict` |

Report 재발 판정은 → problems/reporting의 접수 transaction 안에서 수행한다. 별도 agent 닫기·clear·무시 command는 없다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `ProblemClosed` | Problem ID | 이전 status, Closure | platform/notifications, coding-agent/tickets, coding-agent/repair-context |
| `ProblemReopened` | Problem ID | 이전 Closure, 새 report 또는 보호된 UserProblemDecision | platform/notifications, coding-agent/tickets, coding-agent/repair-context |
| `ProblemConfirmationRecorded` | Problem ID | UserProblemDecision; status 유지 | coding-agent/repair-context |

## 정책

- **무보고 비교.** Verification.basis_seq 뒤 같은 problem의 새 운영 Report가 0개여야 한다. 늦은 과거 release Report도 새 근거이므로 자동 닫힘은 재평가한다. 닫힘 command는 현재 최신 문제 seq와 활성 release를 CAS로 비교한다.
- **기간.** verified의 별도 최소 quiet 대기 기간은 0ms다. 조용한 기간만으로는 닫히지 않는다. Verification의 날짜 기반 유효기간은 없으며 seq·현재 release가 유효성 기준이다.
- **재발 기간.** 닫힘 뒤 경과 기간에 상한이 없다. 같은 key는 언제든 같은 ID로 reopen한다.
- **근거 부족.** app test 통과·test command 통과·배포·ticket 확인됨·고친 기록·앱 clear/success 신호만으로 닫지 않는다. after와 현재 release가 다르면 새 reproduction 또는 사람 확인이 필요하다.
- **재평가.** VerificationRecorded·ReleaseActivated·ProblemObserved에서 조건을 다시 읽는다. event 자체가 닫힘을 대신하지 않으며 오래된 subscriber 명령은 CAS로 거절한다.
- **부정 확인.** not_fixed는 열린 문제를 닫지 않고 닫힌 문제를 다시 연다. 부정 확인 event의 release·basis와 당시 근거를 읽어 같은 release·같은 근거의 고쳐짐 확인을 반복 요청하지 않는다. 새 고친 release 또는 새 근거가 있을 때만 다시 제안한다.
- **notification.** 운영 ProblemOpened·ProblemReopened·ProblemClosed만 → platform/notifications의 계기다. 반복 보고·사람의 부정 확인·test result는 notification을 만들지 않는다.

## 정할 것

- H4: reproduction을 만들 수 없는 repair ticket의 사람 acceptance check 허용 여부는 → coding-agent/tickets다. 현재는 직접 수리 뒤 보호된 사람 확인만 허용한다.
- H5: CLI TTY의 사람 확인 인정 여부는 → shell/confirmation-window다. 현재는 보호 화면 근거만 유효하다.
