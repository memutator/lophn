# bs-route-string-check

shell(main과 renderer)이 core route를 문자열(resource, method)로 부르는 곳이 protocol의 route 목록에 없는 짝이면 `deno task check`가 막도록 `tools/check-source.ts`에 규칙 하나를 더한다.

- 단위: tools (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/check-source.ts`
  - `tools/check-source_test.ts`
  - `tools/check.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/shell.md` 둘째 항목("지금", "고치려면")
  - boundary·module: `project-docs/module-catalog.yaml`의 `tools`(boundary 없음)
  - 본보기: `tools/check-source.ts`의 기존 규칙 둘(`NUMBERED`·`FORBIDDEN`은 줄 단위 정규식, `checkExternalFetch`는 graph 따라가기와 `*_LEFTOVERS` 표), `tools/deps-imports.ts`의 `readStringSites`(문자열 literal의 자리)
  - 계획: `project-docs/plan/bug-sweep/README.md`의 "정한 것"(깨진 호출을 찾으면)
- 계약:
  - 쓰는 것: protocol의 route 목록. 전체는 `packages/protocol/mod.ts`의 `ALL_ROUTES`다. 다만 사람 화면이 부르는 approvals route 몇 개는 core 등록이 내므로 `ALL_ROUTES`에 없다. shell이 그 둘을 합쳐 쓰는 목록이 `packages/shell/main/desktop/core/routes.ts`의 `SHELL_ROUTES`(`ALL_ROUTES` + `turnRequestDecide` + `AGENT_ASSIGNMENT_ROUTES`)다. 규칙의 기준은 `SHELL_ROUTES`다. route는 `kind`(`read`·`command`·`memory`·`upload`·...), `resource`, `method`를 갖는다(`packages/protocol/base/route.ts`).
  - 내놓는 것: `checkSource`가 돌려주는 `Issue`에 새 rule 이름의 항목이 더해진다.

이슈와 코드가 어긋난 곳: 이슈의 "shell의 문자열 route 호출(resource·method 짝)"을 모으는 일이 단순하지 않다. 지금 shell에는 문자열 호출의 꼴이 여럿 있다. 이 task가 읽어야 하는 꼴(찾아 확인한 것):
- main: `call("read", "apps", "runtime", {...})`, `deps.call("memory", "apps", "call_tool", ...)`, `deps.core.call("memory", "annotations", "send", ...)`, `session.call("read", "projects", "list", ...)`(`app-frame/app-connection.ts`, `app-call.ts`, `annotate.ts`, `desktop/wiring/coding.ts`), `core.internal(kind, resource, method, ...)`·`ctx.coreInternal(...)`·`session.internal(...)`(`secret-input/ipc.ts`, `decision-handle/provider-disconnect.ts`, `desktop/wiring/*.ts`), `core.upload("secrets", "put", ...)`·`session.fileStream("apps", "screen_file", ...)`(kind가 첫 인자가 아니다).
- renderer: `link.read<T>("skills", "read", {...})`·`link.memory<T>("settings", "list", ...)`(`workspace/agents/core-extensions.ts`, `core-source.ts`, `core-grants.ts`, `app-frame/app-detail/core-source.ts`, 제네릭이 줄을 넘기기도 한다). `link.command(route, ...)`는 route 객체를 넘기므로 type이 이미 본다.
- main의 renderer 허용 목록: `packages/shell/main/desktop/core/allowlist.ts`의 `"memory:settings/list"` 같은 문자열도 route 이름이다.
이 목록은 시작점이다. `grep`으로 다시 확인하고 빠진 꼴이 있으면 더한다. 규칙이 읽는 꼴을 `check-source.ts` 주석에 적고, 못 읽는 꼴이 있으면 보고의 "알려진 미완 동작"에 적는다.

## 할 일

1. `tools/check-source.ts`에 규칙 `SHELL_ROUTE`(이름은 worker가 정해도 된다)를 더한다. 대상은 `packages/shell/main`·`packages/shell/renderer`의 `.ts`·`.tsx`(test, `dist`, `node_modules`는 뺀다). 호출의 (resource, method) 짝을 모아 route 목록에 없으면 `Issue`로 낸다. 짝이 같은 resource·method라도 kind가 맞아야 하면 kind까지 본다(kind가 호출에 문자열로 있을 때). 주석과 문자열 안 예시를 호출로 보지 않도록 `codeOnly`나 `readStringSites`를 쓴다. 가장 단순한 모양(정규식 또는 문자열 literal 나열)으로 시작한다.
2. route 목록은 `SHELL_ROUTES`를 import해서 쓴다(`packages/shell/main/desktop/core/routes.ts`가 protocol만 import하므로 도구가 불러도 된다). `tools`가 `packages`를 import해도 되는지는 `tools/check-deps.ts`가 정한다. 막히면 `ALL_ROUTES`와 approvals route(`packages/protocol/approvals/mod.ts`의 `turnRequestDecide`, `AGENT_ASSIGNMENT_ROUTES`)를 직접 import한다. check는 `deno run --allow-read tools/check-source.ts`(`tools/check.ts`의 한 줄)로 돌므로 import가 권한을 더 요구하면 `tools/check.ts`의 그 명령 한 줄에만 필요한 권한을 더한다.
3. 규칙을 지금 저장소에 돌린다(`deno run --allow-read tools/check-source.ts`).
   - **이미 깨진 호출이 나오면 고치지 않는다.** 소유 밖 file(`packages/shell/...`)을 고치지 않고, 나온 줄(file:line, 호출한 짝)을 그대로 보고에 적는다. lead가 fix task로 돌린다. 이때 규칙이 `deno task check`를 막지 않도록 `EXTERNAL_FETCH_LEFTOVERS`와 같은 꼴의 예외 표(이유 한 줄과 함께, 위반이 없어지면 빼라고 알리는 검사 포함)에 그 줄들을 올린다.
   - 깨진 호출이 없으면 예외 표는 두지 않는다.
4. 규칙이 막는지 손으로 확인한다(test를 새로 만들지 않는다. README의 위험 test는 셋뿐이다): 임시 폴더에 `packages/shell/main/x.ts` 같은 file을 만들어 없는 짝(`call("read", "apps", "no_such_method", {})`)과 있는 짝 하나를 두고 `deno run --allow-read tools/check-source.ts <임시 root>`가 없는 짝만 내는지 본다(`check-source.ts`는 root를 인자로 받는다). 임시 폴더는 scratchpad에 만들고 저장소에 남기지 않는다. 기존 `tools/check-source_test.ts`가 깨지면 그것만 맞춘다.

## 끝남

- `deno task check`가 통과한다(규칙이 지금 저장소에서 위반 0이거나, 예외 표에 올린 줄만 있다).
- 위험 test: 없음
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- **이미 깨진 호출**: 예외 표에 올린 줄 목록(없으면 "없음")
- 정한 것: 규칙이 읽는 호출 꼴과 못 읽는 꼴
- 넘길 줄: 깨진 호출을 고칠 fix task 제안
- 무겁게 짠 것 / 알려진 미완 동작 (없으면 "없음")
