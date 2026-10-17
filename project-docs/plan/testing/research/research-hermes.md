# Hermes Agent의 test 환경 조사

조사 시점: 2026-10-17 기준 main (commit `0ab43d4f`, shallow clone, 읽기만 함, 실행 안 함).
대상 확인: 이름은 "Hermes Agent" (`NousResearch/hermes-agent`, Python, Nous Research). 설명은 "The agent that grows with you".
설치본은 `~/.local/bin/hermes` (sh wrapper) -> `~/.hermes/hermes-agent/...` 로 이어진다. 이 경로는 `~/.hermes` 아래라 읽지 않았고, GitHub clone을 기준으로 봤다.
clone 위치: 각 repo의 GitHub 기본 branch(`--depth 1` clone, 지금은 지움)의 `hermes`
clean room: 코드는 옮기지 않았고 이름, path, 개수, 구조, 설계만 적었다. 개수는 grep으로 센 대략치(parametrize는 안 펼친 수).

앞선 조사(`research-cli.md`, `research-sdk.md`)와 달리 hermes는 **규모가 한 자리 더 크고**(test 함수 약 48,700개, test 파일 6,529개), **E2E를 제품 process(`hermes -z` 등)로 돌리는 것이 많다**. 그래서 "무거워진 것"의 사례로 가치가 크다.

---

## 1. test 층

### 1.1 폴더 구조
`tests/` 가 소스 트리를 그대로 따른다(placement mirrors source tree). `tests/<소스 최상위 dir>/`.

| 폴더 | test 파일 수 | 비고 |
|---|---|---|
| `tests/hermes_cli/` | 1,653 | CLI, config, auth, profile |
| `tests/gateway/` | 1,515 | messaging gateway (Telegram/Discord/Slack 등 adapter) |
| `tests/agent/` | 1,016 | agent loop, provider adapter, compaction (unit, SDK client를 MagicMock) |
| `tests/tools/` | 800 | tool 구현 (terminal, file, mcp, approval, delegate) |
| `tests/tui_gateway/` | 321 | TUI JSON-RPC |
| `tests/hermes_state/` | 193 | SQLite session DB |
| `tests/cron/`, `scripts/`, `plugins/`, `pm/`, `acp_adapter/` | 163 / 162 / 130 / 124 / 82 | |
| `tests/e2e/` | 145 (+ 하위 헬퍼 포함 python 247개) | 아래 1.3 |
| `tests/fakes/` | fake 서버 module | 2절 |
| `tests/evals/`, `evals/` | 3 / 별도 | 5절 |
| `tests/ci/` | 35 | CI 스크립트 자체의 test |
| `tests/manual/`, `tests/integration/` | 0~1 | 수동, 외부 서비스 필요한 것 |

- 규칙: 파일 이름에 issue 번호를 쓰지 않는다. issue 번호는 module docstring에 "Regression for #N"으로 (과거 `test_413_*`, `test_860_*` 같은 이름이 남아 있다).
- 규칙: test 안에서 소스 파일 text를 읽는 test 금지, "change-detector"(model catalog 개수, `_config_version` 값 고정) 금지, `sys.platform` 을 속이는 test 금지(그 OS에서 `@pytest.mark.platforms(...)` 로 돌림).

### 1.2 종류 구분과 개수
공식 구분은 marker 3개 + 폴더다.
- 기본(unit, "integration" 이라 부르는 in-process 포함): `tests/` 전체에서 `e2e`, `integration`, `live` 제외. 대부분이 여기. 한 test가 진짜 `AIAgent` + 진짜 SQLite를 쓰면서 SDK client만 mock하는 식이라 unit과 integration의 경계가 흐리다.
- `@pytest.mark.integration`: 외부 서비스(API key, Modal 등) 필요. 기본 addopts `-m 'not integration and not live'` 로 제외.
- `@pytest.mark.live`: 진짜 provider API (돈 씀). `-m live` 로만.
- `tests/e2e/`: 약 473 test 함수. 이 중 agent 흐름과 가까운 것은 일부이고, 상당수는 installer/updater(`upgrade` 147, `windows_update` 39, `windows` 15)다.
- 그 밖의 marker: `platforms(...)`(OS gate), `no_isolate`, `real_retry_backoff`, `real_concurrent_gate`, `requires_wal`, `ssh`.

