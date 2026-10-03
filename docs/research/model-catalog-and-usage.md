---
type: research
concerns: [lophn-agent/harness/model, lophn-agent/harness/usage]
---
# Model catalog와 usage·비용

## 질문

catalog 출처·갱신·검증·보완, model 한계와 reasoning, 가격·cache·통화 계약을 어떻게 고정할 것인가?
실제 호출별 usage와 당시 비용을 누락·중복 없이 기록하고, 늦은 보고와 과거 재계산을 어떻게 분리할 것인가?
어떤 tokenizer·추정식과 fake catalog/provider 테스트를 가져오거나 버릴 것인가?

조사일은 2026-10-04다. 아래 사실은 고정 revision의 실제 소스에서 읽은 범위에 한정한다. `[확인]`은 코드 근거, `[추측]`은 설계 해석, `[미확인]`은 조사 범위에서 입증하지 못한 것이다. 경로 접두사의 clone root는 `/tmp/claude-1000/lophn-research/`다. wire별 usage 필드와 reasoning 인자 변환의 상세는 [provider adapters](provider-adapters.md)의 usage 표와 reasoning 부분을 사용하고, 여기서는 catalog 계약·가격·기록에 집중한다. 비교 프로젝트 테스트는 읽었지만 실행하지 않았다.

| 접두사 | 프로젝트 | revision |
|---|---|---|
| `opencode:` | OpenCode | `907b3bc518fa48e90e8ec24dd327d13eee71c36c` |
| `pi:` | Pi | `83692682f095528f8b71652ddacff7075e36e893` |
| `codex:` | Codex | `3a69ec3ef8fb87b41e99b8942af061ad58ae6732` |
| `hermes-agent:` | Hermes Agent | `343500b3547e12530457c2fda60ec687e25118b4` |
| `openclaw:` | OpenClaw | `37efa0b4a644b66a5987a07841e9707e1de2a7d8` |

## 프로젝트별

### OpenCode (`907b3bc518fa`)

**근거 자리**

- OC1: `opencode:packages/core/src/models-dev.ts`의 `Cost`, `Model`, `Provider`, `layer`, `fetchApi`, `fetchAndWrite`, `populate`, `refresh`(갱신은 160–258행).
- OC2: `opencode:packages/opencode/src/provider/provider.ts`의 `cost`, `fromModelsDevModel`, user config model overlay; `opencode:packages/opencode/src/provider/transform.ts`의 `reasoningVariants`(1717–1770행).
- OC3: `opencode:packages/opencode/src/session/session.ts`의 `getUsage`(337–405행); `opencode:packages/opencode/src/session/processor.ts`의 `step-finish`(435–470행); `opencode:packages/core/src/session/projector.ts`의 `applyUsage`.
- OC4: `opencode:packages/core/src/util/token.ts`의 `estimate`; `opencode:packages/opencode/test/session/session.test.ts`의 step-finish token propagation 테스트.

**Catalog·검증**

- [확인] 기본 source는 `https://models.opencode.ai/api.json`, URL/PATH override와 source별 cache가 있다. disk→injected snapshot→fetch, off+자료 없음은 `{}`. mtime freshness **5분**, 즉시 background 후 **60분** 간격, timeout **10초**, retry **2회/200ms exponential+jitter**. conditional GET은 없다. Flock 안에서 freshness를 재검사한다. (OC1)
- [확인] temp→rename은 **JSON/schema 검증 전 raw text 교체**다. refresh fetch 실패는 log/ignore, disk JSON 실패는 기본 cache를 제거할 수 있다. `Schema.Finite` 정의만으로 실제 ingestion 검증을 입증할 수 없으며 positive integer/nonnegative까지의 제약도 아니다. (OC1)

**Model·reasoning·가격**

- [확인] providerID+id, 세 limit·media·reasoning·alpha/beta/deprecated가 있다. missing tool_call→true, user context/output→0, rate→0. user fieldwise overlay는 있으나 unknown 계약에 맞지 않는다. (OC2)
- [확인] reasoning_options는 effort/toggle/budget이며 effort 우선, null→none, `default` 문자열을 배제하지 않는다. budget max는 catalog/output−1/자체 상한−1의 최소, high는 그 절반을 clamp한다. metadata 없으면 fallback variants다. 네 고정 budget과 다르다. (OC2)
- [확인] 네 rate와 whole-request tier. SDK v6 input은 Anthropic도 cache 포함이라 두 cache를 뺀다. output−reasoning과 reasoning을 같은 output rate로 계산하므로 중복은 아니다; 별도 reasoning rate는 TODO. tier는 전체 inputTokens strict `>T`. Decimal.js→`.toNumber()`, missing/nonfinite/negative usage→0. (OC3)
- [확인] Copilot metadata의 유효한 `totalNanoAiu`는 Decimal로 `100_000_000_000`으로 나누어 scalar cost로 반영한다. 이를 다섯 비용 종류의 구분으로 확대 해석하면 안 된다. (OC3)

**기록·추정·테스트**

