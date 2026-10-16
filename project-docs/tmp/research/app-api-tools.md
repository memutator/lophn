# R4 조사: app-api를 tool로 보이기 (2026-10-15)

질문(`research-items.md` R4): 바깥 tool 묶음(MCP server 등)을 model에 보일 때 이름과 namespace를 어떻게 짓나, tool이 많으면 언제부터 이름만 보이고 검색으로 schema를 부르게 하나, session 도중 tool이 더해지거나 빠지거나 schema가 바뀔 때 prompt cache를 어떻게 지키나, 빠진 tool을 부른 지난 기록은 어떻게 두나. lophn에서는 앱 하나를 할당하면 그 앱의 app-api 전부가 agent의 tool이 되고(S2 4장), release activation으로 도중에 바뀐다.

## 대상과 근거

모든 repo는 `git clone --depth 1`로 받아 읽기만 했다. 실행, install, build는 하지 않았다. 확인하지 못한 것은 "확인 못함"으로 적었다.

| 대상 | 버전 | 근거 |
|---|---|---|
| Claude Code | 캡처 v2.1.299(`claude-code-prompt-assembly copy.md` 6장), 공식 문서 2026-10-15 취득 | 문서: code.claude.com/docs/en/ 의 `mcp`("Scale with MCP tool search", "Dynamic tool updates", "Tools with names longer than 128 characters", "Tool availability"), `errors`("No such tool available", "MCP tool name over 128 characters", "tool_use.name over 200 characters"), `tools-reference`, `permissions`, `agent-sdk/tool-search`. 이 조사를 돌린 Claude Code session의 system prompt와 system-reminder에서 본 문구(아래 "관찰" 표시). source는 보지 않았다. |
| Anthropic API | 문서 2026-10-15 취득 | platform.claude.com/docs/en/ 의 `agents-and-tools/tool-use/tool-search-tool`, `agents-and-tools/tool-use/define-tools`, `build-with-claude/prompt-caching`, `build-with-claude/mid-conversation-system-messages` (Claude Code와 pi가 올라타는 provider 기능) |
| Codex | `openai/codex` `bb64b894fd67` (2026-10-15). 경로는 `codex-rs/` 기준 | `codex-mcp/src/tools.rs`, `codex-mcp/src/mcp/mod.rs`, `codex-mcp/src/binding.rs`, `core/src/mcp_tool_exposure.rs`, `core/src/tools/spec_plan.rs`, `core/src/tools/handlers/{tool_search,tool_search_spec,mcp}.rs`, `core/src/tools/registry.rs`, `core/src/context/world_state/top_level_tools.rs`, `prompts/src/model_messages/incremental_tools.rs`, `rmcp-client/src/logging_client_handler.rs`, `core/src/mcp_tool_call.rs` |
| pi | `badlogic/pi-mono` `b06c1f2cf1dea` (2026-10-14). 경로는 `packages/` 기준 | `coding-agent/docs/mcp.md`, `coding-agent/docs/cli.md`, `coding-agent/src/extensions/mcp/{tools,index,runtime}.ts`, `coding-agent/src/extensions/tool-search/tool.ts`, `ai/src/utils/transcript.ts`, `ai/src/api/{anthropic-messages,openai-completions}.ts`, `durable/docs/spec.md`, `agent/src/agent-loop.ts` |
| OpenCode | `sst/opencode` dev `bdf4793286f7` (2026-10-15). V2 구조. 경로는 `packages/core/src/` 기준 | `tool/mcp.ts`, `tool.ts`, `tool/runtime.ts`, `codemode/{catalog,instructions}.ts`, `instructions/index.ts`, `mcp/index.ts`; 문서 opencode.ai/v2/docs/mcp-servers |
| Hermes | 사용자 설치본 `/home/pyosechang/.hermes/hermes-agent` `decf192176b7` (2026-10-11). 읽기만 함 | `tools/mcp_tool_schema.py`, `tools/mcp_tool_health.py`, `tools/mcp_tool_agent.py`, `tools/tool_search.py`, `tools/mcp_tool.py`, `tools/registry.py`, `agent/turn_context.py`, `agent/conversation_loop.py`, `agent/turn_tool_validation.py`, `website/docs/user-guide/features/{tool-search,mcp}.md` |
| Gemini CLI | `google-gemini/gemini-cli` `06d329873703` (2026-10-14) | `packages/core/src/tools/{mcp-tool,mcp-client,mcp-client-manager,tool-registry}.ts`, `core/client.ts`, `config/config.ts`, `scheduler/scheduler.ts`, `docs/tools/mcp-server.md` |

캡처 파일의 식별자(device, account, session, email, UUID 꼴 값)는 옮기지 않았다. 기존 조사 `agent-def-claude-codex.md`, `agent-def-opencode-pi-gemini.md`, `agent-def-hermes-goose-cline.md`와 겹치는 것은 여기서 다시 쓰지 않고, 이번에 새로 확인했거나 고쳐진 것만 적는다. 고친 점은 맨 끝 "기존 조사와 달라진 점"에 모았다.

## 1. provider가 주는 부품 (Anthropic API)

harness의 선택을 이해하려면 먼저 provider 쪽 부품이 필요하다. 아래는 모두 platform.claude.com 문서에서 읽었다.

- **tool 이름 제한:** `^[a-zA-Z0-9_-]{1,128}$` (`define-tools`). 이전 64자에서 128자로 늘었다. Claude Code 문서는 128자를 넘으면 그 tool만 요청에서 뺀다고 쓴다. OpenAI 호환 provider와 Gemini는 64자다(아래 harness 주석).
- **tool search tool:** `tool_search_tool_regex_20251119` / `tool_search_tool_bm25_20251119`. `tools` 배열에 정의를 전부 보내되 `defer_loading: true`인 것은 system prompt prefix에서 빠진다. 검색하면 API가 `tool_reference` block을 대화에 inline으로 붙이고 full 정의로 펼친다. "prefix는 건드리지 않으므로 prompt cache가 지켜진다". 한 요청에 deferred tool은 최대 10,000개, 검색 결과는 기본 5개(model이 1~10,000 사이 `limit`을 줄 수 있음), regex 200자·BM25 500자. 최소 한 tool(보통 tool search tool)은 deferred가 아니어야 한다. `defer_loading` tool에는 `cache_control`을 못 붙인다.
- **쓸 때의 기준(문서):** tool 10개 이상, tool 정의가 10k token 넘음, MCP server 여러 개(200+ tool)면 쓴다. 10개 미만이거나 정의가 작으면 쓰지 않는다. "자주 쓰는 3~5개는 deferred로 하지 않는다". 이름에 service 접두(`github_`, `slack_`)를 일관되게 붙이면 검색 한 번에 한 묶음이 걸린다. system prompt에 tool 범주 설명을 한 줄 넣으라고 권한다.
- **mid-conversation tool 변경 (beta, `inline-tools-2026-09-15`):** `tools` 배열을 건드리면 cache 전체가 깨진다(`prompt-caching`: tools → system → messages 순으로 prefix가 hash되고, 한 단계가 바뀌면 그 뒤가 전부 무효). 대신 대화 중간에 `role: "system"` message를 붙이고 그 안에 `tool_addition`(정의를 값으로 실을 수 있음) / `tool_removal`(이름으로 참조) block을 둔다. 같은 이름에 다른 정의를 보내면 그 지점부터 새 정의가 옛 것을 대체한다. 다른 종류의 tool이 같은 이름을 쓰면 400 `tool_name_conflict`. 한도: 대화 중 정의한 tool 10,000개, 정의 합계 4 MB, 위반하면 400 `available_tools_limit_exceeded`. system message는 `user` turn(tool_result 포함) 바로 뒤, `assistant` turn 앞에만 둘 수 있다(tool_use와 tool_result 사이는 불가). 이미 보낸 system message를 고치거나 빼면 그 뒤 cache가 무효가 되므로 새 message를 덧붙이라고 한다. 문서 경고: tool output 같은 바깥 내용을 system message에 넣지 마라(operator 권한을 얻는다).
- 위 문서가 말하지 않는 것(확인 못함): 지난 대화의 `tool_use`가 지금 `tools`에 없는 tool을 가리킬 때 API가 어떻게 하는지, `tool_removal` 뒤에 model이 그 tool을 부르면 무엇이 돌아오는지.

