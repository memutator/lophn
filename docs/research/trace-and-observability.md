---
type: research
concerns: [lophn-agent/observability]
---
# agent trace·관측·export·보존

## 질문

run·turn·call을 어떤 단위로 남기고, 원문을 사본으로 저장하는지 참조만 하는지, 시각·실패·retry·redaction을 어떻게 구별하나.
export가 로컬 파일인지 network(OTLP)인지, 값 상한과 잘림 표시, 내용 종류 선택이 있나.
보존이 기간·행 수·용량 중 무엇으로 정리되고, 사람 화면은 trace를 어떻게 접나.

## 프로젝트별

### Codex (3a69ec3ef8fb)

trace가 두 겹이다. 둘 다 원문 참조가 아니라 사본을 쓴다.

**otel (metrics + tracing span).** `codex-rs/otel`. `SessionTelemetry::new`(`events/session_telemetry.rs:560`)가 thread(conversation) 하나에 붙고, event 이름은 `codex.conversation_starts`, `codex.api_request`, `codex.sse_event`, `codex.user_prompt`, `codex.tool_decision`, `codex.tool_result`, `codex.sandbox_outcome`다. model 호출은 `log_request`(`:690`)가 `attempt: u64`와 HTTP status·error를 남기고, SSE 완료는 `sse_event_completed`(`:1104`)가 token usage와 `ttft_ms: Option<i64>`를 남긴다. tool은 `tool_decision`(`:1168`, decision + source `AutomatedReviewer/Config/User`)과 `tool_result_with_tags`(`:1270`, success bool + duration)로 잇는다. 경과 시간은 `Instant::now()`(`metrics/timer.rs:30`, Drop 때 record)로 재고 wall clock은 쓰지 않는다. 첫 token 지연은 metric `TURN_TTFT_DURATION_METRIC`(`record_turn_ttft:355`)와 SSE event의 `ttft_ms`로 남긴다. 사람 대기 시간은 구별하지 않는다 [확인].

**rollout trace bundle.** `codex-rs/rollout-trace`. 환경변수 `CODEX_ROLLOUT_TRACE_ROOT`가 있을 때만 켜지고 없으면 no-op이다(`thread.rs:107`, `CODEX_ROLLOUT_TRACE_ROOT_ENV`). `TraceWriter::create`(`writer.rs:54`)가 bundle 디렉터리에 manifest와 `trace.jsonl`(append)을 만들고 payload는 `payloads/<ordinal>.json` 사본 파일로 먼저 쓴 뒤 event가 참조한다(`writer.rs` 주석: replay가 아직 안 쓴 파일을 가리키지 않게). event envelope `RawTraceEvent`(`raw_event.rs:33`)는 `schema_version=1`, writer 단조 `seq`, `wall_time_unix_ms`(SystemTime, `writer.rs:150`; 시계가 epoch 이전이면 0), `thread_id`, `codex_turn_id`다. payload variant(`raw_event.rs:69`)가 rollout/thread/turn/inference/tool/code cell/compaction을 나누고, inference는 `InferenceStarted/Completed/Failed/Cancelled`로 실패·취소를 구별하며 실패·취소에도 `partial_response_payload`를 남긴다. tool은 `ToolCallStarted/RuntimeStarted/RuntimeEnded/ToolCallEnded`와 MCP correlation event로 잇는다. 경과 시간은 이 bundle에 없고 wall clock만 있다 [확인].

**export.** otel exporter는 `OtelExporter`(`config.rs:89`): `None`, `Statsig`(metrics 전용, endpoint `https://ab.chatgpt.com/otlp/v1/metrics`, debug build에서는 `None`으로 바뀜 `config.rs:20`), `OtlpGrpc`, `OtlpHttp`(Binary/Json). trace와 metrics exporter를 따로 둔다(`OtelSettings:57`). 즉 network OTLP가 기본 경로다. rollout trace는 로컬 디렉터리뿐이고 형식은 JSONL 한 줄 + JSON 파일이지 NDJSON trace 하나가 아니다 [확인].

