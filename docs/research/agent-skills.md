---
type: research
concerns: [lophn-agent/extensions]
---
# agent skill 발견·검증·읽기

## 질문

skill을 어디서 어떤 깊이로 찾고, 잘못된 frontmatter를 고칠지 버릴지, 같은 이름을 어떻게 가르나.
본문과 보조 파일을 어떤 도구로 읽고 경로·심볼릭 링크·스크립트 실행을 어디서 막나.
run 시작에 고른 목록과 hash를 고정할 수 있는지, 원격 설치와 agent 자가 작성을 누가 막나.

조사일 2026-10-04. `[확인]`은 해당 revision 소스에서 본 사실, `[추측]`은 정황, `[미확인]`은 근거를 찾지 못한 것이다. 경로는 `프로젝트:저장소 상대 경로`다. 테스트 snapshot은 근거로 쓰지 않았다. Claude Code는 harness 소스가 없어 형식 참고로만 적고 3개 프로젝트에 세지 않는다.

## 프로젝트별

### Codex (3a69ec3ef8fb)

- `[확인]` frontmatter parser는 name 64자(문자 수), description은 비어 있으면 거절하지만 길이 검사는 없다. name이 없으면 호출자가 준 default name으로 채운다. scalar에 `: `나 flow처럼 보이는 `[ { @ \``가 있으면 작은따옴표로 감싸 YAML을 고쳐 파싱을 살린다. 근거: `codex:codex-rs/skills/src/parser.rs` `parse_skill_frontmatter_metadata`, `repair_frontmatter_scalar_fields`, `MAX_NAME_LEN`.
- `[확인]` 로더는 `SKILL.md`, 메타데이터는 `agents/openai.yaml`. 상한은 name 64, qualified name 129, description 1024, scan depth 6, root당 dir 2000, root당 entry 20,000, 동시 root scan 8, 동시 skill load 64. 심볼릭 링크는 Follow/Ignore 정책, 숨김 dir 정책이 따로 있고 walk 오류와 잘림은 warning이다. 근거: `codex:codex-rs/ext/skills/src/loader/mod.rs`, `loader/discovery.rs` `discover_skills`.
- `[확인]` root는 config 층에서 모은다. project `<config>/skills`(Repo), deprecated `$CODEX_HOME/skills`(User), `~/.agents/skills`(User), `$CODEX_HOME/skills/.system`(System, embedded skill을 fingerprint marker와 함께 씀), admin `<config>/skills`(Admin), plugin root, extra root, 그리고 project root에서 cwd까지 매 dir의 `.agents/skills`. 경로는 dedupe한다. 근거: `codex:codex-rs/ext/skills/src/host_roots.rs` `resolve_skill_roots`, `codex-rs/skills/src/lib.rs` `install_system_skills`.
- `[확인]` 같은 파일 경로는 첫 것을 남기고, scope rank(Repo 0, User 1, System 2, Admin 3) → name → path로 정렬한다. 같은 이름은 여기서 버리지 않는다. System scope parse 오류는 조용히 버린다. 근거: `codex:codex-rs/ext/skills/src/loader/host_merge.rs`, `loader/host.rs`.
- `[확인]` prompt budget은 설정 token cap(최대 10,000), 없으면 context window의 2%, 그것도 없으면 8,000자. prompt byte 상한 8,000. description은 1,024자에서 `...`로 자른다. budget을 넘기면 skill description을 통째로 빼고 "Exceeded skills context budget..." warning을 남긴다. 근거: `codex:codex-rs/ext/skills/src/render.rs`.
- `[확인]` 읽기 tool은 `skills.read`(package, resource?, cursor). resource를 빼면 `SKILL.md`를 읽고, resource는 그 package에 묶인 `skill://` id여야 한다. 응답은 512 KiB로 페이지를 나누고 `next_cursor`를 준다. 즉 부분 읽기가 성공이다. resource 본문 상한은 1 MiB. snapshot cache는 페이지 사이에 재사용하고, 주석이 파일 변경을 감지하지 않으며 snapshot이 만료되지 않는다고 적는다. executor skill은 `skill_root` 절대 경로를 돌려준다. `SkillPolicy.allow_implicit_invocation` 기본 true, product gating은 parse하지만 주석이 아직 강제하지 않는다고 적는다. 근거: `codex:codex-rs/ext/skills/src/tools/read.rs`, `tools/mod.rs`, `provider.rs`, `model.rs`.

### OpenCode (907b3bc518fa)

