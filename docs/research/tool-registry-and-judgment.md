---
type: research
concerns: [lophn-agent/harness/tools, lophn-agent/harness/tool-judgment, lophn-agent/harness/safety]
---
# tool 정의, 입력 검증, 결과 상한, 승인 판정

## 질문

tool 하나를 목록과 실행이 같은 정의로 쓰는지, 입력을 어디까지 검증하고 고치는지, 결과를 어디서 자르는지, allow/ask/deny를 무엇으로 가르는지 알아야 한다. lophn은 되돌릴 수 없거나 심각한 일만 묻고(D21) 확인 못 하는 조건은 deny하며, 같은 요청의 최종 실패 2회면 3회째를 막는다. 아래는 그 기준과 여섯 프로젝트의 기본 정책을 비교한다.

조사일 2026-10-04. 코드로 읽은 프로젝트: Codex `3a69ec3ef8fb`, Gemini CLI `fb972b2f87fe`, OpenCode `907b3bc518fa`, Hermes `343500b3547e`, Pi `83692682f095`, OpenClaw `37efa0b4a644`. `[확인]`은 해당 revision 코드에서 본 것, `[미확인]`은 못 찾은 것이다.

## 프로젝트별

### Codex (`3a69ec3ef8fb`)

- 정의와 실행이 한 타입에 묶인다. `ToolExecutor` trait이 `spec()`으로 `ToolSpec`을 내고 `handle()`로 실행한다(`codex:codex-rs/tools/src/tool_executor.rs` 1–131). 노출은 `ToolExposure` = Direct / Deferred / DeferredModelOnly / DirectModelOnly / CodeModeOnly / Hidden이고, `supports_parallel_tool_calls` 기본은 false다. registry(`codex:codex-rs/core/src/tools/registry.rs` `ToolRegistry`)는 `IndexMap<ToolName, RegisteredTool>`이며 `register_trusted`는 중복에서 오류, `register_external`은 중복과 예약 이름(`exec_command`, `shell_command`)을 건너뛰고 collision을 기록한다. `[확인]`
- dispatch(`dispatch_any_with_state`, registry.rs 532–)는 알 수 없는 tool을 `FunctionCallError::RespondToModel("unsupported call: {name}")`로 모델에 돌려 주고, payload 종류 불일치는 `Fatal`이다. 실행 전 `PreToolUse` hook이 `Blocked`면 실행하지 않고 모델에 알리며, `updated_input`이 있으면 인자를 다시 쓴다. `PostToolUse` hook은 실행이 끝난 뒤 결과를 거절하거나 모델에 보이는 출력을 feedback 텍스트로 바꿀 수 있다. hook 인자 파싱은 빈 인자를 빈 객체로, JSON 파싱 실패를 raw string으로 넘긴다(registry.rs 850–856). `[확인]`
- 병렬은 call별 `RwLock`이다(`codex:codex-rs/core/src/tools/parallel.rs` 120–239). 병렬 가능 call은 read lock을 공유하고 병렬 불가 call 하나가 write lock으로 나머지를 전부 직렬화한다. call마다 `tokio::spawn`하고 `Fatal`만 결과 없이 전파된다. `[확인]`
- 승인은 `AskForApproval` = UnlessTrusted / OnRequest(기본, alias "on-failure") / Granular / Never다(`codex:codex-rs/protocol/src/protocol.rs` 986–1048). OnRequest는 모델이 언제 물을지 정한다. `GranularApprovalConfig`의 각 항목이 false면 묻는 것이 아니라 자동 거절이다. sandbox는 `SandboxPolicy` = DangerFullAccess / ReadOnly / ExternalSandbox / WorkspaceWrite이고, `WritableRoot`는 `.codex`와 `.git` 메타데이터 경로를 보호한다(1072–1174). `[확인]`
- 판정 결과는 `ExecApprovalRequirement` = Skip / NeedsApproval / Forbidden이다(`codex:codex-rs/core/src/tools/sandboxing.rs` 1–200). 주석(190–194) 기준 Never는 묻지 않고, OnRequest는 filesystem이 제한 없을 때만 건너뛰며, UnlessTrusted는 항상 묻는다. `ReviewDecision`은 Approved / ApprovedForSession / Denied / TimedOut / Abort 등이고 기본은 Denied{"denied"}다(protocol.rs 4146–4181). `ApprovalStore`는 키의 serde_json을 HashMap 키로 쓰며, ApprovedForSession이면 키마다 저장해 부분 집합도 건너뛴다. MCP tool은 세션 키와 영속 키를 따로 둔다(`codex:codex-rs/core/src/mcp_tool_call.rs` 1502–1542, `allow_session_remember`, `allow_persistent_approval`). 같은 거절을 다시 묻지 않는 비교는 찾지 못했다. `[미확인]`
- 잘림은 가운데다. `truncate_middle_chars`가 예산을 반으로 나눠 앞뒤를 남기고 `…{n} chars truncated…`(토큰이면 `…{n} tokens truncated…`)를 사이에 넣는다(`codex:codex-rs/utils/string/src/truncate.rs` 11–183). 토큰은 `APPROX_BYTES_PER_TOKEN = 4`로 어림하고 UTF-8 char boundary에서 자른다. `formatted_truncate_text`는 "Warning: truncated output (original token count: N)\nTotal output lines: M"을 앞에 붙인다(`codex:codex-rs/utils/output-truncation/src/lib.rs` 23–41). 직렬화 여유는 `* 1.2`다(19–21). MCP 결과는 `is_error`를 보존한 채 JSON escape를 감안해 예산을 줄여 가며 자른다(45–87). exec 출력 상한은 `UNIFIED_EXEC_OUTPUT_MAX_BYTES = 1MiB`이고 head/tail을 반씩 쓴다(`codex:codex-rs/core/src/unified_exec/head_tail_buffer.rs`). 응답 메시지 상한은 `MAX_RESPONSE_MESSAGE_BYTES = 15MiB`다(`codex:codex-rs/core/src/client_tool_metadata.rs` 10). 잘린 뒤 이어 읽는 cursor는 찾지 못했다. `[미확인]`
- 반복 호출을 세는 loop detector는 찾지 못했다. `[미확인]`

