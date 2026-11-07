# shell

데스크톱 앱(packages/shell)의 화면과 그 source. architecture 문서는 아직 없다.

## 사람이 만든 agent의 home session이 런처에서 lophn 얼굴로 보인다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

지금(uo-home 전): home(workspace 없음) session은 런처의 lophn 패널에서만 열었고 패널은 lophn source 하나만 만들었다. 패널은 없어졌고 Home session은 agent 탭으로 열린다(`packages/shell/renderer/desktop/main.tsx`의 `openSession` → Home의 `WorkspaceWindow`가 `agentRow`로 그 session의 agent를 찾아 연다). 다른 agent의 Home session이 맞게 열리는지 확인하고 닫는다. 사람이 만든 agent의 home session(workspace 없는 `call`, job의 `agent_run`, CLI `lophn agent run --agent <이름>`이 연다)을 열면 그 session을 lophn의 source로 읽는다.

영향: 사람이 그 session을 열면 머리와 composer가 lophn 이름과 얼굴을 보이고, session 목록에도 lophn의 session만 보여 그 agent의 대화를 찾기 어렵다.

고치려면:
- 패널이 연 session의 agent(session store `SessionEntry.agent`)로 source를 고른다(작음, 패널 하나). 런처에서 home의 다른 agent를 고르는 길은 없다.
- 런처에 home의 agent select를 둔다(중간, 화면을 새로 그린다).
- 추천: 앞의 것. 여는 길이 이미 session id라 그 session의 agent를 쓰면 된다.

## 일하는 중 보낸 이미지만 든 사람 메시지가 대기 줄에서 빈 줄로 보인다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/lophn-agent]
```

지금: `MessageReceived` event의 `body`는 글 block만 이은 글이다(`packages/core/lophn-agent/run-loop/work.ts`의 `blocksText(input.body)`). live 경로(`packages/shell/renderer/conversation/agent-tab-data.ts`)는 그 글로 대기 메시지의 `summary`를 채운다. 그래서 agent가 일하는 중에 이미지만 붙여 보낸 메시지는 snapshot을 다시 읽기 전까지 대기 줄이 비어 있다. snapshot 경로는 본문 part로 `[image]`를 보인다.

영향: 사람은 방금 보낸 메시지가 대기 줄에 빈 줄로 보여 무엇을 보냈는지 알아보지 못한다. 데이터는 잃지 않는다.

고치려면:
- event의 `body`를 `blocksSummary(input.body)`로 채운다(작음, core 한 줄). live 메시지 목록도 본문을 읽기 전까지 `[image]`를 보인다.
- event에 block을 싣는다(중간, event 계약이 바뀐다).
- 추천: 앞의 것.

## 앱·project 설정에 이름 바꾸기와 보관이 없다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

지금: 보관과 되살리기는 Home 오른쪽 sidebar의 Workspaces panel(`packages/shell/renderer/shell/workspaces-panel.tsx`)에서만 된다. 줄 위 ⋯ menu의 Archive, "Archived N"의 Unarchive다. project 이름은 project 설정 탭 General(`packages/shell/renderer/workspace/project-settings/project-settings-page.tsx`)과 panel의 Details에서 바꾸지만 보관은 없다. 앱 상세(`packages/shell/renderer/app-frame/app-detail/app-detail.tsx`)는 아이콘·폴더·Version·Access·Activity뿐이라 이름도 보관도 없다. core에는 `app.rename`(`packages/protocol/apps/apps.ts`)이 있는데 부르는 화면이 없다.

영향: 사람은 그 앱·project 안에서 이름을 바꾸거나 보관하지 못하고, Home으로 가서 숨은 ⋯ menu를 찾아야 한다. 앱 이름은 아예 바꾸지 못한다.

고치려면:
- project 설정 General 맨 아래에 Archive(secondary), 앱 상세 맨 위에 General 칸(이름 바꾸기 `app.rename`, Archive)을 둔다. 지금 들어와 있는 workspace를 보관하면 Home으로 옮긴다. Workspaces panel의 ⋯ menu는 빠른 길로 둔다(작음, renderer와 gallery만).
- 추천: 이것.

## 기동 때 남은 SDK 업데이트 기록이 사람에게 보이지 않는다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/renderer, packages/core/apps]
```

지금: 0.20.0을 설치하고 켠 data root에서 `noticesWiring.afterReady`가 `lophn_updated` 한 줄과 `sdk_update_needed` 세 줄(mahas, masup, calendar: `@lophn/declaration` 3.0.0, `@lophn/app-ui` 2.2.0이 지원 하한 아래)을 `notices`에 남겼다. 그런데 사람은 아무것도 보지 못했다. 영구 기록은 Inbox의 History 탭에만 있고 sidebar 배지에 세지 않는다(`waiting-store.ts`의 `historyUnread`). toast는 shell main이 `NoticePosted`를 받아 띄우는데(`packages/shell/main/desktop/wiring/notice.ts`), 이 줄들은 core 기동 중에 써져 [INFERENCE] 창이 그 event를 받기 전이었을 수 있다. 원인은 확인하지 못했다.

영향: SDK 업데이트가 필수인 앱(뜨지 않는 앱)이 있어도 사람은 History 탭을 열기 전까지 모른다. 이 흐름의 목적(사람에게 알리고 맡기게 하기)이 서지 않는다.

고치려면:
- 기동 뒤 창이 준비되면 안 읽은 `sdk_update_needed`·`app_unavailable` 같은 급한 program 줄을 toast로 한 번 보인다(작음).
- 그런 급한 종류의 안 읽은 영구 줄은 배지에 센다(작음, 배지 규칙이 바뀐다).
- 추천: 둘 다. 먼저 toast가 왜 안 떴는지 shell main log로 확인한다.