**상한·redaction.** tool 결과 telemetry preview는 `ToolResultLogConfig.max_bytes` 기본 **2048**(`protocol/src/config_types.rs:29`)이고 넘으면 `\n[... telemetry preview truncated ...]`를 붙이고 `output_truncated` bool을 같이 남긴다(`tool_result.rs:14,91`). trace span에는 본문 대신 `arguments_length`, `output_length`, `output_line_count`만 넣는다(`tool_result.rs:75`). user prompt 원문은 `log_user_prompt` 설정이 true일 때만 log event에 넣고, 기본값은 **false**(`core/src/config/otel.rs:13`, `config/src/types.rs:651`)라 기본은 `"[REDACTED]"`다. trace event에는 prompt 길이·개수만 들어간다(`session_telemetry.rs:1146`). 추론 원문(reasoning token 수)은 usage 숫자로만 남긴다 [확인]. secret 값 redaction 단계는 otel 경로에서 찾지 못했다. account id·email은 metadata로 올라간다 [확인, 부재는 미확인].

**sampling.** 코드에서 sampling 분기를 찾지 못했다. metrics는 counter/histogram 전부 기록한다 [미확인: SDK 기본 sampler].

**보존.** rollout(세션 기록) 쪽 `rollout/src/policy.rs`는 저장 시점에 MCP 결과·command 출력을 **64 KiB**에서 잘라 저장한다(`PERSISTED_MCP_RESULT_MAX_BYTES:16`). 용량·기간 정리는 이 조사에서 확인하지 못했다 [미확인]. trace bundle 자체의 정리는 없다(env로 켠 opt-in 산출물) [확인].

**화면.** otel은 화면이 없다. rollout trace는 `README`가 reducer·viewer projection을 `codex-core` 밖으로 둔다고 적는다(`rollout-trace/src/lib.rs:4`). 접기·단계 수 표시는 확인하지 못했다 [미확인].

### Gemini CLI (fb972b2f87fe)

OpenTelemetry 기반이고 GenAI semantic convention 이름을 쓴다(`telemetry/constants.ts`: `gen_ai.operation.name`, `gen_ai.input.messages`, `gen_ai.usage.input_tokens`, `gen_ai.conversation.id`).

**단위.** span 하나가 operation 하나다. `runInDevTraceSpan`(`trace.ts:123`)이 `GeminiCliOperation`으로 span을 열고, 반환값이 async iterable이면 stream이 끝날 때까지 span을 닫지 않으며 GC 대비 `FinalizationRegistry`(`trace.ts:37`)로 마감한다. tool은 `logToolCall`(`loggers.ts:139`)이 `ToolCallEvent`(function name, success, decision, duration_ms)를 log + metric으로 남긴다. model 호출은 `logApiRequest/logApiResponse/logApiError`(`loggers.ts:235,274,307`), retry는 `logNetworkRetryAttempt`(`:508`)와 `logContentRetry`(`:527`)로 별도 event다 [확인].

**시각.** tool·API duration은 `duration_ms: number`(`types.ts:250,503,657`)로 남는다. 시계 출처(wall/단조)는 telemetry 층에 없고 호출자가 넣은 값이다 [미확인]. 첫 token 지연 필드는 types.ts에서 찾지 못했다 [미확인]. 사람 대기 시간은 `logApprovalModeDuration`(`loggers.ts:782`)이 approval mode 지속 시간으로 가장 가깝다 [확인].

**본문.** `truncateForTelemetry`(`trace.ts:55`)가 span attribute를 기본 **10000자**에서 자르고 suffix에 `...[TRUNCATED: original length N]`로 원본 길이를 남긴다. 문자열 길이는 JS `length`(UTF-16 code unit)라 UTF-8 byte가 아니다(`textUtils.ts truncateString:106`은 grapheme cluster로 자른다). 본문은 `logPrompts`가 false가 아닐 때 attribute로 들어가고, span 전체는 `tracesEnabled`일 때만 남는다(`trace.ts:158`). 기본값은 telemetry `enabled: false`, `traces: false`, `logPrompts: true`(`config/config.ts:1094`). 즉 기본은 꺼져 있고, 켜면 prompt 원문이 기본으로 나간다 [확인].

