# ext-host

extension host(registry, CLI를 띄우는 spawner, ACP handle, tool 호출)와 본체 안 extension 둘(`harness`, `harness-gui`와 녹화 60개)을 core에서 돌린다. Settings › Extensions가 route를 쓰고, agent의 extension tool은 core가 바로 부른다. 화면 없는 harness turn은 shell 없이 시작한다.

- 단위: ext (wave 2)
- 선행: `term-contract`.
- 소유(이 task만 고친다):
  - `packages/core/extensions/`(`ports.ts`는 계약이라 고치지 않는다)
  - `packages/core/main/daemon/wiring/extensions.ts`(새 file), `packages/core/main/daemon/wiring/extension-tools.ts`, `packages/core/main/daemon/wiring/harness.ts`
  - `packages/shell/main/desktop/wiring/extensions.ts`, `packages/shell/main/desktop/core/allowlist.ts`
  - `packages/shell/ipc/extensions.ts`, `packages/shell/preload/extensions-api.ts`, `packages/shell/preload/shell.ts`
  - `packages/shell/renderer/desktop/settings/extension-packages/`, `packages/shell/renderer/commands/extension-keys.ts`, `packages/shell/renderer/desktop/main.tsx`
  - `project-docs/flows/tests/core-extensions.yaml`, `project-docs/flows/tests/shell.yaml`, `project-docs/flows/areas/ipc.yaml`
- 읽을 것:
  - 계획 README "정한 것"(일을 가진 process, code는 core 쪽으로, 화면은 route로만, 사람의 환경)
  - 계약: `project-docs/plan/core-terminals/tasks/term-contract.md` "고정할 모양"(자리, 옮기는 법, `extensions/routes.ts`, `GUI_HANDOFF`, core port)
  - architecture: `project-docs/architecture/coding-agent.md`(harness agent, "core는 사람의 PATH를 모른다"는 옛 이유), `project-docs/architecture/harness-gui.md` 지키는 것, skill `.claude/skills/harness-gui/SKILL.md`(녹화 재생 test, 실제 CLI·model 금지)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `extension-host`, `shell-extension`, `harness-host-core`
  - 조사 `reports/multi-device/survey-s3-shell-work.md` 1.3, 1.4, 그룹 F·G, 5.4
  - 지금 code: `packages/shell/main/extensions/`, `packages/shell/main/desktop/wiring/extensions.ts`(`createSpawner`, `createAcp`, `register`, Settings IPC, tool 실행, 다시 맞추기 poll), `packages/core/main/daemon/wiring/{extension-tools,harness,idle}.ts`(idle은 in-process 호출의 본보기), `packages/protocol/extensions/{manifest,acp-session}.ts`, `packages/protocol/lophn-agent/{extension-tools,harness-host}.ts`
- 계약:
  - 쓰는 것: `packages/protocol/extensions/routes.ts`(`extensions/list|install|remove|run`, `ExtensionView`), `GUI_HANDOFF`, `packages/core/extensions/ports.ts`의 `ExtensionHost`, `ctx.extensionHost`(`Late`), `ctx.personEnv`(`term-host`가 낸다)
  - 내놓는 것: `ctx.extensionHost`. `coding-core`가 `tabHandlers()`로 harness-gui의 `onTab`을 받아 터미널 탭을 GUI로 바꾼다.

## 할 일

