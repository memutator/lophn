---
type: domain-model
concerns: [lophn-agent/roles/app-engineer]
---
# lophn-agent/roles/app-engineer

App Engineer Role의 담당 앱 읽기 상한, tool 선택, slot과 설계·해석 결과 값을 정의한다.

## AppEngineerRoleValues (값)

Role의 모양은 → lophn-agent/role-definition, 공통 금지는 → lophn-agent/roles/common이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | enum | 아니오 | `app_engineer` | 책임 종류 |
| `name` | string | 아니오 | `App Engineer` | 내장 이름 |
| `scope_kind` | enum | 아니오 | `app` | Assignment의 앱 하나 |
| `schedule` | null | 예 | 주기 없음; Role 필드로 저장하지 않음 | 사람 요청·그 요청의 handoff만 |
| `perspective` | string[] | 아니오 | 사람이 겪는 동작, domain 불변 조건, 실제 회복 근거 | prompt 관점 |
| `expected_results` | string[] | 아니오 | 현재 요구·범위·acceptance check을 담은 설계, 근거·불확실함이 있는 해석, release 검토 메모 | 결과 내용 |

### 읽기 범위 값

| 대상 | 허용 값 | 참조 |
|---|---|---|
| 담당 앱 place 문서 | 목차·검색·Version·본문·절·이력·차이 | documents/versions, documents/outline-and-search |
| 담당 앱 | blueprint·release·정상 신호·invocation·problem·ticket 및 그 앱에 연결된 보고·snapshot·test result·고친 기록 | apps/blueprint, apps/releases, apps/invocations, problems/grouping, problems/reporting, problems/snapshots, problems/tests, problems/repairs, coding-agent/tickets |
| 관련 context | 담당 앱의 `effect = read` 명령을 item으로 가진 context의 목적·용어·item metadata | documents/contexts, documents/terms |
| 이번 handoff 근거 | Run.source의 고정 Version와 지정 절만, 이 Run 동안만 | lophn-agent/harness/run-loop, lophn-agent/handoff |
| 제품 SDK | 제공한 계약·예시 | apps/sdk |
| 관련 Role·Assignment·Run | 자기 담당 범위·handoff의 현황과 결과 | lophn-agent/role-definition, lophn-agent/assignments, lophn-agent/harness/run-loop |

관련 context의 다른 문서 본문, 다른 앱, handoff 근거의 최신 Version는 허용하지 않는다. 주소를 따라 범위를 넓히지 않는다. 담당 앱의 허락된 read와 undo 지원 write만 실행하며 external·undo 미지원 write는 제공하지 않는다.

### tool 선택 값

공통 문서·context·term·format 읽기와 question 동작은 → lophn-agent/roles/common의 목록에서 위 담당 범위만 선택한다. 전체 목록·검색에도 이 범위를 적용한다.

| 묶음 | 추가 개별 동작 | 제약 |
|---|---|---|
| 담당 앱·SDK 읽기 | `project.read`, `app.read`, `app.blueprint`, `app.commands`, `app.releases`, `app.health`, `app.invocations`, `sdk.contract`, `sdk.examples` | scope 안 조회만 |
| problem·ticket 읽기 | `problem.list`, `problem.read`, `report.read`, `snapshot.read`, `verification.read`, `repair.read`, `ticket.list`, `ticket.read` | 담당 앱만 |
| 문서 결과 | `document.create`, `document.save_version` | 담당 앱 place·Run 요청 범위; 기준 Version 필수 |
| 해석 연결 | `problem.set_interpretation` | 담당 problem에 문서 고정 Version·절 참조; 현재 problem seq·기존 참조 CAS; 이전 참조 보존; → problems/grouping |
| ticket | `ticket.create` | 담당 앱 구현·repair 생성만; → coding-agent/tickets |
| 역할·assignment 읽기 | `role.read`, `assignment.read`, `run.read_result` | 관련 범위만 |
| handoff | `handoff.submit`, `handoff.read_status`, `handoff.read_result` | → lophn-agent/handoff의 허용 방향만 |

### 앱 command·시각 선택 값

- 담당 앱 하나의 현재 agent 사용 허락과 Role scope 교집합에서 자동 앱 command를 선택한다. `effect=read`와 `effect=write`이며 undo contract를 확인한 정의만 제공하고 confirm이면 approval를 거친다. 앱 archive·허락 회수·release 계약 변경은 실제 진입을 막는다. → apps/permissions, apps/blueprint, lophn-agent/harness/tool-judgment.
- `visual.show / visual.read / visual.prepare_document`를 담당 세션·자료 범위에서 선택한다. 문서 저장은 기존 담당 앱 place와 요청 범위다. 앱 코드·blueprint·DB 직접 접근은 추가하지 않는다.

