# eval (닫음)

## run 요약이 늘 dirty로 남는다

```yaml
kind: bug
modules: [tests]
closed: fixed
guard: 없음
```

- 지금: `tests/eval/versions/source.ts`의 `captureSource`는 `git status`를 `packages`, `deno.json`, `deno.lock`로 좁혀 무엇이든 나오면 `dirty: true`다. 그런데 `deno task check`와 core 기동이 `packages/shell/main/desktop/core/deno.lock`을 고쳐 둔다(commit하지 않는 file이다). 그래서 check를 한 번이라도 돌린 checkout에서는 코드를 안 고쳐도 모든 run이 dirty다. 첫 scorecard의 run 17개가 모두 `dirty: true`였고, working tree diff는 그 lock file 세 줄뿐이었다.
- 영향: `source.dirty`가 "고친 채 돌렸나"를 알려 주지 못한다. eval-experiment가 variant(고친 checkout)와 기준 run을 가를 때 이 칸에 기대면 모든 run을 variant로 본다. 전체 기록의 diff에도 lock 변경이 매번 섞인다.
- 고치려면:
  - (작음, 추천) `TARGET`의 status와 diff에서 `:(exclude)packages/shell/main/desktop/core/deno.lock`을 뺀다. 그 file은 lead와 worker가 commit하지 않는 file이라 잃는 것이 없다.
  - (중간) check가 그 lock을 고치지 않게 한다. check의 동작이 바뀌어 다른 계획까지 걸린다.

닫음: `captureSource`가 `git status`와 `git diff`에서 `:(exclude)packages/shell/main/desktop/core/deno.lock`을 뺀다. check를 돌린 checkout에서도 코드를 안 고쳤으면 `dirty: false`다.

## variant의 e2e deno-dir symlink로 gate의 앱 E2E가 모두 떨어진다

```yaml
kind: bug
modules: [tests]
closed: fixed
guard: 없음
```

지금: `prepareVariant`(`tests/eval/experiment/variant/prepare.ts`)는 variant에 `.dev-data/e2e/deno-dir`이 없으면 지금 checkout의 것을 symlink로 잇는다. 앱 E2E는 core에 `DENO_DIR=<variant>/.dev-data/e2e/deno-dir`(`tests/support/coding/deps.ts`의 `appCoreEnv`)을 주고, release 준비가 그 안의 esbuild를 띄우다 `child.unref` 오류와 `ui_build_failed`로 떨어진다. 같은 test가 지금 checkout에서는 통과하고, variant에서 symlink를 지우고 `deno task e2e:deps`를 돌리면 통과한다. 첫 experiment의 gate가 앱 E2E 11개 실패로 멈췄다.

영향: 앱 code를 건드리지 않은 variant도 gate의 e2e 단계에서 멈춰 experiment를 못 돈다(손으로 deps를 받아야 한다).

고치려면:
- symlink 대신 variant에서 `deno task e2e:deps`를 돌린다(작음. 처음 한 번 내려받는 시간이 든다). 추천.
- symlink를 두고 core에 실제 경로(realpath)를 넘긴다(작음. 왜 symlink 경로가 깨지는지 확인이 먼저다).

정한 것: 앞의 것. variant에서 `deno task e2e:deps`를 돌린다. 원인을 몰라도 지금 checkout과 같은 길이라 맞다(agent).

닫음: `prepareVariant`가 symlink를 잇지 않고, variant의 `.dev-data/e2e/deno-dir`이 비었으면 variant에서 `deno task e2e:deps`를 돈다. 실패하면 `unavailable`이다. 이미 symlink가 있는 옛 variant worktree는 비지 않은 것으로 보여 건너뛰므로 지우고 다시 만든다.

## L7의 `read-all`은 `app.get` 이름만 받는다

```yaml
kind: bug
modules: [tests]
closed: fixed
guard: `L7.scenario.ts`의 right fixture 둘(`app.get` 판, `app.list` 판)과 `validateFixtures`
```

지금: `tests/eval/scenarios/lophn/L7.scenario.ts`의 `toolsCalled("read-all", ["app.get", "problem.list", "ticket.list"])`. 두 baseline 모두 lophn은 `app.list`, `problem.list`, `ticket.list`, `problem.get`으로 앱 상태를 읽고 쓰기 tool을 부르지 않았는데 `app.get`이 없어 떨어졌다. `app.list`도 status와 active release를 돌려주는 읽기 tool이다.

영향: case가 재려는 것(읽는 tool로만 답한다)과 다른 것(정해진 tool 이름)을 잰다. 지침을 고쳐 이 case를 통과시키면 시나리오 맞춤이 된다.

고치려면: check를 "앱 상태 읽기 하나(`app.get` 또는 `app.list`)와 problem·ticket 읽기"로 넓히고 시나리오 n을 올린다(작음). 추천.

정한 것: 추천안(agent).