- `[확인]` 발견은 `disableExternalSkills`가 아니면 `~/.claude/skills`(`disableClaudeCodeSkills`가 아니면)와 `~/.agents/skills`, 그리고 directory에서 worktree까지 위로 올라가며 `skills/**/SKILL.md`. 그 다음 config dir의 `{skill,skills}/**/SKILL.md`, `cfg.skills.paths`(tilde·상대), `cfg.skills.urls`는 `discovery.pull(url)`로 원격에서 받는다. glob은 `symlink: true`. 근거: `opencode:packages/opencode/src/skill/index.ts`.
- `[확인]` frontmatter 검사는 name이 string인지, description이 있으면 string인지뿐이다. 길이·문자 집합 규칙은 없다. 같은 이름은 warning을 남기고 덮어쓴다(나중 것). `Effect.forEach`가 동시성 제한 없이 돌아 승자가 경합한다. 내장 skill `customize-opencode`를 먼저 등록해 디스크 skill이 덮어쓰게 한다. 근거: 위 파일.
- `[확인]` `available()`은 `localeCompare`로 정렬하고 agent별 `Permission.evaluate("skill", name) !== "deny"`로 거른다. verbose `fmt()`는 XML `<available_skills>`에 `<location>`으로 절대 경로를 넣는다. 근거: 위 파일.
- `[확인]` skill tool 입력은 name뿐이고 permission은 ask다. 본문 전체와 SKILL.md가 아닌 파일을 최대 10개(ripgrep, `follow: false`) 절대 경로와 base dir 절대 경로로 돌려준다. bundle 안에 가두지 않아 모델은 그 다음 일반 read tool을 쓴다. 이 tool이 스크립트를 실행하지는 않는다. 근거: `opencode:packages/opencode/src/tool/skill.ts`.

### Pi (83692682f095)

- `[확인]` name 64, description 1024. name은 `^[a-z0-9-]+$`, 앞뒤 `-` 금지, `--` 금지인데 위반은 warning이고 skill은 그대로 로드된다. description이 없을 때만 버린다. name이 없으면 부모 dir 이름으로 채운다. 근거: `pi:packages/coding-agent/src/core/skills.ts` `validateName`, `MAX_NAME_LENGTH`, `MAX_DESCRIPTION_LENGTH`.
- `[확인]` 재귀 발견이고 `SKILL.md`가 있는 dir을 skill root로 보고 그 아래로는 더 내려가지 않는다. root의 description 있는 `.md`도 skill로 센다. dot dir과 `node_modules`는 건너뛰고 `.gitignore`/`.ignore`/`.fdignore`를 따르며 심볼릭 링크는 따라간다. 순서는 `<agentDir>/skills`(user) → `<cwd>/<CONFIG_DIR_NAME>/skills`(project) → 명시 경로. 같은 이름은 먼저 온 것이 이기고 collision diagnostic에 이긴 경로와 진 경로를 적는다. 같은 realpath는 조용히 건너뛴다. 근거: 위 파일.
- `[확인]` prompt는 XML로 name, description, 절대 `<location>`을 넣고 모델에게 read tool이나 bash로 읽으라고 한다. 전용 skill tool도 bundle 가둠도 없어 스크립트는 bash로 실행할 수 있다. `disable-model-invocation: true`면 prompt에서 뺀다. 근거: 위 파일 `formatSkillsForPrompt`.

### Gemini CLI (fb972b2f87fe)

- `[확인]` 우선순위는 나중 것이 이긴다. builtin dir(`skills/builtin`) < extension skill < user skills dir < user `.agents/skills` < workspace project skill < workspace `.agents/skills`. workspace skill은 폴더가 untrusted면 통째로 건너뛴다. 충돌은 warning event. `setDisabledSkills`는 제외 목록(대소문자 무시)이고 `getSkill`도 대소문자를 무시한다. 본문은 발견 시점에 메모리로 전부 읽는다. 근거: `gemini-cli:packages/core/src/skills/skillManager.ts` `discoverSkills`.
- `[확인]` glob은 `SKILL.md`와 `*/SKILL.md`, 한 단계만, `node_modules`와 `.git` 무시. YAML이 깨지면 줄 단위 fallback. name은 `frontmatter.name.replace(/[:\\/<>*?"|]/g, '-')`로 고친다. 길이 상한은 이 파일에 없다. 잘못된 파일은 debug log와 함께 null. 근거: `gemini-cli:packages/core/src/skills/skillLoader.ts`.

### Hermes Agent (343500b3547e)

