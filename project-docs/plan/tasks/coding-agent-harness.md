# coding-agent-harness

harness 감지·설치 engine을 새 설계로 줄인다. 감지는 실행 파일·version·로그인을 확인하는 것까지, 설치는 앱 source 폴더에 skill 둘과 hook 설정을 놓는 것까지다. MCP·안내 파일·profile·환경·loading 관측은 지운다. 순수 값은 `protocol/coding-agent`로 옮겨 갔으니 이 package의 `sessions/`와 중복 catalog는 지운다. 배포 skill 본문(`lophn-build-app`, `lophn-repair`)은 CLI 명령에 맞게 다시 쓴다.

- 단위: coding-agent (wave 3)
- 선행: coding-agent-cli (옛 CLI가 engine export를 쓰는 동안은 안 지운다. CLI가 줄어든 뒤 engine을 줄인다)
- 소유(이 task만 고친다):
  - `packages/coding-agent/harnesses/`
  - `packages/coding-agent/guides/`
  - `packages/coding-agent/sessions/`
  - `packages/coding-agent/cli/commands/harness.ts`, `harness-run.ts`(engine 호출이 바뀐 만큼만. 명령 이름과 입출력은 `contract-coding-routes`의 계약 그대로)
- 읽을 것:
  - spec: S6 4장(adapter가 갖는 것), 5장 4, 12장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - inventory: `I1.6#3`(`harnesses/launch.ts`의 `launchOf`), `I1.6#4`(`mcpEntryOf`, catalog의 `config_targets`·`mcp_shape`), `I1.6#5`, `I1.6#6`, `I1.6#9`(`sessions/plan.ts`의 `guideOf`·`OWN_TERMINAL_METHOD`·`SessionGuide`), `I1.6#10`(`sessions/observe`의 관측 socket 쪽), `I1.6#16`(engine은 남긴다), `I1.6#17`, `I1.6#18`, `I1.6#19`, `I2.6#10`, `I2.6#11`, `I2.6#13`, `I2.6#14`, `I2.6#16`, `I2.6#17`, `I2.6#18`, `I2.6#19`, `I2.6#20`, `I2.6#21`, `I2.6#22`, `I3.6#6`, `I3.6#14`, `I2.7#33`(이 package의 안내 skill 쪽만. template와 `sdk/blueprint`는 app-calls와 releases-problems)
  - 결정: `../README.md` 3장 #60
  - 계약: `packages/protocol/coding-agent/harness-adapter.ts`(`HARNESS_ADAPTERS`, `TURN_END_SIGNALS`, `CODING_SKILL_NAMES`), `hook-signal.ts`, `launch-plan.ts`, `cli-commands.ts`(`harness detect|refresh|install`의 입출력)
- 계약:
  - 쓰는 것: 위 계약 file. 감지 결과의 type은 옛 `harnesses.ts`의 `harnessDetectionSchema`(그대로)다.
  - 내놓는 것: CLI가 부르는 두 함수. `detectHarnesses(ports, input) → HarnessDetection[]`(감지. 결과를 저장·재사용하지 않는다. 사람 요청이 오면 다시 한다)와 `installIntoFolder(ports, { harness, folder }) → { skill, hook }`(입출력은 `cli-commands.ts`)

## 할 일

1. **catalog 걷어 내기**(`I2.6#19`): `harnesses/catalog/*.ts` 일곱 file과 `definitions.ts`를 지우고 감지·설치가 `HARNESS_ADAPTERS`를 읽게 한다. `harnesses/model.ts`의 `HarnessDefinition`과 MCP·안내·환경·loading 칸을 지운다. `catalogOf`·`HARNESS_CATALOG`를 쓰던 곳은 adapter 표로 바꾼다.
2. **감지**(`I2.6#20`, `I1.6#18`): `harnesses/detect.ts`, `detection.ts`, `system-ports.ts`는 PATH 탐색, version probe, login probe만 남긴다. 확인하지 못하면 확인 못함(`unknown`)이다. `environments`(wsl·remote), profile 해석, `DetectionCache` 저장을 지운다. `codex_home`·`hermes_home` 같은 root 해석(`resolvers.ts`)은 skill 위치에 필요하면 남기되, 앱 source 폴더 기준 상대 위치로 바뀌므로 쓰이지 않으면 지운다.
3. **설치**(`I2.6#21`, `I2.6#22`, `I3.6#6`): `harnesses/install.ts`, `builder.ts`, `integration/{apply,journal,plan,receipt,remove,tree}.ts`를 `installIntoFolder` 하나로 줄인다.
   - 놓는 것은 둘이다: skill 폴더(`CODING_SKILL_NAMES` 각각을 adapter의 `skill_dir` 아래), hook 설정(adapter의 `hook.path`에 `lophn hook <harness> <event>`를 부르는 항목을 `HOOK_EVENT_TABLE[harness]`의 event마다 넣는다). `plugin_file` 형식(opencode, pi)은 작은 template 문자열로 쓴다.
   - 앱 source 폴더 안만 쓴다. 사용자 전역 설정은 건드리지 않는다. hook이 없는 제품(hermes, openclaw)은 skill만 놓는다.
   - 사람이 고친 파일은 덮지 않는다(S6 4장). 이를 알려고 lophn이 마지막에 쓴 내용의 hash만 남긴다(receipt의 나머지·journal·복구를 지운다). 달라졌으면 결과는 `kept_user_edit`이다. hash 기록 위치는 앱 source 폴더의 git에 안 들어가는 곳(예: `.lophn/` 아래)으로 정하고 보고한다.
   - adapter: `adapters/json.ts`와 `adapters/toml.ts`만 남기고 `region.ts`·`yaml.ts`를 지운다.
