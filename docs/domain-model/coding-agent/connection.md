---
type: domain-model
concerns: [coding-agent/connection]
---
# coding-agent/connection

CodingAgentConnection의 범위, credential 참조와 회수 상태를 정의한다.

## CodingAgentConnection (`cac`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `cac` ID | 아니오 | PK, 불변 | |
| `label` | string | 아니오 | 공백뿐인 문자열 금지 | 사람이 구별하는 이름; 유일할 필요 없음 |
| `scope` | ConnectionScope | 아니오 | 생성 뒤 불변 | |
| `principal` | string | 아니오 | `coding_agent:<id>`; → platform/identity의 Credential.principal과 일치; 불변 | token 원문이 아닌 안정된 principal 참조 |
| `token_hash` | 인증 검증 해시 | 아니오 | 원문 token 검증용; 알고리즘은 → platform/identity; 일반 읽기·event에 반환하지 않음 | 영구 token의 검증 값 |
| `state` | `active \| revoked` | 아니오 | 생성은 `active`; 회수 뒤 재활성화 금지 | |
| `revision` | event seq | 아니오 | 마지막 connection 변경 event seq | CAS 기준 |

### 상태

| 상태 | 뜻 |
|---|---|
| `active` | 매 요청에서 credential·scope 검사를 받을 수 있음 |
| `revoked` | 새 요청 거절 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `active` | `user` | 보호 화면의 정확한 label·scope 확인; credential 발급 성공 | `CodingAgentConnectionCreated` |
| `active` | `revoked` | `user` | 보호 화면 확인; `revision` 일치 | `CodingAgentConnectionRevoked` |

### 불변 조건

- `harness`, 외부 세션 ID, 살아 있음, token 파일 경로를 entity 필드로 두지 않는다.
- token 원문은 ledger·event·티켓·안내·앱 source·진단 log에 저장하지 않는다. 발급·검증·보관 계약은 → platform/identity, platform/secrets이다.
- actor는 credential에서 확인한 `coding_agent:<connection id>`다. 요청 본문의 actor, 제품 이름, 작업 폴더로 추정하지 않는다.
- credential 상한과 connection scope가 모두 요청을 허용해야 한다. 근거 주소나 ticket claim은 scope를 넓히지 않는다.
- 회수 뒤 이미 접수된 완료 보고·문서·release·test result는 남는다. 보고의 machine check도 계속할 수 있다.

## ConnectionScope (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `all \| app` | 아니오 | enum | |
| `app` | 앱 ID | 예 | `kind = app`일 때 필수; `all`이면 null; → apps/registration | 앱 하나 |

## ConnectionInstallationCheck (값)

ledger 정본이 아닌 로컬 설치 검사 결과다. 외부 coding agent의 runtime 상태가 아니다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `connection` | `cac` ID | 아니오 | 이 파일의 connection 참조 | |
| `at` | UTC 시각 | 아니오 | 공통 시각 형식 | |
| `checks` | `{stage, result, reason}[]` | 아니오 | 아래 stage 4개를 각각 한 번 포함 | |
| `checks[].stage` | `mcp_initialize \| tool_discovery \| skill_discovery \| app_guide_loading` | 아니오 | enum | MCP 미지원은 CLI 실패와 다름 |
| `checks[].result` | `success \| failure \| unknown` | 아니오 | enum | 실제 loading을 확인하지 못하면 `unknown` |
| `checks[].reason` | string | 아니오 | 실패·확인 못함이면 공백 금지; secret 제외 | trust·override·발견 실패의 안전한 이유 |

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| CodingAgentConnection | scope 대상 | App → apps/registration | N:0..1 | 참조 보존; 대상 상태에 따른 요청 허용은 대상 concern에서 검사 |
| CodingAgentConnection | token principal 참조 | Credential 값 → platform/identity | 1:1 | 회수 시 새 요청 거절; 과거 actor 참조 보존; 별도 credential entity 없음 |
| CodingAgentConnection | 현재 claim | Ticket → coding-agent/tickets | 1:N | connection 회수 시 machine이 claim 해제; 티켓 삭제 없음 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `coding_agent_connections` | `id, label, scope_kind, scope_app, principal, token_hash, state, revision` | PK `id` | `principal`, `token_hash` | `(state, id)`, `(scope_app, state, id)` | `scope_app` → apps/registration; principal 규칙 → platform/identity; `revision` → platform/ledger event seq |

