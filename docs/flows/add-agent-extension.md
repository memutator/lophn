---
type: flow
concerns: [lophn-agent/extensions, lophn-agent/role-definition, lophn-agent/assignments, lophn-agent/harness/tools, lophn-agent/harness/tool-judgment, platform/settings, platform/identity, platform/secrets, platform/approvals, shell/confirmation-window, shell/desktop]
---
# 필요한 skill과 외부 도구만 붙인다

내장 기능 밖의 절차나 외부 MCP 도구가 필요할 때 사람이 시작한다. 사람은 준비한 확장을 명시적으로 등록하고 허용된 역할에서 필요한 skill·개별 도구만 사용하도록 정한다.

지키는 약속: lophn-agent#I6, lophn-agent#I1, lophn-agent/harness#I4, platform#I2, lophn-agent#I4.

## 흐름

1. settings 화면 사람은 준비한 로컬 skill 폴더 또는 외부 MCP 서버의 이름·연결 방식을 등록한다. skill을 자동으로 검색·다운로드·설치하지 않으며 프로젝트 문서·skill·서버 응답을 읽었다는 이유로 연결을 만들지 않는다. (lophn-agent/extensions#R1, lophn-agent/extensions#R10, lophn-agent/extensions#R11, lophn-agent/extensions#R12, lophn-agent/extensions#R13, platform/settings#R17)
2. lophn은 skill 형식·중복·출처와 서버 설정·연결·도구 정의를 검사한다. 잘못된 skill은 목록에서 제외하고, 서버 설정이나 도구 목록이 잘못되면 해당 서버만 제공하지 않으며 무관한 확장은 유지한다. 사람에게는 보이지 않는다. (lophn-agent/extensions#R2, lophn-agent/extensions#R3, lophn-agent/extensions#R12, lophn-agent/extensions#R22)
3. settings 화면 사람은 오류가 있으면 해당 항목과 고칠 방법을 확인한다. 로그인이 필요하면 직접 시작하고, confirmation-window 화면 필요한 비밀 값은 보호 입력으로만 넣는다. OAuth는 사람이 시작한 브라우저 인증으로 진행하며 값은 일반 설정·세션·agent에게 가지 않는다. (lophn-agent/extensions#R16, lophn-agent/extensions#R17, platform/settings#R14, platform/settings#R15, platform/secrets#R1, platform/secrets#R2, platform/secrets#R4, shell/confirmation-window#R6)
4. settings 화면 사람은 변경 가능한 역할에 사용할 정확한 skill 이름과 연결된 서버의 현재 개별 도구를 고른다. 도구별 읽기·쓰기·바깥 동작 분류도 확인해 정한다. 전체·미래 도구를 한꺼번에 허락하지 않고, 내장 역할 정의를 덮어쓰지 않는다. (lophn-agent/extensions#R4, lophn-agent/extensions#R27, lophn-agent/extensions#R30, lophn-agent/extensions#R31, lophn-agent/role-definition#R7, lophn-agent/role-definition#R9)
5. confirmation-window 화면 Operator 정의·tool 선택 변경이 필요하면 사람은 정의·실제 범위·남길 문서·주기와 tool의 고정된 현재 내용·변경 내용을 검토하고 승인한다. agent의 제안만으로 적용하지 않으며 변경 정의는 다음 run부터 쓰고 현재 범위 회수나 멈춤은 미루지 않는다. (lophn-agent/assignments#R4, lophn-agent/assignments#R5, lophn-agent/role-definition#R8, lophn-agent/role-definition#R14, platform/approvals#R3, platform/approvals#R10)
6. harness는 역할에 선택된 유효한 skill의 이름·설명만 제공하고, 필요할 때 선택된 본문·허용된 보조 자료만 읽는다. 읽었다는 사실로 tool·권한·서버 연결·인증을 추가하지 않으며 현재 역할·담당·연결의 교집합인 도구만 제공한다. 사람에게는 보이지 않는다. (lophn-agent/extensions#R4, lophn-agent/extensions#R5, lophn-agent/extensions#R6, lophn-agent/extensions#R7, lophn-agent/extensions#R9, lophn-agent/harness/tools#R5, platform/identity#R3)
7. 외부 도구 호출마다 harness는 현재 역할 범위·서버·도구·사람 분류·정확한 입력·되돌릴 수 있다는 근거를 다시 검사한다. allow만 시작하고 ask는 사람 결정을 기다리며 deny는 승인으로 열지 않는다. 이 판정은 사람에게는 보이지 않는다. (lophn-agent/extensions#R29, lophn-agent/harness/tool-judgment#R1, lophn-agent/harness/tool-judgment#R2, lophn-agent/harness/tool-judgment#R3, lophn-agent/harness/tool-judgment#R6)
8. confirmation-window 화면 되돌림 보장이 없는 쓰기·바깥 동작이 필요하면 사람은 호출 대상·입력·외부 수신처·영향을 보고 별도 approval request에 답한다. 로그인·기존 성공·skill 설명은 승인 근거가 아니며 허락은 본 내용에만 한 번 사용한다. (platform/approvals#R1, platform/approvals#R3, platform/approvals#R5, platform/approvals#R7, lophn-agent/harness/tool-judgment#R7, lophn-agent/harness/tool-judgment#R8)
9. settings 화면 사람은 연결·인증·사용 가능 여부와 설정 적용 시점을 확인한다. 새 도구나 설명·입력 계약·행동 힌트가 바뀐 도구는 옛 분류를 이어 쓰지 않으며, 필요한 개별 선택·분류와 판정을 다시 확인한다. 재연결만으로 전달한 호출을 재전송하지 않는다. (lophn-agent/extensions#R20, lophn-agent/extensions#R24, lophn-agent/extensions#R31, platform/settings#R25)
10. settings 화면 사람이 서버를 떼거나 역할의 서버 사용을 해제하면 새 호출을 즉시 막고 진행 중 호출의 취소를 요청한 뒤 연결을 정리한다. 이 정리는 사람에게는 보이지 않는다. 이미 일어난 외부 효과는 취소됐다고 표시하지 않으며 자격 회수도 이미 전송한 효과를 지우지 않는다. (lophn-agent/extensions#R18, lophn-agent/extensions#R21, platform/identity#R7)

## 다른 갈래

- 2에서 중복 skill이 발견되면 settings 화면 선택된 출처와 제외 이유를 확인한다. 잘못된 전체 설정 apply는 일부만 적용하지 않고 마지막 성공값을 유지한다. (lophn-agent/extensions#R3, platform/settings#R18, platform/settings#R22)
- 3에서 OS keychain이 없거나 잠겼으면 secret이 필요한 연결만 사용할 수 없고, 사람은 secret 없는 기능을 계속 쓴다. 평문 파일이나 환경 변수로 우회하지 않는다. (platform/secrets#R8)
- 3~9에서 연결이 끊기면 같은 연결의 제한된 재연결만 시도하며 인증 거절은 사람이 다시 인증하기 전 자동 재연결하지 않는다. 이미 전달한 호출의 결과를 확인하지 못하면 성공이 아니라 결과 모름으로 남기고, 웹 탐색·임의 파일 접근 도구로 우회하지 않는다. 안쪽 처리는 사람에게는 보이지 않는다. (lophn-agent/extensions#R19, lophn-agent/extensions#R20, lophn-agent/harness/tools#R1, lophn-agent/harness/tools#R11)
- 6에서 run 시작 뒤 skill이 바뀌거나 사라졌으면 읽기에 실패하고 새 내용을 옛 선택으로 읽지 않는다. 변경 skill은 다음 run부터 적용되며 일부 본문을 완전한 읽기로 표시하지 않는다. (lophn-agent/extensions#R6, lophn-agent/extensions#R8)
- 8에서 사람이 거절·취소하거나 기한이 지나면 해당 호출은 미실행이고, 질문 답·일반 동의·창 닫기는 승인으로 바뀌지 않는다. confirmation-window 화면 옛 대상이나 실패한 재조회로는 결정을 제출할 수 없다. (platform/approvals#R4, platform/approvals#R11, platform/approvals#R12, platform/approvals#R15, shell/confirmation-window#R5)
- 10에서 skill 선택만 해제한 경우와 MCP 서버를 떼는 경우를 혼동하지 않는다. skill 선택 변경은 다음 run부터 적용되며 서버 제거·사용 해제는 새 호출을 즉시 막는다. (lophn-agent/role-definition#R14, lophn-agent/extensions#R21, platform/settings#R24)

## 끝

사람은 등록한 확장이 지금 연결·인증되어 쓸 수 있는지와 역할에 실제 선택된 범위·적용 시점을 확인한다. 오류가 있으면 해당 확장만 사용 불가와 이유가 남고, 제거한 서버는 새 호출이 막힌다. 연결이나 설정 완료를 외부 동작의 성공 또는 기존 효과의 취소로 표시하지 않는다. (lophn-agent/extensions#R12, lophn-agent/extensions#R17, lophn-agent/extensions#R21, lophn-agent/extensions#R29, platform/settings#R25)
