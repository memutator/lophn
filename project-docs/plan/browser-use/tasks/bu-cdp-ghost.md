# bu-cdp-ghost

agent가 다루는 숨은 guest가 사람 화면 위에 비친다. `webview-host.tsx`의 `setDriven`이 숨은 guest를 `z-index: 1`, `opacity: 0.01`로 창 위에 두어서, lead가 창 screenshot을 대비를 올려 보니 사람의 sidebar 위에 agent page("Count up", "typed hidden")가 겹쳐 있었다(before·during diff의 bbox가 (8,13)–(800,587)). 사람 화면에는 agent page가 1px도 비치지 않으면서 guest가 계속 그려지게 고친다.

- 단위: bu-cdp (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/app-frame/webview-host.tsx`(`setDriven`과 숨김 적용 `apply`만)
- 읽을 것:
  - `project-docs/plan/browser-use/tasks/bu-cdp.md`의 13
  - `packages/shell/renderer/app-frame/webview-host.tsx`, `packages/shell/main/browser/agent/driver.ts`(screenshot 기한 8초)
- 계약:
  - 쓰는 것: `setDriven(key, on)`(그대로)
  - 내놓는 것: 없음

## 할 일

1. 숨은 driven guest가 사람 화면에 비치지 않게 둔다. 시도할 것(앞 task에서 `z-index: -1`, `opacity: 0`, 창 밖 + `opacity: 0`은 screenshot이 멈췄다):
   - `opacity: 1` 그대로 마지막 크기를 두고 `clip-path: inset(...)`으로 1px만 남기기(그 1px도 창의 칸 사이 같은 눈에 안 띄는 자리)
   - `opacity: 1`로 창 밖에 두되 1px만 창 안에 걸치기
   - 그 밖에 찾은 길. 무엇을 시도했고 무엇이 되고 안 됐는지 보고에 적는다.
2. 아무것도 안 되면 사람 화면에 비치는 것보다 screenshot이 안 되는 쪽을 고른다. driven guest를 숨기고 그 때 screenshot은 지금처럼 8초 뒤 `unavailable`이다. 그 결과를 보고한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음(화면).
- 진짜 Electron 확인(확인 script, `.dev-data/bu-cdp-ghost/`): 사람이 다른 탭을 보는 채로 agent가 뒤 탭을 열고 `fill`·`screenshot` → agent screenshot에 page가 찍히고, 창 screenshot의 before·during diff가 그 1px 밖에서 0이다(대비를 올린 crop도 붙인다). 숨은 tab의 `screenshot` 시간도 적는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
