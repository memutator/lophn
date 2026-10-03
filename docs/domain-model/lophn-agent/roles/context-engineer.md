---
type: domain-model
concerns: [lophn-agent/roles/context-engineer]
---
# lophn-agent/roles/context-engineer

Context Engineer Role의 읽기 상한, tool 선택, slot과 context·term 후보·Operator 초안의 고정 값을 정의한다.

## ContextEngineerRoleValues (값)

Role의 모양은 → lophn-agent/role-definition, 공통 금지는 → lophn-agent/roles/common이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | enum | 아니오 | `context_engineer` | 책임 종류 |
| `name` | string | 아니오 | `Context Engineer` | 내장 이름 |
| `scope_kind` | enum | 아니오 | `all` | 저장된 자료의 전체 범위 |
| `schedule` | null | 예 | 주기 없음; Role 필드로 저장하지 않음 | 사람 요청·허용 handoff만 |
| `perspective` | string[] | 아니오 | context 목적·경계, 기준·참고·watch 구분, 사람이 정한 뜻과 후보 구분 | prompt 관점 |
| `expected_results` | string[] | 아니오 | 목적에 맞는 context 구성, 관점별 선택 근거, term 후보, 고정 근거를 가진 설계 보고·Operator 초안 | 결과 내용 |

### 읽기 범위 값

| 대상 | 허용 값 | 참조 |
|---|---|---|
| 전체 context·term·문서·project | 목적·item·term·소속·목차·검색·필요한 고정 Version·절·본문·이력·차이 | documents/contexts, documents/terms, documents/versions, documents/outline-and-search, documents/projects |
| 앱 | 목적·blueprint 명령 목록의 이름·설명·입력 schema·effect | apps/registration, apps/blueprint |
| Role·Assignment·Run | 정의·판·scope·outputs·Schedule·상태·확정 결과 | lophn-agent/role-definition, lophn-agent/assignments, lophn-agent/harness/run-loop |
| 반복 판단 근거 | 사람이 제공한 수동 업무, 현재 context의 watch 변화·기준 자료 상태·기존 Operator 결과 | documents/contexts, lophn-agent/assignments |

앱 read command의 metadata는 읽지만 호출 결과·업무 DB를 읽는 권한은 없다.

### tool 선택 값

공통 문서·context·term·format 읽기와 question 동작은 → lophn-agent/roles/common의 개별 목록 전체를 선택한다.

| 묶음 | 추가 개별 동작 | 제약 |
|---|---|---|
| 프로젝트·앱 metadata | `project.list`, `project.read`, `app.list`, `app.read_purpose`, `app.commands` | 앱 명령 호출 없음 |
| context 변경 | `context.create`, `context.rename`, `context.set_purpose`, `context.archive`, `context.add_item`, `context.update_item`, `context.remove_item` | → documents/contexts의 CAS·되돌림 계약 |
| term 후보·답 전달 | `term.propose_candidate`, `term.update_candidate`, `term.remove_candidate`, `term.submit_definition_answer` | 마지막 동작은 사람 Question 답 참조 전달만; 실제 정의 적용은 machine; → documents/terms |
| 문서 결과 | `document.create`, `document.save_version` | Run 요청 범위; 기준 Version 필수 |
| 역할·assignment 읽기 | `role.list`, `role.read`, `assignment.list`, `assignment.read`, `run.read_result` | 실제 Role·Assignment 적용 없음 |
| 승인 초안 | `approval.submit_assignment` | OperatorApprovalBundle → lophn-agent/assignments; 승인 생성 → platform/approvals |
| handoff | `handoff.submit`, `handoff.read_status`, `handoff.read_result` | → lophn-agent/handoff의 허용 방향만 |

### slot 값

| 호출 용도 | slot |
|---|---|
| context 목적·경계·관점 | `judgment` |
| term 후보·충돌 해석 | `judgment` |
| Operator 정의 초안·반복 판단 필요성 | `judgment` |
| 결정한 구성·초안의 제목 | `organizing` |
| 결정한 내용의 요약 | `organizing` |

### 결과 값

| 결과 종류 | 필수 내용 | 제약 |
|---|---|---|
| context 설계 보고 | context별 목적·범위·term·경계 | 범위는 item 주소·관점·한 줄 근거; term은 사람 채택한 것 최대 30개와 미정 후보 별도; 경계는 책임 밖 |
| 관점 선택 | 목적에 대한 책임 근거 `기준`, 배경 지식 `참고`, 변화 추적 `watch` | 같은 문서도 context마다 다른 관점 허용; 값 정의는 → documents/contexts |
| term 후보 | 아직 등록되지 않은 말·출현 주소·사람에게 물을 정의 | 같은 context의 서로 다른 문서 3개 이상 본문에 그대로 출현; 후보당 근거 주소 최대 5개 |
| term 대응·충돌 | 같은 뜻의 다른 말은 대응 후보, 같은 말의 다른 뜻은 미정 충돌 | 사람 답 없으면 정의 확정 불가; → documents/terms |
| Operator 초안 | 이름·목적·상황·prompt 네 설명·반복 질문·근거·비교 기준·갱신 조건·책임 밖·context 하나·읽을 앱/명령·실제 남길 문서·주기·tool 선택·전후 판·변경 설명 | 적용 내용은 OperatorApprovalBundle → lophn-agent/assignments; 공통 model·skill·run 한도·권한 예외 없음 |

## 정책

- **후보 근거 값.** 사람 요청에서 Operator 후보 검토 근거는 최근 30일 watch 변화 4회 이상, 기준 자료 뒤처짐 14일 이상, 최근 30일 같은 수동 업무 4회 이상 중 하나다. 이 집계 자체는 새 Run 계기가 아니다.
- **반복 판단.** 단순 합계·자료 수집만 있는 후보는 Operator 초안으로 만들지 않는다. 같은 context에 책임이 겹치는 Operator가 있으면 기존 Assignment 정의·남길 문서 변경 승인 후보로 남긴다.
- **남길 문서.** Operator 초안은 실제 기존 문서 최소 1개를 지정한다. 필요한 양식은 실제 첫 Version으로 저장하고 주기 결과가 아님을 표시한다. 원본 파일 연결·archived 문서는 거절한다. 제약의 정본은 → lophn-agent/assignments다.
- **정의 적용.** 초안 문서·approval request 제출로 Role·Assignment가 생기거나 바뀌지 않는다. 사람이 전체 내용·이전 판을 승인한 뒤 machine만 적용한다.
- **사람의 뜻.** term 정의는 사람 답의 참조만 전달한다. 미정 후보·충돌은 보고에서 분리하고 관련 변경을 보류한다. 답을 tool approval나 scope 확장으로 쓰지 않는다.
- **금지.** 앱 기획·설계·수리·ticket 작성·앱 command 호출·Operator 업무 대행·실제 Assignment 적용·원본 문서 이동·rename·삭제·derived index 직접 변경·prompt 조립·cache·compaction은 제공 tool 0개다.
- **보고 저장.** 고정 시스템 place·보고 예약·OutputDeclaration은 없다. 요청 범위의 실제 문서 Version에 저장한다. → documents/versions.

## 정할 것

- watch 횟수·기준 자료 뒤처짐·수동 업무 근거의 machine 조회 계약은 → documents/contexts와 맞춘다. 자동 일일 term 탐색·변화 event Run은 만들지 않는다.
- tool 식별자 철자는 → lophn-agent/harness/tools와 맞춘다.
