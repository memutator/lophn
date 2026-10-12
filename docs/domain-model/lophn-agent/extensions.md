---
type: domain-model
concerns: [lophn-agent/extensions]
---
# lophn-agent/extensions

로컬 skill과 외부 MCP 서버 설정·connection·tool 이름의 값, 그리고 두 등록 층(전역, 자리)과 agent 정의가 고르는 규칙을 정의한다.

## 등록 층

skill과 MCP 서버는 두 층에 등록한다. 어느 것을 쓸지 고르는 일은 층이 아니라 agent 정의가 한다(아래 "agent 정의가 고르는 것").

| 층 | 어디 | 들어가는 것 |
|---|---|---|
| 전역 | Workspace | skill 등록 폴더·개인 보관소·동봉 skill, MCP 서버 목록(ExtensionSettings) |
| 자리 | project나 app의 data 폴더 | 그 자리의 skill 폴더, 그 자리의 MCP 서버 목록(PlaceExtensionSettings) |

자리 층은 그 자리(project나 app)에서 여는 agent에만 보인다. 다른 자리의 agent에는 보이지 않는다.

## ExtensionSettings (값)

전역(Workspace) 층의 설정 값이며 독립 entity·ID가 없다. 저장·변경 contract는 → platform/settings.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `revision` | 양의 정수 | 아니오 | 초기 1; 변경마다 1 증가 | 확장 선택 판 |
| `registered_folders` | 절대 폴더 경로 배열 | 아니오 | 기본 `[]`; 중복 없음; user 순서 유지 | skill 발견 범위 |
| `mcp_servers` | McpServerConfig 배열 | 아니오 | 기본 `[]`; name unique | 등록 서버 |
| `skills_off` | skill 이름 배열 | 아니오 | 기본 `[]`; 정확한 이름; 중복·와일드카드 금지; 지금 없는 이름도 남김 | 전역 층에서 끈 skill. 자리 층의 같은 이름 skill은 끄지 않는다 |

ExtensionSettings는 공급·발견·서버 설정이며 agent별 선택 map이 없다. 어느 skill·서버/tool을 쓸지는 agent 정의가 고른다. `skills_off`는 Settings › Agents의 전역 skill 스위치이며 바꾼 값은 다음 run부터 발견 결과에서 그 이름을 뺀다.

읽기: `ReadGlobalSkills`(user)는 전역 층에서 발견한 skill(이름·설명·출처 registered/personal/bundled·enabled)과 `skills_off`, 가려진 skill, 제외한 꾸러미를 돌려준다. 자리 skill은 `ReadPlaceExtensionSettings`가 준다.

## PlaceExtensionSettings (값)

자리(project나 app) 층의 설정 값이며 독립 entity·ID가 없다. 그 자리 data 폴더의 skill 폴더는 값이 아니라 위치로 정해진다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `place` | project 또는 app 참조 | 아니오 | 불변 | 이 층이 보이는 자리 |
| `revision` | 양의 정수 | 아니오 | 초기 1; 변경마다 1 증가 | 설정 판 |
| `mcp_servers` | McpServerConfig 배열 | 아니오 | 기본 `[]`; name이 자기 안에서도, 전역 `mcp_servers`와도 겹치지 않음 | 이 자리 서버 |

