---
type: domain-model
concerns: [platform/approvals]
---
# platform/approvals

ApprovalRequest의 고정 동작, 사람의 결정, 한 번 사용 연결을 정의한다.

## ApprovalRequest (`apr`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `apr` ID | 아니오 | PK | request |
| `requester` | actor | 아니오 | 인증된 값; → platform/identity | 원래 요청자 |
| `run` | `run` ID | 예 | → lophn-agent/harness/run-loop; agent 요청이면 필수 | 원래 run |
| `reason_blob` | sha256 | 아니오 | 비어 있거나 공백뿐인 글 금지; → platform/blob-store | 고정 설명 |
| `effect` | ApprovalEffect | 아니오 | 생성 뒤 불변 | 영향 |
| `action` | ApprovalAction | 아니오 | 생성 뒤 불변 | 허락할 동작 하나 |
| `expires_at` | UTC ISO 8601 밀리초 문자열 | 예 | 지정 시 생성 시각보다 뒤; 결정·사용 모두 `now < expires_at` | 사용 가능한 기한 |
| `status` | `pending / granted / rejected / expired / cancelled` | 아니오 | 생성 시 `pending` | 결정 상태 |
| `closed_reason_blob` | sha256 | 예 | `pending / granted / expired`이면 null; `rejected / cancelled`이면 이유를 적었을 때만 있음(없으면 null); → platform/blob-store | 거절·취소 이유 글. 만료는 이유 글이 없고 상태가 곧 이유다(가짜 hash 없음) |
| `created_seq` | event seq | 아니오 | 생성 event 참조; 불변; → platform/ledger | 내용 비교 기준 |
| `closed_seq` | event seq | 예 | `pending`과 null이 동치; 종료 event 참조 | 결정 참조 |

요청자·설명·영향·동작·기한은 생성 뒤 바꾸지 않는다. 요청·결정의 actor와 시각은 event에서 읽는다.

### 상태

| 상태 | 뜻 |
|---|---|
| `pending` | 결정 대기 |
| `granted` | 고정 동작 하나의 접수를 허락함; 적용 성공과 별개 |
| `rejected` | 거절함 |
| `expired` | 결정 전 기한이 끝남 |
| `cancelled` | 결정 전 취소됨 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `pending` | 권한 있는 요청자 또는 `machine` | 고정 동작·영향 검사 통과; agent 요청이면 원래 run 유효 | `ApprovalRequestCreated` |
| `pending` | `granted` | `user` | 현재 내용·기한·전제 검사와 confirmation window 증거 소비 | `ApprovalRequestGranted` |
| `pending` | `rejected` | `user` | 현재 내용·기한 검사와 confirmation window 증거 소비 | `ApprovalRequestRejected` |
| `pending` | `expired` | `machine` | 기한 있음; `now >= expires_at` | `ApprovalRequestExpired` |
| `pending` | `cancelled` | `user`, 원래 요청자, `machine` | 명시 취소 또는 원래 일 종료·취소·전제 변경 | `ApprovalRequestCancelled` |

### 불변 조건

- 종료 상태는 불변이다. 다시 열기·결정 수정은 없고 대상·입력·기준 변경은 새 request다.
- `granted` 뒤 기한 경과·run 종료는 사용 불가 조건이다. 저장된 허락을 `expired`나 실패로 고치지 않는다.
- `user` 자격만으로 허락·거절할 수 없다. 정확한 request·내용 기준·결정에 묶인 일회 증거가 필요하다. → shell/confirmation-window
- 결정에는 기본 선택이 없다. 침묵·창 닫기·notification 읽음·일반 세션의 긍정·질문 답은 결정이 아니다.
- 적용 상태·사용 횟수·승인 token·지속 허락은 ApprovalRequest에 없다. 실제 결과는 → `action.concern`.

