---
type: domain-model
concerns: [lophn-agent/roles/common]
---
# lophn-agent/roles/common

네 역할의 공통 금지, 공통 tool과 문서 저장·model slot 사용의 고정 값을 정의한다.

## CommonRoleValues (값)

Role의 모양은 → lophn-agent/role-definition이며 이 표는 모든 Role 판의 상한이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `subagent_count` | integer | 아니오 | 고정 `0` | 자식 agent 없음 |
| `external_mcp_selection` | string[] | 아니오 | 현재 고정 `[]` | 외부 MCP tool 선택 없음 |
| `skill_selection` | string[] | 아니오 | 현재 고정 `[]` | skill 선택 없음 |
| `model_overrides` | JSON object | 아니오 | 고정 `{}`; model 선택은 → lophn-agent/harness/model | 역할별 model 선택 없음 |
| `scope_expansion_from_addresses` | boolean | 아니오 | 고정 `false` | 자료 안 주소가 읽기 범위를 늘리지 않음 |
| `organizing_creates_judgment` | boolean | 아니오 | 고정 `false` | organizing은 새 요구·가설·판정·acceptance check 생성 금지 |

### 공통 금지 값

| 능력 | 값 |
|---|---|
| 코드 작성·수정, 코드 실행, 임의 shell, 임의 파일 접근 | 제공 tool 0개 |
| 웹 검색·웹 읽기·임의 URL·브라우저 조작 | 제공 tool 0개 |
| coding agent 띄우기, subagent 생성 | 제공 tool 0개 |
| 소스·앱 업무 DB·secret 값 직접 읽기 | 제공 tool 0개 |
| 앱 command 계약 밖 운영·activation·외부 전송·secret 사용 | 제공 tool 0개; 허락된 앱 command는 아래 역할별 상한 |
| 자기 Role·Assignment 적용, 사람 대신 승인·거절 | 제공 tool 0개 |
| 설정·권한 예외·model 자동 심사로 범위 우회 | 허용 경로 0개 |

### 공통 tool 선택 상한

아래는 개별 계약 동작의 이름이다. 입력·결과·효과 계약은 → lophn-agent/harness/tools와 각 대상 concern이다. 각 역할은 이 상한에서 자기 범위·실제 목록만 선택한다.

| 묶음 | 개별 동작 | 대상 계약 |
|---|---|---|
| 문서 읽기 | `document.list`, `document.outline`, `document.search`, `document.read_version`, `document.read_section`, `document.read_range`, `document.history`, `document.diff` | documents/versions, documents/outline-and-search |
| context·term 읽기 | `context.list`, `context.read`, `context.items`, `context.terms`, `context.document_membership`, `term.read` | documents/contexts, documents/terms |
| format 읽기·검사 | `format.list`, `format.rules`, `format.examples`, `format.validate` | documents/formats |
| 사람에게 묻기 | `question.submit`, `question.read_decision`, `approval.read_decision` | lophn-agent/questions, platform/approvals |

독립 command·event·ledger 표는 없다. 공통 목록도 실제 호출 때 → lophn-agent/harness/tool-judgment를 적용한다.

## 앱 command·시각 tool 선택 값

| 역할 | 자동 앱 command 상한 | 현재 scope·허락 | 시각 tool |
|---|---|---|---|
| `lophn` | read/write/external, confirm 포함 | 사람이 agent 사용을 허락한 앱; → apps/permissions | `visual.show`, `visual.read`, `visual.prepare_document` |
| `app_engineer` | read와 실제 undo 지원 write; confirm은 approval | 담당 앱 하나와 사람의 agent 사용 허락 | 위 세 tool; 담당 문서 범위 |
| `context_engineer` | 실행 0개; metadata 목록·설명만 | 현재 자료 scope | 위 세 tool; 요청 문서 범위 |
| `operator` | 승인된 read command만; confirm이면 approval | Assignment.read_apps/read_commands 및 고정 Role 선택 교집합 | 세션 있는 사람 요청에서 승인 목록에 선택한 시각 tool만; 문서는 승인 output만 |

`visual.show`는 세션 출력이지 Operator의 업무 문서 write 대상 확대가 아니다. 앱 카드가 보인다는 이유로 command를 선택하지 않는다. 현재 앱 허락이 없어지면 어떤 역할도 호출하지 않는다. 주석은 lophn 역할의 선언된 앱 write command이며 → lophn-agent/harness/tool-judgment를 적용한다.

## 정책

- **문서 저장.** lophn·AE·CE는 Run 요청 범위에서 문서 생성·새 Version 저장을 한다. Operator는 → lophn-agent/assignments의 남길 문서 새 Version만 저장한다. 새 Version은 읽은 기준 Version을 요구한다.
- **내용·format.** 큰 prompt·결과 내용은 sha256 blob이다. format·저장 계약은 문서 최신 Version과 → documents/formats가 정한다. Role에 format·시리즈·place 예약을 복사하지 않는다.
- **결과 증거.** 읽은 결과에는 실제 ID·고정 Version·구간·생략·이어 읽을 길을 유지한다. 저장 결과는 접수·Version 확정·파일 반영을 구별한다. 없는 자료·test result·미확인 수치는 확인됨으로 채우지 않는다.
- **결과 기록.** 문서 저장의 actor는 인증된 `agent:<assignment ID>`이고 원인 Run을 가리킨다. 실제 변경 event는 대상 concern이 소유한다. → platform/identity, platform/ledger.
- **slot.** 새 판단·본문은 `judgment`, 이미 정한 내용의 제목·요약은 `organizing`이다. 대화 압축도 organizing이며 → lophn-agent/harness/prompt-assemble가 소유한다. 단순 합계·다음 시점·schema 검사는 model 호출 0회다.
- **읽기 기록.** 현재 Assignment·범위를 확인한 읽기는 먼저 호출하고 뒤따라 기록한다. 쓰기·approval 필요·외부 효과만 선행 기록한다. → lophn-agent/harness/tools.
- **실행 계기.** 사람 요청·승인한 Operator 회차·허용한 사람 요청의 handoff만 가능하다. 문서·problem·notification·handoff 결과 event 자체로 새 Run을 만들지 않는다.

## 정할 것

- 현재 외부 MCP·skill 선택은 0개다. 구체적 반복 업무가 필요하면 → lophn-agent/extensions의 범위·secret·되돌림·승인 계약과 함께 지원 여부를 정한다. 웹·subagent 금지는 유지한다.
