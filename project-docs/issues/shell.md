# shell

데스크톱 앱(packages/shell)의 화면과 그 source. architecture 문서는 아직 없다.

## 대화 입력창의 붙이기 단추가 아무 일도 하지 않는다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/design]
```

지금: `packages/shell/renderer/conversation/composer/agent-composer.tsx`가 붙이기 단추(`conversation.button.attach`, `onAttach`)를 그린다. host는 둘 다 빈 함수다(`packages/shell/renderer/workspace/kinds/agent.tsx`와 `packages/shell/renderer/app-frame/side-panel.tsx`의 `attach: () => {}`). 붙인 것(`attached`) 기구는 지웠다.

영향: 사람이 대화 입력창의 + 단추를 눌러도 아무 일도 일어나지 않는다.

고치려면: 단추와 `onAttach`, host의 `attach`, wording key `conversation.button.attach`를 지우고 wireframe을 맞춘다(작음). 추천. 붙이기 기능을 만들 때 다시 더한다.
