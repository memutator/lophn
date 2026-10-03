---
type: research
concerns: [lophn-agent/extensions]
---
# 외부 MCP client

## 질문

assignment별 stdio·Streamable HTTP 연결에서 전체 tool catalog·이름·사람 분류·인증을 어떻게 일관되게 유지할까?
timeout·끊김·취소·종료 뒤 실행 여부를 잘못 단정하거나 이미 전달한 call을 재전송하지 않으려면 무엇을 기록해야 할까?
SDK 밖에서 직접 검증하고 fake server로 확인할 경계는 무엇인가?

조사일 2026-10-04. `[확인]`은 해당 revision의 소스에서 본 동작, `[추측]`은 해석, `[미확인]`은 확인하지 못한 동작이다. SDK에 위임한 것을 SDK 기본값까지 확인한 것으로 쓰지 않는다. 소스와 테스트를 읽었고 테스트는 실행하지 않았다. `node_modules`·snapshot·빌드 산출물은 근거로 쓰지 않았다. Claude Code clone에는 harness 소스가 없어 비교 프로젝트로 세지 않았다.

lophn 기준: `docs/requirements/lophn-agent/extensions.md` R11–R29/R31, `docs/domain-model/lophn-agent/extensions.md`의 `McpServerConfig`·`McpConnection`·`McpToolClassification`, `docs/architecture/lophn-agent.md` §2.3·§5.5·§7.5. 일반 approval 정책은 `docs/research/tool-registry-and-judgment.md`에 맡기고 MCP 정의·분류 fingerprint·전송 경계만 다룬다. 아래 비교표의 C/G/O/P/A/H 번호는 프로젝트별 근거를 가리킨다.

## 프로젝트별

### Codex (3a69ec3ef8fb)

revision `3a69ec3ef8fb87b41e99b8942af061ad58ae6732`.

- **C1 연결·목록** [확인] stdio·Streamable HTTP. 기본 startup30초·call300초. HTTP initialize/list transient retry는250ms·1000ms, 최초 포함3번이며 공통 deadline 안이다. 전체 list collector는30초·100pages·일반2048items/Apps8192items·cursor64KiB·반복 cursor reject·partial return 없음. normalization에서는 duplicate raw identity를 warning 후 skip한다. [미확인] manager 전체 disconnect 재연결과 입력 Schema 의미 compile. 근거: `codex:codex-rs/codex-mcp/src/rmcp_client.rs` `DEFAULT_STARTUP_TIMEOUT`, `DEFAULT_TOOL_TIMEOUT`, `list_tools_for_client_uncached`; `codex:codex-rs/codex-mcp/src/pagination.rs` `collect_paginated_with_limit`; `codex:codex-rs/rmcp-client/src/streamable_http_retry.rs` retry helper; `codex:codex-rs/config/src/mcp_types.rs` `startup_timeout_sec`, `tool_timeout_sec`.
- **C2 이름·선택** [확인] 현재 모델 이름 maximum은**128bytes**, 선택적 역사 prefix `mcp__`, hash는**SHA-1 앞12hex**다. server/namespace/connector ID/callable/원래 tool을 NUL로 연결한 identity를 hash하고 추가 충돌에는 attempt도 쓴다. sanitizer 구현은 ASCII alphanumeric·underscore만 남긴다. `ToolInfo.server_name`, `ToolInfo.tool.name`은 원래 routing을 보존한다. enabled_tools 생략은 all, disabled_tools는 exact denylist다. 근거: `codex:codex-rs/codex-mcp/src/tools.rs` `ToolInfo`, `ToolFilter::allows`, `normalize_tools_for_model_with_prefix` L105–149, `callable_name_hash_suffix`; `codex:codex-rs/codex-mcp/src/mcp/mod.rs` `sanitize_responses_api_tool_name`.
- **C3 stdio** [확인] safe env allowlist+명시 env/env_vars·custom CA 설정. PATH/HOME 외 LANG/LC_ALL/TMPDIR/TERM/SHELL/USER 등을 포함한다. Unix process group 소유·TERM2초 grace 뒤 group kill·stderr drain250ms. stderr는 줄 단위 tracing. [미확인] stderr byte cap/전체 redaction·모든 OS absolute executable admission. 근거: `codex:codex-rs/rmcp-client/src/utils.rs` env 구성; `codex:codex-rs/rmcp-client/src/stdio_server_launcher.rs` launcher·process-group cleanup.
- **C4 auth·변경** [확인] `SameOriginRedirectHttpClient`는 cross-origin redirect 자체를 거절, 최대10회·원래 timeout 공유. OAuth refresh lock은 server+URL store key와 CODEX_HOME 범위의 cross-process file lock, 획득60초·poll50ms; credential 재읽기→refresh→저장 전체를 잠근다. 서로 다른 CODEX_HOME keyring coordination은 TODO다. `LoggingClientHandler::on_tool_list_changed`는 로그만, elicitation은 host callback으로 실제 전달한다. [미확인] 상위 refresh integration·공유 범위·normal call cancel·PKCE/DCR/store 전체 flow. handler만 보고 제품 전체 list_changed 부재로 단정하지 않는다. 근거: `codex:codex-rs/rmcp-client/src/http_client_redirect.rs` `SameOriginRedirectHttpClient`; `codex:codex-rs/rmcp-client/src/oauth/refresh_lock.rs` `RefreshCredentialLock` L1–99; `codex:codex-rs/rmcp-client/src/logging_client_handler.rs` `create_elicitation`, `on_tool_list_changed` L40–90.

### Gemini CLI (fb972b2f87fe)

