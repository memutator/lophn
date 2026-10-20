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

## import를 지우려고 다른 module의 표를 SQL로 직접 읽음

```yaml
kind: mistake
modules: [packages/core/lophn-agent, packages/core/projects, tools]
closed: fixed
guard: worker-prompt
```

지금: core layer 규칙을 맞추던 worker가 `lophn-agent/register.ts`의 projects import(`contextStatusOf`)를 지우고, projects의 표를 직접 읽는 SQL로 바꿨다. 사람이 review에서 찾아 되돌렸고, `tools/check-deps.ts`에 이름 있는 예외(`lophn-agent>projects`)로 바꿨다.

영향: 의존이 없어지지 않고 check가 못 보는 곳으로 숨는다. projects가 표 모양을 바꾸면 type check도 못 잡고 실행 때 깨진다.

원인: worker에게 규칙이 "이 import를 없애라"로만 주어졌다. 못 끊으면 예외로 드러내라는 지침이 없었다.

막기: `architecture/layers.md`에 "다른 module의 표를 SQL로 직접 읽게 바꾸지 않는다"를 넣었다. 다만 pull 문서라 worker에게 늘 실리지는 않고, worker-prompt(`project-docs/plan/tools/lead/prompt.py`)에는 이 줄이 없다.

고치려면: check로 막는다. 표마다 주인 module을 정하고(ledger schema step이 있는 module), 주인이 아닌 module의 SQL 문자열에 그 표 이름이 나오면 실패시킨다. 비용은 표 이름 목록을 schema에서 뽑는 일이다.

정한 것: 지금은 check를 만들지 않는다. 다시 생기면 check로 막는다. harness와 domain을 나눈 계획은 이 문장을 brief와 worker 지시마다 넣었고 다시 생기지 않았다(옛 SQL은 표를 가진 module의 `lookups.ts`로 옮겼다). 남은 숨은 SQL은 `issues/layers.md`.

닫음: worker 지시문(`project-docs/plan/tools/lead/prompt.py`)과 orchestrate skill의 "worker에게 꼭 넣을 것"에 "import를 끊으려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 check-deps 예외로 둔다"를 넣었다. 계획 README마다 손으로 옮기던 문장이다. 다시 생기면 정한 것대로 check로 막는다.

## check의 test 단에 붙인 `--ignore`가 deno.json의 exclude를 지움

```yaml
kind: mistake
modules: [tools]
closed: fixed
guard: 없음
```

지금: brief가 "`deno.json`의 `test.exclude` 대신 `tools/check.ts`의 `deno test`에 `--ignore=tests/e2e,tests/live`를 붙인다"고 정했고 worker가 그대로 했다. Deno 2.9.7에서 CLI `--ignore`는 root `deno.json`의 `exclude`(`.claude`, `.dev-data`, `project-docs`, `packages/shell/main` …)에 더해지지 않고 그것을 대체한다. 그래서 `check:full`의 discovery가 `.dev-data/` 아래 임시 `*_test.ts`와 core가 깐 template의 test까지 찾았다. lead가 다음 task의 merge에서 worktree의 `.dev-data` file 때문에 full check가 실패해 찾았다.

영향: main checkout에서 `check:full`을 돌리면 `.claude/worktrees/*`의 남의 test까지 돈다. data root에 깔린 template test가 실패하면 check가 이유 없이 빨개진다.

원인: brief를 쓸 때 "`--ignore`는 discovery에서만 빼고 직접 준 인자는 돈다"까지만 확인하고 config exclude와 합쳐지는지는 보지 않았다. worker는 임시 file 확인을 `tests/` 안에서만 했다.

막기: 코드 주석으로 둔다. 다시 생기면 check 자신을 보는 확인(`.dev-data`에 실패하는 임시 test를 두고 `check:full`)을 brief의 끝남 기준에 넣는다.

닫음: `tools/check.ts`의 test 단이 `--ignore`에 `DENO_EXCLUDED`(root `deno.json`의 exclude와 같은 목록)와 `NOT_IN_CHECK`를 같이 준다. 그 자리 주석이 "CLI --ignore는 root deno.json의 exclude를 대체한다"를 적는다.

## core 기동 지시문이 `wait`에서 멈춤

```yaml
kind: mistake
modules: [tools]
closed: fixed
guard: lead/boot.sh
```

