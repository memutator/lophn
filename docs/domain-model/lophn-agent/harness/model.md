---
type: domain-model
concerns: [lophn-agent/harness/model]
---
# lophn-agent/harness/model

Model catalog 항목(model과 option 축)·가격 snapshot, role별 기본 model·요약용 model·즐겨찾기(Workspace 층)와 호출 검증 snapshot을 정의한다. 기본값이 project·Operator·session 층과 어떻게 겹치는지는 → lophn-agent/agents, session override의 저장은 → lophn-agent/conversation이다.

## CatalogEntry (값)

ledger entity가 아닌 derived catalog 값이다. model identity는 `(provider_definition, model_name)`이며 직접 provider와 중계 provider의 값은 공유하지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `provider_definition / model_name` | 비어 있지 않은 문자열 각각 | 아니오 | 쌍 unique; provider 정의는 → lophn-agent/harness/provider | model identity |
| `context_limit / input_limit / output_limit` | 양의 정수 token 각각 | 예 | 알려진 한계만; 0·음수·소수 금지 | 전체 창·입력·출력 한계 |
| `supports_tools` | boolean | 예 | null은 미확인, true로 추측 금지 | tool call 지원 |
| `input_media / output_media` | `text / image / audio / video` 배열 각각 | 예 | 중복 없음; 미확인은 null | 입출력 매체 |
| `options` | OptionAxis 배열 | 예 | null은 미확인(option 선택 불가·요청에 option 필드 없음), 빈 배열은 확인된 없음; axis `id` unique | option 축 |
| `preview / deprecated` | boolean 각각 | 예 | 확인된 값만 | model 상태 |
| `source` | `release_snapshot / models_dev / lophn_patch / user` | 아니오 | 각 필드의 provenance도 유지 | 적용 출처 |
| `source_revision` | 비어 있지 않은 문자열 | 아니오 | snapshot 해시·ETag·보정 판 | 판 |
| `checked_at / received_at` | 시각 각각 | 예 | 갱신 확인·정상 수신 구별 | 정보 시각 |
| `price_basis` | PriceBasis | 예 | 미확인은 null | 당시 가격 자료 |

## OptionAxis (값)

model이 가진 option 하나(effort, speed 등)다. catalog 자료이며 코드에 model별 목록을 두지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | 비어 있지 않은 문자열 | 아니오 | model 안에서 unique; `effort`·`speed` 같은 이름 | 축 |
| `label` | 표시 이름 | 아니오 | 영어; 알려진 축은 → shell/wording의 message key | 화면에 보일 이름 |
| `values` | OptionValue 배열 | 아니오 | 비어 있지 않음; value 중복 없음; 약한 값에서 강한 값 순서 | 지원하는 값 |
| `default_value` | OptionValue의 `value` | 예 | 확인된 기본값만; values 안에 있음 | 모델에 맡김일 때 쓰는 값 |
| `budget` | `{minimum, maximum}` 양의 정수 token | 예 | `id`가 effort이고 값이 token 예산으로 번역될 때 필수; minimum ≤ maximum | 예산 범위 |

## OptionValue (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `value` | 비어 있지 않은 문자열 | 아니오 | 축 안에서 unique; effort 축은 `off / minimal / low / medium / high / very_high / maximum` 중 | 값 |
| `label` | 표시 이름 | 아니오 | 영어; effort 축은 Off·Minimal·Low·Medium·High·XHigh·Max, 이름은 message key | 화면에 보일 이름 |
| `wire` | OptionWire | 예 | null이면 호출 형식의 표가 (축, 값)을 요청 필드로 옮긴다(effort가 이 경우) | 요청에 싣는 방법 |

OptionWire는 둘 중 하나다. `body_patch`: 요청 body에 합칠 JSON object(예: OpenAI의 priority service tier). `model_id`: 보낼 model 이름을 다른 이름으로 바꿈(예: xAI Grok fast). 화면은 wire를 모르고 축·값의 표시 이름만 쓴다. 모델에 맡김은 값이 아니라 선택 없음(`option_values`에 그 축이 없음)이며 effort 축에서는 순서 밖의 선택으로 보인다.

