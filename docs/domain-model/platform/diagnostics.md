---
type: domain-model
concerns: [platform/diagnostics]
---
# platform/diagnostics

lophn 자체의 안전한 운영 log·crash 관측과 상태 점검 값을 정의한다.

## DiagnosticRecord (값)

`~/.lophn/logs/`의 운영 자료이며 domain entity·ledger 감사 event가 아니다. agent run trace는 → lophn-agent/observability, 앱 문제는 → problems/reporting이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `at` | 시각 | 아니오 | → platform/ledger; 시각만으로 domain 순서 판정 불가 | 관측 시각 |
| `component` | string | 아니오 | 실제 플랫폼 구성 요소 이름 | 실패 경계 |
| `kind` | `log` / `crash` / `health` | 아니오 | 원시 crash memory dump 아님 | 관측 종류 |
| `code` | string | 아니오 | 플랫폼 내부 예외는 `lophn_internal`; 안전한 등록 진단 code | 분류 |
| `error_type` | string | 예 | 실제 오류 종류; 원문 입력을 섞지 않음 | 실패 종류 |
| `location` | 안전한 소스 위치 | 예 | 비공개 경로·secret 제외 | 플랫폼 위치 |
| `message` | string | 예 | redaction 완료 설명만; 실패면 null | 안전 설명 |
| `redaction` | RedactionResult | 아니오 | → platform/redaction; 원문 제외 이유 포함 | 출력 검사 |

### 불변 조건

- lophn 내부 오류를 앱을 사용하던 중 발생했다는 이유로 해당 앱 Report·Problem으로 기록하지 않는다.
- 앱 코드 frame 없는 내부 exception은 `lophn_internal`이다. 앱 프로세스 crash·timeout 등의 앱 귀속 관측은 → apps/runtime, problems/reporting이다.
- 원시 stdout·stderr·HTTP dump·crash 메모리를 자동 보관하지 않는다. 안전하게 처리 못한 message·stack은 제외하고 오류 종류·안전 위치만 남긴다.
- 감사 event·확정 command 결과·접수 상태의 원본을 log로 대신하지 않는다.

## HealthObservation (값)

인증된 상태 점검의 현재 관측이며 독립 ledger 상태가 아니다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `component` | string | 아니오 | 실제 점검한 구성 요소 | 대상 |
| `available` | boolean | 아니오 | 실제 점검한 현재 기능만 | 현재 사용 가능 |
| `reason` | string | 예 | available=false이면 안전한 이유 필수 | 불가 이유 |
| `observed_at` | 시각 | 아니오 | 실제 점검 시각 | 관측 시점 |

## 정책

- **쓰기.** 운영 log는 비동기·크기 제한으로 쓴다. 막힌 log 출력이 API·command·무관한 앱 응답을 기다리게 하지 않는다.
- **저장소 실패.** 디스크 부족·ledger 손상은 플랫폼 실패이며 앱 problem으로 돌리지 않는다. 저장 성공을 log·메모리·JSONL로 대체하지 않는다.
- **무인증 요청.** 대량 거절 요청을 매번 ledger event로 남기지 않는다. 제한된 안전 진단만 허용한다.
- **상태 점검.** 준비·건강 상태 API도 → platform/identity의 인증·scope를 요구한다. 인증 전에는 안전한 일반 오류만 준다.
- **redaction.** token·secret·인증 header·원문 입력·scope 밖 대상은 log·crash·점검 결과에 없다. redaction 실패이면 원문 부재와 이유만 남긴다.

## 정할 것

- log 매체·회전 크기·총 보존 한도·crash 기록 보존 기간.
- 등록 component·진단 code 목록, 상태 점검 항목과 측정 기한.
