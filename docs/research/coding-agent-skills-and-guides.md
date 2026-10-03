---
type: research
concerns: [coding-agent/guides]
---
# coding agent의 skill·guide·session hook

## 질문

lophn skill을 어디에, 어떤 모양으로 깔아야 각 harness가 읽고, 같은 이름일 때 누가 이기며, 세션 시작에 context를 넣는 경로가 hook뿐인가. guide 파일은 제품마다 어디까지 읽고 어디서 잘라내는가. 관리 구간을 고칠 때 사용자 수정과 동시 수정을 어떻게 구분하나.

조사일 2026-10-04. `[확인]`은 아래 revision의 코드에서 본 것, `[문서]`는 공식 문서, `[미확인]`은 이번 조사에서 못 본 범위다. 경로는 각 clone 루트 기준이다.

## 프로젝트별

### Agent Skills spec (`agentskills.io/specification`, 2026-10-04 조회) [문서]

- `SKILL.md` = YAML frontmatter + markdown body. 필수 필드는 `name`, `description`.
- `name`: 1–64자, 소문자·숫자·hyphen만, 앞뒤 hyphen 금지, 연속 hyphen(`--`) 금지, **부모 디렉터리 이름과 같아야 한다.**
- `description`: 1–1024자, 비어 있으면 안 된다. `compatibility`는 있으면 1–500자.
- `metadata`: string key → string value map. `allowed-tools`는 실험적(공백으로 구분한 문자열).
- body 형식 제한은 없다. "Keep your main `SKILL.md` under 500 lines." 권고일 뿐 검증 항목이 아니다. 토큰 기준 권고는 metadata ~100, instructions < 5000.
- 파일 참조는 skill root 기준 상대 경로, "one level deep from `SKILL.md`". 검증기 `skills-ref validate`가 frontmatter와 이름 규칙을 검사한다. 실패 시 loader 동작은 spec이 정하지 않는다.

### Claude Code (clone `1c229fcd1e1e4e452e29a8f116b45fe4cfe2c528` — plugins 예시만 있고 loader 본체가 없다. 아래는 전부 [문서], code.claude.com 2026-10-04)

- skill 위치: enterprise managed settings, `~/.claude/skills/<name>/SKILL.md`(개인), `.claude/skills/<name>/SKILL.md`(프로젝트), `<subdir>/.claude/skills/`(그 아래 세션에서), `--add-dir`로 준 디렉터리, plugin `skills/`. enterprise·개인·프로젝트 위치의 `<name>` 항목은 symlink여도 된다. 같은 target은 한 번만 로드한다. [문서]
- `name`은 선택이고 없으면 디렉터리 이름. 모르는 frontmatter 필드는 오류 없이 무시한다. 디렉터리 이름 `synced`와 `anthropic-skills` 계열은 예약되어 로드하지 않는다. description + when_to_use는 skill 목록에서 1,536자에서 잘린다. [문서]
- `CLAUDE.md`는 cwd와 그 위 모든 디렉터리에서 모아 이어 붙인다. `@path` import는 그 파일이 있는 곳 기준 상대 경로, 최대 4단계, code span·fenced block 안은 무시, 공백은 backslash. 프로젝트 밖 import는 첫 승인 대화상자가 있다. 문서가 직접 "Windows면 symlink 대신 `@AGENTS.md` import를 쓰라"고 한다. 파일당 200줄 권고. [문서]
- `SessionStart` matcher: `startup`, `resume`, `clear`, `compact`, `fork`. 이 이벤트는 plain stdout이 그대로 context가 되고, JSON이면 `hookSpecificOutput.additionalContext`를 쓴다. `additionalContext`·`systemMessage`·plain stdout은 10,000자 cap, 넘으면 세션 디렉터리 파일로 넘기고 앞 2,000자 preview만 전달한다. command hook 기본 timeout 600초, 초과 시 출력을 버린다. exit 2여도 세션은 진행되고 stderr는 사용자에게만 보인다. interactive 세션에서 hook은 background로 돌고 첫 응답만 hook 완료를 기다린다. [문서]

