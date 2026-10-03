---
type: flow
concerns: [documents/projects, documents/versions, documents/addressing, documents/file-tracking, apps/registration, lophn-agent/roles/lophn, lophn-agent/questions, platform/ledger, platform/redaction, shell/desktop, shell/workspace, shell/confirmation-window]
---
# 문서와 프로젝트를 정리하고 밖으로 가져간다

사람이 문서 자리를 정하거나 프로젝트·앱의 이름을 바꾸고, 보관하거나 자료를 export하려 한다. 정리해도 옛 근거는 남고, 문서 자리 변경이 원본 파일 변경으로 몰래 이어지지 않는 흐름이다.

지키는 약속: documents#I3, documents#I7, documents#I2, lophn-agent#I7, platform#I1.

## 흐름

1. documents 화면, projects 화면, apps 화면에서 사람이 정리할 대상을 찾아 이름 변경·문서 자리 이동·보관 또는 export를 고른다. 기본 목록은 지금 고를 대상과 필요한 상태만 보여 주고 폴더·추적 설정 같은 상세는 필요할 때 확인한다. (shell/desktop#R28, documents/versions#R9, documents/projects#R8, documents/projects#R11, documents/versions#R11, documents/versions#R16, apps/registration#R8)
2. 자리 없는 문서를 어디에 둘지 사람이 요청하면 lophn 역할이 문서의 목적에 맞는 프로젝트·앱 후보와 이유를 추천한다. 후보를 못 고르면 이동 선택지를 만들지 않고 자리 없음으로 남긴다. 사람에게는 보이지 않는다. (documents/addressing#R3, lophn-agent/roles/lophn#R1, lophn-agent/roles/lophn#R14)
3. 사람은 추천한 이동의 정확한 문서·현재 자리·새 자리가 고정된 선택지를 고르고, machine은 그 답의 확정을 사람의 결정으로 받아 대상·입력·비교 기준만 한 번 적용한다. 자리 이동은 되돌릴 수 있는 안쪽 동작이라 별도 확인 창을 열지 않는다. 자유 답·추천·침묵은 이동 결정이 아니다. 적용과 변경 기록은 안쪽에서 처리하며 사람에게는 보이지 않는다. (documents/addressing#R9, lophn-agent/questions#R13, lophn-agent/questions#R15, lophn-agent/questions#R6, platform/ledger#R3)
4. lophn은 이름이나 자리가 바뀌어도 같은 문서와 고정 판 이력을 유지하고 옛 참조를 같은 대상의 현재 참조로 안내한다. 자리 변경만으로 원본 파일 경로·내용·연결·추적 규칙을 바꾸지 않는다. 사람에게는 보이지 않는다. (documents/addressing#R6, documents/addressing#R7, documents/addressing#R8, platform/ledger#R10)
5. documents 화면, projects 화면, apps 화면에서 사람은 정리된 대상을 확인한다. 문서 보관·폴더 연결 해제·추적 중단 뒤에도 고정 판은 읽을 수 있다. 프로젝트 보관은 소속 문서를 일괄 보관하거나 삭제하지 않고, 앱 보관은 실행을 비허용으로 만들되 release 이력과 문서 자리를 지우지 않는다. (documents/versions#R11, documents/versions#R12, documents/projects#R11, apps/registration#R8, apps/registration#R9)
6. documents 화면에서 사람이 export할 프로젝트·앱 자리의 문서와 고정 판을 고른다. lophn은 선택한 판을 Markdown·JSON으로 export하고 원래 바이트와 판 참조도 함께 보존한다. export preview와 외부 출력은 현재 redaction 규칙을 거치며 원본 판 자체를 바꾸지 않는다. 변환과 검사는 사람에게는 보이지 않는다. (documents/versions#R16, documents/versions#R8, platform/redaction#R7, platform/redaction#R16)
7. documents 화면에서 사람은 포함된 문서·판과 제외되거나 반환하지 못한 자료를 구별하고 export 결과를 확인한다. 원래 바이트를 그대로 반환할 수 없는 자료를 빈 내용이나 온전한 export로 표시하지 않는다. (documents/versions#R16, platform/redaction#R14, platform/redaction#R16)

## 다른 갈래

- 이름이 현재 이름 또는 옛 예약 이름과 겹치면 변경하지 않고 다른 이름을 고르게 한다. 이름이 바뀌어도 옛 이름을 다른 대상에 재사용하지 않는다. (documents/addressing#R2)
- 3에서 대상·자리·비교 판이 바뀌면 옛 선택을 적용하지 않는다. 사람의 답은 보존하되 달라진 대상과 이유를 알리고 최신 내용에서 다시 결정하도록 안내한다. (lophn-agent/questions#R14, platform/ledger#R12)
- 사람이 추천을 미루거나 취소하거나 선택하지 않고 닫으면 이동하지 않는다. 고르지 않은 추천이 나중에 자동 적용되지 않는다. (lophn-agent/questions#R8, lophn-agent/questions#R6)
- 실제 파일에 문서를 두는 일은 단순한 자리 이동과 별개다. 사람의 요청으로만 추적이 켜진 프로젝트에 놓고, 확인 뒤 새로 생긴 파일을 덮지 않는다. 파일 쓰기와 자리·원본 연결 확정은 각각 확인한다. (documents/projects#R12, documents/file-tracking#R13, documents/addressing#R8)
- 원본 파일을 제거하며 문서를 자리 없음으로 돌리는 별도 요청은 디스크 내용이 최신 판과 같을 때만 삭제한다. 일반 문서 정리를 임의 파일 이동·삭제나 문서의 영구 삭제로 바꾸지 않는다. (documents/file-tracking#R14, documents/addressing#R8, documents/versions#R12)
- export의 redaction에 실패하면 해당 원문 반환을 중단하고 빠진 범위와 안전한 이유를 알린다. 이미 저장된 고정 판은 수정하지 않는다. (platform/redaction#R14, platform/redaction#R16, documents/versions#R2)
- 연결이 끊기면 documents 화면, projects 화면, apps 화면에서 마지막 확인 상태를 유지하고 완료를 추정하지 않는다. 재연결 뒤 현재 대상과 적용 결과를 다시 확인한다. (shell/desktop#R7, lophn-agent/questions#R10)

## 끝

사람은 정리된 자리나 보관 상태를 확인하고, 옛 참조로도 같은 문서와 당시 판을 다시 읽는다. export했다면 선택한 판의 결과와 포함·제외 범위를 구별한다. (documents/addressing#R6, documents/addressing#R7, documents/versions#R11, documents/versions#R16, platform/redaction#R14)
