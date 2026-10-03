---
type: research
concerns: [lophn-agent/instructions]
---
# 사람 지침 파일의 자리·층·상한·주입

## 질문

지침 파일을 어느 경로에서 찾고 조상으로 얼마나 올라가며, 층을 어떤 순서로 합치나.
크기 상한을 넘기면 자르는지 실패하는지, 못 읽는 파일을 건너뛰는지 멈추는지.
모델이 다른 파일을 읽다가 발견한 지침을 그 자리에서 반영하는지, 주입 문자열이 권한을 넓힐 수 있는지.

조사일 2026-10-04. `[확인]`은 해당 revision 소스에서 본 사실, `[추측]`은 정황, `[미확인]`은 근거를 찾지 못한 것이다. 경로는 `프로젝트:저장소 상대 경로`다. 테스트 snapshot은 근거로 쓰지 않았다. 요구는 `docs/requirements/lophn-agent/instructions.md` R1–R8, domain model은 `docs/domain-model/lophn-agent/instructions.md`, prompt 층은 architecture §5.4와 open-issues D12–D14다.

## 프로젝트별

### Codex (3a69ec3ef8fb)

- `[확인]` 파일 이름은 dir마다 `AGENTS.override.md` 우선, 그 다음 `AGENTS.md`, 그 다음 `project_doc_fallback_filenames`. fallback 항목에 `.`, `..`, `/`, NUL이 있으면 무시하고 Windows에서는 `\`와 `:`도 무시한다. cwd에서 project root까지 올라가고 root는 `project_root_markers`(기본 `.git`)로 찾는다. marker 목록이 비면 부모 walk가 꺼진다. 합치는 순서는 root → cwd, root에서 멈추고 구분자는 `\n\n--- project-doc ---\n\n`. 근거: `codex:codex-rs/core/src/agents_md.rs`.
- `[확인]` 예산은 `project_doc_max_bytes`, 기본 `DEFAULT_PROJECT_DOC_MAX_BYTES = 32 * 1024`. 넘으면 남은 byte만큼 자르고 warning을 남긴다. 인코딩은 `String::from_utf8_lossy`라 잘못된 byte를 대체 문자로 바꾸고 실패하지 않는다. untrusted project(`active_project.is_untrusted()`)면 project doc을 읽지 않는다. symlink는 허용한다. 근거: 위 파일, `codex:codex-rs/config/src/config_toml.rs` `DEFAULT_PROJECT_DOC_MAX_BYTES`.
- `[확인]` refresh는 1-permit semaphore로 직렬화한다. cache key는 turn 환경 선택과 trust 수준이라 project doc은 그 값이 바뀔 때만 다시 읽는다. 세션 중 파일 수정은 그 자리에서 반영되지 않는다. thread instructions는 `MAX_THREAD_INSTRUCTIONS_TOKENS = 10_000`을 넘으면 자르지 않고 거절한다. 근거: `codex:codex-rs/core/src/agents_md_manager.rs`.

### OpenCode (907b3bc518fa)

- `[확인]` 전역 파일은 config dir의 `AGENTS.md`, 그 다음 `~/.claude/CLAUDE.md`(flag). 먼저 있는 것 하나만 쓴다. project 파일은 `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`(deprecated)를 directory에서 worktree까지 `findUp`한다. 매치가 있는 첫 파일 이름만 쓰고, 그 이름의 조상 매치는 모두 포함한다. `config.instructions`는 http(s) URL일 수 있고 timeout 5초로 가져온다. 근거: `opencode:packages/opencode/src/session/instruction.ts`.
- `[확인]` 읽기 오류는 `""`가 되어 조용히 빠진다. 출력은 `Instructions from: <path>\n<content>`. `resolve()`는 지금 읽고 있는 파일에서 위로 올라가 근처 지침 파일을 assistant 메시지마다 한 번 붙인다. 즉 파일 읽기 도중에 발견한 지침이 그 메시지의 문맥으로 들어온다. 근거: 위 파일.
- `[미확인]` 이 파일 안에 크기 상한은 없다. 다른 모듈의 상한은 확인하지 못했다. 지침 문자열이 system prompt의 어느 자리에 들어가는지도 `session/system.ts`까지만 봤고 역할 배치는 확인하지 못했다.

### Pi (83692682f095)

- `[확인]` dir마다 첫 번째로 있는 파일을 쓴다. 순서는 `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`. 전역 파일을 agentDir에서 먼저 읽고, 그 다음 cwd에서 시작해 `dirname === self`가 될 때까지 파일 시스템 루트까지 올라간다. 합치는 순서는 전역 다음 root → cwd. 중첩 worktree가 자기 context 파일을 가지면 `findShadowedContextFile`이 상위 repo 것을 뺀다. 근거: `pi:packages/coding-agent/src/core/resource-loader.ts` `loadProjectContextFiles`.
- `[확인]` 파일 전체를 읽고 BOM을 제거한다. 이 함수에서 byte 상한은 찾지 못했다. 읽기 실패는 warning을 남기고 건너뛴다. 근거: 위 파일.
- `[확인]` system prompt의 `project_context` 절에 `<project_instructions path="...">`로 들어간다. 절은 turn마다 diff로 패치한다(`diffSystemPromptSections`). 세션 중간에 언제 다시 읽는지는 확인하지 못했다. 근거: `pi:packages/coding-agent/src/core/system-prompt.ts`.

### Gemini CLI (fb972b2f87fe)

- `[확인]` 기본 파일 이름은 `GEMINI.md`(`tools/memoryTool.ts` `DEFAULT_CONTEXT_FILENAME`). `setGeminiMdFilename`으로 바꿀 수 있고 `resolveToRealPath`로 정리한다. private project memory는 `MEMORY.md`를 우선한다. 층은 global(`~/` + GEMINI_DIR), user-project memory dir, extension context 파일(정렬), project 파일. project는 trusted root에서 git root(marker 기본 `.git`, 절대 경로나 `..`가 든 marker는 건너뜀)까지 올라간다. dedupe는 `fs.stat`의 device+inode라 symlink를 따라간다. 근거: `gemini-cli:packages/core/src/utils/memoryDiscovery.ts`, `memory.ts` `flattenMemory`.
- `[확인]` `readGeminiMdFiles`는 `@import`를 `processImports`로 펼치고 tree/flat 형식을 marker로 제한한다. 읽기 실패는 content null과 warning. `GEMINI.md`라는 이름의 dir은 조용히 건너뛴다. `concatenateInstructions`는 파일마다 `--- Context from: <path> ---`로 감싼다. 근거: 위 파일.
- `[확인]` `loadJitSubdirectoryMemory`는 지금 다루는 파일에서 위로 올라가 새로 발견한 `GEMINI.md`를 그 자리에서 로드한다. 읽기 도중 발견이 문맥에 들어온다. 근거: 위 파일.
- `[미확인]` 이 파일들에서 byte 상한은 찾지 못했다. 상한이 다른 모듈에 있을 수 있다.

### Hermes Agent (343500b3547e)

- `[확인]` project context는 한 종류만 로드한다. 우선순위는 `.hermes.md`/`HERMES.md`(cwd에서 git root까지 가장 가까운 것) → `AGENTS.md` 체인(git root → cwd) → `CLAUDE.md`/`claude.md`(cwd만) → `.cursorrules`와 `.cursor/rules/*.mdc`(cwd만). 앞 종류에 내용이 있으면 뒤는 shadow다. `SOUL.md`는 `HERMES_HOME`에 있고 독립적으로 항상 포함한다. git root가 없으면 `.hermes.md`/`HERMES.md`는 cwd만 본다. 주석은 부모로 올라가면 `/tmp`나 `/home`에 심은 파일을 집을 수 있다고 적는다. 근거: `hermes-agent:agent/prompt_builder.py` `build_context_files_prompt`, `_find_hermes_md`, `_CONTEXT_FILE_CANDIDATES`.
- `[확인]` `AGENTS.md`는 dir마다 `AGENTS.override.md`, `AGENTS.md`, `agents.md` 순으로 첫 비어 있지 않은 파일을 쓰고, 체인을 합친다. 같은 내용이 체인 아래에서 다시 나오면(복사·symlink) 뺀다. `.hermes.md`는 YAML frontmatter를 떼고 본문만 넣는다. 근거: 위 파일 `_load_agents_md`, `_agents_md_candidates`, `_strip_yaml_frontmatter`.
- `[확인]` 파일당 상한은 `context_file_max_chars`. 설정 값이 양수면 그 값, 아니면 동적 cap이다. 동적 cap은 context window가 없으면 20,000, 있으면 `context_length * CHARS_PER_TOKEN * 0.06`을 20,000 이상 500,000 이하로 자른다. 넘으면 앞 70%와 뒤 20%를 남기고 가운데를 marker로 바꾼다. 합친 `AGENTS.md` 체인도 같은 상한으로 한 번 더 자른다. 근거: 위 파일 `CONTEXT_FILE_MAX_CHARS`, `_CONTEXT_FILE_WINDOW_FRACTION`, `_CONTEXT_FILE_DYNAMIC_CEILING`, `_get_context_file_max_chars`, `_truncate_content`.
- `[확인]` 읽기는 daemon thread에서 하고 기본 timeout 5초(`context_file_read_timeout`)를 넘기면 warning 후 `None`, 즉 건너뛴다. 인코딩은 utf-8-sig. 못 읽거나 비면 그 파일만 빠진다. 근거: 위 파일 `_CONTEXT_FILE_READ_TIMEOUT_SECS`, `_read_text_with_timeout`, `_read_context_file`.
- `[확인]` 주입 전 `_scan_context_content`가 `scope="context"`로 검사한다. project 파일에서 맞으면 내용 대신 `[BLOCKED: <file> contained potential prompt injection (<findings>). Content not loaded.]`를 넣는다. 사용자 자신의 `SOUL.md`는 warning만 남기고 로드한다. `hermes profile install <git-url>`로 들어온 `SOUL.md`는 `distribution.yaml`이 소유하면 user 파일이 아니므로 맞으면 막는다. manifest를 읽지 못하면 fail closed다. 근거: 위 파일 `_scan_context_content`, `load_soul_md`.
- `[확인]` fallback으로 고른 cwd가 Hermes 설치 트리 안이면 project context를 읽지 않는다. CLI·TUI는 이 가드를 끈다. 명시적으로 지정한 cwd는 그대로 쓴다. 근거: 위 파일 `_project_context_suppressed`.
- `[확인]` 상태 목록은 loaded, truncated, shadowed, blocked, flagged, empty, unreadable, suppressed다. 이 목록은 prompt를 다시 만들지 않는 읽기 전용 manifest다. 근거: `hermes-agent:agent/context_file_sources.py` `_STATUS_DISPLAY`, `list_context_file_sources`.

### OpenClaw (37efa0b4a644)

- `[확인]` workspace bootstrap 파일 이름과 prompt 순서는 `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `BOOTSTRAP.md`, memory 파일. 생성 대상은 앞 넷이다. 추가 파일은 hook `bootstrap-extra-files`의 paths/patterns/files에서 오고, NUL·workspace 밖·`..`는 걸러낸다. 근거: `openclaw:src/agents/workspace-bootstrap-policy.ts` `WORKSPACE_BOOTSTRAP_FILENAMES`, `resolveExtraBootstrapPatterns`, `createWorkspaceBootstrapFilePolicy`.
- `[확인]` 읽기 byte 상한은 파일당 `MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES = 2 * 1024 * 1024`. 넘으면 `RangeError`로 실패하고 truncation으로 넘기지 않는다. cache identity는 canonical path, dev, ino, size, mtime, ctime이라 mtime을 되돌려도 잡는다. 근거: `openclaw:src/agents/workspace-bootstrap-read.ts`, `workspace-file-read.ts` `workspaceFileIdentity`.
- `[확인]` 주입 문자 상한은 파일당 `bootstrapMaxChars` 기본 20,000, 합계 `bootstrapTotalMaxChars` 기본 60,000. `USER.md`는 둘 중 작은 쪽과 4,000의 더 작은 값. 넘으면 앞 75%·뒤 25%를 남기고 marker를 넣는다. `AGENTS.md`는 앞 45%·policy digest 35%·뒤 15%로 다르게 자른다. 합계가 바닥나면 뒤 파일을 건너뛴다. 개인 `USER.md`는 예외로, 상한을 넘으면 자르지 않고 공유 기본값으로 대체한다. 근거: `openclaw:src/agents/embedded-agent-helpers/bootstrap.ts` `DEFAULT_BOOTSTRAP_MAX_CHARS`, `DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS`, `USER_BOOTSTRAP_MAX_CHARS`, `buildBootstrapContextFiles`, `trimAgentsBootstrapContent`.
- `[확인]` 주입 모드는 `contextInjection`으로 always, continuation-skip, never. continuation-skip은 transcript에서 compaction·reset 이전이 아닌 full bootstrap marker가 있으면 다시 넣지 않는다. `BOOTSTRAP.md`는 setup이 끝나면 root의 것을 뺀다. 근거: `openclaw:src/agents/bootstrap-files.ts` `resolveContextInjectionMode`, `hasCompletedBootstrapTurn`, `filterCompletedWorkspaceBootstrapFile`.
- `[미확인]` 지침 파일을 읽는 도중 발견한 다른 지침을 그 자리에서 붙이는 경로. bootstrap 로더는 정해진 이름만 읽는다.

## 비교

lophn 숫자는 요구 그대로다. 파일당 32,768 byte, 합계 131,072 byte, 순서 전역 → project → app → preset 첨부. 넘치면 자르지 않고 그 호출을 멈춘다.

| | 파일 이름과 자리 | 부모 walk | 합치는 순서 | 파일당 상한 | 합계 상한 | 넘치면 | 못 읽으면 | 읽다 발견 |
|---|---|---|---|---|---|---|---|---|
| lophn | `~/.lophn/LOPHN.md`, `<project>/LOPHN.md`, `<app>/LOPHN.md`. 고정 경로 | 없음 | 전역 → project → app → preset | 32,768 byte | 131,072 byte | 호출 실패 | 호출 실패. `absent`만 생략 | 없음 |
| Codex | dir마다 override → `AGENTS.md` → fallback | cwd → project root(기본 `.git`) | root → cwd | 합산 32 KiB가 기본 예산 | 그 예산이 합계 | 잘라 쓰고 warning | lossy 변환, 실패 아님 | 없음 |
| OpenCode | 전역 `AGENTS.md`·`CLAUDE.md`, project `AGENTS.md`·`CLAUDE.md`·`CONTEXT.md`, URL | directory → worktree | 첫 매치 이름의 조상 전부 | `[미확인]` | `[미확인]` | `[미확인]` | `""`로 조용히 생략 | 있음. 읽는 파일 근처 지침을 메시지에 첨부 |
| Pi | override → `AGENTS.md` → `CLAUDE.md`(대소문자) | cwd → 파일 시스템 루트 | 전역 다음 root → cwd | `[미확인]` | `[미확인]` | `[미확인]` | warning 후 생략 | `[미확인]` |
| Gemini CLI | `GEMINI.md`(이름 변경 가능), private는 `MEMORY.md` | trusted root → git root | Global, Private, Extension, Project | `[미확인]` | `[미확인]` | `[미확인]` | null + warning | 있음. 다루는 파일의 조상 `GEMINI.md`를 그 자리 로드 |
| Hermes | `.hermes.md` → `AGENTS.md` 체인 → `CLAUDE.md` → `.cursorrules`, 하나면 나머지 shadow. `SOUL.md`는 항상 | git root까지. root 없으면 cwd만 | 이긴 종류 하나 + SOUL | 기본 20,000자, 동적 상한 500,000 | 체인 합본에 같은 cap 한 번 더 | 앞 70% 뒤 20%로 자름 | timeout 5초 포함 건너뜀 | 없음 |
| OpenClaw | `AGENTS.md` `SOUL.md` `IDENTITY.md` `USER.md` `BOOTSTRAP.md` memory | 없음. workspace 안만 | 그 순서 | 읽기 2 MiB에서 실패. 주입 20,000자(`USER.md` 4,000) | 주입 60,000자 | 주입 단계에서 자름. 개인 `USER.md`는 대신 기본값 | `[미확인]` | `[미확인]` |

## lophn에 가져올 것과 버릴 것

- R1 층과 자리. 전역 `~/.lophn/LOPHN.md`, project `<project>/LOPHN.md`, app `<app>/LOPHN.md`. 가져올 것: Hermes가 git root가 없으면 cwd만 보는 이유(부모 dir에 심은 파일). lophn은 그보다 좁게 고정 경로만 읽는다. 버릴 것: Pi의 파일 시스템 루트까지 walk, Codex·OpenCode의 조상 합치기, OpenCode의 `CLAUDE.md`·`CONTEXT.md` 겸용, Gemini의 파일 이름 변경. 파일 이름이 여러 개면 어느 것이 적용됐는지 사람이 알기 어렵다.
- R2 작업 자리에 따른 층. cwd 추정과 부모 walk가 없다. 가져올 것: OpenClaw가 workspace 밖으로 나가지 않는 것, Hermes의 install tree fallback 억제. 버릴 것: Codex의 marker 기반 root 추정, Pi의 `dirname === self`까지 상승. 자리 추정은 다른 프로젝트의 지침을 끌어온다.
- R3 순서 전역 → project → app → preset 첨부. 가져올 것: Pi가 전역을 먼저 두는 것. 버릴 것: Codex·OpenCode의 root → cwd(먼 조상이 앞), Hermes의 한 종류만 남기는 shadow, Gemini의 extension을 project 앞에 두는 것. lophn은 네 층을 모두 읽고 순서로 우선순위를 만든다.
- R4 prompt 자리. architecture §5.4와 D14는 제품 → role_preset → user_instructions, 그 뒤에 cache boundary, 그 다음 work_material → turn_context다. 가져올 것: 없음. 조사한 프로젝트 가운데 이 경계를 그대로 두는 곳은 없다. 버릴 것: Pi·OpenClaw가 지침을 system prompt 안에 두고 절대 경로를 함께 적는 것. 경로가 들어가면 모델이 그 파일을 도구로 다시 읽는다.
- R5 호출마다 다시 읽고 hash를 context basis에 남긴다. 수정은 다음 호출부터, cache prefix를 깬다. 가져올 것: OpenClaw가 mtime 복원을 ctime으로 잡는 것. 버릴 것: Codex가 turn 환경과 trust가 바뀔 때만 다시 읽는 cache. lophn은 호출 경계마다 읽어야 한다.
- R6 크기. 파일 32,768 byte, 합계 131,072 byte, wrapping 전 UTF-8. 가져올 형태만: Codex의 32 KiB라는 숫자. 의미는 다르다. Codex는 합산 예산이고 넘으면 자른다. lophn은 파일당 상한이고 넘으면 실패한다. 버릴 것: Hermes의 동적 상한(모델 context에 따라 20,000자에서 500,000자), OpenClaw의 주입 단계 truncation과 `AGENTS.md` policy digest. 자른 지침은 잘린 줄에 금지가 있었는지를 숨긴다.
- R7 넘침·인코딩 오류·못 읽는 기존 파일은 호출을 멈춘다. 자를 수 없고 조용히 건너뛸 수 없다. `absent`만 생략. 버릴 것: Codex의 lossy 디코드와 truncation, OpenCode의 오류 → `""`, Pi의 warning 후 skip, Hermes의 5초 timeout 후 skip, Gemini의 null + warning. 하나라도 가져오면 빠진 지침으로 호출이 성공한다.
- R8 지침은 데이터다. 권한·승인·상한을 넓히지 못한다. agent는 지침 파일을 쓰지 않고 question으로 제안한다. 가져올 것: Hermes가 project 파일의 injection 패턴을 내용 대신 marker로 바꾸는 방향. 그대로 가져오지는 않는다. Hermes는 패턴 목록에 의존하고, 사용자 `SOUL.md`는 같은 패턴이어도 통과시킨다. lophn은 지침 문자열을 권한 판정 입력으로 쓰지 않는 쪽에서 막는다. 버릴 것: OpenCode·Gemini의 읽다 발견 첨부. 모델이 고른 파일이 다음 호출의 지침이 된다. 이것과 Hermes의 자가 작성 권유는 둘 다 agent가 지침의 작성자가 되게 한다.

### open-issues 후보

요구와 어긋나서 구현만으로 닫히지 않는 것은 찾지 못했다. R7의 fail closed는 조사한 모든 프로젝트가 어기는 쪽이라, 구현에서 truncation이나 skip을 재사용할 수 없다. 이것은 요구를 바꿀 이유가 아니라 구현이 새로 짜야 하는 자리다.

## 구현 메모

### 자료 구조

`InstructionLocation`은 층(global, project, app)과 고정 경로. `InstructionLayer`는 status `present`, `absent`, `unavailable`, `invalid`, `too_large`와 byte 길이, content hash. preset 첨부는 이 파일들과 별도 목록으로 같은 합치기 단계의 마지막에 붙는다. 상태 전부는 `docs/domain-model/lophn-agent/instructions.md`를 따른다.

### 상태 전이

1. 호출 시작. 전역, project, app 경로를 그 순서로 읽는다. 부모로 올라가지 않는다.
2. 없으면 `absent`. 권한·IO 오류면 `unavailable`, 인코딩이 아니면 `invalid`, 32,768 byte를 넘으면 `too_large`.
3. `absent`가 아닌 비정상 상태가 하나라도 있으면 호출을 멈추고 어느 층이 왜 실패했는지 남긴다.
4. 읽힌 것의 합이 131,072 byte를 넘으면 호출을 멈춘다. 앞에서부터 채우지 않는다.
5. 전역 → project → app → preset 순으로 잇고 hash를 context basis에 기록한다. cache prefix 경계는 user_instructions 앞이다.
6. 권한·승인·상한 판정에는 이 문자열을 넣지 않는다.

### 기본값

| 항목 | 값 |
|---|---|
| 전역 경로 | `~/.lophn/LOPHN.md` |
| project 경로 | `<project>/LOPHN.md` |
| app 경로 | `<app>/LOPHN.md` |
| 파일당 | 32,768 byte, UTF-8, wrapping 전 |
| 합계 | 131,072 byte |
| 순서 | 전역, project, app, preset |
| 없는 파일 | 생략 |
| 오류·넘침 | 호출 실패 |

### 오류 분류

| 상황 | 상태 | 호출 |
|---|---|---|
| 파일 없음 | `absent` | 계속 |
| 읽기 오류 | `unavailable` | 멈춤 |
| UTF-8 아님 | `invalid` | 멈춤 |
| 32,768 byte 초과 | `too_large` | 멈춤 |
| 합계 초과 | 층 상태는 유지하고 합계 오류 | 멈춤 |
| 세션 중 수정 | 다음 호출에서 반영, hash 변경 | 계속 |

### 테스트 경계

- 전역만 있고 project·app이 없으면 그 둘은 `absent`고 호출은 성공한다.
- project가 32,769 byte면 `too_large`고 전역이 정상이어도 호출은 실패한다. 앞부분을 쓰지 않는다.
- 세 파일이 각각 상한 안이지만 합이 131,073 byte면 실패한다.
- 잘못된 byte 하나가 있어도 lossy로 통과시키지 않는다.
- `<project>/sub/LOPHN.md`나 cwd의 `AGENTS.md`는 읽지 않는다.
- 모델이 도구로 다른 파일을 읽어도 다음 지침 합치기에 그 파일이 들어오지 않는다.
- 지침 본문에 권한을 넓히라는 문장이 있어도 판정 입력이 바뀌지 않는다.
- 파일을 호출 사이에 고치면 다음 호출의 hash가 달라지고 cache prefix가 갱신된다.
