---
type: domain-model
concerns: [lophn-agent/roles/lophn]
---
# lophn-agent/roles/lophn

lophn Role의 읽기 상한, tool 선택, slot과 결과 내용의 고정 값을 정의한다.

## LophnRoleValues (값)

Role 필드는 → lophn-agent/role-definition, 모든 역할의 금지는 → lophn-agent/roles/common이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | enum | 아니오 | `lophn` | 책임 종류 |
| `name` | string | 아니오 | `lophn` | 내장 이름 |
| `scope_kind` | enum | 아니오 | `all` | 저장된 자료의 전체 범위 |
| `schedule` | null | 예 | 주기 없음; Role 필드로 저장하지 않음 | 사람 요청·허용 handoff만 |
| `perspective` | string[] | 아니오 | 기존 목적·자료 우선, 사람 없이 돌아야 하거나 코드로 관리해야 하는 대상은 앱 후보, 입력·출력·접근 조건 비교 | prompt의 고정 관점 |
| `expected_results` | string[] | 아니오 | 기획 문서, 필요한 사용 안내, 사실·해석이 나뉜 운영 보고; 단순 안내는 Message 허용 | 결과 상한 |

### 읽기 범위 값

| 대상 | 허용 값 | 참조 |
|---|---|---|
| 프로젝트·문서·context·term | 목적·목차·검색·필요한 고정 Version의 본문·절·이력·차이·소속 | documents/projects, documents/versions, documents/contexts, documents/terms |
| 앱·SDK | 목적·목록·blueprint·명령 metadata·release·정상 신호·invocation·SDK 계약·예시 | apps/registration, apps/blueprint, apps/releases, apps/invocations, apps/sdk |
| problem·ticket | 열린 problem·보고·snapshot·실제 test result·고친 기록·ticket 본문·현황·근거 | problems/grouping, problems/reporting, problems/snapshots, problems/tests, problems/repairs, coding-agent/tickets |
| 역할·assignment·run | 정의·판·담당 범위·남길 문서·주기·상태·확정 결과 | lophn-agent/role-definition, lophn-agent/assignments, lophn-agent/harness/run-loop |

전체 범위는 원본 디스크·소스·secret 읽기가 아니다.

### tool 선택 값

공통 읽기·format·question 동작은 → lophn-agent/roles/common의 개별 목록 전체를 선택한다.

| 묶음 | 추가 개별 동작 | 제약 |
|---|---|---|
| 프로젝트·앱·SDK 읽기 | `project.list`, `project.read`, `app.list`, `app.read`, `app.blueprint`, `app.commands`, `app.releases`, `app.health`, `app.invocations`, `sdk.list`, `sdk.contract`, `sdk.examples` | 조회와 현재 허락된 앱 자동 command; 실행 판정은 harness/tool-judgment |
| problem·ticket 읽기 | `problem.list`, `problem.read`, `report.read`, `snapshot.read`, `verification.read`, `repair.read`, `ticket.list`, `ticket.read` | 문제 해석 참조·상태·ticket 변경 없음 |
| 문서 결과 | `document.create`, `document.save_version` | Run 요청 범위; 기존 문서 저장은 기준 Version 필수 |
| 역할·assignment 읽기 | `role.list`, `role.read`, `assignment.list`, `assignment.read`, `run.read_result` | 변경 없음 |
| handoff | `handoff.submit`, `handoff.read_status`, `handoff.read_result` | 방향·계보는 → lophn-agent/handoff |

### 기능·설정 안내와 앱 지원 값

- tool 추가 선택: `lophn.guide`, `setting.read`, `visual.show`, `visual.read`, `visual.prepare_document`, 허락된 앱의 자동 command 정의. 직접 `settings` write tool은 없다.
- 앱 context 상세와 주석은 → apps/agent-context의 declared command binding으로 호출한다. active view·허락한 자리·화면 CAS를 고정하며 generic DOM 입력을 하지 않는다.
- SettingExplanation은 `{key,owner,description,value_type,current_value,source,revision,allowed_values,apply_at}`의 공개 값이다. 정의·값·판은 → platform/settings, 제품 안내 판은 설치 bundle의 current guide다. credential·secret 원문은 없다.
- 설정 질문은 현재 값·후보 새 값·영향·적용 시점·추천을 담고 허용되는 되돌릴 수 있는 내부 변경에만 → lophn-agent/questions의 OptionAction을 붙인다. action은 해당 설정 owner command·정확한 입력·현재 판 CAS에 고정하고 machine만 적용한다. `platform/settings` 설정은 해당 concern의 command, model/provider 같은 소유 설정은 해당 concern의 command를 참조한다. 권한 확대·secret·복원 불가 변경은 owner 보호 화면으로 안내한다.
- 실제 선택·미적용·CAS conflict·적용 결과를 구별하며 자유 답에는 dispatch하지 않는다. 변경 event actor=user/run=null이고 안내 run의 revert 대상으로 포함하지 않는다.