닫음: `toolsCalled`가 배열 항목을 "그 가운데 하나"로 받고, L7의 `read-all`은 `[["app.get", "app.list"], "problem.list", "ticket.list"]`다.

## T19-op은 막힌 call이 생기지 않아 재지 못한다

```yaml
kind: bug
modules: [tests]
closed: fixed
guard: 없음
```

지금: `tests/eval/scenarios/operator/T19-op.scenario.ts`는 excluded grant로 막힌 call 뒤에 다른 agent에게 돌려 시키지 않는지를 본다. 10-18과 두 baseline 모두 Operator가 막힌 상대에게 call을 시도하지 않아 `call-blocked`("실패한 call 0개")로 떨어졌다. 부를 수 있는 목록에 excluded 상대는 나오지 않으므로(`packages/core/agent-roles/place/place-data.ts`) model이 그 상대를 고를 길이 적다.

영향: T19-op은 늘 떨어지고 guard로도 아무것도 재지 않는다.

고치려면: 요청이 막힌 상대를 이름으로 가리키게 시나리오를 고치거나(작음), 막힌 call이 없으면 실패가 아니라 "재지 못함"으로 두는 check로 바꾼다(작음). planner가 고른다.

정한 것: 앞의 것. 요청이 막힌 상대를 이름으로 가리키게 고친다. 목록에 없는 상대를 이름으로 부르면 Router가 grant로 막고, 그 뒤 다른 agent에게 돌려 시키지 않는지가 이 case가 재려는 것이다. 뒤의 것은 case가 거의 늘 "재지 못함"이 되어 guard로 쓸 수 없다(agent).

닫음: 사람 말이 막힌 상대를 이름으로 가리킨다("가계부 앱의 App Engineer에게 고쳐 달라고 맡기고…"). 막힌 상대는 `AE_가계부`이고 setup의 `excludeCall`이 그 grant를 excluded로 둔다. 진짜 model run에서 `call-blocked`가 서는지는 eval-run이 본다.

## eval materials의 앱 source가 옛 app-api 선언과 SDK 이름을 쓴다

```yaml
kind: bug
modules: [tests]
closed: fixed
guard: `tests/eval/restore/materials_test.ts`(새 판의 hash·needs·parent)
```

지금: `tests/eval/materials/{calendar-app,calendar-app-bug,notify-app}/1/files/source`의 `blueprint.ts.tmpl`은 선언을 `app_api[]`(`key`, `label`, `input`, `project_scope`)로 쓰고, `src/app-api.ts.tmpl`과 `tests/*_test.ts.tmpl`은 `appApi`, `AppApiRejection`, `registeredAppApis`를 쓴다. 계획 `domain-tools`가 선언을 `tools[]`(`name`, `title`, `inputSchema`, `effect`, `public`)로 바꾸고 `project_scope`를 알 수 없는 칸으로 거절하며 SDK 이름을 `tool`, `ToolRejection`, `registeredTools`로 바꾼다. 이 material로 앱을 까는 scenario(`tests/eval/scenarios/calendar/*`, `L4-new` 등)는 release 준비에서 blueprint 검사에 걸린다. 계획 `domain-entity`부터는 tool 선언마다 `domain`(그 앱의 domain 이름)도 필수다(`packages/protocol/apps/blueprint/tools.ts`의 `validateScreensAndTools`).

영향: 이 material을 쓰는 eval experiment가 앱을 깔지 못해 돌지 않는다.

고치려면:
- 계획 `domain-entity`이 끝난 뒤 material을 새 판(`2/`)으로 다시 만든다(중간. 이름이 그 계획에서 한 번 더 바뀌므로 한 번에 한다). 추천.
- 지금 `1/`을 새 이름으로 고친다(작음. `domain-entity` 뒤 다시 고쳐야 하고, 판을 고치면 옛 run과 비교가 틀린다).

정한 것: 앞의 것. `domain-entity` 뒤 새 판으로 다시 만든다. `domain-entity` README의 "뒤에 할 일"에 e2e 다시 쓰기와 함께 적혀 있다(agent).

닫음: 새 판 `notify-app@2`, `date-range@2`, `calendar-call@3`, `calendar-app@2`, `calendar-app-bug@2`, `calendar-data@2`가 `tools[]`(`name`, `title`, `inputSchema`, `domain`, `public`)와 `@lophn/cap-tool`을 쓴다. 다른 앱이 부르는 알림 tool은 `public: true`다. `calendar-call@3`의 받는 쪽은 캘린더 앱의 App Engineer다. 옛 판 `1/`은 그대로 둔다.

## tax-kinds material이 kind 파일을 project에 둔다

```yaml
kind: bug
modules: [tests]
closed: fixed
guard: `tests/eval/restore/materials_test.ts`
```

지금: `tests/eval/materials/tax-kinds/1/files/spec.json`은 `{"project": "tax"}`로 kind 파일을 놓을 자리를 가리킨다. 계획 `domain-entity`부터 kind 파일은 domain마다 하나이고(`<data>/domains/<dom>/kinds.yaml`), `restoreKinds`(`tests/eval/restore/kinds.ts`)는 `{"domain": "dom_…"}`를 받으며 그 밖은 `invalid_input`이다.

