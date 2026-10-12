---
type: flow
concerns: [lophn-agent/harness/provider, lophn-agent/harness/model, lophn-agent/harness/run-loop, lophn-agent/harness/usage, lophn-agent/agents, platform/secrets, shell/confirmation-window, shell/desktop, shell/wording]
---
# provider가 막히면 원인을 확인하고 연결을 끊거나 다시 연결한다

사용량 제한·인증 오류·model 접근 불가로 agent 일이 진행되지 않거나 provider 연결을 끊으려 할 때 시작한다. provider 하나에 credential은 하나이고 그 연결이 곧 provider다. agent·기본값·session은 provider와 model만 고른다. 이 흐름은 lophn-agent/harness#I1·lophn-agent#I7·platform#I4를 지킨다.

## 흐름

1. Settings › Providers 화면 사람은 연결된 provider마다 이름과 로그인 방법을 보고, 사용량 대기나 사용 불가일 때만 그 상태와 다음 행동 한 줄을 본다. 계정 목록·순서·계정별 끄기는 없다. (shell/desktop#R49, lophn-agent/harness/provider#R4, lophn-agent/harness/provider#R8)
2. lophn은 호출을 그 provider의 credential 하나로 보낸다. 고르는 과정이 없고 종류·사용량에 따른 자동 선택도 없다. 그 credential이 막히면 run은 멈추고 같은 provider의 다른 credential이나 다른 provider·model로 가지 않는다. 사람에게는 보이지 않는다. (lophn-agent/harness/provider#R4, lophn-agent/harness/provider#R8, lophn-agent/harness/provider#R10)
3. lophn은 통신의 일시 실패·사용량 제한·인증 거절·해당 model 접근 불가를 구별한다. OAuth 갱신으로 복구할 수 있으면 정해진 갱신 경계에서 처리하며 인증 폐기와 요금제 제한을 섞지 않는다. 사람에게는 보이지 않는다. (lophn-agent/harness/provider#R17, lophn-agent/harness/provider#R18, lophn-agent/harness/provider#R19, lophn-agent/harness/provider#R20, lophn-agent/harness/provider#R21, lophn-agent/harness/provider#R22)
4. Settings › Providers 화면 사람은 그 provider가 왜 사용 불가인지와 필요한 다음 행동을 확인한다. 사용량 제한에는 확인된 리셋 시각을, 인증 폐기에는 Disconnect 뒤 다시 Connect하라고 안내한다. 서버 리셋 시각을 모르면 내부 대기는 1시간으로 정하되 그 시각을 서버가 확인한 리셋 시각이라고 표시하지 않는다. model 문제는 해당 provider·model 조합의 문제로 남긴다. (lophn-agent/harness/provider#R18, lophn-agent/harness/provider#R21, lophn-agent/harness/provider#R22, lophn-agent/harness/provider#R24, shell/wording#R10)
5. confirmation-window 화면 사람은 그 provider의 [Disconnect]를 명시적으로 결정한다. lophn은 새 호출을 막고 credential 값과 참조를 지우며 새 사용 차단과 실제 OS 값 삭제 완료를 구별한다. 안쪽 처리와 credential 값은 agent에게 보이지 않는다. (lophn-agent/harness/provider#R6, platform/secrets#R2, platform/secrets#R4, platform/secrets#R6, platform/secrets#R7, shell/confirmation-window#R5, shell/confirmation-window#R6)
6. Settings › Providers 화면 사람은 Add a provider 목록에서 같은 provider를 다시 [+ Connect]해 새 key를 넣거나 다시 로그인한다. 연결 절차는 connect-provider 흐름과 같다. 다시 로그인하거나 key를 바꾸는 다른 길은 없다. (shell/desktop#R49, lophn-agent/harness/provider#R8, lophn-agent/harness/provider#R31)
7. Settings › Providers 화면 사람은 연결된 provider의 사용 가능 여부를 확인한다. 연결과 실제 agent 일의 결과는 별개이며 사용량·청구액이 보고되지 않았으면 모름으로 남긴다. (lophn-agent/harness/provider#R27, lophn-agent/harness/usage#R6, lophn-agent/harness/usage#R7)

## 다른 갈래

- 1에서 이미 연결된 provider에 두 번째 key나 로그인을 더하려는 길은 없다. 바꾸려면 5에서 Disconnect한 뒤 6에서 Connect한다. (lophn-agent/harness/provider#R8)
- 2에서 credential이 막혀 있으면 run은 멈추고 다른 provider·model로 가지 않는다. (lophn-agent/harness/provider#R4, lophn-agent/harness/provider#R10)
- 3에서 단기 통신 오류면 harness가 같은 입력으로 최초 뒤 최대 2회만 retry하고 서버 최소 재시도 시각을 지킨다. retry를 장기 제한 우회나 인증 변경으로 쓰지 않는다. 실제 시도는 각각 기록한다. (lophn-agent/harness/provider#R20, lophn-agent/harness/run-loop#R23, lophn-agent/harness/usage#R1)
- 3에서 사람이 취소하거나 model이 내용을 거절하거나 문맥 한계를 넘었으면 credential을 막거나 다른 provider·model로 같은 내용을 우회 전송하지 않는다. (lophn-agent/harness/provider#R23)
- 4에서 model 자체가 사라지거나 사용할 수 없어도 저장한 선택을 지우거나 다른 model로 채우지 않는다. 사람은 필요할 때 다음 run에 쓸 선택을 Settings › Agents나 agent editor에서 직접 바꾼다. (lophn-agent/harness/model#R12)
- 5에서 사람이 보호 화면을 닫거나 취소하면 결정으로 보내지 않는다. keychain 불가 또는 삭제 실패에는 더 약한 경로를 만들지 않고 이전 참조와 실제 적용 결과를 유지한다. (shell/confirmation-window#R4, platform/secrets#R6, platform/secrets#R8)
- 5에서 Disconnect하면 새 호출을 막고 가능한 진행 호출에는 취소를 요청한다. 이미 전송한 요청의 결과를 취소 성공으로 꾸미지 않는다. 그 provider를 고른 agent는 다시 Connect하기 전까지 이유와 함께 일을 시작하지 않는다. (lophn-agent/harness/provider#R4, lophn-agent/harness/provider#R28, lophn-agent/harness/run-loop#R25)
- 연결을 고쳐도 failed·stopped로 끝난 agent 일을 자동 재개하지 않는다. 사람이 다시 맡길 때 이전 확정 결과와 남은 입력을 참조하는 새 일을 시작하고 실패 뒤 보존한 다음 요청도 사람의 확인 전에는 시작하지 않는다. (lophn-agent/harness/run-loop#R6, lophn-agent/harness/run-loop#R17, lophn-agent/harness/run-loop#R18)

## 끝

Settings › Providers에서 사람이 각 provider의 연결과 사용 가능 여부, 아직 필요한 행동을 확인할 수 있다. provider가 막혀 있으면 해결되지 않은 상태로 남기며, 연결이 회복됐다는 사실을 중단한 agent 일의 완료로 표시하지 않는다. (lophn-agent/harness/provider#R4, lophn-agent/harness/provider#R10, lophn-agent/harness/run-loop#R18)
