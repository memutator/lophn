---
type: domain-model
concerns: [platform/redaction]
---
# platform/redaction

저장·model 전송·표시·외부 반환용 복사본의 redaction 입력, 결과와 안전한 생략 값을 정의한다.

## RedactionInput (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `source` | 출처 참조 | 아니오 | 소유 concern·고정 판·범위가 확인된 참조 | 자료 근거 |
| `media_type` | string | 아니오 | 지원 매체만; 모르면 원문 제외 | 매체 |
| `audience` | `storage` / `display` / `model` / `external` | 아니오 | 각 수신자의 scope 별도 검사(→ platform/identity) | 출력 대상 |
| `safe_fields` | 필드 경로 목록 | 아니오 | 소유 concern이 선언; 자동 전체 수집 불가 | 남길 필드 |
| `private_fields` | 필드 경로 목록 | 아니오 | 빈 목록 허용; 해당 필드 통째로 제외 | 비공개 필드 |
| `private_regions` | 화면 영역 목록 | 아니오 | 이미지이면 적용; 보호 창·secret 입력은 수집 자체 금지 | 비공개 화면 |

원문은 필요한 동안 제한된 메모리에만 준비한다. 일반 blob·log·임시 파일에 먼저 저장하지 않는다. 사람 원본 문서의 보존은 → documents/versions이며 redaction은 원본을 몰래 바꾸지 않는다.

## RedactionResult (값)

소유 record에 담는 구조값이며 독립 entity·ledger 표가 아니다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `rule_revision` | string | 아니오 | 고정한 규칙 판 또는 hash | 검사 규칙 |
| `status` | `passed` / `partial` / `omitted` | 아니오 | 검사를 완료한 복사본만 passed; 실패 원문 통과 불가 | 결과 |
| `content` | 안전한 작은 값 또는 blob hash | 예 | omitted이면 null; 큰 내용은 → platform/blob-store | 출력 복사본 |
| `redacted_items` | 안전한 위치 목록 | 아니오 | 검출한 값·공개 hash·길이·원문 일부 없음 | 바꾼 위치 |
| `omissions` | Omission 목록 | 아니오 | partial·omitted이면 1개 이상 | 제외 내용 |

잘린 출력·summary·derived data도 rule_revision과 생략 상태를 유지한다. model input 기록은 실제 전송한 redaction 완료 본문과 같아야 한다.

## Omission (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `location` | 안전한 필드·영역 참조 | 아니오 | 원문·범위 밖 제목 없음 | 빠진 범위 |
| `reason` | `private` / `secret_detected` / `unsupported_media` / `limit_exceeded` / `redaction_failed` / `uncertain` | 아니오 | 실제 관측한 이유 | 부재 이유 |
| `message` | string | 아니오 | 원문 없는 안전한 안내 | 설명 |

## RedactionRules (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `revision` | string | 아니오 | 입력·출력이 같은 고정 판 사용 | 규칙 판 |
| `replacement` | literal `*` | 아니오 | 길이·종류에 관계없이 별표 하나; 앞뒤 문자 노출 없음 | secret 대체 값 |
| `pattern_revision` | string | 아니오 | 고정한 gitleaks credential prefix·PEM 규칙 판 | 미지 secret 패턴 |

알려진 secret의 정확 일치는 플랫폼 비밀 경계의 제한된 메모리에서 수행하며 검사 값 목록을 agent·앱·테스트에 전달하지 않는다. 길이·앞머리·개수로 알려진 값을 제외하지 않는다. 긴 값부터 처리하고 겹치는 값·stream 조각 경계도 검사한다. 잠금·재시작 뒤 secret을 사용하기 전 검사 경계에 다시 등록한다.

## 정책

- **수집 최소화.** 보고·log·invocation은 code·위치·판·안전 수치·결과가 기본이다. 업무 DB·전체 파일·일반 입출력·대화 본문을 자동 복사하지 않는다.
- **필드 차단.** Authorization·Cookie, URL 사용자 정보·인증 query, JSON secret·token·password·credential 필드는 값과 무관하게 제거한다. 알려진 값·흔한 key·token·PEM 패턴도 검사한다.
- **개인정보.** 선언 필드·private 화면·필요 범위를 사용한다. 필요 없는 이름·연락처·이메일·경로는 제외하거나 그 자료 안에서만 통하는 표식으로 바꾼다. 표식은 익명화 보장이 아니다.
- **입력 차단.** 알려진 secret 또는 패턴에 맞는 대화·질문 답은 저장·model 전송 전에 전체 전송을 막는다. 원문 대신 전용 secret 입력 안내만 남긴다.
- **재검사.** SDK redaction을 신뢰 근거로 쓰지 않는다. 플랫폼 수집 경계와 읽기·export·model 전송에서 다시 검사한다. model 출력·summary·최종 tool 입력도 각각 검사한다.
- **표시.** 대화·tool 상세·전후 diff·오류·notification·복사·export preview·tooltip에서 redaction된 값을 다시 드러내지 않는다. agent·설정으로 redaction을 끄지 못한다.
- **화면.** 보호 창·secret 입력은 수집하지 않는다. private 영역을 처리 못하면 자동 첨부하지 않는다. 사람이 미리 보고 redaction하거나 제외한 최종 자료만 접수한다(→ problems/feedback).
- **실패.** 실패·불확실·한도 초과·미지원 매체는 원문을 저장·표시·model 전송·외부 반환하지 않고 Omission만 남긴다. `invalid_input` 또는 `unavailable`은 안전한 이유만 포함한다(→ platform/ledger).
- **진단.** 처리 못한 exception은 오류 종류·안전 위치만 남기고 메시지·stack 원문은 제외한다. 원시 stdout·stderr·HTTP dump·crash 메모리를 자동 보관하지 않는다. model 내부 추론·재생용 서명도 수집하지 않는다.
- **불변 자료.** 새 secret·강한 정책으로 과거 event·blob을 다시 쓰지 않는다. 뒤늦게 드러난 원문은 반환을 막고 redaction된 읽기만 허용한다. 삭제 감사에는 상세 값을 다시 복사하지 않는다.
- **효과 분리.** 기록 redaction 실패 때문에 이미 일어난 앱·외부 변경을 재실행하지 않는다.

## 정할 것

- 첫 gitleaks commit과 credential prefix 목록; 입력·출력의 OpenAI·Anthropic·GitHub·AWS·Slack·PEM 공통 테스트 표본.
- 텍스트·JSON·이미지 한도, field path·화면 영역 모양, 처리 기한.
- 알려진 값의 URL encoding·Base64 지원과 오탐 기준. 임의 이미지·암호화·분할된 미지 값의 완전 탐지는 보장하지 않는다.
- 뒤늦은 원문 발견의 반환 차단 메타데이터와 상세 근거 삭제 정책은 → platform/blob-store와 맞춘다.
