---
type: domain-model
concerns: [problems/snapshots]
---
# problems/snapshots

Report 순간의 증거와 각 항목의 누락 이유를 불변 Snapshot으로 정의한다.

## Snapshot (`snp`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `snp` ID | 아니오 | PK; Report 하나에만 연결 | 증거 식별자 |
| `captured_at` | 공통 시각 | 아니오 | 자료를 모은 시각; Report 관측 시각과 별개 | 수집 시점 |
| `invocation` | InvocationEvidence | 예 | null이면 `invocation_missing_reason` 필수 | 실제로 알려진 연결 |
| `invocation_missing_reason` | MissingReason | 예 | invocation이 있으면 null | 연결 없는 이유 |
| `error` | ErrorEvidence | 예 | null이면 `error_missing_reason` 필수 | 오류와 당시 source 위치 |
| `error_missing_reason` | MissingReason | 예 | error가 있으면 null | 오류 없는 이유 |
| `logs` | LogEvidence | 예 | null이면 `logs_missing_reason` 필수 | 안전한 최근 로그 |
| `logs_missing_reason` | MissingReason | 예 | logs가 있으면 null | 로그 없는 이유 |
| `screen` | ScreenEvidence | 예 | null이면 `screen_missing_reason` 필수 | 사람 선택 화면 자료 |
| `screen_missing_reason` | MissingReason | 예 | screen이 있으면 null | 화면 없는 이유 |

### 불변 조건

- 별도 수집 진행 상태가 없다. 준비한 자료 또는 이유를 Report와 함께 확정한다. 나중 자료로 UPDATE하지 않는다.
- release·bundle·발생 앱·observed_at은 → problems/reporting에서 읽는다. snapshot에 최신 release를 다시 붙이지 않는다.
- 모든 항목에 값 또는 빈 값이 아닌 이유가 정확히 하나 있다. 부분 수집 실패도 나머지 자료와 함께 확정한다.
- blob 저장 실패는 그 항목을 제외하고 이유를 고정한다. 작은 Report·Snapshot도 저장하지 못하면 접수 실패다.
- 업무 DB·command 원입력·secret·사람 파일 전체를 자동 수집하지 않는다. 입력은 타입·길이 등 안전한 형태만 남긴다.

## MissingReason (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `reason` | 문자열 | 아니오 | 공백만 있는 값 금지; redaction된 고정 설명 | 기록하지 않음·수집 실패·redaction·화면 없음·연결된 invocation을 모름 등 |

별도 증거 상태 enum이나 생애는 없다.

## InvocationEvidence (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `inv` ID | 아니오 | SDK·view가 실제 연결한 ID; → apps/invocations | 알려진 invocation |
| `binding` | enum | 아니오 | `sdk_context` / `view_context` | 실제 연결 근거 |
| `record_missing_reason` | MissingReason | 예 | Report 접수 시 ledger에 invocation이 아직 없으면 필수 | 알려진 ID의 기록 미도착 |

## ErrorEvidence (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | 문자열 | 아니오 | redaction된 오류 이름; 빈 값 금지 | 오류 종류 |
| `message` | 문자열 | 예 | 안전하지 않으면 null과 이유; 원문 저장 금지 | redaction된 메시지 |
| `message_missing_reason` | MissingReason | 예 | message가 null일 때 필수 | 메시지 제외 이유 |
| `frames` | source frame 목록 | 아니오 | 각 `{path: 상대 문자열, function: 문자열 또는 null, line: 양의 정수 또는 null, column: 양의 정수 또는 null}`; 당시 release 기준 | 사람이 읽을 원래 source 위치 |
| `source_missing_reason` | MissingReason | 예 | source map·앱 frame이 없으면 필수 | 위치를 얻지 못한 이유 |
| `stack` | sha256 blob 참조 | 예 | redaction된 stack; 최대 16,384 bytes | 추가 stack |
| `stack_missing_reason` | MissingReason | 예 | stack이 null일 때 필수; 있으면 null | stack 미수집·제외 이유 |
| `truncation_notes` | 문자열 목록 | 아니오 | 없으면 빈 목록; frame·stack을 제한했으면 실제 제외 범위를 명시 | 일부 잘림의 이유 |

