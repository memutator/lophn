# tr-eval-calendar-maintain

calendar-maintain과 calendar-diagnose를 다시 쓴다. maintain: data가 있는 켜진 앱을 App Engineer가 바꾸고(prepare, preview, activate) 옛 data와 옛 tool이 남는다. diagnose: bug를 터뜨린 뒤 사람이 App Engineer에게 말하고(problem도 reaction도 session을 열지 않는다), App Engineer가 status·logs·invocations를 먼저 읽고 고쳐 올려 같은 호출이 이제 답한다. `root-cause` judge 입력은 ticket 대신 App Engineer의 마지막 답과 고친 commit diff다.

- 단위: eval (wave 2)
- 선행: tr-eval-calendar-build.
- 소유(이 task만 고친다):
  - `tests/eval/scenarios/calendar/{calendar-maintain,calendar-diagnose}.scenario.ts`
  - `tests/eval/scenarios/calendar/{common,spec}.ts`
  - `tests/eval/checks/app/{diagnose,judge-input,mod}.ts`
  - `tests/eval/criteria/root-cause.json`
  - `tests/eval/registry/criterion/root-cause.json`
  - `tests/eval/registry/scenario/{calendar-maintain,calendar-diagnose}.json`
- 계약:
  - 쓰는 것: tr-eval-calendar-build의 `buildAppChecks`, `designFirst`; `tests/eval/checks/app/diagnose.ts`의 live 부분(`BugSpec`, 같은 호출이 이제 `expectAfterFix`로 답한다); App Engineer tool `app.status`, `app.logs`, `app.invocations`; tr-eval-restore의 재료 판
  - 내놓는 것: `rootCauseInput`(이름 다시 둔다)의 입력이 App Engineer의 마지막 답과 고친 commit diff다. criterion은 `root-cause@4`다.

## 할 일

두 시나리오의 죽은 ticket·problem·coding check를 새 흐름의 check로 바꾸고 n을 올려, fixture와 world 되살리기가 통과하게 한다.
