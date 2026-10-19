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
