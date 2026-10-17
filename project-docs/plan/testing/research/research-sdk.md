# 조사: agent SDK/framework의 fake model, 녹화·재생, provider 꼴 맞추기

clean room: 코드 복사·긴 인용 없이 설계, 이름, path, 개수만 적는다. 읽은 repo는 임시 폴더에 `--depth 1`로 받아 읽기만 했다(실행 없음). 실제 provider 호출 없음.
확인 못 한 것은 "(미확인)"으로 표시한다.

## 0. 한 줄 지도

| 층 | 대표 | 뭘 가짜로 두나 |
|---|---|---|
| A. model interface 함수 | Vercel `MockLanguageModelV4`, pydantic-ai `TestModel`/`FunctionModel`, OpenAI Agents `ScriptedModel`, LangChain `Fake*ChatModel` | provider adapter까지 통째로 건너뜀 |
| B. SDK client 객체 | pydantic-ai `MockOpenAI`(tests/models/mock_openai.py) | adapter는 진짜, SDK client가 가짜 |
| C. HTTP transport mock | Vercel `createTestServer`(msw), Anthropic/OpenAI python SDK의 respx, OpenAI Agents의 httpx MockTransport | adapter + SDK + 직렬화는 진짜, 소켓만 가짜 |
| D. 진짜 HTTP 서버(fake provider) | Mastra의 AIMock(`@copilotkit/aimock`), LiteLLM의 `_fake_openai_endpoint_server.py`, Anthropic/OpenAI SDK의 Steady(OpenAPI mock server) | process 밖에서 wire까지 진짜 |
| E. 녹화·재생 | pydantic-ai(cassetter, yaml), LangChain(vcrpy, yaml.gz), LiteLLM(vcrpy + Redis), Anthropic python(http-snapshot + inline-snapshot json), Vercel(손으로 받은 fixture 파일 + msw), AIMock(record 모드) | 위 C/D에 진짜 응답을 얹음 |

핵심 관찰: 성숙한 repo는 거의 다 **A(loop/orchestration test) + C 또는 D(adapter wire test)** 두 층을 함께 쓰고, 문서에 "A로 wire를 검증하지 마라"를 적어 둔다(OpenAI Agents, Mastra).

---

## 1. Vercel AI SDK (`vercel/ai`)

1. **어디에 끼나**
   - 두 층. (a) model interface: `LanguageModelV4` 구현체인 `MockLanguageModelV4`(packages/ai/src/test/mock-language-model-v4.ts. v2, v3 판도 그대로 남아 있음). embedding, image, speech, transcription, reranking, video용 mock이 각각 있고 `mock-provider-v4`, `mock-sandbox`도 있음. `ai/test`로 공개해 사용자도 쓴다(docs `55-testing.mdx`).
   - (b) HTTP: `packages/test-server`의 `createTestServer`(msw `setupServer`). 각 provider package(`packages/anthropic`, `openai` 등)의 `*-language-model.test.ts`가 URL별로 응답을 걸고 진짜 adapter를 부른다.
   - 이유: provider 구현은 `doGenerate`/`doStream`이라는 하나의 spec 인터페이스만 만족하면 되므로 loop(`generateText`, `streamText`, `ToolLoopAgent`)는 mock model로, adapter는 wire fixture로 나눈다(architecture/provider-abstraction.md).
2. **대답 정하기**
   - 생성자에 `doGenerate`/`doStream`을 (함수 | 고정 결과 하나 | 결과 배열) 중 하나로 넘김. 배열이면 호출 횟수 인덱스로 고른다. 함수면 (call options) -> 결과. 기본값은 "not implemented"를 던지는 함수라 안 쓴 경로를 부르면 즉시 터진다.
   - 보조: `mockId`(증가 정수 id), `mockValues`(배열을 차례로, 끝나면 마지막 값 반복).
   - 자동 생성 model은 없음(tool schema를 보고 인자를 만드는 건 pydantic-ai에만 있음).
3. **streaming**: `doStream`이 `ReadableStream`에 provider 중립 chunk(`stream-start`, `response-metadata`, `text-start/delta/end`, tool-call 관련, `finish`)를 담아 반환. 배열 -> stream은 `convertArrayToReadableStream`, 지연을 넣으려면 공개 helper `simulateReadableStream({chunks, initialDelayInMs, chunkDelayInMs})`. `null`이면 delay 호출 자체를 건너뜀(0과 구분). 내부에서 delay 함수를 주입할 수 있어 fake timer와 같이 쓴다. 제어형은 test-server의 `controlled-stream`(test가 chunk를 직접 밀어 넣고, 요청 abort 시 stream을 AbortError로 닫음).
4. **오류·잘림·usage**
   - finish chunk의 `finishReason`(unified 값 stop / length / tool-calls / error ... + raw)과 `usage`(input total/noCache/cacheRead/cacheWrite, output total/text/reasoning)를 test가 직접 채운다. stream 중간에 `type: 'error'` chunk를 넣거나 `doStream` 자체를 throw시켜 오류 경로를 낸다.
   - HTTP 층: `UrlResponse`에 `error`(status + body), `empty`(status), `json-value`, `stream-chunks`, `binary`, `controlled-stream` 6종. 응답은 고정 / 배열(호출 순서) / `({callNumber}) => 응답` 함수.
5. **요청 검사**: mock이 `doGenerateCalls`/`doStreamCalls`에 받은 call options(prompt, tools, 설정)를 쌓아 두고 test가 `toEqual`로 읽는다. HTTP 층은 `server.calls[n]`의 `requestBodyJson`, `requestHeaders`(user-agent 제외), `requestUrlSearchParams`.
6. **녹화**: 자동 cassette 없음. 대신 **fixture를 사람이 한 번 받아서 commit**한다(contributing/testing.md).
   - `examples/ai-functions`의 script를 돌려 generateText는 `result.response.body`를 JSON으로 찍고, streamText는 `includeRawChunks: true` + `saveRawChunks`로 한 줄에 chunk 하나씩 JSON(SSE 포장 없음)으로 `output/`에 저장 -> `__fixtures__/<provider>-<model>.chunks.txt`/`.json`로 복사. 재생 때 test의 loader가 provider별 SSE 꼴(`data: ...\n\n` + `[DONE]`, 또는 cohere식 `event:` + `data:`)로 다시 감싼다.
   - 규모: anthropic 64개, openai responses 61개 파일, `__fixtures__` 폴더가 있는 package 24개. 너무 크면 "의미 안 바뀌게" 잘라 쓰라고 안내. embedding vector는 값 5개로 trim.
   - secret 지우기 장치는 없음. 응답 body만 저장(요청 header를 저장하지 않으므로 구조적으로 안전).
   - 갱신: PR 작성자가 수동. CI는 항상 fixture 재생만.