### 1.3 도는 방법
- **bare `pytest` 금지**, `scripts/run_tests.sh` 만. 이 스크립트가 credential env를 비우고 `TZ=UTC`, `LANG=C.UTF-8`, `PYTHONHASHSEED=0`, `HERMES_HOME` 임시 dir로 고정한다("로컬에서 되는데 CI에서 깨짐" 사고가 반복돼서).
- **파일 단위 subprocess 격리**(`scripts/run_tests_parallel.py`): test 파일마다 새 `python -m pytest <file>` process. xdist는 안 쓴다. 이유(코드 주석): per-test spawn은 ~250ms x 17k = 70분 CPU라 못 쓰고, 파일 단위(~850개)면 3.5분이라 쓸 만하며, module-level dict/ContextVar의 파일 간 누수가 원래 flake 원천이었다.
- 병렬: worker 수 = CPU 수(`HERMES_TEST_WORKERS`로 조절). CI는 32 vCPU runner 2대로 slice(`HERMES_TEST_SLICE=1/2`). 한 대 안에서 약 10분. "96 core 한 대는 1.8배밖에 안 빨라지는데 값은 3배"라서 여러 대로 나눴다고 workflow 주석에 있다.
- 파일 timeout은 직전 정상 소요 시간의 3배로 자동 조정(소요 시간 cache를 CI가 유지).
- 격리(home/config/data dir): 루트 `tests/conftest.py`(1,533줄)의 autouse fixture 약 20개.
  - `_hermetic_environment`: credential 모양 env를 전부 비우고 `HERMES_HOME`을 `tmp_path`로.
  - `_forbid_real_hermes_home_io`, `_forbid_real_user_path_writes`, `_state_db_write_guard`, `_kanban_write_guard`: 진짜 `~/.hermes`나 사용자 경로에 쓰려 하면 실패. `live_system_guard` 자체의 self-test도 있다.
  - basetemp를 사용자 home 밖으로 옮기고, session이 끝나면 `HERMES_HOME`이 그 아래인 남은 process를 reap.
  - 브라우저 열기, 오디오 재생, macOS keychain, 모든 새 SessionDB 누수까지 autouse로 막음.
  - 규칙: `HOME`은 그대로 두되 `HERMES_HOME`은 `$HOME/.hermes`의 형제로(진짜 home으로 오인 방지).
- 지침 문서가 3겹이다: 루트 `AGENTS.md`(169줄) -> `tests/AGENTS.md`(154줄) -> 영역별 `agent/AGENTS.md` 등. CONTRIBUTING.md는 1,039줄.

### 1.4 CI
- workflow 56개. test 관련: `tests.yml`(unit 2 slice + e2e + e2e-upgrade shard들), `tests-os.yml`(OS lane), `live-providers.yml`, `windows-venv-e2e.yml`(`wine2e/**` branch push에만), `js-tests.yml`, `rust-tests.yml` 등.
- `scripts/ci/classify_changes.py`가 바뀐 파일로 lane을 고른다(python, frontend, docker, nix, e2e ...).
- **E2E는 PR과 main push에서 돌지 않는다.** `ci.yaml`이 e2e lane을 release 실행이나 수동 dispatch일 때만 켠다(classifier는 "이 diff는 이 suite를 건드린다"까지만 말해 줌). 즉 일상 PR의 게이트는 unit 약 48k, E2E는 release gate.
- flake 정책: 실패한 **파일**을 새 subprocess로 1번 재시도(`--file-retries`, `HERMES_TEST_FILE_RETRIES=0`로 끔). signal로 죽었거나 파일 timeout이면 재시도 안 함(폭주를 2배로 만들지 않으려고). 재시도로 통과하면 초록이지만 `FLAKY`로 두 출력과 함께 찍는다("noise가 아니라 고칠 bug").

---

## 2. fake가 끼는 곳

두 층에 서로 다른 방식이 있다.

### 2.1 unit/in-process: SDK client를 MagicMock
- `AIAgent(...)`를 진짜로 만들고, `agent._anthropic_client = MagicMock()` 처럼 provider SDK client만 바꾼다. streaming은 `MagicMock`으로 context manager(`__enter__`가 stream 반환, stream의 `__iter__`와 `get_final_message`)를 흉내 낸다.
- 규모: `completions.create`를 건드리는 test 파일 112개, `MagicMock` 쓰는 파일 1,052개, `patch(` 쓰는 파일 1,311개, `monkeypatch` 쓰는 파일 4,144개.
- `tests/agent/conftest.py`가 retry backoff를 0으로 만드는 autouse fixture를 둔다(안 그러면 retry test 한 개가 5초 이상). 진짜 backoff 값을 봐야 하는 test만 `real_retry_backoff` marker로 빠짐.
- 이 방식의 약점이 스스로 드러난다: fake 객체가 SDK 내부 모양(`stream.get_final_message`)에 묶인다.