- [확인] step-finish missing usage→빈 Usage, assistant cost 증가, tokens/cost를 part/message에 저장한다. projector는 이를 session totals에 add/subtract한다. message/event 기반이지 transport retry별 durable start 증거는 아니다. (OC3)
- [확인] token estimate는 JavaScript `input.length / 4`를 반올림한다. UTF-8 bytes 상한이 아니며 짧은 비어 있지 않은 문자열도 0이 될 수 있다. step-finish propagation 테스트는 저장된 reasoning/cache/cost 전달을 확인한다. (OC4)
- [미확인] 실패·취소의 모든 실제 시도, 늦은 usage supplement, price basis의 영구 snapshot, 별도 currency 및 confirmed-free 분류 전체는 확인하지 못했다.

### Pi (`83692682f095`)

**근거 자리**

- PI1: `pi:packages/ai/scripts/generate-models.ts`의 `loadModelsDevData`, `getModelsDevCost` 및 가격 patch; `pi:packages/ai/scripts/model-data.ts`의 generated model validation; `pi:packages/ai/src/models.generated.ts`의 생성 catalog aggregator.
- PI2: `pi:packages/ai/src/models.ts`의 `createProvider`, `publishProviderModels`, `calculateCost`, thinking level 처리; `pi:packages/ai/src/models-store.ts`의 `ModelsStoreEntry`, `InMemoryModelsStore`; `pi:packages/ai/src/model-catalog.ts`의 `flattenModelCatalog`, `modelsAreEqual`.
- PI3: `pi:packages/ai/src/types.ts`의 `Usage`, `ModelCostRates`, `ModelCostTier`, chat Model; `pi:packages/ai/scripts/models-dev-reasoning-options.ts`의 `getEffortThinkingLevelMap`; `pi:packages/ai/src/api/simple-options.ts`의 `DEFAULT_THINKING_BUDGETS`.
- PI4: `pi:packages/coding-agent/src/core/provider-composer.ts`의 `modelFromJson`; `pi:packages/ai/src/api/anthropic-messages.ts`의 stream usage 처리; `pi:packages/coding-agent/src/core/agent-session.ts`의 `getSessionStats`, `getContextUsage`.
- PI5: `pi:packages/coding-agent/src/core/compaction/compaction.ts`의 `estimateTokens`(298–349행); `pi:packages/ai/test/anthropic-cache-write-1h-cost.test.ts`의 fake Anthropic SSE 테스트(62–115행).

**Catalog·검증**

- [확인] release는 provider별 생성 `.models.ts` metadata다. generation은 models.dev/api.json+provider feed+수동 patch, 실패는 strict throw/non-strict `[]`. 일부 missing limit→4096/rate→0, tool-capable filter·alias 보정이 있다. OpenAI/Copilot 가격·metadata 보정과 Kimi Coding subscription zero→implied token rate 정책은 일반 무료 판정으로 복사하면 안 된다. (PI1)
- [확인] provider baseline+dynamic, 동일 type/id는 whole-row replacement다. offline restore 후 provider auth/network, generation과 publication queue로 오래된 결과를 막고 저장 전후 generation을 확인한다. fetch 실패는 이전 publication 유지, empty dynamic은 허용, freshness는 provider 소유다. (PI2)
- [확인] store는 checkedAt/lastModified/etag와 conditional 주석을 갖지만 모든 provider wire 구현 증거는 아니다. generated validation은 duplicate/empty reject, limit finite>0/cost finite다. limit integer와 price nonnegative는 읽은 검증에 없고 runtime remote 검증과도 별개다. (PI1–2)
- [미확인] generation CI 주기, 모든 provider의 TTL·304 구현, raw models.dev 전체 응답을 한 번에 거절하는 runtime 계약은 확인하지 못했다.

**Model·reasoning·가격**

- [확인] type/provider/id; contextWindow/maxTokens, text/image input, reasoning/map, cache/compat를 가진다. 독립 input limit/output media/status 전부는 아니다. custom JSON은 limit≤0 reject, missing은 context128000/max16384/text/reasoning false/cost0다. (PI2–4)
- [확인] off/minimal/low/medium/high/xhigh/max; effort default/null은 mapping 제외. unsupported clamp가 높은 level을 먼저 고를 수 있다. budget minimal1024/low2048/medium8192/high16384, xhigh/max도 high, answer room1024다. maximum32768 정책은 아니다. (PI2–3)
- [확인] USD/1M 네 number rates, whole-request input+cache tier. output subset reasoning은 추가 안 한다. cacheWrite1h는 write subset, long=input rate×2/short=나머지. 독립 reasoning rate/다중 currency는 읽은 type에 없다. (PI2–3)

**기록·추정·테스트**

- [확인] Anthropic은 initial usage0, message_start에서 model/id·usage/cache1h와 cost, delta에서 갱신, catch는 aborted/error partial output을 emit한다. 취소 전 known usage를 보존할 수 있지만 missing0이며 durable 저장과 다르다. response fallback model에 따라 pricing model도 바뀔 수 있다. (PI4)
- [확인] compaction의 `estimateTokens`는 text/thinking/tool name·arguments 등을 chars로 합쳐 `ceil(chars/4)`한다. 주석은 conservative라 부르지만 이것은 lophn R14의 보수 byte 상한 보장이 아니다. fake SSE 테스트는 600k short write×6.25 +400k 1h write×10 = **7.75**, 1h breakdown이 message_delta에만 오는 경우, breakdown이 없으면 5m 계산을 확인한다. (PI5)
- [미확인] 모든 retry/실패를 독립 저장하는 durable call 기록과 완료 후 append supplement, 과거 price basis 고정은 확인하지 못했다.

