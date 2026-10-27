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
