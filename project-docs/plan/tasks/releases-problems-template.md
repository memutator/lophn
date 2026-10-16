# releases-problems-template

새 앱이 시작하는 template(`core/apps/packages/template/`)을 새 계약에 맞춘다. blueprint의 `confirm`·`revert`·`automatic_tasks`·`problem_codes`·`documents`·`agent_context` 칸과 선언한 code마다 실패 경로 test를 요구하던 파일을 걷고, 보고는 이름과 message로 바꾸고, migration 단계 파일은 손실 선언 꼴을 따르고, 이미 있는 폴더에도 빠진 파일만 채워 앱 source를 준비하고, 개발 build도 source map을 낸다.

- 단위: releases-problems (wave 3)
- 선행: `releases-problems-packages`(template은 packages 아래 폴더다), app-calls (blueprint와 app-api의 새 꼴, SDK의 새 app-api 등록 입구, `cap-store`의 새 `Migration`이 main에 들어간 뒤. 이 task가 쓰는 SDK 이름이 거기서 정해진다)
- 소유(이 task만 고친다):
  - `packages/core/apps/packages/template/` (전부)
- 읽을 것:
  - spec: S5 4·6장(app-api 호출 이름, migration과 PRIMARY KEY) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - spec: S7 6장(손실 선언) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/activation.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I2.5#26`, `I2.6#37`, `I3.12#2`(template 개발 build 쪽)
    - 같이 읽되 app-calls 배정인 줄: `I2.7#33`(template의 problem 쪽 fixture·예시. 파일이 이 task 소유다)
  - 결정: `../README.md` 3장 #18(`command` → app-api), #75(손실 선언), #112(source 위치는 source map)
  - 지금 코드: `packages/core/apps/packages/template/{app/**,scaffold.ts,pin.ts,import-map.ts,files.ts,resolve.ts,mod.ts}`, `packages/sdk/blueprint/define.ts`(새 꼴), `packages/sdk/cap-store/store.ts`(`Migration`), `packages/sdk/cap-problem/`
- 계약:
  - 쓰는 것: contract-app-calls의 blueprint 새 칸 이름(`app-api`)과 app-calls가 만든 SDK 앱 쪽 등록 입구. contract-releases-problems-releases의 `migrationOfSql`·`lossOfStepSql`(단계 파일 머리 `-- loss:` 선언). contract-releases-problems-problems의 `ProblemReportCall`(`reportProblem(name, message, details?)`).
  - 내놓는 것: 새 앱 source. `TEMPLATE_HASH`가 새 template의 hash다.

## 할 일