### Codex (`3a69ec3ef8fb`)

**근거 자리**

- CX1: `codex:codex-rs/models-manager/src/cache.rs`의 `ModelsCacheEntry`, `FileModelsCache`, `refresh_ttl`; `codex:codex-rs/models-manager/src/manager.rs`의 refresh 경로(545–650행), bundled models loader; `codex:codex-rs/codex-api/src/endpoint/models.rs`의 `list_models`(60–123행).
- CX2: `codex:codex-rs/models-manager/src/model_info.rs`의 `with_config_overrides`, `model_info_from_slug`; `codex:codex-rs/protocol/src/openai_models.rs`의 `ModelInfo`, `resolved_context_window`, `usable_context_window`.
- CX3: `codex:codex-rs/protocol/src/protocol.rs`의 `TokenUsage`, `TokenUsageRecord`, `TokenUsageInfo`, `TokenCountEvent`(2250–2465행); `codex:codex-rs/core/src/state/session.rs`의 `record_token_usage`(205–303행); `codex:codex-rs/codex-api/src/rate_limits.rs`의 header parsing.
- CX4: `codex:codex-rs/utils/string/src/truncate.rs`의 `approx_token_count`(95–116행); `codex:codex-rs/models-manager/src/manager_tests.rs`의 `file_cache_implements_models_cache_contract`, `file_cache_refresh_ttl_renews_expired_entry_without_serving_it_stale`(355–438행).

**Catalog·한계**

- [확인] bundled/cache/인증 `/models`, TTL300초, client version/provider·tenant identity와 auth 변경을 확인한다. Offline/OnlineIfUncached/Online과 discovery gate가 있다. explicit provider 실패는 remote/etag clear와 persistent timestamp invalidate라 universal last-good이 아니다. (CX1)
- [확인] endpoint는 ETag를 반환하지만 GET에 If-None-Match는 없다. 별도 관측 ETag가 같으면 refresh_if_new_etag는 TTL 갱신, 다르면 fetch. serde decode/일반 fs write만으로 atomic·전체 semantic validation을 입증하지 못한다. (CX1)
- [확인] default/supported reasoning, context/max/effective%, input/tool 정책이 있다. config context는 max로 clamp. unknown slug는272000/95%와 기능을 가정하며 fallback flag를 붙인다. lophn에는 가정 전송 대신 explicit verification이 필요하다. (CX2)
- [미확인] 읽은 manager에서 models.dev 사용, 범용 가격 card와 별도 input/output/reasoning rate, preview/deprecated 전부, 전체 bundle invalid-limit 거절 정책은 확인하지 못했다.

**Usage·추정·테스트**

- [확인] i64 input/cached/write/output/reasoning/total, 일부 absent0; info+last 모두 없으면 None. record는 thread/turn/session/root-turn/response id와 turn/thread totals. turn reset/thread 누적, reasoning 재합산 없음. (CX3)
- [확인] non_cached_input은 write를 빼지 않아 disjoint 과금용이 아니다. fill_to_context_window는 합성 context 표시이지 billed usage가 아니다. quota/credits headers도 call cost와 별개다. (CX3)
- [확인] `approx_token_count`는 Rust 문자열 UTF-8 byte 길이를 **4**로 나눈 올림이다. chars/4보다는 다국어 길이를 반영하지만 byte 수 자체의 상한은 아니다. cache 테스트는 model metadata round-trip과 expired entry를 revalidate 전 제공하지 않는 계약을 직접 확인한다. (CX4)
- [미확인] response 완료에서 이 record로 오는 모든 error/cancel/late usage 경로, per-attempt durable start, price snapshot과 immutable 금액 계산은 확인하지 못했다. account spend/credit 필드가 있다는 이유만으로 범용 token 비용 estimator가 있다고 보지 않는다.

### Hermes Agent (`343500b3547e`)

**근거 자리**

- HM1: `hermes-agent:agent/models_dev.py`의 `ModelInfo`, `ModelCapabilities`, `_validate_registry`, conditional fetch/commit, `_refresh_locked`, `_override_int`, `_parse_model_info`.
- HM2: `hermes-agent:agent/model_metadata.py`의 context resolver와 `estimate_tokens_rough`(2370–2400행).
- HM3: `hermes-agent:agent/usage_pricing.py`의 `CanonicalUsage`, `CostStatus`, `PricingEntry`, usage normalization, route pricing과 cost estimation(1–260, 530–760행).
- HM4: `hermes-agent:agent/aux_accounting.py`의 `record_aux_usage`; `hermes-agent:hermes_state.py`의 queued usage deltas; `hermes-agent:hermes_state_usage.py`의 `update_token_counts`, `_record_model_usage`(273–390행).
- HM5: `hermes-agent:agent/credits_tracker.py`의 micros parsing; `hermes-agent:agent/billing_usage.py`의 account balance; `hermes-agent:agent/account_usage.py`의 `_codex_window_labels`, `_fetch_codex_account_usage`.
- HM6: `hermes-agent:tests/agent/test_models_dev.py`의 stale/background/backoff 테스트(150–207행); `hermes-agent:tests/agent/test_usage_pricing.py`의 Decimal와 context tier 테스트.

**Catalog·검증·override**