호출 형식마다 둔 표 하나(→ 정책 "option 번역")만 코드에 있으며 model 이름으로 분기하지 않는다.

## PriceBasis (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `currency` | ISO 4217 문자열 | 아니오 | catalog 요율은 고정 `USD`; provider 보고 청구액 통화는 → lophn-agent/harness/usage | 통화 |
| `rates` | PriceRate 배열 | 아니오 | 비어 있지 않음; 구간 겹침 금지 | 적용 구간별 요율 |
| `source / revision` | 문자열 각각 | 아니오 | 공식 catalog·models.dev·보정 등 명시 | 출처·판 |
| `checked_at` | 시각 | 아니오 | 당시 확인값 | 가격 시각 |

## PriceRate (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `context_from / context_through` | 0 이상 정수 token / 양의 정수 token | 예 | 하한 포함·상한 포함; null은 열린 경계; 순서 유효 | context 가격 구간 |
| `cache_ttl_ms` | 양의 정수 ms | 예 | cache write 요율의 확인된 TTL | cache 구간 |
| `input / output / cache_read / cache_write / reasoning` | 0 이상 십진수 문자열 각각 | 예 | 1000000 token당 금액; null은 모름, 0은 확인된 무료 | 요율 |

## ModelChoice (값)

agent 정의·기본값·session override가 가지는 model 선택 하나다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `provider` | `pvd` ID | 아니오 | → lophn-agent/harness/provider | 고른 provider(credential은 provider에 하나) |
| `model_name` | 비어 있지 않은 문자열 | 아니오 | 현재 provider 이름 목록 있으면 포함 필수 | model 이름 |
| `option_values` | `{축 id: 값}` | 아니오 | 기본 `{}`; 그 model의 축과 값만; 없는 축은 모델에 맡김 | option 선택 |

## ResolvedModel (값)

resolved agent(→ lophn-agent/agents)가 고른 ModelChoice를 catalog·provider의 현재 정보로 검증해 RunBasis에 고정하는 값이다. 선택 정본은 → lophn-agent/agents와 session이며 이 값은 선택을 독립 편집하지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `purpose` | `judgment / organizing` | 아니오 | agent model 또는 요약용 model을 resolve | 용도 |
| `credential_revision` | 양의 정수 | 예 | run 시작에 고정한 provider의 credential 판; 무인증 loopback(custom provider)만 null | 호출 credential |
| `provider` | `pvd` ID | 아니오 | → lophn-agent/harness/provider | 선택 provider |
| `model_name` | 비어 있지 않은 문자열 | 아니오 | 현재 provider 이름 목록 있으면 포함 필수 | 고른 model 이름 |
| `sent_model_name` | 비어 있지 않은 문자열 | 아니오 | `model_id` wire가 있으면 바뀐 이름, 없으면 `model_name` | 요청에 보낼 model 이름 |
| `verification` | `verified / unverified` | 아니오 | 목록 미조회면 unverified; 첫 성공 call에 확인 | 이름 확인 |
| `option_values` | `{축 id: 값}` | 아니오 | 기본 `{}`; catalog 축·값 안에서만; 맞춤이 있었으면 맞춘 뒤의 값 | option 선택 |
| `request_patch` | JSON object | 아니오 | option 번역 결과; 기본 `{}` | 요청에 더할 조각 |
| `context_limit / input_limit / output_limit` | 양의 정수 token 각각 | 아니오 | catalog 확인 또는 user 명시값; 임의 fallback 한계 금지 | 호출 검사 한계 |
| `supports_tools` | boolean | 아니오 | 확인 또는 user 명시값 | tool 지원 |
| `input_media / output_media` | 매체 배열 각각 | 아니오 | text 필수 | 매체 확인 |
| `price_basis` | PriceBasis | 예 | 없으면 비용 모름 | 가격 snapshot |
| `basis` | 필드별 출처·판의 JSON object | 아니오 | catalog 사실·user 보완 구별 | 선택 근거 |