1. `app/blueprint.ts.tmpl` (I2.5#26): 새 `defineBlueprint` 꼴로 다시 쓴다. `confirm`, `revert`, `automatic_tasks`, `problem_codes`, `documents`, `agent_context`를 걷는다. `commands` 이름을 contract-app-calls가 정한 이름(app-api)으로 바꾼다. 의존 선언은 새 `dependencies` 꼴(release 준비가 manifest와 대조한다, I2.7#17)에 맞춘다.
2. `app/src/commands.ts.tmpl`, `app/tests/blueprint_test.ts.tmpl`, `app/tests/items_test.ts.tmpl`, `app/src/screens/items/bridge.ts.tmpl` (I2.5#26): `@lophn/cap-schedule`(wave 1이 지운다)를 쓰던 곳을 app-calls의 SDK 새 입구로 바꾼다. 화면 bridge가 부르는 이름은 새 앱 view bridge(contract-app-calls의 `protocol/shell/app-bridge.ts`)를 따른다. 실패는 `reportProblem(name, message)`로 보고한다.
3. 지운다 (I2.7#33): `app/tests/failure_path_test.ts.tmpl`(선언한 code마다 실패 경로 test), `app/src/wording/en.ts.tmpl`·`placeholders.ts.tmpl`의 `common.problem.*` key, `app/AGENTS.md.tmpl`의 problem code 안내(62행, 72행 근처)와 `confirm`·`revert`·automation 언급. `tests/wording_test.ts.tmpl`이 지운 key를 가리키지 않게 한다.
4. `app/src/items.ts.tmpl`, `app/migrations/0-1.sql.tmpl`: `migrations()`가 단계 파일을 `migrationOfSql`(또는 cap-store가 낸 같은 일을 하는 helper)로 읽어 `Migration`을 만든다. 단계 파일은 PRIMARY KEY가 있는 표만 만든다(예제 표 `item`의 `id integer primary key`는 이미 맞다). 손실이 없는 예제이므로 `-- loss:` 줄은 없다. 머리 주석에 선언 꼴 한 줄을 설명으로 둔다.
5. `app/scripts/build-ui.ts.tmpl` (I3.12#2): 개발 build도 external source map을 낸다(지금은 `minify: true`, source map 없음). release의 `ui-build`가 이미 `sourcemap: "external"`로 만드는 것과 같은 꼴이어야 한다(preview에서 annotation의 source 위치를 같은 방식으로 푼다).
6. `scaffold.ts` (I2.6#37): `scaffoldApp`이 빈 폴더만 받는 규칙(`isEmpty`)을 바꾼다. 이미 있는 폴더에는 있는 파일을 덮지 않고 빠진 파일만 채운다(맡기기 순서 3에서 불린다). 반환 `files`는 새로 쓴 파일만 담는다. 폴더가 없으면 만든다.
7. `pin.ts`: `TEMPLATE_ROOTS`에서 지운 SDK(`@lophn/cap-schedule` 등)를 빼고 새 입구를 더한다. 그 뒤 `deno.json.tmpl`과 `deno.lock.tmpl`을 같이 맞춘다. lock 항목은 사라진 package의 줄만 지우고, 새로 필요한 pin은 `pin.ts` 위 주석이 말하는 방식으로 만든다(손으로 hash를 짓지 않는다). `TEMPLATE_HASH`는 `templateHash`로 새로 계산한 값으로 바꾼다.
8. `import-map.ts`, `vendor.ts` 관련은 이 task가 건드리지 않는다(`vendor.ts`는 packages 소유). template의 import map이 가리키는 지원 package 이름이 바뀌면 보고에 적는다.
9. 앱 source를 준비하는 쪽 안내(`coding-agent/guides/skills/lophn-build-app`, `sdk/*/guide.md`)는 소유 밖이다. 이 template의 어느 이름이 바뀌었는지를 보고에 적어 coding-agent와 app-calls가 맞추게 한다.
10. (lead가 맞추며 더함) 앱 build가 SDK component 사용 지점에 bundle 위치(`data-lophn-at`)를 싣는다. annotation-core가 source map으로 이 값을 푼다(S9 10장). 그동안 맡은 단위가 없던 일이다.

- (lead가 더함, app-calls-assembly 보고) 지운 route(`apps/blueprint`, `apps/connect`)를 아직 부르는 곳: coding-agent `connection/app-direct.ts`·`connection/app-ops.ts`·`mcp-server/main.ts`·`mcp-server/tools/app-commands.ts`, lophn-agent `tools/app-toolkit.ts`·`tools/app-tools.ts`·`run-loop/runtime-access.ts`·`agents/role-caps.ts`. 각 단위가 `apps/app_api`·`apps/call_api`로 옮기지 않았으면 여기서 본다.

- (lead가 더함, releases-problems-bundle이 넘긴 것) `template/import-map.ts`의 `devImportMap`(`installPart`)이 @me package 경로를 모른다. `apps/packages/install.ts`의 `packageInstallPath`(@me는 `sdk/@me/<part>/<version>`)로 바꾼다. `blueprint/check.ts`가 이 map을 써서 지금 @me package가 풀리지 않는다. `releases/prepare/from-source.ts`의 자체 `stagingImportMap`은 그 뒤 `devImportMap`으로 합칠 수 있으면 합친다.

## 끝남

- `deno task check`가 통과한다. template의 `.tmpl` 파일은 check가 type check하지 않으므로, 새 template을 임시 폴더에 풀어 (`scaffoldApp` 한 번) 그 앱의 `deno check`가 통과하는지 손으로 한 번 돌려 보고 결과를 보고에 적는다.
- 위험 test: 없음
- 남지 않음: `grep -rn "problem_codes\|automatic_tasks\|confirm:\|revert:\|cap-schedule\|agent_context\|CommandRejection" packages/core/apps/packages/template`가 0줄이다(`deno.lock.tmpl` 제외).

## 보고

- 바꾼 file
- 등록할 것: 없음. `TEMPLATE_HASH`가 바뀌면 이를 쓰는 곳(`core/apps/registration`, `main/daemon` wiring의 template 선택)은 값만 읽으므로 확인만 한다.
- 안 쓰게 된 export: `template/mod.ts`가 내보내던 것 가운데 안 쓰게 된 것
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 계약 바꾸기 요청(wave 3): 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다

- (lead가 더함, coding-agent-harness가 넘긴 것) harness install이 앱 source 폴더의 `.lophn/installed.json`에 설치 hash를 남긴다. 앱 template의 `.gitignore`에 `.lophn/`을 넣는다.
