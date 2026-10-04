---
type: requirements
concerns: [lophn-agent/harness/provider]
---
# lophn-agent/harness/provider

지원 provider와 인증, OAuth 로그인·갱신, 호출 형식과 응답 번역, credential 순서·이동 및 실패를 맡는다. secret 보관은 platform/secrets, model 목록·가격은 lophn-agent/harness/model, 비용 계산은 lophn-agent/harness/usage를 따른다.

## 요구

### 지원과 연결

**[R1]** 첫 판은 Anthropic·OpenAI·xAI·OpenRouter·Groq·DeepSeek·Google Gemini API key, ChatGPT·SuperGrok OAuth, Ollama·LM Studio·llama.cpp 로컬 연결을 지원 대상으로 삼되 OAuth는 lophn 이름의 사용 허용과 실제 텍스트·tool call이 확인된 경로만 활성화한다.
- 이유: Anthropic은 제3자 앱의 Claude.ai 로그인과 구독 credential 중개를 금지하므로 Claude 구독 지원을 가장하지 않고 API key로만 연결한다. 이미 가진 계정과 로컬 model을 쓰면서 검증되지 않은 구독 경로를 지원으로 가장하지 않는다.
- 확인: 이름을 적은 연결마다 텍스트와 tool call을 확인하고 미검증 OAuth는 비활성화하며 Claude 구독·Google 계정 OAuth·Vertex AI·AWS 인증을 지원으로 안내하지 않는다.
- 의도: lophn-agent/harness#I1

**[R2]** provider는 표시 이름·호출 목적지·호출 형식·지원 인증 방식·model 목록 조회 목적지를 정의하여 개수 상한 없이 추가하며 model catalog 정의보다 lophn 보정을, 그보다 사람 설정을 우선한다.
- 이유: 같은 형식의 새 제공처를 제품 코드 변경 없이 추가한다.
- 확인: 정의만으로 새 목적지를 추가하고 세 출처의 충돌에서 사람 설정이 이기는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R3]** 호출 형식은 Anthropic Messages·OpenAI Responses·OpenAI Chat Completions 세 가지뿐이며 Google Gemini는 OpenAI Chat Completions 호환 연결로 받고 Google 네이티브 형식은 받지 않는다.
- 이유: provider 차이를 통로에서 흡수하되 모르는 형식을 추측하지 않는다.
- 확인: 세 형식의 요청과 스트림을 테스트하고 Gemini·로컬 서버에는 Chat Completions 요청이 나가며 네 번째 형식은 거절되는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R4]** 미지원 형식·사람이 끈 provider·회수한 credential에는 새 호출을 보내지 않으며 연결 가능한 provider와 지금 쓸 credential이 있는 provider를 구별한다.
- 이유: 꺼진 연결이 다음 호출에서 다시 쓰이면 사람의 통제를 잃는다.
- 확인: 끄기·credential 없음·회수·미지원 형식 각각에서 상태 설명을 구별하고 다음 호출이 전송되지 않는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R5]** 인증은 API key·OAuth·인증 없음 세 종류이며 HTTP와 인증 없음은 127.0.0.1·::1·localhost에만 허용하고 다른 목적지는 HTTPS와 credential을 요구한다.
- 이유: 로컬 서버의 편의가 원격 비밀 노출로 번지지 않게 한다.
- 확인: LAN·공개 주소의 HTTP와 무인증, 로컬에서 원격으로 향하는 무인증 리다이렉트를 거절한다.
- 의도: lophn-agent/harness#I1

### credential 관리

**[R6]** credential 등록·교체·삭제·순서 변경과 OAuth 로그인 시작은 사람만 결정하고 갱신·사용 가능 상태의 영속 변경은 platform/ledger를 따르며 Claude Code·Codex·Gemini CLI의 로그인·keychain 항목·인증 조회를 가져오지 않는다.
- 이유: 다른 프로그램의 갱신 token 계열을 공유하지 않는다.
- 확인: 다른 프로그램 로그인으로 lophn이 로그인되지 않고 agent가 credential을 등록하거나 로그인시키지 못하며 상태 변경의 주체가 남는지 확인한다.
- 의도: lophn-agent/harness#I1, lophn-agent#I6

