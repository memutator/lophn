# code-health

여러 module에 걸친 코드 건강 이슈다(죽은 이름, 긴 파일, test 준비 코드). 짝이 되는 architecture 문서는 없다.

## 400줄 넘는 파일이 67개다

```yaml
kind: defect
modules: [packages/core/lophn-agent, packages/shell/renderer, packages/protocol, packages/core/apps, packages/core/main, packages/core/problems]
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

정할 것: 400을 기준으로 삼을지, 삼는다면 check로 강제할지.

## `protocol/apps/direct-socket.ts`의 흔적

```yaml
kind: defect
modules: [packages/protocol]
```

지금: 앱 직통 통로는 지웠는데 `protocol/apps/direct-socket.ts`가 남았다. 내용은 `DIRECT_SOCKET_PATHS`를 `channel-values.ts`에서 가져와 다시 내보내는 한 줄과 다른 곳으로 옮겨 가야 할 주석 몇 개(읽기 결과 원천 상태, confirm proof 등)뿐이고, `protocol/apps/mod.ts`가 `export *`로 내보낸다. `mod.ts`는 `channel-values.ts`도 이미 내보내서 같은 이름이 두 길로 나온다. 쓰는 곳은 `core/main/app-supervisor/assembly.ts`(probe, open, close, shutdown 경로) 한 파일이다. 상수 이름 `DIRECT_SOCKET_PATHS`도 지운 직통 통로의 이름이다.

영향: 죽은 이름이 남아 "직통 통로가 아직 있나"로 헷갈린다. 고아 주석은 읽는 사람을 잘못 이끈다.

고치려면: `direct-socket.ts`를 지우고(1줄), `mod.ts`의 export 줄을 뺀다. 상수는 supervisor 제어 경로임을 드러내는 이름으로 바꾼다(쓰는 곳 `assembly.ts`와 `process-wire.ts` 주석). 비용 작다. 추천: 한다.

## test 준비 코드가 길다

```yaml
kind: defect
modules: [packages/core/approvals, packages/core/apps]
```

지금: test 수는 적은데 파일마다 준비 코드(setup)가 길다. `apps/calls/calls_test.ts` 344줄(test 3개, 앞 120줄 남짓의 `setup()`과 helper가 앱 process·invocation ledger를 메모리로 흉내), `approvals/approvals_test.ts` 336줄(test 3개, `openLedger`로 임시 ledger를 열고 `makeKit`으로 조립), `apps/rewind/rewind_test.ts` 278줄(test 4개, `DatabaseSync(":memory:")`와 `setup`), `approvals/gate/gate_test.ts` 250줄(test 2개, 대부분 grant·intent fixture). 쓰는 준비가 파일마다 달라서 "공용 ledger fixture 하나"로 모이는 모양이 아니다. calls와 gate는 ledger를 쓰지도 않는다.

영향: 같은 파일에 test 하나를 더하는 비용이 준비 코드를 읽는 데서 든다. 다만 test를 적게 두는 것이 AGENTS.md의 방향이라 test가 늘 일이 적다.

고치려면:
- A. 공용 fixture로 모은다. 파일마다 준비 모양이 달라 억지로 맞추면 오히려 무거워진다. 비용 중간.
- B. 건드리지 않는다. 그 파일에 test를 더할 때 필요한 만큼만 helper로 뺀다.
- 추천: B. 안 쓰는 test는 AGENTS.md 지침대로 합치거나 지운다.
