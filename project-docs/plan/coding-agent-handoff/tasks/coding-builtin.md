# coding-builtin

사람이 즐겨찾기한 coding agent를 정의 file 없이 부를 수 있는 전역 내장 agent로 만들고, headless 실행에서 lophn이 강제하던 permission mode flag를 뺀다. `agent.card` not_found 메시지, `lophn agent create` help, 편집기 잠금을 같이 고친다.

- 단위: agents (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/workspaces.ts`
  - `packages/protocol/lophn-agent/agent-values.ts`
  - `packages/protocol/lophn-agent/agent-definitions.ts`
  - `packages/protocol/coding-agent/headless/`
  - `packages/core/lophn-agent/agents/`
  - `packages/core/lophn-agent/tools/work.ts`
  - `packages/core/lophn-agent/tools/work_test.ts`
  - `packages/core/lophn-agent/tools/registry_test.ts`
  - `packages/core/config/shell-settings.ts`
  - `packages/core/config/mod.ts`
  - `packages/core/agent-workspaces/workspace/`
  - `packages/cli/commands/agent.ts`
  - `packages/shell/main/extensions/bundled/harness/host.ts`
  - `packages/shell/renderer/workspace/agents/editor/`
  - `packages/shell/renderer/workspace/agents/agent-key.ts`
  - `packages/design/i18n/catalog/agents.ts`
- 읽을 것:
  - `project-docs/plan/coding-agent-handoff/README.md`의 "정한 것"
  - architecture: `project-docs/architecture/agent-definition.md`(정의 꼴, 내장 lophn, handle), `project-docs/architecture/coding-agent.md`(harness agent, 결정 18·22, headless 명령), `project-docs/architecture/agent-call.md`(handle 풀기, call 정책)
- 계약:
  - 쓰는 것: `HARNESS_ADAPTERS`, `HARNESS_ADAPTER_OF_RUNTIME`(`packages/protocol/coding-agent/harness-adapter.ts`), `harnessEnabledIn`(`packages/core/lophn-agent/session/harness.ts`)
  - 내놓는 것: `agentIdSchema`가 `coding_<harness id>` 꼴을 받는다. `packages/core/config/mod.ts`가 `codingAgentsSetting`(`shell.coding_agents`)을 export한다(task `tui-handoff`가 읽는다). 내장 coding agent의 handle은 harness id(`claude`, `codex`, `opencode`)다.

## 할 일

1. id: `packages/protocol/lophn-agent/workspaces.ts`의 `agentIdSchema`에 내장 coding agent id `coding_<harness id>`를 더한다. headless runtime이 있는 harness(`HARNESS_ADAPTER_OF_RUNTIME`의 역)만 된다: `coding_claude`(runtime `claude-code`), `coding_codex`, `coding_opencode`. 그 id를 만들고 가르는 helper(`isCodingBuiltin` 같은 것)를 `isLophn` 옆에 둔다.
2. 정의: `packages/core/lophn-agent/agents/inspect.ts`의 `loadAgent`·`listAgents`·`handleOf`·`nameOf`·`profileOf`에 내장 coding agent를 더한다. file이 없으면 기본 정의는 `{runtime: <그 harness의 runtime>, description: <한 줄>}`이고 범위는 전역(`workspace: null`)이다. handle은 harness id, name은 adapter label이다. file이 있으면(사람이 고친 것) 그 file을 읽되 handle·runtime·workspace는 내장 값이 이긴다.
3. 보이기: `listAgents`(목록, 명함, "Agents you can call", handle 풀기가 쓰는 쪽)는 `extensions.harness.enabled`가 켜지고 그 harness id가 `shell.coding_agents.favorites`에 있을 때만 내장 coding agent를 낸다. `shell-settings.ts`의 `codingAgentsSetting`을 export하고 `config/mod.ts`로 낸다. 설정은 이미 있는 file settings reader로 읽는다. 끈 뒤에도 id로 읽기(`loadAgent`, `agents/read`, `AgentDirectory.agent(id)`)는 된다: 열린 session과 harness host(`packages/shell/main/extensions/bundled/harness/host.ts`의 `agents/read`)가 계속 돈다. `agents/read`가 내장 coding agent id를 file 없이 돌려주는지 확인하고, host.ts가 따로 고칠 것이 없으면 건드리지 않는다.
4. 예약과 잠금: 세 handle(`claude`, `codex`, `opencode`)을 예약 이름에 더해 사람·agent가 새로 만들 때 `invalid_input`이다. 내장 coding agent는 지울 수 없고 고칠 때 handle·runtime·workspace를 바꿀 수 없다(내장 lophn이 하는 방식을 그대로 따른다, `commands.ts`·`validate.ts`). agent 자격의 `agent.update`가 내장 coding agent를 고치는 것은 lophn과 같은 규칙이다.
5. 편집기: `packages/shell/renderer/workspace/agents/editor/`에서 내장 coding agent는 lophn 편집기처럼 handle·runtime·범위를 잠그고 Delete를 빼며 이름은 바꿀 수 있다. `agent-key.ts`에 id 판별이 필요하면 더한다. 문구는 `packages/design/i18n/catalog/agents.ts`.
6. `agent.card` not_found: `packages/core/lophn-agent/agents/card.ts`의 `cardByHandle`이 not_found일 때 message를 `unknown agent handle "<h>"; agents you can call: <handle, …>`로 한다(그 자리에서 보이는 것만). `packages/core/lophn-agent/tools/work.ts`의 `INPUT_SCOPED_FAILURES`에 `agent.card`를 더해 tool 결과 summary에 core message가 실리게 한다. 기대값이 바뀐 `work_test.ts`·`registry_test.ts`를 고친다.
7. `lophn agent create` help(`packages/cli/commands/agent.ts`): runtime 설명에 `claude-code`, `codex`, `opencode`(harness가 켜졌을 때, 그 CLI로 headless 실행)를 적고, 즐겨찾기 coding agent는 만들지 않아도 이미 handle `claude`·`codex`·`opencode`로 부를 수 있다고 한 줄 적는다.
8. headless 권한: `packages/protocol/coding-agent/headless/claude.ts`에서 `--permission-mode acceptEdits`를 뺀다. `--allowed-tools "Bash(lophn *)"`와 deny → `--disallowed-tools`는 남긴다. `codex.ts`에서 새 실행의 `-s workspace-write`와 resume의 `-c sandbox_mode="workspace-write"`를 뺀다. `-c sandbox_workspace_write.network_access=true`는 남긴다(사람의 sandbox가 workspace-write일 때 `lophn`이 core에 닿게). `headless_test.ts`의 "전부 허락 flag를 내지 않는다" 검사는 그대로 둔다. 바뀐 주석을 고친다.

## 끝남

- `npm run check:full`이 통과한다.
- 위험 test:
  - "즐겨찾기에 없거나 harness가 꺼져 있으면 내장 coding agent가 목록과 handle 풀기에 없고, 켜고 즐겨찾기에 있으면 handle `claude`가 `coding_claude`로 풀린다"(`agents/` 안 test 하나)
  - "내장 coding agent의 handle·runtime·workspace를 바꾸는 저장과 지우기는 거절된다"
  - "사람이 handle `claude`로 agent를 새로 만들면 invalid_input이다"
- 남지 않음: `grep -rn "acceptEdits" packages/protocol/coding-agent/headless`가 0줄. `grep -rn "workspace-write" packages/protocol/coding-agent/headless`는 `network_access` 줄만 남는다.

## 보고

[brief-template.md](../../../../.claude/skills/orchestrate/brief-template.md)의 "보고" 꼴.
