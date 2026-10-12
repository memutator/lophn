---
type: requirements
concerns: [shell/desktop]
---
# shell/desktop

Electron main과 창별 shell 화면의 분리, 창 구성·탐색·tray·OS 통합과 사람 token 보관, Agent 화면(project의 Agent 탭과 앱 공간의 agent 칸이 같이 쓰는 component)과 Lophn Workspace settings의 Providers·Agents 자리를 맡는다; 각 화면에서 보여 줄 사실과 상태는 해당 concern을 가리키고 이 문서는 위치·순서·조작을 정한다. 탭 구조와 sidebar는 shell/workspace, 앱 공간은 shell/app-frame이 맡는다.

## 요구

### 화면과 조작

**[R3]** agent 답이 만들거나 고친 문서는 그 답 아래 편집 카드의 [Open]으로 열고, 한 답에 4개 이상이면 첫 3개·남은 개수·나머지 결과 보기를 배치한다.
- 이유: 긴 결과 목록이 답을 밀어내지 않게 한다.
- 확인: 결과 5개 중 처음 3개와 나머지 2개를 모두 열 수 있고, 링크는 실제 생성·변경 대상(lophn-agent/conversation)만 가리킨다.
- 의도: shell#I1

**[R7]** 연결 단절·갱신 실패에는 마지막 화면을 유지해 최신 확인 못함과 확인 시각을 표시하고 재연결 때 현재 기록으로 맞추며 놓친 진행 notification을 연속 재생하지 않는다.
- 이유: 단절을 빈 결과나 정상 최신값으로 오인하지 않게 한다.
- 확인: 단절 뒤 기존 내용을 읽고 현재 상태로 복귀하며 결정 제출 gate는 shell/confirmation-window를 따른다.
- 의도: shell#I5

**[R8]** 작성 중 말·선택 답·커서를 session 전환·Agent 탭 전환·confirmation window·전송 실패·단절에 보존하고 보내는 중·접수됨·못 보냄·접수 확인 안 됨을 구별하여 불명확하면 재전송보다 접수 조회를 먼저 제시한다.
- 이유: 전송 불명확으로 입력이 사라지거나 중복 접수되지 않게 한다.
- 확인: 다른 탭에 갔다 오거나 confirmation window를 열었다 닫아도 초안과 커서가 남으며 접수 의미는 lophn-agent/conversation·platform/ledger를 따른다.
- 의도: shell#I5

**[R9]** 확인할 것은 기다리는 것과 지난 일로 나누고 전자는 요청 종류별 개수와 다음 행동을, 후자는 최신순 링크를 배치하며 역할·기간 filter를 제공한다.
- 이유: 미처리 결정과 과거 기록을 구별한다.
- 확인: 목록을 읽는 것만으로 답이나 승인이 제출되지 않으며 내용은 lophn-agent/questions·platform/approvals·platform/notifications를 따른다.
- 의도: shell#I1

**[R10]** 사람을 부르는 notification은 창 오른쪽 아래 한 칸에서 [View]·닫기와 남은 개수를 제공하고 [View]는 그 계기가 가리키는 대상으로 가며 자동 표시가 입력 focus나 현재 문서를 바꾸지 않는다.
- 이유: 자동 notification이 작업 focus를 빼앗지 않게 하고, 알림마다 그 일이 있는 곳으로 바로 간다.
- 확인: 3건에서 하나와 외 2건을 표시하고, 질문·approval 알림의 [View]는 확인할 것으로, context 계약 위반 알림의 [View]는 그 Context 탭의 Violations로 가며, 계기·대상·중복 억제는 platform/notifications를 따른다.
- 의도: shell#I1

**[R11]** 데스크톱 셸은 Electron으로 창·tray·로그인 자동 시작·OS notification 표시·전역 단축키·패키징을 담당하는 얇은 client로 만든다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: Electron 창을 모두 닫아도 tray main과 그 아래 core의 동작이 이어진다.
- 의도: shell#I1

**[R12]** lophn은 browser tab이 아니라 설치된 데스크톱 앱으로 연다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: OS에서 열면 데스크톱 창으로 시작한다.
- 의도: shell#I5

**[R13]** 앱 화면은 WebContentsView로 창 본문에 담고 같은 shell/app-frame 경계의 앱 전용 새 창으로도 연다.
- 이유: 창을 여는 방식이 격리의 예외가 되면 안 된다.
- 확인: 기본 창과 새 창에서 같은 앱과 격리 규칙을 사용한다.
- 의도: shell#I5

