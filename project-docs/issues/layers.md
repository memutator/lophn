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
- 동적 app-api tool(`tools/app-tools.ts`, `tools/app-toolkit.ts`, `tools/app-api/input.ts`)과 `tools/runtime-permissions.ts`(`appDirectSocketPaths`), `run-loop/runtime-access.ts`(agent runtime이 여는 route 목록): apps·projects protocol을 직접 쓴다.
- 범용 tool에 샌 domain(`tools/bundles/call.ts`·`tools/call/target.ts`의 `projectList`·`appList`, `tools/file/image.ts`의 `annotationsGet`, `tools/file/read.ts`의 `openableKind`).
- `tools/questions/option-actions.ts`(`appCreate`)는 계획 범위 밖으로 두었다.

`instructions/files.ts`는 숨은 SQL도 있다: `projectFolder`(`project_folders`), `projectOfApp`(`apps.source_path`, `project_folders` join `projects`), project 존재 확인(`projects`). import가 아니라 `tools/check-deps.ts`가 못 본다. `register.ts`와 `models/`의 같은 SQL은 `projects/lookups.ts`·`apps/lookups.ts`를 port로 받게 바꿨는데 이 file은 따로 싣는 reader 팀 module이라 남았다.

영향: role이나 domain을 더하고 바꿀 때 harness의 이 file들도 고쳐야 한다. 면제된 file 안에서는 새 domain 지식이 늘어도 check가 막지 못한다. `instructions/files.ts`는 projects·apps가 표 모양을 바꾸면 type check 없이 실행 때 깨진다(`issues/mistakes.md`의 숨은 SQL과 같은 종류).

고치려면:
- `instructions/files.ts`의 SQL을 `projects/lookups.ts`·`apps/lookups.ts` 읽기 함수로 바꾸고 조립이 꽂는다. `role-ports`와 같은 방법이다(작음).
- `agents/`의 role 표(`BUILTIN_NAMES`, `DEFAULT_PROFILES`, role별 폴더·검증)를 `agent-roles`로 옮기고 harness는 인자로 받는다(중간).
- 동적 app-api tool을 apps domain tool로 옮긴다(중간). call·file tool의 domain 읽기는 hook이나 port로 뺀다(중간).
- 추천: 다음 계획으로 첫째와 둘째를 먼저. `HARNESS_LEFTOVERS`에서 빠진 file은 check가 "목록에서 빼라"고 알린다.