### 2.2 E2E: loopback HTTP 서버(주 fake) + 제품 process
- `tests/fakes/fake_llm_provider.py` (463줄): `ThreadingHTTPServer`를 `127.0.0.1:0`(port 0)에 띄워 **OpenAI Chat Completions** wire(JSON과 SSE)를 말한다. 제품은 `config.yaml`의 `model.base_url` 만 서버 주소로 바꿔 부른다(`write_hermes_home(home, base_url)` helper가 최소 config.yaml과 가짜 `.env`를 씀).
- 이것을 쓰는 test 파일 88개(전체 중 `tests/fakes/*`를 import하는 파일 145개).
- 제품을 띄우는 법이 여러 가지다.
  - in-process: 진짜 `AIAgent` + 진짜 `SessionDB`(디스크 SQLite) + 진짜 tool, fake 서버만 가짜 (compaction suite).
  - 한 process 안 child driver: `python -m tests.e2e.core.chaos._agent_driver <spec.json>` 가 agent를 만들고 turn을 돌리며 stdout에 `CHAOS {json}` 줄(ready, turn_start, turn_end, closed)을 내고 stdin의 `interrupt` 줄을 받음.
  - 제품 CLI: `subprocess.run(hermes_argv("-z", prompt, "--usage-file", ...))` 로 진짜 `hermes -z` 를 돌리고, 끝난 뒤 state.db를 read-only로 열어 검증.
  - 그 밖에 `tui_gateway`(stdio JSON-RPC), dashboard(HTTP), PTY/tmux 기반 터미널 test.
- child process env는 **allowlist**(PATH, LANG, TZ 등만). 개발자 shell의 `TERMINAL_CWD`, provider key 등이 prompt나 routing을 바꾸지 못하게.
- 7개 dialect fake가 `tests/fakes/providers/`에 따로 있다(각 330~760줄): `anthropic_messages`, `openai_responses`, `chat_variants`(OpenRouter/Nous/DeepSeek/Ollama 변형), `gemini_native`, `bedrock_converse`, `vertex`, `codex_app_server`, `copilot_acp` + OAuth/catalog fake. 그 사용량은 불균형하다: `AnthropicMessagesServer` 5개 파일, `GeminiFake` 5개 파일, `FakeLLMServer` 88개 파일.
- 호스트 이름으로 라우팅을 바꾸는 provider(openrouter.ai 등)는 `HTTP_PROXY`를 fake로 두고 `base_url: http://openrouter.ai/...`를 써서 absolute-form 요청을 받는다. HTTPS 전용(Gemini 등)은 loopback `CONNECT` proxy + 즉석 CA(`SSL_CERT_FILE`)로 TLS를 종단한다. Bedrock은 `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`으로 boto3가 진짜 SigV4 서명/파싱을 하게 두고 서비스만 가짜.

### 2.3 대답을 정하는 꼴
- 기본: **순서 queue**(`FakeLLMServer([Text(..), ToolCall(..), ...])`). 비면 `default_text`로 대답.
- 또는 **함수**: `Responder = Callable[[request record], Response]`. handler thread에서 돌므로 막고 있다가 풀어 주거나 요청 내용(credential 포함)으로 분기할 수 있다. compaction suite는 module 단위 서버 하나에 시나리오마다 main/aux 함수를 바꿔 끼운다(`Dispatch`).
- **main/aux 분리**: `tools`가 있는 요청은 main turn으로 script를 소비하고, `tools`가 없는 요청(제목 생성, compaction 요약, judge)은 aux 함수가 받아 script를 소비하지 않는다. 이 분리 하나로 부수 호출이 queue를 어긋나게 하는 문제를 막는다.
- matcher/DSL은 없다. fixture 파일 재생도 없다(3.2 참조).
- `push()`로 나중에 추가, `drop_unconsumed()`로 안 쓴 response 폐기.

### 2.4 streaming, 오류, 잘림, 무응답
`Response`는 dataclass 7종의 union:

| 종류 | 내는 것 |
|---|---|
| `Text` | 본문(+reasoning)을 `chunk_chars` 크기로 SSE, chunk당 지연, usage(prompt/completion/cached tokens), finish_reason 지정 |
| `ToolCall` | 한 assistant 메시지에 tool call 1개 이상(parallel), 인자를 **문자열 그대로** 보내 깨진/잘린 JSON 흉내 |
| `Error` | HTTP status(429/500/400), message, `Retry-After` |
| `Hang` | 요청을 받고 N초(기본 1시간) 응답 안 함 |
| `DropMidStream` | 앞 N글자 stream 후 finish chunk 없이 socket 닫기 |
| `StallMidStream` | 앞 N글자 후 socket은 열어 둔 채 침묵(멈춘 upstream) |
| `Raw` | 임의 body/status/content-type (깨진 JSON, HTML 오류 페이지) |

dialect 서버는 추가로 provider 고유 오류(HTTP 200 안의 `response.failed`, 200 SSE 안의 `{"error"}`, 차단된 candidate, 반쯤 보낸 tool call 후 끊김, AWS eventstream 예외 frame)를 낸다.
대규모 시간 제어: 가상 시계 cron soak(`delivery/_cron_clock.py`), 하지만 대부분은 실제 시간 + 큰 timeout(1시간짜리 Hang) + config의 timeout을 줄이는 식.

