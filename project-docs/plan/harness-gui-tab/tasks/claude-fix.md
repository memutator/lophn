# claude-fix

Claude adapter가 acp-more 계약을 채운다. 고칠 것은 `audit-claude.md` §4 adapter 1-11과 §5.4 A-F다:

- 명령 분류(내장 고정 목록에 `source: "harness"`와 `opens`, skill·plugin·MCP·custom 출처, SDK `aliases`, TUI 전용 숨김)
- 명령 출력(`SDKLocalCommandOutputMessage`를 `command_output`으로, turn이 없을 때 버리지 않기, `/usage`·`/cost`는 adapter가 답, `/context`는 `getContextUsage`를 `usage.context.parts`로)
- subagent(`parent_tool_use_id` 메시지를 Agent tool call id를 `child`로 하는 `child_update`로)
- todo(TodoWrite를 `plan_changed`로)
- background task와 멈추기(`background_tasks_changed`를 `tasks_changed`로, `stop_task`를 `stopTask`로)
- `/clear`(같은 탭에서 resume 없는 새 query)
- 사용 한도(`rate_limit_event`)
- 알림(`system/informational` 등을 `info`로)
- message `origin`(SDK uuid)과 meta `harness`

녹화는 다시 뜬다(정한 것 13·19). 녹화는 lead가 돌린다.

- 단위: adapter (wave 5)
- 선행: acp-more
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/claude.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/claude_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/claude/`
- 읽을 것:
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/audit-claude.md` 전부(§1 원인, §2 기능표, §4, §5 명령 분류와 §5.4), `claude.md`(첫 조사)
  - SDK type: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, `sdk-tools.d.ts`
  - 앞 녹화 원본: `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/`(README의 scrub 규칙)
  - architecture: `project-docs/architecture/harness-gui.md`, `acp.md`
- 계약:
  - 쓰는 것: acp-more의 명령 칸, `command_output`·`info.level`·turn 없는 notice, subagent detail·`child_update`·`stop_child`, `tasks`·`tasks_changed`·`stop_task`, `limits`·`context.parts`, plan `cancelled`, meta `harness`, message `origin`. `HarnessGuiAdapter`·`HarnessGuiRun`(`adapter.ts`, 바꾸지 않는다). Agent SDK 0.3.318
  - 내놓는 것:
    - adapter 표의 `claude` 칸(이름 그대로)
    - 녹화 script `fixtures/claude/record.ts`. 원본을 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/claude-v2/`에 쓰고, model은 haiku다. worker는 돌리지 않고 scenario 목록을 보고한다

할 일: (살 단계가 채운다)
