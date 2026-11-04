# workflow

workflow 정의, instance와 줄, flow process의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/workflow.md`.

## flow process에 CPU 한도가 없다

```yaml
kind: bug
modules: [packages/core/main]
```

지금: flow process(`packages/core/main/flow-host/host.ts`)는 Electron의 Node로 뜨고 CPU·memory 한도가 없다. 앱 process도 같다. CPU 시간을 막으려면 OS 한도(`prlimit`)가 필요하다. 시간 한도는 두지 않기로 했다(오래 도는 flow가 정상이다).

영향: AI가 짠 `flow.ts`가 끝없는 loop에 빠지면 사람이 화면에서 멈출 때까지(`StopWorkflow`) 사람의 기계에서 CPU 하나를 잡는다. job이 밤에 시작한 flow면 아무도 보지 않는 동안 그렇다.

고치려면:
- OS 한도(`prlimit`)로 CPU 시간을 막는다. core에 그 실행 허락이 있어야 한다. 큼.

추천: 앱의 CPU 한도를 정할 때 같이 정한다.

## bare agent가 `workflow.report`를 고르지 않으면 step을 끝내지 못한다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/main]
```

지금: step 입력 글(`packages/core/lophn-agent/run-loop/input-text.ts`의 `inputParts`, `step` 갈래)은 runtime과 상관없이 "report it with `lophn workflow report`"다. bare session은 정의 `tools`에 `workflow.report`를 고르지 않았으면 `lophn` tool에 그 명령이 없고 실행 목록에도 없다(`packages/core/lophn-agent/run-loop/prepare.ts`의 `visibleTools`, `runnableTools`). result call은 bare면 turn이 끝날 때 마지막 응답이 답이지만 step에는 그런 규칙이 없다.

영향: 사람이 bare agent를 workflow 참가자로 두고 `workflow.report`를 고르는 것을 잊으면 step이 보고되지 않아 instance가 멈춘다. bare의 result call 자동 답이 막으려던 것과 같은 실패다.

고치려면:
- step도 result call처럼 bare면 `answer_completed` turn의 마지막 응답을 `workflow.report`(다음 step 없이 진행 기록, 또는 끝)로 보낸다. 다음 step을 고르는 `--next`를 model이 못 주므로 flow가 다음을 정하는 workflow만 맞다. 중간.
- bare 정의가 workflow에 참가하면 편집 화면과 저장이 `workflow.report`를 요구한다. 어느 agent가 참가자인지는 flow 실행 때 정해져 저장 때 모른다. 중간.
- 편집 화면 Tools의 도움말에 workflow 참가자는 `workflow.report`를 골라야 한다고 적는다. 잊는 것은 그대로 막지 못한다. 작음.

추천: 첫째. harness 참가자(roadmap `agent-platform.md` 단계 7)도 같은 길이 필요하다.

## 이름 없는 `{kind: harness}` 참가자가 아직 선언된다

```yaml
kind: defect
modules: [packages/protocol, packages/core/workflows, packages/shell/renderer]
```

- 지금: harness agent는 runtime이 harness인 이름 있는 agent라 `{agent}` 참가자로 넘긴다. 그런데 옛 설계의 `{kind: "harness"}`가 protocol(`packages/protocol/workflows/declaration.ts`, `values.ts`, `instances.ts`의 not_handed 이유 `harness`), core(`packages/core/workflows/declaration.ts`, `plan.ts`), renderer(`packages/shell/renderer/workspace/source.ts`)에 남아 선언으로 받고 넘길 때 `not_handed`(`unresolved`)가 된다.
- 영향: workflow를 쓰는 사람이나 agent가 받을 곳 없는 참가자를 선언할 수 있고, 지울 때까지 세 package가 쓰이지 않는 꼴을 지닌다.
- 고치려면: kind를 지우고 저장된 instance `participants`의 `{kind: "harness"}`를 옮기는 ledger step을 더한다(중간). 추천.
