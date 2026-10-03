---
type: flow
concerns: [coding-agent/connection, coding-agent/harnesses, coding-agent/sessions, coding-agent/guides, platform/identity, platform/secrets, platform/approvals, shell/confirmation-window, shell/terminal, shell/desktop]
---
# 쓰던 coding agent를 붙인다

익숙한 coding agent로 앱을 만들거나 고치려는 사람이 시작한다. lophn agent의 provider 로그인과 coding harness 연결은 별개다. 사람은 제품·연결 범위만 정하고 감지·credential·설치는 lophn이 준비한다.

## 흐름

1. 사람은 settings에서 Claude Code·Codex·OpenCode·Gemini CLI·Hermes·pi·OpenClaw 중 쓸 harness를 고른다. lophn은 PATH와 catalog의 유한 fallback만 감지하고 executable·version·auth·설치·loading을 따로 보여 준다. 재감지는 사람이 요청할 때만 한다. 안쪽 경로·설치 과정은 기본 화면에 보이지 않는다. (coding-agent/harnesses#R1, coding-agent/harnesses#R2, coding-agent/harnesses#R3)
2. 사람은 연결 이름·전체 또는 앱 하나의 scope·native 환경과 profile·설치 범위를 고른다. 그 선택이 허락이며 확인 창 없이 credential 발급과 MCP·skill 설치로 이어진다. 앱 하나의 scope는 새 앱 등록 허락이 아니다. (coding-agent/connection#R2, coding-agent/connection#R4, coding-agent/connection#R5, coding-agent/harnesses#R4, coding-agent/harnesses#R6)
3. lophn의 인증 경계가 credential을 자동 발급하여 OS keychain에 준비하고 connection과 검증 hash를 확정한다. 사람에게 token 생성·복사·붙여넣기를 요구하지 않는다. 과정과 원문은 사람에게는 보이지 않는다. (coding-agent/connection#R3, platform/identity#R5, platform/secrets#R12)
4. lophn은 고른 harness/profile의 MCP·skill·지침·검증한 hook만 설치하고 resource별 결과·receipt를 남긴다. 기존 server·permission·trust·workspace를 보존하며 token 대신 connection 참조를 쓴다. 설치 과정은 사람에게는 보이지 않는다. (coding-agent/harnesses#R6, coding-agent/harnesses#R7, coding-agent/harnesses#R8, coding-agent/harnesses#R9, coding-agent/connection#R17)
5. lophn은 MCP 초기화·tool 발견·skill 발견·app 안내 loading을 각각 확인하고 성공·실패·확인 못함을 구별한다. 사람이 필요하면 nullable 기본 harness를 고르며 후보 제안이 자동 선택 저장이 되지는 않는다. (coding-agent/harnesses#R5, coding-agent/harnesses#R10)
6. 사람은 준비된 ticket에서 [Start]로 project 터미널 TUI를 열거나 자기 터미널에서 직접 시작한다. 연결 완료 자체로 process나 ticket claim을 만들지 않는다. 첫 prompt 전달은 start-coding-agent flow를 따른다. (coding-agent/sessions#R1, coding-agent/sessions#R2, coding-agent/sessions#R9, shell/terminal#R12)

## 다른 갈래

- keychain 잠김·보관/commit 실패는 unavailable이며 준비 token을 무효 처리·정리한다. 평문 파일·환경 변수·user 자격 fallback은 없다. (platform/identity#R5, platform/identity#R15, platform/secrets#R8)
- receipt/hash와 다른 사람 수정은 보존하고 충돌로 알린다. 다른 resource 성공을 전체 성공으로 표시하지 않는다. (coding-agent/harnesses#R7, coding-agent/harnesses#R9)
- Codex는 TOML 조각을 사람이 비교·적용하며 앱 MCP/TOML을 자동 생성하지 않는다. OpenClaw는 기존 workspace를 옮기거나 지침을 복제하지 않는다. pi는 설치된 exact MCP adapter 계약이 맞을 때만 준비한다. (coding-agent/harnesses#R8, coding-agent/guides#R15, coding-agent/guides#R17, coding-agent/guides#R25)
- 지원 version·TUI adapter/readiness가 미검증이면 [Start]를 실행하지 않는다. 자기 터미널 안내와 확인 가능한 연결 자료는 남기되 loading·session을 성공으로 추정하지 않는다. (coding-agent/harnesses#R3, coding-agent/harnesses#R11, coding-agent/sessions#R4, coding-agent/sessions#R5)

## 끝

사람은 선택한 harness의 연결 범위와 실제 준비 결과·남은 행동을 안다. 연결·설치·loading·TUI 시작·MCP claim은 각각 다른 사실이다. (coding-agent/harnesses#R3, coding-agent/sessions#R9)
