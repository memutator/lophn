# agent definition 조사: OpenCode, pi, Gemini CLI

조사일: 2026-10-15

| 대상 | repo | commit | 비고 |
|---|---|---|---|
| OpenCode | github.com/sst/opencode (branch dev) | `35bb8e4` (2026-10-14) | 코드는 V2 구조(`packages/core`). 공식 문서도 V2(`opencode.ai/v2/docs/`)를 본다. `packages/web`의 옛 문서는 V1이라 쓰지 않았다. |
| pi | github.com/badlogic/pi-mono, 조사 대상은 `packages/coding-agent` | `b45e0eb` (2026-10-14) | 문서 안 링크는 `earendil-works/pi`를 가리킨다. 같은 코드로 보인다. |
| Gemini CLI | github.com/google-gemini/gemini-cli | `a6321ab` (2026-10-14) | `packages/core`, `packages/cli`, `docs/` |

받은 위치: `/tmp/claude-1000/-home-pyosechang-projects-lophn-project-docs/c3fd2111-562b-41c5-8a67-86a862b12e16/scratchpad/agentdef/repos/{opencode,pi-mono,gemini-cli}/`. 읽기만 했고 실행하지 않았다.

경로는 따로 적지 않으면 각 repo 안 경로다. OpenCode 경로의 `core/`는 `packages/core/src/`, pi의 경로는 `packages/coding-agent/` 기준, Gemini의 `core/`는 `packages/core/src/`다.

---

## 1. OpenCode

### 1.1 공통 tools

- 기본 tool: `read`, `glob`, `grep`, `edit`, `write`, `patch`, `shell`, `webfetch`, `websearch`, `question`, `skill`, `subagent`, `execute`(Code Mode). 이름은 소문자 단어 하나, 복수 단어는 `snake_case`(`session_rename`). (`core/tool/plugin/*.ts`, 문서 `opencode.ai/v2/docs/tools/`)
- `patch`는 지원하는 GPT 모델에서만 켜지고 그 밖의 모델은 `edit`와 `write`를 받는다(문서). 코드로 gating 지점은 확인 못함.
- 모든 tool이 한 모양이다: `name`, `description`, `input`(Effect Schema), `output`(Schema), `options`, `execute(input, context)`. 한 객체에 다 들어 있고 별도 executor 등록이 없다. (`core/tool/AGENTS.md`)
- input schema는 필드마다 `.annotate({ description })`를 붙인다. 예: `read`는 `path`, `offset`, `limit`. `edit`는 `path`, `oldString`, `newString`, `replaceAll`. `shell`은 `command`, `workdir`, `timeout`, `background`.
- description은 사용법과 함정을 길게 쓴다. `edit` description은 줄 번호 prefix를 oldString에 넣지 말 것, 못 찾으면 따옴표·공백 변형을 재시도하는 것, 여러 곳이 맞으면 실패하는 것까지 적는다. `shell` description은 OS와 shell 이름을 동적으로 넣는다(`tool/plugin/shell.ts` 36줄).
- 읽기·쓰기·외부 효과 표시: readOnlyHint 같은 annotation은 없다. 대신 tool마다 permission action 이름이 하나 있다. 기본은 tool 이름이고 `edit`, `write`, `patch`는 `edit` action을 같이 쓴다(`options: { permission: "edit" }`). 실행할 때 leaf가 `permission.assert({ action, resources, ... })`를 부른다. 이 이름은 목록에서 tool을 빼는 데 쓰고, 실행 권한 검사는 leaf가 한다(`core/tool/AGENTS.md` Permissions 절).
- tool을 Code Mode로 묶을 수 있다. `options.codemode`가 `false`가 아닌 tool은 직접 노출되지 않고 `execute` tool 하나가 JS를 받아 그 안에서 호출한다. 빌트인 코딩 tool(`read`, `edit` 등)은 `codemode: false`로 직접 노출한다. `namespace`를 주면 모델에 보이는 이름이 `<namespace>_<tool>`이다(`opencode` namespace의 `session_rename`, `worktree_create`, `models` 등). (`core/tool.ts`, `core/tool/plugin/opencode.ts`)
- 출력 한도: 일반 출력 자르기는 session runner가 한다. `shell`은 합친 출력을 파일에 두고 잘린 꼬리와 전체 경로를 돌려준다. `read`는 기본·최대 2000줄. config에 `tool_output: { max_lines, max_bytes }`가 있다(`schema/src/config/tool-output.ts`).
- tool 목록도 model에 맞춰 바뀐다: `plugin/optimize.ts`에 model별 plugin이 있고 지금은 grep, glob 제거 plugin 둘이 주석으로 꺼져 있다.

### 1.2 agent·role·mode별 tools

- agent 정의(`schema/src/agent.ts`): `id`, `name`, `model`(ref + variant), `request`, `system`(prompt 전문), `description`, `mode`(`subagent` | `primary` | `all`), `hidden`, `color`, `steps`(최대 step), `permissions`(ruleset).
- tool 허용·차단은 전부 permission ruleset으로 한다. rule은 `{ action, resource, effect }`이고 effect는 `allow` | `deny` | `ask`. 마지막으로 맞는 rule이 이긴다(`core/permission.ts` `evaluate`의 `findLast`). 일치 rule이 없으면 `ask`.
- 기본 base policy: `*`/`*` allow, `.env`, `.env.*` 읽기는 ask, `.env.example`은 allow (`schema/src/agent.ts` `Info.default`).
- tool 목록에서 빼는 규칙: 어떤 tool의 action에 대해 마지막 rule이 `resource: "*"`, `effect: "deny"`이면 그 tool은 request에 선언조차 되지 않는다(`core/tool.ts` `whollyDisabled`, `snapshot`). `execute` action을 deny하면 Code Mode 전체가 빠진다.
- 빌트인 agent(`core/plugin/agent.ts`, `core/plugin/plan.ts`):
  - `build`: primary, 기본. `question` allow.
  - `plan`: primary. `edit` deny, 단 `~/.opencode/plan/*`만 allow. mode를 별도 개념으로 두지 않고 "agent를 바꾸는 것"이 곧 mode 전환이다. 전환할 때 `<system-reminder>` 문구(Plan mode 진입, 이탈)를 synthetic message로 대화에 넣는다. compaction이나 revert로 reminder가 사라지면 요청마다 다시 맞춘다.
  - `general`: subagent. `question`, `subagent` deny.
  - `explore`: subagent. `*` deny 후 `shell`, `grep`, `glob`, `webfetch`, `websearch`, `read`만 allow, `subagent` deny. 자체 system prompt(검색 전문가).
  - 숨김: `compaction`, `title`(전부 deny), `summary`(전부 deny).
- subagent 호출: `subagent` tool(`agent`, `description`, `prompt`, `model`, `sessionID`, `background` 입력). 자식 session이 새로 생기고, `sessionID`로 이어갈 수 있다. 중첩은 `experimental.subagent_depth`(기본 1)로 막는다. `agent.mode === "primary"`면 거부. 호출 권한은 `subagent` action의 resource가 agent id인 rule로 정한다. 자식은 자기 agent의 permission을 쓰고 부모 것의 부분집합이 아니다(문서).
- 부모가 볼 수 있는 subagent 목록은 `subagent` tool description 끝에 "Available subagents:" 목록으로 동적으로 덧붙는다. `mode !== primary`, `!hidden`, 그리고 부모 permission이 그 id를 deny하지 않는 것만 나온다(`core/tool/plugin/subagent.ts` 279~311).
- 정의 파일: markdown(`agents/<name>.md`, front matter + 본문이 `system`) 또는 config의 `agents` 객체. 위치는 전역 `~/.config/opencode/agents/`, 프로젝트 `.opencode/agents/`(문서). 코드는 옛 이름 `agent/`, `mode/`, `modes/`도 읽는다(`core/config/plugin/agent.ts`). 하위 폴더 이름이 id에 붙는다(`team/reviewer`). 옛 front matter(`tools`, `permission`, `maxSteps`, `temperature` 등)가 있으면 V1로 보고 migration한다.
- 설정 병합: 상위 config의 전역 `permissions`가 모든 agent에 먼저 붙고, agent 자기 rule이 뒤에 붙는다. 같은 key를 가진 scalar는 뒤 config가 덮고, permission은 이어 붙인다(문서). `default_agent`로 시작 agent를 고른다. `disabled: true`로 빌트인도 지운다.
- session 단위로도 permission을 얹을 수 있다: `Permission.merge(agent.info.permissions, session.permissions)`(`core/session/context.ts` 130줄).
- 승인 응답: `once` | `always` | `reject`. `always`는 project 범위 allow rule을 저장한다. 별도로 policy 계층이 있어 rule과 저장된 승인 뒤에 hard deny를 건다(문서 `permissions`, `policies`).