### 2.5 test가 보낸 요청을 검사하는 법
- 서버가 모든 요청을 기록(`requests`: kind main/aux, body, header, 시각 `t`). 접근자: `main_requests()`, `aux_requests()`, `wait_for_requests(n, timeout)`. 요청 시각 차이로 `Retry-After` 대기가 지켜졌는지까지 봄(429 test).
- **재사용 invariant 함수**: compaction suite의 `assert_wire_request_ok`(system 먼저, 첫 user 존재, tool_call/tool_result 쌍 일치, user->user 없음), `assert_persisted_prefix`(state.db에 있는 것 = 요청에 실린 history prefix), `assert_db_recoverable`, `assert_db_matches_history`. 같은 invariant를 여러 파일이 공유한다.
- 같은 대화를 세 군데에서 교차 검증(history suite): 모델에게 보낸 것(fake 기록), resume 때 모델에게 갈 것, resume 때 사용자에게 보일 것, 과금 기록.
- prompt cache: 같은 turn의 요청 prefix가 process를 넘어 byte 단위로 같은지(`test_prefix_stability`).

---

## 3. fake가 진짜와 어긋나지 않게 하는 장치

### 3.1 SDK를 oracle로 삼아 fake를 검증 (가장 독특)
- Anthropic/OpenAI Responses/chat 변형 fake는 **받은 요청 body를 설치된 공식 SDK의 request type(TypedDict + pydantic TypeAdapter)으로 검증**하고, 위반과 모르는 key를 요청 기록(`schema_errors`)에 남긴다. 응답/SSE event/오류 envelope는 `anthropic.types`, `openai.types.*` model을 만들어 `model_dump`로 직렬화(= SDK가 진짜 vendor에서 parse할 모양 그대로).
- 모든 conformance cell이 끝에 `schema_errors() == []`를 단정한다.
- Gemini fake는 공개 API reference의 proto(`GenerateContentRequest` 등)로 검증하고, 진짜 Google처럼 400 `INVALID_ARGUMENT`를 돌려준다(role 교대, functionCall/functionResponse 짝, thought signature 규칙, schema subset 포함). Bedrock fake는 SigV4를 다시 계산해 틀리면 403, botocore service model로 입력 shape 검증, signed thinking은 fake가 발급한 서명만 통과.
- **"fake 자신이 실패할 수 있어야 한다"** test(`test_anthropic_oracle.py`): 알려진 나쁜 body(어떤 content block에든 모르는 key 등)를 일부러 넣어 oracle이 잡는지 parametrize로 확인. oracle이 너무 관대하면 모든 cell이 의미 없다는 인식.

### 3.2 녹화 (사실상 안 씀)
- `AnthropicMessagesServer(record_upstream=..., cassette=...)` record mode가 문서화돼 있다(진짜 upstream에 proxy하고 auth header/key를 뺀 exchange를 jsonl로 저장). 그러나 **commit된 cassette 폴더가 없다**. record mode를 쓰는 곳은 oracle test 한 곳이고 그것도 두 번째 로컬 fake에 대해서다("never run in CI or against a paid key by this suite").
- 즉 hermes에서는 "진짜 응답 녹화 fixture를 재생"은 거의 없다. 대신 fixture 하나 `tests/fixtures/provider_wire_snapshot.json`(provider별 request kwargs snapshot, `HERMES_UPDATE_WIRE_SNAPSHOT=1`로 갱신)과 transport parity test(provider별 현재 동작을 고정)가 있다. 이것은 오히려 change-detector 성격이라 `tests/AGENTS.md`의 금지 원칙과 약간 충돌한다.

### 3.3 live canary (진짜 provider)
- `tests/e2e/core/live/test_live_providers.py` (289줄) + `_helpers.py` (379줄). marker `live`, `-m live`로만. 진짜 `AIAgent` + 진짜 adapter + 진짜 vendor endpoint, tool은 합성 `live_lookup` 하나.
- 질문 3가지만 본다: wire format drift(모든 요청이 4xx 없이 받아들여짐, tool call 인자가 JSON, 병렬 tool call 왕복, reasoning replay 포함 history 재전송 수락, reasoning/tool markup이 본문에 안 샘), prompt cache hit, 진짜 인증/routing(보낸 credential이 해당 provider host에만 감, `/models` parse). **대답 내용의 품질은 안 본다.**
- 대상: openrouter 경유 6개 family + nous + anthropic + openai 직결 등 `LIVE_CASES` 약 9개 + models listing parametrize.
- gate: (1) marker + 기본 addopts 제외, (2) credential env가 없으면 case별 skip, (3) CI `live-providers.yml`은 release tag push 또는 수동 dispatch에서만, repo가 `NousResearch/hermes-agent`일 때만(fork/PR엔 secret 없음), (4) secret 값은 해당 step에서만 env로 노출(job 레벨엔 boolean만), (5) 전용 spend-cap key(`LIVE_*_API_KEY`).
- 비용 관리: 싼 model, case당 최대 3 turn, `max_tokens=2048`, `max_iterations=6`, 한 test 당 token 90,000 / $0.12 상한을 단정, 실행 후 `LIVE-USAGE` 줄과 `live-usage.jsonl`을 모아 job summary 표(model, calls, input/output/cache, 추정 $)로 출력. 전체 실행이 "$0.50 미만".
- 주의: 이 runner는 `scripts/run_tests.sh`가 아닌 직접 pytest(env -i 로 key를 지우기 때문).
- 알려진 live gap은 `known_failure`로(4.3).

