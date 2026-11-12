# core-smalls

서로 관계없는 core의 작은 고침 셋이다. file이 겹치지 않으니 어느 순서로 해도 되고 하나씩 끝내도 된다: idle-exit가 도는 lophn agent turn을 보지 못하는 것(rt #32), git이 없을 때 원인을 말하지 않고 출력을 끝없이 모으는 두 git helper(rt #23), 기한 없이 영영 기다릴 수 있는 extension tool 호출(tools #40, #16).

- 단위: core (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/queue.ts`
  - `packages/core/lophn-agent/run-loop/queue_test.ts`
  - `packages/core/main/daemon/wiring/idle.ts`
  - `packages/core/apps/registration/source-folder.ts`
  - `packages/core/apps/releases/prepare/git-extract.ts`
  - `packages/core/host-queue/queue.ts`
  - `packages/core/host-queue/queue_test.ts`
  - `packages/protocol/lophn-agent/host-queue.ts`
  - `packages/core/main/daemon/wiring/extension-tools.ts` (watch에 `expire()` 한 줄)
  - `packages/core/apps/control.ts` (release 준비의 `rev-parse HEAD` 실패 갈래만)
  - `packages/core/apps/packages/publish.ts` (`rev-parse HEAD` 실패 갈래만)
- 읽을 것:
  - architecture: `project-docs/architecture/platform.md` "core 수명"의 idle-exit(지키는 것 9, 결정의 idle-exit 줄), `project-docs/architecture/extension.md` 지키는 것 15(extension tool 호출은 host queue를 거친다), `project-docs/architecture/coding-agent.md` 지키는 것 6(앱 source 폴더와 첫 commit)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/main`(boundary `core`), `packages/core/host-queue`(boundary `core`), `packages/core/apps`(boundary `apps`), `packages/core/lophn-agent`(boundary `lophn-agent`)
  - 계획 README "정한 것": "extension tool 호출의 기한은 5분이다"
  - 조사(선택): main checkout의 `research_notes/error-handling-verify/runtime.md` #23 #32, `research_notes/error-handling-verify/tools-session.md` #16 #40(commit하지 않아 worktree에는 없다)
- 계약:
  - 쓰는 것: wiring context의 `ctx.queue`(`packages/core/main/daemon/wiring/context.ts`의 Late 칸, `lophnAgentRuntimeWiring`이 `prepare`에서 넣는다. WIRINGS에서 `idleWiring`보다 앞이다), `IdleActivity.busy`(`packages/core/main/daemon/idle.ts`, 고치지 않는다), `GitRunner`(git-extract.ts)
  - 내놓는 것: `Queue.anyRunning(): boolean`, protocol 상수 `EXTENSION_TOOL_CALL_MS`. 다른 task가 기대지 않는다

## 할 일

### A. idle-exit가 도는 turn을 본다(rt #32)

1. 지금: `idleWiring`의 `busy()`는 job, run, workflow instance의 activity read와 server client 수만 본다. 보통 session turn은 그 어디에도 없고, model stream과 tool은 agent runtime child 안에서 돌며 core에는 짧은 HTTP 호출로만 닿는다. 그래서 앱 창을 닫은 채 긴 tool·model 단계가 10분 이어지면 core가 idle-exit로 끝나 turn이 끊긴다.
2. `queue.ts`의 `Queue`에 `anyRunning(): boolean`을 더한다(`running` Set이 비어 있지 않은가). `createQueue`가 구현한다.
3. `idle.ts`의 `busy()`가 activity read 앞에서 `ctx.queue.anyRunning()`이 참이면 `ok(true)`다. ledger read나 새 protocol read는 두지 않는다: core 메모리의 queue가 도는 turn의 정본이다(`createTurnSource`의 `began`·`hold`가 `setRunning(true)`, `ended`가 false, child가 사라지면 `endAll`).
4. harness session queue(`packages/core/main/daemon/wiring/harness.ts`의 따로 만든 `createQueue()`)는 보지 않는다. harness turn은 shell이 돌리므로 shell이 client로 붙어 있다.

### B. git 없음과 출력 상한(rt #23)

5. `source-folder.ts`의 `git()`. 지금: git이 PATH에 없으면 `child.on("error", reject)`가 `spawn git ENOENT`를 던지고, 부르는 쪽 catch가 그 글을 그대로 `unavailable`에 싣는다(사람은 "spawn git ENOENT"를 본다). stdout·stderr를 상한 없이 모은다(`git add -A`의 줄마다 경고가 길어질 수 있다).
   - spawn `error`가 ENOENT면 "git was not found; install git and make sure it is on PATH" 글로 reject한다(그 밖의 spawn 오류는 지금처럼). 부르는 쪽(`scaffold`, `requireCommittedRepository`)의 catch가 이미 이 글을 `unavailable`로 싣는다. `scaffold`의 실패는 `source_folder_unprepared` log에, `app.connect_source` 확인 실패는 응답에 보인다.
   - stdout과 stderr를 각각 64 KiB까지만 모은다(stderr는 넘으면 뒤를 버리고, stdout은 `rev-parse` 한 줄뿐이다).
6. `git-extract.ts`의 `gitCommandRunner`. 지금: 같은 `child.on("error", reject)`라 git이 없으면 `run`이 Result가 아니라 예외를 던져 `extractCommit`과 부르는 쪽의 Result 처리를 건너뛴다. stdout(blob 본문)을 상한 없이 모은다.
   - spawn `error`면 reject하지 않고 `err({ code: "unavailable", message: "git was not found; install git and make sure it is on PATH" })`로 끝낸다(ENOENT가 아닌 spawn 오류는 같은 code에 오류 글). 지금의 실패 code `invalid_input`("git failed")과 code로 가른다.
   - `ExtractFailure.reason`에 `"git_not_found"`를 더하고, `requireRepository`의 첫 `rev-parse --is-inside-work-tree`가 `unavailable`이면 `source_outside_boundary`가 아니라 `git_not_found`를 낸다. reason은 글로 `packages/core/apps/releases/prepare/flow.ts`, `packages/core/apps/releases/prepare/from-source.ts`, `packages/core/apps/packages/publish.ts`의 오류에 그대로 실린다(그 file들은 고치지 않는다).
   - stdout이 `RELEASE_BUNDLE_MAX_BYTES`(`packages/protocol/apps/releases.ts`, 256 MiB)를 넘으면 child를 끝내고 `err({ code: "invalid_input", message: "git output is too large" })`. bundle 상한보다 큰 blob은 어차피 bundle에 들 수 없다.

### C. extension tool 호출 기한(tools #40, #16)

7. 지금: `host-queue/queue.ts`의 `callTool`은 `call(..., null)`로 기한 없이 넣는다(`callBrowser`는 `BROWSER_CALL_MS` 30초, `callTerminalInterrupt`는 10초). shell main이 붙어 있는 채 handler가 답하지 않으면 그 turn과 `lophn ext call`이 영영 기다린다. `wiring/extension-tools.ts`의 watch는 shell이 떨어질 때만 거둔다.
8. `packages/protocol/lophn-agent/host-queue.ts`의 `BROWSER_CALL_MS` 옆에 `EXTENSION_TOOL_CALL_MS = 5 * 60_000`과 "core가 extension tool 호출의 답을 기다리는 기한" 주석을 둔다.
9. `callTool`이 `deps.clock.nowMs() + EXTENSION_TOOL_CALL_MS`를 기한으로 넣고, `timedOut`은 "The extension tool did not answer within 5 minutes, so lophn stopped waiting. It may still be running in the lophn app; check its effect before calling it again, and tell the person if it happens again."이다. `HostQueue`의 `callTool`·`expire` 주석에서 "browser 호출만"이라는 말을 고친다.
10. `wiring/extension-tools.ts`의 watch interval이 `if (!ctx.hostQueue.attached()) abandon(); else ctx.hostQueue.expire();`가 되게 한다(`packages/core/main/daemon/wiring/host-queue.ts`의 browser watch와 같은 꼴). 지금 `expire()`는 browser 호출이나 input request가 기다릴 때만 불려서, 이것 없이는 extension tool만 기다릴 때 기한이 지나도 아무도 거두지 않는다.
11. tools #16(일반 tool timeout)은 이 기한으로 덮는다. `packages/core/lophn-agent/run-loop/tool-batch.ts`에 모든 tool의 기한을 두지 않는다(사람 대기 tool이 있다).
12. `queue_test.ts`의 tool_call test(이미 있는 "tool_call은 workspace 없이 가져가고…")에 경우를 더한다: 빌려 간 tool_call이 5분이 지나 `expire()`되면 `unavailable`이고 늦은 `done`은 무시된다. 수동 clock을 쓴다.

정한 것:
- idle은 lophn agent queue의 `running`만 본다. 기다리는 입력(`waiting()`)은 세지 않는다. 입력이 있으면 turn starter가 곧 `running`으로 바꾸고, child가 없어 못 도는 입력 때문에 core가 영영 살지 않게 한다.
- git 없음 문장은 `source-folder.ts`에서는 reject 글로, `git-extract.ts`에서는 Result로 나른다. 각 file의 지금 오류 처리 꼴(앞은 try/catch, 뒤는 주입된 `GitRunner`의 Result)을 따른다.
- 기한 초과는 `unavailable`이다. model에는 `executeToolCall`이 "tool is unavailable"만 보이고 `lophn ext call`을 부른 사람·agent는 문장 전체를 본다. 결과 불명(`uncertain`)으로 바꾸지 않는다: extension tool 결과는 core route `extension_tools/call`의 Result로 와서 tool 결과 status를 고르는 자리가 이 task의 file에 없다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "답이 없는 extension tool 호출은 5분 뒤 unavailable로 끝나고 늦은 done은 무시된다"(`packages/core/host-queue/queue_test.ts`의 있는 test에 더한다)
- 남지 않음: 없음(이름을 지우거나 바꾸지 않는다)

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴. **무겁게 짠 것**과 **알려진 미완 동작**을 빠뜨리지 않는다. lead가 `project-docs/architecture/platform.md`의 idle-exit 줄(일로 치는 것 목록)에 "도는 lophn agent turn"을 더할 수 있게 적는다.

## (lead가 더함)

- `packages/core/apps/control.ts`의 release 준비와 `packages/core/apps/packages/publish.ts`는 `rev-parse HEAD`가 실패하면 무엇이든 "commit이 없다"로 바꿔 답한다. git이 없어서 실패한 것이면(위 `source-folder.ts`·`git-extract.ts`가 내는 git 없음 오류) 그 글을 그대로 낸다. 두 file에서 이 갈래 말고는 고치지 않는다.