- `[확인]` frontmatter는 YAML, 실패하면 `key:value` 줄 분리 fallback. 길이·문자 집합 검사는 없다. name은 frontmatter `name` 아니면 부모 dir 이름. 근거: `hermes-agent:agent/skill_utils.py` `parse_frontmatter`.
- `[확인]` dir은 local `~/.hermes/skills/` → `skills.create_dir` → `skills.external_dirs`. project skill(`<root>/.hermes/skills`, `<root>/.agents/skills`, root는 가장 가까운 `.git`)은 `skills.trusted_project_dirs`에 root가 있을 때만 로드하고 같은 이름의 profile skill을 가린다. home 자체는 project로 보지 않고 walk-up은 64로 끊는다. 근거: `hermes-agent:agent/skill_utils.py` `get_all_skills_dirs`, `get_project_skills_dirs`, `find_project_root`, `PROJECT_SKILLS_SUBDIRS`, `_PROJECT_ROOT_MAX_DEPTH`.
- `[확인]` project skill은 hub와 같은 scanner로 검사하고 결과는 `HERMES_HOME/cache/project_skill_scans`에 content hash로 캐시한다. verdict `dangerous`면 index·list·view·slash에서 빼고, scanner가 죽거나 없으면 fail closed로 격리한다. `caution`은 로드한다. 근거: 위 파일 `is_quarantined_project_skill`, `iter_project_skill_files`.
- `[확인]` prompt index는 project가 최우선이고 `[project]`를 붙인다. 그 다음 local, 그리고 external은 이미 잡힌 이름을 건너뛴다. org mirror(`skills/_org/<org_id>`)는 `.active_org` marker로 token gate하고, 개인 skill과 이름이 겹치면 둘 다 표시하고 `skill_view`가 bare name을 거절한다. 카테고리는 이름을 빼지 않고 description만 접을 수 있다. index는 disk snapshot(버전 3, manifest가 SKILL.md·DESCRIPTION.md 서명과 맞을 때만)과 in-process LRU 32로 캐시한다. 근거: `hermes-agent:agent/prompt_builder.py` `_build_skills_system_prompt_inner`, `_label_visible_entries`, `_render_skills_index`, `_SKILLS_PROMPT_CACHE_MAX`.
- `[확인]` prompt는 모델에게 조금이라도 관련되면 `skill_view(name)`로 읽으라고 하고, 문제가 있으면 `skill_manage(action='patch')`로 고치고, 어려운 작업 뒤에는 skill로 저장하라고 권한다. 즉 agent 자가 작성을 제품이 부추긴다. 근거: 위 파일 `_render_skills_index`.
- `[확인]` `skill_view` 조회 이름은 절대 경로, Windows drive, `..`를 거절한다. 보조 파일은 skill dir 안에서만 읽고 `validate_within_dir`로 벗어남을 막는다. 목록 상한은 name 64(잘라서 씀), description 1024(잘라서 `...`). 발견 캐시는 dir mtime 서명 + 30초 TTL이라 SKILL.md 제자리 수정은 TTL 안에서 안 보인다. 읽기 인코딩은 utf-8-sig에 `errors="replace"`. 근거: `hermes-agent:tools/skills_tool.py` `_skill_lookup_path_error`, `_find_all_skills`, `_SKILLS_CACHE_TTL_SECONDS`; `tools/skills_tool_plugin.py` `MAX_NAME_LENGTH`, `MAX_DESCRIPTION_LENGTH`, `_serve_skill_file`.
- `[확인]` `skill_manage` 쓰기는 여러 guard(org mirror, pinned, background review는 읽은 뒤에만 수정, delete는 skills root 밖·root 자체·symlink/junction 거절)를 지나지만, 보안 scan(`skills.guard_agent_created`)은 기본 false다. 주석이 terminal()이 같은 코드를 그대로 실행한다고 인정한다. 근거: `hermes-agent:tools/skill_manager_tool.py` `_guard_agent_created_enabled`; `tools/skill_manager_guards.py` `_validate_delete_target`.

### OpenClaw (37efa0b4a644)

