# platform-config

설정을 ledger 표와 writer command에서 `<data root>/settings.json` 한 파일로 바꾼다. 쓰는 요소가 `declareSetting`으로 선언한 항목(type과 기본값)만 받고, 틀린 값은 이유와 함께 거절한다. 파일이 바뀌면 `SettingsChanged`를 낸다. 옛 revision 이력, 충돌 검사, question 근거 apply, TOML 교환, ledger 표를 지운다.

- 단위: platform (wave 3)
- 선행: platform-secrets (같은 I/O worker file `core/main/worker/io.ts`에서 settings pipe 쓰는 곳을 먼저 걷는다. 그 뒤에 이 task가 `core/config/worker/pipe.ts`를 지운다). 그리고 계약 고정: contract-platform, contract-events(`SettingsChanged`와 Bus 발행 port), core-wiring(wave 0의 core-wiring-split), remove-platform(`shell.os_notifications` 읽는 쪽과 notifications를 이미 지운다)
- 소유(이 task만 고친다):
  - `packages/core/config/` 전체
  - `packages/core/main/daemon/wiring/config.ts` (core-wiring-split이 만든다)
  - wording의 settings 영역 file에 key 더하기만 (wording-split이 정한 file)
- 읽을 것:
  - spec: 없음. 계약 모양은 `packages/protocol/config/declaration.ts`, `file.ts`(contract-platform)가 정한다
  - inventory: `I1.11#4`, `I1.11#5`, `I1.11#6`, `I2.11#1`, `I2.11#4`, `I3.11#2`, `I3.11#3`, `I3.11#4`
    - 같이 볼 줄(다른 단위 몫): `I2.11#3`(설정 조회 응답. 이 task의 `settings/list`가 한다), `I2.11#5`(필수 선택이 빈 기능, 아래 6번), `I1.11#7`(question 근거 apply 삭제 중 `core/config/question-evidence.ts`와 `evidence-use.ts`는 이 task가 지운다. `core/server/identity/question-evidence.ts`는 events), `I2.11#14`(schema step 목록)
  - 결정: `../README.md` 3장 #117·118
  - 본보기(화면): `tools/wireframes/frames/compositions/workspace/general-pane.tsx`(타입별 항목, 사람이 정한 값만 저장, 기본값과 나눠 보임, 거절 이유), `appearance-pane.tsx`(theme, text size, reading width, density)
  - 지금 코드: `packages/core/config/*`(`apply.ts` 514줄, `model.ts` 417줄, `registry.ts`, `reads.ts`, `settings.ts`, `schema.ts`, `toml.ts`, `worker/pipe.ts`, `question-evidence.ts`, `evidence-use.ts`, `shell-settings.ts`, `mod.ts`), `packages/core/server/dispatch.ts`(`MemoryHandler`), `packages/core/main/daemon/registration.ts`(`TeamRegistration.memoryRoutes`)
- 계약:
  - 쓰는 것
    - `protocol/config`: `declareSetting`, `SettingDeclaration`, `SettingsReader`, `SETTING_KEY`, `settingWordingKey`, `settingsFileSchema`, `SETTINGS_FILE_NAME`, `settingsList`, `settingsUpdate`, `settingRejectionSchema`(contract-platform)
    - `SettingsChanged`와 Bus 발행 port(contract-events가 `protocol/events`, `core/events/ports.ts`에 둔다. S1 7장 "남지 않는 event")
  - 내놓는 것
    - `core/config/mod.ts`: `createSettingsStore`, `createSettingsReader`, `settingsListHandler`, `settingsUpdateHandler`. `core/config`는 다른 module을 import하지 않는다.
    - `packages/core/main/daemon/wiring/config.ts`: `Wiring`(core-wiring-split이 만든 `wiring/context.ts`)을 내놓는다. `start`에서 store를 열고 watch를 시작하며, `build`에서 `Built.memory`에 `settings/list`·`settings/update` handler를 낸다. `closeIntake`에서 watch를 닫는다. 선언 목록은 `assembly.ts`(lead)가 각 단위의 선언(lophn-agent, problems, coding 연결 등)을 모아 `WiringContext`의 `settingDeclarations` 칸으로 넘긴다. 다른 module이 읽을 `SettingsReader`는 `WiringContext`의 `settings` 칸으로 낸다. 두 칸을 `context.ts`에 더하는 일은 lead다(보고의 등록할 것).

## 할 일

