# layers

core 코드를 어떻게 나누고 어느 쪽으로만 기대게 하는지, 그 규칙이 무엇을 막는지를 다룬다. 다른 architecture 문서가 메커니즘 하나를 다룬다면, 이 문서는 그 메커니즘들이 올라앉은 바닥의 모양이다.

## 말

- **layer**: 기술 역할로 가로로 자른 층. 위가 아래를 쓰고 아래는 위를 모른다.
- **domain module**: 업무 능력으로 세로로 자른 조각(apps, projects, problems).
- **infrastructure**: 업무 규칙이 아닌 기술 수단. 저장, event 배달, HTTP server, process 관리. 운영에서 말하는 서버·클라우드 인프라와 다른 뜻이다.
- **port / adapter**: 안쪽이 필요한 것을 interface(port)로 정하고 바깥이 구현(adapter)한다. 안쪽은 바깥을 모른다.
- **composition root**: 모든 조각을 끼워 맞추는 곳. lophn에서는 `core/main/*`(daemon, worker 조립)이다.

## 모양

```
 core/main (composition root) ── 모두를 알고 조립만 한다. 업무 규칙을 두지 않는다
      │ 조립
      ▼
 problems ──▶ apps     projects      agent-roles         domain / lophn role 층 (서로 모른다)
      │         │          │              │
      ▼         ▼          ▼              ▼
                    lophn-agent                          agent harness
                         │
                         ▼
 storage, events, server, supervision, secrets, ...      바닥 (infrastructure)

 packages/protocol: 경계 사이의 약속(type, schema, route, event). 모든 층이 쓴다
```

- 화살표 방향으로만 import한다. 거꾸로 가는 import가 문제다.
- domain끼리는 problems → apps 하나만 있다. problem은 "앱의 문제"라 앱을 띄우고 읽어야 한다.
- lophn-agent는 domain과 role 층이 tool과 규칙을 꽂는 harness라 그들 아래에 둔다. role 이름, place 종류, domain route를 몰라야 하는 쪽이다.
- agent-roles는 lophn의 role 층이다. role, role별 tool 목록, role prompt와 guide, place 정보, role 규칙이 든 tool, credential의 role 몫을 갖는다. domain과 같은 높이이고 서로 import하지 않는다.

## 실행 때 import가 뜻하는 것

Deno는 실행할 때 tree shaking을 하지 않는다. 파일 하나를 import하면 그 파일이 import하는 것을 끝까지 따라가 모두 읽고 top-level 코드를 실행한다. `import type`만 지워진다.

core는 daemon main thread, writer·reader Worker, I/O Worker, agent runtime child process로 나뉘어 돌고 process마다 Deno 권한을 좁혀 띄운다. 그래서 import는 type 의존일 뿐 아니라 "이 process에 무엇이 실리나"를 정한다. 쓰지 않는 코드가 graph에 붙으면:

- 그 코드의 top-level이 권한 밖 일(환경 변수, 파일)을 하거나 Worker에 없는 API를 쓰면 process가 시작부터 죽는다. type check가 못 잡는다.
- 상관없는 module을 고쳤는데 엉뚱한 process가 깨진다. 원인을 찾기 어렵다.
- graph가 클수록 순환 import가 생기고, 초기화 순서 때문에 값이 `undefined`로 보이는 버그가 난다.
- 권한을 좁힌 process가 필요 없는 DB·파일 코드를 갖게 된다.

## 규칙과 그 이유

**module은 `core/main`을 import하지 않는다.**
- 막는 것: main → module → main 순환. module을 싣는 Worker나 child process에 조립 코드 전체가 딸려 가는 것.
- 조립되는 쪽이 필요한 type이나 함수는 그것을 쓰는 module 쪽에 둔다.

**바닥은 위층(lophn-agent, agent-roles, domain)을 import하지 않는다.**
- 막는 것: 모든 process가 딛는 바닥에 domain이 딸려 가는 것. domain을 고쳤는데 바닥이 깨지는 것.
- 바닥이 위층의 정보가 필요하면 wiring이 넘겨주거나 port로 받는다.

**lophn-agent는 agent-roles와 domain을 import하지 않는다. agent-roles와 domain은 서로 import하지 않는다. domain끼리는 problems → apps만.**
- 막는 것: harness가 꽂히는 쪽을 알게 되는 것(domain이나 role을 더하고 뺄 때마다 harness를 고치게 된다). role 규칙과 domain 구현이 엉키는 것. domain 사이의 순환(하나만 떼어 이해하고 고칠 수 없다).
- 둘을 다 알아야 하는 일(domain의 읽기 함수를 role 층 규칙과 함께 harness에 꽂기)은 `core/main`이 한다. 예: reader·writer Worker가 싣는 팀 file `main/daemon/wiring/lophn-agent-team.ts`가 projects·apps의 lookups와 role 명령, Operator place 규칙을 `lophn-agent/register.ts`의 factory에 꽂는다.
- 처음 규칙은 "domain끼리 import 금지"였다. 한 방향 의존은 해가 없고 problems → apps는 자연스러워 방향 규칙으로 바꿨다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽게 바꾸지 않는다. 의존이 없어지지 않고 check가 못 보는 곳으로 숨는다. 못 끊으면 예외로 드러낸다.

## 두지 않는 규칙

