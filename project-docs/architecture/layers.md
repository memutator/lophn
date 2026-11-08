# layers

core 코드를 어떻게 나누고 어느 쪽으로만 기대게 하는지, 그 규칙이 무엇을 막는지를 다룬다. 다른 architecture 문서가 메커니즘 하나를 다룬다면, 이 문서는 그 메커니즘들이 올라앉은 바닥의 모양이다.

## 말

- **layer**: 기술 역할로 가로로 자른 층. 위가 아래를 쓰고 아래는 위를 모른다.
- **feature module**: 업무 능력으로 세로로 자른 조각(apps, projects, runs, workflows, jobs).
- **infrastructure**: 업무 규칙이 아닌 기술 수단. 저장, event 배달, HTTP server, process 관리. 운영에서 말하는 서버·클라우드 인프라와 다른 뜻이다.
- **port / adapter**: 안쪽이 필요한 것을 interface(port)로 정하고 바깥이 구현(adapter)한다. 안쪽은 바깥을 모른다.
- **composition root**: 모든 조각을 끼워 맞추는 곳. lophn에서는 `core/main/*`(daemon, worker 조립)이다.

## 모양

```
 core/main (composition root) ── 모두를 알고 조립만 한다. 업무 규칙을 두지 않는다
      │ 조립
      ▼
 apps    projects    runs    workflows    jobs    agent-workspaces   feature module / workspace 종류 층 (서로 모른다)
      │         │          │        │          │         │          │
      ▼         ▼          ▼        ▼          ▼         ▼          ▼
                    lophn-agent                          agent harness
                         │
                         ▼
 storage, events, server, supervision, secrets, ...      바닥 (infrastructure)

 packages/protocol: 경계 사이의 약속(type, schema, route, event). 모든 층이 쓴다
```

- 화살표 방향으로만 import한다. 거꾸로 가는 import가 문제다.
- feature module끼리는 import하지 않는다. 마지막 예외(problems → apps)는 test runner와 함께 없어졌다. release의 data 검사는 apps 안의 release 준비가 하고(`packages/core/apps/releases/prepare/checks.ts`), 앱 log와 예외 stack 풀이도 apps 안에 있다(`packages/core/apps/runtime/observations/`).
- `runs`는 lophn-agent와 다른 feature module을 import하지 않는다. agent 이름 풀기, 메시지 넣기, turn 읽기, 앱 tool 호출은 `runs/ports.ts`의 port이고 `core/main/daemon/wiring/runs.ts`가 끼운다(`architecture/run.md`).
- `workflows`도 lophn-agent와 다른 feature module을 import하지 않는다. 정의 file 읽기, project 이름 풀기, turn 멈추기와 읽기, flow process 띄우기와 멈추기(`WorkflowFlows`)는 `workflows/ports.ts`의 port이고 `core/main/daemon/wiring/workflows.ts`와 `workflows-files.ts`가 끼운다(`architecture/workflow.md`). flow process를 띄우는 host와 `workflow.check`는 runs와 apps(SDK 설치 사본)를 같이 알아야 해서 `core/main/flow-host/`에 두고 `core/main/daemon/wiring/flows.ts`가 끼운다.
- `jobs`도 lophn-agent와 다른 feature module을 import하지 않는다. agent·앱·project 이름 풀기와 시간대는 `jobs/ports.ts`의 port(`jobs.targets`, `jobs.zone`)이고 `core/main/daemon/wiring/jobs-registration.ts`가 꽂는다. scheduler가 run과 workflow instance를 시작하고 읽는 길(`runService`, `workflowService`, `ReadWorkflowInstance`)은 `core/main/daemon/wiring/jobs.ts`가 끼운다. 그래서 jobs의 규칙은 runs와 workflows의 표를 SQL로 읽지 않는다(`architecture/job.md`).
- lophn-agent는 feature module과 workspace 종류 층이 tool과 규칙을 꽂는 harness라 그들 아래에 둔다. workspace 종류의 규칙과 feature module의 route를 몰라야 하는 쪽이다.
- agent-workspaces는 lophn의 workspace 종류 층이다. workspace 종류별 tool 목록, 지침과 내장 skill, workspace 정보, workspace 규칙이 든 tool, credential의 workspace 몫을 갖는다. feature module과 같은 높이이고 서로 import하지 않는다.

## 실행 때 import가 뜻하는 것

Node는 실행할 때 tree shaking을 하지 않는다. 파일 하나를 import하면 그 파일이 import하는 것을 끝까지 따라가 모두 읽고 top-level 코드를 실행한다. `import type`만 지워진다.

