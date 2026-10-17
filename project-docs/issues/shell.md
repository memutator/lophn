# shell

데스크톱 앱(packages/shell)의 화면과 그 source. architecture 문서는 아직 없다.

## context chip이 agent에게 chip으로 전해지지 않는다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/lophn-agent]
```

지금:
- 새 session 첫 말: `conversation/agent-view.tsx`의 `ensureSession`이 `openSession({id, contexts: chips})`를 부르지만 `conversation/agent-tab-core-source-sessions.ts`의 `openSession`은 `contexts`를 버리고 `opening_context: null`로 연다. 첫 말은 `agent-tab-core-source-commands.ts`의 `sendText`가 `attached: []`로 보낸다. chip은 쓴 글이 없을 때 보낼 글감(`chipText`, 라벨만)으로만 쓰인다.
- 열린 PM session: `workspace/workspace.tsx`의 `askPm`은 draft가 비어 있을 때만 위반 줄을 `파일 - 규칙` 글로 채운다(새 PM 탭은 `openAgent(... chips)`로 chip이 붙는다). `workspace/reactions/project-manager.ts`는 열린 session이 있으면 chip도 글도 없이 탭만 고른다. 열린 PM session 찾는 함수가 두 곳(`openedPmSession`, `openedSession`)에 따로 있다. composer는 `session === null`일 때만 chip을 그린다.

계약은 이미 있다: `SendMessage.attached`가 `context`·`violation` chip을 받는다.

영향: PM이나 lophn에게 context나 위반을 chip으로 붙여 말해도 agent는 chip을 모르고 글 라벨만 본다. 같은 위반이 열린 session에서는 글이고 새 탭에서는 chip이라 PM이 받는 모양이 다르고, 열린 session의 draft에 글이 있으면 위반이 아예 안 실린다.

고치려면: `sendText`가 chip을 `attached`로 싣고 composer가 열린 session에서도 chip을 그려 보낼 때 같이 싣는다. `ContextChipView`에 context id가 없어(`id`는 위반 key나 check id) 필드를 더해야 한다. 열린 PM session 찾는 함수는 하나로 합친다. 중간, 계약 변경 없음. 추천: 이 안.
