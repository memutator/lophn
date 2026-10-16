# R5 조사: session 도중 지침이 바뀔 때 (2026-10-15)

범위: `research-items.md`의 "R5. session 도중 지침이 바뀔 때". 지침 파일(AGENTS.md류, 사용자 지침, agent 정의)이 열린 session 도중 바뀌면 다음 turn에 반영하나, 다음 session부터 쓰나. 반영한다면 어떤 꼴로 어디에 넣나. cache에는 어떤 영향이 있나.

## 대상과 근거

빈 곳 3개(Claude Code, Gemini CLI, Goose)는 새로 조사했고, 이미 있던 4개(OpenCode, Codex, Hermes, pi)는 더 새 commit에서 핵심 줄만 다시 확인했다. 받은 위치는 `/tmp/claude-1000/-home-pyosechang-projects-lophn-project-docs/c3fd2111-562b-41c5-8a67-86a862b12e16/scratchpad/repos/r5/<이름>/repo/`이고 읽기만 했다. 실행, install, build는 하지 않았다. 경로는 각 repo 루트 기준이다.

| 대상 | 근거 | 버전 |
|---|---|---|
| Claude Code | 공식 문서 `code.claude.com/docs/en/` 의 `prompt-caching`, `memory`, `context-window`, `hooks`, `sub-agents`, `glossary` (2026-10-15 조회). 캡처 `claude-code-prompt-assembly copy.md`(v2.1.299). source는 보지 않았다 | 문서 현재판, 캡처 v2.1.299 |
| Gemini CLI | `google-gemini/gemini-cli` | `06d3298` (2026-10-14) |
| Goose | `block/goose` | `dd17bf2` (2026-10-15) |
| OpenCode (재확인) | `sst/opencode` | `bdf4793` (2026-10-15) |
| Codex (재확인) | `openai/codex`, `codex-rs/` | `bb64b89` (2026-10-15) |
| Hermes (재확인) | `NousResearch/hermes-agent` | `7bda2a33` (2026-10-15) |
| pi (재확인) | `badlogic/pi-mono`, `packages/coding-agent/` | `b06c1f2` (2026-10-14) |
| lophn 현재 설계 | `docs/domain-model/lophn-agent/instructions.md:29,36`, `docs/domain-model/lophn-agent/harness/prompt-assemble.md` ("고정 prefix", "cache 경계") | 읽기만 함 |

캡처에는 CLAUDE.md가 든 project가 없어서 CLAUDE.md가 들어가는 위치는 캡처로 직접 보이지 않는다. 캡처에서 쓴 것은 첫 user message의 `<system-reminder>` 구조, gitStatus 블록의 한 문장, system prompt의 "mid-conversation system turns" 문장뿐이다. 캡처의 식별자(device_id, account_uuid, session_id, email, UUID 꼴 값)는 옮기지 않았다.

## 핵심

1. 세 갈래다. (a) session 시작에 고정하고 변경은 `/clear`, compact, 재시작에서 반영: Claude Code, Hermes. (b) 매 요청 전에 바뀐 것을 감지해 변경분만 대화 끝에 덧붙임: Codex(교체문), OpenCode(diff 또는 교체문), pi(section patch). (c) 매 요청마다 system prompt를 처음부터 다시 조립하므로 바로 반영되고 cache는 깨짐: Goose. Gemini CLI는 명령(`/memory reload`)으로만 반영하는 절충이다.
2. "도는 동안 고정, 다음에 반영"은 Claude Code가 문서로 명시한 방침이고, 이유도 cache다(`prompt-caching` 문서 "Editing CLAUDE.md mid-session").
3. 지침을 넣는 위치가 반영 방식을 정한다. system prompt에 넣는 harness(Goose, Hermes, Gemini Tier 1)는 바뀌면 prefix 전체가 깨지고, 대화 쪽 message에 넣는 harness(Claude Code, Codex, OpenCode, pi)는 변경분만 덧붙일 수 있다.
4. 사람이 편집한 지침(CLAUDE.md, AGENTS.md)과 agent 정의를 다르게 다루는 곳이 있다. Claude Code는 subagent 정의 파일을 watcher로 보고 "다음 delegation부터" 쓰지만 CLAUDE.md는 `/clear`나 compact까지 안 쓴다. Codex는 role의 `developer_instructions`를 spawn 때 고정한다.
5. lophn의 현재 설계(`instructions.md:36`: 매 model call 직전에 다시 읽어 다음 call부터 따름, 지침 변경은 cache prefix를 새로 만듦)는 harness 중 Goose와 같은 쪽이다. 지침이 이력 앞에 있어서 편집 한 번이 이력 전체의 cache miss가 된다.

---

## 1. Claude Code

### 1.1 감지와 반영 시점

