# mistakes

worker가 크게 잘못한 것. 코드가 아니라 context(AGENTS.md, skill, architecture 문서)나 check를 고친다.

## 이름 바꾸기가 type 없이 오가는 wire 칸을 놓쳤다

```yaml
kind: mistake
modules: [tools, packages/core/apps, packages/shell/main]
```

지금: protocol 칸 이름을 바꾸는 task(`declarations` → `facts`, `blueprint` → `declaration`)가 type check가 안내한 곳만 고치고, type 없이 칸을 쓰거나 읽는 곳 둘을 놓쳤다. check:full, core 기동, lead review를 다 지났다.
- shell `packages/shell/main/app-frame/app-connection.ts`의 `declaredHosts`가 `read apps/tools` 응답을 `record(value?.declarations)`로 읽었다. 늘 `undefined`라 선언한 net host 집합을 못 얻는다. lead review가 찾았다.
- core `packages/core/apps/control.ts`가 `deps.activation.command(machine, { command: releaseRecord.name, input: {...} })`로 `release.record`에 옛 칸 `blueprint`를 보냈다. envelope의 `input`은 type이 없고 protocol 입력은 strict object라 release 기록이 늘 `invalid_input`이 된다. lead review도 못 보고, 같은 file의 지역 이름을 고치던 다음 wave worker가 찾았다.

원인: worker 지침(`project-docs/plan/tools/lead/prompt.py`, orchestrate skill의 "worker에게 꼭 넣을 것")은 route를 지우거나 바꿀 때 method 문자열을 grep하라고만 한다. 칸 이름도 type 없는 길(command envelope의 `input`, `link.read`·`call`의 응답, SQL 열)로 오간다는 말이 없다.

막기: `prompt.py`의 grep 문장에 "protocol 입력·출력의 칸 이름을 바꾸면 `<칸>:`과 `.<칸>`도 문자열로 grep한다. command envelope의 `input`과 `link.read`·`call` 응답은 type이 없다"를 더한다(이 변경에서 더했다). 다시 생기면 command envelope `input`을 그 command의 입력 type으로 묶는다.
