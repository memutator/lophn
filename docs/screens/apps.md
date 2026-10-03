---
type: screen
concerns: [apps/registration]
---
# apps

사람이 등록한 앱을 찾고 정리한다.

lophn 공간의 형제 화면이다(shell/desktop#R28). 여기는 코드 없이 앱을 가볍게 등록하고, 등록된 앱의 이름·목적·보관을 정리하는 화면이다. 실제 구현 연결은 connect-coding-agent, 실행·권한·issue는 app-detail이 맡는다.

## 보이는 것

1. **앱 카드** 목록: 이름, 목적 한 줄, 상태 배지(Draft — 아직 source 없음 / 보관됨). 코드가 없어도 목록에 그대로 보인다(apps/registration#R1, R2).
2. **Register app**(주 행동): 이름과 목적 한 줄만 필수로 받는다. slug는 이름에서 자동 추천되고(apps/registration#R7) 사람이 고칠 수 있다. 기획 문서가 있으면 그 고정 version을 선택해 붙일 수 있다(apps/registration#R2).
3. 프로젝트를 고르라고 요구하지 않는다. 앱은 프로젝트 없이도 독립된 자리를 가진다(apps/registration#R10).

## 숨긴 것

- source 연결(git 폴더 위치), 실행 허용, release 이력은 이 목록에 없다. 카드에는 "No source connected"만 보이고 실제 연결은 app-detail/connect-coding-agent로 간다(apps/registration#R4, R5).
- lophn이 알아서 처리해 안 보이는 것: 관리 폴더를 만들 때 같은 이름의 기존 폴더를 입양하지 않는 검사(apps/registration#R6), slug 이름 공간 충돌 검사.
- 보관한 앱의 release 이력과 문서 자리는 사라지지 않지만 기본 목록에서는 접는다(apps/registration#R9).

## 행동

- **주 행동**: Register app.
- **보조 행동**: 카드별 Open(app-detail로), Rename, 목적 바꾸기, Archive/Unarchive.

## 상태

- **빈 목록**: "No apps yet" + Register app.
- **불러오는 중 / 오류**: 공통 패턴.
- **Draft**(source 없음): 등록만 되어 있고 실행할 수 없다는 뜻이며, 실행 시도는 이 화면이 아니라 app-detail에서 안내한다.
- **보관됨**: 실행이 막히고, 꺼내도 사람이 다시 허용하기 전에는 시작하지 않는다(apps/registration#R8).
- **이름 중복**: 예약된 이름(현재든 과거든)과 겹치면 등록 전에 거절한다(apps/registration#R6).

## 문구

| key | en |
|---|---|
| apps.title | Apps |
| apps.register | Register app |
| apps.name.label | Name |
| apps.purpose.label | What's it for? |
| apps.slug.label | Address |
| apps.blueprint.label | Planning document (optional) |
| apps.card.draft | Draft |
| apps.card.archived | Archived |
| apps.card.no_source | No source connected |
| apps.rename | Rename |
| apps.archive | Archive |
| apps.unarchive | Unarchive |
| apps.open | Open |
| apps.filters.archived | Show archived |
| apps.empty.title | No apps yet |
| apps.error.title | Couldn't load apps |
| apps.name.conflict | This name is already used |

## 크기와 접근성

- 카드 목록은 projects와 같은 shell/design-system#R31 치수를 공유한다.
- Register app dialog는 shell/design-system#R33의 480px dialog를 쓰고, 첫 focus는 Name 입력란에 둔다.
- 키보드로 카드 탐색·Register app까지 가능하고, 좁은 창에서는 카드가 한 열로 쌓인다(shell/design-system#R24).