## ModelDefaults (값)

Workspace 층의 기본 model이다. `{lophn: ModelChoice|null, context_engineer: ModelChoice|null, app_engineer: ModelChoice|null, operator: ModelChoice|null, summaries: ModelChoice|null, settings_seq}`다. 처음은 모두 null이다. 앞의 넷은 role마다의 기본 model과 option 값이고, `summaries`는 제목·요약·압축에 쓰는 "Model for summaries" 한 칸(전역만)이다. project·Operator·session 층이 이 위에 어떻게 겹치는지는 → lophn-agent/agents다. 변경은 진행 중 Run과 이어 하기의 고정 값에 전파하지 않는다.

## ModelFavorites (값)

Workspace(사람 전역)의 즐겨찾기다. `{items: [{provider, model_name}], settings_seq}`다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `items` | `(provider, model_name)` 배열 | 아니오 | 중복 없음; 순서 = 별표를 찍은 순서; 새로 찍은 것은 맨 끝 | 즐겨찾기 |

최근 사용 목록은 두지 않는다. catalog에서 사라지거나 provider가 연결되어 있지 않은 항목도 지우지 않고 순서를 보존한다.

## CatalogState (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `auto_update` | boolean | 아니오 | 기본 true | 공개 catalog 갱신 |
| `etag` | 문자열 | 예 | 조건부 GET | 현재 catalog 판 |
| `last_checked_at / last_received_at` | 시각 각각 | 예 | 검증 실패와 network 무응답 구별 | 갱신 상태 |
| `last_failure` | 안전한 오류 코드 | 예 | 원문 오류 없음 | 갱신 실패 |
| `snapshot_hash` | sha256 | 아니오 | 마지막 정상본 또는 release snapshot | 적용 derived 자료 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `agent_model_defaults` | role별 기본 선택 또는 null과 설정 seq | PK `slot` | PK; `lophn / context_engineer / app_engineer / operator / summaries` 다섯 값만 | 없음 | provider는 FK가 아니다(Disconnect가 provider를 지워도 고른 선택은 남고 다시 Connect하기 전까지 그 agent는 시작하지 않는다); option 값은 설정 snapshot; 삭제 RESTRICT |
| `model_favorites` | 즐겨찾기 한 줄 | PK `(provider, model_name)` | `rank`(0 이상 정수, 빈틈 없는 순서) | `rank` | provider는 FK가 아니다(저장할 때 provider가 있는지 command가 본다); 삭제 RESTRICT |

CatalogEntry·CatalogState는 ledger 밖 derived store다. 당시 가격·한계는 Run.basis·ModelCall에 고정하며 catalog 삭제로 과거를 바꾸지 않는다. 설정 공통 층은 → platform/settings.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `ChangeModelDefaults` | user | slot별 ModelChoice 또는 null | 이전 설정 seq; provider·목록·한계·option 축과 값 검증 | `ModelDefaultsChanged` | `invalid_input`, `conflict`, `not_found`, `unavailable` |
| `ChangeModelFavorites` | user | 순서 있는 `(provider, model_name)` 목록 | 이전 설정 seq; 중복 없음; provider 존재 | `ModelFavoritesChanged` | `invalid_input`, `conflict`, `not_found` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `ModelDefaultsChanged` | 없음 | 설정 seq, 변경 slot, 설정 snapshot | shell/desktop, lophn-agent/agents |
| `ModelFavoritesChanged` | 없음 | 설정 seq, 새 순서 | shell/desktop |

## 정책

