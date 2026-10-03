---
type: requirements
concerns: [lophn-agent/harness/model]
---
# lophn-agent/harness/model

model catalog와 한계·가격 검증, 모든 역할이 공통으로 쓰는 judgment model·organizing model의 선택과 호출 가능 조건을 맡는다. 역할별 일의 slot 선택은 lophn-agent/roles, 비용은 lophn-agent/harness/usage를 따른다.

## 요구

### catalog

**[R1]** model은 provider와 그 provider가 받는 model 이름의 쌍으로 구별하여 직접 제공처와 중계 제공처의 문맥 한계·추론 선택·사용 가능 상태를 공유하지 않는다.
- 이유: 같은 이름도 제공처마다 계약이 다르다.
- 확인: 같은 model 이름의 직접·중계 연결에 서로 다른 한계가 유지되는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R2]** catalog는 전체 문맥·입력·출력 한계, tool call 지원, 입력·출력 매체, 추론 조절 방식·범위·기본 수준, preview·폐기 예정 여부를 model 선택과 prompt 조립에 제공한다.
- 이유: 호출 가능한 model을 이름만으로 판단하지 않는다.
- 확인: 선택 화면과 조립 검사가 각 정보의 확인값·미확인 상태를 구별하는지 확인한다.
- 의도: lophn-agent/harness#I1, lophn-agent/harness#I3

**[R3]** catalog는 models.dev release snapshot→새 정상 갱신본→lophn의 좁은 보정→사람 보완 순으로 겹쳐 명시한 부분만 덮으며 사실과 보완의 출처를 구별한다.
- 이유: 보정이 정상 정보를 통째로 없애지 않는다.
- 확인: 출력 한계만 보완했을 때 다른 한계·가격과 각 출처가 유지되는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R4]** model 목록·가격·provider 정의는 models.dev 응답 한 번으로 공유하고 마지막 확인 뒤 24시간이 지나면 시작 시와 run 중 비동기로 갱신하며 ETag 조건부 GET과 사람의 즉시 새로 받기를 지원한다.
- 이유: 중복 다운로드와 호출 경로의 대기를 막는다.
- 확인: 하나의 갱신 요청으로 세 자료가 갱신되고 24시간 전 자동 요청은 없으며 사람 요청은 즉시 나가는지 확인한다.
- 의도: lophn-agent/harness#I1, lophn-agent/harness#I5

**[R5]** 빈 목록·해석 실패·양의 정수가 아닌 token 한계와 음수·무한대·잘못된 단위·중복 또는 잘못된 문맥 가격 경계는 갱신 전체를 거절하고 마지막 정상본·확인 시각을 보존하며 정상본이 없으면 release snapshot을 쓴다.
- 이유: 깨진 외부 자료로 정상 설정을 덮지 않는다.
- 확인: 각 잘못된 응답·네트워크 실패에서 이전 값·정상 수신 시각과 실패 표시가 유지되는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R6]** catalog 갱신은 세션·key·token·model 선택·계정 정보를 싣지 않는 공개 GET만 보내고 사람이 자동 갱신을 끄면 마지막 정상본 또는 release snapshot만 사용한다.
- 이유: 공개 목록 수집에 개인 정보를 보낼 이유가 없다.
- 확인: 갱신 요청 내용을 검사하고 자동 갱신을 끈 뒤 네트워크 조회가 없는지 확인한다.
- 의도: lophn-agent/harness#I1

### 가격

**[R7]** 가격은 provider·model별 출처·확인 시각과 미국 달러 기준 100만 token당 입력·출력·cache 읽기·cache 쓰기·별도 추론 요율 및 문맥 크기 경계를 보존하고 누락 요율은 무료가 아닌 모름으로 제공한다.
- 이유: 동일 이름의 다른 제공처 가격과 부분 가격을 잃지 않는다.
- 확인: 0달러·누락·부분 가격을 구별하고 구간 경계 전후 요율이 lophn-agent/harness/usage에 전달되는지 확인한다.
- 의도: lophn-agent/harness#I5

### 공통 model slot