---

## 4. flow case

### 4.1 E2E 묶음별 개수 (`tests/e2e/core/*`, 473 함수, parametrize 전 수)

| 묶음 | 폴더 | test 함수 | 비고 |
|---|---|---|---|
| provider wire / 오류 / 재시도 | `providers/` | 125 | anthropic, openai responses, gemini, vertex, bedrock, codex app-server, copilot, catalog, oauth 등. 파일 36개 |
| chaos (turn liveness) | `chaos/` | 4 (시나리오 parametrize 각 약 20+) | agent / gateway / tui_gateway 3 surface에 같은 fault matrix |
| 보안 (허락·권한 경계) | `security/` | 25 | approval boundary, secret redaction, workspace escape(쓰기 sandbox, 보호 path), store traversal, profile secret scope, attach handshake |
| MCP / plugin | `mcp_plugins/`, `parity/` | 21 + 일부 | stdio·streamable HTTP conformance, untrusted server 파괴적 tool 거부, 401, server 죽음, host crash 후 grandchild reap |
| compaction | `compaction/` | 10 (seed 3개 x mode 다수로 펼침) | 자동·수동·요약 실패·kill -9 |
| history / session 복원 | `history/`, `terminal/`, `sqlite/` | 3 + 3 + 3 | transcript ledger, prefix 안정성, multi-client session model, interactive roundtrip, state.db 무결성 |
| 메시지 전달 / cron | `delivery/` | 10 | exactly-once, 가상 시계 cron soak |
| kanban / dashboard / tenancy / platforms / tui_pty | | 15 / 13 / 4 / 4 / 4 | |
| installer·updater | `upgrade/`, `windows*/` | 147 / 54 | agent 흐름 아님, release 위험 |

unit 쪽 주제별 대략 (파일 이름 grep, E2E 포함): approval/permission 630(76 파일), checkpoint/rewind/undo 240(41), compress/compact 1,294(190), interrupt/abort/cancel 327(77), resume/session 복원 304(47), mcp 1,209(149), delegate/subagent 554(92), retry/fallback/429 813(162), hook 506(75), skill 1,178(128), config 1,077(156), file tool 481(59), streaming 598(95), redact/secret 528(69), cron 1,751(219).

### 4.2 대표 셋
1. **provider 오류 재시도** (`providers/test_chat_errors.py`, 147줄, 4 함수 + parametrize): 진짜 `hermes -z` process, 서버 script `[CError(429, Retry-After), CText]`. 단정: 종료 코드 0, stdout, 서버가 본 응답 종류 순서, **재시도 간격이 Retry-After 이상(그리고 짧은 hint를 backoff floor로 부풀리지 않음)**, 재시도가 같은 대화를 다시 보냄, state.db에 assistant 답이 정확히 1개. 다른 case: stream이 tool call 도중 끊기면 반쯤 온 call은 실행되지 않고 완성 call이 **정확히 1번** 실행됨(파일에 한 줄), call/result 짝이 1쌍. HTTP 200 stream 안 영구 ban은 한 번 실패하고 사용자에게 보이며 재시도 폭주 없음.
2. **chaos fault matrix** (`chaos/test_agent_turn_liveness.py`, 약 530줄): `Scenario(id, response함수, cfg, expect, call_bound)` 약 20개 (provider_hang, stall, 500/429/400 영구, 깨진 body, 중간 끊김, hang 후 회복, 느린 trickle은 stale 아님, tool 인자 잘림/쓰레기/모르는 이름, 병렬 8 terminal, tool hang, stdin 읽는 tool, 백그라운드 swarm, 거대 출력, turn 예산 소진, 중단 3종). child driver를 시나리오마다 동시 실행. **매 fault 뒤 같은 invariant**: 정해진 시간 안에 끝남, provider 호출 수 상한(retry storm 방지, 400은 재시도 안 함), 같은 agent가 다음 PROBE turn에 답함(interrupt flag, wedge 없음) + PROBE 요청에 faulted turn이 담김, 모든 tool_call에 자기 tool result가 DB와 전송 history 둘 다에 있음(병렬 8에서 id마다 자기 출력), scenario tag를 단 process가 안 남음, `state.db integrity_check == ok`.
3. **compaction** (`compaction/`): 진짜 AIAgent + SessionDB + `read_file`, 임계값을 12K token으로 낮춰 몇 turn 만에 발동. 단정: 위 `assert_wire_request_ok`류 invariant 4개, 나쁜 요약(거절문, 잘린 요약)은 절대 context나 DB에 들어가지 않음, 요약 서버 HTTP 500은 호출 수가 유계이고 손실 없음, mid-compaction `kill -9` 뒤 state가 일관되고 재개 가능, 사용자 message가 live(active) 아니면 archive(compacted) 중 하나로 반드시 존재.

