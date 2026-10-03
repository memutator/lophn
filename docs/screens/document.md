---
type: screen
concerns: [shell/editor, documents/versions, documents/file-tracking, documents/formats]
---
# document

프로젝트 탭 또는 lophn 공간에서 여는 화면이다. 사람이 문서 하나를 읽거나 고치고, 판 이력을 본다.

## 보이는 것

1. **머리.** 문서 제목과 저장 상태(Saved / Saving / Needs attention)(shell/editor#R2, R12).
2. **본문.** 읽기와 편집을 같은 자리에서 전환한다. Edit(주 행동)을 누르면 고칠 수 있고, Done을 누르면 읽기로 돌아간다(shell/editor#R8, R9).
3. **작성 표식.** 최신 Version을 누가(사람 이름, 또는 agent) 언제 썼는지 작은 표식으로 보인다(documents/versions#R6, shell/design-system#R34).
4. **정보 패널(기본 닫힘).** Outline(섹션 목차), Version history, Focus(연결된 context) 세 탭을 가진다(shell/editor#R6).
5. **섹션을 지원하지 않는 형식.** PDF·이미지·그 외 데이터는 원문 그대로 보이는 미리보기이고 목차가 없다는 것만 표시한다(documents/formats#R2, R3).

## 숨긴 것

- 저장 전 hash 비교와 원자적 파일 교체는 보이지 않는다. 결과는 Saved 또는 아래 "바깥에서 먼저 바뀜" 상태로만 보인다(documents/file-tracking#R11, R12).
- 목차·검색 반영 지연 처리는 보이지 않고, 아직 반영되지 않았을 때만 작게 표시한다(documents/outline-and-search#R14).
- format 사전 검사가 어느 module로 무엇을 확인했는지는 Needs attention의 "자세히 보기"에서만 펼친다(documents/formats#R8).
- 정확한 content hash와 blob 참조는 Version history의 "자세히 보기"에서만 보인다(documents/versions#R8).

## 행동

- 주 행동: **Edit** / **Done**.
- 보조: Find in document, Open version history, Compare with another version, 버전 하나를 골라 Restore, 충돌 상태에서 Review the other version.

## 상태

- **불러오는 중.** 300ms 전에는 아무것도 보이지 않고 이후 skeleton을 보인다(shell/design-system#R1).
- **저장 중 / Saved.** 디스크 저장과 Version 확정을 구별해 보인다(shell/editor#R2).
- **Needs attention.** 형식 검사에서 error가 있으면 무엇이 문제인지와 다음 행동 하나를 먼저 보이고, warning만 있으면 Saved 옆에 작게 남긴다(documents/formats#R4).
- **바깥에서 먼저 바뀜.** 저장을 멈추고 바깥 내용과 내가 쓰던 내용을 모두 보존하여, 어느 쪽을 볼지 사람이 고르게 한다(documents/file-tracking#R11, shell/editor#R15).
- **연결 끊김.** 디스크 저장은 로컬이라 계속되고, provider가 필요한 작업만 연결 안 됨으로 표시한다.
- **권한 없음.** 무엇을 못 보는지와 누구에게 권한을 물어야 하는지만 보인다.
- **목차 없음.** 섹션을 지원하지 않는 형식에서 Outline 탭에 "No outline for this file"만 보인다(documents/formats#R3).

## 문구

| key | en |
|---|---|
| document.save.saving | Saving… |
| document.save.saved | Saved |
| document.save.needs_attention | Needs attention |
| document.edit.toggle | Edit |
| document.edit.done | Done |
| document.panel.outline | Outline |
| document.panel.versions | Version history |
| document.panel.focus | Focus |
| document.outline.empty | No outline for this file |
| document.version.restore | Restore this version |
| document.version.compare | Compare |
| document.conflict.title | This file changed outside lophn |
| document.conflict.body | Someone or something else saved new content. Your changes are still here. |
| document.conflict.review | Review the other version |
| document.conflict.keep_editing | Keep working here |
| document.permission.title | You can't open this document |

## 크기와 접근성

- 읽기·편집 모두 같은 기둥 폭과 16px/28px 글꼴을 쓰고, 전환 전후 읽던 위치가 거의 바뀌지 않는다(shell/editor#R8).
- 탭 전환·정보 패널 열기·Find in document는 키보드로 조작하고, 저장 상태 변화는 screen reader에 polite로 전달한다(shell/editor#R11).
- 정보 패널은 본문이 충분히 넓을 때만 옆에 붙고, 좁으면 overlay로 뜬다(shell/editor#R6).
