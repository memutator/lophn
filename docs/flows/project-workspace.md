---
type: flow
concerns: [shell/desktop, shell/workspace, shell/terminal, shell/app-frame, shell/editor, shell/design-system, shell/wording, documents/projects, documents/versions, apps/blueprint, apps/runtime, apps/sdk, apps/permissions, platform/responsiveness, lophn-agent/harness/prompt-assemble]
---
# 문서 옆에 터미널과 앱을 놓고 이어서 쓴다

사람이 프로젝트 자료와 앱을 함께 보거나 지난 작업 배치를 다시 열고 싶을 때 시작한다. lophn은 탭과 읽던 자리를 이어 주지만 종료된 터미널이나 이전 권한을 저절로 다시 시작하지 않는다.

지키는 약속: shell#I1, shell#I2, shell#I3, shell#I5, apps#I8, platform#I3.

## 흐름

1. project-workspace 화면 사람이 프로젝트를 열어 목적과 필요한 상태를 확인하고 같은 탭 줄에서 문서 편집기·뷰어·터미널·패널 지원 앱을 고른다. 프로젝트 폴더·문서·관련 자료 탐색을 유지하며 대화는 작업을 돕는 용도로 연다. (documents/projects#R8, shell/desktop#R1, shell/desktop#R28, shell/workspace#R1)
2. document 화면 사람이 문서를 읽거나 고친다. lophn은 저장 흐름과 고정 판을 처리하고 디스크 저장·판 확정·형식 검사 실패는 서로 다른 결과로 보여 준다. 문서의 이전 고정 판도 다시 읽을 수 있다. (shell/editor#R1, shell/editor#R2, shell/editor#R12, documents/versions#R2, documents/versions#R8)
3. terminal 화면 사람이 등록 프로젝트 폴더에서 터미널을 연다. 폴더가 여러 개이면 먼저 하나를 고르고, lophn은 다른 위치로 조용히 대신 시작하지 않는다. OS 사용자 shell과 권한에서 동작하며 앱 sandbox가 아니라는 것을 확인한다. (documents/projects#R2, shell/terminal#R1, shell/terminal#R2, shell/terminal#R4, shell/terminal#R6)
4. app-panel 화면 사람이 패널 표시를 지원하는 앱을 문서 옆 탭에 연다. 예를 들어 MaHas rate limit 패널과 문서·터미널을 나란히 두고 작업한다. 전체 화면만 지원하는 앱은 app-space 화면로 연다. 패널 지원 여부는 앱이 실제 만들고 테스트한 blueprint 선언에서 확인한다. (shell/workspace#R3, shell/workspace#R5, shell/app-frame#R27, apps/blueprint#R19, apps/sdk#R37)
5. project-workspace 화면 사람이 탭을 이동하거나 나란히 놓고 초점을 전환한다. 같은 작업을 키보드로도 하고, 밝고 어두운 화면·좁은 창에서도 필요한 행동과 읽던 위치를 유지한다. 폭이 좁아져 한 칸으로 보여도 원래 탭 소속과 배치를 잃지 않는다. (shell/workspace#R3, shell/workspace#R4, shell/design-system#R2, shell/design-system#R3, shell/editor#R4)
6. lophn은 앱 화면과 일반 command를 앱으로 직접 보내고, 무거운 준비·모델 호출·테스트·기록 처리나 한 앱의 정체가 무관한 다른 탭을 기다리게 하지 않는다. 탭 사이의 앱 view·문서·터미널 신원과 입력 초점은 구별하며 앱의 권한도 그대로 강제한다. 사람에게는 보이지 않는다. (platform/responsiveness#R1, platform/responsiveness#R2, platform/responsiveness#R5, apps/runtime#R10, apps/permissions#R2, shell/app-frame#R28, shell/app-frame#R33)
7. project-workspace 화면 사람이 지금 대상의 이름·내용·필요한 상태와 행동을 본다. 상세 설정과 복잡한 처리 과정은 기본으로 숨기고, lophn과 앱의 공용 모양·영어 문구를 일관되게 쓴다. 문서 본문이나 사람이 지은 제목을 UI 문구처럼 바꾸지는 않는다. (documents/projects#R8, apps/runtime#R13, shell/design-system#R3, shell/design-system#R5, shell/wording#R1, shell/wording#R2, shell/wording#R3, shell/wording#R4, apps/sdk#R20, apps/sdk#R21)
8. 사람이 현재 자료를 놓고 agent에게 일을 요청하면 lophn이 그 창의 프로젝트·열린 탭·선택·초점·허용 대상과 관측 시각을 짧은 현재 보기 상태로 조립한다. 열린 탭이 권한을 넓히거나 터미널 출력을 자동으로 agent에게 넘기지 않으며, 수집 실패를 이전 화면으로 대신하지 않는다. 사람에게는 보이지 않는다. (shell/workspace#R9, shell/workspace#R10, shell/workspace#R11, shell/terminal#R8, lophn-agent/harness/prompt-assemble#R25, lophn-agent/harness/prompt-assemble#R26, lophn-agent/harness/prompt-assemble#R27, lophn-agent/harness/prompt-assemble#R28)
9. project-workspace 화면 사람이 프로젝트를 다시 열면 lophn이 마지막 탭 순서·선택·나란히 둔 배치·분할 비율·문서 읽던 위치를 복원한다. 대상과 현재 권한의 재검사는 사람에게는 보이지 않는다. 터미널은 종료된 자리로만 복원하고 terminal 화면에서 사람이 새로 시작한다. 배치 복원을 문서 초안·터미널 출력·승인·앱 업무 상태의 복구로 표시하지 않는다. (shell/workspace#R6, shell/workspace#R7, shell/workspace#R8, shell/terminal#R9)

## 다른 갈래

- 폴더를 연결하지 않았거나 시작 위치가 사라졌으면 terminal 화면에서 이유를 보고 시작하지 않는다. 문서·앱을 쓰는 다른 탭까지 막거나 임의 폴더로 대신 시작하지 않는다. (documents/projects#R2, shell/terminal#R1, shell/terminal#R2, platform/responsiveness#R5)
- 복원 대상이 없거나 권한이 없으면 project-workspace 화면에서 해당 자리의 이유와 닫기를 본다. 배치를 살리려고 이전 credential·허락·앱 업무 상태를 복원하지 않는다. (shell/workspace#R7, shell/workspace#R8, apps/permissions#R2)
- 앱 패널이 깨지거나 정체돼도 다른 탭을 계속 쓰고 app-panel 화면의 독립된 문제 알리기를 사용할 수 있다. 앱 내부 화면이 응답해야만 문제를 알릴 수 있는 구조를 만들지 않는다. (shell/app-frame#R21, shell/app-frame#R32, shell/app-frame#R34, platform/responsiveness#R5)
- 저장이나 조회가 실패하면 document 화면에서 실제 저장 단계와 실패를 구별하고 다시 확인한다. daemon 단절에는 마지막 화면과 확인 시각을 유지하며 오래된 내용을 최신으로 표시하지 않는다. (shell/editor#R2, shell/editor#R12, shell/desktop#R7)
- 사람이 작업 중 다른 탭·공간으로 이동하면 터미널 shell과 최근 출력을 같은 Electron 실행 동안 유지한다. 살아 있는 터미널 탭을 닫거나 Electron을 종료할 때에는 작업이 종료될 수 있음을 확인하고 취소하면 유지한다. 종료 뒤에는 자동 재시작하지 않는다. (shell/terminal#R7, shell/terminal#R9, shell/terminal#R10)
- 좁은 창에서 앱과 대화·정보 패널을 함께 쓰면 앱을 숨기는 대신 사용할 영역을 맞추고 원래 분할 배치를 보존한다. 탭·경계 조작의 실제 모양과 크기는 shell과 공용 design system을 따른다. (shell/workspace#R4, shell/app-frame#R36, shell/design-system#R25)

## 끝

사람은 문서·터미널·앱을 원하는 자리에서 함께 쓰고 다시 열어 이어 간다. 사라진 대상·권한 없음·저장 실패·종료된 터미널은 정상 복원과 구별해 다음 행동을 고를 수 있다. (shell/workspace#R1, shell/workspace#R6, shell/workspace#R7, shell/editor#R2, shell/terminal#R9)
