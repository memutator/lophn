# agent definition 조사: Hermes, Goose, Cline

조사일: 2026-10-15

| 대상 | repo | commit |
|---|---|---|
| Hermes | github.com/NousResearch/hermes-agent | `58560bf0` (2026-10-14) |
| Goose | github.com/block/goose (docs 안의 링크는 aaif-goose/goose) | `9686d67` (2026-10-14) |
| Cline | github.com/cline/cline (SDK 재작성판. `sdk/`, `apps/cli`, `apps/vscode`) | `789f79e` (2026-10-14) |

세 repo 모두 `git clone --depth 1`로 받아 읽기만 했다. 실행하지 않았다. 경로는 repo 루트 기준이다. `파일:줄`은 위 commit 기준이다.

읽는 법: 사실은 근거(경로:줄 또는 문서 경로)와 같이 적었다. 확인하지 못한 것은 "확인 못함"이라고 적었다. 각 harness 절 끝의 "role·mode별 tool과 지침 요약"은 lophn이 가장 궁금해하는 부분을 그 harness 안에서 한 번 더 모은 것이다.

---

## 1. Hermes

Hermes는 coding만 하는 harness가 아니다. 같은 agent core를 CLI, 메신저 gateway(Telegram, Discord, Slack 등 약 20개), TUI, Electron desktop이 같이 쓴다 (`AGENTS.md` "What Hermes Is"). role을 나누는 단위는 서너 개가 겹쳐 있다. toolset(platform별 묶음), profile(별도 HERMES_HOME), personality(prompt overlay), subagent(`delegate_task`)이다.

### 1.1 공통 tools

- **등록 방식**: 각 `tools/*.py`가 import 시점에 `registry.register(name, toolset, schema, handler, check_fn, requires_env, is_async, description, emoji, max_result_size_chars, dynamic_schema_overrides, override, scope)`를 부른다 (`tools/registry.py:666`). 최상위에 `registry.register()` 호출이 있는 파일은 AST로 찾아 자동 import한다 (`tools/registry.py` `discover_builtin_tools`, `tools/AGENTS.md` "Registry and discovery"). 패키지형 tool은 `tools/<pkg>/tool.py`만 scan한다.
- **core tool 목록**: `_HERMES_CORE_TOOLS` 약 55개 이름 (`toolsets.py:11`). 묶음별로 보면 web(`web_search`, `web_extract`), terminal(`terminal`, `process_manage`), file(`read_file`, `write_file`, `patch`, `search_files`), vision/image, skills(`skills_list`, `skill_view`, `skill_manage`), browser(`browser_navigate` 등 13개), `todo_list`, `memory`, `session_search`, `clarify`, `execute_code`, `delegate_task`, `cronjob_manage`, `kanban_*` 12개, `computer_use`, `manage_connections`이다.
- **이름**: 전부 snake_case. 접두사는 없다. 이름에 toolset이 드러나는 것은 `browser_*`, `kanban_*`, `feishu_*` 정도다. MCP tool의 model-facing 이름 규칙은 확인 못함. toolset 이름은 `mcp-<server>`이고 server 이름 alias가 따로 등록된다 (`tools/delegate_tool_toolsets.py:_is_mcp_toolset_name`).
- **schema 모양**: OpenAI function 꼴 `{"type":"function","function":{name, description, parameters}}`. `registry.get_definitions`가 이름순(`sorted(tool_names)`)으로 내보낸다 (`tools/registry.py:849`). cache 때문에 순서를 고정한 것으로 보인다(주석에 명시된 이유는 확인 못함). 요청 때마다 `dynamic_schema_overrides()`의 dict를 schema에 shallow merge한다 (`tools/registry.py:860`). 예: `delegate_task`의 description에 현재 동시 child 수 한도를 넣는다.
- **tool 설명 쓰는 법**: 길고 지시적이다. 예: `read_file`은 "Use this instead of cat/head/tail in terminal"로 쉘 명령 대신 쓰게 하고, `write_file`은 "OVERWRITES... call read_file first"를 적는다 (`tools/file_tools.py:1161`, `:1175`). 규칙(`tools/AGENTS.md`): schema description에 **다른 toolset의 tool 이름을 쓰지 않는다**. 그 tool이 꺼져 있으면 model이 없는 tool을 부르기 때문이다. 교차 참조가 필요하면 `get_tool_definitions()`에서 사용 가능한 tool 집합을 보고 동적으로 덧붙인다 (`model_tools.py` `_rewrite_*` 함수들, 예: `_rewrite_browser_navigate`).
- **읽기·쓰기·외부 효과 표시**: `ToolEntry`에 readOnlyHint류 필드가 **없다** (`tools/registry.py` `ToolEntry` dataclass; `read_only`/`destructive`/`annotations` grep 결과 없음). 대신 두 가지가 있다. (a) `check_fn`/`requires_env`는 "쓸 수 있는가(자격 증명, opt-in)"만 답하고 session 표면과 무관해야 한다 (`tools/AGENTS.md`). (b) 위험은 tool 단위가 아니라 **명령 내용 단위**로 본다. `tools/approval.py`가 terminal 명령을 `detect_dangerous_command`/`detect_hardline_command` 패턴으로 검사하고, 승인 mode(`/approvals`, `/yolo`)로 사람에게 묻는다 (`hermes_cli/commands.py` `approve`, `deny`, `yolo`, `approvals`).
- **결과 모양**: 모든 handler는 JSON 문자열을 돌려준다. 이미지를 model에게 줄 때만 `{"_multimodal": True, "content": [...], "text_summary": ...}` 꼴이 허용된다 (`tools/AGENTS.md`). 오류 본문은 2048자로 자른다 (`tools/registry.py:_MAX_TOOL_ERROR_CHARS`).
- **tool 수 관리**: "core tool 추가의 문턱이 높다"가 원칙이다 (`AGENTS.md` "narrow waist", footprint ladder). 확장은 CLI 명령 + skill, service-gated tool, plugin, MCP 순으로 우선한다. MCP/plugin tool이 context의 일정 비율을 넘으면 `tool_search`/`tool_describe`/`tool_call` 세 bridge tool로 바꿔치고 목록만 보여준다 (progressive disclosure, `tools/tool_search.py` docstring, `model_tools.py:523`).

### 1.2 agent·role·mode별 tools

Hermes에는 `plan`/`act` 같은 mode로 tool을 가르는 장치가 **없다**. 가르는 축은 네 가지다.

1. **toolset과 platform별 선택**. `TOOLSETS` dict (`toolsets.py:74`)는 `{description, tools, includes}`다. `includes`로 다른 toolset을 참조한다. 이름 있는 묶음은 두 부류다.
   - 기능 묶음: `web`, `file`, `terminal`, `browser`, `skills`, `todo`, `delegation`, `kanban` 등.
   - posture·platform 묶음: `coding`(`posture=True`, 코딩 작업 때 자동 선택, `toolsets.py` `"coding"` 항목), `hermes-cli`, `hermes-telegram`, `hermes-acp`(coding 묶음에서 `clarify` 뺌), `hermes-api-server`, `hermes-webhook`(`web_search`, `web_extract`, `vision_analyze`, `clarify`만. 주석: webhook payload는 신뢰할 수 없으니 file·system 실행 금지, `toolsets.py:42`).
   - `config.yaml`의 `platform_toolsets.<platform>: [...]`로 platform마다 고른다 (`cli-config.yaml.example:1409`).
2. **선택 계산 규칙**. `enabled_toolsets`를 먼저 더하고, `disabled_toolsets`를 **마지막에 뺀다** (`model_tools.py:316` `_select_tool_names`). 그래서 composite를 켜도 꺼진 toolset의 tool은 빠진다. 그 뒤 `check_fn`이 실패한 tool을 거르고 (`tools/registry.py:853`), 이름순으로 정렬한다.
3. **session 종류별 제한**. `TOOLSET_SESSION_PLATFORMS`로 `desktop_ui`, `project`, `catalog`, `onboarding` 같은 toolset은 해당 client session에만 붙는다 (`toolsets.py` `platforms=frozenset({"desktop"})`). 원칙: "capability is a property of the SESSION" (`AGENTS.md`). kanban worker는 dispatcher가 환경변수 `HERMES_KANBAN_TASK`를 줄 때 `kanban` toolset이 강제로 들어간다 (`model_tools.py:322`).
4. **subagent (`delegate_task`)**. child의 toolset은 **parent의 부분집합**이다 (`tools/delegate_tool_toolsets.py` `_resolve_child_toolsets`). 규칙:
   - 명시한 `toolsets`는 parent의 (composite 풀린) 집합과 교집합. 지정이 없으면 parent의 enabled를 상속한다.
   - child가 절대 못 받는 tool: `delegate_task`(재귀 위임 금지), `clarify`(사용자 상호작용 금지), `memory`(공유 MEMORY.md 쓰기 금지), `send_message`, `cronjob_manage` (`DELEGATE_BLOCKED_TOOLS`, 같은 파일 14줄). 이 이름들만 가진 toolset과 `delegation`/`kanban`도 뺀다.
   - role: `leaf`(기본)와 `orchestrator`. orchestrator는 `delegation`을 role로 다시 받는다. 깊이는 `delegation.max_spawn_depth` 설정이고 기본은 flat이다 (`tools/delegate_tool_config.py:21` `MAX_DEPTH = 1`).
   - 현재 model-facing schema(`tools/delegate_tool.py:691`)는 `tasks[{goal, context, output_schema, images, group}]`, `action(spawn|list|steer|stop)`, `subagent_id`, `message`만 노출한다. 예전에 있던 per-task `role`과 `toolsets`는 "legacy, ignored: capability is depth-derived"이고 **광고하지 않는다**(주석 `:703-706`). 즉 model이 child의 tool을 고르지 못하고, 깊이와 설정이 정한다.
   - 실행 중 제어: 위 `action`으로 child 목록, steer(다음 tool 결과에 지시를 덧붙임), stop을 한다 (`delegate_tool.py:752-766`).
5. **profile**. profile은 별도 `HERMES_HOME` 디렉터리로, 각자 `config.yaml`, `.env`, `SOUL.md`, memory, session, skill, cron을 가진다 (`website/docs/user-guide/profiles.md`). kanban worker lane은 profile 이름이 곧 assignee이고, `--description "<role>"`로 orchestrator가 일을 라우팅할 근거를 준다 (같은 문서 "Blank profile", `website/docs/user-guide/features/kanban-worker-lanes.md`). dispatcher는 `hermes -p <assignee> chat -q <prompt>`로 worker를 띄우고 환경변수 `HERMES_KANBAN_TASK` 등을 준다. 즉 Hermes에서 "role마다 tool과 지침이 다른 agent"에 가장 가까운 것은 **profile = (config의 toolset + SOUL.md + skills + memory) 묶음**이다.

### 1.3 지침(instructions)

