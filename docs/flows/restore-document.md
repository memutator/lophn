---
type: flow
concerns: [documents/versions, documents/addressing, documents/file-tracking, documents/outline-and-search, platform/ledger, shell/editor, shell/workspace]
---
# 예전 문서 판을 다시 보고 되살린다

사람이 문서의 변경을 비교하거나 이전 합의를 지금 내용으로 다시 쓰려 한다. 옛 판과 그 뒤의 이력을 지우지 않고, 선택한 내용을 현재의 새 판으로 남긴다.

지키는 약속: documents#I2, documents#I1, platform#I1.

## 흐름

1. document 화면 사람이 문서 이력을 열고 고정 판의 내용·저장 주체·시각을 확인한다. agent가 쓴 판이면 관련 run도 근거로 확인할 수 있다. 옛 이름이나 자리의 참조로 들어와도 같은 문서의 이력을 읽는다. (documents/versions#R2, documents/versions#R6, documents/versions#R8, documents/addressing#R6)
2. document 화면 사람이 옛 판을 골라 지금 판과 전체 또는 필요한 section의 차이를 읽는다. 비교는 선택한 두 고정 판으로 하고, 없는 구간이나 추출 실패를 변경 없음으로 채우지 않는다. diff 계산은 core 밖에서 하며 사람에게는 보이지 않는다. (documents/outline-and-search#R19, documents/outline-and-search#R21, documents/outline-and-search#R22, shell/editor#R13, shell/editor#R14)
3. document 화면 사람이 선택한 판을 restore하도록 요청한다. lophn은 현재 최신 판을 비교 기준으로 잡고 옛 판의 내용과 format을 새 판으로 남길 준비를 한다. 옛 판과 이후 이력은 수정하거나 지우지 않고, 내용과 format이 이미 같으면 새 판을 만들지 않는다. 준비와 기준 확인은 사람에게는 보이지 않는다. (documents/versions#R4, documents/versions#R10, documents/versions#R2, platform/ledger#R12)
4. 원본 연결 문서라면 lophn은 문서 저장을 직접 적용하지 않고 파일 저장 contract를 따른다. 원본 파일 hash를 대조하고 원자적으로 쓰며, 그 파일의 현재 관측으로 새 판을 확정한다. 사람에게는 보이지 않는다. (documents/versions#R13, documents/file-tracking#R11, documents/file-tracking#R12, documents/file-tracking#R7)
5. document 화면 최신 내용이나 원본이 그사이 바뀌었으면 lophn이 restore를 멈추고 충돌을 알린다. 사람은 선택한 옛 판과 현재 내용을 다시 비교하고 다음 행동을 고른다. 선택한 판도 새로 바뀐 판도 남으며 낡은 기준으로 자동 덮어쓰지 않는다. (documents/versions#R2, documents/versions#R4, documents/file-tracking#R11, platform/ledger#R12, shell/editor#R15)
6. 기준이 맞으면 lophn은 새 고정 판과 변경 기록을 확정한다. 사람에게는 보이지 않는다. document 화면에서 사람이 되살린 최신 내용과 이전·이후의 이력이 함께 남은 것을 확인한다. 파일 저장·판 확정·검색 반영은 각각 확인하고, 검색 반영 대기를 restore 실패나 완료한 반영으로 바꾸지 않는다. (platform/ledger#R3, platform/ledger#R10, documents/versions#R5, documents/versions#R6, documents/versions#R10, documents/file-tracking#R15, shell/editor#R2)

## 다른 갈래

- 사람이 비교만 하고 닫으면 최신 내용은 바뀌지 않는다. 옛 고정 판은 다시 읽을 수 있다. (documents/versions#R8, documents/versions#R10)
- 선택한 판이 이미 최신 내용과 같은 경우 document 화면에서 같다는 결과를 확인한다. 불필요한 새 판은 만들지 않는다. (documents/versions#R10, shell/editor#R14)
- 원본 연결 파일이 없거나 접근할 수 없으면 저장된 옛 판은 읽되, 파일 restore까지 끝난 것처럼 보이지 않는다. 파일 저장 실패와 판 확정 실패를 구별한다. (documents/versions#R11, documents/file-tracking#R9, documents/file-tracking#R16, documents/file-tracking#R15)
- 문서나 프로젝트를 보관했거나 추적을 중단했어도 옛 판 읽기는 유지한다. 낡은 추적 범위로 원본 연결 문서의 새 판을 확정하지 않는다. (documents/versions#R11, documents/file-tracking#R8)
- restore 중 원본 바이트는 저장됐지만 판 확정이 실패하면 document 화면에서 실제 끝난 저장과 실패한 뒤 단계를 구별한다. 이미 성공한 파일 저장을 취소했다고 말하지 않는다. (documents/file-tracking#R15, shell/editor#R2, platform/ledger#R5, platform/ledger#R6)
- 연결이 끊겨 결과를 확인하지 못하면 document 화면에서 연결 끊김과 확인된 저장 상태를 구별한다. 확인하지 못한 판 확정을 성공으로 채우지 않는다. (shell/editor#R12, documents/file-tracking#R10, documents/file-tracking#R15)

## 끝

사람은 선택한 내용이 새 최신 판으로 남았거나 변경 없이 같았다는 결과를 확인한다. 충돌이나 실패이면 완료 대신 다음 행동을 확인하고, 어떤 경우에도 선택한 옛 판과 이후 이력은 보존된다. (documents/versions#R2, documents/versions#R10, documents/file-tracking#R15)
