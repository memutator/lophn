---
type: research
concerns: [coding-agent/harnesses, coding-agent/sessions, coding-agent/connection]
---
# Harness catalog·detection·integration 조사

## 0. 조사 범위와 근거

조사일: 2026-10-04.

- Orca revision: `b601b98644656aeaa7b1c17775d0611a0d5fd06b`.
- Paseo revision: `b5e9747e2a59b694a3e4d827202d686c2e4612c9`.
- 경로는 `orca:`(stablyai/orca), `paseo:`(getpaseo/paseo) 저장소의 위 revision 기준이다.
- Orca/Paseo의 소스만 조사했다. `node_modules`는 보지 않았다.
- 이 컴퓨터에 실제 설치된 harness inventory를 실행 검사하지 않았다. 아래 detection은 두 프로그램이 감지하는 방법이다.
- `[확인]`은 해당 revision의 코드 또는 lophn 현재 문서에서 확인한 사실이다. `[제안]`은 lophn 설계안이다. `[미확인]`은 이번 조사에서 확인하지 못한 범위이며 제품의 기능 부재를 뜻하지 않는다.
- 두 프로그램이 특정 기능을 구현하지 않은 것과 harness 자체가 그 기능을 지원하지 않는 것은 다르다.

근거 번호는 아래 absolute path를 가리킨다. line range는 조사 revision 기준이다.

### Orca 근거

| 번호 | absolute path·확인 위치 |
|---|---|
| O1 | `orca:src/shared/tui-agent-config-types.ts` 1–56: `TuiAgentConfig`, prompt·trust·runtime 타입 |
| O2 | `orca:src/shared/tui-agent-config.ts` 12–23, 27–34, 63–71, 91–102, 119–126, 155–158, 262–272: config 정규화와 일곱 제품 값 |
| O3 | `orca:src/shared/tui-agent-detection-commands.ts` 1–81: detection command builder·required commands·runtime 제외 |
| O4 | `orca:src/main/preflight/agent-detection.ts` 145–253: detection·PATH hydration·refresh·remote |
| O5 | `orca:src/main/ipc/preflight-command-exec.ts` 79–131: version availability probe와 filesystem PATH lookup의 구분 |
| O6 | `orca:src/main/ipc/preflight-wsl-agent-detection.ts` 1–93: WSL lookup·sentinel·Windows mount 제외·10초 timeout |
| O7 | `orca:src/shared/local-agent-install-dir-detection.ts`: `detectCommandsInInstallDirs`; `orca:src/shared/node-cli-command-resolution.ts` 1–140: candidate executable·bounded 설치 디렉터리 |
| O8 | `orca:src/renderer/src/store/slices/local-detected-agent-state.ts` 16–143; `orca:src/renderer/src/store/slices/runtime-detected-agents.ts` 9–150: cache·inflight·refresh |
| O9 | `orca:src/shared/tui-agent-selection.ts` 6–107; `orca:src/shared/global-settings-types.ts` 351–353, 408, 424: preference·disable·override |
| O10 | `orca:src/shared/skill-install-providers.ts` 8–101; `orca:src/main/skills/skill-provider-destinations.ts` 23–60: managed package placement catalog |
| O11 | `orca:src/shared/skill-install-contract.ts`: request·preview·placement·result schema; `orca:src/main/skills/skill-install-provenance.ts` 9–26과 receipt 읽기·쓰기: ownership receipt |
| O12 | `orca:src/main/skills/skill-install-transaction.ts`; `orca:src/main/skills/skill-remove-transaction.ts`: preview conflict·lock·staging·receipt·recovery·remove |
| O13 | `orca:src/shared/skills-cli-agent-keys.ts` 14–95; `orca:src/shared/agent-feature-install-commands.ts` 3–83; `orca:src/cli/handlers/skills.ts` 1–224: bundled feature skills를 community CLI로 설치 |
| O14 | `orca:src/shared/mcp-config.ts`: config candidate·inspection schema |
| O15 | `orca:src/main/agent-hooks/managed-agent-hook-registry.ts`: managed hook service registry; `orca:src/main/claude/claude-hook-event-versions.ts`: hook event별 최소 version; `orca:src/main/claude/hook-service.ts` 161–195, 297–328: managed merge·remove |
| O16 | `orca:src/main/codex/codex-hook-service-implementation.ts` 156–271: 실제 runtime CODEX_HOME에 install·refresh; `orca:src/main/gemini/hook-service.ts` 152–203, 277–307: JSON hook merge·remove |
| O17 | `orca:src/main/hermes/hermes-home-filesystem.ts` 16–34; `orca:src/main/hermes/hook-service.ts` 86–113, 153–182: plugin·YAML enablement |
| O18 | `orca:src/main/opencode/hook-service.ts` 1–100, 155–258: XDG plugin·overlay; `orca:src/main/pi/titlebar-extension-service.ts` 141–215: effective pi agent dirの extensions |
| O19 | `orca:src/shared/agent-session-resume.ts` 6–47, 195–285; `orca:src/shared/agent-resume-argv.ts` 6–40: provider session metadata·resume argv |
| O20 | `orca:src/shared/agent-status-types.ts`: normalized status·evidence; `orca:src/shared/tui-agent-startup.ts` 118–177: prompt injection builders |
| O21 | `orca:src/main/cli/cli-installer.ts` 31–203: own CLI inspection·install·remove·unowned conflict |

### Paseo 근거

| 번호 | absolute path·확인 위치 |
|---|---|
| P1 | `paseo:packages/protocol/src/provider-manifest.ts` 1–40, 197–258: provider definitions·builtin catalog |
| P2 | `paseo:packages/protocol/src/provider-config.ts` 5–139: command/runtime settings·override·custom ACP |
| P3 | `paseo:packages/server/src/server/agent/provider-registry.ts` 68–159과 factories: configured definitions·execution/tool contracts |
| P4 | `paseo:packages/server/src/executable-resolution/executable-resolution.ts` 1–168: which lookup·probe classifier |
| P5 | `paseo:packages/server/src/server/agent/providers/claude/agent.ts` 1655–1780, 3334–3343: availability·version·auth·SDK MCP/resume; `paseo:packages/server/src/server/agent/providers/pi/agent.ts` 2673–2705: availability·auth.json diagnostic |
| P6 | `paseo:packages/server/src/server/agent/providers/opencode/runtime-client.ts` 24–109: V1/V2 selector·minimum V2 version |
| P7 | `paseo:packages/server/src/server/agent/provider-snapshot-manager.ts` 110–369; `paseo:packages/server/src/server/session/provider/provider-catalog-session.ts` 433–450: snapshot cache·refresh |
| P8 | `paseo:packages/app/src/create-agent-preferences/preferences.ts` 6–21, 93; `paseo:packages/app/src/provider-selection/resolve-agent-form.ts` 242–272: explicit/saved provider 선택 |
| P9 | `paseo:packages/server/src/server/agent/agent-sdk-types.ts` 28–76, 168–189, 405–491, 587–796: MCP·capability·session·event·permission common contract |
| P10 | `paseo:packages/server/src/server/agent/runtime-mcp-config.ts` 1–70: runtime own MCP injection |
| P11 | `paseo:packages/server/src/server/agent/providers/codex/agent.ts` 5329–5343, 7212–7235: MCP translation·app-server launch; `paseo:packages/server/src/server/agent/providers/opencode/opencode-agent.ts` 5147–5182: V1 MCP API registration; `paseo:packages/server/src/server/agent/providers/pi/runtime.ts` 116–142: RPC/session/MCP/extension argv |
| P12 | `paseo:packages/server/src/terminal/agent-hooks/agent-hook-installer.ts` 6–229; `paseo:packages/server/src/terminal/agent-hooks/provider-registry.ts` 22–66: hook strategy·path·merge·remove |
| P13 | `paseo:packages/server/src/terminal/agent-hooks/claude/claude-settings.ts` 19–113; `paseo:packages/server/src/terminal/agent-hooks/codex/codex-settings.ts` 25–138; `paseo:packages/server/src/terminal/agent-hooks/opencode/opencode-plugin.ts`: marked hook·status normalization |
| P14 | `paseo:packages/server/src/server/orchestration-skills/internal/paths.ts` 17–23; `paseo:packages/server/src/server/orchestration-skills/internal/operations.ts` 13–41, 160–269: targets·status·selection·operations |
| P15 | `paseo:packages/server/src/server/orchestration-skills/internal/sync.ts` 113–187; `paseo:packages/server/src/server/orchestration-skills/internal/controller.ts` 58–170; `paseo:packages/server/src/server/orchestration-skills/internal/selection-store.ts`: manifest·update/remove·queue·recovery·selection |
| P16 | `paseo:packages/desktop/src/integrations/cli-install/paths.ts`; `paseo:packages/desktop/src/integrations/cli-install/install.ts` 21–70: own CLI shim·PATH·status |
| P17 | `paseo:packages/protocol/src/agent-lifecycle.ts` 1–9: lifecycle status |