revision `fb972b2f87fe7d5b06d37eac711490162d98de2c`.

- **G1 transport·stdio** [확인] 기본 timeout600초를 연결/discovery/call에 쓰고 server timeout override. httpUrl 또는 명시 type은 고정, untyped URL은 HTTP→일부 실패에서 SSE fallback. auth 오류는 먼저 검사, oauth.enabled일 때 자동 OAuth 경로; OAuth HTTP404에도 SSE 후보가 있다. stdio는 trusted folder 필요. process.env+extension env를 sanitize한 뒤 server env 확장, 위험한 실행 env override 제한. command/args/cwd/stderr pipe는 SDK에 전달한다. [미확인] timeout 최소/최대·SDK shell/종료 grace·stderr cap. 근거: `gemini-cli:packages/core/src/tools/mcp-client.ts` `MCP_DEFAULT_TIMEOUT_MSEC`, `createTransport`, `connectToMcpServer`.
- **G2 목록·이름** [확인] tool discovery는 **한 번** listTools({},options)의 tools를 순회한다. 같은 파일 cursor loop는 prompt discovery다. 변환 실패 tool만 skip; nullable 등을 provider schema로 바꾸고 실패하면 원본 fallback. `generateValidName`은 `[A-Za-z0-9_\-.:]`·실사용63자, 긴 이름은first30+`...`+last30, hash 아님. prefix `mcp_`와 원래 tool name은 분리한다. [미확인] registry 전체 collision 처리. 근거: `gemini-cli:packages/core/src/tools/mcp-client.ts` tools discovery·`discoverPrompts`; `gemini-cli:packages/core/src/tools/mcp-tool.ts` `generateValidName`, `DiscoveredMCPTool`.
- **G3 변경·분류·공유** [확인] tools/resources/prompts list_changed refresh를 coalesce하고 같은 이름에도500ms verification refresh. roots는 workspace dirs, 변경 알림도 제공한다. manager는 name/config/extensionId의 stable JSON SHA256 pool key로 여러 RegistrySet에 client를 공유한다. readOnlyHint metadata를 넘기지만 확인한 Kind는 Other. server/server-tool confirmation allowlist와 trusted workspace의 trust=true bypass가 있다. [미확인] subagent manager 범위·definition hash 변경 시 approval 무효화. 근거: `gemini-cli:packages/core/src/tools/mcp-client.ts` `McpClient` refresh·roots; `gemini-cli:packages/core/src/tools/mcp-client-manager.ts` pool/RegistrySet; `gemini-cli:packages/core/src/tools/mcp-tool.ts` invocation confirmation.
- **G4 OAuth·call** [확인] PKCE/DCR·callback 먼저 열어 port 획득 후 등록, DCR 미지원+client ID 없음은 실패. storage key는 serverName, clientId/tokenUrl도 저장한다. HybridTokenStorage는 keychain/encrypted-file fallback, initialization promise 공유. invocation abort는 **로컬 Promise race**지만 조사한 callTool(functionCalls)에 signal을 넘기지 않는다. text는 untrusted wrap, image/audio inlineData, embedded resource text/blob, resource_link text. [미확인] refresh single-flight·issuer/URL/account binding·result cap·MCP cancel delivery. store init single-flight는 refresh single-flight가 아니다. 근거: `gemini-cli:packages/core/src/mcp/oauth-provider.ts` `MCPOAuthProvider`; `gemini-cli:packages/core/src/mcp/mcp-oauth-provider.ts`; `gemini-cli:packages/core/src/mcp/oauth-token-storage.ts`; `gemini-cli:packages/core/src/mcp/token-storage/hybrid-token-storage.ts` `getStorage`; `gemini-cli:packages/core/src/tools/mcp-tool.ts` execute/result 변환. 테스트 `gemini-cli:packages/core/src/tools/mcp-client.test.ts` L7–87은 SDK를 mock하므로 OS lifecycle 근거가 아니다.

### OpenCode (907b3bc518fa)

revision `907b3bc518fa48e90e8ec24dd327d13eee71c36c`.

- **O1 연결·stdio** [확인] connection30초. remote Streamable HTTP→SSE 순차 시도, auth 오류는 needs_auth/needs_client_registration으로 끝. local command array→SDK, **전체 process.env**+명시 environment. cwd는 instance directory 기준 resolve/생략도 instance directory, stderr pipe. pgrep descendants TERM 후 SDK close. [미확인] SDK kill grace·stderr cap. 근거: `opencode:packages/opencode/src/mcp/index.ts` client 생성·transports·cleanup.
- **O2 목록·call·이름** [확인] paginate1000pages·반복 cursor reject·전체 결과 반환, timeout은 page별. duplicate original name 검사는 collector에 없다. outputSchema validation failure에 이를 제외한 tolerant retry. input을 object/properties/additionalProperties:false로 provider 변환. call signal 전달·resetTimeoutOnProgress:true, 이 경로 maxTotalTimeout 없음. 이름 sanitize(server)+`_`+sanitize(tool), disallowed→underscore; 이 함수에 cap/hash 없음. [미확인] SDK 기본 call timeout·제품 범위·다른 계층 collision·Schema compile. 근거: `opencode:packages/opencode/src/mcp/catalog.ts` paginate·tool 변환·call; `opencode:packages/opencode/src/mcp/index.ts` 이름 조립.
- **O3 변경·reverse·공유** [확인] list_changed re-list→defs swap→ToolsChanged, 실패하면 old defs 유지. onclose는 client/defs/instructions 제거·failed. state는 InstanceState·server name key. roots는 instance directory URI, sampling/elicitation/tasks 선언은 조사 경로에서 비활성; prompts/resources/templates·instructions 지원. [미확인] automatic reconnect·classification hash invalidation. 근거: `opencode:packages/opencode/src/mcp/index.ts` `InstanceState`, roots·watch·instructions. 실제 loopback HTTP SDK server·mutable catalog·cwd stdio fixture 테스트: `opencode:packages/opencode/test/mcp/lifecycle.test.ts` `lifecycleServer`, `hangingLifecycleServer`, `stdioFixture` L25–230.
- **O4 OAuth·result** [확인] callback `127.0.0.1:19876/mcp/oauth/callback`, callbackPort/redirectUri 변경 가능. manual clientId/clientSecret·DCR 저장 hook. mcp-auth.json mode0600·mutation file lock, getForUrl exact URL match; Entry에 issuer/account 없음, codeVerifier/state 있음. PendingProvider는 commit 전 stage. auth URL은 http/https 수락. isError는 text error, structuredContent-only 성공은 JSON text. [미확인] SDK PKCE wire·refresh single-flight·redirect/TLS. file mutation lock을 refresh lock으로 간주하지 않는다. 근거: `opencode:packages/opencode/src/mcp/oauth-provider.ts` `McpOAuthProvider`, `McpOAuthPendingProvider`; `opencode:packages/opencode/src/mcp/auth.ts` `Entry`, `getForUrl`, `mutate` L25–95; `opencode:packages/opencode/src/mcp/catalog.ts` result.