### Gemini CLI (`fb972b2f87fe`)

- tool은 `DeclarativeTool`이고 name, displayName, description, `kind: Kind`, parameterSchema를 가진다(`gemini-cli:packages/core/src/tools/tools.ts`). `getSchema()`가 모든 tool schema에 `wait_for_previous` boolean을 주입해(542–573) 모델이 병렬을 직접 끈다. `isReadOnly`는 `READ_ONLY_KINDS`(Read, Search, Fetch)에서 파생되고 `MUTATOR_KINDS`는 Edit, Delete, Move, Execute다(1116–1141). `[확인]`
- 검증은 Ajv다(`gemini-cli:packages/core/src/utils/schemaValidator.ts` 1–130). `$schema`로 draft-07과 draft-2020-12를 고르고 `strictSchema: false`다. schema 컴파일이 실패하면 검증을 건너뛰고 null을 돌려 준다(fail-open). `coerceTypes`를 켜지 않아 Ajv 기본(변환 없음)이다. `validateBuildAndExecute`는 실패 시 `llmContent: "Error: Invalid parameters provided. Reason: …"`, `ToolErrorType.INVALID_TOOL_PARAMS`를 돌려 준다(tools.ts 647–662). `[확인]`
- 판정은 `PolicyEngine.check()`다(`gemini-cli:packages/core/src/policy/policy-engine.ts` 610–879). `PolicyDecision` = ALLOW / DENY / ASK_USER, `ApprovalMode` = PLAN < DEFAULT < AUTO_EDIT < YOLO 순으로 느슨해진다(`gemini-cli:packages/core/src/policy/types.ts` 1–389). 규칙은 priority로 정렬돼 높은 것이 이기고, `toolName: "*"` 와일드카드와 `argsPattern: RegExp`를 받는다. `defaultDecision` 기본은 ASK_USER이고 nonInteractive면 ASK_USER가 DENY가 된다. shell은 휴리스틱을 덧붙인다. workspace 밖 명령(392), 신뢰 못 하는 workspace의 git(399), 위험 명령(413)은 ASK_USER로 끌어올리고, 알려진 안전 명령은 ASK_USER를 ALLOW로 내릴 수 있으며(437), redirection은 `allowRedirection`이 없으면 ALLOW를 ASK_USER로 내린다(519–525). 파싱 실패는 ASK_USER, nonInteractive면 DENY다(495). YOLO에서 매치가 없으면 ALLOW(747). 빌드 파일 수정은 "Build File Protection" 합성 규칙(priority `MAX_SAFE_INTEGER`)으로 ASK_USER 또는 DENY가 된다(851–866). `[확인]`
- 기본 정책 TOML의 우선순위 밴드는 Admin(5.x) > User(4.x) > Workspace(3.x) > Extension(2.x) > Default(1.x)다(`gemini-cli:packages/core/src/policy/policies/write.toml` 머리 주석). write tool은 priority 10에서 ask_user, autoEdit 모드 priority 15에서 allow다. sandbox-default 모드의 default는 `network = false`, `readonly = false`이고 cat·ls·grep·head·tail 등만 `approvedTools`에 있다(`policies/sandbox-default.toml`). `[확인]`
- 승인 요청은 `confirmation-bus`의 `TOOL_CONFIRMATION_REQUEST`로 나가고 종류별로 내용이 다르다(`gemini-cli:packages/core/src/confirmation-bus/types.ts` 1–234). edit는 fileDiff·originalContent·newContent·diffStat을, exec는 command·rootCommands·untrustedFlags를, mcp는 serverName·toolName·toolArgs·toolDescription·toolParameterSchema를 담는다. `UPDATE_POLICY`로 workspace 또는 user 범위에 규칙을 영속할 수 있고, `forcedDecision`이 engine을 우회할 수 있다. 승인 대기 timeout은 찾지 못했다. `[미확인]`
- 스케줄러(`gemini-cli:packages/core/src/scheduler/scheduler.ts` 456–629)는 연속된 병렬 가능 call을 배치로 묶는다. `_isParallelizable`은 UPDATE_TOPIC과 EDIT tool이면 false, 그 외에는 `!args.wait_for_previous`이고 생략 시 기본 true다. 배치 검증은 `Promise.all`이고, 실행은 활성 call이 전부 scheduled 또는 terminal일 때만 시작해 승인 대기 하나가 배치를 막는다. 상태는 Validating / AwaitingApproval / Scheduled / Executing / Error / Cancelled다. `[확인]`
- 잘림은 앞을 남긴다. `truncateString`이 head를 남기고 `...[TRUNCATED]`를 붙이며 UTF-16 단위로 안전하다(`gemini-cli:packages/core/src/utils/textUtils.ts` 106). shell은 `MAX_CHILD_PROCESS_BUFFER_SIZE = 16MiB`, `SCROLLBACK_LIMIT = 50000`줄이고 스트리밍 버퍼는 앞에서 잘라 뒤를 남긴다(`shellExecutionService.ts` 404, 514–517). read-file은 "IMPORTANT: The file content has been truncated. Status: Showing lines start-end of total"과 offset 이어 읽기를 준다(read-file.ts 176–192). 검색 매치 기본 상한은 `DEFAULT_TOTAL_MAX_MATCHES = 100`이다(`tools/constants.ts` 6). `[확인]`
- 반복 감지는 `LoopDetectionService`다(`gemini-cli:packages/core/src/services/loopDetectionService.ts`). 도구 호출 키는 `sha256(name + ":" + JSON.stringify(args))`라 키 순서를 정규화하지 않는다(174–178). 최근 이력을 길이 1~5 주기가 5회(`TOOL_CALL_LOOP_THRESHOLD`) 반복하면 루프로 본다(313–349). 내용 루프는 같은 chunk가 `CONTENT_LOOP_THRESHOLD = 10`회면 감지하고, 코드 블록 안에서는 끈다. 확신도 `LLM_CONFIDENCE_THRESHOLD = 0.9`의 LLM 판정도 있다. `getDisableLoopDetection()`으로 세션에서 끌 수 있다(186–191). 감지가 실행을 막는지, 모델에 어떤 텍스트를 주는지는 확인하지 못했다. `[미확인]`

