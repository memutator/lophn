# acp: App Context Protocol, agent와 화면 사이의 lophn 규격

- 목표: agent 쪽이 내놓는 것(turn, 메시지와 content block, tool 진행, 묻기·승인, 흘러나오는 글, 상태)과 화면이 보내는 것(입력)을 protocol의 ACP로 정한다. core가 ACP를 만들고 lophn 채팅 화면은 ACP만 보고 그린다. 뒤에 앱 화면(단계 5)과 third-party CLI GUI(단계 8)가 같은 규격을 쓴다.
- 재료: `project-docs/products/roadmap/agent-platform.md` 단계 4(사람의 원문 "지금은 renderer가 다 알아서 그리는 게 아니라 그런 lophn acp protocol이 정립되어 있으면 third-party-cli에다 gui를 덮어씌우기도 쉽다"). 코드 사실과 path는 task brief에 있다.
- 범위 밖: 앱 화면의 ACP와 SDK(단계 5), third-party host가 ACP를 내는 일(단계 8), session 관리 조작(fork, rewind, model 바꾸기, compact)은 ACP 입력이 아니다. 표준 Agent Client Protocol이 아니다.

## 정한 것

1. ACP는 `packages/protocol/acp/`에 있다: 상태(`AcpState`: 항목 목록, turn, 대기, 묻기), 갱신(`AcpUpdate`), 입력(`AcpInput`), 순수 reducer `reduceAcp`. block은 `contentBlockSchema`다. (agent)
2. core가 만든다. snapshot은 core route `AcpSnapshot`이 기록에서 만들고, 갱신은 core가 AgentEvent에서 순수 projection으로 만들어 transient event로 낸다. renderer는 snapshot과 갱신만 읽는다(지금 renderer의 `readThread`, `foldEvent`, 이름으로 tool을 가르는 code를 지운다). (agent)
3. 항목마다 session 안의 순번이 있고 순서는 그것으로 정한다(시각 merge를 지운다). (agent)
4. tool은 종류를 갖는다: `edit`, `call`, `question`, `consent`, 그 밖은 `generic`. 종류마다 화면에 필요한 칸만 싣고 큰 본문은 따로 읽는다. renderer는 tool JSON을 parse하지 않는다. (agent)
5. 승인 결과와 rewind로 숨은 것도 ACP 항목이다. 기록에서 만들 수 있으면 만들고, 없으면 기록을 더한다(새 ledger step). snapshot과 갱신이 같은 상태를 낸다. (agent)
6. ACP 입력은 대화 조작뿐이다: 보내기(content block, 앱 context는 `resource` block), 멈추기, 다시 하기, 묻기 답, 승인 결정, 대기 고치기. (agent)
7. `MessageReceived.body`도 content block으로 바꾸고 쓰는 곳(approvals, runs, bare-reply wiring)을 같은 변경에서 고친다. harness가 주체인 대기 거르기는 core(ACP)에서 한다. (agent)
8. 흘러나오는 글의 redaction은 지금 core `live-turns.ts` 규칙 그대로이고 ACP에 redaction 안 된 글이 나가지 않는다. (agent)

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `acp-protocol` | ACP schema, reducer, AgentEvent → 갱신 projection |
| 2 | `acp-core` | core snapshot route, 갱신 transient event, tool 종류·승인 결과·숨김을 core로 |
| 3 | `acp-chat-screen` | 채팅 화면이 ACP만 읽는다. renderer의 해석 code와 fake source를 ACP로 |
| 4 | `acp-input` | 화면 조작을 `AcpInput`으로, 문서 |

## lead가 할 일

- merge마다: 새 `architecture/acp.md`(무엇이 ACP이고 누가 만들고 누가 읽나), `agent-chat.md`, `event.md`를 고친다. boundary·module catalog, registry에 올린다.
- 다 끝나면: `agent-platform.md` 단계 4를 끝남으로 적고, change-log 열린 판에 적고, 계획 폴더를 지운다.