| 대상 | 감지 | 반영 | 근거 |
|---|---|---|---|
| project-root, user CLAUDE.md | 감지 안 함. session 시작에 읽어 메모리에 들고 있음 | `/clear`, `/compact`, 재시작 때 | `prompt-caching` 문서 "Editing CLAUDE.md mid-session": "Your project-root and user-level CLAUDE.md files are read once at session start and held in memory. Editing them mid-session does not invalidate the cache, but the edit also doesn't apply. Claude keeps working with the version that was loaded at session start. The new content loads on the next `/clear`, `/compact`, or restart." |
| 하위 폴더 CLAUDE.md, `paths:` frontmatter rule | 그 폴더의 파일을 Claude가 read, write, edit할 때 | 처음 불러오는 시점의 파일 내용. 불러온 뒤 편집은 반영 안 됨 | 같은 절: "Editing one yourself before it loads does take effect. After it loads, the content is part of the conversation history, so a mid-session edit doesn't retroactively change it." `memory` 문서 "How CLAUDE.md files load": "Instead of loading them at launch, Claude Code loads each one once Claude reads, writes, or edits another file in that subdirectory." (`cat`, `head` 같은 단일 파일 Bash 읽기도 읽기로 침) |
| `/memory` | 명령은 memory 파일 목록을 보여 주고 editor로 열 뿐 | 다시 읽기를 하지 않음. 편집 뒤 자동 반영 없음 | `memory` 문서 "View and edit with /memory" |
| subagent 정의 `.claude/agents/*.md` | watcher가 `~/.claude/agents/`와 `.claude/agents/`를 봄 | 몇 초 안에 감지, "the next delegation uses the updated definition, with no restart needed" | `sub-agents` 문서 "Write subagent files". 예외 3개: session 시작 때 없던 `agents` 디렉터리, `--add-dir` 디렉터리, `--disable-slash-commands` |
| output style | `/output-style` 등으로 바꿈 | "starting with your next message", 새 style 지침을 대화의 message로 전달 | `prompt-caching` 문서 "Changing output style". v2.1.251 전에는 `/clear`나 새 session까지 안 쓰였음 |
| 일반 파일 편집 | Claude가 읽은 파일이 disk에서 바뀌면 감지 | "Claude Code appends a `<system-reminder>` noting the file changed, and Claude re-reads it if needed" | `prompt-caching` 문서 "Editing files in your repository". CLAUDE.md가 이 알림의 대상인지는 문서에 없음. 확인 못함 |

문서는 "CLAUDE.md는 강제 설정이 아니라 context로 취급한다"고 명시하고, 어겨선 안 되는 것은 PreToolUse hook으로 막으라고 한다(`memory` 문서 첫 절).

### 1.2 넣는 꼴

- 지침은 system 필드가 아니다. `glossary`: CLAUDE.md는 "loaded at the start of every session as a user message after the system prompt"이고, system reminder 목록에 "Your CLAUDE.md files", "The instructions of your output style", "Text a hook returns as additionalContext", "The list of available skills", "A note that a file Claude read earlier has changed on disk", "The commit and pull request attribution lines"가 같이 있다. "In a logged API request, a system reminder appears wrapped in `<system-reminder>` tags inside a user message, or on some models as a separate message with the `system` role." `System prompt` 항목은 "Your CLAUDE.md files and the instructions of your output style aren't part of the system prompt."라고 못 박는다.
- 캡처에서 확인한 구조: 첫 user message(`messages[0]`)가 `<system-reminder>` 블록 2개(userEmail과 gitStatus, git attribution)와 실제 입력으로 구성된다. 이 session 자신의 prompt에서도 AGENTS.md가 같은 꼴로 user message의 `<system-reminder>` 블록에 들어온다. 머리글은 `Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.`이고 파일마다 `Contents of <절대 경로> (project instructions, checked into the codebase):`로 시작한다. 이것은 캡처가 아니라 현재 session의 관찰이다.
- 고정이라는 사실을 모델에게 알리는 문구가 있다. 캡처의 gitStatus 블록: `This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.` CLAUDE.md에 같은 문구가 붙는지는 확인 못함.
- system prompt에는 갱신 통로를 설명하는 문장이 있다(캡처 §3): `The system may send updates, reminders, or modifications to rules via mid-conversation system turns. These are system-controlled, unlike function results.`
- 하위 폴더 CLAUDE.md가 들어갈 때 모델에게 가는 실제 문구는 캡처에도 문서에도 없다. 문서는 터미널에 "Loaded" 줄이 뜨고(`memory` 문서 troubleshoot), `InstructionsLoaded` hook이 `session_start`, `nested_traversal`, `path_glob_match`, `include`, `compact` 이유로 불린다고 한다(`hooks` 문서). 모델에게 가는 문구는 확인 못함.

### 1.3 cache

`prompt-caching` 문서의 층 표: System prompt(core instructions, tool 정의) / Project context(CLAUDE.md, auto memory, unscoped rules; "Session starts, or after /clear or /compact"에 바뀜) / Conversation(매 turn). "A change to the system prompt invalidates everything." 지침 편집이 cache를 안 깨는 이유는 반영을 미루기 때문이다. 반영할 때는 `/clear`나 compact가 어차피 prefix를 새로 만든다. plan mode, skill, output style은 "append their instructions as conversation messages, so the cached prefix stays intact"로 같은 원칙을 쓴다.

### 1.4 compact와 resume

