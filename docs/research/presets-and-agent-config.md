---
type: research
concerns: [lophn-agent/agents, lophn-agent/assignments, lophn-agent/roles]
---
# preset과 agent 구성

## 질문

agent 구성(이름, prompt, model·추론 수준, tool, 권한, MCP·skill, 읽을 자료)을 어디에 어떤 형식으로 저장하고, 기본 agent와 사람 정의를 어떻게 합치며, 잘못된 구성과 권한 확대·실행 중 변경을 어떻게 다루나. 역할 prompt는 어떤 문장으로 맡는 일과 맡지 않는 일·출력 형식을 고정하나.

## 프로젝트별

### OpenCode (907b3bc518fa)

구성은 코드에 심은 기본 agent와 사용자 설정·markdown 파일을 한 map으로 합친 결과다. 판(revision)은 없다.

- 기본 agent는 `build`, `plan`(mode `primary`), `general`, `explore`(mode `subagent`), 숨은 `compaction`·`title`·`summary`다. 근거: `opencode:packages/opencode/src/agent/agent.ts` `agents` 객체(140–265행). `build`만 prompt가 없고 권한만 있다. `explore`만 `PROMPT_EXPLORE`를 붙인다.
- 항목은 `Info` 한 구조다. `name`, `description`, `mode`(subagent/primary/all), `model{providerID,modelID}`, `variant`, `prompt`, `temperature`, `topP`, `steps`, `color`, `permission`, `options`, `hidden`, `native`. 근거: 같은 파일 `Info`(35–55행). tool 목록 필드가 아니라 permission rule이다. 옛 `tools: {이름: bool}`은 읽고 `permission`으로 옮긴 뒤 폐기 표시. 근거: `opencode:packages/core/src/v1/config/agent.ts` `normalize`(62–81행).
- permission rule은 `{permission, pattern, action}`이고 action은 allow/ask/deny다. 평가는 뒤에서부터 첫 매치(`findLast`)다. 근거: `opencode:packages/opencode/src/permission/index.ts` `merge`(200행), `disabled`(204–214행). 기본 권한은 `*` allow, `doom_loop` ask, `external_directory`의 `*` ask, `question`·`plan_enter`·`plan_exit` deny, `read`의 `*.env`·`*.env.*` ask. 근거: `agent.ts` `defaults`(119–136행).
- 합치는 순서: 기본 권한 → 그 agent의 내장 권한 → 전역 `permission` → agent별 `permission`. 사용자 rule이 뒤에 붙으므로 내장 deny를 사용자 allow이 이긴다. `plan`의 `edit: deny`도 같다. 근거: `agent.ts` 145–152행, 267–294행. 예외로 truncate glob allow은 정확한 deny pattern이 없으면 다시 붙인다(296–310행).
- 저장은 두 길이다. 설정 `agent` 맵, 그리고 `{agent,agents}/**/*.md`·`{mode,modes}/*.md`의 frontmatter + 본문. 본문 trim이 `prompt`가 된다. mode 파일은 `mode: primary`로 고정. 근거: `opencode:packages/opencode/src/config/agent.ts` `load`(11–31행), `loadMode`(34–58행). 디렉터리별 결과는 `mergeDeep`로 합쳐 나중 것이 이긴다. 근거: `opencode:packages/opencode/src/config/config.ts` 474–475행. 같은 이름의 기본 agent는 필드별 `??`로 덮고(`disable: true`면 삭제), 없는 이름은 mode `all`로 새로 만든다. 근거: `agent.ts` 267–294행.
- 이름 검증이 없다. 파일 경로에서 확장자를 뺀 문자열이 그대로 키다. 근거: `opencode:packages/opencode/src/config/entry-name.ts` `configEntryNameFromPath`. markdown 파싱 실패는 `catch`로 그 파일만 건너뛴다(`agent.ts` `load` 19행). 스키마 디코드 실패는 mode 로더만 그 파일을 빼고(`loadMode` 50–57행), agent 로더는 `ConfigParse.schema`에 맡긴다. 일부 실패가 전체를 거절하지 않는다.
- 기본 agent 이름은 `default_agent` 설정, 없으면 보이는 첫 primary. subagent나 hidden을 기본으로 지정하면 throw. 근거: `agent.ts` `defaultInfo`(328–339행). `get`은 없으면 `undefined`를 돌려준다(312–314행).
- 구성이 바뀌면 instance state를 다시 만들 때 반영된다. 진행 중 세션이 옛 구성을 유지하는지는 [미확인].
- prompt 길이: `explore.txt` 18줄(파일 검색 전문가, Glob/Grep/Read 사용 지침, "do not create files"), `compaction.txt` 5줄("Do not continue the conversation", 요청한 구조 그대로, 대화와 같은 언어), `summary.txt` 11줄, `title.txt` 44줄. 근거: `opencode:packages/opencode/src/agent/prompt/`. 역할 prompt를 사람이 고친 뒤의 적용은 설정 재로드 때다.

