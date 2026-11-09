# layers

lophn의 코드를 어떤 층과 조각으로 나누고, 누가 누구를 import해도 되는지를 정한 규칙이다. 다른 architecture 문서가 메커니즘 하나를 다룬다면, 이 문서는 그 메커니즘들이 올라앉은 바닥의 모양이다. 규칙은 check가 막는다. 규칙이 무엇을 막으려는지, 왜 그 모양인지, 막지 못하는 곳이 어디인지를 여기 적는다.

## 말

- **layer**: 기술 역할로 가로로 자른 층. 위가 아래를 쓰고 아래는 위를 모른다.
- **feature module**: 업무 능력으로 세로로 자른 조각. `projects`, `apps`, `runs`, `workflows`, `jobs`.
- **infrastructure**: 업무 규칙이 아닌 기술 수단. 저장, event 배달, HTTP server, process 감독. 운영에서 말하는 서버·클라우드 인프라와 다른 뜻이다.
- **바닥**: core 안에서 `lophn-agent`, `agent-workspaces`, feature module, core main이 아닌 module 전부(`storage`, `events`, `server`, `supervision`, `secrets`, `config`, `diagnostics`, `approvals`, `router`, host queue, install-and-update). 모든 process가 딛는 곳이다.
- **port / adapter**: 안쪽이 필요한 것을 interface(port)로 정하고 바깥이 구현(adapter)한다. 안쪽은 바깥을 모른다.
- **composition root**: 모든 조각을 끼워 맞추는 곳. core에서는 core main(daemon, agent runtime, Worker, app supervisor의 입구와 조립)이고, daemon은 module마다 하나씩 그 module의 값을 끼우는 wiring으로 조립한다.

## 문제

import는 코드를 읽는 사람만 보는 선이 아니다. Node는 실행할 때 tree shaking을 하지 않아서, 파일 하나를 import하면 그 파일이 import하는 것을 끝까지 따라가 모두 읽고 top-level 코드를 실행한다(`import type`만 지워진다). 그래서 import 방향이 어긋나면 사람은 이런 것을 잃는다.

- 쓰지 않는 코드가 graph에 붙는다. 그 코드의 top-level이 파일·환경 변수를 읽거나 Worker에 없는 API를 쓰면 process가 시작부터 죽는다. type check가 못 잡는다.
- 상관없는 module을 고쳤는데 엉뚱한 process가 깨진다. 원인을 찾기 어렵다.
- graph가 클수록 순환 import가 생기고, 초기화 순서 때문에 값이 `undefined`로 보이는 버그가 난다.
- process마다 필요 없는 DB·파일 코드가 실린다.

core는 daemon main thread, writer·reader Worker, I/O child process, agent runtime child process, app supervisor로 나뉘어 돈다. lophn 자신의 코드가 도는 process도, AI가 쓴 코드를 돌리는 앱·flow process도 OS 권한을 좁히지 않는다(사람이 정했다). 그래서 권한이 아니라 import가 "그 process에 무엇이 실리나"를 정한다.

또 하나의 문제는 업무 규칙이 엉키는 것이다. agent harness가 workspace 종류와 feature module을 알게 되면 module 하나를 더하고 뺄 때마다 harness를 고치게 되고, feature module끼리 서로 알면 하나만 떼어 이해하고 고칠 수 없다.

## 목표와 비목표

- 목표
  - 거꾸로 가는 import를 코드 수준에서 막는다. 사람의 주의에 맡기지 않는다.
  - process마다 실리는 코드를 작게 하고 예측할 수 있게 한다.
  - feature module 하나를 그 module과 protocol만으로 이해하고 고칠 수 있게 한다.
- 비목표
  - 권한 분리. 위 "문제"처럼 process 권한은 이 문서의 도구가 아니다.
  - 모든 import를 규칙으로 못 박는 것. 막는 것은 방향과 process에 딸려 가는 것이고, 안쪽 파일 이름을 숨기는 것(정문 import 강제)은 일부러 하지 않는다(결정 참조).
  - 공격자 방어. 이 규칙은 AI가 만든 코드와 agent의 실수로 구조가 무너지는 것을 막는다.

## 모델

### package 사이

```
 base  ◀── protocol ◀── core ──▶ cli (명령 표, parser, help만)
              ▲  ▲        
              │  └── sdk ──▶ design
              │
              ├── shell ──▶ design
              ├── cli
              └── coding-agent
```

