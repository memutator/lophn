---
type: screen
concerns: [documents/projects]
---
# projects

사람이 등록한 프로젝트를 찾고 정리한다.

lophn 공간의 형제 화면이다(shell/desktop#R28). 여기는 프로젝트의 이름·목적·폴더·추적 범위를 등록하고 바꾸는 유일한 화면이며, 실제로 그 폴더의 문서를 열고 쓰는 일은 project-workspace가 맡는다.

## 보이는 것

1. **프로젝트 카드** 목록: 이름, 목적 한 줄, 추적 on/off, 문서 수(documents/projects#R8). 보관한 프로젝트는 기본 숨김.
2. **Add project**(주 행동): 이름·목적과 OS 폴더 선택기로 고른 폴더를 입력한다. 폴더는 0개로 시작할 수도, 여러 개를 더할 수도 있다(documents/projects#R1, R2).
3. 폴더를 처음 켤 때는 기본 제안(**/*.md 포함, .gitignore 적용)이 먼저 보이고, 켜기 전에 포함될 파일과 이유를 미리 보여준다(documents/projects#R3, R6).
4. 카드를 열면 **Folders & tracking**: 연결된 폴더별 설명·현재 패턴·.gitignore 적용 여부와, 패턴을 바꿀 때마다 같은 미리보기를 다시 보여준다(documents/projects#R6, R8).

## 숨긴 것

- 추적 패턴의 포함·제외 glob 순서 적용 결과, 실제 디스크의 파일 트리, 원본 절대 경로는 기본적으로 없고, 미리보기에서 "포함된 N개 파일"로만 보인다. 사람 화면에는 경로가, agent 쪽에는 경로조차 나오지 않는다(documents/projects#R9).
- lophn이 알아서 처리해 안 보이는 것: 등록 직후 scan, 폴더 해석에서 가장 깊은 등록 폴더 고르기, 내용 유사도로 폴더 이동을 추측하지 않는 판단(documents/projects#R10). scan 중에도 다른 문서·앱은 막히지 않는다.
- 프로젝트 이름·목적 변경, 보관/보관 해제는 카드 메뉴의 "..."에 접혀 있다(documents/projects#R11).

## 행동

- **주 행동**: Add project.
- **보조 행동**: 카드별 Open(project-workspace로), Rename, 목적 바꾸기, Archive/Unarchive, Folders & tracking 펼치기.
- Folders & tracking 안에서: 폴더 추가, 패턴 바꾸기 → 미리보기 → 적용(documents/projects#R6).

## 상태

- **빈 목록**: "No projects yet" + Add project.
- **불러오는 중 / 오류**: 공통 패턴.
- **폴더를 찾을 수 없음**: 그 폴더가 지금 접근 안 된다는 이유와 "Reconnect"만 보이고, 추적을 바로 끄지는 않는다(documents/projects#R10, shell/wording#R10).
- **겹치는 폴더**: 다른 프로젝트가 같은 폴더(또는 그 상위·하위)를 이미 추적 중이면 적용 전에 그 프로젝트 이름과 함께 거절한다(documents/projects#R7).
- **미리보기 대기**: 패턴을 바꾼 뒤 "Turn on tracking"을 누르기 전까지는 적용되지 않는다(documents/projects#R6).
- **보관됨**: 카드는 흐리게, 소속 문서는 그대로 읽을 수 있다(documents/projects#R11).

## 문구

| key | en |
|---|---|
| projects.title | Projects |
| projects.add | Add project |
| projects.name.label | Name |
| projects.purpose.label | Purpose |
| projects.folder.pick | Choose folder |
| projects.card.tracking.on | Tracking on |
| projects.card.tracking.off | Tracking off |
| projects.card.archived | Archived |
| projects.card.documents | {count, plural, one {# document} other {# documents}} |
| projects.folders.heading | Folders & tracking |
| projects.folders.add | Add folder |
| projects.folders.pattern.label | What to track |
| projects.folders.gitignore.label | Skip files in .gitignore |
| projects.folders.preview.heading | Review before turning tracking on |
| projects.folders.preview.included | {count, plural, one {# file included} other {# files included}} |
| projects.folders.preview.apply | Turn on tracking |
| projects.folders.conflict | {project} is already tracking this folder |
| projects.folders.unreachable | Can't find this folder |
| projects.folders.reconnect | Reconnect |
| projects.rename | Rename |
| projects.archive | Archive |
| projects.unarchive | Unarchive |
| projects.open | Open |
| projects.filters.archived | Show archived |
| projects.empty.title | No projects yet |
| projects.error.title | Couldn't load projects |

## 크기와 접근성

- 카드 목록은 shell/design-system#R31의 카드 치수를 따르고 그림자를 쓰지 않는다.
- 폴더 선택기는 OS 기본 dialog를 쓰고, 미리보기 표는 shell/design-system#R30을 따른다.
- 키보드로 카드 탐색·펼침·Add project까지 가능하고, 좁은 창에서는 카드가 한 열로 쌓인다(shell/design-system#R24).
