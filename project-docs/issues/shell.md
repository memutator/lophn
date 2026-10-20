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

## shell이 문자열로 부르는 core route가 지워져도 check가 잡지 못한다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/renderer, tools]
```

지금: shell main과 renderer는 core route를 `call("read", "<resource>", "<method>", …)`처럼 문자열로 부른다(예: `packages/shell/main/app-frame/app-connection.ts`). route를 지우거나 이름을 바꿔도 type check와 core 기동은 통과한다. `releases.get`을 지운 commit 뒤 데스크톱 앱의 모든 live 앱 화면이 "Couldn't load <앱>"으로 떴고, 나흘 뒤 사람이 앱을 열어 보고서야 드러났다. 안 쓰는 export를 정리하다 화면 셋이 부르던 route를 지운 일도 앞서 있었다. 지금은 worker 지침의 "method를 문자열로도 grep한다"만 막는다.

영향: 사람이 데스크톱 앱에서 그 기능을 쓸 수 없다. e2e는 Electron 화면을 띄우지 않아 보지 못한다.

고치려면: `tools/check-source.ts`에 규칙 하나. shell의 문자열 route 호출(resource·method 짝)을 모아 protocol의 route 목록에 없는 짝을 막는다(작음). 추천.
