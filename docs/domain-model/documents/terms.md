---
type: domain-model
concerns: [documents/terms]
---
# documents/terms

Context별 Term의 이름·사람 정의·고정 출현 근거와 후보 구분을 정의한다.

## Term (`trm`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `trm` ID | 아니오 | PK, 불변 | |
| `context` | `ctx` ID | 아니오 | → documents/contexts; 생성 뒤 고정 | |
| `name` | string | 아니오 | 공백만 있는 문자열 금지; 같은 Context의 active 이름 유일 | 정확한 용어 이름 |
| `definition` | string | 예 | null이면 후보; 비null이면 공백만 있는 문자열 금지 | 사람이 정한 뜻 |
| `evidence` | TermEvidence[] | 아니오 | agent 후보에는 1개 이상; 사람 직접 정의에는 빈 목록 허용 | |
| `revision` | event seq | 아니오 | 마지막 이름·정의·근거·보관 변경 seq | CAS 기준 |
| `status` | `active \| archived` | 아니오 | 생성은 active | |

### 상태

| 상태 | 뜻 |
|---|---|
| `active` | 현재 Context 용어 목록 대상 |
| `archived` | 쓰지 않는 후보·용어; 정의·근거는 유지 |
| 후보(계산) | definition null |
| 정의됨(계산) | definition non-null |

후보·정의됨은 별도 status 열이나 approval 상태가 아니다.

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | active 후보 | `user`, 허용된 Context Engineer `agent` | 이름·고정 출현 근거 유효 | `TermProposed` |
| 없음 | active 정의됨 | `user` | 이름·정의 유효; 직접 등록 허용 | `TermDefined` |
| 후보 | 정의됨 | `user` | base_revision 일치; 사람 정의 | `TermDefined` |
| 정의됨 | 정의됨 | `user` | base_revision 일치; 이름·정의 수정 | `TermUpdated` |
| `active` | `archived` | `user`, 허용된 CE `agent` | base_revision 일치 | `TermArchived` |
| `archived` | `active` | `user`, 허용된 CE `agent` | base_revision 일치; 활성 이름 충돌 없음 | `TermUnarchived` |

### 불변 조건

- agent는 definition을 쓰거나 사람의 definition·정의된 이름을 바꾸지 못한다. 사람이 답한 정의를 machine이 적용해도 결정 actor는 user다(→ lophn-agent/questions, platform/identity).
- agent가 만든 후보는 실제 본문 출현 근거가 있어야 한다. 후보 개수·문서 수의 고정 임계값은 없다.
- 활성 이름 비교는 정확한 문자열 기준이다. 별칭·번역 관계·Context 사이 대응·용어 상속은 없다.
- 후보는 읽기에서 별도로 묶는다. 문맥 조립이 후보를 정의처럼 싣지 않는다(→ lophn-agent/harness/prompt-assemble).
- Context 보관은 Term을 자동 보관하거나 definition을 삭제하지 않는다.
- 뜻의 충돌은 문서나 질문으로 남기며 자동 통합하지 않는다.

## TermEvidence (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `document` | `doc` ID | 아니오 | → documents/versions | |
| `version` | `ver` ID | 아니오 | 같은 Document의 고정 판 | |
| `section` | string | 예 | 해당 판의 Format key → documents/formats | |
| `start_line` | integer | 예 | `>= 1`; 대표 텍스트 범위 | |
| `end_line` | integer | 예 | start_line과 함께 존재; `>= start_line` | |

동일 고정 판·section·범위 근거는 중복하지 않는다. 최신 주소만으로 근거를 남기지 않는다. section 또는 줄 범위를 읽을 수 없으면 근거의 실패를 표시하고 최신 판으로 바꿔치기하지 않는다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Term | Context 범위 | Context → documents/contexts | N:1 | 보관에도 참조 유지; 영구 삭제 없음 |
| TermEvidence | 고정 출현 | Version → documents/versions | N:1 | 고정 판 삭제 없음; 읽기 실패 표시 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `terms` | `id, context, name, definition, revision, status` | PK `id` | `(context, name)` where status=active | `(context, status, name)`, `(context, definition)` | context → documents/contexts; revision → platform/ledger |
| `term_evidence` | `term, position, document, version, section, start_line, end_line` | PK `(term, position)` | `(term, document, version, section, start_line, end_line)`의 null-safe 동일성 | `(version)` | term → `terms.id`; `(document, version)` → documents/versions |

position은 0부터 연속인 정수다. nullable evidence 키는 같은 null도 동일한 근거로 검사한다. 근거 교체·revision·event는 한 transaction이다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `term.propose` | `user`, 허용된 CE `agent` | `id, context, name, evidence`, idempotency key | ID·활성 이름 미존재; 고정 근거 유효 | `TermProposed` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `term.define` | `user`; 검증된 사람 답 적용 machine의 `user` actor | 기존 term 또는 새 `id, context, name`, definition | 기존이면 base_revision; 새 ID·활성 이름 미존재 | `TermDefined` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `term.update` | `user`; 후보 이름·근거만 허용된 CE `agent` | `term, name?, definition?, evidence?` | base_revision; CE는 후보만, definition 입력 금지; 활성 이름 유일 | `TermUpdated` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `term.archive` | `user`, 허용된 CE `agent` | `term` | base_revision, active | `TermArchived` | `not_found`, `conflict`, `forbidden` |
| `term.unarchive` | `user`, 허용된 CE `agent` | `term` | base_revision, archived, 활성 이름 미사용 | `TermUnarchived` | `not_found`, `conflict`, `forbidden` |

정의를 null로 지우는 전이는 현재 제공하지 않는다. agent run의 후보 변경은 종료 run을 거절하며 이후 revision이 바뀌면 revert하지 않는다(→ lophn-agent/harness/run-loop, lophn-agent/revert). 사람 definition은 agent run revert 대상이 아니다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `TermProposed` | `trm` | `context, name, evidence` 또는 blob 참조 | documents/outline-and-search |
| `TermDefined` | `trm` | `context, name, before_definition, definition, before_revision`(새 등록은 null) | documents/outline-and-search |
| `TermUpdated` | `trm` | 변경 필드의 before·after, before_revision; 큰 evidence는 blob 참조 | documents/outline-and-search, lophn-agent/revert |
| `TermArchived` | `trm` | `context, before_revision` | documents/outline-and-search |
| `TermUnarchived` | `trm` | `context, before_revision` | documents/outline-and-search |

## 정책

- **목록.** Context 용어 읽기는 active 정의와 후보를 나누고 고정 근거를 반환한다. 정의 목록은 첫 페이지 최대 30개와 cursor를 기본으로 한다.
- **앱 용어.** 앱 read command를 항목으로 가진 Context의 용어는 읽기 근거일 뿐 앱 blueprint에 자동 복사하지 않는다(→ apps/blueprint).

## 정할 것

- 이름의 Unicode 정규화·case 비교를 정확한 문자열 외로 넓힐지. 현재 별칭·번역·Context 대응은 없다.
- 사람 정의 삭제 또는 정의됨에서 후보로 되돌리는 command를 추가할지. 현재 전이는 정의 수정·보관뿐이다.
