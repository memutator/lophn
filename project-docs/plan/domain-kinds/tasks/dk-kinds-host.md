# dk-kinds-host

core 쪽에서 kinds worker를 띄우고 부리는 조립을 만든다: process 띄우기, project별 dispatcher(훑기·2초 규칙·위반을 problem으로 올리기), 파일 변경 감시, 그리고 `kind.get`·`kind.list`·`kind.check` core 메모리 route의 handler. context의 `connection.ts`·`watch/` 조립을 **복사해 줄여** 새 module `packages/core/projects/kinds/host/`에 둔다. 옛 context 코드는 건드리지 않는다(wave 3이 지운다).

worker 쪽(추출·검사·index·질의)은 `dk-kinds-worker`다. 그 file들은 이 task가 존재하지 않는 것으로 두고 짠다(계약 `packages/protocol/projects/kinds-work.ts`만 보고). 코드 이름은 아직 `project`다.

- 단위: kinds (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/projects/kinds/host/`
  - `packages/core/projects/register.ts`
  - `packages/core/projects/lookups.ts`
  - `packages/core/main/daemon/wiring/kinds.ts`
- 읽을 것:
  - plan: `project-docs/plan/domain-kinds/README.md`의 "정한 것"(판 없음, 위반), roadmap `project-docs/products/roadmap/domain.md`의 "재료 schema: kind와 item"(바뀔 때 검사, watch)
  - architecture: `project-docs/architecture/layers.md`와 `tools/check-deps.ts`(core domain `projects`는 `problems`·agent-roles·main을 import하지 못한다. 여기 handler는 protocol route만 안다. problem 쪽 command는 route 이름으로 낸다)
  - 복사해 줄일 원본(`packages/core/projects/contexts/`):
    - `connection.ts`: `contextsWorkerSpec`(launch spec과 Deno 권한, ≈:97), `codeReads`, `createContextsProcess`(`ensure`·`retain`·`launch`, ≈:178), `createContextsDispatcher`의 `scan`·`ensureFresh`(직전 scan 뒤 2초 안이면 새로 요청하지 않는다, 도는 scan은 합친다, `force`)와 `relay`의 envelope 꼴(`idempotency_key`, `compare: {}`, `prepared: []`)
    - `watch/detector.ts`(`createChangeDetector`: 500ms 창으로 합치기), `watch/fs.ts`(`startFsWatch`), `watch/types.ts`, `watch/service.ts`(`createContextsWatch`: 입력이 바뀔 때 그 project 것만 다시 열기, 없는 폴더는 건너뛰고 다음에 다시 시도, `onCommand`)
  - 조립 본보기(읽기만): `packages/core/main/daemon/wiring/projects.ts`의 `start`(machine 자격 발급 `ctx.registry.issue` → `revalidate` → `runtime.record`, `createWorkerChannel`, `ctx.io`, `ctx.server.port`, `ctx.writer.command`)와 `build`(`Built.writer`, ledger 읽기 연결), `packages/core/main/daemon/wiring/apps.ts`의 `memory: [[key, handler], …]`(key는 `"<resource>/<method>"`)(≈:296~330), `packages/core/apps/packages/builtin.ts:109`(`readBuiltinSdk`: `MemoryHandler`가 `(ctx, raw) => Result`)
  - 계약: `packages/protocol/projects/kinds-api.ts`, `kinds-work.ts`, `kinds-file.ts`(`kindWatchFolders`, `folderCovers`, `kindsFilePath`, `KINDS_DISPATCH_PRINCIPAL`), `packages/protocol/problems/project-problems.ts`(`problemSyncProject`)
- 계약:
  - 쓰는 것: 위 protocol 값. worker 요청·응답은 `KINDS_WORK_OPS`, 요청 공통 `{ project, kinds_file, roots, force? }`
  - 내놓는 것: `projectsRegistration`(`packages/core/projects/register.ts`의 `createLedgerRegistration` 반환)에 `memoryRoutes: [kindGet, kindList, kindCheck]`, 그리고 `kindsWiring: WiringFactory`(`packages/core/main/daemon/wiring/kinds.ts`). lead가 `assembly.ts`의 `WIRINGS`에서 `projectsWiring` 바로 뒤에 `kindsWiring`을 등록한다.

## 만드는 것

1. `host/process.ts`: `createKindsProcess({ supervisor, channel, dataRoot, epoch, apiPort, prepare })`. 원본 `contextsWorkerSpec`/`createContextsProcess`에서 `kind: KINDS_WORKER_KIND`, `entry: new URL("../worker/run.ts", import.meta.url).pathname`(worker는 `dk-kinds-worker`가 같은 시기에 만든다. 문자열 경로일 뿐이라 이 task의 type check에 상관없다), `allow_read`는 (project 폴더들 ∪ **각 project의 kinds 파일 경로** ∪ index 파일들(`kindsIndexPath` + `-wal`/`-shm`/`-journal`) ∪ codeReads), `allow_write`는 index 파일들뿐(staging 없음), 네트워크·env·subprocess 없음, `checkLaunchSpec`를 거친다. `ensure(targets)`는 읽을 경로가 늘 때 새 권한으로 다시 띄운다(원본과 같다). kinds 파일 경로를 root와 같은 목록에 넣어 새 project가 생기면 같은 길로 다시 띄운다.
2. `host/dispatcher.ts`: `createKindsDispatcher({ process, dataRoot, roots(project), command(envelope), newId(prefix), nowMs, log })`.
   - `sync(project, { force? })`: 그 project의 `roots`를 읽어 `process.ensure`, `KINDS_WORK_OPS.sync`를 요청(timeout 60초), 응답을 `kinds-work`의 schema로 검사한다. 같은 project의 도는 요청은 합치고, 직전 `sync`가 끝난 지 2초 안이면 건너뛴다(`force`면 건너뛰지 않는다).
   - 응답의 `violations_hash`가 마지막으로 올린 값(메모리 map)과 다르면 `problemSyncProject` command를 낸다: input은 `{ project, violations: [{ id: newId("prb"), violation }…], truncated }`, envelope은 `{ command: problemSyncProject.name, input, idempotency_key: "kinds-dispatch/sync/<crypto.randomUUID()>", compare: {}, prepared: [] }`. 성공하면 hash를 기억한다. 실패하면 기억하지 않아 다음 sync가 다시 올린다. 시작 직후 첫 sync는 늘 올린다.
   - `ask(op, project, extra)`: `sync`(2초 규칙) 뒤에 `op`(`get`·`list`·`check`)를 요청하고 route의 output schema로 검사해 돌려준다. worker의 `ok:false` 답은 그 code 그대로다. worker가 안 뜨면 `unavailable`.
3. `host/handlers.ts`: `kindHandlers({ dispatcher: () => KindsDispatcher | undefined, rootsOf(project): string[] | null })` → `Map<"kinds/get"|"kinds/list"|"kinds/check", MemoryHandler>`. handler마다 호출자 actor가 `user`·`agent`·`machine`이 아니면 `forbidden`, input은 route의 `input` schema로 검사(`invalid_input`), project가 없거나 보관됐으면 `not_found`, dispatcher가 아직 안 붙었으면 `unavailable`("kinds worker is not attached"; 빈 결과로 꾸미지 않는다). **project 범위 판정은 하지 않는다** — 호출자가 어느 project를 읽을 수 있는지는 agent tool이 자기 place로 정한다(지금 `context.*` tool과 같다).
4. `host/watch/`: 원본 `watch/detector.ts`·`fs.ts`·`types.ts`를 복사하되 detector가 contract 대신 폴더 목록(`WatchFolder[]`)을 직접 받게 줄인다(`apply([{ key, folders }])`). `host/watch/service.ts`의 `createKindsWatch({ list, kindsOf, catchUp, watchFs, log })`:
   - 감시 대상은 active project마다 (a) 그 project root들 아래 `kindWatchFolders(적용 중인 kinds)`(적용 중인 kinds는 `dispatcher.ask(get)`의 `kinds`), (b) kinds 파일이 든 폴더 `<data>/projects/<prj>/`(**재귀 아님**. 이벤트 경로가 `kinds.yaml`인 것만 의미 있다). (b)의 폴더가 없으면 감시를 열기 전에 `Deno.mkdir(…, { recursive: true })`로 만든다(PM이 처음 `kinds.yaml`을 쓸 때 폴더 감시가 이미 열려 있어야 한다).
   - 신호는 힌트일 뿐이다. 창(500ms)이 닫히면 `dispatcher.sync(project, { force: true })`를 한 번 부르고, 그 sync 응답의 hash가 적용 중인 kinds 파일 hash와 달라졌으면(`kinds.yaml`이 바뀌었다) 그 project의 감시를 다시 정한다. 폴더를 열지 못하면 건너뛰고 다음 다시 정하기에서 다시 시도한다(원본 `incomplete`).
   - `start()`는 active project 전부를 읽어 감시를 열고 각각 한 번 `sync(force)`한다(core를 다시 켠 뒤 이미 있던 위반이 problem으로 올라온다). `onCommand(command)`는 `project.create`·`project.update`·`project.relink_folder`·`project.archive`·`project.unarchive`(`packages/protocol/projects/project-api.ts`의 `projectApi.*.name`)가 받아들여지면 전체를 다시 정한다. `stop()`.
5. `host/credential.ts`: `kindsDispatchCredential()` — `{ actor: "machine", principal: KINDS_DISPATCH_PRINCIPAL, scope: { operations: [problemSyncProject.name], targets: { task: "kinds" } }, conditions: { task: "kinds", process: KINDS_WORKER_KIND } }`(원본 `contextWorkerCredential` 꼴).
6. `packages/core/projects/lookups.ts`: `activeProjectRoots(sql): { project: string; roots: string[] }[]`(active project와 `project_folders`의 path, position 순)와 `projectRootsOf(sql, project): string[] | null`(없거나 보관됐으면 null)를 더한다. 옛 함수는 그대로 둔다.
7. `packages/core/projects/register.ts`: `createLedgerRegistration`의 반환에 `memoryRoutes: [kindGet, kindList, kindCheck]`를 더한다(`LedgerRegistration` type에 `memoryRoutes?: readonly unknown[]` 칸). 옛 context 등록은 그대로 둔다.
8. `packages/core/main/daemon/wiring/kinds.ts`: `kindsWiring: WiringFactory = () => ({ name: "kinds", … })`.
   - `operations`: `[{ name: problemSyncProject.name, actors: ["machine"], kind: "command" }]`.
   - `build(ctx)`: ledger 읽기 연결(`openConnection(ctx.ledgerPath)`)을 열어 `lookups`로 project root를 읽는다. `kindHandlers`를 만들어 반환값의 `memory`로 준다(`Iterable<readonly [string, MemoryHandler]>`, key는 `"<route.resource>/<route.method>"`(예 `"kinds/get"`)). 쓰기 앞 처리기(`writer`)는 받아들여진 `project.*` command마다 `watch.onCommand(command)`를 부르고 결과는 그대로 돌려준다(`contexts/connection.ts`의 `wrapWriter` 꼴).
   - `start(ctx)`: `kindsDispatchCredential()`을 발급·기록(원본 `projects.ts` `start` 앞부분과 같다. 못 하면 `ok(undefined)`로 끝내 core는 계속 선다), `createWorkerChannel()`과 `createKindsProcess`로 process, dispatcher, watch를 만들고 handler가 보는 `dispatcher` 칸에 붙인다. `prepare`는 `<data root>/derived` 폴더를 만든다(`Deno.mkdir`, recursive). 마지막에 `void watch.start()`.
   - `closeIntake`: `watch.stop()`, `closeWork`: 연 ledger 연결 닫기.
   - 이 file은 `projects.ts`와 import하지 않는다(wiring끼리 import 금지. 공용은 `wiring/context.ts`가 내놓는 `createWorkerChannel`, `WiringFactory`).

## 정한 것

- 위반은 dispatcher의 sync 응답으로만 problem에 올라간다(감시와 읽기 앞 sync가 같은 길이다). 읽기(`get`·`list`·`check`)만으로는 올리지 않는다.
- route handler를 memory route로 두었다: 읽기 handler가 worker(별도 process)에 묻는 일이라 ledger snapshot을 쓰는 reader Worker에는 맞지 않는다. 새 ledger 표는 없다.
- project 범위 판정을 handler에 두지 않는다(위 3번). agent 자격 판정은 `roleOperations`가 tool의 route에서 만든다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(process·감시를 띄우는 test는 AGENTS.md상 새로 만들지 않는다. 조립이 맞는지는 아래 기동으로 본다).
- 남지 않음: `rg -n "projects/contexts" packages/core/projects/kinds packages/core/main/daemon/wiring/kinds.ts`가 0줄이다(복사본이 옛 module을 import하지 않는다).
- core 기동: worktree에서 `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍는다(`assembly.ts` 등록은 lead가 하므로, 확인하려면 임시로 `WIRINGS`에 `kindsWiring`을 넣어 돌리고 되돌린다. 이 변경은 commit하지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `packages/core/main/daemon/assembly.ts`의 `WIRINGS`에 `kindsWiring`(`projectsWiring` 바로 뒤, `import { kindsWiring } from "./wiring/kinds.ts"`). `TEAMS`는 이미 `projects/register.ts`를 가리키므로 `memoryRoutes`는 따로 등록하지 않는다
- 안 쓰게 된 export: 없음
- 정한 것
- 넘길 줄: `register.ts`·`lookups.ts`에 더한 것(`dk-delete-core`가 나중에 옛 줄을 뺀다)
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
