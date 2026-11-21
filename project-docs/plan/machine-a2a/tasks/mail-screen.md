# mail-screen

다른 컴퓨터로 보낸 call과 다른 컴퓨터에서 받은 call을 화면에 보인다: 보낸 쪽 call card는 기계 이름과 상태(아직 닿지 않음, 대기 목록에서 기다림, 도는 중, 모름)를 실시간으로 보이고 [Open conversation]이 그 기계의 session을 연다. 받는 쪽 session은 누가 어느 기계에서 보냈는지를 보낸 쪽 chip으로 보인다.

- 단위: mail (wave 1)
- 선행: mail-router
- 소유(이 task만 고친다):
  - `packages/protocol/acp/items.ts`
  - `packages/core/main/daemon/wiring/acp-build.ts`
  - `packages/shell/renderer/conversation/thread/{call-block.tsx,sender-chip.tsx,thread.module.css}`
  - `packages/shell/renderer/conversation/{agent-tab-source.ts,agent-tab-core-source-calls.ts,agent-tab-core-source-bodies.ts,agent-tab-core-source.ts,agent-tab-fake-source.ts,thread-layout.ts,agent-thread.tsx}`
  - `packages/design/i18n/catalog/conversation.ts`
  - `tools/wireframes/pages/screens/conversation.tsx`
- flows(줄만 고친다): call card와 보낸 쪽 chip을 그리는 `ui:` flow(`node tools/flows.ts index --area shell-workspace`로 찾는다)의 steps·outcome
- 읽을 것:
  - 계획 README "정한 것", roadmap `a2a-multi-device.md` "보이는 것"
  - `project-docs/plan/machine-a2a/tasks/mail-router.md` "계약"(`CallTarget`의 remote, `CallFrom`의 remote, `agentCallRowSchema`의 `delivery`·`remote_session`, 세 실패 이유, `StateChanged{agent_calls}`)
  - architecture: `project-docs/architecture/agent-call.md` 지키는 것 35(call 블록), `project-docs/architecture/remote.md` "desktop에서 다른 기계 보기"(창이 다른 기계를 부르는 길, 기계를 실은 탭 열기)
  - 본보기(화면): `tools/wireframes/pages/screens/conversation.tsx`(gallery가 renderer component를 가짜 source로 그린다), `packages/shell/renderer/desktop/connection/waiting/notice-action.ts`의 `runToastAction({kind: "session", session, machine})`(다른 기계의 session 열기)
  - skill: `.claude/skills/ui-design/SKILL.md`
- 계약:
  - 쓰는 것: `mail-router`가 고정한 protocol(`calls.ts`, `mail.ts`), route `calls/read`, `StateChanged` change 이름 `agent_calls`
  - 내놓는 것: ACP call 항목(`packages/protocol/acp/items.ts`의 `kind: "call"`)에 `remote: z.strictObject({ machine: idSchema("mch"), computer: z.string(), delivery: z.enum(MAIL_DELIVERIES).nullable(), session: id.nullable() }).nullable()`. 이 기계 안의 call은 null이다. 폰도 같은 schema를 읽으므로 칸 이름을 바꾸지 않는다.

## 할 일