### OpenCode (`907b3bc518fa`)

- tool 정의는 `Tool.define(id, init)`이고 실행 전에 `Schema.decodeUnknownEffect(parameters)`로 검증한다(`opencode:packages/opencode/src/tool/tool.ts` 1–184). 실패는 `InvalidArgumentsError`로 "The {tool} tool was called with invalid arguments: {detail}.\nPlease rewrite the input so it satisfies the expected schema."를 돌려 준다. 결과는 `metadata.truncated`가 이미 있으면 그대로 두고 아니면 truncation을 통과한다. `[확인]`
- schema 변환(`opencode:packages/opencode/src/tool/json-schema.ts` 1–165)은 Effect Schema를 draft 2020-12로 내보내면서 `additionalProperties: true`를 지우고(49), 필수 아닌 속성의 null 변형을 빼며, 정수에 safe-integer 범위를 넣는다. 내보낸 schema가 `additionalProperties: false`를 말하지는 않는다. Effect Schema 런타임이 모르는 키를 어떻게 다루는지는 확인하지 못했다. `[미확인]`
- 알 수 없는 tool은 `{type:"error", value:"Unknown tool: name"}`, handler가 없으면 "Tool has no execute handler", decode 실패는 `ToolFailure("Invalid tool input: …")`다(`opencode:packages/llm/src/tool-runtime.ts` 23–35). 빈 입력은 `{}`로 본다(`opencode:packages/llm/src/protocols/shared.ts` `parseToolInput`). `[확인]`
- 권한은 `evaluate(permission, pattern, ...rulesets)`가 마지막에 매치되는 규칙을 쓰고, 매치가 없으면 `{action:"ask", pattern:"*"}`다(`opencode:packages/opencode/src/permission/index.ts` 1–224). `ask`는 패턴 중 하나라도 deny면 묻지 않고 `DeniedError`, 전부 allow면 통과, 아니면 pending을 만들고 `Event.Asked`를 내며 deferred를 기다린다. reply "reject"는 그 요청과 같은 세션의 다른 pending을 모두 거절하고, "once"는 그 요청만 통과하며, "always"는 메모리 `approved` 목록에 allow 규칙을 넣어 세션이 살아있는 동안 같은 패턴을 자동 승인한다. 디스크 영속은 찾지 못했다. `[미확인]`
- 기본 ruleset은 `{"*":"allow"}`에 doom_loop ask, 외부 디렉터리 ask, `.env` 읽기 ask만 더한다(`opencode:packages/opencode/src/agent/agent.ts` 120–264). build agent는 question·plan_enter를 allow로, plan agent는 plan 마크다운 밖 편집을 deny로, explore agent는 grep·glob·list·bash·webfetch·websearch·read만 allow로 둔다. 사용자 설정이 마지막에 합쳐져 이긴다. 즉 기본 agent는 편집을 포함한 거의 전부를 묻지 않는다. `[확인]`
- 잘림은 `MAX_LINES = 2000`, `MAX_BYTES = 50KiB`이고 `tool_output.max_lines`·`max_bytes`로 바꿀 수 있다(`opencode:packages/opencode/src/tool/truncate.ts` 1–157). 방향은 head(기본) 또는 tail이고, 넘치면 전문을 파일로 저장(7일, 시간마다 정리)하고 `...N bytes|lines truncated...`와 이어 읽기 힌트를 돌려 준다. task tool이 있으면 "explore agent에 맡겨라", 없으면 "Grep 또는 Read의 offset/limit를 써라"다. 바이트는 UTF-8 `Buffer.byteLength`다. read 결과는 `<path>…</path> <type>file</type> <content>줄번호…</content>`로 감싸고 "(Output capped at … Showing lines a-b. Use offset=N to continue.)"를 붙인다(`opencode:packages/opencode/src/tool/read.ts` 300–379). `[확인]`
- doom loop는 최근 tool part 3개의 이름과 `JSON.stringify(input)`이 같으면 `permission.ask({permission:"doom_loop"})`로 묻는다(`opencode:packages/opencode/src/session/processor.ts` `DOOM_LOOP_THRESHOLD = 3`, 29, 353–380). 실패가 아니라 호출을 세고, 키 순서를 정규화하지 않는다. 거절이 loop를 깨는지는 `experimental.continue_loop_on_deny`(647)가 정한다. `[확인]`

