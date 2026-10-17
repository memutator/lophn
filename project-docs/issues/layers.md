# layers

core 층과 import 방향(harness, role 층, domain)에 걸린 열린 이슈다. 규칙과 이유는 `project-docs/architecture/layers.md`.

## harness 폴더에 domain protocol import와 role 이름이 25개 file에 남았다

```yaml
kind: defect
modules: [packages/core/lophn-agent, packages/core/agent-roles, packages/core/apps, packages/core/projects, tools]
```

지금: harness와 domain을 나누면서 domain tool 정의는 `apps/agent-tools/`·`problems/agent-tools.ts`로, role 목록·prompt·place 정보·role 규칙이 든 tool은 `agent-roles`로 옮겼다. 그래도 `packages/core/lophn-agent`의 25개 file이 `protocol/{apps,problems,projects,coding-agent}`를 import하거나 role 이름 문자열(`"project_manager"`, `"app_engineer"`, `"operator"`)을 쓴다. `tools/check-deps.ts`의 `HARNESS_LEFTOVERS`가 file마다 이유를 달아 면제하고, 목록 밖의 새 위반만 막는다(rule `harness-domain`). 묶으면:
- agent 정의(`agents/` 10개: `names.ts`의 `BUILTIN_NAMES`, `resolve.ts`의 `DEFAULT_PROFILES`, `store.ts`, `validate.ts`, `inspect.ts`, `reads.ts`, `commands.ts`, `definition-file.ts`, `profile-asset.ts`, `layers.ts`): built-in과 Operator를 role 이름으로 가르고 role별 기본값·폴더를 고른다.
- place와 session(`places/directory.ts`, `places/lifecycle.ts`, `session/model.ts`, `instructions/files.ts`, `register.ts`의 `operatorDirectory`): role별 place 종류와 지침 file 이름을 role 이름으로 푼다.
- 동적 app-api tool(`packages/core/lophn-agent/tools/app-tools.ts`, `packages/core/lophn-agent/tools/app-toolkit.ts`, `packages/core/lophn-agent/tools/app-api/input.ts`)과 `packages/core/lophn-agent/tools/runtime-permissions.ts`(`appDirectSocketPaths`), `run-loop/runtime-access.ts`(agent runtime이 여는 route 목록): apps·projects protocol을 직접 쓴다.
- 범용 tool에 샌 domain(`packages/core/lophn-agent/tools/bundles/call.ts`·`packages/core/lophn-agent/tools/call/target.ts`의 `projectList`·`appList`, `packages/core/lophn-agent/tools/file/image.ts`의 `annotationsGet`, `packages/core/lophn-agent/tools/file/read.ts`의 `openableKind`).

`instructions/files.ts`는 숨은 SQL도 있다: `projectFolder`(`project_folders`), `projectOfApp`(`apps.source_path`, `project_folders` join `projects`), project 존재 확인(`projects`). import가 아니라 `tools/check-deps.ts`가 못 본다. `register.ts`와 `models/`의 같은 SQL은 `projects/lookups.ts`·`apps/lookups.ts`를 port로 받게 바꿨는데 이 file은 따로 싣는 reader 팀 module이라 남았다.

영향: role이나 domain을 더하고 바꿀 때 harness의 이 file들도 고쳐야 한다. 면제된 file 안에서는 새 domain 지식이 늘어도 check가 막지 못한다. `instructions/files.ts`는 projects·apps가 표 모양을 바꾸면 type check 없이 실행 때 깨진다(`issues/mistakes.md`의 숨은 SQL과 같은 종류).

고치려면:
- `instructions/files.ts`의 SQL을 `projects/lookups.ts`·`apps/lookups.ts` 읽기 함수로 바꾸고 조립이 꽂는다. `role-ports`와 같은 방법이다(작음).
- `agents/`의 role 표(`BUILTIN_NAMES`, `DEFAULT_PROFILES`, role별 폴더·검증)를 `agent-roles`로 옮기고 harness는 인자로 받는다(중간).
- 동적 app-api tool을 apps domain tool로 옮긴다(중간). call·file tool의 domain 읽기는 hook이나 port로 뺀다(중간).
- 추천: 다음 계획으로 첫째와 둘째를 먼저. `HARNESS_LEFTOVERS`에서 빠진 file은 check가 "목록에서 빼라"고 알린다.

`extensions/`에도 role 층의 내용이 남았는데 check가 못 본다(import도 role 이름 문자열도 없어 `HARNESS_LEFTOVERS`에 없다):
- MCP server와 skill을 전역(`settings.ts`) → project(`project-settings.ts`의 `<data root>/projects/<id>/extensions.json`, `skills/`) → agent 정의 층으로 겹쳐 고르는 규칙. 앱 place에는 project 층이 없다.
- `<data root>/projects/<id>` path를 `project-settings.ts`·`project-servers.ts`가 문자열로 다시 짠다. 같은 규칙이 `agents/store.ts`의 `placeAgentsFolder`와 `instructions/files.ts`에도 따로 있다.
- PM의 업무 절차인 내장 skill `builtin-skills/context-init`·`context-update`(`protocol/lophn-agent/skill-settings.ts`가 `role: "project_manager"`로 선언). role prompt·guide는 `agent-roles`로 옮겼는데 이 둘은 harness 폴더에 남았다.

정한 것: `instructions/files.ts`의 SQL은 한다. `agents/`의 role 표와 `extensions/`의 층 규칙·project path·내장 skill은 한 묶음으로 `agent-roles`로 옮기고 harness는 결과(path, 층 목록, 기본값)를 인자로 받는다. path 사본이 하나로 모인다. 둘 다 사람이 잃는 동작이 없어, 사람이 잃는 bug(place 폴더 Deno 권한, API key provider 연결, 이미지 base64) 뒤 "role 층 마무리" 계획으로 연다. role이나 place를 바꿀 일이 먼저 오면 당긴다. 동적 app-api tool과 call·file tool의 domain 읽기(셋째)는 하지 않는다: 면제 목록이 새 위반을 막고, 옮겨서 줄어드는 비용이 구체적이지 않다. (agent)
