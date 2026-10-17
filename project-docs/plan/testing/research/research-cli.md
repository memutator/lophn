# coding agent CLI들의 fake provider와 test 환경 조사

조사 시점: 2026-10-17 기준 각 repo의 main (shallow clone, 읽기만 함, 실행 안 함).
clean room: 코드는 옮기지 않았고 설계, 구조, 이름, path, 개수만 적었다.
clone 위치: 각 repo의 GitHub 기본 branch(`--depth 1` clone, 지금은 지움)의 `{codex,opencode,gemini-cli,goose,aider}`
(이하 path는 각 repo root 기준. 개수는 grep으로 센 대략치)

---

## 1. OpenAI Codex CLI (`openai/codex`, Rust)

### 1.1 fake가 끼는 곳
- **HTTP mock server(wiremock crate)**. fake는 OpenAI Responses API(`POST .../responses`, `GET .../models`) 한 가지 wire만 흉내 낸다.
- 제품 코드는 그대로 두고 model provider 설정의 `base_url`만 mock server 주소로 바꾼다. 인증은 dummy API key.
- 두 가지 실행 형태.
  - **in-process**(`codex-rs/core/tests/`): `test_codex()` builder가 임시 `CODEX_HOME`, 임시 cwd, config를 만들고 core의 ThreadManager를 같은 process에서 띄운다. provider 정보를 builder가 덮어써서 mock server URL을 넣고, websocket은 기본으로 끈다. test는 `codex.submit(Op)` 로 입력을 넣고 event stream(`wait_for_event`)으로 결과를 기다린다. model name, feature flag, config는 `.with_model()`, `.with_config(|c| ...)` 로 바꾼다.
  - **제품 binary spawn**(`codex-rs/exec/tests`, `cli/tests`, `app-server/tests`): `assert_cmd` 로 `codex-exec` binary를 실행하며 env `CODEX_HOME`(임시 dir), `CODEX_SQLITE_HOME`, dummy API key를 주고, base URL은 `-c openai_base_url=...` CLI config override 로 넘긴다. app-server는 stdio JSON-RPC child process로 띄우고 test client가 request를 보낸다(임시 CODEX_HOME, `RUST_LOG=warn`).
- 같은 mock server 도구(`core_test_support::responses`, crate `codex-rs/core/tests/common`)를 core, exec, app-server가 공유한다.

### 1.2 대답을 정하는 법
- 기본은 **순서 queue**: `mount_sse_once`(1번만 응답), `mount_sse_sequence`(N개 body를 호출 순서대로, 더 오면 panic, 호출 횟수가 정확히 N이어야 함), `mount_response_sequence`(ResponseTemplate 열).
- **matcher 붙은 one-shot**: `mount_sse_once_match(server, matcher, body)`. wiremock의 `Match` trait을 구현해 request body 내용으로 고른다.
- 한 응답의 모양: "SSE 이벤트 JSON 배열을 `sse(vec![...])` 로 문자열화". 예: response created, function call, completed 이벤트를 순서대로 나열. 한 test에서 mock을 여러 번 mount 하면 1번째 요청, 2번째 요청 순으로 소비된다.
- 녹화 재생(cassette)은 core에서 안 쓴다. 대신 **snapshot(insta)**: 모델에게 실제로 보인 request context를 사람이 읽을 수 있게 정규화해서 `.snap` 으로 저장(`core/tests/common/context_snapshot*`, `suite/snapshots/` 102개). 경로, id 같은 volatile 값은 normalizer가 치환한다.

### 1.3 streaming
- `ev_*` helper 함수군(약 25개): `ev_response_created`, `ev_completed(_with_tokens)`, `ev_assistant_message`, `ev_output_text_delta`, `ev_reasoning_*`, `ev_function_call(_with_namespace)`, `ev_custom_tool_call`, `ev_apply_patch_*`, `ev_exec_command_call`, `ev_web_search_call_*`, `sse_failed` 등. 각각 serde_json Value를 돌려준다. 즉 **타입 없이 raw JSON을 helper가 조립**.
- 한 응답 전체는 `sse_response(body)` 로 text/event-stream ResponseTemplate. delay는 `.set_delay(duration)` (test에서 60초 지연으로 "턴이 계속 active" 상태를 만든다).
- **chunk 단위 gate**: `streaming_sse.rs` 에 직접 만든 TCP 서버(tokio, 721줄). chunk마다 oneshot gate를 걸어 test가 신호를 줘야 다음 chunk를 보낸다. 요청 수 대기, 완료 시각 receiver도 제공. "중간 정지, 도중 interrupt"를 결정적으로 만들 때 쓴다.
- WebSocket용 mock server도 따로 있다(Responses websocket transport 흉내, 연결별 queue, handshake header 검사).

### 1.4 오류와 경계
- 같은 wiremock으로 status/header를 직접 지정: 429 + `Retry-After`, 5xx, usage limit, quota exceeded 코드(`suite/retry_after.rs` 1,200줄 이상, `quota_exceeded.rs`).
- 스트림이 `response.completed` 없이 끝나면 재시도(`suite/stream_no_completed.rs`): 첫 응답은 불완전 SSE 후 연결 종료, 둘째는 정상. provider 설정 `stream_max_retries`, `stream_idle_timeout_ms` 를 test가 명시해서 process 전역 env를 건드리지 않게 했다(주석).
- `response.failed` 이벤트로 서버 오류 -> exec 종료 코드 1 확인(`exec/tests/suite/server_error_exit.rs`).
- 재시도 지연 검증은 tracing subscriber를 test에서 달아 retry telemetry event(attempt, delay)를 모아 범위(180~220ms 등)로 확인.
- 무응답: 긴 `set_delay`.

