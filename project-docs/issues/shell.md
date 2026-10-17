# shell

데스크톱 앱(packages/shell)의 화면과 그 source. architecture 문서는 아직 없다.

## 보낸 chip이 대화에 남지 않고 다시 보내기가 chip을 빼고 보낸다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/protocol]
```

지금: composer의 context·위반 chip은 `SendMessage.attached`로만 간다(`packages/shell/renderer/conversation/attached-chips.ts`의 `attachedOf`, `packages/shell/renderer/conversation/agent-tab-core-source-commands.ts`의 `sendText`). core는 그것을 Router 입력 본문 앞의 `<lophn-attached …>` 줄로 만들 뿐 message 본문(`content.parts`)에는 chip이 없다. 그래서 대화 화면에는 보낸 글만 보이고, 같은 file의 `retryTurn`은 본문에서 chip을 다시 만들 수 없어 `attached: []`로 다시 보낸다. 글 없이 chip만 보내면 본문은 chip 라벨뿐이다.

영향: 사람은 어떤 위반·context를 붙여 보냈는지 대화에서 다시 볼 수 없다. 실패한 turn을 다시 시도하면 agent는 처음에 받은 위반(파일·규칙)을 받지 못하고 라벨 글만 본다.

고치려면: message 본문에 `attached` part(ctx id 포함)를 더해 화면이 그리고 `retryTurn`이 다시 싣게 한다. protocol(`content.parts`)과 core의 본문 처리, 대화 화면을 같이 고친다(중간). 추천: 사람이 chip을 다시 보거나 다시 보내기가 실제로 아쉬워질 때 한다.
