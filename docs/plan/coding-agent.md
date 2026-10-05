---
type: plan
concerns: [coding-agent]
---

# coding-agent 구현 계획

coding-agent 최상위의 작업 전부다. 사람이 쓰던 coding agent(Claude Code, Codex,
OpenCode, Gemini CLI, Hermes, pi, OpenClaw)를 감지해 연결하고(credential 자동
발급·keychain, 선택 target 설치와 receipt), MCP(stdio)·CLI·skill로 lophn을 열고,
ticket을 MCP claim→작업→보고로 맡기며, 사람이 [Start]를 누르면 project 터미널
탭에서 TUI를 첫 prompt와 함께 연다. 수리라면 repair context로 근거를 넘기고
machine이 acceptance check를 비교한다.

정본: [intent](../intent/coding-agent.md),
[requirements](../requirements/coding-agent/),
[domain model](../domain-model/coding-agent/),
[architecture](../architecture/coding-agent.md), flow
[connect-coding-agent](../flows/connect-coding-agent.md),
[start-coding-agent](../flows/start-coding-agent.md),
[manage-coding-access](../flows/manage-coding-access.md),
[manage-tickets](../flows/manage-tickets.md). 지나는 flow:
find-documents(6단계), new-app, change-app, app-broken, verify-app-repair,
work-offline(2단계).

## 순서와 까닭

coding-agent slice는 apps 뒤지만 앞 slice가 coding agent 통로를 먼저 쓴다.
그래서 작업을 여러 slice에 나눈다.