### 1.3 지침(instructions)

- 파일 이름은 `AGENTS.md` 하나다. 문서에 "V2 does not fall back to CLAUDE.md"라고 명시돼 있다(`opencode.ai/v2/docs/instructions/`). 코드도 `AGENTS.md`만 찾는다(`core/config/plugin/instruction.ts`).
- 층:
  1. 전역 `~/.config/opencode/AGENTS.md`
  2. 작업 위치에서 위로 올라가며 각 디렉터리의 `AGENTS.md`. 중단 지점은 home 또는 project root.
  3. 하위: tool이 파일을 읽거나 디렉터리를 나열하면 그 위치에서 위로 `AGENTS.md`를 찾아 session에 synthetic message로 넣는다(`core/tool/plugin/read.ts` 82~110줄, `core/session/instructions.ts`).
- 순서와 우선순위: 전역이 먼저, 그 뒤 작업 디렉터리에서 위로(가까운 것부터). 합치기만 하고 충돌은 풀지 않는다("There is no override system", 문서).
- 변화 감지: 전역과 상위 파일은 watcher로 보고 있다가 바뀌면 다음 요청 전에 "instruction update"를 이력에 넣는다. 바뀐 파일은 diff로 넣는다(diff가 새 전문보다 짧을 때). 하위 파일 변경은 감지하지 않는다. (`core/instruction-discovery.ts` `renderUpdate`)
- 크기 제한: 문서에도 코드에도 확인 못함.
- config의 `instructions` 배열은 schema에 있지만 V2는 아직 해석하지 않는다(문서).
- agent별 지침은 `system` 필드로 prompt 전체를 대체한다. 그래도 project instructions와 skills는 계속 붙는다(문서 `agents`).
- model별 system prompt: `plugin/system-prompt/{anthropic,gpt,gpt-astra,kimi,meta,trinity}.txt`. model id에 `gpt`, `claude`, `kimi`, `muse`, `trinity`가 있으면 해당 prompt를 쓴다(`core/plugin/optimize.ts`). anthropic은 기본 prompt 뒤에 덧붙이는 mode(append)이고 나머지는 교체(override)다. agent에 `system`이 있으면 이 교체를 건너뛴다.

### 1.4 prompt assemble

- request = system parts + messages + tool definitions (`core/session/model-request.ts` `baseTranscript`). system은 `[agent.system || 기본 system.txt(+ tool 지침), initial 지침 묶음]`이고 빈 것은 뺀다.
- 기본 system prompt(`core/session/runner/prompt/system.txt`)는 짧다: 정체성 한 줄, `# Harness`(GFM, `<system-reminder>` 설명, 병렬 호출), `# Communication`, `# Working in codebases`. 그 사이에 `${OPENCODE_TOOL_GUIDANCE}`가 들어가고 `shell`, `write`, `edit` tool이 켜져 있을 때만 해당 문장이 나온다(`core/session/system-prompt.ts`). 즉 prompt 문구가 활성 tool 목록에서 파생된다.
- `initial` 지침 묶음(처음 한 번 system에 들어가는 baseline)의 순서. "가장 많은 session이 공유하는 것부터 가장 적게" 정렬해 prompt cache prefix를 오래 유지한다고 코드 주석에 적혀 있다(`core/session/context.ts` 143~157줄):
  1. Code Mode tool catalog
  2. MCP 지침
  3. references
  4. skill 목록
  5. AGENTS.md 묶음(`Instructions from: <path>\n<내용>`)
  6. 날짜(`Today's date: ...`)와 환경(`<env>` 블록: Working directory, Workspace root, git repo 여부, Platform, 임시 디렉터리 안내)
  7. session별 entry
- 지침은 key를 붙인 source로 관리한다. 값의 hash를 저장해 두고 요청마다 읽어서 달라지면 delta를 `InstructionsUpdated` event로 기록한다(`core/session/instruction-state.ts`). 날짜가 바뀌면 "Today's date is now: ...", 환경이 바뀌면 "The environment you are running in is now: ..."가 이력에 들어간다. baseline은 새 epoch마다 갱신되고 그 이전 delta는 접힌다.
- `<system-reminder>`: system prompt가 "harness 지시이니 따르라"고 알려준다. Plan mode 진입·이탈 문구를 user 역할 synthetic message로, 사용자 prompt 바로 앞에 넣는다(`core/plugin/plan.ts`). 주석: 캐시된 prefix를 데우기 위해 꼬리 가까이에 둔다.
- subagent description 목록, skill 목록, Code Mode catalog는 hook(`session.hook("context" | "compaction" | "generate")`)으로 tool description이나 system에 요청마다 끼운다. 한 plugin이 같은 hook을 세 단계에 모두 건다(`core/tool/plugin/opencode.ts`, `subagent.ts`).
- tool 목록: 요청마다 `registry.snapshot(permissions)`로 그 순간의 정의를 뽑는다. 이름순 정렬로 요청 간 byte 동일성을 유지한다(`core/tool.ts` 253줄). 그 뒤 reload가 와도 이미 보낸 요청에는 영향이 없다.
- `steps`: 마지막 step에서 tool이 제거되고 요약 답을 하게 한다(문서).
- compaction: 별도 hidden agent `compaction`이 한다. 요약 template은 `<template>` 안에 `## Next Move`, `## Relevant Files`, `## Important Context` 등의 section을 두고 AGENTS.md와 환경 정보는 요약에서 빼라고 지시한다(그 정보는 다음 요청에 최신본이 따로 들어가므로). 설정은 `auto: true`, `keep: 15_000`(token) 기본. 이전 요약이 있으면 "update" prompt로 하나로 합친다. (`core/session/compaction.ts`)
- title, summary는 hidden agent가 각자 system prompt와 "전부 deny" permission으로 작은 모델에 시킨다(`core/session/context.ts` `selectTitle`).
- 동적 환경 정보: cwd, 날짜, platform, git 여부는 있다. OS 버전, git status는 없다.

### 1.5 commands(slash command)

- 종류:
  - harness가 바로 실행(TUI command): `packages/tui/src/app.tsx`, `routes/session/index.tsx`에 `/sessions`(`/resume`, `/continue`), `/new`, `/clear`, `/open`, `/models`, `/agents`, `/mcps`, `/variants`, `/connect`, `/settings`, `/status`, `/share`, `/rename`, `/timeline`, `/fork`, `/compact`, `/undo`, `/redo`, `/export`, `/themes`, `/help`, `/exit`, `/reload`, `/debug`, `/stats`, `/diff`, `/btw` 등. `/compact`는 `data.session.compact(...)`로 harness가 compaction을 돌린다(model에는 요약 prompt가 간다).
  - 정해진 prompt를 session에 넣는 core command: `/init`(`core/plugin/command.ts`, 본문 `plugin/command/initialize.txt`, "guided AGENTS.md setup"), `/review`(`review.txt`, 인자: commit, branch, pr, 기본은 uncommitted). `$ARGUMENTS`가 있으면 치환하고 없으면 뒤에 붙인다. 이것은 `ctx.session.prompt(...)`로 보내므로 model에게 간다.
  - 사용자 정의 file/config command: 아래.
  - MCP prompt: server 이름과 prompt 이름을 `sanitize(server):sanitize(prompt)`로 이어 command로 만든다. 인자는 위치로 prompt argument에 대응한다.
  - skill: `@skill-id` 멘션으로 직접 불러온다(문서). skill이 `/` command로 올라오는지는 확인 못함.