### slot 값

| 호출 용도 | slot |
|---|---|
| 인터뷰 해석·용어 후보·앱 설계 | `judgment` |
| problem 가설·해석 | `judgment` |
| ticket 범위·요구·acceptance check | `judgment` |
| release 의미 검토·handoff 판단 | `judgment` |
| 이미 정한 설계·해석·ticket 제목 | `organizing` |
| 이미 정한 결과 요약 | `organizing` |

### 결과 값

문서 내용의 계약이며 고정 OutputDeclaration은 없다. 저장 format은 → documents/formats다.

| 결과 종류 | 필수 내용 | 제약 |
|---|---|---|
| 설계 문서 종류 | domain story, 용어집 후보, domain model·조작, 요구사항, 사용 흐름, 전체 명세, 관측 설계 설명, problem 해석 | Markdown 결과 종류; 요청에서 필요한 문서만 저장 |
| 전체 명세 | 현재 앱 목적·범위 밖·사람이 겪는 동작·불변 조건·acceptance check | 사용 흐름 하나 최대 8단계; 빈 결과·실패는 별도; 시각 배치·색·component·library·저장 구현 선택 없음 |
| 인터뷰 결과 | 사람 답의 설계상 해석, 미정 결정, 가정 | 인터뷰 하나 추가 결정 질문 최대 12개; 선택형 option 2~3개와 근거 있는 추천 1개; 명세 하나 가정 최대 3개 |
| problem 해석 | 지지·반박 근거, 부족한 자료, 다음 확인, 원인 가설 | 가설 최대 3개; 현재 problem·snapshot·설계·release·실제 test result의 고정 근거 |
| 구현 ticket 후보 | 하나의 사용 흐름, 요구, 실행 가능한 acceptance check, 채택 고정 Version·Question ID | 최대 6개 요구; 큰 후보는 흐름 경계로 분리; 실제 ticket 필드는 → coding-agent/tickets |
| repair ticket 후보 | 같은 원인 가설 하나로 모이는 problem, 알려진 회복 조건, 근거 | 원인이 갈리거나 근거 부족·사람 설정 변경만이면 생성 불가; problem당 열린 repair 하나·reproduction test 계약은 → coding-agent/tickets |
| release 검토 | 실제 release·정상 신호·invocation과 설계의 차이, 의미상 어긋남, 후속 ticket 후보 | test·activation·problem 닫힘을 대신하지 않음 |
| 관측 설계 | 사람에게 문제인 동작, 회복 조건, 수리 중 보존할 동작 | 발생 횟수 집계·회복 확인·닫힘은 machine 계약 |

## 정책

- **ticket 생성 allow.** 담당 앱 ticket 생성은 되돌릴 수 있는 안쪽 쓰기다. 매번 approval를 묻지 않는다. 생성·읽기만 제공하며 공개 단계·본문 수정·취소·claim·연장·release 연결 tool은 없다. coding agent가 claim하기 전 취소·revert 보장은 → coding-agent/tickets, lophn-agent/revert다.
- **채택 근거.** ticket·handoff에 채택한 고정 Version와 그 판의 Question ID를 함께 쓴다. 새로운 Version에 옛 채택을 적용하지 않는다. → lophn-agent/questions, coding-agent/tickets, lophn-agent/handoff.
- **미정 요구.** 범위·사용 동작·acceptance check을 정할 답이 없으면 관련 ticket 생성을 보류한다. 남긴 문서의 가정·미정은 확인된 요구로 바꾸지 않는다.
- **설계 근거.** 뒤 결과가 참조하는 앞 결과는 실제로 읽은 고정 Version다. blueprint는 읽기 계약이며 직접 수정·같은 blueprint 사본 생성 tool이 없다. 변경 요구는 설계 문서·ticket에 남긴다.
- **금지.** 앱 등록·채택 결정·전체 재사용 계획·context/term 적용·코드·test/build/preview·앱 command 계약 밖 운영·SDK 자체 수정·Operator 반복 업무·problem 상태 변경·닫힘·test result 생성은 제공 tool 0개다.
- **handoff.** 앱 밖 기획·context 후보의 실제 방향·packet은 → lophn-agent/handoff다. 승인·범위는 복사하지 않는다.

## 정할 것

- **H3.** AE 주기 검토를 추가할지. 현재 주기 없음이다.
- **H7.** ticket 생성 allow 유지 여부. 현재 담당 앱 생성은 allow다.
- tool 식별자 철자는 → lophn-agent/harness/tools와 맞춘다.
