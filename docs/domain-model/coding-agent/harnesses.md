---
type: domain-model
concerns: [coding-agent/harnesses]
---
# coding-agent/harnesses

HarnessDefinition 배포 값, HarnessDetection·HarnessIntegrationObservation derived 관측과 LocalIntegrationReceipt local ownership 기록을 정의한다. entity ID와 새 ledger 표는 없다.

## HarnessDefinition (값)

서명된 제품 release에 들어 있는 불변 catalog 값이다. adapter 함수는 구현 참조이며 serialized 함수 본문이 아니다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `harness_id` | stable string | 아니오 | `claude, codex, opencode, gemini, hermes, pi, openclaw`; revision 안 unique | 제품 key, entity ID 아님 |
| `label` | string | 아니오 | 제품 표시 이름 | |
| `catalog_revision`, `adapter_revision` | release/hash 참조 | 아니오 | 검증된 배포 자원 | 관측·설치·실행 해석 기준 |
| `version_policy` | tested ranges·minimum·unknown policy | 아니오 | `supported/unsupported/unverified`를 구별 | version-sensitive capability 기준 |
| `environments` | runtime support 값[] | 아니오 | 지금 native host만 실행; WSL·remote 미지원 표시 | OS별 검증 범위 |
| `detection` | DetectionSpec | 아니오 | command names·aliases·필수 dependencies·bounded fallback resolver | filesystem lookup |
| `version_probe`, `auth_probe` | ProbeSpec | 예 | 없는 probe의 capability는 unverified/not_required로 명시 | 발견과 독립 |
| `config_targets`, `skill_targets`, `instructions`, `hooks` | target spec[] | 아니오 | effective profile root·user/app 범위·version별 해석 | 설치 계약 |
| `execution` | ExecutionSpec | 아니오 | → coding-agent/sessions; 지금 PTY TUI만 실행 허용 | 첫 prompt·readiness·resume·session ID·status evidence |

### target·probe 계약

- `ProbeSpec = {adapter_method, timeout_ms, output_limit_bytes, classifier, side_effects, tested_versions}`. version은 5,000ms·65,536 bytes, auth 진단은 5,000ms·65,536 bytes 상한이다. filesystem 감지에서 process·auth probe를 자동 실행하지 않고 사람이 선택한 별도 검사 level에서 실행한다. timeout/nonzero를 성공으로 판정하지 않는다. session을 여는 model catalog probe는 이번 범위에 없다.
- `DetectionSpec`의 fallback은 native home의 `.local/bin`, `.bun/bin`, npm/pnpm/Yarn의 정한 bin, Volta/asdf/fnm/mise의 정한 shim/bin, nvm의 alias가 가리키는 bin에 한정한다. 설치 트리 전체·home 전체를 순회하지 않는다. alias cycle/hop guard는 8회다. shell RC를 평가해 PATH를 확장하지 않는다.
- `ConfigTargetSpec = {scope_kind, root_resolver, path_or_api, format, owned_key, merge_policy, loading_probe}`. JSON/TOML/YAML·persistent file·runtime injection은 별도 capability이며 이번 설치는 아래 검증된 persistent target만 사용한다.
- `SkillTargetSpec`은 root resolver·copy/alias topology·format·distribution hash·discovery probe를 가진다. physical root가 같은 사본은 realpath로 dedupe한다. 외부 symlink를 따라 쓰지 않는다.
- `InstructionSpec`은 AGENTS.md 정본·얇은 import/reference·override/workspace 검사·marker를 가진다. 관리 marker 없는 기존 파일은 무변경이다. 새 템플릿 first-create는 별도 명시 plan이다.
- `HookSpec`은 summary/status 목적, config fragment/plugin/extension 방식, owned identity, 최소 version, evidence normalizer를 가진다. 미확인 version은 검증한 conservative subset만 쓰고 subset도 없으면 조각 안내다. 상태 hook 설치는 summary hook 지원을 뜻하지 않는다.

### 일곱 adapter의 위치·형식·merge

