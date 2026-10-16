# releases-problems-bundle

release 준비의 bundle 쪽을 S7 4장대로 고친다. 준비 도중 원본 변경 감시를 지우고, 의존(SDK, 사용자 package, npm·jsr)을 정확한 version으로 bundle에 담아 운영 process가 내려받지 않게 하고, 준비는 언제나 맡은 ticket의 claim 아래에서만 하게 하고, `releases/mod.ts`를 새 module 모양에 맞춘다.

- 단위: releases-problems (wave 3)
- 선행: `releases-problems-activation`(`releases/commands.ts`·`activation/desired.ts`·`mod.ts`가 쓰는 이름이 거기서 바뀐다. 이 task가 마지막에 `mod.ts`를 정리한다), `releases-problems-packages`(`packageInstallPath`를 쓴다)
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/prepare/`
  - `packages/core/apps/releases/bundle/`
  - `packages/core/apps/releases/ui-build/`
  - `packages/core/apps/releases/worker/`
  - `packages/core/apps/releases/preparation.ts`
  - `packages/core/apps/releases/finalizer.ts`
  - `packages/core/apps/releases/mod.ts`
  - `packages/core/main/worker/release-job.ts`
  - `packages/core/apps/releases/activation/desired.ts` (`bundleFlags`만. 선행으로 activation task가 끝난 뒤에 고친다)
- 읽을 것:
  - spec: S7 4장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/activation.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I1.7#5`, `I2.5#25`(release 준비 흐름 몫: `prepare/`), `I2.7#16`, `I2.7#17`(manifest를 만드는 쪽), `I3.7#11`, `I3.7#12`, `I3.12#2`(release의 source map 유지)
  - 결정: `../README.md` 3장 #112(source 위치는 release의 source map으로 푼다)
  - 지금 코드: `packages/core/apps/releases/{prepare/*,bundle/*,ui-build/*,worker/run.ts,preparation.ts,finalizer.ts,mod.ts}`, `packages/core/apps/packages/install.ts`(설치 사본 쓰기), `packages/protocol/apps/releases.ts`(`bundleManifestSchema.dependencies`)
- 계약:
  - 쓰는 것: `bundleManifestSchema.dependencies`(`{ name, version, source: "sdk" | "package" | "npm" | "jsr" }[]`), `packageInstallPath`(releases-problems-packages), blueprint의 의존 선언 칸(이름은 contract-app-calls가 정한 것. 지금은 `sdk_dependencies`)
  - 내놓는 것: 정확한 의존이 모두 든 봉인 bundle과 `manifest.dependencies`. `releases/mod.ts`가 남기는 export 목록.

## 할 일

