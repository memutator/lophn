---
type: domain-model
concerns: [lophn-agent/extensions]
---
# lophn-agent/extensions

로컬 skill과 외부 MCP 서버 설정·connection·tool 이름의 값을 정의한다.

## ExtensionSettings (값)

독립 entity·ID가 없는 설정 값이며 저장·변경 contract는 → platform/settings.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `revision` | 양의 정수 | 아니오 | 초기 1; 변경마다 1 증가 | 확장 선택 판 |
| `registered_folders` | 절대 폴더 경로 배열 | 아니오 | 기본 `[]`; 중복 없음; user 순서 유지 | skill 발견 범위 |
| `role_selections` | `rol` ID→RoleExtensionSelection map | 아니오 | 기본 `{}`; 존재하는 역할만; → lophn-agent/role-definition | 역할별 선택 |
| `mcp_servers` | McpServerConfig 배열 | 아니오 | 기본 `[]`; name unique | 등록 서버 |

## RoleExtensionSelection (값)

Role entity에 저장하지 않고 ExtensionSettings 안에 저장한다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `skills` | skill 이름 배열 | 아니오 | 기본 `[]`; 현재 유효한 정확한 이름만; 없는 이름·중복·전체 선택 거절; user 지정 | 선택 skill |
| `mcp_servers` | 서버 이름 배열 | 아니오 | 기본 `[]`; 중복 없음; 등록 서버만; user 지정; 이 값만으로 tool을 선택하지 않음 | 연결 후보 서버 |
| `mcp_tools` | `{server_name,original_tool}` 배열 | 아니오 | 기본 `[]`; 정확한 쌍 unique; 서버는 mcp_servers·등록 설정에 있고 tool은 현재 검증 목록에 존재; 전체·미래 선택 거절 | 선택한 개별 MCP tool |

## SkillEntry (값)

독립 entity·ID가 없는 발견 목록의 derived 값이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | 문자열 | 아니오 | 1~64자; `[a-z0-9]+(-[a-z0-9]+)*`; 선택 목록 unique | skill 이름 |
| `description` | 문자열 | 아니오 | 1~1024자; 공백만 금지 | 목록 설명 |
| `content_hash` | sha256 | 아니오 | UTF-8 Markdown·Agent Skills YAML name/description 검증 | run 시작 본문 판 |
| `source_kind` | `registered / personal / bundled` | 아니오 | 아래 발견 순서 | 출처 |
| `folder_order` | 0 이상 정수 | 예 | registered에 필수 | user 등록 순서 |
| `bundle_path` | 절대 경로 | 아니오 | agent prompt에는 제공 안 함 | 플랫폼 읽기 위치 |
| `supplemental` | `{title,relative_path,hash}` 배열 | 아니오 | 제목 unique; 꾸러미 안 UTF-8 문서만; 기본 `[]` | 선택 보조 자료 |
| `selected` | boolean | 아니오 | 유효 발견과 RunBasis에 고정한 role_selections[role].skills의 교집합 | run 제공 여부 |
| `discovered_at` | 시각 | 아니오 | 실제 발견 | 시각 |

## SkillReadResult (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | skill 이름 | 아니오 | 이번 run 고정 선택 목록에 있음 | 대상 |
| `body` | UTF-8 Markdown | 예 | 성공이면 전체 본문; 일부 성공 불가 | 본문 |
| `supplemental_titles` | 문자열 배열 | 아니오 | 제목만; 자동 본문 읽기 없음 | 보조 자료 목록 |
| `error` | `not_selected / missing / changed / invalid_path / invalid_format` | 예 | 실패면 body null; → lophn-agent/harness/tools의 안전한 결과로 포장 | 오류 |

## McpServerConfig (값)

platform 설정에 들어가는 값이며 독립 domain entity·접두사는 없다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | 비어 있지 않은 문자열 | 아니오 | 설정 안 unique; 불변 설정 key | 서버 이름 |
| `revision` | 양의 정수 | 아니오 | 변경마다 1 증가 | 설정 판 |
| `enabled` | boolean | 아니오 | 기본 false; user만 변경 | 연결 허용 |
| `transport` | `stdio / http` | 아니오 | 명시 tagged union | 전송 |
| `stdio` | McpStdio | 조건부 | stdio에만 필수; http면 금지 | 프로세스 설정 |
| `http` | McpHttp | 조건부 | http에만 필수; stdio면 금지 | HTTP 설정 |
| `call_timeout_ms` | 정수 ms | 아니오 | 기본 60000; 1000~600000 | call 상한 |
| `classifications` | 원래 tool 이름→McpToolClassification map | 아니오 | 기본 `{}`; user 지정; schema 판에 묶임 | 실제 효과 분류 |