- `[확인]` 이 세션 로더의 검증은 name 64, description 1024(넘으면 warning), `^[a-z0-9-]+$`, 앞뒤 `-` 금지, `--` 금지. description이 없거나 공백뿐일 때만 버리고 나머지 위반은 warning과 함께 로드한다. name이 없으면 부모 dir 이름. 근거: `openclaw:src/skills/loading/session.ts` `validateSkillMetadata`, `loadSkillFromFile`, `MAX_NAME_LENGTH`, `MAX_DESCRIPTION_LENGTH`.
- `[확인]` 기본 순서는 `<agentDir>/skills`(user) 다음 `<cwd>/<CONFIG_DIR_NAME>/skills`(project). 같은 realpath는 건너뛰고 같은 이름은 먼저 온 것이 이기며 collision diagnostic에 winner/loser 경로를 남긴다. dot dir·`node_modules`는 건너뛰고 ignore 규칙을 따른다. 심볼릭 링크는 stat으로 따라가 종류를 판정한다. 근거: 위 파일 `loadSkills`, `loadSkillsFromDirInternal`.
- `[확인]` workspace source plan의 root 순서는 extraDirs → plugin skill → bundled(+ custodian) → workshop → managed(`<CONFIG_DIR>/skills`) → 개인 `~/.agents/skills`(기본 state dir일 때만) → workspace `.agents/skills` → workspace `skills`. 주석은 낮은 쪽에서 높은 쪽으로 발견한다고 적는다. workspace는 조상 repo로 올라가지 않는다. 근거: `openclaw:src/skills/loading/workspace-skill-sources.ts` `resolveWorkspaceSkillSourcePlan`; `loading/workspace-skill-roots.ts` `resolveWorkspaceSkillDirectories`.
- `[확인]` prompt는 XML `<available_skills>`에 name, description, `<location>`을 넣는다. workspace host skill은 `workspace-skill://workspace/<name>/SKILL.md`로 가리고, 그 외는 `filePath` 절대 경로를 그대로 넣는다. 보조 파일은 이 가상 경로를 base dir 안으로 resolve하고 `..`, 절대, NUL을 거절한다. description은 공백을 한 줄로 접고 compact 기본 220자로 자른다. catalog는 기본 150개·18,000자 안에 들고, 넘으면 compact로 줄인 뒤에도 안 되면 skill 수를 줄이고 truncation 경고를 붙인다. 정렬은 `localeCompare(name, "en")`. 근거: `openclaw:src/skills/loading/skill-contract.ts` `formatSkillCatalog`, `compactSkillsPromptForContext`, `COMPACT_DESCRIPTION_MAX_CHARS`; `skills/workspace-skill-read-path.ts` `resolveSkillReadPath`, `resolveWorkspaceSkillSourcePath`; `loading/skill-prompt-limits.ts` `DEFAULT_MAX_SKILLS_IN_PROMPT`, `DEFAULT_MAX_SKILLS_PROMPT_CHARS`.
- `[확인]` 포함 여부는 `skills.entries[<key>].enabled === false`, secret owner 비가용, bundled allowlist, OS·bin·env·config path 요구로 거른다. `user-invocable` 기본 true, `disable-model-invocation` 기본 false. install spec은 brew/node/go/uv/download를 받고 download는 sha256 64 hex를 요구한다. 근거: `openclaw:src/skills/loading/config.ts` `shouldIncludeSkill`; `loading/frontmatter.ts` `resolveSkillInvocationPolicy`, `parseInstallSpec`.
- `[미확인]` 전용 skill 읽기 tool의 bundle 가둠과 스크립트 실행 차단. catalog는 모델에게 location의 파일을 읽으라고만 한다.

### Claude Code (1c229fcd1e1e, CHANGELOG/plugin 예시 근거)

harness 소스가 없다. plugins 아래 `SKILL.md` 예시와 CHANGELOG만 있다. 위 다섯 프로젝트와 같은 종류의 동작 근거로 세지 않는다. name·description frontmatter와 `disable-model-invocation` 관례는 Pi·OpenClaw 로더가 이미 구현한 형식과 같다.

## 비교

숫자는 각 프로젝트가 skill에 실제로 적용하는 값이다. "자름"은 거절하지 않고 일부를 쓴다는 뜻이다.