## 1. Orca

### 1.1 Catalog는 하나의 integration schema가 아니다

[확인] `TuiAgentConfig`는 detection과 TUI launch 계약이다(O1–O3). 주요 필드는 다음과 같다.

| 실제 필드 | 타입/역할 |
|---|---|
| `detectCmd`, `detectCmdAliases?` | command 이름과 detection alias |
| `detectRequiredCommands?` | 함께 발견되어야 하는 command |
| `detectUnsupportedRuntimes?` | `NodeJS.Platform \| 'wsl'` 제외 목록 |
| `launchCmd`, `launchCmdByPlatform?` | 기본/플랫폼별 launch command |
| `expectedProcess` | launch 뒤 기대하는 process 이름 |
| `promptInjectionMode` | `argv`, `flag-prompt`, `flag-prompt-interactive`, `flag-interactive`, `hermes-query`, `stdin-after-start` |
| `argvPromptSeparator?`, `draftPromptFlag?`, `draftPromptEnvVar?` | prompt 전달 계약 |
| `preflightTrust?` | 제품별 trust preflight 선택 |
| `draftPasteReadySignal?`, `draftPasteReadyTimeoutMs?` | TUI readiness 관측·deadline |
| newline/enter encoding 필드 | Windows/terminal 입력 호환성 |

`resolveTuiAgentConfig`는 생략된 `launchCmd`와 `expectedProcess`를 `detectCmd`로 채운다. 이름이 같다는 가정이 아니라 정규화 규칙이다.

`TuiAgentDetectionCommand`는 `{id, cmd, reportVersion?, requiredCommands?, unsupportedRuntimes?}`다. `KNOWN_TUI_AGENT_DETECTION_COMMANDS` builder는 `reportVersion`을 설정하지 않는다. 필드가 있다고 기본 detection이 version을 읽는 것은 아니다.

[확인] 별도 catalog들이 존재한다.

- TUI detection/launch registry.
- 자체 managed package용 `SkillInstallProviderDefinition`.
- community `skills` CLI용 agent alias mapping.
- managed hook registry와 OpenCode/pi의 별도 plugin/extension 경로.
- resumable agent registry.

따라서 `supportedHarnesses: string[]` 하나로 전체 지원을 표현하면 정보가 틀린다. `claude-agent-teams`도 별도 binary 제품이 아니라 `orca` alias + `claude` dependency를 요구하는 launch mode이며 win32/WSL을 제외한다(O2–O3).

### 1.2 Detection·version·auth·cache

[확인] `detectInstalledAgents(context?): Promise<string[]>`의 native 경로는 filesystem PATH lookup을 병렬 실행하고, 놓친 command는 알려진 설치 디렉터리에서 bulk fallback한다(O4–O7).

- native PATH lookup은 `where`/`which` subprocess가 아니라 파일 lookup이다.
- POSIX executable permission과 Windows `.cmd/.exe/.bat` 등의 candidate 이름을 처리한다.
- fallback 후보에는 Volta/asdf/fnm/mise, user local bin, npm/pnpm/Yarn, Bun, nvm alias 등이 있다. nvm alias는 hop/cycle guard가 있다.
- `detectInstalledAgentsWithShellPathHydration`은 shell PATH hydration을 감싼다.
- `refreshAgents`는 hydration을 강제하고 다시 감지하며 `agents, addedPathSegments, shellHydrationOk, pathSource, pathFailureReason`을 반환한다.
- WSL은 guest login PATH lookup을 사용한다. Windows mount directory를 제외하여 Windows binary가 guest binary를 shadow하지 않게 한다. distro별 shell process, sentinel, absolute POSIX path를 사용한다.
- WSL timeout/nonzero/catch는 빈 Set으로 축약된다. 빈 결과가 반드시 설치 부재는 아니다.
- remote는 relay RPC의 `preflight.detectAgents`를 사용한다. disconnected의 빈 결과도 설치 부재와 구분할 필요가 있다.

기본 결과는 ID 배열뿐이다. executable absolute path, version, auth, probe error를 공통 결과로 돌려주지 않는다. 같은 파일군의 `isCommandAvailable`은 별도 `--version` probe다. git/gh/glab auth preflight도 coding harness auth가 아니다.

[확인] detection cache에 명시적인 TTL은 확인하지 못했다(O8).

- local: contextKey별 결과와 inflight promise를 저장한다. 성공한 `[]`도 cache로 재사용한다. 실패한 `[]`는 failed 표시로 다음 ensure에서 재시도할 수 있다.
- runtime environment: environmentId별 nonempty 결과만 ensure에서 바로 재사용하며 empty 결과는 다시 감지한다. refresh는 별도 RPC, 구형 server의 method_not_found만 detect fallback한다.
- generation/promise identity로 늦은 결과를 차단한다.

모델 catalog의 TTL 또는 다른 preflight cache 시간을 harness detection TTL로 가져오면 안 된다.

### 1.3 사용자 선택·disable·default

[확인] `GlobalSettings`는 다음을 가진다(O9).

- `defaultTuiAgent: TuiAgent | 'blank' | null`.
- `disabledTuiAgents: TuiAgent[]`.
- `agentCmdOverrides: Partial<Record<TuiAgent, string>>`.
- `agentStatusHooksEnabled: boolean`.

`pickTuiAgent`는 blank면 null, preferred가 detected+enabled면 preferred, 아니면 `TUI_AGENT_AUTO_PICK_ORDER`의 첫 detected+enabled, 없으면 null이다. Claude가 첫 fallback priority이지만 무조건 Claude default는 아니다. fresh disabled 목록은 비어 있다. disable과 detection은 독립이며 disable은 OS에서 그 제품을 실행하지 못하게 하는 보안 기능이 아니다.

### 1.4 Own CLI·skill·MCP·instruction·hook 설치

#### Own CLI

[확인] `CliInstaller`는 platform별 symlink 또는 Windows wrapper/PATH 등록을 수행한다(O21). status에서 launcher와 실제 target, PATH를 따로 검사하고 `conflict`면 다른 프로그램의 command replace/remove를 거부한다. packaged Windows의 bundled command는 파일 대신 PATH만 등록하는 경우가 있다. AppImage payload revision과 stale registration도 구별한다.

이는 Orca 자신의 CLI 등록이다. 외부 harness를 설치하는 기능으로 해석하지 않는다.

#### 자체 managed skill package

[확인] `SkillInstallProviderDefinition`은 `id, displayName, globalSegments, workspaceSegments`를 갖는다. null segments는 canonical `.agents/skills`를 뜻한다(O10).

이 registry의 provider IDs는 codex/claude/cursor/gemini/droid/continue/trae/grok/aug/muse/zcode다. requested 일곱 중 Claude/Codex/Gemini가 이 경로의 table에 직접 들어 있다. 나머지의 누락을 Orca 전체 skill 미지원이라고 해석하면 틀린다.

`SkillInstallRequest`는 Zod infer 타입이다(O11).

- package identity: `packageId, versionId, packageDigest, archiveSha256, compressedBytes`; hash는 lower 64 hex, compressed archive 상한은 40MiB.
- ingress: `download-grant | staged-upload | local-file`.
- destination: global 또는 workspace. global은 host/WSL/SSH execution target 등을 구별하고, workspace는 worktreeId/folderWorkspaceId 중 정확히 하나다.
- `providers?`, `operationId`, `conflictResolution?`.
- preview currentState: `missing | unchanged | clean-update | modified | unowned | external-link | name-collision`.
- topology: `canonical-copy | provider-alias | independent-copy`.
- result status: `installed | updated | unchanged | removed | conflict | partial | cancelled | failed`.