## McpStdio (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `executable` | 절대 파일 경로 | 아니오 | 존재·실행 가능 확인; shell 문자열 금지 | 실행 파일 |
| `args` | 문자열 배열 | 아니오 | 기본 `[]`; shell 해석 없음 | 인자 |
| `cwd` | 절대 폴더 경로 | 예 | 존재 확인 | 작업 폴더 |
| `env` | 이름→일반값 또는 secret_ref map | 아니오 | 기본 `{}`; secret 값 직접 저장 금지 | 지정 환경 |

## McpHttp (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `url` | URL | 아니오 | HTTPS 또는 127.0.0.1·::1 loopback HTTP | 서버 목적지 |
| `headers` | 이름→일반 문자열 또는 secret_ref map | 아니오 | 기본 `{}`; secret 원문 금지; auth와 중복 금지 | 추가 헤더 |
| `auth` | McpAuth | 아니오 | 기본 none | 인증 |

## McpAuth (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `none / bearer / api_key / oauth2` | 아니오 | 가지 밖 필드 금지 | 종류 |
| `secret_ref` | 불투명 참조 | 조건부 | bearer·api_key에 필수; → platform/secrets | token·key |
| `header_name` | HTTP 헤더 이름 | 조건부 | api_key에 필수 | key 전달 위치 |
| `issuer / client_id` | HTTPS URL / 문자열 | 조건부 | oauth2에 필수; 발급자·대상 묶음 | OAuth client |
| `client_secret_ref` | 불투명 참조 | 예 | 필요한 confidential client만 | client secret |
| `scopes` | 문자열 배열 | 조건부 | oauth2; 기본 `[]` | 권한 |
| `token_ref` | 불투명 참조 | 예 | OAuth 로그인 성공 후만; 값 없음 | token 묶음 |

## McpToolClassification (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `effect` | `read / write / external` | 아니오 | user 명시; 다중 효과는 external > write > read | 실제 영향 |
| `schema_hash` | sha256 | 아니오 | 이름·설명·입력 schema·MCP 행동 hints 기준 | 분류가 묶인 정의 |
| `reversible` | boolean | 아니오 | false 기본; user 선언만으로 보장하지 않음; contract 검증 필요 | 되돌림 보장 |

## McpConnection (값)

메모리·derived 진단 상태이며 ledger 복구 정본이 아니다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `assignment` | `asg` ID | 아니오 | → lophn-agent/assignments; (assignment, server_name)마다 connection 하나; 다른 assignment와 공유 금지 | 연결 소유 |
| `server_name / revision` | 문자열 / 양의 정수 | 아니오 | 고정 설정 참조 | 대상 |
| `state` | `disconnected / connecting / connected / failed_temporary / failed_auth` | 아니오 | 초기 disconnected | 상태 |
| `last_connected_at` | 시각 | 예 | 성공 연결 시각 | 최근 성공 |
| `protocol_version` | 문자열 | 예 | 협상 완료에 필수 | MCP 판 |
| `tool_list_hash` | sha256 | 예 | 모든 page·schema 검증 완료 뒤만 | 제공 목록 |
| `retry_count` | 0~3 정수 | 아니오 | 초기 0; auth failure 자동 retry 없음 | 재연결 |
| `error` | 안전한 코드 | 예 | 비밀·server 자유 오류 원문 없음 | 실패 |

### 상태

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| disconnected/failed_temporary | connecting | machine | enabled·고정 역할에 허용; 재연결 한도 | 없음; derived |
| connecting | connected | machine | 협상 및 모든 tool page 검증 완료 | 없음; derived |
| connecting/connected | failed_temporary | machine | 연결 실패·끊김 | 없음; derived |
| connecting/connected | failed_auth | machine | 인증 거절 | 없음; derived |
| 모든 상태 | disconnected | user / machine | disabled·제거·역할 사용 해제; 새 call 차단·진행 call 취소 요청 | 설정 event는 → platform/settings |

## 정책

