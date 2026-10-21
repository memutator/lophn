# ab-release-prepare

App Engineer가 `release.prepare` 한 번으로 release를 준비한다. 앱 source의 지금 commit(HEAD)으로 bundle을 만들고, 그 자리에서 검사(의존성, migration, blueprint와 handler 일치)를 하고, 통과하면 prepared release를 남긴다(README "release 준비는 한 단계다"). 준비와 마무리의 두 단계, coding agent의 ticket claim 검사, 같은 bundle의 app test 요구, release와 ticket의 묶음(`ticket_source`, `release_tests`)을 지운다(roadmap "지우는 것" 표). 다른 domain이 쓰는 공개 tool을 지우는 release면 막지 않고 결과에 그 tool과 쓰는 쪽을 싣는다(README "공개 tool 막기는 준비 결과의 알림이다").

정한 것: 검사에 떨어진 것은 오류가 아니라 `failed` 출력이다. 이유: model은 오류 code마다 고정 글만 받는다(`packages/core/lophn-agent/tools/work.ts`의 `FAILURE_SUMMARIES`. 이슈 `coding-agent.md`가 같은 일로 막혔다). 떨어진 이유가 model에 닿아야 App Engineer가 고친다.

정한 것(planner, 뼈대 뒤): 같은 bundle을 다시 준비하면 그 앱의 같은 bundle release가 아직 `prepared`일 때만 그것을 다시 준다. `failed`, `active`, `superseded`, `activating`이면 새 release 행을 만든다. 이유: `release.activate`는 `prepared`만 받는다(ab-release-activate). 일시적 이유(drain, start)로 activation이 실패한 release를 다시 주면 그 commit을 다시 올릴 수 없다. 다시 주는 자리는 `release.record` command 안(`packages/core/apps/releases/commands.ts`의 `record`, store 함수 `findPreparedRelease`)이다.

정한 것(flesh. planner 확인 필요. 소유에 뼈대 밖 file을 더했고 계약 셋을 고쳤다):
- 의존성과 migration 검사는 준비 자식(`packages/core/main/worker/release-job.ts`)이 build 바로 뒤에 돈다. core에서 돌리지 않는다. 이유: 앱이 쓴 migration SQL을 core process에서 돌리지 않는다(`packages/core/apps/data/worker/db.ts` 머리 주석 "core·supervisor는 이 모듈을 import하지 않는다", `architecture/activation.md` "core는 앱 DB를 열지 않는다"). Deno는 권한을 좁힌 process에서 `node:sqlite`의 `ATTACH`와 `VACUUM INTO`를 막는다(deno 2.9.7에서 확인). 준비 자식은 쓰기가 `apps/<app>`뿐이다(`release-runner.ts` 52-53).
- 그래서 supervisor 통로를 고친다. 지금 준비 자식이 stdout에 내는 실패 이유(`release-job.ts` 29)를 `release-runner.ts`의 `readOutcome`이 "preparation failed"로 버리고(117), 준비 조회(`PreparationSnapshot`)에는 이유 칸이 없다. 자식은 core만 아는 active release의 schema도 받아야 한다. 소유에 `packages/core/apps/runtime/{control-protocol.ts,supervisor-link.ts}`, `packages/core/main/app-supervisor/release-runner.ts`를 더했다. 뼈대의 "남지 않음" grep(`prepare_bundle`)도 `control-protocol.ts` 36의 op 이름에 걸린다.
- `removed_public_tools`의 쓰는 쪽은 `{ app, domain }`이 아니라 domain 이름 목록이다. 이유: 쓰는 쪽은 앱이 아니라 domain이다(`packages/core/apps/usage/users.ts`의 `ToolUser`는 `{ tool, domain: <domain id>, source }`). domain의 그릇은 project나 app이고(`packages/protocol/domains/values.ts` 16-19) 이름은 전 domain에서 하나다.
- source 폴더가 없거나 commit이 없으면 오류(`invalid_input`)가 아니라 `{ status: "failed", stage: "build" }`다. 이유: 위 첫 "정한 것"과 같다. `invalid_input`이면 model은 "tool input is not valid"만 본다. App Engineer가 commit하면 풀린다.

