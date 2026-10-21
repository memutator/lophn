# tr-support-app

앱을 운영으로 올리는 test helper(`tests/support/app/activate.ts`, `source.ts`)를 App Engineer의 `release.prepare`·`release.activate`(가짜 model lane)와 사람의 `activation.consent` 길로 다시 쓴다. coding 길 support를 지우고 `deps.ts`·`prepare-deps.ts`를 `tests/support/app/`으로 옮기며, `app-sandbox_test.ts`를 새 helper로 고쳐 helper가 실제로 앱을 running까지 올리는 것을 보인다.

- 단위: support (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/support/app/activate.ts`
  - `tests/support/app/source.ts`
  - `tests/support/app/sample`
  - `tests/support/app/deps.ts` (새 file. coding 폴더의 같은 이름 file을 옮긴다)
  - `tests/support/app/prepare-deps.ts` (새 file. coding 폴더의 같은 이름 file을 옮긴다)
  - `tests/support/app/patch-crash.ts` (새 file. patch-reaction에서 이름만 바꾼다)
  - `tests/support/app/patch-reaction.ts` (지운다)
  - `tests/support/app/patch-report.ts` (지운다)
  - `tests/support/app/patch-sandbox.ts`
  - `tests/support/coding` (폴더째 지운다)
  - `tests/support/gateway/shell.ts` (지운다)
  - `tests/e2e/coding_test.ts` (지운다)
  - `tests/e2e/app-sandbox_test.ts`
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md`의 "정한 것"(앱을 운영으로 올리는 helper는 하나, 옮기고 지우는 support), "지켜볼 것"(`app.create` 뒤 runtime 재시작, `release.prepare` 시간, offline cache). `project-docs/plan/test-restore/survey-e2e.md`의 §2 표(`app/activate.ts`, `app/source.ts`, `coding/*`, `gateway/shell.ts`, `patch-*` 줄)와 §4("What the new support/app layer needs")
  - architecture: `project-docs/architecture/testing.md`("가짜 셋"의 fake server와 lane, "`tests/support`", "앱 길", "case 고르는 규칙" 4: helper가 거는 fake 대답은 행 몫에 세지 않는다), `project-docs/architecture/activation.md`("계기와 묻는 조건": `release.activate`는 120초까지 기다리고 동의가 필요하면 `waiting_consent`를 바로 돌려준다), `project-docs/architecture/approval.md` 25행(할당)
  - 변경 기록: `project-docs/products/change-log/0.6.0.md`의 "App Engineer가 앱을 직접 짓고, ticket과 test runner를 지운다"(`release.prepare` 한 단계, source 폴더를 `app.create`가 깐다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `app-runtime`, `app-capability`; `project-docs/module-catalog.yaml`의 `tests`
  - 코드(HEAD `85f19080e`)
    - 지금 helper: `tests/support/app/activate.ts`(`startTestApp` 106-154, `aeLane` 156-163, `tool` 170-173, `deliverRelease` 327-461, `approveActivation` 493-514, `waitRunning` 516-534, `activateTestApp` 536-548. `explaining`·`appStateOf` 59-85는 새 helper에서도 쓴다), `tests/support/app/source.ts`(`sampleFiles` 44-60, `createAppSource` 65-93, `amendAppSource` 96-104)
    - source 폴더를 까는 곳: `packages/core/apps/registration/source-folder.ts`(`scaffold` 55-111: 임시 폴더에 template을 깔고 저장소 안 git 설정과 첫 commit을 남긴 뒤 `<home>/apps/<app>/source`로 옮긴다. `withSourceFolder` 150-191: 실패하면 앱은 `source_path: null`로 남고 오류가 아니다), `packages/core/apps/packages/template/scaffold.ts`(`scaffoldApp`: 이미 있는 file은 덮지 않고 빠진 file만 쓰며 `{{APP}}`·`{{TITLE}}`를 채운다)
    - 앱 domain: `packages/core/apps/registration/commands.ts` 143(앱 slug 이름의 domain이 같은 tx에서 생긴다), `packages/core/apps/releases/commands.ts` 499-503(`release.record`가 blueprint tool의 `domain`을 그 앱의 domain 목록과 대조한다)
    - `release.prepare`·`release.activate`: `packages/core/apps/agent-tools/release.ts`(tool 결과는 `fitted(summary, out)`이라 `content`가 route 출력 그대로다), `packages/core/apps/control.ts`(`releasePrepareHandler` 491: 준비를 `RELEASE_PREPARATION_LIMIT_MS + 60_000` = 360초까지 기다린다(558). handler 검사 preview는 595에서 띄웠다가 닫는다), `packages/core/apps/releases/activation/assembly.ts`(`ACTIVATE_WAIT_MS` 163, `activate` 688)
    - tool 결과가 fake에 닿는 꼴: `packages/core/lophn-agent/run-loop/history.ts` 20(tool_result 글은 `JSON.stringify({status, code, summary, content, …})`), `packages/core/lophn-agent/run-loop/ports.ts`의 `ToolDone.status`(`success | failure | uncertain | not_executed`)
    - tool 시간 한도가 없다는 근거: `packages/core/lophn-agent/run-loop/turn.ts` 337(한도 timer는 model 호출만 끊는다)·538·560(`limiter.toolResult()`가 tool 뒤 stall을 0으로), `packages/core/lophn-agent/run-loop/limits.ts` 162, `packages/core/main/agent-runtime/core-http.ts` 17-57(core loopback 호출에 timeout이 없다), `packages/protocol/lophn-agent/turn-values.ts`의 `DEFAULT_TURN_LIMITS`(stall 300초, active 1,800초)
    - runtime 재시작: `packages/core/lophn-agent/run-loop/runtime.ts` 70(1초 poll)·419(도는 turn이 있으면 다음 주기로 미룬다)
    - 동의: `packages/protocol/apps/activation/consent.ts`, `packages/core/apps/releases/activation/consents.ts`(`waitingConsents`는 `requested_at` 순)
    - fake: `tests/support/fake-server/types.ts`(`Step`, `ReplyFn`, `Lane`, `JournalEntry`), `tests/support/fake-server/probe.ts`(`toolNames` 22, `lastToolResult` 38)
    - human helper: `tests/support/core/human.ts`(`WAIT_MS` 23 = 30초, `until` 28, `settle` 51, `turnsOf` 159, `waitTurnEnd` 169는 30초 고정), `tests/support/core/process.ts`(`runtimePids` 221), `tests/support/core/mod.ts`(`Core.logPath`, `Core.ids`)
- 계약:
  - 쓰는 것:
    - `packages/protocol/apps/apps.ts`의 `appCreate`(입력 `id?`, `slug`, `name`, `description`. core가 template을 `packages/protocol/apps/app-storage.ts`의 `appDefaultSource(<home>, <app>)` = `<home>/apps/<app>/source`에 깔고 commit하고 machine 자격으로 잇는다), `appRuntime`
    - `packages/protocol/apps/releases.ts`의 `releasePrepare`·`releaseActivate`와 출력 type `ReleasePrepareOutput`(`prepared {release, removed_public_tools}` | `failed {stage, reason}`)·`ReleaseActivateOutput`(`active` | `failed {failure}` | `waiting_consent` | `running`). 둘 다 `actors: ["agent"]`라 test는 부르지 못하고 가짜 model lane이 App Engineer로 부른다(wire 이름 `release_prepare`, `release_activate`)
    - `packages/protocol/apps/activation/consent.ts`의 `activationConsents`(`{app?}` → `consents: ActivationConsent[]`)와 `activationConsent`(`{release, choice: "allow" | "reject"}`, compare `{requested_at}`)
    - `tests/support/core/human.ts`(`openSession`, `say`, `settle`, `until`, `turnsOf`, `waitTurnEnd`, `openProject`), `tests/support/core/process.ts`(`runtimePids`), `tests/support/fake-server/probe.ts`(`toolNames`, `lastToolResult`, `idIn`)
  - 내놓는 것(e2e와 eval restore가 이 이름과 모양에 기댄다. 이 task만 바꾼다):
    - `tests/support/app/source.ts`
      - `type AppPatch = (dir: string) => Promise<void>`(그대로)
      - `createAppSource(core, { app, slug, title?, patch?, sample? }): Promise<{ dir: string; commit: string }>`: `dir`은 `app.create`가 깐 `<home>/apps/<app>/source`다. `sample`(기본 `true`)이면 test 몫 견본(`sample/`)을 얹고 template의 자리 표시 `home` 화면을 지운다. 그 뒤 `patch`, commit. commit은 40 hex다.
        - `sample: false`면 core가 깐 template 그대로에 `patch`만 얹는다(template의 `home` 화면도 남는다. 지우려면 patch가 지운다).
      - `amendAppSource(dir, patch): Promise<string>`(그대로. 새 commit)
      - (더함) `sampleDomain(dir: string): Promise<string>`: `<dir>/blueprint.ts`에서 처음 나오는 `domain: "<이름>"`의 이름을 돌려준다. 견본 위의 앱이면 앱 slug(= 앱 domain)다. 없으면 던진다. patch가 새 tool의 `domain`을 이것으로 채운다(아래 "정한 것" 3).
    - `tests/support/app/activate.ts`
      - `type TestApp = { app: string; slug: string; name: string; source: string; commit: string; ae: string }`. `ae`는 App Engineer session이다. 옛 `gateway` 칸은 없다(event가 필요한 test는 `connectGateway`를 스스로 연다).
      - `appProjectName(slug)`, `openAppProject(core, slug)`, `tool(id, name, args)`: 그대로
      - `aeLane(app: TestApp)`: fake lane. 요청의 tool 목록에 `release_prepare`가 있고 본문에 `App <app.app>:`가 있는 요청이 받는다. 이 lane에 대본을 직접 거는 test(preview 등)는 `` say(core, app.ae, `App ${app.app}: …`) ``로 말한다.
      - `startTestApp(core, fake, { name, slug, patch?, id?, description?, sample? }): Promise<TestApp>`: `app.create` → `createAppSource` → `settle`(source 폴더가 App Engineer의 place 폴더라 agent runtime child가 다시 뜬다) → App Engineer session을 연다.
      - `prepareRelease(core, fake, app, { goal? }): Promise<ReleasePrepareOutput>`: App Engineer turn 하나가 `release_prepare {app}`만 부른다. `failed`도 값으로 돌려준다.
      - `activateRelease(core, fake, app, release): Promise<ReleaseActivateOutput>`: App Engineer turn 하나가 `release_activate {release}`만 부른다. 결과를 그대로 돌려준다.
      - `deliverRelease(core, fake, app, { goal }): Promise<{ release: string; activated: ReleaseActivateOutput }>`: turn 하나에서 prepare → activate. prepare가 `prepared`가 아니면 stage와 reason을 담아 던진다.
      - `approveActivation(core, app, choice: "allow" | "reject" = "allow"): Promise<ActivationConsent>`: `activations.consents {app}`에 줄이 올 때까지 기다려 `activation.consent {release, choice}`(compare `{requested_at}`)로 답하고, 답한 줄을 돌려준다.
        - 줄이 여럿이면 `requested_at`이 가장 늦은 줄(목록의 마지막)에 답한다. 특정 줄에 답할 test는 `activationConsent`를 직접 부른다.
      - `waitRunning(core, app, release?): Promise<RuntimeObservation>`: 그대로
      - `activateTestApp(core, fake, { name, slug, patch? }): Promise<TestApp>`: start → deliver → `approveActivation("allow")` → `waitRunning`
      - 지운다: `handOff`, `verifyTicket`, `TestApp.gateway`
      - 같은 session에서 맡기기마다 fake tool call id가 다르다.
      - (더함) App Engineer turn 하나를 대본으로 돌리는 바탕. 위 셋(`prepareRelease`, `activateRelease`, `deliverRelease`)이 쓰고, preview처럼 lane에 대본을 직접 거는 test도 쓴다.

        ```ts
        // 이 turn에 aeLane이 받은 요청들(say 직전 journal 길이 뒤의 것)이다.
        export type AeTurn = { turn: Turn; requests: JournalEntry[] };
        // steps를 aeLane(app)에 걸고 `App <app.app>: <text>`를 말한 뒤 그 turn이 끝날 때까지 기다린다.
        // 제한은 AE_TURN_WAIT_MS(480초)다. 넘으면 release·runtime 상태와 lane의 mismatch를 담아 던진다.
        export function aeTurn(
          core: Core, fake: FakeServer, app: TestApp, text: string,
          steps: (index: number) => Step[], // index는 이 turn의 순번(0부터). tool call id에 붙인다
        ): Promise<AeTurn>;
        // 그 turn에서 tool call id의 결과(tool_result 글의 JSON)다. 없으면 던진다.
        export type AeToolResult = {
          status: "success" | "failure" | "uncertain" | "not_executed";
          code: string; summary: string; content: unknown;
        };
        export function aeToolResult(turn: AeTurn, id: string): AeToolResult;
        ```
    - `tests/support/app/deps.ts`: `appCoreEnv(): Promise<Record<string, string>>`, `e2eDenoDir(): string`(이름 그대로, path만 옮긴다)
    - `tests/support/app/patch-crash.ts`: `crashPatch(dir)`(이름 그대로)
    - 등록할 것(lead): `deno.json`의 `e2e:deps`를 `deno run --allow-all tests/support/app/prepare-deps.ts`로 고친다.

## 할 일

근거는 README "정한 것"의 "앱을 운영으로 올리는 test helper는 하나다"와 `architecture/testing.md` "앱 길"이다. `release.prepare`·`release.activate`는 agent만 부르는 route라 test가 직접 부르지 않고 가짜 model이 App Engineer로 부른다(제품과 같은 길). 제품 route에 test 전용 actor를 더하지 않는다.

1. 옮기고 지운다(`git mv`, `git rm`).
   1. `tests/support/coding/deps.ts` → `tests/support/app/deps.ts`, `tests/support/coding/prepare-deps.ts` → `tests/support/app/prepare-deps.ts`. 두 file의 상대 import(`../../../packages/…`, `./deps.ts`)는 깊이가 같아 그대로다. `deps.ts` 23-29의 주석과 오류 글 "app test가 systemd-run --user로 자식을 띄운다"는 낡았다(packages에 `systemd-run`이 없다). "앱 socket 폴더가 `XDG_RUNTIME_DIR` 아래 data root마다 있다"로 고친다(`packages/core/apps/control.ts` 878, `architecture/testing.md` "앱 길" 끝 줄).
   2. `tests/support/app/patch-reaction.ts` → `tests/support/app/patch-crash.ts`(`git mv`). 머리 주석 "reaction-app flow 전용"을 "앱 process를 죽이는 patch. crash loop e2e(`app-restart_test.ts`)가 쓴다"로, `crashPatch` 주석의 "platform app test"를 "release 준비의 handler 검사(blueprint 선언과 등록 handler가 같다)"로 고친다. 19행의 slug 읽기는 2.3의 `sampleDomain`으로 바꾼다.
   3. 지운다: `tests/support/app/patch-report.ts`(`reportProblem(...).completion`이 없다), `tests/support/coding/`의 나머지(`cli.ts`, `cli_test.ts`(지금 실패한다), `hand-off.ts`, `mcp.ts`), `tests/support/gateway/shell.ts`, `tests/e2e/coding_test.ts`. 근거: README "정한 것"(coding session을 띄우는 길이 없다), AGENTS.md "호환성".
   - 이 뒤 `tests/e2e`의 다른 앱 e2e와 `tests/eval/restore`는 지운 path를 import한 채 깨진다. 둘 다 `NOT_CHECKED`이고 wave 2 task가 고친다. 고치지 않는다.
2. `tests/support/app/source.ts`
   1. `createAppSource(core, { app, slug, title?, patch?, sample? })`
      - `dir = appDefaultSource(core.run.home, app)`(`packages/protocol/apps/mod.ts`). 폴더에 commit이 없으면(`git rev-parse --verify HEAD` 실패) 던진다.
      - `sample !== false`면: 견본 file 목록(`sampleFiles()`, 그대로)의 path마다 `dir`에 있는 file을 지우고(template의 `blueprint.ts`, `src/tools.ts`, `src/wording/en.ts`, `src/wording/placeholders.ts`가 겹친다) `src/screens/home/` 폴더를 지운 뒤 `scaffoldApp({ files: sample, dir, app: slug, title })`로 쓴다.
        - 정한 것: 겹치는 file을 먼저 지우고 `scaffoldApp`에 맡긴다. 이유: `scaffoldApp`은 있는 file을 덮지 않고, 견본 `blueprint.ts`·화면에 `{{APP}}`·`{{TITLE}}`가 있어 같은 치환이 필요하다. 지금 `createAppSource` 74-86이 template 목록에서 겹치는 것과 `home`을 빼던 것과 결과가 같다.
      - `await patch?.(dir)` 뒤 `git add -A`, `git commit -q --allow-empty -m app`, `git rev-parse HEAD`. git은 지금 helper(`git`, `GIT_ENV` 11-38)를 그대로 쓴다. `git init`은 하지 않는다(core가 이미 저장소를 만들었다).
        - 정한 것: `--allow-empty`. 이유: `sample: false`이고 patch가 없으면 바뀐 것이 없어 commit이 실패한다. 그래도 helper는 그 HEAD의 commit을 돌려주면 된다.
      - `title`이 없으면 `scaffoldApp`이 slug에서 만든다. `startTestApp`은 `name`을 넘긴다.
      - 머리 주석(1-2, 40-41, 64)을 새 길로 고친다: core가 `app.create`에서 깐 source 폴더 위에 견본과 patch를 얹고 commit한다.
   2. `amendAppSource`는 그대로 둔다.
   3. `sampleDomain(dir)`을 더한다: `blueprint.ts`를 읽어 `/domain:\s*"([a-z0-9-]+)"/`의 첫 값을 돌려준다. 없으면 `${dir}/blueprint.ts에 domain이 없다`로 던진다.
      - 정한 것: patch는 앱 slug를 `dir.split("/").at(-1)`로 읽던 것을 `await sampleDomain(dir)`로 바꾼다. 이유: source 폴더가 `<home>/apps/<app id>/source`라 마지막 조각이 `source`다. 그대로 두면 tool의 domain이 `source`가 되어 `release.record`가 "is not a domain of this app"으로 거절하고(`packages/core/apps/releases/commands.ts` 499-503) 준비가 `failed {stage: "release"}`로 떨어진다. 견본 blueprint의 `list_items`가 맨 앞 tool이고 그 `domain`이 `{{APP}}`로 채운 slug다. patch는 모두 `add_item` 앞에 끼우므로 첫 값이 바뀌지 않는다. `AppPatch`와 `amendAppSource`의 꼴은 그대로다.
      - 이 task가 고치는 patch는 `patch-crash.ts`, `patch-sandbox.ts` 둘이다. 나머지(`patch-call`, `patch-net`, `patch-rewind`, `patch-restart`, `patch-migration`)는 그 file을 맡은 wave 2 task가 같은 한 줄을 바꾼다(`patch-domain`은 domain을 인자로 받아 상관없다).
3. `tests/support/app/activate.ts`를 다시 쓴다. 머리 주석은 새 길 한 단락이다: `app.create`(core가 source를 깔고 잇는다) → 견본·patch commit → runtime이 다시 뜨기를 기다림 → App Engineer session → 가짜 model이 App Engineer로 `release_prepare` → `release_activate` → 사람이 `activation.consent` → running. data root에 release를 직접 깔지 않는다.
   - 지운다: `ticketShow`·`AcceptanceCheck`·`codingCli`·`agentGrantsSet`·`approvalsDecide`·`approvalsPending`·`reportHarness`·`waitCodingTerminal`·`answerTerminal`·`exitTerminal`·`connectGateway` import, `stateOf`, `TEXT_CHECK`, `ticketIn`, `scriptAe`, `aeHandOff`, `handOff`, `must`, `verifyTicket`, `TestApp.gateway`.
   - 남긴다: `explaining`, `appStateOf`(release 상태 목록과 runtime 상태), `appProjectName`, `openAppProject`, `tool`.
   1. 상수: `AE_TURN_WAIT_MS = 480_000`(준비 360초 + activation 기다림 120초), `RUNNING_WAIT_MS = 120_000`.
      - 정한 것: helper는 `waitTurnEnd`(30초 고정)를 쓰지 않고 `until(…, AE_TURN_WAIT_MS)`로 `turnsOf(core, app.ae)[index].state === "finished"`를 기다린다. 이유("지켜볼 것"의 tool 호출 한도): lophn-agent에는 tool 호출 하나의 시간 한도가 없다. 한도 timer는 model 호출만 끊고(`turn.ts` 337), tool 뒤 `limiter.toolResult()`가 stall을 0으로 돌리며(`turn.ts` 560), runtime의 core loopback 호출에 timeout이 없다(`core-http.ts`). 실제 상한은 core 쪽이다: `release.prepare`는 360초 뒤 `failed {stage: "build", reason: "the preparation did not finish in time"}`, `release.activate`는 120초 뒤 `running`. 그래서 `release.get` 폴링 같은 다른 길은 필요 없고, test 쪽 기다림만 이 상한보다 길면 된다. 맞으면 바로 돌아오므로 정상 run은 느려지지 않는다.
   2. `aeLane(app)`: `` name: `ae-${app.app}` ``, `match`는 `` toolNames(request).includes("release_prepare") && JSON.stringify(request.body).includes(`App ${app.app}:`) ``. 다른 role에는 `release_prepare`가 없다(`packages/core/agent-roles/tool-lists.ts` 54-67).
   3. `aeTurn(core, fake, app, text, steps)`
      - `index = (await turnsOf(core, app.ae)).length`, `fake.script(steps(index), aeLane(app))`, `from = fake.journal().length`, `` say(core, app.ae, `App ${app.app}: ${text}`) ``.
      - `explaining`로 감싸 `until("App Engineer turn <index>이 끝남", …, AE_TURN_WAIT_MS)`. 실패 설명: `appStateOf`, 그 turn의 state, lane 요청 수와 `mismatch`가 있는 요청의 글.
      - 돌려줄 `requests`는 `fake.journal().slice(from)` 가운데 `lane === aeLane(app).name`인 것이다.
   4. `aeToolResult(turn, id)`: `turn.requests`를 뒤에서부터 보며 `lastToolResult(entry, id)`가 있는 첫 요청의 글을 `JSON.parse`한다. 없으면 "tool call <id>의 결과가 없다 (turn outcome …)"로 던진다.
   5. `prepareRelease(core, fake, app, { goal })`: `` aeTurn(…, goal ?? "Prepare a release", (n) => [{ reply: tool(`tc_prepare_${n}`, "release_prepare", { app: app.app }) }, { reply: { kind: "text", text: "prepared" } }]) ``. 결과의 `status`가 `success`가 아니면 `release_prepare: <code> <summary>`로 던진다. 맞으면 `releasePrepare.output.parse(result.content)`를 돌려준다(`failed`도 값이다).
   6. `activateRelease(core, fake, app, release)`: 같은 꼴로 `tc_activate_<n>`의 `release_activate {release}` 하나와 text 하나. `success`가 아니면(예: `conflict` "an activation is already running") 던지고, 맞으면 `releaseActivate.output.parse(result.content)`.
   7. `deliverRelease(core, fake, app, { goal })`: turn 하나에 대본 셋.
      - step 1: `` tool(`tc_prepare_${n}`, "release_prepare", { app }) ``
      - step 2(`ReplyFn`): `` lastToolResult(request, `tc_prepare_${n}`) ``를 읽어 `prepared`면 `` tool(`tc_activate_${n}`, "release_activate", { release: out.release.id }) ``, 아니면 text `"preparation failed"`. ReplyFn 안에서 던지지 않는다(던지면 fake가 400으로 답해 turn이 실패한다).
      - step 3: text `"done"`.
      - turn 뒤 prepare 결과가 `prepared`가 아니면 `` `release 준비가 ${stage}에서 떨어졌다: ${reason}` ``로 던진다. 맞으면 `{ release: out.release.id, activated }`.
   8. `approveActivation(core, app, choice)`: `explaining`(`appStateOf`) 안에서 `until("activation 동의 대기가 옴", …)`이 `core.call(activationConsents, { app: app.app })`의 `consents.at(-1)`을 기다린다. `core.call(activationConsent, { release: line.release, choice }, { requested_at: line.requested_at })` 뒤 `line`을 돌려준다.
   9. `waitRunning`: 몸체는 그대로이고 `until`의 제한만 `RUNNING_WAIT_MS`다. 정한 것: 첫 activation은 앱 process를 처음 띄우고 drain 행은 5초 읽기를 기다리므로 30초에 붙지 않게 한다.
   10. `startTestApp(core, _fake, { name, slug, patch, id, description, sample })`
       1. `before = await runtimePids(core.run.home)`를 **`app.create` 전에** 읽는다. 정한 것: core가 1초 poll로 runtime을 다시 띄우므로(`runtime.ts` 70) source를 commit하는 사이 이미 바뀔 수 있다. `app.create` 뒤에 읽으면 새 pid를 옛 것으로 알고 `settle`이 30초 뒤 실패한다(지금 helper는 `appConnectSource` 직전에 읽었다).
       2. `` created = core.call(appCreate, { ...(id ? { id } : {}), slug, name, description: description ?? `E2E app ${slug}` }) ``. `created.source_path === null`이면 "app.create가 source 폴더를 잇지 못했다(core log: <core.logPath>)"로 던진다(`withSourceFolder`는 실패를 오류로 돌리지 않고 stderr에만 남긴다).
       3. `createAppSource(core, { app: created.id, slug, title: name, patch, sample })`.
       4. `before.length > 0`이면 `settle(core, before)`. 그 뒤에 `openSession(core, { role: "app_engineer", app: created.id })`. ("지켜볼 것" 첫 줄: 다시 뜨는 사이 시작한 turn은 끊길 수 있다. runtime은 도는 turn이 있으면 재시작을 다음 주기로 미룬다(`runtime.ts` 419).)
       5. `{ app: created.id, slug, name, source: dir, commit, ae }`.
   11. `activateTestApp`: `startTestApp` → `deliverRelease(…, { goal: "Make the first release of the app" })` → `activated.status`가 `waiting_consent`가 아니면 던진다(첫 activation은 늘 묻는다, `architecture/activation.md`) → `approveActivation(core, app, "allow")` → `waitRunning(core, app, release)`.
   - 전역 mutable 상태(모듈 counter)를 두지 않는다(AGENTS.md "코드"). tool call id는 turn 순번으로 가른다.
4. `tests/support/app/patch-sandbox.ts`: 11행의 slug를 `await sampleDomain(dir)`로 바꾸고, 머리 주석의 "platform app test(선언과 등록 handler가 같다)"를 "release 준비의 handler 검사(선언과 등록 handler가 같다)"로 고친다.
5. `tests/support/app/sample`: 고칠 것이 없으면 두지 않는다. `sample/src/items.ts.tmpl` 21의 `test`는 SDK host가 앱 자신의 test에 받는 mode라 맞다(changelog "Reactor와 domain event를 지우고" 후의 셋째 줄).
6. `tests/e2e/app-sandbox_test.ts`
   - `appCoreEnv` import를 `../support/app/deps.ts`로, `gateway` 변수와 `app.gateway`·`gateway?.close()`를 지운다.
   - 머리 주석 9-10의 fake 대답 줄을 "App Engineer의 `release_prepare`·`release_activate`는 앱 activation helper(`activateTestApp`)가 거는 것이라 case의 fake 대답 상한(3)에 세지 않는다(`architecture/testing.md` "case 고르는 규칙" 4)"로 고친다. test 이름과 단정은 그대로다.
7. 돌려 본다.
   1. `deno task e2e:deps`(옮긴 path라 lead 등록 전에는 `deno run --allow-all tests/support/app/prepare-deps.ts`).
   2. `deno test --allow-all --no-check tests/e2e/app-sandbox_test.ts`가 통과한다.
   3. offline("지켜볼 것" 셋째 줄): `unshare -rn sh -c 'ip link set lo up && deno run --allow-all tests/support/app/prepare-deps.ts --offline'`와 `unshare -rn sh -c 'ip link set lo up && deno test --allow-all --no-check tests/e2e/app-sandbox_test.ts'`. `prepare-deps.ts`는 `prepareFromSource`(build와 의존 받기)만 지나므로, 둘째가 network 없이 `release.prepare`의 `dependencies`·`migration`·`handlers` 단계에서 떨어지면 그 원인 의존을 `prepare-deps.ts`가 미리 받게 고친다. `unshare`가 이 환경에서 core를 못 띄우면(namespace 권한 등, network 밖의 이유) 고치지 말고 보고의 "알려진 미완 동작"에 적는다.
   4. 처음 통과한 run에서 `activateTestApp` 한 번과 그 안의 `release_prepare`·`release_activate` 한 tool 호출이 걸린 시간을 잰다(turn의 `started_at`·`finished_at`이나 test의 시각). 보고에 적는다.

## 끝남

- `deno task check`가 통과한다(이 task의 file은 모두 `NOT_CHECKED` 안이라 type check·fmt·lint·test에 들지 않는다. 지운 path를 check 안의 file이 import하지 않는지를 이것이 본다).
- 이 task의 file은 따로 본다:
  - `deno check tests/support/app/activate.ts tests/support/app/source.ts tests/support/app/deps.ts tests/support/app/prepare-deps.ts tests/support/app/patch-crash.ts tests/support/app/patch-sandbox.ts tests/e2e/app-sandbox_test.ts`가 오류 없이 끝난다.
  - 같은 file에 `deno fmt --check`와 `deno lint`가 통과한다.
- `deno task e2e:deps` 뒤 `deno test --allow-all --no-check tests/e2e/app-sandbox_test.ts`가 통과한다.
- 위험 test: "activate된 앱 process는 선언 밖의 파일 읽기·쓰기와 network에 닿지 못하고 정상 tool은 계속 된다"(`tests/e2e/app-sandbox_test.ts`. 있는 sandbox 경계 test를 새 helper로 되살린다. 새 test는 없다. helper 자체의 test는 두지 않는다, `write-test` "쓰지 않는 test")
- 남지 않음:
  - `ls tests/support/coding tests/support/gateway/shell.ts tests/e2e/coding_test.ts tests/support/app/patch-reaction.ts tests/support/app/patch-report.ts`가 모두 없음이다.
  - `grep -rnE "ticket|handOff|verifyTicket|reportHarness|approvalsPending|approvalsDecide|agentGrantsSet|codingCli|support/coding|gateway/shell|\.gateway" tests/support/app tests/e2e/app-sandbox_test.ts`가 0줄이다.
  - `grep -rn 'split("/").at(-1)' tests/support/app/patch-crash.ts tests/support/app/patch-sandbox.ts`가 0줄이다.
  - `grep -rn "systemd-run\|platform app test" tests/support/app/deps.ts tests/support/app/patch-crash.ts tests/support/app/patch-sandbox.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check(위 `deno check`·fmt·lint, `deno task check`, app-sandbox e2e)
- 등록할 것: `deno.json`의 `e2e:deps`를 `deno run --allow-all tests/support/app/prepare-deps.ts`로(lead)
- 안 쓰게 된 export: `handOff`, `verifyTicket`, `TestApp.gateway`(지움). `createAppSource`의 입력이 `{ slug, title?, patch? }`에서 `{ app, slug, title?, patch?, sample? }`로 바뀐 것
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것" 여섯을 그대로 했는지 포함: 기다림 상수, 겹치는 file을 지우고 `scaffoldApp`, `--allow-empty`, `sampleDomain`, `app.create` 전 pid, `waitRunning` 제한)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"(wave 2 task가 고칠 patch 다섯의 slug 줄은 여기서 고치지 않는다)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 잰 것: `activateTestApp` 한 번의 시간, `release_prepare`·`release_activate` tool 호출 하나의 시간, `settle`이 기다린 시간
- offline 확인 결과: `unshare` 두 명령의 결과와 `prepare-deps.ts`에 더한 것
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
