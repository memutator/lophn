# ab-coding-tab

coding 터미널 탭과 그 toast가 ticket을 싣지도 보이지도 않게 한다. shell이 launch plan의 `ticket`을 읽지 않게 해서 ab-coding-detach가 protocol에서 그 칸을 지울 수 있게 한다. 화면은 `ui-design` skill로 gallery부터 고치고 문구는 `wording` skill을 따른다(README "화면").

- 단위: coding (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/ipc/terminal.ts`
  - `packages/shell/terminal-host/{coding-types.ts,launch-plan.ts,main.ts}`
  - `packages/shell/renderer/terminal/use-terminal-open-requests.ts`
  - `packages/shell/renderer/app-frame/{app-space.tsx,side-panel.tsx}`
  - `tools/wireframes/mock/app-space/{coding-terminal.ts,data.ts}`
  - `tools/wireframes/pages/screens/app-space.tsx`
  - `packages/design/wording/catalog/`
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "정한 것" 가운데 "연결 장치는 ticket을 모른다"(coding launch는 ticket 대신 call 본문을 첫 prompt로 받는다)와 "화면"
  - 뒤 task: `project-docs/plan/ae-builds/tasks/ab-coding-detach.md`의 "내놓는 것"(wave 2에서 launch plan의 `ticket`을 지우고, 탭 title을 `lophn coding · <harness label>`로 바꾼다)
  - 화면: `.claude/skills/ui-design/SKILL.md`("먼저 알아둘 것": gallery는 renderer component를 fake 통로로 그린다, "확인"), `.claude/skills/wording/SKILL.md`("새 문구 더하는 순서", "손으로 생성물을 고치지 않는다")
  - architecture: `project-docs/architecture/coding-agent.md` 75줄(터미널은 app space의 패널 탭으로 열린다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `coding-agent`, `design`; `project-docs/module-catalog.yaml`의 `packages/shell/ipc`, `packages/shell/terminal-host`, `packages/shell/renderer`, `tools`
  - 코드(줄은 main `dd956b49f`)
    - `packages/protocol/coding-agent/launch-plan.ts` 20-41(`CodingLaunchPlan`), 185(지금 title `lophn coding · <label> · <ticket>`). 읽기만 한다.
    - `packages/shell/ipc/terminal.ts` 110-116(`TerminalCodingSession`, `ticket` 114)
    - `packages/shell/terminal-host/coding-types.ts` 6-15(`CodingPlanView`, `ticket` 10), `launch-plan.ts` 36-43(`ticket: plan.ticket` 39), `main.ts` 149-154(`coding_session`의 `ticket` 152)
    - `packages/shell/renderer/terminal/use-terminal-open-requests.ts` 10(`TerminalOpenRequest.coding`), 36-41(`requestOf`)
    - `packages/shell/renderer/app-frame/side-panel.tsx` 68-76(`PaneTerminal`, `ticket` 75), 177-198(coding toast. `t("app-space.title.coding-opened", { product, ticket })` 181-184)
    - `packages/shell/renderer/app-frame/app-space.tsx` 285-307(`useTerminalOpenRequests`의 `setCoding`, `ticket` 296)
    - wording: `packages/design/wording/catalog/app-space.ts` 216-217(`app-space.title.coding-opened`: "App Engineer opened {product} for ticket {ticket}")
    - gallery: `tools/wireframes/mock/app-space/data.ts` 22-25(`TICKET`, `TICKET_TITLE`. 쓰는 곳은 `coding-terminal.ts`뿐이다), `tools/wireframes/mock/app-space/coding-terminal.ts` 9(import), 18-34(`WORK`), 47-54(`screen`의 ended 장면), 91-97(runtime의 `coding_session.ticket`, `title`), `tools/wireframes/pages/screens/app-space.tsx` 144-157(`new-app-coding-toast`, `new-app-coding-terminal` 설명). 이 mock은 `pages/screens/app-space/space.tsx` 145의 `codingBridge`로 `new-app-coding-toast`, `new-app-coding-terminal`, `new-app-coding-permission`, `new-app-coding-ended`가 같이 쓴다.
- 계약:
  - 쓰는 것: `CodingLaunchPlan`(`packages/protocol/coding-agent/launch-plan.ts`). 이 task는 그 `ticket` 칸을 읽지 않게 할 뿐 고치지 않는다.
  - 내놓는 것:
    - `TerminalCodingSession`(`packages/shell/ipc/terminal.ts`)에 `ticket`이 없다. terminal host는 `plan.ticket`을 읽지 않는다.
    - renderer의 coding 탭 상태(`side-panel.tsx`, `app-space.tsx`, `use-terminal-open-requests.ts`)에 ticket이 없다. 탭 이름은 지금처럼 launch plan의 `title`이다.
    - wording `app-space.title.coding-opened`는 `{product}`만 받는다(예: "App Engineer opened {product}").
    - gallery의 coding 터미널 mock과 page 설명에 ticket이 없다.

## 할 일

근거: README "연결 장치는 ticket을 모른다"와 "화면"(coding 터미널 탭 제목과 toast의 ticket을 지운다). coding 탭의 나머지 동작(첫 prompt 전달 상태, 끝난 상태, 대기 목록의 coding 항목)은 그대로다. 실제 탭 제목은 core가 launch plan에서 정하므로 ab-coding-detach가 바꾼다. 이 task는 shell이 그 칸을 읽지 않게 하고 gallery를 그 꼴로 맞춘다.

1. gallery부터(`ui-design` skill)
   - `mock/app-space/data.ts`: `TICKET`, `TICKET_TITLE`를 지우고 맡긴 글 하나(예: `TASK = "Round discounted totals to the nearest cent"`)를 둔다.
   - `mock/app-space/coding-terminal.ts`
     - `WORK`: 첫 prompt를 맡긴 글로 바꾼다(예: `> ${TASK}.` 한 줄과 다음 줄 "  Expected 42.00, got 41.99 for order 1042."). `Work on ticket …`, "Read it with `lophn ticket show`, claim it, and report when you are done.", "I'll read the ticket first.", `Bash(lophn ticket show …)`, `Bash(lophn ticket claim)`와 그 결과 줄을 지운다. `Read(src/orders/totals.ts)`, `Update(…)` 줄은 둔다.
     - `screen`의 ended 장면: `Bash(lophn ticket report-done)` 줄과 "`${TICKET}` is fixed and reported as complete."를 ticket 없는 끝 줄(예: "● Done. Discounted totals now round to the nearest cent.")로 바꾼다.
     - runtime의 `coding_session`에서 `ticket`을 빼고 `title`을 ab-coding-detach가 만들 꼴인 `"lophn coding · Claude Code"`로 바꾼다.
   - `pages/screens/app-space.tsx`: `new-app-coding-toast` 설명의 "App Engineer가 ticket을 맡기자"를 "App Engineer가 일을 맡기자"로, `new-app-coding-terminal` 설명의 "harness 아이콘과 ticket이 탭 이름이고"를 "harness 아이콘과 launch plan의 title이 탭 이름이고"로 고친다. page id는 바꾸지 않는다(ui-design "새 화면 만들기" 5).
2. shell ipc와 terminal host
   - `ipc/terminal.ts`: `TerminalCodingSession`에서 `ticket`을 지운다.
   - `terminal-host/coding-types.ts`의 `CodingPlanView.ticket`, `launch-plan.ts`의 `ticket: plan.ticket`, `main.ts`의 `coding_session.ticket`을 지운다. host가 protocol `codingLaunchPlanSchema`로 plan을 검사하는 것은 그대로다. schema는 wave 2까지 `ticket`을 요구하지만 host는 읽지 않을 뿐이다.
   - shell main(`packages/shell/main/terminal/coding/requests.ts` 131)은 `coding_session`의 `session`만 읽는다. 고칠 것이 없다.
3. renderer
   - `use-terminal-open-requests.ts`: `TerminalOpenRequest.coding`과 `requestOf`에서 `ticket`을 지운다.
   - `side-panel.tsx`: `PaneTerminal.ticket`을 지우고 toast를 `t("app-space.title.coding-opened", { product: coding.tab.product })`로 부른다.
   - `app-space.tsx`: `setCoding`의 `ticket`을 지운다.
4. wording(`wording` skill)
   - `catalog/app-space.ts`의 `app-space.title.coding-opened` 값을 "App Engineer opened {product}"로 바꾼다. key 이름은 그대로다.
   - catalog에서 이 task가 고치는 것은 `app-space.ts`와 그 생성물 `app-space.placeholders.ts`뿐이다. 같은 wave의 ab-reaction-screen이 `workspace-settings.ts`를 고친다.
   - `deno task wording`으로 placeholders를 다시 만든다(손으로 고치지 않는다). `deno run --allow-read tools/check-wording.ts`를 돈다.

## 끝남

- `deno task check`가 통과한다. renderer를 고쳤으니 `deno run -A packages/shell/renderer/build.ts`도 된다.
- `deno task wireframes`가 되고, gallery `new-app-coding-toast`의 toast가 "App Engineer opened Claude Code"이고, `new-app-coding-terminal`의 탭 이름이 `lophn coding · Claude Code`이며 터미널 글에 ticket이 없다(보는 법은 ui-design "확인").
- 위험 test: 없음. 화면, 문구, IPC 칸 지우기다(`.claude/skills/write-test/SKILL.md` "쓰지 않는 test").
- 남지 않음: `git grep -n -i "ticket" -- packages/shell/ipc packages/shell/terminal-host packages/shell/renderer/terminal packages/shell/renderer/app-frame tools/wireframes/mock/app-space tools/wireframes/pages/screens/app-space.tsx packages/design/wording/catalog/app-space.ts packages/design/wording/catalog/app-space.placeholders.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"(예상: 없음. gallery page를 더하거나 지우지 않는다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(gallery mock의 맡긴 글과 끝 줄의 글)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
