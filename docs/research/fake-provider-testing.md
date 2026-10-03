---
type: research
concerns: [lophn-agent/harness/provider, lophn-agent/evaluation]
---
# fake provider와 녹화 응답 테스트

## 질문

세 protocol의 요청·stream·오류를 실제 provider 없이 재현하고 받은 요청을 단언하는 방법은 무엇인가.
script·요청 매칭·record/replay·secret 제거·clock·E2E 수명을 비교한다. 실제 model 품질 eval과 결정적 테스트를 섞지 않는다.

조사일 2026-10-04. 근거 경로는 `/tmp/claude-1000/lophn-research/`의 고정 clone 기준. `[확인]`은 코드에서 읽은 사실, `[추측]`은 lophn 구현 추천, `[미확인]`은 찾지 못한 범위다. `docs/dev/stack.md`가 정한 `tools/fake-provider/` 로컬 HTTP server·`fixtures/model/` script/녹화·테스트/E2E 실제 호출 금지와 `lophn-agent/evaluation#R21–R22`의 분리를 따른다. protocol event 순서·429 분류 등의 fixture 목록은 [provider-adapters.md](provider-adapters.md)의 구현 메모에 이미 있으므로 여기서는 fixture 실행 방식·통제 경계만 추가한다.

## 프로젝트별

### Gemini CLI (fb972b2f87fe)

**프로세스 안 interface 대체.** `[확인]` `gemini-cli:packages/core/src/core/fakeContentGenerator.ts` `FakeResponse`(21–37)는 method와 response의 union이다. `FakeContentGenerator`는 실제 ContentGenerator interface를 구현하며 Google native generateContent/generateContentStream/countTokens/embedContent를 지원한다. HTTP Messages/Responses/Chat Completions server가 아니다. stream은 응답 객체 배열을 AsyncGenerator로 순서대로 yield(130–145); SSE bytes·header·TCP chunk·끊김 검사는 이 경계를 통과하지 않는다.

**응답 순서와 매칭.** `[확인]` constructor는 structuredClone한 배열을 가진다(63–68). `fromFile`(70–81)은 빈 줄을 뺀 NDJSON 각 줄을 JSON.parse한다. strict 기본은 callCounter로 다음 응답을 소비하고 method mismatch 또는 응답 소진에 throw(100–111). `nonStrict`는 요청 method와 맞는 첫 응답만 찾아 splice(87–98)하므로 background task 순서 차이를 견딘다. 요청 body 의미는 매칭하지 않는다. mismatch 설명은 request를 `safeJsonStringify`로 내보낸다. JSON 안전 직렬화만으로 credential/사용자 자료 redaction이 된다고 인정할 수 없다.

**녹화.** `[확인]` `gemini-cli:packages/core/src/core/recordingContentGenerator.ts` `RecordingContentGenerator`는 실제 generator를 감싼다. generate는 candidates/usageMetadata만, stream은 모든 candidates/usageMetadata를 배열로 모아 stream 종료 뒤 한 NDJSON 줄로 append(42–93)한다. countTokens·embed도 각 method 결과 일부만 기록한다. request·header·error·시간·transport chunk boundary는 저장하지 않는다. stream iteration이 throw하거나 소비 중 취소되면 마지막 append까지 도달하지 않을 수 있다. 명시 secret 검사/치환은 읽은 recorder 함수에 없다 `[확인]`; 저장소 전체 redaction 보장은 `[미확인]`이다.

**integration process.** `[확인]` `gemini-cli:packages/test-utils/src/test-rig.ts` `setup`(375–410)은 fakeResponsesPath를 testDir/fake-responses.json으로 복사한다. CLI args 생성(548–556)은 record mode면 `--record-responses`, 그 외 strict/nonStrict fake flag를 붙인다. cleanup(1024–1031)은 record mode 파일을 원래 golden 경로로 복사한다. subprocess 기본 timeout 300000ms(761); home/testDir는 분리하지만 `_getCleanEnv`(659–688)는 host env/API key를 유지한다. `gemini-cli:integration-tests/concurrency-limit.test.ts`는 fixture path를 rig에 주고 web_fetch rate-limit tool log를 검사한다(24–48). 이는 model 응답을 fake로 만드는 사례이며 모든 integration test가 외부 network를 차단한다는 뜻은 아니다. 예를 들어 읽은 write_file 테스트에는 fakeResponsesPath 지정이 없다.

**한계.** `[확인]` fake의 response union에는 HTTP status·header·delay·error injection field가 없다. invalid array/빈 response/stream 소진은 자연스러운 throw로 테스트할 수 있지만 429/5xx 또는 transport 단절을 native SDK boundary 아래에서 재현하지는 않는다. clock 주입은 이 class에서 `[미확인]`. lophn은 native Gemini protocol을 지원하지 않으므로 이 wire 모양을 가져오지 않는다(`provider#R3`).

