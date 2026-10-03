---
type: flow
concerns: [platform/install-and-update, platform/backup-and-migration, platform/ledger, platform/settings, platform/diagnostics, platform/identity, apps/sdk, apps/runtime, apps/releases, lophn-agent/harness/waiting-and-recovery, documents/versions, shell/desktop, shell/workspace, shell/wording, shell/confirmation-window]
---
# 쓰던 자료와 앱을 유지하며 lophn을 업데이트한다

사람이 새 lophn 설치 패키지를 적용하려 할 때 시작한다. 플랫폼 설치를 바꾸더라도 사람의 자료와 설정, 기존 앱이 쓰는 고정 재료를 몰래 바꾸지 않는다.

지키는 약속: platform#I4, platform#I1, apps#I2, lophn-agent/harness#I2, shell#I1.

## 흐름

1. settings 화면 사람이 자신의 OS에서 실제 검증된 설치 패키지를 확인하고 수동 update를 선택한다. lophn은 자동 다운로드·자동 설치·사용 중 무단 재시작을 하지 않으며 검증하지 않은 배포를 사용 가능한 완료 상태로 안내하지 않는다. (platform/install-and-update#R1, platform/install-and-update#R13)
2. lophn이 진행 작업과 플랫폼을 정상 정지한 뒤 사람이 적용하는 패키지의 설치 파일만 교체한다. 데이터 폴더는 초기화하지 않는다. 사람에게는 보이지 않는다. (platform/install-and-update#R14, platform/ledger#R21)
3. schema 변경이 필요하면 lophn이 새 command를 막고 기존 짧은 쓰기를 끝낸 뒤 worker를 정지한다. 일관된 검증 backup을 확보하고 포함된 migration을 순서대로 수행하며, 실패하거나 중단된 단계는 rollback해 직전 완료 schema를 유지한다. 사람에게는 보이지 않는다. (platform/backup-and-migration#R1, platform/backup-and-migration#R2, platform/backup-and-migration#R3, platform/backup-and-migration#R4)
4. lophn이 설정·무결성·기존 고정 판과 참조·실행 자격·중단 작업을 확인한다. 모르는 schema나 손상 원본은 자동 초기화하거나 downgrade하지 않고 보존한다. 사람에게는 보이지 않는다. (platform/install-and-update#R11, platform/backup-and-migration#R5, platform/backup-and-migration#R6, platform/identity#R7)
5. lophn이 새 SDK를 추가하되 기존 앱의 pinned SDK 의존과 release를 그대로 유지한다. 사람의 새 앱 변경 선택과 정확한 release approval이 있기 전에는 lophn update를 앱 activation 결정으로 대신하지 않는다. 사람에게는 보이지 않는다. (apps/sdk#R8, apps/sdk#R10, apps/sdk#R11, apps/releases#R8)
6. lophn이 끊긴 agent 일을 저장된 경계에서 현재 권한·대상·credential·누적 한도를 다시 확인해 복구한다. 미완료 앱 동작과 approval 대기는 실제 결과를 먼저 조회하고, 결과를 모르는 쓰기나 외부 효과는 반복하지 않는다. 사람에게는 보이지 않는다. (lophn-agent/harness/waiting-and-recovery#R8, lophn-agent/harness/waiting-and-recovery#R9, lophn-agent/harness/waiting-and-recovery#R10, platform/backup-and-migration#R16, platform/backup-and-migration#R17)
7. project-workspace 화면 사람이 다시 연 프로젝트의 탭·선택 탭·문서 읽던 위치를 이어 쓴다. 현재 대상과 권한은 다시 확인하며, 터미널은 종료된 자리표시로 남겨 사람이 새로 시작하기 전에는 명령을 재실행하지 않는다. (shell/workspace#R6, shell/workspace#R7, documents/versions#R8)
8. settings 화면 사람은 현재 사용 가능한 상태와 실제 관측 시각, 확인하지 못한 일과 필요한 복구 행동을 확인한다. 설치 완료나 재기동만으로 앱 업무 정상과 미확인 효과의 성공을 주장하지 않는다. (platform/diagnostics#R8, platform/backup-and-migration#R16, apps/runtime#R3, shell/wording#R10)

## 다른 갈래

- 진행 작업을 정상 정지하지 못하면 2의 설치 파일 교체로 넘어가지 않는다. 중단 요청·실제 정지·확인하지 못한 결과를 완료와 구별한다. (platform/install-and-update#R14, platform/ledger#R21, platform/backup-and-migration#R16)
- migration 전 backup 검증에 실패하면 schema를 바꾸지 않는다. 실패한 migration 단계는 rollback하며 이전 완료 자료와 migration 전 복구본을 유지한다. settings 화면 실제로 유지된 상태와 복구 경로를 확인한다. (platform/backup-and-migration#R3, platform/backup-and-migration#R4, platform/backup-and-migration#R18, platform/diagnostics#R8)
- 지원보다 높은 schema·내용 hash가 다른 이력·손상 원본을 만나면 정상 서비스를 시작하지 않는다. settings 화면 원본을 보존한 채 호환되는 update나 검증 backup restore를 안내한다. (platform/backup-and-migration#R6)
- 이전 설치로 돌아가야 하면 **settings 화면 confirmation-window 화면** 사람이 호환되는 검증 backup과 잃을 최신 기록 범위를 확인해 명시적으로 restore한다. 자동 schema downgrade는 없으며 restore의 보존·정지·검증 절차를 따른다. (platform/backup-and-migration#R7, platform/backup-and-migration#R13, shell/confirmation-window#R5, shell/confirmation-window#R6)
- 새 설치에서 설정을 다시 읽는 데 실패하면 마지막 성공값을 유지하고 일부 항목 적용이나 임의 기본값 복귀는 하지 않는다. 유효한 설정이 전혀 없으면 agent만 막고 설정 수정·무관한 앱 사용·문서 읽기를 허용한다. (platform/settings#R22, platform/settings#R23)
- 사람이 이미 멈춘 agent 일을 update 복구가 다시 시작하지 않는다. 복구의 현재 assignment 검사와 미완료 결과 확인을 거쳐, 멈춘 일은 새 사람 요청을 기다린다. 사람에게는 보이지 않는다. (lophn-agent/harness/waiting-and-recovery#R9)
- 탭 대상이 없어졌거나 현재 권한으로 사용할 수 없으면 project-workspace 화면 이유와 닫기 경로가 있는 자리표시로 남긴다. 이전 탭이 있었다는 사실만으로 권한을 다시 부여하지 않는다. (shell/workspace#R7, platform/identity#R7)

## 끝

사람이 유지된 문서·설정·앱을 이어 쓰며 기존 앱의 고정 SDK와 release는 그대로다. update를 마치지 못한 경우에는 원본과 복구본을 보존하고, 무엇이 유지됐는지·무엇을 확인하지 못했는지·다음 복구 행동을 구별한다. (platform/install-and-update#R14, apps/sdk#R11, platform/backup-and-migration#R6, platform/backup-and-migration#R16, shell/workspace#R6)
