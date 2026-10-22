# sj-shell-hold-card

승인된 wireframe(`drafts/jobs-hold/`)대로 대기 목록에 `hold` 정책 job의 놓친 차례 card를 더한다. 단추는 [Start now]와 [Skip]이다. 대기 목록은 지금 session snapshot과 activation 동의 둘로 맞추고, job hold는 그 옆의 셋째 read source다. 사람이 wireframe을 승인한 뒤에 띄운다.

- 단위: shell (wave 3)
- 선행: `sj-jobs-wireframe`
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/connection/waiting/`
  - `packages/shell/renderer/desktop/connection/events/waiting-store.ts`
  - `packages/shell/renderer/desktop/connection/events/waiting-store_test.ts`
  - `packages/shell/renderer/desktop/connection/events/snapshots.ts`
  - `tools/wireframes/pages/screens/waiting/`
  - `tools/wireframes/pages/screens/questions.tsx`
  - `tools/wireframes/drafts/jobs-hold/` (지운다)
  - `tools/wireframes/mock/jobs-hold-data.ts` (지운다)
- 읽을 것:
  - 규칙: `AGENTS.md`, `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
  - 승인된 draft(옮길 원본): `tools/wireframes/drafts/jobs-hold/`(`panel.tsx`는 gallery 틀이라 옮기지 않고 `hold-card.tsx`를 옮긴다), `tools/wireframes/mock/jobs-hold-data.ts`. 승인된 모양이 이 brief의 가정(card에 단추 [Skip]·[Start now], 새 묶음, 결정한 뒤 남는 줄 없음)과 다르면 코드를 쓰기 전에 lead에게 보고하고 멈춘다.
  - 계약: `tasks/sj-jobs-contract.md`의 `JobHold`(`{job: JobRecord, job_run: JobRunRecord}`)·route `job.holds`·`job.decide_hold`·`JobChanged`. route 상수는 계약이 정한 `packages/protocol/jobs/jobs.ts`의 export 이름 `jobHolds`·`jobDecideHold`다.
  - architecture: `project-docs/architecture/event.md`("session을 건 조건은 session 없는 event와 맞지 않는다"), `project-docs/architecture/activation.md`의 동의 대기(같은 꼴: 표 + 남지 않는 event + snapshot 읽기)
  - 본보기(코드): `packages/shell/renderer/desktop/connection/events/{waiting-store.ts,snapshots.ts,store.ts,fake-source.ts,waiting-store_test.ts}`(`refreshConsents`, `readActivationConsents`, `syncOnReady`), `desktop/connection/waiting/{waiting-panel.tsx,model.ts,decide.ts,fake-source.ts,waiting.module.css,cards/activation-card.tsx,cards/question-card.tsx,cards/head.tsx}`, `renderer/command-call.ts`의 `commandCall`
  - gallery: `tools/wireframes/pages/screens/questions.tsx`, `pages/screens/waiting/waiting-pages.tsx`(`Over`, `WaitingList`), `mock/drive.ts`
- 계약:
  - 쓰는 것: `sj-jobs-contract`의 read `job.holds`, command `job.decide_hold`, `JobHold`, 남지 않는 event `JobChanged`
  - 내놓는 것: `WaitingEntry`의 새 종류 `{kind: "job_hold", id: <job_run id>, session: null, agent: <job의 creator>, place: <creator의 place>, receivedAt: <job_run.created_at>, hold: JobHold}`. card는 job 제목, 만든 agent, 할 일 요약(agent_run은 받는 agent, tool_run은 앱과 tool, workflow_start는 workflow), 놓친 수와 마지막 차례 시각을 보이고, [Start now]는 `choice: "run_now"`, [Skip]은 `choice: "skip"`을 보낸다.

## 정한 것

