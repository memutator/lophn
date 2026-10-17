# code-health (닫음)

## 400줄 넘는 파일이 67개다

```yaml
kind: defect
modules: [packages/core/lophn-agent, packages/shell/renderer, packages/protocol, packages/core/apps, packages/core/main, packages/core/problems]
closed: kept
guard: 없음
```

지금: `packages/` 아래 `.ts` 1811개 중 400줄 넘는 것이 67개다(test 파일은 없다). 가장 긴 열 개:

| 줄 | 파일 |
|---|---|
| 1274 | `packages/shell/renderer/conversation/agent-tab-fake-source.ts` |
| 1194 | `packages/shell/renderer/workspace/contexts/fake-source.ts` |
| 1157 | `packages/protocol/projects/context-api.ts` |
| 1106 | `packages/core/main/app-supervisor/assembly.ts` |
| 1048 | `packages/core/lophn-agent/extensions/mcp-connections.ts` |
| 1038 | `packages/core/problems/reporting/worker/collector.ts` |
| 1030 | `packages/core/lophn-agent/providers/oauth.ts` |
| 882 | `packages/core/lophn-agent/register.ts` |
| 819 | `packages/core/apps/control.ts` |
| 814 | `packages/core/lophn-agent/run-loop/prepare.ts` |

module별로는 core/lophn-agent 19, shell/renderer 13, protocol 9, core/apps 7, core/main 5, core/problems 4 순이다. 위 둘(fake-source)은 화면 fixture 데이터라 나눠도 이득이 작다. 줄 수 한도는 AGENTS.md에도 tools의 check에도 없다.

영향: 읽고 고치는 비용이 든다(worker의 context도 먹는다). 조립 파일(`assembly.ts`, `register.ts`, `prepare.ts`)이 길어 한 번에 읽기 부담스럽다.

고치려면:
- A. 한도를 정하고 check로 막는다. 67개를 한 번에 나눠야 해 비용 크다. 프로토타입 속도와 맞지 않는다.
- B. 나누지 않는다. 그 파일에 기능을 더하러 들어갈 때 같은 변경에서 나눈다. 비용 0.
- C. 가장 긴 비-fixture 파일 몇 개(`context-api.ts`, `assembly.ts`, `mcp-connections.ts`, `collector.ts`, `oauth.ts`)만 지금 나눈다. 파일당 반나절.
- 추천: B. 한도 check는 두지 않는다.

닫음: 남긴다. 줄 수 기준을 두지 않고 check로 막지 않는다. 기능을 더할 때 필요하면 나눈다.

## `protocol/apps/direct-socket.ts`의 흔적

```yaml
kind: defect
modules: [packages/protocol]
closed: fixed
guard: 없음
```

지금: 앱 직통 통로는 지웠는데 `protocol/apps/direct-socket.ts`가 남았다. 내용은 `DIRECT_SOCKET_PATHS`를 `channel-values.ts`에서 가져와 다시 내보내는 한 줄과 다른 곳으로 옮겨 가야 할 주석 몇 개(읽기 결과 원천 상태, confirm proof 등)뿐이고, `protocol/apps/mod.ts`가 `export *`로 내보낸다. `mod.ts`는 `channel-values.ts`도 이미 내보내서 같은 이름이 두 길로 나온다. 쓰는 곳은 `core/main/app-supervisor/assembly.ts`(probe, open, close, shutdown 경로) 한 파일이다. 상수 이름 `DIRECT_SOCKET_PATHS`도 지운 직통 통로의 이름이다.

영향: 죽은 이름이 남아 "직통 통로가 아직 있나"로 헷갈린다. 고아 주석은 읽는 사람을 잘못 이끈다.

고치려면: `direct-socket.ts`를 지우고(1줄), `mod.ts`의 export 줄을 뺀다. 상수는 supervisor 제어 경로임을 드러내는 이름으로 바꾼다(쓰는 곳 `assembly.ts`와 `process-wire.ts` 주석). 비용 작다. 추천: 한다.

정한 것: 지운다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

닫음: `protocol/apps/direct-socket.ts`와 고아 주석을 지우고, `DIRECT_SOCKET_PATHS`를 supervisor 제어 경로 네 칸만 둔 `CONTROL_PATHS`로 바꿨다.