**[R14]** 앱을 Linux .desktop·macOS app bundle·Windows shortcut으로 등록하여 OS에서 누르면 앱 전용 창을 여는 통합을 지원한다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 각 OS의 등록 항목이 앱 전용 창을 연다.
- 의도: shell#I1

**[R15]** Electron main은 하나이며 domain 상태를 직접 쓰지 않고 platform/identity의 사람 token으로 platform/api를 호출한다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 창 두 개를 열어도 main은 하나이고 domain 쓰기는 API로 전달된다.
- 의도: shell#I5

**[R16]** shell renderer는 창마다 하나이며 sandbox와 context isolation을 켜고 Node 접근 없이 schema로 제한한 preload만 사용한다.
- 이유: 페이지가 비밀과 자료를 직접 읽지 못하게 한다.
- 확인: renderer에서 Node·DB·비밀·사람 token을 직접 읽을 수 없다.
- 의도: shell#I5

**[R17]** Electron main은 npm·TypeScript로 build하고 shell renderer는 Deno workspace에서 SDK를 공유하여 build한다.
- 이유: 앱과 shell이 같은 SDK 계약으로 같은 모양을 쓰게 한다.
- 확인: main과 renderer가 정한 build 환경에서 각각 생성되고 같은 SDK 계약을 사용한다.
- 의도: shell#I3

**[R18]** 창 안 명령 팔레트는 CommandOrControl+K, 전역 팔레트는 CommandOrControl+Shift+K, 창 안 런처 복귀는 CommandOrControl+Shift+L로 구별한다.
- 이유: 세 shortcut이 서로 다른 동작을 하여 전역 단축키를 가로채지 않게 한다.
- 확인: 세 shortcut이 서로 다른 동작을 하고 전역 Ctrl+K를 가로채지 않는다.
- 의도: shell#I1

**[R19]** renderer의 허용 호출은 API schema에서 생성한 좁은 목록으로 제한하고 임의 token 발급·daemon 종료 통로는 제공하지 않되 coding-agent/connection의 고정 연결 intent는 별도로 검증한다.
- 이유: 화면이 임의 통로로 secret을 만들거나 daemon을 끝내지 못하게 한다.
- 확인: 임의 발급·종료 호출은 거절되고 연결 화면의 정해진 intent만 통과한다.
- 의도: shell#I5

**[R20]** 시작할 때 daemon의 lock·프로세스 상태를 확인하여 없으면 bundle된 Deno로 시작 요청을 보내며 daemon 수명·설치는 platform/install-and-update를 따른다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 이미 daemon이 있을 때 중복 시작하지 않고 없을 때 하나를 시작한다.
- 의도: shell#I1

**[R21]** 창 닫기는 종료로 해석하지 않아 모든 창을 닫아도 tray main과 그 아래 core가 남고, tray의 Quit은 진행 중 터미널·저장을 확인한 뒤 main과 core를 함께 멈추며, 로그인 자동 시작은 검증된 실행 경로와 창을 열지 않는 tray mode로 시작한다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 창 닫기 후 앱 automation과 진행 중이던 agent 일이 이어지고, tray Quit과 `--quit`만 core 정상 종료 순서를 밟으며, 진행 중 터미널·저장이 있으면 확인에서 취소할 수 있다.
- 의도: shell#I5

**[R22]** 기본 sidebar는 240px·접힘 56px·탐색 행 32px, 상단 바는 48px, 최소 창은 960×600px, 본문 여백은 좌우 32px·위 24px로 두고 창 1024px 미만에서는 좌우 16px로 줄인다.
- 이유: 창 크기가 달라도 같은 자리와 여백으로 찾게 한다.
- 확인: 960×600·1024px 경계에서 정한 치수가 측정된다.
- 의도: shell#I3

**[R23]** 시스템 제목 표시줄 대신 상단 바를 쓰며 macOS 신호등 자리 약 80px를 비우고 Windows·Linux는 상단 바 오른쪽 끝에 최소화·최대화(최대화 중에는 되돌리기)·닫기 단추 144px를 직접 그리며 조작 요소는 창 끌기에서 제외한다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: OS별 창 조작과 상단 검색·버튼이 끌기로 오인되지 않고, 창 단추는 부른 창에만 동작하며 최대화 상태를 단추 모양이 따른다.
- 의도: shell#I1