- base는 아무것도 import하지 않는다. protocol은 base만 쓴다. design은 아무것도 쓰지 않는다. sdk는 protocol, design을 쓴다.
- core는 protocol, base, cli(아래 절)를 쓴다. cli와 coding-agent는 protocol, base만 쓴다. shell은 protocol, base, design을 쓴다.
- core를 import하는 것은 core뿐이다. shell은 core를 import할 수 없고, 그래서 shell과 core가 같이 써야 하는 의존 없는 순수 함수는 protocol에 둔다.
- coding-agent는 shell 중 terminal host와, cli의 binary 입구만 더 쓸 수 있다.
- core가 cli에서 쓰는 것은 명령 표와 그것을 읽는 parser·help뿐이다. cli의 binary 입구, core client(HTTP), 출력은 node 전용이고 HTTP client와 harness 코드를 끌어오므로, agent runtime child에 실리지 않게 core가 import하지 못하고, 명령 표·parser·help도 그쪽을 import하지 않는다.
- core 중 앱 process 진입점만 SDK(예외 관찰)를 import한다. 앱 code보다 먼저 그 관찰을 걸어야 해서다.
- base와 protocol은 어느 runtime에서나 실릴 수 있게 runtime 전용 specifier(`node:`, `npm:`, URL)를 쓰지 않는다. 밖에서 가져오는 것은 protocol의 zod뿐이다.
- protocol 최상위 영역끼리는 순환 import하지 않는다. 지금 남은 예외는 type만 가져오거나 base만 거쳐 실행 순환이 아닌 것으로 이름을 달아 둔 셋이다.
- test 코드는 package 규칙에서 빠진다(여러 package를 같이 띄우는 통합 test가 있어서다). core를 import하는 것은 test도 core 안에서만 한다. 제품 코드는 `tests`를 import하지 않는다.

### core 안

```
 core main (composition root) ── 모두를 알고 조립만 한다. 업무 규칙을 두지 않는다
      │ 조립
      ▼
 projects   apps   runs   workflows   jobs   agent-workspaces
 └──── feature module ────┘            └ workspace 종류 층
      (서로 모른다, workspace 종류 층도 모른다)
      │         │          │
      ▼         ▼          ▼
                 lophn-agent (agent harness)
                      │
                      ▼
 바닥: storage, events, server, supervision, secrets, config, diagnostics,
       approvals, router, host queue, install-and-update ...

 protocol: 경계 사이의 약속(type, schema, route, event). 모든 층이 쓴다
```

방향은 위에서 아래다.

| 층 | 무엇 | import해도 되는 것 |
|---|---|---|
| core main | 조립 | 전부 |
| feature module, `agent-workspaces` | 업무 규칙, workspace 종류 규칙 | `lophn-agent`, 바닥, protocol, base (서로는 안 됨) |
| `lophn-agent` | harness | 바닥, protocol, base |
| 바닥 | 기술 수단 | 바닥끼리, protocol, base |

- 바닥 안 module끼리와 feature module·`agent-workspaces`가 `lophn-agent`를 쓰는 것은 규칙이 막지 않는다.
- core main이 아닌 module은 core main을 import하지 않는다.

### harness와 lophn feature module

`lophn-agent`는 agent 정의·session·run loop·tool registry·model과 provider를 다루는 장치다. 기준은 "lophn이 무엇을 하는 제품인지 알아야 하나"다. 알아야 하면 harness 밖에 둔다.

| 성격 | 자리 | 예 |
|---|---|---|
| 장치 | `lophn-agent` | agent loop, tool registry·schema 검사·Gate 연결, tool 등록 계약(`agent-tool-spi`), prompt 조립 틀(층, 예산, cache marker), provider·model 호출 |
| 범용 능력 | `lophn-agent` | file, shell, web, call, ask, MCP, skill, `lophn` tool |
| feature module tool | 그 feature module | 앱 카드·visual 같은 apps의 tool. workflow·job·release·package·preview 등은 별도 tool이 아니라 `lophn` tool이 부르는 CLI 명령 표로 닿는다 |
| workspace 종류 층 | `agent-workspaces` | workspace 종류별 tool 목록과 순서, credential의 workspace 몫, 제품 고정 규칙과 workspace 종류 지침, workspace 정보, file tool hook, workspace 폴더 규칙, data root 아래 자리와 memory 파일 자리, Home·project·앱 설정 층, 지침 읽기 규칙, session 이름 풀기, 내장 skill |