1. ACP: `items.ts`의 call 항목에 `remote` 칸. `acp-build.ts`의 `call.send` 갈래는 input에 `on`이 있으면 `to` 글을 "<agent 또는 session> on <on>"으로 만들고, 읽은 행의 `to.kind === "remote"`면 `remote`를 `{machine: to.machine, computer: to.computer, delivery, session: remote_session}`으로 채운다.
2. source: `agent-tab-source.ts`의 `CallStatus`에 `remote: { machine, computer, delivery, session } | null`. `agent-tab-core-source-calls.ts`의 `readCallState`가 행에서 채운다. `thread-layout.ts`가 ACP 칸을 옮긴다. `agent-tab-fake-source.ts`에 다른 컴퓨터로 보낸 call 넷(pending, held, running, unknown)과 실패 하나(old_version)를 더한다.
3. call card(`call-block.tsx`):
   - 머리 줄의 받는 곳 뒤에 기계 이름(`remote.computer`).
   - 끝나지 않은 다른 컴퓨터 call은 상태 한 줄: pending "Not delivered yet. It goes when <computer> is reachable.", held "Waiting in <computer>'s Inbox for the person to start it.", running "Running on <computer>.", unknown "Sent to <computer>; not known whether it arrived." 세 실패 이유의 글은 `mail-router`가 넣은 key를 쓴다.
   - 상태는 실시간이다: 그 call의 `StateChanged{agent_calls, id}`를 받으면 `callState`로 다시 읽는다(agent 탭이 core event를 듣는 길을 찾아 쓴다. 그 길이 없으면 끝나지 않은 다른 컴퓨터 call만 5초마다 다시 읽는다. 정한 것에 적는다).
   - [Open conversation]: 다른 컴퓨터 call은 `remote.session`이 있을 때만 서고 그 기계의 session을 연다(`onOpenSession(session, machine)`으로 넓히고 `agent-thread.tsx`가 기계를 실은 열기로 넘긴다).
4. 받은 session의 보낸 쪽: `agent-tab-source.ts`의 `Sender`에 `{ kind: "remote", computer: string, name: string, session: string | null, machine: string }`. `agent-tab-core-source-bodies.ts`의 `senderOf`가 `CallFrom`의 remote를 이것으로 바꾼다(`mail-router`의 임시 갈래를 대신한다). `sender-chip.tsx`의 이름은 "<name> on <computer>"이고 panel은 보낸 기계와 session id를 보이며 session이 있으면 그 기계의 session을 연다. 사람 메시지처럼 그리지 않는다.
5. sidebar: 다른 기계에서 연 session은 지금 그 기계의 묶음에 기계 꼬리표(`MachineTag`)와 함께 선다. gallery의 shell 화면에서 mail로 열린 session이 그 기계 묶음에 보이는지만 확인하고 새 sidebar UI는 만들지 않는다(정한 것: 가장 적은 새 UI. 보고에 확인한 결과를 적는다).
6. 글은 i18n catalog `conversation.ts`에. gallery `conversation.tsx`에 다른 컴퓨터 call의 상태 넷과 받은 쪽 chip이 보이는 장면을 더한다.

(lead가 더함, `mail-router` 보고에서) 보낸 쪽이 `remote`인 입력의 표시를 끝까지 맞춘다. `mail-router`는 shell의 `agent-tab-core-source-bodies.ts`의 `senderOf`만 최소로 맞췄고(`{kind: "agent", agent: null, name: "<name> (<computer>)"}`), ACP 쪽(`acp-project.ts`의 live 변환과 `acp-build.ts`의 이력 만들기)은 remote 보낸 쪽을 이름 없이 낸다. live와 이력이 같은 이름("<agent 이름> · <컴퓨터 이름>")을 내게 한다. 추가 소유: `packages/core/main/daemon/wiring/acp-project.ts`가 소유에 없으면 그 file의 보낸 쪽 변환 범위만.

## 끝남

- `npm run check`가 통과한다. renderer build(`node packages/shell/renderer/build.ts`)가 된다.
- 위험 test: 없음(화면).
- 남지 않음: 다른 컴퓨터에서 온 보낸 쪽을 `kind: "agent"`로 그리는 `mail-router`의 임시 갈래가 없다(`grep -n "remote" packages/shell/renderer/conversation/agent-tab-core-source-bodies.ts`의 갈래가 `kind: "remote"`만 만든다). `tests/`의 e2e 기대값에 call 항목 모양이 있으면 `remote` 칸을 맞춘다(`grep -rn "fail_reason" tests/e2e`로 본다).
- `npm run wireframes`가 되고 gallery의 conversation page가 다른 컴퓨터 call card를 그린다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(gallery `pages/index.ts` 등). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(실시간 길, sidebar 확인 결과)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