**export.** `TelemetryTarget`은 `local` | `gcp`(`config.ts:24`), 기본 target `local`, 기본 OTLP endpoint `http://localhost:4317`, protocol `grpc`(`telemetry/index.ts:12`, `config.ts:2922`). `outfile`이 있으면 `FileSpanExporter/FileLogExporter/FileMetricExporter`(`file-exporters.ts`)가 pretty JSON(들여쓰기 2)을 append한다. NDJSON이 아니라 객체마다 여러 줄이다 [확인]. GCP target은 network다. export 실패는 `ExportResultCode.FAILED`로 callback에만 전달하고 재시도하지 않는다(`file-exporters.ts:66`) [확인].

**redaction.** `sanitize.ts`는 hook 이름에서 경로와 `--api-key=` 같은 인자를 벗겨 basename만 남긴다(`sanitize.ts:17` 주석 예시). 범용 secret scrub은 아니다 [확인]. 추론 원문 처리도 찾지 못했다 [미확인].

**sampling·보존.** sampling과 파일 보존(rotation, 기간)은 telemetry 코드에서 찾지 못했다. `outfile`은 append만 한다 [미확인].

**화면.** `UiTelemetryService`(`uiTelemetry.ts:149`)가 API 응답·오류·tool call을 model별 metric으로 모아 UI event로 흘린다. 단계 접기·실패 요약은 이 층에 없다 [확인, 화면 접기는 미확인].

### Hermes Agent (343500b3547e)

관측이 세 갈래로 갈라져 있다.

**trajectory.** `agent/trajectory.py save_trajectory:37`이 대화 전체를 ShareGPT 형식(`conversations`, `timestamp`, `model`, `completed`)으로 JSONL 한 줄에 append한다. 완료면 `trajectory_samples.jsonl`, 실패면 `failed_trajectories.jsonl`로 파일을 가른다. 완료 bool만 있고 실패 종류(model 오류, tool 오류, 취소)는 구분하지 않는다. timestamp는 `datetime.now().isoformat()`로 timezone 없는 로컬 시각이다(`:41`). 원문 전부 사본이고 상한·잘림 표시·redaction이 없다. flock으로 동시 append만 지킨다(`:24`) [확인].

**운영 log.** `hermes_logging.py`가 `RotatingFileHandler`로 `agent.log`를 돌린다. 기본 `max_bytes` **5 MiB**, `backupCount` 3(`:362`). 기간이 아니라 크기 기준이다 [확인].

**monitoring OTLP.** `agent/monitoring`은 gateway 건강·cron 실행만 다룬다. event는 `GatewayHealthEvent`, `GatewayDiagnosticEvent`, `CronExecutionEvent`(`events.py:25,48,66`)로 내용이 없다. 시각은 `time.time_ns()`(`ts_ns`), cron만 `duration_ms`가 있다. export는 `monitoring.export.otlp.enabled`와 `endpoint`가 둘 다 있어야 켜지는 opt-in이고(`otlp_exporter.py:257`), span attribute는 allowlist 키만 `hermes.<key>`로 싣는다(`:184`). 나가기 전 `redact_for_export`(`redaction.py:25`)가 secret scrub 후 email·UUID·전화번호를 `[email]/[id]/[phone]`로 바꾸고, 실패하면 원문 대신 unavailable을 반환한다(fail closed, `:3` 주석). 문자열은 `redact_bounded`로 **500자**에서 자른다(`:36`). 잘림 표시는 없다 [확인].

**sampling·화면.** sampling 코드 없음 [미확인]. trajectory를 접어 보여주는 화면은 이 코드에 없다 [미확인].

### OpenClaw (37efa0b4a644)

`src/audit`가 metadata만 담는 SQLite ledger다. 본문 사본을 만들지 않는 점만 lophn과 같다.