### Codex (`3a69ec3ef8fb87b41e99b8942af061ad58ae6732`) [확인]

- parser(`codex-rs/skills/src/parser.rs` 4, 70–82): `name` 64자(`chars().count()`) 초과면 그 skill은 오류. `description`은 비어 있지 않기만 요구하고 **길이 제한이 없다.** `MAX_DESCRIPTION_LEN = 1024`(`codex-rs/ext/skills/src/loader/mod.rs` 24)는 dependency 필드에만 쓰인다. frontmatter가 없거나 YAML이 깨지면 `SkillError`로 기록되고(System scope는 조용히 버림) 그 skill만 빠진다. `name`이 없으면 부모 디렉터리 이름으로 채운다. 문자 종류와 디렉터리 이름 일치는 검사하지 않는다.
- metadata는 `metadata.short-description` 하나만 읽고, 나머지는 `agents/openai.yaml`(interface, dependencies.tools, policy)에서 fail-open으로 읽는다(`codex-rs/ext/skills/src/loader/metadata.rs`). nested 구조라 spec의 string map과 다르다.
- discovery(`codex-rs/ext/skills/src/loader/discovery.rs`): depth 6(recursive) 또는 2(direct children), root당 디렉터리 2,000·항목 20,000, 숨김 디렉터리는 건너뛰고, 디렉터리 symlink는 정책으로 켜고 끈다. walk 오류와 상한 초과는 warning이지 실패가 아니다.
- root(`codex-rs/ext/skills/src/host_roots.rs` 24, 96–179): user 계층은 deprecated `$CODEX_HOME/skills`와 `~/.agents/skills`를 둘 다 넣고, project 계층은 config folder의 `skills`와 repo의 `.agents/skills`(project root에서 cwd까지, 있는 디렉터리만)를 넣는다. 경로로 dedupe하고 먼저 넣은 쪽이 남는다.
- `AGENTS.md`(`codex-rs/core/src/agents_md.rs`): 디렉터리마다 `AGENTS.override.md` → `AGENTS.md` → fallback 파일명 순으로 첫 파일만. project root(기본 marker `.git`)까지만 올라가고 root → cwd 순으로 잇는다. 예산 32 KiB(`codex-rs/config/src/config_toml.rs` 75, `codex-rs/core/src/config/mod.rs` 255)를 **바이트 단위로 잘라** lossy UTF-8로 읽는다. untrusted project면 project doc 전체를 건너뛴다(`codex-rs/core/src/config/mod.rs` 3752).
- hook(`codex-rs/hooks/`): `SessionStart` source가 `startup|resume|clear|compact|fork`이고(`codex-rs/hooks/src/events/session_start.rs` 24–42) 결과가 `additional_contexts`로 돌아온다(84–88). command hook 기본 timeout 600초(`codex-rs/hooks/src/engine/discovery.rs` 764), additional context 기본 한도 2,500토큰(`codex-rs/hooks/src/output_spill.rs` 12)으로 넘치면 spill한다. **Codex도 hook 출력을 모델 context에 넣는다.**

### Gemini CLI (`fb972b2f87fe7d5b06d37eac711490162d98de2c`) [확인]

