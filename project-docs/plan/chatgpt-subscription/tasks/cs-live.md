# cs-live

ChatGPT 구독 OAuth를 진짜로 확인하는 live 길을 둘로 만든다. `deno task test:live:login`은 live 전용 data root에 core를 띄워 사람이 진짜 로그인을 한 번 하고 저장한다. `deno task test:live`는 그 root가 있으면 그 core로 구독 token을 써서 model을 한 번 부르고 계정 model 목록과 갱신을 확인한다. 진짜 로그인과 진짜 호출은 사람이 돌린다(AGENTS.md "사람에게 묻는 것"). lead는 코드를 쓰고 `deno task check`까지 하며, 명령은 사람에게 주고 결과를 받아 기록한다.

- 단위: cs-live (wave 2)
- 선행: cs-models-account
- 소유(이 task만 고친다):
  - `tests/live/run.ts`
  - `tests/live/root.ts`
  - `tests/live/login.ts`
  - `tests/live/chatgpt_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/testing.md`의 live 줄과 "돌리는 때"
  - 조사: `project-docs/plan/eval-base/research/infra.md` 1~4절(`tests/live`, 기존 data root 위의 `bootCore`, provider·model, OAuth 저장과 갱신)
  - 본보기: `tools/dev.ts`의 `plantFakeProvider`(기존 root에 hand-made `Run`으로 `bootCore`), `tests/support/fake-oauth/login.ts`(login → poll → 기본 model), `tests/e2e/oauth_test.ts`(구독 provider로 turn 하나), `tests/live/run.ts`·`openai_test.ts`(진입과 gate)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `tests`/live 관련 ID가 있으면 읽는다.
- 계약:
  - 쓰는 것(고치지 않는다): `tests/support/core/mod.ts`의 `bootCore`·`Run`·`Core`, `tests/support/core/human.ts`의 `until`·`settle`·`openSession`·`say`·`turnsOf`, protocol의 `providerDefinitions`·`loginBegin`·`loginComplete`·`providerList`·`modelCatalogRead`·`modelDefaultChange`·`modelCallList`, `cs-models-account`가 내놓는 `credential.account_models`
  - 내놓는 것: task 둘 `test:live:login`, `test:live`(기존 줄 그대로)

## live 전용 root의 규칙 (코드와 안내에 모두 적는다)

- 위치: `<repo>/.dev-data/live/home`(core의 `LOPHN_HOME`, 절대 경로). `.dev-data/`는 git이 무시한다. core의 log와 `user-home`은 `<repo>/.dev-data/live/run`에 둔다(root 안이 아니다).
- 복사하지 않는다. refresh token이 갱신 때마다 바뀌어 복사본과 원본이 둘 다 낡는다. core 하나만 띄운다(둘째 core는 `start_failed`). `test:live:login`과 `test:live`를 동시에 돌리지 않는다.
- 코드가 이 root를 지우지 않는다. 만든 `Run`의 `remove()`는 호출하지 않고(빈 함수), 지우는 길을 만들지 않는다. 다시 로그인하려면 사람이 `.dev-data/live`를 직접 지운다.
- 이 root는 schema가 바뀌면 못 뜬다(`history_mismatch`). 그러면 사람이 지우고 다시 로그인한다.
- 진짜 `~/.lophn`은 건드리지 않는다. `bootCore`는 env를 비우고 `HOME`을 `<run.dir>/user-home`으로 두며, token은 root의 `secrets.json`(0600)에 있어 그대로 쓴다. 환경 변수로 token을 넣지 않는다.

## 할 일

1. `tests/live/root.ts`(새 file; `tests/support/core/**`는 eval-base 계획이 소유해 여기 두지 않는다):
   - `LIVE_HOME`(`<repo>/.dev-data/live/home`), `LIVE_RUN`(`<repo>/.dev-data/live/run`). repo 경로는 `import.meta.dirname`에서 구한다.
   - `liveRootReady(): Promise<boolean>`: `LIVE_HOME/secrets.json`이 있으면 true(로그인으로 token이 한 번 저장된 root).
   - `bootLiveCore(): Promise<Core>`: `LIVE_RUN/user-home`을 만들고 `bootCore({ dir: LIVE_RUN, home: LIVE_HOME, work: LIVE_RUN, remove: () => Promise.resolve() }, { settings: { "lophn-agent.run.model_attempts": 3 } })`. `settings`는 `settings.json`이 아직 없을 때만 쓰인다(`writeSettings`). `lophn-agent.run.model_attempts`가 선언된 key인지 `packages/core/lophn-agent/run-loop/limits.ts`에서 확인한다(선언 안 된 key가 있으면 file 전체가 거절된다). 이유: 구독 호출이 되풀이로 새지 않게 turn의 model 호출 시도를 3으로 묶는다.