**단위.** `audit-event-types.ts`의 `AuditEventKind`는 `agent_run | tool_action | message`(`:6`), `schema_version` 1(`:4`). run 종료는 `succeeded/failed/cancelled/timed_out/blocked`와 error code(`run_failed` 등, `:75`)로 갈리고, tool 종료는 거기에 `unknown`(error code `tool_outcome_unknown`, `:90`)이 추가된다. message는 inbound/outbound와 완료·skip·suppress 사유 code를 상수로 고정한다(`:22,36,48`). 귀속은 `actorType(agent|system)`, `actorId`, `agentId`, `sessionId`, `runId`(`:66`)다. model 호출 event는 이 집합에 없다. run 안에 model 시도를 잇는 자리는 확인하지 못했다 [미확인].

**시각.** `occurredAt: number`(epoch ms, `:62`)와 message의 `durationMs?`(`:128`)만 있다. 단조 시계, 첫 token, tool 시간, 사람 대기 시간 구별은 없다 [확인].

**수집 범위.** ledger 자체는 기본 on이고 `logging.audit.enabled === false`로만 끈다(`audit-config.ts:11`, 주석: 사고 뒤에 켜면 그 사고를 설명 못 함). 끈 뒤에도 받은 write는 drain하고 조회는 만료 전까지 된다. message metadata는 기본 `"off"`(`:22`), execution identity는 `executionIdentity === true` opt-in(`:16`)이다 [확인].

**보존.** `AUDIT_EVENT_RETENTION_MS` = **30일**(`audit-event-store.ts:51`), `AUDIT_EVENT_MAX_ROWS` = **100,000**(`:52`). insert마다 만료 행을 지우고(`occurred_at < now - retention`, `:567`) 행 수가 넘으면 오래된 것부터 1,024행 단위로 prune한다(`:577`). 용량이 아니라 기간 + 행 수다. 영구 보존 구분은 없다 [확인].

**redaction.** 본문을 저장하지 않으므로 값 redaction은 없고, 식별자는 `hmac-sha256:v1:` 형식만 받는다(`AUDIT_HMAC_REF_RE:67`) [확인].

**export·sampling·화면.** export 함수는 audit 코드에서 찾지 못했다. SQLite 조회(`audit-event-queries.ts`)만 있다 [미확인]. sampling 없음(전 이벤트 insert) [확인]. 화면 접기는 이 층에 없다 [미확인].

## 비교

| 항목 | lophn (요구) | Codex | Gemini CLI | Hermes | OpenClaw |
|---|---|---|---|---|---|
| trace 단위 | run 하나 = trace 하나, 독립 model call은 call 하나 (R1, R4) | thread + turn + inference call + tool call 중첩 | operation span 하나 | trajectory 파일 하나(대화 전체) | agent_run / tool_action / message 행 |
| 원문 | 참조만, 사본 없음 (R1, R8) | 사본 (payload JSON 파일, log 본문) | 사본 (span attribute) | 사본 (JSONL 원문 전부) | metadata만, 본문 없음 |
| 실패·취소·retry | 전부 구별, sampling 없음 (R5) | inference failed/cancelled + attempt 번호, sampling 코드 없음 | retry 별도 event, sampling 미확인 | completed bool만 | succeeded/failed/cancelled/timed_out/blocked/unknown |
| 시각 | UTC ms + 단조 경과, 대기·model·첫 응답·tool 분리 (R6) | otel은 Instant, bundle은 wall ms. TTFT 있음, 사람 대기 없음 | duration_ms만, 시계 출처 미확인 | 로컬 시각(timezone 없음), cron만 duration | occurredAt epoch ms, duration 일부 |
| 추론 원문 | trace에 넣지 않음 (R9, R22) | token 수만 | 미확인 | trajectory에 scratchpad 원문 포함 가능 | 저장 안 함 |
| prompt 원문 기본 | 보호 원본으로만, export 기본 제외 (R9, R16) | 기본 제외(`log_user_prompt` false) | telemetry 켜면 기본 포함(`logPrompts` true) | 항상 포함 | 저장 안 함(message 기본 off) |
| export | 로컬 NDJSON v1만 (R12, R14) | otel은 OTLP network, bundle은 로컬 JSONL+파일 | OTLP(grpc, localhost:4317) 또는 pretty JSON 파일 | OTLP opt-in, trajectory는 JSONL | 없음(SQLite 조회) |
| 값 상한·잘림 표시 | 값당 UTF-8 32768, 잘림 별도 표시 (R10) | telemetry preview 2048 byte + `output_truncated` | 10000자 + 원본 길이 suffix (UTF-16 기준) | monitoring 500자, 잘림 표시 없음 | 해당 없음 |
| 내용 종류 선택 | export마다 user 재선택 (R16) | 없음 (설정 하나) | `logPrompts` 하나 | 없음 | 없음 |
| 보존 | 큰 자료만 용량 초과 시 오래된 순, 변경·결정·확정은 영구 (R23) | 저장 시점 64 KiB 절단, 기간 정리 미확인 | 미확인 (append만) | log 5 MiB × 3회전, trajectory 무제한 | 30일 + 100,000행, 영구 구분 없음 |
| 화면 | 기본은 결과만, 단계 수로 접기, 실패 요약 (R20, R21) | 없음(viewer는 외부) | metric 집계만 | 없음 | 없음 |

