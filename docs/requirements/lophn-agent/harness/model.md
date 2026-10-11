---
type: requirements
concerns: [lophn-agent/harness/model]
---
# lophn-agent/harness/model

model catalog(model과 그 option 축)·한계·가격 검증, role별 기본 model과 요약용 model, 즐겨찾기, 고른 model·option 값의 검증을 맡는다. 기본값이 agent 정의·project·Operator·session 층에서 어떻게 겹치고 값의 출처가 어떻게 보이는지는 lophn-agent/agents, 그 session만 바꾼 선택의 저장은 lophn-agent/conversation, 역할의 호출 용도는 lophn-agent/roles, 비용은 lophn-agent/harness/usage다. 계정과 인증은 lophn-agent/harness/provider가 맡고 model은 거기서 고르지 않는다.

## 요구

### catalog

**[R1]** model은 provider와 그 provider가 받는 model 이름의 쌍으로 구별하여 직접 제공처와 중계 제공처의 문맥 한계·option 축·사용 가능 상태를 공유하지 않는다.
- 이유: 같은 이름도 제공처마다 계약이 다르다.
- 확인: 같은 model 이름의 직접·중계 연결에 서로 다른 한계가 유지되는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R2]** catalog는 전체 문맥·입력·출력 한계, tool call 지원, 입력·출력 매체, option 축(effort·speed 등)과 각 축의 값·기본값, preview·폐기 예정 여부를 model 선택과 prompt 조립에 제공한다.
- 이유: 호출 가능한 model을 이름만으로 판단하지 않는다.
- 확인: 선택 화면과 조립 검사가 각 정보의 확인값·미확인 상태를 구별하는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R3]** catalog는 models.dev release snapshot→새 정상 갱신본→lophn의 좁은 보정→사람 보완 순으로 겹쳐 명시한 부분만 덮으며 사실과 보완의 출처를 구별한다.
- 이유: 보정이 정상 정보를 통째로 없애지 않는다.
- 확인: 출력 한계만 보완했을 때 다른 한계·가격과 각 출처가 유지되는지 확인한다.
- 의도: lophn-agent/harness#I3

**[R4]** model 목록·가격·provider 정의는 models.dev 응답 한 번으로 공유하고 마지막 확인 뒤 24시간이 지나면 시작 시와 run 중 비동기로 갱신하며 ETag 조건부 GET과 사람의 즉시 새로 받기를 지원한다.
- 이유: 중복 다운로드와 호출 경로의 대기를 막는다.
- 확인: 하나의 갱신 요청으로 세 자료가 갱신되고 24시간 전 자동 요청은 없으며 사람 요청은 즉시 나가는지 확인한다.
- 의도: lophn-agent/harness#I3

**[R5]** 빈 목록·해석 실패·양의 정수가 아닌 token 한계와 음수·무한대·잘못된 단위·중복 또는 잘못된 문맥 가격 경계는 갱신 전체를 거절하고 마지막 정상본·확인 시각을 보존하며 정상본이 없으면 release snapshot을 쓴다.
- 이유: 깨진 외부 자료로 정상 설정을 덮지 않는다.
- 확인: 각 잘못된 응답·네트워크 실패에서 이전 값·정상 수신 시각과 실패 표시가 유지되는지 확인한다.
- 의도: lophn-agent/harness#I3

**[R6]** catalog 갱신은 세션·key·token·model 선택·계정 정보를 싣지 않는 공개 GET만 보내고 사람이 자동 갱신을 끄면 마지막 정상본 또는 release snapshot만 사용한다.
- 이유: 공개 목록 수집에 개인 정보를 보낼 이유가 없다.
- 확인: 갱신 요청 내용을 검사하고 자동 갱신을 끈 뒤 네트워크 조회가 없는지 확인한다.
- 의도: lophn-agent/harness#I3

### 가격

**[R7]** 가격은 provider·model별 출처·확인 시각과 미국 달러 기준 100만 token당 입력·출력·cache 읽기·cache 쓰기·별도 추론 요율 및 문맥 크기 경계를 보존하고 누락 요율은 무료가 아닌 모름으로 제공한다.
- 이유: 동일 이름의 다른 제공처 가격과 부분 가격을 잃지 않는다.
- 확인: 0달러·누락·부분 가격을 구별하고 구간 경계 전후 요율이 lophn-agent/harness/usage에 전달되는지 확인한다.
- 의도: lophn-agent/harness#I3

### 기본 model