### Pi (83692682f095)

revision `83692682f095528f8b71652ddacff7075e36e893`.

- **P1 protocol·목록** [확인] 자체 stdio/Streamable HTTP library. 기본 request30초·override, nonfinite/≤0 timer off. start 후 initialize라 request timer만으로 start를 묶지 못함. progress가 timer reset. list1000pages·repeat cursor reject·전체 return, page별 timer; null/empty cursor 종료·invalid type reject. isTool은 name string/inputSchema object, duplicate/Schema compile 검사는 없다. [미확인] legacy SSE 전용 transport는 읽은 파일에서 못 찾음. Streamable HTTP SSE **응답 stream**과 구별한다. 근거: `pi:packages/mcp/src/client.ts` `connect`, `listAll` L339–374, `requestInternal`, `handleProgress`, `armTimeout` L394–553; `pi:packages/mcp/src/transports/streamable-http.ts` `StreamableHttpTransport`.
- **P2 stdio** [확인] 기본 process.env, inheritEnv:false→explicit only. crossSpawn literal command/args·shell flag 없음; Windows cmd shim은 cmd.exe 관련 가능. cwd explicit/상속. stderr tail64KiB·callback은 full chunk, JSON-RPC message16MiB. stdin close500ms→TERM2000ms→KILL, POSIX group/Windows taskkill /T /F, closeTimeoutMs 설정. 근거: `pi:packages/mcp/src/transports/stdio.ts` `StdioTransport`·close/tree cleanup.
- **P3 cancel·reverse** [확인] timeout/abort에서 initialize 제외 notifications/cancelled, close pending reject/incoming abort. 기본 capabilities `{}`·ping, roots는 options.roots 있을 때만. custom request handler 가능하지만 sampling/elicitation model call은 내장하지 않음. resources/read/list/template API. MCP package에 이름/분류/assignment pool은 없다. [미확인] host prompts·sharing/approval. 근거: `pi:packages/mcp/src/client.ts` `requestInternal`, `handleRequest`, `cancelPending`, `close`; `pi:packages/mcp/test/client.test.ts` initialize/progress/abort L70–225.
- **P4 HTTP·OAuth** [확인] stream reconnect1000ms exponential·cap30초·max5, SSE retry field 반영. GET+Last-Event-ID **응답 resume**이지 원래 POST 재전송/full session initialize 아님. auth/session/protocol 오류는 stream retry 안 함. authorizedFetch는401/insufficient_scope403 후 provider auth→1회 repeat 가능, DELETE timeout1초. OAuth S256·manual client/DCR·HTTPS/loopback guard·state/path/iss/issuer match; callback port0·wait5분. provider exact URL binding·기본 memory store, auth provider inFlight+token 교체 재검사로 refresh serialize. [미확인] redirect body 정책·durable account binding. 근거: `pi:packages/mcp/src/transports/streamable-http.ts` retry/authorizedFetch/close; `pi:packages/mcp/src/oauth/flow.ts` OAuth flow·`createOAuthAuthProvider`; `pi:packages/mcp/src/oauth/callback.ts`; `pi:packages/mcp/src/oauth/provider.ts` `own`, `MemoryOAuthStateStore` L40–81·152–167.
- **P5 결과·fixture** [확인] text/image 보존, audio omission, resource_link name/URI, embedded text/image 각 content·기타 binary omission. structuredContent는 content 없을 때 JSON. [미확인] 모델측 result cap. 실제 Node stdio/stubborn grandchild·loopback HTTP·in-memory pair를 나눠 테스트한다. 근거: `pi:packages/mcp/src/protocol/content.ts` content 변환; `pi:packages/mcp/test/stdio.test.ts`, `pi:packages/mcp/test/streamable-http.test.ts`, `pi:packages/mcp/test/client.test.ts` `createServer`.

### OpenClaw (37efa0b4a644)

revision `37efa0b4a644b66a5987a07841e9707e1de2a7d8`.