### 1.5 요청 검사
- wiremock `Match` trait을 구현한 `ResponseMock` 이 요청을 모두 기록. API: `single_request()`, `requests()`, `last_request()`.
- `ResponsesRequest` wrapper가 읽는 helper: `body_json`, `header(name)`, `path`, `query_param`, `instructions_text`, `message_input_texts(role)`, `input()`, `function_call_output(call_id)`, `tool_by_name(namespace, name)` 등. tool 정의, tool 결과, instruction을 구조적으로 확인.
- request에서 volatile metadata/id를 strip 하는 helper도 있다.

### 1.6 fake가 진짜와 어긋나지 않게
- 녹화/갱신 명령 없음. fake는 손으로 만든 JSON 이벤트.
- 진짜 provider test는 `suite/live_cli.rs`: `#[ignore]`, `OPENAI_API_KEY` 가 없으면 실패. `just test ... --run-ignored only live_cli` 로 수동 실행. CI는 안 돈다(주석: "CI stays deterministic and free").
- wire 타입은 제품이 `codex-protocol`/`codex-api` crate의 타입을 쓰고 fake helper는 Value로 직접 쓰므로 타입 공유로 막는 장치는 약하다. 스트림 모양이 바뀌면 대량의 시나리오와 snapshot이 깨지는 것으로 잡는다.
- `skip_if_no_network!`, `skip_if_sandbox!` 등 macro로 환경 제약이 있으면 해당 test를 skip.

### 1.7 test 층
- core test는 하나의 integration test binary(`tests/all.rs` + `suite/mod.rs`)에 `suite/` 의 약 250개 모듈을 모았다("former standalone integration tests" 주석).
- 개수(대략): core suite 약 1,640개 `tokio::test`, exec 약 70, app-server 약 1,180. wiremock 쓰는 파일 345개.
- 격리: test마다 `TempDir` 로 CODEX_HOME, cwd. `#[ctor]` 로 process 시작 시 결정적 process id 모드, arg0 dispatch(test binary가 apply_patch/sandbox helper처럼 동작), insta workspace root 설정.
- 실행기: cargo nextest, `slow-timeout 30s x2`, `retries = 1`, test group으로 일부 integration의 병렬도 제한(`max-threads` 1~4; 주석 "병렬 높이면 resource 경합으로 timeout"). Bazel도 병행.
- unit test는 crate 안 `*_tests.rs`.

### 1.8 교훈
- 기본 mock server가 `/models` 기본 응답을 항상 깔아 "hermetic" 유지(주석).
- websocket을 test 기본에서 끄고 필요한 test만 켠다.
- "대기가 필요한 상태는 OS별 명령(sleep) 대신 mock 응답 지연으로 만든다"(주석).
- event 대기 helper는 최소 10초 timeout.
- 대가: 규모가 커지며 builder(`test_codex.rs` 1,600줄), responses helper(1,700줄), context snapshot(830줄)이 무거운 공용 test 인프라가 됐다.

---

## 2. OpenCode (`sst/opencode`, 현재 `anomalyco/opencode`로 보임. TypeScript + Bun + Effect)

repo가 v2 구조로 재편되어 있고 test 문서(AGENTS.md, `.opencode/skills/*`)가 매우 상세하다.

### 2.1 fake가 끼는 곳 (여러 층)
1. **in-process model client 교체**: `packages/ai/src/testing.ts` 의 `TestLLM`(259줄). LLM client 서비스(Effect Context)를 같은 인터페이스의 test 구현으로 갈아 끼운다. session runner, agent loop test(`packages/core/test/session-runner.test.ts` 등)가 쓴다. wire format 없이 normalized `LLMEvent` 수준.
2. **HttpClient layer에서 가로채기(handler)**: `packages/ai/test/lib/http.ts`. Effect `HttpClient` 서비스를 함수 하나(request -> response)로 대체. provider protocol 번역(요청 encode, SSE decode)을 test.
3. **cassette 재생**: `packages/http-recorder` 패키지. 같은 HttpClient / WebSocket constructor layer를 데코레이트해서 녹화 JSON을 재생.
4. **로컬 HTTP 서버 + 제품 process spawn**: `packages/cli/test/acp/subprocess.ts`. `Bun.serve`(port 0)로 OpenAI-compatible `/v1/chat/completions` 서버를 열고, 임시 config(`opencode.json`)의 custom provider baseURL에 이 주소를 적는다. 제품 CLI(ACP 모드)는 child process. 모델 목록은 `OPENCODE_MODELS_PATH` 로 빈 파일.
5. **driver 제어 시뮬레이션**(`packages/simulation`): "simulated network" 위에 OpenAI Chat route를 올리고, WebSocket(JSON-RPC) control server로 사람/agent가 응답 이벤트를 실시간으로 밀어 넣는다. 응답 byte부터 위쪽은 진짜 pipeline(SSE framing, event schema, protocol state machine). TUI/UI 시뮬레이션과 녹화용.
6. **UI e2e(Playwright)**: 백엔드 자체를 fake. `packages/app/e2e/utils/mock-server.ts` 가 in-memory API mock으로 `page.route` 를 가로채고 SSE는 init script로 흉내. 정의 안 된 route는 501로 test 실패.