| | name | description | 발견 깊이 | 같은 이름 | prompt에 넣는 것 | 본문 읽기 | 경로를 prompt에 |
|---|---|---|---|---|---|---|---|
| lophn | 1–64, `[a-z0-9]+(-[a-z0-9]+)*` | 1–1024, 공백 거절 | 폴더 + 바로 아래 bundle | 먼저 온 것, shadowing 보고 | name+description, 이름순 | `skill.read` 전체, 아니면 실패 | 넣지 않음 |
| Codex | 64, 없으면 default name | parser는 빈 값만 거절. prompt에서 1024자 자름 | depth 6 | 버리지 않고 scope rank로 정렬 | budget 안에서 description, 넘으면 통째로 제거 | 512 KiB 페이지, 부분 읽기 성공 | executor는 절대 경로 |
| OpenCode | 규칙 없음 | 규칙 없음 | `**` 재귀 + 조상 walk | 나중 것, 경합 | name+description+절대 경로 | 본문 전체 + 파일 10개 경로 | 절대 경로 |
| Pi | 64, 위반은 warning 후 로드 | 1024, 없으면 거절 | `SKILL.md` dir까지만 | 먼저 온 것, collision 기록 | name+description+절대 경로 | 전용 tool 없음, read/bash | 절대 경로 |
| Gemini CLI | 금지 문자를 `-`로 고침, 길이 없음 | 길이 없음 | 한 단계 | 나중 것, warning | `[미확인]` | 발견 때 본문 전부 메모리 | `[미확인]` |
| Hermes | 64로 자름, 문자 규칙 없음 | 1024로 자름 | 재귀, support dir은 skill로 안 봄 | project > local > external, org 충돌은 둘 다 | 카테고리별 이름+description | `skill_view`, dir 안으로 제한 | 도구 결과에 경로 |
| OpenClaw | 64, 문자 위반은 warning 후 로드 | 1024 넘으면 warning, compact는 220 | 재귀 + ignore | 먼저 온 것, collision 기록 | 150개·18,000자, 넘으면 자름 | workspace host만 가상 경로 | workspace 외에는 절대 경로 |

## lophn에 가져올 것과 버릴 것

요구는 `docs/requirements/lophn-agent/extensions.md` R1–R10, R30이다.

- R1 발견 순서(등록 폴더 → 개인 store → bundled)와 R2 깊이(폴더 자신 + 바로 아래 bundle). 가져올 것: OpenClaw가 workspace를 조상 repo로 올리지 않는 것, Hermes가 support dir(references/templates/assets/scripts)을 skill로 세지 않는 것. 버릴 것: Codex depth 6, OpenCode `**` 재귀와 조상 walk, Pi의 root `.md`도 skill로 세는 것. 깊이를 늘리면 이름 충돌과 스캔 비용이 요구가 정한 자리를 넘는다.
- R3 이름·설명 검증, 잘못된 것은 이유와 함께 제외하고 고치지 않음. 가져올 것: Codex가 description 공백을 거절하는 것, Pi·OpenClaw의 문자 집합 검사 자체. 버릴 것: Codex `repair_frontmatter_scalar_fields`, Gemini의 문자 치환, Pi·OpenClaw의 "warning 남기고 로드", Hermes·Codex의 잘라 쓰기, Codex의 없는 name을 default로 채우는 것. 고쳐서 통과시키면 사람이 쓴 이름과 prompt에 나간 이름이 달라진다.
- R4 같은 이름. 가져올 것: Pi·OpenClaw·Hermes가 이긴 경로와 진 경로를 남기는 것. 버릴 것: OpenCode의 나중 것이 이기는 무제한 동시 스캔(승자가 경합), Codex가 같은 이름을 그냥 같이 두는 것, Gemini의 대소문자 무시 조회. lophn은 먼저 온 것을 고정해야 결과가 재현된다.
- R5 prompt에는 name+description만, 이름순. 가져올 것: 어느 프로젝트도 본문을 prompt에 넣지 않는 것. 버릴 것: 절대 경로를 prompt에 넣는 OpenCode·Pi·OpenClaw(workspace host 제외), Codex의 budget 초과 시 description 전체 삭제. 경로는 모델이 그 위치로 다른 도구를 돌리게 하고, description 삭제는 고른 skill이 사라진 것처럼 보이게 한다.
- R6 `skill.read`는 본문 전체와 보조 파일 제목을 주거나 실패. 부분 성공 없음. 버릴 것: Codex의 512 KiB 페이지와 cursor(부분 읽기가 성공), Codex의 "snapshot은 파일 변경을 감지하지 않는다"는 설계. lophn은 변경된 파일이면 실패해야 한다(R8).
- R7 보조 파일은 제목으로만, `..`·절대·symlink 거절. 가져올 것: Hermes `validate_within_dir`과 traversal 거절, OpenClaw `resolveWorkspaceSkillSourcePath`의 `..`·절대·NUL 거절. 버릴 것: OpenCode가 base dir 절대 경로와 샘플 파일 절대 경로를 주고 일반 read tool에 맡기는 것, Pi가 bash로 읽게 하는 것.
- R8 선택과 hash는 run 시작(RunBasis)에 고정, 바뀐 파일은 읽기 실패. 가져올 것: Hermes의 content-hash scan cache 발상만. 버릴 것: Hermes 발견 캐시 30초 TTL(제자리 수정이 안 보임), Codex의 만료 없는 snapshot, Gemini의 발견 시점 본문 전체 메모리 적재. 고정은 캐시가 아니라 run 경계여야 한다.
- R9 원격 설치·자동 작성 없음. 버릴 것: OpenCode `cfg.skills.urls`의 `discovery.pull`, OpenClaw install spec(brew/node/go/uv/download), Hermes가 prompt에서 `skill_manage`로 고치고 저장하라고 하는 것. 쓸 자리와 승인 주체를 제품이 정하지 않은 채 모델이 skill을 만들게 된다.
- R10 스크립트 실행 없음. 버릴 것: Pi의 bash 안내, Hermes 주석이 인정한 대로 terminal이 같은 코드를 실행하는 것. skill 본문은 읽을 데이터여야 한다.
- R30 선택은 정확한 이름만, 기본 0, wildcard 없음. 가져올 것: Hermes `skills.disabled`와 OpenClaw `skills.entries[].enabled`라는 명시적 이름 목록의 형태. 버릴 것: Codex `allow_implicit_invocation` 기본 true, Pi·OpenClaw `disable-model-invocation` 기본 허용. 기본이 전체 허용이면 선택이 없다.