- 정의 꼴(`core/config/plugin/command.ts`, `schema/src/config/command.ts`): `commands/**/*.md`(전역 `~/.config/opencode/commands/`, 프로젝트 `.opencode/commands/`) 또는 config `commands` 객체. 옛 `command/` 폴더도 읽는다. front matter: `description`, `agent`, `model`, `subagent`(옛 이름 `subtask`), 본문이 `template`. 하위 폴더는 `team/review`처럼 이름이 된다. 
- template 치환: `$ARGUMENTS`, `$1`, `$2`(마지막 번호는 나머지 인자 전부), 인자 없는 template은 뒤에 붙이기, `` !`cmd` `` shell 출력 삽입(agent의 permission 검사를 거치지 않는다고 문서가 경고), `@path`는 확장하지 않는다(문서 `commands`).
- 실행: `agent`가 있으면 session의 agent를 바꾸고, `model`이 있으면 model을 바꾼 뒤 prompt를 보낸다. `subagent: true`나 agent가 subagent mode면 자식 session을 만들어 background로 돌리고 결과를 부모가 받는다.
- 우선순위: 같은 이름은 나중 정의가 덮는다. 프로젝트가 전역을, 가까운 폴더가 먼 폴더를 덮는다. 사용자 정의가 빌트인도 덮을 수 있다.
- 문서의 한 줄: 문서 `commands` 쪽은 빌트인 command를 나열하지 않는다.

### 1.6 skills

- 꼴: 폴더의 `SKILL.md` 또는 source 루트의 단일 `.md`. front matter: `name`, `description`, `metadata`(`opencode/autoinvoke`), `disable-model-invocation`. `license`, `compatibility`는 받아들이지만 해석하지 않는다(문서). id는 파일 경로에서 나오고 `name`은 표시용이다(`core/config/plugin/skill-file.ts`).
- 위치(문서 `skills`, 코드 `core/config/plugin/skill.ts`, `compatibility.ts`): 전역 `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills`; 프로젝트 `.opencode/skills`, `.claude/skills`, `.agents/skills`(현재 디렉터리에서 project root까지); config `skills` 배열(로컬 경로, `~/`, HTTP catalog URL). 중복 id는 나중에 등록된 것이 이긴다. 빌트인이 가장 낮고 config 명시가 가장 높다.
- 빌트인: `opencode`(OpenCode 사용법 질문용), `report`(issue 보고용). 본문은 `core/plugin/skill/*.md`, 이름과 설명은 `core/plugin/skill.ts`에 코드로 등록.
- prompt에 넣는 법: 요청의 system baseline에 `<available_skills>` 아래 `<skill>`마다 `id`, `name`, `description`만 넣는다(본문 없음). 문구: "Use the skill tool to load a skill when a task matches its description." 사용자가 직접 부르면 본문이 `<skill_content>` 블록으로 대화에 들어오고 같은 모양이라 다시 부를 필요가 없다고 적어 둔다. 목록이 바뀌면 추가·삭제는 작은 delta로, 그 외는 전체를 다시 보낸다(`core/skill/instructions.ts`).
- 본문 읽기: model이 `skill` tool을 `id`로 부르면 `<skill_content name=...>` 블록이 tool 결과로 온다. 블록 안에 `Base directory`와 같은 폴더의 파일 최대 10개 목록(`<skill_files>`)이 있다. 나머지 파일은 자동으로 읽지 않는다(`core/skill.ts` `toModelOutput`, `prepare`).
- 끄고 켜기: (1) `description`이 없으면 목록에 나오지 않는다. (2) `metadata.opencode/autoinvoke: false` 또는 `disable-model-invocation: true`면 목록에서 빠지지만 id를 알면 부를 수 있다. (3) `skill` action의 permission rule로 id별 allow, ask, deny. deny하면 목록에서도 로드에서도 빠진다. agent별 rule도 된다. (`core/skill.ts` `available`)

---

## 2. pi

pi는 의도적으로 최소다. README: "Pi ships with powerful defaults but skips features like sub-agents and plan mode. Ask Pi to build what you want, or install a package that does it your way." (`packages/coding-agent/README.md` 19줄). permission 체계도 없다.

### 2.1 공통 tools

