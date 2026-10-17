# shell

데스크톱 앱(packages/shell)의 화면과 그 source. architecture 문서는 아직 없다.

## 보낸 chip이 대화에 남지 않고 다시 보내기가 chip을 빼고 보낸다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/protocol]
```

지금: composer의 context·위반 chip은 `SendMessage.attached`로만 간다(`packages/shell/renderer/conversation/attached-chips.ts`의 `attachedOf`, `packages/shell/renderer/conversation/agent-tab-core-source-commands.ts`의 `sendText`). core는 그것을 Router 입력 본문 앞의 `<lophn-attached …>` 줄로 만들 뿐 message 본문(`content.parts`)에는 chip이 없다. 그래서 대화 화면에는 보낸 글만 보이고, 같은 file의 `retryTurn`은 본문에서 chip을 다시 만들 수 없어 `attached: []`로 다시 보낸다. 글 없이 chip만 보내면 본문은 chip 라벨뿐이다.

영향: 사람은 어떤 위반·context를 붙여 보냈는지 대화에서 다시 볼 수 없다. 실패한 turn을 다시 시도하면 agent는 처음에 받은 위반(파일·규칙)을 받지 못하고 라벨 글만 본다.

고치려면(작음): 본문의 `attached` part는 이미 있다(`packages/protocol/lophn-agent/message-content.ts`의 `attachedFields`). 대화 화면의 `readBody`가 그 part를 그리고 `retryTurn`도 본문의 part를 복사한다. 모자란 것은 둘이다. (1) `attachedFields`에 optional `context`(ctx id)를 더하고 `sendText`가 chip마다 `attached` part를 본문에 쓴다. (2) `retryTurn`이 본문의 `attached` part로 `SendMessage.attached`를 다시 만든다.

정한 것: 위대로 고친다. 앞서 "보낸 chip은 본문에 남기지 않는다"고 정한 것(agent)을 뒤집는다. 다시 시도한 turn에서 agent가 위반을 잃는 것이 고치는 비용보다 크다. (agent)