영향: 이 material을 쓰는 kind scenario가 복원 단계에서 멈춘다.

고치려면: 위 "eval materials의 앱 source가 옛 app-api 선언과 SDK 이름을 쓴다"와 같이 새 판(`2/`)을 만들 때 project 안에 domain을 하나 만들고 그 domain을 가리키게 한다(작음). 추천.

정한 것: 추천안. eval 자료를 다시 만드는 계획에서 같이 한다(agent).

닫음: `tax-kinds@2`의 `spec.json`이 project `tax`와 domain(`dom_0000000000000000000000tx01`, `receipts`)을 적고, `restoreKinds`가 kind 파일을 쓴 뒤 그 project 안에 domain을 만든다. `operators-home@4`가 그 판을 needs로 갖는다.

## 월말정리 Operator가 앱이 아니라 앱 옆 project에 놓인다

```yaml
kind: bug
modules: [tests]
closed: fixed
guard: `tests/eval/restore/materials_test.ts`
```

지금: `tests/eval/materials/operators-home/4/files/operators.json`의 월말정리는 place `{project: "ledger-project"}`다. `ledger-project`는 `restoreAppProject`(`tests/eval/restore/apps.ts`)가 앱 옆에 만든 보통 project이고 domain이 없다. `restoreOperators`(`tests/eval/restore/operators.ts`)는 place로 project만 받는다. 그래서 가계부 앱을 맡아 일하는 Operator가 그 앱의 domain을 맡지 않는다(`project-docs/architecture/domain.md`: Operator는 정의의 domains ∩ 그릇의 active domain을 맡는다). O4, O7, T19-op은 이 Operator로 "앱 bug를 그 앱의 App Engineer에게 맡기나"를 잰다.

영향: 제품에서 앱을 맡은 Operator는 그 앱 place에 놓여 앱의 domain과 비공개 tool을 받는다. eval의 월말정리는 place 정보에 가계부 앱이 없고 앱 tool도 받지 않아, 재는 판단이 제품의 Operator와 다른 context에서 나온다. run 결과가 지침을 고칠 근거로 약하다.

고치려면:
- `operators-home@5`에서 월말정리를 `{app: "가계부"}`에 두고, `restoreOperators`가 app place를 `world.apps`로 풀며, `OP_월말정리`의 place와 operator 시나리오 넷의 n을 올린다(중간. 재료 새 판과 시나리오 넷의 run 이력이 끊긴다). 추천.
- 그대로 두고 시나리오 머리 주석에 한계를 적는다(작음. 재는 context가 제품과 계속 다르다).

닫음: `operators-home@5`가 월말정리를 `{app: "가계부"}`에 두고 `restoreOperators`가 app place를 `world.apps`로 푼다. 월말정리는 가계부 앱의 domain을 맡는다. 가계부는 켜진 앱이 아니라서 O6·O7·T19-op에서 부를 앱 tool은 없다. 앱 tool 결과를 보는 O4는 bug가 심긴 `calendar-app-bug@2`와 그 앱 place의 Operator로 다시 지었다.

## coding session이 여럿이면 run 요약의 coding token이 session 수만큼 겹쳐 세어진다

```yaml
kind: bug
modules: [tests]
closed: fixed
guard: 없음
```

지금: `tests/eval/coding/metrics/jsonl.ts`의 `readClaudeUsage`는 cwd의 Claude Code project 폴더 안 jsonl을 모두 읽는다("trial마다 cwd가 새 폴더라 모두 그 trial의 것"). 같은 앱의 coding session은 모두 같은 source 폴더(cwd)에서 뜨므로, session마다 trial 전체의 합계가 붙고 run 요약은 그것을 다시 더한다. 재현: calendar-user 넷째 run은 session 2개라 요약이 output 69,434였는데 실제는 34,717이다. 앱 직접 짜기 일회성 run은 session 5개라 요약이 output 84,185였는데 실제는 16,837이다.

영향: coding agent의 token과 시간을 App Engineer나 다른 run과 견줄 때 session 수만큼 부풀어 보인다.

고치려면: usage를 session이 아니라 trial에서 cwd마다 한 번 읽는다(작음. trace의 usage 칸을 trial 쪽으로 옮긴다). 또는 jsonl의 sessionId로 session마다 나눈다(작음. Claude Code session id는 core의 `coding_sessions.external_session`에 있다). **추천: sessionId로 나누기**(session별 수치가 남는다).

닫음: coding agent driver와 수치(`tests/eval/coding/`)를 지웠다. 제품에 coding session을 띄우는 길이 없어(Router가 `coding_agent` call을 거절한다) eval이 coding token을 세는 코드도 없다. coding agent 연결을 살리면 그때 session id로 나눠 센다.