### Hermes (`343500b3547e`)

- 인자 변환을 적극적으로 한다. `coerce_tool_args`(`hermes:tools/arg_coercion.py` 20–80)가 schema를 보고 문자열 "42"를 정수로, "true"를 bool로, JSON 인코딩된 문자열을 배열·객체로 고치고, 배열 schema에 스칼라가 오면 한 원소 리스트로 감싼다. 해석이 애매하거나 inf·nan이면 원본을 그대로 둔다(184–207). 변환 실패를 모델에 오류로 돌리는 경로는 없고 로그로만 남긴다. `[확인]`
- 승인은 세 모드다. `approvals.mode` = manual(기본) / smart / off이고, YAML이 맨 `off`를 False로 읽는 것까지 정규화한다(`hermes:tools/approval_context.py` `_normalize_approval_mode` 198–237). timeout 기본은 300초이고 `MAX_SAFE_TIMEOUT_S`(약 1년)를 넘는 값은 clamp한다(240–258). cron·single-query·unattended의 기본은 deny다(`_binary_approval_mode` 282–306). `[확인]`
- 명령 가드 `check_all_command_guards`(`hermes:tools/approval.py` 1168–1233)의 순서는 이렇다. 격리된 컨테이너면 사용자 deny 규칙만 보고 통과하고, 그 다음 hardline floor(YOLO·mode=off로도 못 넘음, 1052–1075), 그 다음 yolo 또는 mode=off면 통과, 영구 allowlist 매치면 통과, 사람이 없으면 unattended 컨텍스트의 approve/deny로 즉시 결정하고, 있으면 tirith 스캔과 위험 패턴을 한 요청으로 묶어 사람에게 묻는다. hardline은 재앙적 삭제, 런타임 자기 삭제, `sudo -S` 비밀번호 파이프, 사용자 `approvals.deny` 규칙이다. 위험 패턴은 정규식 목록이다(`hermes:tools/approval_detection.py` `DANGEROUS_PATTERNS` 217–). `[확인]`
- 사람 결정 `_human_decision`(793–931)은 선택 plugin transport, gateway 대기, CLI 프롬프트 순이다. gateway는 명령과 설명을 redaction한 사본을 카드에 그리고 원본은 승인 뒤 실행한다(855–856). 무응답은 "Silence is not consent."로 deny하고(884–887), 취소는 거절로 기록하지 않는다(878–883). 선택지는 once / session / always / deny이고, smart 모드의 DENY를 사람이 뒤집으면 그 한 번만 허용하고 아무것도 저장하지 않는다(827–833). 세션 승인은 메모리, always는 디스크 allowlist다(`approve_permanent`, `save_permanent_allowlist` 367–449). `[확인]`
- 무인 컨텍스트에서 승인할 사람이 없으면 위험 명령을 자동 승인한다(`_run_approval_gate` 1013–1015, "set HERMES_INTERACTIVE or HERMES_GATEWAY_SESSION to require approval"). plugin이 플래그한 액션만 `fail_closed_when_no_human`으로 막힌다(1005–1012). tirith 스캐너를 import 못 하면 기본은 통과(`security.tirith_fail_open` 기본 True, approval_context.py 309–318)이고, unattended deny 모드에서만 fail-closed가 된다(approval.py 659–668). `[확인]`
- 반복 거절은 사람 거절이 아니라 guardian LLM의 연속 DENY를 센다. `approvals.denial_breaker_threshold` 기본 3이고 0 이하면 꺼지며, 넘으면 거절 메시지에 "STOP attempting variations"를 붙인다(approval.py 60–112). 사람 승인이 tally를 지운다(534–538). 같은 요청을 정규화해 세는 장치는 아니다. `[확인]`
- 잘림은 40% head / 60% tail이다. `truncate_head_tail`이 `... [OUTPUT TRUNCATED - N chars omitted out of T total] ...`를 사이에 넣는다(`hermes:tools/tool_output_truncate.py` 1–45). 터미널 기본 상한은 `DEFAULT_MAX_BYTES = 50000`, read_file은 `DEFAULT_MAX_LINES = 2000`, 줄당 `DEFAULT_MAX_LINE_LENGTH = 2000`이다(`hermes:tools/tool_output_limits.py` 14–16). 스트리밍 수집기는 넘치기 시작하면 전문을 spill 파일로 보내고 `_SPILL_CAP_CHARS = 5_000_000`에서 자른다(`hermes:tools/environments/base_output.py` 24–72). 웹 추출은 기본 15000자, 상한 clamp [2000, 500000], 넘치면 약 75% head / 25% tail이고 전문은 디스크에 2,000,000자까지 남긴다(`hermes:tools/web_tools_truncate.py` 16–87). `[확인]`

