# Agent definition 조사: Claude Code, OpenAI Codex CLI

- 조사일: 2026-10-15
- Claude Code: v2.1.299 (사람이 캡처한 실제 API 요청, `/home/pyosechang/projects/lophn/project-docs/tmp/claude-code-prompt-assembly copy.md`, 아래 "캡처") + 공식 문서(code.claude.com/docs/en/ 의 sub-agents, skills, memory, commands, tools-reference, permission-modes, hooks, mcp, context-window). source는 보지 않았다. 캡처의 식별자(device_id, account_uuid, session_id, email)는 옮기지 않았다.
- Codex: `github.com/openai/codex` main, commit `76ed3b4` (2026-10-14), `codex-rs/` 읽기만 함. 경로는 모두 `codex-rs/` 기준. 문서 3개(`docs/agents_md.md`, `slash_commands.md`, `skills.md`)는 외부 URL(developers.openai.com) 링크 한 줄뿐이라 source를 근거로 삼았다.
- 확인 못한 것은 "확인 못함"으로 적었다. Codex의 여러 기능은 feature flag로 켜고 꺼서 "기본값"을 모두 확인하지는 못했다.

---

## 1. Claude Code

### 1.1 공통 tools

- 캡처 기준 tools[] 24개, 전부 `name` + `description` + `input_schema`(JSON Schema 2020-12, `additionalProperties:false`)를 요청에 inline으로 보낸다: Agent, Bash, CronCreate/Delete/List, DesignSync, Edit, EnterWorktree, ExitWorktree, ListAgents, Monitor, NotebookEdit, PushNotification, Read, RemoteTrigger, ReportFindings, ScheduleWakeup, SendMessage, Skill, TaskStop, WebFetch, WebSearch, Workflow, Write (캡처 §6). MCP 구성에 따라 늘어난다(별도 캡처에서 `mcp__claude_ai_Claude_Docs__*` 8개가 붙어 32개). 즉 tools[]는 환경에 따라 변하는 집합이다.
- 공식 문서의 전체 목록은 더 길다: Glob, Grep(macOS/Linux/WSL에선 기본 빠짐), LSP, PowerShell, AskUserQuestion, EnterPlanMode, ExitPlanMode, TaskCreate/Get/List/Update, TodoWrite, ToolSearch, WaitForMcpServers, ListMcpResourcesTool, ReadMcpResourceTool, SendUserFile, Artifact 등 (tools-reference). 이름은 permission rule, subagent tool 목록, hook matcher에 그대로 쓰는 문자열이다.
- 이름: PascalCase 단어 하나(`Read`, `Bash`). MCP tool은 `mcp__<server>__<tool>`, plugin 번들 서버는 `mcp__plugin_<plugin>_<server>__<tool>` (mcp 문서). subagent tool 목록에서 `mcp__<server>` 또는 `mcp__<server>__*`로 서버 단위 지정.
- 입력 schema: 평평한 object. 필수는 최소로(`Read`는 `file_path`만, `Bash`는 `command`만). `Edit`은 `file_path, old_string, new_string, replace_all`. optional로 `timeout`, `run_in_background`, `description`(사람에게 보이는 짧은 설명) 같은 harness 제어 인자를 둔다 (캡처 Bash/Agent).
- 설명을 쓰는 방식: description 자체가 사용 규칙집이다. 예) Edit: "You must Read the file in this conversation before editing, or the call will fail"처럼 사전조건과 실패 조건을 명시. Bash: git 규칙, 타임아웃 기본값, 백그라운드 의미까지 tool 설명에 넣음. Agent: 언제 쓰고 쓰지 말지, 결과를 어떻게 다룰지. 큰 tool(Monitor 6.3KB, SendMessage 4.2KB, Workflow 3.4KB)은 사용 가이드 문서 수준 (캡처 §6 크기표).
- 읽기/쓰기/외부효과 표시: 요청에 보내는 tool 정의에는 annotation 필드(`readOnlyHint` 등)가 없다(캡처 전체에서 0건 확인). 구분은 harness 쪽 permission 계층이 한다. 문서 표의 "Permission required" 열: Read/Glob/Grep/Task*/Cron* = No; Bash/Edit/Write/NotebookEdit/WebFetch/WebSearch/Skill/Monitor/Workflow = Yes (tools-reference). Bash는 내장 read-only 명령 집합이면 prompt 없이 실행. MCP tool의 annotation은 쓰는지 문서에서 확인 못함(mcp 문서 해당 부분이 잘려 있음).
- 권한 규칙: `permissions.allow/deny/ask`에 `Tool` 또는 `Tool(specifier)`(예 `Bash(git push *)`, `Skill(commit)`, `Agent(Explore)`), CLI `--allowedTools`/`--disallowedTools`/`--tools`.
- deferred tool: tool search가 기본 켜짐. MCP tool은 이름만 목록에 넣고 schema는 `ToolSearch` tool로 필요할 때 불러온다. `ENABLE_TOOL_SEARCH=auto`는 schema가 context의 10% 안에 들면 upfront 로드, `false`는 전부 로드 (context-window 문서). 이 세션의 tool 목록에서도 일부 tool이 이름만 있고 schema는 `ToolSearch`로 받는 형태로 보인다.

### 1.2 agent·role·mode별 tools