**[R24]** 새 기본 창은 런처에서 시작하여 프로젝트·앱·lophn 공간(화면 이름은 Lophn Workspace)으로 이동하고 마지막 공간은 이어서로 기억하며 창 제목은 공간 이름 뒤에 — lophn을 붙인다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 재시작해도 런처가 먼저 보이고 이어서로 이전 공간에 간다.
- 의도: shell#I1

**[R25]** 런처에는 48px 창 끌기 바와 프로젝트 section·그 아래 앱 section(보관하지 않은 앱 카드)·프로젝트 등록을 두고 lophn 관리는 바 오른쪽 고정 진입점으로 두어 형제 카드로 만들지 않는다.
- 이유: 화면의 치수와 조작을 일정하게 하여 본래의 일과 결정을 방해하지 않는다.
- 확인: 런처 본문에 lophn 관리 카드가 없고 고정 진입점이 있다. 프로젝트 section 아래 앱 section에 앱 카드가 있고 누르면 그 앱 공간이 열리며, 앱이 없으면 비었음 상태와 다음 행동 하나가 보인다.
- 의도: shell#I1

**[R26]** 모든 공간 왼쪽 위에 런처 복귀를 두고 sidebar 접힘 때는 상단 바로 옮기며 카드의 approval 대기 개수는 색이 아니라 글자 pill로 표시한다.
- 이유: 어느 공간에서든 같은 자리에서 런처로 돌아가고 대기 개수를 글자로 읽게 한다.
- 확인: 접힘 전후 복귀가 가능하고 색 없이도 대기 개수를 읽는다.
- 의도: shell#I1

**[R27]** 프로젝트·앱 공간의 lophn 크롬은 해당 결정 대기와 daemon 장애 안내에 한정하고 결정 행동은 shell/confirmation-window로 연다.
- 이유: 지금 필요한 안내만 보이고 되돌릴 수 없는 결정은 보호 화면으로만 연다.
- 확인: 관련 없는 전역 관리 크롬이 본문을 차지하지 않고, 작업대의 추적 꺼짐 안내도 본문 높이를 쓰지 않는 떠 있는 카드이며 닫아도 다시 열 수 있다.
- 의도: shell#I1

**[R28]** 프로젝트 작업대 sidebar에는 프로젝트 폴더·Contexts·Saved views·Agents 탐색을, lophn 공간(Lophn Workspace) sidebar에는 프로젝트·앱·확인할 것·설정 탐색을 배치하고 문서와 Context 화면과 agent는 lophn 공간에 두지 않는다.
- 이유: 공간마다 지금 필요한 탐색만 보이게 하고 프로젝트에 속한 일(문서, context, agent)은 프로젝트 화면 안에서만 한다.
- 확인: documents/projects·documents/contexts의 실제 목록으로 이동하며 없어진 거처·분류 전 계층은 표시하지 않는다. 프로젝트 폴더 행은 눌러 펼치고 접으며 펼치면 그 폴더 안 문서를 탭으로 열 수 있게 보이고, Contexts 행은 눌러 그 프로젝트의 Contexts 탭을, 그 아래 context 이름은 Context 탭을, Saved views 행은 Search 탭을 연다. lophn 공간 sidebar에 Documents·Context·Roles·Agents 항목이 없다. Agents 행의 구성은 shell/workspace를 따른다.
- 의도: shell#I1

**[R30]** 명령 팔레트 결과는 프로젝트 범위에서 열린 탭·Contexts(context 이름을 고르면 그 Context 탭을 연다)·Documents·행동, lophn 공간에서 프로젝트·앱·행동 순으로 묶는다.
- 이유: 이름으로 context와 문서를 바로 찾고, 프로젝트에 속한 것을 lophn 공간에 섞지 않는다.
- 확인: 프로젝트 범위에서 context 이름을 치면 Contexts 묶음에 나오고 선택하면 Context 탭이 열리며, lophn 공간 팔레트에는 context와 문서가 나오지 않는다. 삭제된 분류 전·시리즈 전용 목적지가 아닌 현재 탐색 대상으로 이동한다.
- 의도: shell#I1

**[R31]** settings 화면은 왼쪽 세로 nav에 자리를 묶음 제목 아래 아이콘과 이름으로 놓고, 고른 자리 하나를 nav 오른쪽 자리의 가운데 column(form 폭)에 section 제목과 카드(왼쪽 이름·설명, 오른쪽 조작)로 그린다. 가로 탭 줄을 쓰지 않고 backup 자리는 두지 않는다.
- 이유: 자리가 늘어도 이름이 잘리거나 가로로 scroll하지 않고, 어디에 무엇이 있는지 한눈에 찾게 한다.
- 확인: 통로가 있는 자리만 묶음 아래 nav에 서고 고른 자리가 표시되며, 본문 column이 nav 오른쪽 자리의 가운데에 놓인다.
- 의도: shell#I1

