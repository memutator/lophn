# a2a multi-device: 다른 기계의 agent에게 일을 맡긴다

상태: 로드맵. 2026-11-21 사람이 방향을 냈고 planner가 정리했다. 정할 것은 모두 정했다. 사람의 검수 전이고 계획은 아직 열지 않았다. `multi-device.md`가 네 번째 종류로 두고 미룬 것(a2a와 handoff)이다.
배경 문서: `project-docs/architecture/{agent-call,remote,machine,approval,app-call,event,folder-sync,job,project-identity,attention}.md`, `project-docs/products/roadmap/{multi-device,multi-machine}.md`.
조사: harness-lab `_report/cross-harness-orchestration/`, `_report/multi-device/`, `_report/cross-session-messaging/`, `_report/codex-multi-agent-report.md`. 2026-11-21에 T3 Code, Paseo, Orca의 소스를 다시 대조했다(돌려 보지는 않았다).

## 사람의 말 (원문)

2026-11-17(`multi-device.md`):

> 세션 데이터 transcript 같은 건 동기화 할 필요가 없고 해서도 안 된다니까? […] 근데 또 해당 컴퓨터가 꺼져 있어 그러면 이제 handoff가 가능해야해.

> 4는 지금 다룰 건 아니지만 handoff에 국한된 게 아니라서 a2a로 보는 게 맞는 거 같아

2026-11-21(planner가 낸 여섯 물음에):

> (꺼져 있는 기계에 맡겨 두기) window 머신에서 이거 빌드 및 테스트 해봐라 하면 window 머신 켜졌을 때, 이런 핸드오프 와 있는데 agent turn 시작할까요? 이런 식으로 approval 받고 진행

> (기계를 누가 고르나) workflow나 지침, 프롬프트에서 정할 일이고 agent가 부를 수 있는 길을 마련해놔야지

> (그 기계에 없는 agent) agent profile은 무조건적인 동기화는 안 함, 환경이 다르고 지침이 다르고 암튼 다름. 그 기계*workspace에 정의된 agent list를 불러와서 보고 고르는거임 혹은 지침에 미리 고정되어 있다거나

> (project가 없거나 옛것일 때) 그건 지침에서 해결해야할 일

> (받을지) 명단에 든 내 기계끼리는 받는다

> (넘겨받을 때 무엇을 보나) 미리 남겨둔다 folder sync, mobile, vm 사용자가 정해둔 길을 따라 흐른다

## 왜

- agent가 다른 기계에 닿는 길은 앱 command뿐이다. Windows에서만 되는 build와 test, 늘 켜 둔 기계에 맡기는 긴 일, 집에서 하던 일을 직장에서 잇는 일을 agent가 맡길 길이 없다.
- 집과 직장, dual boot처럼 두 기계가 같은 때 켜지지 않는 사람이 있다. 늦게라도 닿아야 한다(`multi-device.md` "될 수 있는 것이 먼저다").

## 지금 코드

