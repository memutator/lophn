# 앱 SDK: event, session lifecycle, A2A, ACP

상태: 로드맵. 2026-11-10 사람이 방향을 냈고 planner가 대화를 정리했다. 정할 것은 남지 않았다.
배경 문서: `project-docs/architecture/{event,app-notice,app-call,acp,agent-call,workspace-session,terminal-agent,coding-agent,observability}.md`, `project-docs/products/roadmap/{agent-platform,agent-surface,app-place,mobile}.md`. 비교: `../harness-lab`의 harness 여덟(Claude Code, Codex, OpenCode, pi, omp, dsh, mixdog, Hermes)의 session ↔ process 대응(2026-11-10 조사, 아래 "비교").

## 사람의 말 (원문, 2026-11-10)

> 우리 SDK에 대해서 좀 크게 업데이트하고 싶은 부분이 있어
> session lifecycle, a2a protocol 을 sdk로 두고 싶거든?
> session lifecycle이 뭘 의미하냐면 우리 workspace 별로 돌아가는 agent session에 대한 정보에 접근할 수 있게 하는 것
> a2a 프로토콜은 agent간 어떤 흐름도 app에서 구현할 수 있게끔 지금은 acp (App context Protocol) 관련해서만 있거든

> session id 나 ppid나 그런 것도 가져오게 할 수 있음?

> (shell tool child의 env에 session id) 일단 이건 넣고

> masup에서 내가 구독제 usage 관리하거든? 거기서 한도 감지하고 90프로 썼으면 뭐 진행 중인 claude code를 죽인다거나
> agent 시스템 모니터를 만들고 특정 프로세스가 메모리 너무 많이 먹으면 터지기 전에 킬 한다거나

> event SDK도 만들고 싶다는거다 생각보다 일대다 구조가 많을 거 같다는 생각?
> 그러면 이제 masup에서는 한도 usage 관련한 이벤트만 발행하고 그걸 쓰는 다른 앱에서는 구독만 하면 된다는거잖아 그치?

> 그럼 session lifecycle를 그냥 core에다 두고 sdk는 listner를 만들 수 있게 가는 방향도 괜찮을텐데? 어짜피 session lifecycle은 lophn이 해야하는거고 app에서도 쓰고 싶다면 그걸 또 만들 필요 없이

> (cwd, worktree, branch) 그걸 실제로 아는 건 근데 서드파티(사용자 앱)에서도 충분히 가능한 거 아닌가? 우리가 별도로 sdk를 두지 않아도?

> a2a도 계획에 포함시키자

## 왜

- 앱이 agent를 쓰는 길은 ACP 하나뿐이다. SDK `@lophn/agent`의 `useAgentSession`이 자기 앱 workspace의 session 하나를 열고 사람 이름으로 말한다. 다른 workspace의 session은 읽지도 못한다.
- 앱이 agent 둘을 엮으려면 A의 답을 B에게 사람 메시지로 넣어야 한다. AI가 쓴 글이 사람 글로 들어가 `architecture/agent-call.md`가 막으려는 일이 생긴다.
- 앱은 "지금 어느 session이 돌고 있나, 무엇이 사람을 기다리나"를 물을 길이 없다. sidebar와 Inbox가 그리는 재료가 사람 화면 전용이다.
- 앱끼리 닿는 길은 방향 있는 앱 쌍의 command 호출뿐이다. 한 앱이 내는 사실(사용량 한도)을 여러 앱이 듣는 일대다에 맞지 않는다.

쓰는 예(사람):
- Masup이 구독 한도 90%를 감지해 `usage.limit`을 낸다. 다른 앱이 듣고 도는 Claude Code를 멈춘다.
- agent system monitor 앱이 session에 딸린 process의 memory를 보고 터지기 전에 죽인다.
- 앱이 agent 둘을 번갈아 부려 흐름을 돌린다(AI 대 AI 오목, 조사 → 글 → 검토).

## 지금 코드 (main, 제품 판 0.23.27)