## lophn에 가져올 것과 버릴 것

**[R1, R8] 원본 참조.** 네 프로젝트 모두 관측 경로에 사본을 둔다. Codex bundle은 payload 파일을 event보다 먼저 쓰는 순서로 깨진 참조를 피하는데, lophn은 사본이 없으므로 이 문제가 "원본이 사라졌을 때의 부재 표시"로 바뀐다. 가져올 것: 부재를 성공으로 바꾸지 않는 표시(OpenClaw의 `unknown` status, Codex의 partial payload 구별). 버릴 것: payload 파일 사본.

**[R5] 종료 분류.** OpenClaw `AuditEventStatus` 6종과 Codex `InferenceFailed/InferenceCancelled` 분리가 요구와 가장 가깝다. 가져올 것: 결과 불명(`unknown`)을 실패와 분리하는 것. 버릴 것: Hermes의 completed bool 하나. Codex는 취소 사유를 자유 문자열 `reason: String`(`raw_event.rs` `InferenceCancelled`)으로 남기므로 요구의 고정 분류와 다르다.

**[R6] 시각.** Codex otel의 `Instant` 경과 + 별도 TTFT metric이 단조 시계 요구와 맞는다. 다만 사람 대기 시간을 빼는 곳은 없다. Gemini는 duration을 호출자가 넣어 시계 종류가 보장되지 않는다. 가져올 것: 측정 지점을 호출 시작·첫 token·종료로 나누는 Codex 방식. 버릴 것: Hermes의 timezone 없는 로컬 시각.

**[R10] 상한.** 잘림 표시를 본문 밖에 두는 것은 Codex `output_truncated` bool이 요구와 같다. Gemini는 suffix를 본문에 붙여 본문과 표시가 분리되지 않고, 기준이 UTF-16 길이라 한글에서 UTF-8 32768과 어긋난다. 가져올 것: 잘림 여부를 별도 필드로. 버릴 것: 본문 안 truncation 문구.

**[R12, R14, R16] export.** 네 프로젝트 중 로컬 파일 export만 기본으로 두는 곳이 없다. Codex·Gemini·Hermes 모두 OTLP network가 있거나 기본 경로다. lophn이 network를 빼기로 한 것(D27)은 이 셋과 정면으로 다르다. pretty JSON(Gemini `file-exporters.ts` 들여쓰기 2)은 한 줄 하나의 JSON이 아니라 R14의 NDJSON과 다르다. 내용 종류를 export마다 고르는 곳은 없고, 가장 가까운 것이 Codex `log_user_prompt`와 Gemini `logPrompts` 설정 하나다. 가져올 것: export 실패가 원본을 건드리지 않고 결과 code만 반환하는 Gemini `ExportResult` 방식(R17과 맞음). 버릴 것: OTLP exporter 구성 자체.

**[R23] 보존.** 용량 기준 정리는 어느 프로젝트에도 없다. OpenClaw는 기간(30일) + 행 수(100,000), Hermes는 log 파일 크기(5 MiB) + 회전 수다. 둘 다 영구 보존 구분이 없어 변경 기록까지 같이 지운다. 요구의 "큰 자료만, 변경·결정·확정은 영구"는 비교 대상보다 세다. 가져올 것: 정리를 쓰기 시점에 하는 OpenClaw의 insert-then-prune 순서(조회 때 정리하면 조회가 느려진다). 버릴 것: 기간·행 수 상한. open-issues 후보 아님 — 요구가 더 구체적일 뿐 충돌은 없다.

