# shell

데스크톱 앱(packages/shell)의 화면과 그 source. architecture 문서는 아직 없다.

## 사람이 만든 agent의 home session이 런처에서 lophn 얼굴로 보인다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

지금: home(place 없음) session은 런처의 lophn 패널에서만 연다(`packages/shell/renderer/desktop/main.tsx`의 `openSession`). 패널은 `packages/shell/renderer/desktop/launcher/lophn-panel/lophn-panel.tsx`에서 `factory({ assignment: "lophn", place: { kind: "global" } })`로 lophn source 하나만 만든다. 사람이 만든 agent의 home session(place 없는 `call`, job의 `agent_run`, CLI `lophn agent run --agent <이름>`이 연다)을 열면 그 session을 lophn의 source로 읽는다.

영향: 사람이 그 session을 열면 머리와 composer가 lophn 이름과 얼굴을 보이고, session 목록에도 lophn의 session만 보여 그 agent의 대화를 찾기 어렵다.

고치려면:
- 패널이 연 session의 agent(session store `SessionEntry.agent`)로 source를 고른다(작음, 패널 하나). 런처에서 home의 다른 agent를 고르는 길은 없다.
- 런처에 home의 agent select를 둔다(중간, 화면을 새로 그린다).
- 추천: 앞의 것. 여는 길이 이미 session id라 그 session의 agent를 쓰면 된다.
