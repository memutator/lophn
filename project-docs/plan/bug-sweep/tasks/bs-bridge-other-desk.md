# bs-bridge-other-desk

다른 desk에 있는 terminal 탭이 연 URL이 OS browser로 가지 않고 그 terminal이 있는 desk에 browser 탭으로 열리게 한다. `project-docs/issues/workspace-layout.md`의 "다른 desk에 있는 terminal이 연 URL" 항목을 고친다.

- 단위: shell (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/terminal/use-bridge-open-requests.ts`
  - `packages/shell/renderer/workspace/model.ts`
  - `packages/shell/renderer/workspace/model_test.ts`
  - `packages/shell/renderer/workspace/kinds/host.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/browser-tab.md`(terminal bridge, `bridgeAfter`, ack), `project-docs/architecture/workspace-layout.md`(desk)
  - 이슈: `project-docs/issues/workspace-layout.md`의 해당 항목("지금", "고치려면"의 추천안)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/shell/renderer`(boundary `shell`)
- 계약:
  - 쓰는 것: `TabHost.windowTabs()`(모든 desk의 탭, `kinds/host.ts`), `TabHost.openTab(tab, { after })`, `workspace.tsx`의 `openTab`이 부르는 `openAcrossDesks(desks, tab, isUnsaved, after)`(`workspace/model.ts`).
  - 내놓는 것: `openTab`의 `after`가 다른 desk의 탭을 가리키면 그 desk로 건너가 그 탭 뒤에 연다. 다른 호출자(`workspace/kinds/browser.tsx`의 `{ after: tab.key }`)는 같은 desk라 그대로다.

이슈와 코드가 어긋난 곳: 없다. `openBridgeUrl`이 `allTabs(host.view)`(보이는 desk)에서만 terminal을 찾고, `openAcrossDesks`가 새 탭을 보이는(active) desk에 붙인다. 한 가지 덧붙임: 이슈는 `openAcrossDesks`에 desk를 정하는 인자가 필요하다고 하는데, `openTab`의 `after`(이미 있는 인자)가 desk를 정하게 하면 호출 쪽 인자가 늘지 않는다. 아래가 그 안이다.

## 할 일

1. `model.ts`의 `openAcrossDesks`: `at`을 `deskOfTab(desks, tab.key)`로 구하되 없으면(새 탭) `after !== undefined`일 때 `deskOfTab(desks, after)`를 쓴다. `after`가 있는 desk가 active가 아니면 지금처럼 `active`를 그 desk로 바꾸고 그 view에 `openTabIn(..., after)`로 연다(사용자가 그 desk로 건너가 browser 탭을 본다. 로그인 URL을 열 때 사람이 그 탭을 봐야 하므로 건너가는 것으로 정했다. README가 답하지 않은 선택이라 보고의 "정한 것"에 적는다). `after`가 어디에도 없으면 지금과 같다. 함수 위 주석과 `kinds/host.ts`의 `openTab`의 `after` 설명("그 key의 탭이 있는 칸에서...")에 "탭이 다른 desk에 있으면 그 desk로 건너가 연다"를 더한다.
2. `use-bridge-open-requests.ts`의 `openBridgeUrl`: terminal을 `host.windowTabs()`에서 찾는다(지금 `allTabs(host.view)`). 찾은 terminal이 보이는 desk의 view에 있으면(`allTabs(host.view)`에 같은 key가 있음) 지금처럼 `bridgeAfter(host.view, terminal.key)`를 `after`로 쓰고, 다른 desk에 있으면 `after: terminal.key`로 연다(그 desk의 view를 이 hook이 모르므로 반대쪽 pane 규칙은 쓰지 않는다. 이 한계는 보고에 적는다). 위쪽 주석("이 창에 그 terminal이 있으면 URL을 browser 탭으로 열고 true", "이 창의 terminal이 아니면...")은 "이 창의 어느 desk든"으로 고친다. 반환값 규칙(터미널이 있어 탭을 열면 true)은 그대로다.
3. `model_test.ts`의 `openAcrossDesks` 표(`"다른 자리의 docked 열기"` 줄 근처)에 한 줄: "새 탭이 `after`로 다른 desk의 탭을 가리키면 그 desk가 active가 되고 그 탭 바로 뒤에 열린다." 표 모양에 그대로 맞춘다. 새 test file이나 별도 test는 만들지 않는다(위험 test가 아니다).
4. `deno run -A packages/shell/renderer/build.ts`를 돌려 통과를 확인한다(`check:full`이 renderer build를 보지 않는다).
5. 문서(`browser-tab.md`)는 lead가 고친다. 이 task는 문서를 고치지 않는다.

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다.
- 위험 test: 없음
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 정한 것: 건너가서 연다는 선택, 다른 desk terminal의 `after` 규칙
- 알려진 미완 동작: 다른 desk의 terminal이 두 pane 중 어디에 있어도 바로 뒤에 연다(반대쪽 pane 규칙은 보이는 desk만). 없으면 "없음"
- 무겁게 짠 것 (없으면 "없음")
