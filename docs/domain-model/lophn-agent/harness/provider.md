---
type: domain-model
concerns: [lophn-agent/harness/provider]
---
# lophn-agent/harness/provider

Provider의 호출 목적지·형식과 그 credential 하나의 참조·사용 가능 상태를 정의한다. provider 하나에 credential은 하나이며 연결이 곧 provider다. provider는 인증·endpoint만 가지며 model과 option은 고르지 않는다(→ lophn-agent/harness/model).

## Provider (`pvd`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `pvd` ID | 아니오 | PK | 등록 provider |
| `name` | 비어 있지 않은 문자열 | 아니오 | user 이름표 | 표시 이름 |
| `definition` | ProviderDefinition | 아니오 | 지원 형식·auth 일치 | 내장 정의 및 보정 snapshot |
| `endpoint` | URL | 아니오 | 목적지 불변; remote HTTPS; HTTP·무인증은 loopback만 | model 전송 목적지 |
| `protocol` | `anthropic-messages / openai-responses / openai-chat-completions` | 아니오 | 정의의 지원 형식 중 하나; 이름으로 추측 안 함 | adapter |
| `credential` | ProviderCredential | 아니오 | 정확히 하나; 두 번째 등록 없음 | 이 provider의 유일한 연결 |

### 상태

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | 등록 | user | 정의·endpoint 검증 및 credential의 secret 보관 성공(Connect) | `ProviderRegistered` |
| 등록 | 등록 | machine | OAuth 갱신·사용 가능 상태 변경 | `ProviderChanged` |
| 등록 | 없음 | user | 확인 창을 거친 Disconnect; provider와 credential(secret)을 함께 지움 | `ProviderDisconnected` |

### 불변 조건

- provider에는 credential이 하나다. 계정 목록·순서·계정별 사용 설정은 없고 provider를 끄고 켜는 상태도 없다. 다시 로그인하거나 key를 바꾸려면 Disconnect 뒤 같은 정의를 다시 Connect한다. Disconnect한 provider를 고른 agent는 다시 Connect하기 전까지 일을 시작하지 않는다(→ lophn-agent/harness/model).
- endpoint 변경은 새 Provider다. 진행 run의 내용을 다른 provider나 다른 model로 자동 이동하지 않는다.
- credential은 OS keychain에 있고 ledger·event·blob에는 불투명 ref만 있다. → platform/secrets. 인증을 붙이는 전송 경계만 값에 접근하며 agent·tool·prompt에는 값이 없다.
- provider credential은 앱 secret과 용도가 다르며 앱에 전달하지 않는다.
- 다른 프로그램의 로그인·keychain 항목·인증 상태를 가져오지 않는다.
- network redirect의 다른 목적지에 credential을 보내지 않는다. TLS 검증 해제는 없다.

## ProviderDefinition (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `key` | 비어 있지 않은 문자열 | 아니오 | 정의 이름 unique | provider 제품 |
| `display_name` | 비어 있지 않은 문자열 | 아니오 | 제품 이름 그대로 | 표시 |
| `protocols` | 호출 형식 배열 | 아니오 | 비어 있지 않음; 중복 없음; 세 형식만 | 지원 adapter |
| `auth_kinds` | `api_key / oauth / none` 배열 | 아니오 | 비어 있지 않음; 중복 없음; none은 custom 정의의 loopback만 | 지원 인증 |
| `models_endpoint` | URL | 예 | remote HTTPS; 공개 catalog 또는 인증된 provider API | model 이름 조회 |
| `oauth` | OAuthDefinition | 예 | oauth 지원에 필수; 검증 전 활성화 금지 | 로그인·호출 허용 경계 |
| `revision` | 비어 있지 않은 문자열 | 아니오 | call snapshot에 기록 | 보정 판 |

| 제품 | 인증 지원 대상 | 호출 형식 |
|---|---|---|
| Anthropic | API key; Claude OAuth는 허용·실제 호출 검증 후 | Anthropic Messages |
| OpenAI | API key; ChatGPT OAuth는 허용·실제 호출 검증 후 | OpenAI Responses, OpenAI Chat Completions |
| xAI | API key; SuperGrok OAuth는 허용·실제 호출 검증 후 | OpenAI Chat Completions |
| OpenRouter, Groq, DeepSeek | API key | OpenAI Chat Completions |
| Google Gemini | API key | OpenAI Chat Completions 호환; native 형식 없음 |
| custom(직접 추가한 OpenAI 호환) | API key 선택; loopback 주소는 무인증 | OpenAI Chat Completions |

- 인증 없음은 내장 정의에 없다. Ollama·LM Studio·llama.cpp 같은 로컬 서버를 위한 내장 정의도 없고 사람이 custom provider로 직접 추가한다.
- 정의 적용 우선순위는 catalog 정의 → lophn 보정 → user 명시 보완이다. 뒤의 명시 필드만 덮는다. provider 개수 고정 상한은 없다.

## ProviderCredential (값)