### 앱 선언과 앱 호출
- 선언 schema는 `packages/protocol/apps/declaration/`(zod 없는 정본)이고 SDK `packages/sdk/declaration/define.ts`는 `validateDeclaration`을 부르기만 한다. 최상위 칸은 `name, description, icon?, skills?, keys?, screens, operations, commands, permissions, app_connections, sdk_dependencies`다. 모르는 칸은 거절하고, 빈 선택 칸은 hash에서 뺀다(옛 선언의 hash가 그대로다).
- handler 이름은 operation과 command가 한 namespace를 쓴다(`packages/protocol/apps/declaration/tools.ts`).
- 앱 호출의 caller 종류는 다섯이다: person, agent, app, program, flow(`packages/protocol/apps/calls/caller.ts`). ledger 표 `invocations`의 `caller_kind`에 같은 다섯이 CHECK로 박혀 있다(`packages/core/apps/invocations/schema.ts`). SQLite는 CHECK를 고치지 못해 종류를 더하려면 표를 다시 만드는 schema step이 필요하다. caller type의 손 사본이 둘 있다(`packages/sdk/cap-tool/context.ts`, `packages/core/apps/runtime/entrypoint/wire.ts`).
- 앱 process는 켜진 앱이면 supervisor가 늘 띄워 둔다(`packages/core/apps/runtime/supervisor/supervisor.ts`). 쓰일 때 깨우는 장치는 없고, process가 없으면 호출은 `app_unavailable`로 거절된다.
- 앱 process → core는 앱마다의 unix socket broker를 지난다. broker route는 일곱이고(`packages/core/apps/permissions/broker/server.ts`), 자식 자격이 부를 수 있는 core route는 셋이다: `app.call_tool`, `notices.post`, `app_tray.set`(`packages/core/apps/control.ts`). "부모 invocation이 돌고 있어야 한다"는 앱 → 앱 호출에만 걸리고 notify·tray는 기동 code에서도 된다.
- 앱 화면 → core는 `lophnApp` bridge다(`packages/protocol/shell/app-bridge-types.ts`). shell main이 sender view에서 앱을 정하고 사람 자격으로 core를 부른다. Bus event가 앱 화면에 가는 길은 `AcpUpdated` 하나다(`packages/shell/main/desktop/wiring/app-calls.ts`).

### session 상태
- running·waiting·idle을 내는 곳이 넷이고 뜻이 조금씩 다르다: `ListSessionSnapshots`(user만, `packages/core/main/daemon/wiring/session-snapshots.ts`), `ListSendableSessions`(agent만), ACP의 turn `phase`, 터미널 tracker. `ListSessions`와 `ReadSessionStatus`에는 상태 칸이 없다.
- Bus의 agent event는 19종이다(`packages/protocol/events/agent.ts`). `session.running|waiting|idle` 같은 상태 event는 없고 `session-snapshots.ts`의 `liveTurns`가 turn·request·질문 event에서 상태를 접는다.
- `StopTurn`은 actor가 user와 machine뿐이다. lophn runtime은 `turn_stop`으로 model 요청과 도는 `shell.run`을 process group째 끊는다. harness runtime은 host가 1초마다 turn을 읽다가 끝났으면 CLI에 `proc.kill()`을 부른다(tree kill이 아니다).
- `shell.run`의 child env는 허용 목록 여덟(`PATH` 등)이고 `LOPHN_`으로 시작하는 이름은 나가지 못한다(`packages/core/lophn-agent/tools/shell/env.ts`). 부르는 자리에 session id는 있다(`ToolContext`). harness runtime의 CLI는 `LOPHN_AGENT_CREDENTIAL`만 받는다.

