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
 problems ──▶ apps        projects                      domain
      │         │             │
      ▼         ▼             ▼
            lophn-agent                                  agent harness (아래층 취급)
                 │
                 ▼
 storage, events, server, supervision, secrets, ...      바닥 (infrastructure)

 packages/protocol: 경계 사이의 약속(type, schema, route, event). 모든 층이 쓴다
```

- 화살표 방향으로만 import한다. 거꾸로 가는 import가 문제다.
- domain끼리는 problems → apps 하나만 있다. problem은 "앱의 문제"라 앱을 띄우고 읽어야 한다.
- lophn-agent는 이름은 domain module이지만 domain들이 tool을 꽂는 플랫폼이라 그들 아래에 둔다.

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

**바닥은 위층(lophn-agent, domain)을 import하지 않는다.**
- 막는 것: 모든 process가 딛는 바닥에 domain이 딸려 가는 것. domain을 고쳤는데 바닥이 깨지는 것.
- 바닥이 위층의 정보가 필요하면 wiring이 넘겨주거나 port로 받는다.

**lophn-agent는 domain을 import하지 않는다. domain끼리는 problems → apps만.**
- 막는 것: 플랫폼이 꽂히는 쪽을 알게 되는 것(domain을 더하고 뺄 때마다 harness를 고치게 된다). domain 사이의 순환(하나만 떼어 이해하고 고칠 수 없다).
- 처음 규칙은 "domain끼리 import 금지"였다. 한 방향 의존은 해가 없고 problems → apps는 자연스러워 방향 규칙으로 바꿨다.
- 아직 못 끊은 예외 둘을 `tools/check-deps.ts`가 이름으로 허용한다. harness와 domain을 나눌 때 다시 본다.
  - projects → apps: writer·reader Worker가 직접 여는 `projects/contexts/ledger/deps.ts`가 app-api의 effect를 알려고 releases store를 읽는다. wiring이 값을 넘길 길이 없다.
  - lophn-agent → projects: agent lookup이 context 상태를 읽는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽게 바꾸지 않는다. 의존이 없어지지 않고 check가 못 보는 곳으로 숨는다. 못 끊으면 예외로 드러낸다.

## 두지 않는 규칙

**"다른 module은 `mod.ts`로만 import한다"는 두지 않는다.**
- `mod.ts`는 barrel이라 지나는 순간 그 module 전체가 실린다. 예: `storage/ledger/mod.ts`는 `sqlite.ts`(node:sqlite)를 싣는다. 함수 하나를 위해 정문을 쓰면 위 "실행 때 import"의 문제를 스스로 만든다.
- 이 규칙이 아껴 주는 것은 안쪽 파일 이름이 바뀔 때 바깥 import를 고치는 수고다. 그 깨짐은 type check가 100% 잡고 고치기는 기계적이다.
- 검증할 수 있고 싼 비용(옆문 import가 깨짐)을 받고, 검증하기 어렵고 비싼 비용(쓸데없이 실림)을 피한다.

## harness와 lophn domain

lophn-agent 안에는 성격이 다른 둘이 섞여 있다. 기준은 "lophn이 무엇을 하는 제품인지 알아야 하나"다.

| 성격 | 예 |
|---|---|
| 장치 (infrastructure) | agent loop, tool calling(registry, schema 검사, 결과 전달), prompt 조립 틀(층, 예산, cache marker), provider·model 호출 |
| 범용 능력 | file, shell, web tool, MCP, skill 불러오기 |
| lophn domain | role(PM, App Engineer, Operator), role별 tool과 prompt 내용, place 규칙, domain tool 정의(ticket, release, problem, context, app-api) |

지금은 셋이 `lophn-agent` 한 module에 있고, domain tool 정의는 `lophn-agent/tools/bundles/`에 있다. 동작은 port로 주입받아 import 방향은 지키지만 domain 지식이 harness 폴더에 있다.

나누면(domain tool 정의는 각 domain으로, role·place·prompt 내용은 harness 위의 domain으로, harness에는 장치와 범용 능력만) 얻는 것:
- 빨리 변하는 agent 기술(provider, tool calling, caching)과 천천히 변하는 업무 규칙이 갈린다. harness를 갈아엎거나 외부 harness로 바꿔도 domain은 그대로다.
- domain tool 하나를 고칠 때 tool 정의, port, 동작, wiring 네 곳이 아니라 그 domain 한 곳에서 끝난다.
- agent에게 주는 context가 작아진다. ticket 일은 `apps/tickets`만, loop 일은 업무를 몰라도 된다.
- 같은 domain 기능을 lophn agent(tool)와 coding agent(CLI)에 한 정의로 낼 수 있다.
- harness는 fake provider로, domain tool은 loop 없이 함수로 test한다.

이 분리는 계획된 리팩터링이다(`../plan/`).
