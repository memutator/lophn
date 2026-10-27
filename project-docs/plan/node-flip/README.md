# node-flip

- 목표: lophn을 Node 하나로 뒤집는다. 계획 `node-api`가 남긴 Deno 의존(`project-docs/products/roadmap/node-runtime.md` "다음 계획이 바꿀 것")을 옮기고, core·lophn 자식 process·앱·flow·CLI를 Electron의 Node로 띄우고, 설치본과 저장소에서 Deno를 지운다.
- 재료: `project-docs/products/roadmap/node-runtime.md`(정한 것, "다음 계획이 바꿀 것", "Node에서 잰 것", 단계 4~6), `project-docs/architecture/app-call.md`, `project-docs/architecture/workflow.md`, `project-docs/architecture/layers.md`, `project-docs/architecture/testing.md`.
- 범위 밖: OS sandbox, 앱·flow의 network 막기(roadmap "정한 것").
- 돌리는 법: `node-api`와 같다. brief와 lead worktree 없이 주 session이 wave마다 worker를 띄우고 prompt(worktree 안 `.dev-data/node-flip-task.md`)에 할 일과 맡은 file을 바로 적는다. 합치는 branch는 `plan/node-flip`이고 main에는 사람이 확인한 뒤 올린다.
- 순서:
  - wave 1(Deno 위에서): 1:1 `node:*` 대체가 Deno에서도 똑같이 도는 것을 먼저 옮긴다. 2026-10-27 Deno 2.9.7과 Node 24.20에서 같이 잰 것: `node:http` server(TCP, unix socket), `http.request`의 `socketPath`, `upgrade` event, recursive `fs.watch`, `process.on` signal, `worker_threads`의 `workerData`, `node:sqlite` exclusive lock(다른 process는 `BUSY`), timer `unref`. 대상은 `Deno.serve`, `Deno.upgradeWebSocket`, `Deno.connect`·`Deno.createHttpClient`, `Deno.watchFs`, `Deno.addSignalListener`, Worker, 감독 통로 stdin·stdout, crash handler, instance lock, `Deno.open`, `Deno.unrefTimer`다. 먼저 `Deno.serve` 대신 쓸 adapter 하나를 만들고(wave 1a), 그것을 쓰는 곳은 그 뒤에 옮긴다(wave 1b). 나머지는 1a와 같이 돈다.
  - wave 2(뒤집기): package마다 `package.json`과 루트 npm workspaces, 자식 process를 띄우는 argv를 한 곳으로 모으기(`Deno.execPath()` 대신), core와 lophn 자식 process를 Electron의 Node로, `tsc --noEmit`과 `node --test`로 check, dev와 e2e helper, CLI launcher.
  - wave 3(앱과 flow): `--permission` flag, SDK와 앱 process·flow entry, SDK symlink, 앱 template과 App Engineer prompt, release 준비와 bundle, `workflow.check`, 선언 검사·추출·eval 자식, sandbox test 다시 쓰기, `app-call.md`·`workflow.md`의 network 보장 문장 지우기.
  - wave 4(지우기): 설치본의 `deno` binary와 `DENO_DIR`, `deno.json`·`deno.lock`, Deno를 말하는 문서·AGENTS.md(`npm run check`)·skill.
- 정한 것:
  - instance lock(`packages/base/install/instance-lock.ts`)은 `node:sqlite`의 exclusive lock으로 한다. Node에는 flock이 없다. SQLite의 POSIX lock은 process가 죽으면 풀리고, 새 의존이 없고, Deno와 Node에서 같이 돈다(위 측정). (agent)
  - `Deno.serve`의 fetch 모양 handler(`Request` → `Response`)는 그대로 두고 `node:http` 위에 adapter 하나를 둔다. handler 코드와 test를 다시 쓰지 않는다. WebSocket은 npm `ws`가 `upgrade` event에서 받는다. (agent)
  - wave 1에서 옮긴 코드는 Deno와 Node 둘 다에서 돌아야 한다. wave 2 전에 runtime을 섞지 않는다. (agent)
- 합칠 때 할 일: `deno task check`와 e2e 전체. wave 2부터는 그 명령이 바뀐다. 다 끝나면 roadmap 단계 4~6과 "다음 계획이 바꿀 것", 바뀐 architecture 문서, changelog 열린 판, AGENTS.md.