`SkillInstallReceiptV1`의 실제 필드에는 schemaVersion/packageId/versionId/packageDigest/bundleDigest/archiveSha256/scope/destinationIdentity/canonicalPath/placements/providers/previousVersionId/installedAt/hostIdentity/fileModes/wslDistro가 있다. receipt는 canonical path identity를 hash하여 별도 state directory에 저장하고 private permissions/temp/sync/rename을 사용한다.

[확인] transaction은 lock, recovery, preview, staging/backup journal, stale-preview 재검사, digest verification, receipt publish를 사용한다(O12). remove는 receipt 없는 unowned, external symlink, nondirectory name collision, 사용자 변경을 구별하고 modified placement는 그대로 지울 수 없게 한다. receipt status observation의 실패가 missing으로 축약되는 부분은 lophn에서 unknown/error와 분리하는 편이 낫다.

#### Bundled feature skills/community CLI

[확인] 별도 경로는 `npx skills add https://github.com/stablyai/orca ...`다(O13). `orca-cli`, orchestration 등 feature skill 이름을 전달하며 global이 기본이다.

requested 일곱의 실제 alias는 다음과 같다.

| Orca ID | community skills CLI key |
|---|---|
| claude | claude-code |
| codex | codex |
| opencode | opencode |
| gemini | gemini-cli |
| hermes | hermes-agent |
| pi | pi |
| openclaw | openclaw |

감지 결과 mapping에는 universal도 포함된다. 명시적 `--agent universal`은 shared `.agents/skills`만 목표로 한다. unattended yes에 target이 없으면 builder가 거부하고, 감지한 agent가 없으면 handler가 명시 target 안내와 실패를 반환한다. dash-leading 등 CLI가 버릴 수 있는 agent key도 거부한다. 이 방어는 no-target/all-agents 설치를 피하기 위한 것이다.

다만 community CLI가 실제로 쓰는 제품별 모든 경로·update/remove ownership policy는 이번 source 범위로 확정할 수 없다. npx의 cold-cache download 가능성도 lophn의 cache-only/no-runtime-download 계약과 다르다.

#### MCP·instruction

[확인] `McpConfigCandidate`는 `format, label, relativePath, serversPath`다(O14). 후보는 `.mcp.json`, `.cursor/mcp.json`, `.claude.json`, `.claude/mcp.json`, 모두 `mcpServers` path다. inspection은 missing/valid/invalid, transport stdio/http/unknown, enabled/disabled/invalid, command/url/env/issue 등의 summary와 secret masking을 제공한다.

이는 config inspection이지 일곱 harness에 Orca own MCP를 persistent install하는 통합 catalog가 아니다. 이번 조사에서는 그 installer를 확인하지 못했다. bundled skill의 MCP discovery 안내를 config installer로 해석하지 않는다. 일곱 제품 instruction file을 자동 관리하는 공통 registry도 이번 조사에서 확인하지 못했다.

#### Hook/plugin/extension

[확인] Orca는 모든 제품을 JSON hooks 하나로 처리하지 않는다(O15–O18).

- Claude: effective config directory의 `settings.json`; managed hook만 merge/remove하고 사람의 statusLine을 보존한다. event 최소 version을 table로 고정한다. 예: SessionStart 1.0.62, PermissionRequest 2.0.45, PostCompact 2.1.76. unknown version은 보수적인 1.0.64 baseline이다. 이유는 모르는 event로 settings 전체가 거절될 수 있기 때문이다.
- Codex: hooks/trust를 실제 runtime `CODEX_HOME`에 설치한다. default shared mirror와 managed account별 home/WSL home을 구별한다. real `~/.codex/hooks.json` 하나만 쓰는 것으로 단순화하면 틀린다.
- Gemini: `~/.gemini/settings.json`; BeforeAgent/AfterAgent/AfterTool/BeforeTool, 기존 user hook 보존. 해당 service는 permission-prompt hook이 없어 이 source만으로 waiting을 추론하지 않는다고 명시한다.
- Hermes: `$HERMES_HOME` 또는 `~/.hermes`, `config.yaml` enablement + `plugins/.../plugin.yaml`와 `__init__.py`; own files일 때만 plugin directory 제거.
- OpenCode: XDG opencode plugins의 `orca-opencode-status.js`, config overlay와 OpenCode 2 TUI plugin 경로도 존재한다. overlay는 사용자 config를 mirror하면서 managed plugin을 별도로 둔다.
- pi: settings JSON hook이 아니라 effective agent directory의 extensions. titlebar/prefill/status extension에 managed marker를 쓴다. 실행하지 않는 default home을 불필요하게 만드는 것도 피한다.
- OpenClaw: TUI catalog에는 있으나 이번 managed hook registry entry는 확인하지 못했다.

### 1.5 Launch·resume·session·status·permission

[확인] requested 제품 launch 값은 Claude/Codex/OpenCode/pi/Gemini/OpenClaw가 command 이름 그대로, Hermes는 `hermes --tui`다(O2). prompt mode는 Claude/Codex/pi argv, OpenCode `--prompt`, Gemini `--prompt-interactive`, Hermes query planner, OpenClaw stdin-after-start다(O20). Hermes query planner의 세부 argv 전체는 이번 보고서에서 확정하지 않는다.

[확인] resume는 별도 catalog다(O19).

- Claude: `claude --resume <id>`.
- Codex: `codex resume <id>`.
- OpenCode: `opencode --session <id>`.
- Gemini: `gemini --resume <id>`.
- pi: `pi --session <transcriptPath>`; ID만으로는 이 builder의 resume 조건을 만족하지 않는다.
- Hermes/OpenClaw: Orca resumable registry에 없다. harness 자체 resume 불가능을 뜻하지 않는다.

`AgentProviderSessionMetadata`는 `key: session_id | conversation_id`, `id`, optional `transcriptPath`다. hook/plugin payload에서 Claude/Codex는 `session_id`와 transcript path, Gemini는 `session_id`, OpenCode는 `sessionID`, pi는 `session_id`와 `session_file`을 얻는다. ID는 empty/leading dash/control char 등을 거부하고 길이를 제한한다. provider session ID와 Orca terminal/session ID는 별개다.

`AGENT_STATUS_STATES`는 `working | blocked | waiting | done`이다(O20). entry에 observed/evidence timestamp, providerSession, tool, prompt, terminal/worktree/connection/tab references, restoredUnconfirmed 등이 있다. 이는 process alive 하나의 bool이 아니다. `preflightTrust` 같은 launch 전 trust와 PermissionRequest 같은 runtime 관측도 별개다. catalog에 prompt/terminal output readiness와 hook/protocol evidence를 함께 표현할 이유가 있다.

## 2. Paseo

### 2.1 Catalog·runtime settings·registry

[확인] `AgentProviderDefinition`은 다음 실제 필드를 가진다(P1).

`id, label, description, enabledByDefault?, defaultModeId, modes, voice?`.

builtin IDs는 `claude, codex, copilot, opencode, pi, omp`다. Gemini/Hermes/OpenClaw는 이 builtin table에 없다. generic ACP/custom/plugin 경로까지 불가능하다는 뜻은 아니다. omp는 enabledByDefault=false다.

[확인] `ProviderCommand`는 discriminated union `default | append(args?) | replace(argv)`다. `ProviderRuntimeSettings`는 command/env/disallowedTools를 갖는다(P2).

`ProviderOverride` 실제 필드는 `extends?, label?, description?, command?, env?, options?, params?, models?, additionalModels?, disallowedTools?, paseoTools?, enabled?, order?`다. params는 legacy compatibility 필드다. custom provider ID는 `/^[a-z][a-z0-9-]*$/`; custom extends에는 label, extends=acp에는 command가 필수다.

[확인] server registry의 `ProviderDefinition`은 manifest에 다음 계약을 더한다(P3).

- `configuration`, `enabled`, `derivedFromProviderId`, `iconSvg?`.
- `supportsExactMcpPreapproval`.
- `applyToolPolicy`, `createClient`.
- `resolveCreateConfig`, `isCreateConfigUnattended`.
- `fetchCatalog`.

`ResolvedProvider`는 runtimeSettings/profileModels/additionalModels/providerOptions/createBaseClient/contract 등을 묶는다. factories는 Claude SDK, Codex AppServer, Copilot ACP, OpenCode runtime selector, pi RPC, omp 등이다. common schema와 native adapter 계약을 분리하는 구조다.

`defaultModeId`는 default harness가 아니라 provider 내부 mode default다. Claude auto, Codex auto-review 등을 보고 Claude가 앱 default harness라고 추론하면 안 된다.