### Pi (83692682f095)

**model 내부 fake.** `[확인]` `pi:packages/ai/src/providers/faux.ts` `fauxProvider`(687–710)·`createFauxCore`(437–675)는 Models collection에 fake Provider와 stream/fetchDeferred/cancelDeferred 함수를 등록한다. baseUrl `http://localhost:0`는 model metadata이며 network server를 띄우는 것이 아니다. 기본 model faux-1/context 128000/maxTokens 16384, text+image, 비용 0(463–487). 제공하는 stream은 Pi의 `AssistantMessageEventStream`; HTTP 세 protocol SSE가 아니다.

**script·요청 단언.** `[확인]` `FauxResponseStep`(109–116)은 AssistantMessage 또는 factory(context, options, state, model)다. `setResponses`/`appendResponses`/`getPendingResponseCount`(665–672)와 FIFO shift(505–508)를 제공한다. factory 안에서 받은 transcript·model·sampling을 직접 단언할 수 있다. state는 callCount/deferredFetchCount/cancelledDeferred(103–107). response 소진은 `No more faux responses queued` error message로 끝난다(513–523); 자동 반복하지 않는다. HTTP header 검사는 안 된다. `onResponse`는 합성 status 200/빈 headers(512)를 호출한다.

**stream·시간·오류.** `[확인]` `streamWithDeltas`(339–435)는 text/thinking/toolcall start/delta/end와 done/error를 만들어 준다. abort는 partial content를 aborted message로 보존한다. pending stopReason은 오류로 바뀐다. factory throw는 error stopReason이다. 기본 chunk는 random token size 3..5(29–30, 270–279), chunk마다 queueMicrotask 또는 tokensPerSecond 기반 실제 setTimeout(331–337). ID에 Date.now/Math.random, timestamp에 Date.now(162–164, 99)를 쓴다. fake라는 이름만으로 결정적이지 않다. deferred pendingFetches는 바닥 0으로 floor, pollAfterMs와 취소 기록을 지원(526–543, 569–643). clock/random injection은 이 구현에서 `[미확인]`.

**usage의 성격.** `[확인]` `withUsageEstimate`(230–268)는 문자 4개/token 근사와 sessionId별 prompt 공통 prefix로 fake usage/cache를 계산해 원래 response usage를 대체한다. 실제 provider 보고 usage 검증 fixture로 쓰면 안 된다. lophn은 보고 누락과 0을 구별하므로 HTTP fixture에서 값을 그대로 내보내야 한다.

**adapter 아래의 별도 fake.** `[확인]` `pi:packages/ai/test/anthropic-sse-parsing.test.ts` `createSseResponse`(9–15)는 event/data 문자열로 Response를 만들고 `createFakeAnthropicClient`(72–82)는 `beta.messages.create().asResponse()`를 가짜로 구현한다. test는 실제 Anthropic adapter/parser를 통과한다. faux보다 낮은 경계이지만 여전히 소켓 없는 Response이므로 DNS/header 송신/TCP chunk는 검사하지 못한다. 이 차이는 unit fake와 HTTP 통합 fake를 별도로 두어야 하는 근거다.

### Codex (3a69ec3ef8fb)

**로컬 HTTP mock과 real request.** `[확인]` `codex:codex-rs/core/tests/common/responses.rs` `start_mock_server`(1203–1213)는 wiremock MockServer를 띄우고 `/models` 빈 목록도 기본 제공한다. body debug print 상한 80000 bytes. `sse`(753–766)는 event type에서 `event:`를 만들고 JSON을 `data:`로 쓴다. `sse_response`(1083–1087)는 200/text-event-stream raw body. `base_mock`(1115–1121)은 POST 및 `.*/responses$`를 매칭한다. 읽은 helper는 OpenAI Responses용; Messages/Chat Completions 지원은 `[미확인]`이다.

**FIFO·매칭·호출 수.** `[확인]` `mount_response_once_match`/`mount_sse_once_match`는 임의 wiremock Match를 추가한다(1098–1142). `mount_sse_sequence`/`mount_response_sequence`(1466–1548)는 AtomicUsize로 순서대로 body/ResponseTemplate를 고르고 `.expect(num_calls)`로 exact call count를 검증한다. 소진 responder는 panic 경로이며 mount 횟수 상한도 걸린다. 응답 status/headers/body/delay를 script에 직접 넣을 수 있다. `mount_models_once_with_delay`(1166–1182)는 ResponseTemplate.set_delay를 쓴다.