### 터미널 탭의 coding agent
- 상태는 core의 tracker(`packages/core/terminal-agents/tracker.ts`)에만 있다: harness, 상태, CLI session id, 제목, cwd. 저장되는 것은 session identity뿐이다(`<data>/terminal-agents/sessions/<project>.json`).
- PTY shell의 pid는 core의 PTY host(`packages/core/terminals/host/`)에 있다. 끊기 key는 harness adapter 표(`packages/protocol/coding-agent/harness-adapter.ts`)의 `interrupt_keys`이고 두 harness만 값이 있다. `signal` 요청은 Linux에서 SIGINT·SIGTERM만 foreground group에 보낸다.
- core는 이 상태를 전혀 모른다. shell main이 core로 상태를 밀어 넣는 route가 없다.

### A2A
- Router의 보낸 쪽(`CallFrom`)은 human, program, agent session 셋이다(`packages/protocol/lophn-agent/calls.ts`). 받은 메시지의 `messages.from_kind`에 같은 셋이 CHECK로 박혀 있고 trigger가 고정한다(`packages/core/lophn-agent/session/model.ts`). `from.kind`로 가르는 곳이 core와 화면에 서른 곳 남짓이다.
- `agent_calls` 행은 agent가 보낸 call에만 있다. `from_session`이 not null이고 보낸 쪽 종류 칸과 본문 칸이 없다(`packages/core/router/schema.ts`). 답 본문은 상대 session의 새 `messages` 행으로만 남는다.
- call 정책, 팀 규칙, 명함 검사는 보낸 쪽이 agent일 때만 돈다. `mayCall`은 순수 함수이고 입력이 `{agent, workspace}` 쌍이다.
- call 상태가 바뀐 것을 알리는 Bus event는 없다.
- `sessions/open`은 actor가 user뿐이고 연 쪽을 남기지 않는다. `sessions`에는 `spawned_by`(팀의 부모)와 `called_from_*`(부른 workspace)가 있고 각각 trigger로 고정한다. `team/end`는 `spawned_by`를 따라 자기 자손만 archive한다.
- "앱이 연 session"은 shell main 메모리의 집합이다(`packages/shell/main/app-frame/app-agent.ts`). 알림 규칙이 이것으로 turn 끝 알림을 거르는데 재시작하면 사라진다.
- ACP의 `sender`는 agent와 program 둘이다(`packages/protocol/acp/items.ts`). SDK에 zod 없는 사본이 있고 type 검사로 맞춘다(`packages/sdk/agent/acp-types.ts`).
- session이 주고받은 call을 session으로 읽는 read는 없다.

### SDK 판
`@lophn/agent` 1.7.0(`supported_from` 1.1.0), `@lophn/declaration` 4.4.0, `@lophn/cap-tool` 2.0.0, `@lophn/cap-notify` 1.2.0, `@lophn/app-ui` 2.13.0.

## 비교: session마다 process를 두는가

| harness | session ↔ process | session별 pid |
|---|---|---|
| Claude Code, pi, omp | 1:1. GUI도 session마다 CLI를 띄운다 | Claude Code만 registry file과 env로 낸다 |
| Codex, OpenCode, dsh, mixdog, Hermes | N:1. session은 process 안의 task다 | 없다. server pid만 낸다 |

- 갈리는 기준은 CLI가 먼저인 제품인가 server가 먼저인 제품인가다. lophn은 뒤쪽이다.
- 어느 쪽도 process를 권한 경계로 쓰지 않는다. sandbox는 명령마다 씌운다.
- 여덟 곳 가운데 shell tool을 가진 곳은 child env에 session id를 넣는다(`CODEX_THREAD_ID`, `OPENCODE_SESSION_ID`, `CLAUDE_CODE_SESSION_ID`, `DSH_SESSION_ID`, `HERMES_SESSION_ID`, `PI_SESSION_ID`).

## 무엇을 만드나

### 원칙

**앱은 자기 앱 workspace에 사는 agent 하나와 같은 시야, 같은 call 모양을 갖는다.** 시야는 call 정책 그대로다: 그 앱 workspace의 agent가 부를 수 있는 workspace의 session이 앱에도 보이고, private workspace는 보이지 않는다. 새 permission이나 새 정책을 만들지 않는다.

