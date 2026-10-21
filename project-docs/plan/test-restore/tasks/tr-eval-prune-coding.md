# tr-eval-prune-coding

eval에서 coding agent 갈래(driver, metrics, type, runner 분기, `eval:attach`)와 막힌 call·call 재료 길(restore `setup`·`call`·`deliver`, material 종류와 save 종류 `call`, 시나리오 `T19-lophn`·`T19-op`)을 지운다. coding 참가자에 묶였던 idle·stuck 한도를 시나리오마다 정하는 칸으로 옮긴다.

- 단위: eval (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/coding` (폴더째 지운다)
  - `tests/eval/types.ts`
  - `tests/eval/runner/{trial,steps,deps,world,cli,experiment,replay,roots,roots_test,spend,paths}.ts`
  - `tests/eval/restore/{setup,call,deliver}.ts` (지운다)
  - `tests/eval/restore/{mod,save,save_test,manifest,manifest_test,materials_test}.ts`
  - `tests/eval/experiment/parallel/{kind,pool,pool_test}.ts`
  - `tests/eval/experiment/overfit/{terms,overfit_test}.ts`
  - `tests/eval/experiment/assembly/replay.ts`
  - `tests/eval/experiment/variant/prepare.ts`
  - `tests/eval/scenarios/lophn/T19-lophn.scenario.ts` (지운다)
  - `tests/eval/scenarios/operator/T19-op.scenario.ts` (지운다)
  - `tests/eval/materials/calendar-call` (지운다)
- 계약:
  - 쓰는 것: tr-support-app이 옮긴 `tests/support/app/deps.ts`(`experiment/variant/prepare.ts`의 주석과 글이 가리키는 path)
  - 내놓는 것(다른 eval task가 기댄다):
    - `types.ts`에서 `CodingParticipant`, `isCodingAgent`, `codingAgent`, `CodingTrace`, `CodingRecord`, `TrialRecord.coding`, `HarnessId` import가 빠진다. `Scenario.real`은 `Participant[]`다. `Step`에 `deliver`가 없다. `SaveSource`는 `{ kind: "active_app"; app }` 하나이고 `sentCall`이 없다. material 종류에 `call`이 없다. `VersionKind`에 `"guide"`가 없다(나머지 guide 정리는 tr-eval-versions). `HumanSpec`·`ApproveRule`·`HumanRecord`는 건드리지 않는다(tr-eval-human).
    - `Scenario.limits?: { idle_ms?: number; stuck_ms?: number }`. `idle_ms`는 trial t0부터 잰 idle 기다림 상한, `stuck_ms`는 turn이 되지 않은 입력의 한도다. 없으면 지금 기본(각 300 s)이다. App Engineer가 앱을 짓는 시나리오(15~60분)가 이 칸을 쓴다. `experiment/parallel/kind.ts`는 `limits`가 있는 시나리오를 무거운 kind로 센다.
    - `restore/mod.ts`가 `deliverCall`을 내보내지 않고 `call` 재료를 되살리지 않는다.
    - `runner/idle.ts`는 고치지 않는다(tr-eval-human).
    - 등록할 것(lead): `deno.json`의 `eval:attach` task를 지운다.

## 할 일

coding·call·T19 file과 `calendar-call` 재료를 지우고 남은 file에서 그 이름을 쓰는 곳을 걷어 낸 뒤, `Scenario.limits`를 `runner/steps.ts`의 `waitUntilIdle` 인자와 parallel kind에 잇는다.
