# always-jobs

job에 주인 기계를 둔다: `jobs.machine` 열을 더하고, 새 job은 만든 기계의 id를 싣고, 이미 있는 job은 새 판의 첫 claim이 그 기계 id를 찍는다. 주인이 이 기계가 아닌 job(지금은 복사된 data root에서 온 것, 뒤에는 기계를 넘어 오는 것)은 차례를 만들지 않고 event로 열리지 않고 놓친 차례를 돌릴 수 없고, Jobs 화면에 "Belongs to another computer"와 [Run on this computer]로 보인다.

- 단위: always-jobs (wave 1)
- 선행: 없음. 계획을 열기 전에 `machine-identity`가 main에 있어야 한다.
- 소유(이 task만 고친다):
  - `packages/core/jobs`
  - `packages/protocol/jobs`
  - `packages/core/main/daemon/wiring/jobs.ts`
  - `packages/core/main/daemon/wiring/jobs-registration.ts`
  - `packages/shell/renderer/desktop/jobs`
  - `packages/cli/commands/job.ts`
  - 한 줄씩 허락(공유 file. 한 줄이나 함수 하나만 더하고 "넘길 줄"에 적는다): packages/core/main/daemon/wiring/remote.ts의 `schemaStepsAfterTeams` 끝에 `jobs.machine` step, packages/core/storage/migration/schema-steps.lock.json 끝에 `{id, sha256}` 한 줄, job 기록 fixture에 새 칸 둘: packages/shell/renderer/desktop/connection/waiting/fake-source.ts, tools/wireframes/pages/screens/project-window.tsx, packages/mobile/src/data/sample.ts, i18n catalog packages/design/i18n/catalog/workspace-settings.ts의 `jobs.*` key, project-docs/flows의 이 task 줄
- 읽을 것:
  - 계획: `project-docs/plan/always-on/README.md`의 "정한 것"(job 주인 줄 셋)과 "다른 계획이 기대는 계약" 4
  - architecture: `project-docs/architecture/job.md`(지키는 것 3·4·5·6, 놓친 차례), AGENTS.md "호환성"(ledger step은 새 id, 맨 뒤 wiring의 `schemaStepsAfterTeams`, lock 끝에 덧붙이기)
  - 기계 신분: `project-docs/plan/machine-identity/README.md` "다른 계획이 기대는 계약" 1(`readMachineId`, 기계에 묶인 상태)
  - 지금 코드: `packages/core/jobs/due.ts`(`claimDue`의 후보 SQL, `closeLeftovers`, `turnFor`, `handOut`, `decideHold`), `events.ts`(`fire`, `triggers`의 `WHERE enabled = 1 AND approved_at IS NOT NULL`), `store.ts`(`hasActivity`, `insertJob`), `commands.ts`(`create`, `approve`의 `firstDue`), `reads.ts`(`list`, `holds`, `pending`), `rows.ts`(`jobFromRow`), `ports.ts`(`jobZonePort`), `schema.ts`·`trigger-schema.ts`·`test-steps.ts`, `wiring/jobs-registration.ts`(`createCoreRegistration`·`createReaderRegistration`의 tx port, `dataRootOf(sql, undefined)`), `wiring/domains-retire.ts`(앞서 `jobs.trigger`를 뒤 wiring에 둔 본보기)
  - 화면: `packages/shell/renderer/desktop/jobs/`의 `job-line.tsx`, `model.ts`, `source.ts`, `core-source.ts`, `testdata/`
- 계약:
  - 쓰는 것: `packages/core/machine/mod.ts`의 `readMachineIdSync(root): Result<Id<"mch">>`(machine-identity의 `machine-id` task가 낸다. 이 task는 고치지 않는다)
  - 내놓는 것:
    - ledger step `jobs.machine`: `ALTER TABLE jobs ADD COLUMN machine TEXT;`(새 file `packages/core/jobs/machine-schema.ts`의 `jobMachineSchemaSteps`. `test-steps.ts`에도 더한다). NULL은 "아직 찍지 않음"이다.
    - `jobRecordSchema`에 `machine: idSchema("mch").nullable()`과 `runs_here: z.boolean()`(읽을 때 이 기계 id와 비교. NULL이면 true: 찍기 전 job은 이 기계의 것이다).
    - command `jobTakeOver`(`defineCommand`, resource `job`, method `take_over`, name `job.take_over`, input `{ job }`, 출력 `{ job: JobRecord }`, actors `["user"]`, changes `jobs`, errors `invalid_input`·`forbidden`·`not_found`·`conflict`).
    - tx port `jobMachinePort = definePort<{ id(): Id<"mch"> }>("jobs.machine")`(`ports.ts`). writer와 reader 둘 다 채운다.

## 할 일

