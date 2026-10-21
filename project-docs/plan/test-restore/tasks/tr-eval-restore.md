# tr-eval-restore

eval이 켜진 앱 재료(`active_app`)와 package 재료를 공용 helper(`tests/support/app/activate.ts`)로 되살리게 다시 쓴다: `startTestApp`이 재료 source를 core가 깐 source 폴더에 commit하고, 가짜 App Engineer가 `release_prepare`·`release_activate`를 부르고, 사람 자격으로 동의한 뒤 running을 기다린다. 재료 source가 지금 `release.prepare`를 못 지나면 그 재료의 새 판을 만든다.

- 단위: eval (wave 2)
- 선행: tr-support-app, tr-eval-prune-coding.
- 소유(이 task만 고친다):
  - `tests/eval/restore/{active-app,package,apps,env,git,save}.ts`
  - `tests/eval/materials/{notify-app,date-range,calendar-app,calendar-app-bug,calendar-data}`
  - `tests/eval/registry/material/{notify-app,date-range,calendar-app,calendar-app-bug,calendar-data}.json`
  - `tests/eval/scenarios/lophn/L4-new.scenario.ts` (재료 판이 오르면 world만)
  - `tests/eval/registry/scenario/L4-new.json`
- 계약:
  - 쓰는 것: tr-support-app의 `tests/support/app/activate.ts`(`startTestApp`의 `id`·`description`·`sample: false`·`patch`, `deliverRelease`, `approveActivation`, `waitRunning`, `tool`, `appProjectName`, `openAppProject`), `source.ts`(`amendAppSource`), `deps.ts`(`appCoreEnv`)
  - 내놓는 것:
    - `restoreActiveApp(ctx, material)`, `restorePackage(ctx, material)`, `restoreApps`의 이름과 꼴은 그대로다.
    - 재료 새 판을 만들었으면 그 `이름@n` 목록을 보고에 적는다. 그 재료를 world에 쓰는 시나리오(O4, calendar-*)는 그 시나리오를 맡은 task가 world를 올린다.

## 할 일

`active-app.ts`·`package.ts`를 새 helper 위로 다시 쓰고 `env.ts`의 deps path를 고친 뒤, 켜진 앱 재료마다 world 되살리기(`prepareTrialWorld`)가 통과하게 한다.
