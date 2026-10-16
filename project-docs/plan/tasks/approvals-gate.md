# approvals-gate

Gate를 순수 함수로 새로 짓고, 그것이 읽는 grant 셋 중 agent grant와 reaction grant, "이 session 동안" 허락 메모리를 만든다. Gate는 `(intent, grants)`를 받아 막음(이유), 실행, 물음 가운데 하나를 돌려준다. IO가 없고, 같은 grant와 같은 intent에는 같은 판정이다. 지금 범용 적용 엔진에 섞인 판정은 고치지 않고 새로 짓는다.

- 단위: approvals (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/approvals/gate/` (새 폴더)
  - `packages/core/approvals/grants/` (새 폴더: agent grant 표, reaction grant 읽기, session 허락 메모리)
- 읽을 것:
  - spec: S2 3·4·5장, 6장의 "이 session 동안"과 "항상" — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`. S8 5·6장(fork·재시작에서 session 허락) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - inventory: `I3.2#1`, `I3.2#3`, `I3.2#4`, `I3.2#5`, `I3.2#11`, `I3.2#12` (`../assignment.md`에서 이 task가 맡은 줄 전부)
  - 결정: `../README.md` 2.5의 B2 줄(위험 test), 3장 #3(Gate는 core 한 곳에서 부른다)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `/home/pyosechang/projects/lophn/project-docs/dev/testing.md`
  - 지금 코드(읽기만): `packages/core/apps/permissions/{effective,model,store}.ts`(앱 grant 범위 비교의 지금 모양), `packages/core/lophn-agent/tool-judgment/model.ts`(옛 판정표. 새로 짓기 위해 읽는다), `packages/core/apps/tickets/{model,commands}.ts`(commands/model 파일 본보기)
- 계약:
  - 쓰는 것: `packages/protocol/approvals/`의 `Intent`, `GateVerdict`, `GateGrants`, `AgentGrant`, `AgentGrantEntry`, `ReactionGrant`, `DEFAULT_ASK`, `SETTINGS_EDIT_DEFAULT_ASK`, `REACTION_EVENT_TYPES`, `reactionSettingKey`, `agentGrantsGet`, `agentGrantsSet`. `packages/core/approvals/ports.ts`의 `Gate`, `Grants`, `SessionAllowances`. `packages/protocol/apps/grants.ts`의 `AppGrant`. 설정 선언은 contract-platform의 `declareSetting`(`packages/protocol/config/declaration.ts`)과 `packages/core/config/`의 설정 읽기를 쓴다.
  - 내놓는 것: `gate: Gate`, `createGrants(...)`(`Grants` 구현), `createSessionAllowances()`, `allowanceKey(intent)`, `agentGrantRegistration`(schema step, command, read. approvals-requests가 `registration.ts`에서 합친다), `reactionSettings`(Settings 선언 다섯). `core/approvals/gate/mod.ts`, `core/approvals/grants/mod.ts`로 내보낸다.

## 할 일

1. Gate — `core/approvals/gate/gate.ts`(새), `I3.2#1`, `I3.2#3`, S2 5장
   - `gate(intent, grants)`는 순수 함수다. 시각, 무작위, IO, 전역 상태를 쓰지 않는다. 정규화는 호출자가 이미 했다.
   - 판정 규칙(위에서부터):
     - `reaction`: `grants.reaction[target.event]`가 `off`면 deny(`reaction_off`), `open`이면 run, `ask`면 ask.
     - `activation`: `intent.input`이 contract-releases-problems의 `ActivationComparison`(`packages/protocol/apps/activation/`)이다. `first`가 참이거나 `added_resources`, `added_app_apis`, `loss_steps` 가운데 하나라도 비어 있지 않으면 ask, 모두 비면 run. 막음은 없다. 칸 이름이 다르면 그 file을 열어 쓴다.
     - actor가 `app`인 `app_api`(다른 앱 호출)와 `app_resource`: 앱 grant의 `scope`가 대상을 덮으면 run, 아니면 deny(`not_granted`). `app.call`은 `target.app`과 `commands`에 `target.api`가 들어 있을 때, `net.fetch`는 host와 port 일치, `secret.use`는 name 일치, `fs.*`는 `recursive`와 lexical 포함으로 본다(realpath 처리는 호출자가 끝냈다). 앱 grant는 묻지 않는다.
     - actor가 `agent`인 `app_api`: 그 앱의 `kind: "app"` entry가 없으면 deny(`not_granted`). `apis`에서 그 api가 `excluded`면 deny(`excluded`). 있는 `setting`(`never`/`ask`)이 우선이고 없으면 `DEFAULT_ASK[intent.effect]`로 run 또는 ask.
     - `mcp_tool`: entry(`server`, `tool`)가 없으면 deny(`not_granted`). `setting`이 없으면 `DEFAULT_ASK[effect]`.
     - `agent_call`: entry(`kind: "agent"`, 대상 `CallAgent`가 canonical JSON으로 같은 것)가 없으면 deny(`not_granted`). `setting`이 없으면 `DEFAULT_ASK.read`(묻지 않음).
     - `settings_edit`: entry가 없으면 ask(`SETTINGS_EDIT_DEFAULT_ASK`). "항상"으로 `setting: "never"`가 생기면 run. agent가 자기 grant를 넓히지 못하게 하는 것은 이 규칙이 아니라 `agentGrantsSet`의 actor가 `user`뿐이라는 것이다.
   - 이유 글은 만들지 않는다. 판정 값만 돌려준다.
2. Grants — `core/approvals/grants/`, `I3.2#4`, `I3.2#5`, `I3.2#12`, S2 4장
   - agent grant 표 `agent_grants`: schema step 하나(`id`, `agent`, `entries`(JSON), `updated_at`), `core/approvals/grants/schema.ts`. 개발 DB는 지우고 새로 만든다.
   - command `agentGrantsSet`(통째로 바꾼다)와 read `agentGrantsGet`. 둘 다 contract-approvals의 route 정의를 쓴다. 입력은 `agentGrantSchema`로 검사하고, entries 안 같은 대상이 겹치면 `invalid_input`이다. 사람(`user`) 자격만 부를 수 있다(route의 `actors`). agent, coding agent, 앱 token은 거절된다.
   - 새 release가 app-api를 더하면 더한 것은 효과별 기본값으로 들어오고(`apis`에 없으므로 자동), 사람이 바꿔 둔 것은 그대로다. release에서 빠진 app-api의 override는 지운다(S2 4장). 이 정리는 activation 성공 단계가 부르는 함수 `pruneAgentGrantApis(tx, app, apiNames)`로 내놓는다. 부르는 쪽은 releases-problems다(이 task는 함수만 둔다).
   - 거두면(`agentGrantsSet`으로 entry를 빼면) 그 agent의 다음 호출부터 막힌다. 별도 거두기 command는 없다.
   - "항상"의 효과 `Grants.setAlways(agent, target)`: 그 대상의 agent grant를 `never`로 바꾼다. app-api면 그 앱 entry의 `apis`에 `{ api, setting: "never" }`를 더하거나 바꾸고, MCP tool·agent·settings면 그 entry의 `setting`을 `never`로 둔다(entry가 없던 settings는 새로 만든다). 이 command는 사람이 turn 안 request에서 "항상"을 골랐을 때 approvals-requests가 부른다. 사람 자격으로만 쓰인다.
   - reaction grant: Settings 항목 다섯(`reactionSettingKey(type)`)을 contract-platform의 `declareSetting`(`packages/protocol/config/declaration.ts`)으로 선언해 `reactionSettings`로 내놓는다. 값은 `off` | `open` | `ask`, 기본은 `open`이다. 이름·설명 wording key는 설정 key로 정한 wording key다(Settings › Agents 화면용, `settings.reactions.*`. 화면 문구는 screens-workspace가 쓴다). `Grants.reactionGrant()`는 core 설정을 읽어 `ReactionGrant`를 만든다. 선언 모델이 이 형태를 못 담으면 보고한다. 옛 `defineSetting`은 쓰지 않는다.
   - app grant 읽기 `Grants.appGrants(app)`는 `core/apps/permissions`의 읽기(approvals-app-grants가 만든다)를 쓰는 port다. 이 task는 호출 모양만 `Grants`에 맞추고 구현은 연결 지점(`createGrants`의 `appGrantsOf` 인자)으로 받는다.
3. "이 session 동안" 허락 — `core/approvals/grants/session-allowances.ts`(새), `I3.2#11`, S2 6장, S8 5·6장
   - `createSessionAllowances(): SessionAllowances`. 메모리 `Map<session, Set<key>>`뿐이다. 저장하지 않는다. 프로세스가 끝나면 사라진다.
   - `allowanceKey(intent)`: `app_api`는 앱과 api, `mcp_tool`은 server와 tool, `settings_edit`는 `what`과 `id`로 만든 문자열. 같은 session의 같은 대상만 같은 key다.
   - `clear(session)`은 session이 닫히거나 archive되거나 지워질 때 부른다. fork가 가져가지 않는다(새 session id라 key가 다르므로 자동이다). 되살려도 되돌아오지 않는다.
4. 위험 test
   - `packages/core/approvals/gate/gate_test.ts` 하나, 이름은 "효과별 기본값대로 판정하고 grant 밖은 막는다". fixture 표로 돈다: read·write는 run, external은 ask, `setting: "never"`로 external이 run, `excluded`는 deny, entry 없음은 deny, settings_edit entry 없음은 ask, reaction 세 mode, activation 늘어난 선언 있음은 ask·없음은 run, 앱의 `net.fetch`가 grant 밖이면 deny. 같은 입력에 두 번 불러 같은 답인지도 본다. IO를 쓰지 않으므로 fake가 필요 없다.
   - `agent_grants` 표의 쓰기 경계는 한 줄로 본다: `agentGrantsSet`을 agent 자격으로 부르면 `forbidden`이다. 같은 test file의 마지막 case로 둔다(route `actors` 검사만 쓴다. SQLite를 새로 띄우지 않는다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "효과별 기본값대로 판정하고 grant 밖은 막는다"
- 남지 않음: 없음 (옛 판정표 `tool-judgment/model.ts`의 `judge()`는 approvals-tool-judgment가 지운다. 이 task는 지우지 않는다)

## 보고

- 바꾼 file
- 등록할 것: `packages/protocol/registry.ts`의 `ROUTES`에 `AGENT_GRANT_ROUTES`(contract-approvals가 보고한 것 확인). `wiring/approvals.ts`의 registration 합치기는 approvals-requests가 한다.
- 안 쓰게 된 export: 없음
- 정한 것: `settings_edit` entry가 없으면 run이 아니라 ask(기본 물음). agent grant 표 이름 `agent_grants`. `activation` 판정은 `ActivationComparison`의 `first`와 세 목록으로 본다(S7 6장).
- 계약 바꾸기 요청(wave 3): `Intent`·`GateVerdict`·`AgentGrantEntry` 모양을 바꿔야 하면 여기 적는다