- **A1 연결·stdio** [확인] bundle client stdio/SSE/Streamable HTTP. command-bearing config stdio 우선, URL 기본 경로 SSE; strict tagged union/HTTP→SSE 순차 fallback과는 다름. connection30초·request60초·명시 timeout 없는 catalog10초. initialize outer abort+SDK timeout/maxTotalTimeout. dispose5초→forceClose·uncertain cleanup 기록. stdio SDK safe env+explicit, exactEnv면 추가 상속off. stderr line8KiB·newline 없는 progress250ms flush. HTTP JSON/SSE event는 SDK buffer 상수 cap, sslVerify 설정 있음. resource redirect-body replay 유지 주석, auth redirect는 더 strict. [미확인] SDK cap 수치·model result cap. 근거: `openclaw:src/agents/mcp-transport-config.ts` `resolveMcpTransportConfig` L60–217; `openclaw:src/agents/mcp-client-lifecycle.ts` `connectMcpClient`, `disposeMcpClient`; `openclaw:src/agents/agent-bundle-mcp-runtime.ts` `getCatalogListTimeoutMs`; `openclaw:src/agents/mcp-stdio-transport.ts`; `openclaw:src/agents/mcp-transport.ts` `attachStderrLogging`, `resolveMcpTransport` L39–210; `openclaw:src/agents/mcp-http-transport.ts` wrapper.
- **A2 catalog·이름** [확인] aggregate deadline·128pages·16384items·serialized10MiB·repeat cursor reject. empty cursor도 present. 이름 `[A-Za-z0-9_-]`·server30/전체64·`<server>__<tool>`·case-insensitive collision `-2/-3`. 선언 순서가 suffix owner를 정함. raw pair 보존. 근거: `openclaw:src/agents/mcp-catalog-listing.ts` `MCP_CATALOG_LIST_LIMITS`, `listAllMcpTools`; `openclaw:src/agents/mcp-pagination.ts` `collectMcpPaginatedItems`; `openclaw:src/agents/mcp-pagination.test.ts` empty/cyclic cursor·absolute monotonic deadline L15–175; `openclaw:src/agents/agent-bundle-mcp-names.ts` `assignSafeServerNames`, `buildSafeToolName` L10–108.
- **A3 refresh·공유** [확인] list_changed invalidate/re-list; closed SDK client retire→새 client. startup first failure30초 exponential·cap600초, 첫 owner recovery5초 예외. session runtime manager singleton, runtime sessionId, idle TTL0은 lifetime 유지·live256·sweep60초. [미확인] 모든 requester/lease physical sharing·call replay. manager 공유와 connection 공유는 같지 않다. 근거: `openclaw:src/agents/agent-bundle-mcp-runtime.ts` currentSession·onclose L655–749; `openclaw:src/agents/mcp-startup-backoff.ts` `connectWithMcpStartupBackoff`; `openclaw:src/agents/agent-bundle-mcp-runtime-shared.ts` constants·`CreateSessionMcpRuntime`.
- **A4 auth·reverse** [확인] OAuth store key server+URL SHA256/16, requester channel/account/sender hash 추가·session ID 제외. Apps-off capabilities `{}`, Apps-on form/url elicitation·UI extension+handler. prompts/resources methods도 있음. [미확인] issuer/account change·refresh single-flight/store backend 전체. 근거: `openclaw:src/agents/mcp-oauth-identity.ts` operator/requester identity; `openclaw:src/agents/mcp-metadata.ts` `buildMcpClientCapabilities`; `openclaw:src/agents/agent-bundle-mcp-runtime.ts` call/listResources L970 이후. strict proxy `mcp-stdio-client.ts` 정책을 bundle client와 섞지 않았다.

### Hermes Agent (343500b3547e)

revision `343500b3547e12530457c2fda60ec687e25118b4`.

- **H1 회복** [확인] connect60초·call300초, initial retries3·reconnect5·backoff start1초·cap60초·jitter±20%. exhausted/permanent failure park 뒤300초 self-probe. initialize만으로 budget reset 안 함, 성공call/충분한 keepalive가 proof. 근거: `hermes:tools/mcp_tool.py` retry constants; `hermes:tools/mcp_tool_common.py` `_DEFAULT_TOOL_TIMEOUT`, `_jittered`; `hermes:tools/mcp_tool_server_run.py` `_RetryBudget`, `run`, `_on_transport_error`; `hermes:tools/mcp_tool_health.py` `_mark_session_proven`.
- **H2 transport·stdio** [확인] explicit SSE·HTTP, 최초 recognizable mismatch만 SSE fallback, timeout/reconnect/strict_redirect_headers는 제외·성공 fallback latch. ssl_verify=false 가능. safe env baseline PATH/HOME/USER/LANG/LC_ALL/TERM/SHELL/TMPDIR+Windows keys/XDG_*+**external secret source**+server env. cwd explicit/logical session cwd. stderr tail16KiB·drain2초지만 append log/newline 전 pending cap은 이 구현에 없음. child PID/group/orphan 관리. 근거: `hermes:tools/mcp_tool_transport.py` `MCPServerTransportMixin`; `hermes:tools/mcp_tool_config.py` `_build_safe_env`, `_StderrTee` L63–177; `hermes:tools/mcp_tool_lifecycle.py` cleanup.
- **H3 목록·이름** [확인]50pages 초과 warning+**partial return**, repeat cursor set 없음, invalid/empty cursor terminal. filters exact/fnmatch. `mcp__server__tool`·64자 넘으면 SHA256/8, hash input은 **sanitize된 full_name**이며 길이 초과 때만 suffix. ambiguous normalized name skip/동일 origin duplicate drop. Schema nullable/ref/object shape repair. 근거: `hermes:tools/mcp_tool.py` `_paginate_full_list` L252–302; `hermes:tools/mcp_tool_schema.py` `mcp_prefixed_tool_name` L147–183, `_normalize_name_filter`, `_normalize_mcp_input_schema`; `hermes:tools/mcp_tool_registration.py` collision 등록.
- **H4 refresh·replay** [확인] list_changed 별도 task·refresh/RPC locks→stale deregister/re-register.401 auth recovery1회 retry, session-expired **read-only** reconnect+replay, write-capable ambiguous/no replay. dead child before dispatch1회 respawn/replay, mid-call death는 reconnect/no replay. readOnlyHint로 replay safety를 고르는 방식은 R20/R28과 다름. 근거: `hermes:tools/mcp_tool_health.py` `_make_message_handler`, `_refresh_tools` L99–167; `hermes:tools/mcp_tool_handlers.py` recovery branches.
- **H5 sharing·reverse·result** [확인] single profile server name, multiplexer `(owner_scope,name)`, route/credential 동일하면 다른 profile adopt 가능. sampling/elicitation enabled 생략true·SDK 지원 때 handler; structured elicitation→approval, URL mode decline. prompts/resources utility tools capability-gated. text cap2,000,000chars, embedded decoded resource50MiB/base64 사전 검사; reserved meta 제거·text/structured 중복 회피·image/audio MEDIA cache tags. image 전체에 embedded cap이 적용된다고 확대하지 않음. [미확인] OAuth 전체·child kill grace·trust 최종 approval. 근거: `hermes:tools/mcp_tool_scope.py` `_server_key`, `_resolve_server_key`; `hermes:tools/mcp_tool_server_run.py` `_prepare_run` L257–276; `hermes:tools/mcp_tool_sampling.py` handlers; `hermes:tools/mcp_tool_schema.py` `_UTILITY_TOOL_SPECS`; `hermes:tools/mcp_tool_content.py` result/resource caps·`_decode_block_b64` L17–125.