- harness는 tool을 등록받은 목록으로만 안다. core main이 범용·feature module·workspace 종류 층의 tool 정의를 모아 workspace 종류 층이 정한 순서로 harness에 넘긴다. workspace 종류별 tool 목록, prompt, workspace 재료, credential 상한도 조립이 그 층에서 꽂는다. 순서가 바뀌면 같은 재료가 같은 bytes가 아니게 되므로 순서는 값으로 고정한다.
- 범용 tool 안의 lophn 규칙은 hook으로 뺀다. file tool의 `LOPHN.md` 쓰기 Gate와 rewind pre-image 기록은 hook으로 workspace 종류 층이 채운다. workspace 폴더 가두기는 그 층이 tool context에 채운 폴더 범위로만 판정한다.
- workspace 종류마다 다른 값과 규칙은 harness가 type만 갖고, 값은 workspace 종류 층이 낸다(이름 규칙, Home·project·앱 설정 층). 조립이 꽂는다.
- agent와 workspace의 순수 값(agent id, "workspace의 agent"를 가리키는 주소, workspace 종류 판정, workspace마다 하나인 lophn의 id를 푸는 값)은 protocol에 두어 모든 층이 쓴다.
- tool 정의 파일은 agent runtime child에서 실린다. 그래서 feature module의 tool 정의는 protocol(route, schema), base, 같은 폴더, harness의 tool 등록 계약만 import하고, handler는 tool context로 core route를 부른다. feature module의 store·DB 코드를 끌어오면 agent runtime에 sqlite가 딸려 간다. 이 규칙은 apps의 tool 정의 폴더와 `agent-workspaces`의 tool 정의에 걸려 있다(sqlite, storage 금지. workspace 종류 층은 store·ledger·register 폴더도 금지).
- tool 정의는 handler가 부르는 route를 적는다. agent credential의 상한은 그 route 이름이다(core는 tool 이름이 아니라 route 이름으로 대조한다).
- feature module tool 하나를 더할 때 고치는 곳: 그 module의 tool 정의, protocol의 route, protocol의 workspace 종류별 tool 이름 목록, workspace 종류 층의 순서 목록.
- harness 폴더는 feature module의 protocol(apps, problems, projects, coding-agent)을 import하지 않는다. 아직 못 끊은 7곳(동적 앱 tool 묶음과 앱 command 호출 정의, agent runtime이 열 core route 목록, 공유 skill 받기가 할당한 앱의 skill을 읽는 길, file.read의 열 수 있는 형식 고르기, file.image의 annotation 읽기, file.outline의 md 제목 tree)은 이유와 함께 예외 목록에 올려 두고 새 위반만 막는다. 예외 file이 위반을 다 없애면 check가 목록에서 빼라고 알린다.

## 지키는 것

