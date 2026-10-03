---
type: flow
concerns: [platform/install-and-update, platform/security, platform/settings, platform/backup-and-migration, platform/diagnostics, platform/identity, shell/desktop, shell/wording, lophn-agent/harness/provider, lophn-agent/harness/model]
---
# lophn을 설치하고 처음 연다

처음 lophn을 쓰거나 새 컴퓨터에 설치하는 사람이 시작한다. 설치와 로컬 자료 사용을 agent 연결 준비와 구별한다. 이 흐름은 platform#I7·platform#I1·shell#I1·shell#I5를 지킨다.

## 흐름

1. 사람은 자기 Linux·macOS·Windows에 맞는 설치 패키지와 검증 여부를 확인하고 설치한다. 검증하지 않은 배포는 사용 가능으로 안내하지 않는다. Linux에서는 .deb를 권장하고, AppImage는 실제 sandbox가 확인된 환경에서만 대안으로 안내한다. (platform/install-and-update#R1, platform/install-and-update#R2, platform/install-and-update#R3)
2. 사람은 설치된 lophn을 OS에서 연다. lophn은 시작에 필요한 runtime과 의존성을 설치 묶음에서 사용하며 인터넷 연결을 요구하지 않는다. 사람에게는 안쪽 준비가 보이지 않는다. (shell/desktop#R12, platform/install-and-update#R4)
3. lophn은 로컬 데이터 위치와 접근 권한·기존 instance를 검사하고 같은 자료에 두 번째 writer를 열지 않는다. 사람에게는 보이지 않는다. (platform/install-and-update#R7, platform/install-and-update#R9, platform/install-and-update#R10, shell/desktop#R20)
4. lophn은 설정·저장 무결성·schema·중단 작업을 점검한 뒤 인증된 API와 허용된 작업을 준비한다. 격리와 loopback 경계는 기본 적용하고 사람 token은 shell main에만 둔다. 필요한 migration은 검증한 복구본 뒤에 수행한다. 사람에게는 보이지 않는다. (platform/install-and-update#R11, platform/settings#R11, platform/backup-and-migration#R3, platform/backup-and-migration#R15, platform/security#R3, platform/security#R6, platform/identity#R4)
5. launcher 화면 사람은 첫 프로젝트를 등록하거나 이미 등록한 프로젝트·앱을 연다. 정상 시작의 점검 단계는 보이지 않는다. 화면 문구는 en message key를 쓰고 안쪽 개념을 설명할 필요 없이 지금 가능한 행동부터 안내한다. (shell/desktop#R24, shell/desktop#R25, shell/wording#R1, shell/wording#R2, shell/wording#R3)
6. launcher 화면 사람은 프로젝트부터 쓰고 agent 연결 준비는 나중으로 미룰 수 있다. provider와 공통 model 선택이 준비되지 않은 agent는 일을 시작하지 않는다. 연결이 없다는 이유로 무관한 로컬 자료 사용을 막지 않으며 준비가 필요한 때 그 사실과 다음 행동만 알린다. (platform/settings#R4, platform/settings#R23, lophn-agent/harness/provider#R28, lophn-agent/harness/model#R9, shell/wording#R10)

## 다른 갈래

- 1에서 해당 OS 패키지의 검증이 끝나지 않았으면 미검증 사실을 알린다. 다른 OS의 성공을 이 OS의 설치 성공으로 대신하거나 sandbox를 끄라고 안내하지 않는다. (platform/install-and-update#R1, platform/install-and-update#R3, platform/security#R4)
- 3에서 기존 instance가 있으면 기존 instance 사용 또는 충돌을 안내하고 새 writer를 만들지 않는다. 다른 데이터 폴더의 자료를 섞지 않는다. (platform/install-and-update#R7, platform/install-and-update#R10)
- 3~4에서 데이터 권한·저장 손상·지원보다 높은 schema가 발견되면 정상 기동을 막고 원본을 보존한다. launcher 화면에는 안전한 영향과 가능한 다음 행동을 먼저 안내하며, 사람이 펼치는 진단도 안전하게 처리한 내용만 제공한다. 원본 초기화로 실패를 숨기지 않는다. (platform/install-and-update#R9, platform/backup-and-migration#R6, platform/diagnostics#R4, platform/diagnostics#R5, platform/diagnostics#R8, shell/wording#R10, shell/wording#R12)
- 4에서 agent 설정만 유효하지 않으면 agent 작업을 막되 설정 수정과 무관한 앱 사용·문서 읽기는 허용한다. 잘못된 설정을 다른 provider나 model로 바꾸지 않는다. (platform/settings#R4, platform/settings#R23)
- 사람이 설치를 그만두거나 시작에 실패하면 사용 가능한 설치라고 표시하지 않는다. 이미 자료가 있는 설치를 새 패키지로 교체하는 경우에도 데이터 폴더를 초기화하지 않는다. (platform/install-and-update#R1, platform/install-and-update#R14)

## 끝

launcher 화면에서 사람이 프로젝트·앱을 열거나 프로젝트 등록을 시작할 수 있으면 설치 후 로컬 사용 준비가 끝났다. 이것은 agent 연결 완료와 다르며 준비하지 않은 agent는 계속 비활성으로 남는다. (shell/desktop#R24, shell/desktop#R25, lophn-agent/harness/provider#R28)