### 2.2 대답을 정하는 법
- `TestLLM`: **순서 queue**(`push`), 큐 소진 후 **fallback**(`always`) 또는 **함수**(`serve(request -> response)`), 둘 다 없으면 defect로 실패("no response for request N"). helper: `text()`, `tool()`, `toolCalls()`, `stop()`, `complete()`, `textWithUsage()` 등 normalized event DSL.
- HTTP handler layer: 요청마다 함수 호출. `observe()` 가 method+URL별 n번째 호출 번호를 알려줘서 폴링/재시도 시나리오를 함수로 작성.
- cassette: 요청 하나가 "첫 번째 안 쓴 일치 interaction"을 원자적으로 claim. 같은 요청 반복은 녹화 순서대로 소비. 불일치는 소비 안 함. 다 안 쓰고 끝나면 layer close 때 실패. 동시 요청은 시작 순서로 기록.
- cassette 형식: 읽기 좋은 JSON(`version`, `metadata`(model, tags, recordedAt), `interactions[]`(request method/url/headers/body, response status/headers/body 문자열)). SSE body가 문자열로 통째로 들어 있음. `packages/ai/test/fixtures/recordings/` 약 274개, core에도 별도 recordings.

### 2.3 streaming
- 손으로 만드는 경우: `test/lib/sse.ts` (`sseEvents(...chunks)` 가 JSON을 `data:` 줄 + `[DONE]` 으로 직렬화, `sseRaw` 는 깨진 chunk 시험용), `test/lib/openai-chunks.ts`(chunk shape helper).
- 중간 정지: `ReadableStream` 으로 첫 chunk만 내고 Deferred가 풀릴 때까지 stall하는 서버 helper(`http-timeout.test.ts`).
- TestLLM: `failAfter(error, ...events)`(이벤트 후 오류), `hangAfter(...events)`(이벤트 후 영원히 대기), `gate()`(요청 도착 시점과 풀어 주는 시점을 test가 제어).
- cassette는 응답을 통째로 buffer 하므로 **streaming timing, cancel, backpressure 시험에는 부적합**(README Current Limits에 명시).

### 2.4 오류와 경계
- handler layer에서 status/header 지정(rate limit 오류 타입 `RateLimitError` 등으로 매핑 확인), 무응답은 `Effect.never`, 늦은 헤더는 `sleep("10 minutes")` + TestClock으로 즉시 진행(실제 시간 소비 없음).
- 타이머를 가상화(Effect `TestClock`)해서 timeout, retry 지연 test가 실제로 안 기다린다.
- 제품 process 쪽 fake 서버(`respond` 옵션)는 임의의 `Response` 객체를 돌려줄 수 있다.

### 2.5 요청 검사
- TestLLM: `requests()` 로 provider 전 normalized `LLMRequest` 목록 확인, `wait(n)` 으로 도착 대기.
- HTTP handler: `observe` 가 method, url, headers, body text 기록.
- subprocess fixture: `llm.requests` 배열에 JSON body 누적.
- cassette: matcher가 요청을 (JSON key 순서 무시, 민감값 redaction 후) 비교 = 곧 "요청이 녹화 때와 같은가" 회귀 검사.

### 2.6 fake와 진짜가 어긋나지 않게
- **진짜를 한 번 녹화**하는 방식이 중심. 첫 로컬 실행에서 cassette가 없으면 녹화(`RECORD=true` + provider API key 필요), `CI=true` 이면 cassette 없을 때 실패(녹화 안 함). 갱신은 **덮어쓰기 모드가 의도적으로 없고** cassette 파일을 지우고 재실행(이유: "갱신 대상 목록이 리뷰 가능해야 함").
- 녹화 시 redaction: 기본 header 제거, 인증 정보 패턴 검사, 환경변수 값 검사. 안전하지 않은 cassette는 기존 파일을 덮지 않고 실패. 그래도 "diff를 사람이 검토하라"고 명시.
- recorded test runner(`packages/ai/test/recorded-runner.ts`): 파일명 `.recorded.test.ts`; tag(provider, protocol, scenario)로 선택; `requires` env가 없으면 녹화 모드에서 skip; cassette 없으면 재생 모드에서 skip; 중복 cassette 이름은 오류. 같은 시나리오 정의(`recorded-scenarios.ts`)를 provider마다 돌려 기능 동등성을 본다.
- 기본 CI는 재생만 하므로 API key가 CI에 필요 없다.
- 스키마 공유: protocol 이벤트 스키마(Effect Schema)를 제품과 simulation fake가 공유(`OpenAIChatEvent`로 chunk encode). fake chunk가 제품 schema에 어긋나면 encode에서 걸린다.

### 2.7 test 층
- 패키지별 `bun test`. root에서 실행 금지(guard). timeout: 30s(ai, cli, core 등) 또는 5s 기본.
- 층: unit(대부분 in-process, TestClock), recorded provider test(재생), CLI/service subprocess test(소수; 환경 격리 helper `isolatedEnv`: HOME, XDG_*, DB 경로, config dir를 임시 root로, 모델 fetch/파일 감시/자동 업데이트 끔, transpiler cache는 공유), Playwright app e2e(OS당 2 shard, 워커 5), Storybook component test, TUI renderer test.
- CI: Linux + Windows, 4 vCPU에서 `turbo test --affected --concurrency=3`.
- core의 test runner(`script/test.ts`)가 HOME, XDG, TMPDIR을 실행당 새 dir로 지정.
- 병렬: `--isolate`/`--parallel` 금지(ai가 7.6s -> 26.3s). `mock.module` 금지(파일 간 누수).