## ApprovalAction (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `concern` | concern id | 아니오 | 등록된 동작 소유 concern | 적용 영역 |
| `command` | string | 아니오 | 해당 concern이 등록한 command route 이름 그대로(`document.rename`처럼 dot 포함); 이름을 바꾸거나 맞추지 않음; 임의 함수 이름 금지 | 동작 |
| `caller` | actor | 아니오 | 생성 시 검증한 실제 호출 주체; 자격 원문 금지 | 적용 주체 |
| `targets` | ID 배열 | 아니오 | 비어 있지 않음; 중복 없음; 정확한 고정 ID; 생성 대상은 미리 배정한 ID | 대상 묶음 |
| `input` | `{kind: inline, value: JSON object}` 또는 `{kind: blob, sha256: sha256}` | 아니오 | 둘 중 하나; command schema 통과; 큰 입력은 blob | 정확한 입력 |
| `input_hash` | sha256 | 아니오 | command의 정규화한 정확한 입력과 일치; 표시용 redacted 입력의 hash가 아님 | 입력 지문 |
| `comparison` | JSON object | 아니오 | 소유 concern의 CAS schema 통과; 검사할 판·관련 seq·hash 포함 | 현재 전제 |
| `binding_hash` | sha256 | 아니오 | concern·command·caller·targets·input_hash·comparison 전체의 지문 | confirmation window 내용 기준 |

- “현재 release”, 이름·slug만으로 대상을 묶지 않는다. 같은 입력이라도 대상·caller·비교 기준이 달라지면 다른 동작이다.
- assignment·tool·MCP 연결이 호출 전제이면 그 고정 ID와 판은 소유 command의 입력·비교 기준에 포함한다. → lophn-agent/harness/tool-judgment, lophn-agent/extensions
- 앱 `confirm` 호출은 `concern = apps/invocations`이며 requester와 caller는 인증된 실제 요청자다. 앱 화면의 user·agent·다른 앱의 요청을 사람이 허락해도 원래 요청자를 user로 바꾸지 않는다. `command`는 접수 command `invocation.accept_confirm`이고 `input`은 그 접수 입력 전체(approval id 포함)다. targets는 정확히 `[앱, release]`, `comparison`은 같은 release를 포함하며 `input_hash`는 접수 입력의 정규 지문이다. 요청자는 사람의 결정자와 별도로 남는다. agent ask와 confirm이 겹치면 같은 정확한 approval을 한 번만 사용한다. → apps/invocations#R17, apps/invocations#R18, lophn-agent/harness/tool-judgment
- secret 값·credential 원문은 입력·미리보기·event에 넣지 않는다. secret 이름·안전 참조·사용 대상만 고정한다. → platform/secrets, platform/redaction

## ApprovalEffect (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `changes_blob` | sha256 | 아니오 | 비어 있지 않은 설명; → platform/blob-store | 바뀌는 범위 |
| `external_blob` | sha256 | 예 | 외부 전송·영향이 있으면 필수; 수신처·전송 정보 포함 | 바깥 영향 |
| `reversible` | boolean | 아니오 | 소유 concern이 판정 | 복원 가능 여부 |
| `reversibility_blob` | sha256 | 아니오 | 비어 있지 않은 설명 | 복원 가능 범위·남는 영향 |

## ApprovalUse (값)

적용 영역의 접수·변경과 함께 저장하는 불변 연결이다. 별도 entity나 허락이 아니다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `approval` | `apr` ID | 아니오 | PK; `granted` request만; FK | 사용한 결정 |
| `concern` | concern id | 아니오 | `ApprovalAction.concern`과 같음 | 적용 영역 |
| `receipt` | `{kind: entity, id: ID}` 또는 `{kind: event, seq: event seq}` | 아니오 | 해당 영역의 실제 접수·변경 참조; 소유 영역이 존재 검사 | 적용 기록 |
| `accepted_seq` | event seq | 아니오 | 소유 영역의 접수·변경 event; → platform/ledger | 한 번 사용 확정 |

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| ApprovalRequest | 원래 요청 | → lophn-agent/harness/run-loop | N:0..1 | 감사 참조 유지; 끝난 run의 새 적용 금지 |
| ApprovalRequest | 적용 대상 | → `action.concern` | N:1..N | pending은 취소; granted는 보존하되 사용 거절 |
| ApprovalUse | 사용 결정 | ApprovalRequest | 0..1:1 | 삭제 금지 |
| ApprovalUse | 적용 결과 | → `concern` | 1:1 | 접수·변경 참조 보존 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `approval_requests` | ApprovalRequest; action·effect는 고정 JSON, 본문은 blob 참조 | `id` PK | `created_seq`, `closed_seq`(null 제외) | `(status, expires_at)` pending partial; `(run, created_seq)`; `(action_binding_hash, status)` | run → lophn-agent/harness/run-loop; seq → platform/ledger; hash → platform/blob-store |
| `approval_uses` | ApprovalUse | `approval` PK | approval 전체 영역에서 최대 1행 | `(concern, accepted_seq)` | approval FK → `approval_requests.id`; accepted_seq FK → platform/ledger; receipt는 소유 concern의 접수·변경 참조 검사 |