## 2. harness별 정리

### 2.1 Claude Code

**이름 (문서 `mcp`, `errors`, 관찰)**
- MCP tool: `mcp__<server>__<tool>`. plugin이 번들한 server는 `mcp__plugin_<plugin>_<server>__<tool>`이고 `A-Za-z0-9_-` 밖의 문자는 `_`로 바뀐다(문서에 이 변환이 명시된 것은 plugin 이름뿐). 일반 server의 변환은 문서에 없고, 이 session에서 본 server 표시명 "claude.ai Claude Docs"의 tool이 `mcp__claude_ai_Claude_Docs__batch`로 나오는 것(관찰)으로 공백과 `.`이 `_`가 됨을 짐작할 수 있다.
- 이름 전체가 128자를 넘으면 그 tool만 요청에서 뺀다(v2.1.292 이후; 그 전에는 보내서 모든 요청이 400). `--debug` 로그에 `Tool "mcp__<server>__<tool>" is not sent to Claude: its name has <N> characters and the API accepts at most 128`. 해결은 사람이 server 이름을 줄이는 것뿐이다. hash suffix 같은 자동 축약은 없다.
- 같은 이름 충돌: 문서에 tool 이름 충돌 처리는 없다(확인 못함). server 이름이 여러 scope에서 다른 endpoint로 겹치면 경고만 한다. 예약 이름(`workspace`, `claude-in-chrome` 등)은 로드를 건너뛴다.
- permission rule의 이름 단위: `mcp__puppeteer`(server 전체), `mcp__puppeteer__*`, `mcp__puppeteer__puppeteer_navigate`(`permissions` "MCP"). 이름이 곧 rule 문자열이라 이름 규칙을 바꾸면 사용자 rule이 깨진다고 `errors` 문서가 직접 적는다("update what refers to the server or its tools by the old name").
- schema 위생: 최상위 property 이름은 1~64자 ASCII 문자·숫자·`_`·`.`·`-`만 허용하고, 어기면 그 tool을 빼고 "Claude에게 어떤 tool을 왜 뺐는지 알린다". 최상위 `anyOf/oneOf/allOf`는 평탄화하고 description 앞에 한 문장을 붙인다.

**tool이 많을 때 (문서 `mcp` "Scale with MCP tool search", `agent-sdk/tool-search`, `context-window`)**
- tool search가 **기본 켜짐**이고 MCP tool은 **전부 deferred**다. session 시작에 tool 이름과 server instructions만 context에 올린다. "Claude Code doesn't impose a fixed per-server tool cap; the practical limit is your context window budget."
- `ENABLE_TOOL_SEARCH`: (unset)=전부 deferred, `auto`=deferred 대상 정의 합이 context의 10% 미만이면 upfront로 올리고 10% 이상이면 전부 defer, `auto:N`=N%(0~100), `false`=전부 upfront, `true`=비-first-party `ANTHROPIC_BASE_URL`에서도 유지. 모델이 Opus 4/Sonnet 4/Haiku 4.5 이전이면 설정과 무관하게 upfront. `ANTHROPIC_BASE_URL`이 proxy면 `tool_reference`를 못 넘길까 봐 끈다.
- server 단위 예외 `alwaysLoad: true`(그 server tool은 항상 upfront; 시작 때 5초까지 기다림), `alwaysLoad: false`(server가 upfront를 요청해도 defer). tool 단위로는 server 쪽이 `tools/list` 항목의 `_meta["anthropic/alwaysLoad"]`를 `true`/`false`로 준다. 이 `_meta` 규약은 lophn이 app-api 선언에 "항상 보임" 표시를 둘 때 그대로 참고할 만하다.
- description 길이 한도: 서버 instructions와 upfront tool의 description은 4,096자, tool search로 불러오는 tool의 description은 16,384자까지 보이고 넘으면 잘린다. 검색은 짧은 쪽 한도 안의 글만 본다고 적혀 있다("put the words Claude would search for near the start"). `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH`로 바꾼다.
- 모델이 보는 꼴: system prompt에 "Some tools are deferred and not listed above. When a deferred tool is surfaced later in the conversation, its full schema appears as a function definition inside a functions block"류 안내가 있고, 이름 목록은 system-reminder로 들어온다(관찰, 아래 문구). model은 `ToolSearch`를 `select:Read,Edit`(이름으로 정확히) 또는 키워드 검색(`+slack send`처럼 `+`는 필수어)으로 부르고 기본 5개를 받는다(관찰: ToolSearch 정의). 불러온 schema는 SDK 문서 기준 "compaction으로 발견한 message가 요약될 때까지" 남고, 그 뒤엔 다시 검색해야 한다.
- 알림 문구(관찰, 이 session의 system-reminder): `The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ToolSearch with query "select:<name>[,<name>...]" to load tool schemas before calling them:` 뒤에 이름 목록. 또 `The following tools just became available and are ready to use:` 뒤에 upfront로 오는 tool의 정의 목록. 즉 **도중에 생긴 tool은 대화 message로 알리고 `tools[]`를 고치지 않는다**.
- 실패 server 정보: tool search가 켜져 있으면 연결 실패한 server와 오류를 Claude에게 알리고, 검색 결과가 비면 같은 정보를 결과에 붙인다.

**도중 변경 (문서 `mcp` "Dynamic tool updates", "Tool availability")**
- server가 `notifications/tools/list_changed`를 보내면 interactive session에서는 그 server의 목록을 다시 받아 오고 재연결은 필요 없다. `-p`와 Agent SDK에서는 tool 목록만 갱신한다. refresh가 실패하면 이전에 찾은 tool을 유지한다(v2.1.214 전에는 실패하면 빈 목록으로 바꿔 버렸다).
- tool search가 켜진 상태에서 server가 session 중에 연결을 마치면 "같은 turn의 다음 요청에서" 그 server의 tool 이름을 Claude에게 나열한다. 기다릴 때는 `ToolSearch`가 대기를 맡고, tool search가 꺼진 구성에서는 `WaitForMcpServers` tool이 맡는다.
- list_changed로 **빠진** tool을 model에게 어떻게 알리는지는 문서에 없다(확인 못함). 이 session에서 본 알림은 "더해짐"뿐이다.
- 효과: deferred tool의 정의는 API가 prefix 밖에 두므로 `tools[]` prefix가 안 변하고 cache가 유지된다. 반면 `alwaysLoad`/upfront tool이 바뀌면 `tools[]`가 바뀌어 cache가 깨진다(Anthropic cache 표). Claude Code가 `inline-tools` beta를 쓰는지는 확인 못함(pi는 쓴다).

**빠진 tool을 부를 때 (`errors` "No such tool available")**
- tool_result로 `Error: No such tool available: <tool name>`을 돌려주고 turn은 이어진다. 이유를 알면 문장을 덧붙인다(`... Tool names are case-sensitive: call Read instead.`).
- session을 resume한 직후 MCP server가 첫 연결 중이면 호출을 최대 10초 잡아 두었다가 실행한다. 못 이어지면 같은 오류.
- 대화 기록의 `tool_use.name`이 200자를 넘으면 도착할 때와 저장된 대화를 불러올 때 200자로 자르고 같은 오류로 끝낸다(API 400 방지). 기록은 지우거나 고쳐 쓰지 않는다.

**효과 표시:** `tools[]` 정의에는 annotation 필드가 없다(캡처 전체에서 0건). MCP annotation 사용은 문서에 없다(확인 못함). 대신 server가 `_meta["anthropic/requiresUserInteraction"]: true`를 주면 그 tool은 모든 permission mode에서 호출마다 묻고 "다시 묻지 않기"도 없다(v2.1.214+). `_meta["anthropic/maxResultSizeChars"]`로 결과 크기도 정한다. 즉 승인 성격은 model에 보이는 schema가 아니라 `_meta`와 harness 규칙으로 간다.

### 2.2 Codex