## 비교

`?`는 미확인이지 부재가 아니다. hard total deadline·page request timer·SSE stream reconnect를 섞지 않는다.

### 숫자

| 항목 | lophn | Codex | Gemini CLI | OpenCode | Pi | OpenClaw | Hermes |
|---|---|---|---|---|---|---|---|
| 연결 |30초|startup30초 C1|600초 G1|30초 O1|request30초/start 별도 P1|30초 A1|60초 H1|
| 전체 list |합산30초|합산30초/100pages C1|1request/600초 G2|page별/1000pages O2|page별30초/1000pages P1|합산10초/128pages A2|50pages 뒤partial H3|
| call 기본 |60초|300초 C1|600초 G1|SDK 기본? O2|30초/progress reset P1|60초 A1|300초 H1|
| call 설정 범위 |1–600초|duration/제품상한? C1|server timeout/범위? G1|timeout/범위? O2|nonfinite/≤0 timer off P1|positive timer 정규화 A1|server/global timeout H1|
| reconnect |1·2·4초/최대3회|HTTP init/list0.25·1초, manager? C1|동등 ladder? G3|onclose failed/ladder? O3|**stream resume**1초→cap30초/5회 P4|startup30초→cap600초 A3|1초+jitter/cap60초/5회→park H1|
| stdio shutdown |5초 뒤kill|TERM2초/stderr0.25초 C3|SDK? G1|descendant TERM/SDK O1|stdin0.5초/TERM2초 P2|dispose5초/forceClose A1|loop drain3초/stderr2초, kill grace? H2|

[확인] lophn 수치는 R19–R21/architecture §5.5다. call retry는 connection retry와 별개며 Pi5회 resume는5회 call POST를 뜻하지 않는다. progress reset(P1/O2)은 요구의 hard60초와 다르다.

### 이름·환경·목록

| 항목 | lophn | 확인된 대조 |
|---|---|---|
| 이름 |`ext_<server>_<tool>`, `[A-Za-z0-9_-]`,64자|Codex 선택적mcp__ namespace/128bytes C2; Gemini mcp_/63/`.`·`:` G2; OpenCode server_tool/cap은 해당함수 없음 O2; Pi host 책임 P3; OpenClaw server__tool/64 A2; Hermes mcp__/64 H3|
| hash/collision |**raw pair SHA256/8**, 잔여 reject|Codex extended raw SHA1/12+attempt C2; Gemini 가운데`...`/collision? G2; OpenClaw 순서기반-2 A2; Hermes **sanitized name** SHA256/8·축약 때만 H3|
| 최소 env |PATH/HOME/TEMP/LC_ALL+해당server explicit|Codex allowlist+CA C3; Gemini broad filtered G1; OpenCode process.env O1; Pi process.env/inheritEnv:false P2; OpenClaw SDK safe/exactEnv A1; Hermes baseline/XDG/external secrets H2|
| repeat cursor |전체 거절|Codex/OpenCode/Pi/OpenClaw reject C1/O2/P1/A2; Hermes50page까지 순환 H3; Gemini tool loop 없음 G2|
| invalid/duplicate |전체 거절|Codex raw identity skip C1; Gemini bad tool skip G2; OpenCode tolerant outputSchema O2; Pi shape-only P1; Hermes ambiguous skip/partial H3|
| 선택 생략 |0개/exact current pair|Codex enabled 생략all C2; Gemini server trust G3; Hermes globs H3|

[확인] lophn env는 §2.3, 검증·이름·선택은 R22/R23/R31·§5.5다. 64자 regex는 **lophn portable contract**이며 모든 provider의 보편 한계라고 주장하지 않는다. Codex128bytes가 반례다. adapter별 실제 제한 검사도 필요하다.

### lifecycle·auth