- compact: project-root CLAUDE.md와 unscoped rule은 "Re-injected from disk", 하위 폴더 CLAUDE.md와 `paths:` rule은 "reloads them on demand"(`context-window` 문서 "What survives compaction"). 하위 파일과 path rule은 message history 안에 있어서 compact 요약으로 사라지고, 다시 읽을 때까지 없다. 문서의 권고: 유지해야 할 rule은 `paths:`를 빼거나 root CLAUDE.md로 옮겨라. compact 뒤에는 편집한 내용이 반영되므로 compact가 곧 "새 판 적용" 시점이다. `prompt-caching` 문서: compact는 "reloads project context from disk, which cache-hits only if CLAUDE.md and memory are unchanged since the session started."
- resume: 이전 대화를 다시 보낼 때 system prompt는 "keeps the system prompt it started with"가 기본이고 compact나 새 conversation에서 바뀐다(`prompt-caching` 문서 "Resuming a session"). resume이 CLAUDE.md를 새로 읽는지는 문서에서 확인 못함.

### 1.5 agent 정의와 사용자 지침

- subagent는 자기 system prompt(정의 파일 본문)와 환경 정보만 받고 Claude Code system prompt는 받지 않는다. CLAUDE.md는 Explore, Plan을 빼고 main과 같은 계층을 받는다. `omitClaudeMd` frontmatter로 끈다(`sub-agents` 문서 "What loads at startup").
- 반영 시점이 다르다. 정의 파일은 watcher가 보고 다음 delegation에 새 판을 쓴다. CLAUDE.md는 session 동안 고정이다. 즉 "새 일을 시작할 때 읽는다"는 단위가 정의 파일에는 delegation, CLAUDE.md에는 session이다.
- `/etc/claude-code/CLAUDE.md` 같은 managed policy는 제외할 수 없다(이전 조사 `agent-def-claude-codex.md` 1.3).

---

## 2. Gemini CLI (`06d3298`)

### 2.1 감지와 반영 시점

- 감지는 명령뿐이다. 지침 파일 watch 코드를 찾지 못했다(watch 코드는 `filesearch/fileWatcher.ts`와 `useGitBranchName.ts`뿐이고 GEMINI.md와 무관). 문서 `docs/cli/gemini-md.md:65-68`: "`/memory reload`: Forces a re-scan and reload of all `GEMINI.md` files from all configured locations." 명령 문서 `docs/reference/commands.md:265-`는 `refresh`라는 이름으로 설명하고 "This command updates the model with the latest `GEMINI.md` content."라고 쓴다. 코드는 `reload`가 본명이고 `refresh`는 `altNames`다(`packages/cli/src/ui/commands/memoryCommand.ts:44-45`). 하위 명령은 `show`, `reload`, `list`, `add`.
- 명령 이후의 흐름: `refreshMemory`(`packages/core/src/commands/memory.ts:57-78`)가 `MemoryContextManager.refresh()`로 전 층을 다시 읽고(`core/src/context/memoryContextManager.ts:38-47`) `MemoryChanged` event를 낸다. `GeminiClient`가 이 event를 받아 `updateSystemInstruction()`으로 현재 chat의 system instruction을 다시 만들어 설정한다(`core/src/core/client.ts:124,139-141,400-407`). 반영 시점은 명령 직후 첫 요청이다.
- 새 chat(`resetChat`)은 `startChat()`을 다시 부르고 memory도 다시 읽는다(`client.ts:334-341`).

### 2.2 넣는 꼴과 "무엇이 실제로 바뀌나"

Gemini는 지침을 3층으로 나누어 넣는 위치가 다르다(`core/src/utils/environmentContext.ts:60-66` 주석: Tier 1 system instruction만, Tier 2 첫 user message, Tier 3 tool 출력).

| 층 | 들어가는 위치 | `/memory reload` 뒤 |
|---|---|---|
| Tier 1: 전역 GEMINI.md, 개인 project memory index | system instruction (`config.ts:2600-2611` `getSystemInstructionMemory`) | system instruction이 새로 만들어져 다음 요청부터 새 판. 코드 주석: "User project memory is in Tier 1 so mid-session saves are reflected via system instruction updates." |
| Tier 2: extension + project(workspace) GEMINI.md | 첫 user message의 `<session_context>` (`config.ts:2617-` `getSessionMemory`, `environmentContext.ts:60-82`) | 이미 이력에 들어간 첫 message는 안 바뀐다. history의 첫 항목을 다시 쓰는 곳을 찾지 못함. 즉 project GEMINI.md 편집은 reload해도 현재 chat에 닿지 않는 것으로 읽힌다(코드 읽기 결과이고 실행 확인은 못함) |
| Tier 3: 하위 폴더 GEMINI.md | tool 결과 뒤에 덧붙임 (`tools/jit-context.ts:45-47,57-65`) | 이미 대화에 들어간 결과는 그대로 |

실제 문구 예(하위 폴더): tool 결과 뒤에 `\n\n--- Newly Discovered Project Context ---\n<내용>\n--- End Project Context ---`.

문서가 "updates the model with the latest content"라고 쓴 것과 위 Tier 2 읽기가 어긋난다. 확정이 아니다.

### 2.3 cache