### 1. 앱 event

- 앱이 선언에 event 이름과 payload schema를 적고 앱 process에서 `publish(name, payload)`를 부른다. 다른 앱은 선언에 구독을 적고 `subscribe(source, name, handler)`로 handler를 건다.
- event는 일이 일어난 뒤의 알림이다. core는 구독자의 답을 기다리지 않는다. hook이 아니다.
- 전달은 구독 앱의 handler 호출(invocation) 하나다. 그 순간 켜져 있는 구독 앱이 받는다. 저장, 구독자 cursor, 재시도는 없다. 놓쳐도 되도록 정본은 발행한 쪽의 read command이고, 구독 앱은 켜질 때 그것을 한 번 읽는다(lophn 화면이 snapshot을 읽고 event로 고치는 약속과 같다).
- 앱 화면도 같은 `subscribe`를 쓴다. 화면이 떠 있는 동안만 받는다.

```ts
// Masup (앱 process)
publish("usage.limit", { provider: "claude", percent: 91 });

// 구독 앱
subscribe("masup", "usage.limit", async (e) => {
  if (e.percent < 90) return;
  for (const s of await sessions.list({ harness: "claude", state: "running" })) {
    await sessions.stop(s.session);
  }
});
```

### 2. 관측

- 구독 handler의 호출은 지금 앱 호출 기록(`invocations`)에 그대로 남는다. caller 종류에 event를 더해 "이 호출은 어느 앱의 어느 event 때문"이 한 줄에 보인다. agent는 지금처럼 `app.invocations`, `app.logs`, `app.status`로 읽는다.
- 발행 기록을 남긴다: 누가, 어느 event를, 언제, 구독자 몇에게 냈고 전달하지 못한 구독자가 있었는지. payload 본문은 남기지 않는다. 앱마다 최근 N개만 둔다. agent가 읽는 tool 하나를 더한다.
- 발행과 거기서 나온 호출은 같은 trace id로 잇는다(`architecture/observability.md`).
- 앱을 짓는 agent가 trace를 심거나 logging 체계를 고르지 않는다.

### 3. session lifecycle

- core가 첫 발행자다: `session.started`, `session.running`, `session.waiting`, `session.idle`, `session.ended`. 구독은 `subscribe("lophn", …)`다.
- 터미널 탭의 coding agent도 같은 event를 낸다. shell main이 tracker의 상태를 core에 알리는 길을 새로 둔다.
- 목록 read 하나: session마다 id, agent(handle·이름·runtime), workspace, 제목, 상태, 무엇을 기다리나, 마지막 활동 시각, `spawned_by`, 종류(`lophn` | `harness` | `terminal`), 터미널이면 harness·CLI session id·탭·shell pid, cwd와 폴더 목록. 지금 넷으로 흩어진 상태 계산을 이 하나로 모은다.
- 하나만 깊게 읽기: token, 비용, context 점유(`ReadSessionStatus`).
- `stop(session)`: 도는 turn을 멈추고 그 turn에 딸린 process를 정리한다. lophn runtime은 지금 그대로, harness runtime은 CLI를 tree째 끝내고, 터미널 탭은 끊기 key를 보낸다.
- `shell.run`의 child env에 `LOPHN_SESSION_ID`를 넣는다. harness runtime의 CLI에도 넣고, 터미널 탭의 shell과 GUI view가 띄운 CLI에는 `term:<탭>`을 넣는다.

### 4. 앱의 A2A

- Router의 보낸 쪽에 `app`을 더한다. 받는 agent는 `<lophn-call from="app:…">`로 받고 채팅 화면에도 앱이 보낸 것으로 그려진다(ACP `sender`에 `app`).
- 받는 곳은 지금 call과 같다: 열린 session, agent + workspace(새 session). 답 방식은 none과 result다. call 정책과 명함 검사를 그대로 거친다(보낸 workspace는 그 앱의 workspace).
- 답과 늦은 실패는 session 입력함 대신 call 행과 event로 앱에 간다. call 행이 앱이 보낸 call도 갖고, 답 본문을 앱이 읽을 수 있게 한다.
- 앱이 session을 연다(시야 안 어느 workspace든). session에 연 앱을 남기고 고정한다. 앱은 자기가 연 것만 끝낸다(archive). 알림 규칙의 "앱이 연 session"은 이 칸을 읽는다.
- 읽기: 명함(`agents/card`), session이 주고받은 call 목록.