**[R32]** shell 화면의 크롬 글자와 그림·링크는 기본으로 선택되거나 끌려가지 않고, 문서 읽기·편집 본문·입력·터미널·code·대화 말·확인 화면 값처럼 사람이 복사할 자리만 선택된다.
- 이유: 앱 화면이 웹 페이지처럼 긁히고 끌려가면 조작하는 도구가 아니라 문서처럼 보인다.
- 확인: 크롬 글자는 선택되지 않고 읽기 본문·입력·code·터미널은 선택된다.
- 의도: shell#I1

**[R33]** lophn 공간(Lophn Workspace)은 프로젝트 화면의 칸·탭 구조에 들어가지 않는 따로인 페이지로 두고 Documents와 Context 화면과 agent를 두지 않는다.
- 이유: 문서와 context와 agent의 대화는 프로젝트(또는 앱) 하나에 속한 일이라 그 화면에서만 다루고, lophn 공간은 프로젝트를 가로지르는 관리(프로젝트·앱·확인할 것·설정)에만 쓴다.
- 확인: lophn 공간 sidebar에 Documents·Context·Roles 항목이 없고 Agent 화면을 여는 길이 없으며 탭 줄과 분할이 없고, 프로젝트 화면에서는 문서·Context·Search 탭을 연다(shell/workspace#R1).
- 의도: shell#I1

**[R34]** 키워드로 문서를 찾는 일은 상단 검색(돋보기·CommandOrControl+K)의 명령 팔레트가 맡고 별도 Documents 화면을 두지 않으며, 선언된 검색은 shell/workspace의 Search 탭이 맡는다.
- 이유: 전체 검색 화면을 따로 만들지 않고 빠른 이름 검색과 context의 선언된 검색을 구별한다.
- 확인: 프로젝트 범위 팔레트에서 단어를 치면 문서 이름이 나오고 Search 탭의 입력 form과 섞이지 않는다.
- 의도: shell#I1

### notification과 agent를 부르는 길

**[R35]** lophn이 가진 사건(context 계약 위반, 앱 문제)을 알리는 notification에만 [Ask <agent 이름>]을 [View]·[×] 앞에 더하고, 누르면 사건이 가리키는 대상을 첫 context chip으로 붙인 그 agent의 Agent 화면을 연다.
- 이유: 프로그램은 문서 내용을 판단하지 못하므로 lophn이 아는 사건에서만 agent를 부르고, 부르는 사람에게는 사건을 다시 설명하지 않게 한다.
- 확인: context 계약 위반 알림에 [Ask Context Engineer] [View] [×]가 있고 다른 계기의 알림에는 [View] [×]만 있다. [Ask]는 그 agent의 새 Agent 화면을 열어 사건 대상이 composer 위 chip으로 붙고 입력칸은 비어 있으며 chip의 ✕로 뗄 수 있고, 사람이 보내기 전에는 아무것도 보내지 않는다. 어느 계기에 어느 agent인지는 platform/notifications를 따른다.
- 의도: shell#I1, lophn-agent#I1

**[R36]** agent는 프로젝트 sidebar의 Agents 묶음(접으면 바로 가기 rail의 Agent 단추)·앱 공간 title bar의 agent select·notification의 [Ask <agent 이름>]으로만 열고, Settings·Contexts·Context·Violations·탭 줄 `+` 메뉴 같은 다른 화면에는 agent를 부르는 단추를 두지 않는다.
- 이유: agent를 부르는 곳이 흩어지면 사람이 어디서 무엇을 부르는지 알기 어렵다.
- 확인: Settings·Contexts 탭·Context 탭·Violations·`+` 메뉴에 Ask 단추나 Agent 항목이 없고, Lophn Workspace에서 Agent 화면을 열 길이 없다. 프로젝트 sidebar와 rail은 shell/workspace, 앱 공간의 agent select는 shell/app-frame을 따른다.
- 의도: shell#I1

### Agent 화면

**[R37]** agent와의 대화는 project의 Agent 탭과 앱 공간의 agent 칸이 같은 Agent component로 그리고, 한 화면은 한 agent의 session 하나를 보이며 탭·칸이 아닌 따로 뜨는 대화 dock·overlay를 두지 않는다.
- 이유: 대화가 산출물 탐색을 밀어내지 않고, 프로젝트에서나 앱에서나 같은 사용법을 쓴다.
- 확인: Agent 탭을 열고 닫아도 다른 탭의 배치와 정보 패널 상태가 그대로이고, 프로젝트와 앱 공간에서 header·대화·composer의 모양과 조작이 같다.
- 의도: shell#I1

**[R38]** Agent 화면 맨 위 header는 [avatar] agent 이름 · session 제목 ▾로 그 agent와 session을 고정해 보이고 오른쪽에 진행 chip·보기 상세·⋯ 메뉴(Rename, Fork, Rewind…, Usage, Close tab — 탭·칸만 닫고 session은 그대로 남는다)를 두며, session 안에서 agent를 바꾸는 칸은 두지 않고 다른 agent는 다른 탭·칸으로 연다.
- 이유: agent마다 tool과 prompt 조립이 달라 한 session 안에서 agent를 바꿀 수 없다.
- 확인: header에서 agent를 고르는 길이 없고 다른 agent를 열면 새 탭·칸이 생기며, ⋯ 메뉴의 Rename은 지금 session의 이름을 고친다. 진행 chip·보기 상세는 R42를 따른다.
- 의도: shell#I1

**[R39]** header의 session 제목을 누르면 열리는 popover는 맨 위에 제목 검색칸을 두고 그 agent의 session만 Today·Earlier로 묶어 상태 점(● Waiting for you, ◐ Working, 없음)·제목·상대 시각과 지금 session의 ✓를 보이며, 줄에 올리면 Rename·Archive·Delete(휴지통 icon) 단추를 보이고 아래에 Archived (n) 줄과 [+ New session]을 둔다.
- 이유: session 목록을 sidebar에 두지 않고도 같은 agent의 session을 찾고 정리한다.
- 확인: 검색어를 치면 제목에 맞는 session만 남고 다른 agent의 session은 나오지 않는다. Rename은 그 줄을 입력칸으로 바꿔 Enter로 저장하고 Esc로 취소하며, Archive한 session은 목록에서 빠지고 Archived (n)에서 다시 열면 풀리며, Delete는 되돌릴 수 없다는 확인 뒤에만 지우고 휴지통 icon을 쓴다. 상태 점은 색이 아닌 모양과 이름으로 구별한다. session의 제목·archive·delete 뜻은 lophn-agent/conversation을 따른다.
- 의도: shell#I1

**[R40]** 대화에서 내 메시지는 오른쪽 bubble로 이름·avatar 없이 놓고 agent 메시지는 왼쪽에 avatar(24px)·agent 이름(굵게)·시각을 위에 한 번 보이며, 같은 agent의 이어지는 메시지·tool 줄·카드는 이름 없이 그 아래 이어지고 카드는 왼쪽 열의 폭을 다 쓴다.
- 이유: 채팅방처럼 누가 말했는지 한눈에 읽고 agent마다 얼굴로 구별한다.
- 확인: 같은 agent가 이어 말하면 avatar·이름은 첫 메시지에만 있고, 내 메시지에는 이름과 avatar가 없으며, agent 이름은 고정 글자가 아니라 그 agent의 이름이다. avatar는 agent의 profile(icon 또는 올린 이미지)이다.
- 의도: shell#I1

**[R41]** agent의 tool 호출은 한 줄("Read 3 documents ›")로 접어 펼치면 하위 줄을 보이고, 문서를 바꾸면 "Edited <경로> +n −m" 편집 카드에 [Open]·[Undo]를 두며, 일이 끝나면 회색 "Worked for 18s"를 남기고 이 줄과 카드는 메시지가 아니라 run trace에서 그린다.
- 이유: 도구 활동은 기본에서 접고, 바뀐 문서와 되돌리는 길은 늘 보이게 한다.
- 확인: tool 줄은 기본에서 접혀 있고 눌러 펼치며, 편집 카드의 [Open]은 그 문서 탭을 열고 [Undo]는 lophn-agent/revert가 정한 되돌리기를 부른다. trace에 없는 줄은 그리지 않는다.
- 의도: shell#I1, lophn-agent#I7

**[R42]** 일하는 중에는 header에 진행 chip("2/4")을 보이고 누르면 Tasks popover(✓ 끝남, ● 지금, ○ 남음)를 열며, 보기 상세 select는 Messages(tool 줄 숨김)·Compact(tool 줄 접힘, 기본)·Everything(tool 줄 모두 펼침)을 고르고, 일을 멈추는 것은 composer의 Stop이다.
- 이유: 진행과 근거는 필요한 만큼만 펼치고, 멈춤과 이어가기를 한 곳에서 한다.
- 확인: 보기 상세를 바꿔도 메시지와 카드는 그대로이고 tool 줄만 숨김·접힘·펼침으로 바뀐다. Stop은 일을 멈출 뿐 거절이 아니며, 멈춘 일의 이어가기와 새 요청은 서로 다른 행동으로 한 단추에 합치지 않는다(lophn-agent/harness/run-loop).
- 의도: shell#I1

**[R43]** composer는 입력칸 안 아래 줄에 [+]·[model · option ▾]·[send / 일하는 중이면 Stop]을 두고 일하는 중에만 send 옆에 작은 select(Change this work / Next request — lophn-agent/conversation의 진행 중 수정과 다음 요청)를 두며, 입력칸 밖 아래 줄에 자리 이름(프로젝트 또는 앱)과 권한 요약 ▾를 두고, 입력칸 위에 떼어 낼 수 있는 context chip 줄을 두고 notification의 [Ask]로 연 session은 첫 context chip만으로 글 없이 보낼 수 있게 하며, 권한 요약은 그 session의 실제 권한(자리 권한 규칙과 이 session에서 Allow한 것)을 보이고 누르면 Agents 화면의 Permissions로 간다.
- 이유: 새 권한 모드를 만들지 않고 지금 이 session이 무엇을 할 수 있는지 입력 곁에서 읽게 하며, 사건을 알린 notification에서 연 session은 사람이 설명을 쓰지 않아도 단추 하나로 agent에게 넘긴다(documents/contexts).
- 확인: 입력칸 옆에 agent 고르기가 없고, 일하는 중에는 send 자리가 Stop이며, 권한 요약은 규칙이나 session의 Allow가 바뀌면 따라 바뀐다. [Ask]로 연 session은 입력칸이 비어 있어도 첫 context chip만으로 보낼 수 있고, chip을 떼고 글도 없으면 보낼 수 없고 chip이 남아 있어도 사람이 보내기 전에는 아무것도 보내지 않으며, 입력 중 말·커서는 R8을 따른다.
- 의도: shell#I1

**[R44]** model 단추는 `Sonnet 5.5 · Medium`처럼 고른 option 값을 이어 보이고, 누르면 검색칸 → Favorites(별표 순서 그대로, 검색 중에도 먼저) → 연결된 provider별 model(줄마다 별, 지금 것 ✓) → 고른 model이 가진 option 축 → "Only this session. Default comes from the agent."와 "Change defaults…"를 위에서 아래로 놓고, model을 바꿔 지금 option 값이 없으면 가까운 약한 값으로 맞추고 한 줄로 알린다.
- 이유: 즐겨찾는 model을 맨 위에서 고르고, model마다 다른 option만 보이며, 고른 것이 이 session에만 쓰임을 알린다.
- 확인: 별표한 model이 provider 묶음 안이 아니라 Favorites 맨 아래에 붙고 다시 누르면 빠진다. option 없는 model은 "No options for this model."을 보이고, effort 밖의 축(Speed 등)도 같은 자리에 나온다. 화면 코드에 model 이름과 option 값이 없고 모두 model catalog가 준다(lophn-agent/harness/model). "Change defaults…"는 Settings › Agents(R50)로 간다.
- 의도: shell#I1, lophn-agent#I5

**[R45]** 입력칸에서 `/`를 치면 composer 위로 Commands(모든 agent 공통)·<agent 이름>(그 agent의 built-in, 없으면 묶음 없음)·Skills 순의 메뉴를 열고, 글자를 더 치면 이름이나 설명에 맞는 것만 남겨 맞는 글자를 굵게 보이며, 지금 못 쓰는 명령(일하는 중 Fork 등)은 흐리게 하고 이유를 한 줄로 말한다.
- 이유: 명령과 skill을 한 곳에서 찾고, 못 쓰는 이유를 모른 채 눌러 보지 않게 한다.
- 확인: "/co"에서 Compact와 맞는 skill만 남고 맞는 글자가 굵으며 맞는 것 없는 묶음은 숨는다. Skills는 전역과 agent 전용의 구분·출처 표시 없이 한 묶음이다. Context Engineer 탭의 둘째 묶음은 Context Engineer이고 Operator 탭에는 둘째 묶음이 없다. 목록과 예약된 이름은 lophn-agent/commands를 따른다.
- 의도: shell#I1

**[R46]** agent의 질문 묶음(질문 1~4개)은 대화 안 카드 하나로 보이고 질문이 3개 이하이면 한 카드에 모두 펼치며 넘으면 1 of N으로 넘기고, 선택지에 번호 키와 추천 표시를, 마지막에 Other 입력칸을 두며, 아래에 "Work is paused until you answer"와 [Skip]·[Submit]을 두고 보내면 접혀 "Answered 2 questions: …" 요약으로 남는다.
- 이유: 여러 질문을 한 번에 읽고 답하며, 답을 기다리는 동안 일이 멈춘 것을 안다.
- 확인: 머리에 "n of N answered"가 보이고 모두 답해야 [Submit]이 켜지며 한 번에 답 전부를 보낸다. [Skip]은 묶음을 미루고 답으로 세지 않는다. 요약은 질문별 답을 보이고 다시 펼치지 않는다. 질문의 내용·기한·미루기 규칙은 lophn-agent/questions를 따르고 composer 위에 질문 칸을 따로 두지 않는다.
- 의도: shell#I1

**[R47]** agent가 사람의 확인이 필요한 일을 하기 전의 승인 카드는 composer 바로 위에 붙여 요청 요약(제목·한 줄 이유·작은 변경 미리보기)과 [Allow ▾](Allow once, Allow for this session)·[Deny]를 보이되, 단추는 결정을 제출하지 않고 고른 범위를 미리 고른 채 shell/confirmation-window를 열며 결정은 그 창에서만 제출하고, 거절은 일을 멈추는 composer의 Stop과 다르다.
- 이유: 허락할 일을 대화 끝에서 늘 보이게 하고 허락 범위를 고르게 하되, 사람의 직접 결정은 보호 화면에서만 받고 거절과 멈춤을 혼동하지 않게 한다.
- 확인: 카드가 대화를 스크롤해도 composer 위에 남고, [Allow]·[Deny]를 눌러도 confirmation window를 거치기 전에는 request가 결정 대기로 남으며, 창이 고른 범위(once 또는 session)를 미리 골라 열린다. Allow ▾에 "Always allow" 항목이 없고(platform/approvals#R18~R20; 오래 가는 허락은 Agents 화면의 권한 규칙에서만), Deny 옆에 Esc 안내가 있다.
- 의도: shell#I1

**[R48]** 내 메시지에 올리면 "Rewind to here"와 "Fork from here" 단추가 나타나며, Rewind는 되돌리기 menu를 여는 자리이고(header ⋯ 메뉴의 Rewind…도 같은 menu), Fork는 그 메시지까지의 확정 메시지를 복사한 새 session을 같은 agent의 새 탭(앱 공간에서는 같은 칸)으로 연다; header ⋯ 메뉴와 `/`의 Fork는 마지막 확정 메시지까지 복사한다.
- 이유: 되돌리기는 session이 살아 있는 동안 내 메시지를 기준으로 시작한다.
- 확인: 내 메시지에서 menu가 열리고 닫힌 session에는 단추가 없다. menu의 항목·복원 범위·알림 문구는 lophn-agent/revert를 따른다.
- 의도: shell#I1, lophn-agent#I7

### Lophn Workspace settings

**[R49]** Settings의 Providers는 provider의 연결과 인증만 다뤄 연결된 provider(이름·로그인 방법·[Disconnect]이고, 사용량 대기나 사용 불가일 때만 그 상태와 다음 행동 한 줄을 덧붙인다)와 Add a provider 목록([+ Connect])을 보이고, Connect dialog는 로그인 방법을 고르게 하거나 OpenAI 호환 custom provider(ID, Display name, Base URL, API key 선택)를 등록하게 하며 model은 여기서 고르지 않고, 펼치는 계정 목록·순서·계정별 끄고 켜기·연결 테스트는 없고 [Disconnect]는 확인 창을 거쳐 그 provider와 credential을 지운다.
- 이유: provider 하나에 연결 하나이고 model 선택은 agent의 일이다. 다시 로그인하거나 key를 바꾸는 길은 Disconnect 뒤 Connect 하나뿐이다.
- 확인: Providers에 model 선택 칸이 없고 연결된 provider 행에 계정 목록·순서·끄기·테스트 단추가 없으며, [Disconnect]가 확인 창을 거쳐서야 provider를 지우고, 지운 provider는 Add a provider 목록에 다시 나타나 Connect할 수 있고, Connect dialog는 방법 고르기와 custom form 둘을 보이고 Add a provider 목록에 Ollama·LM Studio·llama.cpp 같은 내장 로컬 항목이 없으며, 연결 방법과 규칙은 lophn-agent/harness/provider(R6·R8·R31)를 따른다.
- 의도: shell#I1, lophn-agent#I5

**[R50]** Settings의 Agents는 모든 project에 적용되는 기본값을 Default models(lophn·Context Engineer·App Engineer·Operators 넷의 model과 option)·Model for summaries·모든 project의 LOPHN.md(미리보기와 [Edit])·전역 skill([Add skill])·MCP servers([Add server])·기본 권한 순으로 보이고, General에는 Models와 Instructions 칸을 두지 않는다.
- 이유: agent 설정은 전역 기본값을 한 곳에서 정하고, project나 Operator가 바꾸지 않은 칸은 이 값을 따른다.
- 확인: Default models에 role 넷이 각자 model과 option 값을 보이고, 값을 바꾸면 project가 따로 정하지 않은 agent가 따라 바뀐다. General에 Models·Instructions가 없다. 값의 층과 출처는 lophn-agent/agents, 전역 지침은 lophn-agent/instructions, skill·MCP는 lophn-agent/extensions를 따른다.
- 의도: shell#I1, lophn-agent#I5

## 열린 질문

## 버린 것

- 거처·분류 전·시리즈 중심 전용 탐색과 옛 milestone별 UI 제한 — 새 설계의 프로젝트·문서·앱 중심 탐색과 현재 지원 계약으로 대체한다.
- Electron·Deno·SQLite를 다른 기술로 바꾸기 — 기존 기술 선택을 유지하기로 정했다(R11, R17).
- 전역 팔레트와 런처 복귀를 같은 shortcut으로 묶기 — 전역 팔레트는 CommandOrControl+Shift+K, 런처 복귀는 CommandOrControl+Shift+L로 구별하기로 정했다(R18).
- lophn 공간의 Documents 화면과 Context(Focus) 화면 — 문서와 context는 프로젝트 안에만 있기로 했다. 전체 검색은 상단 검색 팔레트가, 저장한 보기와 반복 문서는 프로젝트 화면이 맡는다(R28, R33, R34).
- 오른쪽 대화 dock과 그 자리 규칙(옛 R1, R2, R29: 400px, 정보 패널과 자리 공유·복원, overlay) — Agent가 탭·칸이 되어 dock이 없다(R37).
- Roles 화면의 역할 목록·상세 공유 열과 하는 일 묶음(옛 R4, R5) — Roles 화면을 지웠다(shell/desktop#Q4). 목록과 설정은 project의 Agents 탭과 Operator editor(shell/workspace), 진행·멈춤은 진행 chip과 Stop(R42), 만든 문서는 편집 카드(R3, R41), 검토는 tool 줄 펼침과 보기 Everything, 사용량은 ⋯ 메뉴 Usage(R38), Undo는 편집 카드(R41)로 간다. trace export는 지웠다.
- composer 위 질문·approval 칸(옛 R6) — 질문은 대화 안 카드(R46), 승인은 composer 위 카드(R47)가 맡고, 세션 없는 요청은 확인할 것이 맡는다(R9).
- 화면마다의 Ask 단추(Settings의 [Ask lophn], Contexts의 Ask, Context 탭의 [Ask Context Engineer], Contexts 탭의 [New context], 탭 줄 `+` 메뉴의 Agent 항목, Violations의 [Send to Context Engineer])와 Lophn Workspace의 agent — agent를 부르는 길은 R36의 셋뿐이다(shell/app-frame#Q3). 새 context는 sidebar의 Context Engineer에서 연 Agent 화면에서 시작한다.
- provider 화면에서 model 고르기와 General의 Models(For decisions·For summaries)·Instructions 칸 — provider는 연결만(R49), model은 agent 정의와 composer(R44), 기본값은 Settings › Agents(R50)로 옮겼다.
- 작업대의 Operator 안내 줄 — project sidebar의 Agents 묶음이 Operator를 보인다(R28).
- Providers 화면의 계정 목록·계정 순서·계정별 끄고 켜기·연결 테스트·내장 로컬 provider 항목 — provider 하나에 credential 하나로 하고 내장 로컬 기능을 지웠다(R49, lophn-agent/harness/provider#R8). 로컬 서버는 custom provider로 연결한다.
