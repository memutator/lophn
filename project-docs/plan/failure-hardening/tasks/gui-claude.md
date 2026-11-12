# gui-claude

Claude adapter의 CLI control 호출에 기한을 두고(`stop()`도), 입력 처리 실패를 사람에게 보이고, Stop·승인 답이 앞 입력 뒤에 막히지 않게 한다. rewind·fork가 실패하면 앞 session으로 돌아가게 하고, 시작 실패 때 CLI가 남지 않게 하고, stderr와 harness 오류 글의 secret을 가린다.

- 단위: gui (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/claude.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/claude_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/claude/`
- 읽을 것:
  - 계획 README "정한 것"(`project-docs/plan/failure-hardening/README.md`): adapter file마다 task 하나, `failure.ts`를 만들지 않고 ACP error `code`에 공통 오류 코드 일곱을 쓴다
  - skill: `.claude/skills/harness-gui/SKILL.md`를 따른다(녹화는 사람 허락 없이 돌리지 않는다. 이 task는 새 녹화가 필요 없다: 오류 길은 `claude_test.ts`의 `setup()`이 주는 가짜 SDK(`query`, `interrupt`, `rewindFiles`, `forkSession`)와 가짜 process로 본다. 손으로 만든 메시지는 그렇다고 주석에 적는다). 구현 세부는 `.claude/skills/harness-gui/reference.md`의 Claude 절. test는 `.claude/skills/write-test/SKILL.md`
  - architecture: `project-docs/architecture/harness-gui.md` 지키는 것 6, 7과 모델의 "adapter 넷의 모양" Claude Code 줄(restart handoff, rewind)
  - boundary: `project-docs/boundary-catalog.yaml`의 `shell-extension`, `acp`
  - 대조 기록(main checkout 절대 경로): `/home/pyosechang/projects/lophn/research_notes/error-handling-verify/harness-gui.md`의 #7, #14, #19, #26, #30, #34, #35
- 계약:
  - 쓰는 것: adapter 계약 `HarnessGuiAdapter`·`HarnessGuiRun`(`packages/shell/main/extensions/bundled/harness-gui/adapter.ts`, 바꾸지 않는다), `ClaudeSdk`(이 file), Agent SDK의 `Query` control 호출, ACP `turn_ended`·`notice_added`·`hidden_added`·`hidden_restored`(`packages/protocol/acp/state.ts`), `redactCredentials`(`packages/base/telemetry/log.ts`, import만)
  - 내놓는 것: 없음(adapter 계약은 그대로다)
  - 고치지 않는 것: `packages/shell/main/extensions/bundled/harness-gui/index.ts`와 `packages/shell/main/desktop/wiring/extensions.ts`는 `ext-spawn`의 것이다. 그 task가 같은 wave에 `nodeSpawn`의 stdin EPIPE와 exit 순서를 고치고, `onExit` 뒤에는 stdout data를 주지 않게 한다(`spawned()`의 PassThrough write-after-end를 막는다). adapter에서 같은 방어를 다시 만들지 않는다.

## 할 일

순서는 기한 → 보이는 오류 → 수명이다(이 adapter에는 frame 예외 길이 없다: SDK가 읽고 `onMessage`는 try/catch 안이다).

1. **control 호출 기한(gui #14).** 지금: `live.q.interrupt()`, `setModel`, `setPermissionMode`, `stopTask`, `rewindFiles`, `supportedModels` 같은 control 요청에 기한이 없다. CLI가 답하지 않으면 그 입력이 끝나지 않고, 입력은 `chain`으로 줄 서므로 뒤의 모든 입력이 같이 멈춘다. 작은 helper 하나(예: `bounded(work, what, ms)`)로 `live.q.*` control 호출 모두를 30초(`REQUEST_WAIT_MS`) 기한으로 감싼다. 넘으면 `Error("claude did not answer <what> in 30 seconds.")`로 reject한다. `grep -o "live\.q\.[a-zA-Z]*" packages/shell/main/extensions/bundled/harness-gui/claude.ts`로 빠진 곳을 본다(`close`는 동기라 뺀다). `sdk.*`(transcript 읽기, `forkSession`, `renameSession`)는 CLI control이 아니라 그대로 둔다.
2. **`stop()` 기한(gui #19).** 지금: turn이 돌면 `stop()`이 `await live.q.interrupt()`를 먼저 기다린 뒤에야 `live.q.close()`를 해서, 답 없는 CLI면 toggle과 탭 닫기, 앱 종료에서 CLI가 남는다. 이 interrupt는 3초(`STOP_POLITE_MS`)로 묶고 넘거나 실패하면 그대로 close로 간다. close 뒤 `await live.exited`는 `nodeSpawn`의 SIGTERM→SIGKILL 유예가 끝을 보장하므로 그대로 둔다.
3. **입력 오류 표시(gui #35).** 지금: `session.onInput`의 `chain = chain.then(() => handle(message)).catch(() => undefined)`가 모든 실패(rewind, fork, `renameSession`, `stopTask`, `setPermissionMode`, 1의 기한 넘김)를 삼켜 사람은 아무 일도 없던 것으로 본다. catch에서 `info(<message.type> + " failed: " + <원인 글>, "warning")`으로 알린다(Codex·OpenCode의 `attempt()`와 같은 꼴).
4. **보이는 글의 secret(gui #34).** 지금: `stderrTail`(500자)과 CLI의 오류 글(`result`의 `message.result`·`message.errors`)이 그대로 실패 turn이 된다. `failure()`의 `dead.message`, `result` 실패의 `message`, 3의 원인 글을 `redactCredentials`로 가린다. 원인 글이 지나는 `info()` 안에서 가려도 된다.
5. **rewind·fork 실패 뒤 상태(gui #26).** 지금: `rewind`는 `rewindFiles`(되돌릴 수 없다) → `retire()` → `hideFrom()` → `reopen()` 순이고 `reopen`은 새 CLI가 떴는지 보기 전에 `cliSession`·`empty`를 새 값으로 바꾼다. `fork`도 같다. 새 CLI가 뜨지 못하면 `cliSession`은 없는 id라, 다음 send의 `revive`가 `--resume <없는 id>`로 열고 `tuiCommand()`도 그 id를 넘긴다.
   - `reopen` 앞의 `cliSession`, `empty`, 그리고 `hideFrom`이 만든 숨긴 구간 id를 남겨 둔다(`hideFrom`이 publish한 `hidden_added`의 id를 돌려주게 한다).
   - 새 query(`open()`의 `Live`)가 메시지를 하나도 내지 못하고 끝나거나 던지면(`open()` 안 `for await` 길의 `failure`) 남긴 값으로 되돌린다: `cliSession`·`empty`를 돌리고 `changed({ cli_session })`, 숨긴 구간은 `hidden_restored`로 되살린다.
   - warning 알림으로 rewind·fork가 되지 않았다고 알린다. `rewindFiles`로 이미 되돌린 file은 그대로라는 것도 알린다.
   - 그러면 다음 send의 `revive`는 앞 session을 resume한다.
6. **입력 줄 막힘(gui #30).** 지금: `stop`, `decide`, `answer`도 `chain` 뒤에 서서, 앞 입력(rewind, `setModel`, `setPermissionMode`)이 답 없는 CLI를 기다리는 동안 Stop과 승인 답이 닿지 않는다. 이 셋은 `chain`에 넣지 않고 바로 `handle`한다(3과 같은 catch). 셋은 query를 바꾸지 않는다: `stop`은 지금 `live`에 interrupt만 보내고, `decide`·`answer`는 기다리는 승인·질문을 푼다.
7. **시작 실패 때 CLI(gui #7).** 지금: `start`에서 `live = open(...)`이 CLI를 띄운 뒤의 코드(`settingsDefaults(await settingsFiles(sdk, cwd))`부터 `return` 앞까지)가 던지면 `start`가 reject되고 CLI가 남는다(`settingsFiles`는 file 오류를 삼키지만 그 뒤가 막혀 있지 않다). 그 구간을 try/catch로 감싸 던지면 `live.input.end()`, `live.q.close()` 뒤 `{ ok: false, error: { code: "internal", message } }`로 끝낸다(message는 4로 가린다).

정한 것:
- control 호출 기한은 30초, `stop()`의 polite interrupt는 3초다. 3초는 `index.ts`의 `tui()` 기한(8초, `ext-spawn`)과 SIGKILL 유예(3초) 안에 들게 한 값이다.
- 새 CLI가 "떴다"의 표지는 그 query의 첫 메시지다. 이유: SDK가 `init`을 언제 내는지는 첫 입력에 달려 있을 수 있어, 메시지가 하나라도 오면 CLI가 session을 연 것으로 친다.
- 줄 밖에서 처리하는 입력은 `stop`, `decide`, `answer` 셋이다. 이유: 대조 기록이 확인한 막힘이 이 셋이고, 나머지는 query를 바꾸거나 순서가 뜻을 가진다.
- 7의 실패 code는 `internal`이다. 던졌다는 것은 adapter가 예상하지 못한 것이다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`claude_test.ts`. `setup()`에 답하지 않는 `interrupt`·control 호출과 메시지 없이 끝나는 새 query 옵션을 더한다. timer는 `node:test`의 `mock.timers`로 넘긴다. 본보기: 같은 file의 "steer는 3초 돈 Bash…"):
  - "앞 입력이 CLI 답을 기다리는 동안에도 Stop과 승인 답은 바로 처리된다"
  - "rewind로 연 새 CLI가 메시지 없이 끝나면 다음 send와 TUI 명령은 앞 session id를 쓰고 숨긴 구간이 되살아난다"
  - "interrupt에 답하지 않는 CLI도 `stop()`이 3초 뒤 query를 닫고 끝난다"
- 남지 않음: `grep -n "handle(message)).catch(() => undefined)" packages/shell/main/extensions/bundled/harness-gui/claude.ts`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴. 아래 둘은 꼭 쓴다.
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 예를 들어 새 CLI가 메시지를 낸 뒤 죽은 rewind(되돌리지 않는다), 이미 되돌린 file. 없으면 "없음"
- 실제 앱에서 볼 것: 사람이 설치본에서 해 볼 것(예: `claude gui`에서 긴 Bash 중 Stop, 승인 카드가 뜬 채 model 바꾸기, rewind 뒤 TUI로 넘겼다 돌아오기)과 실제 앱에서는 못 봤다는 것(harness-gui skill "확인").

## (lead가 더함)

- `spawnClaudeCodeProcess`의 env 주석은 `ext-spawn`이 합쳐지면 틀린다. login shell env는 `index.ts`가 아니라 `nodeSpawn`(`packages/shell/main/desktop/wiring/extensions.ts`)이 붙인다. 주석을 그 사실로 고친다.