### 4.3 고르는 기준이 문서에 있는가
있다. 규칙은 문서화돼 있고 꽤 구체적이다.
- 루트 AGENTS.md "Wanted": 재현 가능한 bug fix, 행동 계약(behavior-contract) test, "resolution/config/security/I-O 변경은 임시 HERMES_HOME의 진짜 import로 E2E". "Rejected": change-detector test.
- `contributing.md` rubric: "E2E validation, not just green unit mocks. 해결 chain, config 전파, 보안 경계, 원격 backend, file/network I/O를 건드리면 진짜 경로를 돌려라. mock은 통합 bug를 숨긴다."
- 커밋 규칙: **fix 하나에 invariant test 1~2개, base에서 red임을 증명.**
- E2E의 단위는 bug가 아니라 **"failure class"**(C1 state.db 무결성, C3 transcript ledger, C4 compaction, C7 two-tenant, C8 chaos, C9 wire drift, C11 인증 routing, C12 exactly-once, C13 cron, C17 prompt cache, C18 legacy config ... 최소 19개). 파일 docstring이 "이 class의 invariant"를 나열하고 시나리오 matrix로 같은 invariant를 반복 단정한다. 개별 bug를 "그 class의 한 시나리오"로 흡수하는 방식(`#92450` retry storm, `#93251` 병렬 tool 출력 id 같은 번호가 invariant 주석에 남음).
- **bug 회귀 비율**: test 파일 6,529개 중 `#NNNN` issue 번호를 담은 파일 3,065개(47%), "regression" 또는 번호를 담은 파일 3,510개(54%). E2E는 247개 python 파일 중 106개(43%). 즉 test의 절반이 bug 이력에서 나온 것.
- 알려진 gap 관리: `known_failure(pattern, reason)` — 실패 메시지가 정해진 pattern과 같을 때만 run-time xfail, 다른 실패(timeout, boot 실패)는 그대로 실패, fix가 merge되면 그냥 통과. strict xfail은 fix merge 순서에 따라 main을 빨갛게 해서 버렸다. `HERMES_E2E_STRICT_ACCEPTANCE`면 gap을 면제하지 않는다. E2E 쪽 `KNOWN`/`known_failure` 참조 287곳, 전체 xfail 49곳, skip 845곳.

---

## 5. eval/benchmark와 test의 분리

- `tests/evals/`(3개): offline 불변식 test(예: eval용 compactor가 tool call/result 짝을 깨지 않는가). pytest에 들어가 있어 CI 대상.
- `evals/`(루트, 1.9MB, 약 60개 항목): test가 아니라 **실험·A/B·재현 probe 스크립트와 README**. 예: compaction recall eval(transcript -> 요약 -> 새 LLM에게 recall 질문 -> 채점 -> scorecard, transcript는 실데이터라 commit 안 함, 합성 transcript만 CI smoke), provider_wire의 이슈별 재현(`issue_103944.py` 등: localhost SDK HTTP로 credential 없이 arm A/B 비교), codebase navigability(LLM agent가 코드를 읽는 비용, offline 결정적, tokenizer 사용), subagent handoff stress(live), token accounting 등. 결과는 `evals/*/results/SCORECARD-날짜.md`로 commit. CI workflow에서 `evals/`를 직접 부르는 곳은 못 찾았다.
- 구분 요약: test = 합격/불합격 게이트(pytest). eval = 수치를 남기는 실험(수동, 날짜가 붙은 scorecard). model 행동 품질을 CI로 재는 ALWAYS/USUALLY 식 장치는 없다(live canary도 품질이 아니라 wire).

---

## 6. 무거워진 것, 줄인 것, flaky 교훈