- loader(`packages/core/src/skills/skillLoader.ts` 127): glob이 `SKILL.md`와 `*/SKILL.md`뿐이라 **한 단계까지만** 본다. 이름 정규식·길이 제한이 없고, `name`의 `:\/<>*?"|`만 `-`로 바꾼다. frontmatter가 없거나 잘못되면 null로 그 skill만 빠지고(debug log), YAML 파싱 실패는 줄 단위 fallback parser로 넘긴다.
- 우선순위(`packages/core/src/skills/skillManager.ts`, `packages/core/src/config/storage.ts` 147–356): builtin < extension < `~/.gemini/skills` < `~/.agents/skills` < `<workspace>/.gemini/skills` < `<workspace>/.agents/skills`. 같은 이름은 나중 것이 이기고 warning을 낸다. 그래서 `.gemini/skills`에 깔아도 같은 이름이 `.agents/skills`에 있으면 가려진다. `isTrusted=false`면 workspace skill을 통째로 건너뛴다(82).
- context 파일: 기본 `GEMINI.md`(`packages/core/src/tools/memoryTool.ts`). `settings.context.fileName`이 있으면 `setGeminiMdFilename`으로 넣는데(`packages/cli/src/config/config.ts` 624–630), 이 함수는 기존 목록에 **합집합으로 더한다**(22–44). 설정이 없으면 `resetGeminiMdFilename('GEMINI.md')`로 되돌린다. `@path` import는 공백 경계의 `@`에서 공백까지, `.` `/` 글자로 시작해야 하고 code span은 제외, 순환을 상태로 막는다(`packages/core/src/utils/memoryImportProcessor.ts` 103–153). 발견 상한 `discoveryMaxDirs` 200, boundary marker 기본 `.git`. 파일 크기 cap은 발견 경로에서 찾지 못했다. [미확인]
- hook: `SessionStart` source는 `startup|resume|clear`(`packages/core/src/hooks/types.ts` 607–617)이고 `hookSpecificOutput.additionalContext`를 모아 `<hook_context>`로 감싸 history 첫 turn에 넣는다(`packages/cli/src/ui/AppContainer.tsx` 498–504, `packages/core/src/hooks/hookAggregator.ts` 187–212). 기본 timeout 60,000ms(`packages/core/src/hooks/hookRunner.ts` 34–36). 공식 문서도 interactive는 history 첫 turn, non-interactive는 prompt 앞에 붙는다고 적는다(`docs/hooks/reference.md` 245–258). **Gemini도 hook 출력을 context에 넣는다.**

### OpenCode (`907b3bc518fa48e90e8ec24dd327d13eee71c36c`) [확인]

- v1 loader(`packages/opencode/src/skill/index.ts`): `.claude/skills/**/SKILL.md`, `.agents/skills/**/SKILL.md`(홈 + worktree까지 위로), opencode config 디렉터리의 `{skill,skills}/**/SKILL.md`, `skills.paths`, `skills.urls`. `name`은 string이어야 하고 `description`은 선택, 길이 제한 없음. 같은 이름은 warning 후 나중 것이 덮어쓴다. `NameMismatchError` 클래스가 있지만 `add()`는 디렉터리 이름 일치를 검사하지 않는다. description 없는 skill은 catalog에서 빠진다. catalog는 XML `<available_skills>`(name, description, location) 또는 markdown 목록.
- v2(`packages/core/src/skill.ts`): `{*.md,**/SKILL.md}`를 symlink·dot 포함으로 glob하고 이름 키가 나중 source로 덮인다.
- instruction(`packages/opencode/src/session/instruction.ts`): 전역은 `~/.config/opencode/AGENTS.md` 다음 `~/.claude/CLAUDE.md` 중 있는 첫 파일. 프로젝트는 `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`(deprecated) 순으로 **첫 번째로 발견되는 종류**의 파일 전부(worktree까지). 즉 `AGENTS.md`가 있으면 `CLAUDE.md`는 읽지 않는다. `config.instructions`의 http(s)는 timeout 5초. 크기 cap은 없다. `@` import는 없다.

### pi (`83692682f095528f8b71652ddacff7075e36e893`) [확인]

