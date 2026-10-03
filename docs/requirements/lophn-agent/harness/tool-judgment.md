---
type: requirements
concerns: [lophn-agent/harness/tool-judgment]
---
# lophn-agent/harness/tool-judgment

tool call마다 실제 되돌림 가능성·현재 책임과 범위에 따른 allow·ask·deny, 정확한 approval 결합과 사람 요청 단위 거절 억제를 맡는다. 실제 사람 결정은 platform/approvals와 shell/confirmation-window를 따른다.

## 요구

### 판정

**[R1]** 모든 자체·외부 MCP tool call은 시작 전에 allow·ask·deny로 판정하여 allow만 바로 호출하고 ask는 platform/approvals의 명시 허락까지 미시작으로 두며 deny는 호출도 approval request도 만들지 않는다.
- 이유: 목록에 있는 tool도 실제 진입은 별도 검사를 거친다.
- 확인: 세 판정마다 실제 진입·승인 생성 여부를 확인한다.

**[R2]** 인증·동작·효과·입력·현재 assignment 상태를 확인하지 못하거나 역할 tool·현재 scope·연결된 MCP 범위를 벗어나면 deny로 판정하여 한 번 승인으로 열지 않는다.
- 이유: 확인 실패와 책임 밖을 사람 승인으로 우회하지 않는다.
- 확인: 인증 실패·모르는 효과·잘못된 입력·회수·범위 밖 각각이 ask 아닌 deny인지 확인한다.

### 되돌릴 수 있음

**[R3]** 범위 안 읽기와 사람 요청 또는 그 handoff의 실제 되돌릴 수 있는 lophn 안쪽 쓰기는 allow, 책임·tool·범위가 유효하지만 되돌림 보장 없는 쓰기·external은 ask로 판정하며 되돌림 가능성은 model의 의도 추측이 아닌 소유 계약으로 확인한다.
- 이유: 사람이 원했나의 추측 대신 실제 revert 가능성을 기준으로 삼는다.
- 확인: 문서 새 version·담당 티켓 생성은 allow이고 유효한 비가역 동작은 ask이며 역할 밖 동작은 되돌릴 수 있어도 deny인지 확인한다.

**[R4]** Operator는 lophn-agent/assignments에서 승인한 기존 남길 문서의 새 version만 allow로 저장하고 선언 밖 쓰기는 ask가 아닌 deny로 처리한다.
- 이유: 주기 승인이 새로운 대상의 쓰기 권한으로 커지지 않는다.
- 확인: 선언 문서는 재확인 없이 저장되고 다른 문서 쓰기는 approval request 없이 거절되는지 확인한다.

### 여러 대상과 승인

**[R5]** 대상 여러 개는 각각 판정하여 하나라도 deny이면 전체 deny, deny 없이 ask가 있으면 전체 대상의 approval request 하나, 모두 allow이면 전체 allow로 처리하고 일부부터 적용하지 않는다.
- 이유: 부분 적용 뒤 뒤늦은 승인 실패를 피한다.
- 확인: allow·ask·deny 혼합 대상의 호출이 전체 단위로 미시작·승인·허용되는지 확인한다.

**[R6]** 최초·retry·복구·approval 뒤의 실제 call 직전에 신원·assignment·scope·tool·MCP 연결·설명·입력 계약·정확한 입력·비교 기준을 재검사하여 확인 대상이나 계약이 달라지면 옛 허락을 사용하지 않는다.
- 이유: 대기 중 바뀐 대상과 계약에 이전 결정을 적용하지 않는다.
- 확인: 승인 대기 중 입력·scope·MCP 계약 변경을 넣어 옛 허락으로 진입하지 않는지 확인한다.

**[R7]** 모델·역할·tool 결과·MCP 설명·handoff·티켓·문서·notification의 허락 주장과 일반 긍정 표현은 approval 증거가 아니며 자동 model 심사·승인 생략 모드로 ask·deny를 allow로 바꾸지 않는다.
- 이유: 자료의 가짜 승인과 우회 모드를 차단한다.
- 확인: 가짜 승인 문서·긍정 메시지를 넣어 실제 결정 없이 call이 시작되지 않는지 확인한다.

**[R8]** 되돌릴 수 없는 유효한 call의 ask는 기한과 정확한 동작·대상·입력·비교 기준에 묶인 approval request로 만들고 질문 option action 및 Operator 정의 변경 승인과 구별한다.
- 이유: 모든 사람 결정을 무기한 쓰기 approval 하나로 뭉치지 않는다.
- 확인: 기한·고정 입력·대상을 확인하고 option action·assignment 적용은 lophn-agent/questions·lophn-agent/assignments 계약을 따르는지 확인한다.