## 구현 메모

### 자료 구조

`SkillEntry`는 name, description, bundle 경로, content hash, scope(등록 폴더 순번 / personal / bundled), 보조 파일 제목 목록. `SkillReadResult` 오류는 `not_selected`, `missing`, `changed`, `invalid_path`, `invalid_format` 그대로 쓴다(`docs/domain-model/lophn-agent/extensions.md`). 무효 skill은 별도 목록에 `{path, reason}`로만 남기고 후보에 넣지 않는다.

### 상태 전이

1. run 시작. scope 순서대로 스캔하고 폴더 자신과 바로 아래 bundle만 본다.
2. frontmatter 검증. 실패는 reason과 함께 제외. 수리하지 않는다.
3. 같은 이름은 먼저 온 것을 남기고 shadowing을 기록. scope 안에서는 bundle 이름 사전순.
4. 선택된 이름만 남긴다. 각 본문 hash를 RunBasis에 고정한다.
5. prompt에는 남은 것의 name+description만, 이름순.
6. `skill.read`. 선택되지 않았거나 hash가 다르면 실패. 보조 파일은 제목이 목록에 있고 경로 검사가 통과할 때만.

### 기본값

| 항목 | 값 |
|---|---|
| name | `[a-z0-9]+(-[a-z0-9]+)*`, 1–64자 |
| description | 공백 아님, 1–1024자 |
| 발견 깊이 | 폴더 자신 + 한 단계 |
| 선택 기본 | 빈 목록 |
| prompt 정렬 | name 오름차순 |
| 본문 읽기 | 전체 또는 실패, 페이지 없음 |

### 오류 분류

| 상황 | 결과 | 고르지 말 것 |
|---|---|---|
| name·description 형식 위반 | 제외 + reason | 고쳐서 통과, 잘라 쓰기 |
| 같은 이름 | 첫 번째 유지, shadowing 기록 | 나중 것 우선, 둘 다 노출 |
| 선택 안 된 이름 읽기 | `not_selected` | 그 자리에서 새로 찾기 |
| hash 불일치 | `changed` | 새 내용으로 계속 |
| `..`, 절대, symlink | `invalid_path` | 정규화해서 허용 |
| 파일 일부만 읽힘 | 실패 | cursor로 부분 성공 |

### 테스트 경계

- 깊이 2의 `SKILL.md`는 무시한다.
- name `A`, `-a`, `a--b`, 65자는 제외하고 reason이 있다.
- description 공백, 1025자는 제외한다.
- YAML이 깨진 frontmatter는 고치지 않고 제외한다.
- 같은 이름이 등록 폴더와 personal에 있으면 등록 폴더 것이 이기고 기록이 남는다.
- 선택 목록이 비면 prompt skill 절이 비다.
- run 중 파일을 고치면 `skill.read`가 `changed`다.
- 보조 파일 `../x`, 절대 경로, symlink는 `invalid_path`다.
- 원격 URL과 agent의 skill 작성 요청은 이 경로에 도구가 없다.
