# model 정보: custom model도 catalog 모양으로 적는다

상태: 로드맵. 아직 계획으로 열지 않았다. 2026-10-18 planner와 사람이 정했다.
배경 문서: `project-docs/architecture/agent-definition.md`(catalog, Manage models, 목록 밖 model), AGENTS.md "속도"·"호환성".
조사 자료(지금 코드, opencode·omp·hermes 소스)는 이 roadmap을 쓴 session의 scratchpad에만 있다. 아래에 필요한 사실을 path와 숫자로 옮겨 두었다.

## 왜

- custom provider(hive, b.ai 같은 OpenAI chat-completions 호환 endpoint)의 model은 이름 문자열뿐이다(`credential.reported_models`, `packages/protocol/lophn-agent/provider-values.ts`). catalog 항목이 없으니 core는 자리표시 항목(`unlistedEntry`, `packages/core/lophn-agent/models/resolve.ts`)으로 돈다.
  - effort를 고를 수 없다. `options`가 null이라 picker에는 "No options for this model."이 뜨고, 값을 보내면 `resolveSelection`이 `invalid_input`으로 거절한다.
  - context는 131072로, 입력은 text로만 고정된다. hive의 deepseek-v4.1-flash는 1,000,000 context에 image 입력을 받는데, lophn에서는 compaction이 너무 일찍 돌고 image를 보내지 못한다.
  - 가격이 없어 비용이 늘 `unknown`이다.
- 사람은 같은 model을 opencode에서는 effort max로, omp에서는 high로 쓰고 있다. lophn에서만 provider 기본값으로 돈다.
- catalog 항목의 모양(`CatalogEntry`, `packages/protocol/lophn-agent/models.ts:179-204`)에는 필요한 칸이 이미 다 있다. 한도 넷, `input_media`/`output_media`, effort 축(`options`), cache read·write를 따로 둔 USD 가격(`price_basis.rates[]`), 사람이 적은 항목을 뜻하는 `source: "user"`다. 사람이 이 모양대로 적을 길만 없다.

## 지금 코드

- **catalog 층.** 층은 `release_snapshot < models_dev < lophn_patch < user` 순서로 합친다(`LAYER_ORDER`, `packages/core/lophn-agent/models/model.ts:15`). user 층은 합치는 코드만 있고 저장하는 곳이 없다. 메모리 자리표시 둘(`unlistedEntry`, `selection.ts`의 `EXPLICIT_ENTRY`)만 `source: "user"`를 쓴다.
  - 합친 catalog는 `<dataRoot>/derived/lophn-agent/catalog.json`이다. 파일이 없거나 깨지면 동봉 snapshot(510항목)으로 다시 만든다.
- **effort 축.** 이름 7개(off, minimal, low, medium, high, very_high, maximum)로 고정되어 있고 label도 고정이다(`packages/protocol/lophn-agent/option-axes.ts`). 축 값의 `wire`는 null이고, 요청에 싣는 말은 `models/wire.ts`의 protocol별 표가 정한다.
  - chat-completions는 `reasoning_effort`, Responses는 `reasoning.effort`다. 둘은 같은 표 `REASONING_EFFORT_NAMES`를 쓰는데 이 표에 `maximum`이 없다. 그래서 max를 고르면 `invalid_input`이다.
- **catalog를 읽는 곳 셋.**
  - 화면: `ReadModelCatalog`(400개씩 page). renderer는 `entryOf`(`packages/shell/renderer/workspace/agents/model-picker-data.ts`)로 항목을 찾아 축을 보인다.
  - turn: `createModelResolver`의 `catalog()`(derived catalog).
  - 저장할 때 검사: `checkChoice`(`models/commands.ts`)와 session model. 이 둘은 동봉 snapshot만 본다(`packages/core/lophn-agent/register.ts:237`의 `snapshotCatalogEntry`).
- **고를 목록.** `selectableModels`(`packages/protocol/lophn-agent/model-picker.ts:94`)는 provider가 알려 준 목록이 있으면 그 목록이 전부다.
  - Manage models의 이름 더하기는 renderer가 `reported_models`에 이름을 덧붙여 `RecordProviderModels`로 보낸다(`workspace/agents/core-source.ts`의 `addReportedModel`).
  - Refresh가 성공하면 목록을 provider 것으로 바꾸므로, 손으로 더한 이름이 지워진다.
- **output 상한.**
  - OpenAI 계열(chat, Responses)은 `max_tokens`를 `min(4096, output_limit)`으로 보낸다(`resolve.ts:228`, `:234`). Anthropic은 `min(output_limit, 4096 + thinking 예산)`이다.
  - catalog model에도 똑같이 걸린다. snapshot 510개 중 476개가 4096보다 큰 `output_limit`을 갖는다.
  - 4096인 이유를 적은 주석이나 문서는 없다.
  - 입력 예산이 남기는 output 몫은 이것과 따로 정한다: `prepare.ts`는 min(8000, output_limit), compactor는 4000.
