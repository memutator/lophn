# issue-sweep

- 목표: 열린 이슈를 주제별로 나눠 한 번에 고친다. 사람이 쓰면서 본 것(폰의 대화·목록·터미널·앱 화면, harness GUI)을 먼저 담고, 같은 file을 고치는 이슈를 한 task에 모은다.
- 재료: `project-docs/issues/<id>.yaml`(task brief가 id로 가리킨다. `fix`의 추천안과 `decided`가 할 일이다), 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`, change-log `issue-sort`의 결정.
- 단위: task 하나가 단위 하나다. 소유 path는 brief가 정한다.

## 정한 것

- 폰의 터미널 크기는 Paseo의 규칙(폰이 열면 잡고 컴퓨터가 focus하면 다시 잡는다, 폰이 떠나면 되돌린다). 폰에 보내고 그리는 방식은 그대로다. (사람의 방향, 세부는 agent)
- 폰에서 연 coding session과 터미널은 그 project를 보이는 창이 없으면 창을 focus 없이 하나 열어 거기에 연다. (사람)
- 폰의 새 session 화면은 단추 둘(workspace, agent)이고 coding agent와 Terminal은 agent 목록의 item이다. coding agent는 첫 메시지를 보낼 때 연다. (사람)
- 폰 앱 화면의 머리 줄은 lophn만 그린다. (agent, 사람의 메모 방향)
- 폰은 목록·이름·아이콘만 file로 두고 대화 내용은 저장하지 않는다. (사람)
- 긴 coding session은 답이 한도를 넘으면 오류로 답하고(wave 1), tool 본문을 펼칠 때 받게 한다(wave 2). (사람)
- Claude의 `/remote-control`은 목록에서 숨긴다. (agent)

## 순서

| wave | task | 무엇 |
|---|---|---|
| 1 | `sweep-phone-chat` | 폰 대화 화면과 desktop 대화의 공용 규칙 |
| 1 | `sweep-phone-new-session` | 폰 새 session 화면의 고르기 |
| 1 | `sweep-phone-lists` | 폰 sidebar·Home·검색·아이콘과 가벼운 저장 |
| 1 | `sweep-phone-terminal` | 폰 터미널 보기, 창 없을 때의 열기, 터미널 탭 열기 |
| 1 | `sweep-phone-local-apps` | 폰에서 도는 앱의 호출과 sync, 위젯 binding |
| 1 | `sweep-kit-instructions` | 폰 kit과 앱 agent 지침 |
| 1 | `sweep-harness-adapters` | harness GUI adapter |
| 1 | `sweep-remote-transport` | remote 연결, push, reader 줄, relay |
| 1 | `sweep-shell-main` | shell main의 시작·종료·연결·알림 |
| 1 | `sweep-shell-renderer` | desktop 화면(layout, 탭 자리, 설정, preview, 단축키) |
| 1 | `sweep-core-apps` | 앱 runtime과 sync |
| 1 | `sweep-folder-identity` | folder sync, 기계 따라가기, project identity |
| 1 | `sweep-core-agent` | lophn agent, provider, flow, 공유 승인 |
| 1 | `sweep-tools` | check의 tsc 묶기, merge.sh |

wave 2(wave 1이 모두 merged된 뒤):

| wave | task | 무엇 |
|---|---|---|
| 2 | `sweep-phone-terminal-remote` | 터미널 화면으로 remote 쓰기, 새 session의 Terminal 항목, 터미널 입력 허락의 기본값 |
| 2 | `sweep-coding-bodies` | coding session의 tool 본문을 펼칠 때 받기, 폰의 이미지, 다시 연 대화의 그림 |
| 2 | `sweep-contracts` | 계약을 열어야 해서 wave 1이 못 한 것 |
| 2 | `sweep-connection-paths` | 직접 주소를 pairing 뒤에도 새로 받기, 사람이 적는 주소 |
| 2 | `sweep-phone-polish` | 폰과 kit의 잔손질 |
| 2 | `sweep-docs` | architecture 문서와 flows를 wave 1의 code에 맞추기 |

## 범위 밖

- 사람이 정해야 하는 것: `provider-failure-body-not-kept`, `model-call-body-capacity-not-enforced`, `workspace-relay-unused-and-disconnected`, `phone-write-events-not-delivered`, `phone-conversation-math-mermaid-as-code`, `phone-inbox-history-lacks-answers`, `preview-touch-emulation-changes-cursor`, `windows-unsigned-blocked-by-smart-app-control`.
- 이 기계에서 돌려 볼 수 없는 것: `windows-hook-cmd-tui-toggle`, `windows-login-start-not-service`.
- 실제 CLI·폰·emulator로 먼저 봐야 하는 것: `claude-resumed-subagent-not-running`, `push-misses-gui-tab-approvals`, `phone-guest-memory-grows-per-remount`, `phone-cold-session-url-opens-inbox`, `phone-open-url-blank-workspace`, `e2e-app-restart-reader-unavailable-under-load`.
- 따로 계획으로 열 큰 일: `gui-composer-lacks-at-mention`(roadmap 초안이 다른 worktree `harness-gui-issue-md`에 있다), `flow-process-cpu-limit`, `agent-artifact-tab-needs-mounted-workspace`, `agent-browser-page-duplicated-across-windows`, `phone-backend-bundle-includes-computer-only-commands`, `file-read-lacks-docx`.
- 새 e2e가 필요한 것(사람에게 묻는다): `no-check-starts-a-sync-app-on-the-computer`.
- 죽은 code 지우기(따로 한 번에): `unused-supervision-recovery-hooks`, `unhandled-routes-and-commands`.
- 손해가 작아 뒤로 둔 것: `oauth-failure-reason-lost-on-restart`, `widget-text-not-pretendard`, `phone-apps-menu-lacks-wireframe-rows`, `phone-screen-errors-not-in-app-log`, `phone-coding-ask-duplicates-env-read`, `cli-help-lists-forbidden-commands`.

## lead가 할 일

- 문서만 고치면 닫히는 이슈를 직접 고친다: `activation-result-notice-rules-differ`, `app-source-connect-actors-differ-from-a17`, `job-tool-run-ignores-creator-assignment`, `remove-public-command-users-found-via-home`의 A21 줄(`project-docs/products/AGENT.md`).
- merge마다: 보고를 diff와 대조하고, 고친 이슈를 `status: fixed`로 닫고, 못 고친 것은 이슈에 남긴다. 등록할 것(protocol 목록, core 조립 목록, `allowlist.ts`, gallery index, schema step)을 넣는다.
- `sweep-tools`는 맨 뒤에 합친다(check 도구가 바뀐다).
- 끝나면: `remote.md`의 비목표(폰의 터미널 크기, coding session의 이미지)와 architecture 문서의 이슈 줄을 맞추고, change-log 항목 `issue-sweep`을 쓰고, 계획 폴더를 지운다. land는 끝에 한 번이다.
- worker는 사람이 정한 대로 Opus(`general-purpose`, model `opus`, effort `high`)로 띄운다.
