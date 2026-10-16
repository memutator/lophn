# core-wiring-split

`core-wiring-trim`을 거친 `packages/core/main/daemon/core.ts`를 module마다의 wiring file(`packages/core/main/daemon/wiring/<module>.ts`)과 조립 목록 하나(`packages/core/main/daemon/assembly.ts`)로 쪼갠다. 동작은 바꾸지 않는다. 기동 순서, 종료 순서, 쓰기 앞 처리기의 겹치는 순서가 지금과 같아야 한다. 이 뒤로 각 단위는 자기 module의 wiring file만 고치고 lead는 조립 목록만 고친다.

- 단위: core-wiring (wave 0)
- 선행: core-wiring-trim (같은 file을 줄인 뒤의 모양을 쪼갠다)
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/` 안 모든 file과 새 `wiring/` 폴더, 새 `assembly.ts`
- 읽을 것:
  - 계획: `../README.md` 2.1의 "hotspot 쪼개기", 1장 규칙 6, 2.7 "조립"
  - 소유 지도: `../ownership.md` (아래 표의 "이어받을 단위"를 정하는 근거)
  - dev: `/home/pyosechang/projects/lophn/project-docs/dev/code-map.md` "core 안 module"(module끼리 직접 import하지 않는다. `main`은 module을 조립만 하고 module이 `main`을 import하지 않는다), `/home/pyosechang/projects/lophn/project-docs/dev/code.md` "모듈 모양"(파일 400줄)
  - inventory: 없음 (core-wiring 줄은 `core-wiring-trim`이 맡았거나 다른 단위로 넘겼다. 이 task는 넘긴 줄의 코드가 놓일 file을 만든다)
  - 지금 코드: `packages/core/main/daemon/{core,runtime,platform-register,registration,parent,main}.ts` (trim 뒤)

- 계약:
  - 쓰는 것: `core-wiring-trim`이 줄인 `CoreOptions`·`Core`·`runtime.ts`. protocol과 module의 `mod.ts`는 고치지 않는다.
  - 내놓는 것 (이후 단위가 기대는 모양, 자세한 것은 아래 "모양"):
    - `packages/core/main/daemon/wiring/<module>.ts` — module마다 `Wiring` 하나를 내놓는다
    - `packages/core/main/daemon/assembly.ts` — `TEAMS`, `TEAM_MODULES`, `WIRINGS`. lead만 고친다
    - 밖에서 import하던 `BlobPrepareCall`(`core.ts`), `CoreRuntime`(`runtime.ts`), `platform-register.ts`의 이름은 그대로다

## 모양

### 파일

| file | 담는 것 | 이어받을 단위 |
|---|---|---|
| `assembly.ts` | 세 목록: `TEAMS`(지금 `main.ts`의 `TEAMS`), `TEAM_MODULES`(지금 `main.ts`의 `teamModules` URL들 + `core.ts`의 `withPlatformModule`·`withRewindReader`·`withInstructionReader`가 항상 붙이던 module URL들), `WIRINGS`(아래 wiring들의 순서 있는 목록). **lead가 고치는 유일한 조립 file이다** | lead |
| `wiring/context.ts` | `WiringContext`, `Wiring`, `Built` type. module들이 서로를 import하지 않고 값을 주고받는 길(아래). 밖에서 바뀔 import 두 곳(`createDocumentsChannel`을 `createWorkerChannel`로, `createProductRedactor`)의 단일 import 지점 | lead |
| `core.ts` | `startCore`, `open`(단계 구동기), `Core` type, `BlobPrepareCall`, 종료 구동기. 목표 600줄 이하 | lead |
| `wiring/server.ts` | `core/server`: `baseOperations`, `CredentialRegistry`, `RouteRegistry`, `startApiServer` 호출, coding credential(`createCodingCredentials`, `withRevocationSweep`, connect·registerChild handler) | events |
| `wiring/events.ts` | `core/events`: `eventOperations`, event 이름별 operation 정책 | events |
| `wiring/storage.ts` | `core/storage`: ledger·credential schema step, `applyMigrations`, `ensureLedgerId`, `checkRestart`, blob read deps(`blobReadDeps`), blob relay(`blobRelayFor`, prune timer, `blobBuffer`), `runStoppedMaintenance` | platform |
| `wiring/storage-restore.ts` | `storage/migration`의 backup·restore: `planRestore`, `restoreBinding`, `Core.restore*`, `runStoppedRestore`, `backups` read | remove-platform이 지운다 |
| `wiring/supervision.ts` | `core/supervision`: `io`·`appsSupervision` 감독 생성, 환경 helper(`sessionBusEnv`, `optionalEnv`, `denoDir`), `platformIoSpec`, `startPlatformIo`, `ioComponent`·`appsComponent` | platform |
| `wiring/diagnostics.ts` | `core/diagnostics`: `StatusSource`(`ready`, `components()`) | platform |
| `wiring/config.ts` | `core/config`: `SETTINGS_SCHEMA_STEPS` | platform |
| `wiring/secrets.ts` | `core/secrets`: `SECRET_SCHEMA_STEPS`, 보호 입력 relay와 `secretInputHandler` upload route | platform |
| `wiring/approvals.ts` | `core/approvals`: 승인 글 준비(`withApprovalText`, `createApprovalTextPreparer`), `observeApprovals` | approvals |
| `wiring/notifications.ts` | `core/notifications`: `startNotifications`, `NOTIFICATIONS_CONTEXT` 기록, 종료 때 `stop` | remove-platform이 지운다 |
| `wiring/projects.ts` | `core/projects`의 contexts: `contextsHost`, context worker, watch, blob 준비(`withContextBlobs`), `CONTEXT_WORKER_OPERATIONS` 정책 | places-sessions |
| `wiring/apps.ts` | `core/apps`: `createAppsControl`, preview, confirm adapters, `withReleasePreparation`, 앱 supervisor 자식 시작, 앱 operation 정책, invocation 재시작 복구(`observeInvocations`, `observeReleaseActivations`) | app-calls |
| `wiring/apps-revert.ts` | `core/apps/revert`: `revertChannel`, revert worker 시작, `createAppRevert` memory route, `APP_REVERT_CONTEXT` 기록 | app-calls |
| `wiring/apps-tickets.ts` | `core/apps/tickets`: ticket claim 정리(`ticketClaimSweepIntervalMs`), ticket checker worker와 feed, ticket summary upload route | coding-agent |
| `wiring/apps-export.ts` | `appExportWorkers` 한 줄과 그 worker route | remove-app-extras가 지운다 |
| `wiring/problems.ts` | `core/problems`: report collector, test runner와 control, `problems.work`·`problems.closing` feed, repair worker·reads, `snapshotLogs` 환경, fix summary upload, `withViewBinding` | releases-problems |
| `wiring/lophn-agent.ts` | `core/lophn-agent`의 정의 쪽: 질문 글 준비(`withQuestionText`), trace export, provider login, agent profile 올리기·읽기 | agent-definition |
| `wiring/lophn-agent-session.ts` | `session/`와 `assignments/`: message body 준비, rewind(store, files, summaries, 정리 timer, 설치 복구), assignment 반응과 내장 assignment 준비·재시도 | places-sessions |
| `wiring/lophn-agent-handoff.ts` | handoff body 준비(`withHandoffBody`) | router |
| `wiring/lophn-agent-extensions.ts` | MCP OAuth(`mcpVault`, `mcpAuthRequests`, `mcpAuthControl`) | agent-definition |
| `wiring/lophn-agent-runtime.ts` | agent runtime child 시작, `agentRuntimePolicies`, runtime secret link | router |

- wiring file 하나에는 `../ownership.md`의 한 단위가 가진 path 안의 module 코드만 둔다. 한 file에 단위가 둘 섞이면 file을 나눈다. 20줄 안쪽으로 작은 file은 같은 단위의 file에 합쳐도 된다.
- file이 400줄을 넘으면 `<module>-<부분>.ts`로 더 나눈다 (예: `apps-preview.ts`). 같은 단위의 file이어야 한다.
- 위 목록에 없는 코드를 찾으면 그 코드가 놓인 module 폴더(`packages/core/<module>`)의 wiring file에 둔다. 폴더가 정하지 못하면 가까운 것에 두고 보고에 쓴다.

### 구동기와 wiring의 약속

`core.ts`의 `open`은 단계 구동기가 된다. 지금 순서를 그대로 단계로 옮긴다.

```ts
// wiring/context.ts
export type Wiring = {
  name: string;
  schemaSteps?: readonly SchemaStep[];                 // migration에 더한다 (ledger, credential, 팀 assemble, settings, secret 순서를 지금과 같게)
  environment?(ctx: WiringContext): Record<string, unknown>;   // assemble(options.teams, env)에 합쳐 넘긴다
  operations?(ctx: WiringContext): OperationPolicy[];          // CredentialRegistry의 operation 정책
  records?(ctx: WiringContext): RequestContext[];              // runtime이 열린 뒤 ledger에 기록할 core 안 machine 자격. 하나라도 실패하면 구동기가 runtime을 닫고 오류를 돌려준다
  build?(ctx: WiringContext): Promise<Result<Built>>;          // runtime이 열린 뒤, API를 열기 전
  start?(ctx: WiringContext): Promise<Result<void>>;           // API와 io가 뜬 뒤. 목록 순서대로
  closeIntake?(): Promise<void> | void;                        // 종료 1단계: 지금 `shutdown`의 server.stop 앞 정리
  closeChildren?(): Promise<void> | void;                      // 종료 2단계: server.stop 뒤, supervisor 정지 앞뒤의 정리
};
export type Built = {
  writer?: (inner: Writer) => Writer;                          // 쓰기 앞 처리기. WIRINGS 순서로 접는다(앞이 안쪽)
  memory?: ReadonlyArray<readonly [string, MemoryHandler]>;
  uploads?: ReadonlyArray<readonly [string, UploadHandler]>;
  fileStreams?: ReadonlyArray<readonly [string, FileStreamHandler]>;
  workers?: ReadonlyMap<string, WorkerRouteTarget>;
  reads?: (reads: Map<string, ReadHandler>) => void;           // `overlayReads` 같은 덧씌우기
};
```

- 이름은 위를 쓰되 칸이 모자라면 더한다. 칸을 더하는 기준은 쓰는 wiring이 둘 이상일 때다.
- `WiringContext`는 값 하나로 module 사이를 잇는다. `options`, `clock`, `random`, `root`, `ledgerPath`, `epoch`, 그리고 늦게 생기는 것(`runtime`, `io`, `appsSupervision`, `registry`, `server`, `blobRelay`, `bodyPrepare`, `prepareRelay`, `knownSecrets`, `assembled`, `allRoutes`)이 칸이다. 늦게 생기는 칸은 읽을 때 아직 없으면 오류가 나는 getter로 둔다(`ctx.runtime`을 `runtime!`처럼 쓰는 지금 코드를 대신한다).
- **wiring file은 서로를 import하지 않는다.** 한 module의 값이 다른 module에 필요하면 `WiringContext`에 이름 있는 칸을 더한다. wiring을 아는 것은 `assembly.ts`와 `core.ts`뿐이다.
- **순서를 바꾸지 않는다.**
  - 쓰기 앞 처리기(`Built.writer`)가 안쪽에서 바깥으로 접히는 순서는 지금 `startApiServer`의 `writer:` 중첩 그대로다: contexts(`contextsHost.wrapWriter` + `withContextBlobs`) → message body → handoff body → question text → approval text → apps(`withReleasePreparation`, appsControl commands·grantChange) → trace export → rewind files → provider login → revocation sweep. `WIRINGS` 목록 순서가 이 순서를 만들게 wiring을 줄 세운다.
  - 종료 순서는 `shutdown`의 주석 그대로다: 새 입장 닫기(`ready = false`) → 구독·감시·worker 통로 정리 → `server.stop()` → `appsControl.stop()` → 앱 supervisor 정지 → io 정지 → timer·bootstrap 정리 → `runtime.close()` → 유지보수나 restore → run metadata 지우기와 lock 풀기.
  - 구동 순서도 지금 그대로다: lock → schema step → `checkRestart` → credential registry → 감독 생성 → `openRuntime` → 자격 기록 → `build` → API → run metadata → blob relay와 io 시작 → worker들과 feed들 → bootstrap → 앱 supervisor → coding 복구 → agent runtime → 부모 pipe hello.
- 기동 복구가 놓일 위치: S6의 기동 복구(coding token 회수, claim 반납)는 coding-agent 단위가 `wiring/apps-tickets.ts`의 `start`에 더한다. 거기에는 ticket claim 정리의 첫 호출이 이미 있다. 이 task는 그 복구 코드를 만들지 않고, `start`가 `ctx.runtime`의 writer와 readers를 쓸 수 있게만 해 둔다.

### runtime.ts의 module 몫

`runtime.ts`는 ledger runtime을 여는 file이다. 안에 module 몫이 섞여 있다. 마지막 단계에서 아래를 wiring file로 옮긴다 (`Built.reads`와 `start`를 쓴다).

| `runtime.ts`에 있는 것 | 옮길 곳 |
|---|---|
| ticket claim 정리(`machine:ticket-claims` 자격, `sweepTicketClaims`) | `wiring/apps-tickets.ts` (`records`에 자격, `start`에 timer와 첫 호출. 정리 interval은 `ticketClaimSweepIntervalMs`) |
| invocation 재시작 복구(`sweepInterruptedInvocations`) | `wiring/apps.ts` (`start`에서 한 번) |
| notification 표시 전달(`createNotificationDelivery`, `deliveryMemory`, `decorate` 루프) | `wiring/notifications.ts` (`Built.reads`, `Built.memory`) |
| `backupReads` 등록 | `wiring/storage-restore.ts` (`Built.reads`) |
| `packagesGuideBody` read handler | `wiring/apps.ts` (`Built.reads`) |
| `reportBody` read handler | `wiring/problems.ts` (`Built.reads`) |

`CoreRuntime`에서 위 멤버(`sweepTicketClaims`, `sweepInterruptedInvocations`, `deliveryMemory`)를 뺀다. `runtime.ts`는 writer·reader·secret store·event dispatcher·generic read 등록만 남는다. `PROVIDER_SECRET_OWNER` reclaim 설정은 provider(lophn-agent) 몫이지만 secret store를 여는 곳이라서 그대로 두고 보고한다.

## 할 일

작업 순서는 이렇다. **각 단계 끝에 `deno task check`가 통과하고 commit할 수 있어야 한다.** 한 session에 다 못 끝나면 통과하는 마지막 단계까지 commit하고 남은 단계를 보고에 쓴다.

1. **기준선 부팅**: `core-wiring-trim`의 1번과 같은 명령으로 지금 core가 뜨고 20초 뒤 정상 종료하는지 본다 (stdout/stderr 첫 20줄을 기록해 둔다).
2. **틀 만들기**: `wiring/context.ts`(type과 단일 import 지점), `assembly.ts`(`TEAMS`, `TEAM_MODULES`, 빈 `WIRINGS`). `main.ts`가 `assembly.ts`의 `TEAMS`, `TEAM_MODULES`를 쓰게 하고 `CoreOptions`에 `wirings: readonly Wiring[]` 칸을 더하고 `main.ts`가 `assembly.ts`의 `WIRINGS`를 넘긴다(`teams`와 같은 방식). `core.ts`의 `with*Reader` helper를 `TEAM_MODULES`로 옮겨 지운다. 이 시점에는 wiring이 하나도 없어도 된다.
   - `createDocumentsChannel`은 `wiring/context.ts`에서 `createWorkerChannel`이라는 이름으로 한 번만 import해 내보낸다. 모든 wiring과 `core.ts`는 거기서 가져온다 (lead가 `I6#1`로 위치를 옮길 때 고칠 줄이 하나가 된다). `createProductRedactor`도 같은 방식으로 `context.ts` 한 곳에서 `runtime.ts`·wiring이 가져간다.