**요청 log·header·인자 invariant.** `[확인]` `ResponseMock`(40–82)은 mutex Vec에 받은 요청을 저장하며 single_request(정확 1개 아니면 panic), requests, last_request, saw_function_call, function_call_output_text를 제공한다. `ResponsesRequest.body_json`(201–210)은 content-encoding zstd면 decode한다. `header`/`path`/`query_param`(416–435)과 message/tool extraction helpers가 있다. `impl Match for ResponseMock`(738–749)는 capture할 때 `validate_request_body_invariants`를 실행한다. 이 predicate는 orphan tool output·대응 안 되는 call/output을 검사한다(1550 이후 설명 및 함수). tool ID/call ID 대응을 protocol 테스트에서 단언하는 것과 agent 품질 eval에서 exact tool 순서를 요구하는 것은 다르다.

**오류 주입 사례.** `[확인]` `codex:codex-rs/core/tests/suite/client.rs` `usage_limit_error_emits_rate_limit_event`(3489 이후)은 실제 HTTP 429, rate-limit headers/body, `.expect(1)`로 상태 변환을 확인한다. `sse_failed`(1073–1081)는 response.failed event를 만든다. 완료 event를 빼서 truncated stream을 만들 수 있다. 읽은 SSE helper는 전체 body 문자열이므로 TCP chunk별 지연/중간 reset을 자동 재현하는 helper라고 부를 수 없다 `[확인]`; 별도 raw TCP/stream transport는 이 범위에서 `[미확인]`.

**fresh env·clock·E2E client.** `[확인]` `codex:codex-rs/core/tests/common/test_codex.rs` `TestCodexBuilder.with_external_time_provider`(559–561)는 TimeProvider를 주입하고 `build`(577–589)는 새 TempDir home+test local env+mock server /v1 base URL을 연결한다. `codex:codex-rs/app-server-test-client/src/loopback_responses_server.rs` `LoopbackResponsesServer.start`는 127.0.0.1:0 listener·thread·shutdown flag, read timeout 2초, /responses 200 SSE 또는 404, Drop에서 join을 구현한다. 이 helper는 created/completed와 0 usage만 답하는 좁은 smoke server다. `app-server-test-client/src/lib.rs` `CodexClient.spawn_stdio_with_env`(1628 이후)는 app-server child를 띄우고 config override를 받는다. test client 존재를 실제 provider 품질 eval 증거로 삼지 않는다.

### OpenCode (907b3bc518fa)

**record/replay layer.** `[확인]` `opencode:packages/http-recorder/src/internal-effect.ts` `recordingLayer`(93–181)는 Effect HttpClient를 대체하며 auto/record/replay/passthrough mode를 둔다. `opencode:packages/http-recorder/src/recorder.ts` `resolveAutoMode`(11–18)는 CI면 replay, 로컬은 cassette 있으면 replay/없으면 record다. 테스트에서 fixture가 없다고 유료 network를 자동 호출하는 정책은 lophn에 가져오지 않는다.

**cassette wire·매칭.** `[확인]` `opencode:packages/http-recorder/src/schema.ts` `CassetteSchema`는 version 1, optional metadata, HTTP/WebSocket interaction 배열이다. HTTP request는 method/url/headers/body string, response는 status/headers/body 및 optional text/base64 bodyEncoding이다. `cassette.ts` `buildCassette`(55–63)는 recordedAt metadata를 붙인다. `matching.ts` `canonicalizeJson`/`canonicalSnapshot`(11–37)은 object key만 정렬하고 array order는 보존한다. `selectSequential`(95–106)은 오직 다음 interaction과 매칭; mismatch diff를 낸다. `makeReplayState`(26–62)는 synchronized cursor로 동시 claim을 serialize하고 mismatch에서는 cursor를 증가시키지 않는다. finalizer는 하나 이상 소비한 뒤 남은 interaction이면 실패한다; **0개 소비했을 때는 그대로 통과**(38)하므로 lophn teardown은 별도로 expected count 전체를 검사해야 한다.

**stream replay 한계.** `[확인]` `captureResponseBody`(55–62)는 arrayBuffer로 response 전체를 읽고 text/event-stream이면 문자열로 기록한다. `responseFromSnapshot`은 하나의 새 Response를 만들어 돌려준다(67–76). cassette에는 chunk timestamp/boundary/reset/전송 오류가 없다. SSE event bytes를 보존해 parser 회귀에는 쓸 수 있지만 idle timeout·취소 racing·물리적 stream 분할을 녹화 그대로 재현하지는 못한다. record mode도 실제 stream을 먼저 전부 buffer한 뒤 caller에 반환한다(130–150).

