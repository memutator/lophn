---
type: flow
concerns: [lophn-agent/harness/provider, lophn-agent/harness/model, lophn-agent/harness/run-loop, lophn-agent/harness/usage, platform/settings, platform/secrets, shell/confirmation-window, shell/desktop, shell/wording]
---
# 계정 순서를 정하고 연결 문제를 해결한다

같은 provider에 계정을 여러 개 연결하거나 사용량 제한·인증 오류·model 접근 불가로 agent 일이 진행되지 않을 때 시작한다. 이 흐름은 lophn-agent/harness#I1·lophn-agent/harness#I6·lophn-agent/harness#I5·platform#I8을 지킨다.

## 흐름

1. settings 화면 사람은 계정 이름과 확인된 계정·조직·요금제를 보고 같은 provider 안에서 쓸 순서를 정한다. 확인하지 못한 계정 정보는 추측하지 않으며 API key와 OAuth 종류만으로 순서를 바꾸지 않는다. (lophn-agent/harness/provider#R6, lophn-agent/harness/provider#R8, lophn-agent/harness/provider#R9)
2. lophn은 그 순서에서 인증 거절·사용량 대기·선택 model 사용 불가가 아닌 첫 credential을 고른다. 시작한 run은 그 선택을 유지하고 이후 설정 변경은 다음 run부터 적용한다. 사람에게는 선택 과정이 보이지 않는다. (lophn-agent/harness/provider#R8, lophn-agent/harness/provider#R10, platform/settings#R24)
3. lophn은 통신의 일시 실패·사용량 제한·인증 거절·해당 model 접근 불가를 구별한다. OAuth 갱신으로 복구할 수 있으면 정해진 갱신 경계에서 처리하며 인증 폐기와 요금제 제한을 섞지 않는다. 사람에게는 보이지 않는다. (lophn-agent/harness/provider#R17, lophn-agent/harness/provider#R18, lophn-agent/harness/provider#R19, lophn-agent/harness/provider#R20, lophn-agent/harness/provider#R21, lophn-agent/harness/provider#R22)
4. lophn은 현재 credential이 거절·사용량 대기·해당 model 사용 불가가 된 경우에만 같은 provider의 다음 credential로 넘어간다. 앞 계정이 회복되어도 진행 run에서 돌아가지 않으며 다른 provider·model로 자동 이동하지 않는다. 사람에게는 보이지 않는다. (lophn-agent/harness/provider#R10)
5. settings 화면 사용할 후보가 없으면 사람은 선택한 연결이 왜 사용 불가인지와 필요한 다음 행동을 확인한다. 사용량 제한에는 확인된 리셋 시각을, 인증 폐기에는 교체·재로그인을 안내한다. 서버 리셋 시각을 모르면 내부 대기는 1시간으로 정하되 그 시각을 서버가 확인한 리셋 시각이라고 표시하지 않는다. model 문제는 해당 계정·model 조합의 문제로 남긴다. (lophn-agent/harness/provider#R18, lophn-agent/harness/provider#R21, lophn-agent/harness/provider#R22, lophn-agent/harness/provider#R24, shell/wording#R10)
6. confirmation-window 화면 사람은 정확한 계정을 대상으로 교체·삭제·재로그인을 명시적으로 결정하고 필요한 새 값을 보호 입력으로 넣는다. lophn은 값과 참조 교체를 안전하게 처리하고 새 사용 차단과 실제 OS 값 삭제 완료를 구별한다. 안쪽 처리와 credential 값은 agent에게 보이지 않는다. (lophn-agent/harness/provider#R6, platform/secrets#R2, platform/secrets#R4, platform/secrets#R6, platform/secrets#R7, shell/confirmation-window#R5, shell/confirmation-window#R6)
7. settings 화면 사람은 새 순서·연결 상태·선택 model을 확인하고 원하면 별도 test 재료로 연결 확인을 명시적으로 요청한다. 연결 확인과 실제 agent 일의 결과는 별개이며 사용량·청구액이 보고되지 않았으면 모름으로 남긴다. (lophn-agent/harness/provider#R27, lophn-agent/harness/provider#R29, lophn-agent/harness/provider#R30, lophn-agent/harness/usage#R6, lophn-agent/harness/usage#R7)

## 다른 갈래

- 1에서 같은 key 또는 같은 계정·조직의 OAuth를 중복 등록하려 하면 거절하고 기존 계정을 구별하여 안내한다. 같은 이메일이어도 조직이 다르면 같은 계정으로 합치지 않는다. (lophn-agent/harness/provider#R9)
- 3에서 단기 통신 오류면 harness가 같은 입력으로 최초 뒤 최대 2회만 retry하고 서버 최소 재시도 시각을 지킨다. retry를 장기 제한 우회나 인증 변경으로 쓰지 않는다. 실제 시도는 각각 기록한다. (lophn-agent/harness/provider#R20, lophn-agent/harness/run-loop#R23, lophn-agent/harness/usage#R1)
- 3에서 사람이 취소하거나 model이 내용을 거절하거나 문맥 한계를 넘었으면 credential을 막거나 다른 계정으로 같은 내용을 우회 전송하지 않는다. (lophn-agent/harness/provider#R23)
- 5에서 model 자체가 사라지거나 사용할 수 없어도 저장한 선택을 지우거나 다른 model로 채우지 않는다. 사람은 필요할 때 다음 run에 쓸 선택을 직접 바꾼다. (lophn-agent/harness/model#R9, lophn-agent/harness/model#R12)
- 6에서 사람이 보호 화면을 닫거나 취소하면 결정으로 보내지 않는다. keychain 불가 또는 교체 실패에는 더 약한 보관 경로를 만들지 않고 이전 참조와 실제 적용 결과를 유지한다. (shell/confirmation-window#R4, platform/secrets#R6, platform/secrets#R8)
- 6에서 provider를 끄거나 credential을 회수하면 새 호출을 막고 가능한 진행 호출에는 취소를 요청한다. 이미 전송한 요청의 결과를 취소 성공으로 꾸미지 않는다. (lophn-agent/harness/provider#R4, lophn-agent/harness/run-loop#R25)
- 7에서 대기 중인 credential의 연결 테스트를 요청해도 제한을 우회하지 않는다. 테스트 취소·실패의 실제 사용량과 비용도 기록하며 모름을 무료로 표시하지 않는다. (lophn-agent/harness/provider#R24, lophn-agent/harness/provider#R30, lophn-agent/harness/usage#R1, lophn-agent/harness/usage#R6, lophn-agent/harness/usage#R7)
- 연결을 고쳐도 failed·stopped로 끝난 agent 일을 자동 재개하지 않는다. 사람이 다시 맡길 때 이전 확정 결과와 남은 입력을 참조하는 새 일을 시작하고 실패 뒤 보존한 다음 요청도 사람의 확인 전에는 시작하지 않는다. (lophn-agent/harness/run-loop#R6, lophn-agent/harness/run-loop#R17, lophn-agent/harness/run-loop#R18)

## 끝

settings 화면에서 사람이 정한 계정 순서와 각 계정의 사용 가능 여부, 선택한 model, 아직 필요한 행동을 확인할 수 있다. 모든 후보가 막혀 있으면 해결되지 않은 상태로 남기며, 연결이 회복됐다는 사실을 중단한 agent 일의 완료로 표시하지 않는다. (lophn-agent/harness/provider#R4, lophn-agent/harness/provider#R10, lophn-agent/harness/run-loop#R18)