**[R8]** 기본 model은 lophn·Context Engineer·App Engineer·Operator 네 role마다 하나씩 model과 option 값을 Workspace에 두고, 제목·요약·압축에 쓰는 model은 Workspace 전역의 "Model for summaries" 한 칸으로 두며 그 칸이 비어 있으면 그 run의 agent model로 한다.
- 이유: model은 provider가 아니라 agent가 고르고, 일을 판단하는 model과 제목·요약·압축 model이라는 기존 두 용도는 유지한다.
- 확인: 한 role의 기본값을 바꾸어도 다른 role의 값은 그대로이고, 요약용 칸이 비면 요약이 그 run의 agent model로, 채우면 모든 role의 요약이 그 model로 도는지 본다.
- 의도: lophn-agent/harness#I1, lophn-agent#I5

**[R9]** 처음 설치한 기본 model은 모두 비어 있고 어느 층에서도 model이 정해지지 않았거나 그 provider에 쓸 수 있는 계정이 없는 agent는 일을 시작하지 않으며, 기본값의 변경은 다음 run부터 적용되고 진행 중인 run과 이어 하기의 고정 값은 바꾸지 않는다.
- 이유: 인증·model 준비가 없는 구성을 조용히 시작하지 않고, 도는 도중에 model이 바뀌어 비용과 행동이 달라지지 않게 한다.
- 확인: 기본값이 빈 role은 이유와 함께 막히고 다른 role은 시작되며, 기본값을 바꾼 뒤 진행 중 run은 그대로 끝나고 다음 run이 새 값을 쓰는지 본다.
- 의도: lophn-agent/harness#I1, lophn-agent#I5

**[R10]** model 이름 저장은 기본값·agent 정의·session 선택 어디서든 provider의 현재 목록에 없으면 거절하고 목록을 확인하지 못하면 미확인으로 저장하되 첫 성공 호출에서 그 표시를 해제한다.
- 이유: 목록 조회 실패와 명백히 잘못된 이름을 구별한다.
- 확인: 목록 밖 이름 거절·목록 미조회 저장·첫 성공 뒤 확인 표시를 테스트한다.
- 의도: lophn-agent/harness#I1, lophn-agent#I5

### 호출 한계

**[R11]** 선택은 알려진 텍스트 입력·출력 또는 필요한 tool call 미지원 model을 거절하고 호출 전 입력·예약 출력·전체 문맥 한계를 하나라도 넘으면 전송하지 않는다.
- 이유: provider에 보내기 전에 확정된 한계를 지킨다.
- 확인: 각 한계 바로 아래·같음·초과 요청에서 초과만 전송하지 않는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R12]** catalog 누락·폐기 예정은 저장된 선택(기본값·agent 정의·session 선택·즐겨찾기)을 지우거나 이름을 바꾸지 않고 표시하며 provider가 사용 불가를 판정해도 다른 model로 자동 대체하지 않는다.
- 이유: 외부 catalog 변경으로 사람 선택을 바꾸지 않는다.
- 확인: 누락·폐기·사용 불가 후 기존 선택과 실패 이유가 남고 다른 model 요청은 없는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R13]** catalog 밖 model은 확인된 정보 또는 사람이 명시한 양의 입력·출력·전체 문맥 한계와 text·tool 지원 정보가 있어야 사용할 수 있고 128,000·8,192 token 또는 tool 지원을 임의로 가정하지 않는다.
- 이유: 큰 기본 한계로 미확인 model을 사용 가능하게 만들지 않는다.
- 확인: 한계·tool 지원 미상 model은 호출되지 않고 명시 보완이 catalog 사실과 구별되는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R14]** 정확한 model별 token 계산이 없으면 텍스트 UTF-8 byte 수를 보수적 token 상한으로 쓰고 비텍스트 크기를 모르면 호출하지 않으며 한글·이미지·큰 결과를 0 token이나 4글자당 1 token으로 추측하지 않는다.
- 이유: 한글과 첨부가 작은 입력으로 잘못 계산되지 않게 한다.
- 확인: 한글·큰 MCP 결과·크기 미상 이미지에서 보수 상한 또는 호출 중단을 확인하고 전체 크기 적용은 lophn-agent/harness/prompt-assemble에서 확인한다.
- 의도: lophn-agent/harness#I3

### effort

