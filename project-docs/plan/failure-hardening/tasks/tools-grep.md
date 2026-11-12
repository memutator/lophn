# tools-grep

`file.grep`과 `file.glob`이 model이 준 pattern으로 만든 RegExp를 agent runtime의 main thread에서 돌려, 끝나지 않는 pattern 하나가 그 runtime의 모든 session을 멈추는 것(tools #25)을 고친다. 훑기를 Worker에서 돌리고 10초에 끊으며, 검사하는 줄 길이에 상한을 둔다.

- 단위: tools (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/file/search.ts`
  - `packages/core/lophn-agent/tools/file/search-worker.ts`(새 file)
- 읽을 것:
  - 계획 README "정한 것": "`file.grep`은 Worker에서 돌리고 10초에 끊는다"
  - architecture: `project-docs/architecture/agent-definition.md` 지키는 것 36·37(결과 상한과 spill), `project-docs/architecture/platform.md`(agent runtime child의 수명)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`(boundary `lophn-agent`)
  - 본보기(Worker): `packages/core/storage/ledger/reader-pool.ts`의 `newWorker`, `packages/core/main/daemon/runtime.ts`의 writer `new Worker(new URL(...), { workerData })`
  - 조사(선택): main checkout의 `research_notes/error-handling-verify/tools-session.md` #25(commit하지 않아 worktree에는 없다)
- 계약:
  - 쓰는 것: `resolveInWorkspace`, `fail`, `fsFail`(`packages/core/lophn-agent/tools/file/scope.ts`, `tools-file-write`가 `fsFail`의 문장만 바꾼다. signature는 그대로다), `fitJson`(`packages/core/lophn-agent/tools/result.ts`), `continuation`(`packages/core/lophn-agent/tools/bundles/paging.ts`)
  - 내놓는 것: `globFiles`, `grepFiles`의 이름과 signature는 그대로다(`packages/core/lophn-agent/tools/bundles/file.ts`가 부른다). tool 입력 schema와 설명은 바꾸지 않는다

## 사실(코드에서 확인한 것)

- agent runtime은 Deno가 아니다. `agentRuntimeLaunchSpec`(`packages/core/lophn-agent/register.ts`)의 entry `packages/core/main/agent-runtime/main.ts`를 supervision이 `nodeCommand`(`packages/core/supervision/security/node-command.ts`)로, 곧 Electron의 Node(`ELECTRON_RUN_AS_NODE=1`, Node 24)로 `.ts`를 바로 띄운다. 조사 보고서의 "Deno process"는 옛 글이다.
- 설치본도 같다: `tools/package/main.ts`의 `stagePlatform`이 `packages/`(shell 밖)를 `.ts` source 그대로 `platform/packages`에 싣는다. 번들하지 않으므로 `new URL("./search-worker.ts", import.meta.url)`이 개발 실행과 설치본에서 같은 file을 가리킨다. core의 reader·writer Worker가 이미 이 길로 돈다.
- 확인했다(Electron Node 24.21): `node:worker_threads`의 `new Worker(new URL("./w.ts", import.meta.url))`가 `.ts`를 type stripping으로 띄우고, `^(a+)+$`를 도는 중인 Worker를 `worker.terminate()`가 약 5ms 안에 끝낸다. `scope.ts`를 import하는 Worker의 기동은 약 55ms다.
- `ToolContext.scope`(`WorkspaceScope`)는 `open()` 함수를 가져 Worker에 넘길 수 없다. `resolveInWorkspace`가 쓰는 칸(`read`, `write`, `base`, `results`)만 넘긴다.
- 지금 문제 자리: `grepFiles`의 `new RegExp(input.pattern)`을 `lines[index]`마다 동기 loop로 `regex.test` 하고, 줄 길이 상한(`MAX_LINE_CHARS`)은 출력에만 쓴다. `globMatcher`도 model 입력으로 RegExp를 만든다(`**`가 `.*`·`(?:.*/)?`가 되어 `**a**a**a…`가 path마다 다항 backtracking을 한다). `globFiles`와 `grepFiles`의 `glob` 둘 다다.

## 할 일

1. **Worker module `search-worker.ts`를 만든다.** 지금 `search.ts`의 `walk`, `listed`, `show`, `globMatcher`, glob 맞추기 loop, grep의 file 읽기·줄 검사 loop를 이 file로 옮긴다. 입력은 `workerData` 하나: `{ kind: "glob" | "grep", pattern, glob?, base: { dir, single }, roots: { read, write, base?, results? } }`. 끝나면 `parentPort.postMessage`로 `{ ok: true, items: string[], more: boolean, skipped: number }`을 한 번 보낸다. pattern이나 glob이 RegExp로 만들어지지 않으면 `{ ok: false, message }`를 보낸다(grep은 지금 문장 "pattern is not a valid regular expression", glob은 "glob is not valid". 지금 `{`만 있는 glob은 handler 밖으로 예외가 나간다). 이 module은 Worker로만 띄운다. `search.ts`가 import하지 않는다(top-level 코드가 main thread에서 돌게 된다). 상수 `MAX_FILES`, `MAX_MATCHES`, `MAX_SCANNED_BYTES`, `MAX_LINE_CHARS`, `SKIPPED`도 옮긴다. symlink 판정은 지금처럼 `resolveInWorkspace(roots, path, "read")`다.
2. **줄 길이 상한.** 지금: 2 MiB까지의 한 줄짜리(minified) file에서도 줄 전체에 RegExp를 돌린다. 새 상수 `MAX_TESTED_LINE_CHARS = 4_000`을 넘는 줄은 검사하지 않고 `skipped`로 센다.
3. **`search.ts`는 Worker를 띄우고 기다린다.** `globFiles`·`grepFiles`는 지금처럼 `baseOf`로 base를 풀고(main thread의 async fs라 안전하다), 그 뒤 helper 하나(예: `runSearch`)가:
   - `new Worker(new URL("./search-worker.ts", import.meta.url), { workerData })`로 띄운다(`node:worker_threads`).
   - `SEARCH_DEADLINE_MS = 10_000` timer, `ctx.signal`의 abort, Worker의 `message`·`error`·`exit` 중 먼저 오는 것으로 끝낸다. 어느 길이든 끝에 `worker.terminate()`를 부른다.
   - 기한을 넘으면 `fail("invalid_input", "the search did not finish within 10 seconds; use a simpler pattern or a narrower path or glob")`.
   - `ctx.signal`이 abort되면 `fail("unavailable", "the search was stopped")`.
   - Worker가 message 없이 끝나거나 `error`를 내면 `fail("unavailable", "the search failed")`.
   - `{ ok: false }`면 `fail("invalid_input", message)`.
   - 받은 `items`·`more`로 지금의 `resultOf`를 그대로 부른다. grep의 `skipped`가 0보다 크면 summary 끝에 `(N lines over 4000 characters were not searched)`를 붙인다.
4. `search.ts`에서 옮긴 함수와 상수를 지운다(두 곳에 같은 코드를 두지 않는다).

정한 것:
- glob도 Worker에서 돈다. 같은 file이고 같은 꼴의 위험이라 따로 막는 RegExp 없는 glob 구현을 새로 쓰지 않는다. 그래서 walk 전체가 Worker로 가고, glob의 200개 조기 종료도 Worker 안에서 그대로 된다.
- 호출마다 Worker를 새로 띄우고 끝에 끝낸다(약 55ms). 오래 사는 Worker pool은 terminate 뒤 다시 띄우는 일과 동시 호출의 줄 세우기가 따라와 무겁다.
- 기한 초과는 `invalid_input`이다. `packages/core/lophn-agent/tools/work.ts`의 `executeToolCall`은 `invalid_input`일 때만 handler 문장을 model에 싣고 `unavailable`은 "tool is unavailable"만 보인다. model이 pattern이나 path를 좁히라는 말을 받아야 같은 호출을 되풀이하지 않는다. work.ts는 이 task의 file이 아니다.
- 기한에 끊긴 훑기는 찾은 것 일부를 돌려주지 않는다. 끊는 때 Worker가 가진 것을 받을 길이 없고(동기 RegExp 도중이다), 부분 결과를 주려면 Worker가 중간 결과를 계속 보내야 한다.
- 줄 상한은 4,000자다. 보통 source 줄은 닿지 않고 minified bundle 한 줄은 거른다. 거른 수를 summary에 실어 model이 모르고 놓치지 않게 한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음. "끝나지 않는 pattern이 10초 안에 돌아온다"는 Worker를 띄우는 test라 사람의 허락이 필요하다(AGENTS.md). 허락되면 lead가 따로 알려 준다. 그때는 `packages/core/lophn-agent/tools/file/search_test.ts`(새 file)에 `^(a+)+$`와 긴 `a…!` 줄 file로 쓰고, 기한은 test가 짧게 줄 수 있게 helper 인자로 받는다.
- 남지 않음: `grep -n "globMatcher\|async function\* walk" packages/core/lophn-agent/tools/file/search.ts`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴. **무겁게 짠 것**과 **알려진 미완 동작**을 빠뜨리지 않는다. 손으로 확인한 것(개발 실행에서 `file.grep`이 보통 pattern으로 같은 결과를 내는지)을 적는다. test file을 새로 만들었으면 "등록할 것"에 `project-docs/flows/tests/lophn-agent.yaml` 줄을 적는다.
