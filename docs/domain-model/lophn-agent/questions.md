---
type: domain-model
concerns: [lophn-agent/questions]
---
# lophn-agent/questions

Question의 고정 option·option action, 명시적 답, 기한과 채택 참조를 정의한다.

## Question (`qst`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `qst` ID | 아니오 | PK | 질문 |
| `session` | `ses` ID | 예 | 있으면 run의 session과 같음; → lophn-agent/conversation | 관련 세션 |
| `run` | `run` ID | 아니오 | 유효한 agent run; → lophn-agent/harness/run-loop | 답을 기다리는 run |
| `prompt_blob` | sha256 | 아니오 | 비어 있거나 공백뿐인 글 금지; → platform/blob-store | 묻는 내용 |
| `reason_blob` | sha256 | 아니오 | 비어 있거나 공백뿐인 글 금지 | 질문 설명 |
| `options` | Option 배열 | 아니오 | 순서 고정; key는 질문 안에서 unique; 빈 배열 허용 | 단일 선택 후보 |
| `recommendation` | Recommendation | 예 | option key가 있으면 실제 option 참조 | 추천 |
| `expires_at` | UTC ISO 8601 밀리초 문자열 | 예 | 지정 시 생성 시각보다 뒤; 답은 `now < expires_at` | 답 기한 |
| `status` | `pending / answered / expired / cancelled` | 아니오 | 생성 시 pending | 질문 상태 |
| `answer` | Answer | 예 | answered와 non-null이 동치 | 명시적 답 |
| `closed_reason_blob` | sha256 | 예 | expired·cancelled이면 필수; pending·answered이면 null | 종료 설명 |
| `created_seq` | event seq | 아니오 | 생성 event 참조; 불변; → platform/ledger | 고정 내용 기준 |
| `closed_seq` | event seq | 예 | pending과 null이 동치; 종료 event 참조 | 답·종료 기준 |

session·run·본문·options·추천·기한은 생성 뒤 불변이다. 생성·답의 actor와 시각은 event에서 읽는다.

### 상태

| 상태 | 뜻 |
|---|---|
| `pending` | 명시 답 대기 |
| `answered` | 답 저장됨; option action 적용 완료와 별개 |
| `expired` | 답 없이 지정 기한 종료 |
| `cancelled` | 미루기 또는 취소로 답 없이 종료 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | pending | `agent` | 현재 run 유효; 같은 run의 pending 질문 없음 | `QuestionCreated` |
| pending | answered | `user` | 질문 ID 명시·기한 유효·run 미종료; action option이면 confirmation window 증거 소비 | `QuestionAnswered` |
| pending | expired | `machine` | 기한 있음; `now >= expires_at` | `QuestionExpired` |
| pending | cancelled | `user`, 질문한 `agent`, `machine` | 미루기·명시 취소·원래 일 종료/취소·전제 변경 근거 | `QuestionCancelled` |

### 불변 조건

- run 하나의 pending 질문은 최대 1개다. session 없는 run에도 동일하다. session을 임의로 만들지 않는다.
- 질문 하나는 독립적인 사람의 의도·취향·선택 하나만 담는다. 읽어서 확인한 사실·이미 답한 같은 선택을 다시 묻지 않는다.
- 자유 답은 options 유무와 관계없이 가능하다. 단일 option 선택 또는 자유 답 하나만 받는다. 빈 답·공백만 있는 답은 거절한다.
- 종료 질문은 재개·답 수정하지 않는다. 새로운 요청은 새 질문이다. 늦은 답·다른 중복 답·끝난 run의 답은 conflict다. 정확한 command 재전송은 저장된 결과만 반환한다.
- 화면 닫기·재시작·침묵은 답이나 취소가 아니다. 유효한 질문과 저장된 답은 ledger에 남는다.

## Option (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `key` | string | 아니오 | 비어 있지 않음; 질문 안 unique; 별도 entity ID 아님 | 선택 키 |
| `label` | string | 아니오 | 비어 있거나 공백뿐인 글 금지 | 이름 |
| `description_blob` | sha256 | 아니오 | 비어 있지 않은 설명; → platform/blob-store | 선택 내용 |
| `evidence` | FixedVersionReference 배열 | 아니오 | 빈 배열 허용; 중복 고정 참조 금지 | 근거 |
| `adoption` | FixedVersionReference | 예 | 채택 option이면 필수; 다른 version으로 치환 금지 | 선택으로 채택하는 판 |
| `action` | OptionAction | 예 | 되돌릴 수 있는 lophn 내부 동작만 | 고정 적용 동작 |