### 2.8 교훈
- AGENTS.md: "mock을 가능한 한 쓰지 말라, globalThis 금지, 실제 구현을 test하라, 로직을 test에 복사하지 말라".
- unit-tests skill(140줄)에 flake/느림 원인이 실측 숫자로 기록: 실시간 sleep 대신 TestClock, attempt 횟수 loop 대신 ms 단위 deadline, 벽시계 시간 assert 금지, process spawn 수를 Windows 비용(약 40ms/spawn)으로 환산, git fixture 공용화(spawn 약 2,850회였던 것 감축), 고정 sleep을 "test가 release 파일을 쓰면 child가 이어서 진행"으로 교체.
- "production 구간 상수(예: 15초 bind retry)를 test가 기다리게 하지 말고 옵션으로 줄여라. 단 app 쪽은 test 전용 seam 금지".
- e2e skill: unmocked route는 501로 실패시켜 mock 누락을 숨기지 않기, 한 번만 navigate, 서비스 워커 block, 고정 sleep 금지.
- cassette의 한계: 응답 buffer라 timing 시험은 handler/TestLLM으로 나눔. cassette format에 migration 도구 없음(version 1).

---

## 3. Google Gemini CLI (`google-gemini/gemini-cli`, TypeScript + vitest)

### 3.1 fake가 끼는 곳
- **제품 안의 `ContentGenerator` interface 구현체 교체**. HTTP 레이어가 아니라 SDK(`@google/genai`) 위쪽. `packages/core/src/core/fakeContentGenerator.ts`(164줄)와 `recordingContentGenerator.ts`(125줄). 제품 binary에 CLI flag로 넣는다: `--fake-responses <file>`, `--fake-responses-non-strict <file>`, `--record-responses <file>`. 따라서 **test용 코드가 제품 binary 안에 존재**한다.
- E2E(`integration-tests/`)는 `npm run bundle` 로 만든 `bundle/gemini.js` 를 child process로 spawn(`packages/test-utils/src/test-rig.ts`, 1,735줄의 `TestRig`). 같은 rig가 sandbox(docker/podman)도 돌림.

### 3.2 대답을 정하는 법
- **순서 queue를 파일로**: `.responses` 파일 = JSON Lines. 한 줄 = `{method, response}`. method는 `generateContent`, `generateContentStream`(response는 chunk 배열), `countTokens`, `embedContent`. 엄격 모드는 호출 순서와 method가 안 맞으면 즉시 오류(메시지에 요청 JSON 포함). `non-strict` 는 "해당 method의 아직 안 쓴 첫 응답"을 꺼냄(비결정적 background 호출 대응).
- 요청 내용으로 고르는 matcher는 없다.
- integration test 하나 = `.test.ts` 하나 + 같은 이름 `.responses` 파일(약 60개, 그중 hooks-system 변형 약 20개).
- unit test는 별도로 `vi.mock`/`vi.fn` 으로 ContentGenerator나 SDK를 mock(`geminiChat.test.ts` 등).

### 3.3 streaming
- 녹화된 chunk 배열을 비동기 generator로 하나씩 내보낼 뿐. delay, 중간 끊김, 분할 같은 장치 없음. builder helper 없음(녹화 파일을 손으로 고침).

### 3.4 오류와 경계
- fake generator는 정상 응답만 낸다. 오류 응답을 fake file로 표현하는 장치 없음(`api-resilience` test는 "metadata만 있는 chunk" 같은 이상 chunk가 와도 안 죽는지만 본다).
- 429 재시도 test는 unit 수준: 제품 안 `setSimulate429` 같은 test hook, 오류 클래스(`TerminalQuotaError`, `RetryableQuotaError`)를 unit test가 직접 던진다.
- timeout은 rig 쪽(`getDefaultTimeout`: CI 60s, 컨테이너 30s, 로컬 15s; process 전체 기본 300s)만.

### 3.5 요청 검사
- fake 단에서 하지 않음. 대신 **제품의 telemetry를 파일로 출력**(OTLP outfile)해서 rig가 읽는다: `waitForToolCall`, `waitForTelemetryEvent('user_prompt')`, `waitForMetric` 등. "모델에 무엇을 보냈나"가 아니라 "제품이 어떤 tool을 실행했나"를 본다. stdout과 파일 시스템 결과도 검사.

### 3.6 fake가 진짜와 어긋나지 않게
- **녹화 flag**: `REGENERATE_MODEL_GOLDENS=true` 로 test를 돌리면 rig가 `--record-responses` 를 붙여 진짜 모델 응답(후보와 usage만 추림)을 파일에 append, `rig.cleanup()` 때 원본 golden 위치로 복사. 문서가 "내 시스템 정보가 포함됐을 수 있으니 리뷰하라" 경고. cleanup을 안 부르면 갱신 안 됨.
- 별도 층 **behavioral evals**(`evals/`, `*.eval.ts` 약 38개): 진짜 모델로 "모델이 올바른 tool을 고르는가"를 측정. `evalTest(policy, ...)` 의 policy가 `ALWAYS_PASSES`(PR 게이트) 또는 `USUALLY_PASSES`(nightly 전용, `RUN_EVALS=1`). 신규는 반드시 USUALLY_PASSES로 시작, nightly 7회 이상 후 승격. `eval:inventory/validate/report/coverage` 스크립트.
- 즉 "fake 응답(결정적, 제품 흐름)"과 "실모델(비결정적, 행동 품질)"을 파일과 workflow로 분리.