**이름 (`codex-mcp/src/tools.rs`, `codex-mcp/src/mcp/mod.rs`)**
- Responses API의 `namespace` tool을 쓴다. namespace는 `mcp__<server>`, tool 이름은 `<tool>`이고 둘을 `__`로 이어 평평한 이름 `mcp__<server>__<tool>`이 된다(`connection_manager_tests.rs`의 `model_tool_name_len`). 접두는 기본 켜짐이고 `non_prefixed_mcp_tool_names` feature(UnderDevelopment)가 끈다(`tools.rs:22,113`, `features/src/lib.rs:1597`).
- 변환: `[A-Za-z0-9_]` 밖은 모두 `_`(`mod.rs:583`), 빈 이름은 `_`. 원래 server/tool 이름은 `ToolInfo`에 따로 보존하고 protocol 호출에는 원본을 쓴다.
- 길이: 전체 128 byte(`tools.rs:226`). 넘으면 sha1 앞 12자 suffix(`_<hash>`)를 붙여 줄인다.
- 충돌: 같은 base 이름으로 겹치는 항목은 **전부** hash suffix를 받는다(순서에 따라 누가 plain 이름을 갖는지가 달라지지 않게 하려는 것). 이후 raw identity 순으로 정렬하고 마지막 안전망으로 이름이 이미 쓰였으면 hash를 바꿔 가며 재시도한다(`unique_callable_parts`). 완전히 같은 (server, namespace, tool)은 경고하고 건너뛴다.
- 사용자 filter: server 설정 `enabled_tools`(allowlist)/`disabled_tools`(denylist)를 등록 전에 적용한다. 빠진 tool은 model에 선언조차 안 된다. 노출 위치별 제외 `omit_tools_from`도 있다.

**tool이 많을 때 (`core/src/mcp_tool_exposure.rs:84`, `core/src/tools/spec_plan.rs:155,265,392`)**
- 기준은 개수나 token이 아니라 **모델 속성**이다: `model_info.supports_search_tool`이 참이면 MCP tool 전부가 `Deferred`, 아니면 전부 `Direct`다. 번들 모델 목록(`models-manager/models.json`)의 11개 모델이 모두 이 플래그가 참이다. 임계 token 같은 설정은 찾지 못했다(확인 못함). `omit_tools_from`으로 server 단위로 deferred/direct 표면을 뺄 수 있다.
- `tool_search`는 BM25 클라이언트 실행 tool이고 기본 limit 8(`tools/src/tool_discovery.rs:7`). description은 `# Tool discovery ... Searches over deferred tool metadata with BM25 and exposes matching tools for the next model call.` 뒤에 `You have access to tools from the following sources:` 와 server 이름·설명 목록(512 KiB 한도)을 **tool 정의 안에** 넣는다(`tool_search_spec.rs`). 그래서 server가 추가되면 이 tool의 description, 곧 `tools[]`가 바뀐다. 이 목록을 뺀 모드(`ToolSearchSourceListing::Omit`)도 있다.
- 검색 결과는 `ToolSearchOutput`으로 history에 들어가고, 찾은 tool은 "다음 model 호출"부터 보인다.
- 보조: agent plugin의 MCP tool은 tool당 8,000 byte, 합계 64,000 byte 예산을 넘으면 `Hidden`(`mcp_tool_exposure.rs:19-20`).

**도중 변경**
- MCP 목록은 `McpBinding`의 "frozen model-visible catalog"(`binding.rs:81`)이고, step마다 `build_tool_router`가 binding에서 tool 목록을 새로 만든다. server가 `tools/list_changed`를 보내도 `rmcp-client`는 `info!("MCP server tool list changed")` 로그만 남긴다(`logging_client_handler.rs:86`). 새 catalog는 설정·환경·인증이 바뀌어 runtime이 dirty가 될 때(`session/mcp.rs:201` `refresh_mcp_if_dirty`) 다시 만든다. list_changed 알림만으로 갱신하는 경로는 찾지 못했다(확인 못함).
- 요청 단위로는 `inference_tools_changed`가 바뀐 tool 목록을 감지해 `tools_changed`로 기록한다(`client.rs:433,1432`, `turn.rs:2649`). 즉 tool 목록이 바뀌면 cache를 잃는 것을 전제로 계측만 한다.
- **incremental tools** (feature `incremental_tools`, **UnderDevelopment, 기본 꺼짐**, `use_responses_lite` 모델만): `tools`를 요청 필드에서 빼고 tool 정의를 `<tools>` world-state section으로 history에 넣는다. 이후 바뀐 것만 새 item으로 덧붙인다(`top_level_tools.rs`). 단위 hash: namespace 헤더와 member를 따로 hash해 `added` / `removed` / `schema_changed`를 센다.
  - 더해지거나 바뀐 tool은 developer role의 `AdditionalTools` item(바뀐 member만 든 namespace 정의)로 들어간다. namespace가 새로 들어오면 앞에 developer 안내를 붙인다: `This is an incremental tools update. Previously declared tools remain available for direct calls unless explicitly marked unavailable. If a tool is redefined here, its latest definition replaces the earlier one.` (`incremental_tools.rs` 기본 문구; model catalog로 덮어쓸 수 있고 512 byte 이하)
  - 빠진 tool은 developer message 하나로: `The following tools are no longer available. Do not call them:` 뒤에 `- <name>` 목록, namespace 전체가 빠지면 `The following namespaces are no longer available. Do not call tools in them unless those tools are declared in a later update:`. namespace가 지워지면 그 안의 member는 이 notice에 합쳐 센다.
  - namespace 설명(instructions)만 바뀌면: `Updated instructions for the {name} namespace:\n<새 설명>`, 지워지면 `The {name} namespace no longer has additional instructions.`
  - 공통 불변식: 이전 snapshot(hash 표)을 rollout에 저장해 compact·resume 뒤에도 diff가 이어진다.

**빠진 tool을 부를 때:** registry에 없으면 `FunctionCallError::RespondToModel("unsupported call: <tool name>")`(custom tool은 `unsupported custom tool call: ...`)을 돌려준다(`registry.rs:650-672,962`). history는 지우지 않는다.

**효과 표시:** model에 보내는 정의에 annotation을 넣지 않는다. MCP annotation은 승인 판정에 쓴다(`mcp_tool_call.rs:2472-2503`): `destructiveHint==true`이면 승인 필요, `readOnlyHint==true`이면 불필요, 둘 다 없으면 `destructive` 기본 true로 보아 승인, `openWorldHint` 기본 true도 필요. 앱별 `approval_mode`(auto / prompt / writes / approve)로 덮어쓴다. `readOnlyHint`는 병렬 호출 허용 여부(`mcp.rs:142`)에도 쓰인다.

### 2.3 pi

pi는 이전 조사(commit `b45e0eb`) 때는 MCP가 없다고 했는데 `b06c1f2cf1dea`에는 `packages/mcp`와 `coding-agent/src/extensions/mcp/`가 있다(아래 "기존 조사와 달라진 점").

**이름 (`coding-agent/docs/mcp.md` "Configuration rules", `extensions/mcp/tools.ts:84`)**
- server 이름은 영문자·숫자·`_`·`-`만. tool은 `mcp__<server>__<tool>`, `[A-Za-z0-9_]` 밖은 모두 `_`. `-`와 `_`만 다른 server 이름은 같은 server로 보아 두 번째를 거부한다.
- 길이 상한 64(`tools.ts:49`). 넘거나 이미 쓰인 이름과 겹치면 sha256 앞 8자 suffix. 충돌하는 이름은 **전부** suffix를 받는다("Like Codex"라고 주석에 적혀 있다).
- 이름이 codemode script가 부르는 식별자도 된다.

**tool이 많을 때 (`mcp.md` "Control tool exposure")**
- server별 `exposure`와 tool별 `toolExposure`(정확한 이름이 pattern보다 우선, pattern은 `*`):

| exposure | 의미 |
|---|---|
| `codemode` (**기본**) | model에게 선언하지도 codemode description에 나열하지도 않는다. script 안에서 `searchTools()`, `describeTool()`, `ALL_TOOLS`로 찾아 부른다 |
| `deferred` | `tool_search`가 찾아 다음 model 호출부터 선언한다 |
| `direct` | 기본 tool처럼 선언한다 |
| `hidden` | 등록은 하되 닿을 수 없다 |

