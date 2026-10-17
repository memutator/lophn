# test 환경을 처음부터 다시 만들기

상태: 로드맵. 아직 계획(`plan/`)으로 열지 않았다. 열 때 이 문서를 계획 README의 재료로 쓴다.
배경 문서: AGENTS.md "속도", `.claude/skills/write-test/SKILL.md`, `project-docs/architecture/`의 "지키는 것".

## 왜

- 10-16의 `13a7365e9`가 test 1,503 file과 `e2e/`를 모두 지웠다. test 줄이 제품 코드보다 많았고 check가 40~60분 걸렸다. 그 뒤로는 unit만 87 file 쌓였다.
- 여러 process를 건너는 동작을 보는 test가 없다. agent runtime의 Deno 권한, API key 연결, release 준비처럼 process를 건너야 보이는 것은 이번 판에서 손으로만 확인했다. 다음 변경에서 깨져도 잡을 장치가 없다.
- loop의 안전 규칙(잘린 대답의 tool, retry, 한도, 멈춤)과 provider 오류 분류를 보는 test가 없다. 코드로 읽은 의심이 넷 있다("정할 것" 4~6).
- model fake로 `tools/fake-provider/`(13 file, 1,609줄)가 있지만 test가 없고 쓰는 곳도 없다. `deno task dev`가 넘기는 `LOPHN_FAKE_PROVIDER_URL`을 읽는 코드는 처음부터 없었다. 그래서 dev의 agent가 fake에 닿지 않는다.

## 지금 모양

### test와 check

- `*_test.ts`는 87개, 8,838줄이다: core 72, shell 9(main 5는 `node --test`), coding-agent 2, protocol 2, base 1, sdk 1. process를 띄우는 test는 `core/apps/permissions/sandbox-boundary_test.ts` 하나다(subprocess 한 번).
- `tools/check.ts`(481줄)의 test 단계는 `deno test --no-check --allow-all --permit-no-files`다. fast는 바뀐 package의 `*_test.ts`만 넘긴다. `packageOf`는 `packages/<p>/`와 `tools/`만 package로 안다. full은 `--parallel` discovery다. 그래서 루트 `tests/`는 fast에서 안 잡히고 full에서는 다 잡힌다. 돌 package가 없으면 file 인자가 비어 전체 discovery가 된다(코드로 읽음).
- `deno.json`에 test·e2e task가 없다.

### model 호출 길

- loop: `run-loop/loop.ts`의 `startTurnLoop`는 `TurnPorts` 8칸(stop, inputs, context, model, tools, checkpoint, answer, finish)만 안다. model 칸은 `ModelPort`(`run-loop/ports.ts:113`: `pack`, `available`, `call(request, signal)`)다. `createTurnPreparer`(`prepare.ts`, 847줄)는 core read 11개와 command 2개를 쓰고, place data로 read를 최대 11개 더 쓴다.
- model: `models/resolve.ts`의 `createModelResolver({machine, attach?, catalog, fetch?, nowMs?, timeoutMs?})` → `providers/invoke.ts` → adapter 셋(anthropic-messages, openai-responses, openai-chat-completions). adapter의 judge가 complete, partial, refused, failed를 낸다. 오류 분류는 `providers/failures.ts`다.
- 한도와 retry:
  - `DEFAULT_TURN_LIMITS`: model_attempts 30, stall_ms 300_000, active_ms 1_800_000.
  - `MODEL_RETRY_MAX` 2: 2초, 4초, 또는 `retry_at`. `TOOL_RETRY_MAX` 1: 읽기 tool만.
  - partial이면 machine 글(`turn.ts:482`)을 붙여 같은 한도로 다시 부른다.
  - 제품은 `timeoutMs`를 넘기지 않는다. 호출당 timeout이 없다.
- role의 tool 묶음은 core 없이 만들 수 있다: `agentTools()`(`main/agent-tools.ts`) → `selectTools(builtinToolNames(role), …)`(`tools/registry.ts:67`).

### core 기동과 사람 역할

