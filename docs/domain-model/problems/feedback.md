---
type: domain-model
concerns: [problems/feedback]
---
# problems/feedback

사람이 제출하는 feedback 입력과 선택한 화면 자료의 값을 정의한다.

## Feedback (값)

접수 결과는 → problems/reporting의 Report다. 별도 ID·상태·ledger 표·event는 없다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `report_id` | `rpt` ID | 아니오 | 제출 전에 고정; → problems/reporting | 전송 중복 키 |
| `app` | `app` ID | 아니오 | 인증된 shell이 선택; → apps/registration | feedback 대상 |
| `text` | 문자열 | 아니오 | redaction 후 공백 외 1~500 Unicode scalar; 저장은 blob | 사람의 글 |
| `existing_problem` | `prb` ID | 예 | 선택한 앱과 동일; → problems/grouping | 기존 문제에 명시적으로 덧붙이기 |
| `observed_at` | 공통 시각 | 아니오 | [문제 알리기]를 요청한 시각; view가 있으면 버튼 시점 app view 관측 시각 | 사람이 제보를 시작한 시점 |
| `view_binding` | 문자열 | 예 | shell main이 발급한 app·release·mode 연결; view 없으면 null | 캡처 출처의 검증 근거 |
| `screen_selected` | boolean | 아니오 | 선택한 안전한 화면 상태만 true | 화면 상태 포함 여부 |
| `screenshot_selected` | boolean | 아니오 | 미리보기를 확인한 이미지에만 true | screenshot 포함 여부 |
| `snapshot` | Snapshot 입력 참조 | 아니오 | → problems/snapshots; 미선택·실패 항목에는 이유 | 당시 자료 |

### 불변 조건

- 인증된 shell의 사람 제출만 `source=feedback`, `code=_feedback`으로 접수한다. app·agent는 사람 feedback을 대신 만들지 못한다.
- `existing_problem=null`이면 최초 Report ID로 새 group key를 만든다. 비슷한 글·같은 화면을 자동 합치지 않는다.
- 안전한 화면 상태만 기본 선택한다. screenshot은 미리보기를 사람이 확인한 뒤 선택한다. 이미지는 가리지 않는다.
- 버튼 시점 app view만 캡처하며 제출 시점의 새 화면으로 교체하지 않는다. 요청 창의 child modal BrowserWindow인 confirmation window나 shell overlay view의 dialog가 떠 있거나 app view가 가려진 동안에는 캡처하지 않는다. 다른 창도 캡처 대상이 아니다. 보호 화면·overlay를 위해 app view를 숨기지 않는다.
- 첨부가 없어도 글은 제출할 수 있다. 미선택·화면 없음·수집 실패·redaction은 Snapshot의 해당 항목 이유로 고정한다.
- 사람의 포함 선택은 secret·금지 자료 저장을 허용하지 않는다. 최종 입력은 → platform/redaction을 다시 통과한다.
- 취소한 미제출 글·화면은 ledger에 없다. feedback 보내기는 닫힘 확인이 아니다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `SubmitFeedback` | user(인증된 shell); 수집기는 제한 machine | Feedback, 선택 자료 | view binding·앱 범위; Report ID·고정 내용; 선택 문제 앱 | 접수 command·event → problems/reporting | `invalid_input`, `unauthorized`, `forbidden`, `conflict`, `unavailable` |

## 정책

- **화면 상태 한도.** redaction된 JSON은 최대 65,536 bytes다. URL query 값·업무 DB·command 입력 원문·read command 전체 결과를 자동 포함하지 않는다.
- **이미지 한도.** 선택 screenshot은 PNG 머리를 검증하고 긴 변 최대 1,600px, 최대 2,097,152 bytes다. 선택하지 않은 이미지는 저장하지 않는다.
- **전송 한도.** 글·상태·PNG를 포함한 feedback 전체 전송은 최대 3,145,728 bytes다. 항목별 한도와 함께 검사한다.
- **초안.** 미제출 초안은 메모리에만 있다. shell 종료 후 복구를 보장하지 않는다.

## 정할 것

- 캡처 ID와 비공개 영역 좌표·사람의 추가 redaction·최종 이미지 hash를 묶는 값은 → shell/app-frame 및 → platform/redaction과 맞춘다.