### 3.7 test 층
- unit(패키지 내 `*.test.ts` 약 914개, vitest), `integration-tests/`(약 48개 test 파일, 제품 번들 spawn, 기본 `npm test`에 포함 안 됨, `npm run test:e2e`), `evals/`, `memory-tests/`(baseline JSON과 비교, nightly; `UPDATE_MEMORY_BASELINES`), `perf-tests/`.
- 격리: rig가 test마다 임시 test dir + 임시 home(`GEMINI_CLI_HOME`), settings 파일을 만들어 auto-update 끔, folder trust 끔, telemetry는 로컬 파일. 실제 `GEMINI_API_KEY` 는 env에서 제거 가능.
- 병렬: vitest `fileParallelism` 8~16 thread, `retry: 2`, testTimeout 5분. globalSetup이 격리된 run dir 생성과 고정 포트(18923) 로컬 fixture HTTP server(브라우저 agent용)를 띄움. sandbox matrix(none/docker/podman).

### 3.8 교훈
- 문서: "새 integration test는 deflake script로 최소 5회 돌려 flaky 아님을 확인", GitHub workflow `deflake.yml`. `RUN_FLAKY_INTEGRATION` 별도 flag로 flaky 격리.
- fake 응답을 PR에서 리뷰할 때 개인정보 혼입 주의.
- 약점: 요청을 검증하지 않아 "모델에 잘못된 prompt/tool schema를 보내도" 통과. evals와 telemetry로 보완.

---

## 4. Block Goose (`block/goose`, 현재 `aaif-goose/goose`로 보임. Rust)

### 4.1 fake가 끼는 곳 (층별)
1. **Provider trait 구현을 test마다 직접 작성(in-process)**: `crates/goose/tests/agent.rs` 에 `impl Provider for ...` 가 시나리오별로 10개 이상(MultiStepProvider, ThinkingStreamProvider, EmptyThenTextProvider 등). 공용 fake 없이 struct per 시나리오.
2. **TestProvider 녹화/재생**(`crates/goose/src/providers/testprovider.rs`, 333줄): 진짜 Provider를 감싸 입력(system, messages, tools)->출력(message, usage)을 JSON 파일에 기록, 재생 모드는 **messages의 SHA-256 해시를 key** 로 찾는다(hash 전에 내부 routing 메타를 제거해 의미 있는 입력만 비교).
3. **HTTP mock(wiremock) 위에서 진짜 provider 구현을 구동**:
   - `crates/goose/src/agents/state_machine/tests/dummy_api.rs`(1,034줄): OpenAI chat completions 호환 가짜 서버. agent state machine test(모듈 14개: tool, cancellation, compaction, hooks, steering, provider lifecycle...)가 사용.
   - `crates/goose/tests/acp_fixtures/mod.rs` 의 `OpenAiFixture`: ACP(Agent Client Protocol) server/provider test용.
4. **ACP 서버를 같은 process에서 duplex stream으로 구동**(`spawn_acp_server_in_process`): 제품 binary spawn 없이 실제 서버 코드를 돌린다. 클라이언트 쪽 `Connection` trait 구현이 둘(`AcpServerConnection`, `AcpProviderConnection`)이라 같은 시나리오(`acp_common_tests/mod.rs`, `run_*` 함수 약 36개)를 두 transport로 돌림. 제품이 fake를 보게 하는 법은 임시 config yaml에 `OPENAI_HOST` 를 mock server URL로 쓴다.
5. 새 agent crate(`goose-agent`)는 `Inference`/`Operation` trait을 test 구현으로 교체(HTTP 없음, state machine 단위).
6. MCP server: 실 MCP server를 stdio로 녹화/재생하는 래퍼 binary(`crates/goose-test/src/bin/capture.rs`, `just record-mcp-tests` 가 `GOOSE_RECORD_MCP=1` 로 녹화 후 `tests/mcp_replays/` 갱신) + 자체 fixture MCP server(`goose-test-support`의 `McpFixture`).

### 4.2 대답을 정하는 법
- dummy_api: **요청을 보고 고르는 규칙 DSL**. `api.on("입력에 들어갈 문자열").reply("텍스트")` / `.call(tool, args)` / `.calls([...])` / `.reasoning()` / `.server_error()` / `.context_limit_error()` / `.output_limit()` / `.malformed_tool_call()` / `.hold_reply()`(gate) / `.times(n)`. 규칙이 입력의 문자열로 매칭되므로 호출 순서에 덜 의존한다.
- OpenAiFixture: **순서 queue + 부분 문자열 body 검사**. `(기대 body 부분 문자열, 응답 SSE 텍스트)` 쌍을 앞에서부터 소비. 불일치/예상 밖 요청은 **HTTP 417 + OpenAI 오류 형식 JSON(기대/실제 diff 메시지)** 으로 돌려 provider가 오류를 test 출력까지 전달하게 한다. 응답 SSE는 `acp_test_data/*.txt` 파일(약 18개)을 `include_str!`.
- 인라인 상수 SSE 문자열도 사용(세션 제목 생성 응답).

### 4.3 streaming
- dummy_api: 내부 함수로 `chat.completion.chunk` 이벤트 조립, chunk id를 다르게 하는 변형(`reply_with_distinct_ids`), tool call 인자를 쪼개 보내기, malformed tool call 생성.
- OpenAiFixture: 파일 그대로 body, 지연은 `with_response_delay` (모든 응답 동일 지연).
- `ResponseGate`: test가 `entered().await` 로 "요청이 도착함"을 기다리고 `release()` 로 응답을 푸는 동기화(cancel/steering test용).