- 명시적인 cache 관리 코드(`cachedContent` 등)는 `geminiChat.ts`에서 찾지 못했다. Gemini API 쪽 암묵 cache를 가정한 것으로 보이고 확인 못함.
- cache를 의식한 흔적: 재시도 nudge를 system instruction이 아니라 대화 끝에 붙인다. 주석: "The nudge message is appended to the contents array (end of conversation) rather than modifying systemInstruction. This preserves the prefix cache" (`core/src/core/geminiChat.ts:1050-1054`). Tier 구분 자체가 system을 안정적으로 두려는 설계다(`environmentContext.ts:60-62`, 이전 조사).
- Tier 1이 바뀌면 system instruction 전체가 바뀐다. 그 요청에서 cache가 어떻게 되는지는 확인 못함.

### 2.4 compact와 resume

- compact(`core/src/context/chatCompressionService.ts:665-678`): 요약 한 쌍(user 요약, model "Got it. Thanks for the additional context!")과 보존한 최근 이력을 `extraHistory`로 만들고 `getInitialChatHistory(config, extraHistory)`로 합친다. 첫 항목의 stable id가 `environment-context`가 아니므로 새 `<session_context>`가 맨 앞에 다시 만들어지고, 이때 Tier 2는 그 순간 `MemoryContextManager`의 메모리 상태를 쓴다. 즉 reload를 한 적이 있다면 compact가 Tier 2를 새 판으로 바꾸는 시점이다. reload 없이 disk만 바뀐 경우 메모리에 든 옛 판이 쓰인다(메모리 상태는 `refresh()`에서만 갱신).
- resume(`environmentContext.ts:88-98`): `extraHistory`의 첫 항목 id가 `environment-context`면 그대로 쓴다. 저장된 옛 `<session_context>`가 재사용되어 옛 Tier 2가 유지된다. 대신 Tier 1 system instruction은 `startChat`에서 새로 만들어진다.

### 2.5 agent 정의와 사용자 지침

- subagent는 `getSessionMemory`로 자기 첫 message에 memory를 받고, `includeExtensionContext` 옵션으로 extension 층을 뺀다(`core/src/agents/local-executor.ts:666-669`). subagent 정의 파일(`.gemini/agents/*.md`)의 mid-session 감지는 확인 못함.

---

## 3. Goose (`dd17bf2`)

### 3.1 감지와 반영 시점: 문서와 코드가 어긋난다

- 문서(`documentation/docs/guides/context-engineering/using-goosehints.md:60,79`): UI 절차 끝에 "Restart your session so goose can read the updated `.goosehints`". 79줄: "goose loads hints at the start of your session. As it accesses files in nested directories, it also loads the hint files for those directories. goose adds hints to the system prompt for every request."
- 코드는 매 요청마다 다시 읽는 것으로 읽힌다. 모델 요청 직전 `GooseInferenceRequestPreparer::prepare`(`crates/goose/src/agents/state_machine/inference_preparation.rs:37-62`)가 `PromptManager::new().build_system_prompt(session, input.prompt_parts, goose_mode)`를 새로 부른다. 이 함수는 `.with_hints(&session.working_dir)`를 부르고(`crates/goose/src/agents/prompt_manager.rs:200-211`) `with_hints`는 `load_hint_files`로 전역과 git root→cwd의 hints 파일을 disk에서 읽는다(`:92-101`, `crates/goose/src/hints/load_hints.rs:232-`). 결과를 들고 있는 cache 객체가 없다. `prepare`는 `InferenceRunner::infer`가 요청마다 부른다(`crates/goose-agent/src/inference.rs:395-416`). 따라서 `.goosehints`나 `AGENTS.md`를 고치면 같은 session의 다음 model 요청에서 반영되는 것으로 읽힌다. 실행해서 확인하지는 않았다. 문서의 "restart" 안내는 코드와 맞지 않는 보수적 문구로 보인다.
- 하위 폴더 hints: 요청마다 대화 전체의 tool request를 훑어(`ops_toolcalling.rs:857-877` `prompt_parts`) 만진 경로의 하위 폴더 hints 파일을 `SubdirectoryHintTracker`로 찾고, 같은 `prepare`에서 system prompt의 extras로 들어간다. 즉 하위 폴더 hints도 system prompt에 있고 매 요청 재계산된다.

### 3.2 넣는 꼴

- system prompt 뒤에 `\n\n# Additional Instructions:\n\n` 머리글과 extras를 이어 붙인다(`prompt_manager.rs:155-175`). hints 머리말은 `### Global Hints` / `### Project Hints`다(이전 조사 2.3). 변경분을 따로 알리는 message는 없다. 바뀌면 system prompt가 통째로 달라질 뿐이다.
- turn마다 붙는 context(MOIM): `<turn-context>` 블록을 user message로 대화에 붙인다. 내용은 시각, 작업 디렉터리, 압축 상태, turn 예산, extension이 주는 text다(`agents/moim.rs`, 이전 조사 2.4). 지침 파일은 여기에 넣지 않는다. `inference_preparation.rs:63-78`은 직전 turn-context와 같은 문자열이면 새로 안 붙인다.

### 3.3 cache