- **call 주소에 기계가 없다.** `to`는 `{session}`, `{agent, workspace?}`, `{agent, workspace?, session, fallback: "new"}`다(`packages/protocol/lophn-agent/calls.ts`). Router(`packages/core/router/`)는 이 기계 ledger의 session만 푼다. `calls/send`·`calls/reply`·`team spawn`은 actor agent만 받고 기기 route 목록에 없다.
- **agent의 `--on`은 앱 command에만 붙는다**(`packages/core/lophn-agent/tools/lophn/tool.ts:54-62`). 내장 명령에 붙이면 `invalid_input`이다.
- **기계 사이 live 길.** core가 명단의 컴퓨터마다 link를 들고 `machines/call`로 넘긴다(`packages/core/remote/machine-routes.ts`). 받는 입구는 `packages/core/remote/call.ts`다. 한도는 link마다 동시 8개·120초, command lane 4자리·10분이다(`packages/remote-client/connection.ts`, `packages/core/apps/calls/forward.ts:67`).
- **받는 쪽이 agent·앱 요청(`by: agent|app`)에 여는 route는 넷이다**(`REMOTE_AGENT_ROUTES`, `packages/protocol/remote/allowlist.ts:531`: 앱 목록, 앱 상세, command 목록, `apps/remote_call`).
- **허락의 경계.** 앱 command 원격 호출은 받는 컴퓨터가 켠 터미널 입력 허락이 있어야 한다(`call.ts:224`, `packages/core/apps/calls/remote-entry.ts`). 사람의 화면이 다른 기계의 lophn 대화에 말하고(`acp/send`) 승인에 답하는(`turn_requests/decide`) 것은 허락 없이 된다: 허락을 보는 것은 사람 route 목록과 확인이 필요한 command뿐이다(`call.ts:265-275`).
- **보내는 쪽 규칙.** private인 workspace는 다른 기계를 부르지 못하고, 받은 remote call은 다시 넘기지 못한다(`forward.ts:98,105`). 끊긴 답은 `{status: "unknown", reason: "connection_lost"}`이고 다시 보내지 않는다(`forward.ts:85`).
- **늦게 가는 길.** `across_machines` event가 file(`machines/<기계>/apps/<app>/events/<id>.json`, payload 64 KiB, 7일)로 folder-sync의 길(연결, 폰, 같이 보는 폴더)을 타고, 받는 기계가 (낸 기계, `cross_id`)로 한 번만 낸다(`architecture/event.md`). 요청을 싣는 길은 없다.
- **놓친 일을 사람에게 묻는 꼴이 job에 있다.** 정책 `hold`는 켤 때와 10분 넘게 늦은 차례를 `held`로 남기고, 대기 목록 card의 [Start now]·[Skip]으로 정한다(`architecture/job.md` 21).
- **기계를 건너는 정체.** project는 `pri_`, 앱 id는 기계 사이에 같다. Home은 기계마다 따로다. session id, agent 정의, call 정책의 쌍 규칙, model key는 기계마다 따로다.
- **agent가 기계를 읽는 명령**은 `lophn machine environment` 하나이고 home·앱 workspace에서만 된다(`packages/cli/commands/machine.ts:26`).
- **다른 기계의 승인과 질문**은 이미 지금 앉은 화면의 Inbox와 폰에 온다(`architecture/attention.md`).

## 다른 harness

agent가 다른 기계에 일을 보내는 것을 만든 곳은 T3 Code, Paseo, Orca다.

| | T3 Code | Paseo | Orca |
|---|---|---|---|
| 기계 고르기 | agent가 목록 tool을 보고 id로 | 같다 | 같다 |
| 받는 쪽 agent | 받는 기계의 것. capability를 묻는 tool이 있다 | 받는 기계의 것. 묻는 tool이 없다 | 받는 기계의 것 |
| 가는 것 | 글만 | 글과 설정 | 일 설명 |
| 권한 상한 | 보낸 쪽 mode를 넘지 못한다 | 없다 | 깊이를 넘긴다 |
| 끝남을 아는 법 | 보낸 쪽이 long-poll | 보낸 쪽이 구독하고 당긴다 | 순번 붙은 outbox를 1초마다 당기고 ack |
| 상대가 꺼지면 | 끝없이 다시 시도 | 세 번 뒤 "상태 모름" | 쌓아 두고 다시 당긴다 |
| 승인 | 받는 기계의 화면 | 같다. 알림이 안 울린다 | 받는 기계에 남는다 |
| 다시 넘기기 | 막는다 | 한 번만 건넌다 | worker는 home에만 답한다 |

모인 것: 결과를 모르는 요청은 자동으로 다시 보내지 않고 "모름" 상태를 둔다. 받았다와 끝났다는 다른 상태다. 기계를 건너온 agent 메시지는 사람 입력으로 다루지 않는다. 꺼진 기계에 보내는 일반 명령 대기열은 두지 않는다(Emdash는 만들었다가 지웠다: 늦게 온 명령이 바뀐 대상에 실행됐다). session을 옮기면 fork가 된다(Codex, Claude Code, omp 모두 원래 기계가 켜져 있어야 한다).

꺼진 기계의 일을 다른 기계가 넘겨받는 것은 선례가 없다. 본보기 없이 설계한다.

## 무엇을 만드나

### mail

기계 사이의 call, reply, cancel은 mail 하나다. 보내는 기계의 core가 call을 기록하고 outbox에 넣는다. 받는 기계가 닿으면 link로 바로 가고, 닿지 않으면 outbox에 남아 다시 만났을 때나 folder-sync의 길로 간다. 받는 기계의 core는 mail을 자기 Router에 넣어 그 기계의 call처럼 돌린다. reply도 같은 길로 돌아와 보낸 session의 새 입력이 된다.

- id는 보낸 쪽이 짓고 양쪽이 같은 id를 쓴다. 같은 mail이 두 길로 와도 한 번만 적용한다.
- 가는 것은 body와 작은 값이다. transcript, file, commit하지 않은 변경, 자격은 가지 않는다.
- call의 상태에 "아직 닿지 않음"과 "모름"이 더해진다.

### 주소