### 4.4 오류와 경계
- dummy_api: 500(`server_error`, `empty_server_error`), context length 초과, choices 없음, output limit, 잘못된 tool call. 예: 서버 오류 후 다음 입력에서 복구되는지 확인.
- 429 헤더 파싱(Retry-After 상한 1시간 등)은 provider 크레이트 unit test(`goose-providers/src/http_status.rs`, wiremock 사용 crate).
- 무응답/중간 끊김 전용 장치는 못 봤음(gate로 대체).

### 4.5 요청 검사
- dummy_api가 모든 호출을 `ApiCall` 로 기록: `calls()`, `call_count()`, `input_contains`, `system_contains`, `advertises_tool(name)`, `tool_schema(name)`, `uses_model`, `session_id()`(헤더), `input_has_image`, `input_occurrences` 등. 모델에 어떤 tool schema와 system prompt가 나갔는지까지 확인.
- OpenAiFixture: session id header를 `ExpectedSessionId` 로 강제 검증(어긋나면 417).

### 4.6 fake와 진짜가 어긋나지 않게
- **진짜 provider 통합 test가 같은 repo**: `crates/goose/tests/providers.rs`(968줄). provider별 설정(필수 env 변수 목록, model, 이미지/모델 전환 지원 여부)을 표처럼 두고, **필수 env가 없으면 skip**(조용히 건너뛰고 마지막에 pass/skip/fail 요약 표 출력). `#[ignore]` 가 아니라 env로 gate. 시나리오: model listing, 기본 응답, tool 사용(MCP fixture), context length 초과 오류, 이미지, 모델 전환, thinking effort, permission allow/deny, smart approve. 로컬 CLI형 provider는 binary 유무(`which`)로 skip.
- CI: `pr-smoke-test.yml` 이 fork PR이 아닐 때 secrets(ANTHROPIC, OPENAI, GOOGLE, OPENROUTER, XAI, TETRATE)를 env로 주고 빌드된 binary로 UI 쪽 provider 통합 test(`ui/desktop` 의 `test:integration:providers`)와 shell script(`scripts/test_mcp.sh`, `test_subrecipes.sh`)를 실행. 별도로 `model-toolcall-conformance.yml` 이 매일 03:00 UTC에 OpenRouter tool-capable 상위 N개 모델에 tool call 시험(PR 게이트 아님. 주석: "실패는 보통 provider/model 회귀이지 goose 변경 때문이 아님", upstream repo + secrets가 있을 때만).
- wire 샘플 데이터(`acp_test_data/*.txt`)는 repo 파일로 고정(실제 응답 모양을 따른 것으로 보이나 갱신 자동화는 못 찾음).
- 구조 공유: dummy_api는 제품 protocol 모듈을 쓰지 않고 JSON을 직접 조립. live test가 보증.

### 4.7 test 층
- crate별 `tests/` 디렉터리(통합) + `src/**/tests` (단위, state machine 테스트는 src 안). `cargo test --locked`. env를 만지는 provider test는 전역 `ENV_LOCK` mutex + `env_lock` crate로 직렬화.
- 격리: `tempfile::TempDir`, `GOOSE_DISABLE_KEYRING=1`, HOME 지정, `Paths::config_dir()` 아래 test용 config 작성.
- UI(pnpm vitest), MCP conformance workflow, Windows 별도 job.
- 개수(대략): `crates/goose/tests/*.rs` 약 30개 파일; state machine test 모듈 14개; ACP 공통 시나리오 약 36개를 2 transport로.

### 4.8 교훈
- 문서: "테스트는 `tests/` 폴더 선호; 기능 추가하면 `goose-self-test.yaml` recipe 를 갱신해 `goose run --recipe` 로 실모델 self-test".
- env 전역 변경이 필요한 test는 mutex로 직렬화(해결책이 무거움).
- mismatch를 panic이 아닌 **provider가 소비할 수 있는 HTTP 오류(417 + 상세 diff)** 로 돌려 "어디서 어긋났는지"를 test 출력에 노출.
- 규칙 DSL(`on(needle)`)로 순서 의존을 줄임(대신 규칙 지정 부담).
- 필요 없는 곳은 `unreachable!()` 로 막는 최소 stub.

---

## 5. Aider (보너스, Python, `Aider-AI/aider`)

- **fake가 끼는 곳**: `unittest.mock.patch` 로 `litellm.completion` 이나 coder의 `send` 메서드를 함수로 교체. HTTP mock server 없음, 제품 binary spawn 없음.
- **대답**: 함수(`mock_send(*args, **kwargs)`)가 coder 내부 상태(`partial_response_content`)를 직접 채움. 순서 queue는 `MagicMock(side_effect=[...])`.
- **오류**: 재시도 test(`tests/basic/test_sendchat.py`)는 litellm 예외 객체를 `side_effect` 로 던져 rate limit, 비재시도 오류를 검사.
- **요청 검사**: `mock.assert_called_with` 로 인자 확인.
- **진짜 연동**: `benchmark/` (Docker, exercism 문제) 로 진짜 모델 성능 측정 - 수동 실행, pytest와 분리.
- **격리**: `GitTemporaryDirectory`(임시 git repo + chdir, user.name/email 지정), `IgnorantTemporaryDirectory`(Windows cleanup 오류 무시), `pytest.ini` 에서 analytics off. test 약 12,000줄, `tests/basic` 중심. E2E 없음.
- 교훈: 제품이 "한 함수(send)"를 경계로 가지면 patch만으로 충분. wire 호환은 litellm에 위임하므로 provider live test가 없다.

