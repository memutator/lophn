# fix-call-ask

agent-tools-call(`083e5d26`)의 `call` tool은 command 앞에서 `ToolGate`로 묻는다(lead 결정). 그런데 Router의 `CallGate.authorize`(`main/daemon/wiring/router-registration.ts`)는 grant가 ask이면 늘 `forbidden`(ASK_IN_TX)이라, 사람이 Allow해도 `calls/send`가 `not_allowed`로 닫힌다. 계약을 바꾸지 않고 Router가 "이 turn에서 같은 intent가 이미 허락됐다"를 ledger에서 읽게 한다.

- 단위: router (wave 3 계약 고침)
- 소유(이 task만 고친다): `packages/core/main/daemon/wiring/router-registration.ts`의 `callGate`, 필요하면 `core/approvals/`의 읽기 함수 하나(export만)
- 읽을 것: `core/router/`, `core/approvals/`(turn allow 소비 기록), `core/lophn-agent/tools/bundles/call.ts`·`tools/call/target.ts`(intent 모양: kind `agent_call`, effect `read`, input `{}`), `/home/pyosechang/projects/lophn/project-docs/plan/fixes/README.md`, spec `approval.md`
- 계약: 바꾸지 않는다.

## 할 일

1. `callGate.authorize`가 grant ask를 만나면, 보낸 session의 지금 turn에서 같은 intent(kind `agent_call`, 같은 받는 agent)가 사람 Allow로 결정·소비된 approval이 있는지 tx에서 읽는다. 있으면 허락, 없으면 지금처럼 `not_allowed`.
2. 가장 단순하게 짠다. 새 표나 새 칸을 만들지 않는다. 읽을 길이 없으면 멈추고 보고한다.

## 끝남

- `deno task check:full`이 통과한다. core가 같은 data root로 두 번 뜬다.
- 위험 test: "다른 turn이나 다른 받는 agent에 대한 허락으로는 ask grant의 call이 통과하지 않는다" 1개.

## 보고

- 바꾼 file, 읽은 approval 조건, 계약 바꾸기 요청(없으면 "없음")