- 검증(`packages/coding-agent/src/core/skills.ts` 11–14, 95–): `name` 64자, `/^[a-z0-9-]+$/`, 앞뒤 hyphen·연속 hyphen 금지. `description` 필수, 1,024자(JS string length). 위반은 **warning이고 skill은 로드된다.** description이 없거나 비면 로드하지 않는다. 디렉터리 이름 일치는 요구하지 않는다고 문서가 명시한다(`packages/coding-agent/docs/skills.md` 81–85).
- discovery: `SKILL.md`가 있는 디렉터리에서 재귀를 멈추고, root 바로 아래 `.md`도 skill로 읽는다. symlink를 따라가고 `.gitignore`·`.ignore`·`.fdignore`를 지키며 dot 디렉터리와 `node_modules`는 건너뛴다. 같은 이름은 먼저 발견한 쪽이 이긴다.
- root: `~/.pi/agent/skills`, `<cwd>/.pi/skills`, 그리고 `~/.agents/skills`(항상)와 프로젝트 `.agents/skills`(project trust일 때만, `packages/coding-agent/src/core/package-manager.ts` 2458–2561). catalog는 XML이고 `disable-model-invocation: true`는 뺀다.
- context(`packages/coding-agent/src/core/resource-loader.ts` 184–270): 디렉터리마다 `AGENTS.override.md` → `AGENTS.md` → `AGENTS.MD` → `CLAUDE.md` → `CLAUDE.MD` 첫 파일. 전역 `~/.pi/agent/AGENTS.md`를 먼저 넣고 cwd에서 **파일시스템 root까지** 올라간다. project root에서 멈추지 않고 크기 cap도 없다. trust는 `cwd/.pi`나 `.agents/skills` 항목이 있을 때 묻고, `~/.agents/skills`는 user 수준으로 항상 신뢰한다(`packages/coding-agent/src/core/trust-manager.ts` 181–197).

### Hermes (`343500b3547e12530457c2fda60ec687e25118b4`) [확인]

- 디렉터리(`agent/skill_utils.py` 431–498): 로컬 `~/.hermes/skills`, `skills.create_dir`, `skills.external_dirs`, 그리고 프로젝트 `<root>/.hermes/skills`와 `<root>/.agents/skills`. 프로젝트 root는 `.git`까지 최대 64단계(홈 자신은 제외). 프로젝트 쪽은 `skills.trusted_project_dirs`에 있을 때만 읽고, `hermes skills trust`가 그 목록을 고친다(`hermes_cli/subcommands/skills.py` 28–36). `skills.project_discovery: false`면 끈다.
- 격리: 프로젝트 `SKILL.md`마다 `skills_guard` 스캔, verdict `dangerous`면 제외하고 스캐너가 죽어도 제외(fail-closed), `caution`은 로드한다. `os.walk(followlinks=True)`.
- 라우팅 설명은 `SKILL_PROMPT_DESC_LIMIT = 60`에서 자른다(`agent/skill_utils.py` 761–773). linter(`tools/skill_linter.py` 56, 83–128)는 로드 시점이 아니라 경고다: 이름 `^[a-z0-9][a-z0-9_-]*$`(밑줄 허용), 디렉터리 이름 불일치는 error, description 60자 초과와 body 24,000자(`_BODY_SOFT_BUDGET_CHARS`) 초과는 warning.
- context(`agent/prompt_builder.py`): 종류 우선순위가 있어 `.hermes.md`/`HERMES.md`가 하나라도 있으면 `AGENTS.md` 체인을 아예 안 읽는다. 그 다음이 `AGENTS.override.md`/`AGENTS.md`/`agents.md`(git root → cwd, 디렉터리마다 비어 있지 않은 첫 파일, 같은 내용은 dedupe), 그 다음 cwd의 `CLAUDE.md`, 마지막 `.cursorrules`. 예산은 최소 20,000자, 동적 상한은 context window의 6%를 20,000–500,000으로 clamp, `context_file_max_chars`로 override. 자를 때는 head 70% + tail 20%. 읽기 timeout 기본 5초(`_CONTEXT_FILE_READ_TIMEOUT_SECS`, 36–46).

### OpenClaw (`37efa0b4a644b66a5987a07841e9707e1de2a7d8`) [확인]