1. **파일 저장소** `core/config/store.ts` (새 file) — `I3.11#2`, `I3.11#3`
   - `<data root>/settings.json`을 읽어 `settingsFileSchema`로 모양을 보고, 선언 registry로 key와 type을 검사한다. 파일이 없으면 빈 선택이다.
   - 하나라도 틀리면(모르는 key, 틀린 type, 범위 밖 값) 전체 거절이다. 시작할 때 거절되면 선택 없이(모두 기본값) 시작하고, 이미 값을 읽은 뒤의 변경이 거절되면 이전 값을 그대로 쓴다. 거절은 안전한 log(key와 reason뿐, 값 없음)로 남긴다.
   - 쓰기는 key를 정렬해 JSON(들여쓰기 2)으로 임시 파일에 쓰고 rename한다. 실패하면 파일은 그대로다. 사람이 명시한 선택만 쓰고 기본값과 합친 값은 쓰지 않는다. 파일 mode는 0600이다.
   - 파일 watch: 폴더를 watch하고 `settings.json`만 본다. 이벤트는 timer(주입)로 묶어 한 번만 다시 읽는다. 내용 hash가 마지막으로 읽거나 쓴 것과 같으면 무시한다(자기 쓰기에 반응하지 않는다). 읽은 결과의 값이 달라진 key가 있으면 Bus로 `SettingsChanged`(payload `{ keys }`, 값이 달라진 key 목록)를 낸다. `settings/update`가 쓴 뒤에도 같은 event를 한 번 낸다(watch는 자기 쓰기를 무시하므로).
2. **registry** `core/config/registry.ts` 다시 짜기 — `I2.11#1`
   - 입력은 `SettingDeclaration[]`이다. 같은 key가 둘이면 기동을 거절한다. `MESSAGE_KEY_FIELDS`, `affected_features`, `layers`, `apply_at`, `machine_local` 검사는 모두 지운다.
   - `validate(changes)`가 key마다 reason을 낸다: 선언에 없으면 `unknown_key`, zod issue가 `invalid_type`이면 `wrong_type`, `too_small`·`too_big`·`invalid_value`(선택지)면 `out_of_range`, 나머지는 `invalid_value`.
3. **층 처리** — `I2.11#4`
   - 값은 두 층이다: 선언한 기본값과 파일의 선택. `effective(key)` = 파일에 있으면 그 값, 아니면 기본값, 기본값도 없으면 `undefined`. project·Operator 층 agent 설정은 일반 설정이 아니라 agents가 맡는다(여기서 다루지 않는다). `mergeChoices`, `mergeValue`, `unwrapType`, `effectiveSetting`을 지운다.
4. **route handler** `core/config/routes.ts` (새 file) — `I3.11#2`
   - `settingsList`: 선언마다 `{ key, type: z.toJSONSchema(type), default?, chosen? }`. `chosen`은 파일에 있을 때만 싣는다.
   - `settingsUpdate`: `changes`를 모두 검사한 뒤 하나라도 거절이면 아무것도 쓰지 않고 `{ changed: [], rejected }`를 돌려준다. 전부 통과하면 파일을 쓰고 `{ changed: [키...], rejected: [] }`다. 값이 이미 같은 `set`과 이미 없는 `unset`은 `changed`에 넣지 않는다. 거절 결과에 값을 싣지 않는다.
   - 둘 다 `MemoryHandler`다(`core/server/dispatch.ts`). wiring file이 route와 handler를 `memoryRoutes`로 내놓는다.
5. **reader** `core/config/reader.ts` (새 file): `SettingsReader`를 구현한다(`get(declaration)`은 `effective`를 읽어 선언의 type으로 parse한 값, 기본값도 선택도 없으면 `undefined`).
6. **필수 선택이 빈 기능** — `I2.11#5`(참고)
   - 기본값이 없는 선언이 비어 있으면 `get`이 `undefined`를 돌려준다. 그 기능을 시작하지 않을지는 읽는 쪽(lophn-agent run-loop 등)의 몫이다. 이 task는 `settingsList`가 "필수인데 빔"(기본값 없음, `chosen` 없음)을 구별해 주는 것까지다.
7. **shell 선언** `core/config/shell-settings.ts` 다시 짜기 — `I2.11#1`
   - `declareSetting`으로 넷: `shell.theme`(`light|dark|system`, 기본 `system`), `shell.text_size`(`small|default|large`, 기본 `default`), `shell.reading_width`(`narrow|default|wide`, 기본 `default`. 값은 기존 것을 유지하고 화면 라벨만 wireframe의 Standard), `shell.density`(`comfortable|compact`, 기본 `comfortable`). `shell.os_notifications`는 notifications를 걷는 remove-platform과 함께 없어지므로 선언하지 않는다.
   - wording: `settingWordingKey`로 `settings.shell-theme.name`·`.help` 같은 key 여덟을 wording에 더한다. 글은 wireframe `appearance-pane.tsx`의 이름과 설명을 그대로 쓴다.