**[R15]** effort 축의 값은 끔·최소·낮음·중간·높음·매우 높음·최대 순서의 이름 가운데 그 model이 지원하는 것과 순서 밖의 모델에 맡김으로 제공하되 화면에는 Off·Minimal·Low·Medium·High·XHigh·Max로 보이고 문구는 shell/wording에 따라 영어 message key로 제공한다.
- 이유: provider별 이름 차이를 사람에게 공통 선택으로 보이고, 매우 높음·최대를 사람이 아는 XHigh·Max로 쓴다.
- 확인: 지원하는 값만 순서대로 표시되고 매우 높음이 XHigh로, 최대가 Max로 보이며 미지원 값은 선택되지 않는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R16]** option 축은 catalog에 선언된 값만 제공하고 기본값 이름·빈 값은 값으로 취급하지 않으며 모델에 맡김은 catalog가 확인한 그 축의 기본값이 있으면 그 값을, 없으면 그 축의 요청 필드를 보내지 않는다.
- 이유: 기본값을 실제 값처럼 전송하거나 모르는 값을 추측해 보내지 않는다.
- 확인: 선언된 값만 표시되고 맡김·기본값 미상 요청에는 그 축의 필드가 없는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R17]** token 예산을 쓰는 effort 값은 낮음 2,048·중간 8,192·높음 16,384·최대 32,768 token을 확인된 양의 최소·최대 안으로 제한하고 켜고 끄기만 받는 model의 effort 값은 끔·높음 둘뿐이다.
- 이유: 추론 예산을 결정 가능한 수치로 고정한다.
- 확인: 작은 최소·최대에서 각 예산이 범위를 넘지 않고 켜고 끄기만 받는 model에는 두 선택만 보이는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R18]** run은 시작한 model과 option 값을 끝까지 유지하고 개별 요청은 그 run에 고정된 effort보다 높은 값을 요청하지 못한다.
- 이유: 현재 run의 비용·행동 조건을 설정 변경으로 바꾸지 않는다.
- 확인: 진행 중 기본값·session 선택 변경과 더 높은 요청에도 시작 값이 유지되는지 확인한다.
- 의도: lophn-agent/harness#I1

### 호출 범위

**[R19]** 첫 판 model call은 텍스트 입력·출력만 사용하며 이미지·PDF·음성·영상의 원본은 매체 지원과 크기 계약이 완성되기 전 입력에 넣지 않는다.
- 이유: 미확인 첨부 크기로 한계를 우회하지 않는다.
- 확인: 원본 첨부 없이 범위가 확인된 추출 텍스트만 입력되는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R20]** 선택 model을 사용할 수 없으면 그 이유와 더 호출하지 않았다는 사실을 남기고 요약용 model을 따로 골랐다면 그 실패를 agent model로 바꿔 처리하지 않는다. 요약용 칸이 비어 agent model을 쓰는 것은 구성 resolve이지 실패 뒤 fallback이 아니다.
- 이유: 실패를 더 큰 model이나 다른 용도 호출로 숨기지 않는다.
- 확인: 선택 model 실패 후 다른 구성 선택·model 호출 없이 이유가 보이는지 확인한다.
- 의도: lophn-agent/harness#I1

### option 선언과 고르기