**[R20, R21] 화면.** 접기·단계 수·실패 요약은 네 프로젝트 관측 코드 어디에도 없다. Gemini `UiTelemetryService`의 model별 집계가 가장 가까운데 이건 화면 요약이 아니라 metric이다. 화면은 lophn이 새로 만드는 자리다.

## 구현 메모

**trace 조립 입력.** trace는 저장하지 않으므로 조회 응답을 만들 때 필요한 최소 조회는 이렇다.

| 조각 | 출처 | 없으면 |
|---|---|---|
| run 상태 변경 | ledger event (seq 순) | `missing`에 `{kind: event, reason}` |
| message 본문 | conversation blob | 부재 표시, 성공으로 바꾸지 않음 |
| model 시도 | usage의 ModelCall 전부 (실패·취소 포함) | 누락 표시 |
| tool 판정 | tools의 ToolCall 전부 (deny·미실행·uncertain 포함) | 누락 표시 |
| 시작 조건 | Run.basis hash | basis만 있고 본문 사본 없음 |

**시각 계산.** wall clock은 시작·종료 UTC ms만 저장하고, 경과(active, waiting, model, first output, tool)는 단조 시계 차이로 경계마다 누적한다. 사람 대기 구간은 active·stall 누적에서 빼야 R6가 성립한다(architecture 7.1a 근처 8.1의 "waiting_user는 active/stall 누적을 멈춘다"와 같은 경계). 시계가 뒤로 가도 경과가 음수가 되지 않게 단조 시계만 쓴다. Codex `unix_time_ms`(`writer.rs:150`)처럼 epoch 이전이면 0으로 바꾸는 처리는 wall clock에만 적용한다.

**종료 분류.** `succeeded / model_error / tool_error / permission_denied / safety_blocked / user_stopped / unconfirmed`로 고정하고, 자유 문자열 reason은 받지 않는다. 종료 event가 없으면 `unconfirmed`이며 성공으로 올리지 않는다(R7).

**export NDJSON.** 한 줄에 trace 하나, `format_version: 1`. 값은 redaction 뒤 UTF-8 32768 byte에서 자르되 문자 경계를 지키고(Gemini `truncateString`의 grapheme 처리가 참고할 만하지만 기준은 byte다), 잘림은 본문 안 문구가 아니라 별도 필드(`truncated`, `original_bytes`, 원본 참조)로 낸다. 내용 종류는 기본 빈 집합이고 요청마다 `message / model_input / model_output / tool_input / tool_output` 중에서 받는다.

**export 실패.** 파일 쓰기 실패는 sent/not_sent 수와 안전한 오류만 반환하고 ledger·blob은 그대로 둔다. model 재호출을 만들지 않는다(R17).

**보존.** 정리 후보는 blob-store가 "큰 자료"로 분류한 것만, 오래된 순. 빼야 할 것: 진행 run, 미반영 입력, 답·approval 대기, revert 근거(R24). 변경 기록·결정·확정 결과는 대상 자체가 아니다.

**테스트 경계.**

- 같은 run의 실패 model 시도 2회 + 거절 tool 1회가 trace에 각각 보이는지 (R5).
- 사람 대기 10초 + model 2초에서 waiting과 model이 다른 값인지, 시스템 시계를 뒤로 옮겨도 경과가 음수가 아닌지 (R6).
- 종료 event 없이 끊긴 run이 성공으로 보이지 않는지 (R7).
- 한글 본문 export가 UTF-8 32768 경계를 지키고 잘림 필드가 본문과 따로 있는지, 원본 blob 뒷부분이 그대로인지 (R10).
- 종류를 고르지 않은 export에 본문이 없고, 고른 종류만 있는지 (R16).
- export 도중 쓰기 실패가 원본과 run 결과를 바꾸지 않는지 (R17).
- 용량 초과 정리에서 대기·revert 근거가 빠지지 않는지 (R24).