| 경계 | 소스 대조 | lophn 선택 |
|---|---|---|
| SSE |Gemini/OpenCode fallback G1/O1; Hermes mismatch만 H2; OpenClaw explicit/default SSE A1|R13 tagged stdio/http, legacy fallback0. HTTP SSE 응답은 가능|
| list_changed |G3/O3/A3/H4 refresh, Codex handler log만 C4|R24 complete refresh+definition hash diff+classification 무효화|
| connection owner |Gemini config pool G3; OpenCode instance O3; OpenClaw session A3; Hermes profile adoption H5|R18 assignment/server exact key·cross-assignment physical share0|
| header/TLS |Codex cross-origin reject C4; OpenClaw resource body redirect A1; Hermes TLS bypass/strict option H2|R15 no bypass·custom API-key도 auth header·body 정책 필요|
| secret binding |OpenCode exact URL/file0600 O4; Pi URL/memory P4; OpenClaw URL/requester A4; Gemini serverName G4|R17 URL/issuer/account/revision platform secret binding|
| refresh |Pi provider promise P4; Codex cross-process transaction C4; OpenCode mutation lock O4; Gemini init promise G4|R17 refresh 자체 single-flight, 저장 lock/init promise와 구별|
| reverse |G3/O3 roots; C4 elicitation; H5 sampling/elicitation 기본on; A4 Apps-on; P3 custom handler|R25 capabilities{}·unsupported·model/question/roots 생성0|
| result |G4 multimodal; P5 omission; O4 structured-only text; H5 char/resource cap|data conversion/redaction·receive/model budget 분리|

## lophn에 가져올 것과 버릴 것

- **R11/R12/R31:** tagged config 검증 후 invalid server만 제외, config와 preset selection 분리. exact current `(server,originalTool)`만, 생략0개. Codex raw-name routing(C2)은 가져오고 omitted-all/glob/mixed config precedence(C2/H3/A1)는 버린다. server/skill 응답을 config loader에 넣지 않는다.
- **R13/R14:** Pi transport 분리/no-inheritance(P2), Codex/Pi process tree(C3/P2)를 참고. absolute existing executable·literal args·등록cwd·Deno.Command clearEnv 뒤 네 변수와 server explicit만. external secret source 자동 합치기(H2), package manager 설치 shortcut은 버린다. architecture §2.3대로 Deno allow-run은 child OS sandbox가 아니다.
- **R15:** Codex cross-origin reject(C4) 권장. header case normalize, custom API-key 포함 secret header 집합. TLS bypass(A1/H2) 버림. **open-issues 후보:** auth 제거 후 cross-host body replay를 허용하는지 요구에 미정. 민감 tool input 때문에 전체 cross-origin redirect reject 권장; same host의 scheme/port 변경도 고정해야 한다.
- **R16/R17:** Pi callback/state/iss·single-flight(P4), Codex refresh 재읽기 transaction(C4). OAuth browser는 사람 시작만, background401→failed_auth. DCR 없으면 manual client. token은 platform secret ref/revision, OpenCode plaintext file(O4) 복사 금지. Gemini 자동 browser/serverName-only binding(G1/G4)도 버림.
- **R18:** manager는 공유 가능해도 physical connection key는 `(assignment,server)`만. config 변경 시 generation retire. 연속 run은 idle connection 재사용, login은 승인 근거 아님. Hermes adoption/Gemini identical-config pool(H5/G3)은 버림.
- **R19/R20:** start+initialize30초, 모든 list+validation30초, call60초 hard monotonic deadline. progress로 연장 안 함(P1/O2). 연결만1/2/4초 세 번, dispatch 후 call은 hints와 무관하게 resend0. Hermes read-only replay/SDK401 POST repeat(H4/P4)는 채택하지 않는다.
- **R21:** async cleanup 전 admission 닫기→cancel→close→5초 tree kill. cancel/DELETE/kill은 rollback 아님. OpenClaw uncertain cleanup(A1)·Pi/Codex tree/drain(P2/C3) 참고. waiting_user는 진행 call을 보유하지 않음(§5.5).
- **R22:** C1/A2 staging collector·seen cursor·aggregate budget. duplicate raw name/bad schema 하나도 전체 실패. Gemini bad-tool skip/Hermes partial/Schema silent repair(G2/H3)는 버림. **open-issues 후보:**30초만으로 fast paging 메모리 폭증 못 막음. page/item/aggregate byte/schema depth-node cap 추가 권장. Codex100pages/2048items, OpenClaw128pages/16384items/10MiB는 선택 재료이지 lophn 확정값 아님.
- **R23:** C2처럼 raw routing/callable map 분리. **open-issues 후보:** pair serialization·collision group suffix·축약/정렬 정책 미정. UTF-8 `JSON.stringify([server,tool])` hash, collision group 전체 raw suffix로 순서 무관 권장. sanitize name hash(H3)·순서 숫자(A2) 버림. NUL delimiter면 NUL admission부터 정해야 함.
- **R24:** G3/O3/A3/H4 event plumbing에 `definitionHash(name,description,inputSchema,hints)` diff를 더한다. 바뀐 정의의 old classification/safe 표시/RunBasis를 재사용하지 않음; 새tool 자동선택0. **open-issues 후보:** notification은 삭제 목록이 없는데 즉시 삭제 차단하려면 refresh 중 server catalog stale/blocked 권장. refresh failure old defs 유지(O3)는 callable로 쓰지 않는다.
- **R25:** P3/A4 Apps-off capabilities{} 참고, roots handler도 미등록. reverse -32601, model/question0. instructions/prompts/resources 자동주입0. embedded tool result resource는 data이지 resources/read 권한 추가가 아님.
- **R26–R29:** 사람 원래 tool 분류·최대effect·unknown external/reversible=false, scope/owner contract 없으면 deny, 호출마다 current judgment. hints는 UI/hash data뿐; read-only replay(H4)/server trust(G3)는 승인 근거로 안 씀. classification은 provider repair본 아닌 **원본 정의**에 묶는다. 일반 approval policy는 별도 조사 문서.

