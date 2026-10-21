# approval

판정(Gate)과 사람에게 묻는 request의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/approval.md`.


## shell floor deny가 `rm -rf /`의 그 글자 모양만 막는다

```yaml
kind: bug
modules: [packages/protocol, packages/core/approvals]
```

지금: `packages/protocol/approvals/shell-rules.ts`의 `PRODUCT_SHELL_RULES.floor`는 `rm -rf /`, `rm -rf ~`, `rm -rf ~/`, `rm -rf /\*`, `rm -rf ~/\*`, `mkfs*`, `dd * of=/dev/*`, fork bomb이다. `packages/core/approvals/gate/shell-match.ts`의 `shellRuleMatches`는 공백만 줄이고 글자를 그대로 맞춘다. 그래서 `rm -fr /`, `rm -r -f ~`, `rm -rf --no-preserve-root /`, `sudo rm -rf /`는 floor에 맞지 않고 제품 기본 ask(`rm -r*`, `rm -fr*`)에만 맞는다. `judge`(`packages/core/approvals/gate/judge.ts`)는 ask를 unattended·skip에서 `run`으로 바꾼다.

영향: skip session이나 unattended run에서 agent가 flag 순서만 다른 `rm -fr ~`를 실수로 부르면 묻지도 막지도 않고 사람의 home이 지워진다. AGENTS.md "속도"가 막으라는 agent 실수(데이터 잃기)다. skip은 이 계획의 wave 3, unattended 입구는 `headless-run`부터 열린다.

고치려면:
- floor에 flag 순서 변형을 더한다(`rm -fr`, `rm -r -f`, `rm -f -r`, `--no-preserve-root`, `sudo` 앞붙임 × `/`, `~`, `~/`, `/\*`, `~/\*`). 작음. 목록이 길어지고 다른 변형(`$HOME`, `/home/<사람>`)은 여전히 빠진다.
- `rm`의 짧은 flag 묶음을 정규화한 뒤 맞춘다(`-fr`·`-r -f`를 `-rf`로). 작음~중간. roadmap "하지 않는 것"의 명령 parser에 한 걸음 다가간다.
- 그대로 둔다. roadmap "규칙은 실수를 줄일 뿐 경계가 아니다".

추천: 첫째에서 `rm -fr`·`rm -r -f`·`rm -f -r`와 `sudo` 앞붙임만 더한다. 계약 file 한 곳의 목록이고, 사람 없는 run에서 home을 잃는 길 가운데 흔한 것을 닫는다.

정할 것: floor 목록을 넓힐까(제품 동작. floor는 사람도 덮지 못한다).

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