- **modality.**
  - `MODEL_MEDIA`는 text, image, audio, video다(`packages/protocol/lophn-agent/resolved-model.ts:27`). pdf는 없다.
  - 실제로 쓰는 것은 text 입출력과, tool 결과로 들어오는 image 입력뿐이다(`resolve.ts:216`의 `images`, `tools/registry.ts`의 `image.read` 고르기). composer 첨부는 모두 text다.
- **비용.**
  - call이 끝날 때 `estimatedCost(usage, price_basis)`(`packages/core/lophn-agent/usage/cost.ts`)가 USD 추정 금액을 `model_calls`에 남긴다.
  - cache read·write token도 input 요율로 센다(`chargedTokens`). context 구간 요율은 무시하고 `rates[0]`만 쓴다.
  - session·agent별 합은 `ReadAgentUsage`(`packages/protocol/lophn-agent/traces.ts:186`, `session` filter 있음)가 준다. 이것을 보이는 화면은 없다.
- **shell.** model 화면 어디에도 한도, modality, 가격이 보이지 않는다. renderer가 `CatalogEntry`에서 읽는 칸은 `options`뿐이다.
  - Manage models 행(`packages/shell/renderer/conversation/model-picker/manage-models.tsx`)은 이름과 Switch뿐이다.
  - icon은 lucide-react 1.51.0이고, shell은 `packages/shell/renderer/icons/*.ts`의 map으로 고른다. modality용 map은 없다. 쓸 수 있는 icon은 `Type`, `Image`, `AudioLines`, `Video`, `FileText`, `Brain`, `Coins`, `Wrench`다.

## 선례에서 가져올 것

opencode(v1.18.35), omp(18.8.7)와 upstream pi, hermes(v0.21.6)를 소스로 읽었다.

- **화면에서 적는 길은 셋 다 없다.**
  - opencode desktop의 custom provider form은 model id와 이름만 받는다. effort, 한도, 가격은 JSON을 손으로 고쳐야 한다.
  - omp는 `models.yml`에만 적는다.
  - hermes는 context만 받고 가격은 넣을 길이 없다. `CostSource`에 `user_override`가 선언만 되어 있다.
  - lophn이 catalog 모양 그대로 화면에서 받으면 셋보다 앞선다.
- **칸 이름과 단위는 models.dev 것을 따른다.** `limit.{context,input,output}`, `modalities.{input,output}`, `cost.{input,output,cache_read,cache_write}`이고 가격은 USD per 1M token이다. lophn catalog가 이미 이 모양에서 옮겨 온다(`models/adapters/models-dev.ts`).
- **모름과 0을 나눈다.** opencode와 omp는 가격 0과 모름을 구분하지 않아 모르는 model이 "free"로 보인다. hermes는 요율이 없으면 `unknown`과 "n/a"로 두고 합계에서 뺀다. lophn의 `price_basis` 요율은 이미 nullable이다.
- **안 적은 한도는 기본값이라고 보인다.** omp의 128000/16384 기본값은 자주 틀리는데 표시가 없어서, compaction 시점이 말없이 바뀐다. hermes는 "override - auto: N"처럼 적은 값과 기본값을 함께 보인다.
- **effort는 단순하게.** omp는 mode 5개, 형식, 끄는 방식, host 규칙이 얽혀 무겁다. form에는 reasoning 켜기, 고를 단계, 기본 단계만 있으면 된다(omp 조사 결론). 단계마다 따로 보낼 문자열(pi의 `thinkingLevelMap`)은 필요해질 때 한다.
- **비용 계산.** opencode, omp, hermes 모두 input, output, cache read, cache write를 각자 요율로 곱해 더한다. hermes는 1센트 미만을 소수 넷째 자리(`~$0.0046`)로 보인다.
- **modality icon은 셋 다 없다.** opencode는 tooltip에 글자 "Inputs: text, image", omp는 글자 badge, hermes는 Wrench, Eye, Brain badge다. 이 부분은 lophn이 새로 만든다.

## 무엇을 만드나

### 1. 사람이 적은 model 정보 (core)

- **저장.** custom provider model의 정보를 `CatalogEntry`와 같은 모양으로 ledger에 저장하고, catalog의 user 층으로 합친다.
  - 칸: 한도 넷, `supports_tools`, `input_media`, `output_media`, effort 축, `price_basis`.
  - 열쇠는 catalog와 같은 (provider definition, model 이름)이다. custom 정의는 provider 하나에 하나라 provider별로 갈린다.