아래는 lophn의 검증 대상 계약이다. evergreen upstream schema가 아니다. 실제 profile/env override와 XDG/effective home으로 resolve하고 지원 version이 맞지 않으면 조각 안내·unknown 관측으로 끝낸다.

| harness | MCP target·format | skill root user / app | 지침·merge·loading 제약 |
|---|---|---|---|
| Claude Code | user 등록 또는 app `.mcp.json`, JSON `mcpServers.lophn` command/args/env | `~/.claude/skills` / `.claude/skills` | `CLAUDE.md` 관리 구간 `@AGENTS.md`; 기존 import·permission 보존. `.claude/settings.local.json`의 lophn SessionStart만 summary용 설치 |
| Codex | 사람이 Codex를 고르면 effective `CODEX_HOME`(기본 `~/.codex`)/`config.toml`의 `[mcp_servers.lophn]`만 receipt와 함께 설치 | `~/.agents/skills` / `.agents/skills` | `AGENTS.md`, 가까운 `AGENTS.override.md` 검사. 앱 MCP/TOML 자동 생성 없음. 사람이 고친 hash는 무변경·충돌 |
| OpenCode | XDG/user `opencode.json` 또는 app `opencode.json`, JSON `mcp.lophn` type=local·command 배열·environment | `~/.config/opencode/skills` / `.opencode/skills` | `AGENTS.md`; 기존 rules와 config precedence 보존 |
| Gemini CLI | `~/.gemini/settings.json` 또는 app `.gemini/settings.json`, JSON `mcpServers.lophn` | `~/.gemini/skills` / `.gemini/skills` | 기존 `context.fileName` 목록에 AGENTS.md 참조만 추가; trust=true·skill consent 자동 확대 없음 |
| Hermes | `$HERMES_HOME/config.yaml`(기본 `~/.hermes/config.yaml`), YAML `mcp_servers.lophn` command/args/env/cwd | `$HERMES_HOME/skills` / `.hermes/skills` | `AGENTS.md`; profile home·workspace 확인; `hermes skills trust`는 사람이 결정 |
| pi | 미리 설치된 exact MCP adapter의 `.mcp.json` 또는 `~/.pi/agent/mcp-adapter.json`, JSON `mcpServers.lophn`, `directTools:true` | `~/.pi/agent/skills` / `.pi/skills` | `AGENTS.md`; script/proxy 필수 adapter는 사용하지 않음; native MCP와 adapter 이중 시작 금지 |
| OpenClaw | 사람 config의 `mcp.servers.lophn` stdio command/args/cwd 조각, 지원 version/client 검사 | `~/.openclaw/skills` / 선택 agent workspace의 `skills` | workspace AGENTS.md와 app root 차이 검사; workspace 변경·본문 복제 금지; session 소유 stdio 미확인은 unknown·CLI fallback |

상태 evidence target은 version 검증한 Claude effective config의 settings hooks, Codex effective CODEX_HOME의 hooks, Gemini settings hooks, Hermes home의 YAML-enabled Python plugin, OpenCode effective XDG plugin, pi effective agent dir의 extension으로 구별한다. 이 조사에서 OpenClaw 상태 hook은 미검증이다. catalog에 검증 version이 없는 status target은 설치하지 않고 unknown으로 둔다. Codex 사용자 config 설치는 사람이 Codex를 고른 MCP 항목과 receipt로 한정하며 status hook을 이유로 다른 TOML을 고치지 않는다.