## FixedVersionReference (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `document` | `doc` ID | 아니오 | → documents/versions | 문서 |
| `version` | `ver` ID | 아니오 | 그 document의 실제 불변 version; → documents/versions | 고정 판 |
| `section` | string | 예 | 지정 시 그 고정 판의 section; → documents/formats | 근거 절 |

이 값은 Question의 참조 구조이며 Document·Version 자체를 정의하지 않는다.

## OptionAction (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `concern` | concern id | 아니오 | 등록된 내부 동작의 소유 concern | 적용 영역 |
| `command` | string | 아니오 | 소유 concern의 허용 command | 동작 |
| `targets` | ID 배열 | 아니오 | 비어 있지 않음; 중복 없음; 고정 ID; 생성 대상은 미리 배정한 ID | 대상 묶음 |
| `input` | `{kind: inline, value: JSON object}` 또는 `{kind: blob, sha256: sha256}` | 아니오 | 둘 중 하나; 소유 command schema 통과; 큰 입력은 blob | 정확한 입력 |
| `input_hash` | sha256 | 아니오 | 소유 command의 정규화한 입력 hash와 일치 | 입력 지문 |
| `comparison` | JSON object | 아니오 | 소유 command의 CAS schema; 판·seq·hash 등 실제 비교 기준 | 현재 전제 |
| `binding_hash` | sha256 | 아니오 | concern·command·targets·input_hash·comparison 전체 지문; 생성 뒤 불변 | 표시·제출 내용 기준 |

- action은 option 하나에 최대 1개다. 권한 부여·외부 효과·복원 불가 동작은 이 값으로 허용하지 않는다. → platform/approvals
- agent에게 action의 command 권한을 주지 않는다. 저장된 선택을 근거로 인증된 machine이 적용을 요청하고 event actor는 user, run은 null이다. → platform/identity
- 표시와 적용은 같은 고정 action에서 만든다. secret 원문은 입력·답·event에 넣지 않는다. → shell/confirmation-window, platform/secrets

## Recommendation (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `option_key` | string | 예 | options가 있으면 실제 option key 필수; options가 비면 null | 추천 후보 |
| `explanation_blob` | sha256 | 아니오 | 비어 있지 않음; → platform/blob-store | 추천 설명 |

## Answer (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `option / text` | 아니오 | 판별자 | 답 종류 |
| `option_key` | string | 예 | kind=option이면 필수·실제 option key; kind=text이면 null | 단일 선택 |
| `text_blob` | sha256 | 예 | kind=text이면 필수·비어 있거나 공백뿐인 글 금지; kind=option이면 null | 자유 답 |

채택은 answered 질문의 선택한 option.adoption으로 판정한다. 새로운 version은 자동 채택하지 않는다. 채택을 참조하는 ticket·handoff는 같은 document·version과 question ID를 함께 보관한다. → coding-agent/tickets, lophn-agent/handoff

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Question | 원래 run | → lophn-agent/harness/run-loop | N:1 | 참조 유지; pending은 종료 근거로 취소 |
| Question | 관련 session | → lophn-agent/conversation | N:0..1 | 참조 유지; 화면 닫기는 취소 사유 아님 |
| Option | 근거·채택 | → documents/versions | N:0..N | 고정 version 참조 보존 |
| OptionAction | 적용 대상 | → action.concern | N:1..N | 답은 보존; 적용은 not_found/conflict |
| 소유 적용 기록 | 선택 출처 | Question + option key | 0..1:1 | 답·적용 연결 보존 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `questions` | Question; 고정 options·추천 및 answer JSON | `id` PK | `run WHERE status = 'pending'`; `created_seq`; `closed_seq`(null 제외) | `(status, expires_at)` pending partial; `(run, created_seq)`; `(session, created_seq)` | run → lophn-agent/harness/run-loop; session → lophn-agent/conversation; seq → platform/ledger; hash → platform/blob-store; version·action 대상은 소유 concern 검사 |