## 구현 메모

아래는 **추천 구현**이며 미확정 cap 등은 요구의 숫자와 구별한다.

### 선행 관계·자료 구조

1. `extensions/mcp-auth`: platform secret ref·validated URL/issuer·refresh. discovery가 새 network host를 요구하면 core admission/권한 재기동 경계를 거침(§2.3), 임의 allow-net 확대 금지.
2. `mcp-connections`: owner/generation·dispatch·absolute timer·stdio tree·cleanup. auth 결과만 transport 부착.
3. `mcp-tools`: complete catalog·raw-pair naming·definitionHash·classification compatibility·selection intersection. provider 변환은 원본 hash 후.
4. executor: RunBasis와 **현재** config/owner/catalog/classification을 dispatch 직전 비교. queue 이후에도 재검사(R24/R29).

```ts
// 추천 내부 메모리 구조. 새 persisted entity 제안이 아니다.
type OwnerKey = readonly [assignmentId: string, serverName: string];
type DispatchPhase = 'not_sent' | 'may_have_been_sent' | 'result_received';
type ConnectionRuntime = {
  owner: OwnerKey; configRevision: number; generation: number;
  state: 'disconnected' | 'connecting' | 'connected'
    | 'failed_temporary' | 'failed_auth';
  acceptingCalls: boolean; catalogReady: boolean; retryCount: 0 | 1 | 2 | 3;
  protocolVersion?: string; toolListHash?: string;
  pending: Map<string | number, { phase: DispatchPhase; deadline: number }>;
};
```

catalog은 raw server/tool·callable·originalDefinition·definitionHash를 가진 immutable generation. toolListHash는 전체 검증/naming 성공 뒤만 설정, failed staging discard. domain `schema_hash`가 현재 definitionHash와 같을 때만 사람 classification 유효. selection key는 callable 아닌 raw pair.

**dispatch:** write/fetch 성공은 원격 receipt 증명이 아니다. send 시작 전 may_have_been_sent로 올려 local validation/admission/queue에서 확실히 막힌 경우만 not_executed. send 실패도 일부 bytes가 갔을 수 있어 uncertain. 늦은 result는 timeout을 성공으로 덮지 말고 tool-call 늦은 사실 contract로 넘김(R19/R21·§5.5).

### state/error 표

| 사건 | connection/catalog | call/후속 |
|---|---|---|
| invalid config/executable |해당server disconnected·diagnostic|전송0·다른server/native 유지 R12|
| connect |connecting·catalog false|start+initialize 합산30초|
| tools capability 없음 |connected·검증된 빈catalog|오류없는0개 R22|
| list 완료 |새 immutable generation publish|raw pair/hash/classification 검사|
| repeat/duplicate/bad schema/cap |catalog false·staging discard|partial0·redacted error R22|
| list_changed |즉시catalog false·refresh coalesce|old dispatch0·hash diff R24|
| auth/refresh 실패 |failed_auth·timer 없음|사람reauth·browser/resend0 R16/R20|
| unexpected close |failed_temporary·catalog false|sent uncertain·1/2/4초 새 initialize/list, call resend0|
| 재연결3회 실패 |자동 정지|사람 reconnect/config 수정까지 대기|
| before-send abort/timeout |owner 유지 가능|not_executed·receipt0|
| after-send abort/timeout |cancel best effort|uncertain·replay0|
| detach/disable/종료 |admission false→cancel→close|5초뒤tree kill·rollback 주장0 R21|

monotonic timer(A2), async retry/refresh에 generation capture. retired config의 늦은 refresh/reconnect가 새owner를 되살리면 안 됨. auth/protocol/caller cancel/transient를 generic reconnect catch 하나로 묶지 않는다.

### wire·deadline·validation

```json
{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"original_tool","arguments":{}}}
{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":7,"reason":"owner detached"}}
```

[확인] Pi timeout/abort는 이 cancel을 실제 보냄(P3), initialize에는 금지. notification은 rollback acknowledgement가 아님. unsupported reverse는 같은ID에 error `-32601`(P3). tool isError/application error, JSON-RPC error, HTTP401/auth, transport close를 분리한다. secret/URL query/error 원문을 모델에 그대로 노출하지 않는다.

- connect30초는 spawn/HTTP start/initialize 합산. list30초는 페이지·validation/naming 합산. call60초·server config1000–600000ms, progress 연장0. NaN/Infinity/0/음수/범위밖 config error.
- cursor opaque. 첫 request omitted, 이후 exact. **추가 정책 추천:** omitted/null terminal, empty도 string이면 opaque, invalid type reject. P1/H3 empty terminal과 A2 present 차이 때문에 fixture 필요.
- Schema object 여부만 검증하지 않음. supported draft/object root/local ref를 정하고 remote `$ref` fetch 금지. provider 표현 못 하는 valid schema는 silent repair 대신 명시 adapter 규칙/진단. 원본/변환본 hash 혼합 금지(C1/G2/O2/P1/H3).
- naming raw pair JSON UTF-8 SHA256/8, prefix/suffix 포함64자·native reserved 이름 검사. collision group 전체 suffix로 순서 안정. 잔여 hash collision은 reject, attempt 숫자로 우회 안 함(R23).