**redaction·저장 실패.** `[확인]` `opencode:packages/http-recorder/src/redactor.ts` 기본 request header allowlist는 content-type/accept/openai-beta, response는 content-type(8–9). `make`(104–127)는 URL auth/query·sensitive header·recursive JSON secret fields를 처리하고 custom URL/body transform을 마지막에 적용한다. `redaction.ts` `secretFindings`(106–117)는 token pattern 및 secret-like env 값(12자 이상)을 검사한다. `cassette.ts` `append`(104–123)는 secret 후보가 있으면 UnsafeCassetteError로 쓰기를 거절하고 mutex permit 아래 tmp file→rename한다. **SSE body는 JSON 한 문서가 아니어서 recursive JSON field 제거를 적용받지 않는다**(`redactBody`, 96–102); secretFindings가 알려진 pattern을 잡거나 custom body transform이 있어야 한다. arbitrary 개인 정보나 새 token 형식까지 제거한다는 보장은 없다.

**오류 fixture header 주의.** `[확인]` cassette에는 status 429/5xx/body를 보존할 수 있으나 기본 response headers는 content-type뿐이다. Retry-After·rate reset header는 `allowResponseHeaders`로 명시 추가하지 않으면 사라진다. lophn 429의 30초 경계/사용량 대기를 잘못 테스트하게 되는 중요한 차이다. secret-looking header는 allowlist에 넣어도 redaction되어야 한다.

**진짜 local server.** `[확인]` `opencode:packages/opencode/test/lib/llm-server.ts` `TestLLMServer`(637 이후)는 `/v1/chat/completions`와 `/v1/responses` 두 endpoint를 등록한다(702–703). Chat response builder를 Responses event로 변환(`responses`, 332–410)하며 Messages endpoint는 읽은 server에 없다. queue FIFO 또는 `pushMatch` predicate가 가능한데 pull은 첫 match 또는 무조건 entry를 찾는다(664–669). received Hit은 URL/body만 저장(18–21); raw header는 이 log로 단언하지 못한다. calls/inputs/pending/wait(count)를 제공한다. **queue miss는 error가 아니라 'ok' 정상 응답**, title 요청도 자동 E2E Title을 답한다(675–689). misses collection은 반환 interface가 있어도 handle의 miss branch에서 push가 보이지 않는다. lophn에서는 이 관대한 fallback을 버린다.

**제어 가능한 stream.** `[확인]` `Reply`(452–562)는 text/reason/tool/pendingTool(인자 절반)/usage/stop/contentFilter/toolCalls, `wait(PromiseLike)`, hang/streamError/reset를 제공한다. `send`(418–430)는 head→wait gate→tail→[DONE] 후 hang 또는 Stream.fail을 붙인다. `reset`(433–442)은 node response.destroy로 실제 연결을 끊는다. 다만 Responses branch는 reset 처리 전에 `send(responses(...))`로 return(694–699)하여 **reset은 읽은 코드상 Chat branch에서만 적용**된다. Responses 변환은 단일 `call` accumulator를 쓰고 completion을 합성하므로 multi-tool/임의 incomplete wire를 모두 검증할 수 없다. semantic builder 외에 raw protocol fixture가 필요하다.

**process fixture 수명.** `[확인]` `opencode:packages/opencode/test/lib/cli-process.ts` `withCliFixture`(189–205, 469–479)는 temp home·server layer·cleanup을 Scope에 묶는다. `isolatedEnv`(62–77)는 HOME/XDG root, config 내용, project config/model fetch/autoupdate 비활성, auth `{}`를 준다. `test-provider.ts` `testProviderConfig`는 supplied llmUrl+test-key+test/test-model로 OpenAI-compatible SDK를 설정한다. child 기본 timeout 30000ms, timeout kill finalizer가 child 종료 후 결과를 내게 한다(207–241). host env를 extend하므로 lophn에서는 더 강한 env allowlist와 network allowlist가 필요하다.

### LangChain (57236d55d9ff)

**프로세스 안 model fake.** `[확인]` `langchain:libs/core/langchain_core/language_models/fake_chat_models.py` `FakeMessagesListChatModel`(21–47)은 BaseMessage 배열, `FakeListChatModel`(59–189)은 text 배열을 순서대로 반환하고 끝이면 i=0으로 **순환**한다. sleep option은 실제 time.sleep/asyncio.sleep, stream은 문자 하나씩 chunk를 만들고 지정 error_on_chunk_number에서 FakeListChatModelError를 낸다. 마지막 문자에 chunk_position=last. batch/abatch는 동시성을 끄고 입력 순서를 지킨다(156–189). HTTP·headers·SSE wire는 건너뛴다. lophn은 응답 소진 자동 순환을 쓰면 예상 밖 call을 숨기므로 버린다.

**tool/callback fake.** `[확인]` `GenericFakeChatModel`(227–371)은 Iterator의 다음 AIMessage/text를 받고 whitespace와 additional_kwargs.function_call 문자열을 쪼개 callback을 보낸다. docstring은 streaming 미구현 경고를 쓰지만 실제 `_stream` 구현이 아래에 있다; 구현이 근거다. iterator 소진은 다음 응답으로 넘어가지 못한다. tool JSON 인자 protocol 확정 경계와 네트워크 partial을 이 fake만으로 테스트할 수 없다. request 자체는 _generate 인자로 받지만 fake class는 기본 request log/header 검사 기능을 제공하지 않는다.

