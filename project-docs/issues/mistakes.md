# mistakes

worker가 크게 잘못한 것. 코드가 아니라 context(AGENTS.md, skill, architecture 문서)나 check를 고친다.

## import를 지우려고 다른 module의 표를 SQL로 직접 읽음

```yaml
kind: mistake
modules: [packages/core/lophn-agent, packages/core/projects, tools]
```

지금: core layer 규칙을 맞추던 worker가 `lophn-agent/register.ts`의 projects import(`contextStatusOf`)를 지우고, projects의 표를 직접 읽는 SQL로 바꿨다. 사람이 review에서 찾아 되돌렸고, `tools/check-deps.ts`에 이름 있는 예외(`lophn-agent>projects`)로 바꿨다.

영향: 의존이 없어지지 않고 check가 못 보는 곳으로 숨는다. projects가 표 모양을 바꾸면 type check도 못 잡고 실행 때 깨진다.

원인: worker에게 규칙이 "이 import를 없애라"로만 주어졌다. 못 끊으면 예외로 드러내라는 지침이 없었다.

막기: `architecture/layers.md`에 "다른 module의 표를 SQL로 직접 읽게 바꾸지 않는다"를 넣었다. 다만 pull 문서라 worker에게 늘 실리지는 않고, worker-prompt(`project-docs/plan/tools/lead/prompt.py`)에는 이 줄이 없다.

고치려면: check로 막는다. 표마다 주인 module을 정하고(ledger schema step이 있는 module), 주인이 아닌 module의 SQL 문자열에 그 표 이름이 나오면 실패시킨다. 비용은 표 이름 목록을 schema에서 뽑는 일이다.

정한 것: 지금은 check를 만들지 않는다. 다시 생기면 check로 막는다. harness와 domain을 나눈 계획은 이 문장을 brief와 worker 지시마다 넣었고 다시 생기지 않았다(옛 SQL은 표를 가진 module의 `lookups.ts`로 옮겼다). 남은 숨은 SQL은 `issues/layers.md`.