---

## 비교 (1~7 축)

| 축 | Codex | OpenCode | Gemini CLI | Goose |
|---|---|---|---|---|
| 1 fake 위치 | HTTP mock server(wiremock). Responses API 1종. base URL을 config/CLI override로 | 층별: in-process LLM client(TestLLM), HttpClient layer handler, cassette replay, `Bun.serve` + config로 제품 spawn, UI는 API mock | 제품 안 ContentGenerator(SDK 위 interface) 교체. CLI flag `--fake-responses`로 binary 안에서 | test별 Provider trait impl, wiremock(OpenAI chat 호환) fixture 2종, ACP server in-process duplex |
| 2 대답 정하기 | 순서 queue(+선택적 body matcher), 한 test에 여러 mount | TestLLM queue + fallback + 함수(request->response); cassette는 요청 매칭 + 반복 시 순서 | JSONL 파일 순서 queue(method 일치 확인), non-strict 옵션 | 규칙 DSL `on(needle).reply/call/error`, 또는 queue + body 부분문자열 검사(불일치 417) |
| 3 streaming | `ev_*` helper 25개 내외로 Value 조립, 임의 지연, chunk gate TCP 서버, websocket 서버 | `sseEvents()` helper, stall ReadableStream, TestLLM `failAfter/hangAfter/gate`; cassette는 buffer라 timing 불가 | 녹화된 chunk 배열 그대로(지연/끊김 없음) | 내부 chunk 조립 함수, ResponseGate, 고정 지연 |
| 4 오류/경계 | wiremock status/header 직접(429 Retry-After, failed 이벤트, 불완전 stream, 긴 delay), retry telemetry로 지연 검증 | handler에서 status/header/never/10분 sleep + TestClock, TestLLM에서 AIError 주입 | fake는 정상만. 429 등은 unit에서 예외 직접 throw, 제품 내 simulate hook | dummy_api 규칙(500, context limit, no choices, malformed tool call), 429 파싱은 provider unit |
| 5 요청 검사 | `ResponseMock` 기록 + 구조 접근자(instructions, input items, tool by name, header, call output) | TestLLM `requests()`, handler `observe`, cassette matcher | fake는 검사 안 함. telemetry 파일로 tool 호출 관측 | `ApiCall` 기록(system, tool schema, model, header, 이미지), fixture에서 session header 강제 |
| 6 어긋남 방지 | 손 JSON. live는 `#[ignore]` + API key 수동. snapshot(insta 102개) | **진짜 응답 녹화 cassette**(없으면 로컬 녹화, CI는 실패, 갱신은 파일 삭제 후 재실행, redaction), tag/요구 env로 선택, schema 공유 | `REGENERATE_MODEL_GOLDENS`로 녹화 flag, 별도 evals(ALWAYS/USUALLY, nightly, 실모델) | 같은 repo의 live provider test(env 없으면 skip + 요약), PR smoke(secrets), 일일 conformance workflow, 샘플 SSE 파일 |
| 7 test 층/격리/병렬 | 단일 integration binary에 약 250 모듈, nextest(재시도 1, 30s slow), TempDir home/cwd, 일부 group 직렬화 | 패키지별 bun test, 임시 HOME/XDG/DB 환경 helper, Playwright shard, TestClock, isolate/parallel 금지 | unit(vitest) + integration(번들 spawn, 기본 제외) + evals + memory/perf; 임시 home/dir, retry 2 | crate별 tests/, 임시 dir + config yaml, env 변경 test는 mutex 직렬화 |

---

## lophn에 맞을 것 같은 선택

lophn 조건: core daemon + agent runtime child process가 provider를 HTTP/SSE로 부름. 프로토타입, test 최소화, subprocess/server/E2E 새로 만들기 전 사람 확인. 원칙은 "깨지면 곤란한 것만". `tools/fake-provider` 가 이미 개발과 test용으로 지정돼 있음.