### 거절 억제

**[R9]** 같은 run과 같은 원래 사람 요청에서 handoff로 이어진 모든 run은 사람이 거절한 같은 동작·대상·입력을 다시 묻거나 실행하지 않되 새 독립 사람 요청은 막지 않고 만료·취소·기술 실패를 거절로 바꾸지 않는다.
- 이유: 역할·세션·이유 변경으로 거절을 우회하거나 영구 거절 기억을 만들지 않는다.
- 확인: 같은 요청의 다른 역할·세션·이유는 억제되고 새 사람 요청은 다시 판정되며 만료와 거절은 구별되는지 확인한다.

### 새 기능

**[R10]** 앱 command는 현재 역할·허락·범위·입력이 유효할 때 confirm이면 effect보다 먼저 ask, 아니면 read는 allow, blueprint가 되돌리기 지원을 선언한 write는 allow, 나머지 write와 external은 ask로 판정한다.
- 이유: 같은 blueprint 효과를 호출 주체가 달라도 일관되게 판단한다.
- 확인: read·write 두 종류·external·confirm 조합을 검사하고 confirm read도 approval 전 호출되지 않는지 본다.
- 의도: lophn-agent/harness#I9

**[R11]** 앱의 되돌리기 지원은 active release blueprint의 지원 선언과 대응 command를 기준으로 판단하고 성공 결과의 복원 receipt를 보존하며 model 주장이나 단순 undo 문구만으로 allow로 낮추지 않는다.
- 이유: 지원 선언과 실제 호출을 되돌리는 능력을 함께 검증한다.
- 확인: 지원 없는 write는 ask, 지원 선언과 대응 command가 검증된 write는 선행 기록 후 allow이며 성공 receipt가 저장되는지 본다.
- 의도: lophn-agent#I5

**[R12]** 앱 주석 되쓰기도 일반 write 판정을 거치며 apps/agent-context의 현재 화면·허용 자리 검사가 실패하면 approval로 열지 않고 deny로 처리한다.
- 이유: 힌트라는 이름이 앱의 write 경계를 면제하지 않는다.
- 확인: 되돌릴 수 있는 주석은 allow, 비가역 주석은 ask, 낡은 화면·없는 자리는 deny인지 본다.
- 의도: lophn-agent#I11

## 열린 질문

없음.

## 버린 것