core는 daemon main thread, writer·reader Worker, I/O child process(`platform/io`), agent runtime child process로 나뉘어 돈다. lophn 자신의 코드가 도는 process도, AI가 쓴 코드를 돌리는 앱·flow process도 권한을 막지 않는다(사람이 정했다). 그래도 import는 그 process에 무엇이 실리나를 정한다. 쓰지 않는 코드가 graph에 붙으면:

- 그 코드의 top-level이 파일·환경 변수를 읽거나 Worker에 없는 API를 쓰면 process가 시작부터 죽는다. type check가 못 잡는다.
- 상관없는 module을 고쳤는데 엉뚱한 process가 깨진다. 원인을 찾기 어렵다.
- graph가 클수록 순환 import가 생기고, 초기화 순서 때문에 값이 `undefined`로 보이는 버그가 난다.
- process마다 필요 없는 DB·파일 코드가 실린다.

## 규칙과 그 이유

**module은 `core/main`을 import하지 않는다.**
- 막는 것: main → module → main 순환. module을 싣는 Worker나 child process에 조립 코드 전체가 딸려 가는 것.
- 조립되는 쪽이 필요한 type이나 함수는 그것을 쓰는 module 쪽에 둔다.

**바닥은 위층(lophn-agent, agent-workspaces, feature module)을 import하지 않는다.**
- 막는 것: 모든 process가 딛는 바닥에 feature module이 딸려 가는 것. feature module을 고쳤는데 바닥이 깨지는 것.
- 바닥이 위층의 정보가 필요하면 wiring이 넘겨주거나 port로 받는다.

**lophn-agent는 agent-workspaces와 feature module을 import하지 않는다. agent-workspaces와 feature module은 서로 import하지 않는다. feature module끼리도 import하지 않는다.**
- 막는 것: harness가 꽂히는 쪽을 알게 되는 것(feature module이나 workspace 규칙을 더하고 뺄 때마다 harness를 고치게 된다). workspace 규칙과 feature module 구현이 엉키는 것. feature module 사이의 순환(하나만 떼어 이해하고 고칠 수 없다).
- 둘을 다 알아야 하는 일(feature module의 읽기 함수를 workspace 종류 층 규칙과 함께 harness에 꽂기)은 `core/main`이 한다. 예: reader·writer Worker가 싣는 팀 file `main/daemon/wiring/lophn-agent-team.ts`가 projects·apps의 lookups와 agent 이름 풀기를 `lophn-agent/register.ts`의 factory에 꽂는다.
- 처음 규칙은 "feature module끼리 import 금지"였다. test runner(problems)가 앱을 띄우려 apps를 import해 한때 problems → apps 한 방향을 허락했고, test runner를 지워 처음 규칙으로 돌아왔다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽게 바꾸지 않는다. 의존이 없어지지 않고 check가 못 보는 곳으로 숨는다. 못 끊으면 예외로 드러낸다.

## 두지 않는 규칙

**"다른 module은 `mod.ts`로만 import한다"는 두지 않는다.**
- `mod.ts`는 barrel이라 지나는 순간 그 module 전체가 실린다. 예: `storage/ledger/mod.ts`는 `sqlite.ts`(node:sqlite)를 싣는다. 함수 하나를 위해 정문을 쓰면 위 "실행 때 import"의 문제를 스스로 만든다.
- 이 규칙이 아껴 주는 것은 안쪽 파일 이름이 바뀔 때 바깥 import를 고치는 수고다. 그 깨짐은 type check가 100% 잡고 고치기는 기계적이다.
- 검증할 수 있고 싼 비용(옆문 import가 깨짐)을 받고, 검증하기 어렵고 비싼 비용(쓸데없이 실림)을 피한다.

## harness와 lophn feature module

기준은 "lophn이 무엇을 하는 제품인지 알아야 하나"다. 알아야 하면 harness 밖에 둔다.