### Codex (3a69ec3ef8fb)

agent 구성은 세션 config의 한 층이고, 역할(role)은 그 위를 덮는 제한된 override다. 역할 파일 자체는 판이 없다.

- 역할 메타는 `description`, `config_file`, `nickname_candidates` 셋뿐이다. 근거: `codex:codex-rs/agent-roles/src/agent_role_config.rs` `AgentRoleConfig`(10–18행). 역할 파일은 TOML이고 `name`·`description`·`nickname_candidates`를 뺀 나머지를 `ConfigToml`로 통째 파싱한다(`deny_unknown_fields`). 근거: 같은 파일 `RawAgentRoleFileToml`(20–28행), `parse_agent_role_file_contents`(38–118행).
- 검증: `name` trim 뒤 비면 거절, `description` 빈 문자열 거절, `developer_instructions`는 힌트 없는 파일에서 필수·빈 문자열 거절, nickname은 1개 이상·trim·중복 거절·ASCII 영숫자와 공백·`-`·`_`만. 근거: 같은 파일 120–208행. 이름 대소문자는 접는다 [미확인]. 키는 문자열 그대로다.
- 로딩: config 층을 낮은 쪽에서 높은 쪽으로 보며, 층 안의 `[agents.roles]` 선언과 `<config>/agents/**/*.toml` 탐색을 합친다. 같은 층에서 이름 중복은 경고 후 그 역할을 건너뛴다(먼저 것이 남음). 잘못된 파일도 경고 후 건너뛰고 나머지는 로드한다. 근거: `codex:codex-rs/agent-roles/src/loader.rs` `load_agent_roles`(23–117행), `push_agent_role_warning`(119–123행). 높은 층이 같은 이름을 만나면 비어 있는 필드만 낮은 층 값으로 채운다(`merge_missing_role_fields`, 166–173행). 전체 거절이 아니다.
- 적용은 spawn 때다. 역할 파일이 담을 수 있는 config 필드 가운데 실제로 자식에게 복사하는 것은 `developer_instructions`, `model`, `model_reasoning_effort`, `model_reasoning_summary`, `model_verbosity`, `personality`, `service_tier`와 일부 feature·skill뿐이다. 근거: `codex:codex-rs/core/src/agent/role.rs` `AgentRoleOverrides`(36–48행), `apply_role_to_config_inner`(69–128행). `sandbox_mode` 같은 나머지 필드는 파싱만 되고 override에 안 실린다.
- feature는 끄는 방향만 복사한다. `ShellTool`·`Apps`·`Plugins`·`MemoryTool`·`RequestPermissionsTool`이 `false`일 때만 반영하고, `true`는 버린다(91–104행). skill도 `enabled = false`인 항목만 남긴다(106–117행). 주석: "Roles may customize the child or reduce its capabilities, but never replace the parent session's authority." 다만 managed requirement가 `plugins = true`를 요구하면 역할의 `plugins = false`가 진다. 근거: `codex:codex-rs/core/src/agent/role_tests.rs` `apply_role_disables_plugins_unless_required_by_managed_policy`.
- 내장 역할은 `default`(config 파일 없음, "Default agent."), `explorer`, `worker`다. `awaiter`는 주석으로 빠져 있다. 근거: `role.rs` `built_in::configs`(343–403행). `explorer` 설명은 "fast and authoritative", 같은 문제를 다시 탐색하지 말 것, 독립 질문은 병렬로, 결과는 검증 없이 신뢰해도 된다는 규칙이다. `explorer`의 내장 TOML 파일은 이 revision에서 0바이트다(`codex:codex-rs/core/assets/agent/builtins/explorer.toml`). `worker` 설명은 파일·모듈 소유를 명시하고, 다른 worker의 수정을 되돌리지 말 것을 요구한다. `awaiter.toml`(1213바이트)은 "You must NOT: Modify the task / Interpret or optimize / Perform unrelated actions"와 종료 조건 셋을 적는다.
- 생략한 spawn은 `default` 역할을 쓴다. 근거: `role.rs` `DEFAULT_ROLE_NAME`(33행), `apply_role_to_config`(55행). 모르는 역할 이름은 `unknown agent_type`로 거절한다(57–59행). 적용 실패는 내용을 숨기고 "agent type is currently not available"로 바꾼다(63–66행).
- 동시 자식 수는 `agents.max_concurrent_threads_per_session`(미설정 시 backend 기본), 중첩은 `max_depth`(V1만, V2는 무시). 자식 기본 model·reasoning effort는 `default_subagent_model`, `default_subagent_reasoning_effort`. 근거: `codex:codex-rs/config/src/config_toml.rs` `AgentsToml`(753–774행). 전 이력 fork는 부모 model·reasoning을 물려받고 override를 거절한다. 근거: `codex:codex-rs/prompts/src/multi_agent_instructions.rs` `DEFAULT_MULTI_AGENT_V2_MODEL_OVERRIDE_USAGE_HINT_TEXT`.
- 세션 profile은 역할과 별개다. `profiles` 맵의 `ConfigProfile`이 model·provider·approval·sandbox·reasoning effort·verbosity·instructions 파일을 묶고, `profile` 키가 하나를 고른다. 근거: `codex:codex-rs/config/src/profile_toml.rs` `ConfigProfile`(24–54행), `config_toml.rs` 358–363행.
- 리뷰 prompt는 "override these general instructions", 버그 조건 8개, 코멘트는 1문단·코드 3줄 이하·아부 금지. 근거: `codex:codex-rs/prompts/templates/review/rubric.md`. 권한 prompt는 sandbox 모드별 파일(`read_only.md`: "only permits reading files"). 진행 중 thread에 역할 변경이 닿는지는 [미확인]. spawn·reload가 같은 정책 경로를 쓴다는 주석만 확인. 근거: `codex:codex-rs/core/src/agent/child_config.rs` 파일 머리 주석.