2. `tests/live/login.ts`(새 file, task 진입이다. test가 아니다):
   - `bootLiveCore()` 뒤 `providerList`에 `definition.oauth.product === "chatgpt"`인 provider가 있으면: `credential.state === "available"`이면 만료 시각만 찍고 끝낸다(이미 로그인됨). 아니면 "`.dev-data/live`를 지우고 다시 실행하라"고 찍고 1로 끝낸다.
   - 없으면 `providerDefinitions`에서 `key: "openai"`를 골라 `loginBegin`({ provider: `core.ids.newId("pvd")`, name, definition, endpoint `https://api.openai.com/v1`, protocol `openai-responses` })을 부르고 `sign_in.url`을 찍어 사람이 같은 컴퓨터의 browser에서 열게 한다(loopback callback이라 원격이면 port-forward가 필요하다고 안내). `loginComplete`를 `interval_ms`마다 부르며 `connected`를 기다린다. 기한은 `expires_at`(15분)이고 `until`의 `timeoutMs`로 준다.
   - 연결되면 `before = await runtimePids(core.run.home)`(`tests/support/core/process.ts`)를 연결 전에 잡아 두고 `settle(core, before)`로 runtime이 다시 뜨기를 기다린 뒤, `providerRead`에서 `credential.account_models`가 채워지기를 20초 기다린다. 채워졌으면 개수와, `modelCatalogRead`의 openai 항목과 겹치는 개수를 찍는다. 끝내 `null`이면 "로그인은 저장됐으나 계정 model 목록을 못 읽었다(cs-models-account 알려진 미완 1)"를 찍고 마지막에 1로 끝낸다.
   - 기본 model을 정한다(`modelDefaultChange`): 환경변수 `LOPHN_LIVE_CHATGPT_MODEL`이 있으면 그것, 없으면 `account_models ∩ catalog(openai, supports_tools !== false)`의 첫 항목. 겹침이 0이면 칸 이름이 틀린 것일 수 있다고 찍고 1로 끝낸다(아래 "외부 data").
   - `finally`에서 `core.stop()`(열린 채 끝나면 root를 다음 core가 못 쓴다). token·code·`sign_in.url`의 `state`를 파일이나 log에 쓰지 않는다(화면 출력만).
3. `tests/live/chatgpt_test.ts`(새 file, `Deno.test` 하나; 위험 하나에 test 하나, write-test):
   - 이름: "구독 token으로 model을 한 번 부르고 갱신이 있으면 회전한 refresh token이 저장된다".
   - 시작 전(core가 안 떠 있다)에 `LIVE_HOME/secrets.json`에서 이름이 `.refresh`로 끝나는 항목마다 값의 SHA-256 해시만 이름별로 보관한다(값은 보관·출력하지 않는다).
   - `bootLiveCore()` → `providerList`에서 chatgpt provider를 찾는다. 없거나 `credential.state !== "available"`이면 **실패**한다(메시지: `deno task test:live:login`을 다시). 이유: root가 있다는 것은 gate가 이미 봤고, 쓸 수 없는 root를 조용히 넘기면 만료를 숨긴다.
   - 단정 1(계정 목록): `credential.account_models`가 `null`이 아니고 catalog의 openai 항목과 하나 이상 겹친다.
   - `expires_at - now <= 5분`이면 `due`다(`OAUTH_REFRESH_LEAD_MS`).
   - `settle(core)` → `openSession(core, { role: "lophn" })` → `say(core, session, "Reply with the single word: ok")` → `until`로 90초까지 `turnsOf(...)[0].state === "finished"`를 기다린다(`waitTurnEnd`는 30초 고정이라 쓰지 않는다).
   - 단정 2(호출): turn의 `outcome.kind === "completed"`. `modelCallList({ session })`가 1개 이상 10개 이하이고 각 `model.billing_route === "subscription"`. (기록의 칸 위치는 `packages/protocol/lophn-agent/model-call-values.ts`의 `modelCallFields`: `model.billing_route`.)
   - 단정 3(갱신): `due`였다면 `credential.expires_at`가 전보다 늦고, `core.stop()` 뒤 `secrets.json`의 `provider.<id>.refresh`(이름은 `providerSecretName(provider.id) + ".refresh"`) 해시가 시작 때와 다르다. `due`가 아니면 이 단정을 건너뛰고 "갱신 시점이 아니라 확인하지 못했다(만료까지 N분)"을 찍는다. 이 단정은 사람이 token이 55분쯤 지난 뒤 다시 돌려야 확인된다(아래 사람 단계 4).
   - `try/finally`로 `core.stop()`. 실패해도 `kill`만 하고 root를 지우지 않는다. 출력에 token·refresh 값을 싣지 않는다.
