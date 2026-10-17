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

막기: `architecture/layers.md`에 "다른 module의 표를 SQL로 직접 읽게 바꾸지 않는다"를 넣었다. 다만 pull 문서라 worker에게 늘 실리지는 않는다.

고치려면: check로 막는다. 표마다 주인 module을 정하고(ledger schema step이 있는 module), 주인이 아닌 module의 SQL 문자열에 그 표 이름이 나오면 실패시킨다. 비용은 표 이름 목록을 schema에서 뽑는 일이다.

정할 것: check를 만들지, 다시 생길 때까지 문장으로 둘지.

## 새로 쓴 문서와 주석이 지운 파일을 가리킴

```yaml
kind: mistake
modules: [tools]
```

지금: 문서를 줄이던 worker들이 지운 파일을 가리키는 문장을 남겼다. ui-design skill → `ui-inventory/stack.md`, AGENT-ROLE → requirements·specs, PRODUCT → `requirements/values.yaml`, `tools/check-source.ts` 주석 → `terms.md`. 사람이 하나씩 찾아 고쳤다.

영향: agent가 없는 파일을 찾느라 시간을 쓰거나, 없는 것을 근거로 짐작한다.

원인: 지운 파일 목록이 worker에게 주어지지 않았고, 문서 속 path가 있는지 보는 check가 없었다.

고치려면: check 하나를 만든다. `AGENTS.md`, `.claude/skills/`, `project-docs/`의 md·yaml에서 backtick 안의 저장소 path(`packages/`, `project-docs/`, `tools/`, `.claude/`로 시작하는 것)가 실제로 있는지 본다. 문서 기준 상대 path는 첫판에서 뺀다. `tools/check-modules.ts` 옆에 두면 반나절 일이다.
