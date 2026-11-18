# fix-terminals

터미널을 열면서 치는 것(`terminals/open`의 `command`·`resume`)도 터미널 입력 허락을 보게 하고, 터미널 응답 channel에 검사를 되살리고, extension CLI가 core의 내부 env를 물려받지 않게 하고, 틀린 `resume`이 던지지 않게 하고, mac 설치본의 `spawn-helper`에 실행 권한을 주고, core가 죽을 때 extension CLI가 남지 않게 한다. `core-terminals`가 남긴 옛것, 문서, 이슈의 낡은 path를 고친다.

- 단위: fix (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/terminals/{routes.ts,service.ts}`
  - `packages/core/main/daemon/wiring/{terminals.ts,terminals_test.ts}`
  - `packages/core/extensions/spawner.ts`
  - `packages/core/terminal-agents/bridge/run-dir.ts`
  - `packages/core/config/shell-settings.ts`(`:267` 주석 한 줄)
  - `packages/core/extensions/bundled/harness-gui/fixtures/{antigravity,claude,codex,omp,opencode}/record.ts`(머리 주석만)
  - `packages/core/package.json`, `packages/shell/main/package.json`, `package-lock.json`
  - `packages/shell/main/desktop/paths.ts`, `tools/dev.ts`(`LOPHN_CLI` 줄만)
  - `tools/package/main.ts`, `tools/package/{spawn-helper.ts,spawn-helper_test.ts}`(새 file)
  - `packages/shell/ipc/terminal.ts`, `packages/shell/preload/terminal-api.ts`
  - `packages/shell/main/desktop/{terminal-focus.ts,terminal-focus_test.ts}`(test는 새 file), `packages/shell/main/desktop/wiring/terminal.ts`
  - `packages/shell/renderer/terminal/displays.ts`
  - `project-docs/architecture/{terminal-agent.md,browser-tab.md,coding-agent.md,event.md,layers.md,platform.md}`
  - `project-docs/products/roadmap/{mobile.md,agent-surface.md,app-sdk.md,app-place.md,platform-ipc.md,browser-tab.md}`
  - `.claude/skills/harness-gui/reference.md`
  - `project-docs/flows/areas/{harness.yaml,ipc.yaml,shell-desktop.yaml}`, `project-docs/flows/tests/{shell.yaml,libs-tooling.yaml}`
  - `project-docs/issues/{coding-input-skips-device-scope,coding-input-answered-ok-before-applied,phone-coding-session-takes-no-pictures,phone-cannot-open-terminal-tab,phone-terminal-input-retry-types-twice,windows-hook-cmd-tui-toggle,coding-switch-confirms-stale-plan,phone-coding-session-opens-empty}.yaml`, `project-docs/issues/dev-terminal-cli-reaches-real-root.yaml`(새 file)
- 읽을 것:
  - 계획 README "정한 것 › 경계"의 첫째·둘째 줄, "설치본", "위험 test"
  - review `reports/multi-device/review-core-terminals.md` 전부(finding 1~14, "Docs and catalog pieces checked", "Issues"). `review-device-roster.md` F11의 `terminal-agent.md:68,147,164,212-213`, `layers.md:47-48,54`, `platform.md:130`, `harness.yaml:488`, F1 "Issues"의 `coding-input-skips-device-scope`
  - architecture: `project-docs/architecture/terminal-agent.md`(지키는 것 3, 11, 12, 16~22, "열린 것"), `remote.md`의 터미널 입력 허락 줄
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `host-queue-core`, `harness-host-interface`, `project-docs/module-catalog.yaml:95`
- 계약:
  - 쓰는 것: `terminalsOpen`·`terminalsInput`(`packages/protocol/coding-agent/terminals.ts`, 바꾸지 않는다), `ctx.peek.terminalInputGrant`, `ctx.peek.deviceKind`, `HARNESS_ADAPTERS`, `stripPlatformEnv`의 이름 규칙(`packages/core/terminals/host/env.ts`)
  - 내놓는 것: IPC channel `shell:terminal-shown`(`TERMINAL_SHOWN_CHANNEL`, 입력 `{terminal, shown: boolean}`), `TerminalApi.shown`

시작 전에 다시 볼 것: `core-browser`의 `page-host`가 `harness.yaml`과 `tests/core-rest.yaml`을 소유한다. `status.py ready`가 거르는 대로 띄운다. 띄울 때 `harness.yaml`의 `terminals-open`·`host-shell-launch` 둘레를 merge된 것으로 다시 본다.

## 할 일

1. 열면서 치기의 자격(finding 1, README "터미널을 열면서 치는 것도 입력이다"). `routes.ts`의 `open`이 `input`처럼 principal을 받는다. 부른 쪽이 기기(`deps.isDevice(principal)`. wiring은 `ctx.peek.deviceKind?.(principal) != null`)이고 `deps.granted(principal)`가 아니면 `command`나 `resume`을 실은 열기는 터미널을 열기 전에 `forbidden`이다. 둘 다 없으면 빈 터미널을 연다. 기기가 아닌 사람 화면(renderer, shell main)의 열기는 지금 그대로다. `wiring/terminals.ts`의 `terminalsOpen` handler가 `who.principal`을 넘긴다.
2. 허락의 범위(finding 2, README "허락받은 기기는 그 기계의 어느 터미널에나 친다"). code는 바꾸지 않는다. `terminal-agent.md`의 입력 자격 지키는 것에 "기기의 허락은 그 기계를 온전히 다루는 권한이라 보이는 터미널로 좁히지 않는다. 열면서 치는 `command`·`resume`도 같은 허락을 본다"를 적는다.
3. 응답 channel(finding 3). 창이 보이는 터미널만 응답을 친다. 새 IPC `shell:terminal-shown {terminal, shown}`을 `packages/shell/ipc/terminal.ts`(schema, channel 상수, `TerminalApi.shown`)와 `terminal-api.ts`에 더한다. `displays.ts`는 display가 ref를 얻을 때 `shown: true`, 놓을 때(watch를 끌 때) `shown: false`를 보낸다. `TerminalFocusTable`이 webContents마다 보이는 터미널 set을 들고(`show`, `hide`, `shows`, `forget`이 같이 지운다), `wiring/terminal.ts`의 `TERMINAL_RESPONSE_CHANNEL`은 sender가 그 터미널을 보이지 않으면 core를 부르지 않고 거절한다. 세 channel(input, response, restart)의 판정을 `terminal-focus.ts`의 순수 함수 하나로 모아 test가 Electron 없이 부르게 한다. `terminal-agent.md:133,160`을 고친다(응답은 focus가 아니라 "그 창이 보이는 터미널"을 본다).
4. 틀린 `resume`(finding 7). `service.ts`의 `resumeLine`은 `Object.hasOwn(HARNESS_ADAPTERS, resume.harness)`로 본다. `routes.ts`의 `once`는 run이 던져도(rejected) 그 key를 표에서 지운다.
5. extension CLI의 env(finding 5). `spawner.ts`의 `cliEnv`는 `base`에서 `ELECTRON_*`와 `LOPHN_*` 이름을 지운다(터미널의 `INTERNAL_NAME`과 같은 규칙). 그 뒤 `LOPHN_HOME`과 `given`을 얹는다: 탭의 session 표지(`LOPHN_SESSION_ID`)와 hook env는 `given`으로 그대로 온다. 지금 이름이 맞는 `SESSION_ENV_NAME` 처리는 이 규칙에 든다.
6. core가 죽을 때(finding 8). 고치지 않고 확인해서 이슈로 올린다. 실제 harness CLI를 띄우지 않는다(provider를 부를 수 있다). `createSpawner`가 띄우는 것과 같은 꼴(`detached`, 자기 process group)로 `sleep`을 띄우는 작은 parent script를 `.dev-data/fix-terminals/`에 두고 `kill -9`한 뒤 group이 남는지 본다. 남으면 `project-docs/issues/extension-cli-outlives-core-crash.yaml`(kind bug, topic `terminal-agent`)에 본 것과 고치는 안(group 맨 앞의 watchdog, core가 다시 뜰 때 남은 group 정리)을 적는다(`issue` skill). 남지 않으면 보고에 그렇게 적는다. 이 script를 test file로 남기지 않는다.
7. mac `spawn-helper`(finding 6, README "설치본"). `tools/package/spawn-helper.ts`에 `markSpawnHelpers(nodeModules: string)`: `node-pty/prebuilds/darwin-*/spawn-helper`마다 mode를 0755로 하고 고친 path를 돌려준다. `main.ts`의 `stagePlatform`이 `npm ci` 뒤에 부른다. mac에서 돌려 보지 못한다. 실제 확인은 lead가 사람에게 부탁한다.
8. 옛것(finding 9): `paths.ts`의 `lophnCliPath`(쓰는 곳 없음)를 지운다. `tools/dev.ts:585-586`은 `writeDevCli` 호출을 남기고(core의 `person-env.ts`가 그 launcher를 찾는다) `shellEnv["LOPHN_CLI"]` 대입과 틀린 주석을 지운다. `packages/shell/main/package.json`에서 core bundled extension만 쓰는 `@anthropic-ai/claude-agent-sdk`, `ws`, `yaml`과 node-pty를 다시 build하는 `postinstall`을 지우고, core가 import하는 것은 `packages/core/package.json`에 같은 정확한 판으로 둔다(`npm install`로 `package-lock.json`을 다시 만든다. shell main이 아직 import하는 것이 있으면 남긴다). `shell-settings.ts:267`과 harness-gui `record.ts` 머리 주석의 옛 path를 지금 path로. `run-dir.ts`의 정리가 옛 `shell-<pid>` 폴더도 지운다. `terminal-link.ts`의 link 규칙 사본은 남긴다(shell이 core를 import하지 못한다. 보고에 적는다).
9. re-attach test(finding 14). `terminals_test.ts:240-312`에서 test 안에 쓴 client 고리(`drain`·`resync`, `used`)를 지우고 core가 지키는 것(lease 동안만 Bus에 가는 seq, `after_seq` snapshot이 놓친 출력을 준다)만 남긴다. client 규칙은 `packages/shell/renderer/terminal/displays_test.ts`가 본다.
10. 문서(finding 10과 roster review F11): `browser-tab.md:38,90,139,145`(core `packages/core/terminal-agents/bridge/`, `core-<pid>`, 지운 `shell:terminal-bridge-*`), `coding-agent.md:84`(hook 물음은 link가 닫힐 때만 거절), `event.md:122,131`(`/host-link`가 싣는 것, session 집합은 core), `layers.md:57`(coding-agent가 shell의 터미널 host를 쓰지 않는다), `layers.md:47-48,54`(`remote-client`에 기대는 것은 core다. `tools/check-deps.ts:37`), `platform.md:255`(터미널이 열려 있으면 idle-exit하지 않는다), `platform.md:130`(`pairing/start`), `terminal-agent.md:68,147,164,212-213`(허락은 명단 칸: `roster/set_terminal_input`, `roster/invite`), `.claude/skills/harness-gui/reference.md:19,58`(`terminalName`, `packages/protocol/lophn-agent/session-tag.ts`), 위 roadmap 여섯의 옛 shell path와 IPC 이름.
11. 이슈(finding 11, 12): `issue` skill대로. 위 소유의 여덟 이슈에서 옛 path(`packages/shell/main/terminal/*`, `ctx.codingRelay`, `core/terminal-view/view.ts`)를 지금 path로, `phone-coding-session-takes-no-pictures`의 guard를 `packages/core/terminal-agents/gui_test.ts`로, `phone-cannot-open-terminal-tab`의 닫은 글을 `terminals/open`으로 고친다. `coding-input-skips-device-scope`의 impact에 연결된 컴퓨터도 기기 자격을 받는다는 것을 더한다. 새 이슈 `dev-terminal-cli-reaches-real-root`(kind bug): 개발 core의 터미널 PATH에 dev launcher는 있는데 `LOPHN_HOME`이 없어 그 터미널에서 친 `lophn`이 사람의 `~/.lophn`에 닿고 설치본 core를 띄울 수 있다(`terminal-agent.md` "열린 것"). 쓰기 전에 code와 대조한다.
12. flows(`flows` skill): `harness.yaml`의 `terminals-open`(기기의 `command`·`resume` forbidden), `terminal-respond`(보이지 않는 터미널 거절), 새 channel의 flow, `harness-take`·`harness-turn-*`·`harness-session-bind`의 `actor: shell`과 "shell main의 extension harness host"(`:4-190`), `:488`("kind desktop 기기"). `ipc.yaml`에 `ipc:shell:terminal-shown`. `shell-desktop.yaml`의 `extension-sync`(`:569`). `tests/shell.yaml`에 `terminal-focus_test.ts`, `tests/libs-tooling.yaml`에 `spawn-helper_test.ts`. `projects.yaml:2044-2069`(`fix-identity`의 file)와 `tests/core-rest.yaml`(`terminals_test.ts` covers, `:614,650-674` "shell 원본의 사본" note)에 고칠 글은 보고에 적는다.

정한 것:
- 응답 검사는 새 channel `shell:terminal-shown`으로 한다: 창이 어떤 터미널을 보이는지는 renderer만 알고(출력 lease는 core에 바로 간다), focus channel에 뜻을 섞으면 blur가 focus를 지운다.
- core가 죽을 때 남는 CLI는 이 task에서 고치지 않는다: review가 돌려 보지 못한 것이고, CLI 앞에 process 하나를 끼우는 고침은 모든 harness adapter의 stdio 길을 바꾼다. 확인하고 이슈로 넘긴다.

## 끝남

- `npm run check`가 통과한다. `node packages/shell/renderer/build.ts`가 된다.
- 위험 test(`packages/core/main/daemon/wiring/terminals_test.ts`의 입력 자격 표): "터미널 입력 허락이 없는 기기가 `terminals/open`에 `command`나 `resume`을 실으면 치지 않는다". 그 기기의 열기가 `forbidden`이고 가짜 host에 쓰인 것이 없다. 같은 기기의 빈 열기와 허락받은 기기의 `command` 열기, 사람 화면의 `command` 열기는 된다.
- test(`packages/shell/main/desktop/terminal-focus_test.ts`, Electron 없이): focus가 없는 창의 input·restart와 그 터미널을 보이지 않는 창의 response는 core에 가지 않는다. `isAllowed`(`packages/shell/main/desktop/core/allowlist.ts`)가 renderer에게 `terminals/input`·`terminals/restart`를 열지 않는다(finding 4).
- test(`tools/package/spawn-helper_test.ts`, 임시 폴더): `darwin-*/spawn-helper`만 0755가 되고 다른 file의 mode는 그대로다.
- subprocess·Electron을 띄우는 test와 E2E를 새로 만들지 않는다.
- 남지 않음: `grep -rn "lophnCliPath\|shellEnv\[\"LOPHN_CLI\"\]\|resume.harness in HARNESS_ADAPTERS" packages tools tests`, `grep -rn "packages/shell/main/extensions\|packages/shell/terminal-host\|browser-bridge/policy" packages tools tests .claude/skills`, `grep -rn "terminal_view/open\|devices/set_terminal_input\|pairing/start\|devices/register\|shell-<pid>" project-docs/architecture .claude/skills | grep -v remote.md`가 0줄이다(`remote.md:345`는 `fix-roster`가 고친다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). `boundary-catalog.yaml`(`:113-116` `host-queue-core`, `:188`, `:414-433` harness host는 core의 `machine:extensions`), `module-catalog.yaml:95`, `projects.yaml`·`tests/core-rest.yaml`에 넣을 글도 여기 적는다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적어 둘 것: mac 설치본에서 터미널이 열리는지는 확인하지 못했다. Windows의 extension CLI는 core가 죽으면 남을 수 있다
