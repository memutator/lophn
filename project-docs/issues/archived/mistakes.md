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

## worker가 screenshot용으로 띄운 server와 monitor를 끄지 못한 채 보고함

```yaml
kind: mistake
modules: [tools]
closed: fixed
guard: 없음
```

지금: 계획 `workflow`에서 두 worker가 자기가 띄운 process를 남긴 채 보고했다. 한 worker는 gallery 확인 뒤 `tail -f` monitor 둘을 남겼다가 lead가 다시 시키자 껐다. 다른 worker는 gallery screenshot을 찍으려고 worktree에서 `python3 -m http.server 8741 -d tools/wireframes`를 띄웠는데, PID를 적지 않았고 Bash 호출이 돌아온 뒤에는 끌 길이 없다고 보고했다. ps·fuser·pkill이 금지라서다. 결국 lead가 port, cmdline, cwd로 그 process 하나를 확인하고 PID로 껐다. 세 번째 worker는 screenshot server(`http.server 8765`)를 "껐다"고 보고했지만 남아 있었고, merge.sh가 worktree를 지운 뒤에도 지운 `dist`를 붙잡고 port를 막았다. 다음 worker가 그 port에서 남의 옛 gallery를 찍어 버렸다. lead가 같은 방법으로 껐다. `project-docs/issues/archived/mistakes.md`의 "core를 subshell로 띄워 `$!`가 deno를 가리키지 않음"과 같은 종류다. 그때는 core 기동만 script(`lead/boot.sh`)로 주었다.

영향: 남은 server가 port를 잡아 다음 worker가 다른 port를 찾아야 하고(이번에도 8731이 이미 잡혀 있었다), merge.sh가 worktree를 지운 뒤에도 server가 지운 폴더를 붙잡고 남는다. 찾아 끄려다 남의 process를 끌 위험이 다시 생긴다.

원인: `project-docs/plan/tools/lead/prompt.py`의 worker 지시문은 "띄운 process(예: screenshot용 `http.server`)는 보고 전에 끈다"고만 말한다. 띄우는 법을 주지 않아 worker마다 `&`나 background Bash로 띄우고 끄는 손잡이를 잃는다. gallery를 띄워 보라는 brief(`ui-design` skill과 화면 task brief의 "둘러보기")가 서버를 손으로 띄우게 한다.

막기(추천): core 기동과 같이 script로 준다. `lead/gallery.sh`가 `deno task wireframes` 뒤 `timeout`으로 끝나는 `http.server`를 빈 port에 띄우고 URL을 찍는다. headless screenshot도 그 script 안에서 찍고 끝나면 server가 저절로 끝나게 한다. `prompt.py`와 `ui-design` skill의 둘러보기 줄이 이 script만 쓰게 한다.

닫음: worker 지시문(`project-docs/plan/tools/lead/prompt.py`)과 `ui-design` skill의 "보기"가 gallery server를 `timeout 900 python3 -m http.server 0 -d tools/wireframes`로만 띄우게 한다. port 0이 빈 port를 고르고 15분 뒤 저절로 끝나므로 손잡이를 잃어도 남지 않는다. monitor 같은 다른 오래 도는 process도 `timeout` 아래에서 띄운다. 추천안의 `lead/gallery.sh` script 대신 이 한 줄로 줄였다(같은 효과, file이 늘지 않는다).

## 이름 바꾸기가 type 없이 오가는 wire 칸을 놓쳤다

```yaml
kind: mistake
modules: [tools, packages/core/apps, packages/shell/main]
closed: fixed
guard: 없음
```

지금: protocol 칸 이름을 바꾸는 task(`declarations` → `facts`, `blueprint` → `declaration`)가 type check가 안내한 곳만 고치고, type 없이 칸을 쓰거나 읽는 곳 둘을 놓쳤다. check:full, core 기동, lead review를 다 지났다.
- shell `packages/shell/main/app-frame/app-connection.ts`의 `declaredHosts`가 `read apps/tools` 응답을 `record(value?.declarations)`로 읽었다. 늘 `undefined`라 선언한 net host 집합을 못 얻는다. lead review가 찾았다.
- core `packages/core/apps/control.ts`가 `deps.activation.command(machine, { command: releaseRecord.name, input: {...} })`로 `release.record`에 옛 칸 `blueprint`를 보냈다. envelope의 `input`은 type이 없고 protocol 입력은 strict object라 release 기록이 늘 `invalid_input`이 된다. lead review도 못 보고, 같은 file의 지역 이름을 고치던 다음 wave worker가 찾았다.

원인: worker 지침(`project-docs/plan/tools/lead/prompt.py`, orchestrate skill의 "worker에게 꼭 넣을 것")은 route를 지우거나 바꿀 때 method 문자열을 grep하라고만 한다. 칸 이름도 type 없는 길(command envelope의 `input`, `link.read`·`call`의 응답, SQL 열)로 오간다는 말이 없다.

막기: `prompt.py`의 grep 문장에 "protocol 입력·출력의 칸 이름을 바꾸면 `<칸>:`과 `.<칸>`도 문자열로 grep한다. command envelope의 `input`과 `link.read`·`call` 응답은 type이 없다"를 더한다(이 변경에서 더했다). 다시 생기면 command envelope `input`을 그 command의 입력 type으로 묶는다.

닫음: `prompt.py`와 orchestrate skill에 위 grep 문장을 더했다. 한 번이라 문장으로 막는다. 다시 생기면 command envelope `input`을 그 command의 입력 type으로 묶는다.

