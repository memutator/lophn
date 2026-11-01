# 코드 위치 (2026-11-02 조사)

task brief가 가리키는 사실이다. 줄 번호는 조사 때의 것이라 어긋날 수 있다.

## 지침 층

- `packages/protocol/lophn-agent/instructions.ts`: `PROMPT_INSTRUCTION_LAYERS = [global, project, domain, agent]`. 앱 층은 없다.
- `packages/core/lophn-agent/instructions/files.ts`: `FILE_NAME = "LOPHN.md"`. 전역 `<root>/LOPHN.md`, project `<첫 폴더>/LOPHN.md`(폴더가 없으면 `<data>/projects/<prj>/`). `openFile()`이 ENOENT면 null이다. `ownProject()`는 app place에서 null이다.
- 같은 module: `model.ts`(32 KiB 상한), `turn.ts`(`readTurnInstructions`, 못 읽는 층이면 turn을 막는다).
- 제목: `packages/core/lophn-agent/prompt-assembly/turn-prompt.ts`의 `INSTRUCTION_TITLE`("Project instructions (LOPHN.md)").
- 그 밖: `run-loop/runtime-access.ts`, `main/agent-runtime/product-driver.ts`(`instructionFilesOverCore`), `main/daemon/wiring/instructions-registration.ts`(`projectFirstFolder`).
- 편집 화면은 `LOPHN.md`만 쓴다: `packages/shell/main/editor/instructions.ts`, `packages/shell/renderer/editor/model.ts`, `packages/shell/renderer/workspace/agents/{source,core-source,views}.ts`, `packages/shell/renderer/desktop/settings/agents/*`.
- test: `packages/core/lophn-agent/instructions/{read,turn}_test.ts`, `tests/e2e/prompt-{notice,blocked}_test.ts`, `tests/eval/registry/instruction/*.json`.

## skill 발견과 받기

- parser: `packages/core/lophn-agent/extensions/skills.ts`의 `parseSkillFrontmatter`(줄 단위, `|`·`>`·`[`·`{` 값을 거절). YAML은 `yaml@2.9.1`이 core 의존에 있고 `agents/definition-file.ts`가 `schema: "core"`로 쓴다. parser를 부르는 곳: `extensions/mod.ts`, `tests/eval/versions/components.ts`.
- `discoverSkills(files, sources, {kind, off})`, `SkillSources = {bundled, registered[], personal, domains[]}`. `mergeSkillLayers`가 `off`를 다룬다.
- `skillReceived(skill, chosen, domains)`(allow list)를 쓰는 곳: `agents/resolve.ts`(`receivedSkills`), `extensions/registry.ts`(`commandSkillsOf`, `/` 메뉴), `extensions/skill-read.ts`(`createSkillSnapshot`), `agents/reads.ts`(`rowOf`, Agents 탭 개수).
- 발견을 부르는 곳: `extensions/registry.ts`(`createExtensionRegistry.skills(place, kind)`, place·kind로 cache, agent 인자 없음), `extensions/skill-folders.ts`(`registeredSkillEntries`, `productSkillSnapshotDeps`, `productFiles()`는 읽을 path 허용 목록이고 `privateRoot()`가 `~/.lophn`을 막는다), `extensions/skills-handler.ts`(`skills/read`), `lophn-agent/register.ts`(`globalSkillNames`).
- place 종류의 폴더: `packages/core/agent-places/place/project-layer.ts`의 `PROJECT_LAYER`, `product-driver.ts`의 `SKILL_PLACES`. project 첫 폴더는 SQL(`projectFirstFolder`)로만 안다. 앱 source는 `appGet.source_path`(`agent-places/place/place-data.ts`, `place-folders.ts`의 `placeScope`).
- prompt 목록: `run-loop/prepare.ts`의 `promptSkills`(`deps.skills(place, kind)`, agent 인자 없음), `prompt-assembly/skill-list.ts`의 `skillListText`.
- `skill.read`: `packages/core/lophn-agent/tools/bundles/skill.ts`. turn 시작 snapshot(`product-driver.ts`의 `turnSkillReader`)을 읽는다.
- `skills_off` 지금: 전역 설정 `lophn-agent.extensions.skills_off`(`extensions/settings.ts`), project `extensions.json`의 `skills_off`(`extensions/project-settings.ts`).
- shell: `packages/shell/renderer/workspace/agents/editor/definition-form.tsx`(skill 칸), `.../agents/{source,core-source,core-extensions,fake-data,fake-source}.ts`, i18n `packages/design/i18n/catalog/agents.ts`.
- test: `extensions/skills_test.ts`, `agents/{resolve,reads,commands}_test.ts`, `run-loop/prepare_test.ts`, `tools/file/scope_test.ts`, `tools/work_test.ts`, `tests/eval/versions/versions_test.ts`, `tests/eval/experiment/assembly/prefix_test.ts`.

