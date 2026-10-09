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

- 상태: 완료 (#307) — 이어보냄: CLI 쪽 문서 읽기 command 실행·시험(cli R11~R14, R22, `cliDocumentHistorySchema`의 section, CLI 6단계 통합 시험) → T36
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
    읽을 자료 참조(연결 context는 대상이 문서·app command뿐이라 Q30). 절대
    경로·파일 목록·폴더별 문서 수·label·tracking 규칙
    없음(documents/projects#R9, projects#Q2). current는 cwd로 가장 깊은 등록
    root의 project 참조만, 불일치는 빈 목록과 등록 안내. mcp-server#R9와
    cli#R22의 "label·폴더별 문서 수" 문장은 이 PR에서 documents/projects#R9에
    맞게 고쳤다(mcp#R9, cli#R22; 질문 Q13)
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

- 상태: 완료 (#264) — 이어보냄: CLI `save`·`format validate`의 core dispatch 연결(`runSave` 등), production credential provider와 MCP runner 배선 → coding-agent#T36. 실제 core·documents worker·I/O worker로 `saveFromPaths`·`lophn_save`·`lophn_format`·`lophn_series`가 끝까지 도는 시험은 `apps/core/documents-save-e2e_test.ts`다
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
    제목·format·series·key(메모·tag는 documents에 둘 곳이 없어 받지 않는다. Q22), 고정 주소·판·unchanged·검사 경고. 재전송은
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

- 상태: 완료 (#317) — 이어보냄: CLI core 실행 배선·`forbidden` data root·실제 app scope 발급 → coding-agent#T36. 남은 platform 읽기 operation 검사는 "## 질문" Q31
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
  - 구현 메모(T15):
    - 범위 밖 읽기의 거절은 core client 한 곳에서 같게 만든다. core가 준 `not_found`는
      메시지·details를 버리고 "현재 연결로 읽을 수 없다. 없는 대상이거나 이 연결의
      범위 밖이다"(`UNREADABLE_MESSAGE`) 하나로 바뀐다. MCP와 CLI가 이 client를 같이
      지나므로 두 통로의 거절이 같다. 앱 하나 연결 credential의 scope는 platform이
      `scope.targets`(`place_kind`·`place`)로 판정하고, documents의 읽기가 그 판정으로
      범위 밖 문서를 없는 문서와 같은 답으로 닫는다. 시험의 credential은 그 모양으로 직접
      만든다(실제 발급은 T36).
    - 금지 목록은 `connection/policy.ts`의 `FORBIDDEN_ROUTES`(금지 작업 → 소유 route
      이름)와 `HUMAN_ONLY_DOCUMENT_ROUTES`다. 시험이 이름이 계약 표에 있는지, 두
      통로의 표가 부르는 route가 금지 route가 아니고 모두 `coding_agent` actor를
      받는지 본다. daemon 시험(`apps/core/coding-agent-scope_test.ts`)은 제품 core의
      팀 조립 그대로 띄운 core에 허용 operation만 가진 연결과 금지 operation을 직접 열어
      준 연결로 금지 route를 모두 보내 거절을 본다.
    - fixture `fixtures/projects/two-apps/`는 앱 source 폴더 둘이다.
    - 계약 보정: `ListBackups`·`GetBackup`·`ListSecrets`의 actor에서 `coding_agent`를 뺐다
      (platform 계약, daemon이 actor로 거절). `outline.root`의 `unplaced` 묶음은 target 없는
      판정이 통과할 때만 낸다(앱 하나 범위 연결에는 건수도 없다).
    - 이어보냄: CLI core 실행 배선·`forbidden` data root·실제 app scope 발급 → T36.

## agent slice

### T16 question·approval 읽기 tool

- 상태: 완료 (#280) — 이어보냄: CLI `question`·`approval` list·show·open의 core dispatch 연결(`runQuestionOpen`·`runApprovalOpen`)과 production credential provider·MCP runner 배선 → coding-agent#T36. 제품 core가 approvals를 아직 서빙하지 않는다(platform의 approval 등록이 core 조립에 없어 `approvals/*` command는 "등록되지 않은 command다"이고, route는 contract ROUTES에 이미 있어 team 등록으로 더하면 겹친다): `lophn_approval`은 읽기 route만 부르고 그 응답을 isError로 그대로 낸다. 실제 approval read·create executor를 지나는 시험은 `apps/core/coding-agent-approvals_test.ts`(ledger harness), 실제 core로 질문이 끝까지 읽히는 시험은 `apps/core/coding-agent-decisions_test.ts`다. platform의 approval 등록을 core 조립에 넣는 일(grant·reject는 platform#T22)은 platform 몫이다. 질문의 prompt·reason·선택지 설명 blob은 `general_read: false`라 coding credential이 원문을 읽지 못하고 tool은 blob 참조(hash)만 낸다(approval blob은 `general_read: true`지만 blob read op는 tool 표에 없다). 답 접수 뒤 적용(`applied`)은 option action 적용(lophn-agent#T29)이 오기 전까지 항상 false다
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

- 상태: 완료 (#279) — 이어보냄: CLI `context` 읽기·`context propose`의 core dispatch 연결(`runContextPropose` 등)과 production credential provider·MCP runner 배선 → coding-agent#T36. 실제 core·documents worker·I/O worker로 `lophn_context`가 끝까지 도는 시험은 `apps/core/context-tools-e2e_test.ts`다
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
  - propose: 생성·이름 변경·항목 추가와 제거·관점 변경·용어 추가와
    채택 변경안(분할·병합은 documents/contexts가 두지 않아 뺐다. Q27)을
    고정 변경안 문서로 저장(documents#T8)하고 변경안 주소와
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

- 상태: 완료 (#325) — 이어보냄: 앱 통로 production transport·`appDirect` 배선·CLI `runApp` 실행 배선 → coding-agent#T36, `sync_tools` 실제 실행 → coding-agent#T34, `blueprint` core read route → apps#T19(계약 표 생기면 교체)
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
  - 구현 메모(T21):
    - MCP와 CLI는 한 흐름이다: `connection/app-ops.ts`의 `runAppOp`(op → 소유 route 표
      `APP_OP_ROUTES`, 접수·기다림·결과 구별)를 MCP `tools/app.ts`와 CLI
      `commands/app.ts`(`runApp`)가 함께 쓰고, registry·CLI 표의 route도 그 표 하나다.
      앱 통로(direct)는 `connection/app-direct.ts`의 `createAppDirect`(core `apps/connect` →
      서명 envelope → 주입 transport)로 연결 불발(요청 안 나감)과 응답 유실(결과 불명)을
      구별한다.
    - 접수와 기다림: test·preview_start·validate·release_prepare는 접수 뒤 20초(`DEFAULT_WAIT`)
      안에서만 다시 읽고 기다리는 동안 `notifications/progress`를 보낸다(server가 요청의
      `_meta.progressToken`을 `ToolCallContext.progress`로 넘긴다). 끝나지 않으면 접수와
      다음 read를 돌려준다.
    - release_prepare는 ticket_source가 없으면 core에 가지 않고 거절하고, 준비가 끝난 묶음의
      같은 hash app test(ListVerifications)가 없거나 통과하지 못하면 준비를 거절로 낸다.
      다른 hash의 통과는 근거가 아니다.
    - 계약 보정: `release.prepare_bundle`·`release.preparation`의 actor에 `coding_agent`를
      더했다(architecture/apps 7.3이 coding agent 통로의 준비 접수를 말하는데 계약이
      machine 전용이었다; T15의 "모든 op route가 coding_agent를 받는다" 시험이 이를 잡는다).
      확정(`release.prepare`)은 machine 전용 그대로다.
    - 문서 보정(질문 Q2·Q3): log는 한 번에 1~200줄(requirements mcp#R32·cli#R24),
      environment는 `preview|live`(architecture 5.2).
    - 이어보냄: (1) 앱 통로 production transport(unix socket 연결 권한 — 지금 MCP 실행 argv에는
      `--allow-write`가 없다)와 `apps/mcp/main.ts`의 `appDirect` 배선, CLI `runApp` 실행 배선
      → T36. (2) `sync_tools` 실제 실행 → T34(지금은 `unavailable`). (3) `blueprint`의 core
      read route는 apps#T19(`/v1/apps/blueprint`)가 내고 계약 표에는 아직 없다: 계약 표가 생기면
      `APP_OP_ROUTES.blueprint`를 그 route로 바꾼다(지금은 `unavailable`, 성공을 꾸미지 않는다).
      그 밖의 계약 보정과 범위 판정 수정은 "## 질문" Q32.

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
- 상태: 완료 (#358)
- 완료:
  - catalog(설명·API 이름 검색 → 이름·최신 version·종류·한 줄 설명),
    show(API·type·permission·peer·예제), 비설치·없는 package 구별(mcp#R22,
    cli#R30)
  - add: exact version만, 고정 import 안내, `apply`일 때만 source
    반영(변경·무변경·충돌), 범위 version·미설치 version·조용한 upgrade 거절, 두
    번 추가해도 중복 없음(mcp#R23, cli#R30)
  - 개인 SDK는 지원 범위 밖으로 구별해 표시
- apps#T22에서 넘어온 것: `add`가 앱 deno.json의 import map을 고칠 때 `buildImportMap`(`packages/apps/sdk`)이 같은 결과를 내야 한다(설치 사본의 `@lophn/*`·npm import를 따라간 정확한 pin). 바꾼 뒤 개발용 map(`.lophn/import-map.json`, `devImportMap`)과 deno.lock도 다시 만든다
  - 구현 메모(T22):
    - 흐름은 `connection/sdk-ops.ts` 하나를 MCP `lophn_sdk`와 CLI `sdk …`가 같이 지난다.
      통로 입력에 catalog `query`, show `version`, add `apply`·`app`을 더했다
      (`contracts/coding-agent/mcp-app.ts`의 `sdk*Fields`). 더한 field는 소유 route로 보내지
      않는다. catalog 검색은 `packages.list` 결과를 이름·설명으로 거른다.
    - 찾지 못한 이름은 `not_installed`(@lophn)와 `personal_unsupported`(@me)로 구별하고,
      있는 package의 없는 version은 `version_not_installed`와 설치 version 목록이다.
    - apply는 `app.get`의 source 위치의 `deno.json` imports에
      `"lophn-sdk:<name>@<version>": "./sdk/<name>/<version>/"`를 더한다. 같은 항목은
      unchanged, 같은 이름의 다른 version·다른 대상·깨진/없는 deno.json은 conflict이고 원문을
      바꾸지 않는다. changed 뒤에만 lock을 다시 만든다. 파일 쓰기는 주입 port(`SdkSourcePort`)다.
      MCP는 `--allow-write` 없이 뜨므로 port를 주지 않아 apply가 `unavailable`이다(Q33).
    - apps에 source용 import map 생성 함수(buildImportMap)가 main에 아직 없다. key 모양은
      bundle 잠금(`apps/releases/bundle/import-map.ts`의 `sdkPathMap`)과 같게 두었고, apps가
      source용 함수를 내면 `planImportMap`을 그것으로 바꾼다.
    - 이어보냄: CLI `runSdk`의 dispatch 배선과 실제 source port(파일 쓰기·`deno install`로
      lock 재생성) → T36. 안내 원문(API·type·permission·peer·예제) 읽기 → Q33.

### T23 blueprint 유래 앱 read tool

- 상태: 완료 (#357) — 이어보냄: `/v1/apps/blueprint` core read route → apps#T19, `appBlueprint` 배선 → coding-agent#T36
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
  - 구현 메모(T23):
    - `mcp-server/tools/app-commands.ts`의 `createAppCommandTools`가 목록(`list`)과 호출(`call`)을
      맡는다. server(`createHandler`)는 `appCommands`를 받고 app toolset이 켜져 있을 때만
      `tools/list`에 동적 항목을 붙이며(고정 tool은 core에 닿지 않고 답한다), 꺼져 있으면 동적
      이름은 없는 tool(-32602)이다. 앱 목록(`app.list`)이 scope 판정이고 앱 읽기·목록 실패는
      그 앱·동적 목록이 없는 것과 같다. 이름 충돌은 `tools/list`를 JSON-RPC -32603
      `discovery 실패`로 돌려준다.
    - 호출은 `runAppOp({op:"command"})`로 보내므로 preview 기본값·결과 불명·앱 통로 direct
      call이 `lophn_app command`와 같고 core command(ledger 쓰기)는 없다. 정의는 호출마다 지금
      blueprint로 다시 만들고, 마지막 목록에 낸 stamp(앱·release·blueprint hash·정의)와 다르거나
      낸 적 있는 이름이 사라졌으면 `conflict`+`list_changed`+고정 op 안내다. 목록에 낸 적 없고
      지금도 없는 이름(write·external·confirm command, 범위 밖 앱 포함)은 통일 not_found다.
      목록을 낸 적 없는 프로세스는 옛 정의를 알 수 없어 지금 정의로 부른다.
    - blueprint 읽기는 `AppBlueprintSource`(앱 → `{release, blueprint_hash, commands}` | null)
      port다. `apps/mcp/main.ts`의 `appBlueprint` 옵션이 없으면 동적 tool은 나오지 않는다.
      `/v1/apps/blueprint` route는 main에 없어 apps#T19가 내고(T21이 넘긴 `APP_OP_ROUTES.blueprint`
      교체와 함께) source 배선은 T36이 한다. `listChanged` capability는 동적 tool을 켠 서버만 true다.
    - 문서 보정: architecture 5.2의 동적 tool 이름을 Q16대로 고쳤다(contracts#T50의 `appToolName`은
      이미 이 규칙).
    - R4 재측정(cl100k_base): 고정 app 포함 4,303 token, 동적 read command 6개(입력 있음)가
      +879 token이다. 목표 2,000은 여전히 고정 tool만으로 넘는다(T11 질문과 같다).

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
- 상태: 완료 (#413) — 자리는 `packages/coding-agent/tickets/report.ts`다.
  commands.ts의 `createTicketFinishCommands`가 report_completion·cancel을
  내보내고 apps/core/tickets.ts의 `ticketDefinitions`가 등록한다. 제품
  coding_agent operation ceiling이 ticket route를 싣지 않아 실제 coding
  token이 403이던 것은 coding-agent#T36 후속이 고쳤다.

### T25 MCP·CLI ticket tool: 완료 보고·사람의 생성과 취소

- 상태: 완료 (#429) — 정한 것: report 입력은 summary 본문(통로가 upload_summary로 올림)이고 `ticketReportToolInputSchema`로 MCP·CLI가 같다. CLI `ticket create|cancel`은 core에 쓰지 않고 결정 화면 링크(`applied:false`)로 넘기며(Q1) 연결 참조로 시작하면 forbidden이다. 이어보냄: 결정 화면의 취소·생성 열기 → shell#T50, fake coding agent를 new-app·change-app E2E에서 쓰기 → apps#T27
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

- 상태: 완료 (#426)
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

- 상태: 완료 (#430)
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

- 상태: 완료 (#212)
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

- 상태: 완료 (#217) — 이어보냄: Claude·Codex·OpenCode·Gemini adapter의 실제 설정 위치·hook·skill root와 TOML·YAML 소유 key 텍스트 패치 merge(주석·빈 줄 보존), CLI 실행 경로와 파일 쓰기 연결 → T30; Hermes·pi·OpenClaw adapter → T31; loading 검사(harnesses#R10) → T32
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

- 상태: 완료 (#252) — 이어보냄: CLI harness plan·install·update·remove 실행 dispatch가 builder·engine을 부르는 연결 → T36(선택 target 설치 흐름), doctor의 loading 관측 → T32
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
- T29에서 넘어온 것: 이 adapter들의 실제 설정 위치·hook·skill root 적용, TOML·YAML merge가 소유 key만 고치는 텍스트 패치로 사람의 주석·빈 줄을 보존(#217은 전체 재직렬화), CLI harness plan·install·update·remove 실행 경로와 engine 파일 쓰기 연결
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

- 상태: 완료 (#224) — 이어보냄: doctor가 깨진 Hermes YAML을 loading 실패 이유로 내는지 확인 → T32
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
- T29에서 넘어온 것: Hermes·pi·OpenClaw의 실제 설정 위치·hook·skill root 적용(#217 engine 위)
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

- 상태: 완료 (#259) — 이어보냄: apps/cli의 doctor dispatch(실제 daemon·connection·credential port 조립) → T36
- 등급: 기본
- concern: coding-agent/harnesses, coding-agent/connection, coding-agent/cli
- 요구: coding-agent/harnesses#R3, R10; coding-agent/connection#R13, R14;
  coding-agent/cli#R10
- 자리: packages/coding-agent/harnesses/loading.ts,
  packages/coding-agent/cli/commands/doctor.ts. 같은 PR이 harnesses/ 안에
  mcp-probe.ts(설치 Deno로 lophn-mcp를 띄우는 눈), inspect.ts(component와
  loading을 모은 관측), testing/(fixture·MCP 대역)와 catalog 제품별 `loading`
  근거(model.ts `LoadingSpec`)를 더했다
- 쓰는 contract: C-연결(connection 상태 read), platform 인증(credential 사용
  가능 여부)
- 내놓는 contract: C-harness의 HarnessIntegrationObservation JSON
- slice: coding-agent
- 조사: docs/research/coding-agent-harness-integration.md,
  docs/research/coding-agent-mcp-server.md
- 선행: T30, T31, contracts#T42, contracts#T43
- T31에서 넘어온 것: doctor가 깨진 Hermes YAML을 loading 실패 이유(harnesses#R8·R10)로 내는지 확인(#224)
- T29에서 넘어온 것: loading 검사(harnesses#R10)
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

- 상태: 완료 (#454) — 이어보냄: `lophn_problem`·`lophn_session` 본문 일치 확인 → T44·T35. 앱 root 안내가 skill 이름을 가리키는 일 → T34
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
- coding-agent#T36에서 넘어온 것: CLI `skills list|install`은 command 표에 있고 실행은 배포 skill 원본(`packages/coding-agent/guides/skills`, 설치 묶음 `skills/`)이 없어 unavailable이다(apps/cli/dispatch.ts). 원본·설치 입력(이름·설명·version·hash, 동명 비관리 skill 충돌)을 이 작업이 채우면 그 자리에서 `skills`를 harnesses engine(`installSelected`의 `skill` 입력)에 잇는다
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

- 상태: 완료 (#465)
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
- apps#T22에서 넘어온 것: 설치 템플릿의 `AGENTS.md`(`<!-- begin lophn-managed -->`·`<!-- end lophn-managed -->` 빈 쌍과 그 밖의 사람 몫 구간)·`CLAUDE.md`(`@AGENTS.md`)·`.gitignore`(`# begin lophn-managed`·`# end lophn-managed` 빈 쌍)를 `packages/apps/sdk/template/app/`(원본 이름은 `*.tmpl`)에 두었다. 관리 구간 본문을 `packages/coding-agent/guides/templates/`에서 채울 때 같은 PR에서 이 원본을 고치고 `packages/apps/sdk/template/pin.ts`의 `TEMPLATE_HASH`를 `template_test`가 알려 주는 값으로 바꾼다
- coding-agent#T21에서 넘어온 것: `sync_tools` op·`app sync-tools`의 실제 실행.
  지금 `lophn_app sync_tools`는 `connection/app-ops.ts`에서 `unavailable`을 돌려준다
  (소유 route 표에는 appRuntime이 입력 자리로 있다). 파일별 변경·무변경·건너뜀
  결과가 생기면 그 분기를 실행으로 바꾼다.
- 정한 것(T34): 관리 구간 갱신은 `guides/managed-files.ts`(marker 짝 안쪽만, 바깥
  bytes 보존, 경계 오류 무변경, hash 충돌 무변경, temp·원자 교체)으로 하고 관리 구간
  본문은 `guides/templates/`의 body 원본이 정한다(`templates/sync.ts` 표). sync는
  재사용 구조다: MCP 설정·안내는 harnesses의 `installSelected`(`mcp`·`guide`
  components), skill은 guides의 `installSkills`를 쓰고 ignore 갱신만 이 모듈이
  `updateGuideRegion`으로 쓴다. 두 통로(MCP `lophn_app` op와 CLI `app sync-tools`)는
  `connection/app-ops.ts`의 같은 분기를 지나고 파일 설치는 host가 끼운 `sync` port가
  `guides/syncTools`로 한다(core route 밖).

### T35 session 시작 summary와 Claude Code hook

- 상태: 완료 (#461) — 끝낸 것: 완료 기준 전부에 더해 T36에서 넘어온 것(dispatch `session summary` 분기를 소유 읽기 route `/v1/coding_agent_sessions/summary`로, core read handler를 repair-context와 같은 worker 통로로 등록)과 T33에서 넘어온 것(`lophn-build-app`·`lophn-repair` 본문의 `lophn_session` op `summary` 안내와 실제 응답의 claim_rule이 같은 문장이다 — summary.ts의 CLAIM_RULE)을 끝냈다. `apps/core/registry_test.ts`는 repo에 없고 core의 route 등록을 검사하는 목록 테스트도 없어 맞춘 것 없다. hook 설치는 temp dir 가짜 home 테스트로만 확인했다(실제 ~/.claude는 쓰지 않았다). 추가로 고친 것: apps/cli/main.ts의 redactor가 `createRedactionStream.push`의 검사 확정 prefix를 버려 hookMode stdout을 포함한 모든 사람 출력이 꼬리 24 code point만큼 잘리던 것을 push+finish 연결로 고쳤다.
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
- coding-agent#T36에서 넘어온 것: CLI `session summary`는 command 표에 있고 실행은 core의 `/v1/coding_agent_sessions/summary` read handler가 없어 unavailable이다(apps/cli/dispatch.ts, contracts `codingAgentSessionSummary`는 있음). handler가 서면 dispatch에서 `session ` 분기를 소유 읽기 route로 바꾼다
- coding-agent#T33에서 넘어온 것: 배포 skill `lophn-build-app`·`lophn-repair` 본문이 시작 summary를 `lophn_session` op `summary`로 가리키고 "읽는 것은 착수 지시가 아니다"라고 적었다. summary 본문이 서면 이 안내와 실제 응답이 맞는지 확인한다
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

- 상태: 진행 (#405, #408, #416) — 끝낸 것: #393의 완료 기준 전부와 넘어온 것 일부(위 #393 줄)에 더해 #405가 CLI `harness list|detect|refresh|inspect|plan|install|update|remove`·`mcp config`·`daemon start|stop|status|logs` 실행 배선과 doctor daemon 상태 port, 앱 하나 범위 connection의 발급·문서 authorization 모양 일치(조건으로 앱을 채우지 않고 문서 owner가 자리의 앱을 target에 준다), MCP 앱 direct socket transport와 정확한 경로 권한·CLI `SdkSourcePort`(open-issues coding-agent/mcp-server#Q9), SDK 안내 blob field(`package_version/guide`, general_read) 등록과 `sdk show` 원문 read, `document history --section`, CLI 6단계 통합 시험(찾은 `search` route 누락도 고침)을 끝냈다. #408이 CLI launcher(`cliLauncher`)의 정확한 경로 권한(open-issues coding-agent/mcp-server#Q9: `<H>/integrations`·instance lock 쓰기, helper·설치 Deno·`lophn-desktop` 실행, PATH·감지 bin 폴더 읽기, env, 선택한 제품 설정 파일·`sdk add --apply` 앱 source의 `deno.json`·`deno.lock`은 권한 계획 process가 정확한 경로로 더함)와 `sdk show` 안내 원문의 좁은 read `packages.guide_body`(일반 `blobs/read`를 열지 않음)를 끝냈다. 남은 것: (1) CLI `skills list|install`(T33 원본 필요)·`session summary`(T35 core handler 필요)·`session plan`(T38 필요)은 unavailable로 두었다 — 각 작업 블록에 넘겼다 (2) `tools/verify-linux-install.ts`의 양성 단계 → platform#T48(실제 Secret Service 필요) (3) `harness refresh`의 제품 version·auth probe는 제품 실행 파일의 run 권한이 Q9 목록에 없어 실행되지 않고 unknown으로 남는다. 제품 coding_agent operation 상한은 route가 선언한 coding_agent actors를 따른다(`blobs` 자원 제외, 앱 하나 범위는 credential targets와 owner target이 좁힌다). ticket summary blob은 `/v1/tickets/upload_summary`가 `ticket_summary` purpose로 준비한다.
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
- platform#T19 후속(#294)에서 넘어온 것: connection credential(keychain의 token)의 값도 core의 알려진 값 registry에 등록·회수되어야 한다(documents 읽기·메시지 본문에 token이 나오지 않게). 통로는 열렸다: 등록 파일의 `secretRefs`에 `SecretRefSource`(contracts/platform/secrets.ts: `owner`, 참조를 바꾸는 command 이름 `commands`, `read(sql)`가 `{name, sealedRef}` 목록)를 더하면 core secret store가 같은 keychain에서 값을 읽어 등록하고 command 확정 뒤 다시 맞춘다. 지금 연결 표에는 keychain 참조가 없어(digest만) 연결할 source가 없다. T36이 token의 `coding_connection_credential` 참조를 표에 두면 그 표를 읽는 source를 낸다. 회수된 연결의 token도 참조가 남는 동안은 알려진 값으로 둔다.
- 선행: T9, T10, T29, T32, contracts#T43, platform#T34, platform#T48,
- coding-agent#T22에서 넘어온 것: `sdk show`의 API·type·permission·peer·예제는 `packages.guide`가 `guide_hash`만 돌려줘 지금 낼 수 없다. guide 본문 read(blob.read 등록 또는 guide text route)를 잇고 show에 채운다. MCP launch에는 `--allow-write`가 없으니 apply는 CLI에서만 쓰고 MCP는 거절한다
- coding-agent#T22에서 넘어온 것: `lophn_sdk add apply`의 `SdkSourcePort`(deno.json 읽기·쓰기, lock 재생성)를 MCP·CLI 실행 entry에 주입한다. 지금은 주입이 없어 apply가 unavailable이다
  platform#T35, contracts#T24
- platform#T34에서 넘어온 것: 사람의 연결 결정 입구(사람 선택 → 신뢰 경계 token·keychain → core create). 지금 contract에 입구가 없다. 발급 경계는 `createCodingCredentialAuthority`의 `connect(input, submit)`(packages/platform/identity)이고 core 조립은 `Core.codingCredentials.connect`(apps/core/coding-credential.ts, `codingKeychain` 옵션)다. 이 작업이 그 입구(route 또는 main↔core 메시지, contracts 요청 필요)를 정해 사람 credential로 `submit`(connection create command)을 보내고 token 없는 결과만 사람에게 보인다. `registerChild`(MCP·CLI child의 process generation 등록)의 loader 쪽 요청 모양(`process_generation`, `loader_identity`)은 production provider가 채운다
- platform#T48에서 넘어온 것: helper `lophn-credential`(설치 묶음 `/opt/lophn/lophn-credential`, `/usr/bin/lophn`·`lophn-mcp` launcher의 `--allow-run`이 이것 하나)과 core 쪽 보호 통로(소유자 전용 `H/run/credential.sock`)가 서 있다. production provider는 helper를 stdin `CredentialDeliveryRequest`(purpose `mcp_cli_loader`, `loader_identity`는 helper 절대 경로)로 부르고 stdout `{"token"}`(종료 0) 또는 `{"reason"}`(종료 1)을 읽는다. 실제 설치에서 등록된 child가 token을 받는 양성 경로는 connection 생성 입구와 child generation 등록(`registerChild`, T38) 뒤에야 확인할 수 있어 이 작업이 `tools/verify-linux-install.ts`에 그 단계를 더한다(지금은 등록되지 않은 child가 `not_found`, core 없음이 `no_secret_service`인 것까지 확인). `apps/cli`·`apps/mcp`의 daemon 주소 발견·core 연결도 뼈대라 launcher 시작과 MCP initialize 응답까지만 확인했다
- coding-agent#T21에서 넘어온 것: 앱 개발 tool의 production 배선. (1) 앱 통로
  transport: `AppDirectTransport`(connection/app-direct.ts)의 unix socket 구현과 MCP
  실행 권한(socket 경로가 실행 때 정해지므로 argv의 `--allow-read/--allow-write` 범위를
  정해야 한다), `apps/mcp/main.ts`의 `appDirect` 옵션 채우기. (2) CLI `runApp`
  (cli/commands/app.ts)을 apps/cli 실행 entry에 잇고 `isError`를 비성공 exit로 낸다.
- coding-agent#T23에서 넘어온 것: apps#T19의 `/v1/apps/blueprint`가 서면 그 read로 `AppBlueprintSource`(mcp-server/tools/app-commands.ts)를 만들어 `apps/mcp/main.ts`의 `appBlueprint` 옵션에 잇는다(앱 통로 `appDirect` 배선과 함께; 없으면 blueprint 유래 앱 tool이 나오지 않는다).
- coding-agent#T15에서 넘어온 것: (1) CLI의 core 실행(dispatch) 배선. T15의 parity는
  command 표의 route와 같은 core client로 본다(`cliRead`는 시험 안의 얇은 실행이다).
  실행 entry를 이 표와 같은 route·같은 client로 잇고 `not_found`의 통일 메시지
  (`UNREADABLE_MESSAGE`)를 그대로 낸다. (2) `apps/mcp/main.ts`가 제출 scope의
  `forbidden`을 비워 둔다. 운영 data root(와 다른 앱 source)를 넣는다(connection#R10).
  (3) 앱 하나 범위 연결의 실제 credential 발급. T15 시험은 `scope.targets
  {place_kind:"app", place:<app>}`로 직접 만들었으니 발급이 같은 모양의 scope를 내는지
  맞춘다.
- T13에서 넘어온 것: 문서 읽기 CLI command(index·project·document·read)의 core 실행과 시험, `cliDocumentHistorySchema`에 section 추가, CLI 6단계 통합 시험(MCP 쪽은 #307)
- T16에서 넘어온 것: CLI `question list|show|open`·`approval list|show|open`을
  apps/cli 실행 entry에서 core client로 잇는다(`runQuestionOpen`·`runApprovalOpen`
  은 `read`만 가진 client를 받는다). MCP `lophn_question`·`lophn_approval`은
  `apps/mcp/main.ts`가 이미 같은 core client로 부른다(production provider 뒤)
- T32에서 넘어온 것: `doctorOf`(cli/commands/doctor.ts)를 apps/cli 실행
  entry에 잇는다. daemon 상태(DaemonPort.status)·connection 읽기·credential
  사용 가능 여부(이 작업의 production provider)·`filePort`·`stdioMcpProbe`·
  `storeOf` port를 조립하고 `denoExecutable`(설치된 절대 Deno)·`expectedTools`를
  넣는다. (MCP entry 경로 불일치는 고쳤다: harnesses/launch.ts가 mcp-server의
  `MCP_ENTRY`(`apps/mcp/main.ts`) 한 값을 쓴다. 첫 Hermes 설치가 만드는
  config.yaml도 고쳤다)
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
  - #405 CLI 실행(`apps/cli/run_setup_test.ts`): `harness detect`는 최초 감지(PATH·catalog fallback만, version·auth probe 없음)를 `~/.lophn/integrations/detection.json`에 저장하고 환경·catalog revision이 같으면 다시 감지하지 않으며, `refresh`만 사람 요청 재감지와 version·auth probe를 돈다(harnesses#R2·R3; native 환경 identity는 `native`). `plan`은 쓰지 않는 dry-run, `update`는 receipt 있는 target만, `remove`는 receipt 소유 resource만, 쓰기 command는 coding credential에 `forbidden`(cli#R6·R40)
  - #405 앱 하나 범위(`apps/core/coding-agent-scope_test.ts`): 발급(`codingExternalCredential`)이 낸 `targets.app`·`conditions.app`으로 자기 앱 문서는 읽히고 다른 앱·project·자리 없는 문서는 없는 문서와 같은 답이다. platform ledger의 `mergeTarget`은 coding agent의 `app`을 조건에서 채우지 않는다
  - #405 SDK 안내(`apps/core/sdk-guide-blob_test.ts`): `package.register_version`이 준비한 안내 byte를 같은 transaction에서 등록하고(`guide_blob`), 준비하지 않은 hash는 거절이다. `contracts/apps/socket-slots`가 앱 socket 자리 이름의 한 곳이다(apps runtime이 같은 이름을 쓴다)

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

- 상태: 완료 (#431)
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
- coding-agent#T36에서 넘어온 것: CLI `session plan`은 command 표에 있고 실행은 sessions의 plan 입출력이 없어 unavailable이다(apps/cli/dispatch.ts). plan이 서면 `session ` 분기를 plan 실행으로 바꾼다
- platform#T34에서 넘어온 것: lophn이 띄운 TUI 아래의 MCP·CLI child process generation을 신뢰 감독(terminal host가 runtime_ref·generation을 아는 쪽)이 관측해 `CodingCredentialAuthority.registerChild`(connection·scope·loader identity)로 등록하고 종료 때 `endChild`·회수 때 `endConnection`을 부르는 일. TUI env는 `codingTuiEnvironment`(`LOPHN_CONNECTION` 참조만)를 쓴다. 자기 터미널의 session은 lophn이 시작하지 않아 이 길이 없다(보호 전달은 등록된 child에만 열린다). 이 일을 맡을 작업이 따로 없어 LaunchPlan·terminal host spawn이 만나는 이 작업에 가장 가깝다고 보고 넘겼다(shell terminal 쪽 관측 입구가 필요하면 lead가 shell 작업으로 나눈다)
- coding-agent#T36에서 넘어온 것: loader child의 `process_generation`은 `<pid>.<시작 tick>`(`processGenerationOf`·`currentProcessGeneration`, coding-agent/connection/credential/helper.ts; `/proc/<pid>/stat` 22번째 field, 읽지 못하면 pid)이고 `loader_identity`는 helper 절대 경로(`<설치 root>/lophn-credential`)다. 신뢰 감독이 TUI 아래 MCP·CLI process를 같은 값으로 관측해 `registerChild`로 등록해야 helper가 token을 전달한다(`apps/core/coding-connect-flow_test.ts`가 같은 값으로 등록하는 양성 경로).
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

- 상태: 완료 (#432) — 이어보냄: shell#T49(host가 runtime_ref·generation·origin을 붙이고 process exit·재시작을 관측으로 내는 일)
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

- 상태: 완료 (#411) — 이어보냄: 아래
- 이어보냄: shell#T50(회수 결정 화면) — CLI가 내는 링크는 `lophn://things-to-confirm/<cac_...>`이고(`decisionLink(connection)`) shell `open-intent`는 지금 `apr`·`qst`만 받는다. shell이 `cac` 링크를 받아 그 연결의 현재 판을 `ShowCodingAgentConnection`으로 읽고 `RevokeCodingAgentConnection` confirmation window(결정 `coding_agent_connection_revoke`, binding connection·base_revision)를 여는 일은 shell#T50에서 한다. 화면 E2E는 shell#T50 뒤 T41에서 돈다.
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
- shell#T50에서 넘어온 것: (1) 화면은 [Start]가 연 TUI 상태와 첫 prompt 전달을 Tasks 탭에서 보이지만 project 터미널 탭이 그 runtime(`terminal_ref`)을 탭으로 붙여 보이는 길은 없다(renderer 터미널 store는 자기가 연 터미널만 안다). start-coding-agent flow 4단계("사람은 project 터미널 탭에서 TUI를 본다")의 E2E 전에 이 연결이 필요하다. (2) main은 `lophn`을 설치 묶음 경로(Linux `/usr/bin/lophn`)나 개발 `LOPHN_CLI`로만 부른다. 다른 OS의 `lophn` 경로는 platform#T49 몫이고 E2E는 fake `lophn` 또는 설치 묶음을 준비해야 한다. (3) `lophn harness install` 단독 호출은 화면에 입구가 없다(연결 때 `connection install`만 부른다).
- coding-agent#T40에서 넘어온 것: 제품 core의 coding credential operation 상한(`apps/core/core.ts`의 registry operations)에는 아직 ticket claim·문서 저장 같은 command가 없어 실제 coding token이 `ClaimTicket` 등을 부르면 403이다(읽기 route와 `app.connect`는 닿는다). claim→작업→보고 E2E는 이 상한을 platform이 정한 뒤에 실제 token으로 돈다(사람 결정 필요, T36 남은 것 (3)과 같은 문제)
- problems#T13에서 넘어온 것: manage-tickets 6단계 acceptance check가 problems Verification(TicketTestLink)을 쓰는 통합 확인(#222)
- coding-agent#T26에서 넘어온 것: checker는 Verification을 읽기만 하고 test_command 실행을 요청하지 않는다. 보고 뒤의 completion_seq로 TicketTestLink를 붙여 test_command를 요청하는 주체·경로(고정 test blob 준비 포함)가 정해지지 않았다. 그 요청이 없으면 test_command 조건은 `inconclusive`(실행 안 함)로 reported에 남는다
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

- 상태: 완료 (#427)
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

- 상태: 완료 (#435) — 전체 경로는 owner 작업이 있어야 한다: source diff 근거는 apps release read가 첫 발생 전·현재 고정 release의 보존 source 참조를 내야 하고(지금은 이유만), image 내용은 platform redaction이 image/png를 지원해야 한다(지금은 허용 첨부 열기 참조·종류·크기만). 좁은 본문 읽기 `problems.report_body`는 report_text·snapshot_logs와 R15 screen용 feedback_state를 연다
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
- coding-agent#T42에서 넘어온 것: 조립(`repair-context/assemble.ts`의 `assembleRepairContext`)은 요약 상한(문제당 2줄·전체 10줄·1,200자)을 간이로만 지키고 전체 24,576 bytes·300줄을 넘기면 bundle 대신 `over_budget`을 낸다. 축소(log → 대표 excerpt → 첨부)·최종 redaction 확인·`more`·cursor·이미지는 이 task가 얹는다. worker(`apps/worker/coding-agent/repair-context.ts`, kind `coding-agent/worker`)는 요청 payload `{credential, input}`을 받는다. core가 요청자 connection credential을 싣고, `redact_request`에 알려진 값으로 답하고, 응답에 read 공통 필드(`as_of_seq`)를 붙이고, `repair_context/*` route 등록과 worker launch spec을 더해야 한다. 사람 원문·log 본문은 일반 `blobs/read`로 읽는데 core는 이 route를 서빙하지 않아 지금은 "읽을 수 없음" 이유로 표시된다(problems의 `report_text` field는 일반 읽기도 닫혀 있다). `ListVerifications`·`GetTestRequest`·`GetVerification`도 reader 등록에 없어 제품 core에서 not_found다(problems 소유; 수리 자료는 이를 "읽을 수 없음"으로 표시한다)

### T44 MCP·CLI 문제 tool과 사람의 문제 command

- 상태: 완료 (#452) — 남은 것: 이미지 내용 전달(`attachment open`은 참조·종류·크기만, platform redaction image/png 필요, T43과 같다). reproduction test의 core 요청 접수는 runner 연결(follow-up 40) 전이라 거절로 읽히고, core `RequestTest`의 claim 검사는 problems가 정한다(problems#T18 이어보냄)
- 정한 것(T44): `record_fix` tool·CLI 입력은 owner command 입력이 아니라 `{problem, problem_seq, fix{before, after, verification, ticket, claim_seq}, summary 본문}`이다. 통로가 summary를 `problems/upload_fix_summary`(additive upload route, purpose `fix_summary`)로 저장해 받은 준비 증거와 그 hash만 `RecordProblemFix`에 싣고, 올린 바이트와 다른 hash의 준비 증거는 보내지 않는다. `test`는 reproduction만이고 `ticket_source{ticket, claim_seq}`를 필수로 받아 지정 repair ticket의 현재 claim(claimed·같은 앱·문제 포함·claim_seq 일치·기한 안·이 연결의 claim)을 읽어 확인한 뒤 `app test`와 같은 흐름으로 요청한다. 처리 대상(`handler` user/coding_agent)은 문제 요약의 next_action으로 통로가 가른다(owner list에 filter가 없다). `problem attachment open`은 보고·snapshot 소속과 허용 첨부(snapshot log·화면 이미지)를 읽어 `{kind, media_type, size_bytes, open{report_attachment, problem, report, field}}` 참조만 내고 hash·운영 경로·내용은 내지 않는다
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
- coding-agent#T33에서 넘어온 것: 배포 skill `lophn-repair`·`lophn-build-app`
  본문은 `lophn_problem`(contract 이름·op list, show, snapshot, fix_records,
  summary, bundle, more, record_fix, test)을 가리키고, tool이 목록에 없으면 수리를
  진행하지 않고 사람에게 알리라고 적었다. 이 tool이 실제로 서면 본문의 op 이름·입력
  (`more`의 `kind`, `record_fix`·`test`의 ticket·`claim_seq`)이 실제와 맞는지
  확인하고, 달라졌으면 skill 본문을 고치며 version을 올리고 manifest hash를
  갱신한다(`packages/coding-agent/guides/manifest.ts`, 배포 테스트가 잡는다)
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
  - problems#T14에서 넘어온 것: `lophn_problem` record_fix는 준비 증거가 필요한
    `summary_blob`을 받는다. tool이 먼저 blob을 준비하는 신뢰 프로세스 요청
    (core `prepareBlob`, purpose `fix_summary`)을 하고 그 준비 결과를 입력에 싣는다.
    hash만 싣는 기록은 거절된다(problems/repairs#T40)
  - lead 결정(D27, problems/feedback#R1): CLI는 feedback을 접수하지 않는다.
    `problem report`는 shell의 문제 알리기 화면을 여는 안내만,
    `request-repair`는 담당 agent의 ticket 준비 화면 링크, `confirm|dismiss`와
    "내가 확인함"은 결정 화면 링크와 대기 사실만 출력한다. coding credential은
    거절하고, 요청만으로 문제를 닫거나 coding agent를 띄우지 않는다. cli#R35는
    이 PR에서 이 모양으로 고친다(cli#R7, R35; 질문 Q1)

### T45 repair ticket 검사: reproduction·problems_closed·human_confirmation

- 상태: 완료 (#476) — 보고 release에 대한 사람의 not_fixed 결정은 human_confirmation 실패로 정함. 제품 core의 PROBLEM_STATUSES_PORT 등록은 남음
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
- 선행 풀기(사람 결정 2026-10-07): 선행이 끝나기 전에 이미 있는 contract와 fake로 먼저 만든다. 선행이 merge되면 실제 구현에 잇는 작은 PR을 따로 내고, 그때 완료로 둔다.
- 선행 풀기 뒤 잇는 PR이 할 일:
  - problems#T18: 실제 reproduction Verification 행(`verifications`의 problem·test·after_release)이 checker fixture의 모양과 같은지 ledger 테스트로 확인한다
  - problems#T20·T21: `problems.closure` JSON(reason·release·confirmation·basis_seq)과 사람 확인(`user_confirmed`) 닫힘을 실제 `ProblemClosed`·`ProblemReopened`로 만든 뒤 fixture 행을 그 command로 바꾼다. 사람의 not_fixed 결정(문제는 open 유지)을 human_confirmation fail로 읽을지 정한다(지금은 inconclusive 대기)
  - `apps/core/ticket-checker_test.ts`에 실제 닫힘·재발 뒤 checker worker가 깨어 남은 조건을 다시 비교하는 통합 시험을 더한다
- coding-agent#T26에서 넘어온 것: T26 checker는 reproduction_test·problems_closed·human_confirmation을 이유와 함께 `inconclusive`로만 남기고 `record_checks` handler도 이 세 kind의 pass·fail을 받지 않는다(`packages/coding-agent/tickets/checker/judge.ts`, `checks.ts`). 이 작업이 판정과 handler 허용을 함께 넓히고, `ProblemClosed`·`ProblemReopened`를 checker 깨움(`apps/core/ticket-checker.ts`의 WAKE_EVENTS와 event 공개 정책)에 더한다
- 완료:
  - reproduction_test는 해당 문제·고정 test_hash·보고 after release의
    Verification만, human_confirmation pass는 "내가 확인함"이고 Verification이
    아니다(R9)
  - problems_closed는 problems/closing이 먼저 판정한 닫힘과 이번 보고의 고친
    release를 읽고, 보고·확인됨·취소로 문제를 닫지 않는다(R21)
  - `ProblemClosed`·`ProblemReopened`에서 남은 조건 재비교, 재시작 뒤
    이어서(R20)
  - 일부 문제만 통과·전부 제외에서 자동 confirmed가 없다(R9)
- problems#T19에서 넘어온 것: 제품 checker가 repair ticket의 `problems_closed`·`human_confirmation` 판정에 문제 대상 `targets[].revision`을 문제 상태 문구("open")로 보내 `record_checks`가 `invalid_input`(seqSchema)으로 거절된다(제품 core의 실제 repair ticket 시험으로 확인). 문제의 최신 seq를 revision으로 싣는다. 또 제품 core는 repair ticket 생성의 `PROBLEM_STATUSES_PORT`를 아직 등록하지 않아 시험용 port로만 repair ticket을 만든다

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

- 상태: 미룸 (사람 결정 2026-10-07: 오프라인 MCP 시작 검증은 이번 판에서 뺀다)

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

- **Q31 core가 직접 서빙하는 platform 읽기의 operation 검사(T15, 구현).**
  `ListBackups`·`GetBackup`·`ListSecrets`는 이 작업에서 계약 actor에서 `coding_agent`를 빼
  daemon이 거절한다(mcp-server#R30, cli#R38; documents `outline.root`의 `unplaced`
  묶음도 범위가 좁은 연결에는 내지 않는다). 남은 것: core가 직접 서빙하는 읽기(상태·
  health·진단 목록·진단 검사·blob 읽기, `apps/core/runtime.ts`)는 dispatch가 `scope.operations`를
  보지 않고 handler가 정한다. `PlatformStatus` 같은 읽기는 `coding_agent`가 받는 것이 맞지만
  operation을 열어 주지 않은 연결도 닿는다. dispatch의 `read()`에 operation 검사를 일괄로 걸어
  보니 빈 operation으로 읽기를 시험하는 platform/api 시험 넷이 깨졌다. 추천: platform이 이
  읽기들의 operation 요건을 정하고(일괄 검사 또는 handler별 검사) 시험의 credential을 맞춘다.
  coding-agent는 이 읽기에서 비밀을 내지 않는다.
- **Q32 T21 앱 개발 tool의 계약·범위 보정(구현, lead 승인).**
  (a) `release.prepare_bundle`·`preparation` actor에 coding_agent를 더했다(T21 구현 메모).
  (b) `RequestTest`에 선택 `timeout_ms`(1~300,000)를 더했다. 접수 기록에 `request_timeout_ms`로
  남고 runner는 동결 method의 timeout과 짧은 쪽을 쓴다(`prepareCommand`). 요청 identity(request
  hash)에는 넣지 않고 같은 key의 다른 timeout은 conflict다. 통로는 생략된 값을 기본 300,000으로
  채워 명시한다. 접수 기록을 runner 실행 입력에 잇는 조립은 problems#T8 쪽에 아직 없다.
  (c) CLI `app command` schema에 앱 command key `name`·`environment`(preview 기본)·`timeout_ms`를
  더했고 command의 JSON 입력은 공통 `--input`이다. `app invocation`에도 `environment`를 더했다.
  (d) `appLogs`에 선택 `cursor`(앞선 next_cursor, 숫자 문자열)를 더했다. supervisor log buffer가
  줄의 절대 번호로 더 오래된 줄을 이어 주고 `next_cursor`를 낸다.
  (e) 앱 하나 범위 연결의 범위 밖 앱 읽기·쓰기 틈을 막았다. 원인은 platform `mergeTarget`이 owner가 준
  target(`app`)을 credential 조건 값으로 덮어 판정을 통과시킨 것이었다(덮지 않고 거절하도록 고쳤다).
  apps 쪽은 `app.connect_source`·archive·unarchive가 범위 밖 앱을 revision·status 비교보다 먼저
  없는 앱과 같게 닫고, `invocations.list·get`이 앱별 범위를 판정한다(범위 밖 기록은 없는 기록).
- **Q33 T22 SDK tool의 안내 원문과 MCP apply(구현).**
  (a) mcp#R22·cli#R30의 show는 API·type·permission·peer·예제를 내야 하지만 `packages.guide`는
  `guide_hash`만 내고, 그 blob을 읽을 owner 등록(`blob.read`의 owner_kind·field)이 apps에 없다.
  지금 show는 version 목록과 `guide_hash`를 내고 `body: null`과 이유를 함께 낸다. 추천: apps가
  package guide blob의 owner 등록(예: owner_kind `package_version`, field `guide`)을 contracts에
  더하고, 통로는 그것으로 원문을 읽어 낸다.
  (b) MCP는 `--allow-write` 없이 뜬다(T11, connection#R16). 그래서 MCP의 `apply`는 실행 전
  `unavailable`이고 고정 import 안내로 끝난다. 추천: apply는 CLI(`lophn sdk add --apply --app`)로만
  실제 실행하고 MCP 응답의 next가 그 command를 안내한다. MCP에 앱 source 범위의 쓰기 권한을
  줄지는 harnesses·connection이 정한다.
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
- **Q2 앱 log 줄 수.** (정함: T21 PR에서 requirements를 200줄로 고쳤다) coding-agent/mcp-server#R32, cli#R24는 요청 1~2,000줄인데
  apps/runtime#R27은 한 번에 200줄이다. 추천: 한 번에 1~200줄과 cursor 이어
  읽기로 맞추고 T21 PR에서 두 요구를 고친다(MCP 출력 상한에도 맞다).
- **Q3 command environment 이름.** (정함: T21 PR에서 architecture를 고쳤다) architecture 5.2의 `preview|production`을
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
- **Q13 project 읽기 필드.** (정함, T13 PR에서 고침) coding-agent/mcp-server#R9·cli#R22는 "등록
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
- **Q21 local bytes를 core로 넘기는 통로(lead 결정, 구현).** `document.prepare`는
  준비된 blob 참조를 파일 입력으로 요구하는데 MCP·CLI는 감독 child가 아니라 blob.prepare를
  못 부른다. 정함: raw blob 업로드 route는 두지 않고, 소유 concern이 등록한 `upload` kind
  route가 바이트 body를 받는다(contracts/platform `defineUpload`, platform/api `upload`
  dispatch, architecture/platform 5.1·documents 5.1·coding-agent 7.2 갱신). 문서 파일 제출
  `/v1/documents/upload`(입력 hash·크기는 `x-lophn-input` header, body는 octet-stream)는
  core가 바이트를 해석·모으지 않고 blob 준비 중계로 흘려 보내고, 준비 주체는 요청
  credential, purpose는 `document_file` 고정이다. lead 안은 documents worker가
  child blob.prepare로 준비하는 것이었으나 core→worker로 요청 바이트를 보내는 길이 없고
  (현재 core→자식 바이트는 I/O worker blob.prepare뿐) 이미 `documents-prepare.ts`가 같은
  중계로 core 안에서 준비하므로 같은 중계를 그대로 썼다. `apps/worker/documents`는
  고치지 않았다. 실제 core·I/O worker 시험은 `apps/core/documents-upload_test.ts`다.
- **Q22 입력의 모양(lead 결정, 구현).** MCP `lophn_save`·`lophn_format validate`는 제출 root
  기준 상대 경로 `paths`를 받고(CLI는 절대 경로) tool이 realpath로 다시 검사한 뒤 bytes를
  upload route로 보낸다. CLI `format validate`는 `files`와 `paths` 중 정확히 하나다.
  메모·tag는 documents에 저장 자리가 없고 saved view도 tag 조건을 받지 않으므로(documents/
  outline-and-search) contract에 더하지 않고 mcp-server#R13·cli#R15·architecture 5.2 표에서
  뺐다(기존 contract 시험도 `tags`를 거절한다).
- **Q24 같은 내용의 재준비(구현, platform 쪽 변경).** blob 준비 참조는 (주체, purpose,
  hash)마다 하나이고 platform/blob-store#R1 시험은 같은 참조 등록을 conflict로 둔다.
  그런데 같은 파일을 10분 안에 다시 제출하는 재시도(응답 유실, 같은 요청 재전송)와 같은 내용의
  파일 목록 blob의 재준비가 conflict라 저장이 끝까지 못 갔다. registry는 그대로 두고
  `find`(살아 있는 등록값)를 더했으며, 중계(`apps/core/blob-prepare.ts`)는 같은
  주체·purpose·내용의 준비가 살아 있으면 새 참조를 만들지 않고 그 참조를 돌려준다.
  I/O worker는 같은 hash의 기존 파일을 검증해 재사용하므로 바이트는 하나다.
- **Q25 `/v1/formats/validate` 서빙(구현).** format 검사 worker route가 core에 등록돼 있지
  않아 HTTP에서 404였다. 준비 route와 같은 검사 통로(`documents-validate.ts`)로 서빙하는
  조립(`apps/core/documents-format-validate.ts`)을 더했다. 요청 주체가 upload로 준비해 살아
  있는 blob만 읽고(hash는 읽기 권한이 아니다), 진단이 많으면 cursor로 잇는다. 판·문서·준비
  참조는 만들지 않는다. 같은 점검에서 documents 준비 route(`document.prepare`)는 파일
  입력의 blob이 요청 주체의 살아 있는 준비인지 검사하지 않는 것을 보았다(documents 쪽에
  남긴다).
- **Q23 core 응답 모양과 server 입력 검사(구현).** 실제 core는 성공한 command의 결과
  객체를 그대로 200으로 낸다(platform/api#R3). `createRpcClient`가 이 모양을 읽도록
  고치고(포장된 응답 기대 제거) connection client의 우회를 지웠다. 쓰기 응답 유실 뒤
  `commands/result`는 결과 객체만 돌려준다. MCP server는 tool 입력을 `op`를 모르는 소유 route
  입력이 아니라 tool 표 입력으로 검사하게 고쳤다. `lophn_ticket`의 read op는 `client.read`로
  보낸다. 남은 T20 후속: ticket 쓰기 op의 `op`·`base_revision`을 route 입력·compare로
  나누는 것(지금은 `op`를 route 입력에 그대로 싣는다).
- **Q27 context 변경 제안의 분할·병합과 변경안 문서 모양(구현).**
  coding-agent/mcp-server#R17·cli#R19와 T17 완료 줄은 분할·병합 변경안을 받으라고
  했지만 documents/contexts는 context 분할·병합을 두지 않고(요구 문서와 domain
  model, contracts Q39) `lophn_context propose`의 변경 union도 create·rename·
  set_item·remove_item·term_propose·term_update 여섯뿐이다. 두 요구와 T17 완료 줄에서
  분할·병합을 뺐다. 같은 두 요구의 "직접 질문 생성 미확정 부분" 문장도 Q14대로 "사람이
  변경안 주소를 Context Engineer에게 맡기면 그 agent가 질문으로 잇는다"로 맞췄다.
  변경안 문서는 자리 없는 문서 하나(`context-change.md`, text/markdown)이고 본문에 사람이
  읽는 이유와 기계가 읽는 `lophn-context-change/1` JSON(종류·대상 context·읽은
  context revision·변경안·이유)을 둔다. 시각·사람 값이 없어 같은 제안은 같은 bytes·같은
  문서가 된다. 제안 때 대상 context를 읽어(범위 밖은 없는 것과 같은 not_found) 없는 context·
  이미 있는 id 생성·없는 항목 제거를 접수하지 않는다. documents 쪽에 변경안 문서의
  구조 read나 적용 통로는 아직 없다(Context Engineer가 질문으로 잇는 일은
  lophn-agent 몫).
- **Q30 T13 문서 읽기 tool의 구현 판단과 다른 팀에 알릴 것(구현).**
  (1) `lophn_project`: agent 투영(`agentProjectSchema`)에는 폴더·문서 수가 없고 core의
  project 읽기가 돌려주는 `documents`(읽을 자료 참조)는 아직 항상 비어 있다
  (`apps/core/documents.ts`의 `emptyDocuments`). 그래서 "프로젝트 문서 수"는 전체
  목차(`outline/root`)의 project `document_count`를 한 번 읽어 채우고(읽지 못하면 null과
  "문서 수를 읽지 못했다"), 읽을 자료 참조는 `reading`으로 그대로 낸다. 폴더 설명과 "연결
  context"는 낼 수 없다: 폴더는 agent 투영에 없고 context 대상은 문서·app command뿐이라
  project에 연결된 context가 없다(`/v1/contexts/related`는 대상이 문서). R9·cli#R22를
  이에 맞췄다. 여러 일치는 없다: `project.resolve_cwd`는 가장 깊은 등록 폴더의 project 하나다.
  (2) contract 보정(contracts/coding-agent/mcp-core.ts): `lophn_document history`
  입력에 선택 `section`을 더하고(architecture 표에 있던 입력) route를 `documentHistory`로
  둔다(전에는 입력 schema가 route 자리에 있어 `resolveRoute`가 이 op를 풀지 못했다).
  section을 주면 tool이 `documentSectionHistory`를 읽는다. `lophn_read`의 표 값을
  `documentRead` route로, `lophn_index status`에서 쓸 수 없는 `cursor`를 뺐다(status는
  한 쪽에 담겨 이어 읽기가 없다). CLI의 `cliDocumentHistorySchema`는 아직 section이
  없다(CLI 남은 것).
  (3) documents 쪽에 알림(고치지 않음): `search.query`의 `matchDocuments`
  (`packages/documents/outline-and-search/reads.ts`)가 문서마다 `search_rows`의 첫 행
  하나만 `get`으로 읽어, 둘째 이후 구역 본문에만 있는 낱말은 찾지 못한다(실제 core 시험에서
  "그대로 두는 개요"가 안 찾아졌다). 구역별 행이 모두 후보여야 한다.
  (4) `documents/file`(원문 bytes)은 이 tool들이 열지 않는다. `lophn_read`는 추출하지 못한
  판(unverified·unsupported)에서 이유와 고정 판 파일 참조(`file`)를 오류가 아닌 결과로 내고,
  요구 R10에 bytes 읽기는 없다. CLI에서 파일로 받는 command가 필요하면 별도로 정한다.
  (5) 아직 못 닿는 것: MCP 실행 entry(`apps/mcp/main.ts`)는 실제 credential loader가 없어
  (`noopProvider`, `options.client` 없으면 caller 없음) 제품 프로세스에서는 모든 tool이 "실행
  준비가 안 됐다"로 답한다. tool 조립은 이미 걸려 있고 loader가 서면 그대로 동작한다(T9·T34).