- source(`src/skills/loading/workspace-skill-sources.ts` 96–165, `src/skills/loading/workspace-skill-roots.ts` 39–50): extra dirs·plugin < bundled < workshop < managed(`CONFIG_DIR/skills`, 기본 `~/.openclaw/skills`) < `~/.agents/skills`(personal, state dir가 기본일 때만) < `<workspace>/.agents/skills` < `<workspace>/skills`. 나중 tier가 이긴다. workspace는 agent마다 다를 수 있고 ancestor를 걷지 않는다.
- 상한(`src/skills/loading/skill-root-discovery.ts` 18–20): root당 candidate 300, source당 skill 200, 파일 256,000바이트, scan depth 6. frontmatter가 잘못되면 throw(`src/skills/loading/frontmatter.ts`). metadata는 openclaw 전용 nested 블록(os, requires, install spec 등)이다.
- catalog 예산(`src/skills/loading/skill-prompt-limits.ts` 9–10, `skill-contract.ts`): prompt 안 skill 150개·18,000자. 넘치면 description을 4–220자로 줄이고 그래도 안 되면 skill을 버린 뒤 truncation 주를 붙인다. 캐시되는 skill 본문은 16 KiB(`src/skills/loading/local-loader.ts` 22).
- `AGENTS.md`는 workspace bootstrap 파일이고 파일당 20,000자, 합계 60,000자(`src/agents/embedded-agent-helpers/bootstrap.ts` 88, `src/config/schema.help.models.ts` 152–156). cwd ancestor를 걷는 경로는 찾지 못했다.

### Orca (`fd030c404074f1100e5eedab59aec3dac7e6d1f5`) [확인]

- 설치 위치 catalog(`src/shared/skill-install-providers.ts` 28–101): codex·muse는 `.agents/skills`를 그대로 읽어 별도 placement가 없고, claude는 `.claude/skills`(global·workspace), gemini는 `.gemini/skills`를 **global만** 둔다. gemini-cli 코드는 workspace `.gemini/skills`도 읽으므로 이 catalog는 그 개정과 어긋난다.
- 설치는 staging 디렉터리 + `rename`, conflict는 `replace-unmodified`/`replace-and-discard-local`/`cancel`(`src/main/skills/skill-install-transaction.ts`).
- 관리 파일은 **파일 전체 교체**다(`src/main/agent-hooks/managed-hook-script-refresh.ts` 74–104): 같은 디렉터리의 `.<timestamp>-<uuid>.tmp`에 쓰고 `chmod 0o755`, 대상이 아직 있는지 다시 확인한 뒤 `rename`, 내용이 같으면 건너뛴다. 소유는 marker 파일로 표시해 사용자가 지운 것과 처음 설치를 구분한다(`src/main/claude/hook-service.ts` 199–223). 구간 marker로 파일 일부를 고치는 코드는 없다.
- bundled skill 테스트(`config/scripts/skill-description-length.test.mjs`): description 1,024자 이하, `<tag>` 토큰 금지.

### Paseo (`0d05584d044f5a72212d509ead7af0532dd105e2`) [확인]

- 대상은 `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills`(legacy)다(`packages/server/src/server/orchestration-skills/internal/paths.ts` 17–23).
- 소유는 파일별 sha256 manifest `.paseo-managed-files.json`이다(`internal/sync.ts` 19–170). 바이트가 다를 때만 복사하고, 지울 때는 현재 hash가 manifest hash와 같을 때만 지운다. 사용자가 고친 파일은 남는다. 절대 경로·`..`·symlink segment는 거절한다(`assertManagedPathsStayInsideSkill`, 112–135). legacy codex 사본은 realpath가 공유 사본과 같으면 은퇴시키지 않는다(195–209).
- 쓰기는 `fs.writeFile` 직행이라 atomic하지 않다(26–32). 구간 marker 편집은 없다.

## 비교