Provider에 속하는 구조값이며 독립 entity·ID 접두사는 없고 provider당 하나다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `api_key / oauth / none` | 아니오 | 정의가 지원; none은 custom provider의 loopback만 | 인증 종류 |
| `secret_ref` | 불투명 secret 참조 | 예 | api_key·oauth에 필수; none에 null; → platform/secrets | key 또는 token 묶음 |
| `revision` | 양의 정수 | 아니오 | OAuth 갱신마다 증가 | credential 판 |
| `state` | `available / rejected / usage_wait / revoked` | 아니오 | 초기 검증 결과; 아래 전이 | 사용 가능성 |
| `unavailable_reason` | `authentication / quota / plan_access / refresh_revoked` | 예 | 불가 상태에 안전한 코드 | 인증 폐기와 사용량 제한 구분 |
| `until` | 시각 | 예 | usage_wait에 필수; 그 외 null | 다음 선택 가능 시각 |
| `expires_at` | 시각 | 예 | OAuth 확인값 | access token 만료 |
| `logged_in_at / refreshed_at` | 시각 각각 | 예 | 성공 사실만 | 로그인·갱신 |
| `model_blocks` | ModelBlock 배열 | 아니오 | 기본 `[]`; model별 제한만 | 다른 model 사용을 막지 않는 제외 |

rejected·revoked는 Disconnect 뒤 Connect로만 벗어난다. 같은 credential을 교체하거나 다시 로그인하는 전이는 없다.

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `available` | user | secret 보관 및 인증 검증(Connect와 같은 command) | `ProviderRegistered` |
| `available` | `rejected` | machine | API key 인증 거절 또는 갱신 뒤에도 OAuth 401 | `ProviderChanged` |
| `available` | `usage_wait` | machine | quota·잔액·지출 한도·긴 429 | `ProviderChanged` |
| `usage_wait` | `available` | machine | until 도달; 새 유료 test 없이 선택 가능성만 회복 | `ProviderChanged` |
| available/rejected/usage_wait | `revoked` | machine | OAuth 갱신 권한 폐기·만료·재사용·계정 불일치 | `ProviderChanged` |
| `available` | `available` | machine | OAuth 갱신 성공; 새 secret_ref/revision | `ProviderChanged` |

## ModelBlock (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `model_name` | 비어 있지 않은 문자열 | 아니오 | provider 안에서 unique | 제외 model |
| `reason` | `not_found / retired / account_model_access` | 아니오 | provider 확인값 | 불가 이유 |
| `until` | 시각 | 예 | 확인된 reset만 | 제한 기한 |

## OAuthDefinition (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `product` | `claude / chatgpt / supergrok` | 아니오 | lophn 자신의 product 식별 | 로그인 제품 |
| `flow` | `pkce_paste_code / device_code / device_code_then_pkce_paste_url` | 아니오 | 아래 제품 표 | 인증 방식 |
| `issuer / authorization_endpoint / token_endpoint` | HTTPS URL 각각 | 아니오 | discovery 또는 검증된 고정 정의; redirect 변경 불가 | 인증 목적지 |
| `allowed_call_origins` | HTTPS origin 배열 | 아니오 | 빈 배열 금지; token audience와 일치 | token 전달 허용 목적지 |
| `scopes` | 문자열 배열 | 아니오 | 아래 허용 권한만 | 요청 scope |
| `verified_for_lophn` | boolean | 아니오 | 기본 false; 사용 허용·로그인·갱신·실제 호출 모두 확인돼야 true | 활성화 gate |

| 제품 | flow·제약 | 호출 목적지 |
|---|---|---|
| Claude | S256 PKCE; code 붙여넣기; state 정확 일치; 계정 profile·추론 scope; callback server 없음 | Anthropic API |
| ChatGPT | device code 우선; 계정에서 꺼진 경우만 S256 PKCE·최종 URL 붙여넣기; state 필수; port 1455 callback 없음 | 검증된 ChatGPT Codex backend; 데이터 거주 지역 전달; 서버 저장 요청 안 함 |
| SuperGrok | HTTPS OpenID Connect discovery; device code; 신원·profile·email·offline 갱신·Grok CLI 접근·API 접근 scope만 | xAI API |

## ProviderFailure (값)

