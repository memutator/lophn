---
type: plan
concerns: [lophn-agent]
---
# lophn-agent 구현 계획

lophn-agent 팀의 작업 전부다. 범위는 `docs/intent/lophn-agent*`, `docs/requirements/lophn-agent/`, `docs/domain-model/lophn-agent/`, `docs/architecture/lophn-agent.md`, 그리고 lophn-agent가 지나는 flow다. 작업 모양은 [tasks.md](../dev/tasks.md)를 따른다. 작업 id는 `lophn-agent#T<n>`이다.

## 자리와 모양

- 코드 자리는 [code-map.md](../dev/code-map.md)를 따른다. concern leaf마다 `packages/lophn-agent/<leaf>/`에 core가 등록하는 `commands.ts`·`reads.ts`와 runtime이 쓰는 `work.ts`·`adapters/`를 둔다. 실행 entry는 `apps/agent-runtime/`이다.
- core 등록과 agent runtime launch spec(고정 entry, 좁힌 `--allow-read/write/net`, 등록 MCP executable만 `--allow-run`, 이름을 정한 `--allow-env`)은 `apps/core/lophn-agent.ts` 한 파일에 둔다(platform 팀과 정함). ledger 작업은 자기 command·read·event를 이 파일에 더한다.
- `docs/architecture/lophn-agent.md` §2.4는 `packages/lophn-agent/runtime/`, `provider/`, `ledger/<concern>/`를 쓴다. code-map이 정본이므로 T1에서 §2.4를 code-map에 맞게 고친다.
- agent runtime과 core 사이 감독 통로는 platform 소유 pipe(stdin·stdout 길이 prefix binary frame, codec contracts#T6, child helper platform#T7)다. lophn-agent가 따로 frame을 만들지 않는다.
- 역할 prompt 자산은 `packages/lophn-agent/roles/<role>/` 안에 Markdown으로 둔다. 동봉 제품 안내 원문은 `packages/lophn-agent/roles/lophn/guides/`, 동봉 model catalog snapshot은 `packages/lophn-agent/harness/model/`에 둔다.
- 개발 도구는 `tools/fake-provider/`와 `fixtures/model/`(이 팀 소유, [stack.md](../dev/stack.md)), eval fixture는 `fixtures/eval/`, flow E2E는 `e2e/flows/<flow>_test.ts`다.
- 화면(conversation, 질문 칸, preset 편집, provider·계정 설정, trace, confirmation window)은 shell 계획에 있다. 이 계획은 read·command·event와 runtime 동작만 만든다.
- 최상위 사이는 `packages/contracts/`로만 부른다. 다른 owner의 command를 ToolCall 확정·대기·option action과 한 transaction으로 묶을 때는 `tx.call(route, input, compare)`(contracts#T6, 구현 platform#T18)를 쓴다.
- E2E: agent slice는 T41, operator slice는 T53이 쓴다. context slice는 documents#T27, apps slice는 apps#T27, coding-agent·problems slice는 그 slice 팀의 E2E가 lophn-agent 작업을 선행으로 두고 돌린다.

## 조사

계획 전에 주제마다 오픈소스 3개 이상을 코드로 읽었다([research.md](../dev/research.md)). 저장소는 `/tmp/claude-1000/lophn-research/`의 shallow clone(2026-10-04)이고 revision은 각 문서에 있다. Claude Code 저장소에는 harness 소스가 없어 CHANGELOG·plugin 예시 근거로만 썼다. 구현 작업은 `조사:` 줄로 이 문서를 가리킨다.

| 문서 | concern | 코드로 읽은 프로젝트 |
|---|---|---|
| [provider-adapters.md](../research/provider-adapters.md) | harness/provider, harness/usage | Pi, Codex, OpenCode, Hermes |
| [provider-auth.md](../research/provider-auth.md) | harness/provider | Pi, Codex, OpenCode, OpenClaw, Hermes, Gemini CLI |
| [agent-run-loop.md](../research/agent-run-loop.md) | harness/run-loop, harness/waiting-and-recovery | Codex, OpenCode, Pi, Gemini CLI, Hermes, OpenClaw |
| [prompt-assembly-and-compaction.md](../research/prompt-assembly-and-compaction.md) | harness/prompt-assemble, conversation | Codex, OpenCode, Gemini CLI, Pi, Hermes |
| [tool-registry-and-judgment.md](../research/tool-registry-and-judgment.md) | harness/tools, harness/tool-judgment | Codex, Gemini CLI, OpenCode, Hermes, Pi, OpenClaw |
| [prompt-injection-safety.md](../research/prompt-injection-safety.md) | harness/safety | Codex, Gemini CLI, OpenCode, Hermes, Pi, OpenClaw |
| [mcp-client.md](../research/mcp-client.md) | extensions | Codex, Gemini CLI, OpenCode, Pi, Hermes, OpenClaw |
| [agent-skills.md](../research/agent-skills.md) | extensions | Codex, OpenCode, Pi, Gemini CLI, Hermes, OpenClaw |
| [instruction-files.md](../research/instruction-files.md) | instructions | Codex, OpenCode, Pi, Gemini CLI, Hermes, OpenClaw |
| [model-catalog-and-usage.md](../research/model-catalog-and-usage.md) | harness/model, harness/usage | OpenCode, Pi, Codex, Hermes, OpenClaw |
| [session-and-conversation.md](../research/session-and-conversation.md) | conversation | Codex, OpenCode, Pi, Gemini CLI, Hermes |
| [revert-and-checkpoints.md](../research/revert-and-checkpoints.md) | revert | Codex, OpenCode, Gemini CLI, Hermes, Pi |
| [questions-and-hitl.md](../research/questions-and-hitl.md) | questions | LangChain, OpenCode, Codex, Gemini CLI, Hermes, OpenClaw |
| [handoff-and-delegation.md](../research/handoff-and-delegation.md) | handoff | LangChain, OpenCode, Codex, Gemini CLI, Hermes, OpenClaw |
| [presets-and-agent-config.md](../research/presets-and-agent-config.md) | presets, assignments, roles | OpenCode, Codex, Gemini CLI, OpenClaw, Hermes, Pi |
| [scheduled-runs.md](../research/scheduled-runs.md) | scheduling | OpenClaw, Hermes, Codex, Pi |
| [agent-evaluation.md](../research/agent-evaluation.md) | evaluation | Gemini CLI, Pi, Hermes |
| [fake-provider-testing.md](../research/fake-provider-testing.md) | harness/provider, evaluation | Gemini CLI, Pi, Codex, OpenCode, LangChain |
| [trace-and-observability.md](../research/trace-and-observability.md) | observability | Codex, Gemini CLI, Hermes, OpenClaw |
| [chat-visuals.md](../research/chat-visuals.md) | visuals | OpenClaw, Codex, Pi, Gemini CLI |

## skeleton

### T1 agent runtime entry 뼈대

- 상태: 완료 (#120)
- 등급: 기본
- concern: lophn-agent/harness/run-loop
- 요구: lophn-agent/harness/run-loop#R8
- 자리: apps/agent-runtime/, apps/core/lophn-agent.ts (launch spec과 등록 뼈대), packages/lophn-agent/harness/run-loop/ (runtime 기동 순서), docs/architecture/lophn-agent.md §2.4
- 쓰는 contract: 감독 pipe(contracts#T6), command·read·event client(contracts#T5, contracts#T7)
- 내놓는 contract: 없음
- slice: skeleton
- 조사: docs/research/agent-run-loop.md
- 선행: contracts#T5, contracts#T6, contracts#T7, platform#T5, platform#T7, platform#T9
- 완료:
  - runtime_test.ts에 run-loop#R8 테스트: 감독 pipe로 bootstrap·machine credential 수신 → core read 연결 → event cursor 조회 → 종료 요청·pipe 닫힘·core 종료에 새 진입을 막고 끝난다. runtime은 core writer를 붙잡지 않는 별도 프로세스다
  - stderr에는 redaction된 진단만 쓴다
  - `deno task dev`(contracts#T9)에서 agent runtime이 `.dev-data/`로 뜬다
  - architecture §2.4의 모듈 자리를 code-map에 맞게 고친다

### T2 fake provider

- 상태: 완료 (#37)
- 등급: 기본
- concern: lophn-agent/harness/provider
- 요구: 없음(개발 도구, [stack.md](../dev/stack.md) "tools/fake-provider")
- 자리: tools/fake-provider/, fixtures/model/
- 쓰는 contract: 없음
- 내놓는 contract: 없음(테스트와 E2E가 쓰는 로컬 HTTP server)
- slice: skeleton
- 조사: docs/research/provider-adapters.md, docs/research/fake-provider-testing.md
- 선행: contracts#T1
- 완료:
  - Anthropic Messages(`/messages`), OpenAI Responses(`/responses`), Chat Completions(`/chat/completions`)의 stream·비stream 응답을 script(JSON: 요청 기대값과 응답 순서)와 `fixtures/model/` 녹화 응답으로 낸다
  - 오류 주입: 429와 retry-after·retry-after-ms·reset header(30초 이내·초과·미상), 500·502·503·529, stream 중간 끊김, UTF-8 경계·frame 분할, 출력 한도 잘림(max_tokens·length·incomplete), tool 인자 JSON 미완성, 첫 token 지연, usage 변형(Anthropic cache 제외·OpenAI cache 포함, reasoning 포함, 미보고), 문맥 초과(알리는 provider와 알리지 않는 provider), model 없음, 인증 거절
  - 추론 상태: Anthropic thinking signature·redacted_thinking, Responses encrypted reasoning item을 다음 요청에 되돌려 받았는지 단언한다
  - OAuth 흉내: token·refresh·device code poll(authorization_pending, slow_down, expired), 401 뒤 refresh. API key와 OAuth 요청의 user-agent·tool 이름이 같은지(위장 없음) 단언한다
  - 받은 요청 log(인증 header 값 제외)를 테스트가 읽어 단언할 수 있다. script와 다른 요청, 응답 소진, 남은 응답, 0회 호출은 모두 실패이고 요청 수를 정확히 단언한다(정상 'ok'로 넘기거나 응답을 순환하지 않음)
  - 응답은 실제 HTTP·SSE로 내보내 세 adapter의 parser를 그대로 지난다(프로세스 안 가짜 client 아님). 오류·partial·reset·여러 tool·opaque 상태는 raw protocol fixture로 쓰고, chunk 경계·지연·reset·Retry-After 같은 분류 header를 보존한다
  - 녹화는 테스트에서 자동으로 하지 않는다. 별도 record 명령만 사람 지시와 `LOPHN_LIVE_PROVIDER=1`로 돌고, 합성 최소 입력·event별 redaction·secret scan·사람 diff 검토 뒤 fixture로 채택한다(질문 Q22). 합성 token도 평문 설정으로 넣지 않는다
  - 개발 entry가 loopback 주소를 ready JSON `{url}` 한 줄로 내고 HTTP로 script·요청 log를 받으며 child smoke가 돈다. `deno task dev`의 동시 기동과 `LOPHN_FAKE_PROVIDER_URL` 전달은 이 작업을 선행으로 둔 contracts#T9가 조립한다(질문 Q26)
  - fake provider 자체 테스트

## agent

agent slice가 lophn-agent의 본체다. 순서: 기반 ledger(T3–T12) → provider adapter(T13–T16) → safety·지침·prompt·tool(T17–T23) → 질문·대기·loop·복구·compaction(T24–T28) → lophn 역할·handoff·시각·revert(T29–T34) → 확장(T35–T38) → 관측(T39–T40) → flow E2E(T41).

### T3 provider와 credential ledger

- 상태: 완료 (#155)

- 등급: 기본
- concern: lophn-agent/harness/provider
- 요구: lophn-agent/harness/provider#R2, R4, R5, R6, R7, R8, R9, R11, R28
- 자리: packages/lophn-agent/harness/provider/ (model.ts, commands.ts, reads.ts), apps/core/lophn-agent.ts, docs/requirements/lophn-agent/harness/provider.md, docs/flows/connect-provider.md
- 쓰는 contract: command·read·Tx(contracts#T6), secret 참조(contracts#T23)
- 내놓는 contract: RegisterProvider, ChangeProvider, RegisterProviderCredential, ChangeProviderCredentials, RefreshProviderCredential, RecordProviderAvailability, RecordProviderCheck, provider read/list, credential list, event ProviderRegistered·ProviderChanged·ProviderChecked (contracts#T29)
- slice: agent
- 조사: docs/research/provider-auth.md, docs/research/provider-adapters.md
- 선행: T1, contracts#T29, platform#T1, platform#T2, platform#T3, platform#T19
- 완료:
  - D31에 맞춰 provider requirements를 고친다: R1 지원 대상(Anthropic은 API key만, ChatGPT는 공식 Sign in with ChatGPT, xAI는 SuperGrok OAuth, 그 밖은 API key와 로컬 연결), R11(Claude OAuth) 삭제와 flow connect-provider의 R11 참조 정리, R12·R16을 공식 Sign in with ChatGPT 경로(실제 앱 이름의 dynamic client 등록과 발급 client_id 재사용, 사람이 시작한 browser와 127.0.0.1 loopback callback, state·nonce·S256, id_token 서명·issuer·audience·만료 검증, 공개 `api.openai.com/v1/responses`·store=false·stream=true, backend-api 사용 없음)로, R27의 Claude OAuth 부분 삭제. R13·R14는 유지. 고친 사실은 open-issues에 남기고 check-docs로 다른 참조를 확인한다
  - `providers`, `provider_credentials`, `provider_credential_model_blocks` 표와 schema step
  - provider_test.ts에 R2, R4–R9, R28 테스트와 R11 삭제 확인(Anthropic provider에 OAuth 인증 방식이 없음): 원격 HTTP·무인증 거절과 127.0.0.1·::1·localhost 허용, 같은 key·같은 계정+조직 중복 거절, 사람만 등록·교체·순서 변경, 확인되지 않은 계정 정보를 추측하지 않음, credential 값이 read·event·오류에 없음, 연결 가능한 provider와 쓸 credential이 있는 provider 구별, 미준비 preset 비활성
  - 통합 테스트: core를 메모리 SQLite로 띄워 API로 입력·출력·오류(conflict, forbidden, invalid_input)
  - dev seed는 contracts#T9가 한다: `LOPHN_FAKE_PROVIDER_URL`이 있으면 fake provider의 세 protocol을 loopback provider로 등록한다(lead 결정)

### T4 model catalog

- 상태: 완료 (#159)
- 등급: 기본
- concern: lophn-agent/harness/model
- 요구: lophn-agent/harness/model#R1, R2, R3, R4, R5, R6, R7, R12, R13
- 자리: packages/lophn-agent/harness/model/ (model.ts, work.ts, adapters/models-dev.ts, 동봉 snapshot), apps/agent-runtime/ (catalog 갱신 연결), apps/core/lophn-agent.ts
- 쓰는 contract: settings registry(contracts#T24: catalog 자동 갱신 on/off 정의 등록), read
- 내놓는 contract: catalog read/refresh (`/v1/agent-model-catalog/read`, `/v1/agent-model-catalog/refresh`, contracts#T29)
- slice: agent
- 조사: docs/research/model-catalog-and-usage.md
- 선행: T1, contracts#T29, platform#T25
- 완료:
  - catalog_test.ts에 R1–R7, R12, R13 테스트: `(provider_definition, model_name)` identity와 직접·중계 제공처 분리, release snapshot → 정상 갱신본 → lophn patch → 사람 보완 순서와 출처 구별, 24시간·ETag 조건부 GET·명시 refresh, 빈 목록·해석 실패·양의 정수가 아닌 한계·음수·무한대·중복 가격 경계면 전체 거절하고 마지막 정상본 유지, 공개 GET에 개인 자료 없음, 자동 갱신 끄면 정상본·snapshot만, 누락 요율은 모름, 폐기 예정·누락이 저장된 선택을 바꾸지 않음, catalog 밖 model은 확인된 한계가 있어야 사용(128000·8192 가정 없음)
  - derived `catalog.json`·`catalog-state.json`을 지워도 snapshot에서 다시 만든다. 새 catalog는 JSON·schema·값 검증을 마친 뒤에만 임시 파일→rename으로 교체하고, 갱신은 run을 막지 않는 single-flight다. 정상 304는 확인 시각만 갱신하고 잘못된 200·timeout은 마지막 성공 시각을 유지한다(질문 Q19)

### T5 model 기본값, 선택 검사, 추론 수준, token 상한

- 등급: 기본
- concern: lophn-agent/harness/model
- 요구: lophn-agent/harness/model#R8, R9, R10, R11, R14, R15, R16, R17, R18, R19, R20
- 자리: packages/lophn-agent/harness/model/ (commands.ts, reads.ts, selection.ts, reasoning.ts, budget.ts), apps/core/lophn-agent.ts
- 쓰는 contract: command·read
- 내놓는 contract: ChangeModelDefaults, model defaults read, event ModelDefaultsChanged (contracts#T29)
- slice: agent
- 조사: docs/research/model-catalog-and-usage.md, docs/research/provider-adapters.md
- 선행: T4
- 상태: 완료 (#185)
- 완료:
  - `agent_model_defaults` 표, 처음 값 null
  - model_test.ts에 R8–R11, R14–R20 테스트: 기본값 변경이 기존 preset·assignment에 번지지 않음, 목록에 없는 이름 거절과 미확인 저장·첫 성공 호출에 해제, text·tool 미지원 거절, 입력·예약 출력·전체 문맥 한계 하나라도 넘으면 전송 없음, UTF-8 byte 상한(한글·큰 결과, chars/4 없음), 비텍스트 크기 미상이면 호출 없음, 일곱 수준+모델에 맡김, catalog에서 확인된 강도 이름만 보내고 치환하지 않음(minimal→low 같은 대체 없음), token 예산 2048·8192·16384·32768을 확인된 min·max로 clamp(최대는 32768이고 높음과 다름, 지원 밖 수준을 위로 올려 맞추지 않음), 토글 방식은 끔·높음만, 모델에 맡김에서 보정 기본 수준이 없으면 추론 인자 없음, run 중 수준 상승 거절, organizing 미선택은 같은 model(fallback 아님), 사용 불가면 이유와 더 호출하지 않았다는 사실

### T6 model call 기록과 사용량·비용

- 등급: 기본
- concern: lophn-agent/harness/usage
- 요구: lophn-agent/harness/usage#R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11
- 자리: packages/lophn-agent/harness/usage/ (model.ts, commands.ts, reads.ts, cost.ts, work.ts: derived `usage.sqlite` 합계), apps/core/lophn-agent.ts
- 쓰는 contract: command·read, blob(contracts#T11), redaction(contracts#T12)
- 내놓는 contract: StartModelCall, FinishModelCall, SupplementModelCall, model call read/list (contracts#T29), agent-usage read (contracts#T30), event ModelCallStarted·ModelCallFinished·ModelCallSupplemented
- slice: agent
- 조사: docs/research/model-catalog-and-usage.md, docs/research/provider-adapters.md
- 선행: T3, T4, contracts#T30, platform#T13, platform#T14, platform#T15
- 완료:
  - `model_calls`, `model_call_supplements` 표
  - usage_test.ts에 R1–R11 테스트: 시작 기록 저장 실패면 전송 없음, 실제 시도마다 한 번(retry·credential 이동·요약·연결 test 포함), 용도·원래 선택·전송·응답 model·과금 경로 기록, 오류 본문 없음, 새 입력·출력·cache 읽기·쓰기·추론 구별과 포함 관계(Anthropic은 cache 제외, OpenAI는 cache 포함, 추론은 출력의 부분), 미보고와 누락 요율은 null·모름(0으로 바꾸지 않음, 현재 가격으로 과거 누락 비용을 채우지 않음), 비용 다섯 종류, 십진수 문자열로 입력·계산·저장(float 변환 없음)과 출처·확인 시각·통화·문맥 구간·cache 시간(질문 Q18), adapter마다 usage 정의 판을 기록해 cache 포함 관계를 provider 이름으로 추측하지 않음, 가격 갱신으로 과거 비용 덮지 않음, supplement append, 같은 호출 한 번만 합계, handoff 수신 run 귀속, eval 재생 제외, 금액 상한 없음
  - derived 합계를 지우고 ledger에서 다시 만든 값이 같다

### T7 preset ledger와 구성 검증

- 등급: 기본
- concern: lophn-agent/presets
- 요구: lophn-agent/presets#R1, R2, R3, R5, R6, R7, R10, R11, R12, R13, R14, R16
- 자리: packages/lophn-agent/presets/ (model.ts, commands.ts, reads.ts, validate.ts, capability.ts), apps/core/lophn-agent.ts
- 쓰는 contract: command·read, settings registry(contracts#T24: MCP 등록·skill root 조회)
- 내놓는 contract: RegisterDefaultPreset, CreatePreset, RevisePreset, preset read/list, instruction-attachments read, event PresetCreated·PresetRevised (contracts#T27)
- slice: agent
- 조사: docs/research/presets-and-agent-config.md
- 선행: T3, T5, contracts#T27, platform#T25
- 완료:
  - `presets`, `preset_revisions` 표
  - presets_test.ts에 R1–R3, R5–R7, R10–R14, R16 테스트: 실제 담당·주기·세션을 preset에 넣지 않음, 빈 이름·prompt 거절, 대소문자·공백 무시 중복과 기본 preset 이름과 구별, context는 읽을 자료 선택이고 담당 범위와 구별, credential 값·가격표 없음, capability 묶음을 저장 시점 동작으로 펼쳐 고정, 복사가 구성만 복사, 전체 검사 실패면 항목별 설명과 전체 거절(역할 상한 밖 항목이 하나라도 있으면 저장 전체 forbidden, 규칙 목록을 이어 붙여 뒤 규칙이 이기는 병합 없음, wildcard 없음), 이름은 바꿔 맞추지 않고 거절, 새 판 immutable·실패 시 이전 판 유지, 결정 근거와 전후 내용 보존, 사용 중 assignment 자동 이동 없음, safe 표시는 그 MCP tool 하나만이고 confirm=true를 넓히지 못함

### T8 역할 공통 상한과 제품 기본 preset

- 등급: 기본
- concern: lophn-agent/roles/common, lophn-agent/presets
- 요구: lophn-agent/roles/common#R1, R2, R3, R4, R5, R8, R9, R11, R12, R13, lophn-agent/presets#R4, R8, R9
- 자리: packages/lophn-agent/roles/common/ (역할별 금지·상한 표, 공통 prompt), packages/lophn-agent/roles/lophn/, roles/app-engineer/, roles/context-engineer/, roles/operator/ (기본 preset prompt 자산), packages/lophn-agent/presets/ (기본 preset 등록)
- 쓰는 contract: command(RegisterDefaultPreset machine 호출)
- 내놓는 contract: 없음
- slice: agent
- 조사: docs/research/presets-and-agent-config.md, docs/research/tool-registry-and-judgment.md
- 선행: T7
- 완료:
  - roles_test.ts에 roles/common#R1–R5, R8, R9, R11–R13 테스트: 네 역할 어디에도 코드·shell·임의 파일·URL·웹·브라우저·subagent·coding agent 시작 tool이 없음, 공통 읽기 tool 선택, preset의 MCP·skill 선택 허용과 소스·앱 DB·secret 직접 읽기 없음, 역할별 앱 command 노출 규칙 표, 시각 블록이 쓰기·command 범위를 넓히지 않음, 지침 파일 쓰기 tool 없음, judgment와 organizing 용도 구별, 합계·시점·format 검사는 model 없음
  - presets_test.ts에 presets#R4, R8, R9 테스트: 네 역할 기본 preset이 machine으로 한 번 등록되고 사람 판을 덮지 않음, 기본 prompt가 맡는 일·맡지 않는 일·관점·기대 결과를 담음, preset prompt·skill·지침이 상한을 넓히지 못함

### T9 assignment ledger

- 등급: 기본
- concern: lophn-agent/assignments
- 요구: lophn-agent/assignments#R2, R3, R9, R10, R11, R12, R13, R14, R16, R17
- 자리: packages/lophn-agent/assignments/ (model.ts, commands.ts, reads.ts), apps/core/lophn-agent.ts
- 쓰는 contract: command·read·event 구독(contracts#T7), documents ProjectArchived·DocumentArchived event(documents#T6, documents#T7), apps AppArchived·AppUnarchived event(apps#T1)
- 내놓는 contract: CreateBuiltinAssignment, ChangeAssignmentPreset, PauseAssignment, ResumeAssignment, WithdrawAssignment, assignment read/list, event AssignmentCreated·AssignmentChanged·AssignmentPaused·AssignmentResumed·AssignmentWithdrawn (contracts#T27)
- slice: agent
- 조사: docs/research/presets-and-agent-config.md
- 선행: T7, platform#T4, documents#T6, documents#T7, apps#T1
- 완료:
  - `assignments`, `assignment_revisions`, `assignment_outputs`, `assignment_read_apps`, `assignment_read_commands` 표
  - assignments_test.ts에 R2, R3, R9–R14, R16, R17 테스트: lophn·Context Engineer 전역 하나씩이고 회수 대신 멈춤·재개만, 화면용 기본·상세 자료 구분, 실제 시작한 최종 실패 3회 연속이면 machine pause와 secret 없는 실패 근거, 정상 완료·Operator 무변화에서 끊고 미시작·사람 중단·거절·답 없음·대기는 세지도 지우지도 않음, 사람 재개만 해제(시간·재시작·다음 주기로 풀리지 않음), 시작한 뒤 정상 종료 기록 없이 끊긴 run은 실패로 세고 시작 전에 끝난 run은 세지 않음(질문 Q17), 보관 대상이면 멈춤·일시 접근 불가면 새 일 없음, withdrawn은 지난 대화만·paused는 입력 보존만, preset 새 판 저장이 연결 판을 바꾸지 않고 명시 적용은 다음 run부터

### T10 run ledger와 생명 주기

- 등급: 기본
- concern: lophn-agent/harness/run-loop
- 요구: lophn-agent/harness/run-loop#R1, R2, R3, R5, R6, R14, R16, R17, R18
- 자리: packages/lophn-agent/harness/run-loop/ (model.ts, commands.ts, reads.ts), apps/core/lophn-agent.ts
- 쓰는 contract: command·read·Tx, agent credential 발급·종료와 AgentAppScope(platform#T24)
- 내놓는 contract: AcceptRun, StartRun, CheckpointRun, FinishRun, StopRun, ConfirmNextRun, run read/list/result(`source.original_message`·handoff sender_run 포함), event RunAccepted·RunStarted·RunFinished (contracts#T26)
- slice: agent
- 조사: docs/research/agent-run-loop.md
- 선행: T9, contracts#T26, platform#T24
- 완료:
  - `runs` 표와 assignment당 running·waiting_user 하나의 partial unique
  - run_test.ts에 R1–R3, R5, R6, R14, R16–R18 테스트: 자료 변경·결과 도착·notification으로 run 없음, 접수 저장 뒤 응답·같은 key 재전달은 이전 결과·각 commit 직후 kill해도 accepted run 유실 없음, 같은 assignment 진행 하나와 다른 assignment 무관, 자리 대기 10분 넘어도 보존·시작 필수 설정이 영구히 없으면 이유와 종료, completed면 다음 시작·failed/stopped면 ConfirmNextRun까지 보존, 정상 종료는 미반영 steering 없을 때만 입력 접수와 원자 확정, 끝난 run의 늦은 결과는 supplement만, 멈춘 run 자동 재개 없음, 결과 한 번 확정과 완료 변경을 멈춤·실패로 되돌리지 않음

### T11 세션과 메시지

- 등급: 기본
- concern: lophn-agent/conversation
- 요구: lophn-agent/conversation#R1, R2, R3, R4, R5, R6, R7, R8, R14, R16, R17
- 자리: packages/lophn-agent/conversation/ (model.ts, commands.ts, reads.ts), apps/core/lophn-agent.ts
- 쓰는 contract: command·read, blob, redaction
- 내놓는 contract: OpenSession, ChangeSessionWorkPlace, CloseSession, ReceiveMessage, ExecuteStoredRequest, RecordMessage, ApplyMessages, AssignMessage, session read/list, message list, MessageContent, event SessionOpened·SessionWorkPlaceChanged·SessionClosed·MessageReceived·MessageRecorded·MessageApplied·MessageAssigned (contracts#T26)
- slice: agent
- 조사: docs/research/session-and-conversation.md
- 선행: T10
- 완료:
  - `sessions`, `messages` 표
  - conversation_test.ts에 R1–R8, R14, R16, R17 테스트: 사람 메시지와 AcceptRun 원자 접수, 접수와 최초 반영을 따로 표시, 사람 말·역할 판단·machine 사실 구분과 실제 대상 링크만, 수정(mode=correction)과 다음 일 구별·수정 원문 모두 다음 판단에, 종료 경계 수정이 정확히 한 run에 한 번, 실패·멈춤 뒤 다음 일 자동 시작 없음, paused는 원문만 보존하고 run 없음, ExecuteStoredRequest만 새 run 연결, 재개·재시작만으로 실행 없음, 작업 자리 고정(AE 앱, Operator project/app)과 lophn·CE의 명시 변경만(다음 call부터), 세션 종료 조건, withdrawn은 읽기만

### T12 run selector와 한도

- 등급: 기본
- concern: lophn-agent/harness/run-loop
- 요구: lophn-agent/harness/run-loop#R4, R19, R20, R21, R22
- 자리: packages/lophn-agent/harness/run-loop/ (work.ts: selector, limits.ts), apps/agent-runtime/, apps/core/lophn-agent.ts (run 한도 SettingDefinition)
- 쓰는 contract: read·event 구독, settings registry(contracts#T24)
- 내놓는 contract: 없음(T10의 run read에 현재 행동·경과·대기 표시를 채운다)
- slice: agent
- 조사: docs/research/agent-run-loop.md
- 선행: T10, platform#T25
- 완료:
  - selector_test.ts에 R4 테스트: 세 우선순위 FIFO, 상위 8개 연속 뒤 가장 오래된 하위 후보, 막힌 assignment는 양보를 쓰지 않음, streak를 RunStarted에서 재구성
  - limits_test.ts에 R19–R22 테스트: run 한도는 공통 설정(model 시도 30·무진행 300000ms·전체 1800000ms, 양의 정수만, 사람만 다음 run부터 변경), 완전 응답·확정 결과만 진행, 실패 시도도 셈, 부분 token은 reset 안 함, 세 한도 각각에서 추가 judgment·organizing·마무리 model 호출 0건과 machine 결과, 퍼센트·예상 종료·추론 원문 없음

### T13 SSE parser와 Anthropic Messages adapter

- 등급: 기본
- concern: lophn-agent/harness/provider
- 요구: lophn-agent/harness/provider#R3, R25, R26
- 자리: packages/lophn-agent/harness/provider/ (adapters/stream.ts, adapters/messages.ts, adapters/auth-transport.ts, work.ts: `invokeModelCall` 공통 interface)
- 쓰는 contract: secret 전송 부착(contracts#T23)
- 내놓는 contract: 없음(runtime 내부 `invokeModelCall(input, signal)`)
- slice: agent
- 조사: docs/research/provider-adapters.md
- 선행: T2, T6, platform#T20
- 완료:
  - stream_test.ts: UTF-8 경계·분할 frame·event 종류별 처리, tool 인자 조각을 index·id로 모으고 순서 보존, 부분 JSON을 성공으로 내지 않음
  - messages_test.ts에 R3, R25, R26 테스트(fake provider): system·messages·tools 번역, tool_use.id↔tool_result 대응, content_block_stop과 message 종료·stop reason을 본 뒤에만 complete, thinking 본문 제외와 signature·redacted_thinking을 같은 run·provider·model 메모리에서만 재전송·provider나 model이 바뀌면 버림, cache 경계 최대 3곳 5분 cache·미지원은 실패 아님, SDK 숨은 retry 0(자체 retry만)
  - 인증 header 값이 run loop·blob·log에 없음

### T14 OpenAI Responses·Chat Completions adapter

- 등급: 기본
- concern: lophn-agent/harness/provider
- 요구: lophn-agent/harness/provider#R3, R25
- 자리: packages/lophn-agent/harness/provider/ (adapters/responses.ts, adapters/chat-completions.ts, adapters/compat.ts)
- 쓰는 contract: secret 전송 부착(contracts#T23)
- 내놓는 contract: 없음
- slice: agent
- 조사: docs/research/provider-adapters.md
- 선행: T13
- 완료:
  - responses_test.ts: instructions·input items·function tools, call_id 대응, response.output_item.done과 response.completed만 complete·incomplete(max_output_tokens 포함)/failed는 partial이고 tool 미실행, encrypted reasoning item을 store=false로 메모리에서만 재전송
  - chat_completions_test.ts: tool_calls index 조각, finish_reason, length·단절은 partial, stream_options usage, DeepSeek reasoning_content 제외, Gemini OpenAI 호환 endpoint, OpenRouter·Groq·xAI 차이, Ollama·LM Studio·llama.cpp loopback 무인증과 tool call id 누락 처리
  - endpoint의 `/v1` 중복 없이 path 고정, provider redirect로 다른 목적지에 credential 없음
  - opaque 상태가 없을 때 state-free 계속을 protocol별로 검증하고 불가면 configuration_unavailable(질문 Q7)

### T15 provider 실패 분류, credential 사용 가능 상태, 연결 test

- 등급: 기본
- concern: lophn-agent/harness/provider
- 요구: lophn-agent/harness/provider#R10, R19, R20, R21, R22, R23, R24, R27, R29, R30
- 자리: packages/lophn-agent/harness/provider/ (failures.ts, credentials.ts: affinity와 고정 목록 이동, work.ts: 연결 test)
- 쓰는 contract: command·read
- 내놓는 contract: providers/test (`/v1/providers/test`, contracts#T29)
- slice: agent
- 조사: docs/research/provider-adapters.md, docs/research/provider-auth.md
- 선행: T3, T6, T14
- 완료:
  - failures_test.ts에 R19–R24 테스트: 일시 실패(연결·단절·500·502·503·529·retry 시각 30초 이내 429), retry-after-ms → retry-after(숫자·HTTP-date) → reset header 순서 해석, credential 사용 불가(인증 거절·잔액·지출 한도·30초 초과 또는 미상 429)와 SuperGrok 요금제 403을 인증 폐기와 구별, model 사용 불가는 그 credential+model만, 문맥 초과·사람 취소·응답 거절 구별, 문맥 초과를 알리지 않는 provider는 원인 불명(질문 Q5), 원인 불명을 인증 실패로 추측하지 않음, 오류 본문 보존 없음, usage_wait는 reset까지 또는 1시간이고 그동안 test 없음
  - credentials_test.ts에 R10, R27 테스트: 첫 usable credential affinity, 고정 목록 뒤 계정만, 하나면 이동 없음, 앞 계정으로 돌아가지 않음, 다른 provider·model 자동 이동 없음, API key는 API 과금·ChatGPT와 SuperGrok OAuth는 구독으로 구별하고 청구 미확정은 모름
  - connection_test_test.ts에 R29, R30 테스트: 명시 요청만, 설정 조회로 test 없음, 고정 test 재료(text·tool call), 30초 상한, 사용량 기록, 세션·문서를 재료로 보내지 않음

### T16 구독 OAuth 로그인과 token 갱신

- 등급: 기본
- concern: lophn-agent/harness/provider
- 요구: lophn-agent/harness/provider#R1, R12, R13, R14, R15, R16, R17, R18
- 자리: packages/lophn-agent/harness/provider/ (oauth.ts, adapters/oauth-*.ts), apps/agent-runtime/ (login 제어 작업), (provider requirements 변경은 T3)
- 쓰는 contract: secret 보관·refresh 결과 저장(contracts#T23), confirmation window secret 입력(contracts#T13)
- 내놓는 contract: OAuth login-begin/complete/cancel (`/v1/providers/login-begin` 등, contracts#T29)
- slice: agent
- 조사: docs/research/provider-auth.md
- 선행: T3, T15, platform#T20, shell#T29(code·최종 URL secret 입력), shell#T31(공식 로그인 버튼은 확인 없이 OS 브라우저로 연다)
- 완료:
  - D31(질문 Q1): Claude OAuth는 없다. ChatGPT는 공식 Sign in with ChatGPT, xAI는 SuperGrok device code다. 두 경로 모두 lophn 이름의 실제 login·text·tool 성공을 `LOPHN_LIVE_PROVIDER=1`로 확인하기 전까지 활성 gate는 false다(fake 성공으로 열지 않는다)
  - oauth_test.ts에 R1, R12–R16 테스트(fake provider): Sign in with ChatGPT는 실제 앱 이름의 dynamic client 등록·발급 client_id 재사용·127.0.0.1 loopback callback·state·nonce·S256·id_token 검증, 공개 Responses만(backend-api 없음)·store=false·stream=true·system item 대신 instructions·previous_response_id 없음, access 3600초·refresh 30일과 earliest_refresh_at 존중. SuperGrok은 `https://auth.x.ai/.well-known/openid-configuration` discovery와 HTTPS `x.ai`·하위 도메인 재검사, device code만·여섯 scope만, 간격 없으면 5초·slow_down마다 +5초·만료 없으면 최대 5분. 거절·만료·취소·기한 뒤 늦은 성공은 등록 없음, lophn 제품 이름 식별(Claude Code·Codex·Grok CLI 위장·tool 이름 치환 없음), token 목적지 고정과 다른 host redirect에 token 없음
  - refresh_test.ts에 R17, R18 테스트: 만료 60초 전 credential별 single-flight, secret 재조회, 최대 15초, 보관 성공 뒤 사용·저장 실패면 새 token으로 inference 없음, 새 refresh token 없으면 이전 것 유지, 401은 refresh 1회+재전송 1회(새 ModelCall), 재차 401·폐기·재사용·계정 불일치는 disabled(시간 경과로 풀지 않음), 회전 refresh가 timeout·취소로 결과 미상이면 이전 token을 다시 쓰지 않고 재로그인 필요로 남김, 두 프로세스 동시 refresh에도 network 한 번, 저장 실패면 새 token 전송 0회(OpenCode xAI식 저장 실패 무시 금지), 15초 기한 뒤 늦은 성공은 쓰지 않음
  - 실제 계정 확인은 `LOPHN_LIVE_PROVIDER=1`로 사람이 따로 돌리고 결과를 PR에 남긴다

### T17 safety: 같은 요청, 반복 실패, 자료 포장

- 상태: 완료 (#129)
- 등급: 좁은
- concern: lophn-agent/harness/safety
- 요구: lophn-agent/harness/safety#R1, R2, R3, R4, R5, R6, R7, R8, R9
- 자리: packages/lophn-agent/harness/safety/ (model.ts: canonical 비교·실패 수, fence.ts: `~~~data` 포장·물결표·제어 표식)
- 쓰는 contract: redaction(contracts#T12), canonical JSON(contracts#T4)
- 내놓는 contract: 없음
- slice: agent
- 조사: docs/research/prompt-injection-safety.md, docs/research/tool-registry-and-judgment.md
- 선행: T1, platform#T15
- 완료:
  - safety_test.ts에 R1–R9 테스트: 객체 key 순서만 무시하고 공백·배열 순서·빈 값·null·생략·값 종류 구별, 같은 요청 최종 실패 2회 뒤 세 번째 미실행 안내·또 같으면 종료, 실패 수는 그 요청 성공에만 0이고 model 변경·압축·재시작으로 지워지지 않음, 사람 거절·미실행은 세지 않음, 다섯 출처 구별, 자료 시작·끝 표식과 안내 문구, machine 확인 출처만 밖·자료 유래 문자열은 안, 물결표 치환 전에 전각·zero-width·homoglyph를 접는 정규화 뒤 자료 안 물결표 3개 이상 변환(`～～～`도 경계를 닫지 못함), provider adapter가 선언한 제어 표식 목록(`<|im_start|>`, `<|eot_id|>`, `[INST]`, `<<SYS>>`, `<s>`, `<|reserved_special_token_N|>` 등)을 제거 표시로 바꿈(원본 hash 유지), summary·재읽기·handoff에서도 출처 유지(자료가 하나라도 섞인 summary는 전체를 자료로·분류 없으면 자료), 포장·redaction 실패면 원문 없는 이유로 다음 진입 차단(fail closed)
  - fixtures/model에 가짜 system·user·approval 문구, 전각 물결표·zero-width, `<|im_start|>`·`reserved_special_token_42`, approve라고 쓴 tool 결과 JSON, compaction 뒤 재포장 사례

### T18 사람 지침(LOPHN.md) 층

- 등급: 기본
- concern: lophn-agent/instructions
- 요구: lophn-agent/instructions#R1, R2, R3, R4, R5, R6, R7, R8
- 자리: packages/lophn-agent/instructions/ (model.ts, work.ts)
- 쓰는 contract: 지침 파일 현재 확정 version read(documents#T28, contracts#T15), instruction-attachments(T7)
- 내놓는 contract: 없음
- slice: agent
- 조사: docs/research/instruction-files.md
- 선행: T7, T11, documents#T28
- 완료:
  - instructions_test.ts에 R1–R8 테스트: 전역·project·app 층 구분, 없는 파일은 부재 기록(사람의 최초 저장은 documents·shell), agent는 파일 생성·저장·연결 변경 없이 question으로 제안, 전역→project→app→preset 첨부 순서와 같은 층 연결 순서, 작업 자리로 층 선택(AE·Operator 고정, lophn·CE는 명시 변경만, 탭 이동은 무관), 지침이 권한·상한을 넓히지 못하고 자료 속 LOPHN 파일 승격 없음, 파일 32 KiB·합계 128 KiB 초과·인코딩 오류·읽기 실패면 call 멈춤(자동 생략·잘라 읽기 없음), call마다 확정 version 재확인과 자리·층·원본·전송 hash·부재 기록, 편집은 다음 call부터, 정해진 세 자리 밖 조상 walk·다른 파일 이름(AGENTS.md·CLAUDE.md) 겸용 없음, 지침에 로컬 경로를 넣지 않음, 부재만 생략하고 lossy 디코드·잘라 쓰기·건너뛰기 없음

### T19 prompt 층, 직렬화, cache 경계, 입력 예산

- 등급: 기본
- concern: lophn-agent/harness/prompt-assemble
- 요구: lophn-agent/harness/prompt-assemble#R1, R2, R3, R7, R8, R9, R24, R30
- 자리: packages/lophn-agent/harness/prompt-assemble/ (model.ts: PromptAssembly·ContextBasis, layers.ts, budget.ts)
- 쓰는 contract: blob, redaction
- 내놓는 contract: 없음
- slice: agent
- 조사: docs/research/prompt-assembly-and-compaction.md
- 선행: T5, T8, T17, T18
- 완료:
  - assemble_test.ts에 R1–R3, R7–R9, R24, R30 테스트: 다섯 층 순서와 필수 제품·역할·지침 누락 시 호출 없음, 작업 재료 순서(목적·run 사실 → 이어가기 summary → 자료 → 압축 summary → 이력, 현재 요청·미반영 steering 전부), 같은 판·재료면 byte-identical, ContextBasis에 층별 hash·출처·version·크기·cache 경계, tool schema는 이번 call 목록만(다른 역할 tool을 cache용으로 보태지 않음), cache 경계 최대 3곳(제품+tool 끝, 역할+preset 끝, 사람 지침 끝)을 구조로 정하고 Anthropic wire marker도 3개 이하(tools를 포함하는 system 경계로 매핑, 문자열로 경계를 찾지 않음, 질문 Q11), 입력 예산 `min(input_limit, context_limit - reserved_output)`과 tool schema·provider 포장·opaque 상태까지 전체 wire bytes로 계산(chars/4·bytes/4 하한 추정 없음)·필수만으로 초과면 호출 없음, 추론 본문 제외, 지침 편집은 다음 call의 새 prefix

### T20 작업 재료와 turn context

- 등급: 기본
- concern: lophn-agent/harness/prompt-assemble
- 요구: lophn-agent/harness/prompt-assemble#R4, R5, R6, R18, R25, R26, R27, R28
- 자리: packages/lophn-agent/harness/prompt-assemble/ (material.ts, turn-context.ts)
- 쓰는 contract: outline·search 읽기(documents#T13, documents#T14, contracts#T18), 현재 보기 상태 relay `read {session}` → `{availability, observed_at, generation, summary, next_page?}`(contracts#T25, platform#T57), redaction
- 내놓는 contract: 없음
- slice: agent
- 조사: docs/research/prompt-assembly-and-compaction.md
- 선행: T19, contracts#T25, documents#T13, documents#T14, shell#T26, platform#T57
- 완료:
  - material_test.ts에 R4, R5, R6, R18 테스트: 기준·참고·watch 자료의 주소·version·summary·outline만과 요청한 section만 본문, 같은 대상·version·관점은 한 번·다르면 합치지 않음, skill 이름·설명은 지시에·본문은 tool 이력에만, 초기 자료 초과는 참고 summary→기준 outline→선택 자료 순으로 줄이고 생략 범위·수 표시
  - turn_context_test.ts에 R25–R28 테스트: UTC·timezone·탭·초점·앱 요약을 이력 뒤 맨 마지막 최신 메시지에, 8 KiB·탭 20개·앱 요약 2 KiB, 초점 우선, 수집 실패·주기 run은 없음과 이유, 이전 turn 값 재사용 없음, 탭은 redaction 거친 data이고 command 허락이 아님, 실제 포함한 값·수집 시각을 ModelCall 근거에

### T21 tool registry, 실행기, tool call ledger

- 등급: 기본
- concern: lophn-agent/harness/tools
- 요구: lophn-agent/harness/tools#R1, R2, R3, R4, R5, R11, R12, R13, R14, R15
- 자리: packages/lophn-agent/harness/tools/ (model.ts: ToolDefinition·ToolResult, commands.ts, reads.ts, registry.ts, schema.ts, result.ts, work.ts: executor), apps/core/lophn-agent.ts
- 쓰는 contract: command·read·blob·redaction, `tx.call`(contracts#T6)
- 내놓는 contract: RecordToolRequest, DecideToolCall, StartToolCall, FinishToolCall, RecordReadToolCall, SupplementToolCall, tool call read/list, event ToolCallRequested·ToolCallDecided·ToolCallStarted·ToolCallFinished·ToolCallSupplemented (contracts#T30)
- slice: agent
- 조사: docs/research/tool-registry-and-judgment.md
- 선행: T6, T17, contracts#T30, platform#T18
- 완료:
  - `tool_calls` 표, `(model_call, response_key)` unique
  - tools_test.ts에 R1–R5, R11–R15 테스트: 금지 tool 부재, 정의 하나가 목록과 실행에 함께 쓰임, unknown field·숫자 문자열·허용 밖 값 거절(변환·보정 없음, Pi식 `Value.Convert` 금지), 효과 선언 없는 tool 미제공·호출 기록만 남는 조회는 read, preset capability ∩ 역할 상한의 내장→앱→외부 순서와 같은 판의 같은 bytes, 결과 네 종류와 기계가 구별하는 실패 종류, 목록 20개(45개는 20·20·5)와 조건 유지 cursor, 24 KiB·300줄 상한과 문서 앞·log 최신·JSON·Unicode 보존·생략 표시, read는 즉시 호출·후행 기록, write·approval 필요·external은 선행 기록 뒤 호출, 입력·출력 근거는 redaction 뒤 blob

### T22 tool 판정과 approval request

- 등급: 기본
- concern: lophn-agent/harness/tool-judgment
- 요구: lophn-agent/harness/tool-judgment#R1, R2, R3, R5, R6, R7, R8, R9
- 자리: packages/lophn-agent/harness/tool-judgment/ (model.ts: 판정표, work.ts: 진입 직전 재검사)
- 쓰는 contract: approval 생성·한 번 사용(contracts#T22), 인증
- 내놓는 contract: 없음(T21의 DecideToolCall 근거)
- slice: agent
- 조사: docs/research/tool-registry-and-judgment.md
- 선행: T17, T21, platform#T21, platform#T23
- 완료:
  - judgment_test.ts에 R1–R3, R5–R9 테스트: allow만 바로 호출·ask는 미시작·deny는 approval 없음, 확인 불가·역할 밖·scope 밖은 deny(승인으로 열지 않음), 범위 안 read와 사람 요청·그 handoff의 되돌릴 수 있는 안쪽 write는 allow, 되돌림 없는 write·external은 ask, 되돌림은 소유 계약으로만 판단, 여러 대상은 deny 하나면 전체 deny·ask면 approval 하나·부분 실행 없음, 최초·retry·복구·승인 뒤 매번 재검사, model·자료·MCP 설명의 허락 주장과 자동 심사·승인 생략 모드 없음, ask의 approval은 정확한 동작·대상·입력·비교 기준·기한에 묶임, 거절한 같은 요청은 같은 run과 handoff lineage에서 다시 묻지 않고 새 독립 요청은 막지 않음, 승인은 그 call 하나에만 쓰고 세션·tool 단위 재사용("always" 같은 cache)이 없음, 승인 결정은 사람 event 채널에서만 읽고 model·자료 출력에서 파싱하지 않음

### T23 문서·format tool 묶음

- 등급: 기본
- concern: lophn-agent/harness/tools, lophn-agent/roles/common
- 요구: lophn-agent/harness/tools#R6, R7, lophn-agent/roles/common#R6, R7, R10
- 자리: packages/lophn-agent/harness/tools/ (bundles/document.ts, bundles/format.ts)
- 쓰는 contract: document list·history(documents#T6), 저장 준비와 같은 Tx 확정(documents#T8), search(documents#T13), outline·read(documents#T14), diff(documents#T16), format(documents#T4), agent 출력 저장 범위(documents#T30)
- 내놓는 contract: 없음
- slice: agent
- 조사: docs/research/tool-registry-and-judgment.md
- 선행: T21, T22, documents#T4, documents#T6, documents#T8, documents#T13, documents#T14, documents#T16, documents#T30
- 완료:
  - document_tools_test.ts에 tools#R6, R7(format), roles/common#R6, R7, R10 테스트: 허용 place 안 목록·이력·차이·본문, 새 문서와 실제 읽은 version 기준 새 version, Operator만 승인 outputs, format 안내는 읽기만·검사한 본문을 저장하지 않음, 저장 접수·version 확정·파일 반영을 다른 사실로 결과에 표시, 읽은 근거와 부족한 자료 구분
  - 통합 테스트: ToolCall 성공과 documents 판 확정이 한 transaction
  - SDK 안내 tool은 T44(apps#T5가 apps slice)

### T24 질문 생명 주기

- 등급: 기본
- concern: lophn-agent/questions
- 요구: lophn-agent/questions#R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12
- 자리: packages/lophn-agent/questions/ (model.ts, commands.ts, reads.ts), apps/core/lophn-agent.ts
- 쓰는 contract: command·read·blob·redaction, secret 안전 입력 안내(contracts#T23)
- 내놓는 contract: create_question, answer_question, defer_question, cancel_question, expire_question, question read/list(coding-agent#T18이 쓰는 상태·채택 고정 version·revision 포함), event QuestionCreated·QuestionAnswered·QuestionExpired·QuestionCancelled (contracts#T28)
- slice: agent
- 조사: docs/research/questions-and-hitl.md
- 선행: T10, T11, contracts#T28
- 완료:
  - `questions` 표
  - questions_test.ts에 R1–R12 테스트: 결정 하나만·이미 받은 답 재질문 없음, run 필수·세션 선택·run당 답 기다림 하나, 자유 입력과 선택형+자유 입력·추천 하나와 이유·선택지 수 상한 없음, 답 전 화면용 기본·상세 자료, 본문 덮어쓰기 없음, 지정한 명시 답만 인정하고 일반 메시지·빈 답은 답이 아님(대기 중 일반 text를 답으로 claim하지 않음), 기본 기한 없음(900초·3600초 같은 기본값 없음)과 명시 기한 경계, 대기 질문은 메모리 promise가 아니라 ledger에 남아 재시작 뒤 그대로, 미루기·만료·취소는 답 없음, 무효화와 늦은·중복 답 미적용, 재시작 뒤 상태·답·적용 결과 확인, secret으로 보이는 평문 답은 일반 저장 전에 막고 platform 안전 입력으로 안내·판정 불가면 fail closed(질문 Q23), 답이 approval·권한을 대신하지 않음

### T25 사람 기다림과 재개

- 등급: 기본
- concern: lophn-agent/harness/waiting-and-recovery
- 요구: lophn-agent/harness/waiting-and-recovery#R1, R2, R3, R4, R5, R6, R7, R11
- 자리: packages/lophn-agent/harness/waiting-and-recovery/ (model.ts, commands.ts, reads.ts, work.ts: wait resolver), apps/core/lophn-agent.ts
- 쓰는 contract: approval(contracts#T22), read·event 구독
- 내놓는 contract: WaitRun, ResolveRunWait, CorrectWaitingRun, event RunWaited·RunResumed (contracts#T26)
- slice: agent
- 조사: docs/research/agent-run-loop.md, docs/research/questions-and-hitl.md
- 선행: T10, T22, T24, platform#T21, platform#T22, platform#T23
- 완료:
  - `run_wait_resolutions` 표, `(run, request, decision_seq)` 한 번 반영
  - waiting_test.ts에 R1–R7, R11 테스트: `waiting_user` 상태 기계, 질문 답이면 같은 run 재개·만료/미루기/취소는 no_answer stopped, approval 허락은 재검사 뒤 그 call만 한 번, 거절·만료·취소·재검사 실패는 미실행 뒤 같은 run 새 판단, 금지·거절·미결정·만료·취소·판정 실패 구별과 거절·만료는 실패 수에 없음, 대기 중 새 입력·멈춤 접수, 명시 steering으로 옛 질문·approval 취소, 결정 접수와 적용 구별, 늦은 결정 미사용, 대기 대상·이유와 확인된 시각에만 countdown, retry 예정 시각·횟수 보존과 멈춤·steering·한도가 대기를 깨움, 재시작 뒤 미시작 증거 없는 approval 미사용, 답 저장→option 적용→ResolveRunWait 사이 각 지점에서 죽여도 적용 한 번·재개 한 번

### T26 agent loop: turn 진행, tool 묶음, retry, 멈춤

- 등급: 최상위
- concern: lophn-agent/harness/run-loop
- 요구: lophn-agent/harness/run-loop#R8, R9, R10, R11, R12, R13, R15, R23, R24, R25
- 자리: packages/lophn-agent/harness/run-loop/ (loop.ts, turn.ts, tool-batch.ts, retry.ts), apps/agent-runtime/
- 쓰는 contract: command·read·event 구독, 소유 read(tool 경유)
- 내놓는 contract: 없음
- slice: agent
- 조사: docs/research/agent-run-loop.md, docs/research/provider-adapters.md
- 선행: T11, T12, T15, T19, T20, T21, T22, T25
- 완료:
  - loop_test.ts에 R8–R13, R15, R23–R25 테스트(fake provider·clock·owner contract): model이 응답하지 않아도 core read·다른 assignment가 진행, turn 순서와 조립 뒤 입력·멈춤 재확인, 수정 입력은 다음 tool 전에 새 판단, 불완전 응답의 tool 0개와 잘림을 다음 판단에 전달, 모든 call이 확인된 read일 때만 병렬·하나라도 아니면 요청 순서 순차·결과는 요청 순서, 없는 tool·잘못된 인자는 call별 결과·인자 보정 없음, 순차 write·external 거절·최종 실패 뒤 나머지 미실행 이유·독립 read 결과 보존, 멈춤 뒤 새 model·tool·retry 차단·진행 호출 중단 요청·미시작 call 미실행 결과 합성, 일시 실패만 최대 2회(서버 시각을 지키고 없으면 2초·4초, fake clock으로 서버 시각 전 재시도 없음)·부분 응답 미채택, tool retry는 read·멱등 write만 1회 1초±10%와 재판정, provider 끄기·MCP 제거 뒤 새 진입 차단
  - flow steer-agent-work의 agent 갈래

### T27 중단 뒤 복구

- 등급: 최상위
- concern: lophn-agent/harness/waiting-and-recovery
- 요구: lophn-agent/harness/waiting-and-recovery#R8, R9, R10, R12
- 자리: packages/lophn-agent/harness/waiting-and-recovery/ (recovery.ts, commands.ts: RecoverRun), apps/agent-runtime/ (기동 순서)
- 쓰는 contract: read·command, 소유 command 결과 조회
- 내놓는 contract: RecoverRun, event RunRecovered (contracts#T26)
- slice: agent
- 조사: docs/research/agent-run-loop.md, docs/research/session-and-conversation.md
- 선행: T26, T28
- 완료:
  - recovery_test.ts에 R8–R10, R12 테스트: 완전 응답·확정 결과를 다음 판단 전에 저장, 각 command commit 직후 죽여도 중복 run·효과·usage 없음, 순차 세 call 중 둘째 뒤 끊기면 셋째부터, 저장 실패를 완료로 가정하지 않음, 비사용자 중단만 자동 복구하고 현재 assignment·판정·안전·대상·credential·누적 한도 재확인, 멈춘 assignment를 풀지 않음, 결과 모르는 write·external은 결과 조회·멱등 확인 전 반복 없음·확인 불가면 effect_unknown 종료와 충돌 후속 call 차단, opaque 추론 상태 유실은 state-free 검증 또는 configuration_unavailable, 압축 summary는 완성 출력과 원문 보호 범위로 같은 run에 복구·이어가기 summary와 합치지 않음
  - 앱 invocation 결과 조회 연결은 T44

### T28 compaction과 세션 이어가기 summary

- 등급: 기본
- concern: lophn-agent/harness/prompt-assemble, lophn-agent/conversation
- 요구: lophn-agent/harness/prompt-assemble#R10, R11, R12, R13, R14, R15, R16, R17, R19, R20, R21, R22, R23, lophn-agent/conversation#R9, R10, R11
- 자리: packages/lophn-agent/harness/prompt-assemble/ (compaction.ts, summary.ts, work.ts: derived `summaries/`), packages/lophn-agent/conversation/ (이어가기)
- 쓰는 contract: blob·read
- 내놓는 contract: OpenSession의 continued_from 입력(contracts#T26의 일부)
- slice: agent
- 조사: docs/research/prompt-assembly-and-compaction.md, docs/research/session-and-conversation.md
- 선행: T19, T20, T26
- 완료:
  - compaction_test.ts에 R10–R17 테스트: 예산 80000에서 55999는 압축 없음·56000은 시작해 40000 이하, 보호 범위와 최근 이력 25%(2000~15000)·call/result 짝 유지, 2000 code point 넘는 재조회 가능 결과는 앞 1000·뒤 1000과 생략·재조회 참조·재조회 불가는 자르지 않음, organizing(없으면 같은 model) 출력 상한 min(10%, 4000), 절반 이하 chunk와 단일 짝 초과면 실패, 여섯 부분 summary와 완료 조건, 별도 재검토 call 없음, 실패면 원문 유지·같은 구간 자동 반복 없음·한계 밖이면 context_limit, 보호 입력만으로 50%를 넘으면 사전 검사로 summary 호출 0회(질문 Q10), 병합은 구간을 모두 덮는 merge tree와 단계별 입력·출력 상한, provider 문맥 초과 응답 뒤 재조립 재시도 최대 1회(질문 Q12)
  - summary_test.ts에 R19–R23, conversation#R9–R11 테스트: summary는 derived이고 organizing 호출·원문 구간·생성 시각·근거 version 연결, 이어가기 400 token(401 거절, 문장 자르지 않고 다시 줄임), 사람 의도·추정·확인 결과·미정 구별, 실패가 세션 종료를 막지 않음, 같은 세션 최신 완성본 하나만, 다른 세션·주기·handoff 자동 주입 없음, 원문·미답 질문·approval·효과 복제 없음, 늦은 notification으로 닫힌 세션 재활성 없음
  - flow resume-agent-session의 agent 갈래

### T29 lophn 제안의 question option action: 문서 자리, 설정 변경

- 등급: 기본
- concern: lophn-agent/questions, lophn-agent/roles/lophn, lophn-agent/harness/tools
- 요구: lophn-agent/questions#R13, R14, R15, R16, lophn-agent/roles/lophn#R14, R15, R17, R20, R21, R22, lophn-agent/harness/tools#R20
- 자리: packages/lophn-agent/questions/ (option-actions.ts: 등록 owner command dispatch), packages/lophn-agent/roles/lophn/ (자리 추천, 설정 안내), packages/lophn-agent/harness/tools/ (bundles/guide.ts: `lophn.guide`, `setting.read`)
- 쓰는 contract: QuestionActionEvidence(platform#T24), settings registry·lophn 제안(contracts#T24, platform#T27), 동봉 안내 read(documents#T29), 문서 이동·이름 변경 option 경로(documents#T9, documents#T30), 새 앱 등록 owner command(apps#T1), `tx.call`
- 내놓는 contract: apply_question_option, QuestionOptionAction 값 타입 (contracts#T28)
- slice: agent
- 조사: docs/research/questions-and-hitl.md
- 선행: T23, T24, T30, platform#T24, platform#T27, documents#T29, documents#T30, apps#T1
- 완료:
  - option_actions_test.ts에 questions#R13–R16 테스트: 고정 대상·입력·비교 기준만 사람의 실제 선택 뒤 한 번 적용(actor=user, run=null), 전제 바뀌면 답 보존·동작 미적용과 달라진 대상·이유, 자유 답·일반 tool 결과를 동작으로 parse하지 않음(owner마다 등록 adapter), owner CAS와 `(question, answered_seq, option_key)` 한 번 적용, 채택은 고정 version의 질문 답
  - lophn_guide_test.ts에 roles/lophn#R14, R15, R17, R20–R22, tools#R20 테스트: 자리 추천 run당 최대 5개와 이유 한 줄·후보 없으면 이동 선택지 없음, 보조 근거 두 조건·자동 주기 run 없음, 사용 안내는 기존 안내로 답하고 바뀐 경우에만 새 version 요청, 동봉 안내·공개 설정 정의·적용값·출처만 읽음·secret과 credential은 읽거나 묻지 않음, 설정 변경은 현재·새 값·영향·적용 시점이 고정된 선택지와 추천, 권한 확대·secret·외부 효과는 owner 보호 화면 안내, 설정 변경 command를 agent tool로 제공하지 않음
  - flow ask-lophn-help, organize-documents 2·3단계의 agent 갈래

### T30 동봉 제품 안내 글

- 상태: 완료 (#56)
- 등급: 기본
- concern: lophn-agent/roles/lophn
- 요구: lophn-agent/roles/lophn#R17, R20
- 자리: packages/lophn-agent/roles/lophn/guides/ (안내 Markdown 원문)
- 쓰는 contract: 동봉 안내 형식 BundledGuide(contracts#T18)
- 내놓는 contract: 없음(설치 묶음의 guides 자리는 platform#T48이 정하고 묶는다)
- slice: agent
- 조사: docs/research/presets-and-agent-config.md
- 선행: contracts#T18
- 완료:
  - lophn 기능·화면·설정·provider 연결·agent 역할·질문과 approval·revert·확장(skill·MCP)·지침 파일 안내를 사람이 쓰는 영어 화면 말로 쓴다(제품 사용법만, 내부 개념 이름 없음)
  - guides_test.ts·guide-bytes_test.ts·settings-explanation_test.ts에 roles/lophn#R17, R20 테스트: 안내마다 기능 이름·절·조립에서 받은 현재 제품 판이 있고 실제 UTF-8 bytes·hash·files가 고정되며 BundledGuide 형식 검사를 통과, 설정 항목 wording key는 공개 settings definition 입력과 맞음, secret 값·내부 ledger 말 없음. synthetic definition 테스트는 registry 실물 검증과 구분한다
  - T30은 영어 안내 자산과 고정 BundledGuide·relative files를 내놓는다. `/v1/guides/*` route는 documents#T29, 설치 manifest/files 조립은 platform#T48이 맡고 실제 HTTP·설치 E2E는 그 작업들의 E2E에서 확인한다(질문 Q27)

### T31 lophn 역할: 기획과 안내

- 등급: 기본
- concern: lophn-agent/roles/lophn
- 요구: lophn-agent/roles/lophn#R1, R2, R3, R4, R5, R7, R8, R11, R13, R16, R19
- 자리: packages/lophn-agent/roles/lophn/ (prompt 자산, 역할 tool 선택, plan.ts: 프로젝트 기획 문서 검사)
- 쓰는 contract: outline·search(documents#T13, documents#T14), app list(apps#T1)
- 내놓는 contract: 없음
- slice: agent
- 조사: docs/research/presets-and-agent-config.md, docs/research/questions-and-hitl.md
- 선행: T8, T23, T26, T29
- 완료:
  - lophn_test.ts에 R1–R5, R7, R8, R11, R13, R16, R19 테스트: 기본 상대 역할의 tool 목록(앱 상세 설계·원인 해석·claim·구현·coding agent 시작 없음), 디스크·소스·업무 DB 직접 접근 없음, 되돌릴 수 있는 요청 범위 문서 저장은 approval 없음·문서 이동과 새 앱 등록은 question 선택지, 프로젝트 기획 순서(기존 목적 안→context 범위 넓히기→새 프로젝트)와 문서 검사(목적 한 문장·버린 두 방안·자리 후보·내줄 것), 선택·버린 방안을 요청 범위 기획 문서로, 받는 handoff 내용 한정, 의도·취향 질문과 답 없으면 미결정 유지, judgment·organizing 용도
  - 앱 기획(R6, R9, R10, R12)은 T47(apps slice), 판단 품질은 T55의 eval capability 사례로 잰다

### T32 handoff와 agent 일 tool

- 등급: 기본
- concern: lophn-agent/handoff, lophn-agent/harness/run-loop, lophn-agent/harness/tools
- 요구: lophn-agent/handoff#R1, R2, R3, R4, R5, R6, R7, R8, R9, lophn-agent/harness/run-loop#R7, lophn-agent/harness/tools#R10
- 자리: packages/lophn-agent/handoff/ (model.ts, commands.ts: submit은 AcceptRun 출처 검사 wrapper, reads.ts), packages/lophn-agent/harness/tools/ (bundles/agent.ts: `question.*`, `approval.*`, `preset.*`, `assignment.*`, `run.read_result`, `handoff.*`), apps/core/lophn-agent.ts
- 쓰는 contract: command·read·blob
- 내놓는 contract: handoff submit/status/result (contracts#T28)
- slice: agent
- 조사: docs/research/handoff-and-delegation.md
- 선행: T10, T21, T22, T24
- 완료:
  - handoff_test.ts에 R1–R9, run-loop#R7 테스트: 허용 방향 다섯 개와 Operator 송수신 금지, 유효 assignment만·담당 없는 대기열 없음, 보낸 run·원래 요청·무엇·왜·제외·기대 결과·고정 근거 필수와 기획·설계는 채택 판·채택 질문, 세션·tool 기록·요약 복사 없음, 원래 사람 요청에서 이어진 run에서만·보낸 run은 전달 사실로 끝남, 받은 결과가 새 판단을 자동 시작하지 않음, 권한·approval 이전 없음, 거절 lineage, 결과는 고정 version 주소 또는 없는 이유, 재전송해도 수신 run 하나(`(sender_run, dedup_key)` unique와 송신 기록·수신 접수 원자 확정, transport idempotency와 별개), 재전송 replay는 저장 결과만 주고 상세 읽기는 현재 권한으로 다시 검사(질문 Q24), 발신 approval 정책·grant·설정 상속 없음, what·why에 대화 원문을 붙이는 복사는 safety·redaction 검사(질문 Q25), 받은 run에서 보낸 run·원래 요청·근거 version 확인
  - agent_tools_test.ts에 tools#R10 테스트: preset·assignment는 읽기와 초안·approval 제출만, 직접 적용 없음
  - flow resume-agent-session의 handoff 갈래

### T33 시각 블록

- 등급: 기본
- concern: lophn-agent/visuals, lophn-agent/conversation, lophn-agent/harness/tools
- 요구: lophn-agent/visuals#R1, R2, R3, R5, R6, lophn-agent/conversation#R12, R13, lophn-agent/harness/tools#R19
- 자리: packages/lophn-agent/visuals/ (model.ts: VisualBlock 검사, work.ts: prepare_document), packages/lophn-agent/harness/tools/ (bundles/visual.ts)
- 쓰는 contract: 판 확정(documents#T8), blob·redaction
- 내놓는 contract: MessageContent·VisualBlock 값 타입(contracts#T30, shell renderer가 쓴다)
- slice: agent
- 조사: docs/research/chat-visuals.md
- 선행: T11, T21, T23, contracts#T30
- 완료:
  - visuals_test.ts에 visuals#R1–R3, R5, R6, conversation#R12, R13, tools#R19 테스트: 표·bar/line/scatter·node/edge 도표·앱 카드 참조만, HTML·JS·CSS·URL 거절, 제목·설명·출처(고정 문서 version 또는 앱 command 결과) 필수, 검증 순서(parse → 블록 수 → 종류별 상한 → 마지막에 bytes 합계)와 블록 8개·256 KiB·표 1000행 20열·차트 8 series 1000점·도표 100 node 200 edge 초과는 자르지 않고 메시지 전체 거절(부분 저장 없음, 8·9개와 1000·1001행 경계 사례), 결측은 null로 표시, 깨진 블록도 본문·참조 보존과 다른 앱·release로 대체 없음, 문서 준비는 escape한 명세 JSON과 SDK 정적 그림만 담은 실행 코드 없는 HTML이고 저장은 document tool 별도(준비 성공과 저장 성공 분리), 확정 메시지와 함께 순서대로 저장·stream 조각은 블록 아님·renderer 실패는 메시지 실패 아님
  - flow view-agent-visuals의 표·차트·도표 갈래(앱 카드 갈래는 T47, E2E는 apps#T27)

### T34 run revert (ledger 변경)

- 등급: 기본
- concern: lophn-agent/revert
- 요구: lophn-agent/revert#R1, R2, R3, R4, R5, R6, R7, R8, R9
- 자리: packages/lophn-agent/revert/ (model.ts, commands.ts, reads.ts, work.ts: 준비), apps/core/lophn-agent.ts
- 쓰는 contract: revert가 쓰는 document.archive·restore machine 경로(documents#T30), `tx.call`
- 내놓는 contract: revert_run, revert preview/list, event RevertStarted·RevertApplied·RevertBlocked·RevertFinished (contracts#T28)
- slice: agent
- 조사: docs/research/revert-and-checkpoints.md
- 선행: T21, T23, contracts#T28, documents#T30
- 완료:
  - `reverts`, `revert_changes`, `revert_change_sources`, `revert_change_compensations` 표
  - revert_test.ts에 R1–R9 테스트: 끝난 run 하나의 확정 변경 전체(별도 묶음 확정 없음), 사람만 요청·agent tool 없음, preview의 복원 가능·불가·남길 사실·충돌과 적용 뒤 실제·남은 영향·부분 구별, 후속 변경이 있으면 아무것도 시작하지 않음, 복원은 소유 concern의 새 변경(과거 사실·version 보존), 외부 영향·activation·secret·source·디스크 원본을 복구했다고 하지 않음, 복원 불가 섞이면 기본 차단·명시 동의만 독립 부분, 같은 요청 반복은 저장된 결과를 돌려주고 한 번만 적용(두 번째 거절이 아님)·원래 답·승인·호출·사용량 보존, 분류 안 된 영향 누락 없음, 읽기 전용 호출도 목록에서 지우지 않음, preview 뒤 대상이 바뀌면 revert_run이 owner CAS로 전부 blocked(preview는 저장 diff 합산이 아니라 현재 판 비교)
  - context·term 변경 복원은 T42, 앱 복원은 T48, 문제 해석 재연결은 T50

### T35 skill 발견과 읽기

- 등급: 기본
- concern: lophn-agent/extensions
- 요구: lophn-agent/extensions#R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R30
- 자리: packages/lophn-agent/extensions/ (skills.ts, skill-read.ts), packages/lophn-agent/harness/tools/ (`skill.read`, `skill.read_supplemental`), apps/core/lophn-agent.ts (skill root SettingDefinition)
- 쓰는 contract: settings registry(contracts#T24)
- 내놓는 contract: 없음
- slice: agent
- 조사: docs/research/agent-skills.md
- 선행: T7, T21, platform#T25
- 완료:
  - skills_test.ts에 R1–R10, R30 테스트: 등록 root 순서→개인→동봉, root와 바로 아래 bundle만·다른 harness 보관소 자동 탐색 없음, name `[a-z0-9]+(-[a-z0-9]+)*` 1~64자·description 1~1024자·잘못된 형식은 이유와 제외, 같은 이름 첫 발견·같은 범위 사전순과 진단, preset 선택 ∩ 발견·누락 알림, prompt에 이름·설명만 사전순, 본문 전체와 보조 title만·일부 성공 없음, `..`·절대 경로·symlink·실행 파일 거절, RunBasis hash 비교와 변경·삭제면 실패·새 판은 다음 run부터, tool·권한·연결 추가 없음, 설치·원격 검색·자동 작성 없음, 정확한 이름만 선택(생략·빈 목록은 0개, 없는 이름·중복·전체 선택 거절), 잘못된 frontmatter를 고쳐 통과시키지 않음, prompt와 결과에 절대 경로 없음, 발견 cache가 아니라 run 경계로 고정

### T36 외부 MCP 연결 관리

- 등급: 기본
- concern: lophn-agent/extensions
- 요구: lophn-agent/extensions#R12, R13, R14, R15, R18, R19, R20, R21, R22, R25
- 자리: packages/lophn-agent/extensions/ (mcp-config.ts, mcp-connections.ts, adapters/mcp-stdio.ts, adapters/mcp-http.ts), apps/agent-runtime/, apps/core/lophn-agent.ts (MCP SettingDefinition, `--allow-run` 목록)
- 쓰는 contract: settings registry(contracts#T24), secret 전송 부착(contracts#T23), 감독 launch spec(platform#T7)
- 내놓는 contract: 없음
- slice: agent
- 조사: docs/research/mcp-client.md
- 선행: T21, T26, platform#T7, platform#T20, platform#T25
- 완료:
  - mcp_connections_test.ts에 R12–R15, R18–R22, R25 테스트(가짜 MCP child·HTTP server): 설정 누락·상충이면 그 서버만 연결 안 함과 고칠 항목, stdio와 Streamable HTTP만·SSE 자동 전환 없음, shell 해석 없는 절대 executable과 최소 env(PATH·HOME·TEMP·LC_ALL+명시 env)·shell 문자 literal 전달, 다른 secret 상속 없음, HTTPS·loopback만 HTTP·다른 origin(host·scheme·port)으로의 redirect는 거절(질문 Q13)·TLS 검증 끄기 없음, (assignment, server)마다 연결 하나·다른 assignment와 공유 없음, 연결+initialize 30초·전체 목록+검증 30초·호출 60초(1~600초)는 progress로 늘지 않는 단조 시계 기한이고 전달 뒤 timeout은 uncertain, 끊김 1·2·4초 3회 재연결·auth 실패 재연결 없음·전달한 call 재전송 없음, detach는 새 call 차단→cancel→close·stdio 5초 뒤 kill, 모든 tools/list page 검증 뒤에만 제공·반복 cursor·중복 이름·잘못된 schema 하나면 전체 미제공, page·항목·누적 bytes·schema 깊이 상한(질문 Q14), sampling·elicitation·roots·prompts·resources 미지원

### T37 MCP tool 이름, 분류, preset 선택

- 등급: 기본
- concern: lophn-agent/extensions
- 요구: lophn-agent/extensions#R11, R23, R24, R26, R27, R28, R29, R31
- 자리: packages/lophn-agent/extensions/ (mcp-tools.ts), packages/lophn-agent/harness/tool-judgment/ (MCP 판정 입력)
- 쓰는 contract: settings registry(contracts#T24: tool별 분류)
- 내놓는 contract: 없음
- slice: agent
- 조사: docs/research/mcp-client.md, docs/research/tool-registry-and-judgment.md
- 선행: T22, T36
- 완료:
  - mcp_tools_test.ts에 R11, R23, R24, R26–R29, R31 테스트: `ext_<server>_<tool>` 64자·충돌은 원래 쌍(UTF-8 `JSON.stringify([server, tool])`)의 SHA-256 앞 8자를 충돌 묶음 전체에 붙여 순서와 무관·그래도 충돌이면 거절(질문 Q15), list_changed·재연결이면 전체 재조회와 그동안 그 server tool 호출 차단(질문 Q16), name·description·inputSchema·hints로 만든 정의 hash가 바뀐 tool의 분류·safe 표시 무효(분류는 원본 정의에 묶음)·삭제 tool 즉시 차단·새 tool 자동 선택 없음, read·write·external 정의와 사람 분류·여러 행동은 가장 넓은 분류, 되돌림 모르는 external은 ask·safe 표시 tool만 묻지 않음·hints는 참고만·역할 상한 확대 없음, 호출마다 판정 입력·연결·로그인·이전 성공은 허락 아님, 문서·skill·server 응답에서 설정 자동 수입 없음, 서버+현재 tool 정확한 쌍만 선택(서버 전체·미래 tool 거절)
  - flow add-agent-extension의 agent 갈래

### T38 MCP HTTP 인증

- 등급: 기본
- concern: lophn-agent/extensions
- 요구: lophn-agent/extensions#R16, R17
- 자리: packages/lophn-agent/extensions/ (mcp-auth.ts)
- 쓰는 contract: secret 보관·전송 부착(contracts#T23)
- 내놓는 contract: 없음(MCP OAuth 시작·완료는 settings 화면 흐름의 runtime 제어 작업)
- slice: agent
- 조사: docs/research/mcp-client.md
- 선행: T36, platform#T19, platform#T20
- 완료:
  - mcp_auth_test.ts에 R16, R17 테스트: 없음·Bearer·API key header·OAuth 2.1 Authorization Code+S256 PKCE와 사람이 시작한 browser·loopback callback, dynamic registration 미지원 서버는 사람 등록 client, secret을 server URL·issuer에 묶고 URL·issuer·계정이 바뀌면 재사용 없음, 같은 연결의 refresh는 하나, 실패는 재인증 필요

### T39 trace 읽기

- 등급: 기본
- concern: lophn-agent/observability
- 요구: lophn-agent/observability#R1, R2, R3, R4, R5, R6, R7, R8, R9, R11, R18, R19, R20, R21, R22
- 자리: packages/lophn-agent/observability/ (model.ts: RunTrace, reads.ts), apps/core/lophn-agent.ts
- 쓰는 contract: read·blob
- 내놓는 contract: agent-traces read (`/v1/agent-traces/read`, contracts#T30)
- slice: agent
- 조사: docs/research/trace-and-observability.md
- 선행: T6, T21, T25, T32, T37
- 완료:
  - trace는 저장하지 않고 조회 때 event·ModelCall·ToolCall·message blob을 seq 순으로 조립한다. 경과 시간은 T12·T25가 CheckpointRun과 대기 진입·탈출 경계에 남긴 단조 누적값을 쓴다
  - trace_test.ts에 R1–R9, R11, R18–R22 테스트(실패 model 2회+거절 tool 1회, 시계를 뒤로 옮긴 경과, 종료 event 없이 끊긴 run 사례 포함): run 하나의 시작 조건·상태·호출 참조(사본 없음)와 시작 당시 고정 판, handoff 양방향 연결과 비용 귀속, run 밖 호출은 독립 trace(가짜 run·세션 없음), 모든 model 시도·tool 판정을 샘플링 없이·retry·실패·취소·미실행·불명확 구별, UTC ms 시각과 단조 시계 경과(run·model·첫 응답·tool·사람 기다림), 종료 종류 구별·종료 event 없이 끊긴 run은 unconfirmed로 정상과 분리, 본문은 소유 원본으로만·오류 원문·secret·추론 사본 없음, stream 조각 없음, 사용량·비용·품질은 가리키기만, MCP 호출의 주체·서버·tool·분류·판정·approval·결과, 화면용 기본·상세 자료, 도구 활동 접기, 판단은 검토 가능한 요약만

### T40 trace export

- 등급: 기본
- concern: lophn-agent/observability
- 요구: lophn-agent/observability#R10, R12, R14, R16, R17
- 자리: packages/lophn-agent/observability/ (export.ts, work.ts)
- 쓰는 contract: redaction(contracts#T12)
- 내놓는 contract: agent-traces export (`/v1/agent-traces/export`, contracts#T30)
- slice: agent
- 조사: docs/research/trace-and-observability.md
- 선행: T39
- 완료:
  - export_test.ts에 R10, R12, R14, R16, R17 테스트: UTF-8 NDJSON 형식 버전 1과 trace별 기록, 메타데이터 기본과 export마다 내용 종류 선택, redaction 뒤 값마다 UTF-8 32768 bytes 앞부분(문자 중간에서 자르지 않음, 한글 경계 사례)·잘림·제외·원본 참조는 본문 밖 별도 필드, 내용 종류 기본은 빈 집합, 복구 원본에는 상한 없음, network export·제삼자 전송 없음, 실패가 원본·run을 바꾸거나 model 재시도를 시키지 않고 보낸·못 보낸 수 구별
  - 보존 정리는 T57(platform#T44가 operations slice)
  - flow review-agent-work의 trace·export 갈래

### T41 agent slice flow E2E

- 등급: 기본
- concern: lophn-agent
- 요구: 없음(T3–T40 요구의 flow 확인)
- 자리: e2e/flows/ (`<flow>_test.ts`)
- 쓰는 contract: E2E harness(contracts#T10), shell 화면 전부, platform, documents
- 내놓는 contract: 없음
- slice: agent
- 조사: 없음
- 선행: T3–T40, contracts#T10, platform#T17, platform#T29, shell#T26, shell#T27, shell#T28, shell#T29, shell#T30, shell#T31, shell#T32, shell#T33, shell#T34, shell#T35
- 완료:
  - fake provider·fixture로 E2E가 돈다: connect-provider, manage-provider-accounts, steer-agent-work, resume-agent-session, review-agent-work, answer-question, approve-action(앱 confirm 단계 제외), ask-lophn-help, edit-instructions, add-agent-extension, view-agent-visuals(앱 카드 갈래 제외), organize-documents 2~3단계, find-documents 5~6단계, project-workspace 8단계
  - 앱 confirm·앱 카드 단계는 apps#T27이 돈다

## context

context slice의 선행은 documents와 agent다(lead 결정). E2E는 documents#T27이 이 작업들을 선행으로 두고 돌린다.

### T42 context·term tool과 revert 연결

- 등급: 기본
- concern: lophn-agent/roles/context-engineer, lophn-agent/harness/tools
- 요구: lophn-agent/roles/context-engineer#R4, R5
- 자리: packages/lophn-agent/harness/tools/ (bundles/context.ts: `context.*`, `term.*`), packages/lophn-agent/revert/ (context·term 보상 경로)
- 쓰는 contract: context ledger(documents#T22), context outline(documents#T23), term(documents#T25), context·term contract(contracts#T21), `tx.call`
- 내놓는 contract: 없음
- slice: context
- 조사: docs/research/tool-registry-and-judgment.md, docs/research/revert-and-checkpoints.md
- 선행: T23, T34, contracts#T21, documents#T22, documents#T23, documents#T25
- 완료:
  - context_tools_test.ts에 context-engineer#R4, R5 테스트: 읽기 tool(목차·검색·version·절·범위·목록·이력·차이, context·project·format·역할·assignment, 앱 blueprint의 command 이름·설명·입력·효과)만, 쓰기는 되돌릴 수 있는 context 생성·이름·목적·보관·항목 변경, 용어 후보 관리, 정의 답은 question option으로만 전달(term.define), 요청 범위 보고 저장, Operator 초안 제출, 질문과 허용 handoff
  - context·term 변경이 run revert(T34)에서 documents#T22·T25의 보상 경로로 복원된다

### T43 Context Engineer 역할

- 등급: 기본
- concern: lophn-agent/roles/context-engineer
- 요구: lophn-agent/roles/context-engineer#R1, R2, R3, R6, R7, R8, R9, R10, R14
- 자리: packages/lophn-agent/roles/context-engineer/ (prompt 자산, 역할 tool 선택, report.ts: 설계 보고·용어 후보 검사)
- 쓰는 contract: context·term(documents#T22, documents#T25), outline·search(documents#T13, documents#T14)
- 내놓는 contract: 없음
- slice: context
- 조사: docs/research/presets-and-agent-config.md, docs/research/questions-and-hitl.md
- 선행: T8, T26, T29, T32, T42
- 완료:
  - context_engineer_test.ts에 R1–R3, R6–R10, R14 테스트: 맡지 않는 일 tool 없음(prompt 조립·앱 기획·코드·티켓·앱 command 실행·원본 이동·이름 변경·삭제), 목차에서 시작해 필요한 section만, 기준·참고·watch 선택이 context마다 다름, 보고의 목적·범위(주소·관점·이유)·용어 최대 30개와 미정 후보·경계, 용어 후보는 같은 context의 서로 다른 문서 3개 이상 본문에 그대로 나타나는 미등록 말·후보마다 출현 주소 최대 5개, 대응 후보와 충돌 구별·충돌 판단은 lophn에, 사람 결정 필요하면 질문·답 없으면 보류, judgment·organizing 용도

## apps

E2E는 apps#T27(use-app-command, ask-app-hint, connect-apps, view-agent-visuals 앱 카드, approve-action 앱 confirm)이 이 작업들을 선행으로 두고 돌린다. new-app·change-app의 App Engineer 단계는 coding-agent slice E2E가 돈다.

### T44 앱 command 자동 tool, 앱 command 판정, SDK 안내 tool

- 등급: 기본
- concern: lophn-agent/harness/tools, lophn-agent/harness/tool-judgment
- 요구: lophn-agent/harness/tools#R7, R8, R16, R17, lophn-agent/harness/tool-judgment#R10, R11
- 자리: packages/lophn-agent/harness/tools/ (app-tools.ts, bundles/app.ts: `project.*`, `app.*`, `problem.*`, `report.read`, `snapshot.read`, `verification.read`, `repair.read`, bundles/sdk.ts: `sdk.*`), packages/lophn-agent/harness/tool-judgment/ (앱 판정 근거), packages/lophn-agent/waiting-and-recovery 쪽 앱 invocation 결과 조회 연결
- 쓰는 contract: blueprint·permission·agent-context(contracts#T33), 앱 통로(contracts#T34), invocation(contracts#T35), grant·package(contracts#T37), problem read(contracts#T40)
- 내놓는 contract: 없음
- slice: apps
- 조사: docs/research/tool-registry-and-judgment.md
- 선행: T21, T22, T26, T27, apps#T2, apps#T4, apps#T5, apps#T7, apps#T9, apps#T10, apps#T11, apps#T12, apps#T19, problems#T6, problems#T7
- 완료:
  - app_tools_test.ts에 tools#R8, R16, R17 테스트(fixture 앱): active blueprint에서 command마다 이름·설명·input JSON Schema·effect·confirm·되돌리기 지원으로 tool 정의 자동 생성(별도 MCP 등록 없음), 역할·현재 허락·AgentAppScope 교집합만, release·계약 변경·허락 회수 뒤 옛 정의 호출 없음, source·원본·secret 값 접근 없음, 결과 유실은 ToolCall ID request_key로 status(apps#T7)·invocations(apps#T11) 조회
  - app_judgment_test.ts에 tool-judgment#R10, R11 테스트: confirm은 effect보다 먼저 ask·read allow·`command.revert.supported` 대응 command가 검증된 write는 allow·나머지 write와 external은 ask, ticket 취소는 묻지 않음, 성공 receipt `{invocation, receipt, expected_revision}` 보존, undo 문구만으로 낮추지 않음, ask와 confirm이 겹치면 approval 한 번(apps#T12)
  - sdk_tools_test.ts에 tools#R7(SDK) 테스트: 목록·규칙·예시를 읽기만, SDK 설치 없음
  - flow use-app-command의 agent 단계는 apps#T27 E2E

### T45 App Engineer assignment와 tool 범위

- 등급: 기본
- concern: lophn-agent/assignments, lophn-agent/roles/app-engineer
- 요구: lophn-agent/assignments#R1, lophn-agent/roles/app-engineer#R5, R6, R21
- 자리: packages/lophn-agent/assignments/ (AppCreated 반응: CreateAppEngineerAssignment), packages/lophn-agent/roles/app-engineer/ (역할 tool 선택), apps/core/lophn-agent.ts
- 쓰는 contract: AppCreated·AppArchived event(apps#T1), event 구독 cursor(contracts#T7)
- 내놓는 contract: CreateAppEngineerAssignment (contracts#T27)
- slice: apps
- 조사: docs/research/presets-and-agent-config.md
- 선행: T9, T44, apps#T1
- 완료:
  - assignments_test.ts에 assignments#R1 테스트: AppCreated마다 거두지 않은 AE 하나(같은 event 재전달에 중복 없음, 반응과 cursor를 같이 commit), 보관이면 멈춤·자동 해제·재개 없음
  - app_engineer_tools_test.ts에 AE#R5, R6, R21 테스트: 담당 앱의 허락된 read와 실제 되돌리기 지원 write만, confirm은 approval, external·복원 불가 write 없음, 설계 문서 저장과 ticket 생성은 approval 없음, ticket tool은 생성·읽기·make_ready만(T49)

### T46 App Engineer 인터뷰와 설계 문서

- 등급: 기본
- concern: lophn-agent/roles/app-engineer
- 요구: lophn-agent/roles/app-engineer#R1, R2, R3, R4, R7, R8, R9, R10, R11, R12, R20
- 자리: packages/lophn-agent/roles/app-engineer/ (prompt 자산, design.ts: 문서 종류·순서·명세 검사)
- 쓰는 contract: 판 확정(documents#T8), blueprint(apps#T19)
- 내놓는 contract: 없음
- slice: apps
- 조사: docs/research/presets-and-agent-config.md, docs/research/questions-and-hitl.md
- 선행: T29, T32, T45
- 완료:
  - app_engineer_test.ts에 R1–R4, R7–R12, R20 테스트: 사람 요청·handoff로만, 읽기 범위 한정(담당 앱 자료·그 앱 read를 가진 context·SDK 계약·handoff 고정 근거), 맡지 않는 일 tool 없음, 앱 목적·SDK는 lophn 기획에서 시작, 인터뷰 질문 최대 12개·선택지 2~3개와 근거 있는 추천 하나, 가정 최대 3개·범위·동작·acceptance check 답이 없으면 ticket 보류, 8종 Markdown 문서와 순서·앞 결과의 읽은 고정 version 근거, 명세 흐름 최대 8단계·빈 결과·실패 별도·시각 배치·라이브러리 결정 없음, blueprint 원본 수정·문서 사본 없음, judgment·organizing 용도
  - E2E는 coding-agent slice의 new-app·change-app

### T47 lophn의 앱 일: 앱 기획, 화면 context·힌트, 앱 카드, 운영 보고

- 등급: 기본
- concern: lophn-agent/roles/lophn, lophn-agent/harness/tools, lophn-agent/harness/tool-judgment, lophn-agent/visuals
- 요구: lophn-agent/roles/lophn#R6, R9, R10, R12, R18, R23, lophn-agent/harness/tools#R18, lophn-agent/harness/tool-judgment#R12, lophn-agent/visuals#R4, R7
- 자리: packages/lophn-agent/roles/lophn/ (app-plan.ts: 앱 기획 문서 검사), packages/lophn-agent/harness/tools/ (bundles/app-context.ts), packages/lophn-agent/harness/prompt-assemble/ (turn context의 초점 앱 요약), packages/lophn-agent/visuals/ (앱 카드 참조·snapshot)
- 쓰는 contract: agent-context(apps#T16, contracts#T33), 앱 통로(apps#T10), blueprint 카드 화면(apps#T19), 실행 상태(apps#T9), SDK catalog(apps#T5), problem read(problems#T6), ticket read(coding-agent#T18)
- 내놓는 contract: 없음
- slice: apps
- 조사: docs/research/chat-visuals.md, docs/research/tool-registry-and-judgment.md, docs/research/presets-and-agent-config.md
- 선행: T20, T31, T33, T44, apps#T5, apps#T9, apps#T16, apps#T19, coding-agent#T18
- 완료:
  - app_plan_test.ts에 roles/lophn#R6, R9, R10, R12 테스트: 기존 앱 변경→문서로 남기기→기존 SDK→새 앱 순서와 기존 앱 목록·SDK 안내를 읽기 전 "재료 없음" 결론 차단(fake provider script), SDK 후보 순서와 확인한 version·입력·출력·조건, 앱 기획 검사(위험 첫 줄·무엇 200자·왜 500자·버린 세 방안·재사용·새로 만들 것·근거 주소, acceptance check 없음), 새 앱은 등록·채택 질문 뒤 준비된 AE에 근거 전달·담당 없으면 준비 안 됨
  - app_context_test.ts에 tools#R18, tool-judgment#R12, roles/lophn#R23 테스트: turn마다 초점 앱 요약 2 KiB, 상세는 선언된 read command, 되쓰기는 선언된 write command 그대로·허락 화면·자리·현재 화면 CAS 밖은 deny(approval 없음)·되돌릴 수 있는 주석은 묻지 않음
  - app_card_test.ts에 visuals#R4, R7 테스트: 카드 크기 선언 화면만, 앱·release가 바뀌면 계약 변경과 이용 불가를 구별해 표시(최신 release로 몰래 대체 없음), 카드·탭이 command 권한을 늘리지 않음, 문서 저장은 agent_context read 결과의 redaction snapshot과 고정 참조·없으면 이용 불가와 참조만
  - ops_report_test.ts에 roles/lophn#R18 테스트: 실행 상태(apps.runtime)·열린 문제·진행 ticket의 확인 사실 먼저, 근거 있는 해석 최대 5줄, 미확인 수치는 확인하지 못함(가짜 health 없음)
  - ask-app-hint·view-agent-visuals 앱 카드 E2E는 apps#T27

### T48 앱 revert

- 등급: 기본
- concern: lophn-agent/revert
- 요구: lophn-agent/revert#R10, R11
- 자리: packages/lophn-agent/revert/ (app-revert.ts, commands.ts: CheckpointRevert·FinishRevert), apps/core/lophn-agent.ts
- 쓰는 contract: 앱 통로(apps#T10), invocation(apps#T11), revert 계약(apps#T2), fixture(apps#T23)
- 내놓는 contract: CheckpointRevert, FinishRevert (contracts#T28)
- slice: apps
- 조사: docs/research/revert-and-checkpoints.md
- 선행: T34, T44, apps#T23
- 완료:
  - app_revert_test.ts에 R10, R11 테스트: 저장한 invocation·receipt·현재 revision 검증 뒤 원래 호출 역순 direct call, applying 단계와 step_key 조회로 중복 방지, 시작 전 실패는 blocked·시작 뒤 실패·충돌·응답 유실은 실제 복원·미시작·불명확으로 보존(전체 완료·전체 미실행으로 덮지 않음), 네트워크와 ledger를 한 transaction으로 주장하지 않음

## coding-agent

### T49 ticket tool과 coding 요청 정리

- 등급: 기본
- concern: lophn-agent/harness/tools, lophn-agent/roles/lophn, lophn-agent/roles/app-engineer
- 요구: lophn-agent/harness/tools#R9, lophn-agent/roles/lophn#R24, lophn-agent/roles/app-engineer#R16, R17, R22
- 자리: packages/lophn-agent/harness/tools/ (bundles/ticket.ts: `ticket.list`, `ticket.read`, `ticket.create`, `ticket.make_ready`), packages/lophn-agent/roles/lophn/, roles/app-engineer/ (ticket 준비 검사), docs/requirements/lophn-agent/harness/tools.md (R9에 make_ready 반영), docs/architecture/lophn-agent.md (ticket tool 목록)
- 쓰는 contract: ticket create·make_ready·list·read(coding-agent#T18, contracts#T41), `tx.call`
- 내놓는 contract: 없음
- slice: coding-agent
- 조사: docs/research/tool-registry-and-judgment.md
- 선행: T31, T46, coding-agent#T18, contracts#T41
- 완료:
  - ticket_tools_test.ts에 tools#R9, roles/lophn#R24, AE#R16, R17, R22 테스트: 생성·make_ready·읽기만(claim·연장·보고·[Start] 없음), 직접 요청·피드백도 ticket, 근거·acceptance check 부족은 `readiness: needs_confirmation`과 필요한 확인 목록(질문 Q4), 실행 준비(ready)는 채택 고정 설계·채택 질문·실행 가능한 acceptance check·흐름 하나 최대 6개 요구, 같은 원인 가설의 수리 묶음, 설정 변경만 필요한 일은 coding ticket 아님, ToolCall 성공과 ticket 생성이 한 transaction
  - lophn-agent/harness/tools#R9와 architecture의 ticket tool 목록을 make_ready에 맞게 고친다
  - E2E는 coding-agent slice의 manage-tickets·new-app

## problems

### T50 App Engineer 문제 해석과 release 검토

- 등급: 기본
- concern: lophn-agent/roles/app-engineer
- 요구: lophn-agent/roles/app-engineer#R13, R14, R15, R18, R19
- 자리: packages/lophn-agent/roles/app-engineer/ (interpretation.ts), packages/lophn-agent/harness/tools/ (`problem.set_interpretation`), packages/lophn-agent/revert/ (해석 참조 재연결)
- 쓰는 contract: problem read(problems#T6), verification(problems#T7), LinkProblemInterpretation(problems#T19, contracts#T40), releases(apps#T19), `tx.call`
- 내놓는 contract: 없음
- slice: problems
- 조사: docs/research/presets-and-agent-config.md
- 선행: T46, T49, problems#T19
- 완료:
  - interpretation_test.ts에 R13–R15, R18, R19 테스트: 관측 설계는 문제 정의·보존 동작만(집계·해결 확인·닫힘 없음), 원인 가설 최대 3개와 지지·반박 근거·부족 자료·다음 확인, 해석 문서 고정 version·절 참조만 설정(문제 상태 변경 없음, ToolCall과 한 transaction), release 검토의 의미상 어긋남과 후속 ticket 후보·새 결정은 먼저 질문, SDK 변경은 담당 앱 영향만
  - revert가 이전 해석 참조를 같은 LinkProblemInterpretation으로 다시 연결
  - E2E는 problems#T25(app-broken)

## operator

E2E는 T53이 쓴다.

### T51 Operator 주기 회차

- 등급: 기본
- concern: lophn-agent/scheduling
- 요구: lophn-agent/scheduling#R1, R2, R3, R4, R5, R6, R7
- 자리: packages/lophn-agent/scheduling/ (model.ts, commands.ts: ProcessAssignmentOccurrence, reads.ts, work.ts: 회차 시계), apps/core/lophn-agent.ts
- 쓰는 contract: base `dueTimes`(contracts#T31), command·read
- 내놓는 contract: ProcessAssignmentOccurrence, occurrence list, event AssignmentScheduleAdvanced (contracts#T26)
- slice: operator
- 조사: docs/research/scheduled-runs.md
- 선행: T10, T12, contracts#T31
- 완료:
  - `assignment_schedule_occurrences` 표
  - scheduling_test.ts에 R1–R7 테스트: Operator만·machine 배경 요청·model 호출 없음, base 계산 재사용(apps#T20과 같은 순수 함수), UTC first_at·양수 every_ms·기본 간격 없음·cron·timezone·달력 없음, 같은 회차 중복 접수 없음과 접수·skip 시각·사유, 끝나지 않은 run(accepted·running·waiting_user)이 있으면 그 회차를 `unfinished_run`으로 skip하고 last_due_at을 넘김(due로 남겨 다음 tick에 재시도하지 않음)·대기열 없음·skip도 ledger 행, 주기 회차를 진행 중 run에 steering으로 합치지 않고 run 출처로 사람 요청과 주기를 구별, 기동·절전·재개 뒤 최근 미처리 하나만(10회 놓치면 run 1개와 missed_count 9)·앞은 놓침 구간·수 기록, heartbeat처럼 model을 부르는 주기 없음, 시계는 주입, 책임·상태 변경은 last_due_at 유지·주기 승인 변경만 새 계산

### T52 Operator assignment 적용과 Context Engineer 초안

- 등급: 기본
- concern: lophn-agent/assignments, lophn-agent/presets, lophn-agent/harness/tool-judgment, lophn-agent/roles/context-engineer
- 요구: lophn-agent/assignments#R4, R5, R6, R7, R8, R15, lophn-agent/presets#R15, lophn-agent/harness/tool-judgment#R4, lophn-agent/roles/context-engineer#R11, R12, R13
- 자리: packages/lophn-agent/assignments/ (operator.ts, commands.ts: ApplyOperatorAssignment, reads.ts: outputs read), packages/lophn-agent/roles/context-engineer/ (Operator 초안)
- 쓰는 contract: approval(OperatorApprovalBundle, contracts#T22, contracts#T27), document version read(documents#T6)
- 내놓는 contract: ApplyOperatorAssignment, `/v1/assignments/outputs` read, `approval.submit_assignment`의 bundle 모양 (contracts#T27)
- slice: operator
- 조사: docs/research/presets-and-agent-config.md
- 선행: T9, T22, T43, T51, platform#T21, platform#T23
- 완료:
  - operator_assignment_test.ts에 assignments#R4–R8, R15, presets#R15, tool-judgment#R4 테스트: 사람이 승인한 고정 bundle만 적용·agent가 자기·다른 assignment를 적용하지 않음, preset 전체 판·범위·남길 문서·주기·승인 read의 전후·이유가 bundle에 묶이고 내용·이전 판이 다르면 거절, 실제 첫 version이 있는 기존 문서 최소 1개·원본 연결·보관·빈 예약·시리즈·동적 이름 거절, 이름·자리가 바뀌어도 같은 문서·자료 속 주소 추가 읽기 없음, 남길 문서 독점(멈춤도 유지)과 사람 직접 편집 허용·충돌 검사, 승인 outputs 새 version만 allow·선언 밖 쓰기는 deny, 주기·사람 요청 외 자동 접수 없음, 초안의 판단·근거·비교 기준·갱신 조건·책임 밖과 구성 전체 검토 자료
  - context_engineer_operator_test.ts에 CE#R11–R13 테스트: 후보 근거(최근 30일 watch 변화 4회·기준 자료 뒤처짐 14일·같은 수동 업무 4회) 중 하나와 단순 합계·수집만은 제안 안 함, 초안 항목 전부, 겹치는 Operator는 기존 판·남길 문서 변경 제안과 겹침 근거
  - documents#T32(Operator 출력 범위)가 이 작업을 선행으로 둔다

### T53 Operator 역할과 operator slice E2E

- 등급: 기본
- concern: lophn-agent/roles/operator
- 요구: lophn-agent/roles/operator#R1, R2, R3, R4, R5, R6, R7, R8, R9, R10
- 자리: packages/lophn-agent/roles/operator/ (prompt 자산, 역할 tool 선택, result.ts: 무변화 판정), e2e/flows/
- 쓰는 contract: document version read·판 확정(documents#T6, documents#T8), Operator 출력 범위(documents#T32), 앱 통로 read(apps#T10)
- 내놓는 contract: 없음
- slice: operator
- 조사: docs/research/presets-and-agent-config.md, docs/research/scheduled-runs.md
- 선행: T51, T52, documents#T32, shell#T54
- 완료:
  - operator_test.ts에 R1–R10 테스트: project 또는 app 하나·주기 또는 그 assignment 사람 요청으로만, 고정 preset 판, 겸하지 않는 일 tool 없음, preset context·승인 read만 읽고 자료 관점으로 변화 판단, 제품 상한 안 동작만, 결과의 사실·판단·불확실 구분·갱신 조건 미충족이면 새 version 없이 무변화, 승인 문서 새 version은 묻지 않음·자리·형식 변경·선언 밖 쓰기 없음, 사람 대화로 정의·범위·주기·tool 변경 없음·오래 남길 답은 승인 문서 새 version으로만, organizing 미선택은 같은 model·판 고정, 반복 실패와 대기 회차는 assignments·scheduling 규칙·handoff 없음
  - E2E(fake provider·fixture): set-up-operator, receive-operator-report, manage-operator

## operations

eval은 제품 프로세스가 아니라 개발 runner다(`deno task eval`). 네 역할이 모두 생긴 뒤에 둔다. operations slice E2E는 platform#T54가 돈다(update-lophn·work-offline의 agent 복구 갈래는 T27이 단위·통합으로 확인).

### T54 eval runner와 fixture

- 등급: 기본
- concern: lophn-agent/evaluation
- 요구: lophn-agent/evaluation#R1, R2, R3, R7, R8, R18, R21, R24
- 자리: packages/lophn-agent/evaluation/ (model.ts: EvalFixture·EvalSnapshot, runner.ts, work.ts), fixtures/eval/
- 쓰는 contract: lophn-agent 내부 contract, fake provider·clock, 가짜 MCP server
- 내놓는 contract: 없음(개발 명령 `deno task eval`)
- slice: operations
- 조사: docs/research/agent-evaluation.md, docs/research/fake-provider-testing.md
- 선행: T2, T41, T53
- 완료:
  - runner_test.ts에 R1–R3, R7, R8, R18, R21, R24 테스트: 사례 항목 사전 고정, 이름 중복·빠진 자료·기준·0 이하 반복·시간이면 model 없이 준비 오류, versioned fixture와 사람만 채택·제품 ledger 강제 없음, 시행마다 격리 폴더·DB 새 복사·운영 데이터·credential·MCP 없음(fresh HOME만으로 두지 않고 env·network를 통제), 실제 model credential은 사람이 eval 전용으로 명시 공급한 것만 runner 메모리에(질문 Q20), 사전 시행 계획과 protocol hash 고정, 가짜 MCP의 분류·판정은 실제 규칙·승인은 사례의 사람 답만, 시작 때 조건 고정과 결과와 함께 보존, 자동 주기 실행 없음, 600초 제한과 제품 timeout·runner 장애 구별(질문 Q21), 장애·crash 시행도 예정 분모에 남김

### T55 eval 판정, 결과, 공통 사례

- 등급: 기본
- concern: lophn-agent/evaluation
- 요구: lophn-agent/evaluation#R4, R5, R6, R9, R10, R11, R12, R13, R19, R20, R22, R23
- 자리: packages/lophn-agent/evaluation/ (judge.ts, report.ts, compare.ts), fixtures/eval/ (공통 함정 9가지·regression 다섯 사례·역할 capability 사례)
- 쓰는 contract: T54와 같다
- 내놓는 contract: 없음
- slice: operations
- 조사: docs/research/agent-evaluation.md
- 선행: T54
- 완료:
  - judge_test.ts·report_test.ts에 R4, R9–R13, R19, R20, R22, R23 테스트: regression·capability 구분과 최근 3번 매번 5/5일 때만 승격 후보, 최종 상태·금지 부작용 먼저·문장 일치·tool 순서는 기준 아님, 판정 순서와 품질 실패·평가 오류 분리, 네 결과 구분과 재실행으로 최초 결과를 지우지 않음(provider 500·503을 건너뛰어 통과로 두지 않음), 막힌 비교 쌍은 대표 수치를 null로, 3회·5회와 regression은 전부 통과, 오류·근거 부족·빠진 시행이 있으면 통과율 숫자 없음, 한 조건만 바꾼 전후 비교와 홀짝 순서, 비교용 수만 셈, 사람 지시만 실제 model·변경 전 영향 사례 재확인, 실패 사례 추가와 기대 낮추지 않음
  - fixtures/eval에 R5의 함정 9가지, R6의 regression 다섯 사례, 네 역할의 capability 사례(T31, T43, T46, T47, T53 판단 품질)

### T56 내용 판정 model 보정

- 등급: 기본
- concern: lophn-agent/evaluation
- 요구: lophn-agent/evaluation#R14, R15, R16, R17
- 자리: packages/lophn-agent/evaluation/ (content-judge.ts, calibration.ts)
- 쓰는 contract: T54와 같다
- 내놓는 contract: 없음
- slice: operations
- 조사: docs/research/agent-evaluation.md
- 선행: T55
- 완료:
  - content_judge_test.ts에 R14–R17 테스트: 이해하기 쉬움·근거 충실 두 축만과 축마다 질문·경계 사전 고정·결과와 근거 문서만 제공, 세 답만 받고 다른 답은 1회 재질문·두 번째도 잘못이면 판정 근거 부족, 평가 대상과 다른 model 명시 배정, 30개 중 24개 일치 전에는 통과 근거 아님, 10회마다 축별 최근 5개 재확인·2개 이상 다르면 축 제외와 재보정

### T57 trace 보존 정리 연결

- 등급: 기본
- concern: lophn-agent/observability
- 요구: lophn-agent/observability#R23, R24, R25, R26
- 자리: packages/lophn-agent/observability/ (retention.ts)
- 쓰는 contract: blob-store 보존 정리(platform#T44), read
- 내놓는 contract: 없음
- slice: operations
- 조사: docs/research/trace-and-observability.md
- 선행: T39, T40, platform#T44
- 완료:
  - retention_test.ts에 R23–R26 테스트: 큰 자료만 오래된 것부터 정리 대상·변경 기록·결정·확정 결과는 보존(용량 숫자와 실제 삭제는 platform), 진행 run·미반영 입력·답·approval 대기·revert 근거는 넘기지 않음(쓰기 때 정리 후보를 고르는 쪽에서 제외), 사라진 본문의 derived index·cache 제거와 부재 표시 요청(한 transaction 약속 없음), 문서·release 삭제로 번지지 않고 변경 주체 최소 식별 유지

## 요구 덮기

작업의 `요구:` 줄로 센다. 요구 번호가 빈 곳(conversation R15, observability R13·R15, prompt-assemble R29)은 requirements에 없는 번호다. provider R11(Claude OAuth)은 D31에 따라 T3 PR에서 지우므로 그 뒤 provider는 29개다.

| concern | 요구 수 | 덮은 수 |
|---|---|---|
| lophn-agent/assignments | 17 | 17 |
| lophn-agent/conversation | 16 | 16 |
| lophn-agent/evaluation | 24 | 24 |
| lophn-agent/extensions | 31 | 31 |
| lophn-agent/handoff | 9 | 9 |
| lophn-agent/harness/model | 20 | 20 |
| lophn-agent/harness/prompt-assemble | 29 | 29 |
| lophn-agent/harness/provider | 30 | 30 |
| lophn-agent/harness/run-loop | 25 | 25 |
| lophn-agent/harness/safety | 9 | 9 |
| lophn-agent/harness/tool-judgment | 12 | 12 |
| lophn-agent/harness/tools | 20 | 20 |
| lophn-agent/harness/usage | 11 | 11 |
| lophn-agent/harness/waiting-and-recovery | 12 | 12 |
| lophn-agent/instructions | 8 | 8 |
| lophn-agent/observability | 24 | 24 |
| lophn-agent/presets | 16 | 16 |
| lophn-agent/questions | 16 | 16 |
| lophn-agent/revert | 11 | 11 |
| lophn-agent/roles/app-engineer | 22 | 22 |
| lophn-agent/roles/common | 13 | 13 |
| lophn-agent/roles/context-engineer | 14 | 14 |
| lophn-agent/roles/lophn | 24 | 24 |
| lophn-agent/roles/operator | 10 | 10 |
| lophn-agent/scheduling | 7 | 7 |
| lophn-agent/visuals | 7 | 7 |
| 합계 | 437 | 437 |

## 질문

상태는 셋이다. **사람 결정 대기**는 lead가 사람에게 올렸고 추천안으로 계획을 썼다. **추천으로 진행**은 요구가 정하지 않은 빈 곳을 추천안으로 구현하고, 구현 PR에서 그 requirements를 고치며 open-issues에 남긴다. **정함**은 계획 중에 lead나 다른 팀과 정한 것이다.

- **Q1 provider 구독 OAuth** (정함, 사람 D31). Anthropic은 API key만 쓰고 Claude OAuth는 첫 판에서 뺀다(Anthropic이 제3자 앱의 Claude.ai login을 금지한다). ChatGPT는 공식 Sign in with ChatGPT(실제 앱 이름의 dynamic client 등록, loopback callback, 공개 Responses API, backend-api 금지), xAI는 SuperGrok OAuth(device code)를 연다. T3 PR이 provider#R1·R11(삭제)·R12·R16·R27과 flow connect-provider를 고치고 T16이 두 경로를 구현한다. 두 경로 모두 실제 확인 전까지 꺼 둔다. 근거: docs/research/provider-auth.md.
- **Q2 context slice 순서** (정함, lead). context slice 선행에 agent를 더했다. organize-documents 2~3단계와 find-documents 5~6단계, project-workspace 8단계는 agent slice E2E(T41), view-agent-visuals 앱 카드와 approve-action 앱 confirm 단계는 apps#T27이 돈다.
- **Q3 주기 시점 계산 공용화** (정함, contracts). scheduling#R2의 앱 scheduler 재사용은 최상위 사이 import 금지와 부딪혀 `dueTimes`를 packages/base로 옮겼다(contracts#T31). 놓친 회차를 건너뛸지 처리할지는 각자 정책이다.
- **Q4 ticket readiness** (정함, lead). ticket에 `readiness: needs_confirmation | ready`를 두고 needs_confirmation은 claim·[Start] 대상에서 뺀다(coding-agent#T18). 그래서 agent tool에 `ticket.make_ready`가 생긴다. T49에서 tools#R9("읽기·생성만")와 architecture의 ticket tool 목록을 고친다.
- **Q5 문맥 초과를 알리지 않는 provider** (추천으로 진행). z.ai·Ollama·일부 model은 문맥 초과를 표준 응답으로 알리지 않는다. 추천: 확정할 수 없으면 원인 불명으로 분류하고 인증 실패로 추정하지 않는다. 영향: T15, provider#R19, R23.
- **Q6 stream idle timeout** (추천으로 진행). 요구에 숫자가 없다. 추천: 별도 timeout을 두지 않고 run 무진행 300000ms와 전체 1800000ms가 끊는다. 끊긴 call은 partial 또는 uncertain이다. 영향: T13, T26, run-loop#R20, R21.
- **Q7 opaque 추론 상태 유실** (추천으로 진행). 조사한 프로젝트는 모두 signature·encrypted reasoning을 transcript에 영속하지만 provider#R25는 run 메모리만 허용한다. 재시작·compaction 뒤 상태가 없으면 protocol별로 state-free 계속이 검증된 경우만 잇고 아니면 configuration_unavailable로 끝낸다. provider·model이 바뀌면 버린다. 영향: T13, T14, T27.
- **Q8 현재 보기 상태 통로** (정함, shell·platform). shell main이 core 메모리 relay에 publish하고 runtime이 `read {session}`으로 읽는다(platform#T57, shell#T26, contracts#T25). 영향: T20.
- **Q9 자료 포장 세부** (추천으로 진행). safety#R7에 Unicode 정규화 순서와 제어 표식 목록의 소유가 없다. 추천: 전각·zero-width·homoglyph를 접은 뒤 물결표를 치환하고, 제어 표식 목록은 provider adapter가 선언해 safety가 치환한다. safety#R8: 자료가 하나라도 섞인 summary는 전체를 자료로 분류하고 분류가 없으면 자료다. 영향: T17, T28. 근거: docs/research/prompt-injection-safety.md.
- **Q10 보호 입력만으로 목표를 넘는 compaction** (추천으로 진행). 보호 입력만 50%를 넘으면 목표에 닿을 수 없다. 추천: 사전 검사로 summary 호출 0회, 원문이 한계 안이면 진행·밖이면 context_limit. 보호 원문을 몰래 줄이지 않는다. 영향: T28, prompt-assemble#R10, R11, R16, R17.
- **Q11 cache marker 수** (추천으로 진행). 논리 경계 3곳을 Anthropic wire marker로 옮기면 tools와 system이 나뉘어 4개가 될 수 있다. 추천: tools를 포함하는 system 경계로 매핑해 wire marker 3개 이하. 영향: T13, T19, prompt-assemble#R8.
- **Q12 compaction 세부 상한** (추천으로 진행). provider 문맥 초과 응답 뒤 재조립 재시도 횟수, merge tree의 단계별 상한, 이어가기 401 token 재축소 횟수, 추론이 output 상한을 쓰는 경우가 요구에 없다. 추천: 문맥 초과 뒤 재시도 최대 1회(같은 구간 반복 없음), merge tree 단계마다 입력은 organizing 예산 절반·출력은 min(10%, 4000), 이어가기 재축소 최대 2회, 출력 상한은 본문과 추론을 나눠 기록. 영향: T28, prompt-assemble#R9, R13, R15–R17, R20, R22.
- **Q13 MCP HTTP redirect** (추천으로 진행). extensions#R15는 다른 host redirect에 인증만 빼라고 한다. tool 입력이 민감하니 다른 origin(host·scheme·port)으로의 redirect는 거절을 추천한다. 영향: T36.
- **Q14 MCP 목록 크기 상한** (추천으로 진행). 30초 기한만으로는 빠른 paging의 메모리 폭증을 막지 못한다. 추천: page 100개, tool 2048개, 누적 10 MiB, schema 깊이 32에서 그 server 목록 전체 거절. 영향: T36, extensions#R22.
- **Q15 MCP 이름 충돌 hash** (추천으로 진행). extensions#R23에 직렬화와 충돌 묶음 규칙이 없다. 추천: UTF-8 `JSON.stringify([server, tool])`의 SHA-256 앞 8자를 충돌 묶음 전체에 붙여 등록 순서와 무관하게 한다. 영향: T37.
- **Q16 MCP 목록 갱신 중 호출** (추천으로 진행). list_changed 알림에는 삭제 목록이 없다. 추천: 재조회가 끝날 때까지 그 server의 tool 호출을 막고, 재조회 실패면 옛 정의를 호출 가능으로 두지 않는다. 영향: T37, extensions#R24.
- **Q17 끊긴 run의 실패 집계** (추천으로 진행). assignments#R10·R11은 시작했지만 정상 종료 기록 없이 프로세스가 죽어 복구도 못 한 run을 실패로 셀지 정하지 않았다. 추천: 시작한 뒤 확인된 종료 없이 failed로 끝난 run은 실패로 세고, 시작 전에 끝난 run은 세지 않는다. 그렇지 않으면 연속 실패 수가 재시작 횟수에 따라 달라진다. 영향: T9.
- **Q18 추정 비용 계산 세부** (추천으로 진행). model#R7·usage#R5·R8은 문맥 크기 구간 가격의 기준, 별도 추론 요율의 과금 방식, 보고 0인 구간의 요율 누락을 정하지 않았다. 추천: 구간 기준은 그 call의 새 입력+cache 읽기·쓰기 합(전송 전 예산 검사와 별개), 별도 추론 요율이 있으면 출력에서 추론을 빼고 각각 곱함(이중 과금 없음), 보고 0인 구간은 요율이 없어도 건너뛰고 null인 구간은 모름. 영향: T6. 근거: docs/research/model-catalog-and-usage.md.
- **Q19 catalog 확인 시각** (추천으로 진행). model#R4·R5는 304·잘못된 응답·timeout 때 어떤 시각을 남길지 정하지 않았다. 추천: 정상 304는 확인 시각만 갱신, 잘못된 200·timeout은 마지막 성공 시각 유지와 실패 표시, 전체 거절로 오래 갱신되지 않으면 사람에게 마지막 정상본 시각을 보인다. 영향: T4.
- **Q20 eval의 실제 model credential** (추천으로 진행). evaluation#R7·R18·R21·R22는 운영 credential을 읽지 말라고 하지만 실제 model과 판정 model을 부르는 credential 경로가 없다. 추천: 사람이 eval 실행 때 명시로 공급한 eval 전용 credential을 runner 메모리에만 두고 제품 keychain·다른 CLI 인증을 찾지 않는다. 영향: T54.
- **Q21 eval 600초 초과 결과** (추천으로 진행). evaluation#R24·R10·R11은 runner가 600초에 제품 run을 멈췄을 때 결과 분류를 정하지 않았다. 추천: 제품이 미완료로 관측되면 기대 불충족(product_timeout), runner가 관측을 잃으면 평가 오류(runner_interrupted). 영향: T54, T55.
- **Q22 model 응답 녹화** (추천으로 진행). stack.md의 녹화 응답 정책에 녹화 방법과 secret 검사가 없다. 추천: 자동 녹화 없음, 별도 record 명령만 사람 지시와 `LOPHN_LIVE_PROVIDER=1`로, 합성 최소 입력·redaction·scan·사람 diff 검토 뒤 채택. 영향: T2. 근거: docs/research/fake-provider-testing.md.
- **Q23 질문 답의 secret 판정 실패** (추천으로 진행). questions#R11은 secret 판정기가 동작하지 않거나 사람이 안전 입력을 취소했을 때를 정하지 않았다. 추천: 일반 저장 전에 fail closed, 그 답을 answered로 두지 않고 질문은 미답으로 남긴다. 영향: T24. 근거: docs/research/questions-and-hitl.md.
- **Q24 handoff 재전송과 현재 권한** (추천으로 진행). handoff#R9는 재전송 replay와 수신 assignment가 회수된 뒤의 상세 읽기를 구별하지 않았다. 추천: replay는 저장된 결과만 돌려주고 새 입력·run을 만들지 않으며, 상세 조회는 그때의 현재 권한으로 다시 검사한다. 영향: T32.
- **Q25 handoff 설명의 우회 복사** (추천으로 진행). handoff#R3·R4는 무엇·왜 문자열에 대화 원문·secret을 붙여 넘기는 경우를 막는 방법이 없다. 추천: 구조화한 출처 검증과 기존 safety 포장·redaction을 적용하고, byte 상한만으로 의미상 복사를 막는다고 하지 않는다. 영향: T32. 근거: docs/research/handoff-and-delegation.md.
- **Q26 fake provider 개발 entry와 dev 조립** (정함, lead·contracts). T2 완료에 `deno task dev` 조립을 요구하면서 contracts#T9가 T2를 선행으로 두어 순환한다. T2는 `tools/fake-provider/main.ts`의 ready `{url}`·HTTP script/log·child smoke를 완료하고, contracts#T9는 그 entry를 함께 띄워 주소를 `LOPHN_FAKE_PROVIDER_URL`로 core에 넘긴다. root task와 dev launcher는 contracts 팀만 고친다. 실제 dev 동작 범위는 줄이지 않는다.
- **Q27 동봉 안내 자산과 route·설치 조립** (정함, lead). T30은 영어 guide 자산, 조립에서 받은 제품 판·실제 UTF-8 bytes·hash·relative files의 고정, BundledGuide contract 호환을 완료한다. `/v1/guides/*` route는 documents#T29, 설치 manifest/files 조립은 platform#T48 소유이며 실제 HTTP·설치 E2E는 그 작업들이 끝난 뒤 그쪽 E2E에서 확인한다. 개별 settings registry가 main에 없으면 공개 definition 입력의 wording key를 그대로 투영하며 synthetic contract 테스트를 registry 실물 검증으로 표시하지 않는다. hash는 guide마다 primary Markdown 하나의 raw UTF-8 bytes SHA-256을 content_hash와 blob_hash에 함께 쓰는 추천으로 진행한다(platform이 현재 충돌 없음 확인, T48 구현 정본은 아직 없음). BOM·줄바꿈·Unicode normalization을 하지 않고 host가 매 요청 실제 packaged bytes와 manifest membership을 확인한다. 실제 제품 안내·읽기 범위는 줄이지 않는다.
- **Q28 catalog read 등록 자리** (추천으로 진행). T4의 read 정의는 model leaf(packages/lophn-agent/harness/model)의 검증 helper를 쓰는데, platform/responsiveness#R1의 core import tripwire가 core module graph에서 packages/lophn-agent 전체를 막아 apps/core/lophn-agent.ts에서 정의를 붙일 수 없다. 추천: read 등록은 T5의 reads.ts 자리에서 reader worker 등록과 함께 leaf를 끼우고, core 정적 graph는 leaf import이 없다. 영향: T4, T5.