- [확인] TTL4h/실패 backoff300초. stale memory/disk를 바로 제공하고 background 한 thread; no-cache만 foreground다. corrupt/empty disk quarantine, servable cache 없으면 ETag clear, 있을 때 conditional GET. connect5초/read10초. 304는 held cache freshness만 갱신, no-cache304 거절, 실패는 cache 유지. (HM1)
- [확인] validate는 nonempty dict만; 개별 값은 commit 뒤 lookup에서 실패할 수 있다. missing context/output/input·output price→0, cache price optional. has_cost_data는 input>0 또는 output>0라 all-zero free와 unavailable이 섞인다. (HM1)
- [확인] explicit override 우선/_default는 catalog miss만. override int(raw)>0, invalid warning/ignore라 strict 원문 integer 검증이 아니다. openai-codex→openai/xai-oauth→xai alias와 custom catalog_provider. 최종 context fallback256K, capabilities default tools=true/context200000. (HM1–2)
- [미확인] 조사한 runtime 파일에 release bundled models.dev catalog는 찾지 못했다. runtime fetch/cache와 아래 별도 공식 가격 snapshot은 서로 다른 자료다. reasoning effort/budget/default의 완전한 catalog 계약도 이 범위에서 확인하지 못했다.

**가격·사용량·비용**

- [확인] optional Decimal/source/version/time·whole-request tier. provider reported hook→subscription→OpenRouter live→공식 snapshot→endpoint→models.dev 경로. direct models.dev는 first-party HTTPS443만 허용하여 proxy가 vendor rate를 자동 상속하지 않는다. (HM3)
- [확인] native Anthropic input=new, Codex/Chat는 두 cache 제외; total=new+cache+output, reasoning subset. absent raw usage→0. nonzero rate missing은 unknown/zero bucket skip. Decimal token×rate/1M와 request rate, reasoning 추가 없음. subscription0은 included, CostStatus actual/estimated/included/unknown 네 종류. (HM3)
- [확인] snapshot string→Decimal이나 models.dev float→Decimal은 원래 정확성을 회복 못 한다. fetched_at을 lookup now로 붙이는 경로도 있다. aux/session 저장은 float라 end-to-end decimal이 아니다. (HM3–4)

**기록·합계·추정·테스트**

- [확인] ContextVar로 aux session 전달, title/compression 귀속; 이미 main에 합친 moa tasks 제외. allzero skip/저장 실패 log-only. single-writer queue는 같은 route만 coalesce, model/provider/baseURL/billing/task·source/version/status 유지. durable start gate는 아니다. (HM4)
- [확인] CLI delta/gateway absolute를 구별, 모델 분배는 incremental만. session/model/task aggregate와 missing or0이지 immutable call/price basis가 아니다. (HM4)
- [확인] rough tokenizer는 ASCII ceil(bytes/4), CJK/Hangul/Kana 한 codepoint≈1, 나머지는 ceil(UTF-8 bytes/4)다. 소스 주석의 calibration 비율에는 **1보다 작은 값**도 있으므로 보수 상한으로 보장할 수 없다. stale catalog 테스트는 foreground network 없이 stale disk 반환·background kick, refresh 실패 backoff를 확인한다. 가격 테스트는 cache write까지 포함한 >272K whole-request tier와 Decimal 기대값을 확인한다. (HM2, HM6)
- [미확인] 완료된 호출에 실제 invoice를 append하여 최초 추정을 보존하는 reconciliation 경로는 찾지 못했다. “나중 확인 전 estimate”라는 note만으로 이를 구현했다고 말하지 않는다.

### OpenClaw (`37efa0b4a644`)

**근거 자리**

- CL1: `openclaw:src/model-catalog/remote-refresh.ts`의 `refreshRemoteModelCatalog`(22–198행); `openclaw:src/model-catalog/remote-bundle.ts`의 `parseRemoteModelCatalogWireBundle`, `projectRemoteModelCatalog`; `openclaw:packages/model-catalog-core/src/remote-catalog-bundle.ts`의 bundle schemas, `parseRemoteModelCatalogBundleV2`, transport sanitization(12–317행).
- CL2: `openclaw:packages/model-catalog-core/src/model-catalog-pricing.ts`의 price source constants, `normalizeModelPricingCatalog`, `readPricingCost`; `openclaw:src/agents/model-catalog.ts`의 prepared catalog, configured overlay와 route identity; `openclaw:src/agents/model-selection-shared.ts`의 `buildConfiguredModelCatalog`(1160–1240행).
- CL3: `openclaw:src/agents/sessions/model-registry-schema.ts`의 `ModelDefinitionSchema`, `ThinkingLevelMapSchema`; `openclaw:packages/llm-core/src/usage-cost.ts`의 `normalizeResolvedPricing`, `normalizeTieredPricing`와 token cost 계산.
- CL4: `openclaw:src/infra/session-cost-usage-pricing.ts`의 transcript parser, `needsUsageCostEstimate`, `applyUsageCostEstimate`; `openclaw:src/model-catalog/remote-refresh.test.ts`의 disabled/TTL/force/v1/v2/rollback/error 테스트(35–197행).

**Catalog·검증**