3. **module을 하나씩 옮긴다.** 위 파일 표의 순서로, 의존이 적은 것부터 한다: config, secrets, diagnostics, supervision, storage, storage-restore, events, server, approvals, notifications, projects, apps, apps-revert, apps-tickets, apps-export, problems, lophn-agent 하위들. 옮길 때마다:
   - `core.ts`의 그 module 코드를 wiring file로 잘라 옮기고, 구동기에 `Wiring` 한 칸을 붙인다.
   - 지금 지역 변수로 module 사이를 잇던 것(`bodyPrepare`, `prepareRelay`, `blobRelay`, `knownSecrets`, `runtime`, `io`, `apiPort` 등)은 `WiringContext` 칸으로 바꾼다.
   - `deno task check`를 돌려 통과하면 commit한다 (메시지: `Move <module> wiring out of core.ts`).
4. **`runtime.ts`의 module 몫을 옮긴다** (위 표).
5. **구동기를 정리한다**: `core.ts`에 module 이름(approvals, apps, problems 등)이 하나도 남지 않게 한다. `grep -nE "approvals|notifications|problems|lophn-agent|apps/|projects/" packages/core/main/daemon/core.ts`가 import 몇 줄 밖에 남기지 않아야 한다 (`install-and-update`의 lock·data root·run metadata, `storage`의 `Writer`·`ReaderPool` type은 구동기 몫이다).
6. **마지막 확인**: `deno task check`와 기준선 부팅 명령을 다시 돌려 둘이 같은지 본다. 종료 때 `ps`로 child process(writer·reader Worker가 아닌 deno child: platform/io, 앱 supervisor, agent runtime)가 남지 않는지 본다.
7. (lead가 맞추며 더함) `platform-register.ts`도 module별로 쪼갠다. approvals 반응은 `wiring/approvals.ts`로, notifications는 `wiring/notifications.ts`로, assignment 반응은 `wiring/lophn-agent-session.ts`로 보낸다. 뒤 wave의 단위가 자기 file만 고치게 하려는 것이다.

