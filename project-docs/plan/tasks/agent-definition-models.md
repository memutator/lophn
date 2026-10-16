# agent-definition-models

model 기본값을 role별 slot에서 전역 하나로 바꾸고, "Model for summaries" 칸과 agent trace export를 지운다. provider adapter에 tool 결과의 이미지를 받는 길을 더한다. 이 폴더들의 event 쓰기는 domain event 10개만 남긴다.

- 단위: agent-definition (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/models/` 전체 (`schema.ts`, `store.ts`, `commands.ts`, `reads.ts`, `resolve.ts`, `selection.ts`, `binding.ts`, `catalog-refresh.ts`, `mod.ts`, `adapters/`)
  - `packages/core/lophn-agent/providers/` 전체 (`adapters/{messages,chat-completions,responses}.ts`만 바뀐다)
  - `packages/core/lophn-agent/usage/` 전체 (event 정리만)
  - `packages/core/lophn-agent/observability/` 전체
- 읽을 것:
  - spec: S4 2장(model 줄), 11장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S1 5·12장(domain event 10개) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - inventory: `I1.4#17`, `I1.8#2`, `I2.1#15`, `I2.4#36`
  - 같이 읽는 줄(다른 단위 몫): `I2.1#13`(command 층의 `tx.emit` 정리. agent-tools가 맡은 `tools/` 밖의 이 폴더들은 이 task가 정리한다)
  - 결정: `../README.md` 3장 #117·118(설정 파일)
- 계약:
  - 쓰는 것: `modelDefaultSchema`, `modelDefaultRead`, `modelDefaultChange`(contract-agent-tools-config), `SettingsChanged`(contract-events. 바뀐 것을 화면에 알리는 길), `HistoryPart`의 이미지 part(agent-definition-prompt)
  - 내놓는 것: `ReadModelDefault`·`ChangeModelDefault` handler와 저장, 새 resolve 입력에 맞는 `resolveModel`

## 할 일

먼저 `grep -rn "lophn-agent/models\|lophn-agent/providers\|lophn-agent/observability" packages/core --include=*.ts`로 밖에서 쓰는 이름을 센다(agents, run-loop, session, register.ts가 쓴다). 쓰는 곳이 남은 이름은 지우지 않고 보고한다.

1. model 기본값 (`I2.4#36`, `I1.4#17`): `schema.ts`의 `agent_model_defaults` 표(role 4 slot과 `summaries`)를 전역 기본 하나를 담는 표로 바꾼다(schema step을 고친다. migration을 만들지 않는다). `commands.ts`·`reads.ts`·`store.ts`를 `ChangeModelDefault`, `ReadModelDefault`로 옮긴다. `MODEL_DEFAULT_SLOTS`를 쓰는 곳을 모두 지운다. 처음은 null이다. agent 정의의 model과 composer에서 session 하나만 고른 model은 지금대로 둔다. variant(effort, fast)는 model마다 다른 것 그대로다.
2. summaries (`I1.4#17`): compact의 요약은 그 session의 model로 한다. `session/compactor.ts`는 places-sessions 소유라 고치지 않는다. 이 폴더에 있는 `summaries` slot 고르기와 주석만 지우고, 그 file이 아직 `summaries`를 읽으면 그 사실을 보고한다.
3. trace (`I1.8#2`, `I2.1#15`): `observability/export.ts`, `trace-export.ts`와 `retention.ts` 가운데 export 전용 부분을 지운다. 읽기(`reads.ts`, `model.ts`)는 옛 표(runs, model_calls, tool_calls)에서 조립한다. agent event를 저장하지 않으므로 조립 근거를 session 기록으로 옮겨야 하지만 어디에 남길지 정해지지 않았다(`../../tmp/docs-review.md` 7장 "trace 저장"). 정해지기 전에는 읽기를 건드리지 않고 보고에 적는다. protocol의 `agentTraceExport`는 contract 소유라 지우지 않는다.
4. event 정리 (`I2.1#13`의 이 폴더 몫): `providers/`, `models/`, `usage/`, `observability/` 안의 `tx.emit` 중 domain event 10개가 아닌 것을 지운다(`ProviderRegistered`, `ProviderChanged`, `ProviderDisconnected`, `ModelDefaultsChanged`, `ModelFavoritesChanged` 등). 화면이 바뀐 것을 알아야 하는 곳은 `SettingsChanged`를 내거나(contract-events가 정한 모양) 읽기를 다시 부르게 한다. 어느 쪽을 골랐는지 보고에 적는다.
5. 이미지 (`providers/adapters/`): tool 결과 content가 `{ image: { media_type, data_base64 } }`일 때 `messages.ts`(Anthropic), `chat-completions.ts`, `responses.ts`가 각 provider의 image block으로 바꾼다. 이미지 입력(`input_media`에 `image`)이 없는 model에는 보내지 않고 글로 된 오류 한 줄로 바꾼다.

- (lead가 더함, router-run-loop-turn이 넘긴 것) 고른 model의 `input_media`가 선택 결과에 없어 run-loop가 `listRoleTools`에 `["text"]`를 준다(그래서 `image.read`가 빠진다). 선택 결과에 `input_media`를 싣는다. `main/agent-runtime/providers/watch.ts`와 `main.ts`의 `coreRead`(`ROUTES_BY_PATH`)가 아직 `events/list`를 부른다(없어진 route). Bus 구독이나 snapshot 읽기로 바꾼다.

- (lead가 더함, screens-agents-editor의 계약 바꾸기 요청, lead 승인) S4 2장의 층(전역, project, agent) 가운데 project 층 model을 읽고 바꾸는 route가 없다. Agents 탭의 project model 줄이 저장되지 않는다(`setProjectModel`이 `unavailable`). project 층 model read·change route를 protocol에 더하고(계약 file 추가 소유) handler를 단다. `workspace/agents/core-source.ts`의 `setProjectModel`·`projectModel.chosen` 줄도 맞춘다(추가 소유).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(전역 기본 하나의 저장과 읽기는 얇다. 이미지 변환은 fake provider script로 눈으로 보는 정도다).
- 남지 않음: `grep -rn "MODEL_DEFAULT_SLOTS\|modelDefaultsSchema\|summaries" packages/core/lophn-agent/models packages/core/lophn-agent/providers`가 0줄이다(밖의 사용처 때문에 남긴 이름 제외).

## 보고

- 바꾼 file
- 등록할 것: `ReadModelDefault`·`ChangeModelDefault` handler를 register.ts에 거는 일은 agent-definition-register가 한다
- 안 쓰게 된 export: 옛 `ReadModelDefaults`·`ChangeModelDefaults` handler, 1번~2번에서 밖의 사용처 때문에 남긴 이름
- 정한 것: 화면에 알리는 길(`SettingsChanged` 또는 읽기 다시 부르기), 전역 기본의 저장 표 모양
- 계약 바꾸기 요청: trace 저장 위치가 정해지면 `traces.ts` 읽기 모양

- (lead가 더함, agent-definition-prompt가 넘긴 것) `HistoryPart`에 `tool_result_image {id, media_type, data_base64}`가 생겼다. 지금 `models/binding.ts`는 Anthropic에서 빈 tool_result로, responses에서는 건너뛴다. provider 쪽에서 image block으로 바꾼다.
