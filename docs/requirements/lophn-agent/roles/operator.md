---
type: requirements
concerns: [lophn-agent/roles/operator]
---
# lophn-agent/roles/operator

project 또는 app에 붙어 정의(lophn-agent/agents)가 고른 context·앱 read로 정해진 반복 판단을 사람의 요청에 따라 수행하고 결과를 자리의 문서에 남기는 Operator의 책임·읽기·tool·본문 판단을 맡는다.

## 요구

### 책임과 범위

**[R1]** Operator는 project 또는 app 하나에 붙어 정한 반복 판단과 결과 축적을 맡으며 지침 본문에 판단·필요 근거·비교 기준·갱신 조건을 적고 사람이 그 Operator를 불러 연 session의 요청으로만 일한다.
- 이유: 반복 모델 판단과 임의 앱 작업을 구분한다.
- 확인: 정의의 이름·지침 본문이 맡을 판단을 드러내고 사람 요청 밖의 계기(시각·자료 변화·notification)로 run이 생기지 않는지 확인한다.
- 의도: lophn-agent#I4

**[R2]** Operator는 run마다 사람이 저장한 정의에서 합친 resolved agent를 고정해 쓰고 정의의 칸과 저장은 lophn-agent/agents, 실행 정체와 거둠은 lophn-agent/assignments를 따른다.
- 이유: 사람이 정한 구성과 실행 정체를 분리하고 정의를 고쳐도 시작한 run의 값이 바뀌지 않게 한다.
- 확인: Operator가 독립 run으로만 쓰이고, 정의를 고친 뒤 시작한 run은 새 값을, 진행 중인 run은 처음 값을 쓰는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I5

**[R3]** Operator는 기획·앱 설계·수리 티켓·코드, context 계약·검색·용어집 변경, 자기 역할·정의·assignment 변경과 개별 앱 작업의 판단 담당을 겸하지 않는다.
- 이유: 여러 앱을 읽어도 반복 책임 밖의 변경은 하지 않는다.
- 확인: 여러 앱 자료를 함께 판단한 문서만 남고 프로젝트·SDK·문제·티켓·역할·정의·assignment 관리 tool이 제공되지 않는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I6

**[R4]** Operator는 정의가 고른 담당 project의 context에서 overview·용어집을 알고 선언한 검색과 개체 읽기로 찾은 자료, 앱 Operator는 정의의 `app_reads`로 고른 앱 read command 결과를 읽어 지침의 비교 기준으로 변화의 의미를 판단한다.
- 이유: 읽을 자료 선택은 담당 scope와 다르며 주소가 scope를 확대하지 않는다.
- 확인: 같은 project의 Operator 둘이 서로 다른 자료를 읽고 scope 밖 자료·고르지 않은 명령은 거절되는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I5

**[R5]** Operator는 정의의 권한과 MCP·skill에서 제품 상한 안 동작을 선택하며 담당 자료 읽기·format 검사·자리의 문서에 새 version 저장·담당 context의 series 다음 이름으로 이어 쓰는 새 문서·질문·정의에 고른 정확한 앱 read만 수행한다.
- 이유: apps/blueprint·lophn-agent/roles/operator에 따라 명령 이름만 같거나 컨텍스트에 있다는 이유로 실행시키지 않는다.
- 확인: 선택 MCP에도 범위·effect 검사가 있고 앱 write·confirm·external과 series 다음 이름이 아닌 새 문서 생성이 역할 밖이면 deny되는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I5

### 결과 갱신과 사람 요청

**[R6]** 결과는 확인한 사실·판단·불확실함을 구분해 자리의 문서에 필요한 만큼 남기고 갱신 조건을 충족하지 않으면 근거와 함께 변화 없음으로 답하며 새 version을 만들지 않는다.
- 이유: 무변화는 실패가 아니고 같은 내용을 형식상 덧쌓지 않는다.
- 확인: 변화 없는 요청에서 새 version이 0개이고 run이 정상 완료로 남으며, 갱신할 요청은 필요한 문서마다 결과를 저장할 수 있는지 본다.
- 의도: lophn-agent#I4, lophn-agent#I7

**[R7]** Operator의 문서 쓰기(기존 문서의 새 version, 담당 context의 series 다음 이름으로 이어 쓰는 새 문서)는 다른 agent와 같은 lophn-agent/harness/tool-judgment 판정을 따라 되돌릴 수 있는 쓰기는 묻지 않으되 자리 밖 문서에 쓰거나 문서 자리·형식을 바꾸는 것은 허용하지 않는다.
- 이유: 남길 문서를 미리 선언하지 않으므로 쓸 수 있는 범위는 담당 자리와 정의의 권한이 정하고, 쓰기마다 판정이 지킨다.
- 확인: 자리 안 문서의 새 version 저장은 진행되지만 담당 자리 밖 문서 저장은 approval request로 우회하지 않고 거절되는지 본다.
- 의도: lophn-agent#I4

