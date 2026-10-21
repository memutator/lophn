# tr-e2e-app-release

`app-release_test.ts`를 다시 쓴다. README "정한 것" 표의 `app-release` 줄이 재는 것이다: template 앱으로 `release.prepare` → App Engineer의 `preview.start`·`preview.call`·`preview.stop`(live ledger와 data는 그대로) → `release.activate` → 동의 allow·reject. bundle file 수, source map, 읽기 전용 sdk를 본다. 준비가 떨어지면 `{status:"failed", stage, reason}`이고 release 행이 없다. coding MCP와 ticket examples 단계는 지운다.

- 단위: e2e (wave 2)
- 선행: tr-support-app.
- 소유(이 task만 고친다):
  - `tests/e2e/app-release_test.ts`
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md`의 "정한 것" 표 `app-release` 줄, "지켜볼 것"(`release.prepare`가 build·migration 검사·preview 시작을 tool 호출 하나 안에서 한다, `e2e:deps` cache). `project-docs/plan/test-restore/survey-e2e.md` 1절 6번 줄(app-release, rewrite)과 4절(새 support/app 층)
  - helper 계약: `project-docs/plan/test-restore/tasks/tr-support-app.md`의 "내놓는 것"(`startTestApp`, `aeLane`, `tool`, `prepareRelease`, `activateRelease`, `approveActivation`, `waitRunning`, `TestApp`. 옛 `gateway` 칸, `handOff`, `verifyTicket`은 없다). 같은 곳의 "(더함)" `aeTurn(core, fake, app, text, steps)`·`aeToolResult(turn, id)`(App Engineer turn 하나를 대본으로 돌리고 tool 결과 JSON `{status, code, summary, content}`를 읽는다. 기다림 상한 480초)를 preview 단계가 쓴다
  - architecture: `project-docs/architecture/activation.md` "지키는 것"(38줄 동의를 기다리면 `waiting_consent`를 바로 돌려준다, 47줄 거절은 줄을 지우고 release는 `prepared`로 남는다, 49줄 거절된 `prepared` release는 App Engineer가 다시 부른다), `project-docs/architecture/app-call.md` 73-75줄(preview는 일회용 DB, invocation을 남기지 않는다, 그 앱의 App Engineer만 preview target을 부른다), `project-docs/architecture/testing.md` "앱 길"(56줄)과 "case 고르는 규칙"(91줄. 단계 6, fake 대답 3, 단정 3, helper가 거는 대답은 세지 않는다)
  - changelog: `project-docs/products/change-log/0.6.0.md`의 "App Engineer가 앱을 직접 짓고, ticket과 test runner를 지운다"(떨어지면 `{status: "failed", stage, reason}`이고 release 행이 생기지 않는다)와 "Reactor와 domain event를 지우고, release 준비가 떨어진 이유가 고칠 곳을 가리킨다"(handlers reason이 handler 없는 tool 이름을 싣는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `app-runtime`, `app-data`, `agent-tools`; `project-docs/module-catalog.yaml`의 `tests`
  - 코드
    - `packages/core/apps/control.ts` 484-677줄(`prepareFailed`, `releasePrepareHandler`: HEAD → 준비 자식 → 봉인 → 595줄 `previewService.check`(handler 검사) → 628줄 `releaseRecord`. release 행은 마지막에만 생긴다)
    - `packages/core/apps/agent-tools/preview.ts` 46-180줄(`preview.start {release, fixture?}`는 ready까지 60초 기다린다, `preview.call {app, tool, input?}`, `preview.stop {app}`. 모두 effect `write`라 한 응답의 여러 call은 요청 순서로 하나씩 돈다: `packages/core/lophn-agent/run-loop/tool-batch.ts` 283-310줄)
    - `packages/core/apps/agent-tools/release.ts` 68-125줄(`release.prepare`, `release.activate`의 tool 결과)
    - `packages/core/apps/preview/service.ts` 213-263줄(`launch`), 346-388줄(`check`), `packages/core/apps/preview/launcher.ts` 298-330줄, `packages/core/main/app-supervisor/assembly.ts` 545-591줄(`probeChild`), `packages/core/apps/runtime/entrypoint/control.ts` 35-58줄(probe가 선언과 등록 handler가 다르면 409)
    - route: `packages/protocol/apps/releases.ts`(`ReleasePrepareOutput`, `ReleaseActivateOutput`, `RELEASE_FILE_MAX_COUNT`), `packages/protocol/apps/activation/activation.ts`(`releasesGetRecord`, `releasesListRecords`), `packages/protocol/apps/activation/consent.ts`(`activationConsents`), `packages/protocol/apps/calls/invocation.ts`(`appInvocations`. live ledger는 여기다. 계약 줄의 `invocations.ts`는 summary schema뿐이다), `packages/protocol/apps/previews.ts`(`previewsGet`), `packages/protocol/apps/runtime.ts`(`appRuntime`), `packages/protocol/apps/mod.ts`(`appGet`, `appCallTool`), `packages/protocol/apps/app-storage.ts` 37줄(`appBundleCopy`)
    - 옛 file: `tests/e2e/app-release_test.ts`(58-65줄 `countFiles`와 122-148줄 disk·ledger·process 단정은 살린다)
    - 견본: `tests/support/app/sample/src/tools.ts.tmpl`(`tool("add_item", addItemHandler(deps));` 줄. tr-support-app이 이 견본을 source 폴더에 얹는다), `tests/support/fake-server/types.ts`(`Step`, `Reply`의 `kind: "tool"`은 `calls` 여럿을 싣는다)
- 계약:
  - 쓰는 것: tr-support-app의 `tests/support/app/activate.ts`(`startTestApp`, `aeLane`, `tool`, `prepareRelease`, `activateRelease`, `approveActivation`, `waitRunning`, `aeTurn`, `aeToolResult`), `deps.ts`(`appCoreEnv`); `packages/core/apps/agent-tools/preview.ts`(wire `preview_start`, `preview_call`, `preview_stop`), `packages/protocol/apps/previews.ts`, `packages/protocol/apps/releases.ts`(`RELEASE_FILE_MAX_COUNT`, `ReleasePrepareOutput`), `packages/protocol/apps/calls/invocation.ts`(`appInvocations`, live ledger)
  - 내놓는 것: 없음

## 할 일

file 하나를 처음부터 다시 쓴다. core 하나를 띄우고(`bootCore(run, { env: await appCoreEnv() })`, `connectFakeProvider`) 앱 둘을 쓴다: 성공 길의 `notes`, 준비가 떨어지는 `broken`. `Deno.test` 하나에 아래 단계를 `t.step`으로 차례로 둔다(앞 단계의 앱과 release를 다음 단계가 쓴다). 근거: README 표 `app-release` 줄, `activation.md`, `app-call.md` 73-75줄.

1. 지운다(옛 file 기준)
   - 1-20줄 머리 주석(ticket·coding MCP·"README 정한 것 11")과 22-56줄 import 가운데 `approvalsPending`, `ticket/mod.ts`, `handOff`, `verifyTicket`, `deliverRelease`, `codingCli`, `support/coding/*`, `exitTerminal`, `support/gateway/shell.ts`
   - 67-73줄 `activationRequests`(approvals 대기 목록), 75-79줄 `McpResult`
   - 150-233줄 `coding-mcp-preview-only` 단계(coding session을 띄우는 길이 없다. MCP는 `packages/core/apps/mcp`의 unit이 본다)
   - 278-358줄 examples·ticket test 전체(ticket과 test runner가 없다)
2. 머리 주석을 새로 쓴다(`testing.md` 규칙 1: 세 질문 한 줄씩).
   - contract: boundary `app-releases`·`app-runtime`·`app-data`(App Engineer의 `release.prepare`는 handler 검사까지 지난 것만 release 행으로 남기고, preview는 일회용 DB로 돌아 live ledger와 data에 닿지 않고, 첫 activation은 사람의 동의 뒤에만 앱 process를 띄운다)
   - 현실적 회귀: 새 data root에서 template 앱의 준비가 깨진다(sdk 사본이 없다, file 수 상한, 화면 map에 `mappings`가 없다), release 행이 handler 검사 전에 생긴다, preview 호출이 live process·ledger·DB로 간다, 거절한 동의 뒤에도 앱이 뜬다
   - 왜 지금 test로 못 잡나: `release.prepare`를 보는 unit이 없고(`grep -rln "releasePrepare" packages --include=*_test.ts`가 0줄), 준비 자식 → 봉인 → preview launcher → 앱 process → 기록은 process를 건너야 보인다
   - fake 대답 줄: helper(`prepareRelease`, `activateRelease`)가 거는 App Engineer 대답은 행 몫에 세지 않는다. preview 단계만 대답 둘(tool 넷을 실은 대답 하나와 text)을 건다.
3. 준비: `startTestApp(core, fake, { name: "Notes", slug: "notes" })`.
4. 단계 `prepare-preview`: 준비하고 preview로 확인해도 live ledger와 data는 그대로다.
   1. `const prepared = await prepareRelease(core, fake, notes, { goal: "Make the first release of the notes app" })`. `prepared.status === "prepared"`가 아니면 stage와 reason을 담아 실패한다. `release = prepared.release.id`.
   2. `const previewed = await aeTurn(core, fake, notes, "preview release " + release, (n) => [...])`. 대본은 대답 둘이다(`aeTurn`이 `aeLane(notes)`에 걸고 `App <id>: …`로 말하고 480초까지 turn 끝을 기다린다. `preview.start`가 ready까지 60초를 쓸 수 있어 `waitTurnEnd`의 30초로는 짧다).
      - 대답 1: `{ kind: "tool", calls: [...] }`에 call 넷을 순서대로 싣는다(`tool(...).calls[0]`을 모아도 된다). id는 helper(`tc_prepare_<n>`, `tc_activate_<n>`)와 겹치지 않게 `pv_<이름>_${n}`으로 쓴다.
        - `pv_start` `preview_start {release}`(fixture 없음. 빈 DB에 migration을 돌린 일회용 영역에서 뜬다)
        - `pv_add` `preview_call {app: notes.app, tool: "add_item", input: {title: "from preview"}}`
        - `pv_list` `preview_call {app: notes.app, tool: "list_items"}`
        - `pv_stop` `preview_stop {app: notes.app}`
      - 대답 2: `{ kind: "text", text: "previewed" }`
   3. 단정(곳마다 묶는다)
      - fake: `aeToolResult(previewed, <id>)`로 읽는다. 넷 모두 `status`가 `success`, `pv_start`의 `content.ready`가 true, `pv_add`의 `content.outcome.status`가 `succeeded`, `pv_list`의 `content.outcome.result.rows`에 title `from preview`가 있다. id는 대본을 만든 `n`을 바깥 변수로 받아 같은 글로 만든다.
      - ledger: `appInvocations {app: notes.app}`가 빈 목록(preview 호출은 invocation을 남기지 않는다), `previewsGet {app}`의 `observation`이 null(멈췄다)
      - process: `appRuntime {app}`의 `observation`이 null(preview가 live process를 띄우지 않았다)
5. 단계 `first-activation-rejected`: 첫 activation은 묻고, 거절하면 뜨지 않는다.
   1. `activateRelease(core, fake, notes, release)`의 `status`가 `waiting_consent`다.
   2. `approveActivation(core, notes, "reject")`. 돌려준 줄의 `release`가 `release`다.
   3. 단정
      - route: `activationConsents {app}`의 `consents`가 비었다
      - ledger: `releasesGetRecord {release}`의 status가 `prepared`, `appGet {app}`의 `active_release`가 null
      - process: `appRuntime {app}`의 `observation`이 null
6. 단계 `activation-allowed`: App Engineer가 다시 올리고 사람이 허락하면 그 release가 뜬다.
   1. `activateRelease(core, fake, notes, release)`가 다시 `waiting_consent`다. 정한 것: 거절 행과 허락 행에 앱 하나를 쓴다. 이유: 거절된 `prepared` release는 App Engineer가 다시 부르는 것이 제품 길이고(`activation.md` 49줄), 앱 하나에 준비 한 번(build + handler 검사)을 아낀다.
   2. `approveActivation(core, notes, "allow")` → `const observed = await waitRunning(core, notes, release)`.
   3. 단정(옛 file 122-148줄을 옮긴다)
      - disk: `record = (await core.call(releasesGetRecord, { release })).release`로 읽은 `appBundleCopy(core.run.home, notes.app, record.bundle_hash)`의 file 수가 `RELEASE_FILE_MAX_COUNT`보다 적다(`countFiles`), `<bundle>/screens/items/main.js.map`이 file이다, `${core.run.home}/sdk/ui/1.0.0`의 mode에 쓰기 bit(`0o222`)가 없다(`@lophn/ui` 설치 사본. path가 다르면 `packages/core/apps/packages/install.ts`의 `installCopy`를 보고 고친다)
      - ledger: record status `active`, `appGet`의 `active_release`가 `release`
      - process·data: `observed.ready`가 true, 사람 caller(`{kind: "person", view_session: "e2e"}`)의 live `list_items`가 `succeeded`이고 rows에 `from preview`가 없다(preview의 쓰기가 live DB에 없다)
7. 단계 `prepare-failed`: 준비가 떨어지면 결과에 stage와 reason이 있고 release 행이 없다.
   1. file 안에 patch 하나를 둔다: `src/tools.ts`에서 `  tool("add_item", addItemHandler(deps));` 줄을 지운다(자리가 없으면 던진다. `tests/support/app/patch-domain.ts`의 `replaceOnce` 꼴). blueprint는 `add_item`을 선언한 채라 handler 검사(stage `handlers`)에서 떨어진다. 정한 것: 마지막 검사 단계를 고른다. 이유: release 행은 `releaseRecord` 한 곳에서만 생기고(`control.ts` 628줄) 그 앞 단계 가운데 가장 늦은 것이 handler 검사다. 봉인한 bundle 사본이 있는 채로 떨어져도 행이 없어야 한다.
   2. `const broken = await startTestApp(core, fake, { name: "Broken", slug: "broken", patch })` → `const failed = await prepareRelease(core, fake, broken, { goal: "Make the first release of the broken app" })`
   3. 단정
      - fake·route: `failed.status === "failed"`, `failed.stage === "handlers"`, `failed.reason`이 빈 글이 아니다. reason의 글은 단정하지 않는다(아래 보고).
      - ledger: `releasesListRecords {app: broken.app}`의 `releases`가 비었다, `appGet`의 `active_release`가 null
8. finally: `core?.kill()`, `fake.close()`, `run.remove()`. Gateway는 열지 않는다(`TestApp`에 `gateway`가 없다).
9. type check와 실행
   - `deno check tests/e2e/app-release_test.ts`. `tests/e2e`는 tr-check-enable 전까지 `tools/check.ts`의 `NOT_CHECKED`라 `deno task check`가 이 file의 type을 보지 않는다.
   - `deno task e2e:deps`를 한 번 돌리고 `deno test --allow-all --no-check tests/e2e/app-release_test.ts`.

## 끝남

- `deno task check`가 통과한다.
- `deno check tests/e2e/app-release_test.ts`, `deno fmt --check tests/e2e/app-release_test.ts`, `deno lint tests/e2e/app-release_test.ts`가 오류 없이 끝난다.
- `deno task e2e:deps` 뒤 `deno test --allow-all --no-check tests/e2e/app-release_test.ts`가 세 번 잇달아 통과한다(lead가 merge 전에 열 번 더 돌린다). 끝난 뒤 `/tmp/lophn-e2e-*`와 core process가 남지 않는다.
- 위험 test: 새 unit test는 없다. 이 file이 그 test다. 이름 예: "E2E App Engineer가 준비하고 preview로 확인한 template 앱은 사람이 동의한 뒤에만 뜨고, preview는 live ledger와 data에 닿지 않으며, 떨어진 준비는 release를 남기지 않는다"
- 남지 않음: `grep -n "ticket\|coding\|mcpRequest\|exitTerminal\|approvalsPending\|handOff\|verifyTicket\|gateway" tests/e2e/app-release_test.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check(e2e 세 번의 걸린 시간 포함. `release.prepare` 한 번이 걸린 시간을 따로 적는다. README "지켜볼 것")
- 등록할 것: 없음
- 안 쓰게 된 export: 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것" 둘을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: helper(`prepareRelease`, `activateRelease`, `approveActivation`)의 모양이 이 흐름에 안 맞으면 고치지 말고 여기 적는다
- handler 검사 reason: `prepare-failed`에서 받은 `failed.reason` 글 그대로. changelog 0.6.0은 handlers reason이 handler 없는 tool 이름을 싣는다고 하지만, 앱 entrypoint의 probe가 선언과 다르면 409로 먼저 거절해(`entrypoint/control.ts` 52-57줄) supervisor가 `probe was rejected (409)`만 실을 수 있다(`app-supervisor/assembly.ts` 583줄). 그렇다면 lead가 이슈로 올리게 적는다. test를 그 글에 맞추지 않는다.
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## lead가 더함

- handler 검사 reason은 지금 `probe was rejected (409)`다. tr-support-app이 handler 없는 tool을 선언한 앱으로 확인했고 lead가 `project-docs/issues/activation.md` "release 준비의 handler 검사가 떨어지면 이유가 "probe was rejected (409)"뿐이다"로 올렸다. `prepare-failed`의 handler 행은 `status: "failed"`, `stage: "handlers"`, release 행 없음만 단정하고 reason 글은 단정하지 않는다. 받은 글은 보고에 적는다.