| code | 분류 조건 |
|---|---|
| `temporary` | 연결 실패·stream 중단·HTTP 500/502/503/529; 확인 retry가 30000ms 이내인 429 |
| `credential_unavailable` | 인증 거절·잔액·지출 한도·quota; 30000ms 초과 또는 retry 시각 없는 429; 확인된 plan 접근 403 |
| `model_unavailable` | model 없음·폐기·해당 credential의 model 접근 제한 |
| `context_exceeded` | provider 입력 한계 초과 |
| `invalid_request` | 잘못된 입력·tool schema 등 |
| `unknown` | 안전하게 분류 불가; 인증 실패로 추정 금지 |
| `cancelled` | user 멈춤 |
| `refused` | model의 내용 거절 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `providers` | Provider, definition snapshot, revision | PK `id` | 없음 | `definition_key` | secret 값 없음 |
| `provider_credentials` | ProviderCredential | PK `provider` | PK(provider당 하나) | `(state,until)` | provider FK; secret_ref는 → platform/secrets; Disconnect가 provider와 함께 지움 |
| `provider_credential_model_blocks` | ModelBlock | PK `(provider,model_name)` | PK | `until` | `provider` FK |

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `RegisterProvider` | user | ID, name, definition 또는 OpenAI 호환 직접 추가(표시 이름·기본 URL·선택 API key), endpoint, protocol, 인증 방식과 보관된 secret_ref | 지원 형식·목적지·ID 내용 일치; 같은 ID로 이미 연결돼 있으면 거절 | `ProviderRegistered` | `invalid_input`, `conflict`, `unavailable` |
| `DisconnectProvider` | user | provider | provider revision; 확인 창 증거; credential secret 삭제 | `ProviderDisconnected` | `conflict`, `forbidden`, `unavailable` |
| `RefreshProviderCredential` | machine | 새 secret_ref·revision·expiry 또는 안전한 불가 상태 | 기존 credential revision; 단일 갱신 경계 | `ProviderChanged` | `conflict`, `unavailable` |
| `RecordProviderAvailability` | machine | model block·until·reason | credential revision | `ProviderChanged` | `conflict`, `invalid_input` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `ProviderRegistered` | provider | name, endpoint, protocol, definition revision, 인증 종류 | lophn-agent/harness/model, shell/desktop |
| `ProviderChanged` | provider | 변경 필드, revision, credential revision·안전한 상태 | lophn-agent/harness/run-loop, shell/desktop |
| `ProviderDisconnected` | provider | provider ID, 정의 key | lophn-agent/harness/model, lophn-agent/harness/run-loop, shell/desktop |

## 정책

- **미검증 provider.** OAuth 제품별 lophn 사용 허용·endpoint·client 식별·실제 호출 contract가 검증되지 않은 정의는 활성화하지 않는다.

- **credential 하나.** 호출 계정을 고르는 규칙은 없다. 호출은 이 provider의 credential 하나로 나가며 agent 정의·기본값·session override는 provider만 고른다. usable하지 않으면(rejected·usage_wait·revoked, model block) 그 call은 막히고 run은 멈춘다. 같은 provider의 다른 credential이나 다른 provider·model로 자동 이동하지 않는다. 실제 판은 ModelCall에 남긴다. 무인증은 custom provider의 loopback만 가능하다.
- **Disconnect.** 확인 창(→ shell/confirmation-window)을 거쳐 provider와 credential(secret)을 함께 지운다. 새 call은 즉시 막히고 가능한 진행 호출에는 취소를 요청한다. 같은 ID로 다시 Connect할 수 있고 그때 그 provider를 고른 agent는 다시 쓸 수 있다.
- **OAuth 갱신.** 만료 60000ms 전부터 credential별 단일 갱신, 최대 15000ms. secret 재조회·새 token 안전 보관 뒤 사용하며 새 refresh token 없으면 이전 것을 유지한다. OAuth 401은 갱신 한 번·동일 요청 재전송 한 번만; 실제 재전송은 별도 ModelCall이며 run 한도에 센다.
- **device code.** 서버 interval·expiry 우선; interval 없으면 5000ms. xAI slow_down마다 5000ms 증가. ChatGPT 최대 900000ms, xAI expiry 없으면 최대 300000ms. 거절·만료·user 취소 즉시 중단한다. code·PKCE verifier·state 원문은 ledger에 저장하지 않는다.
- **사용량 대기.** 확인된 reset까지, 모르면 3600000ms. 그 전 call과 test call은 금지다. plan 접근 제한은 인증 폐기와 구별한다.
- **호출.** SDK 숨은 retry는 끈다. 완전 응답의 tool 이름·인자·대응 key·순서를 보존한다. 사람이 읽는 추론 본문은 후속 prompt에서 제외한다. provider 연속 호출에 필수인 불투명 추론 상태(signature·encrypted reasoning item 등)는 run 메모리에만 보관하고 같은 run·같은 provider·같은 model의 다음 요청에 원형 그대로 다시 싣는다. 다른 provider·model·세션으로 넘기거나 ledger·blob에 보관하지 않으며 run 종료·메모리 유실 때 버린다.
- **cache.** Anthropic Messages의 명시 cache는 300000ms; Responses·Chat Completions는 자동 cache. 미지원이면 cache 없이 호출한다. 경계 선택은 → lophn-agent/harness/prompt-assemble.
- **과금 경로.** API key는 API 과금, Claude OAuth는 추가 사용량, ChatGPT·SuperGrok OAuth는 구독으로 표시하되 청구액 확정은 추측하지 않는다. 계산은 → lophn-agent/harness/usage.
- **제품 식별.** 모든 로그인·call은 lophn으로 식별한다. 다른 CLI 위장·CLI 경유·요금 제한 우회용 이름 변경은 금지다.