- 빌트인 이름(`src/core/tools/index.ts`): `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, `ls`. 기본 활성은 `read`, `bash`, `edit`, `write` 네 개다(`docs/cli.md` 128줄, `defaultTools` 설정으로 바꿈). 전부 소문자 짧은 단어. 
- 추가 빌트인 extension tool 둘: `codemode`(QuickJS 샌드박스에서 JS로 다른 tool을 호출, `tools.<name>(args)`), `tool_search`. 기본은 꺼져 있고 MCP server가 필요로 할 때 MCP extension이 켠다(`docs/cli.md` 151~182줄).
- tool 정의 꼴(`ToolDefinition`, `src/core/tools/*.ts`, `docs/extensions.md`): `name`, `label`, `description`(model용), `promptSnippet`(system prompt tool 목록에 들어가는 한 줄), `promptGuidelines`(system prompt rules에 합쳐지는 bullet), `parameters`(TypeBox), `execute()`. 선택적으로 `outputSchema`, `structuredContent`, `exposure`, `namespace`, `annotations`, `reachesTools`, `prepareLoadout`.
- input schema: TypeBox `Type.Object`에 필드마다 `description`. 예: `read {path, offset?, limit?}`, `bash {command, timeout?}`(초 단위), `edit {path, edits: [{oldText, newText}]}`(한 호출에 겹치지 않는 여러 편집), `grep {pattern, path?, glob?, ignoreCase?, literal?, context?, limit?}`, `find {pattern, path?, limit?}`, `ls {path?, limit?}`.
- description에 한도를 숫자로 넣는다: read는 `DEFAULT_MAX_LINES`줄 또는 `DEFAULT_MAX_BYTES/1024`KB, grep은 100개 match, ls는 500개, find는 1000개. 잘리면 계속 읽는 법(offset)을 알려 준다.
- 결과: `content`(model에게)와 `details`(렌더·상태 복원용). 실패는 `throw`. `isError: true`로 데이터를 가진 실패도 낼 수 있다. `terminate: true`로 자동 후속 turn을 건너뛴다.
- annotation: MCP 의미의 `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`를 tool이 가질 수 있다(`core/extensions/types.ts` 519~524줄). MCP tool은 server가 선언한 값을 가진다. 값은 검증하지 않고, 권한 extension이 `tool_call` handler에서 이 hint를 보고 확인을 띄우는 예가 문서에 있다. pi 자체는 hint로 아무것도 막지 않는다.
- tool 노출 방식(`exposure`): `direct`(기본, 선언되고 호출 가능), `model-only`, `codemode`(codemode 스크립트에서만 호출, model에 선언 안 함), `deferred`(`tool_search`로 찾아 켬), `hidden`.
- 파일 변경 tool은 `withFileMutationQueue()`로 read-modify-write 전체를 직렬화한다(`docs/extensions.md`, `src/core/tools/file-mutation-queue.ts`). 한 assistant message의 tool call은 병렬 실행될 수 있다.
- 한 tool이 다른 tool을 호출: `ctx.executeTool(name, args)`. 검증과 `tool_call`/`tool_result` handler를 똑같이 거치고, 중첩 호출은 transcript에 별도 entry를 남기지 않고 `nestedCalls` 기록만 쌓는다.

### 2.2 agent·role·mode별 tools

- agent 정의, role, subagent, plan mode 개념이 없다. 확인한 근거는 README 19줄과 `docs/` 전체에서 해당 기능 문서가 없다는 점이다. extension으로 직접 만들 수 있다는 전제다.
- tool 선택은 CLI 인자와 설정이다: `--tools a,b`(allowlist, `*` 패턴 지원), `+name`/`-name`만 쓰면 기본 선택을 조정, `--exclude-tools`(패턴으로 제외, MCP 포함), `--no-builtin-tools`, `--no-tools`; 설정 `defaultTools` (`docs/cli.md` 119~128줄). MCP tool은 `--tools`에 `mcp__`로 시작하는 항목이 하나라도 있어야 같이 걸러진다.
- 실행 중에 바꾸기: extension이 `pi.setActiveTools([...])`로 활성 집합을 바꾼다. 이름은 이미 등록돼 있어야 한다. 변경은 transcript에 `toolsAdded`/`toolsRemoved`가 붙은 system message로 기록된다(아래 2.4). `prepareLoadout`은 tool이 활성일 때 model이 보는 선언을 바꾸거나 일부를 숨긴다(`hiddenDeclarations`).
- permission: 없다. "Pi does not ask before every tool call... use a sandbox"(`docs/usage.md`). 켜진 tool은 pi 프로세스의 OS 권한으로 돈다(`docs/how-pi-works.md` 마지막 절). 막고 싶으면 extension의 `tool_call` handler가 입력을 바꾸거나 `{ block: true, reason }`을 돌려준다. handler가 예외를 내면 fail-safe로 block된다.
- 신뢰 단위는 project trust다: 프로젝트의 `.pi/`(settings, extensions, skills, prompts, SYSTEM.md 등)는 사용자가 신뢰를 준 뒤에만 읽는다. 단 context file(AGENTS.md)은 trust와 무관하게 읽는다(`docs/configuration.md`).

### 2.3 지침(instructions)

- 파일 이름: 디렉터리마다 `AGENTS.override.md` > `AGENTS.md` > `AGENTS.MD` > `CLAUDE.md` > `CLAUDE.MD` 순으로 처음 있는 하나만 읽는다(`src/core/resource-loader.ts` `loadContextFileFromDir`). `AGENTS.override.md`는 같은 디렉터리의 AGENTS.md/CLAUDE.md만 대체한다.
- 층(`loadProjectContextFiles`): 1) agent 디렉터리 `~/.pi/agent/`(`PI_CODING_AGENT_DIR`로 변경), 2) cwd에서 파일시스템 루트까지 모든 상위 디렉터리, 먼 쪽부터 가까운 쪽 순서. 같은 경로는 한 번만. git worktree 안에서 메인 repo 파일과 중복되는 것은 제외한다. 합쳐서 모두 넣는다.
- system prompt 자체를 바꾸는 파일: `SYSTEM.md`(교체), `APPEND_SYSTEM.md`(덧붙임). 프로젝트 `.pi/`가 agent 디렉터리 것을 덮고 같은 이름은 합치지 않는다(`docs/configuration.md`). CLI: `--system-prompt <text|path>`, `--append-system-prompt <text|path>`, `--no-context-files`.
- 넣는 곳: system prompt 안 `<project_context>` section. 파일마다 `<project_instructions path="...">...</project_instructions>`로 감싼다(`src/core/system-prompt.ts` `renderProjectContext`).
- 크기 제한: 확인 못함.
- 하위 디렉터리에서 필요할 때 읽는 JIT 로드는 없다(cwd 위쪽 경로만 본다).
- agent별 지침은 개념이 없다.

### 2.4 prompt assemble

- 흐름(`docs/how-pi-works.md`): system prompt + active branch의 이력 + tool 정의 + model 설정 → provider. tool과 skill 설명은 request에 같이 간다.
- system prompt는 section map으로 만든다(`buildSystemPromptSections`). 순서:
  1. `preamble`(태그 없는 본문): "You are an expert coding assistant operating inside pi, a coding agent harness..." (`SYSTEM.md`가 있으면 그 내용)
  2. `<tools>`: 활성 tool 중 `promptSnippet`이 있는 것의 `- name: snippet` 목록 + "other custom tools" 문장
  3. `<rules>`: tool별 `promptGuidelines` + 전역 guideline + "Be concise", "Show file paths clearly" (중복 제거). bash만 있고 grep/find/ls가 없으면 "Use bash for file operations like ls, rg, find"를 넣는다
  4. `<docs>`: pi 자기 문서 경로(사용자가 pi 자체를 물을 때만 읽으라고 안내)
  5. `<addendum>`: `APPEND_SYSTEM.md`/`--append-system-prompt`
  6. `<project_context>`
  7. `<skills>`
  8. `<cwd>`
  9. extension이 넣은 custom section
  `SYSTEM.md`를 쓰면 2~4(`tools`, `rules`, `docs`)가 사라지고 preamble만 바뀐다.
- 날짜, OS, git status는 넣지 않는다. cwd만 있다(grep으로 "current date" 없음 확인). bash tool 환경에는 `PI_*` 환경변수로 model·session 정보를 노출한다는 guideline이 있다.
- cache를 위한 배치: transcript 첫 system message에 구조화된 section 전체와 초기 tool 집합을 기록하고, 이후 변경은 system message에 section patch(`sections: { name: text | null }`)나 `toolsAdded`/`toolsRemoved`를 덧붙인다. "Providers that cannot represent the transition receive a complete transcript checkpoint, which can invalidate the cached prefix."(`docs/extensions.md`). section diff 로직은 `diffSystemPromptSections`, `_preparePromptAndToolLoadout`(`src/core/agent-session.ts` 1735줄 근처). extension이 `systemPrompt`를 돌려주면 그 turn 한정으로 전체 교체(forced)인데 transcript에는 구조화 section을 계속 기록한다.
- 별도 cache 기능: `cache_warming_decision` event, 요약 요청은 cache write를 끈다(`docs/compaction.md`).
- 끼워 넣기: extension 이벤트 `before_agent_start`(prompt, 선택된 tool, section을 보고 바꿈, 메시지 추가), `context`(system 제외한 메시지를 변환), `context_with_system`, `turn_end`/`agent_before_settle`(entry 추가 + 한 번 더 이어가기). steering(현재 turn 뒤에 끼움)과 follow-up(작업 다 끝나고)이 queue로 들어온다.
- compaction: `contextTokens > contextWindow - reserveTokens`(기본 16384)에서 자동. `/compact [instructions]`로 수동. 최근 `keepRecentTokens`(기본 20k)를 남기고 앞 부분을 LLM으로 요약해 `CompactionEntry`(summary + `firstKeptEntryId`)를 session tree에 추가한다. 원본 entry는 남고 다음 request 이력만 요약 + 이후 메시지로 바뀐다. 요약은 구조화 형식이고 이전 요약을 이어받으며 파일 조작 기록을 누적한다(`docs/compaction.md`). `/tree` 이동 시 branch summarization이 따로 있다.
- 이력 단위: JSONL session, entry마다 id와 parent. active branch가 request 이력이다.

### 2.5 commands(slash command)

- 빌트인(`src/core/slash-commands.ts` `BUILTIN_SLASH_COMMANDS`, `docs/slash-commands.md`): `/settings`, `/model`, `/tree`, `/thinking`, `/scoped-models`, `/export`, `/import`, `/share`, `/bug`, `/copy`, `/name`, `/session`, `/changelog`, `/hotkeys`, `/fork`, `/clone`, `/trust`, `/login`, `/logout`, `/new`, `/compact`, `/resume`, `/reload`, `/quit` (문서에는 `/llama`도). 코드로 확인한 바로는 이것들은 harness가 직접 처리한다. `/compact`는 harness가 요약 요청을 따로 보내는 것으로 일반 user message로 가지 않는다.
- `!cmd`는 실행해서 출력을 대화에 넣고, `!!cmd`는 실행만 하고 model에는 보내지 않는다(`docs/usage.md`). `@`로 파일 추가.
- prompt template(`docs/prompt-templates.md`, `src/core/prompt-templates.ts`): `~/.pi/agent/prompts/*.md`, `.pi/prompts/*.md`(trust 후)의 직접 자식 `.md`만. 파일 이름이 command 이름. front matter `description`(없으면 첫 비어 있지 않은 줄), `argument-hint`. 치환: `$1`, `$@`/`$ARGUMENTS`, `${1:-default}`, `${@:N}`, `${@:N:L}`. 따옴표로 묶인 인자 지원. template은 editor 입력 단계에서 펼쳐져 user message가 된다. extension은 원문을 `input` event로 먼저 본다.
- skill command: `/skill:name [args]`. 본문을 `<skill name=... location=...>` 블록으로 펼쳐 user message에 넣고 인자는 뒤에 붙인다(`agent-session.ts` `_expandSkillCommand` 2173줄). `enableSkillCommands` 설정이 메뉴 노출만 정한다.
- extension command: `pi.registerCommand(name, { description, handler })`. 같은 이름의 prompt template보다 먼저 처리된다.
- MCP prompt가 command로 올라오는지는 확인 못함(`docs/mcp.md`를 끝까지 보지 않음).
- built-in 가운데 `/init`, `/review`에 해당하는 것은 없다.

### 2.6 skills

- 꼴: Agent Skills 규격. 폴더의 `SKILL.md` + front matter(`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`(실험), `disable-model-invocation`). name은 소문자·숫자·하이픈, 최대 64자, description 최대 1024자(`src/core/skills.ts` 검증). description이 없거나 형식이 깨지면 로드하지 않는다. 이름이 충돌하면 먼저 찾은 것을 둔다.
- 위치: 전역 `~/.pi/agent/skills/`, `~/.agents/skills/`; 프로젝트 `.pi/skills/`, `.agents/skills/`(cwd에서 위로 repo root까지); settings의 resource 경로; pi package(npm, git). 폴더는 `SKILL.md`를 재귀로 찾는다. `.gitignore`, `.ignore`, `.fdignore`를 존중한다.
- 빌트인 skill: 확인 못함(찾은 것 없음).
- prompt: system prompt `<skills>` section에 `<available_skills>` + `<skill>` 마다 `name`, `description`, `location`(파일 경로). 문구는 읽기 tool 이름에 맞게 달라진다("Use the read tool to load a skill's file..."). `disable-model-invocation: true`면 목록에서 뺀다. 본문은 model이 `read`(없으면 `bash`)로 `SKILL.md`를 읽을 때 들어온다. 전용 skill tool이 없다.
- 끄기: `-ns`/`--no-skills`, `disable-model-invocation`, extension의 skills override, resource 설정.

---

## 3. Gemini CLI

### 3.1 공통 tools

- 빌트인 이름(`core/tools/definitions/base-declarations.ts`, `core/tools/tool-names.ts`): `glob`, `grep_search`, `list_directory`, `read_file`, `read_many_files`, `write_file`, `replace`(편집), `run_shell_command`, `google_web_search`, `web_fetch`, `write_todos`, `activate_skill`, `ask_user`, `enter_plan_mode`, `exit_plan_mode`, `get_internal_docs`, `update_topic`, `complete_task`, `read_mcp_resource`, `list_mcp_resources`, `invoke_agent`, 그리고 tracker tool 6개(`tracker_create_task` 등). 이름은 `snake_case`, 동사_명사 꼴. UI용 표시 이름(`ReadFile`, `FindFiles`, ...)이 따로 있다. 옛 이름은 `TOOL_LEGACY_ALIASES`(`search_file_content` → `grep_search`)로 policy, hook에서 같이 취급한다.
- MCP tool은 `mcp_` prefix + server 이름이 붙은 fully qualified name(`mcp_<server>_<tool>`)으로 노출한다(`core/tools/mcp-tool.ts`).
- 정의가 model 계열별로 두 벌이다: `model-family-sets/default-legacy.ts`, `gemini-3.ts`. `resolver.ts`가 모델에 맞는 세트를 고른다. 예: gemini-3 `read_file` description은 "you MUST use start_line and end_line for targeted, surgical reads", 한도(줄 수, 줄당 글자, MB)를 숫자로 적는다.
- schema는 JSON Schema(`parametersJsonSchema`)이고 `description`을 필드마다 쓴다. 예: `read_file {file_path, start_line?, end_line?}`, `write_file {file_path, content}`(주석: placeholder 금지), `run_shell_command {command, description, dir_path?, is_background?}`(`description`은 사용자에게 보일 한 줄 설명, 필수). 파라미터 이름은 상수(`PARAM_FILE_PATH` 등)로 공유한다.
- 읽기·쓰기·외부 효과 표시: tool마다 `kind`(enum `Kind`: `read`, `edit`, `delete`, `move`, `search`, `execute`, `think`, `agent`, `fetch`, `communicate`, `plan`, `switch_mode`, ...). `MUTATOR_KINDS = [edit, delete, move, execute]`, `READ_ONLY_KINDS = [read, search, fetch]`이고 읽기 전용 kind만 병렬로 돌려도 안전하다고 표시한다(`core/tools/tools.ts` 1116~1145줄). 예: `read_file`=Read, `replace`=Edit, `run_shell_command`=Execute, `web_fetch`=Fetch, `ask_user`=Communicate.
- MCP annotation: MCP tool의 `readOnlyHint === true`이면 `isReadOnly`로 `DiscoveredMCPTool`에 넘기고, policy 요청과 confirmation bus 메시지에도 annotation을 그대로 싣는다(`core/tools/mcp-client.ts` 1371줄, `policy/types.ts` 146줄).
- 파일을 다루는 tool(`read_file`, `list_directory`, `write_file`, `replace`, `read_many_files`)은 결과에 하위 GEMINI.md를 JIT로 덧붙인다(`core/tools/jit-context.ts`: `--- Newly Discovered Project Context ---`).
- 외부 데이터 tool 출력은 `<untrusted_context>` 태그로 감싼다고 core mandates에 적혀 있다.

### 3.2 agent·role·mode별 tools

- subagent 정의(`docs/core/subagents.md`, `core/agents/agentLoader.ts`): markdown + YAML front matter, 본문이 system prompt. 위치 `.gemini/agents/*.md`(프로젝트), `~/.gemini/agents/*.md`(사용자), extension의 `agents/`. schema(zod `.strict()`): `name`(slug), `description`, `kind`(`local` 기본 | `remote`), `display_name`, `tools`(배열, 와일드카드 `*`, `mcp_*`, `mcp_<server>_*`; 생략하면 부모 tool을 전부 상속), `mcp_servers`(그 agent 전용 inline MCP; 문서는 `mcpServers`라고 쓰지만 loader 코드는 `mcp_servers`), `model`(기본 `inherit`), `temperature`, `max_turns`(기본 30), `timeout_mins`(기본 10).
- 빌트인 subagent: `codebase_investigator`, `cli_help`, `generalist`(부모 tool 전체 상속), `browser_agent`(기본 꺼짐, 켜면 chrome-devtools-mcp). 설정 `agents.overrides.<name>`로 model, runConfig, enabled를 덮는다.
- 호출: `invoke_agent` tool 하나(`agent_name`, `prompt`)가 등록된 subagent를 찾아 실행한다(`core/agents/agent-tool.ts`). 문서는 "subagent가 같은 이름의 tool로 노출된다"고 쓰지만 코드는 통합 tool이다. prompt 쪽에서도 `invoke_agent`로 `agent_name`을 넘기라고 한다. 사용자는 `@agent_name ...`으로 강제 지정할 수 있고 이때 system note를 끼워 넣는다.
- 재귀 방지: subagent는 다른 subagent를 볼 수도 부를 수도 없다. `tools: ['*']`여도 그렇다.
- 격리: 요청마다 선언되는 tool 집합이 agent별 레지스트리다("Subagent tool isolation").
- mode는 approval mode(`default`, `autoEdit`, `plan`, `yolo`)다. `Shift+Tab`으로 돌린다. 토큰의 뜻은 tool 집합이 아니라 policy engine의 규칙 집합이다:
  - policy engine(TOML `[[rule]]`; `toolName`, `mcpName`, `argsPattern`, `commandPrefix`, `modes`, `interactive`, `subagent`, `decision`(`allow` | `deny` | `ask_user`), `priority` 0~999, `denyMessage`). 가장 높은 final priority가 이긴다. tier: default 1, extension 2, workspace 3(현재 비활성이라고 문서에 경고), user 4, admin 5. final = tier + priority/1000. (`docs/reference/policy-engine.md`)
  - 빌트인 policy 파일(`core/policy/policies/*.toml`): `read-only.toml`(읽기 tool allow, 50), `write.toml`(쓰기 tool은 ask_user, 10), `plan.toml`(plan mode에서 `*` deny 40, 읽기·검색·`ask_user`·research subagent·`.md` plan 파일 쓰기만 allow 50, mode 전환 70), `yolo.toml`(allow-all 999), `agents.toml`, `non-interactive.toml`, `discovered.toml`, `sandbox-default.toml`, `conseca.toml`.
  - 전역 deny(argsPattern 없음)된 tool은 모델의 선언 목록에서도 빠진다("completely excluded from the model's memory", 문서). 인자 패턴 deny는 호출 시점에만 막는다.
  - 설정 기반: `tools.core`(allowlist), `tools.exclude`(문서상 policy deny로 대체되는 deprecated), `tools.allowed`(확인 우회, `run_shell_command(git)` 같은 꼴), `tools.confirmationRequired`. CLI: `--allowed-tools`, `--exclude-tools`.
  - subagent별 policy: rule에 `subagent = "name"`. 없으면 모두에게 적용.
  - extension의 policy는 `allow`와 `yolo` 설정을 무시한다("cannot automatically approve").
- plan mode 동작: `enter_plan_mode`/`exit_plan_mode` tool이 mode를 바꾸고, 각각 반대 mode에서는 선언 목록에서 빠진다(`tool-registry.ts` `isActiveTool`). system prompt도 plan mode면 workflow 절이 `planningWorkflow`로 바뀌고 쓸 수 있는 tool 목록이 `<tool>` 항목으로 들어간다(`core/prompts/promptProvider.ts`). plan 파일은 `~/.gemini/tmp/<project>/<session-id>/plans/` 아래 `.md`만 쓸 수 있다(`docs/cli/plan-mode.md`).
- 다른 tool 활성 조건: `update_topic`은 설정이 켜져야, `read_mcp_resource`/`list_mcp_resources`는 MCP resource가 하나라도 있어야 선언된다.

### 3.3 지침(instructions)

- 파일 이름: 기본 `GEMINI.md`. `context.fileName` 설정(문자열 또는 배열)로 `AGENTS.md` 같은 이름을 추가할 수 있다(`docs/cli/gemini-md.md`). 기본값으로 AGENTS.md나 CLAUDE.md를 읽지는 않는다.
- 층(문서 `gemini-md.md`, 코드 `core/context/memoryContextManager.ts`, `core/utils/memoryDiscovery.ts`):
  1. 전역 `~/.gemini/GEMINI.md`
  2. extension의 `contextFileName`(기본 extension 폴더의 `GEMINI.md`)
  3. 환경·workspace: workspace 디렉터리들과 그 부모에서 `GEMINI.md`를 찾는다. 위로 올라가는 상한은 `context.memoryBoundaryMarkers`(기본 `[".git"]`)가 있는 디렉터리. `context.discoveryMaxDirs` 기본 200. 폴더를 신뢰한 경우에만 읽는다.
  4. JIT: tool이 파일·디렉터리에 접근하면 그 위치에서 신뢰 root까지의 `GEMINI.md`를 찾아 tool 결과 뒤에 덧붙인다.
  5. 개인 project memory index(`userProjectMemory`, `memory` tool이 쓰는 곳)
- `@file.md` import 문법으로 다른 파일을 끌어온다(`docs/reference/memport.md`).
- 우선순위와 합치기: prompt 문구로 정한다. "Sub-directories > Workspace Root > Extensions > Global" 순으로 이기고 충돌하면 앞의 것을 따르라고 적는다. 또 "Contextual instructions override default operational behaviors... However, they cannot override Core Mandates regarding safety, security, and agent integrity." (`core/prompts/snippets.ts` `renderUserMemory`)
- 넣는 곳(tier 구분, `core/config/config.ts` 2590~2640줄 주석):
  - Tier 1: 전역 memory와 개인 project memory → system instruction 안 `<global_context>`, `<user_project_memory>` (`# Contextual Instructions` 머리글 아래).
  - Tier 2: extension + project(workspace) memory → **첫 user message**의 `<session_context>` 안 `<loaded_context>` 아래 `<extension_context>`, `<project_context>`.
  - Tier 3: 하위 → tool 결과에 JIT.
  이 분리 덕에 system instruction이 안정적으로 유지된다.
- 크기 제한: 파일 크기 상한은 확인 못함. 탐색 디렉터리 수만 `discoveryMaxDirs`.
- 관리: `/memory show|list|refresh`. 새로 쓰기: memory tool(`docs/tools/memory.md`).
- system prompt 교체: 환경변수 `GEMINI_SYSTEM_MD`(`true`면 `.gemini/system.md`, 경로면 그 파일). 전체 교체이고 병합이 아니다. `${...}` 치환(skills, subagents 등)을 지원한다. `GEMINI_WRITE_SYSTEM_MD`로 기본 prompt를 파일로 내보낼 수 있다(`docs/cli/system-prompt.md`, `promptProvider.ts`).
- section 단위 끄기: `isSectionEnabled(key)`로 `preamble`, `coreMandates`, `agentContexts`, `agentSkills`, `primaryWorkflows`, `planningWorkflow`, `operationalGuidelines`, `sandbox`, `git`, `finalReminder` 등을 켜고 끈다(환경변수 기반으로 보이나 상세는 확인 못함).

### 3.4 prompt assemble

- request = `systemInstruction` + `tools[{functionDeclarations}]` + `contents`(이력). (`core/core/client.ts` `startChat`)
- 이력의 첫 항목은 user message `<session_context>`(`core/utils/environmentContext.ts`): "This is the Gemini CLI. We are setting up the context for our chat. / Today's date is ... / My operating system is: <platform> / The project's temporary directory is: ... / 디렉터리 구조(설정 `context.includeDirectoryTree`, 기본 true) / Tier 2 memory". 고정 id(`deriveStableId(['environment-context'])`)로 resume할 때 중복을 막는다. 즉 날짜, OS, 폴더 구조는 system이 아니라 첫 user message에 있다.
- system instruction 조립(`core/prompts/promptProvider.ts` → `snippets.ts` `getCoreSystemPrompt`). 순서:
  1. preamble(정체성 + 현재 approval mode 이름: Default/Plan/YOLO/Auto-Edit, interactive 여부)
  2. core mandates(보안, 컨텍스트 효율, 지침 파일 이름 안내)
  3. sub-agents(`# Available Sub-Agents`, `<available_subagents>`에 name, description. `invoke_agent` tool이 활성일 때만)
  4. agent skills(`# Available Agent Skills`, `<available_skills>`에 name, description, location)
  5. hook context 안내
  6. primary workflows 또는 planning workflow(plan mode)
  7. task tracker
  8. operational guidelines
  9. YOLO 안내, sandbox, git repo 안내
  10. (구형 모델만) final reminder
  11. `renderFinalShell`로 Tier 1 memory를 맨 끝에 붙인다.
  활성 tool 이름(`enabledToolNames`)으로 각 section 내용을 조건부로 만든다(예: `write_todos`, `enter_plan_mode`, grep/glob이 있는지).
- 두 벌의 snippet: `snippets.ts`(modern)와 `snippets.legacy.ts`. `supportsModernFeatures(model)`로 선택.
- memory가 바뀌면 `updateSystemInstruction()`이 system instruction을 다시 만들어 chat에 설정한다.
- 활성 topic: 설정이 켜지면 system 끝에 `[Active Topic: ...]`을 덧붙인다.
- reminder류 끼워 넣기: `<hook_context>`(hook이 주입, 읽기 전용 데이터로 취급하라는 안내), subagent `@` 지정 시 system note, `<untrusted_context>` 감싸기. 이력의 tool 출력이 크면 `toolOutputMaskingService`(보호 50000 token, 최소 prunable 30000 token 기본)로 마스킹하고 `toolDistillationService`가 요약한다.
- compaction(`core/context/chatCompressionService.ts`): 기본 임계 0.5(context window의 50%, `DEFAULT_COMPRESSION_TOKEN_THRESHOLD`), 최근 30%는 보존. 별도 compression prompt(`getCompressionPrompt`)로 `<state_snapshot>`을 만들고, 이전 snapshot이 있으면 통합하라고 지시한다. 요약 후 "빠진 것이 없는지 스스로 점검해 FINAL 판을 내라"는 verification 호출을 한 번 더 한다. 결과는 model 역할 message(요약)와 user 역할 message로 이력에 들어간다. `/compress`로 수동.
- tool 목록: `toolRegistry.getFunctionDeclarations(modelId)`. model별 정의를 고르고, 제외된 tool(policy 전역 deny, `tools.exclude`)은 뺀다. 같은 이름은 한 번만.
- system prompt snapshot test가 있다(`tools/definitions/__snapshots__`, `coreToolsModelSnapshots.test.ts`).

### 3.5 commands(slash command)

- command 종류를 코드가 구분한다(`packages/cli/src/ui/commands/types.ts` `CommandKind`): `built-in`, `user-file`, `workspace-file`, `extension-file`, `mcp-prompt`, `agent`, `skill`. 각 loader: `BuiltinCommandLoader`, `FileCommandLoader`, `McpPromptLoader`, `SkillCommandLoader`(`cli/src/services/`).
- command 실행 결과 종류(`core/commands/types.ts`와 cli `types.ts`): `tool`(tool call을 바로 예약, 끝나면 `postSubmitPrompt`), `message`(UI에만 표시), `load_history`(대화 교체), `submit_prompt`(model에게 prompt 전송), `quit`, `dialog`, `confirm_shell_commands`, `confirm_action`, `custom_dialog`, `logout`. 즉 harness 처리와 model 전달이 결과 type으로 갈린다.
- 빌트인(`docs/reference/commands.md`): `/about`, `/agents`(list, reload, enable, disable, config), `/auth`, `/bug`, `/chat`(=`/resume`: list, save, resume, delete, share, debug), `/clear`, `/commands`(list, reload), `/compress`, `/copy`, `/directory`(`/dir`), `/docs`, `/editor`, `/extensions`, `/help`, `/hooks`, `/ide`, `/init`, `/mcp`, `/memory`, `/model`, `/permissions`, `/plan`, `/policies`, `/privacy`, `/quit`, `/restore`, `/rewind`, `/resume`, `/settings`, `/shells`, `/setup-github`, `/skills`, `/stats`, `/terminal-setup`, `/theme`, `/tools`, `/upgrade`, `/vim`. 이 외에 `@`(파일 포함), `!`(shell) prefix.
  - `/init`(`cli/src/ui/commands/initCommand.ts`, `core/commands/init.ts`): 빈 `GEMINI.md`를 만들고 `submit_prompt`로 "프로젝트 분석해서 GEMINI.md 써라" prompt(README 읽기, 최대 10개 파일 탐색 등)를 model에 보낸다. 이미 있으면 메시지만 낸다.
  - `/compress`: harness가 요약 호출을 따로 한다. `/clear`, `/quit`, `/theme`, `/vim` 등은 harness만.
  - `/plan [goal]`: approval mode를 plan으로 바꾸고 goal이 있으면 제출.
  - 검토(review)용 빌트인 command는 없다. extension·skill로 제공.
- 사용자 정의(`docs/cli/custom-commands.md`, `cli/src/services/FileCommandLoader.ts`): TOML. 필수 `prompt`, 선택 `description`만 있다(zod 스키마 `TomlCommandDefSchema`가 이 둘뿐). 위치 `~/.gemini/commands/`(사용자), `<project>/.gemini/commands/`(프로젝트), extension의 `commands/`. 하위 폴더는 `:`로 이은 이름(`git/commit.toml` → `/git:commit`). 같은 이름은 프로젝트가 사용자를 덮는다. extension 이름과 충돌하면 extension 이름을 앞에 붙여 구분한다(`SlashCommandResolver`; 세부는 확인 못함).
- 인자: `{{args}}`(prompt 본문에서는 raw, `!{...}` 안에서는 shell-escape), `{{args}}`가 없으면 prompt 뒤에 두 줄 개행 후 입력한 command 전체를 붙인다. `!{cmd}`로 shell 출력 삽입(실행 전에 정확한 command를 보여 주고 사용자 확인), `@{path}` 파일 내용 삽입 (processor는 `cli/src/services/prompt-processors/`의 `shellProcessor`, `atFileProcessor`, `argumentProcessor`; trigger 상수 `!{`, `@{`는 `types.ts` 49, 54줄).
- 갱신: `/commands reload`.
- MCP prompt는 command로 올라온다(`McpPromptLoader`, `CommandKind.MCP_PROMPT`).
- skill은 `SkillCommandLoader`가 `/<skill-name>` command로 올린다. 실행하면 `activate_skill` tool call을 바로 예약하고(`type: 'tool'`, `toolArgs: { name }`) 뒤에 인자가 있으면 `postSubmitPrompt`로 model에 보낸다.
- subagent도 command로 올라온다(`CommandKind.AGENT`)는 것만 enum에서 확인. 동작은 확인 못함.

### 3.6 skills

- 꼴: Agent Skills 규격, 폴더의 `SKILL.md` + front matter(`name`, `description`). 해석은 `core/skills/skillLoader.ts`.
- 위치와 우선순위(낮은 것부터, `docs/cli/skills.md`): 빌트인 < extension 번들(`skills/`) < 사용자 `~/.gemini/skills/` 또는 `~/.agents/skills/` < 프로젝트 `.gemini/skills/` 또는 `.agents/skills/`. 같은 tier 안에서는 `.agents/skills/`가 `.gemini/skills/`를 이긴다. 이름이 같으면 높은 쪽 승.
- 빌트인(`core/skills/builtin/`): `skill-creator`, `antigravity-support`.
- prompt: 시작 시 system prompt의 `# Available Agent Skills` 아래 `<available_skills>`에 `name`, `description`, `location`만 넣는다. 활성화는 `activate_skill` tool(`name`)로 한다. 활성화할 때 UI가 사용자 확인(이름, 목적, 접근하게 될 디렉터리)을 받고, 승인하면 `SKILL.md` 본문과 폴더 구조가 대화 이력에 들어가며 그 skill 폴더가 허용 파일 경로에 추가된다.
- 끄고 켜기: `/skills list [all] [nodesc]`, `/skills enable|disable <name> [--scope user|workspace]`, `/skills reload`, `/skills link <path>`; 터미널 `gemini skills list|install|uninstall`. 설정으로 skills 지원 자체를 끄는 것도 있다(`isSkillsSupportEnabled`). admin 정책으로도 끈다(`isAdminEnabled`).

---

## 4. harness 사이 비교

| 항목 | OpenCode | pi | Gemini CLI |
|---|---|---|---|
| 공통 tools | 소문자 단어 13개 안팎(`read`, `edit`, `shell`, `subagent`, `skill` ...). 한 객체 정의(Effect Schema). permission action 이름만 표시, readOnlyHint 없음. Code Mode(`execute`)로 묶는 tool 계층 | 소문자 8개(`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `powershell`) 중 기본 4개. TypeBox. MCP식 annotation 4종을 tool이 가질 수 있으나 pi는 쓰지 않음 | `snake_case` 20여 개(`read_file`, `replace`, `run_shell_command` ...). JSON Schema. 모든 tool에 `Kind` enum, MCP `readOnlyHint` 사용. model 계열별 정의 두 벌 |
| agent·mode별 tools | agent = permission ruleset(`action`/`resource`/`effect`, 마지막 일치 승). 전부 deny인 tool은 선언에서 제거. plan = agent 전환. `subagent` tool + 자식 session | agent·subagent·mode 개념 없음. `--tools` allowlist, `setActiveTools`, extension `tool_call`로 block. permission 없음 | approval mode(default, autoEdit, plan, yolo) + 우선순위 policy engine(TOML). subagent는 `tools` allowlist(와일드카드), `invoke_agent`, 재귀 금지. 전역 deny는 선언에서도 제거 |
| 지침 | `AGENTS.md`만. 전역 + 위로 올라가며 + 읽을 때 하위 JIT. 합치기만, 변화는 diff로 이력에 추가. system baseline에 들어감 | `AGENTS.override.md`/`AGENTS.md`/`CLAUDE.md` 중 하나. 전역 + cwd 상위 전부. system prompt `<project_context>`. `SYSTEM.md`/`APPEND_SYSTEM.md` | `GEMINI.md`(설정으로 `AGENTS.md` 추가 가능). 전역/extension/workspace/JIT 5층, tier 1은 system, tier 2는 첫 user message, tier 3은 tool 결과. 우선순위를 prompt 문구로 명시 |
| prompt assemble | system = agent.system 또는 기본 prompt(+ 활성 tool별 문장) + baseline 지침 묶음(cache 순서 주석). 날짜와 `<env>`도 system baseline. 이후 변화는 delta event. reminder는 `<system-reminder>` synthetic message | system을 section map(`preamble`, `tools`, `rules`, `docs`, `addendum`, `project_context`, `skills`, `cwd`)으로. 변경은 system message patch로 transcript에 추가(cache 유지). 날짜 없음, cwd만 | system instruction = section 조합(mode, 활성 tool, 조건부), 끝에 Tier 1 memory. 날짜, OS, 폴더 구조, project memory는 첫 user message `<session_context>` |
| commands | harness command(TUI) 다수 + 정해진 prompt command(`/init`, `/review`) + md template(`commands/*.md`, `$ARGUMENTS`, `` !`cmd` ``, agent/model/subagent 지정) + MCP prompt | harness command 24개 안팎 + prompt template(`prompts/*.md`, `$1`, `$@`, `${1:-x}`) + `/skill:name` + extension `registerCommand`. `/init`, `/review` 없음 | 결과 type으로 구분(`tool`, `message`, `submit_prompt`, `load_history`, dialog ...). 빌트인 40여 개, TOML(`prompt`, `description`, `{{args}}`, `!{}`), MCP prompt, skill, agent, extension |
| skills | `SKILL.md`. 목록(id, name, description)만 system에, 본문은 `skill` tool 호출 결과. `.claude/skills`, `.agents/skills`도 읽음. 빌트인 2개(`opencode`, `report`). permission `skill`로 id별 on/off | `SKILL.md`(Agent Skills). 목록(name, description, location)만 system에, 본문은 `read`로 파일을 읽을 때. 전용 tool 없음. `/skill:name`. 빌트인 없음(확인 못함) | `SKILL.md`. 목록(name, description, location)만 system에, 본문은 `activate_skill` tool + 사용자 확인. `/<skill>` command도 같은 tool을 예약. 빌트인 2개. `/skills enable/disable` |

---

## 5. lophn에 참고할 점

### 사실로 확인된 점

- 세 harness 모두 tool 이름은 짧고 일관된 한 단어 또는 `snake_case`이고, 입력 schema의 필드마다 description을 쓰며, description 안에 한도(줄 수, 바이트)와 잘렸을 때 이어 가는 법을 적는다.
- tool의 읽기·쓰기 성격을 표시하는 방식이 셋 다 다르다: OpenCode는 permission action 이름 하나, Gemini는 `Kind` enum(+ MCP `readOnlyHint`), pi는 MCP 식 annotation을 선택 필드로 두되 pi 자신은 쓰지 않는다. 어디서도 hint만으로 실행을 막지 않는다. 막는 것은 rule 또는 policy(OpenCode permission, Gemini policy engine)이거나 사용자 extension(pi)이다.
- "agent별 tools"를 정하는 방식: OpenCode는 agent마다 permission ruleset을 두고 `deny *`로 목록에서 제거하는 방식, Gemini는 subagent front matter의 `tools` allowlist와 중앙 policy를 같이 쓴다. pi는 하지 않는다.
- 목록에서 아예 빼는 쪽(선언 제거)과 호출 시점에 막는 쪽을 둘 다 갖고 있다. OpenCode는 "전체 deny면 선언 제거", Gemini는 "argsPattern 없는 deny면 선언 제거".
- subagent 호출은 tool 하나(`subagent` / `invoke_agent`)이고, 부를 수 있는 목록을 그 tool의 description 또는 system prompt에 동적으로 넣는다. 중첩은 막거나(Gemini 완전 금지, OpenCode 기본 깊이 1) 설정으로 푼다.
- 지침 파일은 이름이 다르지만(`AGENTS.md`, `GEMINI.md`, 병행 `CLAUDE.md`) 층 구조는 비슷하다: 전역 → 상위 디렉터리 → (OpenCode, Gemini) 읽는 시점의 하위. OpenCode는 `CLAUDE.md`를 읽지 않고, pi는 읽고, Gemini는 설정으로만 이름을 늘린다.
- 지침을 넣는 위치가 다르다: OpenCode는 system baseline + 이후 delta를 이력에, pi는 system section, Gemini는 전역만 system이고 프로젝트는 첫 user message(안정적인 system을 유지하려는 의도가 코드 주석에 있음).
- 동적 환경 정보(날짜, platform, cwd)는 OpenCode가 baseline 지침의 일부로(`Today's date`, `<env>`), Gemini가 첫 user message로, pi는 cwd만 system 끝에 넣는다.
- cache를 의식한 배치 흔적은 셋 다 있다: OpenCode는 공유 많은 것부터 정렬하고 tool을 이름순 정렬, pi는 system 변경을 patch로 덧붙이고 불가능한 provider에서는 checkpoint, Gemini는 Tier 구분.
- prompt에 들어가는 tool 안내문을 활성 tool 목록에서 만든다(OpenCode `OPENCODE_TOOL_GUIDANCE`, pi `rules`, Gemini section 조건). 꺼진 tool을 prompt가 언급하지 않게 하려는 장치다.
- skill은 셋 다 목록(이름, 설명, 경로 또는 id)만 prompt에 두고 본문은 필요할 때 읽는다. 읽는 수단은 전용 tool(OpenCode `skill`, Gemini `activate_skill`) 또는 일반 `read`(pi)이다. Gemini만 사용자 확인을 거친다. OpenCode, pi, Gemini 모두 `.agents/skills`를 읽는다. OpenCode는 `.claude/skills`도 읽는다.
- command는 "harness가 처리"와 "prompt를 model에 보냄"이 코드에서 나뉘어 있다. Gemini는 반환 type(`message`, `submit_prompt`, `tool` ...)으로, OpenCode는 TUI action과 core command(`ctx.session.prompt`)로 나뉜다. `/compact`류는 셋 다 harness가 요약 호출을 따로 한다. `/init`은 OpenCode와 Gemini에 있고 정해진 prompt를 보내는 command다.
- compaction은 셋 다 별도 요약 호출이며 summary template이 구조화돼 있다. OpenCode는 AGENTS.md와 환경 정보를 요약에서 빼라고 지시한다(다음 요청에 최신본이 따로 들어가므로).

### lead의 추론(검증하지 않음)

- agent definition spec에서 "tools"를 하나의 allowlist로 쓸지 permission ruleset으로 쓸지 정해야 한다. lophn은 role(App Engineer, Operator, Context Engineer, lophn)이 고정이고 외부 효과가 크니 allowlist(선언에서 제거)가 먼저 기본이고, 호출 시점 규칙은 그 위의 선택 사항으로 두는 것이 단순하다. OpenCode의 "전체 deny면 선언 제거"와 Gemini의 `tools` 와일드카드 모양이 참고가 된다.
- tool의 읽기·쓰기·외부 효과는 hint 한 값(Gemini의 `Kind`처럼 닫힌 enum)으로 정의에 두고, 막는 일은 role의 tool 목록과 permission이 맡는 구분이 세 harness의 공통 구조와 맞는다.
- 지침 층(전역, project, 하위, role별)은 "role별" 층을 새로 가진다. OpenCode의 agent `system`(prompt 전체 대체, project instructions는 유지)과 pi의 `APPEND_SYSTEM.md`(덧붙임)가 두 선택지다. 대체와 덧붙임을 구분해 정의하면 role마다 prompt를 쉽게 쓸 수 있다.
- 매 요청 바뀌는 정보(날짜, 환경)는 system 끝쪽이나 별도 message로 두고 안정적인 지침은 앞쪽에 두는 것이 세 harness가 모두 택한 방향이다. 변경을 delta로 이력에 쌓는 OpenCode 방식은 cache에는 유리하나 구현이 크다(key, hash, event).
- skill은 "이름과 설명만 먼저, 본문은 호출 시"가 공통이므로 lophn도 같은 방식으로 두면 된다. 전용 tool로 읽게 하면 권한과 사용 기록을 한 곳에서 다룰 수 있다.
- command를 "harness 처리"와 "model에게 prompt 전달"로 정의 단계에서 구분해 두면(Gemini의 반환 type 같은) 나중에 compact, recap 같은 command를 추가할 때 헷갈리지 않는다.

### 확인 못한 것

- OpenCode: 지침 파일 크기 상한, `patch` tool의 GPT gating 코드 위치, skill이 `/` command로 올라오는지, TUI 바깥(web, desktop)의 command 목록.
- pi: 빌트인 skill 유무, MCP prompt의 command 노출, 지침 파일 크기 상한. `docs/mcp.md`, `docs/settings.md`는 끝까지 읽지 않았다.
- Gemini CLI: 지침 파일 크기 상한, `isSectionEnabled`가 읽는 환경변수 이름, extension 이름 충돌 시 command 이름 규칙의 정확한 모양, agent command(`CommandKind.AGENT`)의 동작.
