# agent-tools-shell-web

`shell.run`, `web.search`, `web.fetch` tool을 짓고, agent runtime process의 Deno 권한 계산을 place 폴더로 넓힌다. shell 명령은 lophn token과 secret이 없는 환경으로 띄운다. web 결과만 `<lophn-untrusted>`로 감싼다.

- 단위: agent-tools (wave 3)
- 선행:
  - agent-tools-registry (`ToolDefinition`, `ToolContext`, 껍데기 `bundles/shell.ts`·`bundles/web.ts`)
  - agent-definition-input-tags (web 결과를 감싸는 `wrapUntrusted`를 import한다)
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/bundles/shell.ts`, `bundles/web.ts`
  - `packages/core/lophn-agent/tools/shell/` (새 폴더: `env.ts`, `run.ts`)
  - `packages/core/lophn-agent/tools/web/` (새 폴더: `target.ts`, `fetch.ts`, `search.ts`)
  - `packages/core/lophn-agent/tools/runtime-permissions.ts` (새로)
  - `packages/core/main/agent-runtime/` (`credential-link.ts`, `secret-link.ts`, `main.ts`, `product-driver.ts`, `core-http.ts`, `mcp-auth-pump.ts`, `redact.ts`)
- 읽을 것:
  - spec: S4 3장(shell, web search·fetch), 6장 "tool 결과" 표, 10장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - 조사: `/home/pyosechang/projects/lophn/project-docs/tmp/research/sandbox-harnesses.md`
  - inventory: `I3.4#6`, `I3.4#7`, `I2.11#19`
  - 결정: `../README.md` 3장 #3, #5
  - 지금 코드: `packages/core/lophn-agent/register.ts`의 `agentRuntimeLaunchSpec`(213줄 부근. 수정은 agent-definition-register가 이 task의 함수를 불러서 한다), `packages/core/supervision/security/launch-spec.ts`, `packages/core/main/agent-runtime/credential-link.ts`
- 계약:
  - 쓰는 것: `ToolContext`(agent-tools-registry), `wrapUntrusted`(agent-definition-input-tags, `prompt-assembly/mod.ts`), `protocol/lophn-agent/tool-catalog.ts`의 `TOOL_INPUTS`와 `UNTRUSTED_SOURCES`(contract-agent-tools-catalog)
  - 내놓는 것: `SHELL_TOOLS`, `WEB_TOOLS`, `agentRuntimePermissions(input)`(register.ts가 부른다), 순수 함수 `shellEnvironment(parentEnv)`와 `checkFetchTarget(url)`

## 할 일

