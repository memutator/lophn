---
type: domain-model
concerns: [lophn-agent/roles/operator]
---
# lophn-agent/roles/operator

Operator Role의 context 읽기 상한, 선택 가능한 tool, slot과 반복 판단 결과의 고정 값을 정의한다.

## OperatorRoleValues (값)

Role의 모양은 → lophn-agent/role-definition, 구체적 책임·Assignment는 → lophn-agent/assignments, 공통 금지는 → lophn-agent/roles/common이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | enum | 아니오 | `operator` | 책임 종류 |
| `name` | string | 아니오 | 구체적 반복 판단을 드러내는 승인된 이름; 빈 내장 정의는 실행 불가 | 고르는 이름 |
| `scope_kind` | enum | 아니오 | `context` | Assignment context 하나 |
| `perspective` | string[] | 아니오 | 담당 context 목적·term·기준/참고/watch, 구체적 comparison_basis | prompt 관점 |
| `expected_results` | string[] | 아니오 | 실제 확인한 사실·판단·불확실함·근거 주소, 또는 갱신할 내용 없음의 근거 | 결과 내용 |
| `triggers` | enum[] | 아니오 | 고정 `user_request`, `schedule`; Role 필드로 저장하지 않음 | 허용 계기 |

Role의 OperatorJudgment.question·evidence·comparison_basis·update_condition은 모두 필수다. 책임 밖 설명은 공통 금지를 줄이지 못한다. 실제 Schedule·남길 문서 값은 → lophn-agent/assignments와 lophn-agent/scheduling이다.

### 읽기 범위 값

| 대상 | 허용 값 | 참조 |
|---|---|---|
| 담당 context | 목적·term·item·관점 | documents/contexts, documents/terms |
| 현재 context의 문서 item | 현재 허용된 문서·절의 목차·고정 Version·본문·이력·차이·검색 | documents/contexts, documents/versions, documents/outline-and-search |
| 승인된 남길 문서 | 고정 document ID의 Version·이력·차이·본문 | lophn-agent/assignments, documents/versions |
| 승인된 앱 명령 | Assignment.read_commands의 정확한 `(app, command)` 쌍이며 app은 read_apps, command 이름은 Role.ToolSelection.app_command에 선택된 `effect = read` 명령의 metadata·결과 | apps/blueprint, apps/runtime |
| 자기 Question·approval 결정 | 자기 Run에 연결된 결정 | lophn-agent/questions, platform/approvals |

여러 앱이 context에 있어도 범위 종류는 context 하나다. 결과 문서가 가리킨 다른 자료·context 밖 문서·전체 앱 metadata를 따라 읽지 않는다. 앱 read command가 secret 사용·외부 반출·쓰기 효과를 숨기면 제공하지 않는다.

### tool 선택 상한

구체적 Role은 아래 개별 동작 중 필요한 것만 승인받아 선택한다. 묶음이 바뀌어도 승인 목록은 늘지 않는다.

| 묶음 | 선택 가능한 개별 동작 | 제약 |
|---|---|---|
| context 읽기 | `context.read`, `context.items`, `context.terms`, `term.read` | Assignment context만 |
| 문서 읽기 | `document.list`, `document.outline`, `document.search`, `document.read_version`, `document.read_section`, `document.read_range`, `document.history`, `document.diff` | 허용 context 자료·선언 문서만 |
| format 읽기·검사 | `format.list`, `format.rules`, `format.examples`, `format.validate` | 필요한 문서 저장 계약 확인 |
| 남길 문서 | `document.save_version` | 승인한 기존 document 새 Version만; 읽은 Version CAS |
| 앱 read command | `app.command_metadata`, `app.call_read_command` | 승인된 `(app, command)`·read_apps·현재 effect 확인 |
| 사람에게 묻기 | `question.submit`, `question.read_decision`, `approval.read_decision` | 판단에 필요한 의도·취향·결과 해석; 다른 tool 권한을 주지 않음 |

### slot 값

| 호출 용도 | slot |
|---|---|
| 변화·의미·불확실함 판단 | `judgment` |
| 남길 문서 본문 | `judgment` |
| 이미 정한 결과 제목 | `organizing` |
| 이미 정한 결과 요약 | `organizing` |

### 결과 값

| 결과 종류 | 필수 내용 | 제약 |
|---|---|---|
| 갱신 결과 | 확인한 사실·판단·불확실함·고정 근거 주소·선언한 판단 항목 | 승인된 update_condition에 맞을 때만 새 Version |
| 무변화 결과 | 갱신 조건을 충족하지 않은 근거 | 새 Version 0개; Run 결과 `completed` |
| 부분 결과 | 실제 저장된 문서·Version, 미저장·실패 내용 | 일부 저장을 전체 성공이나 전체 취소로 표시하지 않음 |
| 지속할 사람 답 | 승인된 판단 항목에 필요한 답·결과 해석 | 선언한 기존 문서 새 Version에만 저장 |

## 정책

- **문서 쓰기 allow.** 승인한 선언 문서 새 Version은 회차마다 다시 approval를 묻지 않는다. 다른 문서 쓰기는 ask가 아니라 deny다. document.create·이동·rename·archive·삭제는 제공 tool 0개다.
- **변화 없음.** 갱신 조건 미충족은 실패가 아니다. 무변화 완료는 Assignment 연속 실패를 끊는다. 결과 수 상한은 없고 실제 승인한 문서 수 안에서만 저장한다.
- **정의 불변.** 사람의 판단 답은 Role·scope·Schedule·tool 변경 승인이 아니다. 자기 Role·Assignment 변경 tool은 없다. 변경은 전체 승인 → lophn-agent/assignments다.
- **기다림.** 판단에 필요한 Question은 주기 Run에서도 허용한다. 기다리는 동안 accepted 포함 미종료 Run이 있으면 다음 회차를 skip한다. 기한·same Run 재개는 → lophn-agent/harness/waiting-and-recovery다.
- **금지.** 기획·앱 설계·수리 ticket·코드·context/term 변경·색인 보강·프로젝트/SDK/problem/ticket/Role·Assignment 목록 tool·앱 write/confirm/external 명령·handoff 송수신은 제공 tool 0개다.
- **반복 실패.** 실패 무시·계속 옵션은 없다. 실제 시작한 Run의 연속 최종 failed 3회 pause는 → lophn-agent/assignments만 소유한다. 다음 회차·event·재시작은 resume가 아니다.
- **handoff 없음.** 사람은 Assignment를 직접 선택해 요청할 수 있다. Operator가 handoff를 받거나 보내는 경로는 없다. → lophn-agent/handoff.

## 정할 것

- **H8.** 질문 대기 중 모든 주기 skip 유지 여부. 현재 skip이다.
- 외부 MCP·skill은 현재 0개다. 구체적 반복 절차를 지원할 때 → lophn-agent/extensions와 먼저 계약을 정한다.
- tool 식별자 철자는 → lophn-agent/harness/tools와 맞춘다.