### 2.2 Detection·version·auth·snapshot

[확인] generic executable resolution은 Unix system `which -a` 또는 library lookup의 후보를 dedupe한 뒤 probe한다(P4). direct path도 처리하고 Windows script 실행을 구별한다.

`probeExecutable(path, options)`의 기본은 `--version`, 2초, 64KiB buffer, SIGKILL이다. classifier는 다음처럼 동작한다.

- 정상 완료: true.
- killed/timeout: true.
- numeric exit code, 즉 nonzero process exit: true.
- ENOENT/EACCES/ENOEXEC/UNKNOWN: false.
- 기타 오류: false.

따라서 이는 실행 가능한 후보를 찾는 probe이지 `--version`의 성공·version parsing·auth readiness를 증명하는 probe가 아니다. Unix which code=1은 absence, 다른 오류는 failure다.

[확인] provider별 semantic probe는 별도다(P5–P6).

- Claude `isAvailable`: resolved launch availability. version은 별도 5초 `--version` parsing, auth는 별도 `auth status` stdout/stderr diagnostic.
- pi diagnostic의 auth.json found/not found는 파일 존재이지 실제 인증 검증이 아니다.
- OpenCode runtime selector는 version으로 V1/V2를 선택한다. V2 minimum은 2.0.10이다. version probe 실패 시 legacy로 fallback하여 나중에 재시도할 수 있다. V1 client 구현만 보고 현재 모든 OpenCode 실행 계약을 확정하면 안 된다.

[확인] `ProviderSnapshotManager`는 in-memory catalogs/targets, inflight coalescing, target/config/registry generation invalidation을 사용한다(P7). 120초는 refresh deadline이지 TTL이 아니다. explicit cwd refresh와 settings/global refresh가 다르다. `AgentClient.getCatalogCacheKey` comment는 실행 환경과 effective config를 identity에 포함하고 force를 제외하도록 요구한다(P9).

model/mode fetchCatalog는 provider runtime/server/session을 실제 시작할 수 있다. filesystem detection과 같은 무해한 read probe라고 표시하면 안 된다.

### 2.3 사용자 선택·enabled·default

[확인] provider override에 enabled/order가 있다(P2). app `FormPreferences`에는 provider와 provider별 model/mode/thinking/feature preferences, launchTarget chat/terminal이 있다(P8). `DEFAULT_FORM_PREFERENCES = {}`다.

확인한 form resolver는 userModified일 때 currentProvider를 유지하고, 아니면 `initialValues.provider ?? preferences.provider ?? currentProvider`를 쓴다. discovery readiness가 saved/explicit choice를 바꾸지 않는다는 주석이 있다. 이 resolver는 first-ready provider를 자동 선택하지 않는다. 이 사실을 모든 CLI/server entrypoint의 default 정책으로 확대하지는 않는다.

### 2.4 Own CLI·runtime MCP·skill·instruction·hook

#### Own CLI

[확인] desktop CLI target은 POSIX `~/.local/bin/paseo`, Windows `~/.local/bin/paseo.cmd`다(P16). POSIX symlink 또는 Windows trampoline을 설치하고 shell RC PATH를 보정한다. 해당 함수는 기존 target/symlink를 unlink하고 status는 target 존재를 검사한다. executable/version/content/ownership을 검증한 status로 해석하면 안 된다. lophn의 unowned 파일 보존에는 Orca식 conflict 검사가 더 맞다.

#### Runtime MCP

[확인] Paseo 자신의 MCP는 `AgentSessionConfig.mcpServers`에 runtime HTTP server를 주입한다(P9–P11).

- 이름 paseo, endpoint pathname `/mcp/agents`.
- URL에 callerAgentId, optional Authorization bearer capability token.
- stored config의 내부 server는 stripping하고, user의 동명 server가 남아 있으면 주입하지 않는다.
- 내부 server 판별은 HTTP/SSE URL pathname이다. 이를 더 강한 ownership 인증이라고 확대하지 않는다.
- token은 daemon password와 별개다.

native translation은 Claude SDK options.mcpServers, Codex innerConfig.mcp_servers, OpenCode V1 `client.mcp.add`, pi adapter config/extension injection 등이다. OpenCode API 등록의 영구 저장 효과까지 이번 조사로 보장하지 않는다. 이 구조는 모든 제품 user config 파일에 own MCP를 persistent 설치하는 구조와 다르다.

#### Skills

[확인] `SkillTargets`는 bundled sourceDir, `~/.agents/skills`, `~/.claude/skills`, legacy `~/.codex/skills`다(P14). bundle directory가 selectable skill catalog이며 selection은 all/custom이다. default all, empty custom은 intentional not-installed다(P15).

`SkillsStatus = {state: not-installed | up-to-date | drift, ops, available, installed}`이고 op는 add/update/delete다. status diff는 bundle 파일의 hash를 비교하며 추가 user 파일만으로 drift라 하지 않는다.

`.paseo-managed-files.json`은 `{version:1, files: Record<relativePath, hash>}`다. 중요하게 다음 두 정책을 구분한다.

1. 현재 bundle에 있는 파일이 다르면 sync는 현재 내용을 이전 receipt hash와 비교하지 않고 overwrite한다.
2. 옛 managed 파일이 bundle에서 빠졌다면 현재 hash가 이전 manifest hash와 같을 때만 제거하고 edited 파일은 보존한다.

explicit removeSkill은 named target directory를 recursively 제거한다. update/autoUpdate는 delete op를 제외하지만 current-file overwrite는 가능하다. 따라서 manifest가 모든 user edit를 보호한다고 말하면 틀린다.

controller는 single-writer queue, operation 내 rescan, 정확한 removal confirmation, transaction staging/rollback/recovery, selection save를 제공한다. 이는 concurrency/recovery의 좋은 근거지만 외부 filesystem 전체의 multi-file atomic transaction 보장은 아니다.

#### Instruction

[확인] `AgentSessionConfig.systemPrompt`는 provider-neutral instruction string이며 `daemonAppendSystemPrompt`는 runtime-only/not persisted다(P9). 이는 instruction file 설치와 다른 contract다. Paseo에 일곱 harness instruction filename/root/import installer registry가 있다는 것은 이번 조사에서 확인하지 못했다.

#### Hooks

[확인] common hook strategy는 config-file 또는 plugin-file이며 configDir/configDirBase/configFile/configDirEnvOverride/hookMarker와 parse/stringify/install/uninstall/isInstalled를 가진다(P12).

registry는 Claude/Codex/OpenCode 세 가지다.

- Claude `.claude/settings.json`, CLAUDE_CONFIG_DIR.
- Codex `.codex/hooks.json`, CODEX_HOME.
- OpenCode XDG opencode `plugins/paseo-terminal-activity.js`, OPENCODE_CONFIG_DIR.

command는 PASEO_TERMINAL_ID가 있을 때만 Paseo hook CLI를 호출한다. config parse 실패는 write 전에 중단되며 whole JSON stringify + private atomic writer를 사용한다. Claude/Codex는 own marked command hook을 제거 후 재추가하고 다른 hook을 보존한다(P13).

plugin-file installer는 지정 path의 다른 내용도 overwrite하며 uninstall은 content/receipt 확인 없이 해당 path를 제거한다. lophn의 ownership 정책으로 그대로 가져오면 안 된다.

normalized activity는 running/idle/needs-input이다. Claude Notification idle_prompt, Codex PermissionRequest, OpenCode permission.asked를 needs-input으로 다룬다. registry install은 provider별 error를 warn하고 계속하므로 일부 성공을 전체 성공으로 표시하면 안 된다.

### 2.5 Launch·resume·session·status·permission

[확인] common session 계약은 P9다.

- `AgentClient.createSession(config, launchContext?, options?)`.
- `AgentClient.resumeSession(handle, overrides?, launchContext?, options?)`.
- `AgentPersistenceHandle = {provider, sessionId, nativeHandle?, metadata?}`.
- `AgentSession.id: string | null`; 시작 때 ID가 없을 수도 있다.
- `describePersistence`, `streamHistory`, optional `listImportableSessions`/`importSession`.
- `persistSession` default true; 지원하지 않는 provider는 false를 no-op할 수 있다.
- resume purpose interactive/history는 runtime-only다.
- `close()`는 live runtime을 release하며 durable native session 삭제/보관과 다르다.

실제 launch는 bare TUI CLI와 다르다(P5/P11).

