---
type: flow
concerns: [coding-agent/connection, coding-agent/tickets, coding-agent/mcp-server, coding-agent/cli, platform/identity, platform/approvals, shell/confirmation-window, shell/desktop, coding-agent/harnesses, coding-agent/sessions, platform/secrets]
---
# coding agent의 접근을 거두거나 다시 연결한다

작업이 끝났거나 연결을 잃었거나 coding agent의 허용 범위를 바꾸려는 사람이 시작한다. lophn 접근을 끊는 것과 외부 coding agent 자체를 멈추는 것은 다르다.

지키는 약속: coding-agent#I2, platform#I2.

## 흐름

1. settings 화면 사람이 연결 이름과 전체 또는 앱 하나의 범위를 확인해 거둘 연결을 고른다. 이름이 같은 제품의 다른 연결과 혼동되지 않게 확인한다. (coding-agent/connection#R2, coding-agent/connection#R3)
2. confirmation-window 화면 사람이 정확한 연결과 범위를 다시 확인하고 회수를 결정한다. lophn은 요청한 창의 입력만 막고 앱 화면은 유지한다. CLI나 coding agent의 응답으로 사람 결정을 대신하지 않는다. (coding-agent/connection#R2, coding-agent/cli#R7, platform/approvals#R3, shell/confirmation-window#R5, shell/confirmation-window#R6)
3. lophn이 회수된 credential의 새 읽기와 쓰기를 즉시 거절한다. MCP와 CLI 모두 같은 범위와 현재 자격을 검사하며, 현재 claim 정리가 끝날 때까지 접근을 허용하는 유예를 두지 않는다. 사람에게는 보이지 않는다. (coding-agent/connection#R6, coding-agent/connection#R8, coding-agent/mcp-server#R30, coding-agent/cli#R1, platform/identity#R7)
4. machine이 회수된 연결의 현재 claim을 정리해 ticket을 다시 열린 상태로 두고 이미 남은 문서·release·완료 보고·test result는 보존한다. 정리 전후 모두 낡은 claim의 ticket 쓰기와 release 준비를 거절한다. 사람에게는 보이지 않는다. (coding-agent/tickets#R13, coding-agent/tickets#R14, coding-agent/tickets#R15)
5. settings 화면 사람이 lophn 접근이 끊긴 결과를 확인한다. 이미 읽은 자료나 밖으로 보낸 효과가 취소됐다거나 외부 coding agent 프로세스·OS 파일 편집까지 멈췄다고 표시하지 않는다. (coding-agent/connection#R18, platform/identity#R7, platform/approvals#R9)
6. settings 화면 범위를 바꾸거나 credential을 잃었으면 사람이 기존 연결의 회수를 확인한 뒤 새 연결 이름과 범위를 고른다. 그 선택이 새 연결의 허락이며 확인 창을 열지 않는다. 사람의 새 연결 결정 없이 재발급하거나 user 자격으로 대신 연결하지 않는다. 새 연결을 고른 뒤의 credential 발급은 lophn이 자동 처리한다. (coding-agent/connection#R2, coding-agent/connection#R9, platform/identity#R2)
7. lophn은 새로 결정한 연결의 credential을 자동 발급·OS keychain 보관하고 고른 harness/profile에 connection 참조를 준비한다. 원문은 보여 주거나 설정에 쓰지 않는다. 회수된 credential·지난 claim의 늦은 보고를 새 연결의 변경으로 적용하지 않는다. 안쪽 처리는 사람에게는 보이지 않는다. (platform/identity#R5, platform/identity#R15, platform/secrets#R12, coding-agent/connection#R8, coding-agent/tickets#R13)

## 다른 갈래

- 2에서 사람이 창을 닫거나 결정하지 않으면 회수를 완료로 표시하지 않는다. 6에서 새 연결을 고르지 않으면 재발급하지 않는다. 창 닫기와 침묵은 승인도 거절도 아니다. (platform/approvals#R4, platform/approvals#R9, shell/confirmation-window#R4)
- 연결 상태를 확인하는 동안 daemon과 단절되면 settings 화면에서 마지막 확인 상태와 확인 시각을 유지한다. 재연결 후 현재 기록을 확인하기 전에는 회수 성공을 단정하지 않는다. (shell/desktop#R7, platform/approvals#R9)
- 외부 세션이 계속 파일을 고치면 사람이 그 도구에서 직접 중단한다. lophn은 회수된 자격의 요청을 거절하는 범위만 보장한다. (coding-agent/connection#R18, coding-agent/tickets#R23)
- claim이 이미 만료·반납됐으면 기존 결과를 지우지 않고 현재 ticket을 다시 조회한다. 새 연결이 ticket을 이어 하려면 사람이 자기 터미널에 다시 지시하거나 ticket의 [Start]로 새 TUI를 연다. session 복원이나 receipt만으로 이어서 claim하지 않는다. (coding-agent/tickets#R11, coding-agent/tickets#R14)

## 끝

사람은 선택한 연결의 lophn 접근이 실제로 끊겼는지 안다. 다시 연결했다면 새로 정한 범위만 사용하며, 외부 프로세스의 종료나 이미 생긴 효과의 취소를 회수 결과와 혼동하지 않는다. (coding-agent/connection#R2, coding-agent/connection#R8, coding-agent/connection#R9, coding-agent/connection#R18)