`{agent, workspace, machine}`이다. workspace는 project면 `pri_`, 앱이면 앱 id, Home이면 그 기계의 Home이다. 받는 기계에 열린 session은 그 기계의 session id로 가리킨다.

agent는 기계 목록, 그 기계·workspace의 agent 목록과 명함, 그 기계의 열린 session 목록을 명령으로 읽는다. system prompt에 싣지 않는다(`multi-machine.md` §6). 부를 수 있는 것은 모두 목록에 있고, 목록에 있는 것은 모두 명함을 읽고 부를 수 있다.

### 받는 쪽

- 받는 기계는 자기 agent 정의, 자기 model key, 자기 권한으로 돈다.
- 보낸 쪽(기계, agent, session)이 받는 session에 지워지지 않게 남고, 사람 입력으로 그리지 않는다.
- 받은 mail로 열린 session은 또 다른 기계로 mail을 보내지 못한다.
- 물음과 승인은 지금 길 그대로다: 그 기계의 Inbox에 서고 사람이 지금 있는 기기에 뜬다.

### 늦게 온 mail

닿을 때 바로 온 mail은 묻지 않고 돈다. 늦게 온 mail은 바로 돌지 않고 받는 기계의 대기 목록에 card로 선다: 누가 어느 기계에서 언제 무엇을 맡겼는지를 보이고 [Start now]·[Skip]으로 정한다. job의 `hold`와 같은 꼴이다. mail은 만료 시각을 싣고, 만료된 mail은 받는 쪽이 버리며 보낸 쪽 call은 실패로 닫힌다.

### handoff note

session은 일하는 동안 handoff note를 남긴다. 어디까지 했고 다음이 무엇인지는 agent가 쓰고, 기계, project 정체, branch와 commit, 시각은 program이 붙인다. note는 앱 data처럼 사람이 정해 둔 길(folder sync, 폰, 늘 켜 둔 기계)을 따라 다른 기계로 흐른다. 다른 기계의 사람은 그 project 아래에서 "다른 기계에서 하던 일"을 보고 그 note를 첫 입력으로 새 session을 연다. transcript는 가지 않는다.

켜져 있는 기계로 넘기는 것은 reply를 받지 않는 mail 하나다. 넘긴 session에는 어느 기계로 넘겼는지가 남는다.

### 보이는 것

- 보낸 쪽 call card: 기계 이름과 상태(닿지 않음, 대기 목록에서 기다림, 도는 중, 모름).
- sidebar: 다른 기계에서 도는 call의 session이 기계 꼬리표와 함께 선다.
- 받는 쪽 session: 누가 어느 기계에서 보냈는지.

## 정한 것