```tsx
const sent = await calls.send({
  to: { session: white },
  body: [text(describe(board, lastMove))],
  reply: "result", schema: MOVE,
});
const move = (await sent.result).value;
```

### 5. ACP

- ACP 규격의 상태·갱신·입력은 그대로다. 바뀌는 것은 둘이다.
- **붙을 수 있는 session이 넓어진다.** 지금 bridge는 자기 앱 workspace의 session만 읽게 한다. 시야 안 session이면 어디든 `useAgentSession({session})`으로 붙어 snapshot과 갱신을 받는다. 목록 read에서 고른 session의 대화를 앱이 그릴 수 있다.
- **`sender`에 `app`이 는다.** 앱이 보낸 call이 받은 session의 대화에 앱이 보낸 것으로 나온다. SDK의 type 사본과 채팅 화면의 sender chip을 같이 고친다.
- 앱이 보내는 ACP 입력은 지금 허용 목록(`send`, `stop`, `answer`, `rename`) 그대로이고, 시야 안 모든 session에 보낼 수 있다(정한 것 17).

### 6. event로 도는 job

job의 "때"가 주기 대신 event일 수 있다. 예: `masup`의 `usage.limit` → agent `wrap-up`을 돌린다, `lophn`의 `session.idle` → workflow `review`를 시작한다. job의 나머지는 그대로다(사람의 등록 승인, 승인 뒤 고정된 할 일, 사람 없이 도는 run, 같은 run·기록).

- 때: `{source, event}`. source는 앱(job이 앱을 가리키는 같은 이름)이거나 `lophn`이다. 앱의 event는 등록 때 그 앱의 active release가 선언했어야 하고, 나중 release가 빼면 그냥 돌지 않는다. `lophn`은 `session.*`만(한 앱에게만 가는 `call.settled` 제외).
- 전달: jobs가 1의 전달에 앱이 아닌 안 구독자로 붙는다(호출 기록 없음). 승인하고 켜진 job만 연다. 저장하지 않는다: core가 꺼진 사이의 event는 job을 열지 않는다.
- 폭풍: 앞 차례가 돌면 건너뛴다(`busy`). job마다 최소 간격(기본 5분, 등록 때 정하고 승인 대상)보다 가까운 event는 건너뛴다(`too_soon`). 건너뜀은 기록에 남는다.
- 보이는 범위와 고리: `lophn`의 session event는 job의 workspace(home이면 home)가 call 정책으로 닿을 수 있는 session의 것만 연다. 이 job의 run이 연 session의 event는 이 job을 다시 깨우지 않는다. 앱 event는 1의 사슬(chain)을 싣고 가 돌아오지 못한다.
- 할 일에 주는 것: event(이름, source, payload)는 data이고 사람의 말이 아니다. agent run은 고정 prompt가 지시이고 event는 뚜렷하게 구분된 data 블록이다. 앱 tool run은 등록이 정하면 입력에 합친다. workflow는 시작 입력 글(JSON)로 받는다.
- 화면: 승인 card가 때를 말로 보인다("masup이 usage.limit을 낼 때, 5분에 한 번까지"). Jobs 목록은 다음 차례 대신 때와 마지막으로 연 때·건너뛴 수를 보인다.

## 정한 것

