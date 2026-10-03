---
type: screen
concerns: [apps/releases, apps/permissions, apps/connections, apps/automations, problems/grouping, problems/closing, coding-agent/tickets]
---
# App details

사람이 한 앱의 version·access·연결·issue·task를 한 패널에서 보고 결정한다.

패널은 app-space의 "App details"에서 720px로 열린다(shell/app-frame#R26). 안은 다섯 tab으로 나눈다 — **Issues · Tasks · Version · Access · Connections**. 한 번에 한 tab만 보이므로 tab마다 주 행동은 하나뿐이다(screens/README#G4). 기본 tab은 열린 Issue가 있으면 Issues, 없으면 Version이다(screens/README#G1 — 지금 판단할 것이 먼저).

## 보이는 것

### Issues

- 이 앱의 issue 목록. 기본은 **Open**과 **Fixing** 상태만 보이고, 각 줄에는 증상 한 줄·상태·필요한 다음 행동만 있다(problems/grouping#R11, R12).
- 줄을 펼치면: 처음·최근 발생 시각, 발생 수, 당시 version, 연결된 Task(있으면), App Engineer가 남긴 "What we found" 해석 링크(있으면)가 보인다(problems/grouping#R13).
- Closed issue는 "Show closed"로 따로 펼친다(problems/grouping#R10 — 닫힌 뒤에도 같은 issue로 이어진다). 펼친 각 줄에는 네 가지 닫힌 이유 중 하나(Test confirmed the fix / You confirmed it / No longer appearing / Not pursuing further)와 지금 필요한 주의(없으면 "No further action needed")가 기본으로 보이고, 실제 확인 범위·미확인 부분·당시 release·근거는 그 줄을 한 번 더 펼쳐야 보인다(problems/closing#R13).

### Tasks

- 이 앱에 걸린 Task 목록. 상태는 Open / In progress / Checking / Fixed / Needs another look / Cancelled 중 하나로만 보인다(coding-agent/tickets#R19; problems/grouping#R12 "ticket·claim은 사람이 아는 영어로 설명").
- 각 Task에는 제목(무엇을 하는 일인지)과 어느 Issue·어느 요청에서 왔는지 한 줄이 붙는다.
- 열린 Issue 줄에서 "Create a task"를 누르면 그 Issue 하나를 고치는 Task가 바로 열린다. 글을 직접 쓰는 양식은 없다 — 무엇을 확인해야 고친 것으로 볼지는 그 Issue의 증상에서 자동으로 정해진다(coding-agent/tickets#R9).

### Version

- 지금 쓰는 version 하나를 "Current"로 크게 보이고, 그 아래 지난 version 목록이 최신순으로 있다(apps/releases#R16 — 화면 말은 screens/README#3 "release → Version").
- 각 지난 version에는 만든 시각과 "Use this version" 행동이 있다. 지금 데이터와 맞지 않는 version은 행동 대신 "Needs data restore first"가 보인다(apps/releases#R16).

### Access

- **Files, network, secrets this app can use** — 지금 실제로 쓸 수 있는 access만 나열한다(선언만 있고 사람이 허락하지 않은 것은 없음, apps/permissions#R1, R2). 각 항목에 "Remove access"가 있다.
- **Which roles can use this app** — lophn 안 역할(예: App Engineer)이 이 앱의 command를 쓸 수 있는지. 기본은 전부 닫혀 있고 사람이 허락한 역할·command만 보인다(apps/permissions#R27, R28).

### Connections

- **Can use** — 이 앱이 부를 수 있는 다른 앱과 command 목록.
- **Used by** — 이 앱의 command를 쓸 수 있는 다른 앱과 command 목록(apps/connections#R1, R2).
- 각 방향에 "Remove connection"이 있다.
- 각 연결 줄을 펼치면 선언된 범위와 구별해서, 실제로 호출된 적이 있는지와 마지막 호출의 성공/실패/확인 못함을 본다(apps/invocations#R3, apps/invocations#R10). 허락 접수와 실제 호출 결과를 같은 줄로 섞지 않는다.

## 숨긴 것

- 안쪽 bundle hash, blueprint hash, commit, claim 일정(seq·기한) 같은 식별자는 기본에 없다(shell/wording#R6, R8).
- Task의 완료 보고 본문 전체·test 원문 로그는 숨기고, "Fixed"/"Needs another look" 판정과 그 근거로 쓴 test 이름만 펼쳐서 본다(coding-agent/tickets#R17, R18).
- automation의 실제 호출 기록(성공/실패/건너뜀과 이유)은 각 automation 줄을 펼쳐야 보인다. 선언만 있고 아직 호출되지 않은 automation과 실제 실패한 automation을 구별해서 보인다(apps/automations#R10).
- grant를 바꾸거나(새 access 허락, access 제거, 연결 추가·제거) 하는 실제 승인 결정은 이 화면에서 끝내지 않고 confirmation-window로 보낸다(apps/permissions#R1, apps/connections#R1). 이 화면은 지금 상태를 보여 주고 결정을 "시작"만 한다.
- Version을 바꾸는 실제 activation 전후 비교(어떤 command가 바뀌는지, 추가 권한, 데이터 영향)는 이 화면이 아니라 confirmation-window에서 보인다(apps/releases#R9).

## 행동

- 각 tab의 주 행동: Issues → "Create a task", Tasks → "Cancel", Version → "Use this version", Access → "Remove access" / 역할 허락 켜고 끄기, Connections → "Remove connection".
- Task "Cancel"은 1~200자 이유를 받고 바로 적용된다(coding-agent/tickets#R22) — 되돌릴 수 없는 일이 아니라서 confirmation-window를 거치지 않는다.
- Version "Use this version", Access 변경, Connection 추가·제거는 되돌릴 수 없거나 범위가 넓어질 수 있는 일이라 confirmation-window를 연다(apps/releases#R8; apps/permissions#R1; apps/connections#R1).

## 상태

- **불러오는 중** — tab마다 300ms 뒤 skeleton(shell/design-system#R1).
- **비었음** — Issues 없음("No open issues"), Tasks 없음, Connections 없음을 각각 한 문장·행동 없이 보인다(shell/design-system#R34).
- **Version 호환 안 됨** — 지난 version 중 지금 데이터 schema와 다른 것은 바로 못 쓰며 이유가 함께 보인다(apps/releases#R16).
- **연결 끊김** — 패널을 연 채로 daemon 연결이 끊기면 마지막으로 읽은 내용과 확인 시각을 유지한다(shell/desktop#R7).

## 문구

| key | en |
|---|---|
| app-detail.tabs.issues | Issues |
| app-detail.tabs.tasks | Tasks |
| app-detail.tabs.version | Version |
| app-detail.tabs.access | Access |
| app-detail.tabs.connections | Connections |
| app-detail.issues.empty | No open issues |
| app-detail.issues.status.open | Open |
| app-detail.issues.status.fixing | Fixing |
| app-detail.issues.status.closed | Closed |
| app-detail.issues.show_closed | Show closed |
| app-detail.issues.closed_reason.test_confirmed | Test confirmed the fix |
| app-detail.issues.closed_reason.you_confirmed | You confirmed it |
| app-detail.issues.closed_reason.not_appearing | No longer appearing |
| app-detail.issues.closed_reason.not_pursuing | Not pursuing further |
| app-detail.issues.closed_reason.no_action_needed | No further action needed |
| app-detail.issues.create_task | Create a task |
| app-detail.issues.found_by_app_engineer | What App Engineer found |
| app-detail.tasks.status.open | Open |
| app-detail.tasks.status.in_progress | In progress |
| app-detail.tasks.status.checking | Checking |
| app-detail.tasks.status.fixed | Fixed |
| app-detail.tasks.status.needs_more_work | Needs another look |
| app-detail.tasks.status.cancelled | Cancelled |
| app-detail.tasks.cancel | Cancel |
| app-detail.version.current | Current version |
| app-detail.version.use | Use this version |
| app-detail.version.needs_restore | Needs data restore first |
| app-detail.access.title | Files, network, and secrets this app can use |
| app-detail.access.roles_title | Which roles can use this app |
| app-detail.access.remove | Remove access |
| app-detail.connections.can_use | Can use |
| app-detail.connections.used_by | Used by |
| app-detail.connections.remove | Remove connection |

## 크기와 접근성

- 패널 고정 폭 720px, 창 1,024px 미만에서는 앱 view가 가려지지 않고 남는 폭만큼 줄어든다(shell/app-frame#R26).
- tab 전환·목록 펼치기·행동 버튼은 모두 키보드로 닿고, 좁은 패널에서도 표 대신 줄 단위 목록으로 줄바꿈 없이 읽힌다(shell/design-system#R2, R21, R24).
- 상태 단어(Open/Fixing/Closed, Task 상태)는 색만이 아니라 글자로도 구별된다(shell/design-system#R10).