1. **꺼져 있는 기계에 맡겨 둔다. 늦게 온 mail은 사람에게 묻고 돈다.** (사람, 2026-11-21) 묻는 꼴은 job의 `hold`를 쓴다(agent: 놓친 일을 묻는 길이 이미 하나 있다).
2. **agent가 다른 기계를 부르는 길을 연다. 누가 언제 어느 기계를 고르는지는 workflow, 지침, prompt가 정하고 program은 막지 않는다.** (사람, 2026-11-21) 지침이 가리키는 것이 맞는지 program이 검사하지도 않는다(사람, 2026-11-21. `a2a-access.md` 정한 것 2).
3. **agent 정의는 기계 사이에 맞추지 않는다.** 부르는 쪽은 그 기계·workspace에 정의된 agent 목록을 읽어 고르거나 지침에 적힌 것을 쓴다. (사람, 2026-11-21)
4. **받는 기계에 project가 없거나 옛것일 때의 처리는 지침의 일이다.** program은 `pri_`로 찾고 없으면 없다고 답한다. code를 옮기지 않는다. (사람, 2026-11-21)
5. **명단에 든 내 컴퓨터끼리는 mail을 받는다.** 컴퓨터마다 켜는 스위치를 따로 두지 않는다. (사람, 2026-11-21)
6. **handoff 재료는 미리 남겨 두고 사람이 정해 둔 길을 따라 흐른다.** (사람, 2026-11-21)
7. 기계 사이 a2a는 mail 하나이고 id는 보낸 쪽이 짓는다. (agent: Orca. id를 맞추는 표가 필요 없다)
8. 한 mail이 link와 folder-sync의 길로 같이 가도 받는 쪽이 한 번만 적용한다. (agent: `across_machines` event와 같은 규칙)
9. transcript, file, commit하지 않은 변경, 자격은 가지 않는다. (사람, 2026-11-17의 적용. T3 Code·Paseo·Orca도 같다)
10. 받은 mail로 열린 session은 다른 기계로 mail을 보내지 못한다. (agent: 앱 command의 지금 규칙. 기계 사이 고리를 막는다)
11. 결과를 모르는 mail은 "모름"으로 남기고, 같은 mail(같은 id)만 다시 보낸다. 받는 쪽이 mail id마다 한 번만 적용하므로 일이 두 번 돌지 않는다. 새 mail로 일을 다시 시키지는 않는다. (agent: 조사한 제품이 모인 곳. 2026-11-21 계획 `machine-a2a`에서 "다시 보내지 않는다"를 이 뜻으로 고쳤다)
12. mail은 만료를 싣는다. 기본은 7일이다. (agent: `across_machines` file의 수명과 같다. 사람에게 물었고 답이 없어 추천대로 둔다)
13. private인 workspace는 mail을 보내지도 받지도 않고 handoff note도 남기지 않는다. (사람, 2026-11-17 "private은 기계 사이에도 선다"의 적용)
14. handoff note의 글은 agent가 쓰고 언제 쓸지는 지침이 정한다. program은 사실(기계, project 정체, branch와 commit, 시각)만 붙인다. (agent: `PRODUCT.md` §3)
15. `team spawn`이 기계를 건너는 것은 call 다음 단계다. (agent: 사람에게 물었고 답이 없어 추천대로 둔다)
16. 다른 기계에서 온 mail로 열린 session은, 받는 컴퓨터가 보낸 컴퓨터에 터미널 입력 허락을 켰을 때만 그 agent의 skip 기본값을 따른다. 아니면 묻는 session으로 연다. (agent: 2026-11-19에 사람이 정한 "허락은 받는 컴퓨터가 켠 것만 선다"를 지킨다. skip인 agent가 mail만으로 shell을 돌리면 꺼 둔 허락이 꺼져 있지 않게 된다. 규칙은 하나다: 명단이면 말을 걸 수 있고, 허락이 있어야 묻지 않고 실행된다)
17. workflow 선언의 참가자에 컴퓨터를 적을 수 있다. 그 step은 그 컴퓨터의 agent에게 mail로 넘어가고, 컴퓨터가 꺼져 있으면 기다렸다가 켜질 때 대기 목록 card로 선다(2번 그대로). run 화면은 그 step이 어느 컴퓨터에서 도는지와 배달 상태(아직 닿지 않음, 대기, 도는 중)를 보인다. (사람, 2026-11-21. 적지 않으면 지금처럼 step을 맡은 agent가 지침에 따라 `--on`으로 부른다)

## 정할 것

없다.

## 단계

| 단계 | 하는 일 |
|---|---|
| 1 | live mail: 주소의 기계, outbox와 받는 입구, reply와 cancel, 상태("아직 닿지 않음", "모름"), 기계·agent·session 목록 읽기, call card와 받는 session의 출처 표시 |
| 2 | 늦게 가는 길: outbox를 folder-sync의 길에 싣기, 만료, 늦게 온 mail의 대기 목록 card |
| 3 | handoff note: 남기기, 흐르기, 다른 기계에서 이어 열기 |
| 4 | `team spawn`이 기계를 건넌다 |
| 5 | workflow의 step을 다른 컴퓨터의 참가자에게 넘긴다: 선언의 참가자에 컴퓨터, mail로 넘기기와 report 받기, run 화면의 컴퓨터와 배달 상태 |

1 → 2 → 3은 앞의 것 위에 선다. 4는 한 기계 안의 call 전달을 mail 하나로 맞춘 뒤에 한다. 5는 1과 2 위에 서고 4를 기다리지 않는다.

## 하지 않는 것

- agent 정의, skill, 설정, 자격을 기계 사이에 맞추기.
- transcript를 옮기거나 session을 다른 기계에서 resume하기.
- 받은 일을 또 다른 기계로 넘기기.
- 결과를 모르는 mail을 자동으로 다시 보내기.
- code와 file을 옮기기. git이 하고 방법은 지침에 있다.
- program이 기계를 대신 고르기. 꺼진 기계 대신 이 기계에서 돌리기.
- 지침이 가리키는 기계나 agent가 맞는지 program이 검사하기.
- relay나 서버가 mail을 맡아 두기.

## 확인하지 않은 것

- folder-sync의 길은 실제 도구(Syncthing, Google Drive)와 실제 두 기계로 돌려 본 적이 없다(`multi-machine.md` "남은 것").
- T3 Code, Paseo, Orca는 소스만 읽었다.