**[R21]** catalog는 model마다 option 축(effort·speed 등)을 축 이름·표시 이름·값(값·표시 이름·요청에 싣는 방법)으로 선언하는 데이터로 제공하고, 선택 화면은 고른 model이 가진 축만 보이며 어떤 model에 어떤 축과 값이 있는지를 코드에 적지 않는다.
- 이유: effort 값은 model마다 다르고 effort 밖의 option도 있어, 목록을 코드에 두면 model이 나올 때마다 코드를 고쳐야 한다.
- 확인: catalog 자료만 바꿔 model에 축·값을 더하고 빼면 코드 변경 없이 선택 화면이 바뀌고, effort가 없는 model에는 effort 줄이 없는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R22]** option 값이 요청에 실리는 방법은 요청 body에 더할 조각 하나이거나 보낼 model id를 다른 id로 바꾸는 것 둘뿐이며, OpenAI의 priority service tier 요청과 xAI Grok의 별도 fast model id처럼 서로 다른 방법도 사람에게는 같은 Speed 축의 Fast 값으로 보인다.
- 이유: 사람이 고르는 것은 "빠르게"이지 provider마다 다른 요청 모양이 아니다.
- 확인: OpenAI model의 Speed Priority는 요청 body에 priority service tier 조각이 더해지고 Grok의 Speed Fast는 보내는 model id가 fast 판으로 바뀌며, 두 값이 같은 축 이름으로 표시되는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R23]** option 값을 요청 필드로 옮기는 코드는 호출 형식(Anthropic Messages·OpenAI Responses·OpenAI Chat Completions)마다 표 하나뿐이고 model id로 갈라지는 분기를 두지 않는다.
- 이유: model이 늘 때마다 분기가 쌓이는 것을 막는다(OpenCode·Hermes의 model id 문자열 분기가 겪은 문제).
- 확인: 새 model을 catalog 자료만으로 추가해 호출이 되고, 호출 형식 표 밖에 model 이름을 비교하는 코드가 없는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R24]** 선택한 model이 지원하지 않는 option 값은 호출 전에 실패로 보이고 다른 값으로 조용히 바꾸지 않는다.
- 이유: 사람이 고른 비용·속도 조건을 모르는 사이에 낮추거나 높이지 않는다.
- 확인: 없는 축·값을 저장하거나 호출하려 하면 이유와 함께 거절되고 요청이 나가지 않는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R25]** model을 바꾸어 지금 option 값이 그 model에 없으면 같은 축에서 그보다 약하면서 가장 가까운 지원 값으로 맞추고(없으면 그 축의 가장 약한 지원 값, 끔은 맞춤 대상으로 삼지 않는다) 맞춘 사실을 한 줄로 알린다.
- 이유: model을 바꿀 때마다 값을 다시 고르게 하지 않으면서, 비용을 올리는 쪽으로는 맞추지 않는다.
- 확인: XHigh를 가진 model에서 지원하지 않는 model로 바꾸면 High로 맞춰지고 알림이 뜨며, 새 model에 없는 축의 값은 버려지고 같은 축이 있으면 유지되는지 확인한다.
- 의도: lophn-agent/harness#I1

### 즐겨찾기와 session 선택

**[R26]** 즐겨찾기는 Workspace에 순서 있는 목록으로 두고 선택 화면 맨 위에 별표를 찍은 순서 그대로 보이며 검색 중에도 즐겨찾기가 먼저이고 provider로 다시 묶지 않으며 최근 사용 묶음은 두지 않는다.
- 이유: 별표 model이 제자리에 그대로 있으면 즐겨찾기의 쓸모가 없다.
- 확인: 별표를 찍은 순서가 맨 위에 그대로 유지되고, 검색어를 넣어도 일치하는 즐겨찾기가 일치하는 다른 model보다 앞에 오며, provider가 다른 즐겨찾기가 섞여도 순서가 깨지지 않는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R27]** composer에서 고른 model과 option 값은 그 session의 다음 run부터만 적용하고 진행 중인 run과 agent 정의·기본값은 바꾸지 않는다.
- 이유: 대화 한 번의 선택이 agent의 설정이나 다른 session으로 번지지 않는다.
- 확인: session에서 model을 바꾼 뒤 같은 agent의 다른 session과 기본값이 그대로이고 진행 중 run이 이전 값으로 끝나는지 확인한다.
- 의도: lophn-agent/harness#I1, lophn-agent#I5

## 버린 것

- 새 preset에 복사하는 공통 기본값(judgment·organizing 두 칸)과 "기존 preset·assignment에는 기본값 변경을 적용하지 않는다" — preset이 없고 role별 기본값이 층을 따라 내려가므로 R8·R9로 바꾼다.
- 선택은 preset이 정하고 기본값은 복사용일 뿐이라는 규칙 — 선택은 agent 정의·기본값·session override이며 층의 겹침은 lophn-agent/agents가 맡는다.
- 추론 조절 방식(이름 수준·token 예산·켜고 끄기) 선언과 일곱 수준 고정 목록 — effort 축의 값으로 catalog가 model마다 선언한다(R15~R17).
- 대체 model에 추론 수준을 자동 맞추는 동작 — 다른 model 자동 대체 자체가 없다. 사람이 model을 바꿀 때 맞추는 R25와는 다르다.
- 용도별 자동 대체 model 목록 — 사람 선택을 다른 model 호출로 자동 바꾸지 않는다.
- credential 소진 뒤 다른 model로 자동 이동하는 동작 — credential 선택은 lophn-agent/harness/provider를 따르고 model 자동 대체만 제거한다.
- 자동 대체 model을 run 끝까지 유지하는 동작 — 다른 model 자동 대체가 없다.
- 원래 model과 대체 목록 전체를 순회하는 동작 — model 대체 목록은 없으며 선택 model 실패 이유를 남기고 요약 일을 judgment로 올리지 않는 약속은 R20에 유지한다.