- 읽기와 맞추기: `JobChanged`를 받을 때와 처음 읽을 때 `job.holds`로 hold 항목을 통째로 맞춘다(activation 동의와 같은 꼴).
- 앞 차례가 아직 돌아 [Start now]가 `conflict`이면 card는 남고 사유 글이 보인다(core가 줄을 `held`로 남긴다).
- 결정한 항목은 `JobChanged` 뒤 다시 읽을 때 목록에서 빠진다. toast는 더하지 않는다.
- 소유 밖 예외: wording catalog에 key만 더한다. `tools/wireframes/drafts/index.tsx`의 `jobs-hold` 줄은 지운 draft를 가리키던 등록 줄이라 같이 뺀다.
- `job.holds`는 나머지 둘과 따로 읽는다. 지금 `readAll`은 둘 가운데 하나라도 못 읽으면 통째로 맞추지 않는다(읽지 못한 쪽 항목이 지워지지 않게). hold는 같은 규칙으로 묶지 않고, 못 읽으면 지금의 `job_hold` 항목을 그대로 둔 채 나머지만 맞춘다. 이유: 세 번째 읽기를 필수로 묶으면 `job.holds`를 모르는 fake(`events/fake-source.ts`, 이 task의 소유 밖)를 쓰는 기존 test와 gallery 화면이 모두 빈 목록이 된다.
- `JobChanged`는 session이 없는 event라 `WAITING_CONDITION.types`에만 더한다(session 조건과 섞지 않는다. `event.md`). 받으면 `refreshHolds()`로 `job.holds`를 다시 읽어 `job_hold` 항목을 통째로 맞춘다(`refreshConsents`와 같은 꼴: 읽기 실패면 그대로 두고, 성공하면 목록에 없는 항목을 지우고 있는 항목을 더한다).
- 항목 id는 `job_run.id`(`jbr_…`)다. `session: null`, `agent: job.creator`, `place: placeOfAgentRef(job.creator) ?? null`(`protocol/lophn-agent/places.ts`), `receivedAt: job_run.created_at`.
- [Start now]·[Skip]은 `job.decide_hold` command(`commandCall(route, {input: {job_run, choice}, compare: {}, key})`)다. key는 deterministic으로 두지 않고 누를 때마다 `job-hold-${job_run}-${choice}-${crypto.randomUUID()}`다. 같은 key를 core가 이전 결과로 돌려주면 `conflict`로 막힌 뒤 앞 차례가 끝나고 다시 눌러도 옛 `conflict`가 온다.
- 결정한 뒤 남는 줄(settled)과 toast를 더하지 않는다. `SettledState`(allowed·denied·cancelled)는 권한 결정의 말이고, 카드는 `JobChanged` 뒤 다시 읽을 때 빠진다.
- 실패 글: `conflict`는 "앞 차례가 아직 돈다"(card는 남는다), 그 밖은 기존 `waiting.notice.decide-failed`다. `not_found`(agent나 사람이 먼저 지움)는 다시 읽어 card가 사라지게 두고 글은 없다.
- 소유 밖 예외: wording catalog에는 key만 더한다. `waiting.*` key는 `packages/design/wording/catalog/data.ts`에 있다(생성물 `data.placeholders.ts`는 `deno task wording`). 같은 wave의 다른 renderer task와 영역 file이 겹치지 않는다. `tools/wireframes/drafts/index.tsx`의 `// jobs-hold` 주석 줄 아래 import와 spread는 지운 draft를 가리키던 등록 줄이라 같이 뺀다.

## 할 일

1. 승인 확인(위 "읽을 것"). draft page를 `?frame=draft-jobs-hold-list&theme=light` 등으로 열어 지우기 전 기준을 눈으로 본다.
2. 읽기. `events/snapshots.ts`에 `readJobHolds(core)`를 더한다: `readActivationConsents`와 같은 꼴로 `job.holds` read를 부르고 route의 `output.safeParse`로 읽어 `holds`를 돌려주며 실패나 틀린 모양이면 `null`이다.
3. 저장소. `events/waiting-store.ts`:
   - `WaitingEntry`에 `Common & {kind: "job_hold"; hold: JobHold}`를 더한다(`JobHold`는 protocol type).
   - `WAITING_CONDITION.types`에 `"JobChanged"`.
   - `readAll`이 `readJobHolds`도 부르되 `null`이어도 `{snapshots, consents}` 읽기를 막지 않는다(위 "정한 것"). `replace`는 새 목록을 만든 뒤 holds가 읽혔으면 `job_hold` 항목을 새로 채우고, 못 읽었으면 지금의 `job_hold` 항목을 그대로 넣는다(`coding_start`를 보존하는 `starts`와 같은 자리).
   - `apply`의 `case "JobChanged"`: `void refreshHolds(); return;`. `refreshHolds`는 `refreshConsents`를 본떠 쓴다. `jobHold(hold)`는 `consent()`처럼 항목을 만든다.
   - `waiting-store_test.ts`: 고치지 않는다. 기존 case가 그대로 통과해야 한다(fake가 `job.holds`에 unavailable을 돌려주는 상태).