7. **provider 꼴 맞추기 / live**
   - `examples/ai-functions/src/e2e/feature-test-suite.ts` 하나(`createFeatureTestSuite`)를 provider별 `e2e/<provider>.test.ts`(24개: anthropic, openai, google, bedrock, azure, groq ...)가 `models`와 **capability 목록**(textCompletion, toolCalls, objectGeneration, imageInput, pdfInput, audioInput, embedding, imageGeneration, searchGrounding)을 넘겨 호출. 모델마다 capability가 없으면 해당 test를 건너뜀. suite 안에 대략 50개 test(text 생성/stream, 객체 생성, tool call 단일/연속/stream, 이미지·PDF 입력, 잘못된 model id 오류 = APICallError).
   - gate: `vitest run src/e2e/*.test.ts`를 `test:e2e:all`로 수동 실행, `dotenv/config`로 key를 읽음. 기본 `pnpm test`(vitest, node+edge)에는 안 들어감. 30초 timeout. 비용 관리 장치는 문서에 없음(싼 model 선택 정도, 예: 명시적으로 haiku/nano 계열 사용).
   - 그 외 CI에는 RSC e2e(Next.js) 등 제품 e2e가 있고, 변경 감지로 필요할 때만 돎. `harness-e2e-next`, `harness-e2e-tui` 예제 존재.
8. **교훈**
   - 타입 호환을 위해 spec 버전이 올라갈 때마다 mock을 복제(v2, v3, v4). mock이 spec과 같이 움직여야 해서 유지비가 있음.
   - 거대 test 파일: `stream-text.test.ts`가 약 32,900줄, `generate-text.test.ts`가 약 14,400줄. 각 test가 chunk 목록을 길게 inline으로 쓴다. 복붙이 많아 helper(`createTestModel`)로 줄이는 흔적.
   - mock model로 tool loop를 시험하는 공식 recipe(ToolLoopAgent + 응답 배열)가 문서에 있음.
   - flaky로 보이는 건 codemod test timeout 정도. model 흉내 쪽 flaky는 못 찾음(msw는 in-process라 결정적).

---

## 2. pydantic-ai (`pydantic/pydantic-ai`)

1. **어디에 끼나**: 세 갈래.
   - A. `Model` 서브클래스: `TestModel`(models/test.py), `FunctionModel`(models/function.py). 둘 다 provider adapter와 같은 `Model` 인터페이스(`request`, `request_stream`)를 구현. `Agent.override(model=...)`로 앱 안의 agent의 model만 바꿈. 전역 `ALLOW_MODEL_REQUESTS = False`로 실수로 진짜 model을 부르면 즉시 오류.
   - B. SDK client 가짜: tests/models/mock_openai.py(`MockOpenAI`), `mock_xai`, `mock_async_stream`. 진짜 `OpenAIModel`에 가짜 client를 넣어 응답(또는 Exception)을 차례로 돌려줌.
   - E. cassette(아래 6). **tests/AGENTS.md가 "VCR + public API test가 기본"이라고 명시**: "provider API가 정답을 가장 잘 안다". unit test(A/B)는 "VCR로는 못 닿는 내부, 정의적 동작"에만.
2. **대답 정하기**
   - `TestModel`: 기본 동작이 "tool을 전부 한 번씩 부르고, 그 결과를 받은 뒤 텍스트(또는 구조화 출력)를 낸다". **tool의 JSON schema를 보고 유효한 인자를 자동 생성**(seed로 재현 가능). 옵션: `call_tools`(전부 'all' 또는 이름 목록), `custom_output_text`, `custom_output_args`, `seed`. 문서에 "magic이 아니다, AI 없이 절차적 코드일 뿐, 더 정교하면 FunctionModel"이라고 적음. native(provider 실행) tool은 못 흉내 냄.
   - `FunctionModel(function)`: (messages, AgentInfo) -> 응답. AgentInfo에 function tools, output tools, 설정이 들어 있어 "tool이 보이면 부르고 아니면 텍스트" 같은 분기를 짬. `stream_function`은 비동기 iterator로 문자열 / `DeltaToolCalls`(index -> 이름, 인자 조각) / `DeltaThinkingCalls` / builtin tool 호출 중 **한 종류씩만** yield.