- process: Electron main → core daemon(`core/main/daemon/main.ts`, `startCore`) → agent runtime child, app supervisor child(앱마다 Deno child), worker child 6종.
- data root는 `LOPHN_HOME`이다(절대 path, 0700). 새 root면 기동이 `<root>/sdk/*/1.0.0` 8개와 `<root>/templates/app/`을 0444/0555로 깐다(`main/daemon/wiring/sdk-install.ts`). 지울 때는 `chmod -R u+w`가 먼저다(`tools/dev.ts`의 `removeDataRoot`).
- user token은 parent pipe의 hello frame(`user_token`, `api_port`, `core_epoch`) 한 번으로만 받는다. `<root>/run/location.json`에는 token이 없다.
- 사람이 하는 일은 user token으로 route를 불러 다 할 수 있다: `sessions/open`, `messages/send`, `turns/stop`, `approvals/decide_turn`(memory), `approvals/decide`, `rewind/preview` → `rewind/apply`, `apps/rewind_plan` → `apps/rewind`, `apps/call_api`, `apps/create`, `apps/connect_source`, `projects/create`. decision handle(shell main만 냄)이 필요한 것은 `providers/disconnect`, `providers/login-complete`, `problems/apply-decision` 정도다.
- provider 연결: `secrets/put`(upload. `x-lophn-input` header를 쓰고 `createRpcClient`로는 못 부른다) → `providers/connect`. key 없는 loopback provider는 `auth_kind: "none"`, `credential: null`로 정의를 직접 준다.
- models.dev: agent runtime child가 새 root의 첫 기동에 GET한다. 끄려면 기동 전에 `<root>/settings.json`에 `{"lophn-agent.model.catalog_auto_update": false}`를 둔다. 선언 안 된 key가 하나라도 있으면 file 전체가 거절된다.
- place 폴더나 provider가 바뀌면 runtime child가 1초 polling으로 다시 뜨고 돌던 turn이 끊긴다(`run-loop/runtime.ts`).
- 앱:
  - release 준비 route(`releases/prepare_bundle`, `releases/preparation`)는 coding_agent와 machine만 부른다.
  - coding token은 App Engineer가 ticket을 coding agent에게 맡길 때 Gateway `coding_terminal` open frame의 `plan.env.LOPHN_CODING_TOKEN`으로만 나온다.
  - activation은 `tickets/verify`(agent만)가 내는 `TicketVerified`에서 시작한다.
  - agent 사이 call(`calls/send`)도 agent만 보낸다.
- core 재시작:
  - 돌던 turn은 interrupted로 닫힌다(`interruptRunningTurns`). 받은 call은 `lophn_restarted`로 닫힌다.
  - 앱 invocation은 unknown(`core_restarted`)이 되고, 앱 rewind의 applying은 cancelled가 된다.
  - turn 안 permission request는 메모리라 사라진다.

## 목표 모양

### test 종류

| 종류 | 무엇이 진짜 | fake | 보는 것 | 자리 | 언제 |
|---|---|---|---|---|---|
| unit | 함수 하나 | 없음 | 데이터 잃기, 권한, sandbox, 되돌림 규칙 | 코드 옆 `*_test.ts`(지금 그대로) | check |
| harness loop | loop, tool, Gate, hook | scripted model | loop의 안전 규칙 | `tests/harness/loop/` | check |
| harness wire | provider adapter, 오류 분류 | 녹화 fixture를 `fetch`에서 재생 | 진짜 SSE를 맞게 읽고 분류하나 | `tests/harness/wire/` | check |
| core E2E | core, child process 전부, 앱 process | HTTP fake server | process 경계를 건너야 보이는 flow | `tests/e2e/` | `deno task e2e`. lead가 land 전에 |
| provider live | 진짜 provider와 model | 없음 | 받나, 잘리나, tool 인자가 JSON인가, token 수 | `tests/live/` | `deno task test:live`. 사람이 key를 줄 때만 |

eval(model 대답의 질)은 test와 따로 한다. 이 roadmap 밖이다.

### 폴더