- 명시한 cache 의식: 날짜를 시 단위로 내리고 이유를 적었다(`PromptManager::new`): "Use the fixed current date time so that prompt cache can be used. Filtering to an hour to balance user time accuracy and multi session prompt cache hits." extension을 이름순으로 정렬한다("Stable tool ordering is important for multi session prompt caching.").
- 지침 파일이 바뀐 요청에서는 system prompt가 달라져 prefix가 전부 깨진다. 이를 줄이는 장치는 찾지 못했다. cache control 표시 세부는 확인 못함.

### 3.4 compact와 resume

- system prompt를 요청마다 새로 조립하므로 compact든 resume이든 "다시 넣는" 단계가 따로 없다. 항상 그 시점의 disk 내용이 들어간다. 압축은 이력만 줄인다.
- session에 저장된 `system_prompt_override`와 `system_prompt_extras`(recipe instructions, subagent override가 쓰는 길)는 session 생성 때 정해져 고정이다(`prompt_manager.rs` `with_session`). 즉 사람이 쓴 hints는 매 요청 재독, recipe나 agent 지침은 session에 저장된 값을 쓴다.

### 3.5 agent 정의와 사용자 지침

- agent 파일(`~/.agents/agents/*.md` 등)은 `summon`의 `load`로 현재 대화에 읽어 오거나 `delegate`로 별도 session에서 실행한다(이전 조사 2.2). 파일 본문 변경의 mid-session 반영은 확인 못함.

---

## 4. 재확인한 harness

### 4.1 OpenCode (`bdf4793`): watcher와 diff 메시지

- 감지: 전역과 상위 지침 파일을 watcher로 본다(`packages/core/src/config/plugin/instruction.ts:200,206`이 변경을 받아 `discovery.reload()`).
- 반영: 매 step(model 호출) 직전 `prepareContext`가 `InstructionState.prepare`를 부른다(`core/src/session/runner/llm.ts:168,201-205,218`). 현재 값의 hash를 저장된 값과 비교해 달라진 key만 `InstructionsUpdated` event로 기록한다(`session/instruction-state.ts:21-56`). 같은 tool loop 안의 다음 step에도 반영된다.
- 꼴(`core/src/instruction-discovery.ts:127-147` `renderUpdate`): 바뀐 파일마다 diff를 만들고, diff가 새 전문보다 짧으면 diff, 아니면 전문.
  - 삭제: `The instructions from <path> no longer apply.`
  - 추가: `New instructions apply from:\nInstructions from: <path>\n<내용>`
  - 변경(diff): `The instructions from <path> changed. Here's the diff:` + diff 코드 블록
  - 변경(전문): `The instructions changed:\nInstructions from: <path>\n<내용>`
  - 전부 없어짐: `Previously loaded instructions no longer apply.` (`:88-90`)
- 넣는 위치: 이력 중간에 system 역할 message로 추가한다. `message-updater.ts:149-161`이 `SessionMessage.System`(text, `description: Instructions updated: ...`, metadata notice)을 이력에 넣고, `to-llm-message.ts:291-292`가 `Message.system(message.text)`로 변환한다. 앞의 prefix가 안 바뀐다. 사람 화면에도 "Instructions updated" notice로 보인다.
- 이전 조사의 "하위 폴더 변경은 감지하지 않는다"와 "baseline은 epoch마다 갱신되고 이전 delta는 접힌다"는 이번에 다시 확인하지 않았고 인용만 한다.

### 4.2 Codex (`bb64b89`): 교체문, 그러나 repo 파일은 cache됨

- 꼴(`codex-rs/core/src/context/world_state/agents_md.rs:8-12,38-80`): 변경이 있으면 user role fragment로 다음을 낸다.
  - 이전에 AGENTS.md가 있었으면: `These AGENTS.md instructions replace all previously provided AGENTS.md instructions.` + 새 전문
  - 모두 사라졌으면: `The previously provided AGENTS.md instructions no longer apply.`
  - 이전 상태를 모르면(`Unknown`) 교체 쪽으로 취급.
  - 같으면 아무것도 안 낸다. 비교 기준은 rollout에 저장된 `AgentsMdSnapshot{directory, text}`.
- 시점: 매 step(요청)마다 `agents_md_manager.refresh`를 부른다(`core/src/session/mod.rs:3914-3921`, `session/world_state.rs:59-215`). 그러나 repo의 AGENTS.md는 `selections`(environment 선택)나 project trust level이 바뀔 때만 disk에서 다시 읽고, 아니면 cache한 `loaded`를 쓴다(`core/src/agents_md_manager.rs:66-150`의 `refresh_repository`). 즉 현재 commit에서는 같은 session 중에 사람이 repo의 AGENTS.md를 편집해도 감지하지 않는 것으로 읽힌다. 다른 무효화 지점은 찾지 못했다(확인 못함). 이전 조사(`76ed3b4`)가 적은 "내용이 바뀌면 교체 메시지를 추가한다"는 diff 장치가 있다는 사실이고, 무엇이 그 장치를 일으키는지가 이번에 정밀해졌다.
- 매 step 다시 읽는 것은 host가 주는 provider다. `user_provider`(사용자 지침)와 `thread_provider`(thread 지침)는 `refresh`마다 `load_user_instructions()`, `load_thread_instructions()`를 부르고, 값이 달라지면 교체문이 나간다(`agents_md_manager.rs:96-108,115-120`). 앱이 지침을 DB나 설정에서 주는 구조는 lophn과 같은 형태이고, 이 경로는 편집이 다음 step에 반영된다.
- cache: 이전 조사의 해석(변경분만 새 item으로 덧붙여 prefix 유지)은 그대로다. 명시한 문서는 확인 못함.
- role `developer_instructions`는 agent role 설정으로 spawn 때 정해지고(이전 조사 2.2) mid-session 갱신 경로는 찾지 못함.