**[R7]** API key와 OAuth 접근·갱신 token의 보관과 전달은 platform/secrets를 따르며 평문 설정·환경 변수·세션·prompt·trace·오류에서 credential 값을 받아 인증하거나 노출하지 않는다.
- 이유: 인증의 비밀 입구를 하나로 제한한다.
- 확인: 환경 변수만 채운 경우 credential이 없고 평문 설정의 key가 거절되며 로그인·갱신·호출 실패 출력에 token 일부도 없는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R8]** 한 provider에 API key·OAuth credential 여러 개를 등록할 수 있으나 실제 호출 계정은 preset의 정확한 선택 목록과 사람 순서 안에서만 고르고 종류 우선·돌려 쓰기·최소 사용·무작위 선택은 하지 않는다.
- 이유: 돈과 계정 선택은 사람이 정한다.
- 확인: 같은 provider의 서로 다른 계정을 고른 preset 둘이 각 목록에서만 선택하고 다른 등록 계정은 자동 후보가 되지 않는지 본다.
- 의도: lophn-agent/harness#I1

**[R9]** credential은 사람의 이름표와 확인된 계정·조직·요금제로 구별하고 같은 provider의 같은 API key 또는 같은 계정·조직 OAuth 중복 등록은 거절하며 미확인 계정 정보는 추측하지 않는다.
- 이유: token 대신 실제 계정으로 구별하고 갱신 충돌을 막는다.
- 확인: 같은 key·계정·조직은 중복 등록되지 않고 같은 이메일의 다른 조직은 구별되는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R10]** run은 처음 선택한 credential을 유지하고 거절·사용량 대기·해당 model 불가 때도 preset이 명시한 같은 provider·model의 뒤 계정만 허용하며 목록이 하나이거나 모두 불가면 멈추고 다른 계정·provider·model로 자동 이동하지 않는다.
- 이유: cache 재사용을 지키면서 사람이 선택하지 않은 제공처에 내용을 보내지 않는다.
- 확인: 목록 하나의 계정이 막히면 다른 등록 계정으로 이동하지 않고 명시한 두 계정만 뒤로 이동하며 앞 계정 회복에 돌아가지 않는지 본다.
- 의도: lophn-agent/harness#I1

### OAuth 로그인

**[R12]** ChatGPT OAuth는 공식 Sign in with ChatGPT로 실제 lophn 앱 이름의 dynamic client 등록을 하고 발급된 client_id를 재사용하며, 사람이 시작한 browser와 127.0.0.1 loopback callback으로 진행하고 state·nonce와 S256 검증값이 일치하고 id_token 서명·issuer·audience·만료가 확인될 때만 완료한다.
- 이유: 다른 프로그램의 client와 backend-api를 가장하지 않고 발급된 client와 검증된 id_token으로 로그인 출처를 검증한다.
- 확인: 검증값 누락·불일치와 서명·issuer·audience·만료가 맞지 않는 id_token을 거절하고 발급된 client_id 밖의 client를 쓰지 않는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R13]** SuperGrok OAuth는 xAI OpenID Connect discovery로 확인한 x.ai 또는 그 하위 도메인의 HTTPS 인증 목적지에서 device code만 사용하고 신원·프로필·이메일·오프라인 갱신·Grok CLI 접근·API 접근 권한만 요청한다.
- 이유: discovery가 알려 준 목적지도 신뢰를 검증한다.
- 확인: HTTP·x.ai 밖의 목적지는 중단하고 callback 없이 사용자 코드 승인으로 로그인하며 요청 권한을 검사한다.
- 의도: lophn-agent/harness#I1

**[R14]** device code는 서버 간격·만료를 따르되 간격이 없으면 5초마다 조회하고 xAI 대기 연장마다 5초를 더하며 거절·만료·취소에 중단하고 ChatGPT는 최대 15분, xAI는 만료가 없으면 최대 5분까지만 기다린다.
- 이유: 무한 폴링과 서버 제한 위반을 막는다.
- 확인: 가짜 시계로 간격·대기 연장·각 종료 조건을 테스트하고 마감 뒤 token 등록이 없는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R15]** 로그인과 model call은 lophn 제품 이름으로 식별하며 Claude Code·Codex·Grok CLI 위장, 과금·요금제 우회를 위한 prompt·tool·model 이름 변경, coding agent CLI 경유 호출은 하지 않는다.
- 이유: 일시적 우회 성공보다 오래 쓸 수 있는 연결을 우선한다.
- 확인: API key·OAuth 사이에서 제품 지시와 tool 이름이 바뀌지 않고 거절 뒤 위장 재호출이나 CLI 실행이 없는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R16]** ChatGPT OAuth token은 데이터 거주 지역을 전달하고 서버 저장을 요청하지 않는 공개 `api.openai.com/v1/responses`·`store=false`·`stream=true`에만 보내며 SuperGrok OAuth token은 xAI API에만 보낸다. 목적지 변경·리다이렉트로 다른 곳에 보내지 않고 backend-api는 쓰지 않는다.
- 이유: 구독 token을 사용자 gateway나 검증되지 않은 backend에 노출하지 않는다.
- 확인: API key gateway에는 OAuth token이 가지 않고 ChatGPT 요청의 거주 지역·`store=false`·`stream=true`를 확인하며 backend-api 요청이 없는지 확인한다.
- 의도: lophn-agent/harness#I1