`approval_requests.action_binding_hash`는 고정 action.binding_hash를 추출한 indexed column이며 값이 action과 항상 같아야 한다. `approval_uses`는 공통 검사·사용 함수만 쓴다. 적용 영역도 자기 접수·변경에 approval FK를 남긴다. 두 연결과 소유 영역의 변경·event는 같은 transaction에서 확정한다. 표·event·blob 참조 삭제와 공통 요청 결과는 → platform/ledger, platform/blob-store.

## command

모든 command의 인증·idempotency key·공통 오류는 → platform/ledger. actor는 요청 본문이 아니라 → platform/identity.

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `create_approval_request` | 권한 있는 요청자 또는 `machine` | id, 원래 requester 근거, run?, reason(글), effect(changes·external?·reversible·reversibility 글), action, expires_at? | 소유 command schema·현재 권한·run 유효성·거절 억제 범위 | `ApprovalRequestCreated` | `invalid_input`, `forbidden`, `not_found`, `conflict`, `unavailable` |
| `read_approval_text` | `user`, `machine`, 그 request를 볼 수 있는 요청자 | approval | request를 볼 수 있는 범위(설명 글과 거절·취소 이유 글, 이유가 없으면 null); 범위 밖은 없는 request와 같은 `not_found`; 글 blob 하나라도 읽을 수 없으면 `unavailable` | 없음 | `invalid_input`, `not_found`, `unavailable` |
| `grant_approval_request` | `user` | approval, created_seq, binding_hash, confirmation 증거 | pending·현재 내용·전제·기한; 증거와 결정 저장 원자적 | `ApprovalRequestGranted` | `forbidden`, `not_found`, `conflict` |
| `reject_approval_request` | `user` | approval, created_seq, binding_hash, confirmation 증거, closed_reason(글)? | pending·현재 내용·기한 | `ApprovalRequestRejected` | `forbidden`, `not_found`, `conflict` |
| `expire_approval_request` | `machine` | approval, created_seq | pending·지정 기한 도달 | `ApprovalRequestExpired` | `forbidden`, `not_found`, `conflict` |
| `cancel_approval_request` | `user`, 원래 요청자, `machine` | approval, created_seq, closed_reason(글)? | pending; 원래 요청자 일치 또는 종료·전제 변경 근거 | `ApprovalRequestCancelled` | `forbidden`, `not_found`, `conflict` |
| `apply_approved_action` | 적용 권한이 있는 `machine` 또는 고정 caller | approval, 고정 action, 소유 접수·변경의 idempotency key | granted·미사용·기한·원래 일 유효·action 완전 일치·현재 권한·소유 CAS | → action.concern의 접수·변경 event | `forbidden`, `not_found`, `conflict` |

`apply_approved_action`은 고정 action의 등록된 소유 command로만 dispatch한다. 승인 확인과 사용 연결만 따로 확정하는 공개 command는 없다. 소유 command의 성공 재전송은 동일 접수·변경을 반환하고 새 event·사용 행을 만들지 않는다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `ApprovalRequestCreated` | approval | `binding_hash` | platform/notifications, lophn-agent/harness/waiting-and-recovery |
| `ApprovalRequestGranted` | approval | `created_seq`, `binding_hash` | action.concern, lophn-agent/harness/waiting-and-recovery |
| `ApprovalRequestRejected` | approval | `created_seq`, `closed_reason_blob?` | action.concern, lophn-agent/harness/waiting-and-recovery |
| `ApprovalRequestExpired` | approval | `created_seq`, `closed_reason_blob`(항상 null) | action.concern, lophn-agent/harness/waiting-and-recovery |
| `ApprovalRequestCancelled` | approval | `created_seq`, `closed_reason_blob?` | action.concern, lophn-agent/harness/waiting-and-recovery |

