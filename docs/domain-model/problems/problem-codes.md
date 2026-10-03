---
type: domain-model
concerns: [problems/problem-codes]
---
# problems/problem-codes

blueprint 안에 담는 problem code의 값과 필수 보고 code를 정의한다.

## ProblemCode (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `code` | 문자열 | 아니오 | `^[a-z][a-z0-9_]{1,47}$`; blueprint 안에서 unique | release가 바뀌어도 같은 실패를 뜻하는 이름 |
| `message` | 문자열 | 아니오 | 공백만 있는 값 금지; CR/LF 금지; 치환 자리표시자 없음 | 실패의 설명이자 사람에게 보일 고정 한 줄 |
| `fixer` | enum | 아니오 | `coding_agent` / `user` | 코드 수리 / 사람이 설정·입력을 조정할 일이라는 안내 |

### 불변 조건

- 별도 ID·상태·event가 없다. 값의 소유자는 → apps/blueprint이며 고정 선언의 출처는 → apps/releases다.
- `message` 외의 별도 설명 필드는 없다. 같은 `code`의 의미를 다른 실패로 바꾸지 않는다. 의미가 달라지면 새 code다.
- `fixer`는 permission·claim·닫기 권한을 부여하지 않는다.
- 예상 실패가 없으면 목록 길이는 0이다. 빈 목록도 예외 자동 수집과 feedback 경로를 가져야 한다.
- 사람이 읽는 문구는 보고 당시 release의 선언에서 얻는다. 현재 release의 문구로 과거 선언을 바꾸지 않는다.

## 필수 수집 code (값)

앱이 선언하는 code가 아니라 플랫폼이 준비하는 예약 값이다. 앱 SDK가 `_`로 시작하는 code를 직접 제출하면 `invalid_input`이다.

| code | 설명 | 사람에게 보일 고정 문구 | fixer | 허용 출처 |
|---|---|---|---|---|
| `_exception` | 처리되지 않은 앱 process·view 예외 | 처리되지 않은 오류가 생겼습니다. | `coding_agent` | 수집기의 exception 관측 |
| `_feedback` | 사람이 제출한 feedback | 사람이 문제를 알렸습니다. | `coding_agent` | 인증된 shell의 feedback |
| `_invalid_report` | 미선언 code 또는 잘못된 보고 선언 사용 | 문제 보고가 올바르지 않습니다. | `coding_agent` | 수집기가 원래 보고에서 만든 진단 |

## 정책

- **선언 검사.** 모든 선언에 세 필드가 있어야 하며 code별 실제 실패 경로 테스트가 1개 이상 있어야 한다. SDK 직접 호출 테스트만으로 대체하지 않는다. 검사 결과는 → problems/tests다.
- **보고 경로 검사.** 빈 선언 목록을 포함한 모든 묶음은 process 예외 수집, view가 있으면 view 예외 수집·feedback, 저장 전 redaction 검사를 통과해야 한다. view가 없으면 화면 검사는 `not_applicable`이다.
- **release 근거.** 같은 실행 묶음 hash의 통과한 `app_test` ID가 없으면 준비할 수 없다. 검사 뒤 내용 변경은 새 hash다. 준비 command는 → apps/releases다.
- **선언 약화.** code·보고 경로 삭제나 원래 기대값 약화는 수리 확인 근거가 아니다. 판정은 → problems/tests 및 → problems/closing이다.

## 정할 것

- 추가 자동 관측 code(process 종료·command 실패·permission 거절 등)를 별도 예약 code로 둘지. 지금 필수 목록은 위 3개이며 invocation·permission 사실 자체는 → apps/invocations 및 → apps/permissions다.
- `user` fixer에 별도 조치 링크를 둘지. 현재 값은 세 필드이며 앱 command·화면 링크를 담지 않는다.