- **skill 발견.** user 등록 폴더 순 → 개인 skill 보관소 → 동봉 skill. 폴더 자체 및 바로 아래 꾸러미까지만, 앱 소스·상위 폴더·다른 harness 보관소 자동 탐색 없음. 같은 이름은 먼저 발견한 하나, 같은 범위는 꾸러미 이름 영문 사전순 우선이다. 제외·shadowed·누락·선택 출처는 안전한 진단으로 남긴다.
- **역할별 선택.** skill 및 MCP 서버 선택은 ExtensionSettings.role_selections에만 저장한다. Role에는 목록을 넣지 않는다. run 시작에 확장 설정 revision과 해당 역할 선택을 고정하며 현재 disabled·역할 사용 해제는 다음 call 전에 검사한다. 역할 삭제 뒤 해당 map 항목은 선택에 사용하지 않는다.
- **skill 제공.** 유효 발견과 고정 role_selections[role].skills의 교집합만; run 시작에 이름·설명·선택·본문 hash 고정. prompt에는 이름·설명만 사전순이다. 읽기 전 변경·삭제면 실패하며 다음 run부터 새 판을 쓴다.
- **skill 읽기.** 본문 전체 및 보조 자료 제목만 반환한다. 제목으로 고른 보조 문서만 읽으며 상위 이탈·절대 경로·symlink·스크립트·실행 파일은 거절한다. 원격 검색·download·설치·자동 작성·script 실행은 없다.
- **권한.** skill 등록·읽기는 tool·권한·MCP 연결·인증을 추가하지 않는다. 본문은 data이며 역할·안전 경계를 바꾸지 않는다. → lophn-agent/harness/safety.
- **MCP 제공.** 고정 role_selections[role].mcp_servers와 enabled 등록 서버의 교집합만 연결 후보로 쓴다. 전체 검증 목록 중 고정 mcp_tools의 정확한 `(server_name,original_tool)` 쌍과 현재 역할 상한·scope를 모두 통과한 tool만 제공한다. 새 tool은 자동 선택하지 않는다. call마다 현재 개별 선택·enabled·설정 판·정의 hash를 재검사하며 설정만으로 Operator의 승인 tool 목록을 늘리지 않는다.
- **MCP 설정 소유.** 등록·삭제·enabled·목적지·역할·분류는 user만 결정한다. project·skill·역할 요청·server 응답에서 설정을 자동 수입하지 않는다. 누락·상충·잘못된 설정은 해당 서버만 제외한다. 설정 command·event·ledger 표는 → platform/settings; 새 extension ledger는 없다.
- **MCP 환경.** stdio는 필요한 `PATH`, `HOME`, `TEMP`, `LC_ALL` 및 해당 서버 env만 받는다. 앱 secret·다른 server secret·provider credential은 전달하지 않는다.
- **HTTP 인증.** secret은 인증을 붙이는 경계에서만 사용한다. TLS 검증 해제 없음; redirect에는 인증 헤더 제거. OAuth는 Authorization Code+S256 PKCE·브라우저·loopback 반환이며 발급자·대상에 묶고 credential별 동시 갱신은 하나다.
- **연결 상한.** 연결 30000ms, 모든 tool list page 합산 30000ms, call 기본 60000ms. 끊김 재연결은 1000·2000·4000ms 뒤 최대 3회; 소진 뒤 user 재연결·설정 변경까지 대기. auth 거절 자동 재연결 없음. 이미 전달한 call은 재전송하지 않는다.
- **수명.** assignment 사용 종료·서버 제거·disabled·역할 해제·데몬 종료는 해당 (assignment, server) 새 call 즉시 금지, 진행 call 취소 요청 뒤 연결 종료. stdio 정상 종료 5000ms 뒤 남으면 강제 종료. 실제 효과는 취소 성공으로 추정하지 않는다.
- **목록.** MCP 판 협상 및 전체 page 수신·중복 이름·반복 cursor·schema 검증이 모두 끝난 뒤만 제공한다. 변경 통지·재연결에서 전체 재조회. 새 tool은 미분류 write로 취급하되 되돌림 보장 미확인이면 allow로 추정하지 않는다. 이름·설명·input·MCP 행동 hints 변경은 옛 분류를 무효화하고 없어진 tool은 즉시 call 금지다.
- **외부 이름.** `ext_` + server 이름 + `_` + 원래 tool 이름을 지원 문자로 canonicalize하여 최대 64자로 만든다. 충돌·축약이면 원래 server·tool 쌍의 SHA-256 앞 8자 suffix를 붙인다. 그래도 충돌이면 등록 거절한다. 원래 이름·server·설정 판을 ToolCall에 보존한다. → lophn-agent/harness/tools.
- **판정.** 목록 노출은 실행 허용이 아니다. 현재 역할·scope·효과·input·되돌림 보장으로 call마다 → lophn-agent/harness/tool-judgment. 결과는 data로 포장하며 secret·코드·웹 검색·subagent 금지를 우회하지 않는다.

## 정할 것

- 외부 tool의 되돌림·결과 조회·idempotency 보장을 검증하는 contract 및 현재 네 역할에 허용할 서버·tool 목록. 설정만으로 기존 역할 범위를 넓히지 않는다.
- agent runtime 격리에서 MCP stdio 실행 파일 및 skill 꾸러미 읽기를 허용하는 플랫폼 경계. 무제한 shell·파일 tool로 제공하지 않는다.