### OAuth 갱신

**[R17]** OAuth는 만료 60초 전부터 한 machine 경계에서 credential별로 잠근 뒤 secret을 다시 읽고 필요한 경우에만 최대 15초 갱신하며 새 token 보관 성공 뒤 잠금을 풀고 사용하고 새 갱신 token이 없으면 이전 것을 유지한다.
- 이유: 회전 token의 동시 갱신과 저장 전 사용을 막는다.
- 확인: 동시 호출에서 갱신 요청이 하나이고 저장 실패 때 새 token 호출이 없으며 취소 후 재시도도 저장 token을 재확인하는지 테스트한다.
- 의도: lophn-agent/harness#I1

**[R18]** OAuth 401은 갱신 한 번과 동일 요청 재전송 한 번으로만 복구하며 재차 401·갱신 권한 폐기·만료·재사용·계정 불일치와 API key 인증 거절은 사람의 교체나 재로그인 전까지 다시 쓰지 않는다.
- 이유: 시간으로 고칠 수 없는 인증을 반복하지 않는다.
- 확인: 갱신 1회·재전송 1회를 넘지 않고 재시작·시간 경과에도 폐기 인증이 살아나지 않으며 다른 credential은 쓰이는지 확인한다.
- 의도: lophn-agent/harness#I1, lophn-agent/harness#I2

### 실패와 사용량 대기

**[R19]** provider는 일시 실패·credential 사용 불가·model 사용 불가·문맥 초과·잘못된 요청·원인 불명을 구별하여 전달하고 원인 불명을 인증 실패로 추측하거나 오류 본문을 보존하지 않는다.
- 이유: 통로의 오류를 인증 교체나 model 변경으로 숨기지 않는다.
- 확인: 같은 HTTP 상태의 서로 다른 오류 코드를 구별하고 뜻을 모르는 응답은 원인 불명으로 남기는지 확인한다.
- 의도: lophn-agent/harness#I1, lophn-agent/harness#I2

**[R20]** 연결 실패·스트림 중단·HTTP 500·502·503·529와 재시도 시각이 30초 이내로 확인된 429는 일시 실패로 분류하여 서버 재시도 지시·리셋 시각을 lophn-agent/harness/run-loop에 전달하고 SDK의 숨은 retry는 하지 않는다.
- 이유: retry의 주인과 총 시도 수를 한 곳에 둔다.
- 확인: 429의 30초·31초 경계와 스트림 단절을 테스트하고 provider 안에서 숨은 재전송이 없는지 확인한다.
- 의도: lophn-agent/harness#I1, lophn-agent/harness#I2

**[R21]** 모델 전용 제한을 제외한 인증 거절·잔액 없음·지출 한도·소진과 30초 초과 또는 시각 미상 429는 credential 사용 불가로 분류하되 사용량 제한과 확인된 SuperGrok 요금제 접근 거절 403을 인증 폐기와 구별한다.
- 이유: 요금제 문제를 재로그인으로 해결하라고 시키지 않는다.
- 확인: 소진 계정은 리셋 뒤 다시 후보가 되고 폐기 인증은 그렇지 않으며 SuperGrok 요금제 거절은 API key·지원 요금제로 안내하는지 확인한다.
- 의도: lophn-agent/harness#I1, lophn-agent/harness#I2

**[R22]** model 없음·폐기·계정의 model 접근 제한은 해당 credential과 model 조합만 막고 같은 credential의 다른 model 사용 가능 상태는 바꾸지 않는다.
- 이유: 정상 계정 전체를 버리지 않는다.
- 확인: 한 model의 404·전용 제한 후 다른 model의 사용 가능 상태가 유지되는지 확인한다.
- 의도: lophn-agent/harness#I1, lophn-agent/harness#I2

