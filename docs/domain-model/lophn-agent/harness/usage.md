---
type: domain-model
concerns: [lophn-agent/harness/usage]
---
# lophn-agent/harness/usage

ModelCall의 실제 시도·입출력·사용량·당시 비용과 중복 없는 합계를 정의한다.

## ModelCall (`mcl`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `mcl` ID | 아니오 | PK; 실제 전송 시도마다 별도 ID | 시도 |
| `run` | `run` ID | 예 | 판단·run 안 정리에는 필수; → lophn-agent/harness/run-loop | 원인 run |
| `session` | `ses` ID | 예 | run에 있으면 같은 session; 독립 이어가기에는 필수; → lophn-agent/conversation | 관련 세션 |
| `model_use` | `judgment / organizing` | 예 | connection_test만 null; judgment는 judgment, 제목·압축은 organizing | preset model 호출 용도 |
| `preset` | `{id,revision}` | 예 | run·독립 이어가기에는 필수; connection_test는 null; → lophn-agent/presets | 선택 구성 근거 |
| `purpose` | `judgment / title_summary / conversation_compression / connection_test` | 아니오 | connection_test는 명시 user test이며 run/session null; 가짜 run·세션 없음 | 별도 용도 |
| `test_request` | `{command_key,test_kind}` | 예 | connection_test에만 필수; 인증된 user 요청 key·`text / tool_call` 고정; provider·model·credential은 CallModel과 같은 요청 기준 | 명시 test 근거 |
| `attempt_kind` | `initial / retry / credential_change` | 아니오 | 실제 시도 구별; model fallback 없음 | 시도 종류 |
| `attempt_order` | 양의 정수 | 아니오 | run 안 실제 call seq; 독립 summary 및 같은 test_request.command_key 작업도 증가 | 순서 |
| `retry_of` | `mcl` ID | 예 | 같은 input·model의 이전 실패 시도; 자동 retry 최대 2회 | retry 관계 |
| `credential_change_of` | `mcl` ID | 예 | 같은 provider·model, 다른 credential; → lophn-agent/harness/provider | credential 이동 관계 |
| `model` | CallModel | 아니오 | 실제 선택·당시 값 불변 | 전송 선택 |
| `input` | sha256 | 아니오 | 시작 전 redaction된 blob; 인증 헤더·secret·추론 제외 | 실제 요청 |
| `context_basis` | sha256 | 아니오 | run/summary는 → lophn-agent/harness/prompt-assemble; connection_test는 보호한 별도 test 재료·요청 key·당시 설정 snapshot | 실제 조립 근거 |
| `output` | sha256 | 예 | 완전 또는 partial 표시가 있는 수신 결과; 추론 제외 | 실제 응답 |
| `state` | `started / finished` | 아니오 | 시작 전 저장 필수 | 상태 |
| `started_at` | 시각 | 아니오 | 시작 기록 시각; 전송 완료와 구별 | 시작 |
| `finished_at` | 시각 | 예 | finished에 필수 | 종료 |
| `duration_ms / first_output_ms` | 0 이상 정수 ms 각각 | 예 | 단조 시계 측정; 없으면 null | 전체·첫 출력 시간 |
| `outcome` | ModelOutcome | 예 | finished에 필수 | 실제 결과 |
| `usage` | TokenUsage | 아니오 | 미보고는 각 필드 null | 사용량 |
| `cost` | CallCost | 아니오 | 초기 unknown; 당시 근거 | 비용 |

### 상태

| 상태 | 뜻 |
|---|---|
| `started` | input·시작 사실 저장; 실제 전송은 아직 모를 수 있음 |
| `finished` | 완전·부분 응답 또는 실패·취소·불명확 확정 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `started` | machine | input·basis blob 준비; run·preset 선택·credential 또는 명시 connection_test 자격 검사; 저장 후 전송 | `ModelCallStarted` |
| `started` | `finished` | machine | 응답·실패·취소 저장 또는 복구 확인 불가 | `ModelCallFinished` |
| `finished` | `finished` | machine | 늦은 확인 결과·usage·cost 근거 추가; 기존 사실 보존 | `ModelCallSupplemented` |