무거워진 것
- 규모: test 함수 48.7k, 파일 6.5k. 한 번 전체를 돌리는 데 32 vCPU 2대 x 약 10분. unit도 `MagicMock` 파일 1,052, `patch(` 1,311개, `monkeypatch` 4,144개.
- 이름에 issue 번호를 붙인 파일이 쌓여 규칙(`No issue numbers in filenames`)으로 막아야 했음. 같은 정의의 test가 가려지는 문제까지 생겨 `test_no_shadowed_test_definitions.py` 가 있다.
- root conftest 1,533줄(autouse 20개): 전역 상태(SessionDB, kanban, tui server, event loop, 오디오, keychain)가 누수되는 경로마다 fixture를 하나씩 더함.
- dialect fake 7종 + 보조 8종, 각 300~760줄, TLS CONNECT proxy, SigV4 재계산, AWS eventstream 인코더까지 직접 구현. 유지 비용이 제품 코드 수준.
- E2E를 PR 게이트에서 뺌: 무거워서 release/수동에만 돌린다.
- CI 자체의 test(`tests/ci/` 35개)와 workflow 56개.

줄이거나 막은 것
- xdist 제거, 파일 단위 subprocess 격리로 교체(누수 flake 제거).
- `time.sleep`/`asyncio.sleep`를 새로 쓰면 코드 품질 ratchet(HX013)이 실패시킴 -> `tests.waiting.wait_until`(polling) 또는 Event. 시간 bound는 2초 이상, "조건이 계속 거짓" 단정(`assert not wait_until`)은 경쟁이라 금지. 단 fake 서버 자체의 `wait_for_requests`는 `time.sleep(0.02)` polling.
- retry backoff를 unit에서는 0으로(autouse), 진짜 값은 marker로 opt-in.
- strict xfail을 run-time `known_failure`로 바꿈(merge 순서 문제).
- source text를 읽는 test, change-detector test, OS를 속이는 test를 규칙으로 금지.
- 부분 실패 격리: 실패한 파일만 1회 재시도, 죽은/timeout 난 것은 재시도 안 함. FLAKY는 별도 표시로 "고칠 bug"라고 못 박음.
- 같은 해 시도: `sys.platform` patch를 없애고 실제 OS lane으로(`wine2e`는 실제 Windows runner에서 process topology 확인).

flaky 교훈(문서에 명시)
- 큰 머신에 API key가 설정된 채로 pytest를 직접 돌린 것이 "로컬은 되는데 CI는 안 됨"과 그 반대의 반복 원인 -> credential을 지우는 runner를 강제.
- 파일 간 module-level 상태 누수가 원래 flake 원천.
- 시간 test는 한가한 runner를 가정하지 말 것(2초 미만 bound 금지).
- 제목 생성 thread의 실패 경고가 capture swap과 겹쳐 interpreter가 SIGSEGV 하던 경쟁까지 conftest 훅으로 막음(background thread 정리).
- background review(memory/skill nudge)가 두 번째 agent를 같은 fake provider에 몰래 붙여 scripted turn을 어긋나게 해서 E2E config에서 끄는 상수(`NO_BACKGROUND_REVIEW`)를 따로 둠. 즉 **fake queue는 의도하지 않은 부수 호출에 취약**하고, 그래서 main/aux 분리와 부수 기능 끄기가 필요했다.

---

## lophn에 줄 것

### 앞선 조사와 다른 점
- `research-cli.md`(Codex, OpenCode, Gemini, Goose, Aider)와 `research-sdk.md`(Vercel AI, pydantic-ai 등)는 "fake를 어디에 끼우나"의 선택지를 봤다. hermes는 그 중 **"loopback HTTP 서버 + 제품 process"** 한 가지를 아주 깊이 팠고, 두 가지가 새롭다.
  1. fake가 **공식 SDK의 request schema를 oracle로 써서 받은 요청을 검증**하고 응답도 SDK model로 만든다(녹화가 아니라 schema로 어긋남을 막음). "fake가 실패할 수 있는가"를 test로 확인.
  2. E2E를 **failure class + 시나리오 matrix + 공통 invariant**로 설계(bug 하나당 test 하나가 아님). 같은 matrix를 agent/gateway/TUI 세 surface에 반복.
- 반대로 앞선 조사에서 좋았던 **녹화 cassette 재생(OpenCode)** 은 hermes에 사실상 없다(record mode 코드만 있고 committed 파일 0). 즉 "녹화로 fake 정확도"의 사례는 hermes에서 못 얻는다.
- 앞선 조사들은 대체로 수백 test 규모. hermes는 48k라서 "커졌을 때 무엇이 아픈가"의 사례다. 파일 단위 subprocess 격리, 전역 autouse guard 20개, E2E를 release로 미룬 것이 그 흔적.