- **identity**: `~/.hermes/SOUL.md`(profile 안)가 prompt의 첫 위치(identity slot #1)다. 없거나 비면 코드의 `DEFAULT_AGENT_IDENTITY`를 쓴다 (`agent/system_prompt.py:544` `_identity_parts`, `agent/prompt_builder.py:159`). cwd의 SOUL.md는 읽지 않는다 (`website/docs/user-guide/features/personality.md`). 사용자 본인의 SOUL.md는 injection scan에 걸려도 경고만 하고 읽는다. 저장소에서 온 파일은 걸리면 BLOCKED로 대체된다 (`prompt_builder.py:84-95`).
- **project 지침**: **한 종류만** 읽는다. 먼저 찾은 것이 이긴다. `.hermes.md`/`HERMES.md`(git root까지 올라가며 가장 가까운 것) → `AGENTS.md` chain → `CLAUDE.md`(cwd만) → `.cursorrules` + `.cursor/rules/*.mdc`(cwd만) (`agent/prompt_builder.py:1848-1874` `build_context_files_prompt`).
  - `AGENTS.md`는 git root부터 cwd까지 **디렉터리마다** 읽어 합친다. 각 디렉터리에서 `AGENTS.override.md` > `AGENTS.md` > `agents.md` 중 첫 번째 비어 있지 않은 것 하나 (`prompt_builder.py:1728-1733`, `:1804-1825`). 깊을수록 나중에 오고 우선한다 (`website/docs/user-guide/features/context-files.md`). git 밖이면 cwd만 본다.
  - 하위 폴더: 시작 때는 cwd만 읽고, agent가 tool로 다른 폴더를 만지면 그 폴더의 `AGENTS.md`/`CLAUDE.md`/`.cursorrules`를 **tool 결과에 덧붙인다**. system prompt는 건드리지 않아 cache가 유지된다 (`agent/subdirectory_hints.py` docstring; 파일명 `:20`, 폴더당 상한 `_MAX_HINT_CHARS = 32_000` `:26`). 심볼릭 링크가 working dir 밖을 가리키면 거부한다.
- **크기 제한**: context file마다 `CONTEXT_FILE_MAX_CHARS = 20_000`이 바닥이고, 설정이 없으면 model window의 6%(`CHARS_PER_TOKEN`로 환산)로 늘어나 500K까지 간다 (`prompt_builder.py:1152-1167`). 넘으면 앞 70%, 뒤 20%를 남기고 가운데를 자른다 (`CONTEXT_TRUNCATE_HEAD_RATIO`/`TAIL_RATIO`). 잘림은 chat에 경고로 뜬다 (`drain_truncation_warnings`). 이 repo 자신의 `AGENTS.md`는 루트 12k자, 루트에서 하위까지 chain 30k자로 CI가 제한한다 (`AGENTS.md` 첫 문단).
- **계층**: 전역은 SOUL.md뿐이다(전역 AGENTS.md 개념은 확인 못함). project는 위 chain. agent별은 profile(별도 HERMES_HOME의 SOUL.md)이다. subagent는 `skip_context_files=True`로 만들어져 SOUL.md와 memory를 받지 않고(`delegate_tool.py:277-279`), 대신 workspace 경로가 확실할 때만 project context file을 child system prompt에 직접 넣는다(SOUL.md 제외, `tools/delegate_tool_progress.py:197-208`).
- **personality overlay**: `/personality`로 이름을 고르면 문자열이 `ephemeral_system_prompt`로 간다. 내장 14개(helpful, concise, technical, creative, teacher, kawaii 등) + `agent.personalities`/`personalities:`로 사용자가 추가한다. 값은 문자열이거나 `{system_prompt, tone, style, description}` (`hermes_cli/personality.py:19-31`, `:58-67`, `cli-config.yaml.example:1331-1342`). 선택한 이름은 `display.personality`에 저장한다.
- **prompt 안의 위치**: 위 모두 **system prompt**에 들어간다. 예외가 둘이다. 하위 폴더 hint는 tool 결과에, skill 호출은 user message에 들어간다(1.6).

### 1.4 prompt assemble

- **구조**: system prompt를 session 시작에 **한 번** 짜서 재사용한다. 다시 짜는 것은 context 압축 뒤뿐이다. prefix cache를 지키려는 것이다 (`agent/system_prompt.py` docstring 1-10, `build_system_prompt` `:796`). "Per-conversation prompt caching is sacred"가 두 불변식의 하나다 (`AGENTS.md`). system prompt 상태를 바꾸는 slash command는 다음 session까지 미루고, `--now`를 줘야 즉시 적용한다.
- **세 tier** (`agent/system_prompt.py:730-793` `build_system_prompt_parts`, `\n\n`으로 합침):

  | tier | 내용 (순서대로) |
  |---|---|
  | stable | identity(SOUL.md 또는 기본) → hermes 도움말 안내 → 공통 guidance(task completion, parallel tool call) → tool 존재에 따른 guidance(memory, session_search, skills, kanban) → steer 안내 → model별 guidance(tool-use enforcement, execution guidance, `_model_gate`) → 고정 skill(`skills.auto_load`) → coding 모드 brief |
  | context | `system_message`(호출자 제공) → project context files(`# Project Context ...`) → workspace snapshot(git probe, session마다 고정) → platform hint 등 |
  | volatile | skills index → memory → USER.md → 외부 memory → plugin section → profile 한 줄 → timestamp 줄 → runtime environment(`<!-- Hermes runtime environment -->` 블록) |

  worktree에 따라 달라지는 블록은 project context 뒤에 둬서, 공유 context file이 가장 긴 공통 prefix 안에 남게 한다.
- **tools**: system에 안 넣고 API의 tools 배열로 보낸다. 배열은 이름순이다. model 쪽 규칙(위 1.1)대로 존재하지 않는 tool은 prompt에서 언급하지 않는다. guidance 블록은 해당 tool이 로드됐을 때만 들어간다 (`_tool_guidance_block` `:274`).
- **동적 환경 정보**: 날짜·시각은 volatile tier의 timestamp 줄 (`_timestamp_line` `:489`). cwd·OS·git은 environment probe 한 줄(`tools/env_probe.py`, `agent.environment_probe` 설정)과 workspace snapshot에 있다. 이 중 workspace snapshot 바이트는 session 동안 고정하고, cwd가 바뀔 때만 다시 probe한다 (`:660-690`).
- **API 호출 시점에만 붙는 것** (`agent/turn_context.py:1237-1342` `build_api_messages`): memory prefetch와 `pre_llm_call` hook이 만든 context(현재 user turn에만), `ephemeral_system_prompt`(= personality, system 뒤에 `\n\n`으로 이어 붙임 `:1341`). 저장된 `messages`는 건드리지 않는다. 과거 user/assistant 행은 실제로 보낸 바이트(`api_content` sidecar)를 그대로 재생해 prefix를 안정시킨다.
- **끼워 넣기(reminder)**: steer(`/steer`)는 다음 tool 결과 안에 덧붙는다. 하위 폴더 hint도 tool 결과에 덧붙는다. 별도의 `<system-reminder>` 같은 user message 주입은 확인 못함.
- **compact**: `/compress`(별칭 `/compact`)와 자동 압축. 요약 message는 `[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted ... treat it as background reference, NOT as active instructions ... Respond ONLY to the latest user message that appears AFTER this summary`로 시작한다 (`agent/context_compressor.py:251-266`). 압축 때만 system prompt를 다시 짠다. 압축으로 잃은 skill은 `[SKILL_PRUNED]` 표시를 달고, 다시 `skill_view`로 읽으라고 안내한다 (`prompt_builder.py` `SKILLS_GUIDANCE` `:258`). 진행 중인 작업은 `[STILL IN PROGRESS ...]` 머리말로 요약 뒤에 다시 붙인다 (`context_compressor.py:516`).
- **subagent prompt**: `"You are a focused subagent working on a specific delegated task."` + CONTEXT + WORKSPACE PATH + (선택)project context files + 완료 지침, orchestrator면 위임 능력 블록 추가 (`tools/delegate_tool_progress.py:178-217`). goal은 system이 아니라 child의 첫 user turn으로 보낸다(같은 파일 185-187 주석). child는 `ephemeral_system_prompt=child_prompt`로 만든다 (`delegate_tool.py:277`).

### 1.5 commands (slash command)

- **정의 꼴**: `COMMAND_REGISTRY: list[CommandDef]` 한 곳에 코드로 등록한다 (`hermes_cli/commands.py:45`, `:83`). 필드: `name`, `description`, `category`, `aliases`, `args_hint`, `subcommands`, `cli_only`, `gateway_only`, `gateway_config_gate`, `busy_policy`(`dispatch`|`reject`|`interrupt_then_dispatch`: agent가 일하는 중 들어온 명령의 처리), `busy_handler`, `execute`(`hermes_cli.slash_exec.EXECUTORS`의 key), `desktop` 등. CLI 도움말, gateway dispatch, Telegram BotCommands, Slack 매핑, 자동완성이 전부 이 registry에서 나온다.
- **built-in 목록** (약 100개, 범주별): Session(`new`, `clear`, `history`, `save`, `retry`, `undo`, `title`, `branch`, `compress`/`compact`, `rollback`, `snapshot`, `stop`, `bg`, `btw`, `queue`, `steer`, `goal`, `loop`, `heartbeat`, `agents`...), Configuration(`config`, `model`, `personality`, `reasoning`, `fast`, `yolo`, `approvals`...), Tools & Skills(`tools`, `toolsets`, `skills`, `memory`, `bundles`, `learn`, `init`, `cron`, `kanban`, `curator`, `reload-skills`, `reload-mcp`), Info(`help`, `status`, `context`, `usage`, `insights`), Exit.
- **종류별로 model에 가는지**:
  - harness에서만 처리 (model 안 감): `/new`, `/clear`, `/status`, `/context`, `/model`, `/tools`, `/toolsets`, `/stop` 등. `execute`가 `slash_exec`의 executor를 가리킨다.
  - 정해진 prompt를 **일반 turn으로** model에 보냄: `/plan`은 `build_plan_prompt(task)`가 만든 "PLAN MODE — planning only" 규칙 + 계획 작성 지침 + 저장 경로(`.hermes/plans/YYYY-MM-DD_HHMMSS-<slug>.md`)를 user turn으로 보낸다. "no engine and no model-tool footprint", system prompt와 history를 건드리지 않는다(cache 안전) (`agent/plan_prompt.py` docstring, `:60`). `/learn`, `/review`(독립 subagent를 띄워 작업을 리뷰), `/refine`, `/goal`, `/loop`도 같은 식이다. `/init`은 repo scan으로 `AGENTS.md`를 만들거나 고친다 (`hermes_cli/init_command.py`).
  - skill 실행: 모든 skill이 `/<skill-name>`이 된다. 내장 명령과 이름이 겹치면 skill 쪽이 밀린다 (`agent/skill_commands.py`, `slash_exec.py:149` collision note). skill 본문이 `[IMPORTANT: The user has invoked the "<name>" skill ...The full skill content is loaded below.]` 머리말과 함께 **user message**로 들어간다 (`skill_commands.py:45-47`, `_build_skill_message` `:328`). 뒤에 `[Skill directory: ...]`, supporting file 목록, 사용자가 덧붙인 지시가 온다. 이름 하나로 skill 여러 개를 묶는 `/bundles`도 있다.
  - plugin, MCP prompt: plugin이 command를 등록한다(`/plugins`). MCP prompt의 slash 노출 여부는 확인 못함.
  - 사용자 정의 command: 별도 command 파일 포맷은 확인 못함. 사용자가 직접 만드는 길은 skill(`SKILL.md`)과 `personalities`다.

### 1.6 skills

- **꼴**: 디렉터리 + `SKILL.md`(YAML frontmatter) + 선택 `scripts/`, `references/`, `templates/`. frontmatter: `name`, `description`, `version`, `author`, `license`, `platforms`(OS 제한), `metadata.hermes.{tags,category,related_skills,config}` (`skills/AGENTS.md` "SKILL.md frontmatter"). `metadata.hermes.config`는 skill이 요구하는 설정을 `skills.config.<key>`에 저장하고 로드 때 주입한다. 이 repo는 `description`을 **60자 이하 한 문장**으로 강제한다(시험으로 검사, 같은 문서의 "Authoring standards").
- **built-in**: `skills/`는 기본 활성이고 카테고리별 14개 폴더(software-development, research, productivity, devops, creative, email, media, note-taking, social-media, web, apple, autonomous-ai-agents 등)다. `optional-skills/`는 함께 배포하지만 활성이 아니다. `hermes skills install official/<category>/<skill>`로 설치한다. 카테고리별 `DESCRIPTION.md`가 index에 카테고리 설명을 준다 (`prompt_builder.py:1387`).
- **찾는 위치와 우선순위** (`agent/skill_utils.py:384-403` `get_skill_search_roots`): project(신뢰한 프로젝트의 skills 디렉터리) > local(`~/.hermes/skills/`) > `skills.create_dir` > `skills.external_dirs`. 같은 이름은 높은 tier가 이기고, 같은 tier 안의 중복은 상대 경로로 구분한다. 프로젝트 skill은 `hermes skills trust`로 repo를 신뢰해야 켜지고, 신뢰해도 skills_guard가 scan해 `dangerous`면 index, 목록, view, slash command에서 뺀다 (`skill_utils.py:576-601`).
- **prompt에 넣는 법**: 이름과 한 줄 설명만 volatile tier의 `## Skills` index에 넣는다 (`<available_skills>` 블록에 `카테고리: 설명` 아래 `- name: desc`). 본문은 model이 `skill_view(name)` tool로 읽는다 (`prompt_builder.py:1352-1470`). 안내문은 강하다: "If a skill matches or is even partially relevant to your task, you MUST load it with skill_view(name)". coding 모드에서는 코딩과 무관한 카테고리를 이름만 남긴다("[names only]"). 숨기지는 않는다. `skills.auto_load`로 지정한 skill은 stable tier에 본문까지 미리 넣는다 (`system_prompt.py:317`, 단 context file을 건너뛰는 agent에는 적용 안 함).
- **만들고 고치기**: `skill_manage` tool(patch, edit, write_file, delete 등)로 agent가 skill을 만들고 고친다. `SKILLS_GUIDANCE`가 "non-trivial workflow는 skill로 기록"을 시킨다. 백그라운드 curator가 `created_by: "agent"` skill의 사용량(`.usage.json`)을 보고 오래된 것을 archive한다(삭제 안 함, pinned 제외) (`skills/AGENTS.md` "Curator").
- **끄고 켜기**: `skills.disabled`, `skills.platform_disabled.<platform>` (`skill_utils.py:261-273`). 일부 `ESSENTIAL_SKILLS`는 끌 수 없다. `/reload-skills`로 다시 scan한다. skill 목록이 바뀌어도 prefix cache를 지키려고 index는 volatile tier의 맨 앞에 둔다.

### 1.7 role·mode별 tool과 지침 요약 (Hermes)

- tool을 가르는 단위: toolset(`enabled`에서 더하고 `disabled`는 마지막에 뺌) × platform × session 종류(desktop 전용 등) × `check_fn`. subagent는 parent 부분집합 − 금지 목록. model이 child의 tool을 고르지 못하게 일부러 광고하지 않는다.
- 지침을 가르는 단위: profile(별도 HERMES_HOME의 SOUL.md, skills, memory), personality overlay(ephemeral, system 뒤에 붙음), 모델별 guidance gate, kanban worker면 `KANBAN_GUIDANCE` 블록(해당 tool이 있고 dispatcher가 준 task일 때만, `system_prompt.py:285-292`).
- 고정 mode는 없다. 대신 "posture"(`coding`)가 session의 작업 공간(코드 repo인지)을 보고 자동 선택된다 (`agent/coding_context.py`, 세부는 확인 못함).

---

## 2. Goose

Goose는 "general-purpose AI agent"로 자기를 소개한다 (`crates/goose/src/prompts/system.md:1`). coding은 기본 켜진 `developer` extension이 맡을 뿐이다. 능력의 단위는 **extension**(MCP server 또는 in-process platform extension)이고, 반복 가능한 작업 정의의 단위는 **recipe**(YAML)다. 최근 구조는 `goose-agent` crate의 `Operation` trait 파이프라인이다.

### 2.1 공통 tools

- **extension 종류** (`crates/goose/src/agents/extension.rs:156-257` `ExtensionConfig`): `stdio`(MCP, 자식 process), `streamable_http`(MCP, URL), `builtin`(번들 MCP server), `platform`(agent process 안에서 직접 도는 것). 공통 필드: `name`, `description`, `timeout`, `bundled`, **`available_tools`**(tool 이름 allowlist. 비면 전부 노출, `extension.rs:363` `is_tool_available`).
- **기본 platform extension** (`crates/goose/src/agents/platform_extensions/mod.rs:29-230`, `default_enabled` 표시):

  | 이름 | 기본 | tool 이름이 접두사 없음 | 설명 |
  |---|---|---|---|
  | developer | 켬 | 예 | 파일 쓰기, 편집, shell |
  | summon | 켬 | 예 | `load`, `delegate` |
  | skills | 켬 | 예 | skill 목록·로드 |
  | analyze | 켬 | 예 | tree-sitter 코드 분석 |
  | extensionmanager | 켬 | 아니오 | extension 검색·켜기·끄기 |
  | apps | 켬 | 아니오 | HTML 앱 만들기 |
  | tom (Top Of Mind) | 켬 | 아니오 | 환경변수로 매 turn context 주입 |
  | scheduler | 켬(hidden) | 아니오 | recipe 예약 실행 |
  | todo, chatrecall, summarize, code_execution | 끔 | | |

- **developer의 tool** (`platform_extensions/developer/mod.rs:107-190`): `write`, `edit`(before/after 정확 일치 교체), `shell`, `tree`, `read_image`. 파일 읽기 전용 tool은 없다. 안내는 "읽을 땐 cat이나 sed(shell)를 쓰고, 항상 읽고 나서 편집"이다 (instructions 문자열 `:40-65`).
- **이름 짓기**: MCP·platform tool은 `<extension key>__<tool>` 꼴이고 (`agents/extension_manager/mod.rs:321-322`), `unprefixed_tools: true`인 platform extension은 접두사 없이 노출한다. model이 `__`를 `.`로 바꿔 부르는 경우를 복구하는 코드가 있다 (`:449-471`). 두 unprefixed extension이 같은 tool 이름을 가지면 모호하다고 시험으로 못 박아 두었다 (`:2420`).
- **schema 모양**: MCP `Tool{name, description, input_schema, output_schema?, annotations?, meta}`. `schemars`로 Rust struct에서 JSON schema를 만든다 (`developer/mod.rs` `schema::<T>()`). model에 내보내기 전에 `normalize_input_schema`로 정규화한다 (`extension_manager/mod.rs:331`, `agents/tool_schema_normalize.rs`).
- **annotation**: MCP `ToolAnnotations`를 쓴다. `from_raw(title, read_only, destructive, idempotent, open_world)` 다섯 값. 예: `write`와 `edit`는 (read_only=false, destructive=true, idempotent=false, open_world=false), `shell`은 (false, true, false, **true**), `tree`는 (true, false, true, false), `read_image`는 (false, false, true, true) (`developer/mod.rs:112-186`). **이 annotation이 실제로 쓰인다**. `smart_approve` mode에서 `read_only_hint == true`인 tool은 승인 없이 통과시키고, annotation이 없으면 LLM에게 "이 요청은 읽기 전용인가"를 묻는 보조 tool(`permission_judge`)로 판정한다 (`permission/permission_inspector.rs:52-63`, `:172-186`, `permission/permission_judge.rs:41-88`).
- **tool 설명 쓰는 법**: 한두 문장. `delegate`처럼 사용법과 주의(공유 파일 충돌)를 같이 쓰는 경우도 있다 (`summon.rs:510-523`). 사용 요령은 tool 설명보다 **extension의 `instructions`**에 쓴다 (developer가 그렇다). 그 instructions는 system prompt의 `# Extensions` 절로 간다(2.4). 문서가 권고하는 상한: "총 25개 미만의 tool을 켜라" (`documentation/docs/guides/managing-tools/tool-permissions.md`).
- **MCP 지원 범위**: elicitation, roots 문서가 있다 (`documentation/docs/guides/mcp-elicitation.md`, `mcp-roots.md`). 세부는 확인 못함.

### 2.2 agent·role·mode별 tools

Goose는 mode별 tool 가름이 아니라 **세션이 켠 extension 집합 + 승인 mode + recipe**로 가른다.

1. **extension 집합이 곧 tool 집합**. session은 `EnabledExtensionsState`(활성 extension 목록)를 가진다. extension 안에서는 `available_tools`로 일부만 노출할 수 있다. `extensionmanager` platform extension이 있어 model이 실행 중에 extension을 찾고 켜고 끌 수 있다 (`ext_manager.rs`, system prompt "You can dynamically enable or disable extensions").
2. **승인 mode** (`GooseMode`, `crates/goose-provider-types/src/goose_mode.rs:22`): `auto`(자동 승인, 기본), `approve`(매 tool 호출마다 묻음), `smart_approve`(민감한 호출만 묻음), `chat`(tool 호출 없음. system prompt에 "chat only mode, no access to any tool use" 문구가 추가됨, `prompt_manager.rs:160-166`). 이 mode는 tool 목록을 줄이지 않고 **실행 전 검사**를 바꾼다. `chat`에서 model이 tool을 불러도 실행하지 않고 "skipped" 응답을 준다 (`CHAT_MODE_TOOL_SKIPPED_RESPONSE`, `agents/tool_execution.rs:155`).
3. **tool별 permission**: `permission.yaml`의 `always_allow`/`ask_before`/`never_allow` 목록 (`crates/goose/src/config/permission.rs:13-32`). `approve`/`smart_approve`에서만 의미가 있다 (`documentation/docs/guides/managing-tools/tool-permissions.md`). 또 `ToolPermissionStore`가 "이 인자로 허용" 같은 호출 단위 허용을 hash로 기억한다 (`permission/permission_store.rs`).
4. **tool inspector 파이프라인**: `ToolInspector` trait(`inspect(session, tool_requests, messages, mode) -> Allow | Deny | RequireApproval`)를 여러 개 순서대로 돌린다 (`tool_inspection.rs`). 권한 판단, 보안 scan 등이 이 틀 위에 꽂힌다.
5. **recipe = role 정의**. recipe는 `instructions`, `prompt`, `extensions`, `settings{goose_provider, goose_model, temperature, max_turns}`, `parameters`, `response{json_schema}`, `sub_recipes`, `retry`를 가진 YAML이다 (`crates/goose/src/recipe/mod.rs:34-` `Recipe`, `documentation/docs/guides/recipes/recipe-reference.md`). recipe가 `extensions`를 **명시하면 그 목록만** 쓴다. 기본 platform extension(예: `summon`)도 자동으로 안 들어오니 필요하면 목록에 넣어야 한다 (`recipe-reference.md:178`). `response.json_schema`가 있으면 `final_output` tool이 추가돼 구조화된 결과를 강제한다 (`agents/final_output_tool.rs`, `ops_recipe.rs:71-` `recipe_prompt_parts`).
6. **custom agent 파일 = 가벼운 role**. `~/.agents/agents/*.md`, `<project>/.agents/agents/*.md`(호환: `.goose/agents/`, `.claude/agents/`, `~/.goose/agents/`, `~/.claude/agents/`, config 디렉터리의 `agents/`, `summon.rs:277-286`). frontmatter는 `name`(필수), `description`, `model`뿐이고 본문이 지침이다 (`summon.rs:85-92` `AgentMetadata`, `documentation/docs/guides/context-engineering/custom-agents.md`). **agent 파일은 tool을 따로 정의하지 못한다**. 문서도 "agent file itself does not define a separate MCP server list"라고 쓴다. tool을 고정하려면 recipe를 써야 한다.
7. **subagent (`delegate` tool)** (`summon.rs:460-523`, `:840-` `handle_delegate`): 인자는 `instructions`, `source`(recipe/agent 이름), `parameters`, **`extensions`**(이름 배열. 생략하면 parent의 것을 전부 상속, 빈 배열이면 none), `provider`, `model`, `temperature`, `max_turns`, `context`, `working_dir`이다. 그러니 "이 subagent는 developer extension만"이 호출 때 정해진다. subagent session은 `SessionType::SubAgent`이고, **subagent는 delegate를 못 한다**("Delegated tasks cannot spawn further delegations", `summon.rs:852`). `max_turns` 기본 25 (`agents/subagent_task_config.rs:9`), 환경변수 `GOOSE_SUBAGENT_MAX_TURNS`, 모델은 `GOOSE_SUBAGENT_MODEL`/`PROVIDER`로 바꾼다. subagent는 항상 `final_output` 구조(`{summary: string}` 기본)로 결과를 돌려준다 (`summon.rs:924-940`). subagent의 system prompt는 `subagent_system.md`로 **교체**된다(override) (`subagent_handler.rs:58-67`).

### 2.3 지침(instructions)

- **hints 파일**: 이름은 `.goosehints`와 `AGENTS.md` 두 개가 기본이다. `CONTEXT_FILE_NAMES` 설정으로 바꾼다(예: `CLAUDE.md` 추가) (`crates/goose/src/hints/load_hints.rs:13-26`).
- **층**: 전역 → project. 전역은 config 디렉터리(`~/.config/goose/`)의 hints 파일들과 `~/.agents/AGENTS.md`. project는 **git root부터 cwd까지 각 디렉터리**의 파일을 root가 먼저, cwd가 나중으로 모은다 (`load_hints.rs:232-310` `load_hint_files`, `get_local_directories`). git 밖이면 cwd만. `.gitignore`에 걸린 파일은 건너뛴다(`build_gitignore`). 합칠 때 머리말은 `### Global Hints / These are my global goose hints.`, `### Project Hints / These are hints for working on the project in this directory.`. 충돌 시 로컬이 우선이라고 문서가 안내한다(`using-goosehints.md`). 코드는 단순 이어 붙이기다.
- **@import**: hints 파일 안의 `@경로`로 다른 파일을 끌어온다. 깊이 3, 참조 64번, 확장 결과 합계 1MB, 파일당 128KB까지다. import 경계는 git root (`hints/import_files.rs:14-17`, `:296-302`).
- **하위 폴더 hint**: `SubdirectoryHintTracker`가 이전 tool 호출의 `path`/`command` 인자를 보고 cwd 아래 다른 폴더를 만졌으면 그 폴더 경로의 hints를 `### Subdirectory Hints (<dir>)`로 읽는다 (`load_hints.rs:29-170`). 이건 system prompt의 `prompt_parts`(key `subdir_hints:<dir>`)로 들어가므로 **system prompt가 session 중간에 달라진다** (`ops_toolcalling.rs:857-907`). Hermes는 tool 결과에 덧붙여 system prompt를 지키는 것과 다르다.
- **recipe `instructions`**: system prompt의 "Additional Instructions"에 추가 블록(key `recipe`)으로 들어간다 (`ops_recipe.rs:71-81`).
- **system prompt 교체**: `Session.system_prompt_override`가 있으면 기본 `system.md` 대신 그것을 minijinja 템플릿으로 렌더한다 (`prompt_manager.rs:140-149`). 사용자가 `~/.config/goose/prompts/system.md` 등을 만들면 내장 prompt template을 덮어쓴다 (`documentation/docs/guides/context-engineering/prompt-templates.md`). 덮어쓸 수 있는 template: `system.md`, `compaction.md`, `permission_judge.md`, `subagent_system.md`, `tiny_model_system.md`, `session_name.md`, `apps_*.md`.
- **project**(별도 개념): session에 `project_id`가 있으면 `<dataDir>/projects/<slug>.md`의 이름·설명·본문을 `# Project: <name>`으로 넣는다 (`ops_project.rs`, `sources.rs`).
- **sanitize**: 모든 override와 extras에서 보이지 않는 Unicode tag 문자(U+E00xx)를 제거한다 (`utils::sanitize_unicode_tags`, `prompt_manager.rs`). prompt injection 대비다.
- **크기 제한**: hints 전체 상한은 위 import 한도 말고는 확인 못함.
- **prompt 안의 위치**: 전부 **system prompt** (맨 아래 `# Additional Instructions:` 절). 다만 시간·cwd·턴 예산은 별도 user message다(2.4).

### 2.4 prompt assemble

- **system prompt** (`agents/prompt_manager.rs:114-185` `build`): ① 기본 `system.md`(역할 한 줄 + `# Turn Context` 설명 블록 + `# Response Guidelines: Use Markdown`) 또는 override. ② 뒤에 `\n\n# Additional Instructions:\n\n` + extras를 `\n\n`으로 이어 붙임. extras는 `IndexMap<String,String>`이고 값 종류는 `skills`(skill 목록), `extensions`(각 extension의 이름·instructions), `project`, `recipe`, `final_output`, `subdir_hints:*`, `hints`, `chat_mode`다. 각 Operation이 `prompt_parts()`로 기여한다 (`goose-agent/src/operation.rs:118-124`). extras의 최종 순서는 operation 순서에 의존하며 정확한 순서는 확인 못함. `hints`는 마지막에 insert한다(`prompt_manager.rs:153-158`).
- **extension instructions**: `build_system_prompt`는 `without_extensions()`로 호출하고, 같은 내용을 `ToolExecutionOperation.prompt_parts`가 `# Extensions / ## <name> / ### Instructions ...`로 직접 만든다 (`ops_toolcalling.rs:884-906`). `skills` extension은 이 절에서 빠지고 따로 `# Skills`가 된다. 이름순으로 정렬해 cache를 안정시킨다 (`prompt_manager.rs:116-117` "Stable tool ordering is important for multi session prompt caching.").
- **tools**: Operation별 `inference_tools()`를 모아 API의 tools로 보낸다. skill 전용 `load_skill`은 `ToolExecutionOperation`에서 제외하고 `SkillOperation`이 따로 낸다 (`ops_toolcalling.rs:840-846`, `ops_skills.rs:310`).
- **동적 정보는 system이 아니라 user message(MOIM)로**: "Turn Context" 블록. `<turn-context>` 태그 안에 현재 시각(분 단위로 내림 `%Y-%m-%d %H:%M:00`), 작업 디렉터리, 압축 상태, turn 예산(`turns_taken/max_turns`), extension이 주는 context(`tom` extension의 `GOOSE_MOIM_MESSAGE_TEXT`/`_FILE`)를 넣는다 (`agents/moim.rs:57-125`). 메타데이터가 `agent_only().with_turn_context()`인 user message로 대화에 끼워 넣고, 이미 같은 내용이면 새로 넣지 않는다 (`inference_preparation.rs:71-82`). system prompt의 `# Turn Context` 절은 "이 블록은 goose가 만든 것이고 사용자의 요청이 아니다. 이전 turn의 블록은 기록일 뿐 가장 최근 블록만 현재"라고 model에게 설명한다 (`moim.rs:7-19`). context window가 32,000 미만인 model에는 이 블록을 안 넣는다 (`MIN_CONTEXT_FOR_MOIM`). `PromptManager`는 시각을 시간 단위로 내려서(`%H:00`) 들고 있지만, 현재 `system.md`는 그 값을 쓰지 않는다 (`system.md`에 `current_date_time` 변수가 없음).
- **cache 배치**: 안정적인 것(역할, extension 설명)을 system에 두고 매번 바뀌는 시각·예산은 말미의 user message로 뺐다. extension 이름순 정렬. subagent용 `with_cache_ttl_clamped()` (`summon.rs:1215`). cache control 표시의 세부는 확인 못함.
- **skills 노출**: `# Skills` 절에 `- name: description`을 한 줄씩 (`ops_skills.rs:62-82`). 본문은 `load_skill(name, args?)` tool로 읽는다. tool 설명: "Skills are listed in your system instructions. When you need to use one, load it first."
- **compact**: `/compact`(별칭 `/summarize`, "Please compact this conversation" 문구도 같은 명령으로 취급, `execute_commands.rs:10-14`) 또는 context 한도의 80%에서 자동 (`goose-context-management/src/lib.rs:32` `DEFAULT_COMPACTION_THRESHOLD = 0.8`). 요약 prompt는 `<analysis>` 뒤에 JSON 하나(`user_intent`, `technical_concepts`, `files[{path, summary, key_code}]`, `errors_and_fixes`, `problem_solving`, `user_messages`, `pending_tasks`, `current_work`, `next_step`)만 내라고 시킨다 (`goose-context-management/src/prompts/compaction.md`). turn context 블록에 `compaction` 상태를 담는다.
- **구조**: `StateMachine`이 `Operation` 목록을 순서대로 돌린다 (`state_machine_builder.rs:68-125`). Operation은 `run_command`(slash command 처리), `inference_tools`, `prompt_parts`, `moim_parts`, `run`을 선택적으로 구현한다. 즉 새 기능(skill, recipe, project, compaction, retry, max turns, 승인 등)이 prompt와 tool에 기여하는 길이 하나의 trait로 통일돼 있다.

### 2.5 commands (slash command)

- **built-in 9개** (`crates/goose/src/agents/execute_commands.rs:14-55`): `prompts`(MCP prompt 목록), `prompt`(MCP prompt 실행 또는 `--info`), `compact`, `clear`, `skills`(설치된 skill 나열), `doctor`, `goal`(끝내기 전에 만족해야 할 목표. 설정하면 turn이 시작됨), `grind`(max_turns까지 쫓는 목표), `status`. `goal`/`grind`만 agent turn을 시작한다 (`command_starts_turn`). 나머지는 harness에서 처리한다.
- **정의 꼴 둘**:
  - **recipe 명령**: config의 `slash_commands: [{command, recipe_path}]` (환경에서는 `SLASH_COMMANDS` JSON) (`documentation/docs/guides/context-engineering/slash-commands.md`, `slash_commands/recipe_slash_command.rs`). 호출하면 그 recipe가 실행된다.
  - **skill 명령**: 설치된 모든 skill이 `/skill-name`이 된다. `loaded_skill_context_with_args`가 만든 문자열(`# Loaded Skill: <name> (<type>)` + 본문 + supporting files)이 prompt로 간다. 인자는 frontmatter의 `arguments`(이름 배열)와 `argument-hint`로 치환한다 (`skills/mod.rs:112-190`, `slash_commands/skill_slash_command.rs:52-72`).
- **우선순위**: built-in > recipe > skill (`slash_command.rs` `merge_command_sources`, 시험 `builtin_names_never_run_as_recipes_or_skills`).
- **끄기**: `GOOSE_SLASH_COMMANDS_ENABLED` (`execute_commands.rs:3-6`).
- **`!` 쉘**: `ops_bang_shell.rs`가 있다(`!` 접두사의 쉘 직접 실행으로 보이나 세부 확인 못함).
- 그 외: 문서에는 `@agent-name` mention도 나온다 (`custom-agents.md`). 처리 위치는 확인 못함.

### 2.6 skills

- **꼴**: `<dir>/SKILL.md`, frontmatter `name`(소문자, 숫자, 하이픈. 64자 이하), `description`, `metadata`(자유 맵. agentskills.io 규격), 추가로 `arguments`, `argument-hint`. supporting files는 `load_skill(name: "<skill>/<상대 경로>")`로 읽는다 (`skills/mod.rs:34-48`, `:75-90`, `ops_skills.rs:36-39`, `:109-120`).
- **찾는 위치와 우선순위** (`skills/mod.rs:371-441` `all_skill_dirs_with_config`): 프로젝트 `.agents/skills`, `.goose/skills`, `.claude/skills` → 프로젝트 plugin의 skill → `~/.agents/skills` → goose config 디렉터리의 `skills/` → `~/.claude/skills`, `~/.config/agents/skills` → 사용자 plugin의 skill → built-in. 같은 이름은 먼저 본 것이 이기고(`seen` 집합) built-in이 가장 낮다 (`:609-644`). 쓰기 가능한 정규 위치는 `~/.agents/skills`와 `<project>/.agents/skills` (`:50-60`).
- **built-in skill**: `skills/builtins/`의 2개, `goose-doc-guide`(goose 문서 안내, `{{GOOSE_DOCS_ROOT}}` 치환)와 `web-search`.
- **prompt에 넣는 법**: 이름 + description 한 줄씩을 system의 `# Skills`에 ("Load one when it can help with the task or when the user asks for it"). 본문은 `load_skill`로 필요할 때 읽는다.
- **끄고 켜기**: `skills` platform extension 자체가 on/off 단위다 (`default_enabled: true`). skill 개별 토글은 확인 못함.
- **plugin**: `~/.agents/plugins/<name>/`, `<project>/.agents/plugins/<name>/`에 `plugin.json` + `hooks/hooks.json` + `skills/`. hook은 Open Plugins 규격을 따르는 외부 script다 (`documentation/docs/guides/context-engineering/hooks.md`, `plugins.md`). 이벤트별 hook 목록은 확인 못함.

### 2.7 role·mode별 tool과 지침 요약 (Goose)

- tool을 가르는 단위: session의 extension 집합(+ extension별 `available_tools`) × recipe의 `extensions` 명시 × `delegate`의 `extensions` 인자. 승인 mode(auto/approve/smart_approve/chat)와 permission.yaml은 tool을 숨기지 않고 **실행을 막거나 묻는다**. 읽기 전용 판정의 근거는 tool의 `readOnlyHint` annotation이다.
- 지침을 가르는 단위: recipe `instructions`(extra 블록), custom agent 파일 본문(`load`로 현재 대화에 읽어오거나 `delegate`로 별도 session에서 실행), session `system_prompt_override`(subagent와 사용자 override가 쓰는 경로), hints(global/project/subdirectory), extension instructions.
- role 하나 = recipe 하나로 보는 것이 가장 자연스럽다. recipe는 지침, extension(=tool), model, turn 한도, 결과 schema를 한 파일에 묶는다.

---

## 3. Cline

조사한 repo는 SDK 기반으로 다시 쓴 판이다 (`AGENTS.md`, "legacy repository root"라는 표현). agent loop는 `@cline/agents`(stateless), session·tool·plugin은 `@cline/core`, 계약은 `@cline/shared`에 있다 (`sdk/AGENTS.md` "Package Boundaries"). 이 SDK를 CLI(`apps/cli`), VS Code 확장(`apps/vscode`), desktop이 쓴다. `docs/`에는 옛 VS Code 시절 설명이 섞여 있어 문서와 코드가 어긋나는 곳이 있다(아래 3.2에 한 건).

### 3.1 공통 tools

- **기본 tool 9개** (`sdk/packages/core/src/extensions/tools/constants.ts`, `docs/tools-reference/all-cline-tools.mdx`): `read_files`, `search_codebase`, `run_commands`, `fetch_web_content`, `apply_patch`, `editor`, `skills`, `ask_question`, `submit_and_exit`. 한 session은 `editor`와 `apply_patch` 중 **하나만** 낸다. Act mode의 기본은 GPT/Codex 계열과 `openai-native` provider면 `apply_patch`, 아니면 `editor`다 (같은 문서; 규칙은 `model-tool-routing.ts`, `toolRoutingRules`로 바꿈).
- **이름**: snake_case 동사_목적어. 접두사 없음. MCP tool은 `${serverName}__${toolName}`으로 바꿔 부른다 (`sdk/packages/core/src/extensions/mcp/name-transform.ts:24`, 변환 함수는 설정 가능). 옛 이름(`read_file`, `replace_in_file`, `execute_command`, `use_skill`)은 기본 tool 이름이 아니다. 단 configured agent의 `tools:` 목록에서는 옛 이름을 새 이름으로 alias한다 (`runtime-builder.ts:108-113`, `resolveConfiguredAgentToolName`).
- **입력 schema**: zod로 쓰고 `zodToJsonSchema`로 변환한다. 호출 한 번에 여러 건을 받는 배열 입력이 기본이다. `read_files`는 경로 배열 또는 `{path, start_line, end_line}` 배열(한 호출로 여러 파일), `run_commands`는 명령 배열 (`definitions.ts:274-285`, `:516-523`; 설명에 "When you already know multiple files you need, read them together in one call"). system prompt도 같은 취지로 "한 응답에 독립적인 tool call을 전부 내라"고 한다 (`system/act.ts`).
- **tool 정의 필드** (`sdk/packages/shared/src/agent.ts:171-217`): `AgentToolDefinition{name, description, inputSchema, resultPolicy?: "cache-oversized", lifecycle?: {completesRun}}` + `AgentTool{executionMode?: "sequential"|"parallel", timeoutMs, retryable, maxRetries, execute(input, context)}`. 읽기 tool은 `retryable: true`, `maxRetries: 1`, 쓰기·실행 tool(`run_commands`, `editor`, `apply_patch`, `skills`)은 `retryable: false`로 둔다 (`definitions.ts`). `submit_and_exit`만 `lifecycle.completesRun`이다 (`:856`).
- **읽기/쓰기/권한 표시**: MCP 식 readOnlyHint **없음**. 대신 **tool 이름 단위 policy** `ToolPolicy{enabled?: boolean, autoApprove?: boolean}`가 있다 (`sdk/packages/shared/src/llms/tools.ts:7-17`). `toolPolicies: Record<name, ToolPolicy>`이고 `"*"`가 전체 기본값이다 (`session-runtime-orchestrator.ts:153-167`). `yolo` preset은 `"*"`와 모든 기본 tool을 `{enabled:true, autoApprove:true}`로 만든다 (`presets.ts:130-148`). docs의 설명: "위험한 tool(`run_commands`, write/edit)은 승인을 요구하고, 읽기·검색은 자동 승인"이 전형이라고 한다(`all-cline-tools.mdx`)(코드가 이 기본값을 강제하는 위치는 확인 못함).
- **tool 설명 쓰는 법**: `read_files`는 한계(줄 수·글자 수)와 페이지 넘기는 법까지 적는다 (`definitions.ts:276-282`). `skills`의 설명은 호출 시점마다 **현재 사용 가능한 skill 이름 목록을 getter로 덧붙인다**: "Available skills: a, b, c." (`definitions.ts:793-809`). `run_commands`는 쉘 종류에 맞춰 설명을 만든다 (`buildRunCommandsDescription`).
- **확장**: plugin이 `registerTool`, `registerCommand`, `registerRule`, `registerMessageBuilder`, `registerProvider`, `registerAutomationEventType`, `registerMcpServer`를 쓴다. 각각 manifest의 `capabilities`(tools, commands, rules, messageBuilders, providers, automationEvents, mcp, hooks)를 선언해야 한다 (`sdk/packages/shared/src/extensions/contribution-registry.ts:125-144`, `user-instruction-plugin.ts:240-246`). plugin은 worker 안에서만 돈다(최신 commit 제목, `789f79e`).

### 3.2 agent·role·mode별 tools (Plan/Act)

mode는 `AgentMode = "act" | "plan" | "yolo" | "zen"` (`sdk/packages/shared/src/session/runtime-config.ts:3`). `zen`의 동작은 확인 못함. mode가 하는 일은 **다섯 가지가 한꺼번에** 일어난다.

1. **tool preset이 mode를 따라 달라진다** (`sdk/packages/core/src/extensions/tools/presets.ts:21-125`):

   | preset | read_files | search | run_commands | web | editor | skills | ask_question | submit_and_exit | spawn_agent | teams |
   |---|---|---|---|---|---|---|---|---|---|---|
   | act | O | O | O | O | O (또는 apply_patch) | O | O | X | O | O |
   | plan | O | O | O | O | **X** | O | O | X | O | O |
   | yolo | O | **X** | O | X | O | X | X | **O** | X | X |

   즉 plan은 act에서 **쓰기 tool(`editor`/`apply_patch`)만 뺀** 것이다. `run_commands`는 plan에도 남는다 (주석: "Shell access stays enabled for read-only investigation"). `resolveToolPresetName(mode)`가 고른다 (`:128-137`). `spawn_agent`와 팀 tool은 `normalizeConfig`에서 preset 값이 기본이고 설정으로 덮는다 (`runtime-builder.ts:355-369`).
2. **plan에서 남은 쓰기 구멍은 hook으로 막는다**. `createPlanModeCommandGuardExtension`이 `beforeTool` hook으로 `run_commands`의 모든 명령을 `findFileEditingCommand`(rm, mv, cp, `sed -i`, 파일로 redirect, 작업 트리를 바꾸는 git, 패키지 설치 등의 차단 목록)로 검사해 걸리면 `{skip: true, reason}`을 돌려준다 (`command-guard-extension.ts:40-76`, 차단 구성은 `command-guard.ts`). 효과: 사용자에게 승인을 묻기 **전에** 거부하고(beforeTool은 policy와 승인보다 먼저), model에게는 오류 tool 결과로 알려 turn은 계속된다(`skip`, not `stop`). 이 hook은 모든 `run_commands`(SDK 기본, VS Code의 terminal tool 같은 host 대체품, 위임된 subagent)에 걸린다. 문서(`docs/core-workflows/plan-and-act.mdx`)는 "Plan mode는 파일 수정도 명령 실행도 못 한다"고 써서, 읽기 전용 명령은 되는 코드와 어긋난다. 반면 `docs/features/subagents.mdx`는 코드대로 설명한다.
3. **mode를 바꾸면 runtime을 다시 만든다**. 주석: "Mode switches rebuild the runtime, so the guard appears/disappears with the mode" (`runtime-builder.ts` `planModeCommandGuard` 위). tool 집합, system prompt, hook이 mode에 묶여 새로 구성된다. 대화 history는 이어진다 (`plan-and-act.mdx`).
4. **system prompt와 user message가 mode를 설명한다**: 3.3, 3.4에 자세히. 요점만: plan이면 `# Plan Mode` 블록이 규칙으로 붙고, 모든 user message가 `<user_input mode="plan|act|yolo">`로 감싸진다.
5. **mode 전환 tool은 host가 결정한다**. plan mode의 CLI interactive는 `switch_to_act_mode` tool을 `config.extraTools`로 **plan일 때만** 추가한다 (`apps/cli/src/runtime/run-interactive.ts:255-261`). VS Code 확장은 이 tool을 주지 않고 `planModeSwitchTool: false`를 넘겨, system prompt가 "사용자가 Plan/Act 토글을 눌러야 한다. 'toggle to Act mode'라고 말해 달라"로 바뀐다 (`cline.ts:51-53`, `apps/vscode/src/sdk/sdk-session-config-builder.ts:13-17`). model이 전환 tool을 호출해도 "plan을 보여 준 같은 turn에서는 호출 금지, 사용자 승인을 기다려라"는 규칙이 prompt에 있다.
6. **mode별 model**: "Use different models for Plan and Act" 설정 (`plan-and-act.mdx`). 코드 위치는 확인 못함(설정 UI).

**subagent**:
- `spawn_agent{systemPrompt, task}`: **parent가 child의 system prompt를 직접 쓴다** (`team/spawn-agent-tool.ts:30-36`). child는 현재 mode의 기본 tool을 받는다(plan이면 편집 tool 없음 + 같은 command guard). `subAgentTools`/`createSubAgentTools`로 host가 child의 tool을 정한다. 승인은 `spawn_agent` 호출 한 번으로 **child의 모든 tool 호출을 승인한 것**이 되고 child는 승인 설정을 안 거친다 (`docs/features/subagents.mdx` "Approvals"). 끄려면 `spawn_agent` tool을 끈다. VS Code/JetBrains 확장은 subagent를 안 쓴다(같은 문서 경고).
- **configured agent = `subagent_<name>` tool**: 파일 하나가 tool 하나가 된다 (`team/configured-agent-tool.ts`, `team/configured-agent-config.ts:9-17`). 위치: `<workspace>/.cline/agents/`와 `~/.cline/agents/` (`sdk/packages/shared/src/storage/paths.ts:484-493`). frontmatter(YAML) 필드: `name`, `description`(필수), **`tools`**(허용 tool 이름 목록 또는 쉼표 문자열), `skills`, `providerId`, `modelId`, `maxIterations`. 본문이 child의 system prompt다. tool 입력은 `{prompt}` 하나뿐이다. `tools`가 있으면 기본 tool 중 그 이름만 남긴다(`skills`가 지정되면 `skills` tool은 자동 포함) (`runtime-builder.ts:120-135` `filterToolsForConfiguredAgent`). `skills`가 지정되면 그 skill만 쓰는 skills 실행기를 따로 만든다 (`:672-677`). 이것이 **role마다 tool allowlist와 지침을 다르게 주는 가장 직접적인 장치**다. 이름은 소문자·숫자·밑줄로 정리하고 접두사 `subagent_`, 최대 64자 (`configured-agent-tool.ts:27-28`).
- 팀: `enableAgentTeams`와 team tool (`team/team-tools.ts`, `/team` 명령). 세부는 확인 못함(`docs/cli/agent-teams.mdx`).

### 3.3 지침(instructions)

- **이름과 위치** (`sdk/packages/shared/src/storage/paths.ts:34-57`, `:571-601`):
  - 규칙(rule): 워크스페이스 `AGENTS.md`, `.clinerules`(디렉터리 또는 옛 단일 파일), `.cline/rules/`; 전역 `~/.agents/AGENTS.md`, `~/.cline/rules/`, `~/Cline/Rules`, `~/Documents/Cline/Rules`(OneDrive로 옮긴 Documents도 확인). docs는 `.cursorrules`와 `.windsurfrules`도 자동 인식한다고 쓰나 이 SDK 코드에서 읽는 위치는 확인 못함(`docs/customization/cline-rules.mdx`).
  - 하위 폴더별 AGENTS.md: 확인 못함. 워크스페이스 루트의 `AGENTS.md` 하나만 경로에 올라 있다 (`paths.ts:592-594`).
  - 이름 붙이기: `Workspace AGENTS.md` / `Global AGENTS.md`로 구분 (`user-instruction-config-loader.ts:334-352`).
- **rule 꼴**: markdown 파일. frontmatter는 `name`, `disabled`/`enabled`만 읽는다. 경로 조건(`paths:` 같은 것)은 이 코드에 없다 (`user-instruction-config-loader.ts:383-408` `parseRuleConfigFromMarkdown`). UI에서 파일마다 토글한다 (`cline-rules.mdx`).
- **합치기**: 켜진 rule을 `name` 순으로 정렬해 `# Rules` 아래 `## <name>\n<본문>`으로 이어 붙인다 (`runtime/safety/rules.ts:9-25`, `:41-48`). 충돌은 "workspace가 global에 우선한다"고 docs가 쓰며, 코드는 정렬·이어 붙이기뿐이다.
- **prompt 안의 위치**: **system prompt**. 두 경로다. (a) 기본 prompt 템플릿의 `{{CLINE_RULES}}` 슬롯: `config.rules`와 mode 안내(`MODE_TAG_INSTRUCTIONS`, plan이면 `PLAN_MODE_INSTRUCTIONS`)를 `\n\n`으로 합친 것이 들어간다 (`sdk/packages/shared/src/prompt/cline.ts:158-210`). (b) plugin의 `registerRule`: 실행 직전에 `composeSystemPrompt`가 등록된 rule을 `base\n\nrule1\n\nrule2`로 이어 붙인다 (`session-runtime-orchestrator.ts:138-151`, `:754-768`). 파일 rule은 (b)로 간다(`user-instruction-plugin.ts:255-260`). rule에는 `whenToolAvailable: "<tool>"`을 걸 수 있다. 그 tool이 이번 session에 있을 때만 들어간다 (`contribution-registry.ts:31`, `orchestrator:759-762`).
- **크기 제한**: 확인 못함.
- **system prompt 교체**: `config.systemPrompt`가 있으면 기본 prompt 전체를 대체한다 (`local-runtime-bootstrap.ts:167-186` `resolveBootstrapSystemPrompt`). 정확히는 `buildClineSystemPrompt`가 `overridePrompt`를 받으면 템플릿 없이 그것만 쓴다(Cline provider이고 metadata가 있으면 workspace metadata만 붙임, `cline.ts:99-113`). subagent는 이 경로를 쓴다: parent가 쓴 `systemPrompt`가 override가 된다 (`team/subagent-prompts.ts:23-41`). 반면 팀원(teammate)은 기본 prompt에 `# Team Teammate Role` rule로 역할을 붙인다 (`:5-21`).
- **provider 조건**: Cline provider일 때만 `<CLINE_METADATA>`(workspace 설정 JSON: 경로, hint, remote URL(자격 증명 제거), 최신 commit hash, branch)가 들어간다 (`cline.ts:75-120` `processWorkspaceInfo`, `redactRemoteUrlCredentials`).

### 3.4 prompt assemble

- **system prompt** (`cline.ts:158-210` `buildClineSystemPrompt`): mode가 yolo면 `DEFAULT_CLINE_SYSTEM_PROMPTS.YOLO`, 아니면 `ACT`를 템플릿으로 쓴다(plan도 ACT 템플릿 + plan 블록). 템플릿 치환: `{{PLATFORM_NAME}}`, `{{CWD}}`, `{{CURRENT_DATE}}`(`toLocaleDateString()`), `{{IDE_NAME}}`, `{{CLINE_METADATA}}`, `{{CLINE_RULES}}`. 본문: 역할 한 줄 → `<env>` 블록(Platform, Date, IDE, Working Directory) → Remember 목록(관례 따르기, 병렬 tool call, 끝나면 검증) → `{{CLINE_RULES}}` → `{{CLINE_METADATA}}` (`system/act.ts`). 짧다(약 36줄). tool 사용법은 tool 설명에 두고 prompt에는 안 쓴다.
- **mode 설명 블록** (`cline.ts:11-53`):
  - `MODE_TAG_INSTRUCTIONS`("# Plan / Act Modes"): user message가 `<user_input mode="...">`로 감싸져 온다는 설명. mode가 바뀌면 최신 message의 mode가 현재 규칙이고 `<mode_notice>` 블록이 전환 시점을 표시한다. yolo mode에는 안 넣는다.
  - `PLAN_MODE_INSTRUCTIONS`("# Plan Mode"): 읽고 탐색하고 계획만 세운다. `run_commands`는 읽기 전용 점검에만 쓴다. 파일 편집·`rm/mv/cp`·`sed -i`·redirect·git 변경·설치는 hard-block되니 시도하지 말고, 변경이 필요하면 plan에 적어라. 계획은 구조화된 개요로 보여 주고, 승인을 받은 뒤 `switch_to_act_mode`를 쓴다(전환 tool이 없는 host용 `_MANUAL_SWITCH` 변형이 따로 있다).
- **user message 쪽**: `formatUserInputBlock(input, mode)` → `<user_input mode="plan">...</user_input>` (`format.ts:5-9`). 사용자가 mode를 UI에서 바꾸면 다음 message 앞에 `<mode_notice>The user switched from act mode to plan mode before sending this message.</mode_notice>`가 붙는다. plan→act→plan 왕복은 상쇄한다 (`createModeSwitchNoticeTracker`, `:42-95`). model이 스스로 전환한 경우는 이 notice가 없다. 화면 표시에서는 `<mode_notice>`를 지운다(`stripModeNotices`). slash command는 `<user_command slash="name">...</user_command>`로 감싼다 (`:13-15`).
- **tools**: API tools 배열로 보낸다. 기본 tool + MCP tool + plugin tool + `spawn_agent` + `subagent_*`. 정렬 규칙은 확인 못함.
- **skills 목록**: system prompt에 skill 목록을 넣지 않는다. **`skills` tool의 description**에 이름 목록이 붙는다 (3.1). skill 이름·설명을 prompt에 넣는 경로는 `docs/customization/skills.mdx`가 말하는 "metadata always loaded (~100 tokens/skill)"인데 이 코드에서 그 위치는 확인 못함. 현재 코드에서 model이 skill 목록을 보는 곳은 tool description이다.
- **compact** (`sdk/packages/core/src/extensions/context/`): `compaction.ts`가 파이프라인이고 전략이 `basic-compaction`, `agentic-compaction` 둘이다. 트리거 비율 `COMPACTION_TRIGGER_RATIO = 0.9`, 목표 `DEFAULT_TARGET_RATIO = 0.7`, 최근 `DEFAULT_PRESERVE_RECENT_TOKENS = 20_000`을 보존한다 (`compaction-shared.ts:19`, `:28-29`). provider가 context 초과로 거부하면 추정치를 믿지 않고 강제 압축한다(`overflowRecovery`, `agent.ts` `AgentRuntimePrepareTurnContext`). 요약은 sidecar에 저장한다 (`local-runtime-host.ts:729`). 사용자는 `/compact`(별칭 `/smol`, `/newtask`)로 부른다 (`apps/vscode/src/shared/slashCommands.ts`, `docs/features/auto-compact.mdx`).
- **hook 단계** (`sdk/packages/shared/src/agent.ts:474-506` `AgentRuntimeHooks`): `beforeRun`, `afterRun`, `beforeModel`(요청을 바꿀 수 있음), `afterModel`(중단 제어), `beforeTool`(skip/stop/입력 변경), `afterTool`, `onEvent`. `prepareTurn` 단계가 매 iteration의 messages, systemPrompt, tools를 받아 compaction 등을 한다 (`AgentRuntimePrepareTurnContext`).
- **cache 배치**: prompt 안에 날짜가 일 단위(`toLocaleDateString`)라 하루 동안은 같은 prefix다. cache 표시 방법은 확인 못함.

### 3.5 commands (slash command)

- **두 장소의 두 목록**.
  - CLI(`apps/cli`)의 TUI 로컬 명령 15개 (`apps/cli/src/tui/commands/slash-command-registry.ts:7-123`): `settings`(= `config`, 숨김), `model`, `theme`, `account`, `mcp`, `plugins`, `compact`, `skills`, `fork`, `undo`, `clear`, `history`, `help`, `quit`, + `team`. 실행 종류가 `execution: "local" | "runtime" | "user-command"`다. `local`은 TUI가 직접 처리(model 안 감).
  - VS Code 확장의 기본 명령 (`apps/vscode/src/shared/slashCommands.ts`): `newtask`, `deep-planning`, `compact`, `smol`. `newtask`/`smol`은 `compact` 별칭이며 webview가 가로채 condense RPC로 보낸다. `/newrule`, `/reportbug`는 "prompt 확장이 SDK runtime으로 아직 안 옮겨져서" 숨겨 두었다. 옮겨지기 전에는 글자 그대로 model에 가서 조용히 일반 chat이 되기 때문이다(코드 주석). `docs/core-workflows/using-commands.mdx`에는 이 숨긴 둘도 나오니 문서가 뒤처진 것이다.
- **사용자 정의 = skill과 workflow**: 둘 다 slash command가 된다. 이름은 `normalizeRuntimeCommandName`(공백은 하이픈, 유니코드 글자·숫자 허용)으로 정규화한다. 같은 이름이면 **skill이 workflow를 이긴다**("Workflows are effectively deprecated in favor of skills", `runtime-commands.ts:97-111`).
  - workflow: `.clinerules/workflows/*.md`, `.cline/workflows/`, `~/.cline/workflows`, `Documents/Cline/Workflows` (`paths.ts:603-616`). frontmatter는 `name`, `description`, `disabled`/`enabled`. 본문이 지시문.
  - 실행 방식 (`runtime-commands.ts:116-160`): 입력이 `/name rest`이면 **본문 + rest로 텍스트를 치환**해 model에게 보낸다. 단 session이 `skills` tool을 등록했으면 skill 명령은 치환하지 않고 `/skill args`를 그대로 보내 model이 tool로 읽게 한다(기록에 입력이 남음). workflow는 항상 치환한다. plugin이 `registerCommand({name, description, handler})`로 명령을 더하면 handler가 문자열을 돌려주는 형태다 (`user-instruction-plugin.ts:279-295`).
- **model로 가는가**: `local`은 harness만, 치환형 명령은 치환된 텍스트가 user message로 간다(`<user_command slash=...>` 봉투로 감쌈, `format.ts:13-15`). `/compact`는 runtime의 압축 호출이다.
- 이름 충돌: TUI 로컬 명령이 먼저 등록되고 `byName.has`면 뒤의 것을 버린다 (`slash-command-registry.ts` `addEntry`).

### 3.6 skills

- **꼴**: 디렉터리 + `SKILL.md`. frontmatter `name`(디렉터리 이름과 같아야 함), `description`(최대 1024자). 선택 `disabled`/`enabled`. 본문 지침 + `docs/`, `scripts/`, `templates/` (`docs/customization/skills.mdx`, `user-instruction-config-loader.ts:354-382`).
- **위치** (`paths.ts:511-523`): 워크스페이스의 skill 디렉터리들(`getWorkspaceSkillDirectories`: `.cline/skills` 등), `~/.cline/skills`, `~/.agents/skills`. agent plugin 패키지에 든 skill도 포함한다. 우선순위는 위 순서(워크스페이스 먼저)라고 추정되나 충돌 규칙은 확인 못함. 같은 이름 충돌은 `executor`가 "ambiguous"를 돌려주고 사용자에게 id를 고르게 한다 (`user-instruction-service.ts` `createCombinedSkillsExecutor`).
- **built-in skill**: SDK에 번들된 skill은 확인 못함.
- **prompt에 넣는 법**: 3.4 참조. docs의 3단계 설명(metadata 항상, 본문은 트리거될 때, 리소스는 필요할 때). `skills` tool 설명이 "When a skill matches the user's request, invoking this tool is a blocking requirement before any other response. Never mention a skill without invoking this tool."이라고 강하게 시킨다 (`definitions.ts:771-777`). 호출 결과는 `<command-name>...</command-name><command-instructions>Description: ...\n본문</command-instructions>` 꼴이다 (`user-instruction-plugin.ts:44-48`).
- **끄고 켜기**: skill마다 토글(UI의 Skills 탭), `config.skills`로 허용 목록을 줄 수 있다(`allowedSkillNames`, `createSkillsExecutor(allowed)`). configured agent는 frontmatter `skills`로 child가 쓸 skill만 지정한다.
- **file watcher**: 규칙, skill, workflow는 `UnifiedConfigFileWatcher`가 디렉터리를 감시해 바뀌면 갱신한다 (`unified-config-file-watcher.ts`). 실행 중 session이 새 skill을 보는지는 확인 못함.

### 3.7 role·mode별 tool과 지침 요약 (Cline)

- tool을 가르는 단위: mode preset(plan = act − 쓰기 tool) × 이름별 `ToolPolicy` × host가 주는 `extraTools`(전환 tool) × configured agent의 `tools` allowlist. 읽기 전용성은 **tool을 빼는 것과 hook으로 명령을 막는 것을 겹쳐서** 지킨다 (shell을 남겨 두고 blacklist hook이 hard backstop).
- 지침을 가르는 단위: system prompt의 mode 블록(plan이면 추가, yolo면 다른 템플릿), user message의 `<user_input mode>` 래퍼와 `<mode_notice>`, rule(`whenToolAvailable`로 tool 조건부), subagent는 parent가 쓴 override prompt 또는 configured agent 파일 본문.
- mode가 바뀔 때마다 runtime을 다시 만들고, system prompt를 새로 짜므로 mode 간에 prompt cache는 이어지지 않는다(이 점은 코드에서 확인한 사실이 아니라 "rebuild" 주석에서의 추론이다. cache 영향 자체는 확인 못함).

---

## 4. harness 사이 비교

| 항목 | Hermes | Goose | Cline |
|---|---|---|---|
| 공통 tools | 약 55개 core(`_HERMES_CORE_TOOLS`), snake_case, 접두사 없음. registry에 import 때 등록. OpenAI function 꼴. 이름순 정렬. 읽기/쓰기 표시 없음(명령 내용으로 승인 판단). | extension 단위(MCP+platform). 이름 `ext__tool`, 일부 platform은 접두사 없음. MCP `ToolAnnotations` 5값을 실제 승인에 사용(`smart_approve`). developer는 5개 tool. | 9개 기본(`read_files`, `search_codebase`, `run_commands`, `fetch_web_content`, `editor`/`apply_patch`, `skills`, `ask_question`, `submit_and_exit`). zod 입력, 배열로 한 호출에 여러 건. 이름별 `ToolPolicy{enabled,autoApprove}`. |
| agent·role·mode별 tools | toolset 합집합 − `disabled`(마지막에 뺌) × platform × session 종류. subagent = parent 부분집합 − 금지 5개. 일부러 child의 toolsets를 model에 광고 안 함. profile이 role 단위. | session의 extension 집합 + extension별 `available_tools`. recipe가 extension을 명시하면 그것만. `delegate`가 `extensions` 인자로 child를 좁힘. 승인 mode 4개는 실행만 통제. | mode preset(plan = act − 편집 tool) + plan 명령 guard hook. configured agent 파일의 `tools` allowlist. `spawn_agent`는 parent가 child의 system prompt를 씀. |
| 지침 | SOUL.md(identity) + project 한 종류(.hermes.md > AGENTS.md chain > CLAUDE.md > .cursorrules). 폴더별 hint는 tool 결과에 덧붙임. 파일당 20K~500K자. personality overlay. | `.goosehints` + `AGENTS.md`(이름 설정 가능). global + git root→cwd. `@import`. 하위 폴더 hint는 system prompt에 추가. recipe `instructions`, agent 파일 본문. | `AGENTS.md`, `.clinerules/`, `.cline/rules/`, 전역 rules. 켜진 rule을 이름순으로 `# Rules` 아래 이어 붙임. `whenToolAvailable` 조건. 경로 조건 없음. |
| prompt assemble | 3 tier(stable → context → volatile)를 1회 조립, 압축 때만 재조립. 시각은 volatile. personality는 API 시점에 system 뒤에 붙임. tool은 이름순. | 짧은 `system.md` + `# Additional Instructions` extras(skills, extensions, project, recipe, hints). 시각·cwd·turn 예산은 별도 user message(`<turn-context>`). Operation trait로 기여. | 짧은 템플릿(`<env>`, Remember, `{{CLINE_RULES}}`, metadata). plan이면 mode 블록. user message를 `<user_input mode>`로 감쌈. compact 90%. |
| commands | `CommandDef` registry 한 곳, 약 100개. harness 처리 / 일반 turn으로 prompt 전송(`/plan`) / skill(user message로 본문) 모두 있음. | built-in 9개(`prompts`, `prompt`, `compact`, `clear`, `skills`, `doctor`, `goal`, `grind`, `status`) + recipe 명령(config 매핑) + skill 명령. built-in > recipe > skill. | TUI 로컬 15개 + skill·workflow·plugin 명령. 텍스트를 치환해 model로(skill은 `skills` tool이 있으면 치환 안 함). VS Code는 `compact`/`deep-planning`. |
| skills | `SKILL.md` + `metadata.hermes`. `description` 60자 강제. index(이름+설명)를 prompt에, 본문은 `skill_view`. project > local > create_dir > external. agent가 `skill_manage`로 작성, curator가 정리. | `SKILL.md` + `arguments`/`argument-hint`. 이름+설명을 `# Skills`에, 본문은 `load_skill`. `.agents`/`.goose`/`.claude` 위치. built-in 2개. `/skill-name`으로 실행. | `SKILL.md`. 이름 목록은 `skills` tool description에. 본문은 tool 호출로. `.cline/skills`, `~/.cline/skills`, `~/.agents/skills`. skill 토글, configured agent별 skill 제한. |

## 5. lophn에 참고할 점

### 5.1 사실 (위 조사에서 확인한 것)

1. **role을 파일 하나로 정의하는 꼴이 세 곳에 있다.** Goose recipe(YAML: instructions, extensions, settings, response schema), Goose agent 파일(frontmatter `name`/`description`/`model` + 본문. tool 정의 없음), Cline configured agent(frontmatter `name`/`description`/`tools`/`skills`/`providerId`/`modelId`/`maxIterations` + 본문. 이름 `subagent_<name>` tool이 됨), Hermes profile(별도 HERMES_HOME: config의 toolset, SOUL.md, skills, memory). tool allowlist를 role 정의에 직접 두는 것은 Cline configured agent와 Goose recipe뿐이다.
2. **tool을 가르는 방식은 세 가지로 나뉜다.** (a) 이름이나 묶음의 allowlist/denylist: Hermes toolset(`disabled`를 마지막에 뺌), Cline `tools:`, Goose `available_tools`. (b) mode preset: Cline의 plan/act/yolo. (c) 실행 시점 통제: Goose 승인 mode와 permission.yaml, Cline `ToolPolicy`+`beforeTool` hook, Hermes 명령 승인. (c)는 tool 목록을 그대로 두고 실행만 막는다.
3. **읽기 전용 mode를 tool 제거만으로 지키는 곳은 없다.** Cline은 편집 tool을 빼고도 shell이 남아서 hook으로 명령 blacklist를 건다. Hermes `/plan`은 prompt 지시만으로 하고 기계적 강제는 없다("do not edit project files", `agent/plan_prompt.py`). Goose `chat` mode는 tool 호출을 무시한다.
4. **subagent의 tool은 parent보다 넓을 수 없다**는 규칙이 Hermes에 코드로 있다. Cline은 child가 "현재 mode의 기본 tool"을 받고, Goose는 `extensions`로 좁힌다. 세 곳 모두 subagent의 재귀 위임을 막는다(Hermes: `delegate_task` 금지, orchestrator role만 예외. Goose: SubAgent session은 delegate 불가. Cline: yolo preset은 `spawn_agent`를 끔; 일반 child의 재귀 여부는 확인 못함).
5. **subagent의 입력은 좁다.** Hermes `{goal, context, output_schema, images, group}`, Goose `{instructions, source, extensions, context, max_turns, ...}`, Cline `{systemPrompt, task}` 또는 `{prompt}`. 셋 다 parent의 대화 history를 child에게 넘기지 않는다(Hermes 설명에 "knows nothing about your conversation history"). 결과는 Goose가 `{summary}` JSON을 기본으로 강제하고 Hermes가 선택적 `output_schema`를 검증한다.
6. **지침 파일은 `AGENTS.md`가 공통 분모다.** 셋 다 읽는다(Hermes: `.hermes.md`가 더 우선이고 한 종류만. Goose: `.goosehints`와 함께 둘 다 읽음. Cline: rules 디렉터리와 함께). 합치는 법은 갈린다. Hermes는 "한 종류만 이기기", Goose는 "전부 이어 붙이기", Cline은 "이름순으로 이어 붙이기"다. 하위 폴더 지침은 Hermes가 tool 결과에 붙이고, Goose가 system prompt에 추가한다.
7. **동적 값(시각, cwd)을 system prompt 밖에 두는 설계가 있다.** Goose는 `<turn-context>`를 별도 user message로 넣고 system을 안정시킨다. Hermes는 system 안의 volatile tier 맨 끝에 두고, 필요한 동적 context는 API 시점에만 user message나 system 뒤에 붙이고 저장은 안 한다. Cline은 날짜를 `{{CURRENT_DATE}}`로 system에 둔다.
8. **skill은 "이름+설명만 prompt, 본문은 tool 호출로"가 세 곳 모두 같다.** 목록을 어디에 두는지만 다르다(Hermes system의 volatile 맨 앞, Goose system의 `# Skills`, Cline은 tool description). skill을 slash command로도 부르는 점도 같다. Hermes는 skill 본문을 user message에, Goose는 `loaded_skill_context` 문자열을 prompt로, Cline은 `skills` tool이 있으면 입력 그대로 두고 아니면 본문으로 치환한다.
9. **tool 설명의 원칙이 문서화된 곳은 Hermes뿐이다**: 다른 toolset의 tool 이름을 설명에 쓰지 않는다. 그 tool이 없을 때 model이 환각으로 부르기 때문이다. 필요한 교차 참조는 사용 가능한 tool 집합을 보고 동적으로 덧붙인다. Cline도 `skills` tool 설명에 사용 가능한 skill 이름을 getter로 동적으로 붙인다.
10. **mode 전환 시 Cline은 runtime을 새로 만들고**, 사용자가 UI에서 mode를 바꾼 사실을 user message 앞의 `<mode_notice>`로 알린다. 모든 user message에 현재 mode를 `<user_input mode>`로 달아, history 안의 옛 message가 어떤 mode에서 나왔는지 model이 구분하게 한다.
11. **annotation을 승인에 실제로 쓰는 곳은 Goose뿐이다** (`readOnlyHint`가 true면 `smart_approve`에서 통과, 없으면 LLM이 판정). Hermes와 Cline에는 tool 메타데이터 수준의 읽기/쓰기 표시가 없다.

### 5.2 lead의 추론 (검증하지 않은 의견)

1. lophn의 role(App Engineer, Operator, Context Engineer, lophn)을 Cline configured agent / Goose recipe처럼 **파일 하나(frontmatter + 본문)로 정의**하고 frontmatter에 tool allowlist와 skill 목록을 두는 꼴이 세 harness 중 가장 직접적인 선례다. Goose agent 파일처럼 tool을 정의하지 않는 쪽은 role이 넓어질수록 지침과 tool이 따로 놀 수 있다.
2. role별 tool 차이를 "role = tool allowlist" 하나로 두면 Cline처럼 읽기 전용 같은 **의미 있는 제약**은 allowlist에 안 담긴다(shell이 남음). lophn의 tool이 파일·shell이 아닌 작업 공간 조작(앱, 상태, 이벤트)이라면 읽기/쓰기/외부 효과를 tool 메타데이터로 표시하고(Goose의 annotation 방식) role 정의에서 "쓰기 tool 제외"를 한 줄로 쓸 수 있게 하는 편이 맞을 수 있다. 어느 쪽이든 목록을 빼는 방식과 실행 시점 검사는 겹쳐 두는 것이 세 harness의 공통 경향이다.
3. role마다 지침이 다른 경우 "공통 지침 + role 지침"을 system의 안정된 부분에, 동적 값(시각, 턴 예산, 현재 mode)은 별도 message에 두는 Goose 쪽 배치가 cache에 유리해 보인다. Cline처럼 mode가 바뀔 때 system 자체를 다시 짜면 cache가 끊긴다.
4. role 전환이 한 session 안에서 일어난다면, Cline의 `<mode_notice>`와 `<user_input mode>` 방식(history 안에서 role의 변화를 표시)을 참고할 수 있다. role이 session마다 고정이라면 Hermes profile / Goose recipe처럼 session 시작 때 고정하는 쪽이 단순하다.
5. subagent 호출 입력은 좁게(goal, context, 결과 schema) 하고 child의 tool은 role 정의에서 오게 하며 model이 고르게 하지 않는 편이 Hermes의 선택(광고 안 함)과 일치한다. 재귀 위임 금지와 child가 parent보다 넓은 tool을 못 받는 규칙은 세 곳 모두 비슷하게 갖고 있다.
6. 지침 파일은 `AGENTS.md`를 읽어야 한다는 사실은 AGENTS.md 지침과 일치한다. role별 지침 파일 이름 규칙은 위 harness들이 모두 "role 파일 한 개 = 본문이 지침"으로 쓰고 있어 같은 꼴을 따르면 된다.