### 불변 조건

- 시작 기록 저장 실패면 전송하지 않는다. 외부 전송과 ledger commit은 하나의 원자적 효과가 아니다.
- `started`만 있으면 실제 전송·usage는 모름이다. 실패·취소·retry·정리도 모두 기록한다.
- 완전 응답 저장 뒤에만 다음 판단·tool로 간다. partial 응답의 tool은 하나도 실행하지 않는다.
- 끝난 본문·결과는 덮지 않는다. 늦은 보완은 기존 uncertain·cancelled 사실을 유지한다.
- 보완은 terminal run 재개·새 변경을 만들지 않는다.
- 입력·출력 원본은 redaction을 거친 blob이다. 관측 export 상한으로 복구 원본을 자르지 않는다.

## CallModel (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `provider` | `pvd` ID | 아니오 | → lophn-agent/harness/provider | 실제 목적지 |
| `name / protocol` | 문자열 / 호출 형식 | 아니오 | 실제 전송값 | 실제 model·adapter |
| `credential_key / credential_revision` | 문자열 / 양의 정수 | 예 | 무인증 loopback만 둘 다 null; 그 외 전송 직전 확인값; secret 값 없음 | 실제 credential |
| `options` | JSON object | 아니오 | 당시 preset model 선택 snapshot; connection_test는 명시 요청의 검증된 옵션 snapshot | sampling 등 |
| `requested_reasoning / applied_reasoning` | 수준 또는 provider 옵션 | 예 | 미지원·미확인은 null; 값 구별 | 추론 선택 |
| `limits` | `{context_limit,input_limit,output_limit,supports_tools}` | 아니오 | 당시 확인·user 명시 한계 | 크기 검사 |
| `catalog_basis / price_basis` | 출처 snapshot / PriceBasis | 아니오 / 예 | → lophn-agent/harness/model; 당시 값 | 한계·가격 근거 |
| `billing_route` | `api / subscription / extra_usage / unknown` | 아니오 | provider 확인값 | 청구 경로 |

## ModelOutcome (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `complete / partial / failed / cancelled / uncertain` | 아니오 | complete는 완전한 protocol 종료·응답 | 결과 |
| `code` | ProviderFailure 또는 안전한 종료 코드 | 예 | failed에 필수; → lophn-agent/harness/provider | 실패 분류 |
| `retry_at` | 시각 | 예 | temporary의 서버 지시만 | 예정 retry |
| `finish_reason` | 안전한 protocol 종료 문자열 | 예 | 내부 추론·오류 본문 제외 | provider 종료 이유 |
| `http_status / provider_code` | 정수 / 안전한 문자열 | 예 | 실제 보고값만 | 오류 메타데이터 |

## TokenUsage (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `input / output / cache_read / cache_write / reasoning` | 0 이상 정수 token 각각 | 예 | null은 모름; 0은 보고된 0 | provider 보고 사용량 |
| `cache_in_input / reasoning_in_output` | boolean 각각 | 예 | provider 정의를 call에 snapshot; null이면 비교 불가 | 포함 관계 |
| `definition_revision` | 문자열 | 아니오 | 정규화 규칙 판 | usage 의미 |

## CallCost (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `reported / estimated / subscription / free / unknown` | 아니오 | unknown 기본; failure 무료 추정 금지 | 금액 의미 |
| `amount` | 0 이상 십진수 문자열 | 예 | reported·estimated·free에 필수; free는 0; 나머지 null | 금액 |
| `currency` | ISO 4217 | 예 | 금액 있을 때 필수 | 통화 |
| `basis` | 당시 가격·usage·계산식 snapshot 또는 보고 근거 | 예 | estimated에 필수; 보고 금액은 provider 근거 | 비용 근거 |
| `confirmed_at` | 시각 | 예 | 실제 확인 시각 | 확인 |

