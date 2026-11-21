# mail-hold-card

늦게 온 mail을 대기 목록의 card로 보인다: 누가 어느 기계에서 언제 무엇을 맡겼는지와 [Start now]·[Skip]. job의 hold card와 같은 꼴이고 desktop과 폰에 같이 선다. 다른 기계의 card는 그 기계의 범위로 읽고 정한다(지금 job hold card와 같은 길).

- 단위: mail (wave 2)
- 선행: mail-hold
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/connection/events/{waiting-store.ts,snapshots.ts}`
  - `packages/shell/renderer/desktop/connection/waiting/{decide.ts,model.ts,waiting-panel.tsx,fake-source.ts}`
  - `packages/shell/renderer/desktop/connection/waiting/cards/mail-hold-card.tsx` (새 file)
  - `tools/wireframes/pages/screens/waiting/waiting-pages.tsx`
  - `packages/design/i18n/catalog/{data.ts,mobile-inbox.ts}`
  - `packages/mobile/src/screens/inbox/now.tsx`
  - `packages/mobile/src/screens/home/needs.tsx`
  - `packages/mobile/src/data/{hooks.tsx,ops.ts}`
- flows(줄만 고친다): 대기 목록의 job hold card를 그리는 `ui:` flow(`node tools/flows.ts index`로 `job_hold`를 찾는다)에 mail hold 갈래, 폰 Inbox의 같은 flow
- 읽을 것:
  - 계획 README "정한 것"(늦게 온 mail), roadmap `a2a-multi-device.md` "늦게 온 mail"
  - `project-docs/plan/machine-a2a/tasks/mail-hold.md` "계약"(`mailHolds`, `mailDecideHold`, `mailHoldSchema`, `StateChanged{mail_holds}`, `conflict`·`not_found`의 뜻)
  - architecture: `project-docs/architecture/job.md` 지키는 것 21·24와 "대기 목록의 job card"(`job.holds`를 읽고 `jobs` 변경에 다시 읽는다), `project-docs/architecture/attention.md`
  - 본보기(화면): `packages/shell/renderer/desktop/connection/waiting/cards/job-hold-card.tsx`, `tools/wireframes/pages/screens/waiting/waiting-pages.tsx`, 폰 `packages/mobile/src/screens/inbox/now.tsx`의 `job_hold` 갈래
  - skill: `.claude/skills/ui-design/SKILL.md`
- 계약:
  - 쓰는 것: `mailHolds`, `mailDecideHold`, `mailHoldSchema`(`packages/protocol/lophn-agent/mail.ts`)
  - 내놓는 것: `WaitingEntry`의 새 갈래 `{ kind: "mail_hold", hold: MailHold }`(id는 `<origin>:<mail>`, session null, agent null, workspace는 주소의 workspace를 이 기계의 꼴로 풀 수 있으면 그것이고 아니면 null, receivedAt은 `arrived_at`)

## 할 일

1. `snapshots.ts`에 `readMailHolds(core)`. 읽기가 `not_found`(그 기계의 lophn이 이 route를 모르는 옛 판)면 빈 목록이고, 다른 실패는 null(지금 값을 둔다)이다. job 읽기와 묶지 않는다: mail hold 읽기가 실패해도 job card는 맞춘다.
2. `waiting-store.ts`: `mail_hold` 갈래, `StateChanged`의 change `mail_holds`에 다시 읽기, ready 뒤 snapshot에 더하기. `inboxKey`는 그대로 기계를 붙인다.
3. card(`mail-hold-card.tsx`, `job-hold-card.tsx`를 옮긴다): 머리는 "<from.name> on <computer>"와 받을 agent(주소의 agent handle이나 session), 그 아래 맡긴 글(`text`), "Sent <상대 시각> · arrived <상대 시각>", [Skip]과 [Start now](`decide.ts`의 `decideMailHold`가 `mailDecideHold`). `conflict`면 "This mail was already decided or has expired."를 두고 다시 읽는다. `not_found`는 글 없이 다시 읽는다. `waiting-panel.tsx`는 job 묶음 옆에 "Mail from other computers" 묶음을 둔다.
4. gallery: `fake-source.ts`에 held mail 둘(다른 기계 하나, 만료가 가까운 것 하나)과 `waiting-pages.tsx`에 그 장면. gallery 코드를 renderer로 옮기고 다시 그리지 않는다.
5. 폰: `now.tsx`에 같은 card(정하기는 그 컴퓨터의 `mail/decide_hold`), `needs.tsx`의 순위 표에 `mail_hold`, `hooks.tsx`·`ops.ts`에 job hold와 같은 결정 길. `cd packages/mobile && npm ci && npm run typecheck && npm test`.
6. 글은 i18n catalog(`data.ts`의 `waiting.*`, 폰은 `mobile-inbox.ts`).

## 끝남

- `npm run check`가 통과하고 renderer build와 폰의 typecheck·test가 통과한다.
- 위험 test: 없음(화면. 결정의 판정은 `mail-hold`의 test가 본다).
- 남지 않음: `grep -rn "kind: \"job_hold\", hold: mail\|job_hold.*mail" packages/shell packages/mobile/src`가 0줄이다(mail hold를 job hold 갈래에 얹지 않았다).
- `npm run wireframes`가 되고 gallery의 waiting page가 mail hold card를 그린다.

## 보고

- 바꾼 file
- 통과한 check(renderer build, 폰 포함)
- 등록할 것: lead가 고칠 목록 file(gallery `pages/index.ts` 등). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