## 끝남

- `deno task check`가 통과한다.
- 기준선 부팅 명령이 전과 같이 종료 code 0이고 stderr가 깨끗하다. 안 돌면 보고에 이유를 쓴다.
- 위험 test: 없음 (동작을 바꾸지 않는 이동이다. 종료 순서가 어긋나면 writer가 닫힌 뒤 command가 들어가 data가 틀어질 수 있으므로 위 종료 순서 문단을 주석 한 줄로 `core.ts` 구동기에 남기고 review에서 대조한다)
- 남지 않음:
  - `core.ts`가 600줄 이하다. wiring file은 각각 400줄 이하다(넘기면 보고에 이유를 쓴다).
  - `grep -rnE "from \"\./" packages/core/main/daemon/wiring --include=*.ts | grep -v "context.ts"`가 0줄이다 (wiring끼리 import하지 않는다. `context.ts`만 가져간다).
  - `grep -n "wiring/" packages/core/main/daemon/core.ts | grep -v "context.ts"`가 0줄이다 (module wiring을 import하는 것은 `assembly.ts`뿐이다).
  - `runtime.ts`에 `ticket`, `notification`, `backup`, `invocation` 단어가 없다 (`grep -n`).

## 보고

- 바꾼 file (새 file 목록과 줄 수)
- 등록할 것: lead가 고칠 목록은 `assembly.ts` 하나다. 지금 `TEAMS`, `TEAM_MODULES`, `WIRINGS` 각각의 항목과 순서를 적는다.
- 안 쓰게 된 export: `registration.ts`와 `platform-register.ts`에서 쓰는 곳이 없어진 것 (남이 쓰던 것은 지우지 않았다)
- 정한 것:
  - `Wiring`·`Built`·`WiringContext`의 최종 모양 (위 초안에서 바뀐 것)
  - 위 표에 없어서 둔 코드의 놓은 곳
  - 한 file에 단위가 섞이는 것이 남았으면 어디인지
  - 부팅 확인 결과(전 / 후)
