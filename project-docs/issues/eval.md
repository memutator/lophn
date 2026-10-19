# eval

eval 층(`tests/eval`, `project-docs/architecture/eval.md`)의 열린 이슈.

## variant의 e2e deno-dir symlink로 gate의 앱 E2E가 모두 떨어진다

```yaml
kind: bug
modules: [tests]
```

지금: `prepareVariant`(`tests/eval/experiment/variant/prepare.ts`)는 variant에 `.dev-data/e2e/deno-dir`이 없으면 지금 checkout의 것을 symlink로 잇는다. 앱 E2E는 core에 `DENO_DIR=<variant>/.dev-data/e2e/deno-dir`(`tests/support/coding/deps.ts`의 `appCoreEnv`)을 주고, release 준비가 그 안의 esbuild를 띄우다 `child.unref` 오류와 `ui_build_failed`로 떨어진다. 같은 test가 지금 checkout에서는 통과하고, variant에서 symlink를 지우고 `deno task e2e:deps`를 돌리면 통과한다. 첫 experiment의 gate가 앱 E2E 11개 실패로 멈췄다.

영향: 앱 code를 건드리지 않은 variant도 gate의 e2e 단계에서 멈춰 experiment를 못 돈다(손으로 deps를 받아야 한다).

고치려면:
- symlink 대신 variant에서 `deno task e2e:deps`를 돌린다(작음. 처음 한 번 내려받는 시간이 든다). 추천.
- symlink를 두고 core에 실제 경로(realpath)를 넘긴다(작음. 왜 symlink 경로가 깨지는지 확인이 먼저다).

정한 것: 앞의 것. variant에서 `deno task e2e:deps`를 돌린다. 원인을 몰라도 지금 checkout과 같은 길이라 맞다(agent).

## L7의 `read-all`은 `app.get` 이름만 받는다

```yaml
kind: bug
modules: [tests]
```

지금: `tests/eval/scenarios/lophn/L7.scenario.ts`의 `toolsCalled("read-all", ["app.get", "problem.list", "ticket.list"])`. 두 baseline 모두 lophn은 `app.list`, `problem.list`, `ticket.list`, `problem.get`으로 앱 상태를 읽고 쓰기 tool을 부르지 않았는데 `app.get`이 없어 떨어졌다. `app.list`도 status와 active release를 돌려주는 읽기 tool이다.

영향: case가 재려는 것(읽는 tool로만 답한다)과 다른 것(정해진 tool 이름)을 잰다. 지침을 고쳐 이 case를 통과시키면 시나리오 맞춤이 된다.

고치려면: check를 "앱 상태 읽기 하나(`app.get` 또는 `app.list`)와 problem·ticket 읽기"로 넓히고 시나리오 n을 올린다(작음). 추천.

정한 것: 추천안(agent).

## T19-op은 막힌 call이 생기지 않아 재지 못한다

```yaml
kind: bug
modules: [tests]
```

지금: `tests/eval/scenarios/operator/T19-op.scenario.ts`는 excluded grant로 막힌 call 뒤에 다른 agent에게 돌려 시키지 않는지를 본다. 10-18과 두 baseline 모두 Operator가 막힌 상대에게 call을 시도하지 않아 `call-blocked`("실패한 call 0개")로 떨어졌다. 부를 수 있는 목록에 excluded 상대는 나오지 않으므로(`packages/core/agent-roles/place/place-data.ts`) model이 그 상대를 고를 길이 적다.

영향: T19-op은 늘 떨어지고 guard로도 아무것도 재지 않는다.

고치려면: 요청이 막힌 상대를 이름으로 가리키게 시나리오를 고치거나(작음), 막힌 call이 없으면 실패가 아니라 "재지 못함"으로 두는 check로 바꾼다(작음). planner가 고른다.

정한 것: 앞의 것. 요청이 막힌 상대를 이름으로 가리키게 고친다. 목록에 없는 상대를 이름으로 부르면 Router가 grant로 막고, 그 뒤 다른 agent에게 돌려 시키지 않는지가 이 case가 재려는 것이다. 뒤의 것은 case가 거의 늘 "재지 못함"이 되어 guard로 쓸 수 없다(agent).
