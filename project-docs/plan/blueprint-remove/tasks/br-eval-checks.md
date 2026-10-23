# br-eval-checks

eval의 check, judge 입력, type, criterion에서 `blueprint`를 걷어낸다. judge 입력의 이름표 `[BLUEPRINT]`를 `[DECLARATION]`으로 바꾸고 criterion `card-covered`의 새 판 @5를 만든다. check id `blueprint-kept`는 `declaration-kept`가 된다.

- 단위: br-eval-checks (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/checks/`
  - `tests/eval/types.ts`
  - `tests/eval/criteria/card-covered.json`
- 읽을 것:
  - 공통: `project-docs/plan/blueprint-remove/names.md`, `project-docs/plan/blueprint-remove/README.md`("정한 것"의 eval 항목)
  - architecture: `project-docs/architecture/eval.md`("버전은 hash로 고정한다", "앱을 짓는 단위는 설계와 근거를 본다", criterion `card-covered`, `tests/eval/checks/app/`)
  - 코드: `tests/eval/checks/app/{reuse,reuse_test,diagnose,judge-input,fixtures}.ts`, `tests/eval/criteria/card-covered.json`(지금 `n: 4`), `tests/eval/versions/registry.ts`의 `registerAuthored`(같은 n의 내용이 바뀌면 거절한다. n을 올려라)
- 계약:
  - 쓰는 것: `br-move`가 바꾼 이름(`appTools`가 읽는 `protocol/apps/declaration/read.ts`, 칸 `facts`, SDK 이름 `@lophn/declaration`, 앱 source의 `lophn.ts`).
  - 내놓는 것: judge 입력의 이름표 `DECLARATION`(`judge-input.ts`의 `{ label: "DECLARATION", ... }`)과 criterion `card-covered@5`의 질문 글이 같은 이름 `[DECLARATION]`을 말한다. check id `declaration-kept`. `br-eval-materials`가 시나리오의 `card-covered@4` 핀을 @5로 올린다.

## 할 일

1. 인벤토리(`names.md` "공통 절차" 1). 지금 목록: `checks/app/{diagnose,fixtures,judge-input,reuse,reuse_test}.ts`, `types.ts`, `criteria/card-covered.json`.
2. `checks/app/judge-input.ts`: 변수 `blueprint`와 이름표 `BLUEPRINT` → `declaration`, `DECLARATION`. 입력 조립의 다른 글은 그대로다.
3. `checks/app/diagnose.ts`: check id `"blueprint-kept"` → `"declaration-kept"`, 주석과 `reason` message(`옛 release ... 의 blueprint를 못 읽음`)를 고친다.
4. `checks/app/reuse.ts`(+ `reuse_test.ts`): `blueprintSdkNames` → `declarationSdkNames`, 앱 source에서 읽는 file 이름 `blueprint.ts`(`git show <commit>:blueprint.ts`, pathspec `:(exclude)blueprint.ts`) → `lophn.ts`, `blueprint.declarations.app_connections` → `facts`를 읽는 새 칸, SDK 이름 목록의 `@lophn/blueprint`(`br-move`가 이미 바꿨다), 주석("선언(blueprint)·연결 선언"), test의 `makeBlueprint`·`@lophn/blueprint` 예문. 이 check는 옛 판 재료(`blueprint.ts`)가 아니라 새 판 재료와 지금 template을 읽는다는 점을 확인한다(재료 @4가 만들어지면 맞는다).
5. `checks/app/fixtures.ts`: `blueprint_hash` fixture 칸(`declaration_hash`)과 변수 이름.
6. `types.ts`: 주석의 "source repo(blueprint 포함)".
7. criterion `card-covered`: `tests/eval/criteria/card-covered.json`의 `n`을 5로 올리고 `question`의 `[BLUEPRINT] is what the finished app declares ...`를 `[DECLARATION] is what the finished app declares ...`로 바꾼다(문장의 "blueprint"는 "declaration"으로 읽는다. 질문의 나머지, verdict 목록, pass는 그대로). `registry/criterion/card-covered.json`의 새 항목은 이 task가 손으로 쓰지 않는다. `br-eval-materials`가 등록한다.
8. 지난 run과의 비교가 끊긴다는 것(check id가 바뀌고 criterion이 @5가 된다)을 보고에 적는다. lead가 changelog에 쓴다.

## 끝남

- `deno task check`와 `deno task check:full`이 통과한다.
- 위험 test: 없음. 있는 test(`reuse_test.ts`, `tests/eval/judge`, `tests/eval/versions`의 test)가 그대로 통과한다.
- 남지 않음:
  - `git grep -il blueprint -- tests/eval/checks tests/eval/types.ts tests/eval/criteria`가 0줄이다.
  - `git grep -n "BLUEPRINT\|blueprint-kept" -- tests/eval ':!tests/eval/runs' ':!tests/eval/registry' ':!tests/eval/scorecards' ':!tests/eval/materials'`이 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(registry는 `br-eval-materials`)
- 안 쓰게 된 export: 없으면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 없으면 "없음"
- 남은 blueprint 줄, 겹침: `names.md`의 "보고에 더할 것"
- 비교가 끊기는 것: check id와 criterion 판
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