- 소유 바꾸기 요청 (wave 1·3에 필요한 daemon 안 file):
  - `wiring/notifications.ts`와 `wiring/storage-restore.ts`를 remove-platform에, `wiring/apps-export.ts`를 remove-app-extras에 준다 (file을 지우는 것과 `assembly.ts`의 한 줄은 lead가 한다)
  - `platform-register.ts`는 approvals·notifications·assignment 반응 몫이 섞여 있다. 이번에 쪼개지 않았다. notifications 부분은 remove-platform, approval 부분은 approvals, assignment 반응 부분은 places-sessions가 고쳐야 한다. 소유 지도에서 이 file을 누구에게 줄지 정해야 한다.
  - `registration.ts`의 `TeamModule`과 `assemble`은 팀 등록 key(`problemsTestDefinitions` 등)를 이름으로 읽는다. 새 팀 등록 key를 더하는 단위(router, annotation 등)가 이 file을 고쳐야 한다.
- 걱정: `main/worker/`, `main/app-supervisor/`, `main/agent-runtime/`의 file이 daemon의 type(`CoreRuntime`, `BlobPrepareCall`)을 import하는지(`code-map.md`는 module이 `main`을 import하지 못하게 한다. 지금도 `core/apps`, `core/problems`, `core/projects`, `core/notifications`, `core/storage`가 `main/daemon/*`를 import한다. 이 task는 path를 유지만 했다.)