| provider | 확인한 실행/재개 통로 |
|---|---|
| Claude | Agent SDK query/options, options.resume에 native session ID |
| Codex | resolved command prefix + app-server, protocol thread/session handle |
| OpenCode | runtime selector의 V1/V2 adapter. V1은 serve/server + client API/session ID; V1 계약을 V2 전체로 확대하지 않음 |
| pi | --mode rpc 또는 rpc-ui; --no-session 또는 --session; --mcp-config·--extension 등 |

`AgentStreamEvent`에는 thread_started(sessionId), turn_started/completed/failed/canceled, mode/model/thinking change, timeline, permission_requested/resolved, attention_required, provider_subagent가 있다. `AgentSession`의 getPendingPermissions/respondToPermission은 permission response를 common contract로 다룬다. `supportsExactMcpPreapproval`은 Claude/Codex/OpenCode true, fallback false인 provider contract와 별개다.

세 status 축도 구분해야 한다.

- provider discovery: ready/loading/error/unavailable.
- agent lifecycle: initializing/idle/running/error/closed(P17).
- terminal hook activity: running/idle/needs-input(P12).

waiting permission, runtime error, unavailable provider를 하나의 status enum으로 뭉치면 원인과 authority가 사라진다.

## 3. Harness별 차이

다음 두 표는 역할이 다르다. 첫 표의 MCP/skill/instruction 위치는 **lophn 현재 architecture가 선언한 adapter 계약**이며 Orca/Paseo로 공식 최신 제품 스펙을 재검증했다는 뜻이 아니다. 프로그램 source가 직접 보여 준 integration은 마지막 열에 따로 썼다.

현재 lophn 근거: `docs/architecture/coding-agent.md` 234–255.

### 3.1 Detection·MCP·skill·instruction·hook

| harness | detection | lophn 현재 MCP 위치/format | lophn 현재 skill root user / app | lophn 현재 instruction | Orca/Paseo hook·integration source 확인 |
|---|---|---|---|---|---|
| Claude Code | Orca claude PATH/fallback; Paseo builtin resolved launch probe | user registration 또는 app .mcp.json; JSON mcpServers.lophn, command/args/env | ~/.claude/skills / .claude/skills | CLAUDE.md managed import @AGENTS.md | Orca settings.json version-gated hooks/statusLine; Paseo settings.json terminal hooks + SDK runtime MCP |
| Codex | Orca codex; Paseo builtin resolved launch probe | ~/.codex/config.toml; TOML mcp_servers.lophn 조각 출력, app config 자동 생성 없음 | ~/.agents/skills / .agents/skills | AGENTS.md, closer AGENTS.override.md 검사 | Orca actual managed runtime CODEX_HOME hooks/trust; Paseo CODEX_HOME hooks.json + AppServer mcp_servers |
| OpenCode | Orca opencode; Paseo builtin, 별도 V1/V2 version selector | XDG/user opencode.json 또는 app opencode.json; JSON mcp.lophn local command 배열/environment | ~/.config/opencode/skills / .opencode/skills | AGENTS.md, 기존 rules/config precedence 보존 | Orca plugin/config overlay; Paseo XDG plugin + runtime MCP API. Orca community skills alias 있음 |
| Gemini CLI | Orca gemini; Paseo builtin 없음 | ~/.gemini/settings.json 또는 app .gemini/settings.json; JSON mcpServers.lophn | ~/.gemini/skills / .gemini/skills | context.fileName 기존 목록에 AGENTS.md 참조 추가 | Orca Before/AfterAgent/Tool hook, managed skill placement 및 community alias; Paseo 직접 adapter 미확인 |
| Hermes | Orca hermes; Paseo builtin 없음 | $HERMES_HOME/config.yaml; YAML mcp_servers.lophn command/args/env/cwd | $HERMES_HOME/skills / .hermes/skills | AGENTS.md, profile/workspace/trust 확인 | Orca YAML-enabled Python plugin, community skills alias; Paseo 직접 adapter 미확인 |
| pi | Orca pi; Paseo builtin RPC client | exact installed adapter의 .mcp.json 또는 ~/.pi/agent/mcp-adapter.json; JSON mcpServers.lophn/directTools=true | ~/.pi/agent/skills / .pi/skills | AGENTS.md | Orca extension, community alias; Paseo adapter/builtin runtime injection·temporary extension. native/adapter 이중 시작 금지 |
| OpenClaw | Orca openclaw; Paseo builtin 없음 | 사람 config의 mcp.servers.lophn stdio 조각; 지원 version/client 검사 필요 | ~/.openclaw/skills / 선택 agent workspace의 skills | workspace AGENTS.md와 app root 차이 검사; workspace 변경·본문 복제 금지 | Orca community skills alias, managed hook/resume 미확인; Paseo 직접 adapter 미확인. stdio session 소유 미확인은 unknown |

주의:

- user/app 파일 path는 실행 환경과 profile root에서 resolve해야 한다. Linux host의 ~/.config와 WSL guest home, XDG override를 섞지 않는다.
- Orca community skills 경로는 external CLI가 처리하므로 위 lophn path를 Orca의 직접 파일 쓰기 근거로 인용하지 않는다.
- Paseo의 shared skills targets는 common `.agents`/Claude/legacy Codex이며 제품별 일곱 root installer table가 아니다.
- broken JSON/TOML/YAML 보존, trust/consent 자동 확대 금지는 lophn 현재 계약이다.

### 3.2 Launch·resume·session ID·status·permission

| harness | Orca TUI launch/prompt·resume | Orca native session 정보 | Paseo runtime 경로 | 상태/permission 차이 |
|---|---|---|---|---|
| Claude Code | claude + argv; claude --resume ID | hook session_id + transcript_path | SDK query/options.resume | Orca trust preflight·version-gated PermissionRequest; Paseo protocol permission + terminal Notification |
| Codex | codex + argv; codex resume ID | hook session_id + transcript_path | app-server·thread persistence | Orca composer readiness와 runtime hook/trust; Paseo protocol permission 및 terminal PermissionRequest |
| OpenCode | opencode --prompt; --session ID | plugin sessionID | version-selected V1/V2 runtime; V1 serve/API | plugin/session/output event, permission asked/replied. version별 adapter 계약 필요 |
| Gemini CLI | gemini --prompt-interactive; --resume ID | hook session_id | builtin 없음 | Orca Before/AfterAgent/Tool; 해당 hook 경로의 permission waiting 추론 제한 |
| Hermes | hermes --tui; query planner; Orca resume 없음 | extraction에서 native resume metadata 없음 | builtin 없음 | Orca Python status plugin. resume/permission 전체는 이번 조사에서 미확인 |
| pi | pi + argv; pi --session transcriptPath | extension session_id + session_file, file 필요 | RPC/RPC-UI, session file handle | Orca extension; Paseo structured turn/permission/runtime event |
| OpenClaw | openclaw + stdin-after-start; Orca resume 없음 | resumable registry 없음 | builtin 없음 | generic TUI catalog 존재와 structured status/permission 지원은 별개; 미확인을 unsupported로 바꾸지 않음 |

## 4. lophn domain model 제안

[제안] 아래는 `docs/domain-model/README.md`의 필드·상태·관계·ledger·command·event·정책 틀에 맞춘 초안이다. 사용 흐름과 채택 이유는 requirements/flow에 두고 domain에는 데이터 규칙만 남긴다.

새 concern을 `coding-agent/harnesses`, `coding-agent/integrations`, 필요 시 `coding-agent/sessions`로 나누는 것이 적절하다. 이는 설계안이며 docs를 생성하거나 수정하지 않았다.

### 4.1 HarnessDefinition: 제품 배포 catalog 값

entity가 아니라 signed release에 포함된 catalog 값이다. ID는 stable 제품 key이며 ledger entity ID prefix를 새로 만들지 않는다.