지금: `project-docs/plan/tools/lead/prompt.py`와 `.claude/skills/orchestrate/SKILL.md`의 기동 한 줄은 `tail -f /dev/null | deno run ... & PID=$!; sleep 15; kill $PID; wait $PID`다. `$!`는 pipeline 끝의 deno지만 `tail -f /dev/null`은 쓸 것이 없어 SIGPIPE를 받지 않고 끝나지 않는다. 그래서 `wait`이 돌아오지 않는다. browser-bridge 계획의 worker 둘이 지시문 그대로 돌리다 Bash 호출이 멈췄고, 하나는 TaskStop과 자기 PID의 `kill -9`로, 하나는 `timeout -s KILL 15`로 바꿔 빠져나왔다. 남은 core는 없었다(lead가 두 port에 접속해 확인).

영향: worker마다 기동 확인에서 시간을 잃고, 멈춘 호출을 빠져나오려 지시문 밖 방법(`kill -9`, TaskStop)을 쓴다. 다음 worker가 ps로 남은 process를 찾다가 남의 process를 끌 위험이 다시 생긴다.

원인: 앞서 닫은 "core를 subshell로 띄워 `$!`가 deno를 가리키지 않음"(`archived/mistakes.md`)의 막기가 지시문 한 줄이었고, 그 줄 자체가 끝나지 않는다.

다시 생김: 앞서 지시문에 기동 한 줄을 넣어 닫았고 "다시 생기면 `lead/boot.sh`처럼 timeout으로 끝나는 script로 준다"고 적었다. 이번에는 그 한 줄이 원인이다.

막기: `prompt.py`와 orchestrate skill의 기동 줄을 "`cd <worktree>; project-docs/plan/tools/lead/boot.sh`"로 바꾼다(작음). `boot.sh`는 `(sleep 12) | timeout 40 deno ...`로 stdin을 닫아 core가 스스로 끝나고, 새 data root로 두 번 띄워 `boot N exit 0`을 찍는다. browser-bridge wave 2부터 lead 메모로 이 길을 주었고 worker 넷이 멈추지 않았다.

닫음: `prompt.py`와 orchestrate skill의 core 확인을 `lead/boot.sh` 호출 하나로 바꿨다. 손으로 띄우는 한 줄은 지시문에서 지웠다.

## 안 쓰는 export를 지우며 화면이 문자열로 부르던 route를 지웠다

```yaml
kind: mistake
modules: [packages/protocol, packages/shell, tools]
closed: fixed
guard: worker-prompt
```

지금: protocol의 안 쓰는 export를 지운 변경이 route `app.blueprint`(`apps/blueprint`)를 지웠다. 화면 셋은 그 route를 resource·method 문자열로 불러 type check가 보지 못했다: `packages/shell/renderer/apps/core-source.ts`의 `entryScreen`(`call(core, "read", "blueprint", …)`), `packages/shell/renderer/app-frame/app-views.tsx`, `packages/shell/renderer/workspace/agents/core-grants.ts`(`link.read("apps", "blueprint", …)`). 모두 `not_found`로 실패해 앱 공간의 첫 화면, 앱 화면 목록, agent grant의 앱 목록이 비었다. 같은 출력의 route `app.app_api`가 있어 method만 바꿔 고쳤다(계획 `domain-tools`).

영향: check와 core 기동이 통과한 채 화면 기능 셋이 조용히 비었고, 다른 계획의 worker가 우연히 찾을 때까지 남았다.

원인: "쓰는 곳 없음"을 import로만 판정했다. route는 화면에서 문자열(resource, method)로 부르는 길이 있는데 지침에 그 grep이 없었다.

막기: route를 지우거나 이름을 바꾸는 task는 `grep -rn '"<method>"' packages/shell tools tests`로 문자열 호출을 같이 본다. 이 문장을 orchestrate skill "worker에게 꼭 넣을 것"과 `prompt.py`의 지운 이름 grep 줄에 더했다. 다시 생기면 화면의 문자열 호출을 route 객체(`readOf(core, <route>, …)`)로 바꿔 type check가 잡게 한다.

닫음: orchestrate skill "worker에게 꼭 넣을 것"과 `project-docs/plan/tools/lead/prompt.py`가 route를 지우거나 이름을 바꾸면 method를 문자열로도 grep하라고 말한다. 화면의 문자열 호출을 route 객체로 바꿔 type check가 잡게 하는 일은 같은 일이 다시 생기면 한다.

## wire 칸을 지우고 harness driver의 보내는 쪽을 남겼고, 그 실패를 옛 이슈에 붙였다

```yaml
kind: mistake
modules: [packages/core/problems, packages/protocol]
closed: fixed
guard: `packages/core/problems/tests/work/app-driver.ts`의 `satisfies ProcessCallRequest`(type check)
```

