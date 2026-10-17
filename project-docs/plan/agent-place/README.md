# 계획: agent가 place 폴더에서 일하게 하고, harness에 남은 role·place 규칙을 role 층으로

상태: 열었음. brief는 `tasks/`, 상태는 `status.md`(`python3 -I project-docs/plan/tools/status.py agent-place build`). lead는 `project-docs/plan/tools/lead/lead.sh agent-place`가 여는 worktree(branch `plan/agent-place`)에서 돌린다.

## 이 계획

- 목표: data root 밖 project·앱 source 폴더에서 agent의 file tool과 shell이 돌게 하고(Deno 권한, 같은 turn의 초안 폴더, rewind), place 폴더 목록을 만드는 규칙을 하나로 모은다. 그 위에서 harness(`packages/core/lophn-agent`)에 남은 role·place 규칙을 `packages/core/agent-roles`로 옮기고, 쓰이지 않는 ledger 질문 길을 지우고, Grants에 MCP tool 목록을 채운다.
- 재료:
  - `project-docs/issues/place-session.md`의 두 절(초안 폴더 같은 turn, Deno 권한 place 폴더)
  - `project-docs/issues/layers.md`의 정한 것(25개 file, `extensions/`의 role 층 몫, `instructions/files.ts` SQL)
  - `project-docs/issues/code-health.md`의 "`tools/questions/`의 ledger 질문 길이 쓰이지 않는다"
  - `project-docs/issues/agent-definition.md`의 "외부 MCP tool 이름을 읽는 route가 없어 Grants의 MCP 목록이 빈다"
  - `project-docs/architecture/layers.md`, `project-docs/architecture/place-session.md`, `project-docs/architecture/agent-definition.md`, boundary-catalog의 `lophn-agent`, `agent-roles`, `agent-tools`, `run-loop`
- 범위 밖: 동적 app-api tool과 call·file tool의 domain 읽기(`layers.md`에서 하지 않기로 정함), provider·model·이미지·shell 출력(계획 `agent-io`), 앱·release·platform(계획 `app-platform`), 새 E2E·subprocess test.
- 단위(brief가 확정한다):
  - `place-folders`: place 폴더 목록 규칙 하나(초안 폴더, project Operator 포함)를 `agent-roles`에 두고 turn scope, agent runtime Deno 권한(`run-loop/runtime.ts`의 `placeFolders`), rewind(`main/daemon/rewind-glue.ts`의 `placeFoldersOf`)가 같은 것을 쓴다. `openDraft`가 같은 turn의 scope에 폴더를 더한다. 폴더 목록이 바뀌면 runtime을 다시 띄운다(hosts·MCP가 바뀔 때와 같은 길).
  - `question-path`: `tools/questions/`의 쓰이지 않는 ledger 길을 지운다(`code-health.md`의 "고치려면" 범위 그대로).
  - `mcp-grants`: 서버별 MCP tool 목록(이름, effect, 설명)을 읽는 route 하나와 `shell/renderer/workspace/agents/core-grants.ts`의 `readGrants` 채우기.
  - `role-rules`: `agents/`의 role 표(`BUILTIN_NAMES`, `DEFAULT_PROFILES`, role별 폴더·검증), `places/`·`session/model.ts`·`instructions/files.ts`의 role 분기와 path, `extensions/`의 층 규칙·`<data root>/projects/<id>` path·내장 skill `context-init`·`context-update`를 `agent-roles`로 옮기고 harness는 결과(path, 층 목록, 기본값)를 인자로 받는다. `instructions/files.ts`의 SQL은 projects·apps의 `lookups.ts`로. `HARNESS_LEFTOVERS`에서 빠진 file을 지운다. 크면 여러 task로 나눈다.
- 순서(초안): wave 1 `place-folders`, `question-path`, `mcp-grants`(같은 file은 선행으로). wave 2 `role-rules`(wave 1의 place 규칙 위에서 path 사본을 모은다).
- 사람이 정할 것: 없다.

## 정한 것

1. **place 폴더 목록은 `agent-roles` 한 곳이 만든다.** `place-session.md`의 추천(A를 지금, B를 같이)이다. 목록이 둘이라 이번처럼 어긋났다.
2. **Deno 권한은 열린 place 폴더 전체의 합이다.** agent runtime child는 하나이고 권한은 띄울 때 정해진다. session마다의 범위는 지금처럼 file tool의 scope가 지킨다.
3. **새 subprocess test를 만들지 않는다**(AGENTS.md: 만들기 전에 사람에게 묻는다). 순수 규칙(폴더 목록 계산)은 unit test로 본다. process를 건너는 확인은 이 계획이 하지 않는다(E2E는 testing 계획 몫).
4. **질문 길 지우기는 schema가 바뀐다.** 개발 data는 지우고 새로 만든다(AGENTS.md "호환성").
5. **`role-rules`는 동작을 바꾸지 않는다.** agent가 보는 tool, prompt, place 정보, 정의 file 자리는 전과 같다(harness-domain 계획처럼 role별 snapshot을 전후로 비교한다).

## 지켜야 할 것(worker brief에 그대로 넣는다)

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다. 필요한 값은 composition root(`core/main`)가 넘긴다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

## 돌리기 전에

- 계획 `agent-io`, `app-platform`과 같이 돈다. 이 계획이 갖는 곳: `lophn-agent`의 `run-loop/{runtime,prepare,runtime-access}.ts`, `tools/runtime-permissions.ts`, `tools/questions/`, `agents/`, `places/`, `instructions/`, `session/model.ts`, `extensions/`, `register.ts`, `packages/core/agent-roles`, `main/daemon/rewind-glue.ts`, `main/daemon/wiring/lophn-agent-team.ts`, `protocol/lophn-agent`의 question·MCP grants route, `tools/check-deps.ts`, `shell/renderer/workspace/agents/`. 다른 두 계획은 이 file들을 소유하지 않는다. 겹치는 barrel(`protocol/lophn-agent/mod.ts`, `registry.ts`)은 늦게 merge하는 쪽이 rebase로 합친다.

## lead가 할 일

- merge 때마다 관련 이슈 절을 `issue` skill대로 닫는다.
- 모두 merged면 `architecture/layers.md`, `architecture/place-session.md`, `architecture/agent-definition.md`, boundary-catalog·module-catalog, `context-component-registry.yaml`을 고치고, changelog 열린 판에 항목을 덧붙이고, 이 폴더를 지운 commit까지 land한다.
