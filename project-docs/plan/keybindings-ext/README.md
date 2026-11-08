# keybindings-ext: key context, 연속 key, extension·앱 key, harness GUI parity

- 목표: keybinding service에 key context와 2타 연속 key를 넣고, command id를 열어 extension(manifest)과 앱(SDK)이 command와 key를 낸다. harness GUI는 harness마다 CLI와 같은 key로 돈다.
- 재료: `project-docs/products/roadmap/keybindings.md`(정한 것 1-12, 조사 표), `project-docs/architecture/keybindings.md`, `project-docs/architecture/extension.md`, `project-docs/architecture/harness-gui.md`, `.claude/skills/harness-gui/SKILL.md`, `.claude/skills/sdk-note/SKILL.md`
- 범위 밖: `when` 식 언어, 3타 이상, OS 전역 key 등록, CLI 설정 file 읽기, 외부 편집기

## 정한 것 (계약)

- **context는 DOM 속성이다.** 요소에 `data-key-context="<이름>"`을 단다. keydown 때 event target에서 위로 올라가며 만난 이름이 안쪽부터의 stack이고, 맨 끝은 늘 `global`이다. 따로 등록하는 저장소를 두지 않는다. 터미널처럼 Ctrl+letter를 자기가 가져야 하는 context는 service에 `defineContext(name, {owns(chord): boolean})`로 알린다(지금 `shellOwns` 규칙이 `terminal`의 `owns`가 된다). 이름: `terminal`, `agentView`, `agentView:<harness>`(GUI 탭만, harness는 `claude|codex|opencode|omp`), `composer`, `slashMenu`, `modal`, `app:<app id>`, `browser`. (agent: 가장 단순한 꼴, roadmap 정한 것 3)
- **binding은 `context?`를 가진다.** 맞추는 순서: 안쪽 context부터, 그 context의 binding 중 사용자 > 등록 > 기본(같은 층이면 나중 것), 다음 context, 마지막에 context 없는 binding. 맞은 것 중 `canRun`(command의 `when`)이 참인 첫 것을 실행한다. 바깥 context가 `owns`한 chord는 그보다 바깥 binding이 받지 않는다.
- **연속 key**: chord 글은 한 타 또는 공백으로 이은 두 타(`"Ctrl+KeyX Ctrl+KeyE"`, `"Escape Escape"`). 첫 타가 지금 `canRun`이 참인 두 타 binding의 머리이면 기다린다(1500ms). 기다리는 동안 둘째 타가 맞으면 그것을, 다른 key면 첫 타를 버리고 그 key를 새로 맞추고, timeout이면 첫 타의 홑 binding을 실행한다. 머리인 두 타 binding이 모두 `canRun` 거짓이면 기다리지 않고 홑 binding을 바로 실행한다. 그래서 turn이 도는 동안 Escape는 바로 멈추고(`agent.rewind`의 `when`이 거짓), 쉬는 동안 Escape Escape가 rewind다.
- **id**: 내장은 지금 id(`Command` union). extension `ext.<extension id>.<name>`, 앱 `app.<app id>.<name>`, harness GUI 공통 `agent.<name>`(내장 union에 더한다). `parseBindingId`·`parseKeyOverrides`는 이 꼴의 id를 받고 지금 없는 id의 사용자 설정도 남긴다. `shell.keybindings` 모양은 그대로다.
- **agent command**(내장, 기본 key와 context): `agent.send` Enter(composer), `agent.newline` Shift+Enter(composer), `agent.interrupt` Escape(agentView), `agent.model-picker` Ctrl/Cmd+Shift+M(agentView), `agent.find` Ctrl/Cmd+F(agentView), `agent.jump-previous`·`agent.jump-next` Alt+↑↓(agentView), `agent.cycle-mode`, `agent.send-now`, `agent.queue`, `agent.rewind`, `agent.history-previous`·`agent.history-next`, `agent.history-search`, `agent.background`, `agent.toggle-details`, `agent.clear-input`(기본 key 없음, harness keymap이 낸다).
- **harness keymap**은 harness-gui manifest의 `contributes.keybindings`다(context `agentView:<harness>`). 값은 roadmap의 조사 표대로: Claude Shift+Tab mode·Ctrl+Enter send now·`Ctrl+X Enter` queue·`Escape Escape` rewind·↑↓ history·Ctrl+R 검색·Ctrl+B background·Ctrl+O details·Ctrl+C clear-input/interrupt, Codex Shift+Tab mode·Tab queue·`Escape Escape` rewind·Ctrl+R·Ctrl+T details, OpenCode Shift+Tab mode·`Ctrl+KeyX Enter` queue·`Ctrl+KeyX KeyU` rewind·Ctrl+B background·↑↓, omp Shift+Tab mode(thinking)·Ctrl+Q queue·`Escape Escape` rewind·Ctrl+R·Ctrl+O details. Ctrl+C·Ctrl+J newline은 넷 다.
- **GUI 안에서는 CLI key가 이긴다**(roadmap 10): `agentView:<harness>`가 `owns`로 그 harness keymap의 Ctrl+letter를 가진다. Ctrl+C는 고른 글이 있으면 `when`이 거짓이라 복사로 지나간다.

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `key-core` | context stack, 연속 key, 동적 id 저장·검증, Settings의 동적 행, palette·home·북마크·터미널 복사를 표로, `shellOwns`를 `terminal` context로 |
| 2 | `key-ext` | manifest `contributes`, `ctx.commands`, renderer로 넘기기, harness-gui keymap |
| 2 | `key-app` | 선언 `keys`, `@lophn/app-ui` `useCommand`, guest preload 맞추기와 shell로 넘기기, SDK 판·메모 |
| 3 | `key-agent` | agent view·composer·slash menu·찾기·thread index key를 command와 context로, 있는 동작에 agent command 잇기 |
| 4 | `key-parity` | 입력 history ↑↓·Ctrl+R 검색, ACP `background_tool` 입력과 adapter 넷, details 펼치기 |

## lead가 할 일

- `key-core`가 끝나면 그 계약(type 이름, `defineContext`, 연속 key 글)을 wave 2 worker prompt에 적는다.
- `key-parity`의 ACP 입력은 계약 → core·adapter → 화면 순서로 같은 task에서 한다(harness-gui skill "session 기능은 ACP로"). 녹화가 필요하면 사람에게 묻고 사람이 `!`로 돌린다.
- 화면을 바꾼 task 뒤에는 gallery `harness-gui-perf`로 key 입력 지연을 한 번 잰다(harness-gui skill "화면 성능은 추측하지 말고 잰다").
- 다 끝나면 `project-docs/architecture/keybindings.md`("넣지 않은 것"에서 context·연속 key·extension key를 지운다), `extension.md`, `harness-gui.md`, changelog, 사람에게 CLI마다 눌러 볼 key 목록.
