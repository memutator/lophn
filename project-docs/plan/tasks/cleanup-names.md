# cleanup-names

계획 README 3장이 정한 이름 바꾸기(turn, steer, app-api, `project_manager`, tool 이름 철자)가 코드 끝까지 됐는지 grep으로 확인하고 남은 것을 고친다. implementation-inventory 5장 "만들지 않는 것"과 ui-inventory 4장 "만들지 않는 UI"가 코드에 남지 않았는지도 본다.

- 단위: cleanup (wave 4)
- 선행: cleanup-dead (옛 정의를 먼저 지워야 남은 이름이 진짜 남은 것이다)
- 소유(이 task만 고친다):
  - `packages/` 전체, `tools/` 전체 (저장소 전체. cleanup은 혼자 돈다)
  - 고치지 않는 것: `deno.json`, `deno.lock`, 각 package의 `deno.json`, `AGENTS.md`, `project-docs/`
- 읽을 것:
  - inventory(lead가 맞추며 더함): `I2.8#10`
  - 결정: `../README.md` 3장 #18·#23·#57(이름), #41(tool 이름 철자), #17(남지 않는 event `AppViewChanged`)
  - spec(새 이름이 쓰이는 모양): S3 `turn`·`steer` — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-call.md`, S5 `app-api` — `.../app-call.md`, S4 tool 이름 — `.../agent-definition.md`, S8 Project Manager — `.../place-session.md`, S1 event — `.../event.md`
  - 만들지 않는 것 목록: `/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md` 5장, `/home/pyosechang/projects/lophn/project-docs/tmp/ui-inventory.md` 4장
  - inventory 줄: 없음 (cleanup은 줄 배정이 없다)
  - 지금 코드: `packages/`, `tools/`
- 계약:
  - 쓰는 것: wave 2에서 고정된 이름 (`packages/protocol/**`). 이 task가 새 이름을 만들지는 않는다.
  - 내놓는 것: 없음

## 할 일

1. **기준선**: `deno task check:full`이 통과하는지 본다.
2. **이름 바꾸기가 끝까지 됐는지 본다.** 아래 표의 grep을 돌려 남은 줄을 하나씩 판정한다. 판정은 세 가지다: (가) 옛 뜻이 남은 것 → 새 이름으로 고친다 (나) 다른 뜻의 같은 낱말 → 그대로 둔다 (다) 고치면 새 설계와 어긋날 것 → 고치지 말고 보고한다. 새 이름으로 고칠 때는 protocol → core → shell/sdk/coding-agent → tools 순서로 한 단계씩 `deno task check`를 통과시키고 commit한다. 호환 장치(옛 이름 읽기)는 만들지 않는다.

   표의 grep 씨앗에서 `\|`는 markdown 표 때문에 이스케이프한 `|`(또는)다. `grep -E`에는 `|`로 넣는다.

   | 옛 이름 | 새 이름 | grep 씨앗 | (나) 로 보는 것 |
   |---|---|---|---|
   | `run` (model 한 번의 실행) | `turn` | `\bRun[A-Z]\|\brun_id\|\bRunId\|\bruns\b\|AcceptRun\|RunAccepted\|run-loop\|run_\|\brunId\b` (protocol/lophn-agent의 `runs.ts`·`run-*.ts`, `core/lophn-agent/run-loop`, schema의 `runs` 표) | `deno run`, `Deno.run`, `runtime`, `test-runner`, `runner`, "동작시키다"의 동사 `run`, `RunMetadata`(core 기동 위치 metadata) |
   | `correction` | `steer` (보내기는 `next_turn`과 `steer`) | `correction\|Correction` (66줄 안팎) | 일반 영어 "correction" 문구가 아닌지 본다 |
   | `command` (앱 호출) | `app-api` (blueprint JSON 칸까지) | `blueprint.*commands\|CommandButton\|app_command\|appCommand\|app-command\|\bcommands:` 중 **앱 호출**을 뜻하는 것 | ledger의 command/read(CQRS의 `CommandDefinition`, `command(...)` 쓰기), `Deno.Command`, CLI subcommand, slash command(`/recap`) |
   | Context Engineer | `project_manager` (표시 이름은 Project Manager) | `context_engineer\|ContextEngineer\|Context Engineer\|context-engineer\|contextEngineer` (89 file 안팎) | 없음. 모두 고친다. wording 문장은 `catalog/*.ts`에서 "Project Manager"로 |
   | tool wire 이름의 `.` | `_` (정본은 `context.get`처럼 `.`, model에 보내는 이름만 `_`) | tool registry를 만드는 곳과 provider adapter가 이름을 바꿔 보내는 곳 | 정본 이름이 `_`로 적혀 있거나 wire 이름이 `.`로 나가는 곳이 있으면 고친다. 거꾸로 찾는 표(registry)가 있는지 본다 |
   | `AppViewChanged`, `ApprovalRequested`, `SettingsChanged` (남지 않는 event 이름) | — | 이름 그대로 | 남지 않는 event는 `ALL_EVENTS`에 없어야 한다 |

3. **만들지 않는 것이 코드에 남았는지 본다.** `implementation-inventory.md` 5장의 각 줄에서 코드에 나올 낱말을 뽑아 grep한다. 남았으면 그것과 그것만 쓰던 코드를 지운다. 새 설계가 쓰는 것이면 남기고 보고한다. 씨앗은 아래다. 목록이 전부는 아니다. 5장 표를 줄마다 본다.

   | 5장 줄 | grep 씨앗 |
   |---|---|
   | notification, OS notification, notification chip | `notification`, `Notification`, `notification-chip`, `os-notification` |
   | Things to confirm 화면 | `things-to-confirm`, `ThingsToConfirm` |
   | install-and-update의 update 적용 (단일 instance lock과 data root 검사는 남는다) | `updateNotice`, `UpdatePackage`, `stopForUpdate`, `settings/update`, `lock-check`, `sandbox-check`의 update용 쪽 |
   | 앱 automation | `automation`, `Automation`, `automatic_tasks`, `AutomationPermits`, `cap-schedule` |
   | 앱 화면 상태를 operator context로 보내는 SDK capability | `screen_context`, `ScreenContext`, `agent_context`, `agent-context` |
   | 설정 고치기 tool | agent/skill/grant/설정을 고치는 tool 이름을 `protocol/lophn-agent`의 tool 목록과 `core/lophn-agent/tools`에서 찾는다 |
   | 시각 블록(표, 차트, 도표) | `visuals`, `VisualBlock`, `visual_source`, `visual-spec` (앱 카드는 남는다) |
   | session 되살리기(archive 풀기) | `unarchive`, `reopenSession`, `restoreSession` |
   | 사람용 package 화면 | `renderer`의 package 목록·상세 화면 |
   | project 검색의 취소·snippet redaction·건너뛴 파일 알림·50개씩 이어 보기 | `search`의 `cancel`, `snippet`, `skipped`, `next_cursor`(검색 쪽) |
   | event 쪽 (visibility, 구독 저장, ack, 내부 구독, agent event 저장·replay, 반응 rule engine) | `visibility`, `EventVisibility`, `internal-subscription`, `InternalSubscription`, `api-subscriptions`, `events/list`(renderer가 ledger를 읽는 길), `rule engine` |
   | approval 쪽 (기한, 이력, `decided_by`, LLM judge) | `expires_at`(approval), `decided_by`, `approvalTtl`, `llm-judge`, `LlmJudge` |
   | agent call 쪽 (상태 `sent`·`declined`, 실패 이유 `busy`, 동기 호출, 기본 timeout, durable queue, stall 감시) | `declined`, `"busy"`, `stall`, `durable` |
   | rewind 쪽 (invocation 하나만 되돌리기, release를 넘는 rewind, redo) | `redo`, `revertInvocation`, 앱 data를 session rewind가 저절로 되돌리는 길 |
   | coding agent 쪽 (앱 하나에 coding session 여럿, worktree, 화면 출력으로 idle 짐작, PTY를 살려 두는 daemon, 권한 mode 정하기, heartbeat 실패 처리) | `worktree`, `idle`(화면 출력 기준), `heartbeat`, `permission_mode` |
   | AGENTS.md 읽기, subagent | `AGENTS.md`를 읽는 코드, `subagent` |
   | `ui-inventory.md` 4장 (Settings Update 탭, Tasks 탭, 화면마다 둔 agent 부르기 단추, context 만드는 중 화면, 문서의 판·비교·복원, 놓친 toast 다시 띄우기 등) | 4장 표의 낱말 |

4. **마무리**: `deno task check:full`, 부팅 확인(`/home/pyosechang/projects/lophn/project-docs/plan/tasks/core-wiring-trim.md` 1번 명령)이 기준선과 같다.
5. (lead가 맞추며 더함 (`I2.8#10`)) API 경로의 major

## 끝남

- `deno task check:full`이 통과한다.
- 위험 test: 없음 (이름 바꾸기와 지우기다. type check가 잡는다)
- 남지 않음 (표의 (나)로 판정한 줄은 이유를 보고에 쓴다):
  - `grep -rnE "context_engineer|ContextEngineer|Context Engineer|context-engineer|contextEngineer" packages tools`가 0줄이다.
  - `grep -rniE "\bcorrection" packages tools --include=*.ts --include=*.tsx`가 0줄이다 (일반 문구 제외).
  - `grep -rnE "AppViewChanged|ApprovalRequested|SettingsChanged" packages tools`가 남지 않는 event 목록이 아닌 곳에서 0줄이다.
  - `grep -rniE "notification|things-to-confirm|automation|screen_context" packages tools --include=*.ts --include=*.tsx`가 (나)로 판정한 줄 밖에서 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음 (protocol의 목록이 바뀌면 그 목록을 적는다)
- 안 쓰게 된 export: 없음
- 정한 것: 표마다 (가) 몇 줄, (나) 몇 줄과 대표 이유, (다) 목록
- 계약 바꾸기 요청: (다)로 판정한 것 — 새 이름이 spec과 다르게 굳은 곳, 계약에 두 이름이 있는 곳