- 개수·token 기준은 없다. 사람이 server와 tool마다 고른다. `codemode`나 `deferred` server는 system prompt의 `mcp_servers` section에 "접근 방법 + `description` 한 줄(없으면 server instructions 첫 줄)"로만 나열된다. `tool_search`는 기본 꺼짐이고 `deferred` server가 있으면 자동으로 켜진다. `tool_search`는 BM25, 기본 limit 8.
- `description`은 사람이 server마다 쓰는 한 문장으로, tool search 순위와 시스템 prompt 나열에 쓰인다.
- 사람 필터: `--tools`는 `mcp__`로 시작하는 항목이 하나라도 있어야 MCP tool을 같이 거른다. `--exclude-tools`, `--no-mcp`.

**도중 변경**
- list_changed(`runtime.ts:380`): 목록을 다시 받아 `registerTools`가 새 tool을 등록한다. **withdrawn tool은 지워지지 않고 `exposure: "hidden"`으로 다시 등록**한다(`index.ts:445-448`; "Tools cannot be unregistered"). 서버가 다시 내면 설정된 exposure로 되돌린다. 문서 문구: "new tools are added and withdrawn tools become unreachable".
- prompt cache 보호가 두 겹이다. (1) `mcp_servers` section이 바뀌면(server 연결 등) "새 section을 대화에 덧붙이고 tool 선언은 바꾸지 않아 앞의 message가 cache된 채 남는다"(`mcp.md`). (2) 활성 tool 집합이 바뀌면 transcript에 `toolsAdded`/`toolsRemoved`가 붙은 system message를 덧붙인다. 이 message는 provider에 따라 달리 내려간다(`ai/src/utils/transcript.ts`, `resolveTranscriptTools`): Anthropic이 mid-conversation tool 변경을 받는 모델이면 `tool_removal`/`tool_addition` block + `inline-tools-2026-09-15` beta header(`anthropic-messages.ts:1385-1396`; 테스트 `ai/test/transcript-tool-changes.test.ts`), Kimi 계열 chat completions는 `role: system`에 `tools`를 실은 message(`openai-completions.ts:1251`), 그 밖에는 제거나 같은 이름 재선언이 있으면 현재 tool 목록 전체를 요청에 보낸다. 마지막 경우는 문서 말대로 "Providers that cannot represent the transition receive a complete transcript checkpoint, which can invalidate the cached prefix."
- 같은 이름이 다시 선언되면 옛 정의를 `toolsRemoved`로 먼저 빼고 `toolsAdded`로 다시 넣는다. 순서가 달라지면 전체를 빼고 다시 넣는다(`durable/src/harness/prompt.ts` `planTools`; 같은 로직이 `coding-agent`의 `agent-session.ts`에도 있다는 것은 기존 조사 근거).
- model에게 변경을 글로 알리는 문구는 tool 변경에는 **없다**. section 변경은 `Updated system prompt section "<name>":` / `Removed system prompt section "<name>".`(`ai/src/utils/text.ts:28`)로 알리지만 tool 변경은 구조(block 또는 목록)로만 알린다.
- `tool_search`로 불러온 tool은 활성 집합을 거쳐 transcript에 기록되므로 `/tree`, resume, fork 후에도 그 branch에서 선언된 채 남는다.
- 연결 시점: server는 session 시작 때 background로 연결한다. 첫 prompt는 `direct` tool이 있는 server만 최대 10초 기다린다.

**빠진 tool을 부를 때**
- 이름이 현재 선언에 없으면 agent loop가 `Tool <name> not found` error result를 돌린다(`agent/src/agent-loop.ts:716-722`). durable harness 쪽은 `tool_unavailable`(`Tool <name> is not available`) 오류 진단을 tool result로 주고 run을 이어 간다. 구현이 없어진 tool은 요청에서 빼고 다음 delta의 `toolsRemoved`에 올리며, 다시 풀리면 `toolsAdded`로 현재 선언을 올린다(`durable/docs/spec.md` 4절 "A missing tool implementation never fails a request").
- MCP tool 쪽에서도 실행 때 "MCP tool `<server>/<tool>` is no longer available." / "MCP server `<server>` is disabled." 오류를 낸다(`index.ts` `getClient`).

**효과 표시:** `ToolDefinition`에 MCP식 annotation(`readOnlyHint` 등)을 선택 필드로 둘 수 있지만 pi 자체는 아무것도 막지 않는다(기존 조사). model에 보내는 schema에도 넣지 않는다.

### 2.4 OpenCode (V2)

**이름 (`tool/mcp.ts:16-17`, `tool/runtime.ts:276-281`, 문서 mcp-servers)**
- namespace는 `server.replace(/[^a-zA-Z0-9_-]/g, "_")`, tool id는 `<namespace>_<tool 정규화>`(구분자 `_` 하나, 접두 없음). 예: server `context 7`, tool `resolve.library/id` → `context_7_resolve_library_id`. 문서가 "Choose short server names that remain unique after normalization"라고 사람에게 맡긴다.
- 같은 id가 겹치면 별도 처리가 없다. registry가 `Map.set(id, ...)`로 등록해 나중 것이 앞 것을 덮는 것으로 읽힌다(`tool.ts:183-184`; 코드 독해이며 실행해 보지 않았다). hash suffix나 길이 제한 코드는 찾지 못했다(확인 못함).
- permission action 이름이 `<server>_<tool>`이고 wildcard(`context7_*`) deny를 준다. 어떤 tool의 모든 resource에 deny면 그 tool은 request에 선언되지 않는다(`whollyDisabled`).
- MCP prompt는 `<server>:<prompt>` command가 된다.

**tool이 많을 때 (`codemode/*`, 문서)**
- **기본은 Code Mode**다. server 설정 `codemode: false`가 아니면 MCP tool은 provider의 native tool 목록에 오르지 않고 `execute` tool 하나(JS를 받음) 안에서 `tools.<namespace>.<tool>(...)`로 부른다. 즉 model이 보는 `tools[]`는 `execute`와 `codemode:false`인 직접 tool뿐이다. 
- model에게는 catalog를 instructions로 보인다(`codemode/instructions.ts`, `catalog.ts`): 모든 namespace는 항상 보이고, tool별 listing(`path // 첫 줄 설명(120자까지)`)은 **inline budget 2,000 token**(4자=1token 추정, `catalog.ts:50`)을 채울 때까지 namespace별로 한 줄씩 돌아가며 짧은 것부터 넣는다. 다 못 넣으면 `- <namespace> (N tools, M shown)` 꼴이고 본문이 `The catalog is partial. Inside execute, use search(...) to find a tool, then call it by the path in the result. ... Do not guess tool names.`로 바뀐다. 다 들어가면 `The catalog is complete. Do not guess tool names.`
- 즉 기준은 개수가 아니라 **token 예산**이고, 예산을 넘는 부분은 "이름조차 안 보이고 `search`로 찾는" 상태가 된다. 개별 tool schema는 `search`/`describe` 쪽에 있다.

**도중 변경**
- `Mcp` 서비스가 server별 `ToolsChanged` event를 내고, `tool/mcp.ts`가 100ms debounce로 모아 registry를 `reload()`한다(`mcp.ts:126-144`; server가 알림을 뭉쳐 보내고 매번 전체 catalog를 읽기 때문이라고 주석).
- 요청마다 `registry.snapshot(permissions)`가 그 순간의 definitions를 만든다. 직접 tool은 이름순으로 정렬해 요청 사이 byte가 같게 한다(`tool.ts:257-260`). 이미 보낸 요청은 영향받지 않는다.
- Code Mode catalog는 `Instructions` source(`key: core/codemode`)로 값을 hash로 저장하고 바뀌면 **diff 문구를 새 instruction으로** 만든다. 문구(`instructions.ts`):
  - 전체 교체: `The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.` + 새 catalog. 완전/부분 상태가 뒤바뀌거나 namespace 설명이 바뀌면 이것.
  - 완전 상태에서 부분 변경: `The Code Mode tool catalog has changed.` + `New tools are available in addition to those previously listed:` + 줄들, `Changed tool listings supersede the previously listed ones:`, `The following tools are no longer available and must not be called: <path 목록>.`
  - 부분 상태에서 namespace 변경: `New tool namespaces are available: ...`, `The following namespace inventories changed; search them again before relying on previous results: ...`, `The following tool namespaces are no longer available and must not be used: ...`
  - 전부 없어짐: `Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.`
  - diff 문구가 전체 교체 문구보다 길면 전체 교체를 쓴다.