8. **wiring** — `I3.11#2`: `wiring/config.ts`를 위 "내놓는 것"대로 짓는다. 지금 `core/config/settings.ts`가 다른 module(`lophn-agent/register.ts`, `problems/register.ts`, `server/identity/coding-connection.ts`)을 import해 선언을 모으던 것을 없앤다. 선언은 `ctx.settingDeclarations`로 받기만 한다. core-wiring-split이 `wiring/config.ts`에 옮겨 둔 `SETTINGS_SCHEMA_STEPS` 줄은 이 task가 지운다.
9. **지울 것** — `I1.11#4`, `I1.11#5`, `I1.11#6`
   - `core/config/apply.ts`, `schema.ts`(`SETTINGS_SCHEMA_STEPS`와 `setting_choices`·`setting_revisions`·`settings_state` 표), `toml.ts`, `worker/pipe.ts`, `question-evidence.ts`, `evidence-use.ts`, `settings.ts`, `model.ts`(남는 순수 함수가 없으면 file째), `reads.ts`의 옛 `settingsDefinitionsRead`·`settingsGetRead`·`settingsHistoryRead`.
   - `mod.ts`의 export를 새 모양으로 줄인다.
   - 쓰는 곳이 다른 단위에 있는 export(예: `core/lophn-agent/run-loop/limits.ts`가 쓰는 `resolveRunLimits`의 settings read)는 그 단위가 `SettingsReader`로 옮긴다. 남아 있어 type check가 깨지면 export를 남기고 보고한다(cleanup이 지운다).
   - 옛 settings schema step을 빼면 이미 적용한 step의 content hash가 바뀌어 `checkHistory`가 거절한다. 개발 data(`.dev-data/`)를 지우고 새로 만든다(migration을 만들지 않는다. AGENTS.md 호환성). 보고에 적는다.

- (lead가 더함, screens-workspace-settings가 넘긴 것) Settings 화면이 쓰는데 선언이 없는 key: `coding-agent.default_harness`(null 가능)·`coding-agent.default_model`(문자열), `shell.theme|text_size|reading_width|density`(reading width는 `narrow|default|wide`). 선언 목록에 더한다. `reactions.*`는 `core/approvals/grants/reaction-settings.ts`에 있다. wording 검사가 `settings.<key>.name`을 문장으로 보아 마침표를 요구한다(화면이 떼어 보인다). `tools`의 wording 규칙(`SHORT_PARTS`)에 `name`을 넣고 catalog의 `.name` 값에서 마침표를 뗀다(추가 소유, lead 승인: 그 규칙 file과 `catalog/workspace-settings.ts`의 `.name` 값, `settings/general/`의 마침표 떼기 줄).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "틀린 설정 값은 이유와 함께 거절되고 파일은 그대로다" — `core/config/store_test.ts`. 임시 data root를 쓴다. 표로 돈다: 모르는 key, 틀린 type, 범위 밖 값, 맞는 항목과 틀린 항목을 섞은 update. 기대: `rejected`에 key와 reason이 있고, 파일 byte가 바뀌지 않고, 응답 어디에도 입력한 값이 없다. 같은 준비에서 맞는 update는 파일을 쓰고 `changed`를 낸다.
- 남지 않음: `grep -rn "setting_revisions\|settings_state\|setting_choices\|SettingDefinition\|exportSettingsTOML\|compareAgrees" packages/core/config`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `assembly.ts`의 `WIRINGS`에 config wiring을 넣고, `wiring/context.ts`에 `settings`·`settingDeclarations` 칸을 더하고, 각 단위의 선언을 `settingDeclarations`로 모으기(lead), wording 생성 결과(key 여덟), 루트 `deno.json`의 `@std/toml` 의존 지우기(lead. 쓰는 곳이 더 없는지 확인한다)
- 안 쓰게 된 export: 옛 `settings/definitions`·`get`·`history`·`apply`·`reload` route와 `defineSetting`(protocol. cleanup이 지운다), `SettingsChanged`·`SettingsReloaded`의 옛 정의(`protocol/config/settings.ts`)
- 정한 것: 문서에 답이 없어 정한 것(watch 방식, 거절 때 이전 값 유지, 파일 mode, 선언이 비면 undefined)
- 계약 바꾸기 요청: 선언이나 route 모양에 모자란 것이 있을 때

- (lead가 더함, agent-definition-extensions가 넘긴 것) `shell/renderer/workspace/agents/core-extensions.ts`의 `readGlobalServers`가 옛 `settings/get`을 부른다. 옛 handler를 걷을 때 `settings/list`로 바꾼다(추가 소유, lead 승인: 그 줄). 전역 MCP setting `mcpServersSetting`을 층과 같은 `mcpServerSchema` 배열로 바꾸는 것도 여기서 본다.
- (lead가 더함, coding-agent-session이 넘긴 것) `apps/tickets/coding/settings.ts`가 `coding-agent.default_harness`·`.default_model`을 새로 선언했다. 옛 `defaultHarnessSetting`(`defineSetting`)과 key가 같다. 하나로 합치고 `settingDeclarations`에 넣어 `ctx.peek.settings`가 coding 기본값을 읽게 한다.
- (lead가 더함, agent-definition-register가 넘긴 것) core settings registry(`config/settings.ts`)가 옛 `SettingDefinition`만 받아 새 `declareSetting` 선언을 못 쓴다. registry가 `declareSetting`을 받게 하고, `catalogAutoUpdateSetting`, run 한도 셋, `skillFoldersSetting`, `skillsOffSetting`, `mcpServersSetting`을 새 선언으로 옮긴다.