| 필드 | 타입 | null | 제약·뜻 |
|---|---|---|---|
| harness_id | stable string | 아니오 | release 안에서 unique; display label과 분리 |
| label | string | 아니오 | 사용자 표시, ID 대용 금지 |
| catalog_revision | release/hash 참조 | 아니오 | immutable catalog revision |
| adapter_revision | release/hash 참조 | 아니오 | config/launch/probe adapter 구현 revision |
| version_policy | tested ranges, minimum?, unknown policy | 아니오 | supported/unsupported/unverified 판정 근거; version 미확인 별도 |
| environments | platform/runtime support specs[] | 아니오 | host/WSL/SSH 등; unsupported와 unverified 구분 |
| detection | DetectionSpec | 아니오 | command names/aliases/dependencies, filesystem lookup, bounded fallback |
| version_probe, auth_probe | ProbeSpec | 예 | 없음은 지원 미확인/불필요 등의 capability와 함께 표현 |
| config_targets | ConfigTargetSpec[] | 아니오 | user/app/profile별 path resolver, JSON/TOML/YAML/API, owned key/merge 정책 |
| skill_targets | SkillTargetSpec[] | 아니오 | root resolver·canonical/alias/copy·format·discovery probe |
| instructions | InstructionSpec[] | 아니오 | AGENTS canonical/import/override/workspace 검사·marker 정책 |
| hooks | HookSpec[] | 아니오 | hook/plugin/extension·event version floor·owned resource·status evidence |
| execution | ExecutionSpec[] | 아니오 | PTY/SDK/RPC/HTTP/ACP별 launch/resume/session/status/permission 계약 |

`ProbeSpec`: `{kind, timeout_ms, output_limit_bytes, success_classifier, side_effects, supported_versions}`. side effects는 none/process/auth-query/session 등 실제 영향을 표시한다. detection이 session을 시작하는 probe를 조용히 실행해서는 안 된다.

`ConfigTargetSpec`: `{scope_kind, profile_root_resolver, path_or_api, format, owned_key?, merge_policy, loading_probe}`. file path와 runtime API를 같은 write implementation으로 숨기지 않는다.

`ExecutionSpec` 최소 필드:

- transport: pty/sdk/rpc/http/acp.
- launch executable/argv builder, prompt injection, expected process/readiness signal.
- resume argv 또는 native API method, required cwd/native handle/transcript path.
- session identity kind, acquisition source: hook/protocol response/event/session file/listing.
- capability: create/resume/list/persist/read-history/interrupt/close.
- status evidence channels: hook/output/protocol/process, normalization version.
- permission preflight/trust, runtime pending request/response, exact MCP preapproval.
- tested version/platform 및 side effects.

복잡한 behavior는 검증된 adapter 함수가 수행하고 catalog는 adapter method/spec을 참조한다. SDK 함수를 serialized catalog 데이터로 저장하려 하지 않는다. catalog에 host absolute path, 실제 detected version, user secret, live session ID를 넣지 않는다.

### 4.2 HarnessDetection: 현재 environment의 observation

| 필드 | 타입 | null | 제약·뜻 |
|---|---|---|---|
| harness_id | catalog key | 아니오 | 해당 catalog revision 참조 |
| environment | ExecutionEnvironment 값 | 아니오 | host 또는 WSL distro/remote identity; 서로 분리 |
| profile_id | local profile key | 예 | command/env/config root override identity |
| catalog_revision | revision | 아니오 | 무엇으로 검사했는지 |
| observed_at | UTC 시각 | 아니오 | 결과 관측 시각 |
| discovery | unobserved/detected/absent/unknown/error | 아니오 | absent는 lookup이 끝났으며 후보 없음을 확인한 경우만 |
| candidates | executable evidence[] | 아니오 | source PATH/login PATH/fallback, resolved path, executable result |
| selected_executable | environment absolute path | 예 | detected일 때 실제 실행 후보; host 경로로 guest path 변환 금지 |
| version | VersionObservation | 아니오 | parsed/raw-safe 값 또는 unknown/error; discovery와 독립 |
| auth | AuthObservation | 아니오 | verified/not-verified/unknown/error/unverified-capability 등; 파일 존재는 별도 evidence |
| probe_results | safe structured results[] | 아니오 | timeout/error/classifier/side effect; secret/stdout 전체 보관 금지 |
| freshness | fresh/stale | 아니오 | 관측 유지 여부; TTL/deadline와 분리 |

상태 전이: unobserved→detected/absent/unknown/error; command/env/catalog 변경 또는 refresh 정책으로 stale; refresh 결과로 새 observation 교체. executable detected가 version/auth/loading success로 전이하는 것이 아니다. 다른 축의 결과를 갱신한다.

`ExecutionEnvironment`와 `HarnessProfile`은 platform/environment concern의 값 또는 settings를 참조한다. 다른 concern entity를 여기서 중복 정의하지 않는다.

### 4.3 HarnessIntegrationObservation: 현재 설치·loading observation

| 필드 | 타입 | null | 제약·뜻 |
|---|---|---|---|
| target | IntegrationTarget | 아니오 | environment/profile/harness/user-or-app/app realpath |
| connection | cac 참조 | 예 | credential integration일 때만; standalone CLI resource와 분리 |
| observed_at | UTC 시각 | 아니오 | reinspection 시각 |
| catalog_revision, adapter_revision | revision | 아니오 | inspection 계약 |
| components | ComponentObservation[] | 아니오 | cli-wrapper/mcp/skill/guide/hook 각각 또는 resource별 |
| loading_checks | 네 stage 결과[] | 아니오 | 기존 mcp_initialize/tool_discovery/skill_discovery/app_guide_loading을 각 한 번 |

`ComponentObservation` 필드:

- component kind, logical resource identity.
- expected distribution version/content hash.
- observed version/content or owned-fragment hash, effective path/API target.
- ownership: owned/unowned/unknown.
- state: missing/current/outdated/modified/conflict/unknown/error.
- receipt reference, reason/evidence/observed_at.

CLI binary version, wrapper format version, MCP config adapter version, skill distribution version, instruction content hash, hook adapter version을 구별한다. 하나의 installed_version으로 뭉치지 않는다. upstream skill 자체에 version이 없으면 lophn distribution revision/hash를 version 기준으로 삼는다.

파일 설치 current와 실제 loading success는 독립이다. user override/trust/workspace 때문에 current+loading unknown/failure가 가능하다. inspect가 실패하면 missing이라 하지 않는다.

`IntegrationTarget = {environment, profile_id?, harness_id, scope_kind:user|app, app?, app_realpath?}`. user일 때 app/app_realpath null, app일 때 둘 다 필수다. profile/config root는 resolve한 effective 값과 계획을 묶어 다른 home에 설치하지 않게 한다.

### 4.4 LocalIntegrationReceipt: local durable ownership 기록

ledger 정본 entity가 아니다. 설치 작업이 소유한 resource를 이후 update/remove에서 확인하기 위한 local manifest다.

| 필드 | 타입 | null | 제약·뜻 |
|---|---|---|---|
| schema_version | positive integer | 아니오 | receipt migration/validation |
| target | IntegrationTarget | 아니오 | scope/environment/profile 고정 |
| connection | cac 참조 | 예 | token 대신 안정된 reference |
| catalog_revision, adapter_revision | revision | 아니오 | 작성 계약 |
| distribution_version/hash | release/hash | 아니오 | 배포 내용 |
| resources | OwnedResourceReceipt[] | 아니오 | resource별 path/key/marker·last-written digest |
| operation_id | local idempotency key | 아니오 | 복구/재시도 상관관계; ledger command ID와 자동 동일시 금지 |
| written_at | UTC 시각 | 아니오 | 마지막 성공 write |

OwnedResourceReceipt는 canonical identity, topology, last-written hash/owned fragment digest, managed marker/key, optional previous distribution을 가진다. raw token, token 본문 config, user config 원문, secret-bearing environment dump를 넣지 않는다. 진단에도 반환하지 않는다.

불변 조건:

- receipt 존재만으로 current/loaded라고 하지 않고 매번 재관측한다.
- 이름 일치만으로 ownership을 인정하지 않는다.
- receipt가 있어도 현재 bytes가 last-written digest와 다르면 자동 replace/remove 권한이 없다.
- symlink의 외부 target은 자동 수정하지 않는다.
- multi-file 결과는 component별로 기록하고 partial 실패를 정확히 반환한다.
- recovery journal은 receipt 및 운영 ledger와 다른 local 기술 기록이다.

### 4.5 HarnessSessionObservation·LaunchPlan

launch/resume/session/status 계약을 catalog에서 제외하지 않는다. 현재 사용할 범위와 future coordinator 범위를 아래 질문에서 정한다.

