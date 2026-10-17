<!--
판 하나에 파일 하나: <version>.md (예: 0.2.0.md). 버전은 0.MINOR.PATCH다. MINOR는 기능이 생기거나 계약이 바뀔 때,
PATCH는 버그만 고칠 때 올린다. 판을 닫는 때는 사람이 정하고, 닫으면 git tag v<version>을 단다.
동작이나 계약이 바뀐 것과 결정을 사람과 agent가 읽도록 남긴다. 코드 수준의 세부는 commit에 있다.

항목은 commit마다가 아니라 일(계획이나 task) 하나에 하나다. 그 일의 마지막 commit에 넣는다.
- 쓴다: 사람이나 agent가 겪는 동작, 계약(route, event, schema, tool), 저장 모양이 바뀌었을 때. 결정이 있었을 때(코드가 그대로여도).
- 쓰지 않는다: 동작이 같은 리팩터링, 주석, test 정리, 포맷.
- 항목을 넣은 commit은 git blame으로 찾는다.

append-only다.
- 열린 판(status: open)에는 항목을 끝에 덧붙이기만 한다. 앞 항목이 틀렸으면 바로잡는 항목을 새로 덧붙인다.
- 닫힌 판(status: released)은 고치지 않는다.

항목의 yaml block
- modules: 일 전체의 diff에서 동작이나 계약이 바뀐 module-catalog path. boundary는 module-catalog로 따라간다.
  코드 없이 결정만 남기는 항목은 []
- checked: modules 때문에 change_reasons가 걸려 봤지만 고칠 것이 없던 context-component-registry ID.
  고친 조각은 commit diff에 path로 남으니 적지 않는다
-->
---
version: 0.2.0
status: open
released_at: null
---

# 0.2.0

## <바뀐 것 한 줄>

```yaml
modules: [packages/core/approvals]
checked: [agent-role]
```

사람이나 agent가 겪는 동작, 계약(route, event, schema, tool), 저장 모양의 전과 후.

- 전:
- 후:

왜: 이 변경을 한 이유.

결정:
- <정한 것>. 버린 길: <다른 안과 버린 이유>. 사람이 정하지 않고 agent가 추천안으로 진행한 것은 끝에 (agent)를 붙인다.

후속: 이 변경 때문에 다른 쪽이 할 일(개발 data 지우기, 앱 다시 build 등). 없으면 "없음".