## HarnessDetection (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `harness_id`, `catalog_revision` | catalog 참조 | 아니오 | 같은 정의 | |
| `environment` | `{kind:host|wsl|remote, identity}` | 아니오 | native machine identity / distro / remote identity 구별; 지금 host만 수집 | 관측 key |
| `profile_id` | local profile key | 예 | effective executable/env names/config roots identity; secret 값 제외 | explicit profile override 구별 |
| `observed_at` | UTC 시각 | 아니오 | 실제 검사 시각 | |
| `discovery` | `unobserved/detected/absent/unknown/error` | 아니오 | absent는 모든 정한 lookup 완료·후보 없음만 | |
| `candidates` | `{path, source, executable_result}[]` | 아니오 | PATH/fallback provenance; native absolute path | |
| `selected_executable` | absolute path | 예 | detected이면 필수 | guest path를 host path로 치환 금지 |
| `version` | `{result:verified/unknown/error, value?, reason?}` | 아니오 | parsed version 성공만 verified | |
| `auth` | `{result:verified/not_verified/unknown/error/unverified_capability, evidence?, reason?}` | 아니오 | auth 파일 존재만으로 verified 금지; 원문 제외 | |
| `probe_results` | 안전한 구조화 결과[] | 아니오 | classifier·timeout·side effects; raw stdout 없음 | |
| `freshness` | `fresh/stale` | 아니오 | env/profile/catalog 변경은 stale | 자동 refresh 계기 아님 |

## HarnessIntegrationObservation (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `target` | IntegrationTarget | 아니오 | environment/profile/harness/scope/app realpath 고정 | |
| `connection` | `cac` 참조 | 예 | credential 연결 component에만 필요 | → coding-agent/connection |
| `catalog_revision`, `adapter_revision`, `observed_at` | revision·UTC 시각 | 아니오 | 실제 inspection 기준 | |
| `components` | ComponentObservation[] | 아니오 | cli-wrapper/mcp/skill/guide/hook resource별 | |
| `loading_checks` | `{stage,result,reason}[]` | 아니오 | 아래 네 stage 각각 한 번 | 실제 loading |

`IntegrationTarget = {environment, profile_id?, harness_id, scope_kind:user|app, app?, app_realpath?}`. user이면 app 값 둘 다 null, app이면 둘 다 필수다. resolved effective config root를 plan/receipt identity에 묶는다.

`ComponentObservation = {kind, resource_identity, expected_version/hash, observed_version/hash?, effective_target, ownership:owned/unowned/unknown, state:missing/current/outdated/modified/conflict/unknown/error, receipt_ref?, reason, observed_at}`. CLI binary·wrapper·MCP adapter·skill 배포·지침·hook version은 각각 비교한다.

loading stage는 `mcp_initialize/tool_discovery/skill_discovery/app_guide_loading`, result는 `success/failure/unknown`이다. failure/unknown에는 안전한 이유가 필수다. 앱 없는 target의 앱 안내는 unknown·not_applicable 이유다. current 파일이 loading success를 뜻하지 않는다.

## LocalIntegrationReceipt (값)

ledger 정본이 아닌 local durable 설치 metadata다. receipt·recovery journal은 설치 worker만 쓰며 운영 backup에 token을 포함시키지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `schema_version` | positive integer | 아니오 | 현재 1 | 검증·migration |
| `target`, `effective_roots` | IntegrationTarget·resolved roots | 아니오 | realpath·profile 고정 | ownership 범위 |
| `connection` | `cac` 참조 | 예 | 원문 대신 안정된 참조 | |
| `catalog_revision`, `adapter_revision`, `distribution_version/hash` | 배포 참조 | 아니오 | 실제 쓴 배포 | |
| `resources` | OwnedResourceReceipt[] | 아니오 | 실제 commit한 resource만 | |
| `operation_id`, `written_at` | local key·UTC 시각 | 아니오 | retry/recovery 상관관계 | ledger command ID와 별개 |

`OwnedResourceReceipt = {canonical_identity, path, owned_key/marker?, topology, last_written_hash, owned_fragment_digest?, previous_distribution?}`. fragment merge는 현재 owned digest 일치와 작업 중 전체 파일 hash CAS를 모두 검사한다. 다른 user key 편집은 보존한 채 merge할 수 있으나 lophn fragment 편집은 conflict다. 제거는 owned fragment만 제거하고 주변 파일은 보존한다.

### 불변 조건