**[R8]** 사람은 Operator를 직접 불러 연 session에서 결과 해석·수정과 필요한 의도·취향을 이야기할 수 있지만 그 답으로 정의·범위·tool을 바꾸지 않으며 오래 남길 답은 자리의 문서 새 version으로만 남긴다.
- 이유: 업무 답과 반복 책임 변경 승인을 구분한다.
- 확인: 사람 답 후 변경은 문서 결과뿐이고 정의 변경은 사람이 editor에서 직접 저장해야만 일어나는지 본다(lophn-agent/agents#R8).
- 의도: lophn-agent#I4, lophn-agent#I6

**[R9]** 해석·판단·본문은 resolved agent의 model, 제목·이미 있는 내용의 요약은 Workspace의 Model for summaries를 쓰며 그 칸이 비면 같은 agent model을 쓰고 실제 provider 계정·model은 run에 고정한다.
- 이유: 사람이 고른 구성으로 반복 판단과 정리를 수행한다.
- 확인: Operator 둘의 서로 다른 model·provider이 실제 호출에 반영되고, model을 바꾼 적 없는 Operator만 Workspace의 Operator 기본값을 따라가는지 본다.
- 의도: lophn-agent#I5

**[R10]** Operator의 run 실패와 질문 대기는 lophn-agent/harness/run-loop와 lophn-agent/harness/waiting-and-recovery를, 멈춘 assignment와 거둔 assignment의 입력 처리는 lophn-agent/assignments를 따르며 실패를 무시하고 계속하는 선택이나 handoff 송수신은 없다.
- 이유: 멈춘 반복 책임이 다른 계기로 자동 재개되지 않게 한다.
- 확인: 중단 후 새 run과 handoff가 저절로 시작되지 않고 사람 직접 요청은 현재 assignment 상태 검사에 따르는지 본다.
- 의도: lophn-agent#I4

### prompt의 관점·기대 결과

담당 project/app에서 고른 context의 type·뜻·관계·용어집과 구체적 비교 기준으로 판단한다. 반복할 판단, 필요한 근거, 비교 기준, 갱신 조건은 지침 본문에 모두 명시한다. 실제 확인한 사실·판단·불확실함·근거 주소 또는 갱신할 내용 없음의 근거를 기대한다.

| 결과 종류 | 필수 내용 | 제약 |
|---|---|---|
| 갱신 결과 | 확인한 사실·판단·불확실함·고정 근거 주소·지침에 쓴 판단 항목 | 지침의 갱신 조건에 맞을 때만 새 Version |
| 무변화 결과 | 갱신 조건을 충족하지 않은 근거 | 새 Version 0개; Run 결과 `completed` |
| 부분 결과 | 실제 저장된 문서·Version, 미저장·실패 내용 | 일부 저장을 전체 성공이나 전체 취소로 표시하지 않음 |
| 지속할 사람 답 | 지침의 판단 항목에 필요한 답·결과 해석 | 자리의 문서 새 Version에만 저장 |


## 버린 것
- 앱 업무 단계의 판단 담당·부재 처리까지 Operator가 겸하는 계약은 반복 판단 문서 책임과 맞지 않아 제거했다.
- run당 결과 최대 1개·문서 동적 이름은 lophn-agent/roles/operator에 따라 승인한 실제 문서의 필요한 새 version으로 바꿨다. series 새 문서 금지는 풀었다: 담당 context의 series 다음 이름으로 새 파일을 쓴다(documents/series).
- 앱 write·external과 선언 밖 쓰기를 approval request로 우회하는 경로는 금지한다. provider·model 고정 공통 설정은 preset별 선택으로 바꿨다.
- 외부 MCP·skill 0개 상한은 I5에 맞게 없앴고 제품 금지·scope 검사는 유지한다.
- context의 기준·참고·watch 관점과 watch 변화로 판단하는 읽기는 perspective와 watch가 없어져 뺐다. Operator는 context의 overview·용어집과 검색으로 자료를 찾는다.
- 주기로 도는 회차와 회차마다 쓰는 승인한 남길 문서(outputs)는 scheduling 보류와 남길 문서 삭제로 없앴다(R1·R6·R7·R10; lophn-agent/scheduling, lophn-agent/agents#Q1). 읽을 앱 command는 정의의 `app_reads`가 맡는다(lophn-agent/assignments#Q6).
- 정의·범위·주기를 사람 답 뒤 assignment 전체 승인으로 바꾸는 길은 Operator를 사람이 editor에서 직접 저장하는 길로 바뀌어 없앴다(R8; lophn-agent/assignments#Q5).
