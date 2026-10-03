---
type: flow
concerns: [shell/editor, shell/workspace, documents/file-tracking, documents/versions, documents/formats, documents/outline-and-search, platform/ledger, platform/blob-store, platform/responsiveness]
---
# 문서를 고치고 저장 충돌을 해결한다

사람이 문서를 작성하거나 밖에서 바뀐 파일을 다시 편집한다. 저장을 따로 관리하지 않아도 쓴 내용이 남고, 먼저 바뀐 원본을 덮어쓰지 않는 흐름이다.

지키는 약속: documents#I1, documents#I2, documents#I9, shell#I5, platform#I1, platform#I3.

## 흐름

1. project-workspace 화면 사람이 프로젝트의 문서를 열고 document 화면에서 읽기에서 편집으로 전환해 내용을 고친다. 원본 연결이 없는 문서는 그 문서의 작업 사본을 편집한다. (shell/workspace#R1, shell/editor#R8, shell/editor#R9, documents/file-tracking#R1)
2. document 화면 사람은 글쓰기를 이어 간다. lophn이 자동 저장을 진행하고, 지금 기다리거나 해결해야 할 일이 있을 때만 저장 중·파일 저장됨·판 확정·형식 문제를 구별해 알린다. 목차·검색 반영은 저장과 별개이며 자세한 진행은 필요할 때 확인한다. (shell/editor#R2, shell/editor#R12, documents/file-tracking#R15, documents/versions#R5)
3. 원본 연결 파일이면 lophn이 파일 작업을 시작할 때와 교체 직전에 처음 읽은 hash를 현재 원본과 비교한다. 원본 연결이 없는 문서이면 읽었던 이전 판을 최신 판과 비교한다. 사람에게는 보이지 않는다. (documents/file-tracking#R11, documents/versions#R4, platform/ledger#R12)
4. document 화면 비교 기준이 달라졌으면 lophn은 저장을 멈추고 충돌을 알린다. 사람은 바뀐 원본과 자기 초안을 잃지 않은 채 새 내용을 읽고 다시 고칠지, 편집을 계속할지 결정한다. 낡은 기준으로 자동 병합하거나 덮어쓰지 않는다. (documents/file-tracking#R11, documents/versions#R4, platform/ledger#R12, shell/editor#R15)
5. 충돌이 없으면 lophn이 원본 파일을 원자적으로 교체하고, 실제 관측한 바이트에서 format 검사와 blob 준비를 수행한다. 원본 연결이 없는 문서는 이전 판에 맞춰 내용과 format을 검사한다. 파일·hash·검사·blob 준비는 core 밖에서 한다. 사람에게는 보이지 않는다. (documents/file-tracking#R5, documents/file-tracking#R6, documents/file-tracking#R12, documents/versions#R13, documents/formats#R4, documents/formats#R7, platform/blob-store#R2, platform/responsiveness#R1)
6. lophn이 준비 결과의 기준을 다시 확인하고 고정 판·작성 주체·시각·변경 기록과 blob 참조를 확정한다. 이미 확정된 판은 바꾸지 않고, 같은 내용과 같은 format이면 기존 판을 반환한다. 사람에게는 보이지 않는다. (documents/file-tracking#R7, documents/versions#R2, documents/versions#R3, documents/versions#R6, platform/ledger#R3, platform/blob-store#R4)
7. document 화면 사람은 쓴 내용이 저장됐는지 확인하고 계속 읽거나 고친다. lophn은 목차·검색을 뒤따라 반영하며, 지연이 지금 찾는 결과에 영향을 줄 때만 알린다. 다른 앱과 문서 조작은 이 반영을 기다리지 않는다. (documents/versions#R5, documents/outline-and-search#R13, documents/outline-and-search#R14, documents/outline-and-search#R15, platform/responsiveness#R5)
8. document 화면 사람이 탭을 닫거나 다른 파일·읽기로 전환하면 lophn은 편집 종료와 저장 결과를 확인한다. 저장되지 않은 내용이 남았으면 성공한 저장으로 보이지 않으며, 내용을 버리고 닫는 결정은 사람에게 남긴다. (shell/editor#R1, shell/editor#R2, documents/file-tracking#R15)

## 다른 갈래

- 3~6에서 원본·최신 판·추적 범위가 바뀌면 그 기준의 저장이나 판 확정을 거절한다. document 화면에서 사람은 현재 내용을 다시 읽고 자기 수정 내용을 검토한 뒤 새 기준으로 편집을 이어 간다. (documents/file-tracking#R7, documents/file-tracking#R8, documents/versions#R4)
- 5에서 쓰기 권한·용량·읽기 전용 상태 때문에 파일 저장이 실패하면 document 화면에서 실패와 해결할 항목을 알린다. 원자 교체를 못 하는 환경에서 비원자 쓰기로 바꾸지 않는다. (documents/file-tracking#R12, documents/file-tracking#R16, shell/editor#R12)
- 파일 바이트는 저장됐지만 지정 format 검사에 실패하면 document 화면에서 파일 저장과 판 확정 실패를 구별하고 고칠 부분을 알린다. 성공한 디스크 쓰기를 취소하거나 이전 파일로 되돌리지 않는다. 기본 추론 format의 구조 문제는 경고와 section 추출 가능 여부를 구별한다. (documents/formats#R4, documents/formats#R5, documents/formats#R6, documents/file-tracking#R15)
- ledger 확정에 실패하면 확정된 판처럼 보이지 않는다. 이미 성공한 파일 저장과 뒤 단계의 실패를 구별한다. (platform/ledger#R5, platform/ledger#R6, documents/file-tracking#R15)
- 연결이 끊겼으면 document 화면에서 연결 끊김과 마지막 확인 결과를 구별한다. 확인하지 못한 저장이나 검색 반영을 완료로 채우지 않는다. (shell/editor#R12, documents/file-tracking#R10, documents/file-tracking#R15)

## 끝

사람은 자기 글이 남아 있고, 저장된 고정 판 또는 아직 해결해야 할 실패·충돌을 구별한다. 검색 반영이 늦더라도 이미 저장된 내용을 읽고 다른 작업을 이어 간다. (documents/versions#R5, documents/versions#R6, documents/outline-and-search#R15)