- subagent 정의 = Markdown + YAML frontmatter, 본문이 subagent의 system prompt. 필수는 `name`, `description`. 위치와 우선순위(sub-agents 문서): managed settings > `--agents` CLI JSON > `.claude/agents/`(cwd에서 위로 올라가며 찾고 가까운 것이 이김) > `~/.claude/agents/` > plugin `agents/`. 재귀 탐색, identity는 `name`뿐. 모르는 frontmatter 키는 에러 없이 무시.
- frontmatter 필드: `tools`(allowlist, 쉼표 문자열 또는 YAML list; 생략하면 subagent가 쓸 수 있는 전부), `disallowedTools`(denylist, 먼저 적용), `model`(`sonnet|opus|haiku|fable|<full id>|inherit`), `permissionMode`(`default|acceptEdits|auto|dontAsk|bypassPermissions|plan`), `skills`(시작 때 본문 전체를 주입), `mcpServers`(이름 참조 또는 inline 정의), `hooks`(PreToolUse/PostToolUse/Stop), `memory`(`user|project|local`, 켜면 Read/Write/Edit 자동 허용), 그 밖에 `maxTurns`, `background`, `omitClaudeMd`, `effort`, `isolation: worktree`, `color`, `initialPrompt`. plugin subagent는 `permissionMode`, `mcpServers`, `hooks`가 무시된다.
- 항상 빠지는 tool(`tools`에 적어도): `AskUserQuestion`, `EndConversation`, `EnterPlanMode`, `ExitPlanMode`(permissionMode가 plan이면 예외), `ScheduleWakeup`, `WaitForMcpServers`, `Workflow`, 그리고 깊이 한계의 `Agent`. 백그라운드 subagent는 더 작은 내장 tool 집합만 받고 MCP tool은 유지.
- main thread를 agent로 돌릴 때(`claude --agent`) `tools: Agent(worker, researcher), Read, Bash`처럼 spawn 가능한 subagent type을 allowlist로 제한. `Agent` 생략 = spawn 불가. subagent 정의 안의 `Agent(...)` 목록은 무시. 특정 type 막기는 `permissions.deny: ["Agent(Explore)"]`.
- 내장 subagent(문서): Explore(read-only, Write/Edit deny), Plan(read-only), general-purpose(전부), claude(catch-all), statusline-setup(Sonnet), claude-code-guide(Haiku). 캡처의 "Available agent types"는 이 중 일부 + 사용자 정의(`opencodex` 계열 worker들)가 `이름: 설명 (Tools: ...)` 한 줄씩. Explore/Plan의 `(Tools: All tools except Agent, Artifact, ..., Edit, Write, NotebookEdit)`처럼 denylist 꼴로 표시된다 (캡처 §4).
- Agent tool 입력: `description, prompt, subagent_type, model(enum), effort(enum), run_in_background, isolation(worktree|remote)`. "Each agent type's model, reasoning effort, and tools come from its definition (`.claude/agents/*.md` frontmatter or SDK `agents`)" (캡처 Agent description). `fork` type은 부모 context 전체를 물려받는다.
- mode: permission mode가 `default / acceptEdits / plan / auto / dontAsk / bypassPermissions`. Shift+Tab으로 순환, `/plan`으로 진입. plan mode는 읽기와 분석만 허용하고 source 편집을 막는다(permission-modes). tool 목록 자체를 바꾸기보다 permission 판정을 바꾸는 방식. `EnterPlanMode`/`ExitPlanMode`는 모델이 부르는 tool이기도 하다.
- skill도 tool 범위를 바꾼다: `allowed-tools`(그 turn에 미리 승인, 다른 tool을 막지는 않음), `disallowed-tools`(skill이 켜져 있는 동안 제거), `context: fork` + `agent:`로 subagent에서 실행 (skills 문서).
- subagent가 받는 context: 같은 CLAUDE.md, 같은 MCP와 skill 설정, 대화 이력과 main의 auto memory는 없음. Explore/Plan은 CLAUDE.md를 건너뜀. 부모에게 돌아오는 것은 최종 text 하나 + token/시간 trailer (context-window 문서).

### 1.3 지침(instructions)

- 파일: `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md`(재귀, 선택적으로 `paths:` glob frontmatter로 범위 제한), 그리고 `AGENTS.md` (memory 문서).
- 층과 load 순서(넓은 것부터): managed policy(`/etc/claude-code/CLAUDE.md` 등, 제외 불가) → user `~/.claude/CLAUDE.md`, `~/.claude/rules/` → project `./CLAUDE.md` → local `./CLAUDE.local.md`. 합치는 법은 덮어쓰기가 아니라 이어 붙이기: 파일시스템 root에서 cwd까지 내려오며, 가까운 것이 나중(마지막)에 읽힌다. 같은 디렉터리에서는 `CLAUDE.local.md`가 `CLAUDE.md` 뒤.
- cwd 위 계층은 launch 때 로드. cwd 아래 하위 디렉터리의 CLAUDE.md는 launch 때가 아니라 Claude가 그 디렉터리의 파일을 read/write/edit할 때 로드(lazy). `--add-dir` 디렉터리는 환경변수를 켜야 CLAUDE.md도 로드.
- `@path/to/file` import: 상대 경로는 import한 파일 기준, 재귀 최대 4단계, code span과 fenced block 안은 파싱 안 함. 프로젝트 밖(예: home) import는 처음에 승인 dialog.
- AGENTS.md: v2.1.277부터 읽음. 기본은 cwd나 그 위에 CLAUDE.md/CLAUDE.local.md가 없을 때만 AGENTS.md를 읽는다. 설정 `instructionFiles`로 `claude-md-or-agents-md`(기본) / `claude-md-and-agents-md` / `managed-only` 선택. AGENTS.md로 읽은 것은 `InstructionsLoaded` hook이 안 뜨는 등 CLAUDE.md와 차이가 있다.
- 크기: CLAUDE.md는 200줄 이하 권장(adherence), 파일 하나 4 MiB 초과면 건너뜀. auto memory `MEMORY.md`는 앞 200줄 또는 25KB까지만 로드. 둘 다 "context로 취급하며 강제 설정이 아니다. 막으려면 PreToolUse hook"이라고 문서가 명시.
- 제외: `claudeMdExcludes` glob (managed 제외 불가). `/doctor prompt-audit`으로 충돌·낡은 지침 점검.
- prompt 안의 위치: system 필드가 아니다. 캡처에는 이 프로젝트에 CLAUDE.md가 없어 직접 보이지 않지만, 이 세션 자신의 prompt에서 AGENTS.md가 user role 메시지의 `<system-reminder>` 블록("Codebase and user instructions are shown below...")으로 들어온 것을 관찰했다. 캡처의 사실로는 userEmail, gitStatus, git attribution이 첫 user 메시지의 `<system-reminder>` 블록들로 간다 (캡처 §5).
- 자동 memory: `~/.claude/projects/<project>/memory/MEMORY.md` + topic 파일, 모델이 직접 씀. 모든 worktree가 repo 하나당 memory 하나 공유.