**[R8]** judgment model과 organizing model은 모든 역할이 공통으로 쓰는 두 slot이며 역할별 model 덮어쓰기는 없고 organizing model은 제목·요약·세션 압축에 사용한다.
- 이유: 역할마다 서로 다른 설정과 자동 승격 경로를 만들지 않는다.
- 확인: 네 역할이 같은 두 선택을 쓰고 일별 slot 선택은 lophn-agent/roles에서 확인하며 organizing 실패가 judgment 호출로 대체되지 않는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R9]** 처음 설치한 두 slot은 비어 있고 사람이 slot별 provider·model·추론 수준을 선택해야 해당 일이 시작되며 변경은 다음 run부터 적용한다.
- 이유: model을 시스템이 몰래 배정하지 않는다.
- 확인: 빈 slot의 일을 막고 진행 중 설정 변경이 현재 run을 바꾸지 않는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R10]** model 이름 저장은 provider의 현재 목록에 없으면 거절하고 목록을 확인하지 못하면 미확인으로 저장하되 첫 성공 호출에서 그 표시를 해제한다.
- 이유: 목록 조회 실패와 명백히 잘못된 이름을 구별한다.
- 확인: 목록 밖 이름 거절·목록 미조회 저장·첫 성공 뒤 확인 표시를 테스트한다.
- 의도: lophn-agent/harness#I1

### 호출 한계

**[R11]** 선택은 알려진 텍스트 입력·출력 또는 필요한 tool call 미지원 model을 거절하고 호출 전 입력·예약 출력·전체 문맥 한계를 하나라도 넘으면 전송하지 않는다.
- 이유: provider에 보내기 전에 확정된 한계를 지킨다.
- 확인: 각 한계 바로 아래·같음·초과 요청에서 초과만 전송하지 않는지 확인한다.
- 의도: lophn-agent/harness#I1, lophn-agent/harness#I3

**[R12]** catalog 누락·폐기 예정은 저장된 slot을 지우거나 이름을 바꾸지 않고 사람에게 표시하며 provider가 사용 불가를 판정해도 다른 model로 자동 대체하지 않는다.
- 이유: 외부 catalog 변경으로 사람 선택을 바꾸지 않는다.
- 확인: 누락·폐기·사용 불가 후 기존 선택과 실패 이유가 남고 다른 model 요청은 없는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R13]** catalog 밖 model은 확인된 정보 또는 사람이 명시한 양의 입력·출력·전체 문맥 한계와 text·tool 지원 정보가 있어야 사용할 수 있고 128,000·8,192 token 또는 tool 지원을 임의로 가정하지 않는다.
- 이유: 큰 기본 한계로 미확인 model을 사용 가능하게 만들지 않는다.
- 확인: 한계·tool 지원 미상 model은 호출되지 않고 명시 보완이 catalog 사실과 구별되는지 확인한다.
- 의도: lophn-agent/harness#I1, lophn-agent/harness#I3

**[R14]** 정확한 model별 token 계산이 없으면 텍스트 UTF-8 byte 수를 보수적 token 상한으로 쓰고 비텍스트 크기를 모르면 호출하지 않으며 한글·이미지·큰 결과를 0 token이나 4글자당 1 token으로 추측하지 않는다.
- 이유: 한글과 첨부가 작은 입력으로 잘못 계산되지 않게 한다.
- 확인: 한글·큰 MCP 결과·크기 미상 이미지에서 보수 상한 또는 호출 중단을 확인하고 전체 크기 적용은 lophn-agent/harness/prompt-assemble에서 확인한다.
- 의도: lophn-agent/harness#I3

### 추론 수준