**표준 테스트와 VCR.** `[확인]` `langchain:libs/standard-tests/langchain_tests/unit_tests/chat_models.py` `ChatModelTests.enable_vcr_tests` 기본 false(222–230). integration `chat_models.py` `test_stream`(823 이후)의 주석은 stream 기본 구현이 invoke 결과 한 chunk를 내므로 테스트 통과가 실제 streaming 구현 증명은 아니라고 명시한다. `_validate_tool_call_message`(117–134)는 name/args/id와 normalized content_blocks를 검사한다. interface/normalized event 테스트와 transport 테스트를 분리해야 한다.

`[확인]` `langchain:libs/standard-tests/langchain_tests/conftest.py` `base_vcr_config`(130–143)는 record_mode once, match_on method/uri/body, allow_playback_repeats true, decode_compressed_response true, tests/cassettes, suffix .yaml이다. authorization/x-api-key/api-key는 PLACEHOLDER로 filter(120–127). optional `CustomSerializer`(44–83)·`CustomPersister`(86–115)는 BytesIO→bytes로 정규화하고 yaml.safe_dump/load+gzip을 쓴다(파일 판은 별도 등록 시 yaml.gz). 이것이 모든 provider cassette에 자동 적용된다는 뜻은 아니다. query/body/응답 PII 전체 redaction은 이 기본 config에서 확인되지 않는다. once mode는 missing cassette에서 live record할 수 있고 playback repeat는 unexpected extra call을 숨길 수 있어 lophn 기본으로 부적합하다. E2E local server 수명·fake clock은 읽은 fake/standard-tests 범위에서 `[미확인]`이다.

## 비교

| 질문 | lophn 선택 | Gemini CLI | Pi | Codex | OpenCode | LangChain |
|---|---|---|---|---|---|---|
| fake 경계 | local HTTP+필요하면 내부 contract fake | 내부 ContentGenerator | 내부 Provider 및 fake SDK Response | wiremock/local TCP server | HttpClient layer+local server | 내부 ChatModel+VCR |
| protocol | Messages·Responses·Chat Completions | Google native 객체 | faux normalized; 별도 Messages parser test | Responses | server Chat/Responses; recorder HTTP 일반 | normalized message; wire는 partner별 |
| stream | raw SSE와 chunk/gate/reset script | 객체 array yield | normalized delta; fake Response SSE | event/data body | event SSE+hold/hang/error/reset | 문자/word callback chunk |
| 응답 선택 | 기본 strict script+명시 predicate 매칭 | strict 순서; nonStrict method 매칭 | FIFO message/factory | 순서+wiremock Match+expected call 수 | cassette 다음 요청 비교; server 첫 match | 배열 순환/iterator |
| record 형식 | versioned 안전한 request/response+raw SSE/chunk manifest 추천 | method/response NDJSON | faux record 기능 미확인 | 일반 recorder 미확인; synthetic SSE | JSON v1 cassette, HTTP/WS, text/base64 | VCR YAML; optional gzip |
| secret | allowlist·field redaction·scan·사람 검토; unsafe 기록 거절 | recorder 명시 제거 미확인 | fake만; 기록 없음 | 합성 fake만; capture는 테스트 메모리 | header/query/JSON 제거+secret scan; SSE 별도 필요 | 기본 auth header filter; body/query 추가 필요 |
| 429/5xx/중단 | status/header/delay/reset/partial별 script | dedicated field 없음 | error/aborted normalized; HTTP status 아님 | ResponseTemplate·failed SSE | httpError·streamError·hang·Chat reset | chunk error; HTTP는 VCR |
| 시간 | fake clock+event gate; HTTP real-time 별도 smoke | clock 미확인 | 실제 timer/random chunk | external TimeProvider+response delay | Promise gate/Stream.never | 실제 sleep |
| 요청 단언 | count·safe log·header allowlist·body·tool ID 대응 | method/request mismatch 설명 | factory context/options/state | body/header/query log+invariant | cassette header/body diff; server Hit은 URL/body만 | `_generate` 인자/표준 output 검사 |
| miss/남은 응답 | fail closed; 기대 0 call도 정확 검사 | mismatch/exhaust throw; 잔여 검사 미확인 | 소진 error; pending count | exact expect | cassette 0소비면 잔여 검사 skip; server miss 정상 ok | cyclic response/repeat replay 가능 |
| offline gate/E2E | 테스트/E2E live 0회, 새 core DB/home·scope cleanup | CLI fake flag; host env 유지 | faux는 in-process | fresh TempDir+loopback app-server smoke | scope-tied fake server+child/temp home | fake instance/VCR; server E2E 미확인 |

