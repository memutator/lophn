# mobile-attention-core

core에 "주의(attention)"를 짓는다: host(desktop, 폰)가 보고한 presence, 사람을 기다리는 일의 계기 규칙, 누구에게 push를 보낼지 정하는 순수 함수, push 글 만들기, 메모리 `unseen`, `terminal_sessions/signal`, job hold event. 기기 목록과 push 보내기는 주입 port이고 이 task에서는 비어 있다(뒤 task가 잇는다). desktop과 폰 쪽은 건드리지 않는다.

- 단위: mobile-attention (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/attention`(새 폴더 전체)
  - `packages/core/attention/{mod,ports,presence,unseen,triggers,decide,message}.ts`(새 file. 같은 폴더의 `push/`는 `mobile-push-send`의 것이다)
  - `packages/core/attention/{decide,message,unseen}_test.ts`(새 file)
  - `packages/core/main/daemon/wiring/attention.ts`(새 file)
  - `packages/protocol/events/changes.ts`
  - `packages/protocol/events/transient.ts`
  - `packages/core/jobs/due.ts`
  - `packages/core/jobs/ports.ts`
  - `packages/core/main/daemon/wiring/jobs.ts`
  - 한 줄씩 허락(공유 file이라 소유 목록에 넣지 않는다. 한 줄만 더하고 "넘길 줄"에 적는다. lead가 다른 계획과 합칠 때 두 쪽을 다 남긴다): packages/core/main/daemon/wiring/context.ts의 late 칸 `attention`과 `LATE_KEYS`, packages/core/main/daemon/assembly.ts의 import, `createCoreRegistration` 목록, `TEAM_MODULES`, `WIRINGS`(`sessionLifecycleWiring` 바로 뒤 한 줄씩. 맨 뒤 wiring은 `remoteWiring`이 그대로여야 한다), packages/protocol/mod.ts의 `ALL_ROUTES`에 새 route, project-docs의 boundary-catalog.yaml과 module-catalog.yaml의 `attention` 항목(check-modules가 새 폴더를 요구한다)
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/push-survey.md`의 2(설계), 3(계약), 5(risk test). 이 brief가 survey와 다르면 이 brief가 맞다(README "정한 것")
  - architecture: `project-docs/architecture/app-notice.md`(notices와 Bus event), `event.md`, `remote.md`
  - 같은 꼴의 본보기: Bus 구독과 memory route를 한 wiring에서 하는 `packages/core/main/daemon/wiring/session-lifecycle.ts`(`ctx.bus.subscribe`, `memory:` 목록, `terminalSessionsReport` handler), route 정의 `packages/protocol/lophn-agent/session-lifecycle.ts`(`defineMemory`), core 안 wiring끼리 값을 주고받는 길 `wiring/context.ts`의 `Late`와 `ctx.provide`(`noticeRecorder`가 본보기, `wiring/notices.ts`)
  - 지금 desktop이 같은 일을 하는 곳(규칙을 옮겨 오는 원본. 이 task는 지우지 않는다): `packages/shell/main/notice/rule.ts`(`createSessionNotices`: `unseen`을 세우고 지우는 규칙, `goesToParent`, `turnEndKind`), `packages/shell/main/desktop/wiring/notice.ts`(`ALERT_PROGRAM_KINDS`, app 세션 거르기)
  - 이벤트 payload: `packages/protocol/events/agent.ts`(`TurnEnded`의 `active_ms`·`outcome`, `QuestionAsked`의 `to_parent`), `packages/protocol/approvals/turn-request.ts`(`TurnRequestOpened`의 `request.to_parent`), `packages/protocol/events/transient.ts`(`ActivationConsentRequested`, `ShareRequestOpened`, `NoticePosted`)
- 계약:
  - 쓰는 것: `packages/base`의 `Clock`, `Result`, 오류 code 일곱(`invalid_input` 등), `ctx.bus`, `ctx.clock`
  - 내놓는 것(다른 task가 기댄다. 모양을 바꾸지 않는다):
    - **presence/report** (memory, actors `user`): 입력 `z.strictObject({ focused: boolean, idle_ms: int>=0 optional, looking: sessionRef[] (max 32) })`, 출력 `{}`, `changes: []`. `sessionRef`는 `packages/protocol/lophn-agent/session-lifecycle.ts`의 `sessionRefSchema`(`ses_…` 또는 `term:<탭>`). 보고한 쪽은 `who.principal`로 안다(shell main은 사람 자격이라 `device:`로 시작하지 않고, 폰은 `device:<id>`). 오류 code는 `invalid_input`뿐.
    - **unseen/list** (memory, actors `user`): 입력 `{}`, 출력 `{ items: [{ session: sessionRef, kind: "finished" | "failed", at: ISO 문자열 }] }`. **unseen/dismiss** (memory, actors `user`): 입력 `{ session }`, 출력 `{ dismissed: boolean }`. 보는 것과 같은 효과다.
    - `CHANGE_NAMES`(`packages/protocol/events/changes.ts`)에 `"unseen"`을 더한다. `unseen`이 켜지거나 꺼질 때 `StateChanged { name: "unseen", id: <sessionRef> }`를 `publishStateChanged`로 낸다.
    - **terminal_sessions/signal** (memory, actors `user`, 사람 자격만. `terminal_sessions/report`처럼 다른 actor는 `forbidden`): 입력 `z.strictObject({ terminal_ref: string min 1, harness: string min 1, title: string | null, kind: "waiting" | "finished" | "failed", active_ms: int>=0 | null })`, 출력 `{}`. `terminal_sessions/report`는 그대로 둔다(목록). route 정의는 `packages/protocol/attention/`에 둔다(session-lifecycle protocol file을 건드리지 않는다).
    - **JobHeld** (Bus event, `transient.ts`): subject는 job id, payload `{ job, run, job_title }`. job의 놓친 차례가 새 `held` 줄로 만들어져 commit된 뒤에 한 번 낸다(이미 있는 held 줄이 갱신될 때는 내지 않는다). 폰 allowlist에는 더하지 않는다(Inbox는 `StateChanged{jobs}`로 이미 다시 읽는다).
    - **push 글과 port 모양**(`packages/core/attention/ports.ts`. `mobile-push-send`는 같은 모양을 자기 file에 따로 적어 두었고, 둘이 맞는지는 `mobile-push-device`가 잇다가 type으로 확인한다. 모양을 바꾸지 않는다):
      ```ts
      export type PushPrefs = { needs_you: boolean; long_finish: boolean; app_update: boolean; job_missed: boolean; app_notify: boolean; quiet_when_present: boolean; show_names: boolean };  // zod schema는 protocol/attention의 prefs.ts에 두고 이것은 그 infer
      export type PushMessage = { to: string; title: string; body?: string; data: { host: string; kind: "session" | "app" | "inbox"; session?: string; app?: string }; channelId: "needs-you" | "finished" | "apps"; priority: "high" | "default"; ttl: number };
      export type PushDevice = { id: string; token: string; prefs: PushPrefs };   // token이 있는 기기만
      export type PushPorts = { devices(): readonly PushDevice[]; send(message: PushMessage): Promise<"sent" | "dropped">; host(): string };
      export type SessionLookup = (session: string) => Promise<{ title: string | null; agent: string | null; harness: string | null; opened_by_app: boolean } | null>;
      export type Attention = { bindPush(ports: PushPorts): void; forgetReporter(principal: string): void };
      ```
      `ctx.attention: Attention`을 late 칸으로 낸다. `bindPush`를 부르기 전에는 아무것도 보내지 않는다(`mobile-push-device`가 부른다). `forgetReporter(principal)`는 그 보고를 지운다(기기 연결이 끊길 때 부른다).

## 할 일

1. `packages/protocol/attention/`: route 넷(`presence/report`, `unseen/list`, `unseen/dismiss`, `terminal_sessions/signal`)과 `pushPrefsSchema`(위 `PushPrefs`, strict)를 `defineMemory`로 짓고 `mod.ts`로 내보낸다. `packages/protocol/mod.ts`의 `ALL_ROUTES`에 더한다. `CHANGE_NAMES`에 `unseen`, `transient.ts`에 `JobHeld`를 더한다(등록 길은 `ShareRequestOpened`가 간 곳을 따라 한다).
2. `JobHeld`: `packages/core/jobs/due.ts`에서 새 `held` 줄을 만드는 곳(`insertJobRun(... state: "held" ...)`)에서만 `tx.port(afterCommit).push(JOB_HELD_TOPIC, ...)`로 싣는다. topic 이름과 push helper는 `packages/core/jobs/ports.ts`에 `JOBS_CHANGED_TOPIC` 옆에 둔다. `wiring/jobs.ts`의 `withAfterCommit`에서 그 topic을 받아 `ctx.peek.bus?.publish(...)`로 낸다(`wiring/apps.ts`의 `ACTIVATION_CONSENT_TOPIC` 처리가 본보기).
3. `packages/core/attention/presence.ts`: `Map<reporter, { at, focused, idle_ms, looking }>`. 항목은 `at`에서 90초가 지나면 없는 것이다(desktop은 30초마다 다시 보고하고, 죽은 desktop이 push를 영원히 막지 않게 하는 안전망이다). 상수 `PRESENCE_TTL_MS = 90_000`, `DESKTOP_IDLE_LIMIT_MS = 120_000`. "present": 폰(`device:`로 시작)은 `focused`, desktop은 `focused`이고 `idle_ms`가 한도 아래(`idle_ms`가 없으면 한도 아래로 본다). 시각은 `Clock`으로 받는다. memory 상태이고 ledger 표를 만들지 않는다.
4. `unseen.ts`: `Map<sessionRef, { kind, at }>`. 켜는 때: 끝난 turn(`TurnEnded`의 `outcome.kind`가 `completed`면 finished, `failed`면 failed. 다른 값은 건너뛴다. `opened_by_app`인 session은 건너뛴다(지금 desktop과 같다))이거나 터미널 signal `finished`·`failed`이고, present인 보고 중 `looking`에 그 session이 든 것이 없을 때. 끄는 때: `TurnStarted`, `SessionEnded`, present인 보고의 `looking`에 새로 들어옴, `unseen/dismiss`. 바뀔 때마다 `StateChanged{unseen}`을 낸다. 승인·질문 대기는 `unseen`을 켜지 않는다(지금과 같다).
5. `triggers.ts`: Bus event와 signal을 "계기"(`Cause`)로 바꾸는 순수 함수. 표:

   | 원인 | 설정 칸 | 채널 | priority | data kind |
   |---|---|---|---|---|
   | `TurnRequestOpened`(승인. `request.to_parent`면 건너뜀. app session은 센다) | `needs_you` | `needs-you` | high | session |
   | `QuestionAsked`(`to_parent`면 건너뜀) | `needs_you` | `needs-you` | high | session |
   | signal `waiting`(터미널) | `needs_you` | `needs-you` | high | session(`term:<탭>`) |
   | `TurnEnded` completed·failed, `active_ms >= 60_000`, `opened_by_app` 아님. signal `finished`·`failed`도 `active_ms >= 60_000`이면 | `long_finish` | `finished` | default | session |
   | `ActivationConsentRequested`, `ShareRequestOpened` | `app_update` | `apps` | default | inbox |
   | `NoticePosted`의 `source`가 program이고 `kind`가 `release_failed`·`release_rolled_back`·`app_unavailable`·`app_data_restored`·`sdk_update_needed`(shell `ALERT_PROGRAM_KINDS`에서 `session_stopped_by_app`만 뺀 것) | `app_update` | `apps` | default | 앱이 있으면 app, 없으면 inbox |
   | `NoticePosted`의 `source`가 app, `read_at`이 null | `app_notify` | `apps` | default | app |
   | `JobHeld` | `job_missed` | `needs-you` | default | inbox |

   session의 제목·agent 이름·`opened_by_app`은 주입한 `SessionLookup`으로 읽는다. 없으면(`null`) 그 계기를 버린다.
6. `message.ts`: 계기와 기기의 `show_names`로 `PushMessage`를 만드는 순수 함수. 글은 고정 문장이고 영어다. 길이는 title 120, body 200으로 자른다. `ttl`은 3600, `data.host`는 `PushPorts.host()`.

   | 원인 | `show_names` 켜짐 title / body | 꺼짐 title / body |
   |---|---|---|
   | 승인 | `{제목} is waiting for you` / `{agent} asks for approval.` | `An agent needs you` / 없음 |
   | 질문 | `{제목} has a question` / `{agent} has a question for you.` | `An agent needs you` / 없음 |
   | 터미널 waiting | `{제목} is waiting for you` / `{harness} needs you.` | `An agent needs you` / 없음 |
   | 오래 돈 turn 끝 | `{제목} finished`(실패면 `{제목} failed`) / `{agent 또는 harness} worked for {N} minutes.`(`N = max(1, round(active_ms / 60000))`) | `An agent finished`(실패면 `An agent failed`) / 없음 |
   | 동의, 공유 요청, program 기록 | `{앱 이름 또는 notice 제목}` 그대로(program 기록은 notice `title`, 동의·공유는 `{앱 이름} is waiting for you`) / `lophn` | `An app needs you` / 없음 |
   | app `notify()` | notice `title` / 앱 이름(notice `body`는 싣지 않는다) | `An app has something for you` / 없음 |
   | job hold | `{job_title} was missed` / `Choose whether to run it now.` | `A job needs you` / 없음 |

   `{제목}`은 session 제목이고 없으면 agent 이름, 그것도 없으면 `An agent`. data는 위 표의 kind에 맞게 `session`(sessionRef) 또는 `app`(앱 id)만 싣는다. 대화 글, 명령, 질문 글, 앱 `body`는 어떤 칸에도 들어가지 않는다.
7. `decide.ts`: `decide({ cause, devices, presence, now, host })`가 보낼 `PushMessage[]`를 돌려주는 순수 함수. 기기마다: token이 있고, 그 원인의 설정 칸이 켜져 있고, 그 기기 자신의 presence가 present가 아니고, `quiet_when_present`가 켜져 있으면 present인 desktop 보고가 하나도 없을 때만 보낸다. 지연은 없다. 첫 판이다.
8. `mod.ts`와 `wiring/attention.ts`: `createAttention`(시각, 기기·보내기·session 조회 port를 받는다)과 `attentionWiring`. wiring은 `ctx.bus.subscribe`로 위 event(`TurnEnded`, `TurnStarted`, `SessionEnded`, `TurnRequestOpened`, `QuestionAsked`, `ActivationConsentRequested`, `ShareRequestOpened`, `NoticePosted`, `JobHeld`)를 듣고 `memory:`에 route 넷의 handler를 올리고(`presence/report`는 `who.principal`을 보고한 쪽으로 쓴다. 새로 `looking`에 든 session의 `unseen`을 끈다), `ctx.provide("attention", …)`로 `Attention`을 낸다. session 조회는 session-lifecycle wiring이 `sessions` 표를 읽는 길(`sessionRowOf`, `workspaceDepsOf`)을 따라 한다. `closeIntake`에서 구독을 푼다. 등록은 위 "한 줄씩 허락"대로.
9. test 셋(아래 "끝남").

## 끝남

- `npm run check`가 통과한다. flows 단계가 새 route와 test file 때문에 막으면 catalog에 최소 항목만 더하고 "넘길 줄"에 적는다(`flows` skill. 문장은 lead가 다듬는다).
- 위험 test:
  - "알릴 자리 정하기 표: present인 desktop이 있으면 `quiet_when_present`가 켜진 기기에 보내지 않고, 90초 넘은 보고나 idle이 한도 넘은 보고는 막지 않고, 앞에 있는 폰은 자기에게만 보내지 않고, 칸마다 꺼진 설정은 보내지 않고, `to_parent`와 app이 연 session의 turn 끝은 계기가 되지 않는다"(`decide_test.ts`)
  - "push 글과 data 어디에도 마지막 답, shell 명령, 질문 글, 앱 notice `body`에 심은 비밀 문자열이 없다"(`message_test.ts`. 계기마다 fixture에 그 문자열을 싣고 직렬화한 `PushMessage` 전체에서 찾는다)
  - "`unseen`은 turn이 끝났을 때 보고 있는 present host가 없을 때만 서고, 다른 host가 새로 보면 꺼지고, 승인·질문 대기로는 서지 않는다"(`unseen_test.ts`)
- subprocess, 서버, 브라우저를 띄우는 test는 만들지 않는다.
- 남지 않음: 지우는 것이 없다(`packages/shell` 쪽 `unseen`은 `mobile-attention-desktop`이 지운다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 만든 route 넷의 입력·출력 예 하나씩, 등록한 줄(`넘길 줄`)과 lead가 고칠 목록(`flows`, `architecture/app-notice.md`, `terminal-agent.md`), `JobHeld`를 낸 자리, `SessionLookup`을 어떻게 구현했는지.
