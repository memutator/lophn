# pm-custom-list

custom provider가 `GET {endpoint}/models`로 알려 주는 model 목록을 읽어 `credential.reported_models`에 저장한다. 읽는 때는 provider를 붙인 직후와 사람이 `RefreshProviderModels`를 부를 때다. 읽기가 실패하면 앞 목록을 그대로 둔다. ChatGPT 계정 목록과 같은 칸, 같은 길(발급자 요청 대기열)이다.

**먼저 지금 코드를 다시 읽는다**: 계획 `ui-fixes`와 이 계획의 앞 wave(`pm-reported-models`)가 main에 들어온 뒤의 `packages/core/lophn-agent/providers/**`, `packages/core/main/daemon/wiring/{lophn-agent,lophn-agent-runtime}.ts`를 읽고 시작한다.

- 단위: pm-core (wave 2)
- 선행: pm-reported-models
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/providers/**`
  - `packages/core/main/daemon/wiring/lophn-agent.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`(provider secret은 endpoint origin과 같은 목적지로만 간다, 구독 provider 로그인, 발급자 대기열)
  - 본보기: `providers/login.ts`(`withProviderLogin`: writer queue 앞에서 명령을 가로채고 연결 뒤 뒤에서 목록을 읽는다), `providers/oauth-refresh.ts`(`readModelsLater`)와 그 test의 "앞서 저장한 목록을 남긴다" 사례, `core/lophn-agent/issuer-requests.ts`(8초 기한, `issuerUrlAllowed`는 https와 loopback http만 받는다), `core/main/agent-runtime/issuer-pump.ts`
  - README: `project-docs/plan/provider-model/README.md`의 "정한 것"(provider가 알려 주는 model 목록)
- 계약:
  - 쓰는 것: `RefreshProviderModels`, `RecordProviderModels`, `connectProvider`, `providerRead`(`packages/protocol/lophn-agent/providers.ts`), `ProviderCredential.reported_models`
  - 내놓는 것: 없음(route 모양은 `pm-reported-models`가 정했다. 바꿔야 하면 고치지 말고 요청으로 적는다)

## 정해진 것

- 읽는 주소: custom provider의 `provider.endpoint`에서 끝의 `/`를 뗀 뒤 `/models`를 붙인다. 정의의 `models_endpoint`를 쓰지 않는다: 그 칸은 https여야 해서(`definitionShape`) 이 컴퓨터의 http 주소(local server)를 담을 수 없고, README는 "local http 주소도 같다"고 정했다. ChatGPT는 지금처럼 정의의 `models_endpoint`다.
- 읽는 대상: 정의가 내장이 아니고(`builtinProviderDefinition(definition.key)`가 실패) `definition.oauth === null`인 provider뿐이다. 내장 API key provider(Anthropic, OpenAI, …)는 읽지 않는다: `/models`에 embedding 같은 model이 섞여 있어 고를 목록을 망친다. `RefreshProviderModels`가 내장 provider에 오면 `invalid_input`.
- 인증: `auth_kind`가 `api_key`면 `provider.<id>` secret을 `Bearer`로 붙인다(secret 이름은 `providerSecretName`). 값은 요청 header에만 두고 오류, log, 결과에 싣지 않는다. 요청 URL의 origin이 `provider.endpoint`의 origin과 같음을 확인한 뒤에만 key를 붙인다(`architecture`의 "endpoint origin과 목적지가 같을 때만"). `none`이면 header 없이 보낸다.
- 응답: OpenAI 호환 `{ "data": [{ "id": "..." }] }`. 파싱은 `reported-models.ts`의 기존 함수를 쓴다(보이는 id가 하나도 없으면 null). `RecordProviderModels`는 최대 2000개라 넘치면 정렬한 앞 2000개를 저장하되 그 사실을 보고한다.
- 실패(기한, runtime 없음, 200이 아님, 큰 body, 파싱 실패)는 모두 읽기 null이고 저장하지 않는다. 저장된 앞 목록은 그대로다. `RefreshProviderModels`는 실패 때 `unavailable`을 돌려주고(화면이 알린다), 성공하면 갱신한 provider를 돌려준다.
- 연결 직후 읽기: 연결이 성공한 뒤 뒤에서 읽는다(연결 결과를 기다리게 하지 않는다). 새 provider의 주소가 `--allow-net`에 아직 없으면 runtime이 다시 뜨는 동안 첫 읽기가 실패할 수 있다(ChatGPT 길의 주석과 같은 경주). `lophn-agent-runtime.ts`의 `readProviders`와 `run-loop/runtime.ts`를 보고 실제로 그런지 확인한다. 그렇다면 한 번만 조금 뒤에 다시 읽게 하고(대기 시간은 인자로 받는다) 그래도 실패하면 사람의 refresh에 맡긴다. 그렇지 않으면 다시 읽기를 만들지 않는다.
- `RefreshProviderModels`의 처리기: login처럼 writer queue 앞에서 도는 async 처리기다(ledger transaction 안에서 network를 기다리지 않는다). 그 provider의 record(endpoint, 인증 종류, revision)를 읽을 길이 build 시점에 없으면 supervision wiring처럼 호출 때 읽는 늦은 연결을 쓴다. 새 read route를 만들지 않는다. 길이 없으면 고치지 말고 보고한다.

## 할 일

1. `reported-models.ts`: `readReportedModels`가 `access: string | null`을 받게 한다(null이면 authorization header 없음). custom 주소를 만드는 함수 `reportedModelsEndpoint(provider)`를 provider record를 받는 꼴로 넓힌다(ChatGPT는 정의 칸, custom은 위 규칙, 그 밖은 null).
2. 새 파일 `providers/model-list.ts`: 위 처리기(`RefreshProviderModels`를 가로채고, 성공한 `ConnectProvider` 뒤 읽기를 건다). 인자: `http`(`IssuerFetch`), `secrets`, `readProvider`, `newKey`, 대기 인자. 쓰기는 사람의 context 그대로 `RecordProviderModels`를 `compare: { revision }`으로 부른다.
3. `wiring/lophn-agent.ts`: login 처리기 뒤에 이 처리기를 writer 사슬로 끼운다(같은 `requests.fetch`와 `ctx.secretStore`).
4. login.ts의 ChatGPT 읽기와 새 길이 같은 helper를 쓰게 맞춘다. 중복 구현을 만들지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test 하나(`model-list_test.ts` 또는 `reported-models_test.ts`): "custom provider의 목록 읽기가 실패(200이 아님, 던짐, 파싱 실패)해도 앞서 저장된 `reported_models`가 그대로이고, 성공하면 새 목록으로 바뀐다." `oauth-refresh_test.ts`의 준비 방식을 본받는다. key가 요청 header에만 간다는 것은 같은 test에서 header를 보고 한 줄로 단정해도 된다.
- 손 확인: core를 띄워(`AGENTS.md`의 worker 규칙대로 `LOPHN_HOME`은 worktree의 `.dev-data/<id>`) fake 서버를 custom provider로 붙이고 `RefreshProviderModels`를 부르면 `reported_models`가 채워진다. 실제 model provider를 부르지 않는다.
- 남지 않음: `grep -rn "account-models\|AccountModels" packages --include=*.ts --include=*.tsx`가 0줄이다.

## 보고

- 바꾼 file, 통과한 check
- 등록할 것: 없음이 기본이다. lead가 문서에 올릴 것: `RefreshProviderModels` 동작(연결 직후와 사람의 요청으로 `GET {endpoint}/models`, 실패하면 앞 목록 유지, 내장 provider는 `invalid_input`)
- 고른 처리기 연결 방식과 이유, 연결 직후 읽기의 경주가 실제로 있었는지
- 정한 것 / 넘길 줄 / 계약 바꾸기 요청
- **무겁게 짠 것** / **알려진 미완 동작**: 없으면 "없음"