1. `shell/env.ts` (`I3.4#6`): `shellEnvironment(parentEnv)`는 허용 목록 변수만 돌려준다: `PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `TERM`, `TMPDIR`, `SHELL`. 목록에 든 이름만 나가고, 목록에는 `LOPHN_`로 시작하는 이름과 token·secret·key 성격의 이름이 없다. 부모 환경 전체(`Deno.env.toObject()`)를 넘기지 않는다.
2. `shell/run.ts`: `shell.run`은 `Deno.Command("/bin/sh", ["-c", command])`를 `clearEnv: true`, `env: shellEnvironment(...)`, `cwd`는 place의 첫 폴더로 띄운다. OS sandbox도 묻기도 없다. 시간 상한(기본 120초, 최대 600초, `timeout_ms`)이 지나면 process group을 죽이고 `unavailable`이 아닌 "시간 초과" 결과를 돌려준다. stdout·stderr는 각각 1 MiB까지 담고 넘으면 잘렸다고 표시한다. 결과는 감싸지 않는다(S4 6장). shell이 바꾼 파일은 rewind에 기록하지 않는다.
3. `web/target.ts`: `checkFetchTarget(url)`은 `http`, `https`가 아니거나 loopback(`localhost`, `127.0.0.0/8`, `::1`), 사설(`10/8`, `172.16/12`, `192.168/16`), link-local(`169.254/16`, `fe80::/10`) 주소 literal이면 거절한다. 순수 함수다.
4. `web/fetch.ts`: `web.fetch`는 `checkFetchTarget`을 통과한 url만 `ToolContext.fetch`로 읽는다. redirect는 직접 따라가며 hop마다 `checkFetchTarget`을 다시 본다(최대 5번). 본문은 text로 바꾸고 상한(256 KiB)을 넘으면 잘렸다고 표시한다. 결과는 `wrapUntrusted("web.fetch", text)`로 감싼다.
5. `web/search.ts`: `web.search`는 key 없이 쓸 수 있는 검색 endpoint 하나를 `ToolContext.fetch`로 불러 상위 결과(제목, url, 요약 10개 이하)를 얻고 `wrapUntrusted("web.search", ...)`로 감싼다. endpoint는 이 file 한 곳에만 둔다. 어떤 endpoint를 골랐는지 보고에 적는다.
6. `bundles/shell.ts`, `bundles/web.ts`: tool을 `defineBuiltin`으로 정의한다. shell과 web의 effect는 `read`로 둔다(Gate를 거치지 않는다. README 3장 #3). 입력 schema는 `TOOL_INPUTS`에서 온다.
7. `runtime-permissions.ts` (`I2.4#39`의 계산 부분): 순수 함수 `agentRuntimePermissions(input)`이 `allow_read`, `allow_write`, `allow_net`, `allow_run`, `allow_env`를 돌려준다. 입력은 지금 `agentRuntimeLaunchSpec`의 입력에 `placeFolders: { read: string[]; write: string[] }`를 더한 것이다.
   - `allow_read`에 data root, skill 폴더, 앱 socket 외에 `placeFolders.read`를 더한다.
   - `allow_write`는 `derived/lophn-agent`, 앱 socket, `placeFolders.write`뿐이다. data root 전체나 ledger, blob 폴더는 쓰기에 넣지 않는다.
   - `allow_run`에 MCP stdio 실행 파일과 `/bin/sh`를 둔다.
   - `allow_env`는 지금 여섯 이름에 `shellEnvironment`가 읽는 이름만 더한다.
   - `allow_net`: 지금 것을 그대로 둔다. `web.fetch`가 임의 host로 나가려면 launch spec이 "모든 host"를 표현해야 하는데 지금 `protocol/supervision/supervision.ts`의 `allow_net`과 `launch-spec.ts`는 wildcard를 막는다. 이 task는 그 둘을 고치지 않고 보고의 "계약 바꾸기 요청"에 적는다.
8. `core/main/agent-runtime/` (`I2.11#19`): child가 core 자격을 argv나 env로 받지 않는지 `credential-link.ts`와 `launchArgv`를 읽어 확인한다. 이미 hello frame으로만 받으면 바꾸지 않는다. shell 환경이 부모 env를 통째로 넘기는 곳이 이 폴더에 있으면 1번의 함수를 쓰게 고친다. runtime이 새 tool 정의를 쓰도록 `product-driver.ts`·`main.ts`의 연결이 깨진 곳이 있으면 고친다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test (순수 함수 표 test 둘. subprocess는 띄우지 않는다):
  - "shell 환경에 lophn token과 secret이 나가지 않는다" — `shell/env_test.ts`가 `LOPHN_CODING_TOKEN`, `LOPHN_HOME`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`을 넣은 부모 env로 `shellEnvironment`를 불러 허용 목록 밖 변수가 하나도 안 나오는지 본다.
  - "web.fetch는 loopback과 사설 주소로 나가지 않는다" — `web/target_test.ts`가 허용·거절 주소를 표로 돌린다. 같은 file에서 `agentRuntimePermissions`의 `allow_write`에 data root가 들지 않는 것도 한 줄 본다.
- 남지 않음: `grep -rn "FORBIDDEN_TOOL_NAMES" packages` 가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음. `agentRuntimeLaunchSpec`이 `agentRuntimePermissions`를 부르는 변경은 agent-definition-register가 한다. `run-loop/runtime.ts`가 `placeFolders`를 넘기는 변경은 router가 한다(보고에 호출 모양을 적는다).
- 안 쓰게 된 export: 없음
- 정한 것: 검색 endpoint, shell env 허용 목록, 시간·출력 상한, redirect 상한, `checkFetchTarget`의 금지 대역
- 계약 바꾸기 요청: launch spec이 모든 host를 허용하는 표현(`protocol/supervision/supervision.ts`의 `allow_net`, `core/supervision/security/launch-spec.ts`). 추천: `kindLaunchSpecSchema`에 `net_any?: boolean`을 더하고 `launchArgv`가 `--allow-net`(값 없이)을 내게 하며 `checkLaunchSpec`는 kind가 `lophn-agent/runtime`일 때만 받는다.