| 성격 | 자리 | 예 |
|---|---|---|
| 장치 | `lophn-agent` (harness) | agent loop, tool registry·schema 검사·Gate 연결(`packages/core/lophn-agent/tools/registry.ts`, `packages/core/lophn-agent/tools/spi.ts`), prompt 조립 틀(층, 예산, cache marker), provider·model 호출 |
| 범용 능력 | `lophn-agent` (harness) | file, shell, web, call, ask, MCP, skill tool |
| feature module tool | 각 feature module | `apps/agent-tools/`(app, 앱 진단 읽기 `runtime.ts`, package, release, preview, visual), `workflows/agent-tools.ts`(workflow.list·get·report·edit·check), `jobs/agent-tools.ts`(job.create·update·delete·list) |
| workspace 종류 층 | `agent-workspaces` | workspace 종류별 tool 순서(`tool-lists.ts`의 `TOOL_ORDER`. 목록 자체는 `packages/protocol/lophn-agent/tool-lists.ts`), workspace 규칙이 든 tool(settings, instructions, agent, kind), credential의 workspace 몫(`credentials.ts`), 제품 고정 규칙과 workspace 종류 지침(`prompts/`), workspace 정보(`workspace/`), file tool hook(`hooks.ts`의 `LOPHN.md` Gate와 rewind 기록), workspace 폴더 규칙(`workspace/workspace-folders.ts`), data root 아래 자리와 memory 파일 자리(`workspace/data-folder.ts`의 `workspaceMemoryFile`, `agentMemoryFile`), Home·project·앱 설정 층(`workspace/project-layer.ts`), 지침 읽기 규칙, session 이름 풀기, 내장 skill(`skills/`) |

- harness는 tool을 등록받은 목록으로만 안다. `core/main/agent-tools.ts`가 범용·feature module·workspace 종류 층의 tool 정의를 모아 `TOOL_ORDER` 순서로 넘기고, workspace 종류 목록·prompt·workspace 재료·credential 상한도 조립이 그 층에서 꽂는다.
- tool 정의 file은 agent runtime child에서 실린다(위 "실행 때 import가 뜻하는 것"). 그래서 protocol(route, schema), base, `lophn-agent/tools/spi.ts`만 import하고 handler는 `ctx.core`로 core route를 부른다. feature module의 store·DB 코드를 끌어오면 agent runtime에 sqlite가 딸려 간다.
- tool 정의는 handler가 부르는 route를 `routes`에 적는다. agent credential의 상한은 그 route 이름이다(core는 route 이름으로 대조한다. tool 이름이 아니다).
- 범용 tool 안의 lophn 규칙은 hook으로 뺀다. file tool의 `LOPHN.md` 쓰기 Gate와 rewind pre-image는 `FileHooks`로 workspace 종류 층이 채운다. workspace 폴더 가두기는 그 층이 채운 `ToolContext.scope`로만 판정한다.
- feature module tool 하나를 더할 때 고치는 곳: 그 module의 `agent-tools`와 protocol의 route, `packages/protocol/lophn-agent/tool-lists.ts`의 workspace 종류 목록과 `agent-workspaces/tool-lists.ts`의 `TOOL_ORDER`에 한 줄씩.
- workspace 종류마다 다른 값과 규칙은 harness가 type만 갖고(`workspaces/ports.ts`의 `WorkspaceNameRules`, `extensions/project-settings.ts`의 `ProjectLayer`) 값은 workspace 종류 층이 낸다. 조립(`main/daemon/wiring/lophn-agent-team.ts`, `instructions-registration.ts`, `lophn-agent-registration.ts`, `main/agent-runtime/product-driver.ts`)이 꽂는다. agent와 workspace의 순수 값(`AgentId`, `AgentAtWorkspace`, `workspaceKindOf`, workspace마다 하나인 lophn의 id를 푸는 `lophnIdOf`·`isLophn`·`workspaceOfLophn`)은 `protocol/lophn-agent/workspaces.ts`에 둔다.
- 아직 harness 폴더에 feature module의 protocol import가 남은 file이 7개 있다(동적 앱 tool, `packages/core/lophn-agent/run-loop/runtime-access.ts`, file tool 일부). `tools/check-deps.ts`의 `HARNESS_LEFTOVERS`가 file마다 이유와 함께 목록으로 두고(rule `harness-domain`, 대상 protocol 이름은 `HARNESS_FEATURE_PROTOCOLS`) 새 위반만 막는다. 목록의 file이 위반을 다 없애면 check가 빼라고 알린다. `extensions/`처럼 import도 workspace 종류 이름도 없이 workspace 종류 규칙을 다시 짜는 곳은 check가 못 보므로 path·층 규칙은 workspace 종류 층 값을 받아 쓴다.
- feature module tool 정의 file(`apps/agent-tools/**`)은 base, protocol, 같은 폴더, `lophn-agent/tools/spi.ts`만 import한다(rule `tool-file`).
- core는 `packages/cli` 가운데 명령 표(`packages/cli/commands/`)와 `packages/cli/parser.ts`·`packages/cli/help.ts`만 import한다. binary 입구(`packages/cli/main.ts`), core client(`packages/cli/connection/`), 출력은 agent runtime에 node 전용 code와 HTTP client를 싣지 않으려고 막는다(rule `cli-surface`).
