# pt-app-template

앱 template의 `AGENTS.md.tmpl` managed 절이 지금 있는 skill과 tool만 가리키게 고치고, `app-api.ts.tmpl`의 `withStore`가 업무 code의 예외를 `store_unavailable`로 바꾸지 않게 한다.

- 단위: pt-app-template (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/packages/template/app/AGENTS.md.tmpl`
  - `packages/core/apps/packages/template/app/src/app-api.ts.tmpl`
- 읽을 것:
  - 이슈: `project-docs/issues/coding-agent.md`의 "앱 template의 AGENTS.md가 없는 skill과 tool을 가리킨다", `project-docs/issues/problems.md`의 "앱 template의 `withStore`가 업무 code의 예외까지 `store_unavailable`로 바꿔 원인을 지운다"
  - architecture: `project-docs/architecture/coding-agent.md`
  - 맞출 것(읽기만): 배포 skill 이름은 `packages/protocol/coding-agent/harness-adapter.ts`의 `CODING_SKILL_NAMES`(`lophn-build-app`, `lophn-repair` 둘뿐), 진입점의 보고는 `packages/core/apps/runtime/entrypoint/invoke.ts`(`reportCaught`)
- 계약:
  - 쓰는 것: 없음(고정 계약을 바꾸지 않는다)
  - 내놓는 것: 새 앱 source에 깔리는 `AGENTS.md`와 `src/app-api.ts`. 다른 task가 기대는 것은 없다.

## 할 일

1. `AGENTS.md.tmpl`의 `lophn-managed` 절(`<!-- begin lophn-managed -->`~`<!-- end lophn-managed -->`)에서 없는 것을 가리키는 줄을 지운다. 절 밖(`## 파일`, `## 명령`, `## 재사용 기준`)은 건드리지 않는다.
   - "통로와 필요한 배포 skill" 절: `lophn-navigate`·`lophn-save` 줄과 세션 시작 summary(`lophn_session` op `summary`) 줄을 지운다. 가리킬 것은 skill 둘(`lophn-build-app`, `lophn-repair`), 일의 시작은 `lophn ticket show`다.
   - "사람 지시 claim" 절: "목록·summary 읽기는 착수 지시가 아니다"에서 summary를 뺀다(`lophn ticket list` 같은 읽기로 고친다).
   - "설계와 구현의 구별" 절: "작업 저장소의 context glossary를 읽는다(절차는 `lophn-navigate`)" 줄을 지운다.
   - "SDK 확인과 문제 보고" 절: "설치 catalog(`lophn_sdk`)에서 찾고 exact version만 쓴다"를 바꾼다. 내장 SDK의 사용법은 `.lophn/import-map.json`이 가리키는 설치 사본의 `guide.md`를 읽는다. 새 SDK Package나 의존을 더해야 하면 blueprint와 `deno.json`을 직접 고치지 않고 `message send`로 App Engineer에게 청한다(`lophn-build-app` 5단계와 같다. 직접 고치면 `tests/blueprint_test.ts`와 release 준비가 거절한다). 문제 보고 줄은 `@lophn/cap-problem`의 `guide.md`를 따르라고 가리키되 "`reportProblem(name, message)`만 부른다. 이름은 선언하지 않는다"는 지금 말을 지우지 않는다.
2. `app-api.ts.tmpl`의 `withStore`를 고친다. `try`는 `deps.openStore()`와 `ensureSchema(store)`에만 건다. catch에서는 지금처럼 `reportProblem("store_unavailable", …, { api: name })` 뒤 `AppApiRejection("unavailable", …)`를 던진다. `return work(store)`는 `try` 밖이다. 그러면 catch 안의 `error instanceof AppApiRejection` 재던지기가 필요 없으니 지운다. 함수 위 주석을 "저장소를 여는 데 실패하면 …, 업무 일의 예외는 그대로 던져 진입점이 stack과 함께 보고한다"로 맞춘다(왜만 쓴다).

## 끝남

- `deno task check`가 통과한다(`.tmpl`은 check 대상이 아니므로, 고친 `app-api.ts.tmpl`은 눈으로 type을 확인하고 `deno task check:full`의 template 앱 e2e `tests/e2e/app-release_test.ts`가 지나는지 본다).
- 위험 test: 없음(template의 `tests/items_test.ts.tmpl`이 이미 `withStore` 정상 길을 본다. 예외 통과를 보는 test는 이 이슈가 두 번 고친 bug가 아니라 더하지 않는다).
- 남지 않음: `grep -rn "lophn-navigate\|lophn-save\|lophn_session\|lophn_sdk" packages tools`가 template 밖의 정당한 쓰임(있으면 그 file 목록)을 빼고 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 정한 것: SDK 줄과 문제 보고 줄의 최종 문장
- 무겁게 짠 것 / 알려진 미완 동작: 없으면 "없음"
