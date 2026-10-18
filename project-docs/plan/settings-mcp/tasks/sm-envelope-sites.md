# sm-envelope-sites

손으로 짠 command 봉투가 남은 8곳을 `sm-envelope-helper`의 helper로 바꾼다. 화면마다 봉투를 따로 짜서 한 곳의 실수가 설정의 연결 기능 전체를 막았던 일이 다시 없게 한다.

- 단위: sm-envelope (wave 2)
- 선행: sm-envelope-helper
- 소유(이 task만 고친다):
  - `packages/shell/renderer/apps/core-source.ts`
  - `packages/shell/renderer/workspace/contexts/core-source.ts`
  - `packages/shell/renderer/workspace/agents/core-link.ts`
  - `packages/shell/renderer/workspace/agents/core-source.ts`
  - `packages/shell/renderer/workspace/agents/core-grants.ts`
  - `packages/shell/renderer/workspace/agents/core-extensions.ts`
  - `packages/shell/renderer/app-frame/app-detail/core-source.ts`
  - `packages/shell/renderer/app-frame/app-detail/issues/core-source.ts`
  - `packages/shell/renderer/desktop/connection/waiting/decide.ts`
  - `packages/shell/renderer/desktop/launcher/projects/core-source.ts`
- 읽을 것:
  - issue: `project-docs/issues/shell.md`의 "설정 화면의 command가 compare를 빼서 …"(손으로 짠 봉투 11곳)
  - helper: `packages/shell/renderer/command-call.ts`(`commandCall`, `commandBody`, `CommandBody`)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/shell/renderer`(boundary `shell`)
- 계약:
  - 쓰는 것: `sm-envelope-helper`의 `commandCall`·`commandBody`. 각 호출이 부르는 protocol route(아래 표).
  - 내놓는 것: 없음. 화면 동작은 그대로다.

## 할 일

손으로 짠 봉투 11곳 중 앞 task가 3곳(대화 `Env.command`, 설정 `command()`, provider disconnect)을 고쳤다. 남은 8곳은 다음이다. 문자열 `resource`·`method`를 받던 helper는 route를 받는 꼴로 바꾸고, 호출하는 쪽이 route를 넘긴다. idempotency key의 모양(`apps-archive-<uuid>` 등)은 지금 것을 그대로 쓴다.

| file | 지금 | 쓸 route(`packages/protocol/…`) |
|---|---|---|
| `apps/core-source.ts` `setArchived` | `call(core, "command", "archive"\|"unarchive", {…})` | `apps/apps.ts`의 archive·unarchive route |
| `workspace/contexts/core-source.ts` 안의 `command(resource, method, input, compare)` | save_view, terms set·remove, contexts archive·unarchive·rollback | `projects/context-api.ts`의 같은 이름 route |
| `workspace/agents/core-link.ts` `Link.command(resource, method, input, compare)` | 호출처 여섯 | 호출처의 route(아래) |
| `workspace/agents/core-source.ts` | model-favorites change, operators create·change·delete, builtin-agents change, project-model change | `lophn-agent/models.ts`, `lophn-agent/agent-definitions.ts` |
| `workspace/agents/core-grants.ts` | agent_grants set | `approvals/grants.ts` |
| `workspace/agents/core-extensions.ts` | project-extension-settings change | `lophn-agent/mcp-settings.ts` |
| `app-frame/app-detail/core-source.ts` `command()` | activations activate_previous, app_grants revoke | `apps/activation/activation.ts`, `apps/grants.ts` |
| `app-frame/app-detail/issues/core-source.ts` `setState` | problems set_state | `problems/problem-views.ts` |
| `desktop/connection/waiting/decide.ts` | approvals decide(`approvalsDecide`는 이미 import함) | `approvals/requests.ts` |
| `desktop/launcher/projects/core-source.ts` | projects create(재시도 key가 `-${attempt}`), `write()`의 update·archive·unarchive·relink_folder | `projects/project-api.ts` |

route 이름은 `grep -rn 'resource: "<resource>"' packages/protocol`로 찾고 `method`가 맞는 것을 쓴다. 호출마다 compare가 `{}`인지 값이 있는지는 route의 `compare` 선언을 따른다(type이 알려 준다).

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다.
- 위험 test: 없음(guard는 `sm-envelope-helper`의 test가 맡는다. 호출처마다 test를 붙이지 않는다).
- 남지 않음: `grep -rn "idempotency_key" packages/shell tools --include=*.ts --include=*.tsx --exclude-dir=dist --exclude-dir=node_modules`가 `packages/shell/renderer/command-call.ts`의 한 줄뿐이다. `grep -rn "prepared: \[\]" …`도 같다.

## 보고

- 바꾼 file, 통과한 check
- 정한 것: route를 못 찾아 helper 밖에 남긴 호출이 있으면 어디와 왜
- 무겁게 짠 것 / 알려진 미완 동작: 없으면 "없음"
