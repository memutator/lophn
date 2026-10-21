# tr-eval-calendar-build

calendar-user와 calendar-dev를 App Engineer가 직접 설계하고 짓는 흐름으로 다시 쓴다. `app-design` judge는 App Engineer가 쓴 `DESIGN.md`의 Journeys와 Screens를 사람 요청과 견주게 바꾸고, 첫 `release.prepare` 전에 source root에 일곱 절의 `DESIGN.md`가 있는지 보는 program check를 더한다. ticket을 읽던 `card-covered` 입력은 `DESIGN.md`로 다시 쓴다. 지운 `calendar-call` 재료 대신 캘린더 앱 등록만 되살리는 `app` 재료를 둔다.

- 단위: eval (wave 2)
- 선행: tr-eval-restore, tr-eval-human.
- 소유(이 task만 고친다):
  - `tests/eval/scenarios/calendar/{calendar-user,calendar-dev}.scenario.ts`
  - `tests/eval/scenarios/calendar/common.ts`
  - `tests/eval/checks/app/design.ts`
  - `tests/eval/checks/app/design-doc.ts` (새 file)
  - `tests/eval/checks/app/{judge-input,mod}.ts`
  - `tests/eval/criteria/{app-design,card-covered}.json`
  - `tests/eval/materials/calendar-blank` (새 file)
  - `tests/eval/registry/criterion/{app-design,card-covered}.json`
  - `tests/eval/registry/scenario/{calendar-user,calendar-dev}.json`
  - `tests/eval/registry/material/calendar-blank.json` (새 file)
- 계약:
  - 쓰는 것: `packages/core/agent-roles/roles/app-engineer/prompt.md`의 `DESIGN.md` 절과 순서(Purpose, Reuse, Model, Journeys, Screens, Tools, Failure branches), tr-eval-prune-coding의 `Scenario.limits`, tr-eval-human의 `ApproveRule`, `tests/eval/checks/app/reuse.ts`(`source`, `git`), tr-eval-restore의 재료 판
  - 내놓는 것(tr-eval-calendar-maintain이 기댄다):

    ```ts
    // tests/eval/checks/app/design-doc.ts
    export const DESIGN_SECTIONS = [
      "Purpose", "Reuse", "Model", "Journeys", "Screens", "Tools", "Failure branches",
    ] as const;
    // pass: App Engineer의 첫 release.prepare 앞에 앱 source root의 DESIGN.md가 있고,
    // 그 글에 DESIGN_SECTIONS가 `## ` 머리로 이 순서대로 있다.
    export function designFirst(id: string, opts: { app: string }): ProgramCheck;
    ```

    - `checks/app/mod.ts`가 `designFirst`, `DESIGN_SECTIONS`를 내보낸다.
    - `appDesignInput(card, app)`(이름 그대로)는 켜진 release commit의 `DESIGN.md`에서 Journeys와 Screens 절을 읽어 judge에 준다. criterion은 `app-design@2`다: 그 종류의 앱이 처음 여는 주 화면을 골랐나, 사람이 한 말의 일을 그 화면에서 하나.
    - `cardCoveredInput`(이름 다시 둔다)은 ticket 대신 `DESIGN.md`를 읽는다. criterion은 `card-covered@4`다.
    - `scenarios/calendar/common.ts`의 `buildAppChecks(card, request)`가 `designFirst`와 `app-design@2`, `card-covered@4`를 싣는다(calendar-maintain도 쓴다).
    - 새 재료 `calendar-blank@1`(kind `app`)은 캘린더 앱(id `app_0000000000000000000000cdr1`)을 등록만 한다.

## 할 일

calendar-user·calendar-dev의 world·참가자·check를 새 흐름으로 다시 쓰고 `design-doc.ts`와 바뀐 judge 입력·criterion을 더해, 두 시나리오의 fixture(right·wrong)와 world 되살리기가 통과하게 한다.
