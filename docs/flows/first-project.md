---
type: flow
concerns: [documents/projects, documents/file-tracking, documents/versions, documents/formats, documents/outline-and-search, platform/ledger, platform/blob-store, platform/responsiveness, shell/desktop, shell/workspace, shell/wording]
---
# 첫 프로젝트 폴더를 고른다

처음 문서를 관리하거나 새 작업 폴더를 lophn에 추가하려는 사람이 시작한다. 등록한 폴더와 실제 추적을 구별하며 컴퓨터 전체를 자동으로 추적하지 않는다. 이 흐름은 documents#I1·documents#I2·documents#I3·documents#I9·platform#I3·shell#I1을 지킨다.

## 흐름

1. launcher 화면 사람은 프로젝트 등록을 시작하고 이름·목적을 정한 뒤 OS 폴더 선택기로 작업 폴더를 고른다. lophn은 기본 프로젝트를 자동으로 만들지 않는다. 폴더를 더 고르거나 폴더 없이 프로젝트만 등록할 수도 있다. (shell/desktop#R25, documents/projects#R1, documents/projects#R2)
2. project-workspace 화면 사람은 파일 추적을 켤지 정한다. 등록 직후에는 추적하지 않으며 처음 켤 때 Markdown 파일과 .gitignore 적용을 기본 제안으로 받는다. 사람은 추적할 파일의 범위를 확인한 뒤 필요한 경우 규칙을 펼쳐 바꾼다. (documents/projects#R3, documents/projects#R8, shell/desktop#R28, shell/wording#R12)
3. lophn은 선택한 폴더와 규칙에서 포함·제외 파일과 이유를 준비한다. .git 내부·lophn 데이터 폴더·폴더 밖 symlink는 제외하고 다른 켜진 추적 폴더와 범위가 겹치는지도 검사한다. 사람에게는 안쪽 검사 과정이 보이지 않는다. (documents/projects#R4, documents/projects#R5, documents/projects#R6, documents/projects#R7)
4. project-workspace 화면 사람은 추적 범위 미리보기를 확인하고 그 폴더·규칙으로 추적을 켠다. 등록만 하거나 미리보기를 그만두는 것으로는 추적을 켜지 않는다. (documents/projects#R3, documents/projects#R6)
5. lophn은 켜진 추적 범위의 파일만 scan하며 core 밖 worker에서 같은 읽기 스트림의 hash·형식 검사·blob을 준비한다. 준비와 확정 사이에 규칙·이전 판·접근 경계가 바뀌면 낡은 결과를 확정하지 않는다. 사람에게는 보이지 않는다. (documents/file-tracking#R1, documents/file-tracking#R3, documents/file-tracking#R5, documents/file-tracking#R6, documents/file-tracking#R7, documents/file-tracking#R8, platform/responsiveness#R1)
6. lophn은 완성된 원문 blob과 비교 기준을 확인하여 고정 version·blob 참조·변경 기록을 함께 확정한다. 이 단계는 큰 파일 처리나 검색을 기다리지 않는 짧은 변경이다. 사람에게는 보이지 않는다. (platform/blob-store#R2, platform/blob-store#R4, platform/ledger#R3, platform/ledger#R4, platform/ledger#R12, documents/versions#R1, documents/versions#R5)
7. lophn은 확정한 판의 목차와 검색을 뒤따라 준비하며 이 파생 작업으로 새 문서 판을 만들지 않는다. 큰 scan과 index가 다른 프로젝트·문서·앱 사용을 막지 않는다. 사람에게는 보이지 않는다. (documents/outline-and-search#R13, documents/outline-and-search#R15, platform/responsiveness#R4, platform/responsiveness#R5)
8. project-workspace 화면 사람은 준비된 문서부터 열어 읽고 전체 scan이 끝나기를 기다리지 않는다. 아직 검색에 반영되지 않은 자료가 있으면 결과 판단에 필요한 지연·누락만 안내하고 비교 판·처리 단계는 펼쳐 본다. 원본 파일과 확정된 판을 같은 완료로 보이지 않는다. (shell/workspace#R1, documents/outline-and-search#R14, documents/outline-and-search#R15, documents/file-tracking#R9, documents/file-tracking#R15)

## 다른 갈래

- 1~4에서 사람이 폴더 선택·등록·추적 준비를 그만두면 새 추적을 시작하지 않는다. 이미 등록한 프로젝트에서 추적을 켜지 않은 경우에는 등록과 추적 안 함을 구별한다. (documents/projects#R1, documents/projects#R3, documents/file-tracking#R9)
- 3~4에서 추적 폴더가 겹치거나 미리보기 뒤 구성이 달라졌으면 적용을 거절하고 현재 범위를 다시 확인하게 한다. 자동으로 범위를 넓히거나 다른 프로젝트로 옮기지 않는다. (documents/projects#R6, documents/projects#R7)
- 5에서 폴더 접근 권한을 잃거나 폴더가 이동·제거됐으면 그 범위의 새 판 확정을 멈춘다. project-workspace 화면에서 해당 파일의 미확인·원본 없음과 가능한 다음 행동을 안내하고 폴더 재연결을 추측하지 않는다. 이미 저장한 판은 계속 읽을 수 있다. (documents/file-tracking#R8, documents/file-tracking#R9, documents/projects#R10, documents/versions#R11, shell/wording#R10)
- 5에서 지정 format 검사에 error가 있으면 그 파일의 새 version을 거절하고 warning만 있으면 경고와 함께 결과를 남긴다. format을 지정하지 않은 새 문서는 구조 검사 실패에도 원문을 보존하고 경고·추출 가능 여부를 구별한다. 원본 파일을 고치거나 초기화하지 않는다. (documents/formats#R4, documents/formats#R5, documents/formats#R6)
- 7에서 PDF·image·data의 section 추출을 지원하지 않으면 원문 보존과 검색 구조 미지원을 구별한다. 추출 실패나 빈 검색을 원문 부재로 표시하지 않는다. (documents/formats#R3, documents/formats#R20, documents/outline-and-search#R14, documents/outline-and-search#R22)
- 6에서 자료를 확정할 수 없거나 blob이 손상됐으면 성공·빈 내용으로 채우지 않고 실제 실패와 다음 행동을 안내한다. 큰 scan 중에도 무관한 자료를 읽을 수 있다. (platform/ledger#R5, platform/ledger#R6, platform/blob-store#R6, documents/outline-and-search#R15, shell/wording#R10)
- 사람이 나중에 추적을 끄거나 폴더 연결을 제거하거나 프로젝트를 보관해도 원본 파일과 이미 확정한 판을 삭제하지 않는다. 옛 판을 계속 읽을 수 있다. (documents/projects#R11, documents/file-tracking#R8, documents/versions#R11)

## 끝

project-workspace 화면에서 사람이 등록한 프로젝트와 추적 여부를 확인하고 준비된 문서를 읽을 수 있다. 추적할 파일이 없는 경우도 정상적으로 빈 프로젝트로 남으며 저장된 판과 아직 검색에 반영되지 않은 내용은 구별한다. (documents/projects#R2, documents/projects#R8, documents/versions#R5, documents/outline-and-search#R14)