- 그 instruction을 prompt 어느 role로 넣는지는 확인 못함(기존 조사는 OpenCode 지침 diff를 transcript에 넣는다고 기록).

**빠진 tool을 부를 때** (`tool.ts:271-283`)
- 요청 definitions에는 없지만 registry에 남은 직접 tool: `Tool is not available for this request: <name>`.
- registry에도 없음: `No tool named "<name>" is currently available. Please use a tool from the available tool list.`
- MCP server가 사라진 경우 `MCP server "<name>" is not available`(`tool/mcp.ts:73`).

**효과 표시:** permission action 이름 하나만 있다. read/write 표시는 정의에 없다(기존 조사).

### 2.5 Hermes

**이름 (`tools/mcp_tool_schema.py:147-190`)**
- 코드: `mcp__<server>__<tool>`, 각 부분은 `[A-Za-z0-9_]` 밖을 `_`로(하이픈도 `_`). 주석: "the convention shared by Claude Code, Codex and OpenCode".
- 길이 상한 64(OpenAI 호환 provider의 `^[a-zA-Z0-9_-]{1,64}$` 때문에 그 길이를 넘으면 요청 전체가 400이 된 사례 #81331). 넘으면 sha256 앞 8자 suffix(`_<hash>`)로 줄이고 이름당 한 번 경고. dispatch는 원본 tool 이름을 handler가 닫아 쥐고 있어 영향 없다.
- 이름 충돌: server 이름이 서로 달라도 정규화 뒤 겹치면, 갱신 때 "다른 server가 소유한 같은 이름은 지우지 않는다"(`_deregister_owned`가 `registry.get_toolset_for_tool(name)==mcp-<server>`를 확인). 등록 자체의 충돌 해소는 확인 못함.
- 주의: 사용자 문서(`mcp.md`)는 등록 이름이 `mcp_<server>_<tool>`이라고 적지만 코드는 `mcp__` 이중 밑줄이다. 코드를 따랐다.
- 사람 필터: `mcp_servers.<name>.tools.include` / `exclude`(glob 가능). 제외된 것은 등록하지 않는다.

**tool이 많을 때 (문서 `tool-search.md`, `tools/tool_search.py`)**
- MCP·plugin tool과 curated 일부 core tool(`defer` 설정)을 모델 배열에서 빼고 bridge tool 세 개로 바꾼다: `tool_search(queries, limit?)`, `tool_describe(names)`, `tool_call(calls)`(최대 10개 batch). **deferred tool이 하나라도 있으면 bridge가 켜진다**(`enabled: auto`는 현재 `on`의 별칭). 크기에 따라 달라지는 것은 "얼마나 목록을 보여 주느냐"뿐이다.
- 3단계 노출: tier 0 deferred 없음(전부 eager); tier 1 목록이 예산 안이면 bridge + **모든 deferred tool의 이름과 짧은 설명**(60자 이내, server별로 묶음)을 `tool_search` description에 넣는다. 예산이 모자라면 server 단위로 이름만, 더 모자라면 한 줄 server 요약; tier 2 이름조차 예산을 넘으면(문서 예: 약 3,300 tool, 이름만 ~32K token) 빈 bridge + server별 "이름과 tool 수" 한 줄.
- 예산 = `min(threshold_pct% of context, listing_max_tokens)`, 기본 `threshold_pct: 5`, `listing_max_tokens: 4000`(범위 200~60000). 검색 기본 5개, 최대 25개(1~50).
- 왜 목록을 두나(문서): "live benchmarking showed models substituting visible core tools (running `gh` in the terminal instead of searching for the deferred GitHub tool) or declaring a capability nonexistent instead of calling `tool_search`". 목록이 없으면 deferred tool은 "보이지 않는" 것이 된다.
- 검색: BM25 + 영어 stemming, 질의의 가장 희귀한 단어가 든 tool만 결과가 되고, 질의 단어의 절반 이상이 맞아야 한다(4단어 이상부터). 결과가 비면 `available_sources`(연결된 server 요약)를 붙여 돌려준다.
- 범위: bridge는 session에 허용된 toolset의 deferred 부분만 본다. subagent·gateway session이 허용 밖의 tool을 bridge로 찾거나 부를 수 없다.
- `tool_call`은 bridge를 벗기고 진짜 tool 이름으로 hook·approval·schema 검증을 돈다. deferred schema는 provider가 검증하지 못하므로 Hermes가 로컬에서 coerce·검증한다(문서 "No provider-native validation for deferred schemas").

**도중 변경 (`tools/mcp_tool_health.py:132`, `tools/mcp_tool_agent.py`, `agent/turn_context.py:549`)**
- list_changed를 받으면 `_refresh_tools`가 목록을 다시 받아 registry를 갱신한다. 사라진 이름만 먼저 지우고(`nuke-and-repave` 하지 않음, "live turns may hold tool-call IDs pointing at existing handlers") 나머지를 다시 등록한다. 바뀐 내용은 로그 경고 `tools changed dynamically — added: ...; removed: ...`로만 남고 model에게 알리는 message는 없다.
- agent의 `tools[]`는 build 때 snapshot이고 **session에 pin(freeze)** 된다: `agent.tools` 전체 정의를 session row에 저장하고(`persist_agent_tool_names`), agent가 다시 만들어져도(cache 퇴출, `--resume`, 화면 전환) 같은 byte로 복원한다(`restore_agent_tool_prefix`, `conversation_loop.py:697`).
- turn 사이에 `_refresh_mcp_tools_between_turns`가 늦게 연결된 server를 새 snapshot에 넣는다. `preserve_prefix=True`: **기존 tool은 위치(순서)를 지키고(schema는 갱신) 새 tool은 꼬리에 덧붙이고 deregister된 tool은 뺀다.** `check_fn`이 잠깐 흔들린 tool은 계속 데려간다("check_fn gates exposure, never invocation"). 명시적 `/reload-mcp`가 freeze를 벗어나는 출구다. compaction 경계에서는 `content_aware=True`로 다시 만든다.
- 하지만 tool search가 켜진 session에서는 bridge description에 deferred tool 수와 목록이 들어가므로 문서가 직접 인정한다: "Adding or removing a tool mid-session changes the bridge tools' descriptions (which include the count of deferred tools) and the catalog, so the prompt cache is invalidated." tier도 assembly마다 다시 정해진다("adding or removing MCP servers mid-session moves the session between tiers on the next assembly").
- 승인용 `readOnlyHint`는 discovery 때 저장해 두고 call 때 판정한다("Classified at CALL time from DISCOVERY data: no schema mutation, prompt cache intact", `mcp_tool.py:512-520`).

**빠진 tool을 부를 때**
- 이름이 `valid_names`에 없으면 먼저 `_repair_tool_call`로 이름 교정(오타·대소문자)을 시도하고, 안 되면 tool result로 `Tool '<name>' does not exist. Available tools: <정렬된 전체 이름 목록>`(`conversation_loop.py:1052-1063`). 이름이 비어 있으면 목록을 주지 않고 짧게(`Tool call rejected: the tool name was empty. ...`; 목록을 주면 같은 헛소리를 되풀이하는 사례 #47967). 연속 3 turn 동안 유효한 호출이 없이 잘못된 이름만 내면 turn을 부분 종료한다(`turn_tool_validation.py:131-141`). 한 turn에 유효한 호출이 섞여 있으면 잘못된 것만 오류로 돌리고 나머지는 실행한다.
- registry 직접 dispatch는 `Unknown tool: <name>`(`registry.py:899`).

**효과 표시:** `ToolEntry`에 효과 필드가 없다. MCP `readOnlyHint`가 정확히 `True`인지만 discovery 때 기록해 두고, `trust: untrusted` server의 쓰기 가능 호출(힌트가 `True`가 아니거나 형식이 틀린 것은 쓰기로 본다. fail closed)을 call 직전에 승인으로 보낸다.

### 2.6 Gemini CLI

**이름 (`core/src/tools/mcp-tool.ts:32-55,722-747`, 문서 `docs/tools/mcp-server.md` 3절)**
- 항상 `mcp_<server>_<tool>`(구분자 `_` 하나). 허용 문자 `^[a-zA-Z_][a-zA-Z0-9_\-.:]{0,63}$`; 밖의 문자는 `_`, 숫자로 시작하면 앞에 `_`.
- 길이 상한 64 중 안전하게 63(Gemini API 한도, 코드 주석). 넘으면 **앞 30자 + `...` + 뒤 30자**로 줄인다. hash가 없어 서로 다른 tool이 같은 이름으로 줄 수 있다.
- 충돌: `registerTool`이 같은 이름이면 `"... is already registered. Overwriting."` 경고 후 덮어쓴다(`tool-registry.ts:289`). 문서도 "last registered tool overwrites".
- 문서 경고: server 이름에 `_`를 쓰지 마라. policy parser가 `mcp_` 뒤 첫 `_`에서 server와 tool을 나누므로 `_`가 든 server 이름은 wildcard rule과 보안 정책이 조용히 어긋난다. 이름 문자열을 parse해서 소유를 되짚는 설계의 약점을 harness 스스로 적어 둔 것이다.
- 사람 필터: server별 `includeTools` / `excludeTools`(exclude 우선).

**tool이 많을 때:** tool search나 deferred 개념이 없다. 모든 tool 선언을 요청에 넣는다(`tool-registry.ts` `getFunctionDeclarations`). tool 수 한도도 찾지 못했다(확인 못함).

**도중 변경**
- 알림 → `McpClient.refreshTools`가 새 목록을 받고 그 server의 옛 tool을 전부 지우고 새로 등록한다(`mcp-client.ts:696-790`). 알림 직후 목록이 안 바뀌었으면 500ms 뒤 한 번 더 시도한다("Some servers notify before they're fully ready"). 그 뒤 `onContextUpdated` → `refreshMcpContext()` → `geminiClient.setTools()`가 `chat.setTools(...)`로 **즉시** 선언을 통째로 바꾼다(`config.ts:2581-2587`, `client.ts:322-336`). 평소 turn 시작의 `setTools(modelId)`는 model이 같으면 건너뛴다(`client.ts:327`).
- model에게 알리는 message는 없다. 이 방식에서는 tool 정의가 바뀐 요청부터 cache 이득을 잃는다고 보아야 한다(Gemini의 cache 방식은 조사하지 않았다. 확인 못함).

**빠진 tool을 부를 때:** scheduler가 `Tool "<name>" not found.` + Levenshtein 거리가 가까운 상위 3개 이름 제안(`getToolSuggestion`)을 `TOOL_NOT_REGISTERED` 오류 응답으로 돌린다(`scheduler.ts:405-419`).

**효과 표시:** `Kind` enum과 MCP `readOnlyHint`는 policy와 confirmation에 쓰고(기존 조사), model에 보내는 description에는 넣지 않는다. 확인 정책은 tool 이름(`mcp_server_tool`)에 건다.

## 3. 비교

### 3.1 이름과 namespace

| | Claude Code | Codex | pi | OpenCode | Hermes | Gemini CLI |
|---|---|---|---|---|---|---|
| 형식 | `mcp__server__tool` | namespace `mcp__server` + `__` + tool | `mcp__server__tool` | `server_tool` (접두 없음) | `mcp__server__tool` | `mcp_server_tool` |
| 구분자 | `__` | `__` | `__` | `_` | `__` | `_` |
| 허용 문자 | 문서에 정리 없음. plugin 이름은 `A-Za-z0-9_-` 밖을 `_` | `[A-Za-z0-9_]` | `[A-Za-z0-9_]` | `[A-Za-z0-9_-]` | `[A-Za-z0-9_]` | `[A-Za-z0-9_\-.:]` |
| 길이 | 128 (provider 한도). 넘으면 그 tool을 뺌 | 128 byte | 64 | 제한 코드 못 찾음 | 64 | 63 |
| 넘을 때 | 빼고 로그 | hash 12자 + 줄임 | hash 8자 + 줄임 | 확인 못함 | hash 8자 + 줄임 | 앞 30 + `...` + 뒤 30 |
| 충돌 | 문서 없음 | 충돌한 것 전부 hash suffix, 정렬해 결정적 | 충돌한 것 전부 hash suffix | 나중이 앞을 덮음(코드 독해) | 소유 server가 아니면 지우지 않음 | 나중이 앞을 덮음(경고) |
| 이름을 parse하나 | rule 문자열로만 | 안 함(`ToolInfo`에 원본 보존) | 렌더링에만 | 안 함 | 안 함 | 함. 그래서 server 이름의 `_`가 정책을 깨뜨림 |

### 3.2 tool이 많을 때

| | 기본 | 기준 | model에 보이는 꼴 | 사람이 정하는 곳 |
|---|---|---|---|---|
| Claude Code | MCP 전부 deferred | `auto[:N]`이면 정의 합이 context의 10%(기본) 이상일 때 전부 defer. 기본 모드는 개수·token 무관 | 이름 목록(system-reminder) + `ToolSearch`(`select:` / 키워드). server instructions가 검색 단서 | server `alwaysLoad`, tool `_meta["anthropic/alwaysLoad"]`, `ENABLE_TOOL_SEARCH`, `ToolSearch` deny |
| Codex | 모델이 `supports_search_tool`이면 MCP 전부 deferred | 모델 속성. 개수·token 기준 못 찾음 | `tool_search` 하나 + 그 description에 "source 이름: 설명" 목록 | `enabled_tools`/`disabled_tools`, `omit_tools_from` |
| pi | `codemode` (선언도 나열도 안 함) | 없음. 사람이 server·tool마다 고름 | system prompt `mcp_servers` section에 server마다 한 줄. 나머지는 script 안 `searchTools()` 또는 `tool_search` | `exposure`, `toolExposure`, `description` |
| OpenCode | Code Mode (`execute` 하나) | catalog inline 예산 2,000 token | `- ns (N tools, M shown)` + 예산 안에서 고른 listing, 나머지는 `search()` | server `codemode: false`, permission deny |
| Hermes | deferred가 하나라도 있으면 bridge 켜짐 | 목록 예산 `min(5% of context, 4000 token)`으로 목록의 상세도만 조절(full → 이름만 → server 요약) | bridge 3개 + (예산 안이면) 이름·설명 목록 | `tool_search.enabled/defer/listing*`, `tools.include/exclude` |
| Gemini CLI | 전부 선언 | 없음 | 일반 function declaration | `includeTools`/`excludeTools` |
| (Anthropic API 권고) | | tool 10개 이상 또는 정의 10k token 초과 | 자주 쓰는 3~5개는 non-deferred | |

### 3.3 session 도중 변경

| | 언제 반영 | model 알림 | cache 보호 | 지키지 못하는 경우 |
|---|---|---|---|---|
| Claude Code | list_changed 즉시 목록 갱신. 새로 연결된 server는 같은 turn의 다음 요청에서 이름 나열 | 더해짐: "now available via ToolSearch" system-reminder(관찰). 빠짐: 문서 없음(확인 못함) | deferred tool은 prefix 밖(`tool_reference`가 inline으로 붙음) | upfront/`alwaysLoad` tool이 바뀔 때 |
| Codex | step마다 binding에서 router 새로 구성. list_changed는 로그만(dirty 경로로 갱신) | 기본 꺼짐인 incremental tools에서만 developer message(추가, 교체, 제거 문구가 고정) | incremental tools: tool 정의를 history에 놓고 diff만 덧붙임. 기본: 계측만(`tools_changed`) | 기본 설정 전부. `tool_search` description에 source 목록이 있어 server 추가 시 `tools[]`가 바뀜 |
| pi | list_changed 즉시 등록. 빠진 것은 hidden | tool은 구조(block)로, 목록 section은 message로 덧붙임. tool 변경 전용 문구 없음 | `mcp_servers` section은 덧붙임. tool 변경은 Anthropic beta block / 전체 checkpoint | beta를 못 받는 provider |
| OpenCode | 100ms debounce 뒤 reload, 요청마다 snapshot | catalog diff 문구(위 문구들) | direct tool은 이름순 정렬로 byte 고정. catalog는 instruction으로 덧붙임 | 직접 노출한 MCP tool이 바뀔 때 |
| Hermes | turn 사이 refresh. 새 tool은 꼬리, 기존 순서 보존 | 없음(로그 경고만) | session에 tools[] pin, `preserve_prefix`, 명시적 `/reload-mcp`만 freeze를 뜀 | tool search 켜진 session(bridge description에 개수·목록). 문서가 인정 |
| Gemini CLI | list_changed 직후 `setTools()`로 통째로 교체 | 없음 | 없음 | 항상 |

### 3.4 빠진 tool 호출, 기록, 효과 표시

| | 지난 기록 | 없는 tool 호출에 돌려주는 말 | 효과(read/write/destructive)를 model에 보이나 |
|---|---|---|---|
| Claude Code | 그대로 둠. 이름 200자 초과만 자름 | `Error: No such tool available: <name>` (+이유 한 문장). resume 직후 server 연결 중이면 10초 기다림 | 안 보임. `_meta`와 harness 규칙 |
| Codex | 그대로 둠 | `unsupported call: <name>` | 안 보임. MCP annotation은 승인·병렬 판정에 사용 |
| pi | 그대로 둠 (transcript에 `toolsRemoved`가 남음) | `Tool <name> not found`, durable은 `tool_unavailable`. MCP는 `... is no longer available.` | 안 보임 |
| OpenCode | 그대로 둠 | `No tool named "<name>" is currently available. Please use a tool from the available tool list.` / `Tool is not available for this request: <name>` | 안 보임. permission action 이름 |
| Hermes | 그대로 둠 | `Tool '<name>' does not exist. Available tools: <전체 목록>` (3회 연속이면 turn 종료). 이름 교정을 먼저 시도 | 안 보임. `readOnlyHint`는 call 때 승인 판정 |
| Gemini CLI | 그대로 둠 | `Tool "<name>" not found.` + 가까운 이름 3개 제안 | 안 보임 |

여섯 harness 모두 지난 대화 기록의 tool call을 고치거나 지우지 않는다. 없어진 tool을 다시 부르면 error result 한 줄이 돌아가고 turn은 이어진다(Hermes만 연속 3회 한도).

## 4. lophn에 비춰 본 점

lophn이 정할 것을 먼저 적고, 추천(제안)과 근거 harness를 적는다. 결정은 lead와 사람이 한다.

| lophn이 정할 것 | 추천 | 근거 harness |
|---|---|---|
| 모델에 보이는 이름 꼴과 구분자 | `app__<app>__<api>` 꼴(외부 MCP는 `mcp__<server>__<tool>`). 구분자는 `__`. 허용 문자는 `[A-Za-z0-9_]`만 | Claude Code, Codex, pi, Hermes가 `mcp__a__b`로 수렴한다. Anthropic이 접두 일관성이 검색에 유리하다고 권한다. OpenCode·Gemini의 단일 `_`는 server/tool 경계가 모호하다 |
| 이름 길이 상한 | 전체 64자 이하로 설계하고 넘으면 결정적 hash suffix(8~12자)를 붙인다. 앞뒤를 자르는 방식은 쓰지 않는다 | Anthropic API 128, OpenAI 호환·Gemini 63~64. Hermes는 64 초과로 요청 전체가 400이 난 사례(#81331)가 있다. Gemini의 앞30+`...`+뒤30은 충돌할 수 있다 |
| 이름 충돌 | app·api 이름은 blueprint 검증에서 문법과 중복을 막아 충돌이 생기지 않게 하고, 외부 MCP처럼 바깥에서 오는 이름만 충돌한 것 전부에 hash를 붙인다. 덮어쓰기는 하지 않는다 | Codex·pi(충돌 전부 suffix, 순서 무관). OpenCode·Gemini는 조용히 덮어써서 tool 하나가 사라진다 |
| 이름에서 app/api를 되짚나 | 이름을 parse하지 않는다. 모델 이름에서 (app, api, release)로 가는 표를 registry에 두고 Gate는 그 표로 판정한다 | Codex(`ToolInfo`에 원본 보존). Gemini 문서가 server 이름의 `_`가 정책을 조용히 깨뜨린다고 경고한다 |
| 사람이 뺀 app-api | 해당 agent의 모델 요청에 아예 선언하지 않는다. "묻기"로 바꾼 것은 선언하고 Gate가 호출 때 묻는다(S2) | Codex `disabled_tools`, Hermes `exclude`, OpenCode `whollyDisabled`, Claude Code deny rule(context에서 빠짐), pi `hidden` |
| tool이 많을 때 deferred로 돌리는 기준 | 개수가 아니라 token으로: agent의 app-api schema 합이 context의 일정 비율(Claude Code 기본 10%를 시작점)을 넘으면 그 agent의 app-api 전부를 deferred로 돌리고, 아래면 전부 upfront. 한 session 안에서 문턱을 넘나들며 바꾸지 않는다(session 시작 때 정하고 고정). core tool(read/write류, 사람에게 묻는 tool, call 등)은 deferred 대상에서 뺀다 | Claude Code `auto:N`(10%), Hermes `threshold_pct`(5%)와 "assembly마다 tier가 움직여 cache가 깨진다"는 인정, Anthropic 권고(10k token / 자주 쓰는 3~5개는 non-deferred) |
| deferred일 때 이름 목록을 보일지 | 보인다. app마다 한 단락(앱 이름, app-api 이름 목록, 한 줄 설명)을 message로 넣고, 예산이 모자라면 app당 "N개, M개 표시"로 줄인다. app-api의 `alwaysLoad` 같은 표시는 blueprint 선언 칸으로 둘 수 있다 | Hermes(목록 없으면 model이 `terminal`로 `gh`를 대신 쓰거나 기능이 없다고 단정하는 것을 실측), OpenCode(2,000 token 예산 + `N tools, M shown`), pi(`mcp_servers` section 한 줄), Claude Code(`_meta["anthropic/alwaysLoad"]`) |
| 검색 부품 | provider가 `defer_loading` + tool search tool을 주는 model이면 그것을 쓰고, 아니면 lophn 쪽에 `tool_search`(이름·app·설명 BM25)와 schema를 돌려주는 tool을 둔다. 어느 쪽이든 model에는 같은 이름·같은 결과 꼴로 보이게 한다 | Anthropic tool search(`tool_reference`, prefix 보존), Codex `tool_search`, pi `tool_search`, Hermes `tool_search/describe/call`. 불러온 schema는 compaction 뒤 사라지므로(Claude Code SDK 문서) 다시 찾을 수 있어야 한다 |
| session 도중 app-api가 더해질 때 | 요청의 `tools` 배열(upfront 부분)을 session 시작 때 정한 대로 고정한다. 새 app-api는 turn 경계에서 message(고정 문구)로 알리고, deferred 목록이면 이름 목록에 덧붙인다. provider가 mid-conversation tool 변경을 받으면 `tool_addition` 같은 구조를 쓴다 | Claude Code(더해짐을 reminder로), pi(`mcp_servers` section을 대화에 덧붙이고 tool 선언은 안 바꿈, Anthropic beta block), Codex incremental tools, Hermes `preserve_prefix`(기존 순서 보존, 새 것은 꼬리), Anthropic 문서(`tools`를 건드리면 전체 cache 무효) |
| 도중에 app-api가 빠질 때 | `tools` 배열에서 지우지 않는다. 빠진 이름을 알리는 고정 문구 message를 turn 경계에 한 번 넣고(예: "다음 tool은 더 이상 쓸 수 없다. 부르지 마라: …"), Gate가 호출 때 거절하는 것을 최종 방어로 삼는다 | Codex(`The following tools are no longer available. Do not call them:`), OpenCode(`... no longer available and must not be called`), pi(withdrawn을 hidden으로 두고 제거 block). Claude Code·Hermes·Gemini는 model에게 알리지 않아 model이 한 번 틀리고 배운다 |
| 도중에 schema가 바뀔 때 | 같은 이름의 새 정의를 message로 덧붙이고 "새 정의가 이전 것을 대체한다"고 문구로 못 박는다. 호출 검증은 항상 현재 활성 release의 schema로 하고, 옛 schema로 낸 호출이 검증에서 떨어지면 오류에 현재 schema를 실어 돌려준다. 이름을 release별로 바꾸지는 않는다 | Anthropic(같은 이름 재정의가 그 지점부터 대체), Codex(`schema_changed`, `If a tool is redefined here, its latest definition replaces the earlier one.`), OpenCode(`Changed tool listings supersede ...`), pi(`planTools`: 정의가 달라지면 remove 후 add) |
| 알림 message의 role과 내용 | role은 provider가 지원하면 system/developer, 아니면 user의 `<system-reminder>`류. 문구는 lophn이 고정하고, 앱이 쓴 description 같은 글은 tool 정의 칸에만 싣는다. 알림 문장 속에 앱이 쓴 글을 끼워 넣지 않는다 | Anthropic 문서 경고(바깥 글을 system message에 넣으면 operator 권한을 얻는다). Codex·OpenCode의 고정 문구. app-api 설명은 앱 작성자(또는 AI)가 쓴 글이다 |
| 열린 session을 새 release에 맞추는 시점 | 이미 시작한 turn(tool_use와 tool_result 사이)에는 적용하지 않고 다음 turn 경계에 적용한다. activation이 session 도중이어도 같은 규칙 | Anthropic 제약(tool 변경 system message는 tool_use와 tool_result 사이에 못 둠), Hermes(`_refresh_mcp_tools_between_turns`), pi(첫 prompt 시작 때 갱신) |
| 지난 기록의 tool call | 고치거나 지우지 않는다. 지난 `tool_use`가 가리키는 app-api가 지금 없어도 기록은 그대로 둔다. compaction 요약이 이름을 인용하는 것도 허용한다 | 여섯 harness 모두 기록을 그대로 둔다 |
| 없는 app-api를 부를 때의 오류 | "없음", "사람이 뺌", "release에서 빠짐", "묻는 중/거절"을 서로 다른 오류 문구로 구분한다. 전체 목록을 덤프하지 말고 가까운 이름 몇 개를 제안하고, 연속으로 틀리면 turn을 끊는 한도를 둔다. 오류는 권한 request(S2 6장)로 새지 않는다 | Gemini(가까운 이름 3개), Claude Code(이유 한 문장), Hermes(목록 덤프는 tool 수십 개면 과하고 연속 3회 한도), OpenCode/pi(이유별 문구) |
| 효과(read/write/external) 표시 | model에게 보이는 tool 정의(description, schema)에 효과를 넣지 않는다. blueprint 선언에서 읽어 registry에 두고 Gate가 쓴다. 승인이 필요한 호출은 거절·대기 결과로 model에게 알린다 | 여섯 모두 정의에 효과를 싣지 않는다. Hermes는 "schema mutation 없이 call 때 판정 → cache intact"를 명시, Claude Code·Codex도 효과를 `_meta`/annotation→승인 판정으로만 쓴다. 효과가 release로 바뀌어도 `tools`가 안 흔들린다 |
| 호출마다 꼭 묻는 표시 | 앱 선언에 "항상 묻기"를 둘 수 있게 하고 Gate에서 사람의 "다시 묻지 않기"를 막는다(S2 요구가 생기면) | Claude Code `_meta["anthropic/requiresUserInteraction"]` |

### 정할 때 걸리는 문제 (lead와 사람에게)

- **provider를 몇 개 지원하나:** mid-conversation tool 변경은 Anthropic beta 기능이다. 지원하지 않는 provider에서는 (a) 도중 변경을 message 고지로만 처리하고 `tools`는 session 동안 고정, 또는 (b) 변경 때 `tools` 전체를 바꾸고 cache를 잃는 것 중 고른다. pi는 Anthropic이면 (beta), 아니면 (b)를 쓴다. Hermes는 (a)에 가깝다(꼬리에 덧붙임).
- **"upfront인가 deferred인가"를 session마다 고정할지:** 위 추천은 고정이다. 다만 한 session 동안 app을 새로 할당받는 경우(예: 사람이 도중에 앱을 붙임) 합계가 문턱을 넘을 수 있다. 이때는 새로 붙는 app만 deferred로 돌리는 방법도 있다. 어느 쪽이든 이미 upfront인 것을 deferred로 되돌리지는 않는다는 규칙은 같이 필요하다.
- **tool search tool을 누가 부르나:** Hermes는 `tool_call` bridge로 호출까지 감싼다. 이 경우 approval·hook이 진짜 이름 기준으로 도는지 검증이 필요하다(Hermes는 "unwraps the bridge"로 처리). Anthropic native 방식은 호출이 진짜 이름으로 나오므로 이 문제가 없다.
- **R4 밖으로 넘기는 것:** 앱 할당 변화가 agent 정의에 어떻게 기록되는지(S4), activation 순서(S7)는 이 조사에서 다루지 않았다.

## 5. 기존 조사와 달라진 점

- **pi에 MCP가 있다.** `agent-def-opencode-pi-gemini.md`는 pi에 MCP 설명이 부족하다고 적었다. `b06c1f2cf1dea`에는 `packages/mcp`, `docs/mcp.md`, `extensions/mcp/`가 있고, exposure 4종·`mcp__server__tool`·hash suffix·`toolsAdded/toolsRemoved`→Anthropic `tool_addition/tool_removal` 변환이 구현돼 있다.
- **OpenCode는 MCP tool을 기본으로 Code Mode 뒤에 둔다.** 기존 조사는 `registry.snapshot`과 pi의 `codemode`/`tool_search`를 적었다. 이번에 OpenCode의 MCP 쪽을 읽어, `codemode`가 server 설정 기본값(켜짐)이고 catalog에 inline 예산 2,000 token과 diff 문구가 있다는 것을 더한다.
- **Hermes의 tool 이름:** 기존 조사는 "MCP tool의 model-facing 이름 규칙은 확인 못함"이었다. 코드는 `mcp__<server>__<tool>`(64자, hash suffix)다. 설치본 사용자 문서는 `mcp_<server>_<tool>`로 적혀 있어 문서와 코드가 어긋난다. 또 tools[] pin(session에 저장)과 `preserve_prefix`가 있다.
- **Anthropic 이름 한도:** 문서 기준 128자(`^[a-zA-Z0-9_-]{1,128}$`)다. Hermes 주석과 pi의 64는 OpenAI 호환 provider 기준이다.
- **Codex:** 기존 조사가 적은 `incremental_tools`(tool 정의를 `<tools>` section으로 history에 넣는 모드)는 feature가 UnderDevelopment이고 기본 꺼짐이며 `use_responses_lite` 모델에만 해당한다. 기본 경로는 요청 `tools`에 정의를 싣는다. tool 변경 notice의 고정 문구는 이번에 새로 확인했다.
- **Claude Code:** 기존 조사의 deferred tool 서술은 맞다. 이번에 더한 것은 `alwaysLoad`/`_meta` 규약, description 길이 한도(4,096 / 16,384), 128자 초과 시 tool 제외, `No such tool available` 오류 문구와 resume 직후 10초 대기다.
- 이 조사가 확인하지 못한 것: Claude Code가 list_changed로 빠진 tool을 model에게 어떻게 알리는가; Anthropic API가 `tools`에 없는 tool을 가리키는 지난 `tool_use`를 어떻게 다루는가; Codex가 일반 MCP server의 list_changed로 catalog를 다시 만드는 경로; OpenCode의 이름 충돌 처리와 instruction diff가 들어가는 role; Gemini의 cache 동작.
