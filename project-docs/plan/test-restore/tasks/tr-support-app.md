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
      - `amendAppSource(dir, patch): Promise<string>`(그대로. 새 commit)
    - `tests/support/app/activate.ts`
      - `type TestApp = { app: string; slug: string; name: string; source: string; commit: string; ae: string }`. `ae`는 App Engineer session이다. 옛 `gateway` 칸은 없다(event가 필요한 test는 `connectGateway`를 스스로 연다).
      - `appProjectName(slug)`, `openAppProject(core, slug)`, `tool(id, name, args)`: 그대로
      - `aeLane(app: TestApp)`: fake lane. 요청의 tool 목록에 `release_prepare`가 있고 본문에 `App <app.app>:`가 있는 요청이 받는다. 이 lane에 대본을 직접 거는 test(preview 등)는 `` say(core, app.ae, `App ${app.app}: …`) ``로 말한다.
      - `startTestApp(core, fake, { name, slug, patch?, id?, description?, sample? }): Promise<TestApp>`: `app.create` → `createAppSource` → `settle`(source 폴더가 App Engineer의 place 폴더라 agent runtime child가 다시 뜬다) → App Engineer session을 연다.
      - `prepareRelease(core, fake, app, { goal? }): Promise<ReleasePrepareOutput>`: App Engineer turn 하나가 `release_prepare {app}`만 부른다. `failed`도 값으로 돌려준다.
      - `activateRelease(core, fake, app, release): Promise<ReleaseActivateOutput>`: App Engineer turn 하나가 `release_activate {release}`만 부른다. 결과를 그대로 돌려준다.
      - `deliverRelease(core, fake, app, { goal }): Promise<{ release: string; activated: ReleaseActivateOutput }>`: turn 하나에서 prepare → activate. prepare가 `prepared`가 아니면 stage와 reason을 담아 던진다.
      - `approveActivation(core, app, choice: "allow" | "reject" = "allow"): Promise<ActivationConsent>`: `activations.consents {app}`에 줄이 올 때까지 기다려 `activation.consent {release, choice}`(compare `{requested_at}`)로 답하고, 답한 줄을 돌려준다.
      - `waitRunning(core, app, release?): Promise<RuntimeObservation>`: 그대로
      - `activateTestApp(core, fake, { name, slug, patch? }): Promise<TestApp>`: start → deliver → `approveActivation("allow")` → `waitRunning`
      - 지운다: `handOff`, `verifyTicket`, `TestApp.gateway`
      - 같은 session에서 맡기기마다 fake tool call id가 다르다.
    - `tests/support/app/deps.ts`: `appCoreEnv(): Promise<Record<string, string>>`, `e2eDenoDir(): string`(이름 그대로, path만 옮긴다)
    - `tests/support/app/patch-crash.ts`: `crashPatch(dir)`(이름 그대로)
    - 등록할 것(lead): `deno.json`의 `e2e:deps`를 `deno run --allow-all tests/support/app/prepare-deps.ts`로 고친다.

## 할 일

helper를 새 길로 다시 쓰고 coding·gateway shell support와 `coding_test.ts`를 지운 뒤, `app-sandbox_test.ts`로 앱이 `release.prepare` → `release.activate` → 동의 → running까지 가는 것과 `deno task e2e:deps`의 offline cache가 그 길을 덮는 것을 확인한다.