### auth·result·stderr 결정할 자리

- config에는 secret ref/revision, child clearEnv 후 해당server secret attachment만. stale refresh가 새 account token 덮지 않도록 credential generation compare-and-save(R14/R17).
- refresh promise는 credential identity/revision별 공유·완료/실패 후 제거. **open-issues 후보 R17/R18:** connection은 assignment별이어도 동일 rotating token은 여러 owner에 제공될 수 있다. single-flight 범위를 secret identity 전체로 넓힐지 platform과 고정. Codex cross-process/Pi instance 차이 C4/P4.
- 사람이 시작 OAuth: cryptographic state·S256·loopback path/issuer/target binding·one-shot·bounded wait. port0(P4)/fixed19876(O4)은 lophn 미정. DCR 없음 manual client. discovery/token/DCR URL도 HTTPS/loopback+validated network destination. auth header를 issuer discovery에 무차별 복사 금지.
-401 refresh와 **POST repeat** 분리. SDK implicit retry wire 검사. pre-refresh→dispatch1회,401 뒤 readOnly라도 resend0이 R20에 직접 맞음(P4/H4).
- **open-issues 후보 R14/R22:** stderr line/ring/log-total·result byte/block/image cap 미정. Pi message16MiB/stderr64KiB(P2), OpenClaw line8KiB/catalog10MiB(A1/A2), Hermes text2Mchars/embedded50MiB(H5)는 서로 다른 층이다.
- 추천 result: receive byte cap→shape→platform redaction/blob→supported content conversion→context budget. resource_link URI 자동fetch0, base64 사전/decoded MIME-size/block-count 제한, text/structured 중복0, omission/truncation 명시. transport가 JSON 읽은 뒤 char truncate는 receive cap 대체 아님(H5).
- stderr 계속 drain·ring/line/rate-total/redaction 각각. newline 없는 pending·invalid UTF8/ANSI·chunk 경계 secret·grandchild pipe까지. MCP stdout과 합치거나 자동 context 삽입0. A1 bounded-line+P2 ring 참고; H2 tail만으로 pending/log는 bounded 아님.

### fake server 테스트

SDK mock만으로 env/redirect/cancel/process-tree를 증명 못 함. Pi 실제 child+HTTP+in-memory(P5), OpenCode SDK HTTP lifecycle(O3), OpenClaw fake-clock collector(A2)를 나눠 참고한다. Gemini SDK mocks는 branch wiring 근거뿐(G4).

| fixture | server 동작 | 관측/assert |
|---|---|---|
| stdio launch |argv/env/cwd control 기록|absolute only·metachar literal·parent/provider/다른server secret 없음·server 지정만 R14|
| initialize |start/initialize hang·wrong version·tools 없음|합산30초·cleanup·tools0 R19/R22|
| pages |2pages·empty/null/bad/repeat/cycle·fast endless|합산30초·complete 전노출0·cap 전체0·cursor exact R22|
| bad catalog |page2 duplicate·bad description/schema·remote ref|page1도노출0·ref fetch0·다른server 유지|
| naming |same-tool/different-server·punctuation·Unicode·긴prefix·native/hash collision|regex64·raw dispatch·order stable·remaining reject R23|
| mutation |queue 중 notify·설명/schema/hints 변경·삭제·refresh fail|stale 전송0·classification 무효·자동선택0 R24/R31|
| disconnect |call receipt 직후close·새initialize fail|receipt1·delay1/2/4·3회만·uncertain R20|
| cancel |detach·cancel 무시·late result/sideeffect|cancel requestId·새call0·5초 treekill·rollback 주장0 R21|
| HTTP |JSON/SSE·GET405·session ID/Last-Event-ID|legacy endpoint0·resume와 callPOST 횟수 분리 R13/R20|
| auth/TLS |401/403·badcert·remoteHTTP·cross-origin307·caseAPIkey|failed_auth/no retry·bypass0·header/body 경계·POSTrepeat0|
| OAuth |noDCR·badstate/iss·portcollision·동시expiry·URL/account 변경|manualclient·token save0·refresh1·oldsecret0 R16/R17|
| ownership |연속run·다른assignment·한쪽종료|child reuse1·physical connection2·다른owner 영향0 R18|
| reverse |sampling/elicitation/roots·instructions|unsupported·model/question/file/network0·자동주입0 R25|
| bounds |JSON/SSE/base64/structured/duplicate/stderrflood|receive/model/log 별도·decode 전차단·bounded memory/drain|

counter는 initialize/list/call receipt·refresh·legacy hit·cancel·live child/descendant. secret 값 대신 sentinel 존재·redacted fingerprint만 assert. retry/timeouts는 fake monotonic scheduler, OS kill/socket boundary는 짧은 test budget으로 실제 확인. -32601·tool isError·HTTP401/403·transport close·local abort를 별개 case로 둔다.

### 미확인 요약

Codex 상위 manager sharing/reconnect/list_changed·normal cancel·OAuth 전체(C4), Gemini collision/refresh binding/cancel delivery(G2/G4), OpenCode SDK default/PKCE/TLS·refresh scope(O2/O4), Pi host naming/approval/pool·redirect body(P3/P4), OpenClaw 모든 lease physical pooling/replay·OAuth store/SDK cap(A1/A3/A4), Hermes OAuth/kill grace/trust 최종판(H5)을 끝까지 확인하지 못했다. 부재로 단정하지 않으며 특정 SDK를 재사용할 때 다시 검증할 자리다. lophn의 경계는 wrapper와 wire fixture로 요구대로 고정한다.