- [확인] 자체 bundled+remote, 기본 catalog.openclaw.ai/models/v2/catalog.json. TTL6h/timeout15초/body4MiB/fatal UTF8. 동일 source에 conditional ETag+LastModified, off fetch0/force TTL 우회. no-cache304 거절/valid304 expected-row 체크,200 schema/minVersion 검증 후 저장, newer generatedAt 보존. HTTPS/SSRF guard, explicit loopback만 HTTP. (CL1·4)
- [확인] V2 empty models/미선언 provider/duplicate/reference 오류는 전체 거절, rate finite nonnegative, known은 rate≥1/USD/million_tokens, unknown/unavailable 보존. contextWindow/maxTokens positive finite(integer 아님), contextTokens/options integer. tier range finite/nonnegative만으로 구간 연속성은 입증 안 됨. V1 top providers nonempty는 미검증. (CL1)
- [확인] remote transport 제거/withdrawn row stale price 차단. registry→plugin→live→configured, replace mode. route key는 provider/model+api+normalized baseURL로 sibling capability 공유 금지. (CL1–2)

**가격·한계·기록**

- [확인] publication은 models.opencode.ai/api.json+provider feeds. authoritative와 modelsDev→OpenRouter→LiteLLM 우선순위를 구별. price feed malformed/duplicate 전체 무효, absent row skip/unsupported qualifier 미공개, valid0개 undefined. missing cache rate는0. (CL2)
- [확인] publication size positive safe integer/duplicate·bad rate invalid, modern tier 우선. runtime은 invalid skip/gap·overflow nearest tier, input+cache whole-request number 계산/1h write input×2. 이 보정·float·missing0는 복사 금지. (CL2–3)
- [확인] local schema limit/cost 일반 Number, 일곱 thinking map. configured builder invalid context→undefined skip. remote bundle 검증과 local 관용 처리를 구별한다. 전체 model default는 미확인. (CL2–3)
- [확인] transcript provider/model/outcome/time/usage와 valid stored cost 우선. missing cost는 조회 시 current resolveCost로 추정해 과거 derived cost가 변할 수 있다. token unknown 합계0, missing cost count 별도. R9에 그대로 맞지 않는다. (CL4)
- [확인] remote refresh 테스트는 fake fetch/clock/temporary database로 network-off, TTL, force, 304, V1 mirror transport 제거, V2 inline 가격, source 변경, rollback, invalid JSON/minVersion/timeout을 확인한다. (CL4)
- [미확인] 모든 실패·취소 transport 시도의 durable call record, 완료 후 late usage append, 독립 reasoning price와 tokenizer의 전체 구현은 확인하지 못했다.

## 비교

프로젝트 칸은 위 근거 ID에 연결된다. `미확인`은 기능이 없다는 판정이 아니다.

| lophn 규칙 | OpenCode | Pi | Codex | Hermes | OpenClaw |
|---|---|---|---|---|---|
| model#R1 provider+model, 직접/relay 분리 | providerID+id (OC2) | type/provider/id (PI2) | scoped catalog (CX1) | alias capability 공유, billing route 분리 (HM1·3) | provider/model+api/baseURL route 격리 (CL2) |
| R3 snapshot→refresh→patch→user | disk→snapshot→fetch+overlay | generated+dynamic row replacement+custom | bundled/cache/endpoint+config | memory/disk/remote+override/default | bundled/remote+plugin/live/config |
| R4 24h·ETag | 5m freshness/60m timer, conditional 없음 | provider-owned, store ETag만 확인 | 5m, 별도 ETag 관측; conditional 아님 | 4h·conditional·stale background | 6h·conditional·force |
| R5 malformed 전체 거절·last-good | raw write before validation (OC1) | build 검증/runtime empty 허용 | serde; explicit failure invalidate | top nonempty dict만 | V2 empty/duplicate/rate reject before store; 일부 limit noninteger |
| R7 missing unknown·USD/1M·reasoning rate | missing0·reasoning output rate | missing0·네 rate | generic price 미확인 | optional Decimal rate; catalog missing0 함정 | V2 unknown; runtime missing0 함정 |
| R13 unknown 모델 explicit limit/tools | 0/tools=true fallback | 128000/16384/text | 272000/95% 기능 가정 | 256K/tools=true | 전체 default 미확인 |
| R15–17 일곱 level·maximum32768 | dynamic effort/budget | 일곱 level, budget max16384 | supported/default; budget 미확인 | 전체 catalog reasoning 미확인 | 일곱 map, budget 미확인 |
| usage#R6 missing null | missing0 | missing0/partial error 보존 | info None/일부 count0 | missing0/allzero aux skip | unknown token 합계0+missing cost count |
| R7 비용 다섯 종류 | scalar cost | numeric buckets | 범용 계산 미확인 | actual/estimated/included/unknown 네 종류 | stored/estimate/missing, 다섯 구분 미확인 |
| R8 decimal 끝까지 | Decimal→number | number | 미확인 | Decimal→float 저장 | number |
| R1–4 attempt별 durable start/basis | step/message | assistant/aux | response/turn/thread | session/model/task deltas, best effort | transcript-derived |
| R9 과거 비용 불변·supplement | 미확인 | 미확인 | 미확인 | aggregate source/version; supplement 미확인 | 과거 missing을 current price로 추정 |
| model#R14 exact 없으면 bytes 상한 | round(JS chars/4) | ceil(JS chars/4) | ceil(UTF-8 bytes/4) | CJK≈1+나머지 bytes/4 | 전체 tokenizer 미확인 |

