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

정한 것: 지금은 check를 만들지 않는다. 다시 생기면 check로 막는다. harness와 domain을 나누는 계획의 brief에 "import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 check-deps 예외로 드러낸다"를 넣는다.

## 새로 쓴 문서와 주석이 지운 파일을 가리킴

```yaml
kind: mistake
modules: [tools]
```

지금: 문서를 줄이던 worker들이 지운 파일을 가리키는 문장을 남겼다. ui-design skill → `ui-inventory/stack.md`, AGENT-ROLE → requirements·specs, PRODUCT → `requirements/values.yaml`, `tools/check-source.ts` 주석 → `terms.md`. 사람이 하나씩 찾아 고쳤다. 그 뒤에도 `core/lophn-agent/safety/fence.ts` 주석이 없는 `prompt-injection-safety.md`를 가리키는 것이 나왔다.

영향: agent가 없는 파일을 찾느라 시간을 쓰거나, 없는 것을 근거로 짐작한다.

원인: 지운 파일 목록이 worker에게 주어지지 않았고, 문서 속 path가 있는지 보는 check가 없었다.

고치려면: check 하나를 만든다. `AGENTS.md`, `.claude/skills/`, `project-docs/`의 md·yaml에서 backtick 안의 저장소 path(`packages/`, `project-docs/`, `tools/`, `.claude/`로 시작하는 것)가 실제로 있는지 본다. 문서 기준 상대 path는 첫판에서 뺀다. `tools/check-modules.ts` 옆에 두면 반나절 일이다.

## core를 subshell로 띄워 `$!`가 deno를 가리키지 않음

```yaml
kind: mistake
modules: [tools]
```

지금: "이슈 결정 적용" 계획에서 worker 넷(annotation-target, apps-activation-no-retry, platform-crash-diagnostics, place-operator-app-read, trust-agent-notes 중)이 core 기동 확인 때 `mkdir ... && export ... && tail -f /dev/null | deno run ... &`나 `( ... ) &`로 띄웠다. `$!`가 subshell을 가리켜 kill 뒤에도 deno가 남았다. 남은 deno를 `fuser`(instance.lock)나 `ss -ltnp`(port)로 찾아 자기 data root인 것을 확인하고 끈 뒤 보고했다. 남의 process를 끈 일은 없었다. `tail -f /dev/null`이 하나 남았을 수 있다는 보고가 하나 있었다.

영향: 자기 core를 못 끄면 다른 worker의 core·port와 섞이고, PID를 찾다가 남의 process를 끌 위험이 있다(앞서 `ps` 조건으로 남의 process를 끈 일이 있다).

원인: `prompt.py`가 "띄우고 `$!`만 kill한다"고만 해서 묶어 쓰는 것을 막지 않았다.

막기: `lead/prompt.py`에 기동 한 줄(`... > core.log 2>&1 &`)과 `PID=$!`, "묶어서 background로 보내지 않는다", "ps·fuser·ss로 찾지 않는다"를 넣었다. 다시 생기면 기동을 script(`lead/boot.sh`처럼 timeout으로 끝나는 것)로 worker에게 준다.
