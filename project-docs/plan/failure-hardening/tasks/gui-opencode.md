# gui-opencode

OpenCode adapter의 event stream(SSE)이 한 번 끊기거나 event 하나가 틀려도 session이 죽지 않게 다시 구독하고, 그 위에서 정말 죽은 session은 server를 끄게 한다. 요청에 기한을 두고, 시작 실패 때 server가 남지 않게 하고, stream buffer에 상한을 두고, stderr와 harness 오류 글의 secret을 가린다.

- 단위: gui (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/opencode.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/opencode_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/opencode/`
- 읽을 것:
  - 계획 README "정한 것"(`project-docs/plan/failure-hardening/README.md`): adapter file마다 task 하나, `failure.ts`를 만들지 않고 ACP error `code`에 공통 오류 코드 일곱을 쓴다
  - skill: `.claude/skills/harness-gui/SKILL.md`를 따른다(녹화는 사람 허락 없이 돌리지 않는다. 이 task는 새 녹화가 필요 없다: 오류 길은 `opencode_test.ts`의 가짜 `OpencodeTransport`와 `deps.writeSecret`으로 본다. 다른 harness의 구현은 `/home/pyosechang/projects/harness-lab`을 읽기만 한다). 구현 세부는 `.claude/skills/harness-gui/reference.md`의 OpenCode 절. test는 `.claude/skills/write-test/SKILL.md`
  - architecture: `project-docs/architecture/harness-gui.md` 지키는 것 4, 7과 모델의 "adapter 넷의 모양" OpenCode 줄(shared handoff: TUI client가 같은 server에 붙는다)
  - boundary: `project-docs/boundary-catalog.yaml`의 `shell-extension`, `acp`
  - 대조 기록(main checkout 절대 경로): `/home/pyosechang/projects/lophn/research_notes/error-handling-verify/harness-gui.md`의 2절(특히 2.5, 2.6), #7, #10, #14, #15, #17, #34
- 계약:
  - 쓰는 것: adapter 계약 `HarnessGuiAdapter`·`HarnessGuiRun`(`packages/shell/main/extensions/bundled/harness-gui/adapter.ts`, 바꾸지 않는다), `OpencodeTransport`·`OpencodeDeps`·`createApi`(이 file), OpenCode server의 `/api/*`, ACP `turn_ended`·`notice_added`(`packages/protocol/acp/state.ts`), `redactCredentials`(`packages/base/telemetry/log.ts`, import만)
  - 내놓는 것: 없음(adapter 계약은 그대로다)
  - 고치지 않는 것: `packages/shell/main/extensions/bundled/harness-gui/index.ts`와 `packages/shell/main/desktop/wiring/extensions.ts`는 `ext-spawn`의 것이다(같은 wave에 `nodeSpawn`의 pipe `error`와 exit 순서, login env를 고친다). `sentKeys`(입력 key 중복)는 계획 밖이라 그대로 둔다.

## 할 일

순서는 stream 안전 → 기한 → 보이는 오류 → 수명이다. 수명 안에서는 다시 구독(#15)이 실패 뒤 server 끄기(#17)보다 먼저다: SSE가 잠깐 끊긴 것만으로 server를 끄면 멀쩡한 server와 거기 붙은 TUI client까지 죽는다.

1. **stream 안전(gui #10, #15의 event 하나).** 지금: `fetchTransport`의 `events()`는 SSE `buffer`에 상한이 없고, `JSON.parse(data)` 하나가 틀리거나 `onEvent`가 던지면 async 함수 전체가 끝나 `onEnd` → `failure()`로 session 전체가 `dead`가 된다(server는 산 채로).
   - `fetchTransport.events()`: 틀린 JSON event는 그 하나만 버린다. `buffer`가 64 MiB(`MAX_EVENT_BYTES`)를 넘도록 `\n\n`이 없으면 stream 오류로 끝낸다(아래 5의 다시 구독이 받는다).
   - adapter: `transport.events`에 넘기는 `onEvent`를 try/catch로 감싼다. 던지면 그 event만 버리고 처음 한 번만 `info("OpenCode sent an event lophn could not read: …", "warning")`로 알린다. test의 가짜 transport도 이 길을 지나므로 여기서 막는다.
2. **요청 기한(gui #14, #6을 덮는다).** 지금: `fetchTransport.request`의 `fetch`에 `AbortSignal`이 없어 server가 답하지 않으면 `api.info()`부터 `start`가 끝나지 않고, 그동안 `index.ts`의 `tab.run`이 null이라 탭을 닫아도 server가 남는다. `createApi`의 `call`에 30초 기한(`REQUEST_WAIT_MS`)을 둔다: 넘으면 `Error("OpenCode did not answer <method> <path> in 30 seconds.")`로 reject한다. 시작 중이면 이미 있는 `try { … } catch { events?.close(); proc.end(); proc.kill(); … }`가 server를 끄고 `unavailable`로 끝낸다. 시작 뒤에는 그 호출만 실패한다(`attempt()`가 알린다).
   - 기한에서 뺄 요청: 일이 끝날 때까지 답하지 않는 것. `wait`(`/api/experimental/session/<id>/wait`, execution이 멈출 때까지 기다린다)는 뺀다. `prompt`, `command`, `shell`, `compact`, `runSkill`, `interrupt`, `revertStage`는 OpenCode 원본(`/home/pyosechang/projects/harness-lab/open-code/open-code-cli`, 읽기만)에서 답이 언제 오는지 확인해 늦게 오는 것만 뺀다. 모르겠으면 빼고 보고에 적는다(일하는 호출을 기한으로 끊는 쪽이 더 나쁘다).
   - 기한은 `createApi`에 둔다(`fetchTransport`가 아니라). 이유: test의 가짜 transport로 볼 수 있다. 기한을 넘긴 fetch는 끊지 않고 둔다.
3. **보이는 글의 secret(gui #34).** 지금: `stderrTail`(500자)과 server 오류 글이 그대로 실패 turn과 알림이 된다. "OpenCode did not start." 글, `failure()`의 `dead.message`, start catch의 "OpenCode did not respond: …", `attempt()`의 `message(cause)`, execution 실패의 `rec(data.error).message`, compaction 실패 글을 `redactCredentials`로 가린다. `grep -n "stderrTail\|message(cause)\|error).message" packages/shell/main/extensions/bundled/harness-gui/opencode.ts`로 빠진 곳을 본다.
4. **시작 실패 때 server(gui #7).** 지금: `const secret = await deps.writeSecret(password)`가 server를 띄운 뒤 try 밖에 있어, password file을 못 쓰면(disk full, 권한) `start`가 던지고 `opencode serve`가 남는다. `writeSecret`이 던지면 `proc.end()`·`proc.kill()` 뒤 `{ ok: false, error: { code: "unavailable", message: "OpenCode could not start: …" } }`로 끝낸다.
5. **SSE 다시 구독(gui #15).** 지금: `transport.events(onEvent, (cause) => failure(cause.message))`를 한 번만 열어, 노트북 잠자기나 proxy가 끊은 stream 하나로 tab이 영영 `dead`가 된다.
   - `onEnd`가 오면 `closed`가 아니고 `dead`가 아니고 process가 살아 있으면 다시 구독한다. 간격은 500ms에서 두 배씩 10초까지(OpenCode 자신의 client와 같다: `harness-lab/open-code/open-code-cli/packages/client/src/mcp.ts`의 `RECONNECT_MIN`·`RECONNECT_MAX`). event가 하나 오면 간격과 횟수를 되돌린다.
   - event 없이 다섯 번 이어 실패하면 그때 `failure(cause.message)`다.
   - OpenCode의 event stream은 끊긴 사이 event를 다시 보내지 않는다(`harness-lab/open-code/open-code-cli/packages/client/test/solid-connection.test.ts`의 "a reconnect does not ask the volatile event stream to replay"). 다시 붙은 뒤 `main.turn`이 열려 있으면 최근 메시지(`api.messages`)를 읽어 마지막 assistant 메시지가 끝났으면 turn을 `completed`로 닫는다. 끝났는지 보이는 칸은 녹화(`fixtures/opencode/*.jsonl`의 message 응답)와 OpenCode 원본에서 확인한다. 그런 칸이 없으면 turn은 그대로 두고 "the connection to OpenCode dropped; some output may be missing" 같은 warning 알림만 내고 보고에 적는다.
   - 끊긴 사이 온 승인 요청(`permission.asked`)도 잃는다. 기다리는 승인을 다시 읽는 route가 원본에 있으면 다시 읽고, 없으면 보고의 미완 동작에 적는다.
6. **실패 뒤 server(gui #17, 5 뒤에).** 지금: `failure()`는 `dead`만 세우고 server를 끄지 않는다. 5 뒤에 `failure()`가 오는 것은 process가 끝났거나 다시 구독을 포기했을 때뿐이다. process가 아직 살아 있으면(`exited` Promise와 같이 boolean flag를 둔다) `events?.close()`, `proc.end()`, `proc.kill()`을 부른다. 이미 끝난 process에는 kill을 보내지 않는다: group에 남은 손자를 끄는 것은 계획 밖이다(roadmap `failure-hardening.md`의 harness-gui #23). password file은 지금처럼 `stop()`이 지운다.

정한 것:
- 기한은 요청 하나에 30초다. 시작의 바깥 기한(`index.ts`의 `within(start)`)은 두지 않는다(README 결정).
- 틀린 event는 버리고 session을 살린다. 알림은 처음 한 번만 낸다.
- 다시 구독을 포기하는 기준은 event 없이 이어진 실패 다섯 번이다. 이유: 끝없이 다시 붙으면 죽은 GUI가 살아 보인다. 다섯 번이면 간격 합이 약 15초라 잠자기에서 깨어난 뒤의 짧은 끊김은 넘긴다.
- `failure()` 글에 "다시 열려면 …" 같은 안내를 붙이지 않는다. shared handoff에서 죽은 GUI를 다시 띄우는 길은 아직 없다(roadmap의 #36).

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`opencode_test.ts`. 가짜 transport의 `events`가 `onEnd`를 받아 끊김을 낼 수 있게 넓힌다. timer는 `node:test`의 `mock.timers`로 넘긴다. 본보기: `claude_test.ts`의 "steer는 3초 돈 Bash…"):
  - "모양이 틀린 event와 SSE 끊김이 와도 session이 살고, adapter가 다시 구독하며, server process를 끄지 않는다"
  - "`/api/info`에 답하지 않으면 30초 뒤 start가 `unavailable`로 끝나고 server process를 끈다"
  - "password file을 못 쓰면 start가 실패하고 server process를 끈다"
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴. 아래 둘은 꼭 쓴다.
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 예를 들어 끊긴 사이 잃은 승인 요청, 끊긴 사이 끝난 turn을 닫는 칸이 없을 때, 기한에서 뺀 요청과 그 근거. 없으면 "없음"
- 실제 앱에서 볼 것: 사람이 설치본에서 해 볼 것(예: `opencode gui`에서 turn 중 노트북을 재웠다 깨우기, `kill <opencode pid>` 뒤 앱이 살아 있고 실패 turn이 보이는가)과 실제 앱에서는 못 봤다는 것(harness-gui skill "확인").

## (lead가 더함)

- `start`의 주석 "env는 호출자(`index.ts`)가 login shell env < 탭의 hook env 순으로 합쳐 둔다"은 `ext-spawn`이 합쳐지면 틀린다. login shell env는 `index.ts`가 아니라 `nodeSpawn`(`packages/shell/main/desktop/wiring/extensions.ts`)이 붙인다. 주석을 그 사실로 고친다.