[확인] tier는 대체로 input+cache를 기준으로 요청 전체에 요율을 적용한다. OpenCode/Pi는 strict `> T`, OpenClaw는 half-open range다. `>200000`을 `[200000,∞)`로 바꾸면 1 token 경계가 틀린다. native Anthropic과 SDK-normalized input도 서로 다르므로 provider 이름만 보고 cache를 빼면 안 된다. (OC3, PI2–5, HM3, CL2–3)

## lophn에 가져올 것과 버릴 것

### Catalog와 model 선택

- **model#R1–R3:** provider/model key는 그대로 보존하고 provider alias·relay 이름에서 직접 vendor 계약을 암묵적으로 상속하지 않는다. 가져올 것은 OpenClaw route-specific metadata 격리와 Hermes billing route 확인이다. release snapshot·accepted catalog·좁은 patch·user 보완을 별도 자료로 유지하고 **필드마다 source/revision**을 resolve 결과에 남긴다. Pi의 whole-model dynamic replacement와 user override의 무명 defaults는 버린다. (PI2, HM3, CL2)
- **model#R4–R6:** Hermes stale nonblocking/single-flight, OpenCode lock 안 freshness 재검사, Pi generation-checked publication, OpenClaw validate-before-store/304 guard/source scope를 조합한다. TTL은 요구대로 **86400000ms**이며 비교 프로젝트 숫자를 복사하지 않는다. 모델·provider·price는 한 accepted response에서 함께 교체한다. fetch failure/invalid payload는 last-good·ETag·성공 checked/received 시각을 그대로 두고 safe failure만 별도로 남긴다. raw text를 검증 전에 교체하는 OC1은 버린다.
- **model#R2, R7:** unknown과 explicit false/0을 타입부터 분리한다. known limit은 positive integer, known rate는 decimal string finite/nonnegative, currency/unit와 context/cache TTL 구간을 검증한다. remote catalog는 transport/auth 설정을 바꾸지 못하게 한다. missing cache price를 0으로 채우는 OC2/PI1/CL2는 버린다. confirmed zero-price는 source와 route가 확인됐을 때만 free다.
- **model#R8–R12, R20:** 공통 judgment/organizing은 새 preset 복사용이며 최초 null을 유지한다. catalog refresh, deprecated, provider 목록 변경이 저장 선택이나 이미 시작한 run을 바꾸지 않게 resolver와 저장 선택을 분리한다. provider 목록 확인 실패를 unverified로 보존하고 첫 성공에 verify한다. text/tools 미지원·limit 초과는 전송 전에 막되 다른 model/organizing으로 fallback하지 않는다. 위 프로젝트의 자동 fallback은 요구 충족 근거로 삼지 않는다.
- **model#R13–R14, R19:** catalog 밖 모델은 사람이 context/input/output/text/tools를 확인해야 쓸 수 있게 한다. 4096/128000/16384/272000/256K/tools=true 가정은 모두 버린다. 첫 판 text-only이며 exact tokenizer 없으면 text UTF-8 **byte 수 자체**를 보수 token 상한으로 사용한다. image당 고정 추정이나 chars/4를 permission/preflight 경계로 사용하지 않는다. prompt body뿐 아니라 실제 assembly의 system/tools/role framing까지 추정 대상과 known overhead를 분리해야 한다.
- **model#R15–R18:** level 순서는 off/minimal/low/medium/high/very_high/maximum, provider_default는 순서 밖이다. named는 verified levels만 선택하고 Pi처럼 `default`/null을 effort level에서 배제한다. budget low=2048, medium=8192, high=16384, maximum=32768을 verified min/max로 clamp한다. toggle은 off/high다. answer/output 상한과 budget의 관계도 검증하고 requested/applied를 함께 기록한다. Pi의 상향 clamp와 max→high16384, OpenCode의 output-derived high/max는 복사하지 않는다. run 시작값을 고정하며 요청이 preset 상한을 높이지 못하게 한다. (OC2, PI2–PI3)

### 호출 기록과 비용

- **usage#R1–R4:** message/session aggregate가 아니라 실제 attempt별 `ModelCall`을 먼저 durable 저장한다. 이 단계 실패면 provider 전송 0개다. retry·credential 이동·summary·title·test는 각기 새 call id를 가진다. blob redaction과 catalog/assembly/limit/reasoning snapshot이 선행한다. 오류는 safe class/status/code만 기록하고 body는 저장하지 않는다. Hermes aux attribution·coalesce key는 참고하되 best-effort skip과 aggregate-only persistence는 버린다. (OC3, PI4, CX3, HM4, CL4)
- **usage#R5–R6:** nullable reported counters와 inclusion flags를 정규화 계약으로 고정한다. missing·0·estimate를 합치지 않는다. 실패·취소도 이미 받은 usage를 저장한다. 비교 가능한 input/cache만 disjoint로 바꾸며 불가능하면 별도 표시한다. reasoning output subset은 합계에 다시 더하지 않는다. negative/inconsistent usage를 조용히 0으로 고치는 기존 패턴 대신 safe anomaly와 unknown 근거를 남기는 것을 추천한다. (OC3, PI4, HM3)
- **usage#R7–R8:** reported/estimated/subscription/free/unknown은 금액과 별도 discriminant다. provider reported actual과 token rate estimate, subscription included를 구분하는 Hermes를 가져오되 free를 추가하고 missing0 판정을 제거한다. 계정 balance/quota는 호출 비용과 분리한다. **decimal 문자열→decimal 계산→decimal 문자열 저장**으로 끝까지 유지한다. zero usage라도 보고된 0인지 확인해야 한다. pricing route/model/context range/cache TTL을 선택한 뒤에 곱하고, 임의 invoice 추정·환산·구독료 배분은 하지 않는다. (HM3–HM5)
- **usage#R9:** run/call price basis를 불변 snapshot으로 고정한다. 최초 completed 기록은 덮지 않고 late usage/invoice/명시 재계산을 `model_call_supplements`에 append한다. OpenClaw current-price historical missing estimate는 버린다. supplement가 terminal run을 재개하지 않도록 usage 보완 경로를 실행 상태와 분리한다. (CL4; lophn usage domain model)
- **usage#R10–R11:** 원본 distinct call에서 합계를 derive하고 supplement를 새 attempt로 세지 않는다. role/model/account/currency/billing route/purpose/model_use를 따로 보존한다. Hermes의 aux double-count 제외와 delta/absolute 구분을 fixture로 가져온다. unknown usage·cost·기록 누락 수를 숫자 0 합계 옆에 반드시 표시하고 eval replay는 실제 지출에서 제외한다. monetary gate는 추가하지 않는다. (HM4)