| 필드 | 타입 | null | 제약·뜻 |
|---|---|---|---|
| harness_id, environment, profile_id | catalog/environment/profile 참조 | profile만 예 | execution target 고정 |
| catalog_revision, adapter_revision | revision | 아니오 | 실제 launch/interpretation 계약 |
| runtime_ref | terminal/tab/process/protocol reference | 예 | lophn 내부 reference; provider ID와 분리 |
| cwd | environment absolute path | 아니오 | resume workspace 조건 |
| provider_session | ProviderSessionMetadata | 예 | ID 획득 전 null 가능 |
| lifecycle | initializing/idle/running/error/closed/unknown | 아니오 | runtime lifecycle observation |
| activity | working/idle/waiting/unknown | 아니오 | turn/attention 축; lifecycle와 분리 |
| pending_permissions | safe PermissionObservation[] | 아니오 | request ID/native handle/response capability·scope |
| observed_at, evidence_source | time/source | 아니오 | hook/output/protocol/process 근거 |
| freshness | fresh/stale | 아니오 | evidence 없는 alive 추정 금지 |

`ProviderSessionMetadata = {kind, id, native_handle?, transcript_path?, source, acquired_at}`. kind/id validation은 adapter별로 고정하고 control character/argv injection을 거부한다. pi처럼 file가 resume target인 경우 ID-only resume를 만들지 않는다.

`LaunchPlan`은 target, launch/resume intent, exact executable/argv/cwd/env names, referenced secret handles, selected adapter revision, expected evidence를 담는다. 계획 자체에 raw token을 넣지 않는다. config discovery 자동 시작과 actual launch command를 구분한다.

관측만 도입한다면 ledger entity가 필요 없다. durable execution intent/job/session lifecycle을 lophn이 책임질 때는 별도 domain 설계가 필요하다. 기존 lophn-agent Session/ses 또는 CodingAgentConnection/cac를 외부 harness session ID 용도로 재사용하지 않는다.

### 4.6 상태와 전이

| 대상 | 전이 | 규칙 |
|---|---|---|
| catalog | release A→release B | 검증한 signed resource 교체; 기존 observation에 사용 revision 보존 |
| detection | unobserved/stale→새 결과 | absent와 timeout/error 분리 |
| integration | missing→current | 실제 owned write 성공 후 inspection; loading은 별도 |
| integration | current→outdated | 배포 기대 version/hash 변경 |
| integration | current/outdated→modified | last-written digest와 실제 bytes 불일치 |
| integration | any→conflict | 동명 unowned·stale plan·marker 오류·external link 등 |
| install operation | planned→changed/unchanged/skipped/conflict/failed | resource별 결과; 일부 실패는 partial |
| receipt | 없음→기록/갱신→제거 | 실제 committed resource와 함께 정확히 갱신; 실패 시 recovery 근거 보존 |
| future runtime | initializing→idle/running/error→closed | protocol/process 근거가 있을 때만; reconnect 전 stale/unknown 가능 |
| permission | requested→resolved/canceled/unknown | 정확한 request identity로 처리; request disappearance만으로 allow 추정 금지 |

enable=false, uninstall, connection revoke, process termination은 서로 자동 전이하지 않는다. revoke 뒤 파일은 남아 있으나 요청은 거절될 수 있다. uninstall도 credential revoke를 자동 수행하지 않는다.

### 4.7 관계

| from | 관계 | to |
|---|---|---|
| HarnessDefinition | 제품/adapter release | signed distribution resource |
| HarnessDetection | 어떤 환경·profile을 검사했는가 | platform environment/settings |
| HarnessIntegrationObservation | 검사 target·expected catalog | HarnessDefinition/IntegrationTarget |
| LocalIntegrationReceipt | 설치 ownership | 실제 config fragment/file/alias |
| credential integration | 인증 reference | CodingAgentConnection → coding-agent/connection |
| HarnessSessionObservation | provider metadata와 runtime target | HarnessDefinition/ExecutionEnvironment |
| selected/default/enabled/profile | 사용자 선택 | platform/settings |

connection은 여러 harness/target integration과 연결될 수 있다. harness별 연결 별칭을 지원하더라도 connection의 credential scope/actor가 제품 이름으로 결정되지 않는다.

### 4.8 ledger 표

[제안] 새 ledger 표는 만들지 않는다.

| 값 | 정본/보관 |
|---|---|
| HarnessDefinition | signed 제품 배포 resource |
| Detection/Integration/SessionObservation | derived memory·필요 시 disposable local cache |
| LocalIntegrationReceipt/recovery journal | local durable install metadata; 운영 ledger 아님 |
| enabled/default/profile 선택 | 기존 platform/settings 계약에 따른 setting_choices/setting_revisions/settings_state 또는 environment-local 설정 |
| CodingAgentConnection | 기존 coding_agent_connections 유지 |
| future durable launch intent/session | 이번 조사만으로 표 추가하지 않음; authority·lifecycle 결정 뒤 설계 |

`docs/domain-model/README.md`의 entity 수를 catalog key 때문에 늘리지 않는다.

### 4.9 command

명칭은 제안이며 core ledger command와 local operation을 구별한다.

| command/operation | actor | 입력 | 비교 기준 | 결과/event | 거절 |
|---|---|---|---|---|---|
| harness.catalog/read | 허용된 reader | revision? | verified catalog | 값 반환, ledger event 없음 | unavailable/unverified_resource |
| harness.detect/refresh | 사람 또는 read-only 진단 요청 | environment/profile/harness set/probe level | target identity·budget·side effects | observation 반환 | invalid_target/probe_failed/timeout |
| integration.inspect/doctor | 허용된 reader | exact target/connection? | 실제 파일/API와 current adapter | components+네 loading check | not_found/invalid_config/unknown_capability |
| integration.plan | user | exact target/components/expected distribution | receipt·현재 hash·scope·profile | safe plan | conflict/unsupported/unverified |
| integration.install/update/remove | user/local installer | exact plan·idempotency key | target/adapter/whole-file hash·owned digest/marker 재검사 | resource별 결과·receipt; local notification | conflict/forbidden/invalid_config/io_failed |
| mcp config | 현재 CLI 계약 | connection/app/harness | 지원 adapter | 조각 출력만; 파일 무변경 | unsupported/invalid_input |
| coding_agent_connection.create/revoke | 기존 user | 기존 입력 | 기존 revision/보호 화면 | 기존 connection events | 기존 errors |
| future launch/resume/list/status/permission.respond | 별도 결정 | exact execution/request target | lifecycle/authority/native capability | runtime 결과/notification | stale_request/unsupported/forbidden/launch_failed |

coding credential이 자기 connection을 읽을 수 있다는 이유로 user config 전체를 dump하거나 arbitrary path install 권한을 얻지 않는다. future coordinator의 launch actor/authority는 connection에서 자동 파생시키지 않는다.

### 4.10 event

| 종류 | subject·payload | 구독 |
|---|---|---|
| 기존 CodingAgentConnectionCreated/Revoked | 기존 cac와 안전한 payload | 기존 guides/tickets/runtime |
| 기존 settings change/reload 계약 | harness preference/profile safe references | catalog chooser·local adapter |
| local detection refresh notification | target/revision/관측 시각/안전한 결과 | UI·diagnostics |
| local integration operation result | operation/target/component outcome | UI·diagnostics·receipt recovery |
| runtime session/permission notification | runtime/provider identity/evidence/request refs | terminal UI/future coordinator |

마지막 세 종류는 ledger event로 정의하지 않는다. runtime stream의 turn_started가 core domain에서 확정한 coding 작업 완료 event를 대신하지 않는다. event payload에 token/native transcript 본문/secret env를 넣지 않는다.

### 4.11 정책

- detection은 read-only이며 설치·trust 확대·credential 발급을 하지 않는다.
- filesystem lookup, version, auth, model/mode catalog, loading, launch probe의 side effects를 구분한다.
- current catalog revision과 effective environment/profile을 모든 plan/cache key에 포함한다.
- unsupported와 unverified, absent와 error, current file와 loaded를 구분한다.
- unknown version은 version-sensitive hook 자동 추가에 보수적 policy를 쓴다.
- selected/default/enabled는 사용 정책이지 credential 보안 경계가 아니다.
- unowned 동명 파일·사용자 변경·외부 symlink·broken config를 자동 덮어쓰지 않는다.
- same-directory temp/fsync/atomic rename은 파일별 보장이고 multi-file 원자성을 주장하지 않는다.
- install/update/remove는 ownership receipt와 hash-CAS를 함께 사용한다.
- shared canonical skill와 provider alias가 같은 physical root이면 dedupe하고 중복 ownership 충돌을 막는다.
- CLI fallback 성공을 MCP loading 성공으로 기록하지 않는다.
- instruction은 AGENTS.md 정본 + thin import/reference 원칙을 유지한다.
- permission request 관측과 permission allow authority를 별도로 확인한다.

