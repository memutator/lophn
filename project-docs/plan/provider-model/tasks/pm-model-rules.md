# pm-model-rules

core의 model 규칙 둘을 README 결정에 맞춘다. (1) model 이름은 직접 적어 고를 수 있다: catalog와 custom provider가 알려 준 목록은 고를 수 있는지를 정하지 않고 정보만 준다. 예외는 구독 OAuth provider의 계정 허락 목록이다(목록 밖 이름은 계속 거절). (2) 정의 읽기(`agent-definitions/read`와 목록 줄)가 model 값의 층에 `project`도 낸다.

**먼저 지금 코드를 다시 읽는다**: 계획 `ui-fixes`(catalog 읽기, 이름 직접 적기, 기본 한계)와 `pm-reported-models`가 들어온 뒤의 `packages/core/lophn-agent/models/{resolve,commands,selection,snapshot-catalog}.ts`, `session/session-model.ts`를 읽고 시작한다.

- 단위: pm-core (wave 2)
- 선행: pm-reported-models
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/models/**`
  - `packages/core/lophn-agent/session/session-model.ts`
  - `packages/core/lophn-agent/agents/{reads,ports,commands_test,reads_test,resolve}.ts`
  - `packages/core/lophn-agent/register.ts`(`modelCommandDeps`와 `agentLookups`의 줄만)
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`(model을 정하는 순서, "catalog에 목록이 있는 provider가 모르는 model 이름은 거절한다" 문장, 구독 provider의 계정 model 목록 문장)
  - README: `project-docs/plan/provider-model/README.md`의 "정한 것"(고를 수 있는 model, 어디서 정해졌나)
  - 층 계산: `agents/resolve.ts`의 `modelLayers`와 `sources.model`(이미 session > agent > project > global 순서로 `AgentValueLayer`를 낸다), `agents/layers.ts`(turn 때 `project_model`을 읽는 곳, 정의 읽기의 source가 `global`일 때만 전역 값으로 쓴다)
- 계약:
  - 쓰는 것: `agentDefinitionRead`, `ModelChoice`, `AgentValueLayer`(`agent-definitions.ts`)
  - 내놓는 것: 읽기 모양은 그대로다. `effective.model.source`와 목록 줄의 `model.source`에 `project`가 나올 수 있다(타입은 이미 허락한다).

## 정해진 것

- 규칙(README "정한 것"): 직접 적은 이름은 받는다. 예외는 provider가 알려 준 목록이 계정의 허락 목록일 때뿐이다: 구독 OAuth provider(`credential.kind === "oauth"`)이고 `reported_models`가 null이 아니면 목록 밖 이름은 지금처럼 거절한다(계획 `chatgpt-subscription`이 지킨 것. `entitlementAllows`와 `typedNameAllowed`가 `model-picker.ts`에 있다). custom provider의 목록은 찾기 위한 것이라 목록 밖 이름도 받는다. 내장 provider(catalog만 있는 쪽)는 catalog 밖 이름을 받는다.
- 걷을 곳 넷: `models/resolve.ts`의 `found === undefined && !unlisted`(이름 모름 거절), `models/commands.ts`의 `checkChoice`가 부르는 `modelListed`, `session/session-model.ts`의 `snapshotModelListed`, `models/selection.ts`의 `provider.modelListed === false` 거절 가운데 "catalog/snapshot에 없다"에서 오는 거절이다. 걷은 뒤 catalog에 없는 이름은 어느 provider에서나 기본 한계(`UNLISTED_LIMITS`, option 없음)로 돈다. 허락 목록 거절은 남긴다: resolver의 `modelListed`는 `entitlementAllows(provider.credential.kind, provider.credential.reported_models, name)`다. 저장 때(`checkChoice`, `checkSessionModel`)는 허락 목록을 보지 않는 지금 동작을 유지한다(changelog 0.3.0 "저장 검사는 목록을 보지 않는다").
- 이름이 틀리면 provider 호출이 거절하고 기존 실패 길(`model_unavailable`, `account_model_access` block)로 드러난다.
- 걷은 뒤 쓰는 곳이 없어진 것(`ModelCommandDeps.modelListed`, `snapshotModelListed` 등)은 지운다. 쓰는 곳이 남아 있으면 남긴다.
- 층: 정의 읽기의 `effectiveModel`(`agents/reads.ts`)은 지금 agent와 global만 낸다. project place의 agent가 model을 고르지 않았고 그 project에 model이 있으면 `source: "project"`로 그 값을 낸다. project 값을 읽는 길은 `AgentLookups`에 `projectModel(place)`를 더해 `register.ts`의 lookups가 `loadChoice(sql, project id)`로 채운다(turn 때의 `agents/layers.ts`는 project place에서만 project 값을 읽는다. 앱 place는 project 층이 없다). `layers.ts`는 source가 `global`일 때만 전역 값으로 쓰므로 고치지 않아도 맞다. 새 read route를 만들지 않는다.
- 대화의 session 층은 core가 아니라 대화 화면의 source가 안다(`record.model_selection`). 이 task는 건드리지 않는다.

## 할 일

1. `models/resolve.ts`, `models/selection.ts`, `models/commands.ts`, `session/session-model.ts`에서 위 "catalog에 없다" 거절을 걷고 허락 목록 거절은 `entitlementAllows`로 남긴다.
2. 기존 test를 새 규칙에 맞춘다: `models/resolve_test.ts`(`ui-fixes`가 쓴 "목록이 있는 provider가 모르는 이름은 거절" 사례는 지우거나 반대로 고친다).
3. `agents/ports.ts`에 `projectModel`, `agents/reads.ts`의 `effectiveModel`에 project 층을 더하고 `register.ts` lookups를 채운다. `agents/commands_test.ts`의 lookups 가짜에 줄을 더한다.
4. 문서: architecture 문서는 고치지 않는다(lead가 계획이 끝난 뒤 맞춘다). 코드 주석만 맞춘다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test 둘(기존 file에 더하거나 `agents/reads_test.ts`):
  - 한 표 test(`models/resolve_test.ts`): "직접 적은 이름은 catalog만 있는 provider에서 받고, custom provider에서는 그 provider가 알려 준 목록 밖이어도 받으며(둘 다 기본 한계), 구독 OAuth provider의 허락 목록 밖 이름은 계속 거절한다." 세 경우를 한 표에 둔다.
  - "project place의 agent가 model을 고르지 않았고 그 project에 model이 있으면 정의 읽기의 `effective.model.source`가 `project`이고, agent가 고르면 `agent`, 둘 다 없으면 `global`이다."(`agents/reads_test.ts`. 이 읽기가 틀리면 turn 때 `layers.ts`가 전역 값을 잘못 버린다.)
- 남지 않음: `grep -rn "snapshotModelListed" packages/core`가 0줄이거나 남긴 이유가 보고에 있다.

## 보고

- 바꾼 file, 통과한 check
- 등록할 것: 없음이 기본이다
- 걷은 거절과 지운 export 목록
- lead용 문서 메모: `architecture/agent-definition.md`의 (a) "catalog에 목록이 있는 provider가 모르는 model 이름은 거절한다" 문장은 "직접 적은 이름은 받고 기본 한계로 돈다. 구독 OAuth provider의 계정 허락 목록 밖 이름만 거절한다"로, (b) "목록이 하나도 없는 custom provider의 model은 사람이 이름을 적어 고르고" 문장은 모든 provider로, (c) model 정하는 순서 절에 project 층이 정의 읽기에도 나온다는 것, (d) 계정 model 목록 문장은 칸 이름 `reported_models`와 custom provider의 목록(찾기용, 목록 밖 이름 허용)을 더해 고친다. 위 세 가지 중 실제로 바뀐 것만 쓴다
- 정한 것 / 넘길 줄 / 계약 바꾸기 요청
- **무겁게 짠 것** / **알려진 미완 동작**: 없으면 "없음"
