# fix-agent-routes

agent-tools-work(`17674f46`)가 tool을 지었지만 몇 route가 agent 자격을 받지 않거나 없어서 tool이 forbidden이나 `unavailable`로 끝난다. route 계약과 handler에 걸쳐 lead가 fix로 돌린다.

- 단위: agent-tools (wave 3 계약 고침)
- 소유(이 task만 고친다):
  - route 정의의 `actors`: `instructionsGet`, `appConnectSource`, `operatorCreate`, `operatorChange`, `agentDefinitionList`, `agentDefinitionRead`
  - 그 handler의 agent 분기(호출 agent의 place 검사): `core/lophn-agent/agents/commands.ts`·`reads.ts`, `core/apps/`의 `appConnectSource` handler
  - 새 read route `blueprint.check`(protocol `apps/blueprint/`와 core handler)와 `tools/bundles/app.ts`의 그 tool 줄
  - `package.publish`: `protocol/lophn-agent`의 tool 입력(`TOOL_INPUTS`)과 `tools/bundles/package.ts`
- 읽을 것: agent-tools-work 보고(아래), `/home/pyosechang/projects/lophn/project-docs/plan/fixes/README.md`, spec `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md` 4장(tool), `approval.md`(agent principal)
- 계약: 아래 할 일이 정하는 모양.

## 할 일

1. 위 route의 `actors`에 `agent`를 더한다. agent가 부르면 handler가 호출 session의 role·place로 범위를 본다: Operator 만들기·고치기와 정의 읽기는 자기 place(또는 `operatorPlaceAllowed`가 허용하는 place)만, `appConnectSource`는 App Engineer의 자기 앱만, `instructionsGet`은 이미 role 검사가 있다.
2. `blueprint.check` read route: 입력 `{app}`, actor agent(App Engineer)·coding_agent. 앱 source의 blueprint를 평가해 `{errors, warnings, permission_review}`를 돌려준다. 이미 있는 blueprint 평가 함수를 쓴다. tool handler의 `unavailable`을 이 route 호출로 바꾼다.
3. `package.publish`: tool 입력에 `version`, `description`, `guide{purpose, api, examples}`, `permissions`, `tests`를 더하고 `commit`은 앱 source의 HEAD로 채운다. 가장 단순한 쪽으로.
4. route를 registry에 올리는 일은 lead가 한다. 새 route는 보고에 적는다.

## 끝남

- `deno task check:full`이 통과한다. core가 같은 data root로 두 번 떠도 기동 오류가 없다.
- 위험 test: "agent는 자기 place 밖 Operator를 만들거나 고치지 못한다" 1개(이미 `operator-place_test.ts`가 handler 경계까지 보면 새로 쓰지 않는다).

## 보고

- 바꾼 file, 새 route, 계약 바꾸기 요청(없으면 "없음")
