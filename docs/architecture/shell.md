---
type: architecture
concerns: [shell]
---
# shell

## 1. 맡는 것과 맡지 않는 것

shell은 설치된 Electron client다. 문서·앱을 기본 화면으로 열고 대화는 결과를 만들고 고치는 보조 패널로 둔다. 창, 탐색, 문서 편집기, confirmation window, 앱 view 바깥의 [문제 알리기], OS 통합과 공통 디자인 코드를 맡는다.

- 화면에 넣을 사실·허용 행동은 각 concern의 read 결과에서 받는다. shell은 승인 적용, run 재개, 문제 닫힘, notification 생성, 앱 상태 판정을 하지 않는다.
- Electron main만 사람 token을 갖고 platform의 인증·read·command·event 구독을 쓴다. renderer는 DB·keychain·원본 파일·내부 서비스 port를 직접 열지 않는다.
- 파일 쓰기·hash·version 준비는 documents의 파일 쓰기 contract, 앱 실행과 direct call은 apps의 앱 통로, feedback 접수와 snapshot 조립은 problems의 문제 보고 contract에 맡긴다.
- 창 닫기는 종료가 아니다. core는 Electron main의 child라서 tray의 Quit(또는 `--quit`·OS 종료)이 main과 core를 함께 멈춘다. 앱·agent·worker 감독, 단일 writer, 설치의 데이터 위치와 schema migration은 platform 소유다.
- 앱 UI, 문서 본문, agent의 글은 자료다. shell 컴포넌트나 confirmation window 코드로 import·eval하지 않는다. Markdown은 HTML을 그대로 실행하지 않고 안전한 읽기 렌더러로 표시한다. 실행 가능한 문서 format은 별도 격리 문서 view에서 연다.

shell/workspace와 shell/terminal의 domain model은 로컬 UI layout·현재 보기 상태·PTY runtime 값을 정의한다. shell entity·ledger 표는 없으며 view 식별·창 상태·confirmation handle은 프로세스 값이다.

## 2. 프로세스

### 2.1 프로세스와 수명

shell이 관리하는 프로세스는 여섯 역할이다. renderer는 종류별로 여러 개 생길 수 있다. Chromium의 GPU·network utility 프로세스는 Electron이 관리하며 domain 처리 주체로 세지 않는다.

| 프로세스 | 하는 일 | 시작·감독 | 종료 |
|---|---|---|---|
| Electron main 1개 | 창·tray·scheme proxy·IPC 검증·사람 token·core 연결·view registry·confirmation coordinator | OS가 `lophn-desktop`을 시작; 같은 데이터 root의 두 번째 시작은 기존 main으로 전달 | tray의 Quit(진행 중 터미널·저장 확인 뒤), second-instance `--quit`, OS 종료; 그 아래 core와 terminal host도 함께 멈춤 |
| shell renderer 창마다 1개 | 런처·작업대·앱 frame·대화 도크·편집기·feedback 작성 | main이 BrowserWindow 생성; crash는 main이 감지 | 해당 창 닫힘; 마지막 창을 닫아도 tray main 유지 |
| shell overlay view 창마다 1개 | tooltip·sheet·menu·popover·palette·dialog 표시, 경계 drag 중 pointer 받기 | main이 투명 WebContentsView로 생성해 contentView 맨 위에 둠; shell renderer와 같은 설치 코드·session·preload | 창 닫힘; crash는 main이 다시 만들고 열린 떠 있는 UI를 닫음 |
| confirmation renderer 열린 보호 창마다 1개 | 설치된 결정 화면·secret 입력 | main이 별도 BrowserWindow 생성; 전용 preload·메모리 session | 제출 결과 확인·사람 닫기·기준 변경·crash; 미사용 handle 폐기 |
| content renderer 보이는 view마다 1개 | 앱 GUI·패널·카드 또는 격리 문서 | main이 WebContentsView 생성; 앱 UI는 shell renderer에 import하지 않음 | 탭 폐기·release/연결 교체·권한 변경·crash 때 main이 폐기 |
| terminal host Electron 실행당 1개, PTY 탭마다 1개 | PTY spawn·resize·입출력·child 종료·출력 ring buffer | main이 설치된 고정 host를 상속 pipe로 시작·감독; core child가 아님 | main pipe EOF·Electron 종료; 탭 폐기는 그 PTY group만 종료 |

```
사람 → OS → Electron main (사람 token은 여기만)
              ├─ BrowserWindow → shell renderer
              │                   런처 / 문서 편집기 / 앱 frame [문제 알리기]
              │                   └─ schema 제한 preload → Electron IPC ─┐
              ├─ BrowserWindow → confirmation renderer                   │
              │                   결정 전용 preload → Electron IPC ─────┤
              └─ WebContentsView → 앱 / 격리 문서 renderer               │
                                   앱 전용 preload → Electron IPC ──────┤
                                                                        ▼
                   main의 caller 검증·view registry·contract adapter
                    ├─ loopback HTTP JSON / WebSocket → core
                    ├─ 인증된 내부 연결 → identity의 confirmation handle
                    ├─ 파일 쓰기 contract → documents worker
                    ├─ 앱 통로 direct → 앱 프로세스 (core를 중계하지 않음)
                    ├─ 상속 private pipe → terminal host → 탭별 PTY·사용자 shell
                    └─ 문제 보고 contract → problems 수집·redaction
```

main은 read·command·event·앱 direct call을 독립적인 비동기 요청으로 처리한다. 큰 hash, 디렉터리 순회, 압축, 이미지 redaction, model call을 main 실행 흐름에서 하지 않는다. Chromium `capturePage`는 비동기로 요청하고 이미지 가공·redaction은 문제 보고 경계 밖의 작업 주체로 넘긴다.

### 2.2 시작·build·코드 배치