## agent 정의

- schema: `packages/protocol/lophn-agent/agent-values.ts`(`agentDefinitionSchema`, 칸 `name, profile, model, skills, skills_off, domains, mcp_off, mcp_servers, apps, permissions, skip, body`. `skills_off`·`apps`·`permissions`는 wave 0에 더했다).
- 파일: `packages/core/lophn-agent/agents/`의 `definition-file.ts`(`parseAgentFile`, `serializeAgentFile`, `orderedFrontmatter`), `store.ts`(원자 쓰기, sha256 hash), `inspect.ts`, `validate.ts`, `directory.ts`(동기 `AgentDirectory`, `AgentInfo`는 지금 `{id, name, domains, skip}`).
- route: `protocol/lophn-agent/agent-definitions.ts`의 `agentCreate`, `agentChange`(compare `{hash}`), actor user·agent. 사람만 쓰는 칸은 `agents/commands.ts`(agent actor가 `mcp_servers`·`skip`을 건드리면 `forbidden`)와 `packages/cli/commands/agent.ts`(`.omit`)가 막는다.
- `ResolvedAgent`: `agents/resolve.ts`의 `resolveAgent()`, `layers.ts`의 `resolveTurnAgent()`.
- `dataSteps`: type `DataStep {id, run(root)}`는 `packages/core/storage/migration/data-steps.ts`, 적용 기록은 `<root>/data-migrations.json`. 새 root에서는 돌리지 않고 기록만 한다. 모르는 id는 기동 거절이다. `Wiring.dataSteps`(`main/daemon/wiring/context.ts`)를 `main/daemon/core.ts`가 모은다. 쓰는 wiring은 아직 없다. `WiringFactory`에 `dataSteps`를 두고 `main/daemon/assembly.ts`의 `WIRINGS`에 넣는다. ledger schema step이 먼저 돈다.

## 할당

- protocol: `packages/protocol/approvals/assignment.ts`(`assignmentEntrySchema {app, removed_tools}`, `assignmentGet`, `assignmentSet` compare `revision`, actor user). `removed_tools`는 command 이름뿐이다.
- core: `packages/core/approvals/assignment/`(`schema.ts` step `agent_assignments`, `store.ts`, `commands.ts`, `reads.ts`, `usage.ts`, `registration.ts`, `mod.ts`), `approvals/registration.ts`가 등록한다.
- 읽는 곳: `approvals/gate/judge.ts`(`not_assigned`, `removed`), `approvals/approvals.ts`, `main/daemon/wiring/approvals.ts`(ledger 연결), `apps/calls/gate.ts`(`callAllowed`, 동기 `assignmentOf`, agent·flow caller), `main/daemon/wiring/apps.ts`, `apps/usage/users.ts`(`appAssignees`, `apps/releases/public-tools.ts`와 `app.usage`가 쓴다), `lophn-agent/tools/app-toolkit.ts`(`product-driver.ts`의 `assignmentGet`), `tools/app-tool/command.ts`, `tools/lophn/resolve.ts`, `run-loop/prepare.ts`, `tools/app-public.ts`, `run-loop/runtime-access.ts`(machine 자격 목록).
- 쓰는 곳: shell Grants 탭 `packages/shell/renderer/workspace/agents/core-grants.ts`(`readGrants`, `saveGrants`), `editor/{grants-panel.tsx,grants-model.ts,agent-editor.tsx}`, `conversation/agent-tab-core-source-sessions.ts`(`/permissions` 읽기).
- test: `approvals/assignment/commands_test.ts`, `approvals/gate/judge_test.ts`, `lophn-agent/tools/app-public_test.ts`, `apps/calls/calls_test.ts`, `apps/usage/users_test.ts`, `main/daemon/wiring/approvals_test.ts`, `shell/.../editor/grants-model_test.ts`, `workspace/agents/core-source_test.ts`, `tests/e2e/{app-call,app-data-rewind,session}_test.ts`.

## 앱 선언과 release