### Pi (`83692682f095`)

- 권한 판정 레이어가 없다. 실행 전 가로채기는 `beforeToolCall` hook뿐이고(`pi:packages/agent/src/agent-loop.ts` `prepareToolCall` 707–769), 이 hook은 확장(extension)이 등록해야 존재한다. coding-agent의 `AgentSession._beforeToolCall`은 `tool_call` handler가 없으면 `undefined`를 돌려 그대로 실행하고, handler가 `block`을 돌려야 막는다(`pi:packages/coding-agent/src/core/agent-session.ts` 630–653, runner.ts `emitToolCall` 1242–1260). 기본 설치에는 그런 handler가 없다. tool annotation(`readOnlyHint`, `destructiveHint`, `openWorldHint`)은 "검증되지 않았고 권한 확장이 참고할 수 있다"고만 적혀 있다(`pi:packages/coding-agent/src/core/extensions/types.ts` `ToolAnnotations` 513). Pi는 권한을 코어 기능이 아니라 확장이 얹는 것으로 둔다. `[확인]`
- 검증은 TypeBox다(`pi:packages/ai/src/utils/validation.ts` `validateToolArguments` 317–350). 검증 전에 `normalizeOptionalNulls`로 필수 아닌 null 키를 지우고, `Value.Convert`와 `coerceWithJsonSchema`로 변환한다. `coercePrimitiveByType`(59–131)은 null을 숫자 0·bool false·문자열 ""로, 문자열 숫자를 숫자로, bool을 0/1로, 숫자·bool을 문자열로 바꾼다. 실패하면 `Validation failed for tool "{name}":\n  - {path}: {message}\n\nReceived arguments:\n{json}`를 throw하고, loop는 이것을 오류 결과로 모델에 돌려 준다. `[확인]`
- 병렬은 tool이 정한다. `executeToolCalls`(508–523)는 `config.toolExecution === "sequential"`이거나 call 하나의 `executionMode === "sequential"`이면 전부 순차고, 아니면 병렬이다. 출력 토큰 한도로 잘린 메시지의 tool call은 전부 실행하지 않고 "인자가 잘렸을 수 있으니 완전한 인자로 다시 내라"는 오류 결과를 붙인다(`failToolCallsFromTruncatedMessage` 478–503). `[확인]`
- 결과 잘림·반복 감지·untrusted wrapping은 agent 패키지에서 찾지 못했다. `[미확인]`

### OpenClaw (`37efa0b4a644`)