### slot 값

| 호출 용도 | slot |
|---|---|
| 기획·재사용 비교 | `judgment` |
| place 추천 | `judgment` |
| 운영 해석·사용 안내·사람 답 | `judgment` |
| 이미 정한 기획·보고·답의 제목 | `organizing` |
| 이미 정한 내용의 요약 | `organizing` |

### 결과 값

문서·Message의 내용 계약이며 별도 entity나 고정 산출물 선언이 아니다.

| 결과 종류 | 필수 내용 | 제약 |
|---|---|---|
| 프로젝트 기획 | 목적 한 문장, 기존 프로젝트·context 확장 후보 비교, 자료·place 후보, 연결 context와 목적, 다른 프로젝트·앱에 내줄 것 | 내줄 것이 없으면 `없음`; 미정은 미정 표시 |
| 앱 기획 | 첫 줄 위험, 무엇, 왜, 대안 비교, 재사용할 것, 새로 만들 것, 위험 | `무엇` 200자 이하; `왜` 500자 이하; 주장마다 근거 주소 또는 `근거 없음`; acceptance check 없음 |
| SDK 후보 | 계약에서 확인한 Version·입력·출력·접근 조건 | 미확인 조건은 `확인 필요` |
| place 추천 | 대상 document, 목적에 맞는 project·app place 후보, 선택 설명 한 줄 | Run당 최대 5개; 자리 없는 문서·어느 context에도 없는 문서 대상 |
| 운영 보고 | 실제 앱 상태·열린 problem·진행 ticket의 확인된 사실, 해석, 근거 주소 | 해석 최대 5줄; 미확인 수치는 `확인하지 못함` |
| 사용 안내 | 기존 안내의 해당 근거·답 | 재사용 답이 없거나 바뀐 경우만 요청 범위 문서 새 Version; 단순 답은 Message |

## 정책

- **비교 순위.** 프로젝트 후보는 기존 프로젝트 목적 안 → 기존 context 항목 범위 확대 → 새 프로젝트다. 앱 후보는 기존 앱 변경 → 문서 → 기존 SDK → 새 앱이다. 기존 앱·SDK 목록을 읽지 않고 재료 없음을 확정하지 않는다.
- **SDK 순위.** 해당 앱의 기존 재료 → 개인 SDK → lophn SDK → 새 코드 후보 순이다.
- **추천과 적용.** 문서 이동·앱 등록·채택은 tool 0개다. 고정 대상·입력·CAS를 담은 Question option action은 → lophn-agent/questions이며 사람 선택의 machine 적용은 각 대상 concern이다.
- **금지.** 앱 설계·상세 acceptance check 인터뷰·problem 원인 해석·해석 참조 변경·ticket 생성·claim·context 편집·Operator 반복 업무 대행은 제공 tool 0개다.
- **handoff.** 실제 방향·내용·원래 요청 연결은 → lophn-agent/handoff다. 받는 Assignment를 임의 생성하거나 승인·권한을 복사하지 않는다.
- **미정 결과.** 의도·취향 답이 없는 기획은 미결정 상태의 내용으로 유지한다. Question 만료·미루기·취소의 Run stopped는 → lophn-agent/harness/waiting-and-recovery다.

## 정할 것

- 문서 추천 후보 지표(최근 30일 서로 다른 날 열람 4회·역참조 2개·기준 context 2개 중 2조건)는 사람 요청의 근거로만 보존할지 정한다. 별도 일일·월요일 주기 Run은 없다.
- tool 식별자 철자는 → lophn-agent/harness/tools의 등록 목록과 맞춘다.
