# approval

판정(Gate)과 사람에게 묻는 request의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/approval.md`.


## session 도중 끈 MCP server의 tool이 그 session 끝까지 돈다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/core/approvals]
```

지금: tool 목록은 session을 시작할 때 고정한다(`project-docs/architecture/agent-definition.md`). 빠진 앱 tool은 call 때 `judge`(`packages/core/approvals/gate/judge.ts`)가 지금 할당을 읽어 막는다. MCP tool은 `judge`가 늘 `run`을 낸다. MCP server는 설정한 층이 곧 할당이고 끄기는 `mcp_off`라 할당 줄이 없기 때문이다. 연결 쪽 `packages/core/lophn-agent/extensions/mcp-toolkit.ts`의 `call()`은 session 시작 때 고정한 server 상태만 본다. `packages/core/lophn-agent/extensions/mcp-connections.ts`의 `detach`를 `mcp_off` 바뀜에 부르는 곳도 없다. 그런데 `packages/core/lophn-agent/run-loop/prepare.ts`의 `toolsNotice`는 agent에게 "빠진 tool은 … 지금부터 못 쓴다"고 알린다.

영향: 사람이 도는 session의 agent에게서 MCP server(예: 메일 보내기)를 끄면, agent는 그 session이 끝날 때까지 그 server의 tool을 묻지 않고 부를 수 있다. 사람이 거둔 권한이 바로 거둬지지 않는다. 옛 agent grant에는 MCP tool 줄이 있어 Gate가 call 때 막았다.

고치려면:
- `mcp-toolkit.ts`의 `call()`이 부를 때마다 그 agent의 지금 층(`serversOf`)을 읽어 꺼진 server면 거절한다. 작음~중간. call마다 설정 읽기가 하나 는다.
- `mcp_off`·server 설정이 바뀔 때 그 server를 `detach`한다. 중간. 바뀜을 알리는 길을 새로 둔다.

추천: 첫째. 앱 tool이 call 때 지금 할당을 읽는 것과 같은 꼴이다.