```
tests/
  support/    scripted model, fake server, core 띄우기와 token, 사람 역할, data root 만들기·지우기, 공통 불변식
  harness/
    loop/
    wire/
  e2e/        flow 하나에 file 하나
  live/       공용 suite 하나 + provider별 얇은 file
  fixtures/
    provider/<provider>/<case>   녹화한 응답과 손으로 만든 짧은 응답
    apps/<이름>/                 test용 작은 앱(api 둘 정도)
```

- `tools/fake-provider/`는 옮기지 않는다. 지우고 새로 만든다(clean room). `deno task dev`도 새 fake server를 띄우고 `providers/connect`로 붙인다. `LOPHN_FAKE_PROVIDER_URL`은 지운다.
- `tools/check.ts`는 `tests/harness`를 fast와 full에 넣는다. `tests/e2e`와 `tests/live`는 `deno test` discovery에서 빼고(`deno.json` test exclude) 각자 task로 돌린다.

### fake 셋

- **scripted model**(harness loop): `TurnPorts.model`(`ModelPort`) 자리에 낀다. provider wire를 모르고, 정규화된 결과(outcome, text, tool call, usage)를 순서대로 낸다.
  - queue는 엄격하다. step이 남거나 호출이 더 오면 실패한다.
  - tool이 실린 요청(main)과 나머지(aux: 요약, 제목)는 따로 줄 세운다.
  - 받은 요청은 복사해 기록한다. 읽는 접근자는 몇 개만 둔다: tool 이름, system 글, 마지막 tool 결과.
  - 시간은 gate와 가짜 clock으로 다룬다. sleep을 쓰지 않는다.
- **녹화 재생**(harness wire): `createModelResolver({fetch})`에 fixture file을 돌려주는 `fetch`를 준다.
  - fixture는 live test가 응답만 저장하고, 사람이 diff를 보고 commit한다. 요청은 저장하지 않는다.
  - 끊긴 stream, 깨진 tool 인자, 4xx/5xx 같은 짧은 fixture는 손으로 만들어 같은 폴더에 둔다.
- **fake server**(core E2E, dev): loopback, port 0, suite당 하나, test마다 reset.
  - 응답 종류: text, tool call(인자 문자열 그대로), 오류(status, header), 무응답, 중간 끊김, 중간 멈춤, raw.
  - 받은 요청을 모두 journal에 남긴다. 기대와 다른 요청이 오면 차이를 담은 HTTP 오류로 대답한다.
  - agent가 여럿이면 session마다 따로 줄 세운다.
  - 응답의 꼴이 녹화 fixture와 같은 event 종류를 내는지 unit 하나로 본다.

## case 고르는 규칙

1. 쓰기 전에 세 질문을 통과해야 한다.
   - 어떤 contract를 지키나? boundary ID로 답한다.
   - 어떤 현실적인 회귀에서 깨지나?
   - 왜 지금 있는 test로는 못 잡나?
2. AGENTS.md의 위험 목록에 닿을 때만 쓴다: 데이터 잃기, 권한·secret·sandbox 경계, 두 번 고친 bug. "기능이 있으니 하나"는 안 된다.
3. contract 하나에 test 하나를 두고, 가장 싼 층에 둔다. core E2E에는 process 경계를 건너야만 깨지는 것만 둔다. 경우의 수는 harness에서 늘린다.
4. case 하나는 단계 6, fake 대답 3, 단정 3 이하다. 단정은 서로 다른 곳에서 한다: disk의 file, ledger·event, fake가 받은 요청. 화면 문구는 단정하지 않는다.
5. 변형은 table 한 줄로 둔다. 공통 불변식(tool call과 결과가 짝, ledger에 있는 것 = 요청에 실린 것)은 support의 함수 하나로 같이 쓴다.
6. 회귀는 그 contract의 table에 한 행으로 더한다. 새 file을 만들지 않는다. 고치기 전 코드에서 실패하는 것을 확인한다.
7. 새 E2E는 10번 연속 통과한 뒤 넣는다.
8. flaky한 case는 꺼 두지 않는다. 고치거나, harness로 내리거나, 지운다.
9. lophn이 만든 것은 진짜를 쓰고, lophn 밖의 것만 가짜를 쓴다.
   - 진짜: core, child process, 앱 process.
   - 가짜: model provider.
   - test가 대신하는 것: coding agent CLI, 사람, shell의 Gateway 역할.
   - 막는 것: 인터넷.
   - 제품에 test 전용 flag나 지름길을 넣지 않는다. fake로 가는 길은 `providers/connect`와 `settings.json`(data)뿐이다.