## lophn에 가져올 것과 버릴 것

- **provider#R3·R25:** Codex의 HTTP SSE+request capture, OpenCode의 local server·semantic Reply와 raw path를 가져온다. lophn 세 protocol별 **실제 adapter가 HTTP로 요청을 보내게** 하며 unit contract fake는 별도다. Gemini native method fake/Pi faux/LangChain normalized fake를 protocol parser 검증으로 간주하지 않는다.
- **provider#R5·R7·R15–R16:** loopback port 0 binding과 supplied fake base URL을 가져온다. 무인증 loopback을 기본으로 쓰고 인증 검사가 필요한 테스트의 합성 token은 fake secrets contract로만 주입한다. OpenCode의 평문 apiKey config는 lophn에 가져오지 않는다. fixture와 log에는 실제 secret을 넣지 않는다. header 값 검사는 합성 token으로만 하고 model ID/tool name/user-agent 위장 여부를 독립 단언한다. auth `{}`+isolated home만으로 host keychain·network가 차단된다고 가정하지 않는다.
- **provider#R17–R24:** factory/script로 status/header/state를 제어하고 요청 수·clock을 단언한다. SDK hidden retry를 꺼 실제 wire call count를 본다. record에서 Retry-After/reset header를 제거하지 않는다. 일반 VCR header replay만으로 429 reset/delay 테스트가 됐다고 하지 않는다.
- **provider#R25–R27:** synthetic SSE normal/partial/error wire와 usage missing/null/zero를 고정한다. Pi 문자/token 근사 usage·OpenCode 없는 usage 기본 0 합성은 lophn 보고 usage 테스트에 쓰지 않는다. opaque reasoning/control fields는 JSON 정규화에서 삭제하지 않고 synthetic 안전 값으로 대응을 보존한다.
- **provider#R2·R29–R30:** model/catalog route와 명시 연결 테스트가 호출하는 model endpoint도 fake로 받게 한다. unknown path·catalog miss가 실제 provider로 fallback하지 않는다. explicit connection test의 30초/실제 호출수는 주입 clock+safe request log로 검증한다.
- **evaluation#R7–R8·R21–R22, dev/stack·dev/tasks:** fake provider server·fresh fixture DB·fake MCP·clock·owner contract를 별도로 조립한다. fake 결과는 품질 EvalTrialResult의 mode real_model에 등록하지 않는다. 녹화는 실제 호출을 하므로 테스트 초기 setup/CI에서 자동 record하지 않는다; 사람이 실제 provider 사용을 지시한 별도 개발 command에서만 한다.
- **evaluation#R11:** replay mismatch/파일 불량/소진을 품질 성공 또는 agent 실패로 위장하지 않는다. 결정적 테스트에서는 harness 실패, 실제 eval 자료 replay 결함이면 evaluation_error로 구별한다.

### open-issues 후보

1. **provider#R7 및 stack의 녹화 fixture:** snapshot metadata/body에 arbitrary PII와 unknown secret이 들어갈 수 있다. field redaction/pattern scan만으로 안전을 보장할 수 없다. **추천:** 녹화 입력 자체를 합성 최소 자료로 제한하고 recursive JSON/SSE event redaction+env secret scan+사람 diff 검토 뒤 version 채택한다. recorder는 unsafe 값 발견 시 저장을 거절한다. operational trace를 자동 fixture로 전환하지 않는다.
2. **evaluation#R21–R22 및 dev/stack의 script/record:** missing fixture 자동 record는 Gemini/OpenCode/VCR에서 흔하지만 lophn의 test live 0회와 충돌한다. **추천:** 기본 replay-only/fail-closed; 별도 explicit record command에 사람 gate 및 `LOPHN_LIVE_PROVIDER=1` 둘 다 적용한다. env flag만 켜져 있다고 테스트/E2E가 live fallback하는 경로는 만들지 않는다.
3. **provider#R25:** semantic reply를 세 protocol로 변환할 때 incomplete/reset/multi-tool 동작을 자동 정상화할 위험이 있다(OpenCode Responses reset 분기, 단일 call accumulator에서 확인). **추천:** semantic scenario는 정상 흐름 편의로만 쓰고 오류·partial·opaque replay·multi-tool은 protocol raw fixture로 작성한다. 변환 모드가 넣은 종료 event를 raw fixture에는 합성하지 않는다.

## 구현 메모

### 권장 경계와 파일 모양

`[추측]` `tools/fake-provider/`는 세 protocol route+script dispatcher+safe request log+stream transport를 맡는다. `fixtures/model/`은 immutable versioned synthetic script/녹화 자료다. 제품 `packages/lophn-agent/...`에 테스트용 fake protocol을 추가하지 않는다. test는 base URL contract로 기존 provider adapter를 사용한다. 모델 없는 run-loop 단위 테스트는 HTTP를 건너뛴 fake contract를 쓸 수 있다.