1. `wiring/jobs-registration.ts`가 machine-identity의 `readMachineIdSync`로 `jobMachinePort`를 writer(`createCoreRegistration`)와 reader(`createReaderRegistration`) 둘에 채운다. data root는 `dataRootOf(sql, undefined)`, 값은 Worker마다 처음 한 번 읽어 둔다. 읽지 못하면 그 command는 `unavailable`이다(남의 job으로 보고 돌리지 않는다).
2. step: `machine-schema.ts`와 `remote.ts`의 `schemaStepsAfterTeams` 끝 한 줄, `schema-steps.lock.json` 끝 한 줄(sha256은 `schema-steps_test.ts`가 계산하는 꼴을 따른다).
3. 찍기와 거르기("이 기계의 job" = `machine = <이 기계 id>`):
   - `create`: `machine`을 port의 id로 넣는다.
   - `claimDue`: `startup`이면 맨 먼저 `UPDATE jobs SET machine = ? WHERE machine IS NULL`(새 판의 첫 기동이 옛 job을 이 기계 것으로 찍는다. 그 뒤에 복사된 root는 원래 기계의 id를 들고 간다). 후보 SQL, `turnFor`(`closeLeftovers`가 닫은 남의 job도 차례를 만들지 않는다), `handOut`(남의 job의 queued 줄을 넘기지 않는다), `next_due_at` 최솟값을 이 기계의 job으로만.
   - `events.ts`의 `fire`와 `triggers`: 이 기계의 job만.
   - `decideHold`의 `run`: 남의 job이면 `conflict`("the job belongs to another computer"). `skip`은 된다.
   - `store.ts`의 `hasActivity`: 이 기계의 켜진 job만 idle-exit의 일로 센다.
   - `reads.ts`의 `holds`·`pending`(대기 목록): 이 기계의 job만. `list`·`runList`는 모두 보이고 `runs_here`를 싣는다.
   - `update`·`approve`·`delete`는 주인과 상관없다(사람이 고치고 지울 수 있다. 돌지 않을 뿐이다).
4. `job.take_over`(`commands.ts`, `register.ts`의 목록, `protocol/jobs/mod.ts`의 route 목록): user만(`forbidden`), 없으면 `not_found`, 이미 이 기계 것이면 `conflict`. `machine`을 이 기계 id로 바꾸고, 켜져 있고 승인됐고 주기 job이면 `next_due_at`을 지금부터 새로 센다(`approve`의 `firstDue`와 같이. 다른 기계에 있던 동안은 놓친 것으로 치지 않는다). 그 job의 열린 held 줄은 그대로 둔다(이제 [Start now]가 된다).
5. CLI `packages/cli/commands/job.ts`: `job list`의 설명에 한 문장("`runs_here` false means the job was created on another computer and does not run here; only the person can move it to this computer."). take over 명령은 만들지 않는다(사람만 한다. agent는 못 한다).
6. 화면(`packages/shell/renderer/desktop/jobs`): `runs_here`가 false인 줄은 다음 차례 대신 "Belongs to another computer"(설명: "It was created on another computer and does not run here.")와 [Run on this computer] 단추. 누르면 `job.take_over`. 실패는 이 화면의 다른 단추와 같은 오류 글. `source.ts`·`core-source.ts`·`model.ts`·`testdata`에 칸과 동작을 더하고 fake source에 남의 job 하나를 둔다. 새 문구는 `jobs.*` key로.
   - 기계 이름: `source.ts`의 jobs source에 선택 함수 `machineName?(machine: string): Promise<string | null>`를 둔다. 있고 이름을 돌려주면 "Belongs to <name>"(새 key 하나), 없거나 null이면 "Belongs to another computer". 이 task는 함수를 채우지 않는다(`core-source.ts`에 두지 않는다). 뒤에 `app-folder-sync`의 기계 기록(`machine/environment`의 `machines`)을 아는 쪽이 채운다. fake source는 이름이 있는 경우와 없는 경우를 하나씩 그린다.
7. 다른 곳의 job 기록 fixture 셋에 `machine: null, runs_here: true`를 더한다(위 허락 목록). `packages/mobile`은 root workspace 밖이다.
8. flows: `job.take_over` flow(area `automation`, outcome은 handler가 내는 것만), `job.claim_due`·`job.fire_event`·`job.decide_hold`·`job.activity`·`job.holds`·`job.pending` flow의 조건에 "이 기계의 job만"과 `decide_hold`의 새 `conflict`, 새 test file. `node tools/flows.ts check`.

## 끝남

- `npm run check`와 `npm run check:full`(schema lock)이 통과한다. `cd packages/mobile && npm ci && npm run typecheck && npm test`도 통과한다.
- `npm run wireframes`가 되고, Jobs 화면 gallery에 남의 job 줄이 그려진다.
- 위험 test:
  - "옛 schema(`jobs.tables`·`approval`·`workspace`·`trigger`)에 여러 모양의 job(주기·`at`·event, 켜짐·꺼짐, 승인·대기, held·queued 줄)을 넣고 `jobs.machine`을 적용한 뒤 startup claim을 돌리면 job과 job run이 하나도 빠지거나 바뀌지 않고(`machine` 말고 모든 칸이 같다) 모든 job이 이 기계 id로 찍힌다"(`packages/core/jobs/machine_test.ts`)
  - "주인이 다른 job은 때가 와도 queued·held 줄이 생기지 않고, 남은 queued 줄도 넘겨지지 않고, event로 열리지 않고, `decide_hold run`은 `conflict`이고, idle-exit의 일로 세지 않는다. `take_over` 뒤에는 다음 차례에 돈다"(같은 file)
- 남지 않음: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 넘길 줄 둘(remote.ts, lock), gallery 그림 path, lead가 고칠 목록(`architecture/job.md`의 주인 기계와 지키는 것).