- receipt 존재·이름 일치만으로 ownership·current·loading success를 인정하지 않는다.
- current bytes/fragment digest가 last-written digest와 다르면 replace/remove 금지다. broken config·외부 symlink·unowned 동명 resource도 금지다.
- 파일별 same-directory temp/fsync/rename과 hash-CAS만 보장한다. multi-file 원자성은 없다.
- 실제 파일 commit과 receipt 저장이 갈라지면 partial+recovery다. journal의 이전/작성 hash를 다시 검사해 receipt만 복구하거나 안전하게 보존하고, 다음 갱신은 복구 전 거절한다.
- token·사용자 config 원문·secret env dump·전체 transcript를 receipt·journal·diagnostic에 넣지 않는다.

## 상태와 전이

| 대상 | 전 | 후 | 주체·조건 |
|---|---|---|---|
| catalog | revision A | revision B | 제품 배포 검증; 기존 관측의 사용 revision 보존 |
| detection | unobserved/stale | detected/absent/unknown/error | 최초 lookup 또는 사람 refresh 결과; 늦은 generation 결과 무시 |
| freshness | fresh | stale | env/profile/catalog 변경; 재감지는 사람 요청만 |
| component | missing/outdated | current | owned 파일 commit·receipt 성공 뒤 실제 inspection |
| component | current/outdated | modified | last-written digest 불일치 |
| component | any | conflict/unknown/error | 동명 비관리·stale plan / 증거 없음 / inspection 실패 |
| receipt | 없음/이전 | 기록/갱신/제거 | 실제 owned resource 결과와 일치; 실패는 journal recovery |

설치 제거·후보 disable·connection revoke·process 종료는 서로 다른 동작이다. disable은 선택/launcher 후보 제외만이며 uninstall이나 revoke가 아니다.

## 관계와 ledger 표

catalog는 제품 자원, 관측은 derived memory/disposable cache, receipt·journal은 `~/.lophn/integrations/` 아래 private local metadata다. 새 ledger 표는 없다. default/enabled/profile 선택 저장은 → platform/settings이며 secret 값은 넣지 않는다. connection 한 개는 여러 target receipt에 참조될 수 있으나 제품 이름이 scope/actor를 결정하지 않는다.

## command

아래는 local operation이며 core ledger command가 아니다. credential 생성·회수만 → coding-agent/connection의 command를 사용한다.

| operation | actor | 입력·비교 기준 | 결과·거절 |
|---|---|---|---|
| `harness.catalog/read` | 허용 reader | 검증 배포 revision | catalog; unavailable |
| `harness.detect/refresh` | 사람 | native env/profile·lookup budget; 최초 또는 명시 refresh | observation; invalid_target/timeout/probe_failed |
| `integration.inspect/doctor` | 사람 | exact target·실제 파일·receipt·adapter revision | components·네 loading stage; invalid_config/unknown_capability |
| `integration.plan` | 사람 | exact target/components·distribution·current hash | 안전한 diff/plan; conflict/unsupported/unverified |
| `integration.install/update/remove` | 사람 installer | plan·operation key·target/adapter·전체 hash/owned digest 재검사 | resource별 결과·receipt; conflict/forbidden/io_failed |

## event

derived 갱신·설치 결과는 local notification이며 ledger event를 만들지 않는다. token 없이 target/revision/관측 시각/resource별 outcome만 보낸다. settings 변경과 connection 생성·회수는 각각 소유 concern event를 참조한다.

## 정책

- **cache.** env/profile/catalog identity와 generation으로 invalidate하며 고정 TTL은 두지 않는다. deadline은 probe 제한이지 TTL이 아니다. stale 값은 시각과 함께 유지하며 자동 refresh하지 않는다.
- **선택.** 명시 ticket 선택 → 저장 default 순서다. 비었으면 enabled·detected·검증된 TUI 및 연결 사용 가능 후보 하나를 제안, 여러 개면 chooser, 없으면 연결 안내다. 저장 선택이 unavailable이면 보존하고 다른 제품으로 fallback하지 않는다.
- **권한.** 설치는 사람 선택의 exact target만 쓴다. coding credential에 config dump·임의 경로 설치·trust 확대 권한을 주지 않는다.