**"다른 module은 `mod.ts`로만 import한다"는 두지 않는다.**
- `mod.ts`는 barrel이라 지나는 순간 그 module 전체가 실린다. 예: `storage/ledger/mod.ts`는 `sqlite.ts`(node:sqlite)를 싣는다. 함수 하나를 위해 정문을 쓰면 위 "실행 때 import"의 문제를 스스로 만든다.
- 이 규칙이 아껴 주는 것은 안쪽 파일 이름이 바뀔 때 바깥 import를 고치는 수고다. 그 깨짐은 type check가 100% 잡고 고치기는 기계적이다.
- 검증할 수 있고 싼 비용(옆문 import가 깨짐)을 받고, 검증하기 어렵고 비싼 비용(쓸데없이 실림)을 피한다.

## harness와 lophn domain

기준은 "lophn이 무엇을 하는 제품인지 알아야 하나"다. 알아야 하면 harness 밖에 둔다.

| 성격 | 자리 | 예 |
|---|---|---|
| 장치 | `lophn-agent` (harness) | agent loop, tool registry·schema 검사·Gate 연결(`packages/core/lophn-agent/tools/registry.ts`, `packages/core/lophn-agent/tools/spi.ts`), prompt 조립 틀(층, 예산, cache marker), provider·model 호출 |
| 범용 능력 | `lophn-agent` (harness) | file, shell, web, call, ask, MCP, skill tool |
| domain tool | 각 domain | `apps/agent-tools/`(ticket, app, package, release, visual), `problems/agent-tools.ts` |
| lophn role 층 | `agent-roles` | role별 tool 목록과 순서(`tool-lists.ts`), role 규칙이 든 tool(guide, settings, instructions, operator, kind), credential의 role 몫(`credentials.ts`), role prompt·guide(`roles/`), place 정보(`place/`), role 명령, file tool hook(`hooks.ts`의 `LOPHN.md` Gate와 rewind 기록), role 표(`agents/role-table.ts`: built-in 이름·기본 profile·정의 file 자리), Operator 조회, place 폴더 규칙(`place/place-folders.ts`), data root 아래 자리(`place/data-folder.ts`)와 project 설정 층(`place/project-layer.ts`), 지침 읽기 규칙, session 이름 풀기, 내장 skill(`skills/`) |

- harness는 tool을 등록받은 목록으로만 안다. `core/main/agent-tools.ts`가 범용·domain·role 층의 tool 정의를 모아 `TOOL_ORDER` 순서로 넘기고, role 목록·prompt·place 재료·credential 상한도 조립이 role 층에서 꽂는다.
- tool 정의 file은 agent runtime child에서 실린다(위 "실행 때 import가 뜻하는 것"). 그래서 protocol(route, schema), base, `lophn-agent/tools/spi.ts`만 import하고 handler는 `ctx.core`로 core route를 부른다. domain의 store·DB 코드를 끌어오면 agent runtime에 sqlite가 딸려 간다.
- tool 정의는 handler가 부르는 route를 `routes`에 적는다. agent credential의 상한은 그 route 이름이다(core는 route 이름으로 대조한다. tool 이름이 아니다).
- 범용 tool 안의 lophn 규칙은 hook으로 뺀다. file tool의 `LOPHN.md` 쓰기 Gate와 rewind pre-image는 `FileHooks`로 role 층이 채운다. place 폴더 가두기는 role 층이 채운 `ToolContext.scope`로만 판정한다.
- domain tool 하나를 더할 때 고치는 곳: 그 domain의 `agent-tools`와 protocol의 route, role 층 `tool-lists.ts`의 role 목록과 `TOOL_ORDER`에 한 줄씩.
- role마다 다른 값과 규칙은 harness가 type만 갖고(`lophn-agent/agents/role-table.ts`의 `AgentRoleTable`, `places/ports.ts`의 `PlaceRoleRules`, `extensions/project-settings.ts`의 `ProjectLayer`) 값은 role 층이 낸다. 조립(`main/daemon/wiring/lophn-agent-team.ts`, `instructions-registration.ts`, `lophn-agent-registration.ts`, `main/agent-runtime/product-driver.ts`)이 꽂는다. role과 ref·session 행을 오가는 순수 변환(`placeOfAgentRef`, `agentRefOfColumns`, `agentIdentityOf`)은 role 정체성을 이미 가진 `protocol/lophn-agent/places.ts`에 둔다.
- 아직 harness 폴더에 domain protocol import가 남은 file이 9개 있다(동적 app-api tool, `packages/core/lophn-agent/run-loop/runtime-access.ts`, `packages/core/lophn-agent/tools/runtime-permissions.ts`, call·file tool 일부). `tools/check-deps.ts`의 `HARNESS_LEFTOVERS`가 file마다 이유와 함께 목록으로 두고(rule `harness-domain`) 새 위반만 막는다. 목록의 file이 위반을 다 없애면 check가 빼라고 알린다. `extensions/`처럼 import도 role 이름도 없이 role 규칙을 다시 짜는 곳은 check가 못 보므로 path·층 규칙은 role 층 값을 받아 쓴다.
- domain tool 정의 file(`apps/agent-tools/**`, `problems/agent-tools.ts`)은 base, protocol, 같은 폴더, `lophn-agent/tools/spi.ts`만 import하고, `agent-roles/tools/**`는 storage·store·ledger·register와 `node:sqlite`를 import하지 않는다(rule `tool-file`).