### 4.3 Hermes (`7bda2a33`): session 동안 고정, compression 때 재조립, resume은 저장본

- 원칙(`AGENTS.md:20-23`): "Per-conversation prompt caching is sacred. Mutating past context, swapping toolsets, reloading memories or rebuilding the system prompt mid-conversation breaks the cached prefix and multiplies the user's cost; the ONE exception is context compression. Slash commands that change system-prompt state defer to the next session, with an opt-in `--now`."
- `agent/system_prompt.py:1-9`: system prompt는 session당 한 번 조립(stable, context, volatile 3단), "only context compression triggers a rebuild". 지침 파일은 `context` 단에 들어간다.
- compression 뒤: `invalidate_system_prompt`(`system_prompt.py:808-825`)가 cache한 prompt를 비워 다음 turn에 다시 조립하고 memory도 disk에서 다시 읽는다. 즉 compression이 새 판 적용 시점이다.
- resume/continuing session: 저장한 system prompt를 session DB에서 그대로 복원해 쓴다(`agent/conversation_loop.py:748-805`: "Continuing session — reuse the exact system prompt from the previous turn so the Anthropic cache prefix matches."). 지침 파일 편집은 resume에서도 안 들어온다. 중간에 바뀐 사실(예: 표면 전환)은 prompt 앞이 아니라 "at the tail of the request"에 note로 붙인다(`stage_surface_switch_note`, 같은 파일 790-806 근처).
- 하위 폴더 지침: tool 결과에 덧붙인다(이전 조사 1.3, `agent/subdirectory_hints.py`).
- agent 정의: profile(별도 HERMES_HOME의 SOUL.md)은 session 시작에 읽어 `identity` 단에 고정. subagent는 `skip_context_files=True`로 SOUL.md를 안 받는다(이전 조사).
- 지침 파일 쓰기 자체를 사람에게 묻는다: `AGENTS.md`, `CLAUDE.md`, `SOUL.md` 등 쓰기는 항상 승인 gate에 걸린다(`approval-hermes.md` §1). prompt injection이 오래 남는 길이라는 이유다. Context Engineer가 `LOPHN.md`를 쓰는 lophn에 관련 있는 선례다.

### 4.4 pi (`b06c1f2`): `/reload` 후 section patch

- 감지: 명령뿐이다. `docs/configuration.md:5`: "Run `/reload` after manually changing settings, keybindings, instructions, or resources." `AgentSession.reload()`(`src/core/agent-session.ts:3690-`)가 settings와 resource loader를 다시 읽는다.
- 꼴: transcript의 첫 system message에 section map 전체를 기록하고, 이후 변경은 system 역할 message에 section patch를 덧붙인다(`agent-session.ts:1735-1756` `_preparePromptAndToolLoadout`, `src/core/system-prompt.ts:217-231` `diffSystemPromptSections`: 바뀐 section은 새 text, 없어진 section은 `null`). 지침 파일은 `project_context` section이다. tool 변경은 `toolsAdded`/`toolsRemoved`.
- cache: `docs/extensions.md:189`: "Providers that cannot represent the transition receive a complete transcript checkpoint, which can invalidate the cached prefix." provider가 mid-conversation system message를 못 받으면 전체를 다시 보낸다.

---

## 5. 비교 표