## UsageTotal (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `group` | `{run?,role?,from_at,through_at,currency?}` | 아니오 | 반열린 UTC 기간; run·역할 filter 명시 | 집계 범위 |
| `calls` | 0 이상 정수 | 아니오 | distinct ModelCall.id | call 수 |
| `tokens` | TokenUsage별 알려진 합·unknown call 수 | 아니오 | 포함 관계 다른 값은 별도 그룹; 모름 누락 금지 | 사용량 합계 |
| `costs` | kind·currency별 `{amount?,calls}` 배열 | 아니오 | reported·estimated·subscription·free·unknown 분리 | 비용 합계 |
| `missing_records` | 0 이상 정수 | 아니오 | 누락 있으면 완전한 지출 아님 | 기록 누락 |
| `complete` | boolean | 아니오 | unknown·누락 없을 때만 true | 완전성 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `model_calls` | ModelCall 및 상태 seq | PK `id` | partial `(run,attempt_order)` WHERE run IS NOT NULL; partial `(test_command_key,attempt_order)` WHERE purpose=connection_test | `(run,state)`, `(session,started_at)`, `(model_use,purpose,started_at)`, `(provider,model_name,started_at)`, `retry_of` | run·session·provider FK; credential `(provider,key)` FK; retry·이동 self FK; blob 영구 참조; 삭제 RESTRICT |
| `model_call_supplements` | 보완 근거·usage·cost·결과 참조 | PK `(call,supplement_key)` | PK; event_seq | `(call,event_seq)` | call FK; event FK; blob 참조; 삭제 RESTRICT |

UsageTotal은 호출 원본에서 재계산하는 derived store이며 독립 ledger 표가 없다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `StartModelCall` | machine | 초기 ModelCall, 반영 message ID 목록 | run running·state_seq·한도·correction·provider enabled·credential revision; 독립 summary는 세션 범위; connection_test는 명시 user 요청 key·고정 model/credential·usage_wait 아님·한 시도 30000ms 상한 | `ModelCallStarted`; 최초 반영은 → lophn-agent/conversation | `conflict`, `forbidden`, `invalid_input`, `unavailable` |
| `FinishModelCall` | machine | call, output?, outcome, usage, cost, 측정 | started·state_seq; ID 내용 일치 | `ModelCallFinished` | `conflict`, `invalid_input` |
| `SupplementModelCall` | machine | call, supplement_key, 늦은 근거 | finished; 동일 key 내용 일치; 이전 사실 불변 | `ModelCallSupplemented` | `conflict`, `invalid_input` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `ModelCallStarted` | call | run?, session?, model_use, purpose, model, input, context_basis | shell/desktop |
| `ModelCallFinished` | call | outcome, output?, usage, cost, 측정 | lophn-agent/harness/run-loop, lophn-agent/harness/usage, shell/desktop |
| `ModelCallSupplemented` | call | supplement_key, 이전 근거 참조, 추가 fact | lophn-agent/harness/usage, lophn-agent/observability, shell/desktop |

## 정책

- **합계.** input에 이미 포함된 cache 및 output에 포함된 reasoning은 다시 더하지 않는다. 비교 불가 포함 관계는 분리한다. 모르는 token·금액은 0이 아니다.
- **추정.** 겹침 없는 과금 token 구간 × 당시 1000000 token당 요율을 십진수로 계산한다. 필요한 usage·가격이 하나라도 모르면 그 금액은 unknown이다. 통화는 합치거나 자동 환산하지 않는다.
- **보완 합계.** call마다 한 번만 세며 보완 근거의 확인값을 적용하되 최초 사실·가격을 지우지 않는다. 현재 가격으로 과거를 바꾸지 않는다.
- **연결 test.** model_use·run·session을 만들지 않고 명시 요청의 model·credential·보호 test 재료를 고정한다. 텍스트·tool call 실제 시도는 모두 시작 기록 뒤 전송하며 ProviderCheck.calls로 연결한다. 한 시도 30000ms 상한, usage_wait 제외, 설정 조회로 자동 전송 없음이다.
- **비용 상한.** 없다. run 제어 한도는 → lophn-agent/harness/run-loop.
- **귀속.** handoff 받는 run의 call은 실제 받은 assignment·역할·run에 귀속한다. 보낸 run 비용으로 바꾸지 않는다.

