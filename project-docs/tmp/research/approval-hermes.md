# approval 조사: Hermes Agent (2026-10-14)

사람(원문 그대로): "그리고 hermes에서도 approval, permissions 관련해서 직접 조사하고 와봐"

- repo: github.com/NousResearch/hermes-agent @ `1f6c02c0` (2026-10-13). lead가 직접 읽었다.
- 근거: `website/docs/user-guide/security.md`("Dangerous Command Approval", "File Write Safety"), `website/docs/user-guide/features/acp.md`("Approvals"), `tools/approval.py`, `tools/delegate_tool_config.py`, `tools/file_tools_write_guards.py`, `website/docs/user-guide/features/{hooks,kanban,cron,computer-use}.md`.

## 1. 무엇을 묻나

묻는 범위가 좁다. 일반 파일 쓰기와 MCP tool 호출은 묻지 않고 돈다.

| gate | 무엇 | 근거 |
|---|---|---|
| 위험한 shell 명령 | 미리 정한 pattern 목록(`rm -r`, `chmod 777`, `DROP TABLE`, `curl … \| sh`, `systemctl stop`, `docker stop`, `bash -c` 등)에 걸린 terminal 명령 | security.md "What Triggers Approval", `tools/approval_detection.py` |
| execute_code | 위험 pattern이 든 script | `tools/approval.py` `_EXECUTE_CODE_GATE` |
| 보호된 지침 파일 쓰기 | `AGENTS.md`, `CLAUDE.md`, `SOUL.md`, `.cursorrules`, project `.hermes`. prompt injection이 오래 남는 길이라 언제나 묻는다 | `tools/file_tools_write_guards.py:177~` |
| `~/.ssh/config` 쓰기 | 키는 막고 client 설정만 묻는다 | security.md "File Write Safety" |
| plugin이 올린 tool call | plugin `pre_tool_call`이 `{"action":"approve"}`를 돌려주면 같은 gate로 간다 | `request_tool_approval`, hooks.md |
| MCP elicitation | MCP server가 tool 도중 입력을 물으면 같은 approval 화면으로 | mcp.md "elicitation" |
| 파괴적 slash command | `/clear`, `/new`, `/reset`, `/undo` | `approvals.destructive_slash_confirm` |

## 2. 판정 순서 (결정적인 층이 먼저)

1. **hardline floor:** 코드에 박힌 목록(`rm -rf /`, fork bomb, `mkfs`, 디스크 `dd`). yolo, `mode: off`, "always" 어느 것으로도 못 연다.
2. **사용자 deny 규칙** `approvals.deny`: glob 목록. yolo보다 먼저 막는다.
3. **yolo:** process 단위(`--yolo`) 또는 session 단위(`/yolo`, session에 저장되어 재시작해도 남음).
4. **allowlist:** 영구 목록 `command_allowlist`(config.yaml)와 session 목록(메모리).
5. **smart mode(선택):** 보조 LLM이 approve, deny, escalate를 낸다. approve는 그 명령 하나에만 쓰고 pattern으로 넓히지 않는다. deny가 연달아 3번이면 "그만 시도하라"는 문구를 붙인다(denial breaker).
6. **사람에게 묻기.**

container backend(docker 등)에서는 위험 명령 검사를 건너뛴다. container가 경계라서다. computer-use 문서는 "LLM 분류는 사람 결정을 대신할 수 없다"고 적는다.

## 3. 선택지와 저장

| 선택 | 범위 | 저장 |
|---|---|---|
| once | 이 호출 하나 | 없음 |
| session | 이 session의 같은 pattern | 메모리, session이 끝나면 지움(`clear_session`) |
| always | 앞으로 모든 session | `config.yaml`의 `command_allowlist`에 씀. 사람이 `hermes config edit`로 보고 지운다 |
| deny (기본) | 이 호출 하나 | 없음. `/deny <이유>`의 이유는 그대로 agent에게 간다 |

ACP 쪽도 같다: `allow_once`, `allow_session`, `allow_always`, `deny`.

## 4. 기다림과 끝

- 묻는 동안 agent thread가 막혀 기다린다. 대기 목록은 session별 메모리 queue이고 저장하지 않는다.
- 기본 timeout 300초. 넘으면 거절로 끝나지만 "사람이 거절"로 세지 않는다. 다시 열 수 없고, 사람이 다시 시키면 새 tool call이 새 카드를 낸다.
- turn이 끊기거나 session이 끝나면 대기 중인 요청은 `cancelled`로 끝난다. 사람 거절과 구별한다.
- 화면이 다시 붙으면 `list_gateway_approvals`로 대기 중인 것을 다시 그린다(snapshot).
- 거절 결과에는 "다시 시도하지 말고, 바꿔 말하지도 말고, 다른 길로 같은 결과를 내지도 말라"는 문구가 붙는다.

## 5. 사람이 없는 실행

- cron, 한 번 실행(`-q`), webhook·API 같은 surface는 답할 사람이 없다. context마다 `deny`(기본) 또는 `approve`를 설정한다. deny면 기다리지 않고 바로 막는다.
- subagent(delegate)는 기본으로 위험 명령을 자동 거절한다(`delegation.subagent_auto_approve: false`).
- cron job은 `--paused`로 만들어 사람이 resume할 때까지 멈춰 둘 수 있다("awaiting operator approval").

## 6. 그 밖

- kanban: 작업 완료는 `review` 상태로 가고 reviewer agent가 보거나, `review_dispatch: false`면 사람이 승인한다.
- `hermes approvals suggest`: 지난 session DB에서 승인한 명령을 모아 allowlist 후보를 낸다. 파괴적 종류는 후보로 내지 않고, 적용은 사람이 고른다.
- hook `pre_approval_request`, `post_approval_response`는 관찰만 한다(알림이나 감사용).

## 7. lophn 초안에 비춰 본 점 (lead)

| Hermes | lophn 초안과의 관계 |
|---|---|
| 묻는 범위가 좁고, 나머지는 묻지 않고 돈다 | 초안은 write와 external app-api를 ask로 뒀다. 되돌릴 수 있는 것(lophn 안 변경, rewind 영수증이 있는 app-api write)은 allow, 되돌릴 수 없는 것(external)만 ask로 좁히는 쪽이 기준 2에 맞다 |
| floor deny → 사용자 deny → allowlist → 묻기 | 초안의 allow/ask/deny 규칙과 같은 모양. deny가 allow보다 먼저 |
| always가 설정 파일에 규칙으로 쓰인다 | 초안은 always를 두지 않자고 했다. always를 두되 Settings 규칙으로 쓰는 쪽이 같은 모양이고 사람이 Settings에서 보고 지운다 |
| timeout 300초 | 막힌 thread 때문이다. lophn은 turn이 기다리고 화면에 대기가 남으니 기한 없이, 끊기면 cancelled로 둬도 된다 |
| cancelled와 거절 구별, 거절 이유 전달 | 초안, approvals 0307·0316과 같다 |
| 사람이 없는 실행은 context마다 deny/approve | lophn은 사람이 desktop app에서 대기 목록을 볼 수 있어 기다려도 된다. Operator의 `interval` automation처럼 오래 비는 실행은 따로 볼 수 있다 |
| smart mode(LLM 판정) | 기준 3(결정적 판정은 program, 결정은 사람)에 맞지 않아 가져오지 않는다 |
| 보호된 지침 파일은 언제나 묻는다 | lophn agent가 agent 지침과 skill을 고치는 것이 같은 자리다. 후보 |