1. **사본.** 계약의 "옮기는 법"대로 `packages/shell/main/extensions/registry.ts`·`registry_test.ts`·`extension-tools_test.ts`와 `bundled/harness/`, `bundled/harness-gui/`(adapter, test, `fixtures/` 전부)를 `packages/core/extensions/` 아래 같은 꼴로 복사한다. shell 원본은 `term-desktop`이 지운다. adapter의 import는 상대 경로 깊이만 바뀐다(`tools/check-deps.ts`의 extension 규칙: protocol, base, 자기 폴더만). harness-gui adapter 표의 handoff는 protocol `GUI_HANDOFF`를 쓴다.
2. **host.** `ExtensionHost`를 `packages/core/extensions/`에 구현한다. spawner는 `createSpawner`(process group, SIGTERM 뒤 3초에 SIGKILL, 멈출 때 모두 끝내기)를 가져오고 env는 `ctx.personEnv.env()`를 바탕으로 PATH 앞에 `ctx.personEnv.cli`의 폴더를 둔다(`LOPHN_CLI` env를 읽지 않는다). login env는 `term-host`가 읽으므로 여기서 다시 읽지 않는다. ACP handle은 `createAcp`(`reduceAcp`로 접기)를 가져온다. `ctx.core.call`은 HTTP를 거치지 않고 core handler를 사람 자격(actor `user`)의 내부 context로 부른다(본보기: `wiring/idle.ts`가 machine context로 read를 부르는 길). 새 자격 종류를 만들지 않는다. 설정(`extensions.<id>.enabled`)은 `ctx.settings`로 읽고, Bus의 `StateChanged{settings}`를 들어 바뀌면 다시 맞춘다(본보기 `wiring/remote.ts`. shell의 1초 poll은 가져오지 않는다). bundled 폴더는 개발이면 `packages/core/extensions/bundled`, 설치본이면 지금 `tools/package/main.ts`의 `stageExtensions`가 두는 `<resources>/extensions`다.
3. **wiring.** `wiring/extensions.ts`가 `ctx.extensionHost`를 내고 `extensions/list|install|remove|run` handler를 둔다(user만). `closeWork`에서 host를 멈춘다(도는 headless turn은 지금처럼 `failed/target_unavailable`). core가 뜰 때 한 번, 설정이 바뀔 때 맞춘다.
4. **tool 호출.** `wiring/extension-tools.ts`: tool 목록은 shell의 `publish`가 아니라 `ctx.extensionHost.catalog()`에서 읽고, 호출은 Gate `extension_tool` 판정과 그 호출만의 agent 자격 lease를 그대로 둔 채 host queue(`callTool`) 대신 `ctx.extensionHost.callTool`로 부른다. `extension_tools/publish` route의 handler는 지우지 않는다(route는 `term-cleanup`이 지운다. 부르는 쪽이 없어진다).
5. **headless harness.** core 안 `harness` extension이 `harness/take`를 가져간다. `wiring/harness.ts`의 route가 actor `user`만 받는 것이 2의 내부 context로 통하는지 보고, 막히면 계약 바꾸기 요청으로 적는다. host가 하나라는 가정(`take`가 queue 머리를 준다)은 그대로다: shell은 이제 `harness`를 켜지 않는다(6).
6. **shell 쪽.** `packages/shell/main/desktop/wiring/extensions.ts`에서 tool 목록 올리기, `tool_call` 실행, Settings IPC(`shell:extensions`), `harness` extension 켜기를 지운다. shell의 registry는 shell PTY의 탭 GUI(`TabGui`)를 위해 `harness-gui`만 `term-desktop`까지 계속 켠다. Settings › Extensions(`extension-packages/`, 지금은 `core-source.ts`가 preload의 `lophnExtensions`를 부른다)와 `extension-keys.ts`는 renderer의 core 통로(`core.call`, 켜기·끄기를 쓰는 SettingsSource와 같은 길)로 `extensions/*` route를 부른다. `allowlist.ts`의 `RENDERER_MEMORY_ROUTES`에 `extensions/install|remove|run`을 더하고(`list`는 read라 저절로 열린다) `ipc/extensions.ts`·preload의 extensions API를 지운다.
7. **build와 packaging.** extension bundle의 entry가 `packages/core/extensions/bundled/<id>/index.ts`로, 개발 실행의 dist가 그 옆 `dist/`로, 설치본 `stageExtensions`가 새 자리에서 읽게 바뀌어야 한다. `packages/shell/main/build.ts`와 `tools/package/main.ts`는 `term-host`의 것이라 고치지 않고 바꿀 줄을 보고에 적는다. Agent SDK(`@anthropic-ai/claude-agent-sdk`)는 bundle에만 들어가므로 `packages/core/package.json`에 넣지 않는다(설치본의 `platform/`이 OS별 claude 사본을 받게 된다).
8. flows: 새 test file은 `project-docs/flows/tests/core-extensions.yaml`, 지운 shell test는 `tests/shell.yaml`, 지운 IPC channel은 `areas/ipc.yaml`(`flows` skill).

### 정한 것
- 설정 바뀜으로 다시 맞춘다: core 안에서는 설정 store를 바로 들어 1초 poll이 필요 없다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "옮긴 뒤 harness-gui adapter의 녹화 60개가 그대로 통과한다". `packages/core/extensions/bundled/harness-gui/*_test.ts`가 고치지 않은 `fixtures/<harness>/*.jsonl` 60개(`find packages/core/extensions/bundled/harness-gui/fixtures -name "*.jsonl" | wc -l`이 60)를 재생해 통과한다. test의 단정을 바꾸지 않는다. 실제 coding CLI와 provider를 부르지 않는다(recorder `fixtures/*/record.ts`는 돌리지 않는다).
- 지킬 것: `packages/core/main/daemon/wiring/extension-tools_test.ts`("a tool call credential reaches only lophn commands of its own session and stops with the call")가 새 호출 길에서도 통과한다. 권한 경계라 지우거나 약하게 하지 않는다.
- 남지 않음: `grep -rn "EXTENSIONS_CHANNEL\|extensionsCallSchema\|ipc/extensions" packages tools tests`가 0줄이다. `grep -n "callTool\|extensionToolsPublish" packages/core/main/daemon/wiring/extension-tools.ts`에 host queue 호출과 publish로 목록을 채우는 줄이 없다.
- 새 E2E와 subprocess·서버를 띄우는 test는 만들지 않는다. `bundled/harness/host.ts`에 test가 없는 것은 지금과 같다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 이 task는 적어도 `EXTENSION_ROUTES`의 등록(`packages/protocol/registry.ts`), `extensionsWiring`의 `WIRINGS` 자리(`extensionToolsWiring` 앞), module catalog의 `packages/shell/main` notes에서 extensions/ 설명을 고칠 줄을 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳(7의 `build.ts`·`tools/package/main.ts` 줄을 여기 적는다)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## lead가 더함

- 추가 소유: `project-docs/flows/areas/shell-desktop.yaml`에서 이 task가 지운 `ipc:shell:extensions`와 shell extension code path를 가리키는 줄만 고친다.
- `packages/protocol/extensions/mod.ts`는 shell main의 strict tsc가 읽는다. `routes.ts`는 route machinery를 끌어오므로 그 mod.ts에 export하지 말고 쓰는 곳에서 `routes.ts`를 바로 import한다. route 등록(`EXTENSION_ROUTES`를 `packages/protocol/registry.ts`에)은 보고의 "등록할 것"에 적는다.
- `ctx.personEnv`는 `term-host`가 같은 wave에서 낸다. 이 task는 `ctx.peek.personEnv`나 늦게 읽기로 쓰고, 그 값이 아직 없는 plan branch에서도 type check와 기동이 통과해야 한다(없으면 core의 `process.env`와 `cli: null`로 돈다). `term-host`가 먼저 merge된다.