- 단위: release (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/releases.ts`
  - `packages/protocol/apps/activation/activation.ts`
  - `packages/core/apps/releases/`(`finalizer.ts`는 지운다)
  - `packages/core/apps/{control.ts,register.ts}`
  - `packages/core/apps/preview/service.ts`
  - `packages/core/apps/runtime/{control-protocol.ts,supervisor-link.ts}`(release 준비 op의 이름, 입력, 출력만. flesh가 더함)
  - `packages/core/main/app-supervisor/release-runner.ts`(flesh가 더함)
  - `packages/core/main/daemon/wiring/apps.ts`
  - `packages/core/main/worker/release-job.ts`
  - `packages/core/apps/agent-tools/release.ts`
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/apps/usage/users_test.ts`(release fixture만)
  - `packages/protocol/apps/blueprint/read.ts`(`appBlueprintEvidenceSchema`의 `test`만)
  - `packages/core/apps/blueprint/{reads.ts,reads_test.ts}`(`evidence.test`만)
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "정한 것"("App Engineer의 새 tool", "release 준비는 한 단계다", "공개 tool 막기는 준비 결과의 알림이다")과 "뼈대 검토에서 정한 것"(검사 실패는 결과, handler 검사는 preview service로 봉인된 bundle을 띄우고 그 앱의 지금 preview를 바꾼다, 지우기가 끌고 오는 `evidence.test`)
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "지우는 것" 표(release와 ticket의 묶음, test runner, 공개 tool 막기 줄), "정한 것(agent)"의 "release 준비는 App Engineer가 한다", "test runner의 data 검사는 release 준비 안에서 바로 한다", "공개 tool 막기를 알림으로 바꾼다"
  - 앞 wave의 brief(이 task가 기대는 모양): `ab-release-checks.md`(`checkDependencies`, `checkMigration`, core graph에 넣지 않는다), `ab-preview.md`(`previews.start`의 `fixture` 경로, service의 `agent` 자격), `ab-release-activate.md`(`release.activate`가 memory route로 `control.ts` commands map에 있고 `withReleasePreparation`이 돌린다. `blockActivation`과 `blockedToolsOf` 부르기가 없어졌다), `ab-publish.md`(`wiring/apps.ts`의 `verification`이 없어졌다), `ab-cli.md`(coding CLI가 `release prepare/status`를 지웠다)
  - architecture(지금 동작이고 이 task로 틀린다. 문서는 계획 끝에 lead가 고친다): `project-docs/architecture/activation.md`의 "지키는 것"(`-- loss:` 줄, 공개 tool 막기)과 "왜 이 모양인가"(core는 앱 DB를 열지 않는다), `project-docs/architecture/coding-agent.md` 62줄(release 확정은 CLI의 `release status`가 일으킨다), `project-docs/architecture/domain.md` 34, 66줄(release를 기록하는 준비 command와 preview bundle 사본이 domain을 본다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `app-data`, `app-runtime`, `child-supervision-protocol`; `project-docs/module-catalog.yaml`의 `packages/core/apps`, `packages/core/main`, `packages/protocol`
  - 코드(줄은 main `dd956b49f`. wave 1·2가 고친 file은 줄이 밀린다. 이름으로 찾는다)
    - protocol `packages/protocol/apps/releases.ts`: `ticketSourceSchemas`(37-49), `activationSchemas`(64-83. `started_seq`를 쓰는 옛 모양), `APP_TOOL_CHANGE_KINDS`~`releaseComparisonSchema`(108-153), `releaseSchemas`·`Release`(155-201. 쓰는 곳은 `commands.ts`의 `outputRelease` 하나), `releaseRequestActors`(206-208), `releasePrepareBundle`(210-231), `releasePreparation`(233-257), `releaseCancelPreparation`(259-275), 지금의 machine `releasePrepare`(277-312), `RELEASE_ROUTES`(326-331)
    - protocol `packages/protocol/apps/activation/activation.ts`: `releases.ts`에서 가져오는 것(15-21), `releaseRecordSchema`(60-98. `tests` 69-73, `ticket_source` 74), `ACTIVATION_ROUTES`(342-355). `packages/protocol/apps/registry.ts` 82-88(두 목록을 펼친다. 83줄 주석: protocol file끼리 순환 import를 피한다. `activation.ts`가 `releases.ts`를 import하므로 반대 방향은 안 된다)
    - 확정 command: `packages/core/apps/releases/commands.ts` 머리 주석(1-6), import(22-25, 31-35), `portOf`(89-96), `checkPreparationClaim`(98-140), `outputRelease`(194-200), `prepareBundle`(589-629), `prepare`(630-735. 검증 순서 647-698), `checkTests`(789-819)
    - 표와 저장: `releases/schema.ts`(3, 22, 45-48, 56, 69, 78-87), `releases/store.ts`(`testsOf` 24-29, `releaseFromRow` 46-47, `findReleaseForTicket` 161-172, `insertRelease` 185-217), `releases/mod.ts` 39
    - 공개 tool: `releases/public-tools.ts`(`removedPublicOf` 14-23, `blockedToolsOf` 98-115), `packages/core/apps/usage/users.ts`(`appToolUsers` 18-75), `packages/protocol/domains/ports.ts`(`DomainLookup.get`)
    - 지금의 두 단계: `releases/preparation.ts`(supervisor 메모리 진행 `createPreparationService`), `releases/finalizer.ts`(지운다), `control.ts`의 `releaseGate`(474-487), `lastCompleted`·`testDefaults`(488-511), `releasePrepareBundleHandler`(512-548), `releaseIdOf`(549-566), `releasePreparationHandler`(567-612. 봉인 578-591), `releaseCancelHandler`(613-624), `finalizer`(626-634), commands map(680-685), `withReleasePreparation`(861-888), `withTestDefaults`(890-925), `APPS_CONTROL_CONTEXT`(113-139. 133줄 `FINALIZER_OPERATIONS`), `appsOperationPolicies`의 준비 route(219-231), deps `findPassedAppTest`·`testOf`(264-272)
    - supervisor 통로: `packages/core/apps/runtime/control-protocol.ts`의 `SUPERVISOR_OPS`(36-38), `releasePrepareInputSchema`·`releasePreparationOutputSchema`(148-167), `supervisor-link.ts`의 `releasePrepare` 입력 type(234-239)과 구현(333-347), `packages/core/main/app-supervisor/assembly.ts`(936-958. 파싱한 입력을 그대로 `preparationOf().start`에 넘기고 snapshot을 그대로 돌려준다), `release-runner.ts`(자식 argv 58-63, 멈춤 84-89, `readOutcome` 99-118), `packages/core/main/worker/release-job.ts`(전부), `releases/prepare/from-source.ts`(`prepareFromSource` 196. 실패 이유는 `blueprint_eval_failed` 같은 짧은 code다. staging 235-236), `releases/prepare/flow.ts`(`PreparedRelease` 57-62. 끝난 사본은 봉인 전이다 213-222)
    - HEAD 읽기 본보기: `packages/core/apps/packages/publish.ts` 79-91(agent runtime child는 git을 못 띄운다)
    - 봉인과 사본: `releases/bundle/seal.ts`(`bundleCopyPath`, `sealCopy`), `releases/activation/desired.ts`(`readBundleCopy` 112-173. 161줄이 검증기 message를 버린다, `dataChangesOf` 70-106, `createCopyPreviewBundles` 235-281)
    - preview: `packages/core/apps/preview/service.ts`(`PreviewService` 90-110, `unattachedPreviewService` 150-160, `start` 199-281, `stop` 301-315, `current` 317-332), `preview/model.ts`(`PREVIEW_STARTING`의 code `starting`), `preview/launcher.ts`(`READY_TIMEOUT_MS` 118, 실패 이유 `start_failed`·`unexpected_exit` 205-337. 이유 글은 "handler or schema mismatch" 같은 요약이다)
    - wiring: `packages/core/main/daemon/wiring/apps.ts`(import 39-40, 81-86, activation deps 163-178, writer 사슬 304-311)
    - tool: `packages/core/apps/agent-tools/release.ts`(전부), `agent-tools/app.ts` 115-140(`commandOf` 본보기), `packages/core/lophn-agent/tools/fit-result.ts`(`fitted`), `packages/core/agent-roles/tool-lists.ts`(`app_engineer` 59-69, `TOOL_ORDER` 91-140)
    - blueprint 읽기: `packages/protocol/apps/blueprint/read.ts` 35-48, `packages/core/apps/blueprint/reads.ts` 148-157
    - fixture: `packages/core/apps/usage/users_test.ts` 59-60, `packages/core/apps/releases/activation/consents_test.ts`(ab-release-activate가 다시 쓴 뒤의 `insertRelease` fixture)
- 계약:
  - 쓰는 것: `checkDependencies`, `checkMigration`(ab-release-checks, `packages/core/apps/releases/prepare/checks.ts`), preview service와 launcher의 tool 선언 대조(`packages/core/apps/preview/launcher.ts`의 "handler or schema mismatch"), supervisor 준비(`PreparationService`, `release-job.ts`), `removedPublicOf`와 `appToolUsers`(`public-tools.ts`, `packages/core/apps/usage/`)
  - 내놓는 것:
    - route `release.prepare`(`releasePrepare`, `RELEASE_ROUTES`): command, core memory route(`register.ts`의 `memoryRoutes`. handler는 `control.ts`의 commands map에 있고 `withReleasePreparation`이 writer 앞에서 돌린다), actors `["agent"]`(그 앱의 App Engineer. agent 자격의 앱 조건이 본다), 입력 `{ app: app_… }`. 출력은 둘 가운데 하나다.
      - `{ status: "prepared", release: { id, number, status, code_commit, bundle_hash, data_schema }, removed_public_tools: { tool: string, domains: string[] }[] }`. `domains`는 그 tool을 쓰는 다른 domain의 이름이다. 그 앱에 같은 bundle의 `prepared` release가 있으면 새로 만들지 않고 그것을 준다. 같은 bundle의 release가 `prepared`가 아니면 새 release 행을 만든다(위 planner 결정).
      - `{ status: "failed", stage: "build" | "dependencies" | "migration" | "handlers" | "release", reason: string }`. release 행은 생기지 않는다. source 폴더가 없거나 HEAD commit이 없으면 `build`다.
      - errors: `invalid_input`(입력 모양), `forbidden`(agent 자격이 아님), `not_found`(없는 앱과 범위 밖 앱. 같은 답), `conflict`(보관한 앱, 그 앱의 준비가 이미 돌고 있음), `unavailable`
    - HEAD는 core가 읽는다(agent runtime child는 git을 못 띄운다. 본보기 `packages/core/apps/packages/publish.ts`).
    - 의존성과 migration 검사는 준비 자식이 build 뒤에 돈다. supervisor 통로: op `releases.prepare`(옛 `releases.prepare_bundle`)의 입력에 `previous_schema: number | null`(그 앱의 active release의 `data_schema`, 없으면 null)이 있고, 준비 조회 출력(`releasePreparationOutputSchema`, `PreparationSnapshot`)에 `failure: { stage: "build" | "dependencies" | "migration", reason: string } | null`이 있다. `PreparationRunner.run`은 실패를 `PreparationFailure`(`{ stage, reason }`)로 돌려준다.
    - blueprint와 handler 일치: preview service의 core 안 method `check(app, bundle_hash): Promise<Result<{ ok: true } | { ok: false; reason: string }>>`(route gate 없음)가 봉인된 bundle을 fixture 없이 띄워 ready나 실패를 보고 닫는다. 그 앱의 지금 preview는 지금 규칙(앱마다 하나)대로 닫힌다.
    - ledger 확정 command는 `release.record`(`releaseRecord`, machine만, `ACTIVATION_ROUTES`. 순환 import 때문에 `activation.ts`에 둔다)로 이름이 바뀐다. 입력에 `tests`, `ticket_source`, `comparison`이 없고 `created_by`는 준비를 부른 agent다. 출력은 `{ release: ReleaseRecord, removed_public_tools }`다. 지금의 blueprint·manifest·data_changes 확인은 그대로다(떨어지면 `invalid_input`이고 준비 출력의 `failed`/`release`가 된다). 같은 bundle의 `prepared` release를 다시 주는 것도 이 command다.
    - `ReleaseRecord`와 표 `releases`에 `tests`, `ticket_source`가 없고 표 `release_tests`가 없다. step `apps.releases.tables`를 그 자리에서 고친다(개발 data는 지우고 새로 만든다).
    - 없어지는 것: route `release.prepare_bundle`, `release.preparation`, `release.cancel_preparation`과 그 handler, `finalizer.ts`(`FINALIZER_OPERATIONS`), `checkPreparationClaim`, `checkTests`, `AppsControl.testDefaults`, `withTestDefaults`, `lastCompleted`, activation deps의 `findPassedAppTest`·`testOf`, `findReleaseForTicket`, `ticketSourceSchema`, protocol의 옛 `Release`(`releaseSchemas`)와 `releaseComparisonSchema`, `blockedToolsOf`.
    - 앱 blueprint 읽기의 근거(`appBlueprintEvidenceSchema`)에 `test`(`passed`, `verifications`)가 없다. 지금 `release.tests`에서 채운다. renderer는 읽지 않는다.
    - agent tool `release.prepare`(App Engineer만). `release.get`은 test 결과를 읽지 않는다(`getVerification`을 쓰지 않는다).

## 할 일

1. 먼저 확인한다(앞 wave가 merge된 뒤). 다르면 고치지 말고 file:줄을 보고하고 멈춘다.
   - `git grep -nw "releasePrepareBundle\|releasePreparation\|releaseCancelPreparation" -- packages ':!packages/core/apps' ':!packages/protocol/apps'`가 0줄이다(ab-cli가 coding CLI와 `packages/coding-agent/cli/main_test.ts`에서 뗐다).
   - `packages/core/apps/releases/prepare/checks.ts`가 있고 `checkDependencies`, `checkMigration`, `CheckOutcome`이 ab-release-checks의 계약대로다.
   - `git grep -n "blockedToolsOf\|activationBlock" -- packages`가 `public-tools.ts`의 정의뿐이다(ab-release-activate).
   - `git grep -n "verification" -- packages/core/apps/packages/publish.ts packages/core/main/daemon/wiring/apps.ts`가 0줄이다(ab-publish).
2. protocol `releases.ts`(근거: roadmap "지우는 것" 표의 release와 ticket의 묶음, test runner 줄).
   - 지운다: `ticketSourceSchemas`·`ticketSourceSchema`·`ticketSourceInputSchema`, `activationSchemas`, `APP_TOOL_CHANGE_KINDS`~`releaseComparisonSchema`, `releaseSchemas`·`Release`, 203줄의 떠도는 주석, `releaseRequestActors`, `releasePrepareBundle`, `releasePreparation`, `releaseCancelPreparation`, 지금의 machine `releasePrepare`.
   - 더한다: `removedPublicToolSchema = z.object({ tool: toolKeySchema, domains: z.array(z.string().min(1)) })`(export. `activation.ts`도 쓴다)와 agent route `releasePrepare`(`defineCommand`, resource `releases`, method `prepare`, name `release.prepare`, actors `["agent"]`, 입력 `z.strictObject({ app: appIdSchema })`, 출력은 `status`로 가르는 `z.discriminatedUnion`, errors는 위 계약). 출력의 `release`는 `id`·`number`·`status`(`releaseStatusValueSchema`)·`code_commit`·`bundle_hash`·`data_schema`만 싣는다.
   - `RELEASE_ROUTES`는 `releasePrepare`와 ab-release-activate의 `releaseActivate`다.
   - 안 쓰게 된 import(`invocationIdSchema`, `atSchema` 등)를 지운다.
3. protocol `activation.ts`.
   - `releaseRecordSchema`에서 `tests`, `ticket_source`와 `ticketSourceSchema` import를 지운다.
   - `releaseRecord`를 더한다: `defineCommand`, resource `releases`, method `record`, name `release.record`, actors `["machine"]`, 입력은 지금 `releasePrepareInputSchema`(releases.ts 278-300)에서 `tests`, `ticket_source`, `comparison`을 뺀 것(`app`, `commit`, `bundle_hash`, `blueprint_hash`, `blueprint`, `manifest`, `data_schema`, `data_changes`, `created_by`, `key`), 출력 `z.object({ release: releaseRecordSchema, removed_public_tools: z.array(removedPublicToolSchema) })`, errors `forbidden`, `invalid_input`, `conflict`, `unavailable`. `ACTIVATION_ROUTES`에 넣는다. `bundleManifestSchema`, `removedPublicToolSchema`는 `../releases.ts`에서 가져온다.
4. 표와 저장(근거: AGENTS.md "호환성". migration 없이 그 자리에서 고친다).
   - `schema.ts`: `ticket_source` 열(22), 그 index(45-48), trigger의 `ticket_source` 줄(56), `release_tests` 표·index·trigger 둘(78-87)을 지운다. 머리 주석(3)의 "release_tests"와 69줄 주석의 "Reactor는 TicketVerified를 지나 다시 묻지 않는다"(ab-release-activate 뒤 남았으면)를 고친다.
   - `store.ts`: `testsOf`와 `releaseFromRow`의 `tests`·`ticket_source`, `insertRelease`의 `ticket_source` 열과 `release_tests` 쓰기를 지운다. `findReleaseForTicket`을 지우고 `findPreparedRelease(sql, app, bundleHash): Result<ReleaseRecord | null>`를 둔다(`WHERE app = ? AND bundle_hash = ? AND status = 'prepared' ORDER BY number DESC LIMIT 1`). 위 "왜" 주석: `release.activate`는 `prepared`만 받아 다른 상태의 release를 다시 주면 그 commit을 다시 올릴 수 없다.
   - `mod.ts`: `findReleaseForTicket` export를 지운다.
5. 공개 tool 알림(근거: README "공개 tool 막기는 준비 결과의 알림이다", roadmap "공개 tool 막기를 알림으로 바꾼다").
   - `public-tools.ts`: `blockedToolsOf`, `DomainNotice`, `grouped`, `domainsByTool`, `toolsOfBoth`를 지우고 `removedPublicToolsOf(tx, app, nextTools): Result<{ tool: string; domains: string[] }[]>`를 둔다. active release의 고정 blueprint(`loadActiveBlueprint`)가 없으면 `[]`다. `removedPublicOf(앞 tools, nextTools)`가 비면 `[]`다. 아니면 `appToolUsers`(`usagePorts`)의 쓰는 쪽 가운데 지운 tool의 것을 tool별로 묶고 domain id를 `domainLookupPort.get(id)?.name`으로 바꾼다(없으면 id). 이름순이다. port가 없거나 읽지 못하면 `unavailable`이다. 머리 주석을 "activation 막기" 대신 "준비 결과의 알림"으로 고친다.
6. 확정 command `commands.ts`.
   - 지금 `prepare`(630-735)를 `record`(route `releaseRecord`)로 바꾼다. 검사 순서는 그대로(machine, 앱, 앱 범위, 보관, blueprint 검증과 hash, manifest, 의존, sdk 권한, `checkDataChanges`)이고 `checkTests`와 `checkPreparationClaim` 부르기를 지운다.
   - 검사 뒤 `findPreparedRelease(tx.sql, input.app, input.bundle_hash)`가 있으면 그것을 준다. 없으면 지금처럼 새 행을 넣는다(`tests`, `ticket_source` 없이). 두 길 모두 `removedPublicToolsOf(tx, input.app, blueprint.tools)`를 `removed_public_tools`로 싣는다.
   - 지운다: `prepareBundle`(589-629), `checkPreparationClaim`(98-140), `checkTests`(789-819), 쓰는 곳이 없어진 `portOf`, `outputRelease`와 `Release` import, `TicketClaimCheck`·`TicketId`·`AppTestVerificationLookupPort` import, `createReleaseCommands` 반환 type의 `prepare`·`prepareBundle`.
   - 머리 주석(1-6)을 고친다: `release.record`는 core가 준비와 검사를 마친 봉인 사본에서 모은 입력만 확정한다. machine만 부른다.
7. `finalizer.ts`를 지운다.
8. supervisor 통로와 준비 자식(위 "정한 것(flesh)").
   - `preparation.ts`: `PreparationJob`에 `previous_schema: number | null`, `PreparationFailure = { stage: "build" | "dependencies" | "migration"; reason: string }`, `PreparationRunner.run`의 반환을 `Result<PreparationOutcome, PreparationFailure>`로. `Entry`가 실패를 기억하고 `PreparationSnapshot.failure`로 낸다(`failed`가 아니면 null). runner가 던지면 `{ stage: "build", reason: "the preparation stopped unexpectedly" }`다. 머리 주석의 "취소"는 core의 기한 넘김 때만이다로 고친다.
   - `control-protocol.ts`: `SUPERVISOR_OPS.releasePrepare`의 값을 `"releases.prepare"`로(key 이름 셋은 그대로라 `assembly.ts`는 고치지 않는다). `releasePrepareInputSchema`에 `previous_schema: z.number().int().nonnegative().nullable()`, `releasePreparationOutputSchema`에 `failure`(위 모양, nullable)를 더한다. 주석 "접수는 즉시 답하고 진행은 `releasePreparation`으로 따라간다"는 그대로 맞다.
   - `supervisor-link.ts`: `releasePrepare` 입력 type에 `previous_schema`.
   - `release-runner.ts`: 자식 argv JSON에 `previousSchema: job.previous_schema`. `readOutcome`이 `{ ok: false, stage?, reason? }`를 읽어 `PreparationFailure`로 돌려준다(stage가 없거나 모르는 값이면 `build`). 멈춤(84-89)은 `{ stage: "build", reason: "the preparation was stopped (time limit)" }`, build 도구 실패(39-41)는 `{ stage: "build", reason: "build tools are unavailable" }`다.
   - `assembly.ts`(app supervisor)는 파싱한 입력과 snapshot을 그대로 넘겨 고칠 것이 없다. 고칠 일이 생기면 고치지 말고 보고한다.
   - `release-job.ts`: 입력에 `previousSchema: number | null`. `prepareFromSource`가 떨어지면 `{ ok: false, stage: "build", reason }`. 통과하면 같은 자식에서 `readBundleCopy(dataRoot, app, bundleHash)`(봉인 전 사본을 읽는다)로 manifest와 `dataSchema`를, `dataChangesOf`로 단계를, `<사본>/import-map.json`의 `imports`를 읽고 `checkDependencies` → `checkMigration` 순으로 돈다. 떨어지면 `{ ok: false, stage: "dependencies" | "migration", reason }`. `area`는 `appStagingFolder(dataRoot, app)`(없으면 먼저 만든다) 아래 새 임시 폴더(`Deno.makeTempDir({ dir, prefix: "checks-" })`)이고 `finally`에서 지운다. 자식이 죽어도 `release-runner.ts`가 `staging`을 통째 지운다. `dataChangesOf`가 `-- loss:` 줄로 떨어지면 `migration`이다.
9. preview 검사(근거: README "뼈대 검토에서 정한 것" 셋째 줄).
   - `preview/service.ts`: `start`의 gate 뒤 부분(bundle 열기 → 같은 앱의 앞 preview 닫기 → 영역 → flags → `supervisor.start` → `live`)을 함수 하나로 빼서 `start`와 `check`가 같이 쓴다. ab-preview가 ready 기다리기를 service에 두었으면 그것을 쓴다.
   - `check(app, bundleHash)`: release null, fixture 없이 띄운다. `supervisor.observe`를 짧은 간격(예: 250ms)으로 보며 `ready`면 통과, 이유의 code가 `starting`이 아니면(`start_failed`, `unexpected_exit`) 그 `summary`로 떨어진다. 관측이 null이면 "the check process was lost"로 떨어진다. 기한(launcher의 `READY_TIMEOUT_MS` 30초보다 넉넉히, 예: 45초. `deps.clock.nowMs()`로 잰다)을 넘으면 떨어진다. 끝나면 `stop`과 같은 길로 닫고 영역을 지운다. bundle을 열지 못하면(`bundles.open`의 err) 그 message로 떨어진다. supervisor에 닿지 못하는 것만 err(`unavailable`)다. 기다리는 함수는 deps(`wait?: (ms) => Promise<void>`, 기본 `setTimeout`)로 받는다.
   - `PreviewService` type과 `unattachedPreviewService`에 `check`를 더한다. 102-103줄 주석("아래 둘은 core 안에서만 부른다")에 `check`를 넣는다.
   - `releases/activation/desired.ts` 161줄: `readBundleCopy`의 "bundle blueprint is invalid"에 검증기 message를 붙인다(domain이 틀린 tool 같은 이유가 `handlers` 실패의 reason으로 App Engineer에게 닿는다).
10. `control.ts`의 `release.prepare` handler(근거: README "release 준비는 한 단계다").
    - 순서: gate → HEAD → supervisor 준비와 기다리기 → 봉인 → preview 검사 → `release.record`.
      - gate: `createTargetAuthorizer(ctx)(ctx, releasePrepare.name, { app })`가 떨어지면 `not_found`. 앱을 읽어(`facts.app`이나 `loadApp`) 없으면 `not_found`, 보관이면 `conflict`, `source_path`가 null이면 `{ status: "failed", stage: "build", reason: "the app has no source folder" }`.
      - 같은 앱의 준비가 돌고 있으면 `conflict`다(메모리 `Set<app>`. 같은 앱의 준비 둘은 같은 `apps/<app>/staging`을 쓴다). `finally`에서 뺀다.
      - HEAD: `publish.ts` 79-91처럼 `git -C <source> rev-parse HEAD`. 못 읽거나 40자 hex가 아니면 `{ failed, build, "the app source has no commit; commit the code first" }`.
      - `previous_schema`: ledger를 짧게 열어 `loadActiveRelease`의 `data_schema`(없으면 null).
      - supervisor: 새 `request_key`(예: `crypto.randomUUID()`)로 `client.releasePrepare`, 그다음 `client.releasePreparation`을 500ms 간격으로 `preparing`이 아닐 때까지 본다. 기한은 `RELEASE_PREPARATION_LIMIT_MS` + 60초(`deps.clock.nowMs()`)이고 넘으면 `client.releaseCancel` 뒤 `{ failed, build, "the preparation did not finish in time" }`. `failed`면 snapshot의 `failure`를 그대로 낸다. `cancelled`, `unknown`이면 `{ failed, build, "the preparation was lost (the app supervisor restarted); prepare again" }`.
      - 봉인: 지금 `releasePreparationHandler` 578-591과 같다.
      - preview 검사: `previewService.check(app, bundle_hash)`. 떨어지면 `{ failed, handlers, reason }`.
      - 기록: `readBundleCopy`(manifest, `dataSchema`), `dataChangesOf`, 사본의 `blueprint.json`을 읽어(finalizer 118-134와 같다) `deps.activation.command(machine, { command: releaseRecord.name, input, idempotency_key: key, compare: {}, prepared: [] })`. `key`는 `release-record-<request_key>`, `created_by`는 `ctx.actor`다. 결과는 `done.value.result`를 `releaseRecord.output`으로 읽는다(`wiring/apps.ts`의 package 등록 본보기 377-389). err가 `invalid_input`이면 `{ failed, release, message }`, 나머지 err는 그대로 돌려준다.
      - 통과하면 `{ status: "prepared", release: {…}, removed_public_tools }`.
    - commands map은 `[releasePrepare.name, releasePrepareHandler]`와 ab-release-activate의 `release.activate`다. `withReleasePreparation`에서 `releasePrepareBundle` 앞 검사(872-876)를 지운다. 머리 주석을 맞춘다.
    - 지운다: `lastCompleted`·`testDefaults`, `releasePrepareBundleHandler`, `releaseIdOf`, `releasePreparationHandler`, `releaseCancelHandler`, `finalizer`, `AppsControl.testDefaults`, `RequestTestBody`·`withTestDefaults`, deps `findPassedAppTest`·`testOf`, `requestTest`·finalizer import, `appsOperationPolicies`의 준비 route 셋(219-231).
    - `APPS_CONTROL_CONTEXT`의 `...FINALIZER_OPERATIONS`(132-133)를 `releaseRecord.name`으로 바꾸고 주석을 맞춘다.
11. `register.ts`: commands의 `releaseCommands.prepare` → `releaseCommands.record`, `releaseCommands.prepareBundle`을 지운다. `memoryRoutes`의 `releasePreparation`, `releaseCancelPreparation`을 지우고 `releasePrepare`를 넣는다. 216-217 주석을 맞춘다.
12. `wiring/apps.ts`: `withTestDefaults` import와 writer 사슬의 `withTestDefaults(…, appsControl.testDefaults)`, activation deps의 `findPassedAppTest`·`testOf`, problems import(남은 `findPassedAppTest`, `deriveAppTest`), `testOf`만 쓰던 `bundleCopyPath` import를 지운다.
13. agent tool(근거: README "App Engineer의 새 tool").
    - `agent-tools/release.ts`에 `release.prepare`: 입력 `z.strictObject({ app: idSchema("app") })`, routes `[releasePrepare]`, effect `write`, handler는 `commandOf(ctx.core, releasePrepare, { app }, {}, ctx.tool_call)`. `failed`도 tool 결과(`fitted`)로 돌려준다(오류로 돌리면 이유가 가려진다). 요약 예: `prepared release #3 (rel_…)`, `release preparation failed at migration: …`. 지운 공개 tool이 있으면 요약에 수를 덧붙인다. 설명 예: "Prepare a release from the HEAD commit of the app source, so commit first. It builds the bundle, checks the dependencies, runs the migrations on an empty database and from the active release's schema, and starts the bundle once to match its handlers with the blueprint (this replaces the app's current preview). Returns the prepared release and the public tools it removes that other domains use, or the failed stage and its reason."
    - `release.get`: `getVerification` import와 routes, `tests` 읽기를 지우고 `{ release }`만 돌려준다. 설명에서 "the results of its tests"를 지운다.
    - `tool-lists.ts`: `app_engineer` 쓰기 목록과 `TOOL_ORDER`에 `release.prepare`(`release.get` 뒤, `release.activate`가 있으면 그 앞).
14. blueprint 읽기: `read.ts`의 `appBlueprintEvidenceSchema`에서 `test`와 35-36 주석의 "실제 test 통과", `reads.ts` 148-157의 `test`와 주석을 지운다. `reads_test.ts`는 `evidence.test`를 보면 맞추고 아니면 고치지 않는다.
15. fixture: `users_test.ts` 59-60과 `consents_test.ts`의 `insertRelease` 입력에서 `tests`, `ticket_source`를 지운다(ab-release-activate가 지우지 않았으면 `TICKET` 상수도).
16. 확인할 것: 준비는 build(상한 `RELEASE_PREPARATION_LIMIT_MS` 300초)와 preview 검사로 오래 걸릴 수 있다. tool call 하나가 기다리는 동안 turn이 `stall_ms`(300초, `packages/protocol/lophn-agent/turn-values.ts`)에 걸리는지, 걸려 tool call이 끊기면 core의 준비가 이어서 release를 남기는지 본다. 고치지 말고 보고한다(ab-release-activate와 같은 항목).
17. 위험 test: 없음. 이유: migration 판정은 ab-release-checks의 `checks_test.ts`가 본다. "검사에 떨어진 준비는 release 행을 남기지 않는다"는 순서로 지킨다(`release.record`가 마지막 단계이고 부르는 곳이 이 handler 하나다). 그 길을 test하려면 가짜 supervisor, preview, writer가 필요해 호출을 세는 test가 된다(`write-test` skill "쓰지 않는 test").

## 끝남

- `deno task check`가 통과한다.
- core가 뜬다: `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`을 찍는다(route 중복 검사 포함).
- renderer build: `deno run -A packages/shell/renderer/build.ts`(protocol type이 바뀐다).
- 바꾼 곳의 test가 통과한다: `deno test --no-check packages/core/apps/releases packages/core/apps/usage packages/core/apps/blueprint packages/core/apps/preview packages/core/agent-roles`
- 위험 test: 없음(할 일 17)
- 남지 않음
  - `git grep -n "ticket_source\|release_tests\|prepare_bundle\|FINALIZER_OPERATIONS\|withTestDefaults" -- packages tools ':!packages/core/apps/tickets' ':!packages/core/problems'`가 0줄이다(ticket 모듈과 test runner 안의 것은 ab-ticket-delete, ab-runner-delete가 폴더째 지운다).
  - `git grep -n "testDefaults\|findPassedAppTest\|deriveAppTest\|checkPreparationClaim\|checkTests\|findReleaseForTicket\|TicketClaimCheck\|AppTestVerificationLookupPort\|getVerification\|blockedToolsOf\|releaseComparisonSchema" -- packages/core/apps packages/core/main packages/protocol/apps`가 0줄이다.
  - `git grep -n "protocol/problems/mod.ts\|core/problems/\|\.\./problems/" -- packages/core/apps packages/core/main/daemon/wiring/apps.ts ':!packages/core/apps/preview/adapters/mod.ts'`가 0줄이다(빼 둔 file은 주석이고 ab-runner-delete가 고친다).
  - `git grep -n "prepare/checks" -- packages ':!packages/core/apps/releases/prepare' ':!packages/core/main/worker/release-job.ts'`가 0줄이다(core graph에 들지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`packages/protocol/apps/mod.ts`는 `export *`, `registry.ts`는 `RELEASE_ROUTES`·`ACTIVATION_ROUTES`를 펼친다. tool은 `RELEASE_TOOLS` 배열에 더한다). 다르면 적는다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). 예: supervisor 쪽 준비 취소(`SUPERVISOR_OPS.releaseCancel`, `PreparationService.cancel`)를 core는 기한 넘김에만 쓴다. supervisor의 준비 메모리(`createPreparationService`의 `entries`)는 요청마다 쌓인다
- 1의 확인 결과
- 정한 것: 문서에 답이 없어 worker가 정한 것(reason 글, 기다리는 간격과 기한 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 문서는 계획 끝에 lead가 고친다: `architecture/activation.md`(공개 tool 막기, 준비는 coding agent의 일), `architecture/coding-agent.md` 62줄, `architecture/domain.md` 34·66줄(record command의 이름), `architecture/testing.md`
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 할 일 16의 확인 결과
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 예: build 실패 이유는 `blueprint_eval_failed` 같은 짧은 code라 컴파일러 출력이 없다. handler 검사 실패 이유는 launcher의 요약("handler or schema mismatch")이라 어느 tool이 어긋났는지 없다. 떨어진 준비의 봉인 전 사본이 `apps/<app>/bundles/`에 남는다(같은 bundle을 다시 준비하면 지우고 다시 쓴다).