4. **삭제**: `harnesses/{mcp-probe,loading,inspect,launch,skills}.ts`(`I1.6#3`, `I1.6#4`, `I1.6#5`), `guides/{managed-files,sync-tools,hook,skill-check,distribution}.ts`(`guides/distribution.ts`가 skill 배포에 필요하면 `installIntoFolder`가 쓰는 만큼만 남긴다), `guides/templates/`(`I1.6#6`), `sessions/` 전체(`I1.6#9`, `I2.6#11`, `I2.6#13`, `I2.6#16`: `launchPlanOf`·`firstPromptOf`·hook 변환은 `protocol/coding-agent`로 옮겨 갔다). `harnesses/selection.ts`(`I1.6#17`)는 지금 코드에 이미 없다. `grep -rn decideDefaultHarness packages`로 확인만 한다.
5. **skill**(`I1.6#19`, `I2.6#10`, `I2.7#33`): `guides/skills/lophn-navigate/`, `lophn-save/`를 지운다. `lophn-build-app/SKILL.md`와 `lophn-repair/SKILL.md`(와 `references/investigation.md`)를 다시 쓴다.
   - MCP tool 이름·`op`, `[Start]` 첫 prompt, 시작 summary, `lophn_app register`, `sdk add`, 앱 command, "CLI는 claim 안 함"을 지운다.
   - CLI 명령으로 쓴다: `lophn ticket show/claim/renew/report`, `lophn release prepare`, `lophn problem …`, `lophn package …`. blueprint나 의존을 바꿔야 하면 직접 고치지 않고 `lophn message send`로 App Engineer에게 요청한다(req-1491).
   - problem code 선언·실패 경로 test 안내를 지운다(`I2.7#33`).
   - `guides/manifest.ts`의 항목과 hash를 갱신한다.
6. **turn 끝 신호 유무 표시**(`I3.6#14`): 이 package에는 칸을 더하지 않는다. 표는 `TURN_END_SIGNALS`다(`harnesses/model.ts`의 `HarnessDefinition`과 함께 사라진다).
7. `harness detect|refresh|install` 명령 file(`cli/commands/harness.ts`, `harness-run.ts`)을 engine 변화에 맞게 고친다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "mcp_shape\|config_targets\|mcpEntryOf\|LOPHN_MCP_TOOLSETS\|lophn_ticket\|lophn-navigate\|lophn-save\|OWN_TERMINAL_METHOD\|stdin_after_ready\|profile_id\|managed-files\|sync-tools" packages/coding-agent`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: `packages/protocol/coding-agent/{harnesses,launch,sessions,guides,cli-setup}.ts`에서 이 package가 더는 import하지 않는 것
- 정한 것:
  - hash 기록 위치
  - `plugin_file` template의 모양과 어떤 event를 듣는지
  - `distribution.ts`를 남겼는지
  - hook 위치를 못 찾아 `hook: null`인 제품의 `harness install` 결과(`not_supported`)
- 계약 바꾸기 요청: `harness install`의 입출력을 바꿔야 하면 여기에 적는다.

- (lead가 더함, coding-agent-cli가 넘긴 것) `harnesses/launch.ts`의 `MCP_ENTRY`는 컴파일용 로컬 const로 남았다. 이 file을 지우거나 고칠 때 같이 걷는다. `guides/skills/{lophn-navigate,lophn-save,lophn-build-app}/SKILL.md`가 지운 MCP tool을 설명한다. 새 CLI(`lophn app|problem|ticket|package|release|message`)로 다시 쓰거나 지운다. `harness install`은 새 engine `installIntoFolder`가 없어 `unavailable`을 낸다. `cli/commands/harness-run.ts`의 `runHarnessInstall` 한 곳만 바꾸면 이어진다. `<H>/integrations` 쓰기 권한은 detection.json 저장을 걷을 때 launch-entry에서 같이 뺀다.
