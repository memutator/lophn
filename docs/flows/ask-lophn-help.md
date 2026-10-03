---
type: flow
concerns: [lophn-agent/roles/lophn, lophn-agent/conversation, lophn-agent/questions, lophn-agent/harness/tools, lophn-agent/harness/provider, documents/versions, documents/outline-and-search, platform/settings, platform/ledger, platform/approvals, platform/secrets, shell/desktop, shell/wording, shell/confirmation-window, lophn-agent/presets, lophn-agent/instructions, coding-agent/sessions]
---
# 설정의 뜻을 묻고 원하는 선택을 적용한다

사람이 현재 기능이나 설정을 가리켜 뜻을 묻거나, lophn 사용법을 알고 설정을 바꾸고 싶을 때 시작한다. 설명을 듣는 일과 실제 변경을 결정하는 일은 다르다.

지키는 약속: lophn-agent#I3, platform#I6, lophn-agent#I7, shell#I1, platform#I5.

## 흐름

1. **settings 화면 conversation 화면** 사람이 궁금한 기능이나 설정을 가리켜 lophn 역할에 묻는다. 현재 설정을 설명해 달라는 말은 변경 요청이나 적용 결정으로 취급하지 않는다. (lophn-agent/roles/lophn#R1, platform/settings#R17, platform/settings#R29)
2. lophn 역할이 설치된 같은 판의 offline 사용 안내와 공개 설정 정의·실제 적용값·출처를 읽는다. 필요한 목차와 부분부터 읽고 secret 값이나 credential 원문은 읽지 않는다. 사람에게는 보이지 않는다. (documents/versions#R17, documents/outline-and-search#R1, lophn-agent/harness/tools#R20, lophn-agent/roles/lophn#R20)
3. conversation 화면 사람은 물은 설정의 뜻과 현재 선택이 미치는 영향, 지금 필요한 행동을 듣는다. 기본 안내에는 내부 필드와 처리 과정을 늘어놓지 않고, 모르는 내용은 추측하지 않는다. (platform/settings#R27, platform/settings#R28, shell/wording#R1, shell/wording#R2, shell/wording#R10)
4. conversation 화면 바꾸려면 lophn 역할이 현재 값·새 값·영향·적용 시점을 고정한 선택지와 추천 이유를 question으로 묻는다. 사람은 선택지를 살펴보고, 선택만으로는 답이나 변경을 확정하지 않는다. (lophn-agent/roles/lophn#R21, lophn-agent/questions#R3, lophn-agent/questions#R4)
5. 되돌릴 수 있는 안쪽 변경의 선택지를 고른 사람은 그 질문의 답을 확정하는 것으로 적용을 결정한다. 별도 확인 창은 열지 않는다. lophn은 결정 대상을 독립 재조회해 일치 검사가 끝나기 전에는 적용하지 않는다. (lophn-agent/questions#R13, lophn-agent/roles/lophn#R21)
6. machine이 사람이 확정한 대상·값·층·비교 판과 전체 영향 설정을 검증하고, 소유 command로 그 변경만 한 번 적용한다. agent에게 직접 설정 변경 command를 주지 않는다. 사람에게는 보이지 않는다. (platform/settings#R18, platform/settings#R19, platform/settings#R29, platform/ledger#R13, lophn-agent/harness/tools#R20)
7. **settings 화면 conversation 화면** 사람은 답 접수와 실제 적용 결과를 구별해 확인하고, 즉시 바뀐 항목과 다음 run부터 바뀌는 항목을 안다. 접수됐다는 이유만으로 변경 완료라고 하지 않는다. (lophn-agent/questions#R10, platform/settings#R24, platform/settings#R25)

## agent 구성과 지침을 바꾸는 갈래

- 사람은 현재 작업 자리의 [Instructions]로 전역·project·app 파일을 편집한다. agent는 변경을 question으로 제안하며 저장하지 않는다. 작업 자리는 세션을 연 곳에서 사람의 명시 변경 때만 바뀐다. (lophn-agent/instructions#R2, lophn-agent/instructions#R3, lophn-agent/instructions#R4, shell/editor#R17)
- agent 구성 변경은 Preset 새 판·명시 적용이며 model·context·MCP·skill은 preset마다 고른다. 코드 변경 요청은 ticket으로 이어지고 coding 시작은 자기 터미널 또는 사람이 누른 [Start]다. (lophn-agent/presets#R1, lophn-agent/presets#R6, lophn-agent/presets#R14, coding-agent/tickets#R5, coding-agent/sessions#R1)

## 다른 갈래

- 3에서 안내만 듣고 끝내면 설정은 그대로다. 자유 답·침묵·추천도 적용 결정을 대신하지 않는다. (platform/settings#R17, lophn-agent/questions#R8, lophn-agent/questions#R15)
- 4~5에서 사람이 미루거나 취소하거나 선택하지 않고 창을 닫으면 변경을 확정하지 않는다. 닫기 자체는 결정이 아니며, question의 명시적인 미루기·취소는 답 없음으로 남는다. (lophn-agent/questions#R6, lophn-agent/questions#R8)
- 5~6에서 값이 잘못됐거나 전제가 바뀌면 적용하지 않는다. **settings 화면 conversation 화면** 사람은 최신 상태·달라진 대상·고칠 행동을 보고 다시 선택한다. 마지막 성공값은 유지하며, 받은 답과 미적용 결과를 구별한다. (platform/settings#R12, platform/settings#R14, platform/settings#R19, platform/settings#R22, lophn-agent/questions#R14)
- provider 로그인·secret 입력·권한 확대·되돌릴 수 없는 변경은 일반 question으로 적용하지 않는다. confirmation-window 화면 사람에게 해당 소유 concern의 보호 절차를 안내하고, secret은 전용 보호 입력에서만 받는다. (lophn-agent/roles/lophn#R22, lophn-agent/harness/provider#R6, platform/secrets#R2, lophn-agent/questions#R11, lophn-agent/questions#R12, platform/approvals#R3, shell/confirmation-window#R6)
- 연결이 끊기면 conversation 화면 작성 중 말과 선택 답을 유지한다. 접수 확인이 안 된 경우 재전송보다 접수 조회를 먼저 한다. (shell/desktop#R7, shell/desktop#R8)

## 끝

사람이 설정의 뜻을 이해했거나, 직접 확정한 변경의 실제 결과와 효력 시점을 확인했다. 설명만 들었거나 거절·취소·충돌한 경우에는 설정이 바뀌지 않았음을 안다. (platform/settings#R22, platform/settings#R25, lophn-agent/questions#R10)