### open-issues 후보

아래는 요구를 바꾸지 않고 구현 전에 의미를 확정할 후보다. `open-issues.md`는 이 조사에서 수정하지 않는다.

1. **model#R7, usage#R8 — context 가격 구간의 기준.** 비교 estimator는 prompt/input+cache를 사용한다. lophn의 “문맥 구간”이 input만인지 reserved output까지 포함한 context인지 현재 문장만으로 오해할 수 있다. **추천:** price basis에 provider tariff의 `tier_basis`와 strict/inclusive 경계를 명시하고 verified 기준이 없으면 unknown. limit preflight의 context 기준과 가격 기준을 공유하지 않는다.
2. **model#R7, usage#R5·R8 — 별도 reasoning rate.** model은 별도 reasoning 요율을 허용하지만 usage R8의 계산 문장은 네 buckets를 열거한다. **추천:** reasoning이 output subset이고 별도 요율이면 output−reasoning과 reasoning을 disjoint로 과금할지, provider가 별도 청구 usage를 보고하는지 계약을 명시한다. 둘 다 더한 뒤 output 전체까지 과금하지 않는다.
3. **model#R5 — raw catalog 한 항목 오류의 전체 거절.** 비교 코드 상당수는 permissive 변환/row skip을 쓴다. lophn의 strict whole-catalog rejection은 장기 freeze 가능성이 있다. **추천:** 요구는 유지하되 release snapshot에 대한 사전 전체 검증, last-good, safe 실패 표시, 좁은 patch와 fixture를 준비한다. 운영 편의를 위해 malformed row를 silently drop하지 않는다.
4. **model#R10·R13 — provider model 목록과 public catalog 밖 모델.** 목록 밖 이름 저장 거절과 catalog 밖 모델의 explicit 보완을 같은 “목록”으로 구현하면 충돌한다. **추천:** authoritative provider name list와 public capability catalog를 별도 자료로 정의하고, 전자는 이름 verification, 후자는 limit/capability verification에 사용한다.
5. **usage#R8 — zero bucket의 missing rate.** Hermes는 reported token=0이면 누락 rate를 건너뛴다. **추천:** 다른 필수 basis가 모두 알려지고 해당 reported bucket이 명시적 0이면 rate 없이 비용 0으로 처리할 수 있다고 명시한다. usage null은 0 bucket으로 취급하지 않는다. 최종 free 판정은 route 계약의 확인과 별개다.
6. **model#R4·R5 — 304·실패 시각.** 304는 새 payload가 아니지만 정상 확인이다. **추천:** valid 304는 checked_at만 갱신, received_at은 유지. invalid 200/timeout은 둘 다 유지하고 attempt/failure 시각은 별도로 기록한다. failure backoff가 성공 TTL을 늘리면 안 된다.

## 구현 메모

### 선행 계약과 상태

[추측/추천] 세 갈래로 나누되 contracts를 먼저 고정한다.

1. **Catalog ingestion:** 공개 bounded fetch→decode/parse→전체 semantic validation→accepted store. release/last-good/ETag/24h/concurrency를 맡고 credential·session·model 선택을 request에 넘기지 않는다.
2. **Resolver:** identity·필드별 provenance·verified reasoning/default·price basis를 묶은 immutable `ResolvedModel`. catalog와 저장 선택, 이미 시작한 run을 분리한다.
3. **Call accounting:** durable started→실제 provider attempt→finished. nullable usage·decimal cost·basis·supplement·distinct aggregates를 맡는다. adapter는 inclusion definition을 전달하며 ledger 저장을 대신하지 않는다.

lophn domain model의 CatalogEntry/ReasoningSupport/PriceBasis/PriceRate/ResolvedModel/CatalogState와 ModelCall/TokenUsage/CallCost/model_call_supplements를 사용한다. 새 tariff basis·cache breakdown 필드는 open-issues를 확정한 뒤 contracts에 반영한다.