- 권한 예외는 선택한 개별 도구 하나와 허용, 매번 확인, 거부 중 하나를 짝지은 목록으로만 받으며 생략하면 예외가 없고 도구 목록 밖의 예외와 중복되거나 서로 충돌하는 예외는 거절한다. — 역할 책임·실제 되돌림 판정: 범용 권한 규칙·개별 허용 예외 엔티티 없이 역할 동작·범위와 실제 되돌림 계약으로 판정.
- 권한 규칙 하나는 적용받는 역할 또는 assignment, 안쪽 도구인지 특정 MCP 서버의 도구인지, 도구 하나 또는 읽기·쓰기·바깥 동작 중 한 분류, 대상 범위, 입력 제한, `allow`·`ask`·`deny` 중 한 결정을 함께 정한다. 역할 정의의 권한 기본값과 예외도 권한 규칙의 한 종류로 들어가고, 합치는 순서는 PM-8을 따른다. — 역할 책임·실제 되돌림 판정: 범용 policy·wildcard·규칙 병합·persistent permission 엔티티 제거; 역할 동작·범위와 reversibility로 판정.
- 규칙의 역할·서버·도구 선택은 정확한 이름 또는 그 선택 전체를 뜻하는 `*`만 지원하고 대상 선택은 저장이 정한 같은 대상의 명시적 목록 또는 모든 대상만 지원하며 부분 와일드카드·정규식·이름 접두어·문자열 경로 접두어로 일치시키지 않는다. — 역할 책임·실제 되돌림 판정: 범용 policy·wildcard·규칙 병합·persistent permission 엔티티 제거; 역할 동작·범위와 reversibility로 판정.
- 입력 제한은 입력 전체가 같은 경우와 모든 입력 두 가지만 지원하며 전체 입력 비교는 이름 붙은 값의 나열 순서를 무시하되 값의 종류·내용·목록 순서를 보존하고 MCP 도구의 대상을 확인할 수 없으면 특정 대상의 허용 대신 전체 입력이 같은 허용 또는 모든 대상·모든 입력의 허용만 적용한다. — 역할 책임·실제 되돌림 판정: 범용 policy·wildcard·규칙 병합·persistent permission 엔티티 제거; 역할 동작·범위와 reversibility로 판정.
- 일치하는 명시적 규칙이 여럿이면 `deny`가 `ask`보다 앞서고 `ask`가 `allow`보다 앞서며 규칙의 작성 순서·설정 층·범위의 좁고 넓음·사용자가 계속 허락한 시점으로 이 순서를 뒤집지 않는다. — 역할 책임·실제 되돌림 판정: 범용 policy·wildcard·규칙 병합·persistent permission 엔티티 제거; 역할 동작·범위와 reversibility로 판정.
- 사용자의 허락 범위는 해당 호출을 한 번 허락하는 것과 그 assignment에 표시한 도구·대상·입력 범위를 회수할 때까지 계속 허락하는 것 두 가지로만 제공하되 명시적 `ask` 규칙이 일치하면 한 번 허락만 제공하며 세션 동안 허락은 제공하지 않는다. — 역할 책임·실제 되돌림 판정: 호출 approval과 Operator assignment 승인만 사용; 회수까지 계속 허락하는 별도 agent grant 없음.
- 새로 만들거나 넓히는 계속 허락에서 적용받는 역할·MCP 서버·도구 중 하나가 전체 선택이거나 대상이 모든 대상이거나 입력이 모든 입력이면 넓은 권한으로 보고 설정 변경을 포함한 모든 경로에서 두 번째 확인을 요구한다. — 역할 책임·실제 되돌림 판정: agent persistent permission·넓은 grant·두 번째 grant 확인 없음; MCP contract 변경 재검사는 PM-16/XT-24로 유지.
- 넓은 권한의 첫 허락 뒤에는 새로 허용되는 역할·서버·도구·대상·입력과 이후에는 묻지 않는다는 사실을 다시 제시하고 사용자의 별도 두 번째 동작을 받아야 하며 CLI에서는 `yes` 뒤 `grant`를 다시 직접 입력하고 취소하거나 범위가 바뀌면 처음부터 확인한다. — 역할 책임·실제 되돌림 판정: agent persistent permission·넓은 grant·두 번째 grant 확인 없음; MCP contract 변경 재검사는 PM-16/XT-24로 유지.
- 사용자는 계속 허락의 받는 assignment·도구·서버·대상·입력 범위와 마지막 사용 시각을 확인하고 즉시 회수할 수 있으며 계속 허락은 임의의 시간 경과나 미사용 기간으로 자동 회수하지 않는다. — 역할 책임·실제 되돌림 판정: agent persistent permission·넓은 grant·두 번째 grant 확인 없음; MCP contract 변경 재검사는 PM-16/XT-24로 유지.
- 계속 허락은 확인한 MCP 연결과 도구 계약에 묶어 연결의 대체·삭제 뒤 재등록·도구의 입력이나 효과 변경에 넘기지 않으며 단순 통신 재연결에는 같은 연결과 계약인지 다시 확인한 뒤 유지한다. — 역할 책임·실제 되돌림 판정: agent persistent permission·넓은 grant·두 번째 grant 확인 없음; MCP contract 변경 재검사는 PM-16/XT-24로 유지.
- 자식의 호출 가능 범위는 협업 CO-5를 따르며 부모에게 허용된 동작과 맡긴 범위의 교집합에서 handoff 권한을 뺀 것이다. 호출마다 현재 부모와 자식의 판정 중 더 제한적인 것을 적용하여 부모의 `ask`를 자식의 `allow`로 낮추지 않는다. — 유지 결정의 subagent 제외: subagent 없음; handoff는 approval/권한을 복사하지 않는 별도 경로.
- 부모의 한 번 또는 계속 허락은 자식이나 다른 역할의 허락으로 복사하지 않고 자식에게 새로 허락하더라도 부모의 현재 도구·대상 범위와 자식에게서 제외한 범위를 넓히지 않는다. — 유지 결정의 subagent 제외: subagent 없음; handoff는 approval/권한을 복사하지 않는 별도 경로.
- 같은 assignment가 자료 전체 읽기와 외부 반출을 함께 허용받는 조합도 두 번째 확인으로 다룰지 정한다. — 역할 책임·실제 되돌림 판정: agent의 persistent permission·두 번째 grant 확인 모델 없음.
- subagent 권한은 부모 허용과 맡긴 scope의 교집합에서 handoff 권한을 뺀 것이며 부모 거절을 자식 정의·요청으로 다시 허용하지 않는다. — 유지 결정의 subagent 제외: subagent 권한 상속 모델 없음; 역할 handoff의 독립 scope·lophn-agent/harness/tool-judgment 거절 억제는 별도.