### Gemini CLI (fb972b2f87fe)

agent는 markdown 파일 하나 = 정의 하나다. 내장 agent와 디렉터리 agent를 registry가 이름으로 모은다.

- 로컬 정의 필드: `name`, `description`, `promptConfig{systemPrompt,initialMessages,query}`, `modelConfig`, `runConfig{maxTurns,maxTimeMinutes}`, `toolConfig.tools`(문자열·선언·도구 객체 배열), `mcpServers`, `workspaceDirectories`, `memoryInboxAccess`, `autoMemoryExtractionWriteAccess`, `includeExtensionContext`. 근거: `gemini-cli:packages/core/src/agents/types.ts` `LocalAgentDefinition`(214–285행), `PromptConfig`(315–332행), `RunConfig`(373–384행). 원격 agent는 `agent_card_url` 또는 `agent_card_json` 둘 중 하나. 근거: `agentLoader.ts` `remoteAgentSchema`(208–246행).
- markdown frontmatter는 strict 객체다. `name`은 `^[a-z0-9-_]+$`, `description` 1자 이상, `tools`는 개별 이름(wildcard 허용: `*`, `mcp_*`), `model`, `temperature`, `max_turns`(양의 정수), `timeout_mins`(양의 정수), `mcp_servers`. 알 수 없는 키는 거절. 본문이 `system_prompt`가 된다. 근거: `agentLoader.ts` `nameSchema`(50–52행), `localAgentSchema`(92–116행), `markdownToAgentDefinition`(497–630행). wildcard 허용 근거: `gemini-cli:packages/core/src/tools/tool-names.test.ts` 87–89행.
- 기본값: model 생략은 `inherit`(실행 시 부모 세션 model), `temperature` 1, `topP` 0.95, `max_turns` 30, `timeout_mins` 10. 근거: `agentLoader.ts` 546–619행, `types.ts` `DEFAULT_MAX_TURNS`(51행), `DEFAULT_MAX_TIME_MINUTES`(56행).
- 로딩은 디렉터리의 `.md`만, `_`로 시작하는 파일은 제외. 파일 하나는 sha256을 metadata에 남긴다. 파싱 실패는 그 파일만 `errors`에 쌓고 나머지는 등록한다. 근거: `agentLoader.ts` `loadAgentsFromDirectory`(640–697행). 같은 이름 재등록은 경고 후 무시(먼저 것이 이김). 근거: `gemini-cli:packages/core/src/agents/registry.ts` `registerAgent`(339–354행). 이름·description이 없으면 debug 로그만 남기고 건너뛴다(378–384행).
- 설정 override는 `agents.overrides[이름]`에 `enabled`, `modelConfig`, `runConfig`, `tools`, `mcpServers`를 둔다. `tools`를 주면 정의의 tool 목록 전체를 교체한다. mcp 서버는 병합. 근거: `registry.ts` `applyOverrides`(599–670행), `gemini-cli:packages/core/src/config/config.ts` `AgentOverride`(295–301행). 이 설정 블록은 `requiresRestart: true`다. 근거: `gemini-cli:packages/cli/src/config/settingsSchema.ts` `agents`(1252–1268행). `registry.reload()`는 정의 파일을 다시 읽어 추가·변경·삭제를 집계한다(`AgentReloadSummary`, `types.ts` 389–397행). 이미 돌아 중인 호출이 옛 정의를 유지하는지는 [미확인].
- 내장 agent: `generalist`(모든 tool, model `inherit`), `codebase_investigator`, `cli_help`. 근거: `gemini-cli:packages/core/src/agents/generalist-agent.ts` 19–59행. subagent 호출 자체는 정책에서 허용(priority 50, default·autoEdit·yolo). 근거: `gemini-cli:packages/core/src/policy/policies/agents.toml`. 주석: "Subagents are trusted to handle their own confirmations." 제품 상한을 정의 밖에서 강제하는 코드는 못 찾았다 [미확인].
- workspace 추가 디렉터리에서 filesystem root(`/`, `C:\`)는 실행 때 거절한다. 근거: `types.ts` `workspaceDirectories` 주석(227–236행).

### OpenClaw (37efa0b4a644)

agent는 config의 entry고, 채널·peer에 binding으로 붙는다. 역할 prompt 파일이 아니라 workspace의 bootstrap 파일(AGENTS.md, SOUL.md)이 지시다.

- entry 필드: `id`, `name`, `description`, `workspace`, `cwd`, `agentDir`, `model`, `utilityModel`, `decisionModel`, `models`, `modelPolicy`, `thinkingDefault`, `reasoningDefault`, `fastModeDefault`, `skills`, `subagents{allowAgents,maxConcurrent,model,thinking,requireAgentId}`, `runtime`(embedded 또는 acp), `params`. 근거: `openclaw:src/config/zod-schema.agent-entry-base.ts` `AgentEntryBaseSchema`(94–134행). 기본값 층은 여기에 compaction·contextPruning·bootstrapMaxChars·userTimezone·timeoutSeconds·maxConcurrent를 더한다. 근거: `openclaw:src/config/zod-schema.agent-defaults-base.ts` `AgentDefaultsBaseSchema`(51–276행).
- subagent 기본 상한: 세션당 동시 8, 중첩 1–5(기본 5), agent당 자식 1–20(기본 5). 근거: 같은 파일 `subagents`(238–274행).
- id는 trim 후 소문자. `^[a-z0-9][a-z0-9_-]{0,63}$`에 안 맞으면 그 밖 문자를 `-`로 바꾸고 앞뒤 `-`를 지운 뒤 64자에 자른다. 결과가 비면 `"main"`으로 떨어진다. 거절이 아니라 강제 변환이라 서로 다른 입력이 한 id로 모일 수 있다. 근거: `openclaw:packages/normalization-core/src/agent-id.ts` `normalizeAgentId`(9–30행).
- tool은 agent 필드가 아니라 tools 정책이다. `{allow, alsoAllow, deny}`, exact 이름, deny가 이긴다. allow와 alsoAllow를 같이 쓰면 거절. 근거: `openclaw:src/config/zod-schema.agent-runtime.ts` `ToolPolicyBaseSchema`(120–135행). 정책 안에 제품이 고정한 상한 목록은 없다. 사용자 allow가 곧 허용 범위다.
- 배정은 binding이다. `type: route`(생략 가능) + `agentId` + `match{channel, accountId, peer{kind,id}, guildId, teamId, roles}`. accountId 생략은 채널 기본 계정만, `"*"`는 모든 계정. ACP binding은 `mode: persistent|oneshot`. 근거: `openclaw:src/config/zod-schema.agents.ts` `BindingMatchSchema`(90–108행), `RouteBindingSchema`(117–124행), `AcpBindingSchema`(126–140행). 한 agent의 binding 개수 상한은 [미확인].
- heartbeat는 agent 설정이다. `every`(기간 문자열, 기본 단위 분), `activeHours{start,end,timezone}`(HH:MM, 24:00은 end만), `model`, `session`, `prompt`, `timeoutSeconds`, `lightContext`, `isolatedSession`. 기본 간격 `30m`, ack 최대 300자. 근거: `openclaw:src/config/zod-schema.agent-runtime.ts` `HeartbeatSchema`(43–104행), `openclaw:src/auto-reply/heartbeat.ts` `DEFAULT_HEARTBEAT_EVERY`(26행). scratch가 헤더·빈 목록·펜스만이면 model을 부르지 않는다. scratch 파일이 없으면 비어 있다고 보지 않아 model이 판단한다. 근거: `heartbeat.ts` `isHeartbeatContentEffectivelyEmpty`(49–80행).
- 구성 변경이 진행 중 run에 적용되는 시점은 [미확인]. cron job은 정의 hash를 따로 계산하지만(아래 scheduling 문서) agent entry에는 판이 없다.

### Hermes (343500b3547e)

agent "구성"은 profile 디렉터리와 그 안의 파일이다. prompt 본문은 `SOUL.md`, 말투는 personality, 색·문구는 skin이다. 셋 다 판이 없다.

- profile 이름은 trim 후 소문자, `default`는 대소문자 무시로 예약 alias. 형식 `^[a-z0-9][a-z0-9_-]{0,63}$`, 예약어 `hermes`·`default`·`test`·`tmp`·`root`·`sudo` 거절, 문자열이 아니면 throw(숫자 id가 `profiles/0`이 되는 사고 방지). 근거: `hermes-agent:hermes_cli/profiles.py` `normalize_profile_name`(358–384행), `validate_profile_name`(386–404행), `hermes-agent:hermes_constants.py` `PROFILE_ID_RE`(320행).
- `SOUL.md`는 `~/.hermes/SOUL.md`를 context로 넣는다. 사용자 본인 파일은 prompt injection 패턴이 맞아도 `flagged`로 로드하고, 그 외 출처는 `blocked`로 뺀다. 근거: `hermes-agent:agent/context_file_sources.py` 6행, 54–56행, 90–95행.
- personality는 이름 → 한 줄 prompt다. 내장 14종(`helpful`·`concise`·`technical` 등)과 설정 추가분이 합쳐지고, 활성 선택은 `display.personality`에 있다. 근거: `hermes-agent:hermes_cli/personality.py` `BUILTIN_PERSONALITIES`(19–34행), `resolve_personality`(100행). skin은 색·spinner·문구만 바꾸고 prompt 내용과 무관하다. 근거: `hermes-agent:hermes_cli/skin_engine.py` `_branding`(44–49행).
- 권한·tool·model을 한 단위로 고정하는 구조는 못 찾았다 [미확인]. cron job은 `enabled_toolsets`를 따로 가진다(`cron/job_definition.py` 16행).

### Pi (83692682f095)

설정 파일 두 층(전역, project)이지 agent 정의 파일이 아니다.

- `Settings`에 `defaultProvider`, `defaultModel`, `defaultThinkingLevel`(`off|minimal|low|medium|high|xhigh|max`, 문서 기본 `medium`), `modelThinkingLevels`(키 `provider/modelId`), `defaultTools`, `skills`, `extensions`, `prompts`가 있다. 근거: `pi:packages/coding-agent/src/core/settings-manager.ts` `Settings`(133–214행), `pi:packages/coding-agent/docs/settings.md`.
- tool 기본은 `read`·`bash`·`edit`·`write`. `defaultTools`가 평범한 이름이면 그 목록으로 교체, `+name`·`-name`만 있으면 상속 목록에 가감. 빈 배열은 내장 tool 전부 해제(extension·SDK tool은 남음). 잘못된 값이면 throw 대신 교체. 근거: 같은 파일 `DEFAULT_TOOL_NAMES`(216행), `mergeDefaultTools`(222–230행).
- 층 병합은 deep merge, project가 전역을 덮는다. `reload()`는 두 파일을 다시 읽어 합친다. 진행 중 세션이 재로드 값을 바로 쓰는지는 [미확인]. 근거: `settings-manager.ts` `reload`(607–635행).
- durable subagent는 자기 prompt가 없다. 호출마다 자식 세션을 만들고 부모와 같은 agent로 시작한 뒤 subagent extension만 빼서 재위임을 막는다. 근거: `pi:packages/coding-agent/src/experimental/durable/subagent.ts` `Subagent`(26–55행). crash 뒤 rerun은 같은 자식을 찾는다(`replay: "safe"`).
- 역할별 맡는 일·맡지 않는 일을 적는 내장 prompt는 coding-agent 쪽에 없고, 예시 extension의 한 줄 지시에 그친다. 근거: `pi:packages/coding-agent/src/experimental/vacation/vacation.ts` 122–138행("Hand all research to the research tool").

### Claude Code (1c229fcd1e1e, plugin 예시 근거)

`plugins/<name>/agents/*.md`는 frontmatter `name`·`description`·`model`·`color`와 markdown 본문이다. 본문은 Review Scope, Core Review Responsibilities, Issue Confidence Scoring(0–100, 80 미만 보고 금지), Output Format으로 나뉜다. `description` 안에 `<example>`로 언제 호출할지 적는다. 길이 47–130줄. 근거: `claude-code:plugins/pr-review-toolkit/agents/code-reviewer.md`. 실행 코드가 없어 검증·병합·적용 시점은 확인 못 함.

## 비교

| 항목 | lophn | OpenCode | Codex | Gemini CLI | OpenClaw | Hermes | Pi |
|---|---|---|---|---|---|---|---|
| 구성 단위 | Preset 판(immutable blob) | 이름 → Info map | 세션 config + role override | markdown agent 정의 | config agent entry | profile 디렉터리 | settings 두 층 |
| 판 | revision 증가, 과거 판 유지 | 없음 | 없음 | 파일 sha256 metadata만 | 없음 | 없음 | 없음 |
| 이름 중복 | trim·대소문자 무시 후 거절, 기본 preset과 충돌 거절 | 키가 같으면 덮어씀 | 같은 층 중복은 경고 후 건너뜀 | 경고 후 먼저 것 유지 | id 강제 변환, 충돌 거절 없음 | profile 이름 소문자·예약어 거절 | 해당 없음 |
| 잘못된 구성 | 전체 거절 | 파일 하나씩 건너뜀 | 역할 하나씩 경고 후 건너뜀 | 파일 하나씩 errors에 쌓음 | zod 실패면 그 설정 거절 | profile 이름 거절 | 잘못된 값은 교체 |
| 기본 → 사람 정의 | 기본은 seed, 사람 것은 새 user preset | 같은 이름이면 필드 덮어쓰기, `disable`로 삭제 | 역할 파일이 부모 config를 제한 덮어쓰기 | settings override가 model·tools 교체 | defaults 위 entry | profile이 기본 home을 대체 | project가 전역을 덮음 |
| tool 표현 | 묶음을 저장 시점에 개별 동작으로 펼쳐 고정 | permission rule(pattern, 마지막 매치) | feature on/off, skill enabled=false만 | 이름 배열, wildcard 허용, override가 전체 교체 | allow/deny exact 이름, deny 우선 | cron의 enabled_toolsets | `+name`/`-name` 가감 |
| 사람이 상한을 넓히나 | 못 함(저장 거절) | 함. 사용자 rule이 내장 deny를 이김 | 못 함. `true` feature는 버리고 `false`만 반영. managed requirement는 예외로 다시 켬 | tool override로 목록 전체를 바꿀 수 있음 | allow 목록 자체가 상한. 제품 고정 목록 없음 | [미확인] | tool 목록을 통째로 바꿀 수 있음 |
| prompt가 권한을 넓히나 | 못 함 | permission과 prompt가 분리. prompt로 못 바꿈 | developer_instructions는 텍스트. 권한은 config 층 | system_prompt와 tools가 분리 | bootstrap 파일과 tools 정책 분리 | SOUL.md는 텍스트. injection 패턴이어도 사용자 파일은 로드 | 해당 없음 |
| 변경의 적용 시점 | 다음 run, 진행 run은 옛 판, 권한 축소는 즉시 | instance 재생성 때. 진행 세션은 [미확인] | 다음 spawn·reload. 진행 turn은 [미확인] | 설정은 requiresRestart. reload()는 정의 재로딩 | [미확인] | 파일 다시 읽기. 시점 [미확인] | `reload()`가 메모리 설정 교체. 진행 세션 [미확인] |
| 배정 | assignment가 preset 판 1개 + scope, 역할별 개수 제한 | 없음. 세션이 agent 이름 하나를 고름 | spawn이 role 하나. 동시 thread 상한 | invoke가 agent 이름 하나 | binding(channel·account·peer) → agentId | profile 단위 | 없음 |
| 반복 실패 멈춤 | 실제 시작 run 실패 3회 연속, 사람 재개만 | 없음 | 없음 | maxTurns 30·maxTime 10분으로 한 번 종료 | cron 쪽(scheduling 문서) | cron 쪽 | 없음 |

## lophn에 가져올 것과 버릴 것

- **presets R7, R11.** 가져올 것: Gemini의 strict frontmatter(모르는 키 거절)와 Codex의 "역할 파일 파싱 실패는 그 역할만" 구분. 버릴 것: 둘 다의 부분 적용. lophn은 한 항목이라도 잘못되면 전체 판을 거절해야 한다(R11). 파일 하나씩 건너뛰는 방식은 일부만 바뀐 구성을 남긴다.
- **presets R3.** 가져올 것: Hermes·OpenClaw의 trim + 소문자 정규화. 버릴 것: OpenClaw의 강제 변환(`"main"`으로 떨어짐, 잘못된 문자를 `-`로 바꿈). 서로 다른 이름이 한 id가 된다. lophn은 중복을 거절한다.
- **presets R8.** 가져올 것: Codex의 방향. 역할 config는 부모 권한에서 빼기만 한다(`role.rs`가 `true` feature를 버린다). 버릴 것: OpenCode의 뒤에 붙이는 rule. 사용자 allow이 내장 deny를 이긴다. lophn은 넓히면 저장 자체가 실패해야 하고, Codex처럼 조용히 버리는 것도 안 된다. 사람이 적은 허용이 적용 안 됐는데 저장된 것처럼 보이면 안 된다.
- **presets R8, roles/common R5.** 가져올 것 없음. Gemini는 tool 이름에 `*`, `mcp_*` wildcard를 허용하고 settings `tools` override가 목록을 통째로 바꾼다. lophn의 MCP 선택은 정확한 `(server, tool)` 쌍만, wildcard 없음.
- **presets R12, R14.** 어느 프로젝트도 preset 판을 저장하지 않는다. "다음 실행부터"는 Codex spawn 시점 적용이 가장 가깝다. 진행 중 세션을 즉시 바꾸는 곳은 확인 못 했다. 권한 축소 즉시 적용(lophn 정책)의 선례는 못 찾았다. open-issues 후보 아님. 선례가 없을 뿐 요구와 충돌하지 않는다.
- **presets R4, roles.** 가져올 prompt 패턴: Codex `awaiter.toml`의 "You must NOT" 목록과 종료 조건, `explorer` 설명의 "reuse, don't re-explore", 리뷰 rubric의 보고 기준(무엇을 버그로 볼지, 코멘트 길이·톤), OpenCode compaction의 "대화를 이어가지 마라, 요청한 구조 그대로, 같은 언어", Claude Code plugin의 Scope / Responsibilities / Output Format 구분과 description 속 `<example>`. 버릴 것: OpenCode `generate.txt`의 persona 설계 지시("elite AI agent architect"). lophn prompt는 사람이 읽는 책임 글이지 생성 메타-prompt가 아니다.
- **assignments R2, R10.** 배정 개수 상한은 OpenClaw binding, Codex `max_concurrent_threads_per_session`·`max_depth`에만 있고 책임 단위 개수 제한은 없다. lophn의 역할별 1개(Operator만 N)와 비교할 직접 선례가 없다. 반복 실패 자동 멈춤은 agent 구성이 아니라 cron 쪽이다(scheduling 문서).
- **assignments R17.** 새 판이 사용 중 배정을 옮기지 않는 구조는 어디에도 없다. OpenCode·Gemini는 같은 이름을 덮어 다음 로딩부터 새 값이 된다. lophn이 assignment에 preset revision을 박아 두는 이유가 여기 있다.

## 구현 메모

- Preset 저장 검증 순서 제안: trim → 이름 중복(대소문자 무시, 기본 preset 이름 포함) → prompt 비어 있음 → capability 묶음을 그 시점 개별 tool로 펼침 → 펼친 결과가 역할 상한 안인지 → MCP·skill 이름 실재·중복·wildcard 없음 → model·계정 실재. 하나라도 실패면 판 blob을 쓰지 않는다. Codex·Gemini처럼 경고 후 부분 저장을 하지 말 것.
- 권한 병합을 "뒤에 온 rule이 이긴다"로 구현하지 말 것. OpenCode `findLast`가 그 함정이다. 상한은 입력에서 빼는 게 아니라, 상한 밖 항목이 있으면 그 저장을 `forbidden`으로 거절해야 한다.
- tool 이름 비교는 exact. Gemini `isValidToolName(val, { allowWildcards: true })`를 가져오지 말 것.
- 이름 정규화는 Hermes `normalize_profile_name`(trim, casefold, 빈 값 throw)을 따르고 OpenClaw `normalizeAgentId`(잘못된 문자 치환, 실패 시 `"main"`)은 따르지 말 것.
- 기본 prompt에 넣을 문장 뼈대: 맡는 일 한 단락, "하지 않는 일" 목록, 끝내는 조건, 출력은 어떤 섹션을 어떤 길이로. 숫자 상한(질문 12개, term 30개 등)은 prompt가 아니라 제품 고정 값으로 남긴다(domain model 표).
- 테스트 경계: 공백만 이름, 기본 preset과 대소문자만 다른 이름, 유효 prompt + 상한 밖 tool 하나(아무것도 안 바뀌어야 함), 묶음에 tool이 추가된 뒤 옛 판의 tool 목록 불변, 사용자 prompt에 "shell을 써도 된다"가 있어도 tool 목록 불변, 새 판 저장 뒤 기존 assignment의 preset_revision 불변, 진행 중 run의 기준 판 불변.
- 적용 시점 테스트: assignment가 판 N을 보고 있는 동안 preset을 N+1로 저장하고, 그 사이 시작한 run과 다음 run이 서로 다른 판을 쓰는지. 비교 대상이 다른 프로젝트에 없어 fixture로 직접 만들어야 한다.

확인 못 한 것: OpenCode·Pi의 설정 재로드가 이미 돌아 중인 세션 안 구성에 즉시 닿는지, Codex 역할 이름의 대소문자 처리, Gemini 실행 중 호출이 reload 이전 정의를 유지하는지, OpenClaw agent entry 변경의 적용 시점, Hermes에서 tool 상한을 사용자 설정이 넓힐 수 있는지.