- 반복 감지가 가장 정교하다. `detectToolCallLoop`(`openclaw:src/agents/tool-loop-detection.ts` 464–608)는 세션·run 범위 이력에서 다섯 가지를 본다. 없는 tool 재시도(`UNKNOWN_TOOL_THRESHOLD = 10`), 전역 회로 차단기(`GLOBAL_CIRCUIT_BREAKER_THRESHOLD = 30`), 알려진 polling tool의 무진행(`CRITICAL_THRESHOLD = 20`, wait는 10), 두 패턴이 번갈아 무진행인 ping-pong, 일반 반복이다. 경고 임계는 `TOOL_LOOP_WARNING_THRESHOLD = 10`이고 숫자 튜닝은 폐지돼 코드 상수가 유일한 기준이다(`tool-loop-thresholds.ts` 1–6). `[확인]`
- 같은 요청의 키는 `sha256(stableStringify(params))`다(`hashToolCall` 70–77). exec는 `title`을 빼서 표시용 문자열이 키를 갈라지게 하지 않는다. 결과 해시는 메시지 발송의 휘발성 id·시각을 제거한 뒤 만든다(235–272). 즉 키 순서와 표시 문자열과 휘발성 필드를 정규화하지만, 공백·배열 순서·null과 생략의 차이는 `stableStringify` 구현을 확인하지 못했다. `[미확인]`
- 차단은 실행 전이다. `tool-loop-admission.ts`(48–80)가 critical이면 `{kind:"critical-tool-loop", reason}`을 돌려 그 call을 실행하지 않고, warning은 한 번만 알린다. 이력 크기는 `TOOL_CALL_HISTORY_SIZE = 30`이다(tool-loop-detection.ts 53). 차단 메시지는 "Session execution blocked …"로 모델에 전달된다(505, 520, 551, 585). `[확인]`
- 승인 정책 본체가 `src/agents` 아래에 있는지 이번 조사에서 특정하지 못했다. 찾은 것은 workspace·bootstrap·transcript 정책 파일이라 명령 승인 흐름으로 확인하지 못했다. `[미확인]`

## 비교

기본 승인 정책. lophn은 되돌릴 수 없거나 심각한 일만 묻는다(D21).

| 프로젝트 | 기본 동작 | 물을 때 | 못 확인하면 | 한 번의 승인이 퍼지는 범위 |
|---|---|---|---|---|
| lophn | 묻지 않고 진행 | 되돌릴 수 없거나 심각할 때만 | deny | 그 요청 하나. 대상·입력·계약이 바뀌면 무효 |
| Codex | OnRequest: 모델이 정함 | sandbox가 제한하고 모델이 요청할 때 | 모델 판단에 남음 | ApprovedForSession은 세션, MCP는 영속 가능 |
| Gemini CLI | ASK_USER | 규칙 매치가 없을 때 기본이 묻기 | ASK_USER (nonInteractive면 DENY) | UPDATE_POLICY로 workspace·user 범위 영속 |
| OpenCode | `*`: allow | doom_loop, 외부 디렉터리, .env 읽기만 | ask (매치 없을 때) | "always"는 세션 메모리 |
| Hermes | manual: 위험 패턴만 묻기 | 위험 정규식·tirith 소견이 있을 때 | 무인 컨텍스트에선 자동 승인 | session은 메모리, always는 디스크 |
| Pi | 판정 없음 | 확장이 block할 때만 | 그대로 실행 | 해당 없음 |
| OpenClaw | 승인 본체 `[미확인]` | — | — | — |

입력 검증.

| 프로젝트 | 검증기 | 모르는 필드 | 숫자 문자열 | 실패 시 모델에 가는 텍스트 |
|---|---|---|---|---|
| lophn | 자체 | `invalid_input` | 거절 (변환 없음) | 오류 결과 |
| Codex | hook 경로만 확인 | `[미확인]` | `[미확인]` | "unsupported call", 파싱 실패는 raw string으로 hook에 |
| Gemini CLI | Ajv | schema를 따름 | 변환 없음 | "Error: Invalid parameters provided. Reason: …" |
| OpenCode | Effect Schema | 내보낸 schema에서 `additionalProperties:true` 제거 | `[미확인]` | "Please rewrite the input so it satisfies the expected schema." |
| Hermes | 변환 우선 | 그대로 통과 | 정수·실수로 변환 | 없음 (로그만) |
| Pi | TypeBox | schema를 따름 | 숫자로 변환, null은 0·false·"" | "Validation failed for tool …" + 받은 인자 JSON |

결과 잘림.

| 프로젝트 | 상한 | 방향 | 표시 | 전문 보존 | 이어 읽기 |
|---|---|---|---|---|---|
| lophn | UTF-8 24576바이트 또는 300줄 | 문서는 head, 로그는 tail | 잘림 표시 | ledger의 원본 | cursor |
| Codex | exec 1MiB, 응답 15MiB | 가운데 | `…N chars truncated…` + 원본 토큰 수 | 없음 | `[미확인]` |
| Gemini CLI | shell 16MiB·50000줄 | 문자열은 head, shell 버퍼는 tail | `...[TRUNCATED]` | 없음 | read-file은 offset |
| OpenCode | 2000줄 또는 50KiB | head 또는 tail | `...N bytes\|lines truncated...` | 파일로 7일 | offset/limit 힌트 |
| Hermes | 터미널 50000자, read 2000줄 | 40% head / 60% tail | `... [OUTPUT TRUNCATED - N of T] ...` | spill 파일 5,000,000자 | 웹은 디스크 사본 |
| Pi | `[미확인]` | — | — | — | — |