### 가져올 만한 것 (3개 이내)
1. **fake 서버 vocabulary 최소판**: 463줄짜리 `FakeLLMServer`의 꼴 그대로 작게. 응답 종류 7개(Text, ToolCall(인자를 문자열로도), Error(status+Retry-After), Hang, DropMidStream, StallMidStream, Raw) + queue 또는 함수(responder) + **main(tools 있음)/aux(tools 없음) 분리** + 요청 기록(body, header, 시각)과 `wait_for_requests`. 서버는 port 0, base_url만 주입. harness test와 core E2E가 같은 서버를 쓴다. (research-cli 5의 결론과 같지만 main/aux 분리와 "인자 문자열 그대로" 가 새로 얹힌다.)
2. **공통 invariant 함수 + fault matrix 하나**: 요청마다 `assert_wire_request_ok` 식 검사(system 먼저, tool_call/tool_result 짝 일치, role 교대)를 모든 E2E가 공유하게 두고, 오류·잘림·무응답·중단을 시나리오 표 한 파일에 모아 "끝남(시간 유계), provider 호출 수 유계, 같은 agent가 다음 turn에 답함, 모든 tool call에 result, DB/ledger 무결성"을 매번 단정. AGENTS.md의 "테스트는 몇 개면 충분" 원칙과도 맞는다(시나리오는 data, test 함수는 하나). 단 process를 띄우는 E2E는 새로 만들기 전에 사람에게 묻는다.
3. **live canary의 gate와 비용 상한**: marker/전용 task로만, key 없으면 skip, 기본 check에는 절대 안 들어감, case당 max_tokens·turn·token·$ 상한을 단정, 사용량 요약 출력, 대답 품질이 아니라 wire(요청이 수락되는가, tool call이 parse되는가, 병렬 tool call 왕복, reasoning replay, 인증 대상 host)만 본다. key 값은 해당 실행에서만 노출.

### 피할 것
- test 수와 층의 팽창: 파일 단위 subprocess runner, root conftest autouse 20개, CI 자체의 test, workflow 56개. lophn은 `deno task check`가 한 번에 빨라야 한다.
- MagicMock으로 SDK client를 흉내 내는 unit(1,052 파일). lophn은 provider를 직접 HTTP로 부르므로 해당 없고, 이 방식은 fake가 SDK 내부 모양에 묶이는 약점을 보인다.
- provider dialect마다 fake를 따로(7종, 각 300~760줄, TLS proxy, SigV4, eventstream 구현). 진짜가 필요한 wire 검증은 live 한 번과 "받은 요청을 schema로 검증"으로 줄인다. lophn이 schema를 쓸 수 있으면(공식 SDK 타입이나 공개 schema) 요청 검증만 추가하고 응답 builder를 키우지 않는다.
- provider_wire_snapshot류 고정값 test(change-detector)와 issue 번호 파일명. hermes 자신도 이를 금지 규칙으로 막고 있다.
- 실제 시간 기반 대기(1시간 Hang + 짧은 config timeout, polling sleep). lophn은 gate/Event나 Clock 인자를 쓴다(Clock을 인자로 받는 규칙이 이미 있음).
- `known_failure` 같은 xfail 관리 장치. 프로토타입에서는 틀린 test를 지우는 쪽이 낫다.

### 미확인
- 설치본(`~/.hermes/hermes-agent`)은 사람 설정 폴더 아래라 읽지 않았고 GitHub main으로 대체했다. 설치된 판과 main이 다를 수 있다.
- 개수는 `def test_` 줄을 센 것이라 parametrize를 펼친 실제 실행 수는 훨씬 많다. 실제 소요 시간은 CI 주석 값(약 10분/slice)만 확인했고 직접 재지 않았다(실행 금지).
- 데스크톱 앱(`apps/desktop`)의 Playwright/Electron E2E와 JS(vitest) test는 보지 않았다.

## 참고 path
`tests/AGENTS.md`, `AGENTS.md`, `website/docs/developer-guide/contributing.md`(rubric), `tests/conftest.py`, `scripts/run_tests.sh`, `scripts/run_tests_parallel.py`, `pyproject.toml`([tool.pytest.ini_options]), `.github/workflows/{ci.yaml,tests.yml,live-providers.yml}`, `scripts/ci/classify_changes.py`,
`tests/fakes/fake_llm_provider.py`, `tests/fakes/providers/{anthropic_messages,openai_responses,chat_variants,gemini_native,bedrock_converse}.py`,
`tests/e2e/core/{providers/test_chat_errors.py,providers/test_anthropic_oracle.py,chaos/test_agent_turn_liveness.py,chaos/_agent_driver.py,compaction/_helpers.py,history/_helpers.py,live/{test_live_providers,_helpers}.py,_pending_fixes.py}`, `tests/agent/{conftest.py,test_anthropic_mid_tool_call_drop.py}`, `tests/evals/`, `evals/{compaction,provider_wire,codebase_navigability}/`
