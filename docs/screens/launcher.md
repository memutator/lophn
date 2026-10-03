---
type: screen
concerns: [shell/desktop, documents/projects, apps/registration, platform/install-and-update]
---
# launcher

창을 열 때 맨 처음 보는 화면이다. 사람이 프로젝트와 앱을 열거나 새 프로젝트를 등록하고, 지난 작업으로 이어서 간다.

## 보이는 것

1. **Continue.** 가장 최근에 있던 공간(프로젝트, 앱, lophn 공간) 하나로 바로 돌아가는 진입점. 아직 아무 공간도 연 적이 없으면 보이지 않는다(shell/desktop#R24).
2. **Projects 목록.** 등록한 프로젝트의 이름과 한 줄 목적. 고르면 그 프로젝트의 project-workspace를 연다(documents/projects#R8).
3. **Apps 목록.** archive하지 않은 앱의 이름과 한 줄 목적만 보인다(apps/registration#R8). 그 앱에 사람의 결정을 기다리는 일이 있으면 색 없는 글자 pill로 개수만 보인다(shell/desktop#R26). 고르면 app-space를 연다. archive한 앱과 전체 목록은 apps 화면에서 다룬다.
4. **New project(주 행동).** 이름을 받고, 원하면 폴더를 지금 추가해 추적을 켠다(documents/projects#R1, R2).
   - 폴더를 추가하면 lophn이 추적할 파일의 기본 범위(**/*.md, .gitignore 적용)를 미리 보여 주고, Turn on tracking을 눌러야 그 폴더·범위 그대로 켜진다(documents/projects#R3, R6). 폴더를 건너뛰면 추적 없는 프로젝트로 만들어지고 나중에 Project settings에서 추가할 수 있다(documents/projects#R2).
5. **lophn 관리로 가는 고정 진입점.** 창 끌기 바 오른쪽에 두어 Projects·Apps 카드와 나란한 형제 카드로 만들지 않는다(shell/desktop#R25).

## 숨긴 것

- 첫 실행·재시작의 단일 instance 확인, 설정·ledger 무결성 점검, 중단 작업 복원 순서는 보이지 않는다. 문제가 있을 때만 아래 상태로 나타난다(platform/install-and-update#R11).
- 등록한 폴더의 실제 scan·hash·형식 검사 진행은 보이지 않는다. 결과인 문서 수만 보이고, 폴더·추적 패턴·전체 포함 파일 목록은 프로젝트 카드의 "자세히 보기"에서 펼친다(documents/projects#R8).
- agent를 쓰려면 필요한 provider·model 연결은 이 화면의 주 행동이 아니다. 아직 연결하지 않았을 때만 보조 안내 하나로 보이고, 건너뛰어도 로컬 문서는 그대로 쓴다.

## 행동

- 주 행동: **New project**.
- 보조: 카드를 골라 프로젝트·앱 열기, **Continue**로 마지막 공간 열기, lophn 관리 진입점, (New project 안에서) Turn on tracking / Skip for now.

## 상태

- **비었음.** 등록한 프로젝트·앱이 하나도 없으면 각 목록에 아이콘 하나·한 문장·New project 행동만 보인다(screens/README.md#2 G1, shell/design-system#R34).
- **불러오는 중.** 300ms 전에는 아무것도 보이지 않고, 이후 카드 자리를 지킨 skeleton을 보인다(shell/design-system#R1).
- **이미 열려 있음.** 같은 데이터 폴더로 두 번째 창을 열면 새로 시작하지 않고 이미 열려 있다는 안내와 기존 창으로 가는 행동만 보인다(platform/install-and-update#R10).
- **폴더를 열 수 없음.** New project에서 고른 폴더가 없거나 읽을 수 없으면 그 자리에서 이유와 다른 폴더 고르기만 보인다(documents/projects#R1).
- **연결 끊김.** 외부 provider 연결이 끊겨도 마지막으로 확인한 Projects·Apps 목록은 그대로 보이고 New project도 동작한다(shell/desktop#R7).

## 문구

| key | en |
|---|---|
| launcher.continue.label | Continue where you left off |
| launcher.projects.heading | Projects |
| launcher.projects.empty.title | No projects yet |
| launcher.projects.new | New project |
| launcher.apps.heading | Apps |
| launcher.apps.empty.title | No apps yet |
| launcher.apps.pending | {count, plural, one {# waiting} other {# waiting}} |
| launcher.new_project.name_label | Project name |
| launcher.new_project.folder_label | Folder |
| launcher.new_project.folder_action | Add a folder now |
| launcher.new_project.folder_skip | Skip for now |
| launcher.new_project.preview.title | Files lophn will track |
| launcher.new_project.preview.count | {count, plural, one {# file} other {# files}} will be tracked |
| launcher.new_project.track_on | Turn on tracking |
| launcher.new_project.create | Create project |
| launcher.new_project.folder_error | This folder can't be opened |
| launcher.hint.connect_provider | Connect an AI provider to use agents |
| launcher.error.already_open.title | lophn is already open |
| launcher.error.already_open.action | Switch to the open window |
| launcher.manage.label | Manage lophn |

## 크기와 접근성

- 본문 최대폭 1040px, 가운데 배치(shell/design-system#R22).
- 창 끌기 바 48px, 최소 창 960×600px(shell/desktop#R22).
- Projects·Apps 카드, New project, Continue, lophn 관리 진입점 모두 키보드 Tab·Enter로 조작하고, 각 카드는 이름과 상태를 screen reader로 읽는다(shell/design-system#R2).
- 좁은 창에서는 Projects·Apps를 위아래로 쌓고 가로 스크롤을 만들지 않는다(shell/design-system#R24).
