# shell

데스크톱 앱(packages/shell)의 화면과 그 source. architecture 문서는 아직 없다.

## 사람이 만든 agent의 home session이 런처에서 lophn 얼굴로 보인다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

지금(uo-home 전): home(place 없음) session은 런처의 lophn 패널에서만 열었고 패널은 lophn source 하나만 만들었다. 패널은 없어졌고 Home session은 agent 탭으로 열린다(`packages/shell/renderer/desktop/main.tsx`의 `openSession` → Home의 `PlaceWindow`가 `agentRow`로 그 session의 agent를 찾아 연다). 다른 agent의 Home session이 맞게 열리는지 확인하고 닫는다. 사람이 만든 agent의 home session(place 없는 `call`, job의 `agent_run`, CLI `lophn agent run --agent <이름>`이 연다)을 열면 그 session을 lophn의 source로 읽는다.

영향: 사람이 그 session을 열면 머리와 composer가 lophn 이름과 얼굴을 보이고, session 목록에도 lophn의 session만 보여 그 agent의 대화를 찾기 어렵다.

고치려면:
- 패널이 연 session의 agent(session store `SessionEntry.agent`)로 source를 고른다(작음, 패널 하나). 런처에서 home의 다른 agent를 고르는 길은 없다.
- 런처에 home의 agent select를 둔다(중간, 화면을 새로 그린다).
- 추천: 앞의 것. 여는 길이 이미 session id라 그 session의 agent를 쓰면 된다.

## 일하는 중 보낸 이미지만 든 사람 메시지가 대기 줄에서 빈 줄로 보인다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/lophn-agent]
```

지금: `MessageReceived` event의 `body`는 글 block만 이은 글이다(`packages/core/lophn-agent/run-loop/work.ts`의 `blocksText(input.body)`). live 경로(`packages/shell/renderer/conversation/agent-tab-data.ts`)는 그 글로 대기 메시지의 `summary`를 채운다. 그래서 agent가 일하는 중에 이미지만 붙여 보낸 메시지는 snapshot을 다시 읽기 전까지 대기 줄이 비어 있다. snapshot 경로는 본문 part로 `[image]`를 보인다.

영향: 사람은 방금 보낸 메시지가 대기 줄에 빈 줄로 보여 무엇을 보냈는지 알아보지 못한다. 데이터는 잃지 않는다.

고치려면:
- event의 `body`를 `blocksSummary(input.body)`로 채운다(작음, core 한 줄). live 메시지 목록도 본문을 읽기 전까지 `[image]`를 보인다.
- event에 block을 싣는다(중간, event 계약이 바뀐다).
- 추천: 앞의 것.