1. **fake의 주된 위치는 HTTP/SSE 서버 하나** (Codex, Goose 방식). lophn은 child process가 HTTP로 provider를 부르므로 "base URL만 바꾸면 되는" 위치가 제품 전체 경로(직렬화, SSE parse, 오류 매핑)를 가장 많이 덮고, harness test와 core E2E가 **같은 fake 서버**를 공유할 수 있다. Gemini식(제품 안 flag로 test 코드가 binary에 들어감)은 피한다.
2. **대답 지정은 2단**: 기본은 순서 queue(Codex, 가장 단순), 필요할 때만 "요청 본문에 이 문자열이 있으면"(Goose 규칙)을 더한다. 첫 구현은 queue + 선택적 matcher 하나면 충분. queue가 비었거나 불일치일 때는 **provider가 소비할 수 있는 HTTP 오류로 돌려주고 기대/실제를 메시지에 담는** Goose식이 디버깅에 좋다(panic/throw는 child process 안에서 원인이 묻힌다).
3. **streaming/오류 builder는 작게**: 이벤트를 JSON으로 조립하는 helper(텍스트, tool call, 완료)와 "status+header", "N번째 chunk 후 끊김", "무응답(지연)", "gate" 정도. provider wire의 모든 변형을 미리 만들지 말고 시나리오가 생길 때 추가. gate는 Codex/OpenCode/Goose 모두 cancel, 도중 interrupt test를 결정적으로 만드는 데 썼다. 시간은 sleep이 아니라 gate나 가상 시계로(OpenCode 교훈).
4. **요청 검사는 fake 서버가 모든 요청을 기록**하고 test는 구조적 접근자(tool 정의 이름, system 문구 포함 여부, 마지막 tool 결과, header)로 확인. Gemini처럼 요청을 안 보면 잘못된 prompt/tool schema를 보내도 통과한다. 접근자는 처음엔 3~4개로.
5. **fake 정확도는 "녹화 1회 + 갱신은 삭제 후 재생성" 정도만 채택**(OpenCode): provider live test(사람이 key로 실행)가 돌 때 응답 body를 저장하는 옵션을 두고, 그 SSE 샘플을 repo 파일로 두어 fake가 재생. cassette matcher 엔진까지는 만들지 않는다(OpenCode도 별도 패키지가 필요했고 timing 시험은 못 한다). 녹화 파일에 key가 남지 않는지(redaction)는 "secret 경계"이므로 live 녹화를 넣을 때만 test 대상.
6. **provider live test gate**: 기본 `deno task check` 에서는 절대 돌지 않고, 명시 task(예: `test:live`)와 env key가 둘 다 있을 때만 실행. Codex식 "key 없으면 실패"보다 Goose식 "skip + 이유/요약 출력"이 보기 편하다. Gemini의 `USUALLY_PASSES`/nightly 분리는 lophn이 model 행동 품질을 측정하기 시작할 때나 필요하므로 지금은 불필요.
7. **층 구분**: unit(순수 규칙) / harness test(agent loop를 process 없이) / core E2E(제품 전체 process, 임시 data root, fake 서버). harness는 in-process model stub(함수 하나 `request -> events`, OpenCode TestLLM, Goose Inference trait)으로 시작하면 빠르고 쓰기 쉽다. 단, HTTP/SSE 계층(제품 코드)은 fake 서버를 쓰는 소수의 test(E2E 포함)에서만 검증해 fake를 두 벌 안 만든다. 사람 확인이 필요한 E2E(process 띄움)는 대표 시나리오 몇 개(정상 turn, tool call, provider 오류, 도중 cancel)로 시작.
8. **E2E 격리**: Codex(CODEX_HOME 임시 dir + dummy key + base URL override)와 OpenCode(`isolatedEnv`: HOME, XDG, DB 경로, config dir 모두 임시 root, 자동 업데이트/파일 감시 끔)를 합친 형태. lophn은 이미 data root를 인자로 받으므로 `임시 data root + fake 서버 포트 0 + env/설정 한 곳으로 base URL 주입` 으로 충분. 포트 0으로 병렬 충돌 방지.
9. **피할 것**: 규모가 커질수록 Codex식 공용 builder(`test_codex.rs` 1,600줄)와 OpenCode식 recorder 패키지가 무거운 인프라가 된다. 시나리오마다 큰 snapshot/golden을 만드는 방식(Codex context snapshot)은 AGENTS.md의 "내부 구현은 테스트하지 않는다"와 충돌하므로 도입하지 않는다. 실시간 대기(sleep, 고정 timeout)는 OpenCode가 가장 많은 flake 원인으로 기록했다. 단일 integration binary 합치기(Codex)는 Rust 링크 시간 이유라 deno에는 해당 없음. env 전역을 바꾸는 test를 mutex로 직렬화하는 Goose식은 전역 mutable 상태 금지 규칙과 맞지 않으므로 env/경로를 인자로 받는 설계가 먼저.

## 참고 path (조사 근거)
- Codex: `codex-rs/core/tests/common/{responses.rs,streaming_sse.rs,test_codex.rs,test_codex_exec.rs,lib.rs,context_snapshot.rs}`, `core/tests/suite/{retry_after.rs,stream_no_completed.rs,live_cli.rs,abort_tasks.rs}`, `exec/tests/suite/server_error_exit.rs`, `app-server/tests/common/{mock_model_server.rs,test_app_server.rs}`, `codex-rs/.config/nextest.toml`
- OpenCode: `AGENTS.md`(Testing), `.opencode/skills/{unit-tests,app-e2e-tests}/SKILL.md`, `packages/http-recorder/README.md`, `packages/ai/{AGENTS.md,src/testing.ts,test/lib/{sse,http,openai-chunks}.ts,test/recorded-runner.ts,test/http-timeout.test.ts,test/fixtures/recordings/}`, `packages/cli/test/{acp/subprocess.ts,fixture/environment.ts}`, `packages/simulation/src/backend/{openai.ts,simulated-provider.ts}`, `packages/app/e2e/utils/mock-server.ts`
- Gemini CLI: `docs/integration-tests.md`, `integration-tests/*.responses`, `packages/core/src/core/{fakeContentGenerator.ts,recordingContentGenerator.ts,contentGenerator.ts}`, `packages/test-utils/src/test-rig.ts`, `integration-tests/{vitest.config.ts,globalSetup.ts}`, `evals/README.md`, `docs/behavioral-evals.md`
- Goose: `crates/goose/src/agents/state_machine/tests/{dummy_api.rs,mod.rs,provider_lifecycle.rs}`, `crates/goose/tests/{acp_fixtures/mod.rs,acp_common_tests/mod.rs,acp_test_data/,providers.rs,agent.rs,mcp_replays/}`, `crates/goose/src/providers/testprovider.rs`, `crates/goose-providers/src/http_status.rs`, `.github/workflows/{pr-smoke-test.yml,model-toolcall-conformance.yml}`, `Justfile`(record-mcp-tests)
- Aider: `tests/basic/{test_sendchat.py,test_coder.py}`, `aider/utils.py`, `pytest.ini`, `benchmark/`
