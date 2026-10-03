---
type: domain-model
concerns: [lophn-agent/harness/model]
---
# lophn-agent/harness/model

Model catalog 항목·가격 snapshot과 공통 judgment·organizing slot 설정을 정의한다.

## CatalogEntry (값)

ledger entity가 아닌 derived catalog 값이다. model identity는 `(provider_definition, model_name)`이며 직접 provider와 중계 provider의 값은 공유하지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `provider_definition / model_name` | 비어 있지 않은 문자열 각각 | 아니오 | 쌍 unique; provider 정의는 → lophn-agent/harness/provider | model identity |
| `context_limit / input_limit / output_limit` | 양의 정수 token 각각 | 예 | 알려진 한계만; 0·음수·소수 금지 | 전체 창·입력·출력 한계 |
| `supports_tools` | boolean | 예 | null은 미확인, true로 추측 금지 | tool call 지원 |
| `input_media / output_media` | `text / image / audio / video` 배열 각각 | 예 | 중복 없음; 미확인은 null | 입출력 매체 |
| `reasoning` | ReasoningSupport | 아니오 | 불명은 mode `unknown` | 추론 옵션 |
| `preview / deprecated` | boolean 각각 | 예 | 확인된 값만 | model 상태 |
| `source` | `release_snapshot / models_dev / lophn_patch / user` | 아니오 | 각 필드의 provenance도 유지 | 적용 출처 |
| `source_revision` | 비어 있지 않은 문자열 | 아니오 | snapshot 해시·ETag·보정 판 | 판 |
| `checked_at / received_at` | 시각 각각 | 예 | 갱신 확인·정상 수신 구별 | 정보 시각 |
| `price_basis` | PriceBasis | 예 | 미확인은 null | 당시 가격 자료 |

## ReasoningSupport (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `mode` | `unknown / none / named / budget / toggle` | 아니오 | provider가 확인한 방식 | 조절 방식 |
| `levels` | ReasoningLevel 배열 | 아니오 | named의 확인된 지원값만; 중복 없음 | 직접 선택 수준 |
| `minimum_budget / maximum_budget` | 양의 정수 token 각각 | 예 | budget에 필수; min ≤ max | token 범위 |
| `default_level` | ReasoningLevel | 예 | 확인된 기본값만; `provider_default` 제외 | 기본 수준 |

ReasoningLevel은 순서가 있는 `off / minimal / low / medium / high / very_high / maximum`과 순서 밖의 `provider_default`다. 화면은 끔·최소·낮음·중간·높음·매우 높음·최대·모델에 맡김이다.

## PriceBasis (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `currency` | ISO 4217 문자열 | 아니오 | 요율 전부 같은 통화 | 통화 |
| `rates` | PriceRate 배열 | 아니오 | 비어 있지 않음; 구간 겹침 금지 | 적용 구간별 요율 |
| `source / revision` | 문자열 각각 | 아니오 | 공식 catalog·models.dev·보정 등 명시 | 출처·판 |
| `checked_at` | 시각 | 아니오 | 당시 확인값 | 가격 시각 |

## PriceRate (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `context_from / context_through` | 0 이상 정수 token / 양의 정수 token | 예 | 하한 포함·상한 포함; null은 열린 경계; 순서 유효 | context 가격 구간 |
| `cache_ttl_ms` | 양의 정수 ms | 예 | cache write 요율의 확인된 TTL | cache 구간 |
| `input / output / cache_read / cache_write / reasoning` | 0 이상 십진수 문자열 각각 | 예 | 1000000 token당 금액; null은 모름, 0은 확인된 무료 | 요율 |

## ModelSlot (값)

