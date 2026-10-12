---
type: requirements
concerns: [lophn-agent/harness/usage]
---
# lophn-agent/harness/usage

실제 model call의 입력·출력 근거와 token·cache·당시 가격 비용, run·역할·세션·기간별 합계를 맡는다. 가격 수집은 lophn-agent/harness/model, 기록 보존 기간은 lophn-agent/observability를 따른다.

## 요구

### 호출 기록

**[R1]** provider에 실제 보낸 성공·실패·취소·retry·요약 시도는 각각 한 번 기록하고 전송 전 막힌 선택은 실제 호출로 세지 않으며 시작 기록 저장 실패면 전송하지 않는다.
- 이유: 실제 지출과 보내지 않은 선택을 구별한다.
- 확인: retry·요약의 실제 시도 수와 기록 수가 같고 시작 저장 실패에는 전송 0개인지 확인한다.
- 의도: lophn-agent/harness#I3

**[R2]** 호출마다 주체·역할·run·세션·순서·시도·provider·secret 없는 credential 참조·원래 선택·전송 model·응답 model·과금 경로·judgment(agent model) 또는 organizing(Model for summaries) 선택과 판단·제목과 요약·세션 압축 용도를 각각 확인할 수 있다.
- 이유: 같은 model을 왜 어느 credential 판으로 불렀는지 되짚는다.
- 확인: model 용도와 작업 용도가 별도로 보이고 호출 때 고정한 provider의 credential 판·과금 경로가 기록되는지 확인한다.
- 의도: lophn-agent/harness#I3

**[R3]** 시작·종료 시각·전송부터 종료까지 millisecond·측정된 첫 출력 token 지연·종료 결과·provider 실패 종류·종료 이유·상태와 오류 코드를 남기되 오류 본문은 기록하지 않는다.
- 이유: 지연과 실패를 비밀 없는 근거로 분석한다.
- 확인: 성공·실패·취소·거절 기록에 시간·종류가 있고 측정하지 않은 첫 token 지연은 모름인지 확인한다.
- 의도: lophn-agent/harness#I3

**[R4]** 호출의 실제 입력·출력은 platform/redaction을 거친 blob 근거로 보존하여 조립 판·층별 근거·자료 version·원문 구간·문자 수·압축 여부·당시 model 한계·catalog와 보완·요청한 option 값과 실제 실은 값을 남기고 완료 기록은 덮지 않는다.
- 이유: catalog·설정 변경 뒤에도 과거 호출 조건을 재현한다.
- 확인: 설정·catalog 갱신 후 과거 입력·출력·근거·한계가 유지되고 내부 추론·secret이 없으며 보존 기간은 lophn-agent/observability를 따르는지 확인한다.
- 의도: lophn-agent/harness#I3

### token

**[R5]** 보고된 새 입력·출력·cache 읽기·cache 쓰기·추론 token을 구별하여 새 입력과 cache 구간은 겹치지 않게 세고 출력에 포함된 추론은 전체 합계에 다시 더하지 않으며 포함 관계를 비교할 수 없으면 분리한다.
- 이유: provider마다 다른 usage 의미를 이중 합산하지 않는다.
- 확인: cache가 입력에 포함된 경우와 추론이 출력에 포함된 경우의 합계가 중복되지 않는지 확인한다.
- 의도: lophn-agent/harness#I3

**[R6]** 보고하지 않은 사용량은 모름으로 남겨 0·추정과 구별하고 추정 token으로 채우지 않으며 실패·취소 호출도 보고된 값은 보존한다.
- 이유: 실패한 호출을 무료 또는 사용량 0으로 오해하지 않는다.
- 확인: usage 없는 응답·실패 후 usage·취소 후 usage가 각각 모름 또는 보고값으로 남는지 확인한다.
- 의도: lophn-agent/harness#I3

### 비용

**[R7]** 실제 시도마다 비용 또는 모름 사유를 연결하여 provider 보고 청구액·단가 추정·구독 포함·확인된 무료·금액 불명 다섯 종류를 구별하고 구독료·로컬 운영비를 호출마다 임의 배분하지 않는다.
- 이유: API 추정 금액을 실제 청구처럼 보이지 않는다.
- 확인: 다섯 종류와 과금 경로를 구별하고 로컬 호출에 임의 운영비가 없는지 확인한다.
- 의도: lophn-agent/harness#I3

**[R8]** 추정 비용은 보고된 겹치지 않는 새 입력·출력·cache 읽기·cache 쓰기에 당시 해당 요율을 곱해 십진수로 더하여 추론을 중복 과금하지 않고 필요한 usage·가격이 없으면 모름으로 남기며 출처·확인 시각·판·통화·문맥 구간·cache 시간을 함께 보존한다.
- 이유: 사용한 요율과 실제 token 근거로 계산을 재현한다.
- 확인: 부분 가격·구간 경계·cache 시간별 계산을 확인하고 다른 통화는 합치거나 자동 환산하지 않는지 확인한다.
- 의도: lophn-agent/harness#I3

**[R9]** 가격 갱신으로 과거 비용을 다시 계산해 덮지 않고 사후 청구 확인·명시 재계산·늦은 usage는 최초 사실과 구별되는 보완 근거로 추가한다.
- 이유: 최초 추정과 나중 확인을 함께 되짚는다.
- 확인: 가격 변경·실제 청구 보완 뒤 옛 추정이 남고 새 근거가 별도로 보이는지 확인한다.
- 의도: lophn-agent/harness#I3

### 합계

**[R10]** run·세션·역할·기간·model·통화별 합계는 같은 실제 호출을 한 번만 세어 청구·추정·구독·무료·불명 수와 사용량·기록 누락을 함께 제공하며 eval 재생은 실제 지출에서 빼고 handoff 수신 호출은 실제 수신 run·역할에 귀속한다.
- 이유: 누락을 0원으로 숨기거나 handoff 비용을 이중 계산하지 않는다.
- 확인: 보완·재생·handoff가 있는 합계에서 호출 중복 0개와 모름·누락 표시를 확인하며 화면의 모양과 위치는 shell/desktop을 따른다.
- 의도: lophn-agent/harness#I3

**[R11]** run을 금액 비용 상한으로 막지 않고 유한한 횟수·시간 제어는 lophn-agent/harness/run-loop를 따른다.
- 이유: 돈의 선택은 사람에게 두고 사용량은 투명하게 기록한다.
- 확인: 비용이 커져도 금액 gate가 없고 model 횟수·시간 한도는 작동하는지 확인한다.
- 의도: lophn-agent/harness#I3

## 버린 것

없음.
