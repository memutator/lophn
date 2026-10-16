# code map

## 저장소 모양

```
packages/
  protocol/       package 사이 약속(type, schema, route, command, event)과 client. protocol/base는 모두가 쓰는 정의
  base/           여러 package가 같이 쓰는 순수 구현(id, clock, Result와 오류 코드, canonical JSON, log, redaction, install)
  core/           core process(daemon, agent runtime, worker, app supervisor) 코드 전부. package 하나
    <module>/                          domain module(projects, apps, problems, lophn-agent)과 바닥 module(server, events, storage, ...)
    main/{daemon,agent-runtime,worker,app-supervisor}/   process entry와 조립. 업무 규칙을 두지 않는다
  shell/          desktop app(main, preload, ipc, renderer, terminal-host)
  coding-agent/   coding agent 연결(CLI, harness adapter)
  design/         lophn 화면과 사용자 앱이 같이 쓰는 UI kit(token, component, wording)
  sdk/            사용자 앱이 import하는 입구(ui-*, cap-*, format-*, blueprint)
tools/            개발 도구(check, wireframes gallery, fake provider 등)
```

- module 이름과 위치의 세부(어느 boundary가 어느 폴더인가)는 리팩터링 계획이 spec 단위(S1~S9)로 정하고, 정한 뒤 이 문서에 표로 적는다.
- 이 문서와 코드가 다르면 이 문서를 먼저 고치고 코드를 옮긴다.
- Router(`core/router/`): 사람 메시지, call tool, Reactor에서 온 입력을 session 입력함으로 보낸다. domain module(lophn-agent, apps, projects 등)을 import하지 않고 `core/router/ports.ts`의 port만 안다. 구현은 wiring이 끼운다.
- core 조립(`core/main/daemon/`): `core.ts`는 단계 구동기다. module마다 `wiring/<module>.ts`가 그 module을 끼우고, `assembly.ts`의 목록(`TEAMS`, `TEAM_MODULES`, `WIRINGS`)이 순서를 정한다. wiring file끼리는 import하지 않고, 둘 이상이 쓰는 값은 `wiring/context.ts`의 칸으로 나눈다. shell main도 같은 꼴이다(`shell/main/desktop/main.ts`와 `desktop/wiring/`).

## package 사이 import

| package | import해도 되는 것 |
|---|---|
| base | 없음 |
| protocol | base |
| core | protocol, base |
| coding-agent | protocol, base |
| design | 없음(자기 wording 포함) |
| sdk | protocol, design |
| shell | protocol, base, design |

- core를 import하는 것은 core뿐이다.
- coding agent adapter를 어디에 둘지(core가 hook 변환을 부르려면 adapter 값이 protocol에 있어야 한다)는 리팩터링 계획에서 정한다(00-decisions C #60).
- `tools/check-deps.ts`가 이 표를 검사한다.

## core 안 module

- domain module(projects, apps, problems, lophn-agent)끼리, 그리고 바닥 module이 domain module을 직접 import하지 않는다. 필요하면 protocol의 약속이나 event로 잇는다.
- 다른 module은 그 module의 `mod.ts`로만 import한다.
- `packages/core/main/*`는 module을 조립만 하고, module이 `main`을 import하지 않는다.
- 한 module의 저장 표는 그 module의 코드만 읽고 쓴다. 다른 module의 표가 필요하면 그 module의 read를 쓴다.

## 여러 package가 같이 쓰는 순수 함수

두 package가 같은 결정적 순수 함수를 써야 하면 한 곳에 두고 `packages/protocol`로 내보낸다. shell은 core를 import할 수 없고 protocol은 import할 수 있기 때문이다.
- 예: md 목차 parser `packages/protocol/projects/outline-markdown.ts`, blueprint 검사.
- 의존성, 시각, 무작위, IO가 없는 순수 함수일 때만 이렇게 한다.

## test helper

- test helper는 그것을 쓰는 test 옆이나 그 package의 `testing/`에 둔다. 제품 코드는 helper를 import하지 않는다.
- 여러 package를 같이 띄우는 test helper는 두지 않는다. 그런 test가 필요하면 [testing.md](testing.md)의 "사람에게 묻는 test"를 따른다.