1. 앱 event를 연다. `architecture/event.md`와 `app-notice.md`의 "앱 event의 발행·구독을 열지 않는다"(2026-11-05)를 뒤집는다. (사람, 2026-11-10)
2. event는 일이 일어난 뒤의 알림이고 core는 답을 기다리지 않는다. hook(시작 전에 막기)은 두지 않는다. (사람이 설명을 듣고 받음)
3. 전달은 한 번이고 저장하지 않는다. 정본은 발행한 쪽의 read다. (agent) 닫았던 이유가 "반응을 믿게 할 장치(저장, cursor, 재시도, 멱등 key)"였고, 그 약속을 하지 않으면 장치가 필요 없다. 쓰는 예 둘(한도 감지, process 감시)은 지금 상태가 중요한 일이라 켤 때 한 번 읽으면 된다.
4. session lifecycle은 SDK에 따로 짓지 않는다. core가 event의 첫 발행자이고 앱은 listener를 건다. (사람, 2026-11-10)
5. 터미널 탭의 coding agent를 lifecycle에 넣는다. (사람이 session id·ppid를 물은 것에서, 2026-11-10) pid가 뜻이 있는 것은 process가 곧 session인 터미널 CLI뿐이다.
6. session마다 process를 두지 않는다. (agent, 사람이 비교를 봄) server가 먼저인 harness 다섯이 모두 N:1이고, process를 나눠 얻는 것(crash 격리, session별 kill)보다 치르는 것(기동 시간, memory, session마다 MCP)이 크다.
7. lophn만 아는 것만 SDK로 준다. git root·worktree·branch, process 목록, CLI 자신의 pid, process kill은 주지 않는다. 앱이 `LOPHN_SESSION_ID`(환경 표지가 먼저다. core session은 `ses_…`, 터미널 탭은 shell과 그 아래 CLI(GUI view가 띄운 CLI 포함)가 `term:<탭>`), cwd, shell pid(표지가 없을 때의 대안)로 직접 한다. (사람, 2026-11-10) process tree 따라가기와 group kill은 `design-app` skill의 예제로 둔다.
8. `shell.run`의 child env에 session id를 넣는다. (사람, 2026-11-10)
9. `stop`은 시야 안 모든 session에 연다. archive는 앱이 연 것만, 지움·승인·rewind·fork는 계속 사람만이다. (agent) stop은 잃는 것이 없고 사람의 예(한도에서 멈춤)가 남이 연 session을 멈추는 일이다.
10. A2A를 같은 계획에 넣는다. (사람, 2026-11-10)
11. 앱은 call을 받는 주소가 되지 않는다. agent → 앱은 이미 앱 command다. (agent)
12. 앱이 보내는 call의 답 방식은 none과 result다. conversation은 같은 session에 result call을 다시 보내는 것으로 된다. (agent)
13. 앱은 팀의 node가 되지 않는다. 앱이 연 session은 `spawned_by`가 없는 root다. (agent) 팀의 부모는 자식의 승인에 답하는데, 앱이 승인을 정하지 못하게 한 사람의 결정(`architecture/acp.md`)과 부딪친다.
14. event·목록·stop은 화면과 앱 process 양쪽에 둔다. call 보내기는 화면 먼저다. (agent) 한도 감지는 화면이 닫혀 있어도 돌아야 하고, 흐름을 돌리는 code는 지금 SDK와 같은 자리(`await`)에서 쓴다. 사람 없는 예약 흐름은 workflow의 일이다.
15. SDK는 `@lophn/agent` 하나에 둔다. (사람, 2026-11-02: "저걸 lophn agent Sdk로 묶을 거 아니야")
16. 구독에 사람 허락을 두지 않는다. event는 발행 앱이 내놓겠다고 선언한 것이다. (사람, 2026-11-10, 추천대로)
17. 앱은 시야 안 모든 session에 사람 이름으로 말할 수 있다(ACP `send`). 자기 앱 workspace나 자기가 연 session으로 좁히지 않는다. (사람, 2026-11-10. planner 추천은 좁히는 쪽이었다) 허용 목록 넷(`send`, `stop`, `answer`, `rename`)은 그대로이고 승인·model·rewind는 열지 않는다(쓰는 예가 없다. 사람, 2026-11-10). 앱 화면이 보낸 사람 메시지에는 어느 앱 화면이 보냈는지 이름표("via <앱>")가 붙는다. 메시지는 사람의 것 그대로이고 model이 받는 글과 권한은 바뀌지 않는다. (사람, 2026-11-11)
18. event로 도는 job을 이 계획에 넣는다. "하지 않는 것"에 있던 "event로 시작하는 job"을 뒤집는다. (사람, 2026-11-11)