```ts
// 개발 도구 값 제안; 제품 domain contract가 아니다.
type FakeStep = {
  id: string;
  protocol: "messages" | "responses" | "chat_completions";
  match: { method: string; path: string; body?: unknown; headers?: Record<string, string> };
  response: { status: number; headers: Record<string, string> };
  chunks: Array<{ bytes: string; gate?: string; delay_ms?: number }>;
  end: "close" | "reset" | "hold";
};
```

bytes가 UTF-8/raw binary 경계를 정확하게 나타내야 하면 base64 encoding을 명시한다. string slice는 UTF-8 byte split과 다르다. fixture manifest에 schema version·protocol·model/SDK/adapter 판·recording 정책 판·source revision·입력 hash·합성 자료임을 넣는다. 요청 matcher와 응답 normalization은 별개이며 array/tool order를 정렬하지 않는다. step ID/expected count는 데이터 저장 key이지 model prompt에 보내는 정보가 아니다.

짧은 녹화 값 예시(제안):

```json
{"version":1,"protocol":"responses","metadata":{"source_revision":"fixed","redaction_version":"fixed"},"interactions":[{"request":{"method":"POST","path":"/v1/responses","headers":{"content-type":"application/json"},"body":{"model":"fixture-model","stream":true}},"response":{"status":429,"headers":{"content-type":"application/json","retry-after":"10"},"body":"{\"error\":{\"type\":\"rate_limit\"}}"}}]}
```

fixture schema에는 credential 원문을 두지 않는다. raw body `event/data` JSON은 event별 decode→redaction→encode하거나 token scan을 하고, parser 오류 사례는 합성 byte로 만든다. redaction이 call ID 대응·opaque signature·stream 종료 의미를 훼손하면 그 녹화는 semantic replay 증거가 아니다.

### matcher·request log

- 기본은 다음 step exact match+소진/잔여 검사. 요청 body JSON의 object key만 canonicalize한다. model/messages/tools/permission/sampling field 변화는 그대로 mismatch로 드러낸다.
- 동적 temp root·timestamp·ID는 **지정 field만** deterministic placeholder로 정규화한다. tool call ID와 response item ID의 참조 관계는 bijection map으로 유지한다; ID 전체 삭제는 대응 결함을 숨긴다.
- background title/utility call은 명시 matcher를 붙인다. matching step이 여럿이면 ambiguous mismatch로 실패한다. 무조건 'ok' fallback, 첫 catch-all에 먹히기, cyclic 응답은 금지한다.
- 한 request가 atomic하게 한 step을 소비한다. concurrency test는 각 logical run/session별 queue 또는 명시 matcher로 독립하고, response 도착 순서가 아니라 request 접수 순서를 기록한다. call count·미사용 step·unexpected request 모두 teardown에서 단언한다; 0개 소비도 검사한다.
- log는 seq·method·path·safe header·safe body hash/projection·matched step·abort/disconnect로 한정한다. credential/body 원문을 mismatch 오류에 찍지 않는다. count/ID correspondence/selected headers 검사는 E2E 완료 후에도 runner가 볼 수 있게 한다.

### 시간과 오류

| 제어 | 권장 방식 | 확인할 경계 |
|---|---|---|
| run-loop deadline/retry/reset | 주입 fake clock | 30초 경계, 1시간 대기, 재기동 뒤 대기, hidden retry 0회 |
| response 시작/중간 지연 | 이름 있는 gate를 test가 release | 응답 미시작/partial 중 취소·steering, core read/write 진행 |
| stream silent | hold until test release/cancel | wall-clock sleep 없이 waiting·abort 상태 확인 |
| TCP split/reset | raw HTTP stream transport 별도 | event 두 chunk, UTF-8 byte split, reset 전 body 일부 수신 |
| status 오류 | status+safe headers+synthetic body | 401 refresh 1회/재전송 1회, 429 두 분류, 5xx, unknown |
| truncated/invalid | 완료 marker 제거·partial JSON·잘못된 bytes | complete로 추정하지 않음, uncommitted tool 미실행 |
| server startup failure | bind/init/readiness 실패 주입 | 실제 provider fallback 0회, child/port/DB cleanup |

HTTP 소켓 wall clock 자체는 fake clock이 자동으로 움직여 주지 않는다. product clock과 test gate를 분리해 연결하고, transport timeout smoke만 짧은 실제 timer로 확인한다. 외부 server를 fake clock으로 제어하려면 control channel로 gate/advance를 보낸다. 무작위 chunk·Date.now ID를 그대로 쓰지 않는다. 시각/ID/random seed는 dev/tasks 지침대로 주입한다.

### fixture 유지·다시 녹화

