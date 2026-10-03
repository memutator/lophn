---
type: flow
concerns: [platform/backup-and-migration, platform/install-and-update, platform/ledger, platform/blob-store, platform/identity, platform/secrets, platform/diagnostics, platform/responsiveness, apps/data, apps/releases, documents/projects, documents/versions, documents/outline-and-search, platform/approvals, shell/confirmation-window, shell/desktop, shell/wording]
---
# 자료를 안전하게 보관하고 필요하면 복원한다

매일의 자동 backup 시각이 되거나, 사람이 backup·restore·앱 export를 요청할 때 시작한다. 플랫폼 자료 복원과 앱 데이터 export, secret의 안전한 이전은 서로 다른 일이다.

지키는 약속: platform#I1, platform#I3, platform#I7, platform#I4, apps#I9, documents#I7.

## 흐름

1. machine이 매일 1회 ledger의 일관된 snapshot·그 snapshot이 참조하는 blob·사람의 설정 선택을 backup한다. 복원 검증을 마친 최근 완료 묶음 7개를 보존한다. 사람에게는 보이지 않는다. (platform/backup-and-migration#R8, platform/backup-and-migration#R12)
2. worker가 복사·hash·압축·검사를 수행한다. 필요한 blob의 GC를 막고 SQLite 무결성·blob 존재·실제 hash를 확인하며, 실패한 새 묶음 때문에 마지막 유효 backup을 지우지 않는다. 무관한 문서 읽기와 앱 응답은 이 준비를 기다리지 않는다. 사람에게는 보이지 않는다. (platform/backup-and-migration#R9, platform/backup-and-migration#R10, platform/backup-and-migration#R12, platform/responsiveness#R1)
3. settings 화면 사람이 backup을 열어 복원 가능한 묶음과 제외된 자료·다시 준비할 항목을 확인한다. 앱 DB·외부 프로젝트와 앱 source 원본·OS keychain·credential 원문은 플랫폼 backup에 자동 포함되지 않는다. (platform/backup-and-migration#R10, platform/backup-and-migration#R11, shell/wording#R10)
4. settings 화면 앱을 밖으로 가져가려는 사람은 플랫폼 backup이 아니라 별도 앱 export를 고른다. lophn은 고정 blueprint·release 이력·일관된 앱 DB 복사본을 준비하며, 플랫폼 backup의 제외 자료가 이 묶음에도 자동 포함됐다고 설명하지 않는다. (apps/data#R13, platform/backup-and-migration#R11)
5. **settings 화면 confirmation-window 화면** 복원하려는 사람은 검증된 묶음을 고르고 잃을 최신 기록 범위를 확인한다. 정확한 대상과 영향을 본 뒤 명시적으로 결정하며, 창을 닫거나 설명만 읽은 것은 복원 결정이 아니다. (platform/backup-and-migration#R13, platform/approvals#R1, platform/approvals#R3, platform/approvals#R4, shell/confirmation-window#R5, shell/confirmation-window#R6)
6. lophn이 현재 자료를 별도로 보존하고 모든 writer·worker의 정지를 확인한 뒤 복원한다. 적용 전에도 사람의 결정·현재 대상·비교 기준이 여전히 맞는지 검사한다. 사람에게는 보이지 않는다. (platform/backup-and-migration#R13, platform/approvals#R11)
7. lophn이 복원한 기준에서 무결성·schema와 실행 credential을 점검하고 필요한 credential을 재발급한다. 검색 등 derived data와 처리 위치는 복원 ledger 기준으로 재생성하며, 큰 scan·index가 끝날 때까지 정상 읽기를 막지 않는다. 사람에게는 보이지 않는다. (platform/install-and-update#R11, platform/backup-and-migration#R14, platform/backup-and-migration#R15, platform/identity#R7, platform/ledger#R17)
8. settings 화면 사람은 복원 성공과 확인하지 못한 부분, 다시 준비해야 할 연결을 구별해 본다. 미완료 일은 실제 관측으로 확인하며 과거 외부 효과나 컴퓨터 전체까지 복원됐다고 하지 않는다. (platform/backup-and-migration#R11, platform/backup-and-migration#R16, platform/backup-and-migration#R17, platform/diagnostics#R8, shell/wording#R10)
9. document 화면 사람은 복원한 문서와 고정 기록을 열어 확인한다. **settings 화면 confirmation-window 화면** 필요한 credential은 일반 대화가 아닌 보호 절차에서 다시 준비한다. secret 값은 어떤 agent에게도 전달하지 않는다. (documents/versions#R8, platform/backup-and-migration#R11, platform/secrets#R2, platform/secrets#R4, shell/confirmation-window#R6)

## 다른 갈래

- 새 backup이 미완성이거나 무결성·blob 검증을 통과하지 못하면 복원 가능한 것으로 표시하지 않는다. settings 화면 사람은 마지막 검증 묶음을 사용할 수 있고 새 실패를 성공으로 보지 않는다. (platform/backup-and-migration#R10, platform/backup-and-migration#R12)
- restore할 묶음이 현재 설치와 호환되지 않거나 원본이 손상됐으면 정상 읽기와 쓰기를 열지 않고 원본을 보존한다. settings 화면 필요한 update 또는 검증 backup restore를 안내한다. 자동 초기화·downgrade·임의 덮어복원은 하지 않는다. (platform/backup-and-migration#R6, platform/backup-and-migration#R7)
- 5에서 사람이 거절·취소하거나 대상을 다시 확인할 수 없으면 복원을 시작하지 않는다. 바뀐 대상에는 옛 결정을 적용하지 않는다. (platform/approvals#R11, platform/approvals#R13, platform/approvals#R15, shell/confirmation-window#R5)
- credential을 아직 준비하지 못하거나 OS keychain이 잠겼으면 secret이 필요한 기능만 사용할 수 없다. document 화면 secret 없는 로컬 자료는 계속 읽는다. (platform/secrets#R8)
- secret을 다른 머신으로 옮기려면 **settings 화면 confirmation-window 화면** 일반 backup과 분리한 암호 보호 export·import를 사람이 명시적으로 선택한다. 평문 중간 파일·agent·앱 코드·일반 log를 거치지 않는다. (platform/secrets#R9, shell/confirmation-window#R6)
- 문서만 밖으로 가져가려면 document 화면 프로젝트나 앱 자리의 문서와 선택한 고정 판을 Markdown·JSON으로 export한다. 플랫폼 restore나 앱 DB 복원은 함께 하지 않는다. (documents/versions#R16)
- 복원 뒤 외부 동작 결과를 확인할 수 없으면 확인 불가와 근거를 남긴다. 원래 확정 결과를 먼저 확인하고, 프로세스를 다시 시작했다는 이유로 외부 작업을 반복하지 않는다. 사람에게는 보이지 않는다. (platform/backup-and-migration#R16, platform/backup-and-migration#R17)

## 끝

backup만 한 경우에는 검증된 복원 가능한 묶음과 제외 범위를 안다. restore한 경우에는 이전 현재 자료를 보존한 채 복원 기준의 문서·기록을 다시 열 수 있고, 확인 불가와 필요한 credential 준비가 성공과 구별된다. export한 경우에는 선택한 앱 또는 문서의 자료를 밖으로 가져가며, 컴퓨터 전체와 과거 외부 효과까지 옮겼다고 보지 않는다. (platform/backup-and-migration#R10, platform/backup-and-migration#R11, platform/backup-and-migration#R13, platform/backup-and-migration#R16, apps/data#R13, documents/versions#R16)
