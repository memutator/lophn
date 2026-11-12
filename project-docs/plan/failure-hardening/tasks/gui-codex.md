# gui-codex

Codex adapter가 깨진 app-server 메시지에 던져 앱을 끄지 않게 하고, 답 없는 JSON-RPC 요청에 기한을 둔다(시작이 걸리면 start가 실패하고 process를 끈다). session이 죽으면 app-server를 끄고, stderr와 harness 오류 글의 secret을 가린다.

- 단위: gui (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/codex.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/codex_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/codex/`
- 읽을 것:
  - 계획 README "정한 것"(`project-docs/plan/failure-hardening/README.md`): adapter file마다 task 하나, `failure.ts`를 만들지 않고 ACP error `code`에 공통 오류 코드 일곱을 쓴다
  - skill: `.claude/skills/harness-gui/SKILL.md`를 따른다(녹화는 사람 허락 없이 돌리지 않는다. 이 task는 새 녹화가 필요 없다: 오류 길은 `codex_test.ts`의 가짜 link와 가짜 `ExtensionProcess`로 본다). 구현 세부는 `.claude/skills/harness-gui/reference.md`의 Codex 절. test는 `.claude/skills/write-test/SKILL.md`
  - architecture: `project-docs/architecture/harness-gui.md` 지키는 것 6, 7, 9와 모델의 "adapter 넷의 모양" Codex 줄(shared handoff)
  - boundary: `project-docs/boundary-catalog.yaml`의 `shell-extension`, `acp`
  - 대조 기록(main checkout 절대 경로): `/home/pyosechang/projects/lophn/research_notes/error-handling-verify/harness-gui.md`의 2절, #6, #9, #14, #17, #34
- 계약:
  - 쓰는 것: adapter 계약 `HarnessGuiAdapter`·`HarnessGuiRun`(`packages/shell/main/extensions/bundled/harness-gui/adapter.ts`, 바꾸지 않는다), `CodexIo`·`CodexLink`(이 file), ACP `turn_ended`·`notice_added`(`packages/protocol/acp/state.ts`), `redactCredentials`(`packages/base/telemetry/log.ts`, import만)
  - 내놓는 것: 없음(adapter 계약은 그대로다)
  - 고치지 않는 것: `packages/shell/main/extensions/bundled/harness-gui/index.ts`와 `packages/shell/main/desktop/wiring/extensions.ts`는 `ext-spawn`의 것이다. 그 task가 같은 wave에 `nodeSpawn`의 pipe `error`, exit 순서, 시작 실패 글을 고치므로 adapter에서 같은 방어를 다시 만들지 않는다.

## 할 일

순서는 crash 막기 → 기한 → 보이는 오류 → 수명이다.

1. **frame 예외(gui #9).** 지금: `ready` 안 `connected.onMessage((text) => { if (!closed) onLine(text); })`에서 `onLine`이 맨 `JSON.parse(line)`을 하고 `onNotification`·`onRequest`로 바로 가며, 그 길에 try가 없다. 깨진 JSON 한 줄이나 `thread/tokenUsage/updated`의 `tokenUsage`에 `modelContextWindow`만 있고 `last`가 없는 값(`usageOf`의 `usage.last.totalTokens`)이 ws `message` listener 안에서 던지고, uncaught exception으로 main에 가 `packages/shell/main/desktop/wiring/crash.ts`가 앱을 끈다. listener 안의 `onLine(text)`를 try/catch로 감싼다. 던지면 그 메시지만 버리고 session은 그대로 둔다. 처음 한 번만 `info("Codex sent a message lophn could not read: …", "warning")`로 알리고 뒤의 것은 조용히 버린다.
   - 같이 확인: `handle`의 `void fn()` 입력 길(`rewind`, `fork`, `steerChild`, `implementPlan`, `openSession` 등)과 `void readGoal()`·`void readShells()`가 reject하지 않는지 본다. 열어 본 것은 `attempt()`나 자기 try/catch로 막혀 있다. 막히지 않은 것이 있으면 `attempt()`로 감싼다.
2. **요청 기한(gui #14, #6을 덮는다).** 지금: `request()`는 `pending`에 넣고 답이나 `failure()`만 기다린다. app-server가 `initialize`·`thread/start`에 답하지 않으면 `start`가 끝나지 않고, 그동안 `tab.run`이 null이라 탭을 닫아도 process가 남는다. `request()`에 30초 timer(`REQUEST_WAIT_MS`)를 둔다. 넘으면 `pending`에서 빼고 `Error("Codex did not answer <method> in 30 seconds.")`로 reject한다. 답이 오거나 `failure()`가 `pending`을 비우면 timer를 지운다. 시작 중이면 이미 있는 `try { await ready } catch { await cleanup(); return { ok: false, … } }`가 process를 끄고 `unavailable`로 끝낸다. 시작 뒤에는 그 호출만 실패한다(`attempt()`가 한 줄 알림으로 보인다).
   - 기한에서 뺄 요청: 일이 끝난 뒤에야 답하는 요청. 녹화에서는 `turn/start`, `thread/shellCommand`가 일이 시작되자마자 답한다(`fixtures/codex/shell.jsonl`, `session.jsonl`). `review/start`, `thread/compact/start`, `thread/fork`, `thread/resume`, `thread/turns/list`를 녹화와 `codex app-server generate-ts` 모양으로 확인하고, 답이 일 끝까지 늦는 것만 뺀다. 모르겠으면 빼고 보고에 적는다(늦게 끝나는 호출을 기한으로 끊는 쪽이 더 나쁘다).
3. **보이는 글의 secret(gui #34).** 지금: `stderrTail`(500자)과 app-server의 오류 글이 그대로 실패 turn과 알림이 된다. `failure()`의 `dead.message`, `start` catch의 `message`, `attempt()`의 `cause.message`, turn 실패의 `wire.error?.message`, `error` 알림의 `params.error?.message`를 `redactCredentials`로 가린다(`grep -n "stderrTail\|error?.message" packages/shell/main/extensions/bundled/harness-gui/codex.ts`로 남은 곳이 없는지 본다).
4. **실패 뒤 자식(gui #17).** 지금: `failure()`는 `dead`를 세우고 기다리는 요청을 거절할 뿐 app-server를 끄지 않는다. ws가 닫혔는데 process가 살아 있으면 탭을 닫을 때까지 남는다. `failure()`에서 `exited`가 false일 때만 `link?.close()`와 `proc.kill()`을 부른다. 이미 끝난 process에는 kill을 보내지 않는다: group에 남은 손자(CLI가 띄운 background 명령)를 끄는 것은 계획 밖이다(roadmap `failure-hardening.md`의 harness-gui #23). socket 폴더는 지금처럼 `stop()`의 `cleanup()`이 지운다.

정한 것:
- frame 하나가 틀리면 버리고 session을 살린다. 이유: app-server가 살아 있고 다음 메시지는 읽힌다. 알림은 처음 한 번만 낸다(같은 꼴이 쏟아지면 대화를 덮는다).
- 기한은 요청 하나에 30초다. 시작의 바깥 기한(`index.ts`의 `within(start)`)은 두지 않는다(README 결정: child를 끌 handle이 아직 없다).
- `failure()` 글에 "다시 열려면 …" 같은 안내를 붙이지 않는다. shared handoff에서 죽은 GUI를 다시 띄우는 길은 아직 없다(roadmap의 #36).
- `code`는 지금처럼 `unavailable`이다(crash와 timeout).

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`codex_test.ts`, `boot()`의 가짜 link와 가짜 process를 넓혀 쓴다. timer는 `node:test`의 `mock.timers`로 넘긴다. 본보기: `claude_test.ts`의 "steer는 3초 돈 Bash…"):
  - "깨진 JSON 줄이나 모양이 틀린 `thread/tokenUsage/updated`가 와도 adapter가 던지지 않고 다음 녹화 메시지를 그대로 그린다"
  - "app-server가 `initialize`에 답하지 않으면 30초 뒤 start가 `unavailable`로 끝나고 process를 끈다"
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴. 아래 둘은 꼭 쓴다.
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 예를 들어 기한에서 뺀 요청 목록과 그 근거, 확인하지 못한 요청. 없으면 "없음"
- 실제 앱에서 볼 것: 사람이 설치본에서 해 볼 것(예: GUI에서 `kill <app-server pid>` 뒤 앱이 살아 있고 실패 turn이 보이는가)과 실제 앱에서는 못 봤다는 것(harness-gui skill "확인").
