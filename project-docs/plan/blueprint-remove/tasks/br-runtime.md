# br-runtime

앱 runtime, supervisor, preview, permissions, usage, mcp와 `core/apps`·`core/main`의 나머지에서 `blueprint`를 걷어낸다. 지역 이름, 주석, 오류 message를 새 이름으로 고치고 permissions의 파생 사실 가족을 `facts`로 끝까지 맞춘다.

- 단위: br-runtime (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/runtime/`
  - `packages/core/apps/preview/`
  - `packages/core/apps/permissions/`
  - `packages/core/apps/usage/`
  - `packages/core/apps/mcp/`
  - `packages/core/apps/packages/{vendor,install_test}.ts`
  - `packages/core/apps/{control,routes,register,ports}.ts`
  - `packages/core/main/app-supervisor/{access,assembly,preview-broker}.ts`
  - `packages/core/main/daemon/wiring/{apps,coding-mcp}.ts`
  - `packages/core/lophn-agent/run-loop/runtime-access.ts`
  - `packages/core/lophn-agent/tools/{app-toolkit,app-tools}.ts`
  - `packages/core/server/mcp.ts`
- 읽을 것:
  - 공통: `project-docs/plan/blueprint-remove/names.md`, `project-docs/plan/blueprint-remove/README.md`
  - architecture: `project-docs/architecture/app-call.md`(선언과 호출 판정, broker), `project-docs/architecture/activation.md`(선언 비교에서 파생 사실이 하는 일)
  - boundary·module: `project-docs/module-catalog.yaml`에서 `packages/core/apps/runtime`, `packages/core/apps/permissions`, `packages/core/main/app-supervisor`를 가진 module
  - 코드: `packages/core/apps/permissions/facts.ts`(옛 `declarations.ts`. `AppFacts`, `CurrentFacts` port), `runtime/entrypoint/main.ts`(번들 폴더에서 `declaration.json`을 읽는 곳)
- 계약:
  - 쓰는 것: `br-move`가 바꾼 이름(`AppDeclaration`, `AppFacts`, `declaration.json`, `declarationCheck`, `loadActiveDeclaration`, port id `apps.permissions.CurrentFacts`).
  - 내놓는 것: 없음. 이름만 바뀐다.

## 할 일

1. 인벤토리(`names.md` "공통 절차" 1). `br-move`의 보고 "넘길 줄"에서 이 lane 몫을 먼저 본다.
2. `runtime/**`(entrypoint `main.ts`·`startup.ts`·`state.ts`·`invoke.ts`·`cap-host.ts`·`control.ts` + test, `control-protocol.ts`, `supervisor/supervisor.ts`): 진입점 deps의 칸 `blueprint`(`deps.blueprint`, `state.blueprint`)를 `declaration`으로 바꾸고 주석("bundle 폴더에서 blueprint를 읽는다")을 고친다. 오류 message도 고친다.
3. `permissions/**`: 파생 사실 가족의 남은 곳(변수 `declarations`, `Pick<AppDeclarations, ...>`의 지역 이름, 주석 "현재 release의 선언", `secret-allowance.ts`의 `source.declarations(app)`, `effective.ts`의 `input.declarations`)을 `facts`로 끝까지 맞춘다. `broker/access.ts`·`model.ts`의 `blueprint` 지역 이름과 주석도 고친다. 이 폴더 안 test 이름도 고친다. 주석의 "blueprint는 해석하지 않는다"는 "선언 내용을 읽거나 해석하지 않는다"처럼 문장을 읽고 고친다.
4. `preview/{model,service}.ts`(+ adapters): `blueprint: Pick<..., "permissions">` 같은 인자 이름과 주석("bundle blueprint의 tool 선언")을 고친다.
5. `usage/users.ts`, `mcp/serve.ts` (+ test), `control.ts`(`declaration.json`을 읽는 곳의 변수와 message), `routes.ts`, `register.ts`, `ports.ts`, `packages/vendor.ts`(주석과 지역 변수), `packages/install_test.ts`(test 제목 "깐 blueprint·cap-store·cap-problem 사본이 ..." → declaration), `main/app-supervisor/{access,assembly,preview-broker}.ts`(`AppBlueprintView`가 이미 `AppDeclarationView`로 바뀌었다. 변수 `blueprint`와 message "blueprint is unavailable"), `main/daemon/wiring/{apps,coding-mcp}.ts`, `lophn-agent`·`server/mcp.ts` 세 file(대개 import만 있었다. 남은 것이 없으면 건드리지 않는다).
6. `packages/core/apps/usage/users_test.ts`가 releases 표를 직접 읽거나 바뀌는 열 이름(`blueprint`, `blueprint_hash`, `declarations`)을 SQL 문자열로 쓰면 고치지 말고 "넘길 줄"에 적는다(`br-release`의 소유가 아니므로 lead가 정한다).
7. 새 이름을 정할 일이 생기면 정하지 말고 보고의 "겹침"에 적는다. 특히 `packages/core/apps/runtime/connect.ts`의 module 안 type `AppFacts`가 permissions의 `AppFacts`와 한 file에서 만나면 안쪽 type 이름을 바꾸고 적는다.

## 끝남

- `deno task check`와 `deno task check:full`이 통과한다.
- 위험 test: 없음. 있는 test(앱 호출 broker 판정, 선언 비교, runtime entrypoint control test, preview 범위)가 그대로 통과한다.
- 남지 않음:
  - `git grep -il blueprint -- packages/core/apps/runtime packages/core/apps/preview packages/core/apps/permissions packages/core/apps/usage packages/core/apps/mcp packages/core/apps/packages/vendor.ts packages/core/apps/packages/install_test.ts packages/core/apps/control.ts packages/core/apps/routes.ts packages/core/apps/register.ts packages/core/apps/ports.ts packages/core/main/app-supervisor/access.ts packages/core/main/app-supervisor/assembly.ts packages/core/main/app-supervisor/preview-broker.ts packages/core/main/daemon/wiring/apps.ts packages/core/main/daemon/wiring/coding-mcp.ts packages/core/lophn-agent/run-loop/runtime-access.ts packages/core/lophn-agent/tools/app-toolkit.ts packages/core/lophn-agent/tools/app-tools.ts packages/core/server/mcp.ts`가 0줄이다.
  - `git grep -nwE "AppDeclarations|CurrentDeclarations|currentDeclarations|declarationsOf|compareDeclarations|releaseDeclarations" -- packages/core`가 0줄이다(옛 이름은 `releases/`와 다른 lane에서도 이미 없어야 한다. 남아 있으면 lane 밖은 "넘길 줄"에 적는다).
  - `git grep -nw declarations -- packages/core/apps/permissions`에 남은 줄은 영어 낱말로서의 "declarations"뿐이고 보고에 이유가 있다.
  - 코어 기동: `project-docs/plan/tools/lead/boot.sh`가 `boot 2 exit 0`을 찍는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없으면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳, `users_test.ts`처럼 lane 밖에서 본 것
- 계약 바꾸기 요청: 없으면 "없음"
- 남은 blueprint 줄, 겹침: `names.md`의 "보고에 더할 것"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
