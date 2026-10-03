---
type: research
concerns: [coding-agent/mcp-server]
---
# coding agent MCP server의 모양

## 질문

harness가 stdio MCP server를 어떻게 띄우고 tool 결과를 model에 넣는지, 그리고 server가 tool을 어떻게 묶어 내놓는지 알아야 한다. lophn은 세션마다 stdio server 하나를 띄우고, 고정 15개 tool에 op enum을 두며, blueprint에서 `lophn_app_<app-id>_<command-name sha256 앞 16자>` 이름의 동적 tool을 만든다.

조사일 2026-10-04. client: Codex `3a69ec3ef8fb`, Gemini CLI `fb972b2f87fe`, OpenCode `907b3bc518fa`, Claude Code는 본체 소스가 없어 [공식 문서](https://code.claude.com/docs/en/mcp)와 [tool search 문서](https://code.claude.com/docs/en/agent-sdk/tool-search). server: GitHub MCP server `71ef8266e481`, Sentry MCP `9f1a7b2147d9`, Paseo `0d05584d044f`. `[확인]`은 그 revision 코드, `[문서]`는 공식 문서, `[미확인]`은 이번 조사에서 못 본 것이다.

## 프로젝트별

### Codex (`3a69ec3ef8fb`)

- stdio spawn은 부모 env를 통째로 넘기지 않는다. `codex:codex-rs/rmcp-client/src/utils.rs` `create_env_for_mcp_server`(16–58)는 `DEFAULT_ENV_VARS`(163–175, Unix: HOME·LOGNAME·PATH·SHELL·USER·`__CF_USER_TEXT_ENCODING`·LANG·LC_ALL·TERM·TMPDIR·TZ)와 CA bundle 11개(`codex:codex-rs/network-proxy/src/certs.rs` `CUSTOM_CA_ENV_KEYS` 260–272)만 상속하고, 설정 env를 그 위에 덮는다. `is_non_inheritable_env_var`에 걸리는 이름은 마지막에 뺀다. cwd는 설정값으로 `command.current_dir`에 명시한다(`stdio_server_launcher.rs` 282–283). `[확인]`
- stderr는 pipe로 읽어 한 줄씩 `info!("MCP server stderr ({program_name}): {line}")`로 남긴다(383). 자손이 stderr를 붙잡고 있어도 reader를 멈출 수 있게 watch channel을 둔다(362). `[확인]`
- timeout은 두 개다. startup(initialize와 첫 tools/list를 포함한 client 기동) 기본 `DEFAULT_STARTUP_TIMEOUT` 30초(`codex:codex-rs/codex-mcp/src/rmcp_client.rs` 106), tool call 기본 `DEFAULT_TOOL_TIMEOUT` 300초(107, `connection_manager.rs` 363). 둘 다 server 설정의 `startup_timeout_sec`·`tool_timeout_sec`로 덮는다. pagination 전체 상한은 별도로 30초(`pagination.rs` 13). `[확인]`
- 한 server 실패는 세션을 막지 않는다. `required: true`인 server만 `validate_required_servers`(`connection_manager/required.rs` 17–63)에서 기다리고, 하나라도 실패하면 `"required MCP servers failed to initialize: {details}"`로 세션 시작이 실패한다(59–62). 기본 `required`는 false(`config/src/mcp_types.rs` 242, 580). optional server는 `DEFAULT_OPTIONAL_MCP_STARTUP_GRACE` 1초만 기다린다(`mcp/mod.rs` 197). `[확인]`
- protocol은 세션 생성 때 고른다. 기본 `McpProtocolMode::Legacy`는 `2025-06-18`로 initialize하고, `V20260728`은 `2026-07-28`을 선호하되 legacy로 내려간다(`rmcp-client/src/protocol_mode.rs` 8–36). stdio는 서버가 env `CODEX_MCP_PROTOCOL_VERSION=2026-07-28`을 내보내야 새 판을 쓰고, 다른 값은 `InvalidInput`으로 거절한다(38–52). `[확인]`
- tool 이름. model에 보이는 이름은 `mcp__<server>__<tool>`이고 기본으로 prefix를 붙인다(`prefix_mcp_tool_names`, `mcp/mod.rs` 66–67, 178–180, `qualified_mcp_tool_name_prefix` 83–87). sanitize 주석은 Responses API 제약 `^[a-zA-Z0-9_-]+$`를 말하지만 구현은 hyphen도 `_`로 바꾼다(575–593). 합친 이름 상한 `MAX_TOOL_NAME_LENGTH` 128이고, 넘거나 충돌하면 tool 이름을 잘라 sha1 앞 12자를 `_`와 함께 붙인다(`tools.rs` 225–227, 269–316). server 이름 자체는 `^[a-zA-Z0-9_:@/.-]+$`(`rmcp_client.rs` 903–911). `[확인]`
- 결과. `CallToolResult::as_function_call_output_payload`(`protocol/src/models.rs` 2302–2324)는 `structured_content`가 null이 아니면 그것을 JSON 문자열로 model에 넣고 text content를 버린다. 둘 다 보내면 model은 structured만 본다. `is_error == Some(true)`는 `success()`가 false다(2298–2299). image content는 model이 image modality를 선언하지 않으면 `"<image content omitted because you do not support image input>"` 텍스트로 바꾼다(`core/src/mcp_tool_call.rs` 943, 962). model에 넘기는 결과의 크기 상한은 찾지 못했다. 1 MiB 잘림은 이벤트 기록에만 적용된다. `truncate_mcp_tool_result_for_event`(`mcp_tool_call.rs` 982–988)가 `MCP_TOOL_CALL_EVENT_RESULT_MAX_BYTES`(`DEFAULT_OUTPUT_BYTES_CAP` 1 MiB, `utils/pty/src/lib.rs` 25, `mcp_tool_call.rs` 125)로 직렬화 결과를 자르고, 넘으면 content를 미리보기 text 하나로 바꾸며 `structured_content`를 지운다(`utils/output-truncation/src/lib.rs` 45–70). 이 값은 `notify_mcp_tool_call_completed`에만 들어가고 model에 반환하는 `result`는 그 전에 따로 나간다(570, 631). `[확인]` `[미확인]`
- `notifications/tools/list_changed` 핸들러는 `info!("MCP server tool list changed")` 로그만 남긴다(`rmcp-client/src/logging_client_handler.rs` 86–88). 재발견은 하지 않는다. server `instructions`는 tool namespace 설명으로 model에 전달한다(`rmcp_client.rs` 836–839). `readOnlyHint`는 승인 생략에 쓰지 않고, trusted-access context를 붙일 조건 중 하나일 뿐이다(`trusted_access.rs` 57–60). outputSchema 검증 코드는 찾지 못했다. `[확인]` `[미확인]`
- catalog 상한은 `MAX_MCP_CATALOG_ITEMS` 2,048, `MAX_MCP_CATALOG_PAGES` 100, cursor 64 KiB(`pagination.rs` 9–12). stdio 한 줄 상한 `MAX_MCP_STDIO_LINE_BYTES` 8 MiB이고 넘으면 transport를 닫는다(`bounded_stdio_transport.rs` 22, 63–65). `[확인]`

### Gemini CLI (`fb972b2f87fe`)

- stdio는 `@modelcontextprotocol/sdk`의 `StdioClientTransport`에 `command`·`args`·`env`·`cwd`·`stderr: "pipe"`를 넘긴다(`gemini-cli:packages/core/src/tools/mcp-client.ts` 2378–2383). cwd를 생략하면 SDK 기본(프로세스 cwd)이다. trusted folder가 아니면 stdio server 자체를 거절한다(2336–2340). `[확인]`
- env는 항상 redaction을 켠 뒤 넘긴다(2344–2350). 이름에 TOKEN·SECRET·PASSWORD·PASSWD·KEY·AUTH·CREDENTIAL·CREDS·PRIVATE·CERT가 있으면 빼고, private key·인증서·URL credential·GitHub·Google·AWS·JWT·Stripe·Slack 값 패턴도 뺀다(`services/environmentSanitization.ts` 94–124). 항상 남기는 것은 PATH·HOME·LANG·SHELL·TMPDIR·USER·LOGNAME·TERM·COLORTERM과 Windows 대응, GitHub Action 변수다(52–92). 설정 env가 실행 계열 이름(dangerous)이면 경고 후 무시한다(2365–2371). `[확인]`
- stderr는 debug mode일 때만 pipe를 읽어 진단으로 남긴다(2387–2405). debug가 아니면 pipe로 열리되 소비하지 않는다. `[확인]`
- timeout은 하나다. `MCP_DEFAULT_TIMEOUT_MSEC` 600,000(10분, mcp-client.ts 96)이 initialize·tools/list·tool call 전부에 쓰이고 server 설정 `timeout`으로 덮는다. 진행 알림이 이 시간을 늘리지는 않는다. `[확인]`
- 한 server 실패는 나머지를 막지 않는다. discovery 오류는 로그만 남기고 다음 server로 간다(`mcp-client-manager.ts` 509–525, "don't let a single failed server stop the others"). `[확인]`
- tool 이름. `generateValidName`(`mcp-tool.ts` 722–750)은 `mcp_<server>_<tool>`을 만들고 `[^a-zA-Z0-9_\-.:]`를 `_`로 바꾸며, Gemini API 제약 `^[a-zA-Z_][a-zA-Z0-9_\-.:]{0,63}$`에 맞춰 `MAX_FUNCTION_NAME_LENGTH` 64에서 1을 뺀 63자를 상한으로 한다. 넘으면 앞 30자 + `...` + 뒤 30자로 가운데를 잘라 해시 없이 줄인다. 서로 다른 tool이 같은 63자로 줄어드는 충돌 처리는 없다. `[확인]`
- 결과. `transformMcpContentToParts`(`mcp-tool.ts` 644–673)는 `content` 배열만 읽는다. text는 그대로, image·audio는 inlineData로, resource는 text 또는 inlineData로 옮긴다. `structuredContent`는 model 입력에 넣지 않는다. 대신 `McpComplianceTransport`(`mcp-compliance-transport.ts` 78–102)가 text content의 JSON parse에 성공하면 `structuredContent`가 비어 있을 때 채워 넣는다. `isError: true`(문자열 `"true"` 포함)는 tool 오류로 보고 내용 전체를 오류 메시지에 담아 model에 돌려준다(389–408, 456). `[확인]`
- `notifications/tools/list_changed`는 server가 `listChanged` capability를 선언하지 않아도 구독하고, 받으면 `tools/list`를 다시 돌려 registry를 교체한다(417–422, `refreshTools` 696). 재조회가 겹치면 하나만 돌리고 나머지를 pending으로 합친다. `[확인]`
- `readOnlyHint === true`는 tool의 `isReadOnly`가 된다(1368). 일반 모드의 승인 생략은 server 설정 `trust: true`와 trusted folder의 조합이다(`mcp-tool.ts` 352–354). `readOnlyHint`가 승인을 건너뛰는 곳은 Plan mode뿐이고, 거기서도 allow가 아니라 `ask_user`다(`policy/policies/plan.toml` 89–94). server `instructions`를 prompt에 넣는 코드는 찾지 못했다. `[확인]` `[미확인]`

### OpenCode (`907b3bc518fa`)

- stdio는 `StdioClientTransport`에 `command`·`args`·`cwd`·`stderr: "pipe"`·`env: { ...process.env, ...mcp.environment }`를 넘긴다(`opencode:packages/opencode/src/mcp/index.ts` 347–356). 부모 env를 통째로 상속하고 redaction이 없다. cwd 기본은 세션의 작업 디렉터리(`InstanceState.directory`)다. `[확인]`
- stderr를 읽는 코드는 이 모듈에 없다. pipe로만 연다(348). `[확인]`
- timeout 기본 `DEFAULT_TIMEOUT` 30,000ms가 connect·tools/list·tool call에 공통이다(index.ts 38, catalog.ts 11). 설정 `timeout`과 `experimental.mcp_timeout`으로 덮는다(662–672). tool call은 `resetTimeoutOnProgress: true`라 진행 알림이 올 때마다 30초가 다시 센다(catalog.ts 60–66). `[확인]`
- 한 server 실패는 `{ status: "failed", error }`로 남고 다른 server 연결을 막지 않는다(index.ts 367, 412). 연결이 닫히면 그 server만 failed로 돌리고 `ToolsChanged`를 낸다(447–451). `[확인]`
- tool 이름. `sanitize`는 `[^a-zA-Z0-9_-]`를 `_`로 바꾸고, 등록 이름은 `<server>_<tool>`이다(catalog.ts 117–119). `mcp_` prefix도, 길이 상한도, 잘림도 없다. 두 tool이 sanitize 뒤 같은 이름이 되면 `Object.fromEntries`에서 나중 것이 덮는다(684). `[확인]`
- 결과. `convertTool`(catalog.ts 42–82)은 `isError`면 text content만 모아 throw한다. content가 비어 있고 `structuredContent`만 있으면 그것을 `JSON.stringify`한 text content로 만들어 반환한다. 둘 다 있으면 structured를 버리고 content를 반환한다. image content를 따로 다루는 코드는 없다. `[확인]`
- `outputSchema` 검증에 실패하는 server(`can't resolve reference`, `outputSchema` 등)는 `outputSchema` 필드를 뺀 schema로 `tools/list`를 한 번 더 요청한다(149–169). 검증을 고치지 않고 우회한다. `[확인]`
- `notifications/tools/list_changed`를 구독해 목록을 교체하고 `ToolsChanged` 이벤트를 낸다(index.ts 470). server `instructions`는 system prompt의 `<mcp_instructions>` 안에 server별로 넣되, 그 server의 tool이 전부 권한 거부면 뺀다(`session/system.ts` 129–135). `[확인]`
- `readOnlyHint`를 읽는 코드는 이 모듈에 없다. MCP tool 호출은 매번 `permission.ask`를 거친다(`session/tools.ts` 408). `[확인]`
- 목록 pagination은 cursor 중복을 거절하고 1,000페이지에서 멈춘다(catalog.ts 12, 26–35). `[확인]`

### Claude Code (본체 소스 없음, 문서)

근거는 [Claude Code MCP 문서](https://code.claude.com/docs/en/mcp)와 [tool search 문서](https://code.claude.com/docs/en/agent-sdk/tool-search)다. 2026-10-04에 읽었다.

- stdio 항목은 `command`·`args`·`env`다. `type`을 생략하면 stdio로 읽는다. cwd 필드는 문서에 없고, 대신 spawn한 server env에 `CLAUDE_PROJECT_DIR`(프로젝트 root)을 넣는다. 부모 env 상속 여부는 문서가 말하지 않는다. stderr 처리도 문서에 없다. `[문서]` `[미확인]`
- timeout. `MCP_TIMEOUT`은 server 기동 timeout이고 예시만 있다(`MCP_TIMEOUT=10000`이 10초). 기본값은 문서에 없다. tool call의 `MCP_TOOL_TIMEOUT` 기본은 약 28시간이고, server별 `timeout`(ms)이 그것을 덮으며 1,000 미만은 무시된다. 진행 알림은 이 wall-clock을 늘리지 않는다. 응답도 진행도 없는 idle 창은 stdio에서 30분(`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`). 메인 대화의 tool call은 2분 뒤 background task로 빠진다(`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`). `[문서]`
- 한 server 실패는 세션을 막지 않는다. tool search가 켜져 있으면 실패 server와 오류를 model에 알리고, 꺼져 있으면 알리지 않는다. stdio는 자동 재연결하지 않는다. `[문서]`
- protocol. v2 runtime(MCP TypeScript SDK 2.0)은 `2026-07-28`을 더한다. `MCP_SDK_GENERATION=v1|v2`, `MCP_PROTOCOL_NEGOTIATION=auto|legacy`. stdio server에 새 판을 묻는 동작은 v2.1.285부터 단계 적용이다. `[문서]`
- tool 이름. 문서의 형식은 `mcp__<server>__<tool>`, plugin은 `mcp__plugin_<plugin>_<server>__<tool>`이고 `A-Z a-z 0-9 _ -` 밖은 `_`로 바꾼다. server 이름은 문자·숫자·hyphen·underscore만 받는다. 길이 상한은 이 문서에 없다. `[문서]` `[미확인]`
- 결과 크기. 10,000 token을 넘으면 경고하고, `MAX_MCP_OUTPUT_TOKENS` 기본 25,000 token을 넘으면 자르지 않고 `~/.claude/projects/`의 `tool-results` 파일로 옮긴 뒤 경로만 대화에 남긴다. tool 정의의 `_meta["anthropic/maxResultSizeChars"]`는 text content에 따로 적용되며 하드 상한 500,000자다. image(PNG·JPEG·GIF·WebP)는 inline으로 보여 주고 원본은 같은 디렉터리에 저장한다. `[문서]`
- `structuredContent`와 text를 함께 보낼 때의 동작은 문서에 없다. 이 저장소의 issue #55677(Claude Code v2.1.126, "Closed as not planned")은 둘 다 있으면 model이 `structuredContent`만 봤다고 보고한다. maintainer 확인은 없다. `[미확인]`
- `notifications/tools/list_changed`를 받으면 그 server의 목록을 다시 가져온다. `-p`와 Agent SDK는 tool 목록만 갱신한다. 갱신 실패 시 이전 목록을 유지한다(v2.1.214부터). `[문서]`
- tool search가 기본이다. `ENABLE_TOOL_SEARCH` 미설정이면 tool 정의를 전부 미루고 필요할 때 찾는다. `auto`는 미룰 수 있는 정의의 token이 context window의 10%에 닿으면 켜지고, `auto:N`은 그 비율을 바꾼다. `false`는 매번 전부 넣는다. catalog 상한 10,000개, 검색 한 번에 기본 5개. `[문서]`
- `readOnlyHint`와 server `instructions`의 사용은 이 문서에 없다. `[미확인]`

### GitHub MCP server (`71ef8266e481`)

- toolset은 등록 시점 필터다. `default`가 기본이고 context·repos·issues·pull_requests·users·copilot을 켠다(`pkg/github/tools.go` 29–68, 143–147, 각 `Default: true`). `all`은 전부(24–28), 그 밖은 flag `--toolsets`와 env `GITHUB_TOOLSETS`(viper prefix `github`, `cmd/github-mcp-server/main.go` 243, 314–316)로 명시한다. `[확인]`
- `--read-only`(env `GITHUB_READ_ONLY`)는 `ReadOnlyHint`가 true가 아닌 tool을 등록에서 빼는 필터다(`pkg/inventory/filters.go` 38, `server_tool.go` 121–123). 실행 중 검사가 아니다. `[확인]`
- 한 tool에 여러 동작을 묶는다. `pull_request_read`는 필수 `method` enum 9개(get·get_diff·get_status·get_files·get_commits·get_review_comments·get_reviews·get_comments·get_check_runs)를 갖고 handler에서 switch한다(`pkg/github/pullrequests.go` 30–50, 83–157). 모르는 method는 `NewToolResultError`로 `IsError: true`를 반환한다. `[확인]`
- pagination은 tool 인자다. `page` 최소 1, `perPage` 최소 1·최대 100·기본 30(`pkg/github/params.go` 347–365, 421). cursor 기반은 `after`를 받고 `page`를 주면 오류로 거절한다(issues 쪽 안내 문자열). `[확인]`
- 오류는 JSON-RPC error가 아니라 tool result의 `IsError: true`와 text 하나다(`pkg/utils/result.go` 15–34). `[확인]`
- `list_changed`를 일부러 끄고 광고한다. tool 집합이 정적이라 capability를 빈 값으로 선언해 SDK가 `listChanged: true`를 추론하지 못하게 한다(`pkg/github/server.go` 92–103). server `Instructions`는 켜진 toolset의 안내를 합쳐 initialize에 넣는다(89). `[확인]`
- 런타임에 toolset을 켜고 끄는 dynamic toolset은 이 revision에서 찾지 못했다. 필터는 시작 때 한 번 계산한다. `[미확인]`

### Sentry MCP (`9f1a7b2147d9`)

- 대부분 tool을 `tools/list`에 올리지 않는다. `TOP_LEVEL_TOOL_NAMES` 14개만 직접 노출하고(`packages/mcp-core/src/tools/surfaces.ts` 17–31: find_organizations·find_projects·update_issue·search_errors·search_logs·search_traces·search_metrics·search_profiles·search_replays·analyze_issue_with_seer·search_issues·get_sentry_resource와, `CATALOG_INFRASTRUCTURE_TOOL_NAMES`의 search_sentry_tools·execute_sentry_tool 10–13), 나머지는 catalog에 둔다. experimental surface도 같은 목록이다(35). `[확인]`
- `search_sentry_tools`는 이름·설명으로 catalog를 찾고 입력 schema와 annotations를 반환한다. 기본 `limit` 8, 최대 20(`tools/special/search-tools.ts` 10–11, 60–80). `execute_sentry_tool`이 그 이름과 인자로 실제 handler를 부른다. 직접 노출과 catalog 호출이 같은 handler다. `[확인]`
- 출력 규약(`internal/tool-helpers/results.ts` 4–17). `structuredContent`가 정본이고 text content는 그 JSON의 호환 view다. 둘에 서로 다른 사실을 넣지 않는다. handler가 structured만 반환하면 server가 `JSON.stringify(structuredContent, null, 2)` text를 붙여 보낸다(`server.ts` 90–102). markdown만 있는 tool은 structured를 붙이지 않는다(14–16). `[확인]`
- 오류는 throw하지 않고 `{ content: [{type: "text"}], isError: true }`로 반환한다(server.ts 413–433). 주석이 throw로 바꾸지 말라고 못박는다(422). `[확인]`
- annotations 네 개(readOnlyHint·destructiveHint·idempotentHint·openWorldHint)를 schema에 실어 돌려준다(search-tools.ts 13–18). client가 승인을 생략하는 용도는 server 쪽에 없다. `[확인]`
- token 측정 스크립트(`scripts/measure-token-cost.ts` 177)는 tool 정의 JSON을 tiktoken `encoding_for_model("gpt-4")`(cl100k_base)로 센다. 배포 테스트의 기준값으로 쓰지 않고 사람이 돌리는 측정이다. `[확인]`

### Paseo (`0d05584d044f`)

- runtime MCP는 stdio가 아니다. daemon이 `POST /mcp/agents`를 Streamable HTTP로 stateless하게 제공한다(`packages/server/src/server/bootstrap.ts` 1458–1479). 요청마다 server와 transport를 새로 만들고 응답이 닫히면 없앤다. 세션을 유지하지 않아 GET·DELETE는 JSON-RPC `-32000`과 함께 405다(1527–1536). `[확인]`
- 인증은 daemon password middleware 밖이라 route에서 따로 본다. 주입된 capability token 또는 daemon password의 bearer가 아니면 401 `{error: "Unauthorized"}`다(1497–1510). `mcpEnabled`가 false면 404다(1495–1498). 띄운 agent의 MCP 설정에 `Authorization: Bearer <token>`과 `?callerAgentId=<id>`를 넣어 준다(`runtime-mcp-config.ts` 40–52). token이 없으면 header를 생략한다. 저장된 설정에 남은 주입 server는 `stripInternalPaseoMcpServer`가 지운다(6, 40). `[확인]`
- tool은 한 server에 40개를 평면으로 등록한다. `speak`·`create_workspace`·`list_workspaces`·`archive_workspace`·`create_agent`·`send_agent_prompt`·`get_agent_status`·`list_agents`·`cancel_agent`·`archive_agent`·`kill_agent`·`update_agent`·`rename_workspace`·`list_workspace_scripts`·`start_workspace_script`·`stop_workspace_script`·`list_terminals`·`create_terminal`·`kill_terminal`·`capture_terminal`·`send_terminal_keys`·`create_schedule`·`create_heartbeat`·`delete_heartbeat`·`list_schedules`·`inspect_schedule`·`pause_schedule`·`resume_schedule`·`delete_schedule`·`update_schedule`·`schedule_logs`·`run_schedule_once`·`list_providers`·`list_models`·`list_profiles`·`inspect_provider`·`get_agent_activity`·`set_agent_mode`·`list_pending_permissions`·`respond_to_permission`(`tools/paseo-tools.ts`의 `registerTool` 호출). op enum으로 묶지 않는다. `[확인]`
- 결과. `structuredContent`만 있고 content가 비면 model용 text를 만들어 붙인다(`paseo-tool-serialization.ts` 51). 배열 필드는 `<key>_count=<n>`과, 모든 항목에 string id가 있으면 `<key>_ids=a,b`를 JSON 앞에 붙인다(33–42). content가 이미 있으면 structured를 그대로 두고 text를 추가하지 않는다(51). `[확인]`
- `callerAgentId`로 tool policy를 좁힌다(bootstrap.ts 1461–1467). 같은 server라도 호출한 agent마다 보이는 tool이 달라질 수 있다. `[확인]`

## 비교

| | Codex | Gemini CLI | OpenCode | Claude Code |
|---|---|---|---|---|
| 부모 env | whitelist 상속 (utils.rs 163–175) | redaction 후 상속 (environmentSanitization.ts 52–120) | 전부 상속 (mcp/index.ts 352–356) | `[미확인]` |
| stderr | 줄 단위 info 로그 | debug일 때만 소비 | pipe만, 미소비 | `[미확인]` |
| 기동 timeout 기본 | 30초 | 600초 (공용) | 30초 (공용) | `MCP_TIMEOUT`, 기본 `[미확인]` |
| tool call timeout 기본 | 300초 | 600초 | 30초, 진행 알림마다 리셋 | 약 28시간, idle 30분 |
| 한 server 실패 | optional은 격리, required는 세션 실패 | 격리 | 격리, failed 상태 | 세션 유지, tool search일 때만 model에 알림 |
| protocol 기본 | 2025-06-18, env opt-in으로 2026-07-28 | SDK 기본 `[미확인]` | SDK 기본 `[미확인]` | v2 runtime에서 2026-07-28 협상 |
| 이름 형식 | `mcp__<server>__<tool>` | `mcp_<server>_<tool>` | `<server>_<tool>` | `mcp__<server>__<tool>` |
| 이름 상한 | 128, 초과 시 sha1 12자 suffix | 63, 초과 시 앞30+`...`+뒤30 | 없음 | 문서에 없음 `[미확인]` |
| 둘 다 보낼 때 model이 보는 것 | structured만 (models.rs 2314–2324) | content만 | content만 | `[미확인]` (issue #55677은 structured만) |
| isError | `success: false`로 전달 | 오류 결과로 model에 반환 | throw, text만 | `[미확인]` |
| list_changed | 로그만, 재발견 없음 | 재발견, capability 선언 없어도 구독 | 재발견 + 이벤트 | 재발견, 실패 시 이전 목록 유지 |
| readOnlyHint | 승인 생략 아님 | Plan mode에서 ask_user로 완화 | 미사용, 매번 permission.ask | `[미확인]` |
| server instructions | tool namespace 설명 | `[미확인]` | system prompt `<mcp_instructions>` | `[미확인]` |
| 큰 결과 | 이벤트 기록만 1 MiB, model 상한 `[미확인]` | `[미확인]` | `[미확인]` | 25,000 token 넘으면 파일로 옮김 |

server 쪽.

| | GitHub MCP | Sentry MCP | Paseo |
|---|---|---|---|
| tool 묶음 | toolset, 기본 `default` | 직접 14개 + catalog | 평면 40개 |
| 켜는 방법 | `--toolsets` / `GITHUB_TOOLSETS` | 코드의 surface 목록, flag 없음 | `callerAgentId` policy |
| 한 tool 여러 동작 | `method` enum (pull_request_read 9개) | `execute_sentry_tool`이 이름과 schema를 받아 실행 | 없음, tool마다 하나 |
| read-only | 등록 시 필터 (`--read-only`) | annotation으로만 노출 | 없음 |
| 출력 | text + `IsError` | structured 정본, text는 같은 JSON | structured만이면 text를 생성해 부착 |
| list_changed | 끔 (정적 집합) | `[미확인]` | stateless라 의미 없음 |
| 인증 | token·GitHub App·OAuth | access token | bearer capability token, 없으면 401 |

## lophn에 가져올 것과 버릴 것

가져올 것.

- env는 Codex처럼 whitelist로 시작한다. lophn server는 credential을 env로 받지 않으므로(R36) 상속 env에 TOKEN·SECRET·KEY·AUTH가 들어가는 Gemini의 redaction 목록이 최소 기준이다. OpenCode의 전체 상속은 버린다.
- timeout은 둘로 나눈다. Codex의 startup 30초, tool call 300초가 가장 가깝다. OpenCode의 30초 공용은 app test 기본 300초(R33)보다 짧아 tool call 기본으로 못 쓴다. Claude Code의 28시간은 멈춘 server를 세션 끝까지 붙잡는다.
- 한 server 실패 격리는 넷 모두 기본이다. lophn은 세션당 server 하나라 해당이 적지만, 그 하나가 실패해도 세션 자체를 죽이지 않고 CLI fallback을 남기는 R1과 맞다.
- 결과 이중 표현은 Sentry의 규약이 lophn R5와 같다. structured가 정본, text는 같은 JSON, 어느 한쪽만 믿지 않는다. Codex와 Claude Code issue는 structured만, Gemini와 OpenCode는 content만 읽으므로 둘을 다르게 쓰면 어느 client에서 사실이 사라진다.
- `isError: true`는 GitHub·Sentry처럼 domain 실패에 쓰고 JSON-RPC error와 섞지 않는다. lophn R7과 같다.
- `list_changed`는 Gemini·OpenCode·Claude Code가 받아 재발견한다. Codex만 로그만 남긴다. lophn이 동적 tool을 바꾸려면 알림을 내야 하고, Codex에서는 사람이 server를 다시 연결해야 반영된다.
- toolset은 GitHub 방식이 lophn R3과 같다. 기본 묶음, 명시 opt-in, `all` 별칭 거절. Sentry의 search/execute 두 tool 구조는 schema를 더 줄이지만 lophn의 고정 15개와 이름 있는 동적 tool을 없앤다.
- op enum은 GitHub `pull_request_read`가 검증된 형태다. 필수 `method`, enum 밖 값은 실행 전 `IsError`. 동작이 늘수록 입력이 희소해지고 client가 엉뚱한 조합을 보내므로, lophn이 하듯 허용 목록을 문서에 고정하는 쪽이 맞다.

버릴 것.

- Paseo의 HTTP `/mcp/agents`와 bearer 주입. lophn MCP는 stdio만이다.
- Paseo의 평면 40개 tool. schema 비용을 묶음으로 줄이는 R3과 반대다. 이 40개에는 `respond_to_permission`·`kill_agent`·`set_agent_mode`·`cancel_agent`가 들어 있어, coding credential에서 세션·권한 동작을 빼는 R37과도 반대다.
- Gemini의 63자 가운데 절단(`...`). 서로 다른 command가 같은 이름이 되어도 감지하지 못한다. 해시를 붙여 충돌을 드러내는 Codex 쪽이 lophn의 sha256 이름과 같다.
- OpenCode의 tool 이름 무제한. Claude API의 64자 제약 앞에 두면 어느 길이에서 깨지는지 모른다.
- GitHub의 read-only를 등록 필터로만 두는 것. lophn은 숨김이 권한이 아니므로(R30) 실행 때도 검사해야 한다.

### 동적 tool 이름 길이

lophn 이름 `lophn_app_<app-id>_<command-name sha256 앞 16자>`는 고정 27자에 app ID 길이 L을 더한 것이다. client는 이 이름을 그대로 쓰지 않고 server 이름을 앞에 붙인다. 아래 계산은 server 이름을 `lophn`(5자)으로 둔 가정이다. app ID 최대 길이는 lophn 문서에 없다. 문서 이름 최대 길이가 spec로 미뤄져 있어(documents/addressing R10) app ID도 같은 상태라, L을 8·16·26으로 가정해 센다. `[미확인]`

model에 보이는 이름.

- Gemini CLI. `generateValidName`이 `mcp_`를 한 번 더 붙인다(`mcp-tool.ts` 521–524, 725–727). 결과는 `mcp_lophn_lophn_app_<id>_<16hex>`이고 길이는 `10 + 27 + L = 37 + L`이다. 상한은 63이라 L이 26 이하면 그대로 통과하고, 27부터 앞 30자 + `...` + 뒤 30자로 가운데를 자른다(738–747). 뒤 30자는 `_`와 hex 16자를 포함하므로 sha256 suffix는 남는다. 잘린 이름은 lophn이 만든 결정적 이름과 달라지고, app ID의 가운데만 다른 두 command는 같은 이름이 되는데 충돌 감지가 없다.
- Codex. `mcp__lophn__` 11자에 tool 이름을 붙인다(`mcp/mod.rs` 66–67, 83–87). 길이는 `11 + 27 + L = 38 + L`이라 128 상한까지 L은 90이다. 그 안에서는 잘리지 않는다. hyphen은 `_`로 바뀌므로(575–593) app ID에 hyphen이 있으면 서로 다른 app ID가 같은 이름이 되고, 그때 `unique_callable_parts`가 sha1 앞 12자를 덧붙여 model에 보이는 이름이 lophn 이름과 달라진다(`tools.rs` 289–316).
- OpenCode. `<server>_<tool>`이라 `lophn_` 6자를 더한다(catalog.ts 117–119). 길이 상한은 이 모듈에 없다. 허용 문자 밖이 `_`로 바뀐 뒤 같은 이름이 되면 나중 tool이 덮고 오류는 없다. provider 요청 조립 쪽의 이름 상한은 찾지 못했다. `[미확인]`
- Claude Code. 문서의 형식은 `mcp__<server>__<tool>`이고 길이 상한은 문서에 없다. `[문서]` `[미확인]`

| app ID 길이 L | tool 이름 (27+L) | Gemini `mcp_lophn_` 포함 (37+L, 상한 63) | Codex `mcp__lophn__` 포함 (38+L, 상한 128) | OpenCode `lophn_` 포함 |
|---|---|---|---|---|
| 8 | 35 | 45, 통과 | 46, 통과 | 41, 상한 없음 |
| 16 | 43 | 53, 통과 | 54, 통과 | 49, 상한 없음 |
| 26 | 53 | 63, 통과 | 64, 통과 | 59, 상한 없음 |
| 27 | 54 | 64, 가운데 절단 | 65, 통과 | 60, 상한 없음 |

## requirements와 다른 점

**coding-agent/mcp-server#R1** startup timeout이 requirements에 없다. Codex 기본 30초, OpenCode 30초 from initialize까지라, 기동이 느린 server는 tool 발견 전에 끊긴다. lophn executable의 기동 예산을 숫자로 정해야 client 설정이 맞는다.

**coding-agent/mcp-server#R1** env 상속이 넷 다 다르다. Codex는 whitelist, Gemini는 redaction, OpenCode는 전체 상속, Claude Code는 문서가 말하지 않는다. lophn server가 부모 env의 secret을 진단에 찍지 않으려면 자기 쪽에서도 상속 목록을 줄여야 한다.

**coding-agent/mcp-server#R5** client가 두 표현을 동시에 쓰지 않는다. Codex는 `structured_content`가 있으면 text를 버리고(`protocol/src/models.rs` 2314–2320), Gemini와 OpenCode는 content만 읽는다. 두 표현의 의미가 같아야 한다는 R5는 선택이 아니라 어느 한쪽만 보는 client가 있다는 이유에서 필수다. 어느 한쪽을 생략하면 그 client에서 결과가 빈다.

**coding-agent/mcp-server#R7** `isError`의 전달이 다르다. Codex는 `success: false`인 정상 tool 결과로, Gemini는 오류 메시지로, OpenCode는 throw로 올린다. 셋 다 model이 실패를 보기는 한다. 효과 불명을 성공과 구분하는 필드를 client가 보존하는지는 확인하지 못했다. `[미확인]`

**coding-agent/mcp-server#R34** 이름 길이. 계산은 위 절이다. server 이름을 `lophn`으로 두면 Gemini는 app ID 27자부터 model에 보이는 이름을 가운데에서 자르고, 잘린 이름은 lophn의 결정적 이름과 다르며 가운데만 다른 command가 충돌해도 알리지 않는다. Codex는 128 안에서 app ID 90자까지 그대로 두지만 hyphen을 `_`로 바꿔 생긴 충돌에는 sha1 12자를 덧붙인다. OpenCode는 이 모듈에 길이 상한이 없다. Claude Code의 길이 상한은 공식 문서에 없어 `[미확인]`이다. app ID 최대 길이가 lophn 문서에 없으므로 그 값을 정하기 전에는 이 이름이 client에서 그대로 보인다고 말할 수 없다.

**coding-agent/mcp-server#R35** `notifications/tools/list_changed`를 Codex는 무시한다(`logging_client_handler.rs` 86–88). release가 바뀌어 알림을 내도 Codex 세션은 옛 tool 목록으로 호출하고, server가 `conflict`와 재조회를 반환해야 한다. Gemini·OpenCode·Claude Code는 재발견한다. Codex에서 재발견을 기대하는 검증은 실패한다.

**coding-agent/mcp-server#R4** `readOnlyHint`로 승인을 건너뛰는 client는 넷 중 없다. Gemini는 Plan mode에서 deny 대신 ask_user로 완화할 뿐이다. annotation은 힌트이지 권한 경계가 아니므로, 혼합 tool에 붙이지 않는 R4의 방향은 유지하되 승인 생략을 이 annotation에 기대면 안 된다.

**coding-agent/mcp-server#R4** token 측정 기준이 없다. Sentry는 tiktoken `gpt-4`(cl100k_base)로 tool 정의 JSON을 센다(`measure-token-cost.ts` 177). lophn의 "배포에서 고정한 tokenizer"가 이와 다르면 2,000 token 목표의 의미가 달라진다. 어느 tokenizer를 고정하는지는 이 문서 범위 밖이다.

**coding-agent/mcp-server#R3** 큰 catalog의 다른 해법. Sentry는 tool을 14개만 노출하고 나머지는 `search_sentry_tools`·`execute_sentry_tool`로 찾는다. Claude Code는 tool search로 정의를 미룬다(기본 on, catalog 상한 10,000). lophn의 동적 tool이 앱마다 늘면 2,000 token 목표는 toolset만으로 못 지킨다. 둘 다 lophn의 이름 있는 동적 tool과 다르므로 가져오려면 R34의 직접 tool 방식을 바꿔야 한다.
