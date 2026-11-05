# codex-fix

Codex adapter가 acp-more 계약을 채운다. 고칠 것은 `audit-codex.md` §3의 1-9와 §2 명령 분류다:

- 명령 분류(`model`, `permissions`, `usage`, `agents`, `mcp`, `diff`, `ps`, `stop`, `init`, `clear`를 더하고 `opens`를 단다. TUI 전용은 넣지 않는다)
- 명령 출력(`/status`, `/mcp`, `/ps`, `/diff`, `/usage`를 `command_output`으로)
- `/review` 글(`exitedReviewMode.review`)
- subagent(자식 thread item을 `child_update`로, collab·`subAgentActivity`를 subagent detail로, 멈추기)
- plan mode 상태(`toggles`), goal(get/clear, `thread/goal/updated`, `set_goal`)
- 사용 한도(`account/rateLimits/read`·`updated`를 `limits`로)
- `imageGeneration` item
- elicitation·권한 요청을 사람에게 보이기
- 경고 notification(`warning`, `configWarning`, `model/rerouted`)을 `info`의 `level: "warning"`으로
- message `origin`(Codex item id)과 meta `harness`

녹화는 다시 뜬다(정한 것 13·19). 녹화는 lead가 돌린다.

- 단위: adapter (wave 5)
- 선행: acp-more
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/codex.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/codex_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/codex/`
- 읽을 것:
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/audit-codex.md` 전부(§0-3, "ACP에 더할 것", "adapter·화면에서 고칠 것"), `codex.md`(첫 조사)
  - 앞 녹화 원본: `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/codex/`와 README의 scrub 규칙
  - architecture: `project-docs/architecture/harness-gui.md`, `acp.md`
- 계약:
  - 쓰는 것: acp-more의 명령 칸, `command_output`·`info.level`·turn 없는 notice, subagent detail·`child_update`·`stop_child`·`steer_child`, `limits`, `toggles`·`set_toggle`, `goal`·`set_goal`, meta `harness`, message `origin`. `HarnessGuiAdapter`·`HarnessGuiRun`(`adapter.ts`, 바꾸지 않는다)
  - 내놓는 것:
    - adapter 표의 `codex` 칸(이름 그대로)
    - 녹화 script `fixtures/codex/record.ts`. 원본을 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/codex-v2/`에 쓰고, model은 Codex의 가장 싼 model이다. scenario는 review, compact, goal, plan mode toggle, collab subagent(spawn → wait → close), rate limit read다. worker는 돌리지 않고 scenario 목록을 보고한다

할 일: (살 단계가 채운다)
