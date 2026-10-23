# bs-release-probe-reason

blueprint와 앱의 handler가 다를 때 `release.prepare`가 "probe was rejected (409)"만 돌려주는 것을, 빠진 tool과 더해진 tool 이름이 든 reason으로 고친다. 두 번째로 고치는 bug라 진입점의 거절을 지나는 위험 test를 같이 쓴다.

- 단위: apps (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/runtime/entrypoint/control.ts`
  - `packages/core/apps/runtime/entrypoint/control_test.ts`
  - `packages/core/main/app-supervisor/assembly.ts`
  - `tests/e2e/app-release_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/activation.md`(release 준비, handlers 검사)
  - 이슈: `project-docs/issues/activation.md` 첫 항목("지금", "고치려면"의 추천안, "다시 생김")
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/apps`(boundary `apps`), `packages/core/main`(boundary `core`)
  - 계획: `project-docs/plan/bug-sweep/README.md`의 "정한 것"(handler 실패 이유), "위험 test"
- 계약:
  - 쓰는 것: 앱 진입점 control 경로의 응답 모양. 거절은 `{ error: { code, message } }` + HTTP status다(`packages/core/apps/runtime/entrypoint/control-server.ts`가 `handleControl`의 `error`를 그대로 `jsonResponse`로 보낸다).
  - 내놓는 것: 409 본문의 `error.message`가 빠진 tool과 더해진 tool의 이름을 담는다. 본문 모양과 status는 그대로다.

이슈와 코드가 어긋난 곳: 없다. `handleControl`의 `/probe` 갈래(`appToolsMatchBlueprint`), `assembly.ts`의 `probeChild`가 이슈 설명 그대로다. 이슈가 말한 launcher의 이름 비교(`packages/core/apps/preview/launcher.ts`)는 probe가 200일 때만 닿는다는 것도 맞다(이 task는 launcher를 고치지 않는다). 거절의 reason은 `probeChild` → launcher의 `entry.reason.summary` → `previewService.check` → `packages/core/apps/control.ts`의 `prepareFailed("handlers", reason)`로 그대로 간다.

## 할 일

1. **진입점 (`control.ts`).** `appToolsMatchBlueprint`가 불리언 대신 차이를 알려 주게 바꾼다(예: `{ missing: string[]; extra: string[] }`). 빠진 tool은 blueprint에 있고 등록되지 않은 것, 더해진 tool은 등록됐는데 blueprint에 없는 것이다. `/probe`의 409 message를 두 목록으로 만든다. launcher(`packages/core/apps/preview/launcher.ts`, probe가 200일 때의 비교)와 같은 글과 같은 꼴을 쓴다: `declared without a handler: a, b` / `handler not declared: c`를 `; `로 잇고, 각 목록은 이름 5개까지 싣고 넘으면 `and N more`를 붙인다(launcher의 `listed`와 같은 규칙). 앱 process 쪽이 preview 쪽을 import하지 않으므로 `control.ts` 안에 작게 둔다. 비어 있는 쪽은 말하지 않는다. status 409와 code `conflict`는 그대로다.
2. **supervisor (`assembly.ts`의 `probeChild`).** 거절 갈래(`answered.value.status !== 503`)에서 `answered.value.body`가 `{ error: { message: string } }`이면 reason을 `probe was rejected (<status>): <message>`로 만든다(message가 문자열이 아니면 지금 글 그대로). reason에 길이 상한이 없으므로 message는 500자에서 자른다. 401 등 다른 status도 같은 모양이다.
3. **위험 test (새 file `packages/core/apps/runtime/entrypoint/control_test.ts`).** 진짜 `handleControl`을 부른다: `createRuntimeState`(`state.ts`)로 만든 state에 blueprint가 tool 하나(예: `add_item`)를 선언하고 handler는 등록하지 않은 채 `handleControl(state, "/probe", { process_nonce })`를 부르면 409이고 `error.message`에 `add_item`이 있다. `readAppToolPort().register`(`ensureAppToolPort`가 설치)로 다른 tool 하나를 등록해 "더해진" 쪽도 한 번에 본다. 등록은 모듈 전역이라 이 file 안에서만 쓴다. subprocess나 socket은 쓰지 않는다. broker·store는 `as never` 가짜로 충분하다(`/probe`는 쓰지 않는다).
4. **기존 e2e 한 줄 (`tests/e2e/app-release_test.ts`의 `prepare-failed` step).** 이 step은 진짜 core와 앱 process로 `probeChild`까지 지나는데 reason 글을 단정하지 않는다("reason 글은 단정하지 않는다" 주석). 그 주석과 `assert(failed.reason !== "")`를 `assertStringIncludes(failed.reason, "add_item")`로 바꾼다(`dropAddItemHandler`가 지우는 tool이 `add_item`이다). 새 e2e나 새 subprocess test가 아니라 기존 step의 단정 하나다. 돌리는 법: `deno task e2e:deps`를 한 번 돌린 뒤 `deno test --allow-all --no-check tests/e2e/app-release_test.ts`. 이 환경에서 못 돌리면 보고에 적는다(lead가 merge 전에 돈다).
5. 문서는 lead가 고친다(`activation.md`). 이 task는 문서를 고치지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "handler 없는 tool을 선언한 앱의 `/probe`가 409로 거절하고 message에 그 tool 이름이 있다." 진입점의 `handleControl`을 지난다(가짜 probe가 아니다). reason에 싣는 쪽(`probeChild`)은 위 4번의 기존 e2e 단정이 지난다.
- 남지 않음: `grep -rn "registered tool differ" packages tests`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check, e2e를 돌렸는지
- 정한 것: message 모양, 자른 길이
- 무겁게 짠 것 / 알려진 미완 동작 (없으면 "없음")
