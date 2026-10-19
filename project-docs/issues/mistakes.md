# mistakes

worker가 크게 잘못한 것. 코드가 아니라 context(AGENTS.md, skill, architecture 문서)나 check를 고친다.

## 안 쓰는 export를 지우며 화면이 문자열로 부르던 route를 지웠다

```yaml
kind: mistake
modules: [packages/protocol, packages/shell, tools]
```

지금: protocol의 안 쓰는 export를 지운 변경이 route `app.blueprint`(`apps/blueprint`)를 지웠다. 화면 셋은 그 route를 resource·method 문자열로 불러 type check가 보지 못했다: `packages/shell/renderer/apps/core-source.ts`의 `entryScreen`(`call(core, "read", "blueprint", …)`), `packages/shell/renderer/app-frame/app-views.tsx`, `packages/shell/renderer/workspace/agents/core-grants.ts`(`link.read("apps", "blueprint", …)`). 모두 `not_found`로 실패해 앱 공간의 첫 화면, 앱 화면 목록, agent grant의 앱 목록이 비었다. 같은 출력의 route `app.app_api`가 있어 method만 바꿔 고쳤다(계획 `domain-tools`).

영향: check와 core 기동이 통과한 채 화면 기능 셋이 조용히 비었고, 다른 계획의 worker가 우연히 찾을 때까지 남았다.

원인: "쓰는 곳 없음"을 import로만 판정했다. route는 화면에서 문자열(resource, method)로 부르는 길이 있는데 지침에 그 grep이 없었다.

막기: route를 지우거나 이름을 바꾸는 task는 `grep -rn '"<method>"' packages/shell tools tests`로 문자열 호출을 같이 본다. 이 문장을 orchestrate skill "worker에게 꼭 넣을 것"과 `prompt.py`의 지운 이름 grep 줄에 더했다. 다시 생기면 화면의 문자열 호출을 route 객체(`readOf(core, <route>, …)`)로 바꿔 type check가 잡게 한다.

## wire 칸을 지우고 harness driver의 보내는 쪽을 남겼고, 그 실패를 옛 이슈에 붙였다

```yaml
kind: mistake
modules: [packages/core/problems, packages/protocol]
```

지금: 계획 `domain-tools`가 앱 process wire(`ProcessCallRequest`)에서 `context.project`를 지웠다. 앱 runtime의 `parseProcessCall`은 모르는 칸을 거절한다. 그런데 app test harness의 `packages/core/problems/tests/work/app-driver.ts`는 control socket 호출 셋(`rejectsInvalidInput`, `rewind`, `call`)의 body를 type 없는 object literal로 만들어 `project: null`을 계속 실었다. check와 core 기동은 통과했고, main에서 모든 앱의 `rewind`·`examples` 검사가 깨졌다(`blueprint_handler_match`는 거꾸로 공짜 통과). lead는 손 확인에서 이 실패를 열린 이슈 "write app-api의 rewind 검사가 fail로 나온다"와 문구가 같다고 보고 detail을 읽지 않은 채 그 이슈의 "막힌 앱"으로 적었다. 원인은 계획 `rewind-check`의 진단에서 나왔다.

영향: examples ticket이 모두 확인되지 않고 template 앱도 활성화되지 않은 채 main에 남았다. 사람이 이슈의 방향을 잘못된 근거로 다시 정할 뻔했다.

원인:
- wire 칸을 지운 task의 brief가 보내는 쪽 목록을 core 호출 길과 앱 runtime까지만 적었다. harness driver는 같은 wire를 따로 만드는데 type을 걸지 않아 type check가 못 봤다.
- 실패 이름과 문구가 같으면 같은 원인이라고 본 것. detail은 token으로 읽히지 않았지만 disk의 blob에는 있었다.

막기:
- 계획 `rewind-check`의 `rc-wire`가 driver의 세 body에 `satisfies ProcessCallRequest`를 건다(check로 막는다).
- `issue` skill "같은 이슈를 찾는다"에 "겉 문구가 같아도 detail을 읽어 원인이 같은지 본 뒤 덧붙인다"를 더했다.