| harness | 감지 | 반영 시점 | 꼴 | 넣는 위치 | cache | compact / resume | role 정의 대 사용자 지침 |
|---|---|---|---|---|---|---|---|
| Claude Code | 안 함 (root CLAUDE.md는 시작에 읽어 고정). 하위 CLAUDE.md는 폴더 파일 접근 때 | `/clear`, `/compact`, 재시작. 하위 파일은 처음 로드 때 | 전문 그대로 reminder. 변경 알림 없음 (문구 확인 못함) | 첫 user message의 `<system-reminder>`. system 필드 아님 | 깨지지 않음 (미루므로). 반영할 때는 어차피 새 prefix | compact: root 파일은 disk에서 재주입, 하위 파일은 on demand로 다시. resume: 문서에 CLAUDE.md 재독 여부 없음 | subagent 정의는 watcher, 다음 delegation에 반영. CLAUDE.md는 session 고정 |
| Gemini CLI | 명령 `/memory reload`(별칭 refresh)만 | 명령 뒤 다음 요청 (Tier 1). Tier 2(project GEMINI.md)는 compact나 새 chat까지 현재 chat에 안 닿는 것으로 읽힘 | system instruction 재조립(Tier 1) / 첫 message(Tier 2) / tool 결과 덧붙임(Tier 3) | 3곳 | 명시 관리 확인 못함. 재시도 nudge는 대화 끝에 붙여 prefix 보존 | compact: 새 `<session_context>`로 재구성. resume: 저장된 첫 message 재사용, system은 새로 | subagent는 별도 `getSessionMemory`. 정의 파일 반영은 확인 못함 |
| Goose | 안 함 (요청마다 disk 재독) | 다음 model 요청 | system prompt 통째 재조립 (`# Additional Instructions`) | system prompt | 지침이 바뀐 요청에서 prefix 전부 miss. 날짜는 시 단위로 내려 miss를 줄임 | 항상 최신 disk. 따로 재주입 없음 | recipe/agent 지침은 session에 저장된 값(고정), hints는 재독 |
| OpenCode | watcher (전역/상위). 하위는 감지 안 함 | 다음 step 직전 | 삭제문 / 추가문 / diff 또는 전문(짧은 쪽) | 이력 중간 system message. 화면에 notice | 유지 (이력 끝에 덧붙임) | baseline은 epoch마다 갱신, 이전 delta 접힘 | agent `system`은 prompt 전체 대체, project 지침은 계속 붙음 |
| Codex | host provider는 step마다, repo 파일은 environment/trust가 바뀔 때만 | 다음 step | `These AGENTS.md instructions replace all previously provided ...` / `... no longer apply.` | user role fragment (이력 끝) | 유지 (변경분만 추가) | snapshot을 rollout에 저장해 resume, compact 뒤에도 diff 이어감 | role `developer_instructions`는 spawn 때 고정 |
| Hermes | 안 함 | 다음 session. `--now`는 opt-in. compression 때 재조립 | 재조립(통째) | system prompt `context` 단 | 불변식으로 보호 ("sacred"). 예외는 compression | resume: 저장한 prompt 그대로. compression: 재조립 + memory 재독 | profile(SOUL.md)은 시작에 고정. subagent는 SOUL.md 안 받음 |
| pi | 명령 `/reload` | reload 뒤 다음 요청 | section patch (`{section: text or null}`) | system 역할 message (이력 중간) | 유지. provider가 못 받으면 checkpoint로 miss | transcript에 section 상태가 쌓여 있어 replay | `SYSTEM.md`(교체)/`APPEND_SYSTEM.md`(덧붙임)도 section |

## 6. lophn에 비춰 본 점

현재 lophn 설계(`instructions.md:29,36`, `prompt-assemble.md` "고정 prefix", "cache 경계")는 한 call 안에서는 snapshot이고, 다음 call마다 LOPHN.md와 agent 정의를 다시 읽어 따른다. 지침은 이력(`work_material`) 앞에 있어서 편집은 이력 전체의 cache miss다. 이것은 Goose와 같은 쪽이다. 아래는 그것을 바꾸자는 확정이 아니라 선택지와 근거다. 결정은 lead와 사람이 한다.