## 단계

| 단계 | 하는 일 | 선행 |
|---|---|---|
| 1 | 앱 event: 선언의 event·구독 칸, `publish`·`subscribe`, handler 호출로 전달, caller 종류 event(표 rebuild step), 발행 기록과 읽는 tool, 화면 구독 | 없음 |
| 2 | session lifecycle: 상태 계산 하나로 모으기, core의 `session.*` event, 목록 read, status, `stop`, `LOPHN_SESSION_ID`, shell main → core의 터미널 상태 길 | 1 |
| 3 | 앱의 A2A와 ACP: 보낸 쪽 `app`(`messages` 표 rebuild step), call 행과 답 읽기, call event, session 열기와 연 앱 남기기, 자기 것 archive, 명함·call 목록 read, 시야 안 session에 ACP로 붙기, ACP `sender`의 `app`과 채팅 화면 | 2 |
| 4 | event로 도는 job: job의 때에 event(앱 event, core의 `session.*`), jobs가 앱 event 전달의 안 구독자, 폭풍 규칙(`busy`·`too_soon`), 고리 규칙, event를 data로 할 일에 주기, 승인 card·Jobs 목록 | 1, 2 |

각 단계는 SDK 판 올림과 `migrate-sdk` 메모, `project-docs/flows/` 갱신을 같이 한다. 선언 칸이 늘어도 빈 칸은 hash에서 빠져 옛 release는 그대로 뜬다.

## 같이 고칠 문서

- `architecture/event.md`, `app-notice.md`: 앱 event를 열지 않는다는 비목표와 결정.
- `architecture/workspace-session.md`: "child 하나가 여러 session을 돈다" 결정에 비교를 보탠다. event 목록.
- `architecture/app-call.md`: caller 종류, "앱 화면의 agent session".
- `architecture/agent-call.md`, `acp.md`: 보낸 쪽 `app`, `sender`.
- `architecture/terminal-agent.md`: 상태가 core에 닿는 길.

## 하지 않는 것

- hook. 쓰는 예가 생기면 `turn.starting` 하나부터 연다. event의 전달 길 위에 "답을 돌려준다"를 얹는 꼴이라 지금 event를 만들어도 막히지 않는다.
- 저장되는 event(구독자 cursor, 재시도, 멱등 key).
- program이 event를 듣고 agent session을 스스로 여는 것(사람이 승인한 job이 event로 도는 것은 "6. event로 도는 job"에서 열었다).
- session마다 process 두기.
- git 정보, process 목록, process kill의 SDK.
- 앱이 session을 지우거나, 승인을 정하거나, rewind·fork하는 것.
- 앱 process에서 call을 보내고 답을 handler 호출로 받는 길. 쓰는 곳이 생기면 같은 core 계약 위에 입구만 더한다.
- mobile. 이 event 줄기를 push와 remote가 쓴다(`roadmap/mobile.md`).

## 알려진 한계

- CLI 자신의 pid와 foreground 판정은 Linux의 `/proc`에 기댄다. macOS·Windows는 shell pid까지만 믿을 수 있다(`architecture/platform.md`).
- 끊기 key가 있는 harness는 둘뿐이다. 나머지 터미널 CLI에는 `stop`이 `unavailable`이다.
- 앱이 죽어 있던 사이, core가 꺼져 있던 사이의 event는 오지 않는다.
- agent가 env를 지우고 띄운 process는 `LOPHN_SESSION_ID`로 찾지 못한다.