- **선택 적용.** Run 시작에 resolved agent(→ lophn-agent/agents)의 ModelChoice를 resolve한다. 새 판단·본문은 judgment, 제목·요약·세션 압축은 organizing이며 후자는 Workspace의 `summaries`가 null이면 judgment와 같은 model·option 값을 쓴다. 사람이 부른 Compact 요약도 같은 방식으로 resolve한다. 기본값 변경과 catalog 누락은 이미 고른 구성이나 진행 중 Run을 바꾸지 않는다. 어느 층에도 model이 없거나 provider가 Disconnect됐거나 provider의 credential을 쓸 수 없으면 Run을 시작하지 않는다.
- **session override.** composer가 고른 ModelChoice는 그 session의 다음 Run부터 resolve에 들어가며 agent 정의·기본값·다른 session을 바꾸지 않는다. 저장은 → lophn-agent/conversation.
- **호출 gate.** 빈 model, 확인·user 명시 한계 없음, 필요한 text·tool 미지원, 입력·예약 출력·전체 창 초과, catalog에 없는 option 축 또는 값이면 call하지 않는다. 이름 미확인을 큰 한계나 tool 지원으로 대신하지 않는다.
- **catalog 우선순위.** models.dev release snapshot → 새 정상 갱신본 → 좁은 lophn 보정 → user 명시 보완. 명시된 필드만 덮는다.
- **catalog 갱신.** 마지막 확인 뒤 86400000ms마다 비동기 공개 GET; ETag 조건부 조회. user 새로 받기는 즉시. 세션·key·token·선택·credential은 보내지 않는다. auto_update false면 마지막 정상본만 쓴다.
- **catalog 검증.** 빈 목록·깨진 자료·양의 정수 아닌 알려진 token 한계·음수 또는 무한대 가격·USD/1000000 token이 아닌 단위·중복 또는 잘못된 context 가격 경계는 전체 갱신 거절이다. 마지막 정상본, 없으면 release snapshot을 유지하며 실패·마지막 정상 수신 시각을 남긴다.
- **선택 보존.** catalog 누락·폐기 예정은 저장된 선택(기본값·agent 정의·session override·즐겨찾기)을 지우거나 이름을 바꾸지 않는다. provider 사용 불가에도 자동 model 대체는 없다.
- **option 번역.** 호출 형식마다 (축, 값) → 요청 필드 표 하나만 코드에 둔다. `wire`가 있으면 `body_patch`를 요청 body에 합치거나 `model_id`로 보낼 model 이름만 바꾸고, `wire`가 null인 effort는 호출 형식의 표가 옮긴다. model 이름으로 갈라지는 분기는 없다. 지원하지 않는 값은 실패이며 조용히 낮추거나 높이지 않는다.
- **effort.** 지원된 값만 제공한다. token 예산으로 번역되는 값은 low 2048·medium 8192·high 16384·maximum 32768 token을 `budget`의 min/max로 clamp한다. 켜고 끄기만 받는 model은 `off`·`high`만 선언한다. 모델에 맡김은 축의 `default_value`가 확인돼 있으면 그 값을, 아니면 그 축의 필드를 보내지 않는다. Run 중 고정 값을 높이지 않는다.
- **model 바꿈 맞춤.** 사람이 model을 바꿔 `option_values`의 값이 새 model에 없으면 같은 축에서 그보다 약하면서 가장 가까운 값으로 맞추고, 없으면 그 축의 가장 약한 지원 값으로 맞춘다. `off`는 맞춤 대상이 아니다. 새 model에 없는 축의 값은 버린다. 맞춘 사실은 알림으로 남기고 저장 전 값은 바꾸지 않는다.
- **표시 이름.** `very_high`는 XHigh, `maximum`은 Max로 보인다. 화면 문구는 → shell/wording의 영어 message key이며 enum을 화면 문자열로 직접 노출하지 않는다.
- **즐겨찾기 순서.** 선택 화면의 Favorites 묶음은 `items` 순서 그대로이며 provider로 다시 묶지 않는다. 검색 중에도 일치하는 즐겨찾기가 먼저다. 즐겨찾기 model은 아래 provider 묶음에도 보인다.
- **가격.** 현재 가격으로 과거 call 비용을 재계산하지 않는다. 계산·집계는 → lophn-agent/harness/usage.