1. main은 `app.requestSingleInstanceLock`을 데이터 root별로 적용하고, 두 번째 시작의 등록된 앱 ID·창 열기 intent만 기존 main에 전달한다. argv의 URL·파일·명령을 일반 실행 권한으로 해석하지 않는다.
2. 창부터 열어 준비 상태를 표시한다. platform/install-and-update의 lock·프로세스 상태 확인 결과로 기존 daemon에 붙거나 bundle된 Deno로 시작을 요청한다. PID만 보고 같은 daemon이라고 믿거나 lock을 직접 지우지 않는다.
3. 인증이 끝나야 API 준비 상태를 읽고 event를 구독한다. core bootstrap·권한 플래그·daemon 수명은 platform이 정한다. shell은 별도 worker를 Deno `-A`로 띄워 빈자리를 메우지 않는다.
4. 로그인 자동 시작은 `--tray` intent로 main과 core만 띄우고 창은 열지 않는다. 모든 창을 닫아도 main·tray와 그 아래 core가 남아 앱 automation과 주기 일이 이어진다. tray의 Quit만 core 정상 종료 순서(contracts#T6 stop frame)를 밟고 Electron을 끝낸다.

코드는 `apps/shell/main/`, `apps/shell/preload/`, `apps/shell/renderer/`에 둔다. main entry는 `apps/shell/main/desktop/main.ts`이며 npm·TypeScript strict로 check하고 esbuild로 main과 preload 세 종류를 각각 CJS 한 파일로 `apps/shell/main/dist/`에 묶는다. sandbox preload의 외부 require는 `electron`만 허용한다. renderer는 Deno workspace에서 SDK와 `packages/design`을 공유하고 esbuild로 shell·overlay·confirmation entry를 `apps/shell/renderer/dist/`에 build한다. CSS Modules는 esbuild `local-css` loader가 클래스 맵으로 바꾸고, Deno import map은 esbuild-deno-loader가 resolve한다. preload 세 종류는 `apps/shell/preload/`, 공유 IPC schema는 `apps/shell/ipc/`에 둔다. main과 renderer가 서로의 실행 코드나 DB 모듈을 import하지 않는다.

- `main/desktop/`: 창·tray·autostart·shortcut·설치 실행 intent. `main/workspace/`와 같은 layout adapter로 창과 공간별 UI 편의 값을 보존한다.
- `main/confirmation/`: 보호 창·handle 수명·결정 제출 adapter.
- `main/app-frame/`: view registry·scheme proxy·session·network·native view visibility.
- `main/editor/`: 파일 쓰기 adapter·창 닫기 guard; 파일 쓰기 구현은 없음.
- `main/workspace/`: layout 검증·원자 저장·요청 창 current-view binding·scope/redaction adapter. `main/terminal/`은 host 감독·IPC caller 검증, `terminal-host/`는 node-pty의 POSIX PTY/Windows ConPTY와 child group을 소유한다. terminal host에 플랫폼 credential을 전달하지 않는다.
- `renderer/workspace/`, `renderer/terminal/`: 네 종류 탭·두 칸 배치·xterm.js 표시·설치 SDK 시각 블록 renderer. 앱 화면 코드는 이 renderer에 import하지 않는다.
- `renderer/overlay/`: shell overlay view entry point. shell renderer와 같은 디자인 컴포넌트·token bundle로 떠 있는 UI만 그리고 업무 상태는 갖지 않는다.
- `renderer/desktop/`, `renderer/editor/`, `renderer/app-frame/`, `renderer/confirmation/`: 화면별 코드. confirmation은 별도 entry point이며 사용자 slot·fork를 읽지 않는다. 공통 wording catalog는 `packages/design/wording/`에 둔다.
- contract DTO와 좁은 API allowlist는 소유 contract schema에서 생성한다. 출력 bundle·generated 파일을 정본처럼 수동 편집하지 않는다.

### 2.3 preload와 IPC 경계

모든 BrowserWindow·WebContentsView에 `sandbox: true`, `contextIsolation: true`, `webSecurity: true`, `nodeIntegration: false`, `nodeIntegrationInSubFrames: false`, `nodeIntegrationInWorker: false`, `webviewTag: false`, `allowRunningInsecureContent: false`를 적용한다. 배포 sandbox 실패를 `--no-sandbox`로 우회하지 않는다. packaged build에서는 devtools를 열지 않는다.

`contextBridge`는 정해진 함수만 노출한다. `ipcRenderer`, 임의 channel·method·URL 요청, filesystem 함수, DB 연결, token·인증 header·앱 연결 자격은 노출하지 않는다.

| preload | 허용하는 함수 범위 | 금지하는 것 |
|---|---|---|
| shell | 생성된 read·일반 사람 command 목록, 탐색·창 조작, workspace 배치·보기 상태, 사람의 terminal 시작·입력·resize·종료, view 열기·bounds·visibility, 편집·feedback·confirmation 열기 intent | approval 허락·거절과 option action 결정의 직접 제출, 임의 credential 발급, daemon 종료 |
| confirmation | main이 고정한 표시 자료 읽기, 해당 창의 결정 제출·취소, 전용 secret 입력 | 다른 대상·명령 선택, 일반 shell API, 앱 호출·파일 접근 |
| 앱 | 자기 앱의 선언된 command 호출과 좁은 외부 링크 열기 | 별도 Query 체계, 다른 앱 호출, shell API·원본 파일 수정·사람 token |
| 격리 문서 | 없음 | 원본 파일 쓰기, 앱 command, 플랫폼 API |

main은 매 IPC마다 다음을 검사한다.

1. `event.sender`가 main registry의 살아 있는 webContents인지, `senderFrame`이 그 webContents의 main frame인지 검사한다. subframe은 거절한다.
2. URL을 파싱해 scheme·host·port·경로를 각각 비교한다. 문자열 prefix만으로 신뢰하지 않는다. 문서·앱·보호 창의 caller 종류를 섞지 않는다.
3. schema에서 모르는 필드·너무 큰 입력·잘못된 enum·잘못된 대상 참조를 거절한다. 페이지가 적은 app·release·mode·actor는 인증에 쓰지 않는다.
4. 허용 동작은 caller 종류와 교집합으로 좁힌다. coding-agent connection 화면은 고정된 연결 intent를 별도 검증하여 confirmation 경로로만 넘긴다.
5. 비동기 결과에는 창·view·요청 generation을 검사한다. 폐기된 view의 응답을 새 view나 다른 탭에 붙이지 않는다.

### 2.4 lophn 화면·탐색

route는 renderer의 로컬 화면 주소다. API endpoint나 domain 주소를 대신하지 않는다.

| 화면 route | 구성 |
|---|---|
| `/` | 48px 창 끌기 바·최대폭 1040px 런처; 프로젝트·앱 카드, 프로젝트 등록, 이어서; lophn 관리는 바 오른쪽 고정 진입점 |
| `/projects/:project` | 프로젝트 작업대: 폴더·문서·연관 컨텍스트 탐색, 문서 편집기·뷰어·터미널·앱 패널 탭과 좌우 분할, 정보 패널; 연결된 실제 프로젝트 목록 사용 |
| `/apps/:app` | 얇은 shell 바·앱 view 전체 본문; [문제 알리기] 독립 버튼·운영 패널·문서 작업대로 전환 |
| `/lophn/:page` | 프로젝트·문서·컨텍스트·앱·확인할 것·역할·설정 탐색; 거처·분류 전·컨텍스트 계층을 만들지 않음 |

새 기본 창은 언제나 런처로 열고, 마지막 공간은 이어서 버튼으로만 복원한다. 제목은 main이 검증된 공간 이름에 `— lophn`을 붙인다. 창 최소 크기는 960×600px, sidebar 240px/접힘 56px·행 32px, 상단 바 48px다. sidebar는 200~400px drag 범위다. macOS 신호등 약 80px, Windows·Linux 창 버튼 138px를 비우고 조작 요소는 drag 영역에서 제외한다.

- 작업대는 네 종류 탭 36px, 좌우 1칸 또는 2칸·최소 칸 폭 480px를 쓴다. 부족하면 분할 설정을 보존한 한 칸 보기로 전환한다.
- 정보 패널은 320px·정보/버전/컨텍스트 탭·기본 닫힘이다. dock 뒤 본문 720px 또는 분할 두 칸과 경계 1px를 남길 수 없으면 overlay다.
- 대화는 오른쪽 400px로 본문을 밀고 정보 패널을 임시 접는다. 본문 480px를 남길 수 없으면 overlay로 바꾼다. 닫으면 이전 정보 패널 상태를 복원한다. 입력·선택 답·커서는 세션별 초안 메모리에서 유지한다.
- 역할은 같은 목록 열과 하는 일/만든 것/대화 탭을 쓴다. 하는 일은 지금/기다림/멈춤/끝남 순서, 다시 시작/다시 시키기는 분리한다. 대화 입력 gate는 lophn-agent/assignments의 현재 허용 결과를 쓰며 회수된 담당은 지난 대화만 읽고 새 입력을 받지 않는다. 결과가 4개 이상이면 첫 3개와 남은 개수·전체 보기를 둔다.
- 질문·approval request 칸은 대화 입력 위 하나, blocking 우선·나머지 접수 순서로 현재 번호/전체와 앞뒤 이동을 둔다. 세션 없는 요청도 확인할 것에서 연다.
- 확인할 것은 기다리는 것/지난 일과 역할·기간 filter로 나눈다. notification 칩은 오른쪽 아래 360px 한 칸·외 n건·보기/닫기만 두고 focus나 현재 문서를 바꾸지 않는다.
- 창 팔레트 `CommandOrControl+K`, 전역 팔레트 `CommandOrControl+Shift+K`, 런처 복귀 `CommandOrControl+Shift+L`은 서로 다르다. 전역 Ctrl+K를 등록하지 않는다. 창 안 두 키는 main이 그 창에 속한 webContents(shell renderer·overlay·앱 view)의 `before-input-event`에서 보고 그 창 shell renderer에 이름만 보낸다. 보호 창의 키는 건드리지 않는다. 팔레트 묶음 순서는 shell/desktop#R30을 따른다.

## 3. 저장

Linux 기본 root는 `~/.lophn`, 변경 시 `LOPHN_HOME`이며 다른 OS root 결정은 platform/install-and-update를 따른다. 이하 `<home>`은 그 검증된 root다. main은 `app.setPath('userData', '<home>/shell/browser')`를 session 생성 전에 적용한다. root별 Electron single-instance 범위도 이 경로에 맞춘다.

| 위치·종류 | 담는 것 | 소유·접근 |
|---|---|---|
| main private 메모리 | 사람 token, 인증된 core 연결, 앱 통로 연결, view registry, 미사용 confirmation handle, 요청 키·접수 확인 중 정보 | main만; platform/identity가 신뢰 시작 경로로 전달; core epoch 변경에 폐기 |
| `<home>/shell/layout.json` | 창 bounds, 마지막 공간, shell/workspace의 프로젝트별 탭 순서·선택·분할 비율·읽던 위치·정보 패널 상태 | `main/desktop/layout`; 디렉터리 0700·파일 0600 또는 동등 ACL, 원자 교체; 본문·결정·token 없음 |
| `<home>/shell/browser/` | 앱별 persistent Chromium partition의 cookie·localStorage·IndexedDB·cache | main의 session manager만 partition 생성; shell·앱·문서 사이 분리; 업무 DB의 정본이 아님 |
| terminal host 메모리 | PTY handle·child group·탭별 최근 10,000줄/5MiB 중 먼저 도달한 출력 ring buffer·순서·종료 관측 | terminal host만; disk·ledger·blob·진단 자동 보관 없음; Electron 종료에 소실 |
| shell renderer 메모리 | 마지막 read와 확인 시각·event cursor, 세션별 대화 초안·커서, 편집 중 아직 전달 못한 내용 | crash·Electron 종료 뒤 보존을 약속하지 않음; 필요 사실은 소유 read로 재구성 |
| main·shell overlay view·feedback 작성 소유 renderer 메모리 | 미제출 feedback 글·button 시점 binding·raw capture·안전한 미리보기 | raw는 main과 문제 보고 경계만 보유; overlay·작성 소유 renderer는 글과 안전한 미리보기만 보유; 취소·창 종료에 폐기; raw screenshot을 disk·일반 log·blob에 쓰지 않음 |
| documents의 원본 파일·working copy | 원본 연결 문서는 등록 프로젝트 파일; 원본 없는 문서는 document별 working copy | 파일 쓰기 contract만 사용; 위치를 shell 설정·browser 저장에 복제하지 않음 |
| platform ledger·blob·derived·앱 DB | 확정 사실·문서 version·redaction된 snapshot·검색·업무 데이터 | shell은 경로를 직접 열거나 표를 쓰지 않음 |
| OS keychain | platform secret contract가 저장한 실제 secret | shell은 보호 입력을 전달하고 안전 참조만 받음; 사람 token의 영구 저장소로 쓰지 않음 |

shell 소유 ledger 표는 없다. `approval_requests/approval_uses`, `notifications`, `questions`, `messages`, `reports`, `events`는 각각 소유 모듈의 command만 쓴다. read cache와 UI layout은 사실의 정본·idempotency 결과 저장소가 아니다. 전역 theme·읽기 폭·OS notification 선택 같은 설정은 platform의 settings contract를 쓰고 layout 파일에 두 번째 설정 정본을 만들지 않는다.

사람 token 원문은 main 메모리에만 두고 renderer·argv·URL·cookie·공통 환경 변수·로그·crash 자료에 넣지 않는다. 재시작 때 예전 token 파일을 임의로 읽어 복원하지 않고 인증 contract로 다시 연결한다. keychain이 없으면 secret을 평문 fallback하지 않으며 secret이 필요 없는 로컬 화면은 계속 연다.

디자인 정본은 `packages/design/tokens.ts`다. 생성한 CSS 변수·TS 타입·문서값, 로컬 Pretendard Variable·JetBrains Mono 파일을 같은 패키지에 둔다. `packages/design/components/`는 CSS Modules·Radix Primitives·Lucide를 쓰는 공통 UI, `packages/design/reading/`는 읽기와 편집기가 공유하는 Markdown 스타일이다. apps/sdk는 이 코드를 고정 SDK package로 배포하는 소유자이며 shell renderer 모듈을 앱에 공개하지 않는다. CodeMirror 6은 `apps/shell/renderer/editor/`에만 있다.

## 4. concern 배치표

| concern | 프로세스 | 모듈 | 저장 | 주로 쓰는 contract |
|---|---|---|---|---|
| shell/desktop | main·shell renderer | desktop, IPC, core client, router, notifications | layout.json·메모리·platform settings | 인증, read, command, event 구독, notification, agent run |
| shell/workspace | main·shell renderer·content renderer | workspace/layout·current-view, tabs·panes·visual renderer | layout.json의 UI 값·현재 보기 메모리; 블록 정본은 lophn-agent/visuals | agent run의 보기 상태 입력, 앱 화면 틀, 문서 read·redaction·앱 context |
| shell/terminal | main·terminal host·shell renderer | terminal supervisor·PTY adapter·xterm.js | host 메모리 ring buffer·runtime; 폴더 선택만 layout | 프로젝트 폴더 read, 사람용 검증 IPC; core 실행 경로 아님 |
| shell/confirmation-window | main·confirmation renderer | confirmation coordinator, 전용 preload·screen | 일회 handle·secret 입력 메모리; shell ledger 없음 | confirmation window, 인증, approval, read, command, secret |
| shell/app-frame | main·shell renderer·content renderer | app-frame/view registry, scheme proxy, session, visibility, feedback screen | 앱별 browser partition·문서 메모리 session·임시 capture | 앱 화면 틀, 앱 통로, 문제 보고, redaction, blob |
| shell/editor | shell renderer·main | editor/CodeMirror, file adapter, close guard | documents의 원본·working copy; 미전달 초안 메모리 | 파일 쓰기, outline·search 읽기, read, event 구독 |
| shell/wording | shell·confirmation renderer; main의 OS 문구 | wording catalog, status presenter, 고정 문구 검사 | build된 문구 catalog; 별도 ledger 없음 | read, 문제 보고, notification, redaction |
| shell/design-system | shell·confirmation·content renderer; build 도구 | tokens, components, reading, theme validator | 코드 정본·생성 CSS/TS·로컬 font | settings는 read·command로; SDK 배포는 apps/sdk |

## 5. 내놓는 contract

shell이 내놓는 최상위 contract는 **confirmation window**, **앱 화면 틀** 두 개다. 둘 다 main 내부 service와 Electron IPC로 제공한다. shell renderer가 HTTP listener를 띄우거나 사람 token을 노출하는 endpoint는 없다. platform·apps는 연결된 main에 구조화된 열기 요청만 전달할 수 있고 결정 제출 권한을 받지 않는다.

### 5.1 confirmation window

**실제 이름과 입력**

- main service `confirmation.open({request, comparison, parentWindow})`는 등록된 결정 종류와 고정 대상 참조·실제 요청 부모 창만 받는다. approval request·question option action·소유 concern의 사람 결정 intent·secret 입력·shell 외부 링크 열기 intent가 대상이다.
- 일반 preload `lophnShell.openConfirmation(intent)` → IPC `shell:confirmation-open`은 창을 열 뿐이다. 임의 command 본문·HTML·허락값을 받지 않는다.
- 보호 preload `lophnConfirmation.getDisplay()` → `confirmation:display`, `submit({displayId, decision, input?})` → `confirmation:submit`, `cancel()` → `confirmation:cancel`만 둔다. input은 해당 결정 schema의 입력이다.
- 일회 handle 원문은 main에 남는다. renderer의 `displayId`는 그 창의 표시 자료 참조이며 bearer credential이나 독립 결정 권한이 아니다. main은 caller registry의 창과 displayId를 함께 확인한 뒤 handle을 붙인다.

**출력**

`open`은 `{windowId, displayId}` 또는 열기 실패를 반환한다. 창 종료 결과는 `{outcome: 'decided', receipt}` 또는 `{outcome: 'dismissed'}`다. receipt는 소유 command의 접수 참조이며 실제 적용 성공이 아니다. secret 입력의 결과에는 안전 참조·저장 결과만 있고 값은 호출자에게 반환하지 않는다.

**일회 handle과 위조 방지**

1. main은 미리보기와 독립적으로 read를 호출해 대상 정본·현재 CAS·허용 결정을 얻는다. 표시 자료와 제출 command는 이 동일한 고정 자료에서 만든다. option action은 concern·command·대상·정확한 입력·비교 기준·영향을 고르기 전에 그대로 보여 준다.
2. 보호 창은 요청한 shell 창의 child modal BrowserWindow(`parent`, `modal: true`)다. 앱 view는 부모 창의 contentView 안에만 붙으므로 다른 BrowserWindow를 덮을 수 없고, 그래서 native view를 숨기거나 detach하지 않는다. 열린 동안 부모 창은 modal로 입력이 막히고, main은 `main/app-frame/visibility`의 모든 앱 webContents에 `before-input-event` 차단을 걸어 OS별 modal 차이에도 앱이 키 입력을 받지 않게 한다. 앱 view는 `setWindowOpenHandler` 거절로 새 창을 띄울 수 없어 보호 창 위로 올라올 창이 없다.
3. 별도 BrowserWindow·메모리 session에서 `lophn-shell://confirmation/index.html`의 설치 코드만 연다. 일반 shell preload와 앱 preload는 없다. 외부 탐색·새 창·download·network·native view 삽입을 막고 부모 shell 입력도 막는다. 앱 전용 창에서 요청해도 main이 이 보호 창을 앞으로 가져온다.
4. platform/identity가 인증한 비공개 main 연결에서 handle을 등록한다. handle은 무작위 32 bytes의 메모리 값이며 core epoch·main 연결·window ID·대상 참조·내용 기준·허용 결정 집합에 결합한다. 유효 기한은 발급 뒤 120초와 대상 기한 중 이른 시각이다. 일반 user token으로 handle을 발급받는 공개 API는 없다. 새 token 종류·ledger 표·지속 허락은 만들지 않는다.
5. 최초 focus는 설명, 결정은 기본 선택 없음·Enter 즉시 제출 없음이다. 개별 버튼의 명시 조작만 `submit`으로 받고 현재 read·연결 상태가 유효한지 다시 검사한다. 위험한 결정의 2차 확인은 영향·scope를 다시 표시하는 별도 단계다.
6. main이 고정 대상·CAS·선택 결정을 소유 command로 보내고 core가 handle 결합·기한·현재 조건 검사와 handle 소비·결정 저장을 같은 짧은 transaction에서 처리한다. approval 한 번 사용은 이후 approval contract의 별개 경계다.
7. 창 닫힘·취소·crash·main 연결 종료·core 재시작·다른 대상 표시 때 미사용 handle을 무효화한다. 기한이 끝나면 버튼을 제거하고 독립 재조회와 새 확인을 요구한다. 이미 제출한 결과가 불명이면 새 handle이나 새 결정을 만들지 않고 command receipt부터 조회한다.

정본 기준이 바뀌거나 다른 곳에서 결정되면 옛 행동을 제거하고 이유·최신 내용 열기만 남긴다. 대상 설명을 새 것으로 조용히 바꾸어 옛 클릭을 적용하지 않는다. secret input은 일반 문구 catalog·event·feedback 캡처 경로와 분리하고 제출·취소·창 종료에 지운다.

**표시**는 shell/confirmation-window#R2의 최대폭 640px이며 좁은 창에는 창 안에 맞추고, 대상·변경 → 영향·위험 → revert 가능 → 결정 순만 기본으로 보인다. 주체·시각·이유·근거·상세 전후는 Details에 접고, 결정에 필요한 정확한 범위는 숨기지 않는다. 현재/바뀐 뒤는 세로, 문서는 바뀐 문단과 앞뒤 1문단·추가/삭제 기호, 전체/code diff는 펼침이다. permission 경로는 고정폭 원문 전체로 표시한다. 앱 동작 전후 자료가 없으면 없다고 적고 안전 preview만 apps/preview 결과로 연다. 사용자 theme은 검증된 token 값만 받으며 slot·fork는 보호 화면에 적용되지 않는다.

**오류**는 공통 `invalid_input`, `not_found`, `forbidden`, `unauthorized`, `conflict`, `unavailable`을 쓴다. IPC sender 위조는 `forbidden`, 사라진 대상은 `not_found`, 끝난 요청·바뀐 내용·사용된/만료 handle은 `conflict`, core·keychain에 닿지 못함은 `unavailable`로 표시한다. 발급·검증의 인증 오류 최종 분류는 인증 contract를 따른다.

**보장**은 설치 코드·독립 정본·일회 증거·현재 비교 기준을 통해서만 사람 결정이 제출된다는 것이다. 침묵·Escape·닫기·notification 읽기·대화 속 동의는 결정이 아니다. **보장하지 않는 것**은 허락 이후 동작 성공, 앱 본문 안의 비슷한 그림 자체 제거, 동일 OS 계정 악성 프로그램·OS 입력 위조·변조된 설치 방어다. threat model은 platform/security를 따른다.

### 5.2 앱 화면 틀

**실제 이름과 입력**

- `appFrame.open({app, mode, release?, screen, size, parentWindow, bounds})` / `replace(view_session, target)` / `close(view_session)`는 main service다. 앱 통로가 확인한 앱·release·실제 연결·모드·network 정책을 입력으로 쓰고 페이지가 주장한 신원은 받지 않는다.
- shell preload `openApp`, `openDocumentView`, `setViewBounds`, `setViewsHidden`, `closeView`의 IPC는 각각 `shell:view-open-app`, `shell:view-open-document`, `shell:view-bounds`, `shell:views-hidden`, `shell:view-close`다. bounds는 창 본문 경계 안의 정수 rectangle로 검증한다. visibility 완료는 main이 적용한 generation을 돌려준다.
- 앱 preload는 `lophnApp.call(command, input)` → `app:call`, `lophnApp.openExternal(url)` → `app:open-external`만 공개한다. read와 write는 blueprint의 command effect로 구분하며 별도 query API를 만들지 않는다. 예외 수집은 설치 preload의 내부 `app:view-error` 경로로 문제 보고 contract에 보낸다.
- feedback용 `lophnShell.beginFeedback(view_session)`, `submitFeedback(draftRef, text, selection)`, `cancelFeedback(draftRef)`의 IPC는 `shell:feedback-begin`, `shell:feedback-submit`, `shell:feedback-cancel`이다. submit은 소유 문제 보고 contract에 넘기는 adapter이지 shell의 새 ledger command가 아니다.

**출력**은 `{view_session, app, release, mode, screen, size, connectionState}`의 안전한 화면 정보·view 상태 변경, 앱 direct call의 응답, feedback의 안전한 미리보기·없는 항목 이유·최종 Report 접수 참조다. view ID는 main이 생성한 메모리 식별이며 credential이 아니다. IPC push는 `shell:view-state`, `shell:feedback-preview`를 쓴다. 이것은 ledger event가 아니라 창 표시 갱신이다.

**session·scheme·network**

- `protocol.registerSchemesAsPrivileged`는 준비 전에 `lophn-shell`, `lophn-app`, `lophn-document`를 secure·standard·fetch 지원 scheme으로 등록한다. session별 `protocol.handle`은 해당 대상의 URL만 처리한다.
- 앱 host는 `app-<ULID 소문자>`처럼 DNS label로, 문서 host는 `ver-<ULID 소문자>`로 만든다. underscore가 있는 entity ID·변하는 slug를 host에 직접 넣지 않는다. main registry가 label→고정 ID를 해석하고 URL 경로 정규화·인코딩·경로 이탈을 검사한다.
- 운영 앱은 `persist:app-<app ID>:live`, preview는 `persist:app-<app ID>:preview-<bundle hash>` partition으로 분리한다. 같은 앱·모드 창들은 같은 partition을 쓰되 다른 앱·preview와 cookie·localStorage·IndexedDB·cache를 공유하지 않는다. 페이지에 플랫폼 credential을 저장하지 않는다.
- shell은 shell 전용 partition, confirmation은 창별 메모리 partition, 격리 문서는 `document-<version ID>-<view ID>` 메모리 partition이다. 문서 view를 닫으면 webContents를 파괴하고 `clearStorageData`·cache 정리를 한 뒤 registry에서 지운다.
- main은 앱 연결을 앱 통로의 `POST /v1/apps/connect`로 얻는다. `session.protocol.handle('lophn-app', handler)`는 `lophn-app://<app label>/<screen key>/...` 요청을 main registry의 고정 연결과 매칭하고 앱 프로세스 Unix socket의 `/screens/<key>/...`로 넘긴다. main의 `node:http` client는 `socketPath`를 사용해 해당 socket에 직접 붙고, 응답 바이트를 `Response`의 stream으로 돌려준다. renderer는 socket 경로·내부 port·인증 header를 받지 않는다. protocol handler는 요청을 낸 webContents를 모르므로 session `webRequest`가 webContents에서 view를 정해 main만 아는 view 표지를 내부 header로 싣고(페이지가 보낸 같은 header는 지운다) handler는 그 view의 연결·screen·size·view_session만 쓴다. 페이지 query는 socket으로 넘기지 않는다. redirect·응답 CSP·MIME을 검사하고 다른 연결로의 redirect를 따르지 않는다. 취소된 protocol 요청은 upstream도 중단하며 무한 응답을 main 메모리에 모으지 않는다.
- 앱 preload의 `app:call`도 같은 고정 socket의 `/_lophn/commands/invoke`에 main이 schema 검증한 호출을 전달한다. 이것은 core command 중계가 아니며 일반 호출은 ledger 기록을 기다리지 않는다. confirm만 approval와 invocation의 선행 접수를 따른다. command effect는 앱 통로가 검증한 blueprint 값을 따른다: 밖에서 가져오기만 하면 read, 가져와 저장하면 write, 앱 밖 상태를 바꾸면 external이다. 바깥 요청은 network grant의 host 경계로만 간다. secret 전송은 앱에 준 grant가 허락이며 호출마다 approval을 더하거나 caller 종류로 막지 않고 전송 직전 플랫폼이 붙인다. shell은 값을 받거나 앱 코드·agent에 전달하지 않는다. automation의 external·confirm 금지는 apps/automations 소유이고 shell이 가져오기·동기화까지 같은 금지로 표시하지 않는다. socket의 OS별 transport 차이는 앱 통로 adapter가 숨긴다. main이 임의 socket 경로나 대상 앱을 renderer 입력에서 고르는 API는 없다.
- 문서 protocol handler는 별도로 blob contract의 고정 version 자원만 proxy한다. 앱 socket 응답·문서 blob·shell 설치 파일은 각 session의 handler와 대상 registry를 공유하지 않는다.
- session `webRequest.onBeforeRequest`와 CSP에서 network를 기본 차단한다. 자기 scheme·자기 대상과 apps/permissions가 전달한 허용 fetch host만 통과시킨다. URL을 파싱해 port·redirect·WebSocket·subframe에도 적용하고 임의 loopback·file·다른 앱 주소는 거절한다. session 정책은 단일 모듈에 등록해 여러 handler가 덮어쓰지 않게 한다.
- 문서 CSP는 `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'`이다. resource는 자기 문서 고정 판에서만 proxy한다. worker의 Node integration도 끄며 worker 요청에 session·CSP·대상·network 경계를 그대로 적용하고 요구에 없는 앱 browser worker 금지를 별도로 만들지 않는다.
- `setWindowOpenHandler`는 deny, permission request/check/device handler는 모두 기본 false, download·fullscreen·webview 삽입·scheme 밖 navigation은 거절한다. 새 창은 main의 검증된 앱 창 intent로만 만든다.
- 앱의 외부 링크는 HTTP/HTTPS·userinfo 없음·8192자 이하를 검사해 live·preview 모두 확인 없이 OS browser로 바로 연다. 링크 열기는 되돌릴 수 없는 일이 아니라서 묻지 않는다. shell 크롬의 외부 링크만 confirmation을 거친다. 링크 기록은 origin·path만 남기고 query·fragment를 제거한다.

**native view와 깨진 앱**

main registry는 `{view_session, webContents, window, app/version, release, mode, connection, generation, attached}`를 갖는다. bounds는 shell renderer가 `ResizeObserver`로 요청하지만 실제 붙이기·숨기기·폐기는 main 한 모듈만 한다. 상단 크롬·[문제 알리기]는 shell renderer 소유이며 앱 bounds에 포함되지 않는다.

- 앱 공간·프로젝트 탭 패널·세션 카드는 같은 frame 경계를 쓴다. 프로젝트 두 칸에서 앱·문서·터미널을 나란히 놓고 보이는 native view를 각 경계에 동시에 attach한다. 입력 focus는 하나다. 앱 공간 운영 패널은 720px, 창 1024px 미만이면 overlay로 두되 패널이 덮지 않는 본문 영역에 앱 view bounds를 줄여 표시하고 패널 닫힘 뒤 원래 bounds로 돌린다.
- tooltip·sheet·menu·popover·palette·dialog는 shell overlay view에 그리고 앱 view는 숨기지 않는다. 탭·칸 경계 drag 중에는 overlay view가 창 본문 전체 bounds로 pointer를 받는다. resize는 16ms마다 bounds 변경을 합친다. 탭 교체는 옛 view부터 숨기고 새 view 준비 후 붙인다.
- 분할의 각 칸과 보이는 앱 카드는 자기 rectangle에 view를 붙인다. main은 창 본문·칸·카드 경계와 교차 영역을 검사한다. 스크롤 밖 카드는 detach한다. 좁은 창에서 대화·정보 패널이 본문을 덮으면 앱 view bounds를 패널 밖 영역으로 줄이고 숨기지 않는다. confirmation window는 별도 modal 창이다.
- release·연결·permission 변경은 옛 view와 연결을 폐기하고 현재 앱 통로를 다시 얻는다. persistent session의 cache·이전 실행 코드가 새 release를 대신하지 않도록 cache를 정리하고 고정 release의 응답만 제공한다. 저장 상태의 존재가 호출 권한은 아니다.
- view 생성·숨김·교체·폐기·실제 attach는 동일 view_session와 generation으로 platform diagnostics에 남긴다. URL query·본문·token은 기록하지 않는다.
- view를 폐기하거나 다른 앱으로 교체하면 main이 `POST /v1/apps/view_closed`로 그 앱 runtime에 옛 view_session이 닫혔음을 알린다. 앱은 닫힌 view의 context 조회·주석 쓰기를 받지 않는다(apps/agent-context). 같은 앱 안의 교체는 같은 view_session이 이어진다.

**shell overlay view**

- main은 창마다 투명 WebContentsView 하나를 `lophn-shell://overlay/index.html`로 만들고 `setBackgroundColor('#00000000')`로 둔다. 앱 view를 attach할 때마다 overlay를 `contentView.addChildView`로 다시 넣어 항상 맨 위에 둔다. z-order는 main의 view registry만 바꾼다.
- 닫혀 있으면 `setVisible(false)`다. menu·popover·tooltip은 그 사각형만, backdrop이 있는 dialog·palette와 경계 drag는 창 본문 전체를 bounds로 쓴다. 그래서 떠 있는 UI 바깥의 click은 그대로 앱이나 shell에 간다.
- shell renderer가 `shell:overlay-open {kind, anchorRect, model}`을 보내면 main이 sender를 검증해 overlay로 전달하고, 선택·입력 결과는 `shell:overlay-result`로 연 쪽에 돌아온다. overlay는 표시와 선택만 하고 command를 직접 보내지 않는다. 검색 palette(`model.search`)는 검색어를 거르지 않고 `shell:overlay-result`의 query로 연 쪽에 돌려주고, 연 쪽이 `shell:overlay-update`로 같은 표면의 행을 바꾼다. 행의 대상은 연 쪽 renderer에만 남고 overlay·main에는 행 id·이름·묶음만 간다. 같은 창에서 열린 표면들은 overlay 안의 sibling DOM으로 두어 shell/design-system#R20의 층을 유지하고 dialog 안 menu도 별도 shell overlay view를 만들지 않고 같은 registry에서 표시한다.
- menu·popover·palette·dialog·sheet 같은 조작 표면만 keyboard focus를 overlay로 옮기고 닫히면 연 요소로 되돌린다. tooltip·경계 drag의 표시만으로 focus를 옮기지 않는다. sheet는 backdrop 없이 Escape·바깥 click으로 닫고 modal 밖 popup은 focus 이동에 닫는다. 자동 notification은 focus와 현재 문서를 유지한다. 조작 표면에 해당 menu·dialog role을, tooltip에는 tooltip 의미를 제공한다.
- overlay는 보안 경계가 아니다. 사람 결정과 secret 입력은 confirmation window만 받는다.

**feedback binding**은 main이 버튼 시점에 `{view_session, generation, app, release, mode, screenPath, observedAt}`를 고정한 뒤 만든 불투명 메모리 참조다. 다른 창·새 release로 재해석하지 않는다. problems/feedback#R5에 따라 보호 창·lophn dialog가 이미 열렸거나 view가 가려진 동안·다른 창은 캡처하지 않고 제외 이유만 남긴다. 그 외에는 `capturePage`를 먼저 요청하고 shell overlay view에 dialog를 연다. 앱 view는 그대로 보인다. 캡처 중 view 교체·crash·timeout이면 이미지를 제외하고 글 작성은 유지한다. capture는 main에서 문제 보고 contract로만 보내고 shell 미리보기에는 같은 PNG를 가리지 않고 전달한다(D32). capture hash·binding·선택 자료를 같은 draftRef에 묶어, 최종 제출 때 새 이미지를 바꿔 붙이지 못하게 한다.

글은 redaction 뒤 공백 외 1~500 Unicode scalar, 화면 상태는 65536 bytes 이하, 이미지 PNG는 긴 변 1600px·2097152 bytes 이하, 전체 전송은 3145728 bytes 이하라는 problems/feedback의 결과를 표시한다. screenshot 기본 선택은 false이며 미리보기를 사람이 확인해야 true다. 이미지는 가리지 않는다. 다른 창은 캡처하지 않고 수집 실패·미선택 이유를 snapshot에 전달한다. 이미지를 얻지 못해도 글을 제출할 수 있다.

**앱 화면 검사 host**는 problems runner가 같은 실행 파일을 `--app-screen-test`로 띄우는 test mode다. `main.cjs`가 시작 flag로 desktop main과 이 host 중 하나만 열어 host는 데이터 root·사람 token·core 연결·single instance·collector를 거치지 않는다. userData는 실행마다 새 임시 폴더, 앱 view는 `app-test-<run>` 메모리 partition, 모든 표면은 `show: false`·offscreen이다. 앱 view는 운영과 같은 adapter·앱 preload·session 정책·`lophn-app` protocol handler(CSP·MIME·경로 검사)를 지나고 화면 byte만 앱 socket 대신 입력의 고정 bundle 화면 폴더에서 온다. `lophnApp.call`은 runner가 준 test 앱 socket의 `/_lophn/commands/invoke`로 가고 외부 링크는 열지 않는다. 앱 IPC의 view 오류는 collector 대신 관측으로 모은다. CSP가 renderer 안에서 막은 요청은 webRequest에 닿지 않으므로 test session에만 더한 preload가 `securitypolicyviolation`의 주소를 main에 보내고, 관측에는 webRequest가 막은 요청과 함께 주소의 sha256만 싣는다. 화면마다 load 뒤 늦은 오류를 기다린 다음 버튼 시점 binding(view가 살아 있고 main frame이 그 화면 주소), 새 frame 캡처, 앱 view 위 다른 renderer의 dialog 자리 열기를 각각 1500ms까지 본다. 남은 기한을 남은 화면 수로 나눠 멈춘 화면이 다른 화면을 막지 않는다. 입력과 관측은 상속 fd 3의 JSON 한 줄씩(65,536 bytes 이하, contracts/shell schema)이고 stdout은 쓰지 않는다. 관측을 쓰지 못하면 아무것도 쓰지 않고 0이 아닌 code로 끝나 runner가 판정 불가로 둔다.

**오류**는 잘못된 표면·bounds·URL에 `invalid_input`, 범위 밖 caller·host에 `forbidden`, 옛 release·binding 불일치에 `conflict`, 앱 중지·연결 없음에 `unavailable`이다. capture 실패는 첨부 없는 결과이며 feedback 글 보내기 실패와 합치지 않는다.

**보장**은 앱 crash·무한 loop에서도 독립 shell renderer의 크롬·feedback 작성 경로가 남고, view 신원은 main이 정하며, 내부 port·token이 노출되지 않는다는 것이다. **보장하지 않는 것**은 앱 업무의 정확성·완전한 CPU/메모리 격리·crash 이후 마지막 픽셀 복원·임의 개인정보의 완전한 자동 redaction이다. 무한 loop·큰 렌더링·crash에서 shell과 다른 앱 조작을 실제로 테스트하고 WebContents 분리만으로 자원 격리 완료라고 하지 않는다.

### 5.3 workspace·터미널의 내부 표시 경계

workspace는 `WorkspaceLayout`을 schema 검증하여 `<home>/shell/layout.json`에 원자 교체한다. 프로젝트 reopen·[이어서]에서 현재 대상과 권한을 다시 읽고 탭을 만든다. 실패 참조는 placeholder로 유지하며 terminal은 종료된 자리만 복원한다. 새 기본 창은 여전히 런처다. preview·편집 초안·출력·credential·앱 업무 상태는 layout에 넣지 않는다.

사람의 요청·steering을 보내는 shell main이 `{window_ref, generation, observed_at, project, tabs, focused_pane, selection, app_view, availability, omissions}`를 현재 보기 상태로 묶는다. renderer가 제공한 layout 힌트를 main의 실제 view registry·현재 scope와 대조한다. 문서 선택은 판·절·줄 범위만, 앱은 실제 app·release·mode·screen·size 참조만이다. 신뢰 agent runtime과 인증된 요청 연결로만 전달하고 prompt-assemble이 매 turn 사용할 때 현재 창 generation을 다시 확인한다. 최대 2048 bytes 요약과 최대 20개 탭의 상세 page를 제공하며 platform/redaction 실패는 omission이다. 상세 앱 상태는 apps/agent-context의 read command로 읽고 DOM·screenshot·편집 초안·터미널 출력은 자동 전송하지 않는다. 창이 닫히거나 단절되면 unavailable을 표시하며 주기 run에 마지막 사람 창을 임의 결합하지 않는다.

터미널 IPC는 `shell:terminal-open({project, folder_ref})`, `shell:terminal-input({terminal_ref, generation, text})`, `shell:terminal-resize({terminal_ref, generation, columns, rows})`, `shell:terminal-close({terminal_ref, generation})`다. main이 실제 shell main-frame caller·소유 창·focus·runtime generation을 검사하고 상속된 private pipe로 terminal host에 보낸다. shell 시작은 OS 사용자 shell 실행 파일과 argv 배열로 직접 spawn하며 command 문자열을 인자로 만들지 않는다. Linux/macOS 사용자 login shell, Windows PowerShell 7 또는 표시한 5.1을 사용한다. 사용자가 고른 등록 폴더만 cwd로 검사한다. OS 사용자 환경에서 플랫폼 내부 credential·endpoint를 제거하고 host의 제어 pipe는 shell child에 상속하지 않는다.

host는 비동기 PTY I/O를 처리하고 terminal별 10,000줄·5MiB ring buffer를 순서와 dropped_output 표시로 관리한다. xterm.js에는 OSC clipboard·자동 링크·파일/앱/플랫폼 동작 handler를 등록하지 않는다. 출력 push는 `shell:terminal-output`, 종료는 `shell:terminal-state`로 보내며 renderer 재생성 때 host가 살아 있으면 buffer만 다시 읽어 표시한다. output flood는 chunk 단위로 양보·buffer 상한 적용하여 main과 다른 PTY가 막히지 않게 한다. 닫기·Electron 종료의 사람 확인 뒤 Linux/macOS process group 또는 Windows ConPTY·Job Object의 child 종료를 확인한다. 시작 실패·exit code·unknown을 구별하고 host crash 뒤 자동 shell 재시작·입력 재생은 없다. 이 IPC와 host runtime은 ledger command가 아니다.

### 5.4 시각 블록 renderer와 sandbox

lophn-agent/visuals의 검증된 선언형 블록만 설치 SDK의 허용 컴포넌트 registry로 그린다. 종류·필드·크기 schema를 통과하지 못하면 같은 자리에 오류와 안전한 설명만 둔다. agent의 JS·HTML·CSS·URL을 import·eval·innerHTML로 실행하지 않으며 표·차트 label과 도표 text는 escape한다. SDK renderer는 설치 코드이고 블록 데이터는 지시가 아니다. 고정 문서 참조는 기존 문서 view 경계로, 앱 카드는 blueprint가 선언한 card size의 screen와 기존 appFrame.open으로 연다. 문서·앱의 WebContentsView는 shell renderer·서로 다른 대상과 격리되어 같은 sandbox·session·network 정책을 유지한다.

카드는 view registry에 message·block의 로컬 표시 참조와 generation을 묶고 ResizeObserver·scroll 관측으로 현재 보이는 rectangle만 main에 전달한다. 크기 상한은 lophn-agent/visuals를 따르고 shell은 별도 내용 한도를 만들지 않는다. shell 크롬의 제목·출처·시각·[문제 알리기]·문서로 남기기는 앱 bounds 밖이다. save는 visuals의 기존 문서 저장 contract를 호출하고 완료 후 고정 문서 링크를 표시한다. loading·error·empty·접근 불가를 다른 블록과 세션 입력을 막지 않는 해당 자리 상태로 표시한다. crash·무한 loop·큰 렌더링·미지원 card와 보호 창 경쟁을 실제로 테스트한다.

## 6. 쓰는 contract

| contract·소유 | shell에서 쓰는 곳 |
|---|---|
| 인증·platform | 신뢰 main 연결·사람 token·caller scope·일회 handle 발급 권한 검사 |
| read·command·event 구독·platform | 목록·상세·결정 정본·접수 확인·화면 갱신; command는 CAS와 같은 idempotency key 유지 |
| blob·platform | 고정 문서 자원 읽기; 내부 저장 경로 직접 열지 않음 |
| secret·redaction·platform | 보호 입력 전달·안전 참조, feedback·OS 표시·오류 자료의 안전 출력 |
| approval·platform | 허락·거절과 적용·한 번 사용을 구분; shell이 approval use를 따로 확정하지 않음 |
| notification·platform | 확정된 notification 표시·명시 읽음·OS 표시; 모든 event를 notification으로 바꾸지 않음 |
| 파일 쓰기·documents | 사람의 파일 읽기·자동 저장·편집 종료·결과 확인·충돌; 디스크 I/O는 worker |
| outline·search 읽기·documents | 고정 version의 탐색·section·본문과 index 지연 표시 |
| 앱 통로·apps | 화면 proxy·앱 command direct call·현재 release/연결 확인 |
| release 준비·적용·apps | 변경과 영향·시작 확인 결과 읽기; shell은 앱 프로세스를 감독하지 않음 |
| 문제 보고·problems | feedback 자료 준비·redaction·선택·접수와 앱 view 예외 전달 |
| agent run·lophn-agent | 요청·steering·다음 일·stop·진행·기다림·결과 링크 표시, 요청 창에 묶인 현재 보기 요약 전달 |
| 앱 context·apps/agent-context | 실제 view의 앱·release·screen·size 참조; 상세 읽기·되쓰기는 선언 command만 사용 |
| 시각 블록·lophn-agent/visuals | 검증된 블록 순서·참조·내용·문서로 남기기 결과 표시; SDK 컴포넌트는 apps/sdk |

core RPC는 platform/api의 `POST /v1/<resource>/<method>`, event는 WebSocket `/v1/events/subscribe`, 놓친 event 조회는 `/v1/events/list`를 쓴다. main의 생성된 adapter가 소유 contract 이름을 이 API schema의 resource·method로 연결한다. 이 파일은 다른 소유자의 command 목록·입출력·오류를 다시 정의하지 않는다. core의 요청에 Origin을 보내는 renderer fetch를 열지 않고 main의 인증된 HTTP client만 사용한다.

### OS 통합·설치에서 쓰는 경계

- tray는 창 열기·런처·로그인 자동 시작·Quit을 둔다. 창 열기는 가장 최근 창을 앞으로 가져오고 창이 없으면 새 기본 창을 연다. 런처는 새 기본 창이다. Quit은 main의 tray callback에만 있고 일반 preload에 넣지 않는다. 진행 중 터미널·저장이 있으면 OS 확인 창(기본·Esc는 취소)으로 묻고, 고른 때만 terminal host와 core를 멈춘 뒤 Electron을 끝낸다. 확인할 창이 없는 second-instance `--quit`은 그 사실을 log에 남기고 같은 종료 순서를 밟는다.
- Linux `.desktop`, macOS app bundle, Windows shortcut은 고정 앱 ID를 `lophn-desktop --open-app <app ID>` intent로 전달한다. main은 현재 read와 앱 통로를 확인해 같은 앱 frame의 전용 창을 연다. shortcut은 앱 코드·source path·token·고정 port를 실행하지 않는다.
- 전역 shortcut 등록 실패는 해당 기능의 사용 불가로 안내하고 다른 shortcut을 임의 점유하지 않는다. 종료 때 main이 등록을 해제한다. OS 자동 시작은 packaged 실행 파일의 검증된 절대 경로와 tray intent만 등록한다(Linux XDG autostart entry, macOS·Windows login item). 경로가 실행 가능한 파일이 아니거나 제어 문자·따옴표·Exec field code 글자를 담으면 등록하지 않는다. macOS login item은 인자를 넘기지 못해 OS가 알려 준 로그인 시작을 tray intent로 읽는다.
- OS notification은 설정의 opt-in 때만 표시하고 제목 `lophn`, en message key의 본문 `Something needs your attention`과 내부 notification ID의 클릭 연결만 쓴다. 이름·문서 내용·secret·원문 오류는 OS에 넘기지 않는다. 클릭은 해당 확인할 것/결과를 열 뿐 결정·읽음 command를 대신하지 않는다.
- `NotificationCreated`의 현재 도착분만 OS 표시 대상으로 삼고 재연결의 backlog를 연속 재생하지 않는다. main 메모리의 표시 ID 중복 억제는 domain 읽음 상태가 아니다. OS 실패여도 ledger notification·창 안 목록은 남고 자동 retry 루프를 추가하지 않는다.
- shell build·preload·renderer·로컬 font·고정 의존성·bundle된 Deno를 설치 staging에 제공한다. electron-builder로 OS별 포장하되 지원 완료·서명·공증·sandbox 검증과 데이터 위치는 platform/install-and-update 기준을 따른다.
- 첫 update는 수동 OS 패키지 설치다. shell은 새 version·OS·schema 호환·정상 정지·재시작 필요를 보여 줄 뿐 autoUpdater 다운로드·자동 설치·무단 재시작·데이터 초기화를 하지 않는다. backup·migration은 platform이 수행한다.

### 디자인·문구 검사

`tokens.ts` 하나에서 CSS·TS·문서값을 생성하고 모든 컴포넌트는 생성 token만 사용한다. token-only lint는 색·길이·시간·굵기·z-index·breakpoint·없는 token 참조를 막는다. theme override는 이름 추가·삭제 없이 값만 검증하고 실패한 값만 기본값으로 돌아간다. 전역 검증 결과를 shell과 앱 session에 같은 CSS 변수 집합으로 적용하되 보호 창은 설치 컴포넌트와 검증된 값만 사용한다.

화면은 Playwright E2E로 동작을 검사한다. 키보드 focus 복원, 읽기/편집 첫 블록 위치 차이 4px 이하, 떠 있는 UI·경계 drag 중 앱 view가 사라지지 않음, 보호 창 열림 중 부모 창·앱 view 입력 차단을 별도 테스트한다. 접근성(screen reader, 대비 검증, reduced-motion)은 범위 밖이라 테스트하지 않는다. 차트 palette 변경 검증은 shell/design-system의 정한 값을 검사하며 새 색이나 차트 정책을 여기서 만들지 않는다.

고정 UI 문구는 `packages/design/wording/`의 en-only catalog와 shared 타입으로 main·shell·overlay·confirmation renderer에 전달한다. 모든 고정 문구는 shell/wording#R14의 `<screen>.<part>.<name>` key·ICU MessageFormat을 쓰며 날짜·숫자·상대 시각은 Intl API로 formatting한다. locale을 더할 때 같은 key의 catalog를 더하고 문장 조각을 이어 붙이지 않는다. 문구 검사는 직접 문자열·없는 key·빠진 en 값·placeholder 불일치를 오류로, 사용자 화면의 ID 접두사·snake_case·원시 enum·ledger·release·invocation·assignment 같은 안쪽 개념 이름을 경고로 처리한다. 문서·코드·별도 개발자 diagnostics는 이 경고에서 제외한다. 화면 말의 mapping과 자유 글·고정 문구 구분은 ui-ux/README.md#3,#4를 따른다. agent 자유 글은 key로 만들지 않고 en 언어 규칙만 지킨다. 기본 안내는 짧고 직접적인 1~2문장·영향·다음 행동 하나, 버튼·제목은 마침표 없음이다. 문제 문구는 problems가 확정한 값을 그대로 쓰며 shell이 placeholder·앱 이름을 다시 합성하지 않는다. 앱 기본 안내·tooltip·사용자 상세에 stack·log·원문 오류를 넣지 않는다.

화면 전체 UI/UX 규칙은 docs/ui-ux/README.md, 공통 시각·조작 값은 shell/design-system, 여러 concern을 지나는 사람 흐름은 docs/flows가 정본이다. 이 architecture의 route·adapter는 그 명세를 구현할 뿐 별도 정보 목록을 늘리지 않는다. read의 세부 단계는 메모리 presenter에 보존하되 기본에는 지금 필요한 결과·다음 행동만 표시하고 Details에서 필요한 근거를 펼친다. 내부 재검사·scan·index·redaction·retry 과정은 기본 화면에 진행 목록으로 만들지 않는다.

## 7. 흐름

### 7.1 시작해서 문서·앱을 연다

```
OS → main: data root·single instance 확인
   → main: 창을 런처로 생성 / tray mode면 창 없음
   → main: platform의 daemon 확인·시작 경로 → 인증
   → main: read·event 구독 → shell renderer: 실제 프로젝트·앱 카드
사람 → renderer: 공간 선택 → main: 해당 read·앱 통로
   ├ 문서 → 고정 version 읽기 → 작업대·outline
   ├ 앱·패널 → main: session·view 신원 고정 → GUI direct proxy → 각 칸 view attach
   └ 터미널 → main: 등록 폴더·사용자 shell 확인 → terminal host: PTY 생성
             → host output ring buffer → main → 해당 탭 xterm.js 표시
```

시작 event 하나로 앱을 응답 중이라고 표시하지 않는다. 마지막 확인 시각과 현재 연결 결과를 분리한다. shell은 AppCreated 뒤 assignment 생성 command를 내지 않는다. [이어서]는 저장 layout으로 현재 대상의 탭을 만들되 PTY를 시작하지 않는다. 사람이 terminal 탭 시작을 누른 때만 host가 shell을 만든다. 사람 입력은 focus·generation 검증 후 같은 PTY로 전달하며 종료와 출력 누락은 별도 상태다.

### 7.2 approval·option action을 결정한다

```
platform/apps → main: 고정 대상 confirmation 열기 요청
또는 사람 → shell renderer: [확인하기] → main: open intent
 → main: 정본 read·CAS 일치 검사
 → main: 부모 창 modal 입력 차단(앱 view는 그대로 보임)
 → main: 전용 보호 창·handle 등록 → confirmation renderer: 고정 내용 표시
사람 → 보호 renderer: 개별 결정 버튼
 → main: caller·displayId·연결 검사 → 소유 command + handle + CAS + 같은 요청 키
 → core: 증거 소비·결정 저장 transaction → main: receipt → 화면: 결정됨
 → 소유 concern: 적용·run 재개 → shell: 별도 read로 실제 결과
```

action 없는 질문·자유 답은 일반 답 경로이고 이를 command로 해석하지 않는다. action 답 확정과 실제 action 적용을 두 사실로 보여 준다. secret 입력도 전용 창에서만 받아 secret contract로 보내며 값은 이 흐름의 결과에 없다.

### 7.3 앱 command를 쓴다

```
앱 renderer → app preload: call(command, input)
 → main: 실제 view의 앱·release·mode·연결·schema 검사
 ├ 일반 command → 앱 통로 direct → 앱 응답 → 앱 renderer
 │                                   └ apps: invocation 비동기 전달 → core command
 └ confirm command → approval contract → 7.2 confirmation
                    → apps: accepted invocation + approval 사용을 같은 command로 확정
                    → main: 같은 접수의 실행 근거로 앱 direct call → 응답
                    → apps: 결과 비동기 전달 → core command
```

결과 불명인 앱 write·external command를 새 invocation으로 자동 반복하지 않는다. release가 바뀌면 옛 입력을 새 release에 자동 재전송하지 않고 새 화면 열기를 안내한다.

### 7.4 깨진 앱에서 문제를 알린다

```
사람 → shell frame [문제 알리기] (앱 renderer 밖)
 → main: button 시점 binding·관측 시각 고정, 앱 view capturePage 먼저 요청
 → shell overlay view: dialog·글 입력 열기 (앱 view는 그대로 보임)
 → problems: 안전한 화면 상태·snapshot 자료·redaction 준비
 → shell renderer: 안전 미리보기·수집 실패 이유·첨부 선택
사람 → [보내기] → main: 고정 Report ID·draftRef·선택 자료
 → 문제 보고 contract: 최종 redaction·blob 준비 → core 접수 command
 → main → shell renderer: Report 접수·Problem 링크
```

캡처 응답은 1500ms까지만 기다려 미리보기에 붙인다. timeout·crash·binding 변경이면 늦은 이미지는 버리고 첨부 없음 이유로 진행한다. 글은 앱 응답을 기다리지 않고 쓸 수 있다. 접수는 수리 시작·문제 닫힘이 아니다. 취소는 메모리 준비 자료만 지우고 ledger 기록을 만들지 않는다.

### 7.5 문서를 편집하고 외부 충돌을 만난다

```
사람 → 작업대: 문서 열기
 → main: 고정 version read / 파일 쓰기 contract로 실제 파일·base_hash 읽기
 → shell editor: CodeMirror 초안·커서 유지
고침 → main: target·base_hash·request_key·바이트 전달
 → documents worker: 파일 쓰기 contract
 ├ written → shell: 디스크 저장 표시
 │         → worker: file.record_result command → core: 파일 event
 │         → 편집 종료·명시 저장 경계: version 준비 → core command
 │         → shell: version 확정/검사 문제 / derived read: search 지연 별도
 └ conflict → shell: 초안 유지·지속 충돌 막대·현재 파일과 비교
```

target은 원본 연결이면 등록 프로젝트 파일, 아니면 document별 working copy다. 경로 생성·원자 교체·hash 비교는 documents가 수행한다. 자동 저장마다 version을 요구하지 않는다. 탭 닫기·파일/읽기 전환·창 닫기·CommandOrControl+S는 마지막 파일 변경을 flush하고 documents의 편집 종료 경계에 연결한다. worker가 알린 유휴 종료도 같은 결과로 표시하고 shell에 별도 version timer를 만들지 않는다.

쓰기 실패·불명·충돌에서 탭·창 닫기를 잠시 막고 초안 보존과 비교/접수 확인 경로를 제시한다. disk 성공·기록 확인·version 확정·format 검사·search 반영을 한 저장 완료로 합치지 않되, 머리 메타 줄에는 현재 결과·필요한 다음 행동만 보이고 단계별 사실과 관측 시각은 Details에서 펼친다. 외부 파일을 자동 병합·덮어쓰지 않는다.

### 7.6 단절 뒤 돌아오고 notification을 표시한다

```
main: core 연결 끊김 → renderer: 마지막 화면·확인 시각·최신 확인 못함
                        → confirmation: 제출 gate 닫기·옛 버튼 제거
재연결 → main: 인증·core epoch 확인 → event cursor 따라잡기 + 현재 read
       → renderer: 원래 대상의 상태 갱신·초안 유지·중복 표시 제거
       → main: backlog는 OS 표시하지 않음 / 새 NotificationCreated만 opt-in 표시
OS notification 클릭 → main: 현재 notification read → 확인할 것/결과 열기
명시 [읽음으로 표시] → main: notification 소유 command → core event
```

대화 전송은 보내는 중/접수됨/못 보냄/접수 확인 안 됨을 나누고 결과 불명은 새 요청보다 원래 접수를 먼저 조회한다. streaming 글은 임시 표시이며 확정 Message·산출물 링크를 읽어 교체한다.

## 8. 실패와 재시작

| 실패 | 처리 |
|---|---|
| core 연결·event 구독 단절 | 마지막 read·확인 시각 유지; 새 결정·파일 변경 gate를 닫음; 인증 뒤 cursor와 현재 read로 맞춤. cursor 공백 복구 불가면 event contract의 새 기준 read로 시작 |
| command 응답 유실 | 요청 키·대상·CAS를 유지하고 command receipt 조회가 먼저; 같은 command의 확정 결과만 표시. 새 approval·새 앱 호출로 대체하지 않음 |
| core epoch 변경 | 사람·앱 연결과 미사용 handle 폐기; 인증·현재 read·앱 통로를 다시 얻음. 늦은 옛 응답은 generation 불일치로 폐기 |
| terminal host crash·main pipe EOF | PTY group 종료 관측; 터미널 결과 불명·출력 일부 없음 표시; 자동 shell 재시작·이전 입력 재생 없음 |
| shell renderer crash | main이 native view를 detach하고 창을 다시 연 뒤 domain read로 대기 요청·목록 복구. layout 복구는 편의뿐; 메모리 초안 전체 복구를 약속하지 않음 |
| 앱 view crash·무한 loop | 독립 frame 유지·연결 상태 표시·feedback 글 작성 가능. 캡처 실패 이유를 전달; 자동 재호출 없이 현재 연결로 새 view를 여는 행동 제공 |
| shell overlay view crash | main이 overlay를 다시 만들어 맨 위에 두고 열려 있던 떠 있는 UI는 닫힘으로 연 쪽에 알림. 앱 view 숨김으로 돌아가지 않음 |
| confirmation renderer crash·닫힘 | 미사용 handle 무효화·결정 없음. 제출 진행 중이면 접수 결과 조회 전 자동으로 창을 재생성하거나 같은 증거를 재제출하지 않음 |
| main crash·Electron 재시작 | terminal host는 pipe EOF에 child group 종료; output 메모리 소실. core·앱·agent 수명은 독립. main은 신뢰 인증을 다시 하고 모든 보호 창을 새로 열어야 함. 이전 handle·view binding·raw capture를 복구하지 않음 |
| 파일 쓰기 결과 불명·worker 종료 | documents의 결과 조회·현재 파일 재관측 경로를 쓰고 자동 재쓰기하지 않음. working copy로 남은 내용만 복구; version으로 확정됐다고 추측하지 않음 |
| capture·redaction 실패 | 해당 첨부 제외·이유 표시·글만 제출 가능. raw capture를 임시 disk에 저장해 우회하지 않음 |
| keychain unavailable | secret 저장·사용 실패를 분리하고 평문 fallback 없음; 이미 읽은 로컬 문서·secret 불필요 앱은 계속 |
| OS notification·shortcut 실패 | 창 안 기록과 기존 조작 유지·해당 OS 기능 실패만 안내. notification을 새로 만들거나 다른 key를 대신 등록하지 않음 |
| 설치 sandbox·schema 호환 실패 | 정상 사용 가능으로 표시하지 않음. 설치·backup/migration의 복구 행동으로 연결; 안전 옵션을 끄지 않음 |

scene별 loading은 300ms 이후 해당 자리를 유지한 skeleton으로만 표시한다. 한 API 실패로 전체 창을 가리지 않는다. protection만 의도적으로 부모 입력을 막는다. 없는 자료·결과 불명·미검증을 성공·0으로 채우지 않는다. main log에는 코드·안전한 대상 참조·generation·영향만 남기고 사람 token·secret·본문·URL query·raw image를 넣지 않는다.

검증은 main의 IPC sender 위조·subframe·다른 scheme/host·path traversal, 앱/문서/preview session 교차 읽기, 보호 창 열림 중 부모 창·여러 패널·카드 view의 입력 차단, PTY 환경의 credential 제외·제어 문자열·출력 상한·host crash·child 잔존, 요청 창과 current-view generation 경쟁, 시각 블록 script 거절·카드 스크롤 bounds, handle 중복·만료·재시작, view crash·무한 loop 중 feedback, 자동 저장/외부 변경/창 닫기 충돌, 재연결 backlog와 불명 접수 등을 대상 옆 테스트로 둔다. 지원 OS에서 실제 Chromium sandbox와 OS 통합·설치·update를 확인하며 mock 동작 검사만으로 완료라고 하지 않는다.

## 9. 이전과 달라진 것

- 이전: 작업대는 문서 탭만 갖고 앱과 문서는 나란히 놓지 않으며 focus native view만 표시했다. / 지금: 문서·터미널·앱 패널을 같은 탭 줄과 두 칸에 놓고 각 경계의 native view를 동시에 표시한다. / 이유: shell#I2에 맞추며 입력 focus와 표시 여부를 구별한다.
- 이전: shell domain model은 없었다. / 지금: workspace의 UI layout·현재 보기 값과 terminal의 PTY runtime 값을 정의하고 ledger 표는 만들지 않는다. / 이유: 복원할 UI 편의와 업무 정본·출력·권한을 분리한다.
- 이전: 세션은 글·결과 링크만 표시했다. / 지금: 검증된 선언형 SDK 블록·격리 문서·앱 카드 frame을 답 안에 놓는다. / 이유: 시각 자료를 읽되 agent 코드가 shell 실행 권한을 얻지 않게 한다.

- 이전: 앱 command·조회가 daemon을 경유하고 `action/query`를 별도로 노출했다. / 지금: 선언된 command 하나의 direct call과 effect 구분만 쓴다. / 이유: A4와 현재 apps/invocations·shell/app-frame의 통로에 맞추고 ledger와 무관한 응답을 기다리지 않게 한다.
- 이전: 일반 shell 화면에서 보호 dialog를 그리고 native view만 숨기거나 native message box로 확인했다. / 지금: 설치된 전용 보호 renderer·preload·session과 identity가 검증한 일회 handle을 쓴다. / 이유: 일반 자료 표시·OS 링크·앱 UI가 실제 사람 결정 권한을 빌리지 못하게 한다.
- 이전: menu·popover·dialog를 열거나 경계를 drag할 때 앱 view를 숨겼다. / 지금: 떠 있는 UI는 앱 view 위의 shell overlay view에 그리고 앱 view는 숨기지 않는다. / 이유: 앱 view가 HTML 위에 붙는 Electron 한계 때문에 메뉴를 열 때마다 앱 화면이 사라지는 것은 사람이 견딜 일이 아니다.
- 이전: 보호 화면을 띄우기 전 모든 native view를 숨겼다. / 지금: 보호 창을 child modal BrowserWindow로 띄우고 앱 view는 보이게 둔 채 입력만 막는다. / 이유: 앱 view는 다른 창을 덮을 수 없어 숨김이 보안을 더하지 않고, 결정하는 동안 보던 화면이 사라지는 UX 손해만 크다.
- 이전: 직전 architecture가 앱 메모리 session을 첫 구현으로 추천했다. / 지금: 현재 요구에 따라 앱별 persistent session을 쓰고 live·preview·문서 고정 판을 분리한다. / 이유: shell/app-frame#R1이 정한 앱 상태 보존을 지키되 preview와 고정 문서가 운영 상태를 공유하지 않게 한다.
- 이전: main이 secret master key를 만들고 daemon에 전달하며 keychain 실패 때 passphrase fallback도 있었다. / 지금: main은 보호 입력·안전 참조만 중계하고 secret 값 저장은 platform secret contract가 OS keychain에 맡는다. / 이유: 현재 단일 secret 경계를 따르고 shell이 별도 보관 체계를 만들지 않는다.
- 이전: 시기 이름이 코드 경로·client adapter에 섞였다. / 지금: `apps/shell`과 concern 이름 모듈·`packages/design`으로 배치한다. / 이유: A11에 따라 같은 일이 한 곳에 있고 과거 v2 장치를 가져오지 않는다.
- 이전: legacy 디자인의 거처·분류 전·컨텍스트 계층·milestone별 제한이 화면에 남았다. / 지금: 런처→프로젝트/앱/lophn 공간, 문서·앱 중심 탐색과 얇은 앱 frame을 쓴다. / 이유: 현재 shell/desktop의 실제 대상과 조작을 유지한다.
- 이전: SDK 폴더마다 token·읽기 스타일을 복사하거나 shell 편집기까지 공개하려는 범위가 섞였다. / 지금: shell/design-system 정본에서 생성하고 SDK는 고정 package 배포만, CodeMirror는 shell 전용이다. / 이유: 공통 시각 규칙은 재사용하고 두 번째 소비자가 없는 편집기 공개 계약은 만들지 않는다.
- 이전: 과거 notification event·진행 글을 OS로 그대로 보냈다. / 지금: platform이 확정한 NotificationCreated만 opt-in·최소 문구로 표시하며 backlog는 재생하지 않는다. / 이유: notification 계기·기록은 한 곳에서 정하고 OS 노출·focus 방해를 줄인다.

## ticket에서 coding TUI를 시작한다

사람 ticket [Start] → shell main: exact ticket/harness/method의 one-use human_start_handle·operation_id 확인 → coding-agent/sessions: 현재 ticket·connection scope·catalog version/profile·executable·project folder를 검증한 LaunchPlan → 인증 경계: keychain connection을 실제 child generation의 trusted loader에 보호 전달 → terminal host: executable/argv/cwd로 PTY 직접 spawn → adapter: 첫 prompt 정확히 1회 → 사람: 같은 project 터미널 탭 TUI. 별도 confirmation window 없이 클릭 자체가 이 시작의 허락이다. credential 발급·scope 확대·harness 자체 trust 결정은 대신하지 않는다.

중복 접수는 같은 runtime ref만 반환한다. 준비·prompt 전달 결과 불명은 unknown이며 자동 재전송·새 spawn·resume은 없다. renderer 복원은 살아 있는 host에 재연결하고 layout 복원은 PTY를 시작하지 않는다. TUI session 상태·native ID는 derived evidence이고 actual ticket claim·완료·문제 닫힘과 분리한다. 일반 shell은 기존 비주입 환경을 유지한다. 터미널 일반 agent 제어 contract나 미래 coordinator 권한은 여기서 만들지 않는다. → shell/terminal#R4,R5,R12,R13, coding-agent/sessions#R1~R10

[Instructions]는 기존 편집기·초안·충돌·version 보기 경로를 재사용하며 exact 지침 파일 대상만 main에서 resolve한다. 경로·안쪽 ID는 기본 화면에 노출하지 않는다. → shell/editor#R17