**[R23]** 문맥 초과는 lophn-agent/harness/prompt-assemble에 전달하고 사람 취소·model 응답 거절은 각각 구별하여 run에 전달하며 credential을 막거나 다른 계정으로 같은 내용을 우회 전송하지 않는다.
- 이유: 내용 문제와 인증 문제를 섞지 않는다.
- 확인: 큰 입력·취소·내용 거절 후 credential 순서와 사용 가능 상태가 바뀌지 않는지 확인한다.
- 의도: lophn-agent/harness#I1, lophn-agent/harness#I2

**[R24]** 사용량 대기는 서버 리셋 시각까지 유지하고 시각을 모르면 1시간으로 정하며 그 전에는 유일한 credential이어도 test call을 보내지 않고 model 전용 대기는 그 model에만 적용한다.
- 이유: 확정된 장기 제한을 test call로 무시하지 않는다.
- 확인: 일주일 리셋을 재시작으로 앞당기지 않고 시각 미상 제한은 1시간 뒤 후보가 되는지 확인한다.
- 의도: lophn-agent/harness#I1, lophn-agent/harness#I2

### 응답과 cache

**[R25]** 세 형식의 스트림은 텍스트·tool call·종료 이유·보고된 사용량으로 번역하면서 tool 이름·인자·대응·순서를 보존하고 추론 본문은 제외하되 필수 opaque 추론 상태만 같은 run·같은 provider·같은 model 메모리에서 재사용하여 끝날 때 버린다.
- 이유: 조각난 tool 응답을 정확히 잇되 내부 추론을 영속 이력으로 만들지 않는다.
- 확인: 병렬 tool과 조각난 JSON의 대응을 확인하고 opaque 상태는 같은 run에서만 전송되며 blob·trace·종료 후 메모리에 없는지 확인한다.
- 의도: lophn-agent/harness#I1, lophn-agent/harness#I2

**[R26]** lophn-agent/harness/prompt-assemble의 cache 경계는 Anthropic Messages의 5분 cache로 번역하고 Responses·Chat Completions는 자동 cache에 맡기며 cache 미지원은 실패로 취급하지 않는다.
- 이유: cache 내용과 전송 방식을 분리한다.
- 확인: Anthropic 요청에만 5분 표시가 있고 cache 미지원 서버도 cache 없이 성공하는지 확인한다.
- 의도: lophn-agent/harness#I3

### 과금과 첫 준비

**[R27]** provider는 선택 계정과 API 과금·구독 한도를 구별하여 API key는 API 과금, ChatGPT·SuperGrok OAuth는 구독으로 전달하며 확정되지 않은 청구액은 모름으로 남긴다.
- 이유: API 가격 곱셈을 구독 실제 청구액으로 오해하지 않게 한다.
- 확인: 같은 OpenAI model의 key·ChatGPT 호출 경로가 구별되고 비용 계산은 lophn-agent/harness/usage에서 확인한다.
- 의도: lophn-agent/harness#I3

**[R28]** 첫 설치는 provider 로그인·API key 등록 또는 무인증 loopback 연결 뒤 preset의 provider 계정·model을 준비해야 그 구성이 일할 수 있고 공통 기본값 선택은 선택 사항이며 미준비 preset은 비활성으로 남는다.
- 이유: 인증과 model이 준비되지 않은 첫 요청이 조용히 실패하지 않게 한다.
- 확인: 공통 기본값 없이 직접 준비한 preset은 시작되고 미준비 preset만 막히며 무인증 local 선택도 허용되는지 본다.
- 의도: lophn-agent/harness#I1

### 연결 확인

**[R29]** 사람은 provider 목적지·사용 여부를 확인하고 별도의 test 재료로 텍스트·tool call 연결 테스트를 명시적으로 요청할 수 있으며 설정 조회만으로 테스트하거나 세션·문서를 test 재료로 보내지 않는다.
- 이유: 연결 확인 때문에 사적인 실제 자료가 전송되지 않게 한다.
- 확인: 설정 조회에는 model call이 없고 명시 테스트의 목적지·credential·텍스트·tool 지원·실패 분류가 보이는지 확인한다.
- 의도: lophn-agent/harness#I1

**[R30]** 명시 연결 테스트는 한 시도 최대 30초에 끝내고 실제 전송 시도의 사용량·비용을 lophn-agent/harness/usage에 남기며 사용량 대기 credential은 test하지 않는다.
- 이유: 연결 확인이 끝없이 대기하거나 숨은 지출이 되지 않는다.
- 확인: 무응답 test가 30초 안에 끝나고 유료 test의 실제 시도와 알려진 사용량이 기록되는지 확인한다.
- 의도: lophn-agent/harness#I3, lophn-agent/harness#I2

## 버린 것

없음.
