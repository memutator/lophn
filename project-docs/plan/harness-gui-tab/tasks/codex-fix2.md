# codex-fix2

사람이 Codex GUI를 써 보고 찾은 것(README 정한 것 20, 21, 23, 24, 28)을 Codex adapter에서 고친다: GPT model에 Speed(fast)가 없음, `!` 결과가 agent 것처럼 그려지고 사람 말 아래에 남음, resume 목록 없음, fork 뒤 표시 약함. 조사는 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/round2-others.md`의 §1 Codex, §2, §3, §4에 file:line과 함께 있다.

- 단위: adapter (wave 10)
- 선행: acp-round2
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/codex.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/codex_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/codex/`
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/.cache/harness-gui-research/round2-others.md`(§1 Codex, §2 표의 Codex 줄과 "추천", §3 Codex, §4, 끝의 계약 목록)
  - README 정한 것 20-30(`project-docs/plan/harness-gui-tab/README.md`)
  - architecture: `project-docs/architecture/harness-gui.md`의 "Codex adapter", `project-docs/architecture/acp.md`
  - 설치한 Codex 0.166 protocol type: `/home/pyosechang/projects/lophn/.cache/harness-gui-research/codex-ts-0.166/v2/`의 `Model.ts`·`ModelServiceTier.ts`(serviceTiers, defaultServiceTier), `ThreadSettings.ts`(serviceTier), `TurnStartParams.ts`(serviceTier, serviceTierForTurn), `ThreadShellCommandParams.ts`, `CommandExecutionSource.ts`(`"userShell"`), `ThreadListParams.ts`·`ThreadListResponse.ts`·`Thread.ts`·`ThreadSortKey.ts`
  - Codex source(참고): `/home/pyosechang/projects/harness-lab/codex/codex-cli/codex-rs/tui/src/chatwidget/service_tiers.rs`(TUI `/fast`), `core/src/tasks/user_shell.rs`(user shell 기록), `core/src/event_mapping.rs:126`(history가 shell 문맥 메시지를 거름), `rollout/src/lib.rs:88`(기본 source 목록)
  - 사람 model catalog(읽기만): `~/.codex/opencodex-catalog.json`의 `service_tiers`
- 계약:
  - 쓰는 것(acp-round2가 wave 9에 정한다. 이름이 다르면 main이 맞다):
    - capability `shell`, `resume`
    - 입력 `run_shell {command}`, `open_session {cli_session}`
    - tool item `by: "agent" | "user"`
    - 갱신 `session_reset`
    - model 축 `kind: "choice" | "switch"`
    - `ACP_COMMAND_OPENS`의 `resume`
    - `HarnessGuiRun.sessions?(): Promise<{id, title, updated_at}[]>`(`adapter.ts`)
  - 내놓는 것: Codex `HarnessGuiRun`의 `sessions`. 그 밖에 다른 task가 기대는 것은 없다.

## 할 일

1. **Speed 축**(정한 것 24, 조사 §1 Codex)
   - `modelMeta()`(지금 834-871줄)에서 model마다 effort 축 뒤에 Speed 축을 더한다: `{id: "speed", label: "Speed", kind: "choice", values: [{value: "default", label: "Standard"}, ...serviceTiers.map(t => ({value: t.id, label: t.name}))]}`. `serviceTiers`가 비면 축을 두지 않는다. tier가 "Fast" 하나뿐이어도 `choice`로 둔다(값 이름이 tier 이름이라 `switch`로 줄이면 ultrafast가 있는 model과 모양이 갈린다. 정한 것으로 보고).
   - `Settings`(`settingsOf`, 지금 343줄)에 `serviceTier: string | null`을 더한다. thread/start·resume·fork 답과 `thread/settings/updated`의 `serviceTier`를 읽는다.
   - 지금 값 `options.speed`는 `settings.serviceTier ?? model.defaultServiceTier ?? "default"`이다. 사람 catalog에서 gpt-6-sol·gpt-6-luna는 기본이 `priority`(Fast)다.
   - `set_model`(지금 2812줄)은 `thread/settings/update {threadId, model, effort, serviceTier: options.speed ?? null}`로 보낸다. 고른 model에 Speed 축이 없으면 `serviceTier: null`이다. 실패하면 지금처럼 `attempt`의 warning이다. ultrafast는 feature(`UltrafastMode`)를 몰라 그대로 내고 실패로 안다.
   - TUI로 넘길 때는 shared(같은 server, 같은 thread)라 flag가 필요 없다. 사람 `config.toml`에 쓰지 않는다(TUI `/fast`는 config에 저장하지만 GUI는 thread 설정만 바꾼다).
2. **`!` shell**(정한 것 21, 조사 §2)
   - `CAPABILITIES`(지금 355줄)에 `shell: true`.
   - `run_shell {command}`를 받으면 `thread/shellCommand {threadId, command}`를 보낸다. 도는 turn이 있어도 보낸다(app-server가 도는 turn에 붙인다: `ActiveTurnAuxiliary`). 지금 `send`의 `!` 분기(2681-2693줄)는 `run_shell`과 같은 함수로 옮기고, 도는 중이면 prompt로 보내던 것을 없앤다.
   - `describe()`의 `commandExecution`(지금 1054줄)에서 `item.source === "userShell"`이면 tool item을 `by: "user"`로 낸다(제목 `! <command>`, `body`는 지금처럼 명령과 `aggregatedOutput`). 사람 말풍선을 따로 만들지 않는다. 그 줄이 사람 쪽 줄이다. app-server가 연 turn(사람 메시지 없음)은 `by: "user"` 줄만 있으니 끝에 "Worked for"(turn_end notice)를 붙이지 않는다. 그 turn의 끝은 `turn_ended`만 내고 notice는 내지 않는다.
   - replay(`replay()`, 지금 2241줄)도 같다: userMessage 없이 `commandExecution(userShell)`만 있는 turn을 `by: "user"` tool item으로 그린다. model이 보는 `<user_shell_command>` 문맥 메시지는 history에서 이미 빠진다.
   - TUI처럼 친 글이 `!`로 시작해 `send`로 와도 model로 보내지 않고 `run_shell`과 같이 처리한다.
3. **resume 목록**(정한 것 23, 조사 §3 Codex)
   - `CAPABILITIES.resume: true`. `BASE_COMMANDS`(지금 380줄)에 `{name: "resume", description: "Open an earlier conversation in this folder", hint: null, opens: "resume"}`.
   - `HarnessGuiRun.sessions()`: `thread/list {cwd, sortKey: "updated_at", limit: 30}`을 부르고 `data[]`를 `{id, title: name ?? preview, updated_at: ISO(updatedAt*1000)}`로 옮긴다. 기본 `sourceKinds`는 그대로 둔다(Cli·VSCode. GUI thread는 source가 `"vscode"`라 같이 나온다). 지금 thread는 목록에서 빼지 않는다(화면이 표시한다).
   - `open_session {cli_session}`: 도는 turn이 있으면 info("Stop the running turn before opening another conversation.")로 거절한다. 아니면 `thread/resume {threadId: cli_session, excludeTurns: true, ...policy}` → `switchThread(opened, false)`(지금 2445줄) → `session_reset` 갱신 → `replayThread(root)`·`replayChildren()` → `materialized`를 그 thread 상태로. 이미 붙어 있던 TUI는 옛 thread에 남고 다음 toggle 때 `tuiCommand`가 새 id로 붙는다(조사 §3).
4. **fork 줄**(정한 것 28, 조사 §4): `fork()`(지금 2645줄)의 info를 "Forked from “{앞 제목}”. The original conversation is unchanged."로 바꾸고, `change({title})`로 새 thread 제목을 낸다(app-server가 이름을 주지 않으면 "{앞 제목} (fork)"). `/fork`(메시지 없음)에도 같다.
5. **test**(`codex_test.ts`): 위험 test 둘.
   - "`!ls`는 `thread/shellCommand`로만 가고 `turn/start`·prompt로 가지 않는다. 그 `commandExecution(userShell)`은 `by: "user"` tool item 하나이고 사람 말풍선·turn_end notice가 없다"(손으로 만든 이벤트 몇 줄).
   - "`open_session`은 `thread/resume`에 고른 id를 싣고 `session_reset` 뒤에만 그 thread의 turn을 그린다"(scrub한 fixture `fixtures/codex/resume_list.jsonl` 또는 손으로 만든 답).
   Speed 축은 test하지 않는다(화면·설정 값이고 깨져도 데이터를 잃지 않는다).

## 녹화

새 녹화가 있으면 좋다(lead가 `gpt-6-luna`로 돌리고 원본은 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/codex-v3/`에 둔다). worker는 돌리지 않는다. `fixtures/codex/record.ts`에 scenario를 더하고 중간 보고로 돌리는 명령 한 줄을 알린다.
- `shell`: `thread/shellCommand {command: "ls"}`(turn 없을 때), 도는 turn 중 `thread/shellCommand {command: "echo hi"}`, 끝난 뒤 `thread/turns/list`. 확인할 것: userShell item의 모양, 도는 turn에 붙는지, history의 turn 모양.
- `speed`: `model/list`의 `serviceTiers`(scrub 전 원본), `thread/settings/update {serviceTier: "priority"}` 뒤 `thread/settings/updated`, 짧은 turn 하나, 새 process에서 `thread/resume`의 `serviceTier`(resume 뒤 남는지).
- `list`: `thread/list {cwd, sortKey: "updated_at", limit: 5}`(model 호출 없음).
지키는 것: 지금 `record.ts`의 guard(config 쓰기·영구 승인 금지)를 그대로 쓴다. 원본은 commit하지 않고 scrub한 줄만 fixture로 옮긴다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 위 둘.
- 남지 않음: `grep -n "startsWith(\"!\")" packages/shell/main/extensions/bundled/harness-gui/codex.ts`가 `run_shell`과 같은 함수로 가는 줄 하나뿐이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 특히 녹화 scenario 목록(중간 보고), Speed 축을 `choice`로 둔 이유, resume 뒤 thread의 serviceTier가 남는지(녹화로 확인했으면).
