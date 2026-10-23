# workflow

workflow 정의, instance와 줄, flow process의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/workflow.md`.

## flow process에 CPU 한도가 없다

```yaml
kind: bug
modules: [packages/core/main]
```

지금: `packages/core/main/flow-host/flags.ts`의 `flowFlags`는 memory 한도(`--v8-flags=--max-old-space-size=512`)만 두고 CPU 한도는 없다. CPU 시간을 막으려면 OS 한도(`prlimit`)가 필요한데 core에는 그 실행 허락이 없다. 앱 process도 CPU 한도가 없고 화면에 그 한계를 알린다(`packages/core/apps/permissions/flags.ts`의 `permissions.limit.cpu`). flow에는 그런 안내가 없다. 시간 한도는 두지 않기로 했다(오래 도는 flow가 정상이다).

영향: AI가 짠 `flow.ts`가 끝없는 loop에 빠지면 사람이 화면에서 멈출 때까지(`StopWorkflow`) 사람의 기계에서 CPU 하나를 잡는다. job이 밤에 시작한 flow면 아무도 보지 않는 동안 그렇다.

고치려면:
- OS 한도(`prlimit`)로 CPU 시간을 막는다. core에 그 실행 허락이 있어야 한다. 큼.

추천: 앱의 CPU 한도를 정할 때 같이 정한다.