저장 위치는 agent 정의와 같은 자리 폴더 `<data root>/{projects,apps}/<id>/` 아래이되 `agents/`와 따로 둔다(open-issues extensions#Q8).

| 무엇 | 자리 |
|---|---|
| skill 꾸러미 | `<자리 폴더>/skills/<꾸러미>/SKILL.md`: 바로 아래 꾸러미만 본다 |
| MCP 서버 목록 | `<자리 폴더>/mcp-servers.json`: `revision`과 `mcp_servers` 두 칸의 JSON 한 파일 |

파일은 사람이 손으로 고칠 수도 있어 읽을 때 다시 검사한다. 틀린 파일은 그 자리 서버가 없는 것과 같다. 전역 서버와 이름이 겹치는 자리 서버는 쓰지 않는다(전역이 이긴다).

| command | actor | 입력 | 검사 | event | 오류 |
|---|---|---|---|---|---|
| `ChangePlaceExtensionSettings` | user | 자리, `mcp_servers` 새 목록 전체 | 파일 hash CAS(없는 파일은 null); 서버 이름이 자기 안에서도 전역과도 겹치지 않음; 서버 설정 검사(R12); 서버 `revision`은 바뀐 설정에 맞춰 올림 | `PlaceExtensionSettingsChanged`(자리, 전·후 파일 hash) | `invalid_input`, `conflict`, `not_found`, `forbidden` |
| `BeginMcpAuth` | user | 서버 `name`, 서버가 등록된 자리(전역 서버는 null), `client_id`, `scopes` | 그 자리의 그 이름 서버가 등록되어 있고 `http`+`oauth2`임; 같은 이름이 다른 자리에 있어도 입력의 자리 서버만 고름; 전역과 이름이 겹쳐 쓰지 않는 자리 서버는 없는 서버 | 없음(작업 메모리가 상태다) | `invalid_input`, `not_found`, `conflict`, `unavailable`, `forbidden` |
| `CompleteMcpAuth` | user | 서버 `name`, 서버가 등록된 자리(전역은 null), loopback `callback_port` | 시작과 같은 자리·이름의 서버로 state 검사 후 token 교환 | 없음 | `invalid_input`, `not_found`, `conflict`, `unavailable`, `forbidden` |

읽기: `ReadPlaceExtensionSettings(자리)`는 그 자리 서버 목록과 파일 hash, 그리고 그 자리에서 발견하는 skill(이름·설명·`source_kind`)과 가려진 skill, 제외한 꾸러미를 돌려준다. 화면과 run 준비(machine)가 읽는다.

## agent 정의가 고르는 것

agent 정의는 skill과 MCP를 "켠 것 목록"이 아니라 "끈 것"으로 저장한다. 기본은 보이는 것 전부 켬이고 정의에는 사람이 끈 것만 남는다.

| 필드 | 타입 | 제약 | 뜻 |
|---|---|---|---|
| `skills_off` | skill 이름 배열 | 기본 `[]`; 정확한 이름; 중복·와일드카드 금지; 지금 없는 이름도 둔다 | 끈 skill |
| `mcp_servers_off` | 서버 이름 배열 | 기본 `[]`; 정확한 이름; 중복·와일드카드 금지 | 끈 서버(그 서버의 tool 전부 끔) |
| `mcp_tools_off` | `(server_name, original_tool)` 배열 | 기본 `[]`; 정확한 쌍만 | 끈 개별 tool |
| `mcp_tools_safe` | `(server_name, original_tool)` 배열 | 기본 `[]`; 사람이 표시한 쌍만 | 되돌림을 모르는 tool을 묻지 않게 한 표시 |

agent 정의의 파일 자리와 나머지 칸은 agent 정의의 concern이 정한다. 이 concern은 위 네 칸의 뜻과 제약만 정한다.

## SkillEntry (값)

독립 entity·ID가 없는 발견 목록의 derived 값이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | 문자열 | 아니오 | 1~64자; `[a-z0-9]+(-[a-z0-9]+)*`; 선택 목록 unique | skill 이름 |
| `description` | 문자열 | 아니오 | 1~1024자; 공백만 금지 | 목록 설명 |
| `content_hash` | sha256 | 아니오 | UTF-8 Markdown·Agent Skills YAML name/description 검증 | run 시작 본문 판 |
| `source_kind` | `place / registered / personal / bundled` | 아니오 | 아래 발견 순서; `place`는 자리 층, 나머지는 전역 층 | 출처 |
| `folder_order` | 0 이상 정수 | 예 | registered에 필수 | 전역 등록 순서 |
| `bundle_path` | 절대 경로 | 아니오 | agent prompt에는 제공 안 함 | 플랫폼 읽기 위치 |
| `supplemental` | `{title,relative_path,hash}` 배열 | 아니오 | 제목 unique; 꾸러미 안 UTF-8 문서만; 기본 `[]` | 선택 보조 자료 |
| `selected` | boolean | 아니오 | 유효 발견에서 RunBasis에 고정한 agent 정의의 `skills_off`를 뺀 것 | run 제공 여부 |
| `discovered_at` | 시각 | 아니오 | 실제 발견 | 시각 |

## SkillReadResult (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | skill 이름 | 아니오 | 이번 run에 고정한 제공 목록에 있음 | 대상 |
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
| `effect` | `read / write / external` | 아니오 | user 명시; 다중 효과는 external > write > read; 미분류는 external | 실제 영향 |
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
| disconnected/failed_temporary | connecting | machine | enabled·고정 agent 정의가 끄지 않음·역할 상한 통과; 재연결 한도 | 없음; derived |
| connecting | connected | machine | 협상 및 모든 tool page 검증 완료 | 없음; derived |
| connecting/connected | failed_temporary | machine | 연결 실패·끊김 | 없음; derived |
| connecting/connected | failed_auth | machine | 인증 거절 | 없음; derived |
| 모든 상태 | disconnected | user / machine | disabled·제거·agent 정의가 끔; 새 call 차단·진행 call 취소 요청 | 설정 event는 → platform/settings |

## 정책

- **skill 발견.** 그 agent 자리의 skill 폴더 → user가 전역에 등록한 폴더 순 → 개인 skill 보관소 → 동봉 skill. 폴더 자체 및 바로 아래 꾸러미까지만, 앱 소스·상위 폴더·다른 harness 보관소 자동 탐색 없음. 같은 이름은 먼저 발견한 하나, 같은 범위는 꾸러미 이름 영문 사전순 우선이다. 제외·shadowed·선택 출처는 안전한 진단으로 남긴다.
- **agent 정의별 선택.** 정확한 skill·서버/tool의 끈 것은 agent 정의에만 저장하며 기본은 전부 켬이다. RunBasis에 resolved agent의 hash와 출처·확장 설정 revision(전역과 자리)·본문 hash·서버/tool 정의 판을 고정하고 현재 disabled·설정 회수·scope 축소는 매 call 검사한다. agent 정의를 고쳐도 도는 run의 선택은 바뀌지 않고 다음 run부터 쓴다.
- **skill 제공.** 유효 발견에서 고정한 `skills_off`를 뺀 것만; run 시작에 이름·설명·선택·본문 hash 고정. `/` 메뉴의 skill 묶음은 같은 목록이다 → lophn-agent/commands. prompt에는 이름·설명만 사전순이다. 읽기 전 변경·삭제면 실패하며 다음 run부터 새 판을 쓴다.
- **skill 읽기.** 본문 전체 및 보조 자료 제목만 반환한다. 제목으로 고른 보조 문서만 읽으며 상위 이탈·절대 경로·symlink·스크립트·실행 파일은 거절한다. 원격 검색·download·설치·자동 작성·script 실행은 없다.
- **권한.** skill 등록·읽기는 tool·권한·MCP 연결·인증을 추가하지 않는다. 본문은 data이며 역할·안전 경계를 바꾸지 않는다. → lophn-agent/harness/safety.
- **MCP 제공.** enabled 등록 서버(전역·자리) 중 고정한 `mcp_servers_off`에 없는 것만 연결 후보로 쓴다. 전체 검증 목록 중 `mcp_tools_off`에 없는 tool이 현재 역할 상한·scope를 모두 통과하면 제공한다. 새 tool은 기본 켬이지만 허락이 아니며 분류가 없으면 external로 묻는다. call마다 현재 개별 선택·enabled·설정 판·정의 hash를 재검사하며 설정만으로 Operator의 승인 tool 목록을 늘리지 않는다.
- **MCP 설정 소유.** 등록·삭제·enabled·목적지·분류는 user만 결정한다. 같은 이름의 서버는 전역과 자리 사이에서도 겹치면 등록을 거절한다. project·skill·역할 요청·server 응답·다른 harness의 설정 보관소에서 설정을 자동 수입하지 않는다. 누락·상충·잘못된 설정은 해당 서버만 제외한다. 설정 command·event·ledger 표는 → platform/settings; 새 extension ledger는 없다.
- **MCP 환경.** stdio는 필요한 `PATH`, `HOME`, `TEMP`, `LC_ALL` 및 해당 서버 env만 받는다. 앱 secret·다른 server secret·provider credential은 전달하지 않는다.
- **HTTP 인증.** secret은 인증을 붙이는 경계에서만 사용한다. TLS 검증 해제 없음; redirect에는 인증 헤더 제거. OAuth는 Authorization Code+S256 PKCE·브라우저·loopback 반환이며 발급자·대상에 묶고 credential별 동시 갱신은 하나다.
- **연결 상한.** 연결 30000ms, 모든 tool list page 합산 30000ms, call 기본 60000ms. 끊김 재연결은 1000·2000·4000ms 뒤 최대 3회; 소진 뒤 user 재연결·설정 변경까지 대기. auth 거절 자동 재연결 없음. 이미 전달한 call은 재전송하지 않는다.
- **수명.** assignment 사용 종료·서버 제거·disabled·선택 회수·데몬 종료는 해당 (assignment, server) 새 call 즉시 금지, 진행 call 취소 요청 뒤 연결 종료. stdio 정상 종료 5000ms 뒤 남으면 강제 종료. 실제 효과는 취소 성공으로 추정하지 않는다.
- **목록.** MCP 판 협상 및 전체 page 수신·중복 이름·반복 cursor·schema 검증이 모두 끝난 뒤만 제공한다. 변경 통지·재연결에서 전체 재조회. 되돌림을 모르는 새 tool은 external로 보고 묻는다. 사람이 agent 정의에서 그 tool을 안전하다고 표시(`mcp_tools_safe`)하면 묻지 않는다. MCP hint·설명으로 분류하거나 allow로 추정하지 않는다. 이름·설명·input·MCP 행동 hints 변경은 옛 분류를 무효화하고 없어진 tool은 즉시 call 금지다.
- **외부 이름.** `ext_` + server 이름 + `_` + 원래 tool 이름을 지원 문자로 canonicalize하여 최대 64자로 만든다. 충돌·축약이면 원래 server·tool 쌍의 SHA-256 앞 8자 suffix를 붙인다. 그래도 충돌이면 등록 거절한다. 원래 이름·server·설정 판을 ToolCall에 보존한다. → lophn-agent/harness/tools.
- **판정.** 목록 노출은 실행 허용이 아니다. 현재 역할·scope·효과·input·되돌림 보장으로 call마다 → lophn-agent/harness/tool-judgment. 결과는 data로 포장하며 secret·코드·웹 검색·subagent 금지를 우회하지 않는다.