시작 크기는 harness 20~40개, core E2E 6~10개(상한 12)다.

## 첫 case

### harness loop: 안전 규칙 다섯

규칙: (1) 불완전한 대답의 tool은 실행하지 않는다. (2) 쓰기 tool은 자동 retry하지 않는다. (3) 되풀이는 반드시 끝난다. (4) 멈춤은 진행 중인 요청을 끊는다. (5) 오류 종류가 retry 여부를 맞게 가른다.

| 규칙 | scripted model이 내는 것 | 기대 |
|---|---|---|
| 기본 | 답 하나 | turn 완료, 호출 1번 |
| 기본 | tool 하나 → 답 | tool 실행, 다음 요청에 tool 결과가 있음 |
| 1 | partial 안에 쓰기 tool | tool 실행 안 됨, 잘림 안내를 붙여 다시 부름 |
| 3 | 같은 partial을 계속 냄 | 정한 한도에서 turn이 실패로 끝남("정할 것" 6) |
| 3 | 무응답 | 정한 시간에 요청이 abort되고 끝남("정할 것" 5) |
| 4 | 무응답 중 사람이 멈춤 | stopped, 요청 abort |
| 2 | 쓰기 tool이 `unavailable` | 다시 실행 안 함, 실패를 model에 전함 |
| 2 | 읽기 tool이 `unavailable` | 한 번만 다시 실행 |
| 5 | temporary 둘 → 정상 | retry 2번 뒤 완료 |
| 5 | temporary 셋 | retry 2번 뒤 `model_error` |
| 5 | temporary + `retry_at` | 가짜 clock으로 그 시각까지 기다렸다 retry |
| 5 | credential_unavailable, refused, context_exceeded | retry 없이 끝남. 끝난 이유가 종류마다 맞음 |

더할 후보:
- approval 정책 table: tool 종류 × 정책 → 묻는다 / 허락 / 거절
- context 한도와 compact: 임계 직전·직후, compact가 실패해도 이력 보존
- 보낸 요청의 공통 불변식

### harness wire

- protocol 셋의 판정 table: 끝 event, 길이 한도(`max_tokens`, `incomplete`, `length`), 끝 event 없이 끊김, tool 인자 미완·JSON 아님, 거절(`refusal`, `content_filter`), stream 오류 frame → complete / partial / refused / failed.
- HTTP 분류 table: 401·403·402, 429(`retry-after` 30초 이하 / 그 밖), 500·502·503·529, 504·3xx, context 초과, model 없음 → `failures.ts`의 종류.
- 의심 A·B 행은 "정할 것" 4의 기대로 적는다.

### core E2E 후보

| # | flow | 지키는 것 |
|---|---|---|
| 1 | agent가 data root 밖 project 폴더에 file을 쓴다. 폴더 밖 쓰기는 거절된다 | agent runtime Deno 권한과 file tool scope |
| 2 | Gate가 걸린 쓰기 → 허락하면 실행, 거절하면 file이 없고 거절이 다음 model 요청에 실린다 | approval 왕복 |
| 3 | agent가 file을 두 번 고친 뒤 session rewind → 첫 상태로 돌아간다 | 틀린 되돌리기 막기 |
| 4 | turn 도중 사람이 멈춤 → 진행 중인 model 요청이 끊기고 tool은 안 돈다 | 멈춤 |
| 5 | turn과 approval 도중 core가 꺼졌다 켜짐 → session이 남고, 돌던 turn은 interrupted로 닫힌다 | 재시작 뒤 상태 |
| 6 | key로 provider 연결 → key는 model 요청 header에만 있고 ledger·event·log에는 없다 | secret 경계 |
| 7 | agent A가 agent B를 부르고 B의 결과가 A로 돌아온다 | agent call |
| 8 | 앱 만들기 → release 준비 → activation → agent의 app-api tool → 앱 process → 결과 | 앱 호출, 앱 sandbox |
| 9 | 256KiB를 넘는 여러 write의 앱 data rewind가 한 번에 되돌아간다 | 앱 data 되돌리기 |

