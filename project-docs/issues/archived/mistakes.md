# mistakes (닫음)

## core를 subshell로 띄워 `$!`가 deno를 가리키지 않음

```yaml
kind: mistake
modules: [tools]
closed: fixed
guard: worker-prompt
```

지금: "이슈 결정 적용" 계획에서 worker 다섯이 core 기동 확인 때 `mkdir ... && export ... && tail -f /dev/null | deno run ... &`나 `( ... ) &`로 띄웠다. `$!`가 subshell을 가리켜 kill 뒤에도 deno가 남았다. 남은 deno를 `fuser`(instance.lock)나 `ss -ltnp`(port)로 찾아 자기 data root인 것을 확인하고 끈 뒤 보고했다. 남의 process를 끈 일은 없었다. `tail -f /dev/null`이 하나 남았을 수 있다는 보고가 하나 있었다.

영향: 자기 core를 못 끄면 다른 worker의 core·port와 섞이고, PID를 찾다가 남의 process를 끌 위험이 있다(앞서 `ps` 조건으로 남의 process를 끈 일이 있다).

원인: `prompt.py`가 "띄우고 `$!`만 kill한다"고만 해서 묶어 쓰는 것을 막지 않았다.

막기: `lead/prompt.py`에 기동 한 줄(`... > core.log 2>&1 &`)과 `PID=$!`, "묶어서 background로 보내지 않는다", "ps·fuser·ss로 찾지 않는다"를 넣었다. 다시 생기면 기동을 script(`lead/boot.sh`처럼 timeout으로 끝나는 것)로 worker에게 준다.

닫음: `project-docs/plan/tools/lead/prompt.py`의 worker 지시문이 기동 한 줄(`... > core.log 2>&1 & PID=$!`)을 그대로 주고, `;`로 잇고 묶어 background로 보내지 않기, ps·fuser·ss로 찾지 않기, pkill·killall 금지를 말한다. 다시 생기면 기동을 script(`lead/boot.sh`처럼 timeout으로 끝나는 것)로 준다.

## 새로 쓴 문서와 주석이 지운 파일을 가리킴

```yaml
kind: mistake
modules: [tools]
closed: fixed
guard: tools/check-docs.ts
```

지금: 문서를 줄이던 worker들이 지운 파일을 가리키는 문장을 남겼다. ui-design skill → `ui-inventory/stack.md`, AGENT-ROLE → requirements·specs, PRODUCT → `requirements/values.yaml`, `tools/check-source.ts` 주석 → `terms.md`. 사람이 하나씩 찾아 고쳤다. 그 뒤에도 `core/lophn-agent/safety/fence.ts` 주석이 없는 `prompt-injection-safety.md`를 가리키는 것이 나왔다.

영향: agent가 없는 파일을 찾느라 시간을 쓰거나, 없는 것을 근거로 짐작한다.

원인: 지운 파일 목록이 worker에게 주어지지 않았고, 문서 속 path가 있는지 보는 check가 없었다.

고치려면: check 하나를 만든다. `AGENTS.md`, `.claude/skills/`, `project-docs/`의 md·yaml에서 backtick 안의 저장소 path(`packages/`, `project-docs/`, `tools/`, `.claude/`로 시작하는 것)가 실제로 있는지 본다. 문서 기준 상대 path는 첫판에서 뺀다. `tools/check-modules.ts` 옆에 두면 반나절 일이다. 같은 check가 `context-component-registry.yaml`의 `path`가 있는지, `change_reasons.boundaries`가 boundary-catalog에 있는지, `roles`가 registry의 role인지도 본다(지금 registry를 보는 check가 없다).

닫음: `tools/check-docs.ts`(`deno task check`의 `docs` 단계, 문서만 바뀐 변경에도 돈다)가 `AGENTS.md`, `.claude/skills/`, `project-docs/`(change-log, `issues/archived`, `plan/`, `products/roadmap/` 제외)의 backtick 저장소 path와 `context-component-registry.yaml`의 `path`·`change_reasons`·`roles`를 본다. 걸리던 28줄(harness 상대 `tools/…` 표기, 옮겨진 template path)을 고쳤다. 코드 주석 속 문서 path는 보지 않는다.