3. **streaming**: FunctionModel은 `stream_function`이 async generator. delay는 test가 generator 안에서 직접. `TestModel`도 stream을 지원(내용을 조각으로 나눔).
4. **오류·잘림·usage**: FunctionModel 안에서 예외를 던지거나 `ModelHTTPError` 등을 직접 만들어 던짐. usage는 `_estimate_usage`가 메시지 길이로 "그럴듯한 숫자"를 채워 줌("테스트용 가짜 숫자"라고 주석) -- 응답에 usage가 비어 있을 때만. `Model` 레벨에서 잘림(finish_reason=length)을 만들려면 `ModelResponse`를 직접 구성.
5. **요청 검사**: `TestModel.last_model_request_parameters`, `capture_run_messages()`, `result.all_messages()`를 `inline-snapshot` + `dirty-equals`(IsNow, IsStr)로 한 번에 비교. **wire 검사는 네 가지를 구분해 문서화**(tests/AGENTS.md): (1) `request_capture` fixture = httpx event hook으로 **실제로 나간 요청**을 읽음(replay에서도 동작, cassette 매칭 영향 없음, header도 봄). 우선 사용. (2) cassette에 들어 있는 요청 body를 snapshot(검토용이지만 drift는 못 잡음). (3) test별 matcher(`additional_matchers=['body']`)로 cassette 매칭에 body를 포함. (4) mock으로 SDK를 통째로 바꿨을 때는 adapter가 만든 render를 캡처. body 전체 대신 projection(`content_blocks`, `message_shape`, `cache_breakpoints`)을 snapshot.
6. **녹화·재생**
   - 도구: `cassetter`(pydantic 팀 유지. 원래 pytest-recording/vcrpy였고 issue #8835가 "cassetter 하나로 대체" 요청). 모드 이름은 `--record-mode=rewrite|none|...`. 기본 재생 전용(미확인: 정확한 default 이름). 갱신은 `rewrite`.
   - cassette 꼴: yaml 한 파일 = test 하나. 경로 `tests/models/cassettes/<test_file>/<test_name>.yaml`. 안에 `version: 1` + `interactions[]`(request: method, uri, headers, body(type json이면 파싱된 구조) / response: status, headers, body(type text이면 SSE 원문 그대로)). 요청이 여러 번이면 interactions가 여러 개. 전체 1,786 yaml, tests 폴더 270MB. tests/models/cassettes/test_anthropic 아래만 99개.
   - 지우기: `tests/cassette_hooks.py`의 `before_record_request`/`before_record_response`. 필터할 header 목록(authorization, cookie, date, request-id, server, user-agent, via, set-cookie, api-key 등)과 prefix(`anthropic-`, `cf-`, `x-`; 일부 예외는 allow 목록), 지원 안 되는 인증값, 그리고 **스마트 따옴표·특수문자를 ASCII로 정규화**(snapshot에 non-ASCII가 번지는 걸 막으려고). uri는 `normalize_uri`로 AWS 계정, GCP project 등을 일반화해 다른 사람이 녹화한 걸 다른 환경에서 재생.
   - test용 key: 재생 중에는 session fixture가 기본 `'mock-api-key'`. 녹화 때만 `.env`의 진짜 key. 
   - 갱신 주체: 기여자가 PR에서 `source .env && uv run pytest <test> --record-mode=rewrite` 후, 모드 없이 재생 확인, git diff로 cassette 변경 파일 목록과 snapshot을 리뷰(testing-skill SKILL.md에 agent용 절차와 `parse_cassette.py`). "녹화는 key가 필요하고 쉽지 않아서 기여자는 종종 덜 테스트한다. VCR test를 대신 써 주는 게 maintainer의 핵심 일"이라고 적혀 있음. Makefile에 전체 `rewrite` target 하나 있음.
   - CI: 재생 전용. 추가 검사: (a) cassette의 **일부만 재생되면 test 실패**(`fail_partially_used_vcr_cassettes`; `--strict-vcr-cassette-usage`로 더 엄격), (b) **cache prefix 불변 검사**: 연속 요청이 같은 직렬화 prefix를 확장하는지 cassette 전체로 확인(의도적으로 깨는 test는 `moves_cache_prefix(reason=)` 마크), (c) `blockbuster`: event loop를 막는 blocking call 감지, (d) `cost_guards.py`: 새 Python 프로세스를 띄우는 test는 `subprocess(reason=)` 마크 없으면 실패, `PYTEST_TEST_BUDGET_SECONDS` 초과 test는 `slow(reason=)` 없으면 실패.
7. **꼴 맞추기 / live**: 같은 test 본문을 `@pytest.mark.parametrize('model', ['openai','anthropic','google'], indirect=True)` x `stream in [False, True]`로 돌리는 게 표준. 기대값은 (model, stream) -> 출력 dict(`EXPECTATIONS`) 또는 `Case` dataclass(자기 snapshot을 가짐). 별도 "live test" 계층은 없고 **녹화 순간이 곧 live 호출**. live marker는 외부 sandbox류(modal_live, e2b_live 등)에만.
8. **교훈 (issue 제목에서)**
   - #6993 "cassette가 실제로 보내는 요청에서 drift해도 test가 계속 통과", #8023 "wire-contract case가 자기 cassette를 대상으로 단정해서 body drift를 못 잡음", #7178 "기록된 요청 body가 코드와 어긋난 cassette 재녹화". 그래서 `request_capture`(실제 wire) 우선 규칙이 생겼다.
   - #7853 "CI에서 network 차단", #6775 "WebSocket cassette가 다 소비됐는지 단정 안 함" -> 부분 재생 실패 규칙.
   - suite 비용 관리를 test 정책으로 올림(cost_guards): "한 test에 1초를 더하면 하루에 수천 번 지불". 코딩 agent가 가까운 helper를 복사해서 비싼 패턴이 번진다는 설명이 있음.
   - 큰 cassette repo(270MB)와 smart quote 정규화 같은 잡일.

---

## 3. OpenAI Agents SDK python (`openai/openai-agents-python`)

1. **어디에 끼나**: SDK 자체의 공개 test utility `agents.testing`(src/agents/testing/model.py 약 1,200줄, sandbox.py 약 630줄)의 `ScriptedModel`이 `Model` 인터페이스 자리에 들어감. 같은 철학으로 `ScriptedRealtimeModel`, voice용 `ScriptedSTTModel`/`ScriptedTTSModel`, `scripted_sandbox_session()`. top-level `agents`에는 export 안 하고 `agents.testing`에만 둠. docs/testing.md가 "경계 선택" 절을 따로 둠: Scripted*는 run loop, tool, handoff, guardrail, session, retry, **normalized** streaming용. **Responses/Chat Completions 직렬화, auth header, HTTP payload, provider stream chunk, realtime wire frame은 이걸로 시험하지 말고 진짜 adapter + 제어된 network transport로** (httpx MockTransport 사용: tests/models/test_openai_chatcompletions.py).
2. **대답 정하기**: `ScriptedModel([...])`에 호출 1회당 step 하나를 FIFO로. step은 (정규화된 output item 배열 | `ModelStep` | dict | `ModelResponse` | Exception). 헬퍼 `assistant_message(text)`, `function_call(name, args, call_id=)`. 요청에 따라 달라야 할 때만 `ModelStep.respond(responder)`(sync/async, 정규화된 `ModelCall`을 받음). `enqueue()`/`extend()`로 추가. 응답 id, usage는 결정적 기본값.
3. **streaming**: 일반 step 하나가 `run()`과 `run_streamed()` 둘 다 지원. message, reasoning, function call, apply-patch call은 start/delta/done/completed 이벤트를 **자동 생성**. 정확한 이벤트열이 대상이면 `ModelStep.stream(events, output=)`(고정 목록 또는 `ModelCall`을 받는 async factory). 자동 생성이 지원 안 하는 item 종류는 명시적으로 거부. 이벤트는 "SDK-normalized" 이벤트이고 provider wire chunk가 아님(문서의 한계 절에 명시).
4. **오류**: `ModelStep.raise_error(exc, retry_advice=)`로 호출 1회 실패. retry 정책은 runner가 정하고 retry도 다음 step을 소비. 잘림/거절/usage는 `ModelResponse`의 item(`ResponseOutputRefusal` 등)이나 usage 필드를 직접 구성. 구조화 오류: `InvalidModelStep`(잘못된 step을 큐에 넣기 전에 거부), `UnexpectedModelCall`(script 끝난 뒤 추가 호출), `UnconsumedModelSteps`(`assert_complete()`가 남은 step 보고).
5. **요청 검사**: `calls`/`first_call`/`last_call`/`remaining_steps`. `ModelCall`에 input, model_settings, tools, handoffs, streamed. 호출 시점에 deep copy로 snapshot해 나중에 mutation이 섞이지 않음.
6. **녹화**: 없음(tests/에 cassette 개념 없음). 대신 `tests/fixtures/released_api_contract.json`(공개 API 계약 manifest)과 `RunState` 과거 버전 fixture(역사적 writer가 쓴 것만 허용).
7. **꼴 맞추기 / live**
   - `integration_tests/`(`make integration-tests`)가 실제 wheel을 clean venv에 설치하고 live OpenAI를 부름. 파일: openai/{responses, chat_completions, retry, handoffs, guardrails, sessions, tracing, websocket ...}.py, hosted/{web_search, mcp, tool_search ...}.py. 일반 `make tests`에는 안 들어감.
   - gate: `OPENAI_API_KEY` + `OPENAI_API_KEY_SOURCE=service-account`(개인 key 거부), profile마다 credential 종류 하나, local-only profile은 실행기가 상속된 key를 **지우고** 시작. 외부 provider(Anthropic, Gemini)는 기본 deselect, `make integration-tests-providers-external`과 `OPENROUTER_API_KEY`로만, 환경변수 flag만으로는 켜지지 않음. `STRICT=1`이면 skip 대신 실패(release 계열 profile은 무조건 strict). 각 live test 75초 timeout. JUnit report에 raw provider payload는 passing case에 안 붙임. 모델명은 env로 override.
   - autouse fixture `disable_real_model_clients`가 OpenAI model의 `get_response`/`stream_response`를 monkeypatch해서 "Real models should not be used in tests!"로 실패시킴(마커 `allow_call_model_methods`로 예외).
8. **교훈**: tests/README.md가 "새 mock/fake Model을 만들지 말고 ScriptedModel을 쓰라. 전문 test double은 wire 변환, 깨진 stream, 동시성/취소 경계가 필요할 때만 쓰고 이유를 문서화하라"고 규칙화 -- fake가 난립하다 하나로 모은 흔적(121개 test 파일이 ScriptedModel 사용, 다른 tests/*.py 합쳐 172). "실제 sleep 대신 event, 결정적 fake, 즉시 예외"를 쓰라고 명시. xdist 병렬 + `serial` marker는 실제로 간섭을 보인 test에만.

---

## 4. LangChain (`langchain-ai/langchain`)

1. **어디에 끼나**
   - A층: `langchain_core/language_models/fake_chat_models.py`에 5종 + `fake.py`의 LLM 2종(FakeListLLM, FakeStreamingListLLM). BaseChatModel의 `_generate`/`_stream` 자리.
   - 별도로 langchain_v1 agent test가 자체 `FakeToolCallingModel`(tests/unit_tests/agents/model.py)을 가짐. 공용 fake로 부족해서 tool 호출 목록 순환, structured response, openai/anthropic tool 모양 선택을 직접 구현.
   - partner package(anthropic 등) unit test는 `--disable-socket`(pytest-socket)으로 **network 자체를 차단**.
2. **fake 종류와 대답 정하기**
   - `FakeListChatModel`: 문자열 목록을 **순환**(cycle). `sleep`(응답 사이 지연), `error_on_chunk_number`(stream 중 n번째 chunk에서 예외).
   - `FakeMessagesListChatModel`: `BaseMessage` 목록 순환(+ sleep). tool_calls가 든 AIMessage를 줄 수 있음.
   - `GenericFakeChatModel`: `messages`에 **iterator**(AIMessage 또는 str). 소진되면 끝. 문자열은 단어 단위 chunk로 쪼개 stream 흉내, `on_llm_new_token` callback 발생.
   - `FakeChatModel`: 고정 문자열. `ParrotFakeChatModel`: 마지막 입력 메시지를 그대로 돌려줌.
   - 함수형(request -> response)은 없음.
3. **streaming**: 위 모델들이 `_stream`/`_astream` 구현. `error_on_chunk_number`로 중간 오류. sleep으로 지연.
4. **오류·잘림·usage**: `FakeListChatModelError` 등 예외 클래스. usage와 잘림은 AIMessage의 `usage_metadata`/`response_metadata`를 직접 구성.
5. **요청 검사**: 공용 fake는 입력을 기록하지 않음(필요하면 서브클래스). Parrot이 입력을 반사하는 방식이 가장 가까움.
6. **녹화·재생**: vcrpy + pytest-recording. libs/standard-tests/langchain_tests/conftest.py가 공용 설정(`base_vcr_config`): record_mode `once`, match_on method+uri+body, `allow_playback_repeats`, 압축 응답 decode, header 필터(authorization, x-api-key, api-key -> PLACEHOLDER). 직렬화는 **yaml을 gzip**(`CustomSerializer`/`CustomPersister`; 이유는 "vcr 기본 yaml은 신뢰 못 할 입력에 안전하지 않다" + 사람이 열어 보기 어렵게). anthropic은 한 단계 더: 모든 요청·응답 header 값을 `**REDACTED**`로, uri도 `**REDACTED**`로 바꾸고 match_on에서 uri 제거(직접 API든 gateway든 재생). 파일은 `libs/partners/anthropic/tests/cassettes/<test>.yaml.gz`(anthropic 24개; repo 전체 134개 yaml.gz). 
   - CI: `_test_vcr.yml` workflow가 "API key 없이 재생 전용"으로 돌려 **test 입력이 바뀌어 cassette가 낡은 것**을 잡음(재녹화는 안 함). 갱신은 사람이 로컬에서.
7. **꼴 맞추기 / live (이 조사의 핵심)**
   - `langchain-tests` package(libs/standard-tests)가 **상속용 test 묶음**을 배포: `ChatModelUnitTests`(unit_tests/chat_models.py)와 `ChatModelIntegrationTests`(integration_tests/chat_models.py, 약 3,600줄, 약 48개 test: invoke/ainvoke/stream/astream/batch, 대화, usage_metadata(+stream), stop sequence, tool_calling(+async), tool_choice, 인자 없는 tool, tool message 오류 status, structured output(+async, json mode), 이미지/PDF/오디오 입력, agent_loop, stream_time(benchmark), unicode tool call 등). 각 provider package가 `class TestXxx(ChatModelIntegrationTests)`를 만들고 `chat_model_class`, `chat_model_params`(model 이름)만 정의.
   - 기능 차이는 **capability property**로 선언: `has_tool_calling`, `has_tool_choice`, `has_structured_output`, `supports_json_mode`, `supports_image_inputs`/`image_urls`/`pdf_inputs`/`audio_inputs`/`video_inputs`, `returns_usage_metadata`, `supported_usage_metadata_details`, `supports_anthropic_inputs`, `supports_image_tool_message`, `supports_pdf_tool_message`, `supports_model_override`, `enable_vcr_tests`. 기본값은 `bind_tools` 오버라이드 여부나 시그니처로 추정. 각 property와 각 test method의 docstring에 **"이 test가 실패하면 어디를 고치라"는 troubleshooting 안내**가 있음.
   - **`test_no_overrides_DO_NOT_OVERRIDE`**: 표준 test를 지우거나 override하면 실패. 단 `@pytest.mark.xfail(reason=...)`(reason 필수)이면 허용. "표준을 조용히 약화하지 못하게" 하는 장치.
   - unit 쪽 표준: 초기화, env 초기화, bind_tools(pydantic), structured output 바인딩, 표준 파라미터, serdes(snapshot), init 시간(benchmark).
   - live gate: partner Makefile `integration_tests` target, `.github/workflows/integration_tests.yml`가 **매일 cron(13:00 UTC)** + workflow_dispatch. fork에서는 scheduled 실행 안 함, LangSmith로 trace해서 실패와 Actions run을 연결. 실행 옵션 `--timeout 30 --retries 3 --retry-delay 1 -n auto`, 먼저 SDK major별 smoke 1개(`test_stream`). 기본 `make test`는 `--disable-socket`. 가장 싼 model(claude-haiku 계열)을 고정해서 비용 제한.
8. **교훈**: 재시도(`--retries 3`)를 쓴다는 것 자체가 live test의 flaky를 인정한 것. 표준 test가 3,600줄까지 커지면서 capability flag가 17개 이상으로 늘어남 -- 새 기능이 생길 때마다 flag와 test가 쌍으로 추가됨(무거워짐). 일부 스냅샷, 호환(httpx vs httpx2) 때문에 Makefile이 SDK major별로 두 번 돌림.

---

## 5. Anthropic·OpenAI 공식 SDK

(Stainless 생성 SDK: anthropic-sdk-python/typescript, openai-python)

1. **어디에 끼나**
   - D층: **OpenAPI spec 기반 mock server "Steady"**(`@stdy/cli`, 예전 Prism 자리. OpenAI는 fork, `scripts/steady/manifest.json`에 commit/digest/Deno runtime checksum 고정). `scripts/mock`이 127.0.0.1:4010에 띄우고 `scripts/test`가 떠 있지 않으면 자동으로 띄우고 끝나면 kill. 생성된 `tests/api_resources/**` test가 이 서버를 상대로 모든 endpoint의 인자 조합을 호출(응답은 spec의 example/schema에서 만든 값). `TEST_API_BASE_URL`로 다른 서버 지정 가능. 이 mock은 응답 **형태**만 시험하고 대답 내용 시나리오는 못 만든다.
   - C층: 손으로 만든 시나리오(stream 조립, tool runner, helper, 오류 재시도)는 `respx`(python httpx mock)로 `/v1/messages`를 가로채 `side_effect=[응답1, 응답2]`로 호출 순서대로 고정. 요청 body는 `respx_mock.calls`로 읽음. openai-python은 자체 `tests/respx2`(httpx2용).
   - SSE fixture: anthropic `tests/lib/streaming/fixtures/*.txt`(basic_response, compaction_response, incomplete_partial_json_response, fallback_response 등 약 10종)에 **원문 SSE 이벤트열**을 텍스트로 두고 helper가 줄 단위 byte iterator(sync/async)로 바꿔 stream으로 먹임.
2. **대답 정하기**: Steady = spec 기반 자동, respx = test가 지정, fixture = 파일, snapshot = 녹화본(아래).
3. **streaming/오류**: 잘림·tool 인자 JSON 깨짐은 fixture로 표현("incomplete_partial_json", "invalid tool JSON" -> 정확한 오류 메시지를 정규식으로 단정). 모델 응답이 refusal -> fallback으로 이어붙는 stream 재조립(`test_refusal_fallback_streaming`) 등도 respx 두 응답으로.
4. **요청 검사**: `respx_mock.calls`에서 body, header(`anthropic-beta` 등) 추출하는 작은 helper 함수.
5. **녹화**:
   - anthropic-python: `http-snapshot`(+ `inline-snapshot`). fixture `snapshot_client`/`async_snapshot_client`가 httpx client를 감싸 녹화 모드면 진짜로 보내고, 아니면 저장본 재생. 저장 위치 `tests/lib/_parse/__inline_snapshot__/<파일>/<클래스>/<uuid>.json`(요청 method, url, headers, body + 응답이 한 JSON 배열). 응답 header에서 date, request-id, organization-id, cf-ray 등을 제외, 요청에서 `x-api-key` 제외, 녹화 중에는 `api_key=None`(환경에서 읽게). 갱신: `./scripts/test --inline-snapshot=fix --http-record -n0`(병렬 불가). "엔드포인트는 같고 코드 처리만 바뀌었으면 `--http-record` 없이 inline snapshot만 갱신"이라고 안내.
   - openai-python: respx로 응답 body를 **inline-snapshot 문자열**로 test 파일 안에 박아 둠. `OPENAI_LIVE=1`이면 mock을 끄고 진짜 호출 후 response hook으로 body를 snapshot에 채움(명령: `OPENAI_LIVE=1 pytest --inline-snapshot=fix -p no:xdist`). 즉 재생과 녹화가 같은 test, 환경변수 하나로 전환. 파일 머리말에 "snapshot은 live API에서 자동 생성"이라 명시.
6. **live**: openai-python `tests/lib/live/*`는 실시간 transcript 문법 test(실제 live 호출 아님, 이름만 live). 진짜 live는 `test_websocket_live.py`, `bedrock_live.py`, anthropic `test_google_cloud_live.py` 같은 개별 파일로 env 없으면 skip. CONTRIBUTING: "live credential 대신 mock server나 mock transport를 선호", "test, fixture, 녹화 응답에는 sanitized data만".
7. **교훈**: Steady 서버를 SDK repo가 직접 pin(commit, checksum)한다는 건 mock 서버 자체가 공급망 위험/유지비가 된다는 뜻. snapshot이 xdist와 비호환이라 갱신 때 `-n0`가 필요. 녹화본에 SDK 버전·OS·python 버전 header가 박혀 있어 노이즈(예: `user-agent: Anthropic/Python 0.82.0`, macOS)가 diff에 섞임.

---

## 6. LiteLLM (보너스)

1. **A층(함수 안 mock)**: `litellm.completion(..., mock_response=...)`. 값이 문자열이면 그 텍스트, `Exception` 인스턴스면 그걸 던짐, 특정 문자열(`"litellm.RateLimitError"`, `"litellm.ContextWindowExceededError"`, `"litellm.InternalServerError"`, `"Exception: content_filter_policy..."`)이면 해당 오류, dict/`ModelResponse`면 그대로. 추가 인자 `mock_tool_calls`, `mock_delay`, `mock_timeout`. stream도 mock으로 chunk를 생성(`mock_completion_streaming_obj`). 요청에 끼워 넣는 kwarg라 test 코드가 production 코드에 섞이는 방식.
2. **D층**: tests/_fake_openai_endpoint_server.py(uvicorn+starlette). 주석: 예전에 공유 호스팅 mock이 내려가자 모든 job이 "404 Application not found"로 실패 -> **로컬 stand-in으로 교체**. 규칙: `model` 이름이 `429`면 HTTP 429, `slow-endpoint`면 3초 지연. usage는 현실적인 값을 줘서 비용 계산 경로가 진짜로 돎.
3. **E층**: VCR + **Redis cassette**(`CASSETTE_REDIS_URL`, key `litellm:vcr:cassette:<test_id>`). 모든 provider test가 자동으로 vcr 마킹. 첫 실행은 live로 호출해 녹화, **TTL 24시간(읽기로 갱신 안 함)** -> 하루 한 번 자동 재녹화로 provider drift를 하루 안에 노출. **2xx 응답만 녹화**(`filter_non_2xx_response`), cassette당 episode 최대 50. 끄기 `LITELLM_VCR_DISABLE=1`, 비우기 make target. 한계: in-process httpx만 가로채므로 Docker 안 proxy의 호출은 못 잡음 -> 별도 `_openai_record_replay_proxy.py`(record/replay **reverse proxy**, api_base로 라우팅, 시작 시 REPLAY/PASSTHROUGH/DEGRADED 로그, 요청마다 HIT/MISS 로그)를 둠. 이유가 주석에 있음: 매 commit이 진짜 provider에 돈을 쓰고, provider 장애/401에 노출됐기 때문.
4. **교훈**: 녹화 만료를 시간(TTL)으로 자동화한 점, 호스팅 mock 의존이 깨진 경험, 실패 응답은 녹화하지 않는 점, 어느 층(in-process vs docker)이 녹화를 못 가로채는지 문서에 적은 점.

## 7. Mastra + AIMock (보너스, 가장 lophn E2E에 가까움)

1. **어디에 끼나**: `packages/core/src/loop/test-utils/aimock/`(README + 시나리오 약 104개 `*.scenario.test.ts`). **진짜 OpenAI provider(AI SDK v5)를 `baseURL`로 in-test mock HTTP 서버(`@copilotkit/aimock`의 `LLMock`)에 연결**하고 `Agent -> loop()` 전체를 돌린다. 이유(README "Why this exists"): step 단위 unit test는 통과하는데 **합성(tool 결과 배관, turn 간 message 순서, 긴 loop의 stop 조건)이 깨지는 회귀**가 Mastra Code(제품)에서야 잡혔기 때문.
2. **대답 정하기**: 시나리오가 `llm.on(match, response)`로 fixture를 건다. match 키: endpoint, userMessage, toolCallId, `hasToolResult` 등. response: `{content}` 또는 `{toolCalls:[{id,name,arguments}]}`. `onToolCall`, `onTurn` 도우미. 서버는 suite마다 하나(`port: 0` 임시 port), test마다 fixtures, 요청 journal, match count만 reset ("test마다 서버를 띄우면 느리다").
3. **검사**: 결과 두 가지를 동시에 단정 -- loop가 내놓은 출력, 그리고 **서버가 받은 turn별 HTTP 요청 body**(`requests[n].body.messages`, `body.tools`). chunk 단위 단정이 필요하면 `collectChunks`.
4. **AIMock 자체의 설계**(WebFetch로 확인한 공식 설명): 11 provider, 22 API surface를 흉내 내는 zero-dependency 서버(+WebSocket). fixture는 JSON(`match`/`response`), `aimock validate`로 offline lint. 응답은 text/tool call을 순서 있는 `blocks`로, `id/model/usage/finishReason` override 가능. **record 모드**(`--record --provider-openai <url>`): 진짜 API로 프록시하며 fixture 저장(chunk 도착 시각, 마지막 usage frame의 진짜 token 수 포함), replay는 TTFT와 평균 속도만 근사(`--replay-speed`). streaming 물리값 `ttft`/`tps`/`jitter`. **chaos**(확률): 500, 깨진 JSON, 중간 끊김, 429+Retry-After, 고정 지연; `X-Test-Id` 단위로 병렬 test가 서로 간섭 안 하게. **model 오작동 fixture**(aimock 1.45.0+) 9종: 잘못된 tool 인자, schema 위반, 없는 tool, 중복 id, length stop, 빈 응답, refusal, content filter, reasoning-only. 요청 journal API(`GET /__aimock/journal`, 필터 path/method/status/testId). 주의: LLM fixture에 대한 secret redaction은 문서에 없음(MCP 녹화만 명시) -> commit 전 사람이 검토.
5. **교훈**: "Mastra Code(제품)에서만 잡히던 loop 회귀"가 이 층을 만든 동기. 시나리오 104개가 한 loop 기능 영역을 BDD 식으로 나눔. e2e-tests/ 디렉터리는 번들/배포 호환(monorepo, create-mastra, deployers)이라 model 흉내와 무관.

---

## 8. 비교 표

| 축 | Vercel AI SDK | pydantic-ai | OpenAI Agents | LangChain | Anthropic/OpenAI SDK | LiteLLM | Mastra+AIMock |
|---|---|---|---|---|---|---|---|
| fake 층 | model interface(Mock) + HTTP(msw) | Model 서브클래스 + SDK client mock + cassette | Model 서브클래스(`ScriptedModel`), wire는 httpx MockTransport | BaseChatModel fake 5종 + vcr | OpenAPI mock 서버(Steady) + respx + snapshot | 함수 인자(`mock_response`) + fake 서버 + vcr | in-process HTTP 서버(AIMock) |
| 대답 정하기 | 고정/배열(호출 순서)/함수 | **자동(TestModel)** / 함수(FunctionModel) / cassette | **FIFO step**(고정 우선) / responder | 순환 list / iterator | spec 자동(Steady) / respx 순서 / fixture | 문자열, Exception, 특정 문자열 | `llm.on(match,response)` 규칙 |
| streaming | chunk 배열 + `simulateReadableStream`(delay) | `stream_function`(delta) / TestModel 자동 | **normalized 이벤트 자동 생성** + 정확한 이벤트 지정 | `_stream`, `error_on_chunk_number`, sleep | SSE 원문 fixture | mock stream 객체 | ttft/tps/jitter, 중간 끊김 chaos |
| 오류·잘림 | finish chunk 값, error chunk, throw, HTTP error 응답 | 함수 안 예외, ModelResponse 직접 | `raise_error`, item 직접 | 예외 클래스 | fixture(잘린 JSON) | 오류 문자열/예외, 429 모델명 | chaos 5종 + model 오작동 9종 |
| 요청 검사 | `doStreamCalls[]`, server.calls | `request_capture`(wire hook), snapshot, `last_model_request_parameters` | `calls`(deep copy), `assert_complete` | (공용 fake는 없음) | respx.calls | (미확인) | 서버가 받은 turn별 body |
| 녹화 | 사람이 받아 commit한 fixture 파일 | cassetter yaml, 1,786개 | 없음 | vcrpy yaml.gz, 134개 | http-snapshot json / inline-snapshot 문자열 | vcr + Redis TTL 24h | aimock record 모드 |
| 녹화 mode | 해당 없음 | rewrite / 재생(none) | - | once(기본), CI는 재생 전용 | `--http-record` / `OPENAI_LIVE=1` | 첫 실행 record, 만료 후 재record | `--record`, `--proxy-only` |
| secret 지우기 | 요청 저장 안 함 | hook: header 목록+prefix, 값 정규화 | - | header를 PLACEHOLDER/REDACTED, uri도 | header 제외 목록 | 2xx만, 헤더 scrub | 문서에 LLM은 없음 |
| 갱신 주체 | PR 작성자 수동 | 기여자/maintainer 수동 | - | 사람 로컬, CI는 낡음 감지 | 사람 수동 | **자동(매일)** | 사람 수동 |
| 꼴 맞추기 | provider별 `e2e/*.test.ts`가 공용 `feature-test-suite` + capability 목록 | `parametrize(model) x stream`, 기대값 표 | 해당 없음(provider adapter는 wire test로 개별) | **`langchain-tests` 상속 묶음** + capability property + override 금지 test | spec(OpenAPI)이 계약 | provider별 test 파일 | 해당 없음 |
| live gate | 수동 `test:e2e:all`, `.env` | 녹화 순간이 곧 live | service-account key 강제, strict, 75초 timeout, 외부 provider는 flag+gateway key | daily cron, `--retries 3`, timeout 30, 싼 model 고정 | 개별 `*_live` 파일, env 없으면 skip | 매일 첫 실행이 live | 해당 없음 |
| 무거움 | stream-text.test 약 3.3만 줄 | cassette 270MB, 정책 많음 | testing 모듈 1,200줄 | 표준 test 3,600줄, flag 17+ | mock 서버 pin/유지 | Redis 의존 | 시나리오 104개 |

---

## 9. lophn에 맞을 선택 (근거와 함께)

lophn 원칙(AGENTS.md): 프로토타입, 가장 단순한 구현, test는 깨지면 곤란한 것에만, subprocess/server/browser를 띄우는 test는 사람에게 먼저 묻고, 실제 provider는 사람이 key로, 개발은 `tools/fake-provider`.

### harness test (agent loop를 process 없이, model은 fake)

- **권장: A층 scripted model 한 종류 + 필요할 때만 C층.** OpenAI Agents의 `ScriptedModel`이 가장 맞음.
  - 호출 1회당 step 하나인 FIFO 큐(고정 응답 위주), 요청에 따라 달라야 할 때만 함수 step. 근거: 고정 큐는 "예상치 못한 추가 호출/남은 step"을 즉시 실패로 드러내 loop 회귀를 잡는다(`assert_complete`, `UnexpectedModelCall`). Vercel의 "배열 또는 함수"도 같은 모양.
  - 받은 요청(messages, tools, 설정)을 호출 시점에 **복사해서** 기록(`calls`). 나중에 loop가 mutation해도 단정이 안 흔들림.
  - streaming은 "응답 하나 -> stream 이벤트 자동 생성"을 기본으로, 정확한 chunk열이 대상일 때만 직접 지정(OpenAI Agents식). 오류/중간 끊김/잘림(length)/거절/usage는 step 종류로 낸다(`raise_error`, finish reason 값, usage 필드). Vercel처럼 chunk 배열 + delay 주입 helper(`null`=무지연)도 참고.
  - **pydantic-ai `TestModel`식 자동 생성(schema -> 인자)은 지금은 보류.** 근거: 문서에서도 "magic 아님, 보기 좋지 않은 값"이고, lophn은 "요구마다 test를 붙이지 않는다". tool 전체 smoke가 필요해지면 그때 추가.
  - fake가 난립하지 않게 **repo 규칙 한 줄**(OpenAI Agents tests/README): "새 fake model 만들지 말고 scripted model을 쓴다. 예외는 wire 변환, 깨진 stream, 동시성/취소 경계, 이유를 test에 적는다".
  - **fake의 경계를 어디에 두나**: 이 fake는 lophn 내부의 정규화된 model 이벤트/응답 층에 끼워야 하고 provider wire(Anthropic·OpenAI 이벤트 이름)를 흉내 내지 않는다. 문서에도 "normalized event는 wire가 아니다"를 적고, wire 검증은 아래로 보낸다(OpenAI Agents와 Vercel이 같은 분리).
- **wire(adapter가 provider HTTP/SSE를 올바르게 읽고 쓰나)는 C층 fixture 재생 한 벌.** Vercel/Anthropic 방식: 진짜 응답 chunk를 파일로 두고(provider별 SSE 원문 `.txt`, 비-stream은 `.json`) in-process fetch/transport mock에서 되돌려 줌. 근거: process를 안 띄우므로 AGENTS.md의 "서버/subprocess test는 먼저 묻는다"에 걸리지 않음. 잘린 stream, 깨진 tool 인자 JSON, 4xx/5xx/429는 손으로 만든 짧은 fixture로(Anthropic의 incomplete_partial_json처럼). **요청 쪽도 실제로 나가는 body를 transport hook에서 읽어 단정**(pydantic-ai #6993/#8023의 교훈: cassette가 자기 자신을 단정하면 drift를 못 잡음).
- **자동 cassette(vcr류)는 harness test에서는 쓰지 않는다.** 근거: pydantic-ai는 270MB, 1,786개 cassette에 smart quote 정규화, 부분 재생 실패 규칙, cache prefix 검사, drift 이슈까지 생김. LangChain도 암호화 수준으로 header/uri를 가리고 낡음 감지를 따로 둠. lophn 규모에서는 "fixture 파일을 사람이 받아서 commit"(Vercel)이 가장 단순하고 secret도 구조적으로 안전(요청을 저장하지 않음).

### core E2E (제품 process 전체, model은 fake)

- 이미 `tools/fake-provider`가 있으므로 **D층(진짜 HTTP 서버가 provider wire를 말함)** 으로 가는 게 맞고, Mastra/AIMock과 LiteLLM의 fake endpoint server가 설계 선례.
  - 규칙 기반 응답(`match` -> `response`: 마지막 메시지에 tool result가 있나 / 어떤 tool call id에 대한 답인가 / turn 번호), 서버는 suite당 하나 + ephemeral port + test마다 reset(Mastra), 서버가 받은 요청 journal을 API로 노출해 "turn별 요청 body"를 단정(Mastra는 loop 출력과 요청 body를 같이 단정해서 합성 회귀를 잡음).
  - 오류 주입(429, 500, 중간 끊김, 느린 응답)은 요청의 model 이름/헤더로 트리거(LiteLLM의 `429`, `slow-endpoint`, AIMock의 `X-Test-Id` 단위 chaos). 병렬 test가 서로 간섭하지 않게 test id로 격리.
  - usage는 현실적인 값을 채워 비용/한도 경로가 진짜로 돌게(LiteLLM).
  - 동기: Mastra는 "step test는 통과하는데 제품에서만 합성 회귀"가 원인. lophn의 core E2E가 같은 이유로 필요하고, harness test와 중복을 줄이려면 E2E는 **합성 경로 몇 개**(tool loop, 거절/재시도, 중단)만.
  - 주의: process/서버를 띄우는 새 E2E는 AGENTS.md상 **먼저 사람에게 묻는다**.

### provider live test (사람이 key로, 대답 내용은 안 봄)

- **하나의 공용 suite + provider별 얇은 파일 + capability 목록**. Vercel `feature-test-suite` + LangChain `langchain-tests`를 섞은 형태.
  - provider 파일은 model 이름과 capability(tool call, streaming, usage, 긴 출력 등)만 선언, 본문은 공용. lophn이 단정할 것은 이미 정해져 있음: 받았나, 잘렸나(finish reason), tool 인자가 JSON인가, token 수가 있나. 이 4개 단정만 공용 suite에 두면 test 수가 작게 유지됨(Vercel은 약 50개, LangChain은 약 48개로 불어난 점이 경고).
  - LangChain의 `test_no_overrides_DO_NOT_OVERRIDE`(표준 test를 조용히 약화 못 하게)는 provider가 2~3개인 지금은 과함. 대신 capability가 false인 항목은 test 안에서 이유와 함께 명시적 skip.
  - **gate**: OpenAI Agents식 -- key가 있는 env를 명시적으로 줬을 때만, 기본 `deno task check`에는 안 들어감, key가 없으면 skip이 아니라 "설정 안 됨"으로 구분(strict 플래그면 실패), 호출마다 짧은 timeout(75초, LangChain 30초), key를 부모 환경에서 상속하지 않는 명시적 target. **자동 cron은 쓰지 않는다**(AGENTS.md: 실제 provider 호출은 사람에게 묻는다). LangChain은 daily cron, LiteLLM은 매일 자동 재녹화지만 lophn에는 부적합.
  - **비용**: 가장 싼 model 고정, max_tokens 작게, 호출 수를 provider당 4~6개 정도로 제한, 재시도는 사람이 판단(LangChain의 `--retries 3`은 flaky 인정이라 기본값으로 따라 하지 않음).
  - **fixture 갱신과 연결**: live test가 이미 진짜 응답을 받는 순간이므로, 같은 실행에서 chunk 원문을 `__fixtures__` 형태로 저장하는 옵션(Vercel `saveRawChunks`, openai-python의 `OPENAI_LIVE=1`로 녹화/재생 전환)을 한 줄로 켤 수 있게 하면 wire fixture를 사람이 직접 만들 일이 줄어듦. 저장 시 요청은 저장하지 않고 응답 body만(secret 위험 제거), 응답에 org id 같은 값이 있으면 가림 규칙 한 곳.
  - 대답 내용을 보지 않는 설계는 flaky를 줄이는 선택이라 맞음. 단정은 구조(JSON parse 가능, finish reason, usage 숫자)만.

### 하지 말 것 (선례에서 무거워진 부분)

- OpenAPI mock 서버 자체를 repo에서 pin하는 것(Steady): 유지비 대비 lophn 이득 없음.
- 거대한 cassette 저장소와 정규화/부분재생/prefix 검사 규칙 묶음(pydantic-ai).
- 거대 inline chunk 목록을 test마다 복붙(Vercel의 3만 줄 test 파일): fixture 파일 + helper로.
- capability flag가 계속 늘어나는 표준 suite(LangChain): provider 수가 적으니 단정 4개로 고정.

### 미확인 / 한계

- cassetter의 default record mode 이름, LiteLLM mock이 요청을 기록하는지, AIMock의 LLM fixture secret redaction 여부는 문서/코드로 확인 못 함.
- Vercel, LangChain의 flaky 이력은 issue 검색 몇 건만 봤고 전수 아님.