| lophn이 정할 것 | 추천 | 근거 harness |
|---|---|---|
| 지침 변경을 언제 읽나 | run 단위로 고정하고 변경은 다음 run부터. skill(req-0099)과 같은 규칙. 사람이 설정 화면에서 고치는 것과 Context Engineer가 `LOPHN.md`를 고치는 것을 같은 규칙으로 다룬다. 도는 run은 시작할 때 읽은 판을 쓴다. 그 run이 스스로 쓴 변경은 대화 이력(tool call)에 이미 있어 모델이 안다 | Claude Code (문서가 "doesn't apply"를 명시하고 이유가 cache), Hermes. turn마다 반영하는 쪽은 Codex, OpenCode, pi, Goose |
| 매 call 재독과 watcher | 위 규칙이면 run 시작 때 한 번 읽어 ContextBasis에 hash로 고정하면 된다. 매 call 재독과 watcher는 필요 없다. 감지 장치 없이 시작 때 읽는 쪽이 가장 단순하다 | Claude Code, Hermes (감지 없음). watcher까지 쓰는 곳은 OpenCode뿐 |
| run 도중에도 반영해야 한다면 꼴 | 앞의 prefix를 바꾸지 말고 이력 끝에 변경 message를 덧붙인다. 전문 교체문 한 형식에 삭제 문구를 따로 둔다. diff는 모델이 이전 판을 정확히 기억해야 해서 LOPHN.md처럼 작은 문서에는 이득이 작다(OpenCode는 짧은 쪽을 고름). 이전 판이 이력에 남아 모순되므로 "이전 지침을 대체한다"는 문구가 필수 | Codex (`replace all previously provided`, `no longer apply`), OpenCode (삭제/추가/변경 분리, 짧은 쪽 선택) |
| 덧붙임을 넣는 위치 | user role fragment가 provider 이식성이 높다. system 역할 message는 못 받는 provider가 있다(pi는 그때 checkpoint로 전체 재전송). provider adapter를 가진 lophn은 둘 다 가능 | Codex (user fragment), OpenCode와 pi (system message) |
| cache 경계 순서 | 지침을 이력 앞에 두는 현재 순서에서는 편집이 이력 전체 miss다. 고정 규칙이면 run 안에서는 miss가 없고 새 run의 첫 call만 miss다. 경계 3개 설계는 그대로 둘 수 있다 | Claude Code (project context를 conversation 앞 층으로 두고 반영을 미룸) |
| compact 때 지침 | compact는 어차피 prefix를 새로 만든다. 이 시점에 최신 판을 읽어 넣는 것이 가장 싸게 새 판을 적용하는 경계다. "run 안 고정"의 예외로 둘지 lead가 정한다. 어느 쪽이든 지침은 요약 대상이 아니라 다시 주입하는 층이어야 한다(`prompt-assemble.md` "보호"와 일치) | Claude Code (root CLAUDE.md를 disk에서 재주입), Hermes (compression 때 재조립), Gemini (compact가 `<session_context>`를 새로 만듦) |
| resume 때 지침 | session을 이어서 열 때는 그 session 마지막 run이 쓴 판(ContextBasis hash)을 쓰는 쪽이 cache에 유리하다. 새 run을 시작하는 순간 최신 판으로 바뀐다 | Hermes (저장한 prompt를 그대로 복원), Codex (snapshot을 rollout에 저장) |
| 사람이 무엇을 보나 | 설정 화면과 run 화면에 "이 run이 읽은 지침 판"과 "더 새 판이 있음(다음 run부터 적용)"을 보인다. 반영 시점을 UI가 말해 주지 않으면 "고쳤는데 안 따른다"가 된다 | Claude Code (`/context`의 Memory files, `/memory`, `InstructionsLoaded` hook), Gemini (`/memory show`, `list`), OpenCode ("Instructions updated" notice) |
| 모델에게 고정을 알릴지 | 지침 판이 run 시작 snapshot이라는 짧은 안내가 있으면 모델이 "고쳐진 지침"을 기대하지 않는다. 필수는 아니고 낮은 우선순위 | Claude Code (gitStatus 블록의 "snapshot in time, and will not update during the conversation") |
| built-in role 지침 대 사람 지침 | built-in role 지침은 앱 판과 같이 움직이므로 run 시작 고정으로 충분하다. 사람이 고치는 지침(전역, `LOPHN.md`, agent 지침)만 변경 알림 문제가 있고 모두 같은 "run 시작 때 읽음" 규칙으로 묶을 수 있다. agent 정의는 Claude Code의 subagent 정의처럼 "다음에 이 agent를 부를 때부터" 새 판이면 사람에게 직관적이다 | Claude Code (subagent 정의는 다음 delegation, CLAUDE.md는 session 고정), Codex (role 지침은 spawn 고정), Goose (agent/recipe 지침은 session에 저장) |
| Context Engineer가 `LOPHN.md`를 쓸 때 | 지침 파일 쓰기는 prompt injection이 오래 남는 길이라서 사람 확인을 거치게 한 선례가 있다. Context Engineer의 `LOPHN.md` 변경을 사람이 승인하거나 diff로 보는 흐름이 이미 있는지 확인한다. R5 범위 밖이면 별도 항목으로 | Hermes (`AGENTS.md`, `CLAUDE.md`, `SOUL.md` 쓰기는 언제나 사람에게 물음. `approval-hermes.md` §1) |
| 하위 폴더 지침(nested) | `LOPHN.md`는 project 폴더 한 곳에서 모든 role과 agent가 같이 읽는 한 파일이므로 하위 폴더 lazy load는 필요 없다. 앞으로 폴더별 지침이 생기면 Claude Code(접근할 때 대화에 들어옴, compact 때 사라짐), Gemini와 Hermes(tool 결과에 덧붙임) 방식이 prefix를 안 깬다 | Claude Code, Gemini CLI, Hermes |

## 7. 확인 못한 것

- Claude Code: CLAUDE.md를 mid-session에 편집할 때 모델에게 가는 알림이 있는지(문서에 없음). 하위 폴더 CLAUDE.md가 대화에 들어갈 때의 실제 문구. resume이 CLAUDE.md를 다시 읽는지. source는 보지 않았다.
- Gemini CLI: Tier 2(project GEMINI.md) 변경이 `/memory reload` 뒤에도 현재 chat에 닿지 않는다는 결론은 코드 읽기이고 실행 확인이 아니다. 문서는 반대로 읽힌다. Gemini API 쪽 cache 동작은 확인 못함. subagent 정의 파일의 mid-session 감지는 확인 못함.
- Goose: 코드는 매 요청 재독으로 읽히지만 실행으로 확인하지 못했고, 문서는 "restart your session"이라고 한다. cache control 표시 세부는 확인 못함. agent 파일 본문의 mid-session 반영은 확인 못함.
- Codex: repo AGENTS.md가 `refresh_repository` 조건 말고 다른 경로(예: compaction, `/new`)로 다시 읽히는지는 확인 못함. role `developer_instructions`의 mid-session 갱신 경로는 찾지 못함.
- OpenCode: 하위 폴더 변경과 agent `system` 변경의 mid-session 반영은 이번에 다시 확인하지 않았다.
