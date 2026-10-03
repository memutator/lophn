---
type: flow
concerns: [coding-agent/connection, coding-agent/mcp-server, coding-agent/cli, coding-agent/guides, platform/identity, platform/secrets, platform/approvals, shell/confirmation-window, shell/desktop, shell/wording]
screens: [settings, confirmation-window]
---
# 쓰던 coding agent를 붙인다

익숙한 coding agent로 lophn 앱을 만들거나 고치려는 사람이 시작한다. lophn agent의 provider 로그인과 coding agent 연결은 별개의 준비다. 이 흐름은 coding-agent#I1·coding-agent#I2·coding-agent#I6·platform#I2·shell#I3을 지킨다.

## 흐름

1. **[screen: settings]** 사람은 Claude Code·Codex·OpenCode·Hermes·pi·Gemini CLI·OpenClaw 중 사용할 제품, 구별할 연결 이름, 전체 또는 앱 하나의 협업 범위를 고른다. 앱 하나의 범위는 새 앱 등록 권한을 주지 않으며 전체 범위도 사람 권한이 아니다. (coding-agent/connection#R1, coding-agent/connection#R2, coding-agent/connection#R4, coding-agent/connection#R5)
2. **[screen: confirmation-window]** 사람은 정확한 연결 이름과 대상 범위를 다시 확인하여 연결 생성을 결정한다. lophn은 최신 대상과 범위를 다시 검사하며 창 닫기·세션의 동의를 결정으로 받지 않는다. 요청한 창의 앱 view는 보이는 채로 입력만 막는다. (coding-agent/connection#R2, platform/approvals#R3, platform/approvals#R4, shell/confirmation-window#R5, shell/confirmation-window#R6)
3. lophn은 결정한 범위의 coding credential을 발급하고 한 번 전달하여 git 밖 소유자 전용 위치에 안전하게 보관한다. 연결 이름·제품·작업 폴더로 권한을 추정하지 않으며 원문을 source·안내·진단·model 문맥에 넣지 않는다. 사람에게는 안쪽 발급과 보관이 보이지 않는다. 이 credential은 provider API key·OAuth secret과 별개다. (coding-agent/connection#R3, coding-agent/connection#R17, platform/identity#R2, platform/identity#R5, platform/identity#R6, platform/secrets#R1)
4. lophn은 선택한 제품과 설치 범위에 맞는 MCP·CLI·skill·공통 안내를 준비한다. 기존 다른 server·안내·permission·trust는 보존하며 lophn 관리 구간만 바꾼다. 사람에게는 준비 과정이 보이지 않는다. (coding-agent/connection#R12, coding-agent/guides#R4, coding-agent/guides#R5, coding-agent/guides#R13, coding-agent/guides#R15, coding-agent/guides#R17, coding-agent/guides#R25)
5. **[screen: settings]** 사람은 선택 제품에 필요한 연결 안내를 따라 자기 coding agent에서 세션을 직접 연다. 수동 설정 조각이 필요한 경우 기존 설정과 비교해 직접 추가한다. lophn은 외부 coding agent 세션을 자동 시작하지 않는다. (coding-agent/connection#R1, coding-agent/cli#R9, coding-agent/guides#R18)
6. lophn은 실제 MCP 초기화·lophn tool 발견·skill 이름과 설명 발견·앱 공통 안내 loading을 검사한다. MCP는 설치된 로컬 stdio 통로를 사용하고 CLI는 같은 credential과 범위 판정을 쓴다. 사람에게는 검사 과정이 보이지 않는다. (coding-agent/connection#R6, coding-agent/connection#R13, coding-agent/connection#R16, coding-agent/mcp-server#R1, coding-agent/cli#R10)
7. **[screen: settings]** 사람은 연결 사용 가능 여부와 지금 필요한 다음 행동을 확인하고, 원할 때 네 검사 단계의 성공·실패·확인 못함을 펼쳐 본다. 파일이 설치됐다는 이유로 실제 발견·loading을 성공으로 표시하지 않는다. (coding-agent/connection#R13, shell/wording#R10, shell/wording#R12)

## 다른 갈래

- 1에서 아직 등록하지 않은 새 앱을 만들려면 전체 범위 연결을 고르거나 이미 등록된 앱을 대상으로 연결한다. 앱 하나의 연결로 새 앱 등록을 허용하거나 scope를 자동 확대하지 않는다. (coding-agent/connection#R4, coding-agent/connection#R5)
- 2에서 사람이 취소하거나 닫으면 연결 생성을 결정으로 보내지 않는다. 대상이 달라지거나 조회하지 못하면 옛 결정 행동을 제거하고 최신 내용부터 확인한다. (shell/confirmation-window#R4, shell/confirmation-window#R5)
- 3에서 credential을 소유자 전용 위치에 보관할 수 없으면 그 credential을 사용하지 않는다. 다른 프로그램의 로그인이나 user token으로 대체하지 않는다. (platform/identity#R4, platform/identity#R5, coding-agent/connection#R9)
- 4에서 동명 연결·skill·깨진 설정·불완전한 안내 관리 경계·동시 파일 변경을 만나면 덮어쓰지 않고 충돌한 부분과 필요한 수정만 안내한다. trust·permission을 자동 확대하지 않는다. (coding-agent/connection#R12, coding-agent/connection#R13, coding-agent/guides#R5, coding-agent/guides#R15, coding-agent/guides#R16, coding-agent/guides#R25)
- 5에서 사람이 아직 세션을 열지 않았으면 설치와 실제 연결 확인을 구별하여 미확인으로 남긴다. lophn 시작이나 연결 등록을 외부 세션 시작으로 바꾸지 않는다. (coding-agent/connection#R1, coding-agent/connection#R13)
- 6에서 더 가까운 안내·override·제품 전용 안내·OpenClaw의 별도 workspace 때문에 안내가 loading되지 않으면 그 부분의 실패나 미확인을 안내한다. 기존 파일을 삭제하거나 workspace를 몰래 바꾸지 않는다. (coding-agent/connection#R14)
- 6에서 daemon 연결·인증·발견이 실패하면 **[screen: settings]**에서 필요한 다음 확인 방법을 안내하고 검증한 단계와 미확인 단계를 유지한다. MCP를 쓸 수 없는 경우 CLI도 같은 credential·범위를 쓰며 CLI라는 이유로 승인·secret·운영 데이터 접근을 허용하지 않는다. (coding-agent/connection#R6, coding-agent/connection#R13, coding-agent/cli#R1, coding-agent/cli#R6, coding-agent/mcp-server#R30)
- 사람이 연결을 회수하거나 범위를 바꾸려면 **[screen: confirmation-window]**에서 기존 연결을 회수하고 필요한 새 연결을 만든다. 회수 직후 새 사용은 거절되지만 이미 외부에 전달한 자료나 외부 프로세스까지 취소됐다고 표시하지 않는다. (coding-agent/connection#R2, coding-agent/connection#R8, coding-agent/connection#R9, coding-agent/connection#R18, platform/identity#R7)

## 끝

**[screen: settings]**에서 사람이 연결 이름·범위와 실제 확인한 연결 상태를 알 수 있다. 검증이 끝난 통로만 사용 가능으로 안내하고, 확인하지 못한 단계가 남으면 그 사실과 다음 행동을 남긴다. 연결은 일할 통로를 준비한 것이지 구현·수리 착수 지시가 아니다. (coding-agent/connection#R13, coding-agent/guides#R22)