1. 원본 변경 감시를 지운다 (I1.7#5): `prepare/source-watch.ts`를 지우고 `prepare/flow.ts`(`gitSourceWatch`, `changedSince`, `source_changed` 두 곳과 254행 근처의 매핑), `prepare/from-source.ts`, `preparation.ts`, `worker/run.ts`의 `source_changed`·`minor` 상태를 정리한다. 준비는 지정한 commit에서 읽으므로 도중에 원본이 바뀌어도 결과가 달라지지 않는다(req-0814 rejected).
2. 준비 입구 (I2.7#14의 prepare 쪽): `finalizer.ts`가 `ticket_source`가 없는 접수를 확정하지 않게 한다(`request.ticket_source === undefined`를 허용하지 않고, `watch` 입력에서 `ticket_source`를 필수로 한다). `prepare/flow.ts`의 blueprint 값 가운데 `confirm`·`revert`·`automatic_tasks`·`documents`·`agent_context`를 읽는 곳이 있으면 걷는다(I2.5#25).
3. 의존을 bundle에 담는다 (I2.7#16, I2.7#17, I3.7#11, I3.7#12).
   - `bundle/lock.ts`: `lockAppImports`가 `lophn-sdk:@me/<이름>@<version>`도 받는다. 잠근 경로와 `readSdkCopies`가 읽는 설치 사본 위치는 `packageInstallPath`를 쓴다(`@lophn`과 `@me`의 같은 part가 부딪치지 않는다). 설치 안 된 사본은 준비를 막는 것을 유지한다.
   - npm·jsr: 정확한 pin이면 받아서 bundle에 담는다. 준비는 release worker 안(network를 쓸 수 있는 곳)에서 한 번 받고, 운영 process는 network 없이 bundle 안 사본만 쓴다. 담는 방법(`deno vendor` 계열이나 bundle 안 `vendor/` 폴더와 import map 매핑 등)은 지금 Deno 판에서 되는 것으로 고르고 정한 것으로 보고한다. 고른 방법에 맞춰 `activation/desired.ts`의 `bundleFlags`가 운영 process에 network·cache 권한 없이 도는 flag를 만들게 한다.
   - `bundle/import-map.ts`: npm·jsr를 거절하던 함수(제품 코드가 부르지 않는다)를 지운다. `parseSdkSpecifier`, `sdkPathMap`, `resolveSpecifier`, `lockedImportMap`, `validDependency*` 가운데 쓰는 곳이 남는 것만 둔다.
   - `bundle/manifest.ts`: `buildManifest`가 `dependencies`(`source` 포함)를 싣고, `sdk_dependencies`는 비운다. `prepare/flow.ts`는 `prepare/from-source.ts`가 모은 의존으로 넘긴다.
4. source map (I3.12#2): `ui-build/build.ts`의 external source map(`app.js.map`, `SOURCE_MAP_COPY_NAME`)과 `sourcesContent`가 봉인 bundle에 계속 들어가는지 확인한다. 안 들어가면 넣는다. annotation이 쓸 위치 풀이는 이 task에서 만들지 않는다.
5. `releases/mod.ts`를 정리한다: `source-watch`·`checkPin`·`gitSourceWatch` 계열 export를 뺀다. activation task가 이름을 바꿨거나 안 쓰게 된 export(`compareReleases`가 아직 쓰이면 둔다)를 확인해 맞춘다. `core/apps/register.ts`와 `main/daemon`이 import하는 이름은 유지한다(`grep -rn "releases/mod.ts\|apps/releases" packages/core --include=*.ts`로 확인).
6. worker 입구: `core/main/worker/release-job.ts`가 `prepare/from-source.ts`를 부르는 꼴이 바뀌었으면 맞춘다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "source-watch\|gitSourceWatch\|source_changed\|observeSourceChanged" packages/core`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: 이 module을 밖에서 import하던 것 가운데 안 쓰게 된 것의 목록
- 정한 것: 문서에 답이 없어 worker가 정한 것(npm·jsr를 bundle에 담는 방법과 `bundleFlags` 변경)
- 계약 바꾸기 요청(wave 3): 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다(예: `manifest.dependencies`에 npm·jsr 사본 위치를 싣는 칸이 필요할 때)

- (lead가 더함, releases-problems-activation가 넘긴 것. 추가 소유, lead 승인: `core/apps/register.ts`의 releases·activation 줄과 `main/daemon/wiring/apps.ts`의 activation 연결 줄) app-calls-assembly가 이미 끝나서 이 등록을 이 task가 넣는다.
  - `core/apps/register.ts`: `releaseCommands.activatePrevious`, reads `releaseReads.listRecords/getRecord/activationCompare`를 ledger와 reader 양쪽에 등록한다. `releaseActivated/Superseded/ActivationFailed`를 쓰는 visibility 등록은 옛 event 기준이니 걷는다(`ReleaseActivated`는 더 나가지 않는다). `activations.queue`는 `createActivationQueueRead({ entries: appsControl.activation.queueEntries })`를 API read로 덮는다(preview reads와 같은 방식).
  - wiring: `appsControl.activation.attach({ approvals: { createPending, cancelPendingFor, request, pending }, bus, intake: AppIntake, heldCalls?, invocations: { pruneChangesets } })`. `Approvals`에 `request(id)`·`pending()` 읽기가 없으니 wiring에서 ledger read로 임시 구현한다. `heldCalls`는 `AppIntake`에 없으면 넘기지 않는다(0). `attach` 전에는 activation이 일하지 않는다.
  - Reactor에 `activation.handlers.ticketVerified`, `activation.handlers.approvalDecided`를 등록하고 `approvals.registerApplier("activation", activation.handlers.applier)`를 부른다. Reactor가 handler를 실제로 부르는 구현이 아직 없으면(events-reactor) 등록 줄만 넣고 보고한다.
  - `releases.list/get`은 새 record를 `as never`로 낸다. 옛 route의 zod 출력과 모양이 달라 client parse가 깨질 수 있다. `core/problems/repairs/assembly/reads.ts`, `core/apps/control.ts`의 `releasesGet` 사용처를 `releases.get_record`로 옮기고 옛 `releases.list/get`·`compareReleases`가 안 쓰이면 지운다.

- (lead가 더함, coding-agent-tickets가 넘긴 것) 이 task 소유 file 가운데 `TicketClaimCheck`를 쓰는 곳(`apps/releases/commands.ts`, `problems/repairs/commands.ts`, `problems/tests/request-ports.ts`)이 아직 없어진 `ticket_problems` 표와 `kind='repair'` 열을 읽는다. 새 `tickets` 표 모양에 맞추거나 걷는다. `ProblemFixRecorded`와 `releases.ticket_source`는 옛 모양 그대로 읽힌다.
- (lead가 더함, annotation-core가 넘긴 것. 추가 소유, lead 승인: wiring의 `releaseSourceMaps` 칸 채우기) `WiringContext.releaseSourceMaps`를 채운다(release bundle의 source map 읽기). 없으면 annotation의 source 위치가 null이다.
- (lead가 더함, coding-agent-harness가 넘긴 것) `release prepare`(CLI·route) 출력에 준비된 release id가 없는데 `ticket report`는 `release` id를 요구한다. prepare 결과에 release id를 싣는다(계약 고침 필요하면 보고).
- (lead가 더함, fix-agent-routes가 넘긴 것. 추가 소유, lead 승인: apps wiring의 memory handler 줄) `blueprintCheck`(`checkBlueprint({dataRoot, sourceRootOf(ctx, app)})`, `core/apps/mod.ts`)와 `packagePublish` memory handler를 core에 건다. `sourceRootOf`는 `core/apps/control.ts`의 `releaseGate`(target authorizer와 `sourcePathOf`) 모양으로 호출자가 그 앱을 열 수 있는지 보고 source 폴더를 돌려준다. route는 lead가 registry에 올렸다.
- (lead가 더함, coding-agent-session이 넘긴 것) release bundle source를 읽는 port(`coding/source-diff.ts`의 `ReleaseSourceReader` 가정)를 relay `sources()`에 잇는다. 없으면 `coding.source_diff`가 unavailable이다.