- 검사: `packages/protocol/apps/declaration/`의 `types.ts`(`DECLARATION_KEYS`, 없어도 되는 칸은 `icon` 하나), `tools.ts`(`validateLayers`), `value.ts`(`validateDeclaration`), `read.ts`, `mod.ts`, test `validate_test.ts`.
- SDK: `packages/sdk/declaration/{define,mod}.ts`, `package.json` 2.0.0. `packages/core/apps/packages/vendor.ts`의 `DECLARATION`이 protocol 파일 목록을 vendor한다(새 파일은 목록에 더한다).
- 2.0.0이 박힌 곳: `packages/sdk/declaration/package.json`, `packages/sdk/app-ui/package.json`, `package-lock.json`, `packages/core/apps/packages/template/app/{package.json.tmpl,lophn.ts.tmpl}`, `tests/support/app/sample/lophn.ts.tmpl`. 같은 판의 SDK byte를 바꾸면 기존 앱의 `npm ci`가 깨진다(`change-log/0.14.0.md`).
- 준비(`packages/core/main/worker/release-job.ts`): `prepare/from-source.ts`(commit 풀기, SDK sync, install, 선언 평가, UI build) → `prepare/flow.ts`(`extractDeclaration`, icon 검사, `bundle/seal.ts`의 `writeBundle`) → `prepare/checks.ts` → machine command `release.record`(`releases/commands.ts`, `releases/public-tools.ts`의 `removedPublicToolsOf`; protocol `apps/releases.ts`, `apps/activation/activation.ts`; CLI `cli/commands/release.ts`).
- bundle: `<data>/apps/<app>/bundles/<hash>/`(0444/0555, `protocol/apps/app-storage.ts`의 `appBundleCopy`). commit의 모든 파일이 들어 있다. bundle 파일 읽기 본보기: `apps/screens/icon.ts`의 `readAppIcon`(`bundleLocatorOf(...).dir({mode: "live", app, release: null})`, realPath 안 확인, `readFile`).
- template `.gitignore.tmpl`은 `.lophn/`, `dist/`, `node_modules/`를 뺀다. SDK 사본은 `.lophn/sdk`(`APP_SDK_FOLDER`).

## 대기 목록

- turn 요청(`protocol/approvals/turn-request.ts`, `core/approvals/turn-requests.ts`)은 메모리에 있고 turn이 끝나면 닫힌다. turn을 넘는 요청에는 맞지 않는다.
- 남는 요청 본보기: activation 동의(ledger `activation_consents`, `protocol/apps/activation/consent.ts`의 `activation.ask_consent`·`activation.consent`, `core/apps/releases/activation/consents.ts`, transient event `ActivationConsentRequested`·`ActivationConsentClosed`), job 승인(`protocol/jobs/jobs.ts`, `core/jobs/*`).
- shell: `packages/shell/renderer/desktop/connection/`의 `events/waiting-store.ts`(`WaitingEntry`, `WAITING_CONDITION.types`), `events/snapshots.ts`, `waiting/{decide.ts,model.ts,waiting-panel.tsx,fake-source.ts}`, `waiting/cards/*.tsx`, `events/waiting-store_test.ts`, 알림 `packages/shell/main/notice`, `renderer/workspace/reactions/toast-handler.ts`.

## coding agent harness

- `packages/coding-agent/harnesses/install.ts`: `RETIRED_SKILL_NAMES`, `removeRetiredSkills()`, `thinBody()`. `InstallPorts`(`install-common.ts`)의 `remove`는 재귀가 아니다.
- adapter `skill_dir`(`packages/protocol/coding-agent/harness-adapter.ts`): claude `.claude/skills`, codex `.agents/skills`, opencode `.config/opencode/skills`, pi `.agents/skills`, 그 밖 null.
- 진입: `packages/coding-agent/local/harness-run.ts`(`lophn harness install|status|uninstall`), shell main `shell/main/terminal/agent/hook-install.ts`(`runCli`).
- hook(`packages/coding-agent/local/hook.ts`)은 shell의 터미널 hook socket에 한 줄을 쓸 뿐 core를 부르지 않는다.

## CLI 명령 표

- `packages/cli/commands/mod.ts`의 `COMMANDS`. `defineCommand({name, summary, description, input, positional, effect, routes, places, run})`. `routes`가 agent 자격 상한을 정한다(`packages/core/agent-places/credentials.ts`). place 목록은 `agent-places/tool-lists.ts`(`tool-lists_test.ts`), prompt 글 `agent-places/prompts/prompts.ts`.