## 5. 기존 connection.md에 남길 것과 바꿀 것

근거: `docs/domain-model/coding-agent/connection.md` 9–97.

### 남길 것

- CodingAgentConnection의 id/label/scope/principal/token_hash/state/revision.
- harness, 외부 session ID, alive, token file path를 credential entity 필드에 넣지 않는 불변 조건.
- actor는 credential에서 확인하고 제품 이름/argv/cwd로 추정하지 않는 규칙.
- raw token 금지, credential 상한+scope 동시 검사, revoke 즉시 새 요청 거절.
- create/revoke command/event와 coding_agent_connections table.
- 설치와 credential 발급/회수를 자동 결합하지 않는 경계.

### 바꿀 후보

- ConnectionInstallationCheck는 설치 concern으로 옮기거나 기존 이름을 유지하면서 HarnessIntegrationObservation을 참조한다.
- current check는 connection/at/checks만 있으므로 environment/profile/harness/scope/app realpath/catalog revision을 inspection envelope에 추가한다. 어느 target의 네 checks인지 알아야 한다.
- 네 stage와 success/failure/unknown은 유지한다. 설치 파일 상태/version/receipt를 stage 결과로 대체하지 않는다.
- runtime session/status는 installation check로 확장하지 않고 별도 observation으로 둔다.
- concern 분리 후 connection은 installation/status 관측을 credential 정본과 분리한다는 cross-reference만 둔다.

## 6. Requirements·architecture 영향

### 현재 문서와 맞는 점

`docs/architecture/coding-agent.md` 234–255에는 이미 adapter manifest, tested version/schema/user-app path/loading probe, owned skill/marker/key, hash-CAS, file별 result, 네 loading check가 있다. 큰 방향은 새 기능보다 빠진 domain 값을 명시하는 일이다.

`docs/domain-model/coding-agent/guides.md`의 배포 skill 값과 managed marker 계약도 유지한다. receipt는 그 소유 범위를 더 명시하는 local 구현 값이다.

### 추가·명시할 내용

- 제품 catalog vs host detection vs integration ownership vs runtime observation의 경계.
- execution environment/profile identity, PATH hydration/fallback/error provenance.
- version/auth capability의 별도 상태와 probe side effects.
- immutable catalog revision과 mutable preference/profile 분리.
- component별 installed version/hash, receipt/recovery journal, stale preview 처리.
- runtime MCP injection과 persistent user/app configuration의 구별.
- SDK/RPC/HTTP/PTY/ACP별 launch/resume/session ID/source/status/permission contract.
- unknown/unsupported/unverified와 loading failure 의미.

### 충돌하거나 범위 결정이 필요한 내용

1. `docs/requirements/coding-agent/connection.md` R1은 사람이 연 session만 연동하고 lophn이 외부 프로세스/code loop를 시작하지 않는다고 한다. 터미널 탭에서 actual launch/resume 또는 future coordinator를 도입하면 이 규칙을 단계별로 변경해야 한다. catalog에 실행 계약을 기록하는 것만으로 현재 launch가 허용되는 것은 아니다.
2. `docs/requirements/coding-agent/guides.md` R25와 architecture의 시작 hook은 Claude만 지원한다. 다른 제품 status hook을 설치한다면 summary delivery와 runtime status 수집 목적을 나누고 지원 범위를 변경해야 한다.
3. `docs/requirements/coding-agent/cli.md` R9의 mcp config output-only, guides의 Codex app TOML 자동 생성 금지는 보존한다. catalog/install command 추가를 이 금지의 우회로 쓰지 않는다.
4. connection R16의 installed runtime/cache-only/no-download는 Orca의 npx skills 설치와 다르다. lophn signed resources를 사용한다.
5. detection/doctor가 Paseo의 fetchCatalog처럼 runtime session을 시작하는 경우 explicit probe class·budget·permission 범위를 정해야 한다.
6. OpenCode version selector, pi adapter/native MCP, OpenClaw gateway/workspace/session stdio 계약은 tested version별로 명시한다. 현재 표를 evergreen 공식 schema로 취급하지 않는다.
7. preference persistence는 `docs/domain-model/platform/settings.md`를 재사용하되 machine-local profile/env path와 sync 가능한 choice를 구분한다.

## 7. 사람이 정할 질문·선택지·추천

| 질문 | 선택지 | 추천 |
|---|---|---|
| 지금 launch/resume를 제공하는가? | catalog만 준비 / terminal tab launch / coordinator까지 | execution contract는 지금 catalog에 포함. actual terminal launch와 coordinator authority/lifecycle은 단계별 requirement로 별도 승인·설계 |
| detection 범위는? | PATH만 / login PATH+bounded fallback / session까지 여는 full probe | 기본은 read-only PATH+bounded fallback, refresh 명시. version/auth/loading/heavy probe는 별도 level |
| default harness는? | 필수 fixed / auto priority / nullable explicit preference | nullable preference + 명시 auto policy. discovery가 saved choice를 지우거나 implicit launch하지 않게 함 |
| enabled=false 의미는? | launcher 제외 / uninstall / credential revoke | launcher/선택 후보 제외만. uninstall/revoke는 별도 command |
| 설치 target은? | 감지한 모든 제품 자동 / 선택 제품만 / user·app 모두 | 선택 harness/environment/profile/scope만 쓰기. detection 자동화와 install 자동화를 분리 |
| custom executable/profile은? | 미지원 / command override만 / explicit profile | explicit profile identity와 command/env/config roots. 다른 profile을 같은 cache/receipt로 보지 않음 |
| WSL/remote는 언제? | host만 / WSL / SSH까지 | 지원하지 않는 환경도 unverified로 명시. host·guest observation key 분리를 처음부터 적용 |
| user edit update/remove 정책은? | bundle 우선 overwrite / receipt+hash conflict / 별도 discard 확인 | receipt+hash conflict. Paseo current-file overwrite/name-based recursive remove보다 Orca 보수적 모델 선택 |
| unknown version hook은? | 최신 event 추가 / conservative subset / 설치하지 않음 | 검증한 conservative subset 또는 조각 안내. guessed event로 전체 config 거절을 만들지 않음 |
| instruction marker 없음은? | append / 무변경 / first-create plan | 기존 파일은 무변경·복구 안내 유지. 새 템플릿 first-create는 명시 plan으로 구분 |
| MCP 방식은? | 모든 제품 config 파일 / runtime injection / adapter별 선택 | persistent config/runtime API/injection capability를 따로 두고 tested adapter별 선택 |
| detection cache TTL은? | 고정 TTL / process cache+refresh / env changes invalidation | effective env/profile/catalog identity invalidation+explicit refresh. TTL을 쓴다면 deadline와 별도 필드 |
| receipt/journal 저장 실패는? | 성공 표시 / 전부 rollback / partial+recovery | component별 commit/partial/recovery를 정확히 기록. multi-file atomic promise 금지 |
| session observation은 ledger인가? | 전부 ledger / derived cache / durable intent만 | observation은 derived. 재시작 뒤 실행 ownership을 복구해야 하는 durable intent만 별도 entity 검토 |
| status hook의 목적은? | guide summary와 결합 / 별도 collection | startup guide delivery와 runtime status collection을 분리. 설치·privacy·permission contract도 각각 명시 |

## 8. 결론

[제안] lophn이 기억할 것을 세 층으로 먼저 나누면 된다.

1. **제품 배포 값**: 무엇을 어떻게 감지·설치·실행·재개·관측하는가.
2. **environment별 observation**: 현재 무엇을 발견했고 어느 version/auth/파일/loading/session evidence를 확인했는가.
3. **local ownership receipt**: 어떤 resource를 lophn이 썼고 언제 어떤 digest로 update/remove할 수 있는가.

사용자 선택은 settings, 인증 권한은 CodingAgentConnection, 실제 external session은 별도 execution contract에 둔다. Orca/Paseo의 구조는 이 분리를 뒷받침하지만 지원 집합과 write ownership 정책이 다르므로 코드의 한 registry나 installed bool을 그대로 domain model로 가져오지 않는다.