### 1.4 prompt assemble

캡처 §1~§5 (v2.1.299, `POST /v1/messages`):

- `system[]` 3블록, 약 4KB: [0] billing header 한 줄(`cc_version`, `cc_entrypoint`), [1] "You are a Claude agent, built on Anthropic's Claude Agent SDK." 한 줄, [2] 본체 3.9KB = 목표/보안 정책(IMPORTANT 한 문단), `# Harness`(출력은 GFM, permission mode, system turn과 hook 설명, `<pasted_content>` 규칙, 전용 tool 선호, `file_path:line_number` 표기), 코드 스타일 한 줄, 대명사 규칙, 되돌리기 어려운 작업은 확인 후, `# Session-specific guidance`(`/<skill-name>`이면 Skill로 호출), `# Environment`(모델 ID 목록 등), `# Context management`(긴 대화는 요약되니 서둘러 끝내지 말 것).
- `messages[0]` user, 3블록: `<system-reminder>`(userEmail + gitStatus: branch, status, 최근 commit), `<system-reminder>`(git commit/PR 꼬리말 규칙), 실제 입력.
- `messages[1]` **role:"system"** 메시지 23KB: 동적 환경 블록. `# Environment`(cwd, git 여부, platform, shell, OS, 다운로드 파일 취급 규칙), 모델 이름과 knowledge cutoff, `Available agent types for the Agent tool:` 목록, MCP 서버 지침(있으면), `The following skills are available for use with the Skill tool:` 목록(이름: 설명), 현재 permission mode 안내(auto mode 문단), 오늘 날짜.
- `tools[]` 24개 inline.
- 요청 config에 prompt와 별개로: `thinking{adaptive}`, `context_management.edits`(`clear_thinking`), `output_config.effort`, `safeguards[dangerous_tool_use]`(classifier에 permission mode, cwd, rule roots, 신뢰 디렉터리, allow/deny/ask 규칙, auto_mode 환경 설명을 넘김). 안전 장치를 prompt가 아니라 API 파라미터로 분리했다.
- cache 배치(캡처 §8의 해석, 문서에는 명시 없음): system 필드는 거의 정적(4KB), 기계마다 다른 정보(cwd, git, skill 목록)는 messages로 밀어 prefix cache 적중을 지킨다. 대화 중 갱신은 `<system-reminder>`를 user 메시지 블록으로 끼워 넣는다("The system may send updates, reminders, or modifications to rules via mid-conversation system turns").
- interactive와 `-p`의 차이(캡처 §7): interactive는 system이 8개 블록으로 나뉘고 `! <command>` 안내 한 줄이 더 붙는다. output style을 고르면 `You are an interactive CLI tool...` 변형 템플릿 7종이 교체/부록된다.
- compact: 문서상 `/compact` 또는 자동. 대화를 "your requests and intent, key technical concepts, files examined or modified with important code snippets, errors and fixes, pending tasks, current work" 구조의 요약 하나로 바꾸고, 최근 수정한 파일을 다시 읽고, 호출한 skill 본문을 다시 넣는다(skill당 앞 5,000 token, 합 25,000 token). skill **목록**(설명)은 compact 뒤 다시 안 넣는다. 요약 prompt 원문은 확인 못함.
- tool 목록과 skill 목록의 모습: tool은 API tools[]로, skill은 `- 이름: 설명` 한 줄씩, agent type은 `- 이름: 설명 (Tools: ...)` 한 줄씩 messages의 system 블록 안에 텍스트로.

### 1.5 commands (slash command)

- 문서(commands, skills)의 분류: (a) 내장 command = 대부분 harness가 고정 로직으로 직접 실행, (b) bundled skill = model에게 주는 prompt ("Bundled skills are prompt-based"), (c) 사용자 정의 skill / `.claude/commands/*.md`, (d) MCP prompt, (e) plugin skill(`/plugin:skill`).
- 인식: 메시지 맨 앞의 `/name`만 command. 뒤 text는 인자. skill은 `/skill-a /skill-b 인자`로 최대 6개 chain. 응답 중에 치면 queue에 쌓였다가 turn이 끝난 뒤 실행(`/status`, `/usage` 등은 즉시).
- 내장 예(commands 문서): `/compact [instructions]` 요약(harness), `/clear [name]` 새 대화, `/init` CLAUDE.md 만들기(Skill tool로 Claude가 부를 수도 있음), `/recap` 한 줄 세션 요약, `/plan [description]` plan mode 진입, `/agents`(v2.1.197 이후는 안내문만 출력), `/skills` 목록·visibility 메뉴, `/mcp`, `/memory`, `/model`, `/permissions`, `/hooks`, `/context`, `/resume`, `/rewind`(`/checkpoint`, `/undo`), `/export`, `/fork`, `/btw`(대화에 안 남는 곁질문), `/goal`, `/review`(= bundled skill `/code-review`의 alias, effort 단계와 `--fix --comment` 인자). bundled skill: `/batch`, `/simplify`, `/loop`, `/debug`, `/claude-api`, `/verify`, `/run`, `/code-review`, `/doctor` 등.
- 정의 꼴: `.claude/commands/<name>.md`(하위 폴더는 `frontend:component`), frontmatter는 skill과 같고 `name`, `paths`만 없음. 이름이 겹치면 skill이 이긴다. 새 작업에는 skill을 권장. `UserPromptExpansion` hook이 command가 prompt로 펼쳐질 때 끼어들 수 있다.
- 인자: `$ARGUMENTS`, `$ARGUMENTS[N]`/`$N`, `arguments:`로 이름 붙인 `$name`. 인자 placeholder가 없으면 `ARGUMENTS: <value>`를 뒤에 붙인다. `!`command`` 구문은 model에 가기 전에 shell을 돌려 출력으로 치환(실패하면 invocation 전체 중단, permission 규칙 적용, `disableSkillShellExecution`으로 끔).
- MCP prompt를 command로 노출한다는 것까지만 확인(명명 규칙은 mcp 문서 해당 절이 잘려 확인 못함).

### 1.6 skills

