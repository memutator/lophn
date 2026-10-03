---
type: requirements
concerns: [shell/confirmation-window]
---
# shell/confirmation-window

사람 결정을 받는 보호 화면의 배치·focus·입력·일회 확인 통로를 맡는다; 결정 대상·정확한 입력·되돌릴 수 있는지·option action의 의미는 platform/approvals·lophn-agent/questions와 각 대상 concern을 따른다.

## 요구

### 보호 경계

**[R1]** 사람의 직접 결정으로 인정할 확인 행동은 lophn의 confirmation window에서만 제출하고 CLI·TTY 입력·MCP·앱·세션 속 동의·자동 동의로 대신하지 않는다.
- 이유: H5의 현재 추천과 platform/identity의 사람 증거 경계를 유지한다.
- 확인: CLI에서 yes를 직접 입력하거나 agent가 동의해도 결정되지 않고 confirmation window의 명시 조작만 전달된다.

### 배치

**[R2]** approval request 미리보기에는 확인하기만 두고 confirmation window는 최대 640px에서 주체·시각 → 대상·변경 → 이유 → 위험 → revert 가능 → 근거 → 전후 → 결정 순으로 배치하며 좁으면 창 안에 맞춘다.
- 이유: 결정 전 정보를 같은 순서로 읽게 한다.
- 확인: 640px 및 좁은 창에서 순서가 같고 배경 조작은 막힌다.

**[R3]** 전후는 현재·바뀐 뒤를 세로 배치하고 문서는 바뀐 문단과 앞뒤 1문단에 추가·삭제 표지를 붙이며 설정은 변경 항목과 값을 보이고 전체·code diff는 별도 펼침으로 둔다.
- 이유: 기본 확인을 patch 읽기로 만들지 않는다.
- 확인: 색 없이 추가·삭제·생략·자료 부재를 구별하고 긴 줄은 잘리지 않는다.

### focus와 제출

**[R4]** 첫 focus는 설명에 두고 결정 기본 선택·Enter 즉시 제출을 없애며 범위가 드러나는 개별 결정 버튼만 제출하고 닫기·Escape는 결정으로 보내지 않으며 platform/approvals가 요구한 2차 확인은 별도 단계에서 영향과 scope를 다시 보인다.
- 이유: 의도 없는 키 입력을 동의로 해석하지 않는다.
- 확인: 열자마자 Enter·Escape·닫기로 결정이 생기지 않고 버튼의 명시 조작만 제출된다.

**[R5]** 열 때 결정 대상을 독립 재조회하여 platform/approvals·lophn-agent/questions의 일치 검사가 끝날 때까지 제출을 막고 대상 변경·다른 결정·조회 실패에는 옛 행동을 제거하여 이유와 최신 내용 경로만 남긴다.
- 이유: 오래된 미리보기를 최신 결정으로 제출하지 않는다.
- 확인: 목록을 연 뒤 대상을 바꾸거나 연결을 끊으면 옛 버튼으로 결정할 수 없다.

### 보호 경계

**[R6]** approval·권한 부여·secret 입력·option action의 사람 결정은 요청한 창 위에 modal로 뜨는 별도 confirmation window에서 받고 열린 동안 그 창의 앱 view와 shell 입력을 막되 앱 view를 숨기지 않으며 앱 전용 창에서 요청해도 lophn confirmation window를 앞으로 가져온다.
- 이유: 앱 view는 다른 창 위에 그릴 수 없으므로 별도 창이면 앱 화면을 숨기지 않고도 결정을 가리지 못하고, 사람은 보던 앱 화면을 보며 결정한다.
- 확인: confirmation window가 열린 동안 뒤의 앱 view가 그대로 보이지만 click·키 입력이 전달되지 않고 앱 view가 confirmation window 위에 그려지는 frame이 없다.

**[R7]** confirmation window는 설치된 lophn 코드만 사용하여 사용자 slot·fork로 바꾸지 못하고 사용자 theme은 shell/design-system의 접근성·대비를 통과한 값만 적용한다.
- 이유: 결정 버튼이나 대상을 사용자 컴포넌트가 위장하지 못하게 한다.
- 확인: slot·fork를 지정해도 보호 화면은 바뀌지 않고 대비 실패 값은 기본값으로 남는다.

### 배치

**[R8]** 권한 화면은 apps/permissions가 제공한 내용을 같은 틀로 표시하고 요청 경로는 고정폭 글꼴의 원문 전체로 줄이지 않는다.
- 이유: 경로를 축약하면 허용 범위를 잘못 읽을 수 있다.
- 확인: 긴 경로도 전체로 확인할 수 있고 내용의 의미는 apps/permissions를 따른다.

### focus와 제출

**[R9]** 확인 제출은 platform/identity가 검증한 해당 화면의 일회 handle만 사용하고 창 재사용·닫힘·다른 결정에 같은 확인을 재전송하지 않는다.
- 이유: 화면 조작 한 번이 여러 결정을 만들지 않아야 한다.
- 확인: 같은 handle의 두 번째 제출이 새 결정을 만들지 않는다.

### 배치

**[R10]** diff로 표현할 수 없는 앱 동작은 현재·바뀐 뒤 설명을 같은 세로 순서로 보여 주고 안전한 preview가 있으면 apps/preview의 분리된 결과로만 연다.
- 이유: preview 자체가 바깥 효과를 실행해서는 안 된다.
- 확인: preview가 외부 동작을 실행하지 않으며 자료가 없으면 없다고 표시한다.

## 열린 질문

- shell/confirmation-window#Q1 TTY의 직접 확인도 사람 승인으로 인정할까(H5)?
- shell/confirmation-window#Q2 MCP sampling·elicitation을 승인 흐름에 쓸까?
- shell/confirmation-window#Q3 앱 동작 전후를 설명·안전 preview 중 무엇으로 보여 줄까?

## 버린 것

- 같은 사람 결정 경로의 중복 요구 — R1의 보호 화면 요구에 합친다.
- confirmation window를 띄우기 전 모든 native view 숨김 — 별도 modal 창이면 앱 view가 덮을 수 없고 숨김의 UX 손해가 더 커서 버린다(R6).
