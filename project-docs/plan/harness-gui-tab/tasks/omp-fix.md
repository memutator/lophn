# omp-fix

omp adapter가 acp-more 계약을 채운다. 고칠 것은 `audit-omp.md` §4의 1-10, §2 명령 분류(`opens`), §3 model role이다:

- 명령 출력 블록(`command_output`을 4000자 한 줄 `info` 대신 `format: "preformatted"`로. ANSI만 지운다)
- 도는 중 명령(말없이 버리지 않고 queue에 넣거나 알린다)
- 로컬 명령의 빈 turn(turn 밖 notice로)
- subagent(`subagent_progress`·`subagent_event`를 `child_update`로. 읽기는 `get_subagent_messages`, 멈춤은 `cancel_subagent`, 말 넣기는 `steer_subagent`)
- `get_session_stats`를 usage로
- `!cmd`(`bash`로 보내고 멈춤은 `abort_bash`)
- fast/slow(`toggles`), goal, `new_session`, `export_html`
- 승인 mode(`--approval-mode`로 띄우고 `set_mode`는 다시 띄운다)
- TUI 전용 이름 막기
- `abandoned` todo를 `cancelled`로
- role(설정 파일을 읽어 `roles`를 내고, `use_role`을 `/switch @role`로. 정한 것 18: `~/.omp` 설정은 읽기만 하고 쓰지 않는다)
- message `origin`(omp entry id)과 meta `harness`

녹화는 다시 뜬다(정한 것 13·19). 녹화는 lead가 돌린다.

- 단위: adapter (wave 5)
- 선행: acp-more
- 소유(이 task만 고친다):
  - `packages/shell/main/extensions/bundled/harness-gui/omp.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/omp_test.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/fixtures/omp/`
- 읽을 것:
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/audit-omp.md` 전부(§3 role과 경계), `omp.md`(첫 조사)
  - omp 18.8.7 RPC 문서: `audit-omp.md`가 가리키는 `LAB/docs/rpc.md`, `models.md`, `config-usage.md`
  - architecture: `project-docs/architecture/harness-gui.md`, `acp.md`
- 계약:
  - 쓰는 것: acp-more의 명령 칸, `command_output`·turn 없는 notice, subagent detail·`child_update`·`stop_child`·`steer_child`, `toggles`·`set_toggle`, `goal`·`set_goal`, `roles`·`use_role`, `limits`, plan `cancelled`, meta `harness`, message `origin`. `HarnessGuiAdapter`·`HarnessGuiRun`(`adapter.ts`, 바꾸지 않는다)
  - 내놓는 것:
    - adapter 표의 `omp` 칸(이름 그대로)
    - 녹화 script `fixtures/omp/record.ts`. 원본을 `/home/pyosechang/projects/lophn/.cache/harness-gui-recordings/omp-v2/`에 쓰고, model은 omp의 가장 싼 model이다(`--model`). scenario는 `/todo`, `/stats`, `/session`, subagent progress·event, `goal create`, `set_fast_mode`, `bash`, `/switch @smol`이다. role 쓰기는 녹화하지 않는다. worker는 돌리지 않고 scenario 목록을 보고한다

할 일: (살 단계가 채운다)
