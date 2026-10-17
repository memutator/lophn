# model-catalog

제품 agent runtime이 model catalog 갱신(models.dev 공개 GET)을 실제로 돌리게 하고, 설정 `lophn-agent.model.catalog_auto_update`가 `<dataRoot>/derived/lophn-agent/catalog-state.json`의 `auto_update`를 정하게 한다. 이슈의 "살린다"(추천)로 한다.

- 단위: model-catalog (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/main/agent-runtime/main.ts`
  - `packages/core/lophn-agent/models/catalog-refresh.ts`
  - `packages/core/lophn-agent/models/work.ts`
  - `packages/core/lophn-agent/models/catalog-refresh_test.ts`(새로 만든다)
- 읽을 것:
  - 이슈: `project-docs/issues/agent-definition.md`의 "model catalog가 models.dev에서 갱신되지 않고 자동 갱신 설정은 아무것도 바꾸지 않는다"(추천: 살린다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `models`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/main`
  - 본보기: `packages/core/lophn-agent/run-loop/prepare.ts`의 `settingsList` 읽기(`readOf(machine, settingsList, { keys })`)와 `packages/core/config/reader.ts`의 `createListSettingsReader`
  - test: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `protocol/config`의 `settingsList`(machine actor가 부를 수 있다. `prepare.ts`가 같은 길로 읽는다), 설정 key `lophn-agent.model.catalog_auto_update`(`lophn-agent/register.ts`가 선언. boolean, 기본 true. 이 task는 `register.ts`를 고치지 않는다)
  - 내놓는 것: `startCatalogRefresher`의 입력에 `autoUpdate: boolean`이 생긴다. `CatalogRefresher.kickAutoUpdate()`는 `Promise<void>`를 돌려준다(시작한 갱신이 끝나면 풀린다. 시작하지 않으면 바로 풀린다). 부르는 쪽(`main.ts`)은 `void`로 부른다.

## 지킬 것(계획 README "지켜야 할 것")

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.
- protocol을 바꾸면 쓰는 쪽(shell, coding agent CLI)을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- secret 값은 보호 메모리와 전송 직전 attach 밖으로 나가지 않는다(log, event, ledger, model 입력 금지). catalog 요청은 method·URL·Accept·If-None-Match뿐이고 credential·선택·세션을 싣지 않는다(지금 `adapters/models-dev.ts`가 그렇다. 바꾸지 않는다).

## 할 일

근거: 이슈 "model catalog가 models.dev에서…". 코드를 열어 확인한 사실: `main.ts`의 `import.meta.main`은 `startAgentRuntime({ driver, pump })`로 `fetch`를 안 주고, `work.ts`의 `runRefresh`는 `fetch`가 없으면 network 없이 끝난다. `state.auto_update`는 `initialState(true, …)`로만 만들어져 설정이 닿는 곳이 없다. 아래 1~4가 코드를 열어 새로 안 구멍이다(이슈에 없다).

1. `main.ts`에 `startAgentRuntime` 입력 `catalogFetch?: typeof fetch`를 더하고, refresher를 만드는 곳(`onHello`의 `startCatalogRefresher({ dataRoot, … })`)은 `input.fetch` 대신 `input.catalogFetch`를 넘긴다. `import.meta.main`은 `catalogFetch: fetch`를 준다. 근거: `input.fetch`는 core loopback용(`coreRead`, `machineCall`, `agentCall`, MCP auth pump)이라 같은 인자에 models.dev를 실으면 loopback 가짜 fetch가 공개 GET을 받는다. 둘을 나눠 두면 `fetch`를 주입하는 쪽(test)이 models.dev로 나가지 않는다. runtime은 `net_any`라 `--allow-net` 권한 변경은 없다(`tools/runtime-permissions.ts`를 고치지 않는다).
2. 설정 값을 읽어 넘긴다. `onHello`에서 refresher를 만들기 전에 machine 자격(`input.read ?? machineCall(...)`, 지금 `calls.machine`에 inline으로 들어 있다. 변수로 빼서 같은 것을 쓴다)으로 `readOf(machine, settingsList, { keys: [CATALOG_AUTO_UPDATE_KEY] })`를 부르고 `autoUpdate`를 정한다: 항목의 `chosen`이 boolean이면 그 값, 아니면 `default`가 boolean이면 그 값, 읽지 못하면 true. key 문자열 상수 `CATALOG_AUTO_UPDATE_KEY`는 `catalog-refresh.ts`에서 export한다(`register.ts`를 import하지 않는다. `register.ts`의 선언과 문자열이 같아야 하고 그 선언은 `agent-place`가 갖는다. 같은 문자열을 한 번 더 쓰는 것은 아래 보고 "정한 것"에 적는다). 근거: runtime은 `<dataRoot>/settings.json`을 직접 읽지 않고 core를 loopback으로 부르는 것이 `prepare.ts`의 길이다. 설정은 "다음 기동부터 적용"이다(`register.ts` 주석). 그래서 기동 때 한 번만 읽는다.
3. `catalog-refresh.ts`의 `startCatalogRefresher`가 `autoUpdate`를 받아 `CatalogWorkInput`에 싣고, `work.ts`가 쓴다:
   - `rebuildFromSnapshot`의 `initialState(true, hash)`를 `initialState(input.autoUpdate, hash)`로.
   - state 파일이 있을 때도 읽은 `auto_update`가 설정과 다르면 설정 값으로 고쳐 쓴다(설정이 정본이고 파일은 derived다). 파일이 없거나 새로 복구했으면 catalog와 state를 함께 쓴다. 근거: 지금 복구 경로는 메모리에만 두고 파일을 쓰지 않아 `catalog-state.json`이 생기지 않는다. "설정 값이 `catalog-state.json`의 `auto_update`로 간다"가 성립하려면 파일이 있어야 한다. state만 쓰면 다음 `load()`가 catalog가 비어 snapshot 복구로 가서 state 파일을 무시하므로 catalog도 같이 쓴다.
   - `persist`/`writeAtomic` 앞에 `files.mkdir(directory, { recursive: true })`를 더한다. 근거: `<dataRoot>/derived/lophn-agent`를 만드는 곳이 없다(`derived`는 `main/daemon/wiring/projects.ts`가 만들고 그 아래 `lophn-agent`는 아무도 안 만든다. `writeAtomic`은 `mkdir`을 안 부른다). 이대로면 새 data root에서 첫 `persist`가 `unavailable`로 끝난다. runtime의 쓰기 권한은 `<dataRoot>/derived/lophn-agent` 한 곳이고 `mkdir` 대상이 그 경로 자체라 권한 안이다.
   - `rebuildFromSnapshot`이 `stateAfterChecked(…, now)`로 복구 시점을 마지막 확인으로 두는 것을 `initialState(…)` 그대로(`last_checked_at: null`)로 바꾼다. 근거: 지금은 새 data root가 24시간 동안 갱신을 안 해 사람이 snapshot의 4개 model만 보게 된다(`refreshDueAt`가 `last_checked_at === null`일 때만 즉시 갱신한다). 갱신이 실패하면 `catalog.json`이 안 생겨 다음 기동에도 다시 시도하는 비용(공개 GET 1회)은 받아들인다.
   - `kickAutoUpdate()`가 `Promise<void>`를 돌려준다(진행 중이면 그 진행을 기다리고, 갱신하지 않을 때는 바로 풀린다). `auto_update`가 false면 `runRefresh`에 들어가지 않는다(지금 `refreshDueAt`가 이미 그렇게 거른다. 바꾸지 않고, state의 `auto_update`가 설정 값이 되도록만 한다).
4. `refreshNow()`는 그대로 둔다(부르는 route가 없다. 이 task는 route를 만들지 않는다). 이슈 영향 항목의 "설정 화면의 자동 갱신 켜기·끄기"는 이 task 뒤에 기동 때 반영된다.
5. dev·test에서 models.dev에 실제 GET이 나가지 않게 한다:
   - test는 `fetch`를 주입하는 길만 쓴다. 제품 entry(`import.meta.main`)는 test가 띄우지 않으므로 test에서 `catalogFetch: fetch`가 켜질 길이 없다. 이 task가 새 subprocess test를 만들지 않는다.
   - `deno task dev`(`tools/dev.ts`)는 `.dev-data`에서 실제 core와 runtime을 띄우므로 새 data root마다 첫 기동에 models.dev로 GET이 나간다(그 뒤로는 24시간에 한 번). `tools/dev.ts`는 이 계획의 소유가 아니다(test·E2E roadmap이 고칠 수 있다). 고치지 말고 보고의 "넘길 줄"에 "dev에서 끄려면 `.dev-data/settings.json`에 `"lophn-agent.model.catalog_auto_update": false`를 둔다"를 적는다. 판단: models.dev는 model provider가 아니라 공개 catalog GET이라 AGENTS.md의 "실제 model provider 호출" 금지에 들지 않는다.
6. test 하나(`catalog-refresh_test.ts`): "자동 갱신을 끄면 새 data root에서도 catalog 요청이 나가지 않고, 켜면 나간다". 임시 폴더(`Deno.makeTempDir`)를 dataRoot로, 시계는 고정 값을 주입하고, `fetch`는 status 500을 돌려주는 가짜를 준다. 표로 두 경우를 돈다: `autoUpdate: false` → `await refresher.kickAutoUpdate()` 뒤 `catalog-state.json`의 `auto_update`가 false이고 `last_failure`가 null이다. `autoUpdate: true` → 같은 호출 뒤 `last_failure`가 `"unavailable"`이고 `auto_update`가 true다. 판정은 파일에 남은 state로 하고 fetch 호출 횟수를 세지 않는다. 실제 models.dev를 부르지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "자동 갱신을 끈 사람의 새 data root에서 models.dev 요청이 나가지 않는다"(사람이 끈 network 접근 경계). 설정 → `catalogFetch` 배선(`main.ts`)은 supervised child라 test하지 않는다.
- 남지 않음: `grep -n "initialState(true" packages/core/lophn-agent/models/work.ts`가 0줄이고, `grep -n "catalogFetch" packages/core/main/agent-runtime/main.ts`에 `import.meta.main`의 `catalogFetch: fetch`가 보인다. refresher 생성부에 `input.fetch`가 남아 있지 않다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(route·barrel을 더하지 않는다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것. `register.ts`의 선언과 `CATALOG_AUTO_UPDATE_KEY`가 같은 문자열을 두 번 쓰는 점, 복구 직후의 `last_checked_at`을 null로 둔 점을 반드시 적는다.
- 넘길 줄: 남의 file을 최소로 맞춘 곳. dev에서 GET을 끄는 길(위 5).
- 계약 바꾸기 요청: `register.ts`가 `CATALOG_AUTO_UPDATE_KEY`를 import해 선언의 key로 쓰게 하는 것(`agent-place`가 `register.ts`를 갖는다). 고치지 않는다.
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: `refreshNow()`를 부르는 route가 없어 사람의 즉시 새로 받기는 여전히 없다. 설정을 바꾸면 다음 기동부터 반영된다. (더 있으면 적는다)