## planner가 package 안 md를 고치고 빠른 check만 돌려 main의 fmt를 깨뜨렸다

```yaml
kind: mistake
modules: [tools]
closed: fixed
guard: tools/check.ts
```

지금: planner가 App Engineer prompt(`packages/core/agent-roles/roles/app-engineer/prompt.md`)를 고치고 `deno task check`만 돌려 commit했다. 다음 계획의 merge에서 `check:full`의 fmt가 떨어졌다. 빠른 check의 fmt는 package의 `.ts`·`.tsx`·`.js`·`.json`만 넘겨서, package 안 `deno.json`이 fmt하는 `.md`는 full만 봤다. 문서 fmt로 main이 깨진 것은 두 번째다(orchestrate skill "겪은 함정"에 "check:full을 돈다"는 문장이 있었다).

영향: 다음 lead가 merge 중에 남의 fmt를 고치는 commit을 따로 만들어야 했다.

원인: 빠른 check와 full check가 fmt할 file을 다르게 골랐다. 문장만으로는 막히지 않았다.

닫음: `tools/check.ts`의 빠른 fmt가 바뀐 package의 `.md`도 넘긴다. config가 md를 빼는 package에서는 deno fmt가 건너뛴다. prompt에 너무 긴 줄을 넣어 빠른 check가 fmt 실패로 잡는 것을 확인했다.

## orchestrate skill대로 wave마다 land하면 계획이 land 대기에 묶인다

```yaml
kind: mistake
modules: [tools]
closed: fixed
guard: 없음
```

지금: orchestrate skill의 "merge" 절과 `project-docs/plan/tools/lead/land.sh` 머리 주석이 "wave가 모두 merged면 land"로 정한다. land는 lock을 잡고 main 위로 rebase하고, `check:full`, e2e 전체, core 두 번 기동을 거친 뒤 main을 fast-forward한다. workspace-layers는 wave가 넷이고 wave 2·3·4가 task 하나씩이라, task 하나마다 land가 붙는다. land가 도는 동안 lead는 plan branch에 commit할 수 없고, launch.sh가 status를 바꾸므로 다음 wave도 띄우지 않고 기다린다. wave 1 land는 네 번 돌았다.
- 첫 번째: 다른 session이 main에 더한 의존성(`@xterm/addon-unicode11`) 때문에 lead worktree의 `node_modules`가 낡아 wireframes smoke에서 멈췄다.
- 두 번째: `npm ci` 뒤 다시 돌렸는데 e2e 한 줄(옛 lophn id 기대값)에서 멈췄다.
- 세 번째: 그 줄을 고친 뒤 다시 돌렸다.
- 네 번째: 세 번째 land가 e2e와 기동까지 통과한 뒤 main fast-forward 직전에 다른 session이 main에 terminal 코드를 올려 `STOP: land 사이 main에 코드가 바뀌었다`로 멈췄다. 처음부터(`check:full`, e2e 약 7분) 다시 돌아 올라갔다.

영향: 사람의 시간. 계획 하나의 대부분이 land와 그 대기로 간다. lock 때문에 다른 계획의 land와도 줄을 선다. 사람이 "왜 wave마다 그 긴 과정을 거치나"라고 물어 드러났다.

원인: skill이 land 때를 wave로만 정했다. wave가 차례로만 이어지고 wave마다 task가 하나인 계획에도 같은 규칙이 걸린다. 중간 land의 값(main과 일찍 맞추기, e2e 실패를 좁히기)과 비용을 견주는 기준이 없다. land.sh는 rebase 뒤 의존성이 바뀌어도 `npm ci`를 하지 않는다.

막기:
- orchestrate skill과 land.sh 주석을 바꾼다. land는 계획 끝에 한 번이 기본이다. 중간 land는 다음 셋 가운데 하나일 때만 한다. 이번 계획은 wave 1(migration)만 land하고 나머지는 `wui` 뒤에 한 번 land한다.
  - 사람의 data root 모양을 바꾸는 migration이 든 wave
  - main에서 같은 file을 고치는 다른 계획이나 session이 있을 때
  - plan branch가 오래 열려 rebase가 커질 때
- e2e는 land에서만 돌므로, land를 미루면 e2e 실패가 늦게 드러난다. 그 대신 protocol 이름이나 id 꼴을 바꾼 task의 brief "남지 않음" grep에 `tests/`를 넣는다. 이번 실패는 brief grep이 `packages tools`만 봐서 `tests/e2e`의 옛 문자열 기대값을 놓친 것이다.
- land.sh가 rebase 뒤 `package-lock.json`이 바뀌었으면 `npm ci`를 돌린다.
- land 사이 main에 코드가 바뀌면 처음부터 다시 도는 대신, 새 rebase 뒤 바뀐 package만 빠른 check로 보고 e2e는 바뀐 쪽이 e2e에 닿을 때만 다시 돈다. main에 자주 올리는 session이 있으면 지금 규칙으로는 land가 끝나지 않을 수 있다.

닫음: orchestrate skill "merge"가 land를 계획 끝 한 번으로 두고 중간 land의 세 조건을 적는다. brief-template의 "남지 않음" grep이 `tests/`를 본다. `land.sh`가 rebase 뒤 `package-lock.json`이 바뀌었으면 `npm ci`를 돌고, land 사이 main이 움직이면 처음부터 다시 돌지 않고 다시 rebase와 빠른 check 뒤 e2e에 닿는 변경일 때만 e2e와 기동을 다시 돈다. 문장과 script로 막았다. 다시 wave마다 land하면 `land.sh`가 계획 README의 중간 land 표시를 확인하게 한다.