반복 실패.

| 프로젝트 | 무엇을 세나 | 정규화 | 임계 | 막으면 |
|---|---|---|---|---|
| lophn | 자동 재시도 소진 뒤의 최종 실패 | canonical JSON, 키 순서만 무시 | 최종 실패 2회면 3회째 차단, 한 번 더 하면 run 종료 | `not_executed(repeated_failure_blocked)` |
| OpenCode | 연속 호출 (성공이든 실패든) | `JSON.stringify` 그대로 | 3회면 사람에게 질문 | 실행은 계속될 수 있음 |
| Gemini CLI | 호출 패턴의 주기 | `JSON.stringify` 그대로 | 주기 5회, 내용 chunk 10회 | 모델에 가는 텍스트 `[미확인]` |
| OpenClaw | 무진행 결과 | `stableStringify`, exec는 title 제외 | 경고 10, 차단 20, 전역 30 | critical이면 실행 안 함 |
| Hermes | guardian LLM의 연속 DENY | 없음 | 3회면 메시지 강화 | 실행을 막진 않음 |
| Codex, Pi | 찾지 못함 | — | — | — |

## lophn에 가져올 것과 버릴 것

- `lophn-agent/harness/tools` R3 (숫자 문자열 변환 금지). Hermes `coerce_tool_args`와 Pi `coercePrimitiveByType`은 정반대로, 변환이 실패를 숨긴다. Pi는 null을 0·false·""로 바꾸므로 모델이 빠뜨린 값과 일부러 준 값이 구분되지 않는다. lophn이 거절하는 쪽을 유지한다. 가져올 것은 실패 텍스트의 구체성이다. OpenCode의 "schema를 만족하도록 다시 써라"와 Pi의 경로별 오류 한 줄은 모델이 고칠 위치를 알려 준다.
- `lophn-agent/harness/tools` 결과 상한. 방향은 프로젝트마다 다르다. Codex는 가운데, Hermes는 40/60, OpenCode는 선택, Gemini는 종류별이다. lophn의 "문서는 head, 로그는 tail"이 가장 내용에 맞다. 가져올 것은 전문 보존이다. OpenCode와 Hermes는 잘린 전문을 파일로 남겨 모델이 이어 읽게 한다. lophn은 ledger에 원본이 있으므로 파일 사본은 버리고, 잘림 표시에 원본 크기와 이어 읽는 cursor를 함께 주는 Codex·OpenCode 방식만 가져온다.
- `lophn-agent/harness/tools` 목록과 실행의 정의 일치. Codex의 `ToolExecutor`가 spec과 handle을 한 trait에 묶어 가장 가깝다. Gemini는 `getSchema()`가 실행 schema에 `wait_for_previous`를 주입해 모델이 보는 schema와 구현 schema가 달라진다. lophn은 주입 없이 한 정의를 쓴다.
- `lophn-agent/harness/tool-judgment` R 판정 순서와 D21. 여섯 프로젝트 중 "되돌릴 수 없으면 묻고 나머지는 묻지 않는다"를 기본으로 갖는 곳은 없다. OpenCode는 거의 전부 allow, Gemini는 거의 전부 ask, Codex는 모델에게 맡긴다. 어느 쪽도 가져오지 않는다. 특히 버릴 것은 Gemini의 `argsPattern` 정규식, OpenCode의 와일드카드, 양쪽의 "always" 영속이다. lophn 요구가 generic 규칙·와일드카드·정규식·세션 허가를 버린 것과 그대로 충돌한다.
- `lophn-agent/harness/tool-judgment` 확인 못 하면 deny. 이것과 같은 쪽은 Gemini의 nonInteractive 변환(ASK_USER를 DENY로)과 Hermes의 hardline floor뿐이다. 반대로 Hermes의 무인 자동 승인, Pi의 판정 부재, `security.tirith_fail_open` 기본 True는 fail-open이라 버린다. open-issues 후보: Gemini는 빌드 파일처럼 "내용으로 보면 위험하지만 규칙이 allow인 것"을 합성 규칙으로 끌어올린다. lophn은 효과와 되돌릴 수 있음만 보므로, 되돌릴 수 있는 write가 빌드 파일을 부수는 경우를 규칙으로 막을 자리가 없다. 요구를 바꿀 일은 아니고, 앱 command의 revert 검증이 이 자리를 대신하는지 구현 때 확인할 것.
- `lophn-agent/harness/tool-judgment` 사람 거절의 재질문 억제. 같은 요청을 다시 묻지 않는 비교 키를 가진 프로젝트는 찾지 못했다. OpenCode의 "always"와 Codex의 ApprovedForSession은 승인 쪽만 기억한다. Hermes는 무응답을 거절과 구분하고(timeout·cancelled는 denial tally에 안 들어감) 취소된 프롬프트를 사람 거절로 기록하지 않는다(approval.py 878–883). 이 구분은 lophn의 "거절만 억제하고 만료·취소·기술 실패는 거절이 아니다"와 같으므로 가져온다.
- `lophn-agent/harness/safety` R1–R4 반복 실패. 가져올 것은 OpenClaw의 결과 기반 판정이다. 호출 횟수가 아니라 결과가 같은지를 봐서, 진행 중인 반복과 막힌 반복을 구분한다. 버릴 것은 임계값이다. OpenClaw는 10·20·30, Gemini는 5, OpenCode는 3으로 lophn의 "최종 실패 2회"보다 훨씬 늦다. lophn 기준을 유지한다. open-issues 후보: 어느 프로젝트도 키 순서만 무시하고 공백·배열 순서·null·생략·타입을 전부 다르게 보는 canonical JSON 해시를 쓰지 않는다. `JSON.stringify`는 키 순서에 민감해 같은 요청을 다른 것으로 센다. lophn 명세가 이 프로젝트들보다 엄밀하며, 구현은 자체 정규화가 필요하다.
- `lophn-agent/harness/tool-judgment` 여러 call 중 일부만 ask. Gemini 스케줄러는 승인 대기 하나가 배치 전체를 멈추고, OpenCode는 한 요청의 거절이 같은 세션의 다른 pending을 모두 거절한다. lophn은 "하나라도 deny면 전부 deny, deny 없이 ask가 있으면 한 번만 물어 전부 적용"이라 둘 다 그대로 쓸 수 없다. 배치를 멈추는 시점(실행 전)만 참고한다.

