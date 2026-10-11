---
type: requirements
concerns: [lophn-agent/roles/operator]
---
# lophn-agent/roles/operator

project 또는 app에 붙어 preset context로 읽을 자료를 고르는 assignment에서 정해진 반복 판단을 수행하고 승인한 기존 문서에 결과를 축적하는 Operator의 책임·읽기·tool·본문 판단을 맡는다.

## 요구

### 책임과 범위

**[R1]** Operator는 project 또는 app 하나에 붙어 정한 반복 판단과 결과 축적을 맡으며 prompt에 판단·필요 근거·비교 기준·갱신 조건을 적고 주기 또는 그 assignment에 대한 사람 요청으로만 일한다.
- 이유: 반복 모델 판단과 임의 앱 작업을 구분한다.
- 확인: 정의의 이름·목적·사용 상황이 맡을 판단을 드러내고 다른 계기로 run이 생기지 않는지 확인한다.
- 의도: lophn-agent#I4

**[R2]** Operator는 사람이 고른 preset 하나의 고정 판을 사용하고 preset 편집·복사·재사용은 lophn-agent/presets, 실제 담당 대상과 실행 승인은 lophn-agent/assignments를 따른다.
- 이유: 재사용 구성과 실제 담당 범위·쓰기를 분리한다.
- 확인: 구체적 Operator가 독립 run으로만 쓰이고 승인 전 실행할 assignment가 생기지 않는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I5

**[R3]** Operator는 기획·앱 설계·수리 티켓·코드, context 계약·검색·용어집 변경, 자기 역할·assignment 변경과 개별 앱 작업의 판단 담당을 겸하지 않는다.
- 이유: 여러 앱을 읽어도 반복 책임 밖의 변경은 하지 않는다.
- 확인: 여러 앱 자료를 함께 판단한 문서만 남고 프로젝트·SDK·문제·티켓·역할·assignment 관리 tool이 제공되지 않는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I6

**[R4]** Operator는 preset이 고른 담당 project/app의 context에서 overview·용어집을 알고 선언한 검색과 개체 읽기로 찾은 자료, 승인한 앱별 read 명령 결과를 읽어 prompt의 비교 기준으로 변화의 의미를 판단한다.
- 이유: 읽을 자료 선택은 담당 scope와 다르며 주소가 scope를 확대하지 않는다.
- 확인: 같은 project의 Operator 둘이 서로 다른 자료를 읽고 scope 밖 자료·미승인 명령은 거절되는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I5

**[R5]** Operator는 preset capability와 MCP·skill에서 제품 상한 안 동작을 선택하며 담당 자료 읽기·format 검사·기존 outputs 새 version·질문·승인한 정확한 앱 read만 수행한다.
- 이유: apps/blueprint·lophn-agent/roles/operator에 따라 명령 이름만 같거나 컨텍스트에 있다는 이유로 실행시키지 않는다.
- 확인: 선택 MCP에도 범위·effect 검사가 있고 write·confirm·external·새 문서 생성이 역할 밖이면 deny되는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I5

### 결과 갱신과 사람 요청

**[R6]** 결과는 확인한 사실·판단·불확실함을 구분해 승인한 문서에 필요한 만큼 남기고 갱신 조건을 충족하지 않으면 근거와 함께 변화 없음으로 끝내며 새 version을 만들지 않는다.
- 이유: 무변화는 실패가 아니고 같은 내용을 형식상 덧쌓지 않는다.
- 확인: 변화 없는 회차에서 문서 수가 0이고 정상 완료로 남으며 다른 회차는 승인 문서 수 안에서 여러 결과를 저장할 수 있는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I7

**[R7]** 승인한 기존 문서의 새 version은 회차마다 approval request를 다시 묻지 않되 문서 자리·형식을 바꾸거나 선언 밖 문서에 쓰는 것은 허용하지 않는다.
- 이유: lophn-agent/roles/operator에 따라 assignment 승인으로 범위를 고정한다.
- 확인: 남길 문서 저장은 진행되지만 다른 문서 저장은 approval request로 우회하지 않고 거절되는지 본다.
- 의도: lophn-agent#I4

**[R8]** 사람은 Operator assignment를 직접 선택해 결과 해석·수정과 필요한 의도·취향을 이야기할 수 있지만 그 답으로 정의·범위·주기·tool을 바꾸지 않으며 오래 남길 답은 승인한 문서의 새 version으로만 남긴다.
- 이유: 업무 답과 반복 책임 변경 승인을 구분한다.
- 확인: 사람 답 후 변경은 문서 결과뿐이고 정의 변경은 lophn-agent/assignments의 별도 전체 승인을 요구하는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I6

**[R9]** 해석·판단·본문은 preset model, 제목·이미 있는 내용의 요약은 preset organizing 선택을 쓰며 organizing 선택이 없으면 같은 preset model을 쓰고 실제 provider 계정·model은 판에 고정한다.
- 이유: 사람이 고른 구성으로 반복 판단과 정리를 수행한다.
- 확인: Operator 둘의 서로 다른 model·계정이 실제 호출에 반영되고 공통 기본값 변경으로 바뀌지 않는지 본다.
- 의도: lophn-agent#I5

**[R10]** Operator의 반복 실패와 대기 중 회차 처리는 lophn-agent/assignments와 lophn-agent/scheduling을 따르며 실패를 무시하고 계속하는 선택이나 handoff 송수신은 없다.
- 이유: 멈춘 반복 책임이 다른 계기로 자동 재개되지 않게 한다.
- 확인: 중단 후 새 회차와 handoff가 시작되지 않고 사람 직접 요청은 현재 assignment 상태 검사에 따르는지 본다.
- 의도: lophn-agent#I4

### prompt의 관점·기대 결과

담당 project/app에서 고른 context의 type·뜻·관계·용어집과 구체적 비교 기준으로 판단한다. 반복할 판단, 필요한 근거, 비교 기준, 갱신 조건은 prompt 글에 모두 명시한다. 실제 확인한 사실·판단·불확실함·근거 주소 또는 갱신할 내용 없음의 근거를 기대한다.

| 결과 종류 | 필수 내용 | 제약 |
|---|---|---|
| 갱신 결과 | 확인한 사실·판단·불확실함·고정 근거 주소·선언한 판단 항목 | 승인된 update_condition에 맞을 때만 새 Version |
| 무변화 결과 | 갱신 조건을 충족하지 않은 근거 | 새 Version 0개; Run 결과 `completed` |
| 부분 결과 | 실제 저장된 문서·Version, 미저장·실패 내용 | 일부 저장을 전체 성공이나 전체 취소로 표시하지 않음 |
| 지속할 사람 답 | 승인된 판단 항목에 필요한 답·결과 해석 | 선언한 기존 문서 새 Version에만 저장 |


## 버린 것
- 앱 업무 단계의 판단 담당·부재 처리까지 Operator가 겸하는 계약은 반복 판단 문서 책임과 맞지 않아 제거했다.
- run당 결과 최대 1개·시리즈 새 문서·문서 동적 이름은 lophn-agent/roles/operator에 따라 승인한 실제 문서의 필요한 새 version으로 바꿨다.
- 앱 write·external과 선언 밖 쓰기를 approval request로 우회하는 경로는 금지한다. provider·model 고정 공통 설정은 preset별 선택으로 바꿨다.
- 외부 MCP·skill 0개 상한은 I5에 맞게 없앴고 제품 금지·scope 검사는 유지한다.
- context의 기준·참고·watch 관점과 watch 변화로 판단하는 읽기는 perspective와 watch가 없어져 뺐다. Operator는 context의 overview·용어집과 검색으로 자료를 찾는다.