| 값 | 표현 |
|---|---|
| TTL/auto | 86400000ms/기본 true; force도 validation/privacy 우회 안 함 |
| limit/tools/media/reasoning/default/rate absent | null/unknown; 사용 가능으로 가정하지 않음 |
| 무료 | decimal `"0"` + confirmed source/billing route |
| budget | 2048/8192/16384/32768, verified min/max clamp |
| provider_default | verified default 없으면 인자 생략 |
| usage/TTFT 미보고·미측정 | null; 추정·0과 구별 |
| amount | decimal string; currency별 합계; float/자동 환산 금지 |
| source 시간 | revision/hash·checked_at/received_at; lookup now로 대체 금지 |

refresh는 stale accepted 자료를 바로 제공하며 due+auto-on일 때만 single-flight background로 돈다. 200은 전체 검증 후 catalog/provider/price/ETag를 한 transaction 또는 atomic replacement로 publish하며 generation/expected revision을 검사한다. 304는 같은 source의 servable body가 있어야 하고 checked_at만 갱신한다. network/parse/validation/store 실패는 last-good·ETag·성공 시각을 보존하며 실패 시각/backoff는 별도다. timeout/body cap/retry 숫자는 요구에 없는 정책값이므로 비교 코드의 10–15초/4MiB를 그대로 확정하지 않는다.

### 계산과 실패

- inclusion이 확인된 경우에만 new_input+cache_read+cache_write+output을 total로 만든다. reasoning output subset은 다시 더하지 않는다. raw provider total/derived total 이름과 normalization definition revision을 구별한다.
- verified tariff basis에서 tier/TTL을 선택한 뒤 decimal `sum(tokens×rate/1000000)`을 계산한다. context preflight 기준과 tariff 기준을 공유하지 않고 gap/overflow를 nearest tier로 메우지 않는다. 필요한 nonzero bucket의 rate/usage가 없으면 unknown이다.
- start 저장 실패면 전송0, 저장 후 crash면 started-only/전송 여부 unknown이다. 실패·취소의 reported usage는 보존한다. safe 오류 종류/status/code만 기록하고 body는 기록하지 않는다.
- completed price를 current catalog로 resolve하지 않는다. late usage/invoice/명시 재계산은 idempotent append supplement이며 call count를 늘리거나 terminal run을 재개하지 않는다.
- distinct call에서 run/session/role/period/model/account/currency별 합계를 derive한다. original/sent/response model, credential revision, billing route, purpose/model_use, handoff 수신 귀속을 유지한다. account quota는 별도이며 unknown·누락 수를 함께 표시한다.

### 테스트 경계

테스트 이름은 요구 번호로 시작한다. 실제 유료 호출 없이 fake clock/network/SSE와 temporary store를 사용한다.

| 요구 | fixture·확인 |
|---|---|
| model#R1·R3 | 같은 모델명 direct/relay의 서로 다른 limit/rate/reasoning, patch/user 필드별 override와 provenance, 과거 snapshot |
| model#R4–6 | 24h−1ms/24h, 동시 single-flight/old generation, force/off fetch0, 비밀 없는 request, source 변경 시 old ETag 금지, 200→304 checked만 증가, cache 없는304 |
| model#R5 | empty/duplicate/truncated JSON·UTF8, limit0/음수/fraction/NaN/Infinity, rate 음수/잘못된 decimal·unit·currency, tier overlap/gap; 전체 거절 후 hash/ETag/성공 시각 불변 |
| model#R7 | missing vs0·부분 가격, T−1/T/T+1 strict 경계, 5m/1h/unknown TTL, 지원 안 하는 qualifier 단순화 금지 |
| model#R8–13·R20 | common 초기 null/새 preset 복사만, run·선택 불변, unverified→verified, catalog 밖 세 limit/text/tools 없으면 전송0, deprecated 자동 변경/fallback0 |
| model#R14·R19 | ASCII/CJK/emoji/combining/tools와 byte 상한, exact tokenizer, nontext unknown 전송0, input/reserve/context 세 한계 각각 초과 |
| model#R15–18 | named default/null 제외, 상향 clamp0, provider_default omission, 네 budget/min/max, toggle, run 중 설정 불변 |
| usage#R1–4 | 실제 success/error/cancel/retry/credential 이동/summary/test=각 call, start 저장 실패 fetch0, crash, redacted blobs·safe code·모델3종·requested/applied |
| usage#R5·R6 | native/SDK input 포함 관계, inconsistent cache, reasoning subset, missing/null vs reported0, 취소 뒤 usage, final delta에만 cache1h, completed 뒤 late usage |
| usage#R7·R8 | 다섯 kind, actual/estimate/구독 분리, Decimal0.1·작은 양수·큰 count/float 왕복0, 600k short+400k long=7.75, nonzero rate missing unknown |
| usage#R9 | 가격 갱신 뒤 과거 amount/basis 불변, invoice/recalc/late append, supplement idempotency, terminal 유지 |
| usage#R10·R11 | aux/main 중복0·delta/absolute, 모든 합계 key, handoff 수신 귀속·eval replay 제외·unknown/누락 count, monetary gate0 |

[미확인] 전체 tokenizer, Pi generation cadence/모든 provider ETag wire, Codex 모든 error/cancel 연결, OpenCode price basis 저장, 프로젝트별 완료 후 reconciliation과 모든 attempt durability는 후속 범위다. 기존 aggregate/message 구현만으로 lophn의 엄격한 계약을 대체하지 않는다.