1. core main이 아닌 module은 core main을 import하지 않는다. 조립되는 쪽이 필요한 type이나 함수는 그것을 쓰는 module 쪽에 둔다.
2. 바닥은 `lophn-agent`, `agent-workspaces`, feature module을 import하지 않는다. 바닥이 위층의 정보가 필요하면 wiring이 넘겨주거나 port로 받는다.
3. `lophn-agent`는 `agent-workspaces`와 feature module을 import하지 않는다.
4. `agent-workspaces`와 feature module은 서로 import하지 않는다. feature module끼리도 import하지 않는다.
5. 둘 이상을 알아야 하는 일(feature module의 읽기 함수를 workspace 종류 층 규칙과 함께 harness에 꽂기)은 core main이 한다. 예: reader·writer Worker가 싣는 `lophn-agent` 팀 등록 파일이 projects·apps의 읽기 함수와 agent 이름 풀기를 harness에 꽂는다.
6. `runs`, `workflows`, `jobs`는 `lophn-agent`와 다른 feature module을 import하지 않고, 필요한 것(agent 이름 풀기, 메시지 넣기, turn 읽기·멈추기, 앱 tool 호출, 정의 file 읽기, project 이름 풀기, flow process 띄우기·멈추기, 시간대·timer)은 자기 port로 받는다. wiring이 끼운다(`architecture/run.md`, `workflow.md`, `job.md`).
7. 두 module을 같이 알아야 하는 host는 module이 아니라 core main에 둔다. flow process를 띄우는 host와 `workflow.check`는 runs와 apps(SDK 설치 사본)를 같이 알아야 해서 core main의 flow host에 있다.
8. 어떤 module도 다른 module의 표를 SQL로 직접 읽지 않는다. 표를 가진 module이 읽기 함수를 내고 조립이 꽂는다. `jobs`가 `runs`와 `workflows`의 표를 읽지 않고, scheduler가 run과 workflow instance를 시작하고 읽는 길도 wiring이 끼운 service와 읽기 함수다.
9. harness 폴더는 feature module의 protocol과 workspace 종류 이름을 새로 들이지 않는다(예외 목록 밖). workspace 종류 규칙을 import 없이 다시 짜는 것도 하지 않는다. 폴더·층 규칙은 workspace 종류 층이 낸 값을 받아 쓴다.
10. feature module의 tool 정의 파일은 base, protocol, 같은 폴더, harness의 tool 등록 계약만 import하고 sqlite·storage를 import하지 않는다.
11. core는 cli에서 명령 표, parser, help만 import한다. cli의 그 셋은 binary 입구·core client·출력을 import하지 않는다.
12. 본체 안 extension code(shell main의 bundled extension)는 protocol, base, 자기 폴더만 import하고 electron을 import하지 않는다. 그 밖 shell main 내부는 ctx로만 닿는다. 따로 설치하는 package로 옮겨도 구조가 같아야 해서다.
13. 이름에 판·단계·작업 번호(`v2`, `m1`, `phase`, `new-`, `old-`, `legacy-`, `-next`)를 넣지 않는다. 내장 skill 폴더 이름은 사람이 `/`로 치는 이름이라 예외다.
14. test 도구 폴더(`testing/`)는 test와 같은 폴더에서만 import한다. 제품 module graph에 test 도구가 실리지 않게 한다.

## 경계와 계약

이 문서의 계약은 module 사이 import와 조립의 약속이다.

- boundary ID: `core`(core main, install-and-update, host queue), `lophn-agent`(하위: `agents`, `agent-sessions`, `run-loop`, `agent-tools`, `models`, `host-queue-core`, `harness-host-core`), `agent-workspaces`, `projects`, `apps`, `runs`, `workflows`, `jobs`, `approvals`, `router`, `events`, `storage`, `server`, `supervision`, `secrets`, `config`, `diagnostics`, `protocol`, `base`, `coding-agent`, `coding-agent-cli`, `design`, `sdk`, `shell`.
- `agent-tool-spi`: feature module와 `agent-workspaces`가 harness에 agent tool을 등록하는 계약. 제공은 apps 같은 feature module과 `agent-workspaces`, 정의는 `lophn-agent`의 `agent-tools`다.
- port: module이 바깥에서 받는 것을 자기 안에 type으로 둔 것. 구현은 core main의 wiring이 끼운다. `runs`는 agent·메시지·turn·앱 tool 호출·origin, `workflows`는 정의 file·project·turn·flow process, `jobs`는 대상 이름 풀기·시간대·timer·run과 instance 시작, `router`는 session directory·input transport·call store, `approvals`는 할당 읽기·쓰기와 앱 공유 요청의 이름 풀기에 port를 둔다.
- wiring: daemon은 module마다 하나의 wiring이 자기 module의 값을 끼우고, 순서는 조립 목록이 정한다. 저장된 data의 새 schema step은 그 목록 맨 뒤 wiring이 낸다(AGENTS.md "호환성"). `lophn-agent` 팀 등록처럼 reader·writer Worker가 싣는 파일은 따로 있다.
- agent tool 이름이 아니라 route 이름이 agent credential 상한이다(위 "harness" 절).
- 설정 key, 저장 파일은 이 문서가 정하지 않는다. 각 메커니즘 문서가 가진다.

## 결정

