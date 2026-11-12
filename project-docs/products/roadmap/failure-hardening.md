# 실패 대응: 다른 harness가 막아 둔 실패를 lophn에 대어 본 뒤 남은 것

상태: 로드맵. 계획 `failure-hardening`(`project-docs/plan/failure-hardening/`)이 고칠 것을 가져갔고, 이 문서는 그 계획에 넣지 않은 것과 이유를 둔다. 계획이 끝나도 이 문서는 남는다.

## 재료

- 조사 보고서: `../harness-lab/_report/error-handling/`(저장소 밖). harness 15개가 막아 둔 실패 201개를 lophn `33e6a0f4c`에 대어 본 것. 요약은 그 폴더의 `README.md`, `lophn.md`.
- 지금 코드 대조: `research_notes/error-handling-verify/`(`agent-loop.md`, `tools-session.md`, `runtime.md`, `terminal.md`, `harness-gui.md`). 2026-11-12에 main `25edb533d`에서 보고서의 `없음`·`부분` 항목 115개를 코드를 열어 다시 확인했다. 항목 번호는 조사 보고서의 영역별 번호다.
  - 그대로 있다 98, 일부만 있다 16, 보고서가 틀렸다 1. 30 commit 사이 고쳐진 것은 없다.
  - 보고서의 권고 가운데 틀린 것이 여럿이다(writer가 죽으면 `ctx.shutdown()`, 주기 GC에 sweep 넣기, `recovery/daily-*` backup, harness-gui의 `ctx.log`, `close` event로 바꾸기 등). 고친 내용은 대조 file의 "Audit corrections", "Surprising"에 있다.

## 계획에 넣지 않은 것

### 사람이 이미 정했다

| 항목 | 무엇 | 정한 곳 |
|---|---|---|
| tools #32 | unattended turn이 `ask` shell 명령(`rm -r*`, `git push --force`, `git reset --hard`, `curl \| sh`)을 묻지 않고 돌린다 | `project-docs/architecture/approval.md` 지키는 것 5와 결정, 사람 2026-10-21(`ask`를 바꾸지 않고 floor deny를 넓힌다). 조사가 더한 것: 기본으로 거절하거나 보류하는 harness가 5/9다 |
| tools #31 | attended 승인 대기에 timeout이 없다 | `project-docs/architecture/approval.md` 하지 않는 것 |
| loop #30 | 기본 model 호출 상한이 없다 | `project-docs/products/change-log/0.14/drop-turn-work-time-limit.yaml` |
| tools #42 | 자식 turn의 실패가 부모 call의 실패로 가지 않는다 | `project-docs/architecture/agent-call.md`. 고치려면 `fail_reason` CHECK가 있는 표 넷을 다시 만든다 |

### 사람이 정해야 넣을 수 있다

| 항목 | 무엇 | 정할 것 |
|---|---|---|
| loop #40, #14 | provider 실패 본문을 남기지 않아 원인을 모른다. 모르는 칸을 400으로 거절하는 gateway에서 그 기능만 끄고 다시 보내지 못한다 | secret 경계 규칙을 바꾼다. 이슈 `provider-failure-body-not-kept`의 안 C |
| tools #27 | 읽은 뒤 바뀐 file을 그대로 덮어쓴다. 읽지 않은 file도 덮어쓴다 | 막으면 agent가 쓰기 전에 꼭 읽어야 한다. 기본으로 막는 harness는 2/9 |
| loop #16 | 잔액·plan 한도로 거절된 provider에 Retry와 새 turn마다 같은 요청이 다시 간다. 상태를 남기는 command(`RecordProviderAvailability`)는 부르는 곳이 없다 | 남겨서 보내기 전에 막으면, provider가 reset 시각을 주지 않을 때 결제한 뒤에도 최대 1시간 막힌다. reset 시각을 아는 경우만 막을지. 기본으로 남기는 harness는 3/9 |
| loop #34 | 동료 session끼리 `call send`를 끝없이 주고받을 수 있다 | 상한의 뜻(연쇄 길이, 같은 쌍의 횟수)과 거절 문구. 아무 harness도 하지 않는다 |
| runtime #26(a) | ledger의 주기 backup이 없다 | disk를 ledger 크기의 몇 배 더 쓴다 |
| runtime #17 | `memory_limit_bytes`를 선언만 하고 적용하지 않는다 | 적용하면 agent runtime이 새로 OOM으로 죽을 수 있다. 지우면 protocol 칸이 없어진다 |
| runtime #9 | core의 event loop가 멈춰도 shell은 `ready`로 본다 | 새 화면 상태("core가 답하지 않는다")가 필요하다 |
| runtime #22 | Linux에서 GUI로 띄운 앱의 PATH에 rc file의 것이 없다 | 고치면 느린 rc file에서 시작이 최대 5초 멈춘다 |
| terminal #17 | hook이 오지 않으면 탭이 running·waiting에 머문다 | 몇 분 뒤 상태를 지울지 |
| harness-gui #18, #36 | 멈추지 않는 harness를 강제로 끝내는 단추, 죽은 GUI를 다시 띄우는 단추 | 화면 |
| harness-gui #23 | CLI가 스스로 끝나면 그 CLI가 띄운 background 명령이 남는다 | 정리하면 사람이 일부러 띄운 것도 같이 끝난다 |

### 다른 이슈가 이미 가졌다

- terminal #25, #30, #43: 이슈 `windows-hook-cmd-tui-toggle`.
- terminal #21: 이슈 `nested-harness-session-enters-tab-recent`.

### 하는 곳이 적거나 잃는 것이 작다

지금은 하지 않는다. 실제로 겪으면 이슈로 연다.

- loop #15(fallback model), #32(비용 상한): 기본으로 하는 곳이 0~1곳이다.
- runtime #1(turn 밖 예외의 fail-fast 정책): 업계가 반반이다. #5(app supervisor가 SIGKILL로 죽으면 app이 남는다): 확인하지 못한 추정이다. #31(rewind 기록 실패를 알리지 않는다): 아무도 하지 않는다.
- harness-gui #3(login 안 됨 문구), #4(version 불일치), #21(앱 crash 뒤 고아 reap), #31(입력 key 중복), #33(공통 실패 꼴).
- terminal #22(hook 없는 Esc), #24(Claude hook event version gate), #29(`CLAUDE_CONFIG_DIR`·`CODEX_HOME`), #31(hook 설치 실패 이유 표시), #39(TUI crash 뒤 terminal mode).
- runtime #27·#33의 화면 쪽(저장소 오류 종류별 toast). 계획은 오류 글에 원인만 싣는다.

### 보고서가 틀렸거나 이미 된다

- loop #36: 사람 message 글은 64 KiB, image는 5 MiB로 이미 막는다.
- terminal #33: renderer가 같은 크기의 resize를 이미 거른다.