| | spec | Claude Code | Codex | Gemini CLI | OpenCode | pi | Hermes | OpenClaw |
|---|---|---|---|---|---|---|---|---|
| name 검사 | 64자, `a-z0-9-`, 디렉터리 일치 | 없으면 디렉터리 이름 [문서] | 64자만, 불일치 허용 | 없음(문자만 sanitize) | string이기만 | 64자·문자 검사, warning 후 로드 | linter만(밑줄 허용) | 없음 |
| description | 1–1024 | 목록에서 1,536자 truncate [문서] | 비어 있지만 않으면 통과 | 제한 없음 | 제한 없음, 없으면 catalog 제외 | 1024 초과 warning 후 로드 | 인덱스에서 60자 | 220자로 줄이고 예산 초과 시 drop |
| 발견 깊이 | 규정 없음 | symlink 포함 [문서] | depth 6 | **1단계** | `**` 재귀 | 재귀, `SKILL.md`에서 멈춤 | 재귀, symlink 따라감 | depth 6, 300/200/256KB |
| 같은 이름 | — | [미확인] | 먼저 넣은 root | 나중 source가 이김 | 나중 source가 이김 | 먼저 발견 | 프로젝트 tier가 profile을 이김 | 나중 tier |
| guide 예산 | — | 200줄 권고 [문서] | 32 KiB, 바이트로 자름 | cap 못 찾음 [미확인] | 없음 | 없음, root까지 walk | 20K–500K, head/tail | 파일 20K, 합계 60K |
| session hook → context | — | 넣음(10,000자) [문서] | **넣음**(2,500토큰) | **넣음**(`<hook_context>`) | [미확인] | [미확인] | [미확인] | [미확인] |
| 프로젝트 신뢰 | — | 외부 import 승인 [문서] | untrusted면 `AGENTS.md` 생략 | untrusted면 workspace skill 생략 | 없음(disable flag만) | `.pi`·`.agents/skills`에 trust | `hermes skills trust` + 스캔 | [미확인] |

## lophn에 가져올 것과 버릴 것

- 가져온다: spec 그대로의 frontmatter(이름 64·`a-z0-9-`·디렉터리 일치, description 1024, metadata string map, 참조 한 단계, body 500줄 권고). 이건 검증기가 있는 유일한 공통 기준이고, 각 loader는 그보다 느슨할 뿐 더 엄격하지 않다.
- 가져온다: 설치는 평평하게 `<root>/<name>/SKILL.md`. 한 단계만 보는 쪽(Gemini)이 있어 중첩은 거기에서 안 보인다.
- 가져온다: Paseo의 소유 판정. 고치거나 지우기 전에 기록해 둔 hash와 현재 바이트를 비교해 사용자가 고친 파일은 남긴다. 절대 경로·`..`·symlink 거절도 같이.
- 가져온다: Orca의 교체 방식. 같은 디렉터리 temp 파일에 쓰고 대상이 아직 있는지 다시 확인한 뒤 `rename`. Paseo의 직행 `writeFile`은 중간 상태가 남으므로 버린다.
- 버린다: 제품별 metadata(`agents/openai.yaml`, `metadata.hermes`, OpenClaw metadata 블록)에 의존하는 것. lophn skill은 spec의 string map만 쓰고 tool 의존을 거기 숨기지 않는다.
- 버린다: hook 하나로 모든 제품에 context를 넣는 가정. Claude·Codex·Gemini는 hook 출력이 context에 들어가지만 출력 계약·한도·timeout이 제각각이라(10,000자 / 2,500토큰 / 한도 없음, timeout 600초 / 600초 / 60초) 한 구현을 공유한다고 볼 수 없다. 나머지는 확인되지 않았다.

## requirements와 다른 점