- **명령.** 더하기·고치기와 지우기 둘이고, compare는 seq 하나로 한다(Manage models의 `ChangeHiddenModels`와 같은 꼴).
- **user 층을 함께 보는 곳.** catalog를 읽는 곳 셋(`ReadModelCatalog`, turn resolver, 저장할 때 검사) 모두다. 그러면 picker 축, 요청 변환, 한도, image 허용이 지금 코드 그대로 따라온다.
- **고를 목록.** custom provider에서는 provider가 알려 준 목록과 user 정보가 있는 model의 합이다.
  - Manage models에서 이름을 더하면 `reported_models`에 덧붙이지 않고 user 정보를 만든다. 그러면 Refresh가 손으로 더한 model을 지우지 않는다.
  - `RecordProviderModels`는 provider 목록 읽기만 쓴다.
- **effort.** 사람이 고를 단계(고정 이름 7개 중), 기본 단계("model에 맡김" 포함)를 적는다. custom provider는 chat-completions뿐이라 `reasoning_effort`로 간다.
  - chat 표에 `maximum → "max"`를 더한다. deepseek-v4 계열이 max를 받는다(opencode, hermes 선례).
- **한도.** 안 적은 칸은 null이고, core는 지금의 기본값(context 131072, output 4096, tool 지원)으로 돈다.
- **가격.** input, output, cache read, cache write 요율은 USD per 1M이다. 비우면 모름(null), 0은 무료다.

### 2. output 상한

- 4096 고정을 없앤다. 사람이 적은 output 한도가 이 상한에 묶이면 칸이 뜻이 없다. catalog model에도 같은 bug가 있다.
- 보내는 `max_tokens`와 입력 예산이 남기는 몫을 같은 값으로 맞춘다. vLLM 계열은 입력과 `max_tokens`의 합이 context를 넘으면 거절한다.
- 값은 "정할 것" 1번이다.

### 3. 비용

- `estimatedCost`가 cache read·write를 각자 요율로 곱한다. 요율이 null이면 지금처럼 input 요율로 센다.
- 대화 화면에 그 session의 추정 비용 합을 보인다. 자리는 "정할 것" 2번이다.
  - `ReadAgentUsage`의 `session` filter를 쓴다.
  - 가격을 모르는 call이 있으면 그 수를 함께 보인다(합에서 빠졌다는 뜻).
  - 1센트 미만은 소수 넷째 자리까지 보인다.

### 4. shell

- **Manage models 행에 정보를 보인다.**
  - 모든 model 행에 입력 modality icon과 context를 보인다. catalog model은 읽기만 한다.
  - icon map을 `packages/shell/renderer/icons/`에 새로 둔다: text `Type`, image `Image`, audio `AudioLines`, video `Video`, pdf `FileText`. icon마다 tooltip으로 이름을 보인다.
- **custom provider model은 정보 form을 연다.** 이름 더하기 칸 대신 [Add model]이 form을 열고, 각 행의 [Edit]도 같은 form을 연다. form 칸:
  - model 이름(보내는 이름 그대로, 필수).
  - context, input, output 한도. 비우면 회색 placeholder로 기본값을 보인다.
  - tool 지원(Switch).
  - 입력과 출력 modality: icon toggle 다섯. text는 켜진 채 고정이다.
  - reasoning effort: 켜면 단계 7개 중 고를 것을 toggle chip으로, 기본 단계를 Select로 고른다. 기존 `OptionAxes`의 `aria-pressed` Button 꼴을 쓴다.
  - 가격 넷. 비우면 "모름"이다.
  - [Remove model].
- **실제로 쓰지 않는 칸도 자리는 만든다.** audio, video, pdf 입력과 text 밖의 출력은 저장하고 보이지만 요청에는 쓰지 않는다. form 도움말에 "lophn은 지금 text와 image만 보낸다"고 적는다.
- **picker.** user 정보에 effort가 있으면 지금 `OptionAxes`가 그대로 보인다. 따로 만들 것이 없다.
- **비용 자리.** 대화 화면에 session 비용 합을 둔다(3).
- **wireframes gallery.** 다음 상태를 `FakeAgentsOptions`와 user 항목으로 더한다.
  - Manage models에 icon이 붙은 모습.
  - custom model 정보 form(새로 더하기, 고치기, effort 켬).
  - custom model을 고른 picker의 effort.
  - 대화 화면의 비용 합(가격 모름 call 포함).

## 정한 것