지금: 계획 `domain-tools`가 앱 process wire(`ProcessCallRequest`)에서 `context.project`를 지웠다. 앱 runtime의 `parseProcessCall`은 모르는 칸을 거절한다. 그런데 app test harness의 `packages/core/problems/tests/work/app-driver.ts`는 control socket 호출 셋(`rejectsInvalidInput`, `rewind`, `call`)의 body를 type 없는 object literal로 만들어 `project: null`을 계속 실었다. check와 core 기동은 통과했고, main에서 모든 앱의 `rewind`·`examples` 검사가 깨졌다(`blueprint_handler_match`는 거꾸로 공짜 통과). lead는 손 확인에서 이 실패를 열린 이슈 "write app-api의 rewind 검사가 fail로 나온다"와 문구가 같다고 보고 detail을 읽지 않은 채 그 이슈의 "막힌 앱"으로 적었다. 원인은 계획 `rewind-check`의 진단에서 나왔다.

영향: examples ticket이 모두 확인되지 않고 template 앱도 활성화되지 않은 채 main에 남았다. 사람이 이슈의 방향을 잘못된 근거로 다시 정할 뻔했다.

원인:
- wire 칸을 지운 task의 brief가 보내는 쪽 목록을 core 호출 길과 앱 runtime까지만 적었다. harness driver는 같은 wire를 따로 만드는데 type을 걸지 않아 type check가 못 봤다.
- 실패 이름과 문구가 같으면 같은 원인이라고 본 것. detail은 token으로 읽히지 않았지만 disk의 blob에는 있었다.

막기:
- 계획 `rewind-check`의 `rc-wire`가 driver의 세 body에 `satisfies ProcessCallRequest`를 건다(check로 막는다).
- `issue` skill "같은 이슈를 찾는다"에 "겉 문구가 같아도 detail을 읽어 원인이 같은지 본 뒤 덧붙인다"를 더했다.

닫음: app test harness driver의 control socket body 셋(`rejectsInvalidInput`, `rewind`, `call`)이 `satisfies ProcessCallRequest`를 걸어, wire 칸을 바꾸면 type check가 driver도 잡는다. `issue` skill "같은 이슈를 찾는다"가 겉 문구가 같아도 detail을 읽어 원인이 같은지 본 뒤 덧붙이라고 말한다.

## core main에서 전역 fetch로 자기 HTTP를 불러 problem을 보고했다

```yaml
kind: mistake
modules: [packages/core/problems, tools]
closed: fixed
guard: `tools/check-source_test.ts`(core main graph의 bare fetch는 check가 막는다)
```

지금: examples run 뒤 "증명 못 함" write tool을 problem으로 알리는 첫 구현이 `packages/core/problems/tests/control.ts`(core main process)에서 app credential을 발급해 `globalThis.fetch`로 core 자기 loopback의 `problemReport`를 불렀다. `proven`도 examples 증거가 아니라 예시 step의 tool 이름 전부였다. review에서 되돌려 보고는 runner child(`work/runner-service.ts`)가 주입받은 fetch로 하고 `proven`은 증거에서 읽게 했다.

영향: AGENTS.md "네트워크는 인자로 받는다"를 어긴 core main 코드가 check와 core 기동을 통과했다. 되돌리지 않았으면 test에서 바꿀 수 없는 network 호출과, 되돌리지 않은 write를 증명한 것으로 세는 알림이 남았다.

원인:
- brief가 증거(`unproven`, `proven`)를 observations blob에서 읽는다고 적었는데 그 blob에는 검사별 hash만 있다(진단이 저장 모양을 열어 보지 않았다). worker는 막힌 길을 우회했다.
- `packages/core/problems`의 주석 여럿이 "core graph의 EXTERNAL_FETCH tripwire가 bare fetch를 금지한다"고 하지만 그런 check는 없다. 잡을 장치가 있다고 믿게 한다.

막기:
- check: `packages/core`의 core main graph(child worker 진입점 밖)에서 `fetch(`와 `globalThis.fetch`를 막는다. 그 전까지 주석의 tripwire 말은 실제와 다르다.
- brief를 쓸 때 "읽을 것"의 data가 실제로 저장되는지 표나 blob 모양을 열어 본다(planner-persona).

닫음: `tools/check-source.ts`의 규칙 `EXTERNAL_FETCH`가 daemon 진입점(`packages/core/main/daemon/main.ts`)에서 닿는 graph의 bare `fetch(`와 `globalThis.fetch` 값 쓰기를 막는다. 예외 둘(`EXTERNAL_FETCH_LEFTOVERS`: app broker의 기본 transport, 연결 전 runtime tool port의 fetch)은 child process 쪽 인터넷 fetch 기본값이 barrel import로 graph에 든 것이다. 예외 file에서 위반이 없어지면 check가 표에서 빼라고 알린다.