- 첫 묶음은 1~6이다. 7은 session마다 queue가 필요하다. 8·9는 test가 shell(Gateway `coding_terminal`)과 coding agent(`lophn ticket claim`, `lophn release prepare`) 역할을 해야 해서 support가 하나 더 든다.
- 뒤로 미루는 것: coding agent의 ticket session(PTY), Electron smoke.

### provider live

- 대상은 Anthropic과 OpenAI다.
- 공용 suite 하나에 provider별 얇은 file(model 이름, 되는 기능)을 둔다.
- 요청 셋: tool 없는 대답, 실제 role tool 묶음으로 tool call 하나, 이미지 하나. OpenAI는 reasoning model로 "실제 tool 묶음을 지금 출력 한도로 보내면 잘리나"를 한 행 더 본다.
- 단정 넷: 받았나(HTTP 2xx), 잘렸나(판정), tool 인자가 JSON인가, token 수가 있나. 대답의 내용은 보지 않는다.
- task와 env key가 둘 다 있어야 돈다. key가 없으면 이유를 찍고 0으로 끝난다. 호출당 timeout과 호출 수 상한을 둔다. cron은 쓰지 않는다.
- 같은 실행에서 응답을 `tests/fixtures/provider/`에 저장한다(secret 지우기, 요청은 저장 안 함). 사람이 diff를 보고 commit한다.
- 돌리는 때: `providers/`·`models/`를 고친 계획이 land하기 전, provider나 model을 더할 때, 판을 닫기 전.

## 지켜야 할 것

- `~/.lophn`, OS keychain, 사람의 전역 harness 설정을 건드리지 않는다. E2E data root는 실행마다 `.dev-data/e2e/<run>`에 만들고, 끝나면 권한을 되돌린 뒤 지운다. 기동 전에 `settings.json`으로 models.dev를 끈다.
- 진짜 provider는 live task에서만, 사람이 key를 줄 때만 부른다.
- 전역 mutable 상태를 두지 않는다. 고정 port와 고정 path를 쓰지 않는다. 병렬로 돌아야 한다.
- sanitizer를 끄지 않는다.
- support에는 띄우기와 연결만 둔다. flow의 단계는 test file에 그대로 쓴다. 옛 suite의 시나리오 helper(약 3,300줄)처럼 키우지 않는다.

## 정할 것

1. **fake 구조**: scripted model, 녹화 재생, fake server 셋으로 간다. 추천이다. OpenAI Agents SDK, Vercel AI SDK, OpenCode가 loop와 wire를 따로 본다.
2. **case 고르는 규칙**: 위 9개로 간다. 추천이다.
3. **core E2E 첫 묶음**: 1~6. AGENTS.md는 "process를 띄우는 E2E는 만들기 전에 사람에게 묻는다"고 한다. 이 답이 그 승인이 된다.
4. **의심 A·B(오류 분류)**: Anthropic stream의 `rate_limit_error`가 header 없는 429처럼 `credential_unavailable`(1시간 대기)이 된다. OpenAI Responses의 `server_is_overloaded`는 `unknown`이 되어 retry하지 않는다. 추천: 둘 다 temporary로 retry한다. `failures.ts` 주석의 뜻과 같다.
5. **의심 C(호출당 timeout)**: 지금은 stream이 말이 없어도 `stall_ms` 300초가 지나야 끝난다. stream에서 N초 동안 byte가 없으면 그 호출을 끊고 temporary로 retry할지, N을 얼마로 할지 정한다(제품 동작).
6. **의심 D(같은 잘림의 되풀이)**: 지금은 `model_attempts` 30번까지 같은 한도로 다시 부른다. 연속 partial 몇 번에서 멈출지 정한다(제품 동작). OpenAI reasoning model의 출력 한도(`MAX_OUTPUT_TOKENS` 4096 안에 reasoning이 든다)는 live test의 결과를 보고 따로 정한다.
7. **live test의 model과 비용 상한**: provider마다 model 하나, 실행 한 번의 호출 수 상한.