| slice        | coding-agent 작업                                                                                                                                                                                                                    | 그 slice에서 쓰는 쪽                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| documents    | T9–T15: connection core, credential loader·core client, MCP·CLI 뼈대, 문서 읽기·저장·format·series tool, 범위 검사                                                                                                                   | find-documents 6단계(coding agent가 MCP·CLI로 목차·검색·section을 읽는다)                                        |
| agent        | T16: question·approval 읽기 tool                                                                                                                                                                                                     | answer-question, approve-action의 coding agent 쪽 대기 표시                                                      |
| context      | T17: context 읽기·제안 tool                                                                                                                                                                                                          | build-context, define-terms의 coding agent 읽기                                                                  |
| apps         | T18–T23: ticket core(readiness 포함)·claim, ticket·app·SDK·blueprint 유래 tool, fake coding agent fixture                                                                                                                            | new-app·change-app(App Engineer의 ticket 생성, release 준비의 claim 검사 apps/releases#R6, fixture coding agent) |
| coding-agent | T24–T41: 완료 보고·취소·checker·ticket 화면 read, harness catalog·감지·설치·adapter·doctor, skill·template·summary hook, 연결 생성·회수, daemon command, LaunchPlan·관측, slice E2E(shell#T49 [Start] host, #T50 연결·Tasks 화면 뒤) | connect-coding-agent, manage-coding-access, start-coding-agent, manage-tickets, new-app 전체                     |
| problems     | T42–T47: repair context, problem tool, repair ticket 검사, 사람 화면의 repair ticket 준비                                                                                                                                            | report-app-problem, app-broken, verify-app-repair                                                                |
| operations   | T48: 오프라인 MCP 시작                                                                                                                                                                                                               | work-offline 2단계                                                                                               |

조사(T1–T8)는 계획 단계에서 끝냈다. 구현 작업은 `조사:`로 그 문서를 가리킨다.

## 자리

| concern                     | 자리                                                        | architecture 모듈                                                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| coding-agent/connection     | `packages/coding-agent/connection/`                         | `model.ts`, `commands.ts`, `reads.ts`(→ `connection/read`), `credential/`(trusted loader adapter), `client/`(daemon 찾기·core HTTP client; MCP·CLI 공통)                                    |
| coding-agent/harnesses      | `packages/coding-agent/harnesses/`                          | `catalog/`(일곱 제품 HarnessDefinition), `detection.ts`, `integration/`(plan·install·update·remove·receipt·journal), `adapters/`(JSON·TOML·YAML merge, 제품별 target), `loading.ts`(doctor) |
| coding-agent/sessions       | `packages/coding-agent/sessions/`                           | `plan.ts`, `prompt.ts`, `observe/`(harness별 evidence normalizer), `model.ts`                                                                                                               |
| coding-agent/mcp-server     | `packages/coding-agent/mcp-server/`, 실행 entry `apps/mcp/` | `stdio.ts`, `server.ts`, `registry.ts`, `result.ts`, `tools/`(tool마다 파일)                                                                                                                |
| coding-agent/cli            | `packages/coding-agent/cli/`, 실행 entry `apps/cli/`        | `parser.ts`, `output.ts`, `help.ts`, `commands/`(group마다 파일)                                                                                                                            |
| coding-agent/guides         | `packages/coding-agent/guides/`                             | `skills/<name>/SKILL.md`(배포 원본), `skill-check.ts`, `managed-files.ts`, `summary.ts`, `hook.ts`, `templates/`(안내 파일 조각)                                                            |
| coding-agent/repair-context | `packages/coding-agent/repair-context/`                     | `assemble.ts`, `select.ts`, `budget.ts`, `cursor.ts`                                                                                                                                        |
| coding-agent/tickets        | `packages/coding-agent/tickets/`                            | `model.ts`, `commands.ts`, `reads.ts`, `checker/`(worker)                                                                                                                                   |

- worker kind `coding-agent`(`apps/worker/`): session summary·repair context
  조립, ticket checker. core가 감독한다.
- core 등록(command·read·event type·ledger schema)은 skeleton이 정한 등록 자리를
  따르고 `apps/core/` 안의 coding-agent 등록 줄만 고친다.
- contract는 contracts 팀이 `packages/contracts/coding-agent/`에 먼저
  둔다(contracts#T47 C-연결(documents), #T48 C-통로의 공통 출력과 문서
  tool(documents), #T49 question·approval·context tool(agent), #T41
  C-ticket(apps), #T50 앱·SDK·ticket tool과 bundle 제외 상수(apps), #T44
  C-수리자료와 problem tool(problems), #T42 C-session·C-harness(coding-agent),
  #T43 나머지 CLI·skill 이름·hook 상한(coding-agent)). 이 문서의 이름:
  - **C-연결**: `coding_agent_connections` RPC(list·show·create·revoke), event,
    ConnectionScope, platform 인증이 매 요청 부르는 principal→connection
    read(state·scope).
  - **C-ticket**: `tickets`
    RPC(create·make_ready·list·show·checks·claim·renew_claim·release_claim·report_completion·expire_claim·record_checks·cancel),
    event, read `getTicket`·`checkTicketClaim`, TicketTestLink 모양(problems와
    공유).
  - **C-통로**: MCP tool 15개의 이름·op·입력 schema, blueprint 유래 tool 이름
    규칙, CLI command 이름·입력, 결과 envelope `{summary, data, next}`, 오류
    `{code, message, details}`, CLI exit code, release bundle에서 뺄 개발 도구
    경로 목록.
  - **C-session**: CodingAgentLaunchPlan, `lophn session plan` 입출력, terminal
    host 관측 socket의 NDJSON, HarnessSessionObservation,
    CodingAgentSessionSummary와 `/v1/coding_agent_sessions/summary`.
  - **C-harness**: `lophn harness …`·`lophn doctor`의 JSON(HarnessDetection,
    HarnessIntegrationObservation, resource별 결과). shell 연결 화면이 쓴다.
  - **C-수리자료**: `/v1/repair_context/summary|bundle|more`,
    RepairContext·RepairEvidenceRead.
- shell main은 `packages/coding-agent`를 import하지 않는다. LaunchPlan과 harness
  감지·설치는 shell main이 `lophn` CLI를 자식으로 불러 C-session·C-harness
  JSON으로 받는다(shell 팀과 합의).

## 조사

### T1 조사: MCP server 모양과 harness의 MCP client

- 등급: 기본
- concern: coding-agent/mcp-server
- 요구: coding-agent/mcp-server#R1–R7, R34, R35
- 자리: docs/research/coding-agent-mcp-server.md
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: documents
- 선행: 없음
- 완료: Codex, Gemini CLI, OpenCode의 MCP client 코드와 Claude Code 문서, GitHub
  MCP server·Sentry MCP·Paseo의 server 쪽 코드로 spawn·tool 이름
  상한·structuredContent·isError·list_changed·toolsets를 비교한 문서
- 상태: 완료 (계획 단계, commit은 lead)

### T2 조사: agent용 CLI 모양

- 등급: 기본
- concern: coding-agent/cli
- 요구: coding-agent/cli#R1–R5, R9, R39
- 자리: docs/research/coding-agent-cli.md
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: documents
- 선행: 없음
- 완료: gh, beads(bd), Orca CLI, Paseo CLI, Codex(`exec --json`, `mcp`), Gemini
  CLI(`mcp`)의 JSON 출력·exit code·입력·help·설정 조각 출력을 코드로 비교한 문서
- 상태: 완료 (계획 단계, commit은 lead)

### T3 조사: connection credential 보관과 전달

- 등급: 기본
- concern: coding-agent/connection
- 요구: coding-agent/connection#R3, R9, R15, R17
- 자리: docs/research/coding-agent-connection-credential.md
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: documents
- 선행: 없음
- 완료: Codex keyring store, Gemini CLI token storage, gh keyring, Paseo·Orca의
  token 전달, MCP clientInfo.name과 제품 환경 변수를 코드로 비교한 문서
- 상태: 완료 (계획 단계, commit은 lead)

### T4 조사: ticket claim과 일 배정

- 등급: 기본
- concern: coding-agent/tickets
- 요구: coding-agent/tickets#R11–R20
- 자리: docs/research/coding-agent-ticket-claim.md
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: apps
- 선행: 없음
- 완료: Orca coordinator, beads, vibe-kanban, claude-task-master(, Paseo)의 일
  단위·claim 원자성·lease·완료 보고·검사를 코드로 비교한 문서
- 상태: 완료 (계획 단계, commit은 lead)

### T5 조사: harness 감지와 MCP·skill·지침·hook 설치

- 등급: 기본
- concern: coding-agent/harnesses
- 요구: coding-agent/harnesses#R1–R12
- 자리: docs/research/coding-agent-harness-integration.md(기존 Orca·Paseo 조사에
  harness 소스 근거 절을 더함)
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: coding-agent
- 선행: 없음
- 완료: Codex·OpenCode·Gemini CLI·Hermes·pi·OpenClaw 소스로 설정 형식·깨진 설정
  동작·hook 자리·`mcp add` 형식을 확인한 절, Orca 새 revision의 바뀐 점
- 상태: 완료 (계획 단계, commit은 lead)

### T6 조사: TUI launch·첫 prompt·session 관측

- 등급: 기본
- concern: coding-agent/sessions
- 요구: coding-agent/sessions#R1–R10
- 자리: docs/research/coding-agent-session-launch.md
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: coding-agent
- 선행: 없음
- 완료: Orca·Paseo·Codex·Gemini CLI·OpenCode·vibe-kanban 코드와 Claude Code
  hooks 문서로 prompt 전달 mode·readiness·hook payload·전달 통로·resume를 비교한
  문서
- 상태: 완료 (계획 단계, commit은 lead)

### T7 조사: skill·앱 안내·시작 summary hook

- 등급: 기본
- concern: coding-agent/guides
- 요구: coding-agent/guides#R1–R5, R13, R15, R16, R23–R25
- 자리: docs/research/coding-agent-skills-and-guides.md
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: coding-agent
- 선행: 없음
- 완료: Agent Skills 형식과 Codex·Gemini CLI·OpenCode·pi·Hermes loader,
  AGENTS.md 발견 규칙, Claude Code SessionStart 출력 계약, Orca·Paseo의 managed
  파일을 비교한 문서
- 상태: 완료 (계획 단계, commit은 lead)

### T8 조사: repair context 묶음

- 등급: 기본
- concern: coding-agent/repair-context
- 요구: coding-agent/repair-context#R1–R20
- 자리: docs/research/coding-agent-repair-context.md
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: problems
- 선행: 없음
- 완료: Sentry MCP의 issue 근거 조립, Codex·Gemini CLI·OpenCode의 출력 잘림,
  GitHub MCP server·Sentry의 cursor를 코드로 비교한 문서
- 상태: 완료 (계획 단계, commit은 lead)

## documents slice

### T9 connection core: 표·생성·회수·read·principal 해석

- 상태: 완료 (#86)
- 등급: 기본
- concern: coding-agent/connection
- 요구: coding-agent/connection#R2, R3, R4, R5, R7, R8
- 자리: packages/coding-agent/connection/ (model.ts, commands.ts, reads.ts,
  mod.ts), `coding_agent_connections` ledger schema, apps/core의 coding-agent
  등록 줄
- 쓰는 contract: platform command·read·event, 인증(principal
  `coding_agent:<id>`, 신뢰 경계가 준비한 token 검증 hash), confirmation
  window(회수 근거)
- 내놓는 contract: C-연결
- slice: documents
- 조사: docs/research/coding-agent-connection-credential.md
- 선행: contracts#T47, contracts#T6, contracts#T20, platform#T2, platform#T3,
  platform#T4, platform#T5
- 완료:
  - `model_test.ts`: ConnectionScope(all이면 app null, app이면 필수), principal
    = `coding_agent:<id>`, state active→revoked만, 재활성화 없음(R2, R8)
  - `commands_test.ts`(메모리 SQLite): create는 user actor만·확인 창 근거
    없이·준비된 hash만 받고 원문 입력 필드가 없다; 없는 앱·공백
    label·coding_agent actor의 발급은 거절(R2, R3)
  - revoke는 user + confirmation window 근거 + base_revision; revoked 직후
    principal read가 revoked를 돌려 인증이 새 요청을 거절한다(R2, R8)
  - scope 정책 함수: app scope가 허용하는 concern(그 앱의 문서·앱
    정보·문제·ticket, 공통 format·SDK·템플릿)과 금지 동작 목록(approval 결정,
    grant, secret 값, backup, 문제 닫힘·무시·사람 확인, connection
    발급·회수·확대, project·tracking·context·term·assignment 변경, ticket 목표
    변경·확인 판정, test result 작성)을 내놓고 테스트한다(R5, R7)
  - 앱 등록 허용은 scope all만(R4)
  - label이 같은 두 connection이 서로 다른 principal·기록으로 구별되고,
    label·작업 폴더를 바꿔도 scope가 넓어지지 않는다(R3)
  - event payload와 read 결과에 token·hash가 없다

### T10 daemon 찾기·대상 앱·credential provider·core client (MCP·CLI 공통)

- 상태: 완료 (#139)
- 등급: 기본
- concern: coding-agent/connection
- 요구: coding-agent/connection#R9, R11, R15
- 자리: packages/coding-agent/connection/client/,
  packages/coding-agent/connection/credential/(provider interface; 실제 keychain
  loader는 T36)
- 쓰는 contract: C-연결, platform API transport·envelope·오류·client
- 내놓는 contract: 없음(coding-agent 안에서 mod.ts로 공유)
- slice: documents
- 조사: docs/research/coding-agent-connection-credential.md,
  docs/research/coding-agent-cli.md
- 선행: T9, contracts#T5, contracts#T47, contracts#T48, platform#T9
- 완료:
  - daemon 주소 순서 `--daemon-url` → `LOPHN_DAEMON_URL` → 현재 daemon 연결 정보
    → 설치 설정 → `http://127.0.0.1:7431`, loopback 아닌 주소 거절(R15)
  - 대상 앱 순서 `--app` → `LOPHN_APP` → 현재 작업 폴더의 blueprint, 찾은 앱을
    connection scope와 다시 비교해 범위 밖이면 거절(R11)
  - connection 참조(`--connection`, `LOPHN_CONNECTION`)만 받는 credential
    provider interface. token 인자·env·파일 입력이 없다. 테스트는 provider를
    주입하고, 주입 provider는 실행 entry의 flag·env로 고를 수 없다
  - 인증 실패 뒤 재발급·user 변경 요청을 보내지 않고 재연결 안내를 돌려준다(R9)
  - core client: `POST /v1/<resource>/<method>`, Authorization, idempotency key
    전달, 쓰기 응답 유실을 `effect_unknown`과 원래 key·대상 read 안내로 돌려준다
  - core 통합 테스트는 `apps/core/testing/`(platform#T9)의 테스트 credential로
    coding_agent actor·scope를 만들어 붙는다. 이 입구는 실제 entry에 없다(실제
    credential 경로는 T36)

### T11 MCP stdio server 뼈대

- 상태: 완료 (#163)
- 후속 schema token 재측정: 진행 (#167) — 남은 것: 2,000 token 목표 미도달("##
  질문" Q20의 다음 수단)
- 등급: 기본
- concern: coding-agent/mcp-server, coding-agent/connection
- 요구: coding-agent/mcp-server#R1, R2, R3, R4, R5, R6, R7;
  coding-agent/connection#R3, R16
- 자리: packages/coding-agent/mcp-server/ (stdio.ts, server.ts, registry.ts,
  result.ts, mod.ts), apps/mcp/main.ts
- 쓰는 contract: C-통로, T10의 client·credential provider
- 내놓는 contract: C-통로의 MCP 쪽(tool 목록과 schema, 결과 표현)
- slice: documents
- 조사: docs/research/coding-agent-mcp-server.md
- 선행: T10, contracts#T48
- 완료:
  - stdout에는 JSON-RPC만, stderr에는 진단만. 공백이 든 설치·작업 위치에서
    initialize·tools/list가 된다(R1)
  - `--cached-only`, `-A`·`--allow-run`·`--allow-write`·`--allow-ffi` 없는 실행
    argv 생성 함수와 그 argv로 오프라인 시작 테스트(R1, connection#R16)
  - toolsets: 기본 core만, `--toolsets core,app`과 `LOPHN_MCP_TOOLSETS=core,app`
    각각으로 app을 켜고 `ops`·`catalog`·`all` 별칭은 거절. 보이는 tool도 API가
    다시 검사한다(R3)
  - 결과는 `structuredContent`와 같은 뜻의 JSON text content,
    `{summary, data, next}`. 본문을 summary에 중복하지 않는다(R5)
  - 틀린 op·필수 값·cursor·폐지 별칭은 실행 전 `isError` + 이유·다음 read(R6).
    없는 tool·params는 -32602, parse -32700, request -32600, method -32601. 효과
    불명은 `isError`와 effect_unknown(R7)
  - registry의 op마다 core RPC 하나로만 routing하고 passthrough가 없다(R2)
  - `readOnlyHint`는 모든 op가 읽기인 tool에만(어느 client도 이것으로 승인을
    건너뛰지 않으니 권한 경계로 쓰지 않는다). discovery schema(minified UTF-8
    JSON)의 token 수를 고정 tokenizer(js-tiktoken 1.0.21의 cl100k_base, Sentry
    MCP와 같은 기준; stack.md에 이유와 함께 적는다)로 재는 배포 테스트를 두고
    2,000 token 목표를 출력한다(R4)
  - token 재측정 후속(coding-agent/mcp-server#R4): 고정 tokenizer를 js-tiktoken
    1.0.21(cl100k_base)로 바꿨고 discovery schema에서 description
    중복·pattern·range 제약·$schema·default를 걷어내고 op·kind union을 GitHub
    MCP처럼 discriminator enum + 합친 properties로 폈다. 전(원본 toJSONSchema)
    12,268 token / 43,393 bytes → 후 4,704 token / 19,488 bytes(전체 toolset),
    core 3,273 token. 2,000 token 목표에 못 미치는 남은 차이와 다음 수단은 "##
    질문"에 있다. 펴기는 op·kind union의 member마다 있던 required를 걷어낸다
    (discriminator만 required로 남긴다. member별 임의 필드는 그대로 임의다)
  - core에 닿지 않아도 initialize·tools/list가 답하고, 기동부터 tools/list
    응답까지 2,000ms 안(Codex·OpenCode 기동 timeout 30초보다 넉넉히)을 측정
    테스트로 둔다. Codex는 env를 whitelist하므로 connection·toolsets는
    argv(`--connection`, `--toolsets`)로 받는다(R1)
  - structuredContent와 text를 둘 다 보낸다: Codex는 structured만,
    Gemini·OpenCode는 text만 model에 넣는다. effect_unknown·approval 대기도
    text에 같은 뜻으로 넣는다(R5, R7)
  - initialize의 `clientInfo.name`이 label 표시 순서(명시 `--label` → 제품 환경
    → clientInfo)의 마지막으로만 쓰이고 권한에 쓰이지 않는다. 조사(T3)의 이름:
    codex-mcp-client, gemini-cli-mcp-client, opencode, pi, openclaw-node-host,
    hermes(Claude Code는 미확인). Codex가 env를 whitelist하므로 설치 설정은
    label도 argv `--label`로 넣는다(connection#R3)

### T12 CLI 뼈대

- 상태: 완료 (#173) — 이어보냄: core dispatch와 R1·R5 테스트(dispatch 배선 뒤) → coding-agent#T36
- 등급: 기본
- concern: coding-agent/cli
- 요구: coding-agent/cli#R1, R2, R3, R4, R5, R39
- 자리: packages/coding-agent/cli/ (parser.ts, output.ts, help.ts, commands/,
  mod.ts), apps/cli/main.ts
- 쓰는 contract: C-통로, T10의 client·loader
- 내놓는 contract: C-통로의 CLI 쪽(command 이름·입력·exit code)
- slice: documents
- 조사: docs/research/coding-agent-cli.md
- 선행: T10, contracts#T48
- 완료:
  - `lophn <group> <command>`, 공통
    `--json --help --connection --daemon-url --app`, 쓰기
    `--base-revision --idempotency-key`, ticket 후속 `--claim-seq`. 별칭
    없음(R4, R39)
  - JSON 입력은 `--input` 또는 `--input-file` 하나, 둘 다·깨진 JSON·빈 필수
    값·폐지 별칭은 실행 전 거절, 상대 경로는 현재 작업 위치 기준(R4)
  - `--json`이면 stdout에 JSON 하나와 newline만, stderr는 redaction된 진단만(R3)
  - exit: 성공·정상 read·approval 대기 0, 입력 2, 인증·범위 3, 작업 실패·실제
    test fail 4, 전송 5, 효과 불명 6, 내부 1(R2, R5)
  - 쓰기 응답 유실에서 자동 재실행 없이 같은 key 결과 조회·대상 read 안내(R5)
  - MCP가 없는 세션에서 같은 registry·client로 같은 결과가 나온다는 parity
    테스트 틀(R1)
  - `help`와 `version`: command마다 목적·필수와 선택 입력·JSON 예·읽기와
    변경·사람 전용·confirmation window 필요 여부·다음 조회. `help --json`은 같은
    registry에서 만든다(R39)
  - dispatch 전 취소(SIGINT)·broken pipe는 무변경 실패로, 쓰기 요청을 보낸 뒤의
    취소는 effect_unknown(exit 6)으로 구별한다. parse 오류도 `--json`이면 JSON
    오류 하나를 낸다. `--input-file -`(stdin)은 R4대로 두지 않는다(R3, R4, R5;
    조사 T2)

### T13 문서 읽기 tool: 목차·검색·project·목록·이력·본문

- 등급: 기본
- concern: coding-agent/mcp-server, coding-agent/cli
- 요구: coding-agent/mcp-server#R8, R9, R10, R11, R12; coding-agent/cli#R11,
  R12, R13, R14, R22
- 자리: packages/coding-agent/mcp-server/tools/ (index.ts, project.ts,
  document.ts, read.ts), packages/coding-agent/cli/commands/ (index.ts, read.ts,
  document.ts, project.ts)
- 쓰는 contract: documents outline·search 읽기, documents versions read,
  documents projects read, documents addressing
- 내놓는 contract: 없음(C-통로 안)
- slice: documents
- 조사: docs/research/coding-agent-mcp-server.md,
  docs/research/coding-agent-cli.md
- 선행: T11, T12, contracts#T18, contracts#T48, documents#T6, documents#T7,
  documents#T9, documents#T13, documents#T14, documents#T16
- 완료:
  - `lophn_index`의 root·place·context·document·section·search·status op와 CLI
    `index …`·`search`: 깊이·cursor·반영 지연·잘림 표시(mcp#R8, cli#R11)
  - `lophn_project` list·show·current(documents#T7의
    /v1/projects/list·get·resolve): 이름·제목·목적, 폴더 설명, project 문서 수,
    읽을 자료 참조, 연결 context(/v1/contexts/related, context slice부터). 절대
    경로·파일 목록·폴더별 문서 수·label·tracking 규칙
    없음(documents/projects#R9, projects#Q2). current는 cwd로 가장 깊은 등록
    root의 project 참조만, 불일치는 빈 목록과 등록 안내. mcp-server#R9와
    cli#R22의 "label·폴더별 문서 수" 문장은 이 PR에서 documents/projects#R9에
    맞게 고친다(mcp#R9, cli#R22; 질문 Q13)
  - `lophn_read`: 고정 판·section·start·length·cursor, 읽는 중 새 판이 생겨도
    원래 판을 이어 읽고 새 판 존재를 알린다. 부재와 추출 실패 구별(mcp#R10,
    cli#R12)
  - `lophn_document` list: place·unplaced·state, limit 1~500, 남은 허용
    수·cursor, 본문 없음(mcp#R11, cli#R14)
  - history·diff: 두 고정 판과 선택 section의 줄 단위 추가·소실·변경·변경 없음,
    rename 추정 없음, 복원 불가는 누락 표시(mcp#R12, cli#R13)
  - CLI에 project 등록·보관·연결 command가 없다(cli#R22)
  - find-documents 6단계 통합 테스트: MCP와 CLI로 목차→section→본문을 읽고
    잘림·이어 읽기가 같다

### T14 문서 저장·format·series tool

- 등급: 기본
- concern: coding-agent/mcp-server, coding-agent/cli, coding-agent/connection
- 요구: coding-agent/mcp-server#R13, R14, R15, R16; coding-agent/cli#R15, R20;
  coding-agent/connection#R10
- 자리: packages/coding-agent/mcp-server/tools/ (save.ts, format.ts, series.ts),
  packages/coding-agent/cli/commands/ (save.ts, format.ts, series.ts)
- 쓰는 contract: documents versions(저장 command), format 실행, documents series
  read, blob
- 내놓는 contract: 없음
- slice: documents
- 조사: docs/research/coding-agent-mcp-server.md
- 선행: T11, T12, contracts#T17, contracts#T19, contracts#T48, documents#T4,
  documents#T8, documents#T17, documents#T18, platform#T13
- 완료:
  - `lophn_save`·`lophn save <files...>`: 첫 파일 primary,
    제목·format·메모·tag·series·key, 고정 주소·판·unchanged·검사 경고. 재전송은
    새 판 없음. series만 있고 key 없음은 거절(mcp#R13, cli#R15)
  - 명시 format 부적합은 무저장, 추론 format 부적합은 경고로 전달. 옛 저장 종류
    입력 거절(mcp#R14)
  - 자리 없는 저장은 고정 주소와 자리 선택 안내, 폐지 소속 입력·원본 파일 이동
    요청 거절(mcp#R15)
  - `lophn_format` list·show·validate(bytes 검사는 format 실행 요청)(mcp#R14,
    cli#R15)
  - `lophn_series` list·show·next: 다음 key·title 제안만, 생성 op 없음. CLI에
    series 생성 command 없음(mcp#R16, cli#R20)
  - 제출 파일은 realpath로 재검사해 submission root 밖·symlink로 이어진 운영
    data·backup·다른 앱 source를 거절(connection#R10)

### T15 범위 검사·금지 동작·MCP와 CLI parity

- 등급: 기본
- concern: coding-agent/connection, coding-agent/mcp-server, coding-agent/cli
- 요구: coding-agent/connection#R5, R6, R10, R11; coding-agent/mcp-server#R30,
  R31; coding-agent/cli#R1, R6, R16, R17, R23, R38
- 자리: packages/coding-agent/mcp-server/, packages/coding-agent/cli/ (테스트와
  금지 목록), fixtures/projects/ 의 두 앱 범위 fixture
- 쓰는 contract: C-연결, platform 인증·redaction
- 내놓는 contract: 없음
- slice: documents
- 조사: docs/research/coding-agent-mcp-server.md
- 선행: T13, T14
- 완료:
  - app scope connection으로 다른 앱·project의 근거를 가리켜도
    제목·본문·건수·첨부가 나오지 않고 "현재 연결로 읽을 수
    없음"만(connection#R5, mcp#R30)
  - 같은 credential·입력의 읽기·저장을 MCP와 CLI로 보내 결과와 거절이
    같다(connection#R6, cli#R1)
  - 금지 동작(project 등록, tracking, context·term 정의, assignment, 원본 임의
    읽기, 앱 DB 직접, ticket 목표 변경·확인 판정, test result 작성, approval
    결정, grant, secret 값, backup, 문제 닫힘·무시·사람 확인)이 discovery에 없고
    직접 요청도 daemon에서 거절(mcp#R30, R31, cli#R6)
  - CLI에 place·unplace·unarchive, file show·track·edit·restore, folder
    add·update·remove, secrets status·list·set·delete·lock·unlock command가 없고
    coding credential의 해당 core 요청이 거절(cli#R16, R17, R23, R38)
  - source처럼 보이는 data symlink·다른 앱 source를 거절하고 API·MCP·CLI 출력에
    운영 data 경로가 없다(connection#R10)
  - 대상 앱 우선순위가 scope를 넓히지 않는다(connection#R11)

## agent slice

### T16 question·approval 읽기 tool

- 등급: 좁은
- concern: coding-agent/mcp-server, coding-agent/cli, coding-agent/connection
- 요구: coding-agent/mcp-server#R18; coding-agent/cli#R7, R21;
  coding-agent/connection#R7
- 자리: packages/coding-agent/mcp-server/tools/ (question.ts, approval.ts),
  packages/coding-agent/cli/commands/ (question.ts, approval.ts)
- 쓰는 contract: lophn-agent questions read, platform approvals read, shell 결정
  화면 링크 모양(`lophn://things-to-confirm/<id>`, contracts/shell; 링크를 여는
  쪽은 shell#T47)
- 내놓는 contract: 없음
- slice: agent
- 조사: docs/research/coding-agent-mcp-server.md
- 선행: T11, T12, contracts#T13, contracts#T22, contracts#T28, contracts#T49,
  lophn-agent#T24, platform#T21
- 완료:
  - `lophn_question`·`lophn_approval`의 list·show: 이유·option·고정 action,
    exact 대상·입력·영향·기한·대기와 적용 구별. answer·allow·reject·consume op가
    없다(mcp#R18, cli#R21)
  - CLI `question open`·`approval open`은 결정 화면 링크와 대기 사실만 출력하고
    TTY yes·옵션 승인이 없다. 창을 닫거나 기한이 지나면 무변경(cli#R7)
  - 승인 대기 응답 뒤 같은 연결로 승인·permission 변경·secret 값 요청이
    거절(connection#R7)

## context slice

### T17 context 읽기·변경 제안 tool

- 등급: 좁은
- concern: coding-agent/mcp-server, coding-agent/cli
- 요구: coding-agent/mcp-server#R17; coding-agent/cli#R18, R19
- 자리: packages/coding-agent/mcp-server/tools/context.ts,
  packages/coding-agent/cli/commands/context.ts
- 쓰는 contract: documents contexts read, documents versions(제안 문서 저장)
- 내놓는 contract: 없음
- slice: context
- 조사: docs/research/coding-agent-mcp-server.md
- 선행: T14, contracts#T21, contracts#T49, documents#T8, documents#T22,
  documents#T23, documents#T25
- 완료:
  - list(보관 포함)·show·items·glossary·of: 기준·참고·watch 항목과 읽기
    깊이·용어·문서를 참조하는 context(mcp#R17, cli#R18)
  - propose: 생성·이름 변경·항목 추가와 제거·관점 변경·분할·병합·용어 추가와
    채택 변경안을 고정 변경안 문서로 저장(documents#T8)하고 변경안 주소와
    "사람이 Context Engineer에게 맡기라"는 안내만 돌려준다. run을 만들거나
    agent에 넘기지 않는다. 제안만으로 context·용어가 바뀌지
    않는다(documents/contexts#R6, lophn-agent/run-loop#R1; mcp#R17, cli#R19;
    질문 Q14)
  - 폴더·untracked 파일 항목 제안 거절, CLI에 context 생성·항목 변경 command
    없음(cli#R18)

## apps slice

### T18 ticket core: 표·생성·readiness·read

- 상태: 완료 (#183)
- 등급: 기본
- concern: coding-agent/tickets
- 요구: coding-agent/tickets#R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R25
- 자리: packages/coding-agent/tickets/ (model.ts, commands.ts, reads.ts,
  mod.ts), ticket ledger schema 9개, apps/core 등록 줄;
  docs/requirements/coding-agent/tickets.md,
  docs/domain-model/coding-agent/tickets.md, docs/architecture/coding-agent.md
  5.3절(readiness 반영)
- 쓰는 contract: platform command·read·event·blob, documents versions·addressing
  read, lophn-agent questions read(채택 답의 판), problems 문제 read, apps
  registration read
- 내놓는 contract: C-ticket의 create·make_ready·list·show·checks, event
  `TicketCreated`·`TicketMadeReady`, read `getTicket`
- slice: apps
- 조사: docs/research/coding-agent-ticket-claim.md
- 선행: contracts#T41, contracts#T40, platform#T2, platform#T3, platform#T4,
  platform#T18, lophn-agent#T24, problems#T6, apps#T1, documents#T9
- 완료:
  - lead 결정의 readiness: `needs_confirmation | ready`와 `needs`(필요한 확인
    1~12개)를 domain model·requirements(R2, R5, R6, R11, R26)·architecture에
    반영하고 그 문서 변경을 같은 PR에 넣는다
  - `model_test.ts`: 종류 implementation·repair만, 앱 둘·다른 종류 거절(R1).
    제목 1~120자, 무엇·왜 1~2,000자, ready의 조건 1~12·근거 1~20·볼 곳·지킬 것
    최대 20, 하나 초과·공백·중복 근거·없는 대상 거절(R2)
  - ready 생성과 make_ready는 고정 판 reference와 그 판을 채택한 question 답이
    일치해야 하고 최신 주소·다른 판의 답은 거절(R3)
  - repair는 같은 앱 미해결 문제 1~12, 문제당 종료 전 repair ticket 하나를
    `ticket_open_repair_problems` unique로 생성 transaction에서
    예약(needs_confirmation 포함). 동시 생성 중 하나만 성공(R4)
  - 생성 actor는 user·lophn·담당 App Engineer, 확인 창 없이 즉시 목록에 나오고
    coding agent run을 시작하지 않는다(R5)
  - 생성 뒤 title·what·why·app·kind·problems 불변, ready 뒤 근거·채택 답·조건·볼
    곳·지킬 것 불변. 바꾸는 command가 없다(R6)
  - 조건 kind 여섯 가지만, 자유 산문 조건 거절, human_confirmation은 repair에서
    reproduction을 만들 수 없을 때만이고 어느 문제의 reproduction을 대신하는지
    `problem`을 갖는다(domain model 불변 조건을 R9에 맞춰 이 PR에서 고친다; 질문
    Q18)(R7). 구현 ready는 app_test와 test_command 각각 하나 이상,
    release_active는 명시할 때만(R8). 수리 ready는 app_test·문제마다
    reproduction_test 또는 human_confirmation·problems_closed(R9)
  - test_command는 실행 파일·분리 argv·source 안 상대 cwd·양의 timeout·기대 exit
    code, 절대 경로·`..`·외부 symlink·shell 문자열 거절(R10)
  - 기능 요청으로 판명된 문제의 원문·기대·출처를 새 구현 ticket 근거로 연결하고
    근거 주소가 권한을 넓히지 않는다(R25)
  - list는 호출당 최대 20, 본문 없음; show는 모든 조건과 check_hash(조건의 RFC
    8785 정규 JSON sha256, contracts#T32·T41)

### T19 ticket claim: claim·갱신·반납·만료와 claim 검사 read

- 상태: 완료 (#196)

- 등급: 기본
- concern: coding-agent/tickets, coding-agent/connection
- 요구: coding-agent/tickets#R11, R12, R13, R14, R16;
  coding-agent/connection#R8; coding-agent/sessions#R9
- 자리: packages/coding-agent/tickets/ (commands.ts, reads.ts, expiry.ts),
  apps/core의 감독 timer 등록 줄
- 쓰는 contract: platform command·read·event, core 감독 timer, C-연결(회수
  event)
- 내놓는 contract: C-ticket의 claim·renew_claim·release_claim·expire_claim,
  event `TicketClaimed`·`TicketClaimRenewed`·`TicketClaimReleased`(reason
  returned·expired·connection_revoked), read
  `checkTicketClaim`(apps/releases#R6, problems/repairs가 같은 transaction에서
  씀)
- slice: apps
- 조사: docs/research/coding-agent-ticket-claim.md
- 선행: T18, T9
- 완료:
  - claim은 범위 안 coding_agent connection만, readiness ready·state
    open|check_failed·claim 없음·base_revision 일치. 같은 ticket 동시 claim 중
    하나만 성공, 한 connection의 여러 ticket claim 허용, 목록 읽기로 claim이
    생기지 않는다(R11)
  - 기한 3,600,000ms는 claim·명시 갱신 시각부터, 정확히 경계에서 갱신 거절,
    읽기·release 준비로 기한이 바뀌지 않는다(R12)
  - 60초마다·재시작 때 만료·회수 후보를 정리하고, 정리 전이라도
    checkTicketClaim이 만료·회수·다른 seq를 즉시 거절. 같은 connection의 재claim
    뒤 옛 seq는 conflict(R13)
  - 만료·반납·회수 뒤 ticket은 open, 과거 completion·문서·release·test result
    보존, 무호출·읽기 실패로 claim을 풀지 않는다(R14)
  - 문제 직접 claim·ticket 없는 시작 통로가 없다(R16)
  - connection 회수 뒤 claim 정리 event가 나가고 그 전에도 회수 credential
    요청은 거절(connection#R8)
  - session 시작·관측 입력이 claim을 바꾸는 경로가 없다(sessions#R9)
  - checkTicketClaim reason:
    missing·expired·released·revoked·changed·wrong_connection·not_ready·ticket_closed

### T20 MCP·CLI ticket tool: 목록·본문·claim·갱신·반납과 fake coding agent

- 등급: 기본
- concern: coding-agent/mcp-server, coding-agent/cli, coding-agent/tickets
- 요구: coding-agent/mcp-server#R26, R27, R37; coding-agent/cli#R36, R41;
  coding-agent/tickets#R16
- 자리: packages/coding-agent/mcp-server/tools/ticket.ts,
  packages/coding-agent/cli/commands/ticket.ts, tools/fake-coding-agent/
- 쓰는 contract: C-ticket
- 내놓는 contract: 없음(C-통로 안). fake coding agent는 다른 팀 E2E가 쓰는 개발
  도구
- slice: apps
- 조사: docs/research/coding-agent-ticket-claim.md,
  docs/research/coding-agent-mcp-server.md
- 선행: T19, T11, T12, contracts#T50
- 완료:
  - list는 앱·여섯 상태 filter, 호출당 최대 20 요약(제목·종류·앱·문제
    수·readiness)과 cursor. 21개에서 20개와 cursor(mcp#R26, cli#R36)
  - show는 모든 조건·고정 근거·볼 곳·지킬 것·문제별 묶음 읽기 안내, checks는
    조건별 결과(mcp#R26)
  - claim·renew·release는 MCP만 실제 실행. 응답에
    connection·claim_seq·expires_at·반납 방법. 통로가 기한이나 자동 갱신을
    덧붙이지 않는다(mcp#R27)
  - CLI `ticket claim`은 MCP 연결·지정 ticket 안내로 끝나고 claim을 만들지
    않는다(cli#R41)
  - start·resume·harness 설치·permission 응답 op가 discovery와 직접 호출
    모두에서 거절(mcp#R37)
  - 문제 직접 claim op가 없다(tickets#R16)
  - `tools/fake-coding-agent/`: MCP client script로 ticket show → claim → (app
    tool 호출) → release 준비 → (T25 뒤) report를 돌리는 개발 도구. apps 팀
    new-app·change-app E2E가 coding agent 자리에 쓴다
- 상태: 완료 (#208) — 이어보냄: fake coding agent의 report 단계와 apps 팀 new-app·change-app E2E가 coding agent 자리에 이 도구를 쓰는지 확인 → coding-agent#T25
  apps 팀 new-app·change-app E2E가 coding agent 자리에서 이 도구를 쓰는지
  확인한다

### T21 MCP·CLI 앱 개발 tool

- 등급: 기본
- concern: coding-agent/mcp-server, coding-agent/cli, coding-agent/connection
- 요구: coding-agent/mcp-server#R19, R20, R21, R29, R32, R33;
  coding-agent/cli#R7, R24, R25, R26, R27, R28, R31, R32;
  coding-agent/connection#R4
- 자리: packages/coding-agent/mcp-server/tools/app.ts,
  packages/coding-agent/cli/commands/app.ts
- 쓰는 contract: apps registration(list·get·create·connect_source), apps
  bundle·releases(prepare_bundle, prepare), apps preview(start·stop), apps
  runtime·blueprint read, 앱 통로(direct call), apps invocations read, apps
  logs, problems test 실행(RequestTest, GetVerification),
  C-ticket(checkTicketClaim), shell 결정 화면 링크
- 내놓는 contract: 없음
- slice: apps
- 조사: docs/research/coding-agent-mcp-server.md
- 선행: T20, contracts#T50, contracts#T33, contracts#T34, contracts#T36,
  contracts#T37, contracts#T32, apps#T1, apps#T6, apps#T9, apps#T10, apps#T11,
  apps#T19, apps#T21, problems#T7, problems#T8, problems#T9
- 완료:
  - op 대응(apps 팀 합의): list→apps.list, show→apps.get,
    register→apps.create(scope all만), source→apps.connect_source,
    validate→prepare_bundle의 blueprint diagnostics와 bundle_hash, test→problems
    RequestTest, preview_start·stop→previews, release_prepare→prepare_bundle 뒤
    releases.prepare, status→apps.runtime, blueprint, invocations, invocation,
    logs, command(앱 통로 direct)(mcp#R19, cli#R24)
  - register는 scope all만, app scope는 거절(connection#R4, cli#R25)
  - validate·test는 오류·경고·permission 검토와 실제 Verification을 구별하고
    실패 뒤 release 준비 거절, preview는 fixture 격리·상태·중지 결과(mcp#R20,
    cli#R26, R27)
  - release_prepare는 ticket·claim_seq 필수, 같은 bundle hash의 app test 통과
    근거, 준비와 activation 구별(mcp#R21, cli#R28)
  - app test 기본 timeout 300,000ms를 runner 요청에 명시하고 실패·timeout·준비
    실패를 구별, 바뀐 source는 이전 성공으로 준비하지 않는다(mcp#R33, cli#R26)
  - test·preview_start·release_prepare는 MCP 응답을 접수와 다음 read(요청 ID,
    대상 read)로 나눠 OpenCode 기본 tool timeout 30초 안에 돌려준다. 기다릴 때는
    progress notification을 보낸다(조사 T1)
  - command·invocation: environment는 `preview | live`, 기본 preview, 양의
    timeout만, coding credential은 effect=read·confirm=false만. 결과 불명과 실제
    실패 구별(mcp#R29, cli#R31, R32)
  - invocations는 페이지당 최대 20, logs는 apps/runtime#R27에 맞춰 한 번에
    1~200줄과 cursor(질문 Q2; mcp#R32, cli#R24의 2,000줄 문장은 이 PR에서
    고친다)
  - 사람 전용 `app start|stop|release activate`, `app automation run`은 결정
    화면 링크·대기 사실만 출력하고 coding credential은 거절(cli#R7, R27, R31)

### T22 SDK tool

- 등급: 좁은
- concern: coding-agent/mcp-server, coding-agent/cli
- 요구: coding-agent/mcp-server#R22, R23; coding-agent/cli#R30
- 자리: packages/coding-agent/mcp-server/tools/sdk.ts,
  packages/coding-agent/cli/commands/sdk.ts
- 쓰는 contract: apps sdk catalog(packages.list·versions·guide), apps sdk add
- 내놓는 contract: 없음
- slice: apps
- 조사: docs/research/coding-agent-mcp-server.md
- 선행: T21, contracts#T37, contracts#T50, apps#T5
- 완료:
  - catalog(설명·API 이름 검색 → 이름·최신 version·종류·한 줄 설명),
    show(API·type·permission·peer·예제), 비설치·없는 package 구별(mcp#R22,
    cli#R30)
  - add: exact version만, 고정 import 안내, `apply`일 때만 source
    반영(변경·무변경·충돌), 범위 version·미설치 version·조용한 upgrade 거절, 두
    번 추가해도 중복 없음(mcp#R23, cli#R30)
  - 개인 SDK는 지원 범위 밖으로 구별해 표시

### T23 blueprint 유래 앱 read tool

- 등급: 기본
- concern: coding-agent/mcp-server
- 요구: coding-agent/mcp-server#R4, R34, R35
- 자리: packages/coding-agent/mcp-server/tools/app-commands.ts, registry.ts
- 쓰는 contract: apps blueprint read(active release), 앱 통로(direct call),
  C-연결(scope)
- 내놓는 contract: C-통로의 동적 tool 이름 규칙
- slice: apps
- 조사: docs/research/coding-agent-mcp-server.md
- 선행: T21, contracts#T50
- 완료:
  - app toolset을 켠 경우에만 scope 안 앱의 read·confirm=false command마다 tool
    하나, 원 이름·설명·input schema 그대로. 이름은
    `lophn_app_<app ID sha256 앞 12자>_<command 이름 sha256 앞 16자>`(39자)로
    Gemini의 `mcp_lophn_` 포함 63자 상한 안에 든다. architecture 5.2의
    `lophn_app_<app-id>_…`(app ID 30자라 Gemini가 가운데를 자름)는 이 PR에서
    고친다(질문 Q16). 설명에 앱 이름과 command 이름을 넣는다. 이름 충돌은
    discovery 실패(R34)
  - 바깥 객체에 input·environment·timeout_ms, 기본 preview, 앱 통로 direct call,
    읽기가 ledger 쓰기를 기다리지 않는다(R35)
  - release·connection이 바뀌면 옛 정의 호출은 conflict와 목록 재조회,
    `notifications/tools/list_changed` 전송. Codex는 list_changed를 무시하므로
    conflict 응답에 고정 op `lophn_app command`로 부르는 방법을 함께 준다(R35)
  - write·external·confirm·범위 밖 앱은 discovery와 직접 요청 모두 거절(R34)
  - 동적 목록을 포함한 schema token 재측정(R4)

## coding-agent slice

### T24 ticket 완료 보고와 취소

- 등급: 기본
- concern: coding-agent/tickets, coding-agent/connection
- 요구: coding-agent/tickets#R15, R17, R22, R23; coding-agent/connection#R18
- 자리: packages/coding-agent/tickets/ (commands.ts, model.ts)
- 쓰는 contract: platform command·blob, apps releases read(ticket_source),
  problems repairs read(ListProblemFixes), problems tests read(GetVerification),
  documents versions read, lophn-agent revert(revert 근거)
- 내놓는 contract: C-ticket의 report_completion·cancel, event
  `TicketCompletionReported`·`TicketCancelled`
- slice: coding-agent
- 조사: docs/research/coding-agent-ticket-claim.md
- 선행: T19, problems#T14
- 완료:
  - report: 유효 claim·같은 앱·`ticket_source{ticket, claim_seq}`가 맞는
    release만, 다른 앱·다른 claim release 거절, ticket과 release에서 claim
    출처를 역조회(R15)
  - 완료 보고 값: release·summary blob(변경·수행 확인·미실행
    확인·한계)·outputs·repair면 문제마다 fix record·verifications. 접수 때
    claim이 끝나고 보고만으로 confirmed가 되지 않는다(R17)
  - cancel: user는 종료 전 ticket을 1~200자 한 줄 사유로 확인 창 없이, revert
    machine은 외부 claim·보고·결과가 한 번도 없을 때만. 빈 사유·201자 거절(R22)
  - 취소 직후 옛 claim의 갱신·release 준비·보고 거절, 과거 결과·문제 보존, 외부
    프로세스를 멈췄다는 표시 없음(R23, connection#R18)
  - confirmed·cancelled 때 문제 독점 예약 행 제거

### T25 MCP·CLI ticket tool: 완료 보고·사람의 생성과 취소

- 등급: 좁은
- concern: coding-agent/mcp-server, coding-agent/cli
- 요구: coding-agent/mcp-server#R27, R28; coding-agent/cli#R36, R37
- 자리: packages/coding-agent/mcp-server/tools/ticket.ts,
  packages/coding-agent/cli/commands/ticket.ts, tools/fake-coding-agent/
- 쓰는 contract: C-ticket, shell 결정 화면 링크(사람 전용 생성·취소 화면 intent)
- 내놓는 contract: 없음
- slice: coding-agent
- 조사: docs/research/coding-agent-ticket-claim.md
- 선행: T24, T20
- T20에서 넘어온 것: tools/fake-coding-agent에 report 단계를 넣고, apps 팀 new-app·change-app E2E가 coding agent 자리에 이 도구를 쓰는지 확인(#208)
- 완료:
  - `lophn_ticket` report와 `ticket report`: release·summary·outputs·fix
    event·Verification 참조를 받고 completion seq는 입력받지 않는다. 결과는 완료
    주장·보고 접수·확인 실패·approval 대기·activation·문제 정상 확인을
    따로(mcp#R28, cli#R36)
  - 만료·취소 뒤 보고는 거절, 통로가 자체 기한·자동 갱신을 붙이지
    않는다(mcp#R27)
  - `ticket create`·`ticket cancel`은 사람 전용: 같은 필수 입력 검사와 취소
    사유, 확인 창 없음. coding credential에는 목표 수정·공개·취소·확인 판정·test
    result 작성이 없다(cli#R37; actor 경로는 질문 Q1)
  - fake coding agent가 report까지 도는 script를 갖는다

### T26 ticket checker: app_test·test_command·release_active

- 등급: 기본
- concern: coding-agent/tickets
- 요구: coding-agent/tickets#R7, R8, R18, R19, R20
- 자리: packages/coding-agent/tickets/checker/, apps/worker의 coding-agent kind
- 쓰는 contract: platform event 구독·read·command, problems test
  실행(test_command 요청과 TicketTestLink, GetVerification), apps releases
  read(active release)
- 내놓는 contract: C-ticket의 record_checks, event
  `TicketChecksRecorded`·`TicketConfirmed`·`TicketCheckFailed`
- slice: coding-agent
- 조사: docs/research/coding-agent-ticket-claim.md
- 선행: T24, problems#T13
- 완료:
  - 최신 completion의 release에 대해 조건별 pass·fail·inconclusive와 이유·근거.
    test 근거는 같은 app·bundle hash의 Verification만, test_command는
    TicketTestLink{ticket, check_index(조건 position), check_hash,
    completion_seq}가 맞아야 한다. shell 성공 문장은 근거가 아니다(R18)
  - 전부 pass면 confirmed, 실제 fail 하나 이상이면 check_failed,
    미실행·승인·운영 대기만 남으면 이유와 남은 조건을 가진 reported(R19)
  - 구현 ticket의 app_test·test_command 판정과 release_active는 실제 active
    release 비교, activation 조건이 없으면 승인 대기로 막히지 않는다(R7, R8)
  - 재시작 뒤 reported의 누락 검사를 잇고
    `VerificationRecorded`·`ReleaseActivated`·`ReleaseSuperseded`에서 남은
    조건만 재비교, 늦은 옛 completion이 새 결과를 덮지 않는다. model 호출
    없음(R20)
  - record_checks는 completion_seq·ticket revision·읽은 대상 revision CAS
  - 이어받음: platform#T36의 checker 발생 작업. 이 작업이 `TicketConfirmed`·`TicketCheckFailed`를 낸다

### T27 사람 화면용 ticket read

- 등급: 좁은
- concern: coding-agent/tickets
- 요구: coding-agent/tickets#R27
- 자리: packages/coding-agent/tickets/reads.ts
- 쓰는 contract: C-ticket
- 내놓는 contract: C-ticket의 사람 화면 read(제목·원래 요청 또는 문제·화면 상태
  값·다음 행동 값, 펼침 상세). wording key로 바꾸는 것은 shell#T50
- slice: coding-agent
- 조사: docs/research/coding-agent-ticket-claim.md
- 선행: T26
- 완료:
  - 여섯 상태와 readiness가 서로 다른 화면 상태 값으로 나오고 claim이라는
    말·기한·connection ID·전체 조건·보고·test 원문은 기본 data에 없고 상세
    read로만(R27)
  - 다음 행동은 [Start] 가능(ready·open|check_failed), 확인
    필요(needs_confirmation), 결과 확인, 승인 대기 중 하나로 계산

### T28 harness catalog와 감지

- 등급: 기본
- concern: coding-agent/harnesses, coding-agent/cli
- 요구: coding-agent/harnesses#R1, R2, R3, R4, R12; coding-agent/cli#R40
- 자리: packages/coding-agent/harnesses/ (catalog/, detection.ts, model.ts,
  mod.ts),
  packages/coding-agent/cli/commands/harness.ts(list·detect·refresh·inspect)
- 쓰는 contract: platform settings(선택 저장 읽기)
- 내놓는 contract: C-harness의 catalog·HarnessDetection JSON
- slice: coding-agent
- 조사: docs/research/coding-agent-harness-integration.md
- 선행: T12, contracts#T42, contracts#T43
- 완료:
  - 일곱 제품 HarnessDefinition: 감지 명령·alias·fallback, version·auth
    probe(5,000ms·65,536 bytes), config·skill·instruction·hook target,
    ExecutionSpec, version_policy(supported·unsupported·unverified). 미검증
    capability는 성공으로 나오지 않는다(R1)
  - 감지는 PATH와 정한 fallback(.local/bin, .bun/bin, npm·pnpm·Yarn bin,
    Volta·asdf·fnm·mise shim, nvm alias; hop 8회)만, 다른 위치·home 전체 순회
    없음, shell RC 평가 없음. refresh는 사람 요청만, 화면 재진입·빈
    결과·timeout에 자동 재감지·설치 없음(R2)
  - 발견·version·auth·설치·loading·session을 별도 값으로, timeout·실패·미지원
    probe를 absent나 성공으로 바꾸지 않는다(R3)
  - native host만 수집, WSL·remote 요청은 미지원 안내, environment·profile별
    key와 freshness(R4)
  - 관측·실행 계획에 token·인증 원문·설정 원문·transcript가 없다(R12)
  - CLI `harness list|detect|refresh|inspect`(cli#R40 일부)

### T29 설치 engine: plan·install·update·remove·receipt

- 등급: 최상위
- concern: coding-agent/harnesses, coding-agent/connection, coding-agent/cli,
  coding-agent/guides
- 요구: coding-agent/harnesses#R6, R7, R8, R9, R12; coding-agent/connection#R12,
  R17; coding-agent/cli#R40; coding-agent/guides#R4
- 자리: packages/coding-agent/harnesses/integration/ (plan.ts, apply.ts,
  receipt.ts, journal.ts), packages/coding-agent/harnesses/adapters/ (json.ts,
  toml.ts, yaml.ts),
  packages/coding-agent/cli/commands/harness.ts(plan·install·update·remove)
- 쓰는 contract: 없음(로컬 파일만; `~/.lophn/integrations/`)
- 내놓는 contract: C-harness의 plan·resource별 결과 JSON
- slice: coding-agent
- 조사: docs/research/coding-agent-harness-integration.md
- 선행: T28, contracts#T42, contracts#T43
- 완료:
  - plan은 사람이 고른 harness·native 환경·profile·user 또는 app
    범위·connection·app realpath·catalog revision의 exact target만. 감지된 다른
    제품·다른 profile은 무변경(R6)
  - receipt의 owned resource·last-written hash·fragment digest와 계획 때 읽은
    전체 파일 hash를 교체 직전에 다시 비교, 불일치·외부 symlink·동명 비관리
    resource는 conflict, 사람 수정 보존(R7)
  - JSON·TOML·YAML merge는 lophn key만, 기존
    server·env·permission·trust·hook·지침 보존, 깨진 설정은 무변경. harness
    자체의 `codex|gemini|claude mcp add`는 부르지 않는다(파일 전체 재직렬화·동명
    교체·OAuth 부작용, 조사 T5)(R8)
  - 소유 판정은 lophn 항목을 파싱해 정규화한 fragment digest로 한다. Gemini의
    settings migration·Codex의 재직렬화처럼 harness가 파일의 다른 부분을 다시
    써도 lophn 항목이 그대로면 소유가 유지되고, 전체 파일 hash는 plan을 읽은
    뒤와 교체 직전 사이의 동시 변경 검사에만 쓴다(R7)
  - 대상 경로가 symlink면 따라 쓰지 않고 conflict(Codex는 따라 쓰지만 lophn은
    R7대로)(R7)
  - 파일별 같은 폴더 temp·fsync·rename, resource별
    changed·unchanged·skipped·conflict·failed와 receipt 결과, receipt 저장
    실패는 partial+recovery journal이고 복구 전 다음 갱신 거절(R9)
  - 설정·wrapper에는 `--connection <cac>`·`LOPHN_CONNECTION`만, token 원문
    없음(connection#R17, harnesses#R12)
  - 설치 실패·제거가 credential 재발급·회수를 하지 않는다(connection#R12)
  - skill은 root 바로 아래 `<name>/`에 본문·보조 자료 함께, 외부 원본을 치워도
    읽힌다(guides#R4)
  - CLI `harness plan|install|update|remove`, 선택하지 않은 harness
    무변경(cli#R40)

### T30 adapter: Claude Code·Codex·OpenCode·Gemini CLI

- 등급: 기본
- concern: coding-agent/harnesses, coding-agent/guides, coding-agent/cli,
  coding-agent/connection
- 요구: coding-agent/harnesses#R8, R11; coding-agent/guides#R5, R13, R18;
  coding-agent/cli#R9; coding-agent/connection#R1, R14
- 자리: packages/coding-agent/harnesses/catalog/ (claude.ts, codex.ts,
  opencode.ts, gemini.ts),
  packages/coding-agent/cli/commands/mcp.ts(`mcp config`)
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: coding-agent
- 조사: docs/research/coding-agent-harness-integration.md,
  docs/research/coding-agent-skills-and-guides.md,
  docs/research/coding-agent-mcp-server.md
- 선행: T29, contracts#T43
- 완료:
  - Claude Code: user 등록 또는 app `.mcp.json`의 `mcpServers.lophn`, skill
    `~/.claude/skills`·`.claude/skills`, CLAUDE.md 관리 구간 `@AGENTS.md`,
    SessionStart는 `.claude/settings.local.json`의 lophn 항목만(R8, R11,
    guides#R13)
  - Codex: 사람이 고르면 effective `CODEX_HOME`(기본 `~/.codex`)/config.toml의
    `[mcp_servers.lophn]`만 receipt와 함께, 앱 TOML 없음, 사람이 고친 hash는
    conflict(R8, guides#R18). AGENTS.override.md 검사
  - OpenCode: XDG user 또는 app `opencode.json`의 `mcp.lophn`(type local,
    command 배열, environment), skill root, 기존 rules·precedence 보존
  - Gemini CLI: `settings.json`의 `mcpServers.lophn`(scope는 사람이 고른 user
    또는 app, Gemini 자체 기본 project를 따르지 않음), `context.fileName` 기존
    목록 보존에 AGENTS.md 추가, trust 자동 설정 없음, settings 파싱 실패는
    무변경(guides#R13)
  - hook은 제품별 event 이름(Claude `SessionStart`, Gemini
    `SessionStart`·`BeforeTool` 등)을 catalog에 version별로 두고, Claude Code는
    모르는 event가 settings 전체를 버리게 하므로 검증 version 밖에는 hook을 쓰지
    않는다(R11)
  - 네 제품 각각 기존 server·env·permission·trust·동명 연결을 둔 fixture
    HOME에서 설치해 보존과 conflict 확인(connection#R1, R14)
  - `lophn mcp config --target <제품> --scope user|app`은 executable·분리
    argv·안전 env 조각만, 설정 파일 bytes 무변경, secret·운영 경로 없음(cli#R9)
  - 제품별 skill 발견 위치·trust 안내, 동명 skill 자동 교체 없음. 설치 plan은
    제품 root만이 아니라 그 제품이 읽는 다른 발견 root(`.agents/skills`,
    `.claude/skills` 등, 조사 문서의 우선순위)의 동명 skill도 검사해
    가림·가려짐을 conflict로 낸다(guides#R5)

### T31 adapter: Hermes·pi·OpenClaw

- 등급: 기본
- concern: coding-agent/harnesses, coding-agent/guides, coding-agent/cli,
  coding-agent/connection
- 요구: coding-agent/harnesses#R8, R11; coding-agent/guides#R5, R13;
  coding-agent/cli#R9; coding-agent/connection#R1, R14;
  coding-agent/mcp-server#R1
- 자리: packages/coding-agent/harnesses/catalog/ (hermes.ts, pi.ts, openclaw.ts)
- 쓰는 contract: 없음
- 내놓는 contract: 없음
- slice: coding-agent
- 조사: docs/research/coding-agent-harness-integration.md,
  docs/research/coding-agent-skills-and-guides.md
- 선행: T29
- 완료:
  - Hermes: `$HERMES_HOME/config.yaml`(기본 `~/.hermes`)의
    `mcp_servers.lophn`(command·args·env·cwd), skill trust는 사람의
    `hermes skills trust` 안내, profile home·workspace 확인(R8, guides#R5)
  - pi: 조사 revision(8369268)의 native MCP 설정 `~/.pi/agent/mcp.json`(user)과
    trusted `<cwd>/.pi/mcp.json`(app)에 lophn 항목, 깨진 파일은 무변경.
    architecture 5.5·domain model 표의 `mcp-adapter.json`·`directTools`는 이
    PR에서 검증 version 기준으로 고친다(질문 Q19). script·proxy 필수 형태와
    native·adapter 이중 시작 금지(R8, guides#R5)
  - OpenClaw: config의 `mcp.servers`는 strict schema라 invalid면 harness가
    throw하므로 자동 merge하지 않고 `mcp.servers.lophn` stdio 조각 안내만(env
    치환·기본 경로·hook·skill root가 조사에서 미확인). workspace AGENTS.md와 앱
    root 차이 안내, workspace 변경·본문 복제 없음, session 소유 stdio 미확인은
    unknown과 CLI fallback(R8, connection#R14, mcp#R1)
  - Hermes는 깨진 YAML을 메모리에서 기본값으로 대체하므로 doctor가 파싱 실패를
    loading 실패 이유로 낸다(R8)
  - 세 제품의 상태 hook·plugin·extension target 중 검증 version만 설치, 미검증은
    조각 안내(R11)
  - pi·Hermes·OpenClaw의 `.agents/skills` 등 다른 발견 root와 project skill
    trust를 설치 plan의 동명 검사에 넣는다(guides#R5)
  - 기존 설정 보존 fixture 테스트(connection#R1), `mcp config` 조각(cli#R9),
    지침 정본 읽기(guides#R13)

### T32 doctor와 네 loading 관측

- 등급: 기본
- concern: coding-agent/harnesses, coding-agent/connection, coding-agent/cli
- 요구: coding-agent/harnesses#R3, R10; coding-agent/connection#R13, R14;
  coding-agent/cli#R10
- 자리: packages/coding-agent/harnesses/loading.ts,
  packages/coding-agent/cli/commands/doctor.ts
- 쓰는 contract: C-연결(connection 상태 read), platform 인증(credential 사용
  가능 여부)
- 내놓는 contract: C-harness의 HarnessIntegrationObservation JSON
- slice: coding-agent
- 조사: docs/research/coding-agent-harness-integration.md,
  docs/research/coding-agent-mcp-server.md
- 선행: T30, T31, contracts#T42, contracts#T43
- 완료:
  - mcp_initialize·tool_discovery·skill_discovery·app_guide_loading을 각각
    success·failure·unknown과 안전한 이유로. MCP probe는 설치된 절대 Deno
    executable로 lophn-mcp를 띄워 initialize·tools/list(R10)
  - 파일 존재·credential active를 loading 성공으로 쓰지 않고, CLI fallback
    성공으로 MCP loading 성공을 만들지 않는다(R3, connection#R13)
  - trust 거절·override·동명 skill·더 가까운 안내·별도 workspace를 넣은
    fixture에서 단계별 이유와 다음 확인이 나오고 파일·workspace 설정이 바뀌지
    않는다(connection#R13, R14)
  - `lophn doctor`: daemon·인증·설정과 네 단계를 따로(cli#R10)

### T33 배포 skill 네 개와 검사

- 등급: 기본
- concern: coding-agent/guides, coding-agent/cli
- 요구: coding-agent/guides#R1, R2, R3, R6, R7, R8, R9, R10, R11, R12, R20, R22,
  R26; coding-agent/cli#R10
- 자리: packages/coding-agent/guides/ (skills/lophn-navigate/,
  skills/lophn-save/, skills/lophn-build-app/, skills/lophn-repair/,
  skill-check.ts, manifest.ts), packages/coding-agent/cli/commands/skills.ts
- 쓰는 contract: C-통로(tool·command 이름을 본문이 가리킴)
- 내놓는 contract: 없음
- slice: coding-agent
- 조사: docs/research/coding-agent-skills-and-guides.md
- 선행: T29, T25, contracts#T43
- 완료:
  - 네 skill(탐색·저장·앱 제작·수리), 시작 발견에는 name·description만, 본문은
    선택 시(R1)
  - 검사: YAML frontmatter·UTF-8, name 1~64자
    `^[a-z0-9]+(-[a-z0-9]+)*$`·디렉터리 이름 일치, description 1~1,024 code
    point, 본문 500 logical line 미만, metadata는 string→string만, 참조는 본문이
    직접 가리키는 한 단계 상대 경로만. 경계값과 한 글자 초과 테스트(R2, R3)
  - 본문 절차: 탐색(기준 전체, 참고·watch 요약부터; R6), 저장(format
    확인→자리→저장→주소 보고, 원본 편집 안내 없음; R7), 앱 제작(지정 ticket→MCP
    claim→채택 설계→SDK→필요 시 등록→source·템플릿→blueprint 먼저→구현→실제
    테스트→preview→release 준비→결과; R8), 수리(지정 ticket→claim→repair
    context→추가 근거→수정→테스트·preview→claim 재확인→release 준비→결과; R9),
    직접 요청도 ticket(R10), problem code·보고·예외·피드백·원래 증상 테스트
    보존(R11), 결과 구별(R12), 수리 조사 순서(R26), 지정 ticket만 claim·목록과
    summary는 착수 지시가 아님(R22)
  - version·content hash manifest, 같은 version의 내용 변경은 배포 테스트
    실패(R20)
  - `lophn skills list|install`: 이름·설명·version·hash, 파일별
    변경·무변경·충돌(cli#R10)

### T34 앱 template 안내·관리 구간·sync-tools

- 등급: 기본
- concern: coding-agent/guides, coding-agent/mcp-server, coding-agent/cli
- 요구: coding-agent/guides#R13, R14, R15, R16, R17, R18, R19;
  coding-agent/mcp-server#R19; coding-agent/cli#R29
- 자리: packages/coding-agent/guides/ (managed-files.ts, templates/),
  packages/coding-agent/mcp-server/tools/app.ts(sync_tools),
  packages/coding-agent/cli/commands/app.ts(sync-tools)
- 쓰는 contract: apps template 자리(templates/app/, apps#T22), C-통로(release
  bundle 제외 목록, contracts#T50)
- 내놓는 contract: C-통로의 release bundle 제외 경로 상수
- slice: coding-agent
- 조사: docs/research/coding-agent-skills-and-guides.md
- 선행: T33, T30, contracts#T50, apps#T22, apps#T6
- 완료:
  - 앱 root AGENTS.md 하나가 정본, CLAUDE.md는 `@AGENTS.md`, Gemini는
    context.fileName 참조(기존 목록과 합집합), 나머지는 AGENTS.md 직접. 더
    가까운 `AGENTS.override.md`(Codex·pi), `.hermes.md`·`HERMES.md`(Hermes가
    AGENTS.md를 건너뜀)를 doctor가 app_guide_loading의 이유로 낸다. 관리 구간은
    Codex 32 KiB 절단 안에 들도록 상한을 두고 배포 테스트로 잰다(R13)
  - 안내 본문은 앱 설명·필요 skill·시작 summary·사람 지시
    claim·설계·blueprint·구현·machine 생성물 구별·수정 주의·용어·SDK 확인·문제
    보고·테스트·preview·결과 반환만, ticket 본문·묶음·token 없음(R14)
  - marker `<!-- begin lophn-managed -->`·`<!-- end lophn-managed -->` 한 쌍
    안만 바꾸고 바깥 bytes 보존, 없음·중복·불완전·짝 불일치는 무변경과 복구
    안내(R15)
  - 읽은 hash와 현재 hash가 다르면 무변경 충돌, temp·원자 교체(R16)
  - sync-tools: MCP 설정·skill·CLI wrapper(`bin/lophn`)·공통 안내·제품 얇은
    안내·ignore 안내별 변경·무변경·건너뜀과 이유, 두 번 해도 중복 없음, 앱
    code·다른 server·사람 안내 보존(R17, mcp#R19, cli#R29)
  - Codex는 사용자 config만, 앱 TOML 없음(R18)
  - release bundle 제외 목록(안내·skill·hook·wrapper·제품 local MCP 설정)을
    contracts에 두고 apps bundle이 쓰는지 통합 테스트, local hook 설정은 ignore
    관리 구간에(R19)

### T35 session 시작 summary와 Claude Code hook

- 등급: 기본
- concern: coding-agent/guides, coding-agent/mcp-server, coding-agent/cli
- 요구: coding-agent/guides#R21, R22, R23, R24, R25; coding-agent/harnesses#R11
- 자리: packages/coding-agent/guides/ (summary.ts, hook.ts), apps/worker의
  coding-agent kind, packages/coding-agent/mcp-server/tools/session.ts,
  packages/coding-agent/cli/commands/session.ts(summary)
- 쓰는 contract: platform read·worker 요청 전달, C-ticket read, problems 문제
  read, C-session(summary RPC)
- 내놓는 contract: C-session의 `/v1/coding_agent_sessions/summary`와
  CodingAgentSessionSummary
- slice: coding-agent
- 조사: docs/research/coding-agent-skills-and-guides.md
- 선행: T27, T30, contracts#T42, contracts#T43, problems#T6, platform#T12
- 완료:
  - summary: 범위 안 open·fixing 문제와 open·check_failed ticket 요약, 자기
    claim·기한, reported의 남은 조건, next_cursor, claim_rule.
    본문·log·첨부·묶음 없음, 읽어도 claim·상태 무변경, 읽기 실패를 빈 목록으로
    바꾸지 않는다(R21, R22)
  - `session summary --hook --app <app>`: warning 이상 coding_agent 대상 문제
    최대 3개와 ticket, 나머지 수·상세 읽기·착수 금지 마지막 줄, 10줄·1,200 code
    point 이하, info·사람 처리 문제 제외(R23)
  - hook 전체 timeout 5초·daemon 대기 3초, 장애·빈 결과는 stdout 빈 값·exit 0.
    일반 summary는 실패를 표시(R24)
  - hook은 Claude Code에만 설치하고 다른 여섯 제품은 명시 summary 안내, 상태
    수집 hook과 receipt·목적이 섞이지 않는다(R25, harnesses#R11)

### T36 keychain loader·연결 생성·설치 흐름과 기본 harness

- 등급: 기본
- concern: coding-agent/connection, coding-agent/harnesses, coding-agent/cli,
  coding-agent/mcp-server
- 요구: coding-agent/connection#R1, R2, R9, R12, R17; coding-agent/harnesses#R5,
  R6; coding-agent/cli#R40; coding-agent/mcp-server#R36
- 자리: packages/coding-agent/connection/credential/(platform loader adapter),
  packages/coding-agent/cli/commands/connection.ts(list·show·install),
  packages/coding-agent/harnesses/selection.ts
- 쓰는 contract: C-연결, platform 인증(신뢰 경계의 token 발급·keychain, 신뢰
  MCP·CLI loader), platform settings(기본 harness·enabled·profile), C-harness
- 내놓는 contract: C-harness의 기본 harness 제안 JSON
- slice: coding-agent
- 조사: docs/research/coding-agent-harness-integration.md,
  docs/research/coding-agent-connection-credential.md
- 선행: T9, T10, T29, T32, contracts#T43, platform#T34, platform#T48,
  platform#T35, contracts#T24
- 완료:
  - MCP·CLI 시작 때 connection 참조로 helper
    `lophn-credential`(contracts/coding-agent `CREDENTIAL_HELPER`)에
    `CredentialDeliveryRequest`(purpose `mcp_cli_loader`)를 stdin으로 보내
    credential을 한 번 받는 production provider. 회수 확인은 core의 매 요청 hash
    검사이고 loader를 다시 읽지 않는다. keychain 잠김·Secret Service
    없음·timeout·누락(`locked`, `no_secret_service`, `timeout`, `not_found`)은
    서로 다른 이유의 `unavailable`, 평문 파일·user credential fallback·자동
    재발급 없음(connection#R9, R17, mcp-server#R36; 조사 T3)
  - keychain 항목은 service `lophn`, account `coding-agent/<cac>`(platform
    합의). MCP·CLI는 platform의 helper `lophn-credential`(고정 권한으로
    compile한 binary)을 `--allow-run=<helper 절대 경로>` 하나로만 부르고
    connection 참조를 stdin, token을 stdout으로 받는다. helper timeout 5초.
    architecture/coding-agent 2.2의 run 금지 문장을 이 PR에서 "helper 하나만
    허용"으로 고친다(질문 Q17)
  - 설정·wrapper·source·진단·stderr·PTY 출력에 token 원문이 없다는
    테스트(connection#R17)
  - 사람 선택(harness·profile·설치 범위·label·scope) → 신뢰 경계 token·keychain
    → core create(hash만, 확인 창 없음) → 선택 target 설치 → doctor 흐름을
    shell#T50이 부를 순서 그대로 test driver로 통합 테스트(fake keychain). token
    생성·붙여넣기 단계가 없다(connection#R2)
  - 보관 준비 실패는 무생성, 설치 실패는 connection 성공과 따로
    partial(connection#R2, R12)
  - 기본 harness는 nullable, 비었을 때 연결 확인된 실행 가능 후보가 하나면
    제안·여럿이면 고르게, 저장 선택이 사라져도 다른 제품으로 자동 교체
    없음(harnesses#R5)
  - `connection install`은 기존 connection의 선택 target 재설치, 자동 재발급
    없음(harnesses#R6, cli#R40)
  - lophn 시작·문제 발생·ticket 생성만으로 외부 process가 뜨지
    않는다(connection#R1)
  - 이어받음: coding-agent#T12의 core dispatch. R1·R5 테스트는 dispatch 배선 뒤 이 작업에서 닫는다

### T37 daemon command

- 상태: 완료 (#205)
- 등급: 좁은
- concern: coding-agent/cli
- 요구: coding-agent/cli#R6, R8
- 자리: packages/coding-agent/cli/commands/daemon.ts
- 쓰는 contract: platform 설치·시작 contract(daemon start·stop·status), platform
  diagnostics(redaction된 daemon log)
- 내놓는 contract: 없음
- slice: coding-agent
- 조사: docs/research/coding-agent-cli.md
- 선행: T12, contracts#T43, platform#T9, platform#T55, shell#T51
- 완료:
  - `daemon start|stop|status|logs`(platform#T55): start는 launcher로 창 없는
    Electron main을 띄우고, stop은 OS single-instance 통로로 명시 종료를
    요청한다. status·logs는 token 없이 OS 사용자 권한으로 `H/run` metadata와
    `H/logs`의 안전 log를 읽는다. 이미 시작·중지된 상태도 현재 상태로, 접수와
    실제 상태 구별, 장애의 안전한 이유(R8)
  - coding credential의 start·stop은 거절(R6)
  - 보통 읽기·MCP는 lophn 창 없이 동작(R8)

### T38 LaunchPlan과 첫 prompt

- 등급: 기본
- concern: coding-agent/sessions, coding-agent/harnesses
- 요구: coding-agent/sessions#R1, R2, R3, R4, R5, R10; coding-agent/harnesses#R5
- 자리: packages/coding-agent/sessions/ (model.ts, plan.ts, prompt.ts, mod.ts),
  packages/coding-agent/cli/commands/session.ts(plan)
- 쓰는 contract: C-session, C-harness(catalog·감지), shell terminal host
  spawn(executable·argv·cwd·env(`LOPHN_CONNECTION` 참조 포함)·prompt_delivery)
- 내놓는 contract: C-session의 CodingAgentLaunchPlan과 `lophn session plan`
  입출력
- slice: coding-agent
- 조사: docs/research/coding-agent-session-launch.md
- 선행: T28, T27, contracts#T42, contracts#T43
- 완료:
  - 시작은 ticket·harness·방식 하나, 방식은 자기 터미널 안내와 terminal_tui
    둘만(R1)
  - plan은 shell main이 넘긴 ticket·revision·connection·cwd와 catalog·현재
    감지로 executable 재확인·분리 argv·env
    이름·first_prompt·prompt_delivery(argv 또는 stdin_after_ready, readiness
    신호·deadline 10,000ms)를 만든다. human_start_handle 없이는 shell이
    spawn하지 않는다는 contract 테스트(R2)
  - first_prompt는 지정 ticket 읽기·MCP claim→작업→보고 지시와 근거 읽을 곳만,
    token·전체 log·묶음 없음. source·project가 없으면 임의 cwd 대신 연결
    안내(R3)
  - executable 이동·다른 profile·미지원 version·회수·이미 claim된
    ticket·needs_confirmation이면 conflict·unavailable과 다음 행동, 다른
    harness·재감지·재발급 없음(R4, harnesses#R5)
  - 공백·줄바꿈·shell 문자가 분리 인자나 PTY 입력으로만 들어간다.
    argv·`--prompt`·`--prompt-interactive` adapter(Claude Code, Codex, OpenCode,
    Gemini CLI, pi)는 harness가 스스로 submit하므로 추가 stdin 입력이 없다.
    stdin_after_ready는 검증한 composer readiness evidence가 있는 adapter만,
    deadline 10,000ms는 spawn부터 센다. write를 시도한 뒤 결과를 모르면
    unknown이고 재전송하지 않는다. Windows의 `.cmd` shim은 줄바꿈 prompt를
    argv로 넘기지 않고 미지원과 자기 터미널 안내로 끝낸다(R5; 조사 T6)
  - folder trust·MCP 승인 같은 harness 자체 trust를 미리 써 넣지 않는다(Orca의
    pretrust를 버림, R2)
  - env는 overlay(TERM 등 안전 값, `LOPHN_CONNECTION` 참조,
    `LOPHN_TERMINAL_OBSERVE`는 host가)와 삭제(상속된 다른 terminal·connection
    식별 값)를 나눠 plan에 담는다
  - 재시작·실행 실패 뒤 자동 spawn·재전송 없음, resume 실행 없음(R10)

### T39 session 관측

- 등급: 기본
- concern: coding-agent/sessions, coding-agent/harnesses
- 요구: coding-agent/sessions#R6, R7, R8, R9, R10; coding-agent/harnesses#R11
- 자리: packages/coding-agent/sessions/observe/ (harness별 normalizer),
  packages/coding-agent/cli/commands/session.ts(observe),
  packages/coding-agent/harnesses/catalog/(status hook target)
- 쓰는 contract: C-session의 관측 socket NDJSON(terminal host가
  runtime_ref·generation을 붙여 shell main에 넘김)
- 내놓는 contract: C-session의 HarnessSessionObservation과 socket NDJSON
- slice: coding-agent
- 조사: docs/research/coding-agent-session-launch.md
- 선행: T38, contracts#T42
- 완료:
  - 상태 starting·ready·working·waiting_input·ended·unknown, evidence 시각·출처,
    관측 없음·낡음은 unknown, process exit는 ended이지 ticket 완료가 아니다.
    normalizer: Gemini `Notification`의 `notification_type=ToolPermission`은
    waiting_input, pi `agent_settled`는 ready(`agent_end`보다 강함), pi
    `session_shutdown`·done·idle만으로는 ended가 아니다(R6; 조사 T6)
  - native session ID는 hook·plugin·extension·session file evidence에서만,
    없으면 null, 터미널·connection·`ses` ID로 채우지 않는다. pi는 ID와 session
    file을 나누고 미검증 Hermes·OpenClaw는 unknown(R7)
  - 자기 터미널 session은 lophn 시작·소유·prompt 전달을 표시하지 않고
    connection·cwd가 같아도 합치지 않는다(R8)
  - 관측이 claim을 만들거나 연장·해제하지 않는다(R9)
  - lophn 재시작 뒤 unknown, 재관측만 허용(R10)
  - `lophn session observe --hook <harness>`가 payload를 정규화해
    LOPHN_TERMINAL_OBSERVE socket에만 쓰고, env가 없으면 아무것도 보내지 않는다.
    Gemini CLI hook env sanitizer처럼 env가 hook까지 살아남는지 version마다
    다르므로 catalog에 검증 결과를 두고 미검증은 unknown. 관측 socket은
    observation 전용이고 connection credential과 섞지 않는다. 상태 hook target은
    검증 version만 설치(harnesses#R11)

### T40 연결 회수

- 등급: 기본
- concern: coding-agent/connection, coding-agent/cli, coding-agent/tickets
- 요구: coding-agent/connection#R2, R8, R18; coding-agent/cli#R7;
  coding-agent/tickets#R13, R14
- 자리: packages/coding-agent/cli/commands/connection.ts(revoke)
- 쓰는 contract: C-연결, platform approvals, shell confirmation window·결정 화면
  링크, apps 앱 통로(회수 뒤 direct call 거절)
- 내놓는 contract: 없음
- slice: coding-agent
- 조사: docs/research/coding-agent-connection-credential.md
- 선행: T36, T19, platform#T21, platform#T22, contracts#T13, apps#T10
- 완료:
  - 회수는 confirmation window에서만, CLI `connection revoke`는 결정 화면
    링크·대기 사실만 출력(connection#R2, cli#R7)
  - 회수 직후 살아 있는 MCP·CLI·direct-call 요청이 거절되고 claim 정리 전에도
    허용 유예가 없다(connection#R8, tickets#R13)
  - 정리 뒤 ticket은 open, 과거 결과 보존(tickets#R14)
  - 외부 프로세스·OS 파일 편집을 멈췄다고 표시하지 않는다(connection#R18)
  - 회수 결정의 confirmation window 근거·창 닫기·침묵 무변경을 core 통합
    테스트로 확인한다. 화면 E2E는 shell#T50 뒤 T41에서 돈다

### T41 coding-agent slice E2E

- 등급: 기본
- concern: coding-agent/connection, coding-agent/harnesses,
  coding-agent/sessions, coding-agent/tickets
- 요구: coding-agent/connection#R1, R8, R18; coding-agent/sessions#R1, R2, R3,
  R5, R9; coding-agent/tickets#R11, R14, R17, R18, R19
- 자리: e2e/coding-agent/ (connect-coding-agent, start-coding-agent,
  manage-coding-access, manage-tickets, new-app 전체),
  tools/fake-coding-agent/(fake harness TUI 모드), fixtures/(fake harness 실행
  파일과 테스트 catalog)
- 쓰는 contract: 위 작업 전부, shell 화면(설정의 연결, app-detail의
  ticket·[Start], 터미널 탭)
- 내놓는 contract: 없음
- slice: coding-agent
- 조사: docs/research/coding-agent-session-launch.md,
  docs/research/coding-agent-harness-integration.md
- 선행: T25, T26, T27, T32, T34, T35, T37, T39, T40, lophn-agent#T49, shell#T25,
  shell#T47, shell#T49, shell#T50, shell#T51
- 완료:
  - fake harness: PATH fixture로 감지되고 테스트 catalog의 ExecutionSpec(argv
    prompt, stdin_after_ready 둘 다)을 따르는 TUI 흉내. 받은 prompt로 MCP
    claim→작업→보고를 돈다
  - connect-coding-agent, start-coding-agent, manage-coding-access,
    manage-tickets flow E2E가 Playwright(Electron)로 돈다. 다른 갈래: keychain
    잠김, 사람 수정 충돌, 미검증 version의 [Start] 막힘, readiness timeout
    unknown, 만료 뒤 재[Start], 취소
  - new-app flow를 처음부터 끝까지(App Engineer ticket → [Start] → claim →
    release 준비 → 보고 → 검사)
  - 일곱 제품 adapter의 설치 fixture 테스트를 모아 돌린다(connection#R1)

## problems slice

### T42 repair context 조립과 대표 근거

- 등급: 기본
- concern: coding-agent/repair-context
- 요구: coding-agent/repair-context#R1, R2, R3, R4, R5, R6, R7, R8, R9, R10,
  R13, R14, R18, R19, R20
- 자리: packages/coding-agent/repair-context/ (model.ts, assemble.ts, select.ts,
  sections.ts, mod.ts), apps/worker의 coding-agent kind
- 쓰는 contract: problems 문제·Report·Snapshot read, apps releases·invocations
  read, problems repairs·tests read, C-ticket read, platform
  read·blob·redaction, C-연결(scope)
- 내놓는 contract: C-수리자료의 summary·bundle 조립(RPC 연결은 T43)
- slice: problems
- 조사: docs/research/coding-agent-repair-context.md
- 선행: problems#T6, problems#T14, problems#T17, T24, contracts#T44,
  platform#T15, platform#T16, platform#T28
- 완료:
  - 요청마다 현재 정본을 읽어 조립, observed_at·basis·증상 관찰 시각·발생
    release·기준 commit, 저장 없음(R1)
  - ticket의 여러 문제를 문제별로, ticket 준비 전 조사는 문제 하나·ticket null,
    code 작업 시작 안내는 담당 agent의 ticket 준비로(R2)
  - 15절 순서 고정, 내용도 누락 사실도 없는 절만 뺀다(R3)
  - 머리 6줄, 증상 문제당 1줄·전체 2줄, 사람 원문 5줄·문제당 300자, 볼 곳
    10줄·5개, acceptance·지킬 것 8줄·200자 요약과 전체 읽을 곳, 실패 invocation
    15줄, 대표 발생 3개·30줄·400자, 직전 변화 12개·14줄·100자, log 45줄, 지난
    고친 기록 5개·10줄, 관련 문제 묶음당 5줄·10개, 첨부 40줄·이미지 metadata
    20개·command 결과 3행, 재현 6줄·500자, more 5줄, 반환 4줄(R4–R10)
  - 대표 발생: 첫·마지막·fingerprint 불일치 최대, 동률은 낮은 Report seq, 반복
    조립 결과 같음(R13). 직전 변화: 첫 발생 7일 전~지금, 거리순·같은 거리는 낮은
    seq, 원인 단정 없음(R14)
  - 없음·부분·미검증·redaction·범위 거절·잘림을 summary에서도 숨기지 않는다(R18)
  - 모든 참조 scope 검사·redaction, 사람 말·앱 문자열·log는 data fence 안. fence
    delimiter·경고 문구·escape 순서(fence 문자열이 자료 안에 있을 때 포함)를
    상수로 고정하고 악성 지시·fence 탈출 fixture로 테스트한다(R19)
  - 계수 단위: `자`는 Unicode code point, 줄은 CRLF·CR을 LF로 바꾼 logical
    line(끝 newline은 줄을 더하지 않음). 대표 발생의 fingerprint 불일치 점수식을
    코드 상수로 고정한다(R5–R10, R13; 조사 T8)
  - 읽기 전후 claim·문제·ticket 상태 같음, raw log 기본 전송 없음(R20)

### T43 repair context 예산·추가 근거·cursor·이미지

- 등급: 기본
- concern: coding-agent/repair-context
- 요구: coding-agent/repair-context#R11, R12, R15, R16, R17, R19
- 자리: packages/coding-agent/repair-context/ (budget.ts, cursor.ts, more.ts),
  core의 `/v1/repair_context/summary|bundle|more` 등록(worker 전달)
- 쓰는 contract: platform redaction·blob·worker 요청 전달, apps releases(source
  diff 보존 참조), problems snapshots(첨부·화면)
- 내놓는 contract: C-수리자료 RPC
- slice: problems
- 조사: docs/research/coding-agent-repair-context.md
- 선행: T42, platform#T12
- 완료:
  - summary 문제당 2줄·전체 10줄·1,200자, 전체 묶음과 추가 텍스트 페이지는
    24,576 UTF-8 bytes와 300줄 둘 다, 누락 표시·이어 읽기 안내도 예산 안,
    다국어·한 줄 큰 자료 테스트(R11)
  - 초과 시 log → 대표 excerpt → 첨부 metadata 순으로 줄이고 생략 지점마다
    잘림·원래 범위·실제 추가 읽기, 그래도 넘치면 필수 참조·상태만 남기고 페이지
    참조. code point·JSON 구조 중간을 자르지 않는다(R12)
  - more: log 200줄·occurrences 20개·source_diff 300줄·screen 24,576 bytes, 조건
    유지 cursor로 누락·중복 없이(R15)
  - source diff는 첫 발생 전 고정 release와 현재 고정 release, 보존 근거 없으면
    이유만, 현재 파일로 보충 없음(R16)
  - image는 redaction 뒤 2,097,152 bytes까지 image content, 미지원 통로는 허용
    첨부 열기 참조·종류·크기, base64를 텍스트에 넣지 않음(R17)
  - cursor는 서버 MAC 붙인 opaque값(connection principal·app/problem·kind·고정
    참조·filter·offset, 길이 상한), 다른 대상·kind·filter 재사용·변조는
    invalid_input, 매 페이지 scope·회수 재검사, worker 재시작으로 key가 바뀌면
    첫 페이지 안내. 발생 목록처럼 자라는 목록은 첫 페이지의 Report seq
    high-water mark를 cursor에 묶어 누락·중복 없이 읽는다(R15, R19;
    GitHub·Sentry cursor는 서명이 없어 버림, 조사 T8)
  - 잘림 marker·누락 표시·more 안내·fence도 24,576 bytes·300줄 안에
    센다(Codex·OpenCode는 marker를 cap 밖에 둠, 조사 T8)(R11, R12)

### T44 MCP·CLI 문제 tool과 사람의 문제 command

- 등급: 기본
- concern: coding-agent/mcp-server, coding-agent/cli
- 요구: coding-agent/mcp-server#R24, R25; coding-agent/cli#R7, R26, R33, R34,
  R35
- 자리: packages/coding-agent/mcp-server/tools/problem.ts,
  packages/coding-agent/cli/commands/problem.ts
- 쓰는 contract: C-수리자료, problems 문제·snapshot·고친 기록 read, problems
  repairs(RecordProblemFix), problems tests(reproduction RequestTest), problems
  feedback(제출), problems closing(사람 확인·무시는 결정 화면), C-ticket
- 내놓는 contract: 없음
- slice: problems
- 조사: docs/research/coding-agent-mcp-server.md,
  docs/research/coding-agent-repair-context.md
- 선행: T43, contracts#T44, problems#T14, problems#T15, problems#T18,
  problems#T21
- 완료:
  - `lophn_problem` list(앱·진행 상태·처리
    대상)·show·snapshot·fix_records·summary·bundle·more, 추가 조회가 claim을
    만들거나 갱신하지 않는다(mcp#R24, cli#R33)
  - record_fix·test(reproduction)는 지정 ticket의 현재 claim 필수, 문제 직접
    claim·별도 시도 단계·workflow·test result 입력·문제 닫힘 없음, 과거 ticket
    없는 기록은 조회만(mcp#R25, cli#R34)
  - `app test --kind reproduction` 요청과 실제 결과 read(cli#R26)
  - `problem attachment open`은 scope 검사한 허용 첨부만, 운영 경로 대신 안전한
    참조(cli#R33)
  - lead 결정(D27, problems/feedback#R1): CLI는 feedback을 접수하지 않는다.
    `problem report`는 shell의 문제 알리기 화면을 여는 안내만,
    `request-repair`는 담당 agent의 ticket 준비 화면 링크, `confirm|dismiss`와
    "내가 확인함"은 결정 화면 링크와 대기 사실만 출력한다. coding credential은
    거절하고, 요청만으로 문제를 닫거나 coding agent를 띄우지 않는다. cli#R35는
    이 PR에서 이 모양으로 고친다(cli#R7, R35; 질문 Q1)

### T45 repair ticket 검사: reproduction·problems_closed·human_confirmation

- 등급: 기본
- concern: coding-agent/tickets
- 요구: coding-agent/tickets#R9, R20, R21
- 자리: packages/coding-agent/tickets/checker/
- 쓰는 contract: problems tests(reproduction Verification), problems
  closing·grouping read와 event(`ProblemClosed`, `ProblemReopened`), problems
  repairs read, platform confirmation 결과(사람 확인)
- 내놓는 contract: 없음(C-ticket record_checks 확장)
- slice: problems
- 조사: docs/research/coding-agent-ticket-claim.md
- 선행: T26, problems#T18, problems#T20, problems#T21
- 완료:
  - reproduction_test는 해당 문제·고정 test_hash·보고 after release의
    Verification만, human_confirmation pass는 "내가 확인함"이고 Verification이
    아니다(R9)
  - problems_closed는 problems/closing이 먼저 판정한 닫힘과 이번 보고의 고친
    release를 읽고, 보고·확인됨·취소로 문제를 닫지 않는다(R21)
  - `ProblemClosed`·`ProblemReopened`에서 남은 조건 재비교, 재시작 뒤
    이어서(R20)
  - 일부 문제만 통과·전부 제외에서 자동 confirmed가 없다(R9)

### T46 사람 화면의 repair ticket 준비와 수리 요청

- 등급: 기본
- concern: coding-agent/tickets
- 요구: coding-agent/tickets#R24, R26
- 자리: packages/coding-agent/tickets/ (prepare.ts, reads.ts)
- 쓰는 contract: problems 문제·snapshot read, problems tests(reproduction 기준
  유무), lophn-agent App Engineer 연결(ticket 준비 요청), C-ticket create
- 내놓는 contract: C-ticket의 사람 화면 repair 준비 read·create 입력
- slice: problems
- 조사: docs/research/coding-agent-ticket-claim.md
- 선행: T18, T45, lophn-agent#T50
- 완료:
  - 열린 문제 하나에서 제목·무엇과 왜·고정 근거·acceptance check를 기존
    증상·채택 자료로 준비, 생성 검사를 완화하지 않는다(R26)
  - reproduction test를 만들 수 없으면 human_confirmation 조건만, 없는
    reproduction 기준·채택 답을 만들지 않는다(R26)
  - 근거가 부족한 수리는 needs_confirmation ticket과 담당 App Engineer 연결, 새
    구현 요청은 대화로(R26, lead 결정)
  - 수리 요청은 ticket 준비로만 이어지고 priority·요청 표시로 자동 시작·approval
    생성이 없다(R24)

### T47 수리 flow의 coding agent 단계

- 등급: 기본
- concern: coding-agent/repair-context, coding-agent/tickets,
  coding-agent/connection
- 요구: coding-agent/repair-context#R3, R11; coding-agent/tickets#R11, R15;
  coding-agent/connection#R5, R8
- 자리: tools/fake-coding-agent/(수리 script), e2e/coding-agent/repair-steps
- 쓰는 contract: T42–T46
- 내놓는 contract: 없음
- slice: problems
- 조사: docs/research/coding-agent-repair-context.md
- 선행: T44, T45, T46
- 완료:
  - fake coding agent의 수리 script: repair ticket claim → summary·bundle·more →
    reproduction test → record_fix → release 준비 → report
  - app-broken·verify-app-repair의 coding agent 단계 통합 테스트(범위 밖·회수된
    연결의 수리 요청 거절 갈래 포함). problems 팀의 flow E2E(problems#T24,
    T25)가 이 script를 쓴다

## operations slice

### T48 오프라인 MCP 시작

- 등급: 좁은
- concern: coding-agent/connection, coding-agent/mcp-server
- 요구: coding-agent/connection#R16; coding-agent/mcp-server#R1
- 자리: packages/coding-agent/mcp-server/ (실행 argv),
  e2e/coding-agent/offline-mcp
- 쓰는 contract: platform 설치 자원(Deno 실행 파일·cache·resources 경로)
- 내놓는 contract: 없음
- slice: operations
- 조사: docs/research/coding-agent-mcp-server.md
- 선행: T11, platform#T48, platform#T49
- 완료:
  - 설치 자원으로 network를 끊고 `--cached-only`로 initialize·tools/list 성공,
    시작 download·npx·원격 import 없음(connection#R16, mcp#R1)
  - work-offline 2단계의 패키지 MCP 연결 갈래

## 요구 덮기

| concern                     | 요구 수 | 덮은 수 | 작업                                                                                                    |
| --------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------- |
| coding-agent/connection     | 18      | 18      | T9, T10, T11, T14, T15, T16, T19, T21, T24, T29, T30, T31, T32, T36, T40, T41, T47, T48                 |
| coding-agent/harnesses      | 12      | 12      | T28, T29, T30, T31, T32, T35, T36, T38, T39                                                             |
| coding-agent/sessions       | 10      | 10      | T19, T38, T39, T41                                                                                      |
| coding-agent/mcp-server     | 37      | 37      | T11, T13, T14, T15, T16, T17, T20, T21, T22, T23, T25, T31, T34, T36, T44, T48                          |
| coding-agent/cli            | 41      | 41      | T12, T13, T14, T15, T16, T17, T20, T21, T22, T25, T28, T29, T30, T31, T32, T33, T34, T36, T37, T40, T44 |
| coding-agent/guides         | 26      | 26      | T29, T30, T31, T33, T34, T35                                                                            |
| coding-agent/repair-context | 20      | 20      | T42, T43, T47                                                                                           |
| coding-agent/tickets        | 27      | 27      | T18, T19, T20, T24, T26, T27, T40, T41, T45, T46, T47                                                   |
| 합계                        | 191     | 191     |                                                                                                         |

조사 작업(T1–T8)의 `요구:`는 조사 범위 표시이고 위 덮기에는 구현 작업만 셌다.

## 질문

- **Q15 ticket claim의 readiness.** coding-agent/tickets#R11 본문은
  needs_confirmation ticket도 claim할 수 있다고 적고, T19 완료 줄과
  checkTicketClaim의 not_ready 거절은 ready만 허용한다. 구현은 완료 줄을
  따랐다(needs_confirmation은 conflict). 추천: 완료 줄과 같다. claim은 ready만
  받고, R11 본문을 그 기준으로 고친다. 사람이 정하기 전에는 바꾸지 않는다.
- **Q1 사람 전용 CLI command의 actor.** (정함, 추천안) CLI는 user token 파일을
  읽지 않는다(architecture 1절). core에 user actor로 쓰는 사람 전용
  command(`ticket create|cancel`, `problem report|request-repair`,
  `connection list|show`)는 무엇으로 인증하나. 추천: core에 쓰는 사람 전용
  command는 결정 화면 링크(`lophn://…`, contracts/shell)로 shell 화면에 넘기고
  사람이 그 화면에서 누르면 shell main이 user credential로 쓴다. 로컬 파일만
  쓰는 `harness …`, `skills …`, `mcp config`, `doctor`는 credential 없이,
  `daemon …`은 platform의 로컬 시작 contract로 한다. problems 팀도 같은 방식을
  추천했다(feedback은 shell 사람 제출만, problems/feedback#R1). platform 팀에
  확인 요청을 보냈다.
- **Q2 앱 log 줄 수.** coding-agent/mcp-server#R32, cli#R24는 요청 1~2,000줄인데
  apps/runtime#R27은 한 번에 200줄이다. 추천: 한 번에 1~200줄과 cursor 이어
  읽기로 맞추고 T21 PR에서 두 요구를 고친다(MCP 출력 상한에도 맞다).
- **Q3 command environment 이름.** architecture 5.2의 `preview|production`을
  apps·shell wire의 `preview|live`로 맞춘다(apps 팀 합의). T21 PR에서
  architecture를 고친다.
- **Q4 validate op.** apps에 별도 blueprint 검사 RPC가 없어 `validate`를
  `prepare_bundle`의 diagnostics·bundle_hash로 잇는다(apps 팀 합의).
- **Q5 연결 생성의 확인 창.** (정함) architecture/platform.md의 "보호 화면의
  exact scope 결정"은 connection#R2·D19와 달랐다. platform 팀이 skeleton T5
  PR에서 "사람의 harness 연결·범위 선택이 허락, 회수만 confirmation window"로
  고친다(platform 계획 Q16).
- **Q6 [Start] TUI의 credential 전달.** (정함) TUI 프로세스에는
  `LOPHN_CONNECTION=<cac>` 참조만 가고 token은 가지 않는다. 그 아래 lophn
  MCP·CLI child가 platform#T34의 loader로 받는다. TUI 전용 보호 전달은
  없다(platform 팀 합의). T38의 plan은 credential_handle 대신 connection 참조
  env만 담는다.
- **Q7 hook의 env 상속.** 관측 socket 경로(LOPHN_TERMINAL_OBSERVE)는 TUI env로
  넘긴다. 조사(T6): Gemini CLI는 hook env를 sanitize하고 그 allow 목록은
  확인하지 못했다. harness version마다 실제 전달을 테스트해 catalog에 표시하고,
  전달되지 않으면 그 harness의 lophn 시작 session 상태는 unknown이다(T39).
- **Q8 MCP tool과 lophn agent tool의 공통 계약.** coding-agent/mcp-server#R2의
  "공통 tool 계약"은 core RPC의 actor×동작 허용 목록(platform 인증)으로 읽는다.
  추천: MCP registry와 lophn agent tool registry는 따로 두고 둘 다 같은 core
  RPC와 허용 목록을 쓴다.
- **Q9 core→worker 요청 전달.** `/v1/coding_agent_sessions/summary`와
  `/v1/repair_context/*`는 core가 받고 coding-agent worker가 조립한다.
  platform#T12(file·worker 전달 route)를 쓴다(T35, T43 선행).
- **Q10 fake coding agent 자리.** `tools/fake-coding-agent/`를 개발 도구로
  둔다(code-map의 tools/). apps·problems 팀 E2E도 쓴다.
- **Q11 ticket readiness(lead 결정).** (정함)
  `readiness: needs_confirmation | ready`를 T18에서 넣고
  coding-agent/tickets#R2, R5, R6, R11, R26, R28과 domain model을 같은 PR에서
  고친다.
  needs_confirmation → ready는 새 command `ticket.make_ready`(근거·채택
  답·조건을 한 번만 채우고 그 뒤 불변), event `TicketMadeReady`.
- **Q12 daemon 시작·중지 contract.** (정함) platform#T55(coding-agent slice)가
  launcher 시작·single-instance 종료·`H/run` metadata·`H/logs`를 내놓는다.
  metadata schema는 platform이 contracts 팀에 요청한다.
- **Q13 project 읽기 필드.** coding-agent/mcp-server#R9·cli#R22는 "등록
  폴더·label·폴더별 문서 수"를 보이라고 하지만 documents/projects#R9와
  projects#Q2 결정은 agent·coding agent에게 절대 경로·폴더별 문서 수를 주지 않고
  label을 없앴다. 추천: documents 쪽을 따르고 T13 PR에서 두 요구를 고친다.
- **Q14 context 변경 제안의 전달.** (정함) coding agent 제출로 run을 만드는
  통로는 일부러 없다(lophn-agent/run-loop#R1, handoff#R1·R5). propose는 변경안
  문서 주소와 "사람이 Context Engineer에게 맡기라"는 안내만 돌려준다.
  coding-agent/cli#R19의 "담당 agent가 … 연결하게 하며"는 사람이 그 주소로
  요청하면 Context Engineer가 질문으로 잇는다는 뜻으로 T17 PR에서 문장을 맞춘다.
- **Q15 다른 제품의 시작 summary hook.** (정함, 추천안) 조사(T7)에서
  Codex·Gemini CLI의 SessionStart hook도 출력을 context에 넣는다는 것이
  확인됐다. coding-agent/guides#R25는 summary hook을 Claude Code에만 둔다. 추천:
  첫 판은 R25대로 Claude Code만 두고, 나머지는 명시 summary 조회 안내를
  유지한다. 확대는 별도 결정으로 남긴다.
- **Q16 blueprint 유래 tool 이름.** architecture 5.2의
  `lophn_app_<app-id>_<sha16>`은 app ID가 30자(`app_` + ULID)라 Gemini CLI의
  63자 상한(`mcp_lophn_` 포함)을 넘어 가운데가 해시 없이 잘린다(조사 T1). 추천:
  `lophn_app_<app ID sha256 앞 12자>_<command 이름 sha256 앞 16자>`(39자). T23
  PR에서 architecture 5.2와 mcp-server#R34 확인 문장을 고치고 contracts#T50의
  이름 규칙도 같이 바꾼다. contracts 팀에 알렸다.
- **Q17 MCP 안의 keychain loader와 실행 권한.** (정함) MCP server는 harness가
  직접 띄워 lophn 부모 프로세스가 없고, FFI 없이 keychain을 읽으려면 OS 명령
  실행이 필요하다(조사 T3). platform#T34가 helper `lophn-credential`(OS keychain
  도구 실행만 허용한 고정 권한 compile binary, 설치 묶음의 고정 절대 경로)을
  만들고 MCP·CLI에는 `--allow-run=<helper 절대 경로>`만 준다. 통로는 stdin
  참조·stdout token, timeout 5초, 잠김·Secret Service 없음·timeout은 다른 이유의
  unavailable. 같은 OS 사용자의 다른 프로세스가 helper를 부를 수 있는 한계는
  platform/security#R2 범위 밖으로 받아들인다. contracts Q9(`mcp_cli_loader`만,
  `CredentialDeliveryRequest`·실패 이유 넷)에 맞춰 architecture/coding-agent
  2.2·2.3, domain-model connection·sessions, connection#R17을 T9 PR에서 고쳤다.
- **Q18 문제마다의 human_confirmation.** coding-agent/tickets#R9는 수리 문제마다
  reproduction test 또는 사람 확인을 허용하지만 domain model의
  human_confirmation은 추가 필드가 없어, 문제가 여럿이면 어느 문제를 대신하는지
  알 수 없다(조사 T4). 추천: human_confirmation에 `problem`(Ticket.problems의
  항목)을 두고 ready 검사는 "문제마다 reproduction_test 또는 human_confirmation
  하나"로 한다. T18 PR에서 domain model을 고친다.
- **Q19 pi MCP 설치 자리.** architecture 5.5와 domain model harnesses 표는 pi에
  "미리 설치된 exact MCP adapter의 `.mcp.json` 또는
  `~/.pi/agent/mcp-adapter.json`, `directTools:true`"를 적었지만 조사
  revision(8369268)의 pi는 native `~/.pi/agent/mcp.json`과 trusted
  `<cwd>/.pi/mcp.json`을 쓰고 그 adapter 파일·필드가 없다(조사 T5). 추천:
  catalog는 검증 version별 target을 갖고 T31 PR에서 두 문서 표를 native 형식으로
  고친다.
- **Q20 discovery schema의 2,000 token 목표 차이.** (추천안)
  coding-agent/mcp-server#R4의 전체 2,000 token 목표는 schema만 줄여서는 못
  이룬다. 실제 tokenizer(js-tiktoken 1.0.21의 cl100k_base)로 전 12,268 token /
  43,393 bytes → 후 4,704 token / 19,488 bytes(전체 toolset), core 3,273
  token이다. 남은 차이는 약 2,700 token으로, 도구 목록 자체(lophn 문제·승인·문서
  주소 등 도메인 이름과 필수 필드)가 차지한다. 펴기는 op·kind union의 member마다
  있던 required를 걷어낸다(discriminator만 required로 남긴다). 다음 수단(추천
  순서): 1) toolset 기본을 끄고 started tool만 내보내기(core 3,273 token이라
  목표에 여전히 못 미치지만 R3의 기본 core만 정책과 맞다), 2) Sentry MCP처럼
  검색·실행 catalog tool 몇 개로 통합해 tool 수를 줄인다(T13 이후 tool 자리를
  다시 정할 때), 3) 목표를 요구 문서에서 완화해 측정치 기록으로 바꾼다. 추천:
  1·2를 T13(문서 읽기 tool) 설계 시 함께 판단하고 그때까지 측정치를 테스트가
  출력하게 둔다.