4. 결정. `waiting/decide.ts`에 `decideJobHold(core, entry, choice: "run_now" | "skip")`를 더한다: `commandCall(jobDecideHold, …)`를 보내고 `activationConsent` 분기처럼 `catch(() => null)`, `!reply.ok`면 `{ok: false, code}`, 출력은 route `output.safeParse`로 읽는다. 기존 `WaitingChoice`/`decideWaiting`은 건드리지 않는다.
5. card.
   - `waiting/model.ts`: `cardOf`에 `case "job_hold"`를 더한다(`CardView`에 draft가 보인 칸만 더한다). 제목은 job 제목, 설명은 할 일 요약(`agent_run`은 `agentLabel(action.agent)`, `tool_run`은 `appText(action.app)`와 tool, `workflow_start`는 workflow 이름 — 앱·project는 id뿐이라 `shortId`로 보인다. 기존 activation 카드와 같다), 놓친 수와 마지막 차례 시각은 `formatRelativeTime`으로. `metaOf`가 만든 agent와 place를 이미 보인다.
   - `waiting/cards/job-hold-card.tsx`: draft의 `drafts/jobs-hold/hold-card.tsx`를 옮긴다. `Head`와 `waiting.module.css` class를 그대로 쓴다. 단추는 `Decision`을 쓰지 않고 [Skip](secondary)·[Start now](primary)를 오른쪽 끝에 둔다. 누르는 동안 `busy`, `conflict`면 사유 글을 단추 위에 보이고 card를 남긴다(`QuestionCard`의 `failed` 처리와 같은 꼴).
   - `waiting/waiting-panel.tsx`: `GROUPS`에 `{title: "waiting.label.group-job", kinds: ["job_hold"]}`를 draft가 보인 자리에 더하고, `card()`의 `switch`에 `case "job_hold"`로 `<JobHoldCard entry view core />`. `decider`/`settled.add`는 거치지 않는다.
6. fake. `waiting/fake-source.ts`: `Item`에 hold 항목을 더하고(`JOB_HOLD_AGENT()`, `JOB_HOLD_TOOL()`, `JOB_HOLD_WORKFLOW()`, 앞 차례가 아직 도는 `JOB_HOLD_BLOCKED()`), draft의 `mock/jobs-hold-data.ts` fixture를 protocol `JobHold` type으로 옮긴다(칸 이름이 같으므로 interface만 바꾼다). `createFakeWaiting`이 `read job.holds`와 `command job.decide_hold`를 받는다: blocked 항목의 `run_now`는 `fail("conflict")`, 그 밖은 항목을 빼고 `JobChanged` event를 흘린다. `allItems()`에 hold 하나를 더한다.
7. gallery. `tools/wireframes/pages/screens/waiting/waiting-pages.tsx`에 component(`WaitingJobHolds`, `WaitingJobHoldKinds`, `WaitingJobHoldConflict`)를 더하고 `pages/screens/questions.tsx`에 page `waiting-job-hold-list`·`-kinds`·`-conflict`로 등록한다(`Over`를 쓰고 conflict는 `useDrive`로 [Start now]를 누른다). `allItems()`가 늘었으므로 `new-waiting-list`와 `new-waiting-toasts` description의 개수·묶음 수를 실제와 맞춘다.
8. wording. `catalog/data.ts`에 `waiting.label.group-job`, `waiting.button.start-now`, `waiting.button.skip`, `waiting.notice.job-*`(설명·놓친 수·conflict)를 더한다. 화면 글에 `run`·`claim`·`call`·`grant`를 쓰지 않는다. 먼저 `waiting.*`·`common.*`에 같은 뜻이 있는지 grep한다. `deno task wording`, `deno run --allow-read tools/check-wording.ts`.
9. 걷어내기. `tools/wireframes/drafts/jobs-hold/`, `tools/wireframes/mock/jobs-hold-data.ts`, `drafts/index.tsx`의 `// jobs-hold` 줄 아래 import와 spread.

## 끝남

- `deno task check`와 `deno run -A packages/shell/renderer/build.ts`가 통과하고 `deno task wireframes`가 된다.
- `deno test packages/shell/renderer/desktop/connection/events/waiting-store_test.ts`가 고치지 않고 통과한다.
- gallery의 `waiting-job-hold-*` 세 page가 Light와 Dark에서 draft page(지우기 전에 나란히 대조한다)와 같은 모양으로 그려진다. `waiting-job-hold-conflict`는 [Start now] 뒤 card가 남고 사유 글이 보인다.
- `deno task dev:mock`에서 대기 목록의 job hold card를 [Skip]·[Start now]로 한 번씩 결정하면 card가 빠진다.
- 화면 글이 모두 wording key이고 `deno run --allow-read tools/check-wording.ts`가 통과한다.
- 남지 않음: `grep -rn "jobs-hold" tools packages`가 0줄이다.
- 위험 test: 없음(화면은 test하지 않는다. 있는 `waiting-store_test.ts`는 새 종류를 넣어도 깨지지 않게 둔다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물(`catalog/data.placeholders.ts`)은 이 task가 `deno task wording`으로 만든다. lead가 더할 것은 없다.
- 안 쓰게 된 export: 없음이 기본
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없음이 기본
- 계약 바꾸기 요청: card가 앱·project 이름을 보여야 한다고 승인되면 `JobHold`에 이름이 있어야 한다(지금은 id뿐이라 짧은 id로 보인다)
- **무겁게 짠 것**: 없음이 기본
- **알려진 미완 동작**: card가 앱·project를 이름 대신 짧은 id로 보인다. 결정 직후 남는 줄이 없다.
