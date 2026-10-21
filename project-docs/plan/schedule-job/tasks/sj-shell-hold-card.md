# sj-shell-hold-card

대기 목록에 `hold` 정책 job의 놓친 차례 card를 더한다. 단추는 [지금 실행]과 [건너뛰기]다. 지금 대기 목록은 session snapshot(turn request, 질문)과 activation 동의 두 read로 맞추고(`events/waiting-store.ts`), job hold는 그 옆의 셋째 read source로 붙는다. `ui-design` skill로 대기 목록 wireframe부터 고친다.

- 단위: shell (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/design/wording` (key만)
  - `packages/shell/renderer/desktop/connection/waiting/`
  - `packages/shell/renderer/desktop/connection/events/waiting-store.ts`
  - `packages/shell/renderer/desktop/connection/events/waiting-store_test.ts`
  - `packages/shell/renderer/desktop/connection/events/snapshots.ts`
  - `tools/wireframes/pages/screens/waiting/`
  - `tools/wireframes/pages/screens/questions.tsx`
- 읽을 것:
  - 계획: `project-docs/plan/schedule-job/README.md`의 "정한 것"(`hold`는 대기 목록 card로 알리고 사람이 [지금 실행]이나 [건너뛰기])과 "뼈대 검토에서 정한 것"의 "`hold`로 기다리는 줄"(같은 줄에 접기, 제때 온 차례가 `superseded`로 닫기, 도는 중의 [지금 실행]은 `conflict`이고 card가 남는다)
  - roadmap: `project-docs/products/roadmap/headless-schedule.md`의 "놓친 차례"(알림은 꺼졌다 켜져도 대기 목록에 남는다)
  - 가장 닮은 source: activation 동의(`project-docs/architecture/activation.md` "지키는 것": 대기 목록은 `activations.consents`를 읽고 남지 않는 event `ActivationConsentRequested`·`ActivationConsentClosed`로 고친다. 사람의 결정은 command `activation.consent`다). 꺼졌다 켜져도 표에 남아 대기 목록에 다시 뜨는 것도 같다.
  - 낱말: `project-docs/plan/schedule-job/tasks/sj-shell-job-screen.md`의 "내놓는 것"(화면 낱말 "Scheduled job")
  - 계약: `project-docs/plan/schedule-job/tasks/sj-jobs-contract.md`(route 표, `compare`, `jobDecideHold`의 `conflict`)와 코드 `packages/protocol/jobs/jobs.ts`(`JobHold`, `JobRecord`, `JobRunRecord`, `jobHolds`, `jobDecideHold`), `packages/protocol/jobs/values.ts`(`JobAction`), `packages/protocol/events/transient.ts`(`JobChanged`)
  - architecture: `project-docs/architecture/approval.md` "지키는 것"의 "묻는 길"(카드 내용은 program이 만든다, 침묵은 결정이 아니다), `project-docs/architecture/event.md`의 "agent event와 화면"(조건을 건 뒤 ready에 읽는다, session 없는 event는 종류 조건으로만 받는다), `project-docs/architecture/ui-kit.md`의 "gallery가 정본이다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`, `.claude/skills/write-test/SKILL.md`
  - 본보기(화면): `tools/wireframes/pages/screens/questions.tsx`(영역 file), `tools/wireframes/pages/screens/waiting/waiting-pages.tsx`(`Over`, `idOf`), `tools/wireframes/mock/drive.ts`(`useDrive`, `runSteps`, `find`, `click`)
  - renderer(모두 `packages/shell/renderer/desktop/connection/` 아래)
    - `events/waiting-store.ts`(`WaitingEntry`의 다섯 종류 `permission`·`coding`·`question`·`coding_start`·`activation`, `createWaitingStore`의 `readAll`·`replace`·`refreshConsents`·`start`, `WAITING_CONDITION`), `events/snapshots.ts`(`readSessionSnapshots`, `readActivationConsents`), `events/store.ts`(`syncOnReady`), `events/client.ts`(`EventClient.subscribe`), `events/hooks.tsx`(`useWaiting`), `events/waiting-store_test.ts`, `events/fake-source.ts`(읽기만. 모르는 read는 `unavailable`이다)
    - `waiting/waiting-panel.tsx`(`GROUPS` 셋, `SETTLED_MARK`, `decider`, `card()`), `waiting/model.ts`(`cardOf`, `metaOf`, `agentLabel`, `shortId`, `appText`), `waiting/decide.ts`(`SettledState`, `decideWaiting`의 activation 동의 갈래: `commandCall`과 compare, key), `waiting/settled.ts`(`useSettled`), `waiting/cards/head.tsx`, `waiting/cards/permission-card.tsx`(`Facts`), `waiting/cards/coding-card.tsx`(가장 작은 card), `waiting/fake-source.ts`(`Item`, `allItems`, `SETTLED`, `createFakeWaiting`, `id`), `waiting/waiting.module.css`
    - `packages/shell/renderer/command-call.ts`(`commandCall`, `CompareOf`)
  - wording: `packages/design/wording/catalog/data.ts`의 `waiting.*`, `packages/design/wording/rules.ts`의 `INTERNAL_WORDS`(`run`이 들어 있다)
- 계약:
  - 쓰는 것: `sj-jobs-contract`의 read `jobHolds`(`job.holds`), command `jobDecideHold`(`job.decide_hold`), `JobHold`, 남지 않는 event `JobChanged`
  - 내놓는 것: `WaitingEntry`의 새 종류 `{kind: "job_hold", id: <job_run id>, session: null, agent: <job의 creator>, place: <job의 place>, receivedAt: <job_run.created_at>, hold: JobHold}`. card는 job 제목, 만든 agent, 할 일 요약(agent run이면 받는 agent, tool run이면 앱과 tool), 놓친 차례 수와 마지막 차례 시각을 보이고, [지금 실행]은 `choice: "run_now"`, [건너뛰기]는 `choice: "skip"`을 보낸다. `JobChanged`를 받을 때 `job.holds`를 다시 읽어 맞춘다(결정도 commit 뒤 `JobChanged`를 낸다).

## 할 일

지금 대기 목록: `GROUPS`는 셋(권한 요청 `permission`·`coding`·`coding_start`, 질문, 앱 업데이트 `activation`)이다. store는 snapshot과 activation 동의를 `readAll`로 같이 읽어 `replace`로 통째로 맞추고, `ActivationConsentRequested`에는 `refreshConsents`로 동의만 다시 읽는다. 결정한 항목은 닫힘 event(`TurnRequestClosed`, `ActivationConsentClosed`)가 목록에서 뺀다. 결정 뒤 store를 다시 읽게 하는 함수(`refresh`)는 없다. job hold는 이 둘과 따로 읽는 셋째 source다.

근거: README "정한 것"과 "뼈대 검토에서 정한 것", roadmap "놓친 차례", `sj-jobs-contract`의 `JobHold`·`jobHolds`·`jobDecideHold`·`JobChanged`.

아래의 `waiting/`과 `events/`는 `packages/shell/renderer/desktop/connection/` 아래다.

1. wireframe부터 고친다(ui-design skill "새 화면 만들기", "먼저 알아둘 것"). gallery는 renderer를 그대로 그리므로 2~4의 renderer 변경과 한 task에서 한다.
   - `waiting/fake-source.ts`
     - 견본 둘: `JOB_HOLD_AGENT()`(lophn이 만든 job, place 없음, `agent_run`으로 project의 Operator를 부른다, `missed_count` 3, `due_at` 이틀 전)와 `JOB_HOLD_TOOL()`(Project Manager가 만든 job, place project, `tool_run`으로 앱 tool 하나, `missed_count` 1). 값은 `JobHold` 모양 그대로이고 id는 이 file의 `id(prefix, n)`로 만든다(`job`, `jbr`).
     - `Item`에 `JobHold`를 더하고(`"job_run" in item`으로 가른다) `allItems()`에 `JOB_HOLD_AGENT()`를 더한다.
     - `createFakeWaiting(items, options?)`에 `options.holdBusy`를 더한다. `call`이 받는 것:
       - `read` `jobHolds.resource`/`jobHolds.method` → `{ holds }`
       - `command` `jobDecideHold` → 없는 줄은 `not_found`. `holdBusy`이고 `run_now`면 `conflict`(card가 남는다). 그 밖에는 그 hold를 빼고 `JobChanged`(subject job id, payload `{ job_run }`)를 흘린 뒤, state를 `queued`(run_now)나 `skipped`(skip, reason `person`)로 바꾼 `JobRunRecord`를 돌려준다.
     - `SETTLED`에 결정 뒤 줄 둘(started, skipped)을 더한다.
   - `tools/wireframes/pages/screens/waiting/waiting-pages.tsx`
     - `Over`에 fake option을 넘기는 prop을 더한다.
     - `WaitingJobHold`: 두 견본을 세부까지 편 상태(`initial.expanded`).
     - `WaitingJobHoldBusy`: `holdBusy`로 띄우고 `useDrive`로 첫 card의 [Start now]를 누른다. card가 남고 그 아래 "앞 차례가 아직 돈다" 문구가 보인다.
   - `tools/wireframes/pages/screens/questions.tsx`
     - page 둘을 더한다: `new-waiting-job-hold`("Waiting · missed job"), `new-waiting-job-hold-busy`("Waiting · missed job, still going"). title은 영어, description은 한국어 한두 문장이다.
     - 두 page의 description을 맞춘다. `new-waiting-list`는 지금 "세 묶음"(권한 요청, 질문, 앱 업데이트)이라 적혀 있으니 넷째 묶음 "Scheduled jobs"를 더해 적는다. `new-waiting-settled`는 지금 "줄 셋"(허락, 거절, cancelled)이니 시작함(started)과 건너뜀(skipped)을 더해 적는다.
2. store에 셋째 source를 붙인다(계약 "`JobChanged`를 받을 때 `job.holds`를 다시 읽어 맞춘다").
   - `events/snapshots.ts`: `readJobHolds(core): Promise<JobHold[] | null>`. `readActivationConsents`와 같은 꼴로 `jobHolds`를 읽고 output schema로 검사한다.
   - `events/waiting-store.ts`
     - `WaitingEntry`에 `Common & { readonly kind: "job_hold"; readonly hold: JobHold }`를 더한다. 값은 계약 그대로다(`id` = `hold.job_run.id`, `session` null, `agent` = `hold.job.creator`, `place` = `hold.job.place`, `receivedAt` = `hold.job_run.created_at`).
     - job hold는 따로 맞춘다. `start()`에서 둘째 구독 `client.subscribe({ types: ["JobChanged"] }, syncOnReady({ read, replace, apply }))`을 건다.
       - `read`는 `readJobHolds`다.
       - `replace`는 `job_hold` 항목만 모두 빼고 읽은 hold를 `created_at` 순으로 넣은 뒤 `publish()`한다.
       - `apply`는 `JobChanged`를 받으면 다시 읽고 같은 `replace`를 한다.
     - 기존 `replace()`(snapshot과 activation 동의로 통째로 맞추기)가 `job_hold` 항목을 지우지 않게 한다. 지금 `coding_start` 항목(`starts`)을 남기는 것과 같은 방법이다.
     - 결정 뒤 store를 따로 다시 읽지 않는다. `job.decide_hold`가 바꾼 줄은 commit 뒤 `JobChanged`로 오고 위 `apply`가 다시 읽는다. activation 동의가 닫힘 event로 빠지는 것과 같다.
     - `WAITING_CONDITION`은 그대로 둔다.
3. card와 결정을 만든다.
   - `waiting/model.ts`의 `cardOf`에 `job_hold` 갈래를 더한다. 글은 program이 만들고, agent가 쓴 값은 job `title`만 그대로 싣는다(README "job에 `title`을 둔다. 목록과 card에 보일 이름이다").
     - title: job 제목을 넣은 한 줄(`waiting.title.job-hold`)
     - description: 놓친 수(plural)와 마지막 차례의 상대 시각, 지금 시작할지 건너뛸지 고르라는 한 문장(`waiting.notice.job-hold`)
     - facts: 할 일(`agent_run`은 `agentLabel(action.agent)`, `tool_run`은 지금 있는 `waiting.label.target-tool`에 `waiting.label.place-app`의 `shortId`와 tool 이름), 놓친 수, 마지막 차례 시각
     - meta는 지금 `metaOf`가 creator와 place로 만든다. `choices`는 빈 목록이다.
   - `waiting/cards/job-hold-card.tsx`(새 file): `Head`(펼침 토글 포함), 펼치면 `Facts`, 아래 오른쪽 끝에 [Skip](secondary)과 [Start now](primary, 맨 오른쪽)를 둔다. 보내는 동안 단추를 끈다. `conflict`면 card 안에 `waiting.notice.job-hold-busy`를, 그 밖의 실패는 `waiting.notice.decide-failed`를 보인다. 거절 이유 칸은 없다. class는 `waiting.module.css`의 것(`request`, `actions`, `error`)을 쓴다.
   - `waiting/decide.ts`
     - `decideJobHold(core, entry, choice: "run_now" | "skip")`: `commandCall(jobDecideHold, { input: { job_run: entry.id, choice }, compare, key })`. key는 `job-decide-hold-<job_run id>-<choice>`다(같은 결정은 같은 key라 core가 한 번만 받는다). `compare`는 `{}`다(계약 "command의 `compare`는 모두 `z.strictObject({})`").
     - 성공이면 `run_now`는 `started`, `skip`은 `skipped`다. 실패는 `{ ok: false, code }`다.
     - `SettledState`에 `started`, `skipped`를 더한다. `decideWaiting`은 `job_hold`를 받지 않는다(지금 `coding`처럼 `UNAVAILABLE`).
   - `waiting/waiting-panel.tsx`
     - `GROUPS` 맨 뒤에 `{ title: "waiting.label.group-job", kinds: ["job_hold"] }`.
     - `card()`에 `job_hold` 갈래: `JobHoldCard`. 고르면 `decideJobHold`를 보내고, 성공이면 `settled.add(entry, state)`다. card를 빼는 것은 store가 `JobChanged`로 다시 읽을 때다(다른 창에서 정했거나 `superseded`로 닫힌 card도 그 event로 빠진다).
     - `SETTLED_MARK`에 `started`(tone good)와 `skipped`(tone neutral)를 더한다.
   - `waiting/cards/head.tsx`의 얼굴은 `agent`가 있으면 role 아이콘이라 그대로 맞는다. 고칠 일이 없으면 두지 않는다.
4. wording key를 `packages/design/wording/catalog/data.ts`(`waiting.*`이 있는 file)에 더한다. 소유 줄의 `packages/design/wording`(key만)이 이 file이다. 여러 task가 key만 더하는 shared file이라 같은 wave의 다른 task와 겹쳐도 된다(`project-docs/plan/tools/briefs.py`의 `shared`).
   - 더할 key: `waiting.label.group-job`, `waiting.title.job-hold`, `waiting.notice.job-hold`, `waiting.label.fact-missed`, `waiting.label.fact-last-time`, `waiting.button.job-skip`, `waiting.button.job-start-now`, `waiting.notice.job-hold-busy`, `waiting.label.settled-started`, `waiting.notice.settled-started`, `waiting.label.settled-skipped`, `waiting.notice.settled-skipped`. `common.*`에 같은 뜻이 있으면 그것을 쓰고 만들지 않는다.
   - 값에 안쪽 말 `run`을 쓰지 않는다(`rules.ts`의 `INTERNAL_WORDS`). 단추는 "Start now"와 "Skip"이다.
   - 묶음 이름 `waiting.label.group-job`의 값은 `sj-shell-job-screen`이 정한 화면 낱말의 복수 "Scheduled jobs"다. card 글에서 job을 부를 때도 "scheduled job"을 쓴다.
   - `deno task wording`으로 `data.placeholders.ts`를 다시 만든다. 손으로 고치지 않는다.
5. `events/waiting-store_test.ts`는 그대로 통과해야 한다. 그 test의 fake(`events/fake-source.ts`)는 `job.holds`에 `unavailable`을 돌려주고, 2의 따로 맞추기는 그때 `job_hold` 항목을 그대로 둔다. 통과하면 고치지 않는다.

정한 것:
1. job hold는 대기 목록의 새 묶음 하나(맨 뒤, "Scheduled jobs")에 둔다. 이유: 결정의 뜻(지금 시작, 건너뛰기)이 허락·거절과 달라 다른 묶음에 섞으면 단추가 헷갈린다. 이름은 job 화면과 같은 낱말이다(README "살 단계 검토에서 정한 것").
2. 단추 글은 "Start now"와 "Skip"이고, [Start now]가 맨 오른쪽 주 행동이다. 이유: wording 규칙이 값에 `run`을 막고, ui-design 규칙이 주 행동을 오른쪽 끝에 둔다.
3. `conflict`이면 card를 남기고 "앞 차례가 아직 돈다" 문구를 보인다. 이유: README "앞 run이 도는 중에 [지금 실행]을 누르면 `conflict`이고, card는 남는다", 계약 `jobDecideHold`(같은 job에 `queued`나 `running` 줄이 있으면 `run_now`는 `conflict`이고 줄은 `held`로 남는다). 다른 창에서 정했거나 `superseded`로 닫혀 `conflict`가 난 card는 그 변경의 `JobChanged`로 빠진다.
4. 결정 뒤 남는 줄에 `started`, `skipped` 두 상태를 더한다. 이유: 지금 상태(허락 접수, 적용, 거절)의 문구가 job 결정과 맞지 않는다.
5. `superseded`로 닫힌 card는 결정 뒤 줄 없이 사라진다. 이유: 사람이 정한 것이 아니다. `JobChanged`로 다시 읽을 때 빠진다.
6. `job.holds`는 snapshot·activation 동의와 따로 읽고 따로 맞춘다. 못 읽으면 지금 job hold 항목을 그대로 둔다. 이유: 한 source를 못 읽었다고 다른 source의 항목을 지우지 않는다는 지금 규칙(`readAll`의 주석)을 지키면서, 기존 test fake와 다른 화면의 fake를 고치지 않아도 된다.
7. 새 hold에 toast를 띄우지 않는다. 이유: README와 roadmap은 대기 목록 card만 정했다. 알림 단추의 수가 는다. toast 종류는 `events/reactions.ts`가 정하고 이 task의 소유 밖이다.

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다. `check:full`은 renderer build를 보지 않는다.
- `deno run --allow-read tools/check-wording.ts`에 오류가 없고, 새 key에 안쪽 말 warning이 없다.
- `deno task wireframes`가 되고(ui-design skill "확인"), gallery에서 다음이 그려진다.
  - `new-waiting-list`: 맨 뒤 묶음에 job hold card 하나가 있다.
  - `new-waiting-job-hold`: agent run job과 tool run job의 card 둘이 세부까지 펴져 있고, 할 일, 놓친 수, 마지막 차례 시각, 오른쪽 끝 [Skip] [Start now]가 보인다.
  - `new-waiting-job-hold-busy`: [Start now]를 누른 뒤에도 card가 남고 그 아래 "앞 차례가 아직 돈다" 문구가 있다.
  - `new-waiting-settled`: started와 skipped 줄이 있다.
- `deno task dev:mock`에서 대기 목록의 job hold card의 [Skip]을 누르면 card가 빠지고 결정 뒤 줄이 남는다.
- 위험 test: 없음. 화면이다(write-test skill). 겹쳐 돌지 않기는 core의 `conflict`와 `sj-jobs-due`의 위험 test가 지킨다. 기존 `events/waiting-store_test.ts`는 그대로 통과한다.
- 남지 않음: `grep -rnE 'resource: "job|"decide_hold"|"holds"' packages/shell/renderer/desktop/connection tools/wireframes/pages/screens/waiting`가 0줄이다. route 이름은 `jobHolds`·`jobDecideHold`의 값으로만 쓴다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). wording 생성은 `deno task wording`을 돌렸는지 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 적어도 wording catalog `data.ts`에 key를 더한 것
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
