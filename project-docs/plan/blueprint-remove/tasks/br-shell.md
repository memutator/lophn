# br-shell

shell(main, renderer)와 wireframes의 `blueprint` 이름과 글을 걷어낸다. shell 안에서만 쓰는 이름(`Blueprint` interface, `BlueprintSource`, `blueprint-source.ts`, `BlueprintValue`)과 주석, wireframe 예제 글을 선언 이름으로 바꾼다. 화면 모양은 바뀌지 않는다.

- 단위: br-shell (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/`
  - `tools/wireframes/`
- 읽을 것:
  - 공통: `project-docs/plan/blueprint-remove/names.md`, `project-docs/plan/blueprint-remove/README.md`
  - architecture: `project-docs/architecture/app-call.md`(shell의 앱 호출: 입력 검사와 선언한 tool만 core로 보낸다)
  - boundary·module: `project-docs/module-catalog.yaml`에서 `packages/shell/main/app-frame`을 가진 module
  - 코드: `packages/shell/main/app-frame/app-call.ts`, `blueprint-source.ts`(core `apps/tools` read로 고정 release의 선언을 읽는다)
- 계약:
  - 쓰는 것: core의 읽기 route `apps/tools`의 output(`appTools.output`)은 `br-move`가 이미 새 이름으로 바꿨다(칸 `declarations` → `facts`). shell이 이 output을 `link.read(...)`로 문자열 route와 느슨한 type으로 읽는 곳(`renderer/app-frame/app-views.tsx`, `renderer/workspace/agents/core-grants.ts`, `main/app-frame/blueprint-source.ts`)은 type check가 못 본다. 읽는 칸(`tools`, `screens`, `release`, 그리고 있으면 `declarations`)을 하나씩 확인한다.
  - 내놓는 것: 없음.

## 할 일

1. 인벤토리(`names.md` "공통 절차" 1). 지금 목록: `main/app-frame/{app-call,app-call_test,blueprint-source}.ts`, `main/desktop/{app-window.ts,wiring/app-calls.ts,wiring/app-views.ts}`, `renderer/app-frame/app-views.tsx`, `renderer/apps/{core-source,source}.ts`, `renderer/desktop/entry.tsx`, `renderer/workspace/{agents/core-grants.ts,app-panel-tab.tsx,visuals/registry.ts}`, wireframes 5개(`build.ts`, `pages/kit/app-ui/{index,order-actions,page}.tsx`, `pages/kit/input/orders-filters.tsx`).
2. `main/app-frame/blueprint-source.ts` → `declaration-source.ts` (`git mv`). 이름은 파생 규칙대로: `createBlueprintSource` → `createDeclarationSource`, `BlueprintSource` → `DeclarationSource`, `BlueprintRead` → `DeclarationRead`, `readBlueprint` → `readDeclaration`, shell main의 좁은 interface `Blueprint`(main이 쓰는 tool 선언 부분) → `AppDeclaration`, `app-call.ts`의 deps 칸 `blueprint` → `declaration`, 캐시 Map `blueprints` → `declarations`. 한 file에서 `AppDeclaration`이 둘이 되거나 `declarations`가 파생 사실(`facts`)과 헷갈리면 그 자리를 바꾸지 말고 "겹침"에 적는다. 오류 message `"blueprint is not available"` → `"declaration is not available"`.
3. `main/desktop/wiring/{app-calls,app-views}.ts`, `main/desktop/app-window.ts`, `renderer/**`의 interface `BlueprintValue` → `DeclarationValue`, 지역 변수 `blueprint` → `declaration`, 주석("blueprint가 full 크기로 선언한 첫 screen")을 "선언이 ... 선언한 첫 screen"처럼 읽고 고친다.
4. wireframes 예제 글: "blueprint command를 버튼으로 두는 ..." 같은 문장을 "앱 선언의 tool"로 읽고 고친다(`pages/kit/app-ui/*`, `orders-filters.tsx`, `build.ts` 주석). 그림 모양, 가짜 data, 문구 key는 바꾸지 않는다.
5. `packages/shell/main/desktop/core/deno.lock`은 손으로 고치지 않는다. `@lophn/blueprint` 한 줄은 lead가 따로 고친다. check가 이 file을 바꿔 놓으면 되돌린다.
6. 화면을 바꾸지 않았지만 renderer build가 되는지 본다: `deno run -A packages/shell/renderer/build.ts`.

## 끝남

- `deno task check`와 `deno task check:full`이 통과한다. `deno run -A packages/shell/renderer/build.ts`가 된다. `deno task wireframes`가 된다.
- 위험 test: 없음. 있는 test(`app-call_test.ts`: 선언하지 않은 tool은 core로 보내지 않는다)가 그대로 통과한다.
- 남지 않음:
  - `git grep -il blueprint -- packages/shell tools/wireframes`가 `packages/shell/main/desktop/core/deno.lock` 한 줄만 남는다(lead가 고친다).
  - `git ls-files packages/shell | grep -i blueprint`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없으면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 없으면 "없음"
- 남은 blueprint 줄, 겹침: `names.md`의 "보고에 더할 것"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