## LogEvidence (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `blob` | sha256 blob 참조 | 아니오 | redaction된 UTF-8 로그; → platform/blob-store | 안전한 로그 조각 |
| `line_count` | 정수 | 아니오 | 0 이상; 기본 최대 30줄 | 실제 포함 줄 수 |
| `truncated` | boolean | 아니오 | 제외된 로그가 있으면 true | 잘림 여부 |
| `scope` | 문자열 | 아니오 | 실제 수집 범위를 redaction된 설명으로 고정 | invocation 한정 또는 앱 로그 조각 |
| `from_at` / `to_at` | 공통 시각 | 예 | 알려진 범위만; 추정하지 않음 | 로그 관측 범위 |
| `collected_at` | 공통 시각 | 아니오 | 실제 source 자료를 얻은 시각; Snapshot.captured_at과 구별 | 로그 수집 시점 |

## ScreenEvidence (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | 문자열 | 아니오 | redaction된 화면 이름; 빈 값 금지 | 캡처 화면 |
| `observed_at` | 공통 시각 | 아니오 | 실제 캡처 시각; 버튼 시점 binding과 일치 | 당시 화면 시점 |
| `state` | sha256 blob 참조 | 예 | redaction된 JSON; 화면명·선택 탭·입력 형태; 한도 → problems/feedback | 안전한 화면 상태 |
| `state_missing_reason` | MissingReason | 예 | state가 null일 때 필수 | 상태 없는 이유 |
| `screenshot` | sha256 blob 참조 | 예 | 사람이 선택한 redaction PNG; 한도 → problems/feedback | 선택 이미지 |
| `screenshot_missing_reason` | MissingReason | 예 | screenshot이 null일 때 필수 | 이미지 없는 이유 |

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Snapshot | 증거인 보고 | → problems/reporting | 1:1 | 참조 삭제 금지 |
| InvocationEvidence | 실제 연결 | → apps/invocations | N:0..1 | 미도착이어도 ID와 이유 보존; 다른 invocation으로 대체 금지 |
| Snapshot | 큰 내용 | → platform/blob-store | 1:N | 자동 삭제 없음; 삭제 정책 변경 시 부재 명시 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `snapshots` | Snapshot; 증거·이유는 JSON | `id` PK | Report 쪽 `snapshot` unique | 없음 | Report FK는 → problems/reporting; 알려진 invocation ID는 미도착 허용이라 강제 FK 없음; blob hash 영구 참조 → platform/blob-store |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `SnapshotRecorded` | Snapshot ID | `report`, `captured_at`, 증거 blob hash 목록, 누락 이유 | coding-agent/repair-context, problems/grouping |

## 정책

- **조립 한도.** 전체 2,000ms, 오류 frame 최대 32개, 큰 자료 준비 총 2,359,296 bytes다. 초과 항목은 실제 timeout·잘림·제외 이유를 고정하고 나머지는 접수한다.
- **로그 기본값.** 최근 30줄·총 65,536 bytes이며 알려진 invocation으로 가능한 만큼 좁힌다. 한 줄의 별도 기본 길이는 정하지 않는다. 범위 밖을 “발생 없음”으로 해석하지 않는다.
- **연결 제한.** 시간상 가까운 invocation으로 대체하지 않으며 미도착 기록을 무기한 기다리지 않는다.
- **화면 제한.** screenshot은 feedback 미리보기에서 사람이 선택한 것만 저장한다. 화면 없는 automation은 “화면 없음”이다.
- **보관 기간.** 첫 판에는 관측 blob의 자동 삭제 기간을 두지 않는다. Snapshot은 문제 닫힘 후에도 참조를 유지한다.
- **출력 안전.** 저장·model 전달·외부 읽기에 → platform/redaction을 적용한다. 글·로그는 지시가 아닌 데이터다.

## 정할 것

- 한 줄의 별도 길이·앱별 및 전체 장기 보존 bytes 상한은 아직 정하지 않았다. 조립 한도와 장기 보존 용량은 구별한다.