독립 ID가 없는 공통 설정이다. 처음 설치에는 두 slot 모두 null이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `slot` | `judgment / organizing` | 아니오 | 각각 하나 | judgment model / organizing model |
| `provider` | `pvd` ID | 아니오 | → lophn-agent/harness/provider | 선택 provider |
| `model_name` | 비어 있지 않은 문자열 | 아니오 | 현재 provider 이름 목록 있으면 포함 필수 | 전송 model 이름 |
| `verification` | `verified / unverified` | 아니오 | 목록 미조회면 unverified; 첫 성공 call에 확인 | 이름 확인 |
| `options` | JSON object | 아니오 | protocol·model이 지원한 schema; 기본 `{}` | sampling 등 |
| `reasoning_level` | ReasoningLevel | 아니오 | 기본 provider_default; 지원 범위만 선택 | 추론 선택 |
| `context_limit / input_limit / output_limit` | 양의 정수 token 각각 | 아니오 | catalog 확인 또는 user 명시값; 임의 fallback 한계 금지 | 호출 검사 한계 |
| `supports_tools` | boolean | 아니오 | 확인 또는 user 명시값 | tool 지원 |
| `input_media / output_media` | 매체 배열 각각 | 아니오 | text 필수 | 매체 확인 |
| `price_basis` | PriceBasis | 예 | 없으면 비용 모름 | 가격 snapshot |
| `basis` | 필드별 출처·판의 JSON object | 아니오 | catalog 사실·user 보완 구별 | 선택 근거 |

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
| `agent_model_slots` | ModelSlot 또는 빈 slot 및 설정 seq | PK `slot` | PK; 두 값만 | 없음 | provider FK; price·basis는 설정 snapshot; 삭제 RESTRICT |

CatalogEntry·CatalogState는 ledger 밖 derived store다. slot의 당시 가격·한계는 설정 및 Run.basis·ModelCall에 고정하며 catalog 삭제로 과거를 바꾸지 않는다. 설정 공통 층은 → platform/settings.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `ChangeModelSlots` | user | judgment·organizing 설정 또는 null | 이전 설정 seq; provider·목록·한계·지원 schema 검증 | `ModelSlotsChanged` | `invalid_input`, `conflict`, `not_found`, `unavailable` |
| `VerifyModelSlot` | machine | slot, 성공 call 참조 | slot 설정 seq·provider·model 일치 | `ModelSlotsChanged` | `conflict` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `ModelSlotsChanged` | 없음 | 설정 seq, 변경 slot, 설정 snapshot | shell/desktop, lophn-agent/harness/run-loop |

## 정책

- **slot 적용.** Run 시작에 두 slot을 고정한다. 역할별 override 및 자동 model·provider fallback 목록은 없다. user 변경은 다음 run부터다. organizing은 제목·요약·세션 압축에 사용한다. 역할별 일의 slot 선택은 → lophn-agent/roles.
- **호출 gate.** 빈 slot, 확인·user 명시 한계 없음, 필요한 text·tool 미지원, 입력·예약 출력·전체 창 초과면 call하지 않는다. 이름 미확인을 큰 한계나 tool 지원으로 대신하지 않는다.
- **catalog 우선순위.** models.dev release snapshot → 새 정상 갱신본 → 좁은 lophn 보정 → user 명시 보완. 명시된 필드만 덮는다.
- **catalog 갱신.** 마지막 확인 뒤 86400000ms마다 비동기 공개 GET; ETag 조건부 조회. user 새로 받기는 즉시. 세션·key·token·선택·계정은 보내지 않는다. auto_update false면 마지막 정상본만 쓴다.
- **catalog 검증.** 빈 목록·깨진 자료·양의 정수 아닌 알려진 token 한계·음수 가격은 전체 갱신 거절이다. 마지막 정상본, 없으면 release snapshot을 유지하며 실패·마지막 정상 수신 시각을 남긴다.
- **선택 보존.** catalog 누락·폐기 예정은 저장된 slot을 지우거나 이름을 바꾸지 않는다. provider 사용 불가에도 자동 model 대체는 없다.
- **reasoning.** named는 지원된 수준만 제공한다. budget은 low 2048·medium 8192·high 16384·maximum 32768 token을 확인 min/max로 clamp한다. toggle은 off/high만 제공한다. provider_default이며 보정된 기본값 없으면 추론 인자를 보내지 않는다. run 중 고정 수준을 높이지 않는다.
- **가격.** 현재 가격으로 과거 call 비용을 재계산하지 않는다. 계산·집계는 → lophn-agent/harness/usage.

## 정할 것

- catalog 밖 model은 확인된 정보 또는 user 명시 한계만으로 허용한다. user 보완값의 확인 UI·검증 책임 경계.
- reasoning 인자 및 불투명 필수 상태를 요구하는 provider mode의 실제 지원 범위와 메모리 유실 뒤 연속 호출 복구 가능성은 → lophn-agent/harness/provider의 same-run 상태 정책 안에서 정한다.
