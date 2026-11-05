# opencode-fix

OpenCode adapter가 acp-more 계약을 채운다. 고칠 것은 `audit-opencode.md` §3의 1-7과 §2 명령 분류다:

- 명령 분류(client 명령을 `source: "harness"`와 `opens`로. 이것으로 `/undo`, `/redo`, `/new`가 산다. `models`, `variants`, `agents`, `usage`, `status`, `stats`, `mcps`, `skills`, `export`, `clear`를 더한다)
- 명령 출력(`/status`, `/stats`, `/mcps`, `/export` 경로를 `command_output`으로)
- todo(`todowrite`를 `plan_changed`로. 다시 열 때는 마지막 완료 `todowrite`)
- subagent(자식 session 이벤트를 `child_update`로, subagent detail, 멈추기는 자식 session의 `session.interrupt`)
- 되살리기(`/redo`와 `session.revert.cleared`를 `hidden_restored`로)
- `api.command`의 delivery·첨부
- 사용 한도(`usage.limits`), auto-accept(`toggles`)
- message `origin`(OpenCode message id)과 meta `harness`

녹화는 다시 뜬다(정한 것 13·19). 녹화는 lead가 돌린다.

- 단위: adapter (wave 5)
- 선행: acp-more
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/opencode.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/opencode_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/opencode/`
- 읽을 것:
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/audit-opencode.md` 전부, `opencode.md`(첫 조사)
  - 앞 녹화 원본: `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/opencode/`와 README의 scrub 규칙
  - architecture: `project-docs/architecture/harness-gui.md`, `acp.md`
- 계약:
  - 쓰는 것: acp-more의 명령 칸, `command_output`·turn 없는 notice, subagent detail·`child_update`·`stop_child`, `hidden_restored`, `limits`, `toggles`·`set_toggle`, meta `harness`, message `origin`. `HarnessGuiAdapter`·`HarnessGuiRun`(`adapter.ts`, 바꾸지 않는다)
  - 내놓는 것:
    - adapter 표의 `opencode` 칸(이름 그대로)
    - 녹화 script `fixtures/opencode/record.ts`. 원본을 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/opencode-v2/`에 쓰고, model은 `openrouter/deepseek/deepseek-v4.1-flash-1017`이다(`gemini-4-argon`은 쓰지 않는다). scenario는 server 명령(`/init`이나 `/review`), todowrite, subagent 한 번, compact, undo→redo다. worker는 돌리지 않고 scenario 목록을 보고한다

할 일: (살 단계가 채운다)