option·action·recommendation·answer는 질문 안의 값이고 독립 ID·표가 없다. option action의 접수·적용 결과는 대상 concern의 실제 표가 `(question, option_key)` unique와 question FK를 제공한다. 별도 Proposal·Suggestion·채택 entity나 이 concern의 적용 상태 표는 없다.

## command

인증·공통 idempotency·오류는 → platform/ledger, platform/identity.

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `create_question` | `agent` | id, run, session?, prompt_blob, reason_blob, options, recommendation?, expires_at? | 현재 run·assignment 범위·pending 질문 없음·action 허용 schema | `QuestionCreated` | `invalid_input`, `forbidden`, `not_found`, `conflict` |
| `answer_question` | `user` | question, created_seq, Answer, action 선택이면 binding_hash·confirmation 증거 | pending·내용 일치·기한 유효·run 미종료; action 증거와 답 저장 원자적 | `QuestionAnswered` | `invalid_input`, `forbidden`, `not_found`, `conflict` |
| `defer_question` | `user` | question, created_seq | pending·현재 내용 | `QuestionCancelled` (`closed_reason=deferred`) | `not_found`, `conflict` |
| `cancel_question` | `user`, 질문한 `agent`, `machine` | question, created_seq, closed_reason_blob | pending·생성 actor 일치 또는 원래 일 취소/종료·전제 변경 근거 | `QuestionCancelled` | `forbidden`, `not_found`, `conflict` |
| `expire_question` | `machine` | question, created_seq | pending·지정 기한 도달 | `QuestionExpired` | `forbidden`, `not_found`, `conflict` |
| `apply_question_option` | `machine` | question, answered_seq, option_key, 고정 action | answered·실제 선택 key 일치·action 완전 일치·현재 범위·소유 CAS·미적용 | → action.concern의 접수·변경 event | `forbidden`, `not_found`, `conflict` |

`apply_question_option`은 등록된 소유 command로만 dispatch한다. action 없음·자유 답은 적용할 command가 없다. 기존 `(question, option_key)` 적용이 있으면 새 적용 없이 그 기록을 반환한다. 답 저장은 적용 성공을 뜻하지 않는다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `QuestionCreated` | question | `run`, `session?` | platform/notifications, lophn-agent/harness/waiting-and-recovery |
| `QuestionAnswered` | question | `created_seq`, Answer, 선택 option의 `binding_hash?` | action.concern(있을 때), lophn-agent/harness/waiting-and-recovery |
| `QuestionExpired` | question | `created_seq`, `closed_reason_blob` | lophn-agent/harness/waiting-and-recovery |
| `QuestionCancelled` | question | `created_seq`, `closed_reason_blob`, `deferred: boolean` | lophn-agent/harness/waiting-and-recovery |

답 event는 actor=user, envelope run=null이다. 원래 run은 Question.run에서 읽는다. option 적용 event도 actor=user/run=null이며 agent run revert 목록에 넣지 않는다.

## 정책

- **고정 입력 포장.** OptionAction 정규화·binding hash는 platform/ledger와 소유 command schema contract를 쓴다.

- **답 기한.** 기본 expires_at=null이며 options 수의 고정 상한·900초 기본 기한은 없다. 기한이 있는 경우 그 경계부터 답을 받지 않는다.
- **답 없음.** 만료·미루기·취소는 답 없이 종료다. 같은 run의 stopped 및 reason은 → lophn-agent/harness/waiting-and-recovery. 자동 기본 답·추정 적용은 없다.
- **재개.** 답은 같은 run으로 전달한다. 고정 action이 있으면 대상 적용 결과를 확인한 뒤 그 결과와 함께 재개한다. 적용 CAS conflict는 답을 지우지 않고 동작 미적용으로 남긴다. 바뀐 기준은 새 질문의 고정 option을 다시 확인해야 한다. → lophn-agent/harness/waiting-and-recovery
- **자유 답.** 자유 답은 command로 해석하지 않는다. 후속 동작은 새 고정 option 확인 또는 사람의 직접 command다.
- **secret.** 질문으로 password·API key·token을 받지 않는다. secret 판정된 답은 일반 blob·model 입력에 넣지 않고 안전 입력으로 처리한다. → platform/secrets, platform/redaction
- **Operator 대기.** pending run이 있는 assignment의 주기 처리와 건너뛰기는 → lophn-agent/scheduling. 질문 생성·답이 새 agent run의 event 계기를 만들지 않는다.