- **feature module끼리 import하지 않는다.** 이유: 하나만 떼어 이해하고 고칠 수 있어야 하고, 사이의 순환을 막는다. 처음 규칙이 이것이었고, test runner(problems)가 앱을 띄우려 apps를 import해 한때 problems → apps 한 방향을 허락했다(agent). test runner를 지울 때(사람, 2026-10-21) 예외도 사라져 처음 규칙으로 돌아왔다. release의 data 검사와 앱 log·예외 stack 풀이는 apps 안에 있다.
- **`lophn-agent`를 harness로 두고 workspace 종류 규칙과 feature module을 그 위에 꽂는다.** 이유: 빨리 변하는 agent 기술(provider, tool calling, caching)과 천천히 변하는 업무 규칙을 가르고, feature module tool 하나를 그 module과 protocol, tool 목록 한 줄에서 끝내려고. (agent)
- **workspace 종류 층은 `lophn-agent` 안 하위 폴더가 아니라 따로 둔 module(`agent-workspaces`)이다.** 이유: 하위 폴더면 check가 harness와 그 층을 path로밖에 못 가른다. 처음 이름은 role 층이었고 workspace 종류로 바뀌며 이름을 옮겼다. (agent)
- **못 끊은 import는 예외로 드러내고 새 위반만 막는다.** 버린 안: import를 지우려고 다른 module의 표를 SQL로 직접 읽게 바꾸는 것. 의존이 없어지지 않고 check가 못 보는 곳으로 숨는다. 못 끊으면 이름을 단 예외로 둔다. (agent)
- **남은 harness 예외 7곳은 지금 옮기지 않는다.** 이유: 예외 목록이 새 위반을 막고, 옮겨서 줄어드는 비용이 구체적이지 않다. 이 파일들을 다른 이유로 고칠 일이 올 때 같이 옮긴다. (agent)
- **core process의 OS 권한을 좁히지 않는다.** 이유: core의 좁힘은 경계가 아니었다. lophn 자신의 코드이고, 개발과 배포의 권한이 달라 test가 잡지 못하는 실패(project 폴더가 data root 밖이면 등록이 죽음)만 만들었다. process에 무엇이 실리나는 import 규칙이 정한다. (사람) agent runtime child의 좁힘도 처음엔 이슈로 미뤘다가 같은 이유로 걷어 냈다.
- **"다른 module은 정문(barrel)으로만 import한다"는 규칙을 두지 않는다.** 이유: 정문은 지나는 순간 그 module 전체를 싣는다(예: storage의 정문은 sqlite를 싣는다). 함수 하나를 위해 정문을 쓰면 "문제"의 실행 때 import 문제를 스스로 만든다. 이 규칙이 아껴 주는 것은 안쪽 파일 이름이 바뀔 때 바깥 import를 고치는 수고인데, 그 깨짐은 type check가 100% 잡고 고치기는 기계적이다. 검증할 수 있고 싼 비용(옆문 import가 깨짐)을 받고, 검증하기 어렵고 비싼 비용(쓸데없이 실림)을 피한다. (agent)
- **core가 cli에서 가져오는 것을 명령 표·parser·help로 좁힌다.** 이유: `lophn` tool이 같은 명령 표를 쓰는데, binary 입구와 HTTP client가 agent runtime child에 실리면 안 된다.
- **lophn tool과 coding agent CLI를 한 정의로 내지 않는다.** 이유: 둘은 이미 같은 route를 쓰고, 감싸는 코드를 합치면 CLI 출력·인증과 얽혀 일이 커진다. (agent) 뒤에 workflow·job·release·package 등의 tool은 `lophn` tool이 명령 표를 부르는 길로 합쳐졌다.
- **tool context의 agent·workspace 값은 묶지 않는다.** 범용 `call` tool과 Gate의 intent가 읽고, type은 protocol의 것이라 harness가 workspace 종류 이름 문자열을 갖게 되지는 않는다. (agent)

## 열린 것

- harness 폴더의 feature module protocol import 예외 7곳(위 "harness" 절). 이유와 옮길 때가 정해져 있고(위 결정), 열린 이슈는 없다. 예외 목록이 가드다.
- check가 못 보는 것: (1) `runs`·`workflows`·`jobs`가 `lophn-agent`를 import하지 않는 것은 지금 코드가 지키지만 check 규칙은 아니다(feature module이 harness를 쓰는 것을 일반 규칙은 허락한다). (2) workspace 종류 규칙을 import도 workspace 종류 이름도 없이 harness 안에서 다시 짜는 곳은 규칙으로 못 잡는다. (3) feature module의 tool 정의 폴더 규칙은 지금 apps 하나에만 걸려 있다. 다른 feature module이 tool 정의를 두면 규칙의 대상에 올려야 한다.
- protocol 순환 검사에서 곧 지울 옛 서버 등록 계약 파일 하나를 뺀다. 쓰는 곳을 걷으면 목록을 비운다.