## 단계

1. wave 1 (서로 다른 file)
   - harness loop: scripted model과 안전 규칙 table.
   - harness wire: 녹화 재생 `fetch`, 손 fixture, 판정·분류 table.
   - E2E support: fake server, core 띄우기와 hello token, data root 만들기·지우기, upload helper.
2. wave 2
   - core E2E 1~6. flow마다 task 하나.
   - provider live suite와 녹화.
3. wave 3
   - `deno task dev`를 새 fake server와 `providers/connect`로 바꾼다.
   - `tools/fake-provider/`와 `LOPHN_FAKE_PROVIDER_URL`을 지운다.
   - `tools/check.ts`, `deno.json`, registry(`tool-fake-provider`), module-catalog(`tests`), AGENTS.md "사람에게 묻는 것", `write-test` skill을 새 층에 맞춘다.
4. 다음 계획: core E2E 7~9와 그 support(session별 queue, Gateway·coding agent 역할).

## 끝남 기준

- `deno task check`가 harness loop·wire를 돈다. harness 전체가 10초 안에 끝난다.
- `deno task e2e`가 첫 묶음 6 flow를 돌고 10번 연속 통과한다.
- `deno task test:live`가 key 없이는 이유를 찍고 0으로 끝난다. key가 있으면 provider 둘 × 요청 셋을 돈다.
- `tools/fake-provider/`가 없다. `grep -rn LOPHN_FAKE_PROVIDER_URL tools packages`가 0줄이다. `deno task dev`의 첫 turn이 fake 대답을 받는다.
- 의심 A~D의 행이 정한 동작으로 초록이다.
- `write-test` skill과 AGENTS.md가 새 층과 `tests/` 자리를 가리킨다.

## 하지 않는 것

- UI E2E(Electron, Playwright), eval.
- cassette 녹화 engine. pydantic-ai는 1,786개, 270MB까지 커졌다.
- 제품 binary의 test flag. Gemini CLI의 `--fake-responses` 같은 것이다.
- provider마다 따로 만드는 fake server. hermes는 file당 300~760줄이 됐다.
- 큰 공용 builder. Codex의 test helper는 1,600줄이다.
- OS·transport matrix, nightly·cron live, env를 바꾸는 test를 mutex로 줄 세우기.

## 선례

조사한 곳: Codex CLI, OpenCode, Gemini CLI, Goose, Aider, hermes, Zed, Cline, Continue, OpenHands, Roo Code, Mastra, Vercel AI SDK, pydantic-ai, OpenAI Agents SDK, LangChain, Anthropic·OpenAI 공식 SDK.

- loop fake와 wire를 나눈다: OpenAI Agents SDK(`ScriptedModel`, "scripted model로 wire를 시험하지 말라"), Vercel AI SDK, OpenCode.
- 엄격 queue와 요청 기록: OpenAI Agents SDK, Codex.
- main과 aux 분리, 응답 종류 7가지, 공통 불변식: hermes.
- 기대와 다른 요청에 차이를 담은 HTTP 오류: Goose.
- 녹화는 응답만, 사람이 commit: Vercel AI SDK.
- 세 질문, contract 하나에 owner 하나, 회귀는 고치기 전 실패 확인, 벽시계 대기 금지: OpenCode.
- E2E 약 10개, harness 100~200개 비율: Mastra, Cline, Zed.
- 새 integration은 여러 번 연속 통과 뒤 넣기, skip을 쌓지 않기: Gemini CLI(integration의 21%가 skip).

## 관련 이슈

- `issues/activation.md`의 "write app-api의 rewind 검사가 fail로 나온다". core E2E 8·9가 그 근처를 지난다.