- 꼴: `<dir>/<name>/SKILL.md` + 보조 파일. frontmatter: `name`(기본은 폴더 이름), `description`, `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `background`, `hooks`, `paths`(자동 활성 범위 glob), `shell`. 모르는 키는 무시.
- 위치/층(skills 문서): enterprise(managed 설정 디렉터리) > personal `~/.claude/skills/` > project `.claude/skills/`; nested `<subdir>/.claude/skills/`(그 하위 파일을 읽거나 편집할 때 로드), `--add-dir`, plugin `<plugin>/skills/`(이름이 `plugin:name`이라 충돌 없음), claude.ai에서 sync된 `~/.claude/skills/synced/`. 같은 이름이면 enterprise > personal > project, skill > `.claude/commands/`, 사용자 skill > bundled skill.
- 언제 무엇을 넣나(progressive disclosure): 시작 때 이름 + 설명(+`when_to_use`)만 listing에 넣는다. listing 한 항목은 1,536자에서 자른다. 본문은 호출될 때만 읽혀 대화에 메시지 하나로 남고 다시 안 읽는다. `disable-model-invocation: true`면 listing에도 안 들어가고 `/name` 때만 로드. 권장: SKILL.md 500줄 이하, 참고 자료는 보조 파일로. 모델 호출 경로는 `Skill` tool(`skill`, `args`) — "Available skills appear in a system-reminder listing", "the skill's instructions load into the turn".
- built-in: bundled skill `/doctor`, `/code-review`, `/batch`, `/debug`, `/loop`, `/claude-api`, `/verify`, `/run`, `/run-skill-generator`, `/simplify`, (`/workflow-authoring`은 dynamic workflow 켰을 때). 캡처의 목록에도 `update-config`, `keybindings-help`, `fewer-permission-prompts`, `schedule`, `init`, `security-review`, `plugin-authoring` 등 내장 항목이 보인다.
- 끄고 켜기: `Skill` tool 전체 deny; `Skill(name)` / `Skill(prefix *)` allow·deny 규칙; frontmatter `disable-model-invocation`(모델에게 숨김), `user-invocable: false`(`/` 메뉴에서 숨김); settings `skillOverrides: {name: on|name-only|user-invocable-only|off}`; `disableBundledSkills`; `/skills` 메뉴에서 Space로 순환 후 `.claude/settings.local.json`에 저장.

---

## 2. OpenAI Codex CLI (`codex-rs`)

### 2.1 공통 tools

- tool 정의는 OpenAI Responses API 꼴이다. `ToolSpec` enum = `function` / `namespace` / `tool_search` / `web_search` / `custom`(freeform) (`tools/src/tool_spec.rs:20-55`). `ResponsesApiTool`은 `name, description, strict, defer_loading, parameters(JsonSchema), output_schema`.
- 코어 tool은 `core/src/tools/spec_plan.rs`의 `add_core_tool_sources`(1177~)가 조건부로 등록한다: shell 계열(`exec_command` + `write_stdin`; unified exec 끄면 one-shot `exec_command`만), MCP resource 3종(`list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`; MCP 서버가 있을 때), `update_plan`, `request_user_input`, `request_permissions`, `apply_patch`, `view_image`, `web_search`(hosted), 시간·sleep·token budget류, `request_plugin_install`, collaboration tool(`spawn_agent`, `send_input`/`send_message`, `wait_agent`, `close_agent`, `resume_agent`, `list_agents`, `interrupt_agent`, `followup_task`), `tool_search`.
- 파일 편집은 별도 Write/Edit이 없다. `apply_patch`는 **freeform(custom) tool**이고 입력은 JSON이 아니라 lark grammar로 검증하는 patch text다 (`core/src/tools/handlers/apply_patch_spec.rs:9-32`, 설명: "This is a FREEFORM tool, so do not wrap the patch in JSON"). 파일 읽기 전용 tool도 없고 `exec_command`로 shell을 쓴다(`view_image`만 별도). model의 `apply_patch_tool_type`이 있을 때만 등록 (`spec_plan.rs:1423`).
- 이름: snake_case. namespace를 둔다: 기본 `functions`, multi-agent `multi_agent_v1` 등 (`tools/src/tool_spec.rs:106-`). MCP tool은 `mcp__<server>__<tool>` 접두 (`codex-mcp/src/tools.rs:22, 225`).
- 입력 schema: `JsonSchema::object(properties, required, additionalProperties=false)`. 설명은 짧다. 예) `update_plan`: "Updates the task plan. ... At most one step can be in_progress at a time." (`plan_spec.rs`). `exec_command`: "Runs a command in a PTY, returning output or a session ID for ongoing interaction." 인자 `cmd, workdir, tty, yield_time_ms, max_output_tokens, shell, login, environment_id` + approval 인자(`sandbox_permissions: use_default|with_additional_permissions|require_escalated`, `justification`, prefix rule) (`shell_spec.rs:36-`, `create_approval_parameters`). 규칙집은 tool 설명이 아니라 base prompt와 developer 블록에 둔다.
- output schema를 tool 정의에 포함한다(`exec_command`는 `wall_time_seconds, exit_code, session_id, output...`).
- 노출 방식(`ToolExposure`, `tools/src/tool_executor.rs:51-76`): `Direct`(처음부터 모델에게), `Deferred`(tool_search로 찾아야 보임), `DeferredModelOnly`, `DirectModelOnly`, `CodeModeOnly`. 모델이 `supports_search_tool`이면 multi-agent tool v1을 Deferred로 등록(`spec_plan.rs:1560-`).
- 읽기/쓰기/외부효과 표시: 자체 tool에는 annotation이 없다. 위험 판정은 command 단위의 exec policy(prefix rule)와 sandbox 정책이 한다. MCP tool의 annotation(`readOnlyHint`, `destructiveHint`, `openWorldHint`)은 승인 판정에 실제로 쓴다: destructive=true면 승인 필요; readOnly=true면 불필요; 그 외 destructive 기본 true 또는 openWorld면 필요; 앱별 `approval_mode`(auto/prompt/writes/approve)로 덮어쓴다 (`core/src/mcp_tool_call.rs:2448-2490`).
- 승인 정책 `AskForApproval`: `untrusted`(exec policy 허용 규칙 없으면 매번 승인), `on-request`(기본, 모델이 판단), `granular`(범주별), `never` (`protocol/src/protocol.rs:1095-1118`). sandbox `read-only`(기본) / `workspace-write` / `danger-full-access` (`protocol/src/config_types.rs:104`). 이 둘의 설명문은 `prompts/templates/permissions/{sandbox_mode,approval_policy}/*.md`에서 만든 `<permissions instructions>` developer 블록으로 모델에게 간다.

### 2.2 agent·role·mode별 tools

- role(= 사용자 정의 agent): TOML. 선언 위치는 config layer마다 (a) `[agents.<name>]` 테이블(`description`, `config_file`, `nickname_candidates`) 또는 (b) layer의 config 폴더 아래 `agents/` 안의 `*.toml` 재귀 탐색 (`agent-roles/src/loader.rs:26-`, `discovery.rs`). layer는 낮은 것에서 높은 순으로 합치고 같은 이름이면 부족한 필드만 아래 layer에서 채운다(`merge_missing_role_fields`). `description`이 없으면 경고 후 무시.
- role 파일 필드: `name`, `description`, `nickname_candidates` + 일반 config 필드. 실제로 적용되는 override는 `developer_instructions, model, model_reasoning_effort, model_reasoning_summary, model_verbosity, personality, service_tier`, `skills`(끄는 것만), `features`(끄는 것만) (`core/src/agent/role.rs:30-130`).
- **role은 권한을 넓히지 못하고 줄이기만 한다**: "Roles may customize the child or reduce its capabilities, but never replace the parent session's authority" (`role.rs:3`). 꺼질 수 있는 feature는 `ShellTool, Apps, Plugins, MemoryTool, RequestPermissionsTool` 뿐 (`role.rs:100-110`). 즉 Claude Code식 `tools:` allowlist/denylist는 role 정의에 없다. tool allowlist는 별도로 `ToolPolicy.allowed_tools: Option<Vec<ToolName>>`(None=기본, 빈 list=tool 없음; namespace 포함 이름)이 있고 host/extension이 세션에 건다 (`ext/extension-api/src/tool_policy.rs:10-`).
- 내장 role: `default`("Default agent."), `explorer`("specific codebase questions... fast and authoritative", 병렬 spawn 권장), `worker`("execution and production work", 파일/책임 ownership을 명시하고 다른 worker 편집을 되돌리지 말라고 알리라는 규칙) (`role.rs:300-`). `awaiter`는 주석 처리됨. `explorer.toml` 파일이 이 commit에서는 0 byte(빈 파일)라 explorer의 실제 override 내용은 확인 못함.
- spawn: `spawn_agent`에 `message, agent_type, fork_turns(all|none), model, reasoning_effort` (v2, `multi_agents_spec.rs:649-`). `agent_type` 설명에 `Available roles:\n이름: {설명 + (model이 role에 고정돼 있으면) "cannot be changed" 문장}` 목록을 붙여 모델에게 role 목록을 보여준다(`role.rs:spawn_tool_spec`). 기본값: 동시 thread 6, 중첩 깊이 1 (`core/src/config/mod.rs:255-265`). 자식은 부모 history를 기본으로 전부 물려받는다(`fork_turns` 기본 `all`).
- mode: collaboration mode `Default` / `Plan` (`ModeKind`). mode 지침은 `collaboration-mode-templates/templates/{default,plan}.md`가 `<collaboration_mode>` developer 블록으로 들어간다. Plan mode는 **tool을 빼지 않고 prompt로 막는다**: "You must not perform mutating actions", 허용/금지 예시 나열; 단 코드로 막는 것이 둘 있다: `update_plan`을 plan mode에서 부르면 에러(`handlers/plan.rs:87-89`), `request_user_input`은 mode별 노출(`tools/src/tool_config.rs:6-15`, Default에선 flag 필요). Default mode는 "strongly prefer making reasonable assumptions"로 질문을 줄이라고 지시.
- 자동 turn은 Plan mode에 들어가거나 나올 수 없다 (`session/turn_input.rs:TurnStartKind::permits_mode`).

### 2.3 지침(instructions)

- 파일: `AGENTS.md`, 로컬 override `AGENTS.override.md`(둘 다 있으면 override가 같은 디렉터리의 AGENTS.md를 대신함), 설정 `project_doc_fallback_filenames`(기본 빈 list)로 다른 파일명 추가 (`core/src/agents_md.rs:43-45, 270-295`). 경로 구분자가 든 fallback 이름은 무시.
- 전역(user) 층: `$CODEX_HOME/AGENTS.override.md` → `AGENTS.md` 첫 번째 (`codex-home/src/instructions/mod.rs:43`). 빈 파일은 무시.
- project 층: cwd에서 위로 올라가 `project_root_markers`(기본 `.git`)를 가진 첫 조상을 root로 정하고, **root에서 cwd까지 각 디렉터리의 AGENTS.md를 root→cwd 순으로 이어 붙인다**. root를 넘어 올라가지 않는다. marker가 없으면 cwd만. marker list를 빈 값으로 두면 부모 탐색 끄기 (`agents_md.rs:1-18, 213-258`).
- 크기: `project_doc_max_bytes` 기본 32 KiB, 여러 environment에 걸쳐 남은 예산을 깎아 쓰고 넘으면 잘라냄(경고 로그) (`config_toml.rs:75`, `agents_md.rs:104-150`). 신뢰하지 않는 project(`active_project.is_untrusted()`)면 project 문서는 건너뛰고 user 지침만.
- 합치는 문자열: user 지침 → 그 뒤 project 문서 순, user→project 경계에 `\n\n--- project-doc ---\n\n` 구분자 (`agents_md.rs:49, 372-395`).
- 우선순위 규칙은 코드가 아니라 base prompt가 말한다: "More-deeply-nested AGENTS.md files take precedence", "Direct system/developer/user instructions take precedence over AGENTS.md", 범위는 그 파일이 든 디렉터리 하위 전체 (`protocol/src/prompts/base_instructions/default.md`의 `# AGENTS.md spec`). root~cwd 문서는 이미 들어가 있으니 다시 읽지 말고, cwd 하위나 cwd 밖에서 일할 때는 해당 AGENTS.md를 직접 찾아보라고 한다.
- prompt에서의 위치: **user role 메시지**, 형식 `# AGENTS.md instructions for <dir>\n\n<INSTRUCTIONS>\n...</INSTRUCTIONS>` (`core/src/context/user_instructions.rs:26-40`). 내용이 바뀌면 "These AGENTS.md instructions replace all previously provided AGENTS.md instructions." 또는 "no longer apply" 갱신 메시지를 추가한다(`context/world_state/agents_md.rs:8-70`).
- 그 밖의 지침 경로: config의 `developer_instructions`(developer role 메시지), `instructions`(system 지침), `model_instructions_file`(모델 기본 지침을 통째로 교체, "STRONGLY DISCOURAGED"), `compact_prompt`, managed(관리자) developer instructions (`config_toml.rs:249-280`). agent role의 `developer_instructions`도 같은 경로.

### 2.4 prompt assemble

- Responses API 요청: `instructions` = `base_instructions`(모델별 .md 기본 prompt), `input` = 대화 item 배열, `tools` = `model_visible_specs()`, `parallel_tool_calls: true`, 선택 `output_schema` (`core/src/client_common.rs:20-60`, `session/turn.rs:1666-1697`). 기본 prompt는 `core/gpt_*_prompt.md`, `models-manager/prompt.md`, `protocol/src/prompts/base_instructions/default.md`(275줄: 정체성 "coding agent running in the Codex CLI", personality, AGENTS.md spec, preamble 규칙, plan 사용법, sandbox/approvals 절 등). 모델 metadata가 base_instructions를 결정(`models-manager/models.json`).
- 환경·지침류는 `instructions`에 넣지 않고 `input` 맨 앞의 **initial context**로 넣는다 (`session/mod.rs:build_initial_context_with_world_state`, 4469-): developer role 메시지 하나에 sections를 묶는다(model switch 안내가 맨 앞; `developer_instructions`; extension이 낸 policy/capabilities 조각; 아래 world state의 developer 조각들). 그 외 developer 메시지는 따로(token budget, multi-agent role 지침 등). user role 쪽 조각들(AGENTS.md, `<environment_context>`)은 user 메시지 하나로 묶는다. 순서는 [prefix item] → developer 묶음 → 별도 developer들 → multi-agent mode → user 묶음 → managed developer instructions.
- "world state" 구조: 각 section(`model`, `tools`, `context_window_guidance`, `realtime`, `agents_md`, `permissions`, `collaboration_mode`, `persistent_mode`, `environment`, `apps/skills/plugins instructions`, `multi_agent_*` 등)이 `render_diff(previous snapshot)`을 가진다 (`context/world_state/mod.rs`, `session/world_state.rs:150-300`). 첫 요청은 전체, 이후는 **바뀐 것만 새 item으로 추가**한다. 이전 snapshot이 rollout에 저장돼 resume/compact 뒤에도 diff가 이어진다. 그래서 prompt prefix가 바뀌지 않아 cache에 유리(이 목적을 명시한 문서는 확인 못함, 구조에서 읽은 추론).
- 태그: developer 쪽 `<permissions instructions>`, `<collaboration_mode>`, `<apps_instructions>`, `<skills_instructions>`, `<plugins_instructions>`, `<model_switch>`, `<multi_agent_mode>`; user 쪽 `# AGENTS.md instructions`, `<environment_context>`, `<skill>`, `<user_shell_command>`, `<subagent_notification>`, `<turn_aborted>` 등 (`protocol/src/protocol.rs:118-140`, `core/src/context/*.rs`).
- 동적 환경 정보: `<environment_context>` 안에 `<cwd>`, `<shell>`, `<current_date>`, `<timezone>`, network 정책, `<filesystem>` 권한 profile(workspace roots + permission profile), `<subagents>` (`context/world_state/environment.rs:290-345`). 설정(`include_environment_context*`)으로 켜고 끈다. git 상태나 OS 이름은 이 블록에서 확인 못함.
- tools는 요청의 `tools` 필드. `incremental_tools` 모드에서는 요청 `tools`를 비우고 tool 정의를 `<tools>` world state section으로 history에 넣는다(`turn.rs:1666-`, `world_state.rs:162-`).
- compact: (1) 요약 prompt를 일반 user 입력으로 보낸다: "You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM..." (`prompts/templates/compact/prompt.md`, config `compact_prompt`로 교체 가능). (2) 모델의 마지막 assistant 메시지를 요약으로 쓰고 앞에 `SUMMARY_PREFIX`("Another language model started to solve this problem and produced a summary...")를 붙인다. (3) 새 history = initial context + 최근 user 메시지들(최대 20,000 token) + 요약 (`core/src/compact.rs:63-64, 120-140, 404-410, 700-`). remote compaction(`compact_remote_*`) 변형도 있다. 자동 compact는 `model_auto_compact_token_limit`.
- skill 목록은 `<skills_instructions>` developer 블록: `## Skills`, 소개문, `### Skill roots`, `### Available skills`(이름·설명·경로), `### How to use skills`(trigger 규칙, progressive disclosure, context hygiene 수십 줄) (`ext/skills/src/catalog_prompt.rs`, `fragments.rs`).

### 2.5 commands (slash command)

- 내장 command는 enum `SlashCommand` (`tui/src/slash_command.rs`). 약 70개, enum 순서가 popup 순서. 사용자 정의 command(파일로 만드는 custom prompt)는 이 commit의 source에서 찾지 못했다(`custom_prompt` grep 결과는 TUI 입력 view뿐). 그 역할은 skill(`$SkillName` mention)이 한다.
- 분류(`slash_dispatch.rs`):
  - model에게 정해진 prompt를 user message로 보냄: `/init` — `tui/assets/prompt_for_init_command.md`("Generate a file named AGENTS.md that serves as a contributor guide...")를 그대로 `submit_user_message` (`slash_dispatch.rs:328-331`).
  - harness 작업 요청: `/compact`(`app_event_tx.compact()`로 core에 compact op), `/recap`(`GenerateRecap` 이벤트), `/clear`, `/new`, `/fork`, `/resume`, `/side`·`/btw`(ephemeral fork 대화), `/worktree`, `/goal`, `/review`(popup으로 대상 고른 뒤 review 흐름 시작; 내부 prompt는 `prompts/templates/review/rubric.md` 등에 있으나 흐름 전체는 확인 못함).
  - mode/설정 변경: `/plan`(collaboration mode를 Plan으로), `/model`, `/permissions`, `/approve`, `/experimental`, `/skills`, `/mcp`, `/hooks`, `/memories`, `/agents`, `/subagents`, `/theme`, `/statusline`, `/keymap`, `/vim` 등.
  - 정보 표시/UI: `/status`, `/diff`, `/copy`, `/export`, `/pwd`, `/ps`, `/stop`, `/usage`, `/warnings`, `/debug-config`.
- 인자: `supports_inline_args`인 것만(예 `/review`, `/rename`, `/new`, `/plan`, `/goal`, `/mcp`, `/export`, `/cd`, `/side`). 작업 중에 실행 가능한지(`available_during_task`), 부모 thread 없이 가능한지, side conversation에서 가능한지를 command마다 코드로 정한다.
- `/import`: Claude Code의 설정·project·최근 chat을 가져옴("import setup, this project, and recent chats from Claude Code").

### 2.6 skills

- 꼴: `SKILL.md` + YAML frontmatter(`name`, `description` 필수 — description이 비면 에러, name 최대 64자, `metadata.short-description`). 공백은 한 줄로 정리. 일부 third-party skill의 `description: A: B`처럼 깨진 YAML은 줄 단위로 고쳐 읽는 보정이 있다 (`skills/src/parser.rs:44-90`). 보조 파일 `agents/openai.yaml`에 `interface`(표시 이름, 아이콘, `default_prompt`), `dependencies`, `policy`(`allow_implicit_invocation`, `products`)를 둔다 (`skills/src/model.rs`, `interface.rs`).
- 위치/층(`ext/skills/src/host_roots.rs:55-130`): project layer의 `.codex/skills`(repo), cwd에서 repo까지 `.agents/skills`, user의 `$CODEX_HOME/skills`(deprecated 표기)와 `~/.agents/skills`, system(번들 캐시 `.system`), admin(`/etc` 쪽 system layer `skills`), plugin skill root, 추가 root. 경로로 중복 제거. executor(원격 환경)와 cloud 소유 skill은 `skills.read({"package": ...})` tool로 읽는다.
- built-in(번들): `skills/src/assets/samples/` 5개 — imagegen, openai-docs, review-agent, skill-creator, skill-installer. 실행 파일에 포함(`include_dir`)되고 `.system` 캐시 폴더로 풀린다. `[skills.bundled].enabled`로 켜고 끈다.
- prompt: 이름+설명+경로만 `<skills_instructions>`에 넣는다. catalog 크기는 `skills.max_context_tokens`(기본 context window의 2%, 상한 10,000 token). 본문은 모델이 목록 경로의 `SKILL.md`를 직접 읽는다("must read its SKILL.md completely before taking task actions"; 참조 파일은 필요한 것만; 읽기를 subagent에게 위임 금지). 사용자가 `$SkillName`으로 명시하면 harness가 본문을 `<skill><name>..</name><path>..</path>...</skill>` user 메시지로 직접 주입한다 (`fragments.rs:76-120`, `skills/src/selection.rs`). 신뢰 규칙: 이름을 말했거나 설명에 분명히 맞으면 "must use", skill은 turn을 넘겨 유지하지 않고 재언급 필요, 여러 개면 최소 집합과 순서를 한 줄로 알림.
- 끄고 켜기: `[[skills.config]] {path|name, enabled}`, `skills.include_instructions=false`(catalog 블록 자체를 뺌), `policy.allow_implicit_invocation=false`(skill별), `/skills` 메뉴 (`config/src/skills_config.rs`). agent role이 자식의 skill을 끌 수 있다(`role.rs`).

---

## 3. harness 사이 비교

| 항목 | Claude Code | Codex CLI |
|---|---|---|
| 공통 tools | PascalCase 단일어(`Read`, `Edit`, `Bash`...) 24개+. 파일 읽기/쓰기/편집 tool 분리. JSON schema 평평한 object, 사용 규칙은 tool description에 길게 | snake_case, shell(`exec_command`) 중심. 편집은 freeform `apply_patch`(grammar 검증), 읽기 전용 tool 없음. 설명은 짧고 규칙은 base prompt·developer 블록. output schema 포함 |
| 위험 표시 | tool 정의에 annotation 없음. 문서·harness가 tool별 "permission required" + 규칙(`Tool(specifier)`) + classifier | 자체 tool은 annotation 없음, exec policy(prefix rule) + sandbox + approval policy. MCP annotation(readOnly/destructive/openWorld)은 승인 판정에 사용 |
| agent별 tools | frontmatter `tools` allowlist + `disallowedTools` denylist, `Agent(type,...)` spawn allowlist, 항상 제외 목록, permissionMode, mcpServers, hooks, skills, memory | role TOML은 model/effort/instructions/skill·일부 feature만 override하고 **권한을 줄이기만** 함(tool allowlist 없음). `ToolPolicy.allowed_tools`는 host/extension이 건다 |
| mode | permission mode 6종(plan 포함), 판정 규칙을 바꿈. EnterPlanMode/ExitPlanMode tool | collaboration mode Default/Plan(지침 블록으로 mutating 금지), approval policy와 sandbox mode는 별도 축. 코드 강제는 `update_plan` 금지 정도 |
| 지침 파일 | CLAUDE.md(+local, rules, @import 4단계), AGENTS.md는 CLAUDE.md가 없을 때 기본으로 읽음. managed/user/project/local, 하위 폴더는 lazy | AGENTS.md(+AGENTS.override.md, fallback 이름 설정). user(`$CODEX_HOME`) → root~cwd 이어 붙임, 32 KiB 상한 |
| 지침 위치 | user role `<system-reminder>` 블록(관찰) | user role 메시지 `# AGENTS.md instructions ... <INSTRUCTIONS>` |
| prompt 구조 | system 3블록 4KB(정적) + messages[1] role:"system" 23KB(환경, agent type, skill 목록) + user `<system-reminder>` + tools[] inline | `instructions`(모델별 base prompt) + input 앞의 developer/user initial context + tools. section별 snapshot diff로 변경분만 추가 |
| compact | 구조화 요약(요청, 개념, 파일, 오류, 대기 작업), 최근 파일 재읽기, 호출한 skill 본문 재주입(5,000/25,000 token), skill 목록은 안 넣음 | handoff 요약 prompt를 일반 turn으로 보내고 `SUMMARY_PREFIX` + 최근 user 메시지(20k token) + 요약으로 history 교체. prompt는 config로 교체 가능 |
| commands | 내장(대부분 harness 고정 로직) + bundled skill(prompt) + `.claude/commands/*.md` + skill + MCP prompt. 맨 앞 `/name`, `$ARGUMENTS` 치환, `!`cmd`` 선실행 | 내장 enum 약 70개(UI/harness 작업 다수, `/init`만 고정 prompt를 user 메시지로 전송). 파일로 정의하는 custom command는 확인 못함 |
| skills | `SKILL.md`, frontmatter 풍부(allowed-tools, context fork, hooks, paths...), 설명 1,536자 listing, 본문은 `Skill` tool 호출 때 로드, `skillOverrides`·`Skill(...)` 규칙 | `SKILL.md`(name/description 필수) + `agents/openai.yaml`, catalog는 context의 2%, 본문은 모델이 파일을 직접 읽음, `$name` 명시 시 harness가 주입. 번들 5개, `[[skills.config]]` |
| 끄고 켜기 | permission rule, frontmatter, settings `skillOverrides`, `disableBundledSkills` | `skills.config`, `skills.bundled`, `include_instructions`, skill `policy` |

## 4. lophn에 참고할 점

### 사실 (위 근거가 있는 것)

- 두 harness 모두 **정적 prefix + 동적 환경은 뒤로** 둔다. Claude Code는 system 4KB를 정적으로 두고 cwd·git·skill 목록을 messages로 밀었다. Codex는 base prompt를 `instructions`에, 나머지를 input 앞쪽 item으로 두고 변경분만 diff로 추가한다.
- 지침 파일은 둘 다 prompt의 **system이 아니라 message(user role)**에 들어간다. 층은 이어 붙이기이고 더 가까운 파일이 뒤(Claude)/깊은 파일이 우선(Codex가 prompt 문장으로 규정). Claude Code는 AGENTS.md를 읽을 수 있고, Codex는 `/import`로 Claude Code 설정을 가져온다.
- skill은 둘 다 progressive disclosure(이름·설명 먼저, 본문은 나중). 차이는 본문을 누가 읽나: Claude는 `Skill` tool이 본문을 대화에 주입, Codex는 모델이 파일을 읽고 `$name`일 때만 harness가 주입.
- subagent의 tool 제한은 Claude Code만 선언형(`tools`/`disallowedTools`/`Agent(type)`)이다. Codex role은 권한 축소 전용이고, 승인 쪽은 role이 아닌 session 설정(`approval policy`, `sandbox`)이 맡는다.
- Plan 같은 mode를 tool 제거가 아니라 **지침 블록 + permission 판정**으로 구현한다(Codex는 prompt, Claude는 permission mode). tool 목록 자체를 mode별로 바꾸지 않아 cache가 안정적이다.
- 요청에 보내는 tool 정의에 annotation(readOnlyHint 등)을 두지 않고, 위험 분류는 harness 내부 규칙으로 한다. 예외는 외부 MCP tool의 annotation을 읽는 Codex.
- tool 정의가 길어질수록 deferred(이름만 노출 + 검색 tool)로 돌린다: Claude `ToolSearch`, Codex `tool_search`/`ToolExposure::Deferred`.
- 크기 상한이 있다: Codex AGENTS.md 32 KiB, skill catalog 2% context, Claude skill 설명 1,536자, MEMORY.md 200줄/25KB, compact 뒤 skill 재주입 5,000/25,000 token.

### lead의 추론 (사실이 아닌 제안, 반증 가능)

- role별 agent(App Engineer, Operator, Context Engineer, lophn)는 Claude식 선언형 정의(이름, 설명, tools allow/deny, model, 지침 본문)가 맞다. Codex처럼 "권한 축소만"으로 하면 role마다 다른 tool 집합을 줄 수 없다. 다만 Codex의 "자식은 부모보다 넓은 권한을 못 가진다"는 불변식은 가져올 만하다(위임 시 권한 상승 방지).
- tool에 읽기/쓰기/외부효과 표시를 두려면 lophn은 요청 정의가 아니라 **자체 registry의 metadata**로 두는 편이 두 harness와 일관된다(모델에게 보내는 schema와 permission 판정 데이터를 분리). MCP처럼 외부에서 오는 tool에는 annotation을 신뢰하되 기본은 "쓰기·외부효과 있음"으로 보는 Codex의 기본값(destructive 기본 true)이 안전하다.
- 동적 정보(cwd, role 목록, skill 목록, 날짜)와 정적 지침은 갈라 두고, 대화 중 바뀐 것은 Codex식 snapshot diff 또는 Claude식 reminder로 추가하는 방식을 고르면 cache가 유지된다. 어느 쪽이든 "변경분만 새 message"가 핵심.
- `AGENTS.md`를 쓰는 프로젝트이므로 지침 파일 이름은 AGENTS.md를 기본으로 하고, 하위 폴더 범위 규칙(Codex: 범위 = 폴더 하위, 깊은 파일 우선)을 그대로 쓰면 두 harness와 호환된다.
- slash command는 "harness가 직접 실행하는 것"과 "정해진 prompt를 model에 보내는 것"을 정의 단계에서 구분해 두면 된다(Claude: 내장 고정 로직 vs bundled skill, Codex: enum 안에서 `/init`만 prompt). prompt형은 skill과 같은 정의 꼴로 합치는 쪽이 Claude의 최근 방향(command 파일 → skill 통합)과 맞다.
