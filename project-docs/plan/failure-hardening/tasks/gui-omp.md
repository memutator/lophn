# gui-omp

omp adapter가 모양이 틀린 RPC frame, 끝없이 큰 줄, 처리하지 않은 promise reject로 앱을 끄지 않게 하고, 기동·요청·`stop`에 기한을 둔다. TUI로 넘길 session id를 못 읽으면 알리고, stderr와 harness 오류 글의 secret을 가린다.

- 단위: gui (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/omp.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/omp_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/omp/`
- 읽을 것:
  - 계획 README "정한 것"(`project-docs/plan/failure-hardening/README.md`): adapter file마다 task 하나, `failure.ts`를 만들지 않고 ACP error `code`에 공통 오류 코드 일곱을 쓴다
  - skill: `.claude/skills/harness-gui/SKILL.md`를 따른다(녹화는 사람 허락 없이 돌리지 않는다. 이 task는 새 녹화가 필요 없다: 오류 길은 `omp_test.ts`의 `setup()`이 주는 가짜 process로 본다). 구현 세부는 `.claude/skills/harness-gui/reference.md`의 omp 절. test는 `.claude/skills/write-test/SKILL.md`
  - architecture: `project-docs/architecture/harness-gui.md` 지키는 것 4, 6, 7과 모델의 "adapter 넷의 모양" omp 줄(restart handoff)
  - boundary: `project-docs/boundary-catalog.yaml`의 `shell-extension`, `acp`
  - 대조 기록(main checkout 절대 경로): `/home/pyosechang/projects/lophn/research_notes/error-handling-verify/harness-gui.md`의 2절(특히 2.2 unhandledRejection), #6, #9, #10, #14, #19, #27, #34
- 계약:
  - 쓰는 것: adapter 계약 `HarnessGuiAdapter`·`HarnessGuiRun`(`packages/shell/main/extensions/bundled/harness-gui/adapter.ts`, 바꾸지 않는다), `OmpIo`(이 file), ACP `turn_ended`·`notice_added`(`packages/protocol/acp/state.ts`), `redactCredentials`(`packages/base/telemetry/log.ts`, import만)
  - 내놓는 것: 없음(adapter 계약은 그대로다)
  - 고치지 않는 것: `packages/shell/main/extensions/bundled/harness-gui/index.ts`와 `packages/shell/main/desktop/wiring/extensions.ts`는 `ext-spawn`의 것이다. 그 task가 같은 wave에 `nodeSpawn`의 stdin EPIPE, exit 순서, `index.ts`의 `void run?.stop()` catch를 고치므로 adapter에서 다시 만들지 않는다. 다만 `stop()`이 reject하지 않는 것은 이 task가 지킨다(아래 3).

## 할 일

순서는 crash 막기 → 기한 → 보이는 오류다. 지금 crash 길은 둘이다: listener 안 예외(uncaught exception)와 처리하지 않은 reject(unhandledRejection). `packages/shell/main/desktop/wiring/crash.ts`는 둘 다 `app.exit(1)`이다.

1. **frame 꼴(gui #9).** 지금: `connect()`의 `onLine`은 `JSON.parse`만 try로 막는다. `null`이나 숫자 줄은 `frame.type`에서 TypeError가 되고, `onFrame(frame)`(handler 본문)이 던지는 것도 `mine.onStdout` listener 안이라 그대로 main에 간다. parse 뒤 값이 plain object가 아니면(null, 배열, 원시값) 버린다. `rpc_chunk` 모으기와 `onFrame(frame)` 부르기를 try/catch로 감싼다. 던지면 그 frame만 버리고, 처음 한 번만 `info("omp sent a message lophn could not read: …", "warning")`로 알린다.
2. **큰 frame(gui #10).** 지금: 줄 `buffer`와 `chunks` Map에 상한이 없고 `rpc_chunk`의 `index`·`count`를 검사하지 않으며 다 오지 않은 조각은 지워지지 않는다. 상한은 64 MiB(`MAX_FRAME_BYTES`)다. omp 자신이 `ready` frame에 `maxReassembledFrameBytes: 67108864`를 알린다(`fixtures/omp/text.jsonl` 첫 줄).
   - 줄바꿈 없이 `buffer`가 상한을 넘으면 그 줄을 버리고 다음 줄바꿈까지 받은 것을 버린다.
   - `rpc_chunk`는 `chunkId`가 빈 글이 아니고, `count`가 양의 정수이고, `index`가 `[0, count)`의 정수여야 한다. chunk 하나의 합과 `chunks` 전체 합이 상한을 넘으면 그 `chunkId`를 지운다.
   - 버릴 때는 1의 알림과 같은 한 번 알림을 쓴다. process는 끄지 않는다.
3. **떠 있는 promise(gui #9, 대조 기록 2.2).** 지금 reject가 처리되지 않는 곳:
   - `const ready = (async () => { … })()`. `.catch`가 없고 첫 입력이나 `stop()` 전에는 아무도 기다리지 않는다. `readState`의 `st = reply.data; cliSession = st.sessionId`(data가 null), `replayHistory`의 `page.data.messages.some`이 여기서 던진다. 끝에 `.catch`를 달아 `info("omp did not report its state: …", "warning")`로 알리고 `ready`가 늘 resolve되게 한다.
   - `session.onInput((message) => void ready.then(async () => { … await handle(message) }))`. `.catch`를 달아 `info(<message.type> + " failed: …", "warning")`로 알린다(`restart()`의 reject도 여기로 온다).
   - `onFrame`의 `void refresh()`(`agent_end`, `model_changed`·`thinking_level_changed`, `manual_compaction_end`·`auto_compaction_end`)와 `void readState()`(todo tool 끝). `.catch`로 받는다.
   - `run.stop()`. body 전체를 try/finally로 감싸 reject하지 않고, 실패해도 `closed = true`, `proc.end()`, kill timer까지 간다.
   - 읽기 함수의 data 접근: `readState`, `readLevels`(`reply.data.levels.length`), `readStats`, `replayHistory`(`page.data.messages`)는 `reply.ok`여도 `data`가 기대한 꼴인지 보고 아니면 읽지 않은 것으로 친다.
4. **기동 기한(gui #6).** 지금: `connect()`가 돌려주는 `first`(`ready`나 exit)에 기한이 없어, `ready`를 보내지 않는 omp면 `start`가 끝나지 않고 그동안 `index.ts`의 `tab.run`이 null이라 탭을 닫아도 process가 남는다. `connect()`가 30초(`START_WAIT_MS`) 안에 `ready`도 exit도 없으면 `proc.kill()`하고 `"timeout"`으로 끝나게 한다. `start`는 `"timeout"`이면 `{ ok: false, error: { code: "unavailable", message: "omp did not get ready in 30 seconds.…(stderr 꼬리)" } }`를 돌려준다(`--resume` 재시도는 지금처럼 `"exit"`일 때만). `restart()`도 `"timeout"`을 "omp did not restart."와 같은 실패 turn으로 끝낸다.
5. **요청 기한(gui #14).** 지금: `request()`는 response frame이나 exit만 기다린다. `request()`에 30초 timer(`REQUEST_WAIT_MS`)를 두고, 넘으면 `waiting`에서 빼고 `{ ok: false, error: "omp did not answer <type> in 30 seconds." }`로 resolve한다(지금처럼 reject하지 않는다). handshake의 `negotiate_protocol`도 여기서 묶인다.
   - 기한에서 뺄 요청: 일이 끝난 뒤에야 답하는 것. 녹화로 확인한 것은 `bash`(답에 `exitCode`가 실린다, `fixtures/omp/bash.jsonl`)와 `compact`(compaction event 뒤에 답한다, `fixtures/omp/compact.jsonl`)다. `prompt`·`follow_up`은 바로 답한다(`fixtures/omp/text.jsonl`, `abort.jsonl`). 나머지 요청 종류도 녹화에서 답의 자리를 보고, 모르겠으면 빼고 보고에 적는다.
6. **`stop()` 기한(gui #19).** 지금: `stop()`이 `await ready` → `restarting` 기다림 → `await request("abort")` → `await readState()` 순으로 기다린 뒤에야 `proc.end()`를 해서, 답 없는 omp면 끝나지 않는다(탭 닫기와 앱 종료에서 process가 남는다). 맨 앞에 `stopping = true`를 두고, `ready`·`restarting`·`abort`·`readState`의 polite 단계를 한 기한 3초(`STOP_POLITE_MS`) 안에 묶는다. 넘으면 그대로 `closed = true`, `proc.end()`, 지금의 kill timer(`EXIT_WAIT_MS`), `await gone`으로 간다. `restart()`는 `await gone` 뒤 `stopping`이나 `closed`면 새 omp를 띄우지 않는다(지키는 것 6: stop이 옛 process를 끄는 사이 restart가 새것을 띄우면 한 session에 process가 둘이거나 고아가 남는다).
7. **TUI로 넘길 session id(gui #27).** 지금: `readState`는 `if (!reply.ok) return;`으로 조용히 끝나고 `data`가 없으면 TypeError다. 그러면 `tuiCommand()`가 옛 `cliSession`으로 `--resume`한다. 3의 꼴 검사에 더해, 못 읽었으면 `cliSession`·`st`는 그대로 두고 처음 한 번 `info("omp did not report its session, so the terminal view may open an earlier session.", "warning")`로 알린다.
8. **보이는 글의 secret(gui #34).** 지금: `stderrTail`(500자)과 omp의 오류 글이 그대로 실패 turn과 알림이 된다. `info()`(이미 `plain()`으로 색 code를 뗀다)에 `redactCredentials`를 더하고, 실패 turn을 만드는 곳(`onExit`의 "omp exited", `start`의 "did not start", `restart()`의 실패, `prompt_result`의 `errorText`·`failure.message`, 마지막 assistant의 `errorMessage`)도 가린다. `grep -n "stderrTail\|errorMessage\|errorText" packages/shell/main/extensions/bundled/harness-gui/omp.ts`로 빠진 곳을 본다.

정한 것:
- 틀린 frame과 넘친 줄은 버리고 session을 살린다. 이유: omp process는 살아 있고 다음 줄은 읽힌다. 버린 것이 response면 5의 기한이 그 요청을 끝낸다. 알림은 처음 한 번만 낸다.
- omp의 `request()`는 지금처럼 reject하지 않고 `{ ok: false }`로 끝난다. 이유: 부르는 곳이 모두 `Reply`를 본다.
- `stop()`의 polite 기한은 3초다. `index.ts`의 `tui()` 기한(8초, `ext-spawn`)과 nodeSpawn의 SIGKILL 유예(3초) 안에 들게 한다.
- 7의 알림은 TUI로 넘기는 순간에는 handle이 바로 닫혀 보이지 않는다. turn이 끝날 때의 `refresh()`에서 못 읽은 것만 사람이 본다. 그래도 TUI 명령은 마지막으로 안 id를 쓴다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`omp_test.ts`. `setup()`의 가짜 process에 답하지 않을 요청 종류와 `ready`를 보내지 않는 옵션을 더한다. timer는 `node:test`의 `mock.timers`로 넘긴다. 본보기: `claude_test.ts`의 "steer는 3초 돈 Bash…"):
  - "`null`·배열 frame과 handler가 던지는 frame이 와도 adapter가 던지지 않고 다음 녹화 frame을 그린다"
  - "`ready`를 보내지 않는 omp는 30초 뒤 start가 `unavailable`로 끝나고 process를 끈다"
  - "`abort`와 `get_state`에 답하지 않는 omp도 `stop()`이 reject 없이 끝나고 stdin을 닫는다"
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴. 아래 둘은 꼭 쓴다.
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 예를 들어 기한에서 뺀 요청 목록과 그 근거, 확인하지 못한 요청. 없으면 "없음"
- 실제 앱에서 볼 것: 사람이 설치본에서 해 볼 것(예: `omp gui`에서 turn 중 `kill -9 <omp pid>` 뒤 앱이 살아 있고 실패 turn이 보이는가, TUI로 넘겼다 돌아오기)과 실제 앱에서는 못 봤다는 것(harness-gui skill "확인").