허락·거절 event의 actor는 `user`, envelope의 run은 null이다. 원래 run은 request에서 읽는다. 적용 성공·실패 event는 적용 concern이 소유한다.

## 정책

- **글은 값이다.** 요청의 `reason`과 `effect`의 `changes`·`external`·`reversibility`, 거절·취소의 `closed_reason`은 글(UTF-8, 글 하나 32KiB 이하, 공백뿐인 글 금지)을 값으로 싣는다. 호출자는 hash를 만들지도 blob을 준비하지도 않는다. core가 command 앞에서 글을 redaction해 UTF-8 bytes로 blob을 준비(purpose `approval_text`, 보낸 자격의 principal)하고 command가 같은 transaction에서 영구 참조(owner_kind `approval_request`, field reason·changes·external·reversibility·closed_reason; 종료 이유는 종료와 같은 transaction에서)를 등록한다. 저장·event·record는 그대로 blob hash(`reason_blob`, `effect.*_blob`)다. 글은 일반 blob read로 열지 않고 `ReadApprovalText`(`/v1/approvals/text`)가 request를 볼 수 있는 쪽에만 돌려준다. 메시지 본문·질문 글과 같은 길이다. → lophn-agent/conversation, lophn-agent/questions
- **결정 표시.** 기본 화면은 동작·대상·이유·변경과 외부 전송·보존 데이터·되돌릴 수 없는 영향을 사람이 아는 말로 요약한다. 필수 설명을 숨겨 결정을 유도하지 않는다. 기술적인 호출 출처·정확한 입력·CAS는 redaction된 상세에서 확인하며 표시용 요약이 action 결속을 바꾸지 않는다. en·message key·child modal과 입력 차단은 → shell/wording, shell/confirmation-window다. → platform/approvals#R17
- **한 번 사용.** ledger 변경은 유효성 검사·`approval_uses` INSERT·소유 변경을 같은 짧은 transaction에서 한다. ledger 밖 동작은 접수·사용 연결부터 함께 확정하고 밖에서 수행한다. 동작 시작 뒤 사용 연결을 쓰지 않는다.
- **confirm 접수.** 앱 confirm은 `accepted` invocation과 approval 사용을 같은 command에서 확정한다. 결과 불명확·실패·재전송은 같은 접수이며 허락을 다시 쓰지 않는다. → apps/invocations
- **현재 권한.** 허락은 권한 검사를 면제하지 않는다. tool 판정 `deny`는 approval request로 우회하지 않는다. → lophn-agent/harness/tool-judgment
- **지속 범위.** permission grant·Operator assignment 결정은 고정 범위 하나만 허락한다. 범위 확대는 새 request다. → apps/permissions, lophn-agent/assignments
- **거절 억제.** rejected request의 같은 command·대상·입력은 같은 run 및 같은 원래 사람 요청에서 handoff로 이어진 run에서 다시 묻지 않는다. 설명만 바꿔도 같다. 새로운 사람 요청은 억제하지 않는다. 판정과 run 계보 검사는 → lophn-agent/harness/tool-judgment, lophn-agent/handoff.
- **기다림 결과.** granted는 재검사 뒤 해당 호출 접수, rejected·expired·cancelled는 미실행이다. 호출 미실행은 사람 결정이며 실패로 세지 않는다. run의 새 판단·종료 후 미재개는 → lophn-agent/harness/waiting-and-recovery.
- **기한.** 기본 `expires_at`은 null이다. 기한 경계부터 결정과 새 사용을 거절한다. request의 자동 허락은 없다.

## 정할 것

- action 입력 정규화·binding hash의 직렬화 contract를 → platform/ledger 및 각 command 소유 concern과 맞춘다. hash와 작은 JSON/blob의 동일 입력 판정이 같아야 한다. 승인은 confirmation window에서만 받는다.
- confirmation 증거의 기한·재시작 무효화·전송 형식은 → shell/confirmation-window. 증거와 approval 사용 연결은 서로 다른 값이다.