`scope_kind = all`이면 `scope_app IS NULL`, `app`이면 `scope_app IS NOT NULL`이다. `principal = 'coding_agent:' || id`를 강제한다. connection 생성·검증 hash 설치, connection·credential 회수는 각각 같은 command transaction으로 적용한다. Credential 값은 → platform/identity이며 별도 ledger credential 표·ID는 없다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `coding_agent_connection.create` | `user` | `id, label, scope`, 보호 화면 근거, idempotency key | ID 미존재; 앱 존재; 확인 대상·입력 일치 | `CodingAgentConnectionCreated` | `invalid_input`, `forbidden`, `conflict` |
| `coding_agent_connection.revoke` | `user` | `connection`, 보호 화면 근거, idempotency key | `base_revision`, 현재 `active`, 확인 대상 일치 | `CodingAgentConnectionRevoked` | `not_found`, `forbidden`, `conflict` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `CodingAgentConnectionCreated` | `cac` | `label, scope, principal`; token 값 없음 | coding-agent/guides |
| `CodingAgentConnectionRevoked` | `cac` | `before_revision` | coding-agent/tickets, apps/runtime |

## 정책

- **허용 범위.** `all`은 모든 저장 대상에 허용된 작업을 요청하는 범위이지 user 권한이 아니다. 앱 등록은 `all`만 가능하며 등록 입력·source 연결은 → apps/registration이다.
- **앱 scope.** 그 앱의 문서·앱 정보·문제·티켓과 공통 format·SDK·템플릿만 허용한다. 목록·검색·요약·절·첨부·추가 근거에도 적용한다. 범위 밖 근거는 `현재 연결로 읽을 수 없음`으로 표시하며 제목·본문을 복사하지 않는다.
- **금지 작업.** approval 결정, grant 변경, secret 값 접근, 운영 backup 읽기, 문제 닫힘·무시·사람 확인, connection 발급·회수·scope 확대, project 등록·tracking 변경·context·term 정의·assignment 변경, ticket 목표 변경·확인 판정, test result 작성은 coding agent에게 금지한다(→ 해당 concern, platform/identity).
- **원본 접근.** 사람 원본 파일의 임의 경로·폴더 순회와 앱 DB 직접 접근은 제공하지 않는다. 외부 coding agent의 OS 파일 접근이나 프로세스 종료를 connection으로 통제하지 않는다.
- **회수 적용.** 회수 직후 새 읽기·쓰기를 거절한다. 직접 앱 credential도 원래 connection 회수를 따른다(→ apps/runtime). 남은 claim 해제는 → coding-agent/tickets이며 정리를 기다리는 동안에도 회수된 credential을 허용하지 않는다.
- **교체.** token 분실·scope 변경은 기존 connection 회수 뒤 새 connection 생성으로만 처리한다. MCP·CLI는 같은 credential을 쓰고 user credential로 자동 fallback하지 않는다.
- **설치 보존.** 기존 server·env·permission·동명 skill·hook·안내·trust는 자동 덮어쓰기나 확대 대상이 아니다. 하네스별 경로·설정 형식은 spec이다.

## 정할 것

- 로컬 token 원문 보관 수단과 소유권·symlink·backup 제외 검사는 → platform/identity, platform/secrets에서 확정한다.
- 실제 loading을 검증할 제품·최소 버전과 외부 세션에 claim 상실을 알리는 비강제 방법. 현재는 claim 재조회이며 강제 프로세스 중단은 없다.
