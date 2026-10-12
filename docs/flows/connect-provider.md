---
type: flow
concerns: [lophn-agent/harness/provider, lophn-agent/harness/model, lophn-agent/harness/usage, platform/secrets, platform/settings, platform/redaction, shell/confirmation-window, shell/desktop, shell/wording]
---
# 쓰던 구독이나 API key로 provider를 연결하고 agent의 기본 model을 고른다

첫 agent 요청 전에 연결을 준비하거나 사용할 provider를 더하려는 사람이 시작한다. provider를 연결하는 일과 model을 고르는 일은 따로다. 이 흐름은 lophn-agent/harness#I1·platform#I4·shell#I3·platform#I5를 지킨다.

## 흐름

1. Settings › Providers 화면 사람은 Add a provider 목록에서 provider 하나의 [+ Connect]를 누른다. Connect dialog는 그 provider가 지원하는 로그인 방법을 고르게 하고(OpenAI는 Sign in with ChatGPT 또는 API key), 목록에 없는 제공처와 로컬 서버는 ID·Display name·Base URL과 선택 항목인 API key로 OpenAI 호환 custom provider를 직접 추가하게 한다. provider 하나에는 연결 하나뿐이다. API 과금·구독 한도·추가 사용량 과금은 구별하며 확인하지 못한 청구액은 모름으로 남긴다. 구독 이름만으로 사용 가능하다고 안내하지 않는다. (shell/desktop#R49, lophn-agent/harness/provider#R1, lophn-agent/harness/provider#R31, lophn-agent/harness/provider#R27, lophn-agent/harness/usage#R7)
2. lophn은 구독 경로가 lophn 이름으로 허용되고 실제 텍스트·tool call이 확인된 것인지 검사한다. 미검증 경로는 활성화하지 않으며 다른 제품인 것처럼 위장하지 않는다. 직접 추가한 목적지는 HTTPS이거나 127.0.0.1·::1·localhost일 때만 받는다. 사람에게는 안쪽 검사가 보이지 않는다. (lophn-agent/harness/provider#R1, lophn-agent/harness/provider#R5, lophn-agent/harness/provider#R15)
3. confirmation-window 화면 사람은 API key를 전용 보호 입력에 넣거나 선택한 OAuth 로그인을 명시적으로 시작한다. OAuth는 사람이 시작한 browser 인증과 device code 또는 보호된 인증 응답 입력으로 진행한다. 다른 프로그램의 로그인을 가져오지 않는다. custom provider의 loopback 연결에는 API key를 넣지 않아도 되며 이때는 secret 입력을 요구하지 않는다. (platform/secrets#R2, lophn-agent/harness/provider#R5, lophn-agent/harness/provider#R6, lophn-agent/harness/provider#R12, shell/confirmation-window#R6)
4. lophn은 인증 응답을 검증하고 API key·OAuth token은 OS keychain에 보관하며 저장 기록에는 참조만 남긴다. agent·세션·일반 설정에는 값이 가지 않고, 보호 입력은 수집하지 않는다. 사람에게는 보이지 않는다. (platform/secrets#R1, platform/secrets#R4, platform/secrets#R6, platform/settings#R15, lophn-agent/harness/provider#R7)
5. Settings › Providers 화면 사람은 연결된 provider 목록에서 이름과 로그인 방법을 확인한다. model을 고르지 않아도 연결은 여기서 끝난다. 다시 로그인하거나 key를 바꾸려면 Disconnect 뒤 다시 Connect한다. (shell/desktop#R49, lophn-agent/harness/provider#R8, lophn-agent/harness/provider#R28)
6. Settings › Agents 화면 사람은 Default models에서 lophn·Context Engineer·App Engineer·Operators 네 role마다 연결한 provider의 model과 그 model이 가진 option 값을 고른다. 처음 설치한 기본 model은 모두 비어 있고, model이 정해지지 않은 role의 agent는 일을 시작하지 않는다. 제목·요약에 쓸 model은 Model for summaries 한 칸으로 따로 고른다. (shell/desktop#R50, lophn-agent/harness/model#R8, lophn-agent/harness/model#R9, lophn-agent/harness/model#R21)
7. lophn은 고른 model이 provider의 현재 목록에 있고 필요한 text·tool call을 지원하는지 검사해 저장한다. 새 기본값은 다음 run부터 적용되며 이미 진행하는 일의 model을 바꾸지 않는다. 검사는 사람에게는 보이지 않는다. (lophn-agent/harness/model#R9, lophn-agent/harness/model#R10, lophn-agent/harness/model#R11, platform/settings#R25)

## 다른 갈래

- 1~2에서 구독 경로가 미검증이거나 사용 허용을 확인하지 못했으면 그 경로는 비활성으로 남기고 지원하는 API key 경로나 custom provider를 고르게 한다. 확인된 요금제 거절은 재로그인 문제로 바꾸지 않는다. (lophn-agent/harness/provider#R1, lophn-agent/harness/provider#R15, lophn-agent/harness/provider#R21, shell/wording#R10)
- 1에서 직접 추가한 목적지가 LAN·공개 주소의 HTTP이거나 인증 없는 원격 주소이면 거절한다. (lophn-agent/harness/provider#R5)
- 3에서 사람이 취소하거나 보호 화면을 닫으면 동의로 해석하지 않는다. device code 거절·만료·취소 뒤 인증 대기를 멈추고 token을 등록하지 않는다. (shell/confirmation-window#R4, lophn-agent/harness/provider#R14)
- 3~4에서 인증이 거절되거나 응답 검증값이 맞지 않으면 연결을 준비 완료로 표시하지 않고 안전한 이유와 재로그인·교체 같은 다음 행동만 안내한다. 세션에 key를 넣었다면 전체 제출을 막고 보호 입력으로 안내한다. (lophn-agent/harness/provider#R12, lophn-agent/harness/provider#R18, platform/redaction#R4, shell/wording#R10)
- 4에서 OS keychain이 없거나 잠겼으면 secret이 필요한 연결만 사용할 수 없게 한다. 평문 파일·환경 변수로 저장을 바꾸지 않고 secret이 필요 없는 custom provider의 loopback 연결은 계속 쓸 수 있다. (platform/secrets#R8)
- 6~7에서 model 목록을 확인하지 못했다면 미확인 선택과 확인된 선택을 구별한다. 호출에 필요한 한계·text·tool 지원을 모르면 임의 값을 붙여 호출하지 않는다. 준비되지 않은 provider나 사용할 수 없는 model을 다른 provider·model로 대체하지 않는다. (lophn-agent/harness/model#R10, lophn-agent/harness/model#R13, lophn-agent/harness/model#R20)
- 7에서 편집을 시작한 뒤 설정이 바뀌었거나 검증에 실패하면 변경을 함께 거절하고 이전 성공값을 유지하며 최신 선택과 충돌 항목을 알려 다시 확인하게 한다. (platform/settings#R18, platform/settings#R19, platform/settings#R22)
- 7 뒤에 model이 사라지거나 폐기 예정이 돼도 저장한 선택을 지우거나 다른 model로 채우지 않는다. 사람은 필요할 때 다음 run에 쓸 선택을 직접 바꾼다. (lophn-agent/harness/model#R12)

## 끝

Settings › Providers에 연결한 provider가 보이면 연결은 끝난 것이다. 설정 저장만으로 실제 호출이 되는지 확인했다고 표시하지 않으며 첫 call의 실패는 provider 오류 분류가 알린다. 일을 시작하려면 Settings › Agents에서 그 role의 기본 model까지 정해져 있어야 한다. (lophn-agent/harness/provider#R19, lophn-agent/harness/provider#R28, lophn-agent/harness/model#R9)
