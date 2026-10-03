---
type: flow
concerns: [lophn-agent/harness/provider, lophn-agent/harness/model, lophn-agent/harness/usage, platform/secrets, platform/settings, platform/redaction, platform/approvals, shell/confirmation-window, shell/desktop, shell/wording]
screens: [settings, confirmation-window]
---
# 쓰던 구독이나 API key로 agent를 연결한다

첫 agent 요청 전에 연결을 준비하거나 사용할 provider·model을 바꾸려는 사람이 시작한다. 이 흐름은 lophn-agent/harness#I1·platform#I8·shell#I3·platform#I5를 지킨다.

## 흐름

1. **[screen: settings]** 사람은 API key·사용이 검증된 구독 연결·로컬 model 중 사용할 경로와 목적지를 고른다. API 과금·구독 한도·추가 사용량 과금은 구별하며 확인하지 못한 청구액은 모름으로 남긴다. 구독 이름만으로 사용 가능하다고 안내하지 않는다. (lophn-agent/harness/provider#R1, lophn-agent/harness/provider#R5, lophn-agent/harness/provider#R27, lophn-agent/harness/usage#R7)
2. lophn은 구독 경로가 lophn 이름으로 허용되고 실제 텍스트·tool call이 확인된 것인지 검사한다. 미검증 경로는 활성화하지 않으며 다른 제품인 것처럼 위장하지 않는다. 사람에게는 안쪽 검사가 보이지 않는다. (lophn-agent/harness/provider#R1, lophn-agent/harness/provider#R15)
3. **[screen: confirmation-window]** 사람은 API key를 전용 보호 입력에 넣거나 선택한 OAuth 로그인을 명시적으로 시작한다. OAuth는 선택 경로의 browser 인증과 device code 또는 보호된 인증 응답 입력으로 진행한다. 다른 프로그램의 로그인을 가져오지 않는다. 인증 없는 로컬 연결에는 secret 입력을 요구하지 않는다. (platform/secrets#R2, lophn-agent/harness/provider#R5, lophn-agent/harness/provider#R6, lophn-agent/harness/provider#R11, lophn-agent/harness/provider#R12, shell/confirmation-window#R6)
4. lophn은 인증 응답을 검증하고 API key·OAuth token은 OS keychain에 보관하며 저장 기록에는 참조만 남긴다. agent·세션·일반 설정에는 값이 가지 않고, 보호 입력은 수집하지 않는다. 사람에게는 보이지 않는다. (platform/secrets#R1, platform/secrets#R4, platform/secrets#R6, platform/settings#R15, platform/redaction#R13, lophn-agent/harness/provider#R7)
5. **[screen: settings]** 사람은 연결 준비 뒤 모든 역할이 공통으로 쓸 judgment model과 organizing model의 provider·model·지원하는 추론 수준을 각각 고른다. 화면은 두 용도를 이해할 수 있는 en message key로 설명하고 알려진 미지원 model은 선택할 수 없게 한다. 사람이 적용하기 전 선택은 바뀌지 않으며 빈 slot은 다른 선택으로 채우지 않는다. (lophn-agent/harness/provider#R28, lophn-agent/harness/model#R8, lophn-agent/harness/model#R9, lophn-agent/harness/model#R11, lophn-agent/harness/model#R15, platform/settings#R4, platform/settings#R17, shell/wording#R13)
6. **[screen: settings]** 사람은 원할 때만 연결 테스트를 명시적으로 요청한다. lophn은 별도 test 재료로 텍스트·tool call을 확인하고 실제 문서나 세션은 보내지 않는다. 한 시도는 최대 30초이며 실제 전송 시도·알려진 사용량·비용을 기록한다. 사람에게는 안쪽 기록 과정이 보이지 않는다. (lophn-agent/harness/provider#R29, lophn-agent/harness/provider#R30, lophn-agent/harness/usage#R1)
7. **[screen: settings]** 사람은 현재 선택과 사용 가능한 상태, 테스트한 것과 확인하지 못한 것을 확인한다. 호출하지 않은 테스트를 성공으로 보이거나 보고되지 않은 사용량을 0으로 채우지 않는다. 새 model 선택은 다음 run부터 적용되며 이미 진행하는 일의 선택을 바꾸지 않는다. (lophn-agent/harness/provider#R4, lophn-agent/harness/provider#R29, lophn-agent/harness/model#R9, lophn-agent/harness/usage#R6, platform/settings#R25)

## 다른 갈래

- 1~2에서 구독 경로가 미검증이거나 사용 허용을 확인하지 못했으면 그 경로는 비활성으로 남기고 지원하는 API key·로컬 경로를 고르게 한다. 확인된 요금제 거절은 재로그인 문제로 바꾸지 않는다. (lophn-agent/harness/provider#R1, lophn-agent/harness/provider#R15, lophn-agent/harness/provider#R21, shell/wording#R10)
- 3에서 사람이 취소하거나 보호 화면을 닫으면 동의로 해석하지 않는다. device code 거절·만료·취소 뒤 인증 대기를 멈추고 token을 등록하지 않는다. (shell/confirmation-window#R4, lophn-agent/harness/provider#R14)
- 3~4에서 인증이 거절되거나 응답 검증값이 맞지 않으면 연결을 준비 완료로 표시하지 않고 안전한 이유와 재로그인·교체 같은 다음 행동만 안내한다. 세션에 key를 넣었다면 전체 제출을 막고 보호 입력으로 안내한다. (lophn-agent/harness/provider#R11, lophn-agent/harness/provider#R12, lophn-agent/harness/provider#R18, platform/redaction#R4, shell/wording#R10)
- 4에서 OS keychain이 없거나 잠겼으면 secret이 필요한 연결만 사용할 수 없게 한다. 평문 파일·환경 변수로 저장을 바꾸지 않고 secret 없는 로컬 기능은 계속 제공한다. (platform/secrets#R8)
- 5에서 model 목록을 확인하지 못했다면 미확인 선택과 확인된 선택을 구별한다. 호출에 필요한 한계·text·tool 지원을 모르면 임의 값을 붙여 호출하지 않는다. 준비되지 않은 slot이나 사용할 수 없는 model을 다른 provider·model·slot으로 대체하지 않는다. (lophn-agent/harness/model#R10, lophn-agent/harness/model#R13, lophn-agent/harness/model#R20)
- 5에서 적용 판이 바뀌었거나 검증에 실패하면 변경을 함께 거절하고 이전 성공값을 유지한다. 확인이 필요한 변경은 **[screen: confirmation-window]**에서 최신 대상과 입력을 다시 확인하며 허락 접수와 실제 적용 성공을 구별한다. (platform/settings#R18, platform/settings#R19, platform/settings#R22, platform/approvals#R9, shell/confirmation-window#R5)
- 6에서 제한 대기 중인 credential이면 테스트 요청으로 대기를 우회하지 않는다. 단절·취소·실패 시도도 실제 시도는 기록하고 확인하지 못한 결과와 비용은 모름으로 남긴다. (lophn-agent/harness/provider#R24, lophn-agent/harness/provider#R30, lophn-agent/harness/usage#R1, lophn-agent/harness/usage#R6, lophn-agent/harness/usage#R7)

## 끝

**[screen: settings]**에서 사람이 고른 연결과 각 용도의 model 선택이 저장되어 있고 해당 일을 시작할 조건을 충족하면 agent 준비가 끝난다. 연결 테스트를 하지 않은 경우에는 미확인을 남기며 설정 저장만으로 실제 연결 검증을 했다고 표시하지 않는다. (lophn-agent/harness/provider#R28, lophn-agent/harness/provider#R29, lophn-agent/harness/model#R9, lophn-agent/harness/model#R13)