- `coding-agent/guides#R2`: "부적합 배포가 거절된다"와 달리 어느 loader도 spec 위반을 설치 거절로 만들지 않는다. pi는 warning만 내고 로드하고, Codex는 길이 초과·frontmatter 파손만 그 skill을 빼며, 나머지는 통과시킨다. 거절은 lophn이 배포 전에 스스로 해야 하고 harness에 기대면 안 된다. description 1–1024도 마찬가지라 Hermes는 인덱스에서 60자로 잘라 1024자 description의 라우팅 신호가 사라진다. body 500줄은 spec의 권고일 뿐 어느 loader도 줄 수로 거절하지 않는다(Hermes linter만 24,000자 warning).
- `coding-agent/guides#R3`: metadata를 string map으로 제한하는 것은 spec과 같아 안전하다. 다만 Codex·OpenClaw·Hermes는 바로 그 제품 metadata에서 tool 의존과 설치 spec을 읽으므로, 거기 의존하는 skill은 lophn 검증을 통과해도 그 제품에서만 동작이 달라진다.
- `coding-agent/guides#R4`: "한 단계, symlink 없음"은 Gemini에만 해당한다. Codex는 depth 6에 symlink 정책, pi·OpenCode·Hermes·OpenClaw는 재귀에 symlink를 따라간다. 평평하게 설치하면 어디에서도 보이므로 설치 규칙은 유지하되, "중첩이 안 읽힌다"는 Gemini 외에는 사실이 아니다.
- `coding-agent/guides#R5`: root 표가 제품의 전부가 아니다. Codex는 `$CODEX_HOME/skills`(deprecated)와 project config `skills`도 읽고, Gemini는 `~/.agents/skills`·`<workspace>/.agents/skills`를 `.gemini/skills`보다 위에 두며, OpenCode는 `.opencode/skills` 외에 `.agents/skills`와 `.claude/skills`를, pi는 `.pi/skills` 외에 `.agents/skills`를(프로젝트는 trust 필요), Hermes는 `.hermes/skills`와 `.agents/skills`를 trust 뒤에, OpenClaw는 `~/.openclaw/skills`와 workspace `skills` 사이에 `~/.agents/skills`·`<workspace>/.agents/skills`를 둔다. 제품별 root만 깔면 `.agents/skills`의 같은 이름이 제품을 가리거나(Gemini·OpenClaw·Hermes·OpenCode) 가려진다(pi·Codex는 먼저 발견). 같은 이름 자동 교체를 안 한다는 전제에서 이 순서를 설치 계획에 반영해야 한다.
- `coding-agent/guides#R13`: `AGENTS.md` 단일 canonical은 대체로 맞다. Codex·pi는 더 가까운 `AGENTS.override.md`가 그 디렉터리의 `AGENTS.md`를 이기고, OpenCode는 `AGENTS.md`가 있으면 `CLAUDE.md`를 읽지 않으며, Hermes는 `.hermes.md`/`HERMES.md`가 있으면 `AGENTS.md` 체인 전체를 건너뛴다. Gemini의 `context.fileName`은 확인 결과 기존 목록과 합집합으로 더해지므로(없으면 `GEMINI.md`로 리셋) 설정에 `AGENTS.md`를 넣는 계획은 맞다. 다만 예산이 달라 Codex는 32 KiB를 바이트 경계로 자르고(UTF-8 깨짐 가능), Hermes는 20,000자 바닥에서 head/tail로, OpenClaw는 파일당 20,000·합계 60,000으로 자른다. pi는 파일시스템 root까지 크기 제한 없이 올라간다.
- `coding-agent/guides#R15`, `#R16`: 조사한 프로젝트 가운데 marker로 파일 일부를 관리하는 곳은 없다. Orca는 파일 전체를 temp + `rename`으로 교체하고, Paseo는 파일별 sha256 manifest로 사용자 수정을 보존하지만 쓰기가 atomic하지 않다. marker 구간 방식은 선례 없는 [제안]이고, 소유 판정은 Paseo의 hash 비교를, 교체는 Orca의 temp + 재확인 + `rename`을 가져오는 쪽이 근거가 있다.
- `coding-agent/guides#R23`–`#R25`: "hook으로 context를 넣는 것은 Claude뿐"은 사실이 아니다. Codex `SessionStart`(source `startup|resume|clear|compact|fork`, 기본 timeout 600초, additional context 2,500토큰)와 Gemini `SessionStart`(source `startup|resume|clear`, timeout 60초, `<hook_context>`로 history에 주입)도 출력을 context에 넣는다. Claude의 10,000자 cap·600초 기본 timeout·exit 2에서도 세션 진행은 [문서]로 확인된다. lophn이 정한 5초 timeout, 10줄·1,200자, 실패 시 빈 stdout + exit 0은 어느 제품 기본값과도 다르므로 lophn 쪽 규약으로 유지하면 된다. OpenCode·pi·Hermes·OpenClaw의 session hook 출력 계약은 [미확인]이다.