## 구현 메모

판정 함수는 순수하게 둔다. 입력은 tool 효과, 대상, 인자, run 상태, 사람의 이전 거절 목록이고 출력은 allow / ask / deny와 이유 코드다. 프로젝트들의 공통 실수는 판정 안에 프롬프트와 저장을 섞는 것이다. Hermes `_human_decision`은 판정·전송·저장이 한 함수에 있다.

사람 거절의 비교 키는 safety R1의 요청 키와 같게 한다. 한 정규화를 두 곳이 쓰면 거절 억제와 반복 차단이 같은 요청을 다르게 세지 않는다.

```
요청 키 = sha256(canonical_json({tool, target, args}))
canonical_json: 객체 키 정렬, 그 외(공백, 배열 순서, null/생략/빈 값, 타입)는 그대로
```

승인 요청에 담을 것. Gemini가 종류별로 나누듯 lophn도 효과별로 담는다. write는 대상 경로와 diff, external은 대상과 전송 본문, 앱 command는 실행할 명령과 revert 명령. 모델이 적은 설명이 아니라 실행기가 해석한 값을 담아야 한다. Hermes가 카드에는 redaction한 사본을 그리고 실행은 원본으로 하는 구분(approval.py 855–856)을 그대로 쓴다.

timeout. Hermes 기본 300초, Codex는 `ReviewDecision::TimedOut`이 있다. lophn은 만료를 거절과 분리해야 하므로 timeout 결과는 `expired`로 두고 재질문 억제에 넣지 않는다. 숫자 기본값은 요구에 없으므로 여기서 정하지 않는다.

반복 실패 카운터의 리셋 조건은 lophn이 가장 좁다. 다른 요청의 성공, 모델 교체, compaction, 재시작으로 리셋하지 않는다. OpenClaw는 이력을 30개로 잘라 오래된 반복이 잊히므로 가져오지 않는다.

경계 테스트.

- 숫자 문자열 "42", "true", "", "null"이 각각 `invalid_input`이 되는지. Hermes·Pi는 이걸 조용히 변환한다.
- 객체 키 순서만 다른 두 요청이 같은 키로 합쳐지고, 배열 순서만 다른 둘은 다른 키로 남는지.
- 최종 실패 2회 뒤 3회째가 `not_executed(repeated_failure_blocked)`이고, 그 사이 다른 tool의 성공이 카운터를 못 지우는지.
- 사람이 거절한 요청은 같은 run과 같은 사용자 메시지의 handoff 계열에서 다시 묻지 않고, 그 밖에서는 묻는지. timeout과 취소는 거절로 세지 않는지.
- 대상 셋 중 하나만 deny면 전부 deny이고 아무것도 실행되지 않는지. ask가 섞이면 승인 요청이 하나이고 승인 뒤 실행 직전 재검증에서 대상이 바뀌었으면 그 승인이 무효인지.
- 결과가 UTF-8 24576바이트와 300줄 중 먼저 닿는 쪽에서 잘리고, 멀티바이트 문자와 JSON 문자열이 중간에 끊기지 않는지. 문서는 앞, 로그는 뒤가 남는지.
- schema에 없는 필드를 모델이 넣으면 `invalid_input`이고 나머지를 실행하지 않는지. Gemini는 schema 컴파일 실패 시 검증을 건너뛰므로, lophn은 schema를 못 읽으면 deny여야 한다.