- 사람이 적는 칸은 catalog 항목과 같은 모양이고, 적은 effort는 고를 수 있어야 한다(사람).
- modality는 icon으로 보이고 고칠 수 있다(사람).
- runtime이 아직 못 쓰는 칸도 shell과 저장에 자리를 만든다(사람).
- 가격(input, output, cache read, cache write)을 받아 비용 추적에 쓴다(사람).
- 저장은 ledger에 한다(agent). derived `catalog.json`은 깨지면 snapshot으로 다시 만들어 사람이 적은 것을 잃는다. 사람 데이터는 ledger가 지킨다.
- 사람이 적는 정보는 custom provider model에만 받는다(agent). 내장 provider의 catalog를 사람이 덮는 길은 필요해질 때 한다. 같은 이름 항목을 다른 정의에서 빌리지 않는 규칙(`agent-definition.md` catalog 절)은 그대로 둔다.
- Manage models의 이름 더하기를 user 정보 만들기로 바꾸고, 고를 목록은 provider 목록과 user 정보의 합이다(agent). Refresh가 손으로 더한 model을 지우는 문제가 함께 풀린다.
- chat-completions effort 표에 `maximum → "max"`를 더한다(agent). Responses 표는 그대로 둔다. OpenAI Responses는 max를 받지 않는다.
- `MODEL_MEDIA`에 `pdf`를 더한다(agent). models.dev가 쓰는 값 다섯과 icon 다섯이 맞는다. runtime은 계속 쓰지 않는다.
- 가격은 비우면 모름, 0은 무료다(agent). opencode와 omp가 둘을 섞어 모르는 model이 free로 보인다.
- 안 적은 한도는 null로 저장하고 화면은 기본값을 회색으로 보인다(agent, omp와 hermes 선례).

## 정할 것

1. **output 상한 값.**
   - 추천: 보내는 `max_tokens`와 입력 예산이 남기는 몫을 모두 `min(output_limit, 32000)`으로 한다(opencode와 같은 값).
   - 얻는 것: reasoning model의 긴 tool call이 잘리지 않는다.
   - 잃는 것: 호출 하나의 최대 비용이 커진다. 입력 예산이 지금보다 최대 24000 token 줄어든다.
   - 다른 안: `output_limit` 전부를 보낸다(omp). 1M context model은 output 한도가 384000이라 입력 예산이 크게 준다.
2. **비용 합을 보일 자리.**
   - 추천: 대화 tab composer 아래 한 줄에 `$0.0123 · 가격 모름 2`.
   - 다른 안: session 머리, 또는 Settings에 사용량 화면 하나(agent별, 기간별). Settings 화면은 `ReadAgentUsage`가 이미 받는 filter로 만들 수 있지만 크다.

## 단계

계획 둘로 연다.

1. **`model-info`**: output 상한(2), user 정보 저장·명령·user 층 합치기·고를 목록·effort `max`·`pdf`(1), Manage models icon과 정보 form, gallery(4).
   - output 상한을 첫 task로 둔다. 정보 form의 output 칸이 그 위에서 뜻이 있다.
2. **`model-cost`**: cache 요율 계산, 대화 화면 비용 합, gallery 비용 상태(3).

계획마다 끝에 고칠 것:
- `project-docs/architecture/agent-definition.md`: catalog 절(user 층, 고를 목록, 목록 밖 model 기본값), Manage models 절.
- changelog 열린 판.
- 이 문서에서 그 계획 몫을 지운다.

## 끝남 기준

- hive처럼 `/models`가 없는 custom provider에 model을 정보와 함께 더하면, 고른 effort가 `reasoning_effort`로 요청에 실린다. 적은 context로 compaction 시점이 정해지고, image를 켜면 tool 결과 image가 실린다.
- b.ai처럼 `/models`가 있는 provider에서 Refresh를 해도 손으로 더한 model과 그 정보가 남는다.
- 적은 정보는 core를 다시 띄워도, `derived/` 폴더를 지워도 남는다.
- 가격을 적은 model의 call은 cache read·write를 각자 요율로 센 추정 비용을 남기고, 대화 화면에 그 session의 합이 보인다. 가격이 빈 model의 call은 "가격 모름"으로 세고 합에 넣지 않는다.
- OpenAI 계열 catalog model의 `max_tokens`가 4096에 묶이지 않는다.

## 하지 않는 것

- 내장 provider catalog 덮기(hermes `model_overrides`, omp `modelOverrides`).
- custom provider의 다른 wire API(Responses, Anthropic Messages), custom header, key를 env나 command로 받기. hive와 b.ai 모두 chat-completions와 Bearer로 붙는다.
- 단계마다 보낼 문자열 고치기(pi `thinkingLevelMap`), `thinking.type`이나 `enable_thinking` 같은 다른 effort 형식(omp `thinkingFormat`). 필요한 provider가 생기면 한다.
- model 이름으로 quirk나 한도 추론하기(opencode, hermes의 이름 표). DeepSeek `reasoning_content` 처리는 지금처럼 provider 정의 key로만 붙인다.
- context 구간 요율, 시간대 요율, 요청당 요금.
- audio, video, pdf 입력과 text 밖의 출력을 실제로 보내기.