**[R15]** 추론 수준은 끔·최소·낮음·중간·높음·매우 높음·최대 일곱 순서와 순서 밖의 모델에 맡김으로 제공하되 화면 문구는 shell/wording에 따라 영어 message key로 제공한다.
- 이유: provider별 이름 차이를 사람에게 공통 선택으로 보인다.
- 확인: 일곱 순서와 별도 맡김이 표시되고 미지원 수준은 선택되지 않는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R16]** 강도 이름 방식은 catalog에서 확인된 수준만 제공하고 기본값 이름·빈 값은 강도로 취급하지 않으며 모델에 맡김에서 보정된 기본 수준이 없으면 추론 인자를 보내지 않는다.
- 이유: 기본값을 실제 강도처럼 전송하지 않는다.
- 확인: 지원 수준만 표시되고 맡김·기본 수준 미상 요청에는 추론 인자가 없는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R17]** token 예산 방식은 낮음 2,048·중간 8,192·높음 16,384·최대 32,768 token을 확인된 양의 최소·최대 안으로 제한하고 토글 방식은 끔·높음만 제공한다.
- 이유: 추론 예산을 결정 가능한 수치로 고정한다.
- 확인: 작은 최소·최대에서 각 예산이 범위를 넘지 않고 토글 방식은 두 선택만 보이는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R18]** run은 시작한 추론 수준을 유지하고 일별 요청은 slot의 명시 수준보다 높이지 못한다.
- 이유: 현재 run의 비용·행동 조건을 설정 변경으로 바꾸지 않는다.
- 확인: 진행 중 수준 변경과 더 높은 일별 요청에도 시작 수준 상한이 유지되는지 확인한다.
- 의도: lophn-agent/harness#I1

### 호출 한계

**[R19]** 첫 판 model call은 텍스트 입력·출력만 사용하며 이미지·PDF·음성·영상의 원본은 매체 지원과 크기 계약이 완성되기 전 입력에 넣지 않는다.
- 이유: 미확인 첨부 크기로 한계를 우회하지 않는다.
- 확인: 원본 첨부 없이 범위가 확인된 추출 텍스트만 입력되는지 확인한다.
- 의도: lophn-agent/harness#I3

**[R20]** 선택 model을 사용할 수 없으면 그 이유와 더 호출하지 않았다는 사실을 남기고 organizing slot의 실패를 judgment slot으로 올려 처리하지 않는다.
- 이유: 실패를 더 큰 model이나 다른 용도 호출로 숨기지 않는다.
- 확인: 선택 model 실패 후 다른 slot·model 호출 없이 이유가 보이는지 확인한다.
- 의도: lophn-agent/harness#I1

## 열린 질문

- lophn-agent/harness/model#Q1 공개 가격 외 계약 가격을 사람이 별도 출처로 보완할 것인가?
- lophn-agent/harness/model#Q2 catalog 밖 model의 128,000·8,192 token·tool 지원 가정을 허용할 것인가?
- lophn-agent/harness/model#Q3 첫 설치의 두 model slot을 어떤 목록·순서로 추천할 것인가?
- lophn-agent/harness/model#Q4 2,048·8,192·16,384·32,768 추론 예산이 품질 차이를 만드는가?
- lophn-agent/harness/model#Q5 강도·예산·토글을 함께 선언한 model의 추론 선택 우선순위는 무엇인가?
- lophn-agent/harness/model#Q6 첫 판 model input에 이미지를 포함할 것인가?
- lophn-agent/harness/model#Q7 정확한 token 계산을 local tokenizer·provider count API 중 무엇으로 제공할 것인가?
- lophn-agent/harness/model#Q8 Claude 계열을 기본 추천으로 유지할 것인가?
- lophn-agent/harness/model#Q9 한계를 모르는 model을 사용할 조건은 무엇인가?

## 버린 것

- 대체 model에 추론 수준을 자동 맞추는 동작 — 다른 model 자동 대체 자체가 없으므로 제거한다.
- slot별 자동 대체 model 목록 — 사람 선택을 다른 model 호출로 자동 바꾸지 않는다.
- credential 소진 뒤 다른 model로 자동 이동하는 동작 — credential 선택은 lophn-agent/harness/provider를 따르고 model 자동 대체만 제거한다.
- 자동 대체 model을 run 끝까지 유지하는 동작 — 다른 model 자동 대체가 없다.
- 원래 model과 대체 목록 전체를 순회하는 동작 — model 대체 목록은 없으며 선택 model 실패 이유를 남기고 organizing 일을 judgment로 올리지 않는 약속은 요구에 유지한다.
