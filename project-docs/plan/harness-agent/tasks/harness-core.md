# harness-core

core 쪽 바탕: 정의의 `runtime`이 harness 값을 받고, Router가 그 session의 입력을 harness 입력함에 두고, shell host가 core route로 turn과 메시지를 기록한다.

- 단위: harness (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{agent-values,message-content,mod}.ts`, 새 `packages/protocol/lophn-agent/harness-host.ts`
  - `packages/core/lophn-agent/agents/{definition-file,resolve}.ts`(+test), `packages/core/lophn-agent/run-loop/prepare.ts`(harness는 run-loop가 돌리지 않는다는 guard)
  - `packages/core/router/{ports,router}.ts`(+test), `packages/core/lophn-agent/session/**`(외부 session id, ledger step)
  - `packages/core/config/setting-declarations.ts`(설정), `packages/core/main/daemon/wiring/`의 새 harness wiring과 `assembly.ts`
  - `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`, `agent-call.md`, `coding-agent.md`
  - 선례: `packages/core/main/daemon/wiring/bare-reply.ts`(turn 끝 답), router의 `TargetSession.transport`, `InputTransport`
  - 제품 결정: 계획 README 정한 것 1~4, 6
- 계약:
  - 쓰는 것: `AGENT_RUNTIMES`(`agent-values.ts:114`), `HARNESS_ADAPTERS` id
  - 내놓는 것: shell 내부 route `HarnessTake`(입력 하나 꺼내기), `HarnessStartTurn`, `HarnessRecord`(메시지, `harness_tool` part), `HarnessFinishTurn`, `HarnessSetExternalId`, 설정 `harness.enabled`, part kind `harness_tool`

## 할 일

1. `AGENT_RUNTIMES`에 `claude-code`, `codex`, `opencode`. serializer와 resolve, 편집기의 runtime 고르기는 설정이 켜졌을 때만 harness 값을 낸다.
2. Router: runtime이 harness인 session은 transport `harness`이고 입력(call, run, step, 사람 메시지)은 그 session의 입력함에 쌓인다. 설정이 꺼져 있으면 그 session으로 보내는 call은 `unavailable`.
3. route(정한 것 2): shell 내부 principal만, runtime이 harness인 session만. turn은 시작 → 기록 → 끝 순서이고 `TurnEnded`는 한 번이다. 재시작하면 끝나지 않은 harness turn은 끊긴 것으로 끝난다.
4. 기록: 메시지와 `harness_tool` part(gate·rewind chain 없음). 외부 session id column은 새 ledger step id.
5. 답: `result` call이면 turn 끝에 bare 자동 답(`bare-reply.ts`)과 같은 길로 마지막 메시지가 답이다(harness가 먼저 reply했으면 하지 않는다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "host route는 runtime이 harness가 아닌 session을 고치지 못한다"
  - "harness turn의 `TurnEnded`는 한 번이고 재시작하면 끝나지 않은 turn이 끊긴 것으로 끝난다"
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
