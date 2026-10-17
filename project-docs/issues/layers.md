# layers

core 층과 import 방향(harness, role 층, domain)에 걸린 열린 이슈다. 규칙과 이유는 `project-docs/architecture/layers.md`.

## harness 폴더에 domain protocol import가 9개 file에 남았다

```yaml
kind: defect
modules: [packages/core/lophn-agent, tools]
```

지금: `packages/core/lophn-agent`의 9개 file이 `protocol/{apps,projects}`를 직접 import한다. `tools/check-deps.ts`의 `HARNESS_LEFTOVERS`가 file마다 이유를 달아 면제하고 목록 밖의 새 위반만 막는다(rule `harness-domain`). role 이름 문자열은 harness에 더 남지 않았다.
- 동적 app-api tool: `packages/core/lophn-agent/tools/app-tools.ts`, `packages/core/lophn-agent/tools/app-toolkit.ts`, `packages/core/lophn-agent/tools/app-api/input.ts`(apps의 app runtime·`AppAppApi`).
- agent runtime 권한과 route 목록: `packages/core/lophn-agent/tools/runtime-permissions.ts`(`appDirectSocketPaths`), `packages/core/lophn-agent/run-loop/runtime-access.ts`(projects·apps route 값).
- 범용 tool에 샌 domain 읽기: `packages/core/lophn-agent/tools/bundles/call.ts`·`packages/core/lophn-agent/tools/call/target.ts`(`projectList`·`appList`), `packages/core/lophn-agent/tools/file/image.ts`(`annotationsGet`), `packages/core/lophn-agent/tools/file/read.ts`(`openableKind`).

영향: apps·projects의 route나 type이 바뀌면 harness의 이 file들도 고쳐야 한다. 면제된 file 안에서는 새 domain 지식이 늘어도 check가 막지 못한다.

고치려면: 동적 app-api tool을 apps domain tool로 옮긴다(중간). call·file tool의 domain 읽기는 hook이나 port로 뺀다(중간). route 목록과 권한 계산은 조립이 넘긴다(작음).

정한 것: 지금은 하지 않는다. 면제 목록이 새 위반을 막고, 옮겨서 줄어드는 비용이 구체적이지 않다. 이 file들을 다른 이유로 고칠 일이 오면 그때 같이 옮긴다. (agent)
