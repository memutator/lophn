# releases-problems-repairs

수리 자료를 묶음으로 밀어 넣던 장치(조립기, 시작 summary, 고친 기록)를 지우고, coding agent와 App Engineer가 종류를 골라 읽는 `problem.more`를 만든다. problems module의 마지막 정리도 이 task가 한다: 다른 problems task가 못 지운 연결(조립 wiring, 옛 worker kind)을 끊는다.

- 단위: releases-problems (wave 3)
- 선행: `releases-problems-register-split`, `releases-problems-intake`, `releases-problems-problem-state`, `releases-problems-tests`(마지막 정리가 앞선 셋이 끝난 뒤의 import 상태를 본다)
- 소유(이 task만 고친다):
  - `packages/core/problems/repairs/` (전부. `register.ts`는 register-split이 만든다)
  - `packages/core/main/daemon/wiring/problems.ts` (확인. core-wiring이 쪼갠 problems 조립 file. 지금은 core.ts의 problems 줄이다)
- 읽을 것:
  - spec: S4 4장(`problem.get`이 발생과 근거를 한 번에 준다), S6 5장 6(coding agent가 CLI로 읽는다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`, `.../coding-agent.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I1.7#11`, `I1.7#12`, `I2.1#2`(자기 path), `I2.6#8`, `I2.10#12`(`repairs/context.ts`의 import)
  - 지금 코드: `packages/core/problems/repairs/**`, `packages/protocol/coding-agent/repair-context.ts`(옛 route. 읽기만), core.ts의 problems·repair 줄(`REPAIR_WORKER_KIND`, `fixSummaryUploadHandler`, `repair_context`)
- 계약:
  - 쓰는 것: `problem.more`·`PROBLEM_MORE_KINDS`·종류별 item type(contract-releases-problems-problems), `core/problems/ports.ts`의 `ReleaseLookup`(`get`, `previousOf`, `resources`). 표 칸은 `releases-problems-problem-state`(`problems`: `state`, `name`, `state_changed_at`, `seq`)와 `releases-problems-intake`(`snapshots`)가 만든 것을 읽는다.
  - 내놓는 것: `problem.more` read handler.

## 할 일

1. 지운다 (I1.7#12). `repairs/assembly/` 전부(조립기 `assemble.ts`, `sections.ts`, `budget.ts`, `draft.ts`, `select.ts`, `text.ts`, `summary.ts`, `cursor.ts`, `reads.ts`, `model.ts`, `more.ts`, `mod.ts`), `repairs/worker/context.ts`, `repairs/worker/session-summary.ts`, `repairs/context.ts`(`/v1/repair_context/*`를 coding-agent worker kind로 넘기던 연결, `REPAIR_WORKER_KIND`). 시작 summary 조립(`guides/hook.ts`의 session summary)을 부르던 core 쪽 입구도 같이 끊는다. coding agent 쪽(`packages/coding-agent`)은 소유 밖이다.
2. 지운다 (I1.7#11). 고친 기록: `repairs/commands.ts`(`recordProblemFix`), `reads.ts`(`listProblemFixes`), `model.ts`, `blobs.ts`(FIX blob), `fix-summary-upload.ts`(`problemsUploadFixSummary`), `repairs/register.ts`의 해당 등록. 완료 보고에 고친 문제를 잇는 것은 ticket 쪽(coding-agent 단위) 일이다.
3. 새로 만든다 (I2.6#8). `repairs/more.ts`에 `problem.more` read handler를 두고 `repairs/register.ts`에 등록한다. 종류별로 한 표 읽기다(ledger read, 동기, 외부 호출 없음).
   - `occurrences`: 그 문제의 `reports`를 `observed_at` 내림차순으로 커서로 이어 읽는다. item은 `problemOccurrence`.
   - `failed_invocations`: 각 발생의 snapshot이 가리키는 invocation id를 `{ report, invocation }`으로 낸다. invocation이 정말 실패했는지는 problems가 앱 표를 읽지 못하므로 확인하지 않는다(내용은 `app.invocation` read로 본다. 정한 것으로 보고).
   - `logs`: 각 발생의 snapshot `logs` 메타를 `{ report, snapshot, log }`로 낸다. 본문은 옛 `GetSnapshotLogs`로 읽는다.
   - `release_changes`: 발생들의 release를 `ReleaseLookup`으로 풀어 `{ release, previous, added_resources, removed_resources }`로 낸다(바깥 자원 이름 차이만. 코드 차이는 CLI `problem diff`).
   - `related_problems`: 같은 앱의 다른 문제 가운데 마지막 발생의 release가 이 문제의 마지막 발생 release와 같은 것을 `problemListItem`으로 낸다.
   - "지난 고친 기록"과 "첨부"는 problems가 가진 자료가 아니라 ticket 쪽이라 여기에 없다. `problem.more`에 없는 종류를 coding agent CLI가 요구하면 보고에 적는다.
   - actor 범위와 열람 범위(앱을 볼 수 있는가)는 `problem.get`과 같은 판정을 쓴다(`reporting/mod.ts`의 `targetVisible` 등 이미 있는 helper).
4. 마지막 정리. 앞선 problems task가 "다른 task가 import해서 못 지운" 것을 보고에 적었다. 그 목록을 오케스트레이터에게 받거나 `git log`로 보고, `grep -rn "problems/" packages/core --include=*.ts`로 지금 import 상태를 확인한다. 이 task의 소유 안에서 끊을 수 있는 것(`wiring/problems.ts`, `main/daemon/main.ts`의 register 경로)을 정리하고, 소유 밖 import가 남은 export는 지우지 않고 보고한다.
   - `wiring/problems.ts`: repair worker kind 등록(`REPAIR_WORKER_KIND` 조건과 `repair_context` route 분기), `fixSummaryUploadHandler` 연결, `problemsUploadFixSummary`를 뺀다. `ProblemCounts`(problem-state가 만든 구현)를 apps 조립에 넘기고 `ReleaseLookup`(activation이 만든 `releaseLookupOf`)을 problems에 끼운다. `ReleaseLookup`·`ProblemCounts` 연결이 아직 한쪽만 있으면 보고한다.
5. `from events`(I2.1#2): 이 task의 path에서 `events` 표를 상태 근거로 읽는 곳을 각 표 읽기로 바꾼다.
6. import (I2.10#12): `repairs/context.ts`는 지워지므로 `DocumentsChannel` import는 함께 사라진다. 남은 곳이 있으면 lead가 옮긴 공용 위치로 바꾼다.

- (lead가 더함, releases-problems-problem-state가 넘긴 것) `ReleaseLookupPort`(`core/problems/reporting/release-port.ts`, `problems/register.ts`가 다시 내보낸다. 값은 `(sql) => ReleaseLookup`)를 releases 표로 구현해 두 곳에 끼운다: writer ports(`defineTxPort(ReleaseLookupPort, …)`)와 `createReaderRegistration`의 ports Map. 없으면 `problem.get`이 release가 있는 문제에서 `unavailable`이고, 해결된 문제에 release가 붙은 발생이 오면 접수 tx가 실패한다. `problemCounts(sql)`(같은 곳에서 내보낸다)을 apps의 `ProblemCounts`에 끼운다(추가 소유, lead 승인: `wiring/apps.ts`의 그 줄). `problems.report_body`의 접근 판정이 옛 `getReportRead` shim을 쓴다. `problem.get_occurrence`로 옮기고 shim을 지운다. 옛 `problems.work`·`problems.closing` 반응기 연결(`grouping/{work,work-ids,connection}.ts`, `grouping/adapters/core-client.ts`, `closing/{work,connection}.ts`, `closing/adapters/core-client.ts`), `problem-codes/`, `snapshots/mod.ts`의 `insertSnapshot`·`applyPrunedSnapshotAbsence`·`PrunedAttachments`·`SnapshotViewRequest`는 import하는 곳(tests 단위)이 끊긴 뒤 지운다. `ReleaseLookupPort`는 `core/problems/ports.ts`로 옮겨도 된다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "repair_context\|REPAIR_WORKER_KIND\|fenceBlock\|assembleRepair\|recordProblemFix\|problemsUploadFixSummary" packages/core`가 0줄이다(소유 밖 import가 남아 지우지 못한 것은 보고에 적고 이 grep에서 예외로 둔다).

## 보고

- 바꾼 file
- 등록할 것: `core/server/credentials.ts`(events 단위)의 `PROBLEMS_WORK_FEED_PRINCIPAL`·`PROBLEMS_CLOSING_FEED_PRINCIPAL` import, `core/apps/register.ts`(app-calls)의 `visibleToProblemsClosing` import 등 소유 밖에서 이 module의 옛 export를 여전히 쓰는 곳의 목록(cleanup이 지운다)
- 안 쓰게 된 export: 지우지 못한 것의 목록
- 넘길 일: 옛 `repairs/assembly/text.ts`의 `fenceBlock`(CLI 출력의 data fence, `I2.6#7`)은 coding-agent의 `cli/output.ts`가 자기 쪽에 가진다. core에서는 지운다.
- 정한 것: 문서에 답이 없어 worker가 정한 것(`failed_invocations`의 뜻 등)
- 계약 바꾸기 요청(wave 3): 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다(예: coding-agent CLI가 `problem.more`에 없는 종류를 요구할 때)

- (lead가 더함, releases-problems-activation가 넘긴 것) `releaseLookupOf(sql)`(activation이 만든 것)를 `ReleaseLookupPort`로 끼운다. release event(`ReleaseActivated` 등)가 더 나가지 않으니, 그것을 깨움 신호로 읽던 problems closing 쪽 연결은 걷는다.

- (lead가 더함, coding-agent-tickets가 넘긴 것) 이 task 소유 file 가운데 `TicketClaimCheck`를 쓰는 곳(`apps/releases/commands.ts`, `problems/repairs/commands.ts`, `problems/tests/request-ports.ts`)이 아직 없어진 `ticket_problems` 표와 `kind='repair'` 열을 읽는다. 새 `tickets` 표 모양에 맞추거나 걷는다. `ProblemFixRecorded`와 `releases.ticket_source`는 옛 모양 그대로 읽힌다.
- (lead가 더함, coding-agent-session이 넘긴 것) **coding token 발급이 모두 실패한다.** coding CLI token의 operation 목록에 `problem.more`가 있는데 어느 team도 이 route를 등록하지 않아 registry 상한에 없다(`invalid credential scope or kind`). 이 task가 `problem.more`를 만들고 actors에 `coding_agent`를 둔다. 끝나면 lead가 coding session 하나를 열어 발급을 확인한다.