4. `tests/live/run.ts`: 지금은 API key env가 있는 provider file만 돈다. 구독 항목을 더한다: `liveRootReady()`가 true이면 `chatgpt_test.ts`를 같은 방식(`deno test --allow-all --no-check`)으로 돈다. 아무것도 돌 것이 없으면 이유 둘(키 env 이름들, `.dev-data/live/home` 없음과 `deno task test:live:login`)을 찍고 0으로 끝낸다. 이 gate는 task 진입이라 test의 "조건 안 맞으면 통과" 금지에 걸리지 않는다.
5. 위의 규칙 다섯 줄을 `login.ts`와 `root.ts` 머리 주석에 "왜"로 적는다(복사 금지의 이유, core 하나, `remove` 안 부름).

## 외부 data (실제 응답을 못 본 채 쓴 것)

- `GET /v1/models`의 칸 이름(`data[].id`, `data[].visibility`)은 이슈가 옮긴 OpenAI 문서에서 가져왔고 이 brief를 쓸 때 진짜로 확인하지 못했다. 이 task의 첫 진짜 실행이 확인이다. 사람이 `test:live:login`을 돌렸을 때 찍힌 "겹치는 개수"가 0이거나 `account_models`가 `null`이면 `providers/account-models.ts`의 칸 이름 상수가 틀린 것이다. lead는 사람에게 응답 모양(token 없이, 칸 이름과 `visibility` 값 종류만)을 받아 상수를 고치고 `cs-models-account`의 test 표에 그 모양을 한 줄 더한다. 진짜 token은 어디에도 옮기지 않는다.
- ChatGPT 계정의 model id가 catalog의 model 이름(`snapshot.json`의 openai 항목)과 같은 철자인지도 모른다. 겹침이 0이면 같은 문제로 본다.
- access token 길이가 `issuer-requests`의 header 상한(`cs-models-account`가 4096으로 올림)을 넘는지 첫 실행에서 본다.

## 사람 단계 (lead가 사람에게 주고 결과를 받는다)

1. 코드가 `deno task check`를 통과한 뒤 lead가 `.dev-data/live`가 없음을 확인한다. `cs-models-account`가 schema step을 고쳤으므로 옛 `.dev-data`는 이미 지워졌어야 한다.
2. 사람: `deno task test:live:login`. browser에서 ChatGPT 로그인을 끝낸다. 찍힌 출력(개수, 겹침, 기본 model 이름)을 lead에게 준다. token은 주지 않는다.
3. 사람: `deno task test:live`(ChatGPT 구독 호출 1회 + 모델 호출 1~3개). 결과를 lead에게 준다.
4. 사람: 3번에서 "갱신 시점이 아님"이 나왔으면 약 55분 뒤 `deno task test:live`를 한 번 더 돌려 갱신 단정을 채운다(로그인 직후에는 `due`가 아니다).
5. 선택: 목록이 화면에 나오는지 보려면 `deno task dev`로 앱을 띄워 설정에서 ChatGPT로 provider를 붙이고 model picker를 연다. 이것은 live root가 아니라 `.dev-data`의 별개 로그인이다(live root에 앱을 붙이지 않는다. core가 둘이 된다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "구독 token으로 한 번 부르고 갱신이 있으면 회전한 refresh token이 저장된다" 하나. 사람이 돌릴 때만 의미가 있는 live test다. unit test를 더하지 않는다.
- 남지 않음: `grep -rn "\.remove()" tests/live`가 0줄이다.
- 사람 단계 2·3이 통과했다고 lead가 기록했다(단계 4는 기다려도 된다. 못 했으면 `status.md` 기록 칸에 "갱신 미확인"을 적는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것:
  - `deno.json`의 tasks에 `"test:live:login": "deno run --allow-all tests/live/login.ts"`. `test:live` 줄은 그대로 둔다. `login.ts`는 `.env`를 읽지 않는다(`--env-file` 없음).
  - `project-docs/architecture/testing.md` 81줄(live): `test:live:login`, `.dev-data/live/home`, 복사 금지·core 하나·지우지 않음, 구독 호출은 `due`일 때만 갱신을 단정함.
  - `.env.example`의 구독 OAuth 주석에 `deno task test:live:login`을 가리키게 한다(이 컴퓨터에만 있다).
- 안 쓰게 된 export: 없음
- 정한 것: root가 있는데 credential이 쓸 수 없으면 실패(README는 "이유를 찍고 넘어간다"; write-test는 조건이 안 맞아 조용히 통과하는 test를 금지한다. 넘기는 쪽을 원하면 test 첫머리에서 이유를 찍고 return으로 바꾼다. 열린 질문), 모델 호출 시도 3, 기본 model은 `LOPHN_LIVE_CHATGPT_MODEL` 또는 목록과 catalog의 첫 겹침
- 넘길 줄: 없음
- 계약 바꾸기 요청: `bootCore`·`Run`의 모양을 eval-base가 바꾸면(이 task는 `tests/support/core/mod.ts`를 import만 한다) `root.ts` 한 곳을 맞춘다.
- **무겁게 짠 것**: 없음
- **알려진 미완 동작**: 갱신 단정은 token이 55분쯤 지나야 채워진다. 로그인과 같은 session에서는 확인할 수 없다.