`[추측]` SDK/adapter/protocol 판 변경 또는 request matcher mismatch가 나면 먼저 원인을 diff로 확인한다. 전부 다시 녹화하여 diff를 없애지 않는다. bug fix는 synthetic script를 먼저 남긴다. 진짜 provider wire 변화 확인이 필요한 경우만 사람이 record command를 지시한다.

1. 합성 입력·예상 request shape·선택 model/protocol·SDK/adapter 판·redaction 판을 고정한다.
2. 실제 key는 runner의 단기 secret 경계에만 넣고 실제 인증 목적지로 보내는 header 외에는 전달하지 않는다. 저장된 request header·오류 log·fixture에는 쓰지 않는다.
3. stream event/data·HTTP status·분류에 필요한 header를 수집한다. 시간/chunk boundary는 별도 schema가 없으면 보존했다고 하지 않는다.
4. allowlist redaction→JSON/event 정규화→secret scan→사람 diff 검토. 저장 전 unsafe면 거절한다. 임시 원문은 프로젝트 fixture 폴더 밖 제한된 scratch 경계에서만 다룬다.
5. 새 fixture version으로 채택하고 이전 fixture/hash를 남긴다. provider 장애로 녹화가 incomplete면 정상 응답으로 승격하지 않는다.
6. CI/test는 replay-only이며 missing/version mismatch/잔여/소진은 harness 오류. record 모드 switch를 일반 test flag로 자동 선택하지 않는다.

### E2E 수명과 offline 보장

`[추측]` OpenCode Scope·Codex loopback smoke를 Deno/Playwright 경계에 맞춰 가져온다.

1. fresh temp root와 파일 SQLite(core·앱 DB), project fixture, fake MCP를 만든다. HOME/XDG/제품 data root를 격리하고 operational root/secret/MCP discovery를 끈다.
2. fake provider를 **127.0.0.1:0**에 bind하고 readiness 결과로 실제 port를 받는다. 세 endpoint·model catalog 필요 부분 외 unknown path는 실패한다.
3. runner-only control interface로 script를 주입한다. product에는 base URL+test-only 선택 model/credential contract만 준다. control secret/queue 조작은 model tool에 노출하지 않는다.
4. shell/core/runtime을 fake 목적지 config로 띄운다. Deno host/network allowlist를 loopback fake에 제한하고 모든 live provider URL 호출 시 즉시 테스트 실패하게 한다. host env를 전체 상속하지 않는다. Playwright flow는 UI와 실제 final state를 검사한다.
5. product child 종료를 기다린 뒤 request assertions를 수행하고 server/MCP/DB/폴더를 scope finally에서 정리한다. timeout도 child kill+await를 먼저 보장한다. listener/child가 다음 테스트에 남지 않게 한다.

이 E2E는 provider parser·run-loop·approval·core effect 제어를 검증한다. 실제 model의 판단 능력·readability·evidence fidelity 품질은 별도 actual eval이다.

### 추가할 테스트 시나리오

protocol 상세 byte 목록은 provider-adapters 문서의 10개 scenario를 재사용하고 다음 실행기 경계를 더한다.

- strict match 성공/mismatch/소진/잔여/0-call; 실패 후 cursor 안 이동; 동시 두 요청의 unique step 소비.
- 합성 secret이 query/header/recursive body/SSE event/error 설명에 섞였을 때 노출 0개; scanner가 모르는 형태는 합성 입력 제한과 사람 diff 검토로 보완(자동 검출 보장 아님).
- 429 녹화에서 Retry-After 유지; default allowlist가 필요한 rate header를 지웠으면 schema 검증에서 실패.
- semantic builder와 raw fixture를 구별; raw partial/incomplete/reset에 종료 event가 자동 합성되지 않음.
- server 시작 실패·catalog route 누락·queue miss→live fallback 0회; `LOPHN_LIVE_PROVIDER=1` env만 있어도 일반 test live 0회.
- hold 중 cancel/steering, partial tool 인자 뒤 reset, abort 뒤 남은 byte 도착, request log는 실제 시도 수와 일치.
- same fixture 두 E2E의 state/clock/script cursor/home/DB 독립; cleanup 중 오류도 test failure로 보고.
- recorder schema/SDK 판 변화에 explicit re-record 필요; 이전 hash/fixture 결과를 덮지 않음.

### 확인하지 못한 것

Codex의 일반 record/replay recorder와 세 protocol 공통 fake 지원, Pi faux의 HTTP recorder·fake clock 주입, Gemini recorder의 전체 secret 정책, LangChain partner별 VCR 보안 설정 및 local server E2E는 확인하지 못했다. Hermes는 실제 eval 주제에서 3번째 프로젝트로 읽었으며 이 문서의 fake provider 비교에는 집계하지 않는다. 새 provider를 호출하거나 녹화/E2E를 실제 실행하지 않은 코드 조사다.
