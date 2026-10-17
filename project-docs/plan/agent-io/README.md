# 계획: provider 연결, model catalog, tool 결과 크기, chip, coding agent 신호를 고치기

상태: 열었음. brief는 `tasks/`, 상태는 `status.md`(`python3 -I project-docs/plan/tools/status.py agent-io build`). lead는 `project-docs/plan/tools/lead/lead.sh agent-io`가 여는 worktree(branch `plan/agent-io`)에서 돌린다.

## 이 계획

- 목표: 사람이 API key로 cloud provider를 연결해 agent가 model을 부를 수 있게 하고, model catalog가 models.dev에서 갱신되게 하고, 이미지와 shell 출력이 context와 ledger를 터뜨리지 않게 하고, context chip이 agent에게 chip으로 가게 하고, coding agent의 turn 끝 신호를 바로잡는다.
- 재료:
  - `project-docs/issues/platform.md`의 "API key로 provider를 연결해도 쓸 수 있는 provider가 생기지 않는다"(정한 것: `secrets.json` 길로 끝낸다)
  - `project-docs/issues/agent-definition.md`의 catalog, 이미지 base64, shell 출력, `wrapUntrusted` 절
  - `project-docs/issues/shell.md`의 context chip 절
  - `project-docs/issues/coding-agent.md`의 OpenCode `TurnEnded`, 전역 hook `lophn` PATH 절
  - `project-docs/architecture/agent-definition.md`, `project-docs/architecture/coding-agent.md`, boundary-catalog의 `providers`, `models`, `secrets`, `run-loop`, `agent-tools`
- 범위 밖: place 폴더·role 규칙·질문 길·MCP grants(계획 `agent-place`), 앱·release·platform(계획 `app-platform`), codex hook trust, docx 읽기, 새 E2E·subprocess test, 실제 provider 호출.
- 단위(brief가 확정한다):
  - `provider-connect`: core에 `ConnectProvider` handler(`credential: {secret}`), 보호 입력 창이 `secrets/put` 뒤에 intent의 `connect`로 `ConnectProvider`를 부르기, agent runtime의 attach를 `createFileSecretAttach`로 바꾸고 provider endpoint host를 목적지로 허락하기, `RegisterProvider`의 `preparation`과 provider가 쓰던 옛 keychain 코드 지우기.
  - `model-catalog`: 제품 agent runtime이 refresher에 `fetch`를 넘기고, `lophn-agent.model.catalog_auto_update` 설정 값이 `catalog-state.json`의 `auto_update`로 가게 한다.
  - `tool-output`: 이미지(history의 오래된 이미지 조각을 `[image omitted]`로 바꿔 `model_call_input`이 blob 상한 아래에 들게), shell 출력 상한(`limitText`로 24 KiB 근처, 앞뒤 남김, description 맞추기), `wrapUntrusted` 하나로 합치기(`prompt-assembly/input-tags.ts`만 남김). 같은 file(`run-loop/history.ts` 등)은 선행으로.
  - `context-chip`: `sendText`가 chip을 `attached`로 싣고, 열린 session에서도 composer가 chip을 그려 보내고, `ContextChipView`에 context id를 더하고, 열린 PM session 찾는 함수를 하나로.
  - `coding-signal`: `HOOK_EVENT_TABLE.opencode`에서 `session.idle`을 빼고, 개발 실행에서 hook command가 `LOPHN_CLI` 경로를 쓰게.
- 순서(초안): wave 1 모두(서로 다른 file). 같은 file이 나오면 선행으로 묶는다.
- 사람이 정할 것: catalog를 살린다(추천)로 brief를 쓴다. 사람이 "지운다"로 정하면 `model-catalog` brief만 바꾼다.

## 정한 것

1. **provider 연결은 `secrets.json` 길로 끝낸다.** `platform.md`의 정한 것. 옛 keychain 길은 지운다(AGENTS.md "호환성").
2. **이미지는 이슈의 추천대로 둘째(history에서 오래된 이미지 조각 빼기)를 먼저 한다.** 몇 개를 남길지는 brief가 코드를 보고 `model_call_input` blob 상한(16 MiB)과 `MAX_IMAGE_BYTES`로 정한다. `tool_calls.result`에 metadata만 남기는 첫째는 실제로 막히면 한다.
3. **실제 provider를 부르지 않는다.** 확인은 unit test로 한다. process를 건너는 확인은 이 계획이 하지 않는다(E2E는 testing 계획 몫).
4. **새 subprocess·서버 test를 만들지 않는다.** 위험 test는 `write-test` skill대로: secret 값이 목적지 밖으로 안 나간다, shell 출력이 상한을 넘지 않는다.

## 지켜야 할 것(worker brief에 그대로 넣는다)

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.
- protocol을 바꾸면 쓰는 쪽(shell, coding agent CLI)을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- secret 값은 보호 메모리와 전송 직전 attach 밖으로 나가지 않는다(log, event, ledger, model 입력 금지).

## 돌리기 전에

- 계획 `agent-place`, `app-platform`과 같이 돈다. 이 계획이 갖는 곳: `lophn-agent`의 `providers/`, `models/`, `run-loop/{runtime-secret,core-ports,history,untrusted,mod}.ts`, `prompt-assembly/input-tags.ts`, `tools/{shell,file/image.ts,commands.ts}`, `packages/core/secrets`, `main/daemon/wiring/secrets.ts`, `main/agent-runtime/main.ts`, `protocol/lophn-agent`의 provider·secret route, `shell/main/secret-input/`, `shell/renderer`의 settings/providers·conversation·workspace의 chip 부분, `packages/coding-agent`, `protocol/coding-agent/hook-signal.ts`. `run-loop/runtime.ts`, `register.ts`, `agent-roles`는 `agent-place`가 갖는다. 거기를 고쳐야 하면 brief의 "계약 바꾸기 요청"으로 lead에게 올린다.

## lead가 할 일

- merge 때마다 관련 이슈 절을 `issue` skill대로 닫는다.
- 모두 merged면 `architecture/agent-definition.md`, `architecture/coding-agent.md`, `context-component-registry.yaml`을 고치고, changelog 열린 판에 항목을 덧붙이고, 이 폴더를 지운 commit까지 land한다.
