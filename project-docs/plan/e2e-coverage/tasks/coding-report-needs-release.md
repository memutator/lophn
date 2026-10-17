# coding-report-needs-release

완료 보고는 현재 유효한 claim과 그 claim으로 준비된 release가 있어야 접수된다. claim 없이 보고하면 거절되고, claim이 있어도 준비된 release가 없으면 거절되며 claim과 ticket은 그대로다. `tests/e2e/coding_test.ts`에 행 하나를 더한다. 접수되는 쪽(release가 있으면 접수되고 claim이 끝난다)은 release 준비를 지나야 해서 `app-release`(`test-app`의 E2E)의 `deliverRelease`가 지난다(App Engineer의 `ticket_verify`는 `reported` ticket만 받는다). 이 task는 거절 쪽만 본다.

- 단위: coding-report-needs-release (wave 3)
- 선행: coding-token-scope. 같은 `tests/e2e/coding_test.ts`의 `Ctx`·`ROWS`와 `handOff`를 쓴다.
- 소유(이 task만 고친다):
  - `tests/e2e/coding_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/apps/tickets/report.ts`
  - `packages/core/apps/tickets/claims.ts`
  - `packages/core/apps/tickets/model.ts`
  - `packages/coding-agent/connection/ticket-ops.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 9절 `coding-report-needs-release`
  - architecture: `project-docs/architecture/coding-agent.md`("완료 보고는 현재 유효한 claim과 그 claim으로 준비된 release가 있어야 접수한다. 접수하면 claim이 끝난다"), `project-docs/products/AGENT-ROLE.md` K1·K3
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-tickets`, `coding-agent-cli-interface`, `app-releases`
  - 코드: `packages/core/apps/tickets/report.ts`(`currentClaim` → release 존재 → `releaseSourceMatches`), `packages/core/apps/tickets/claims.ts`(`currentClaim`: 기준 revision이 맞고 나서 `claim === null`이면 `conflict` "ticket has no claim"), `packages/coding-agent/connection/ticket-ops.ts`(`reportTicket`: summary를 올린 뒤 `report_completion`), `packages/protocol/coding-agent/ticket/claims.ts`(`ticketReportToolInputSchema`: `ticket`, `base_revision`, `claim_seq`, `release`, `summary`)
  - main의 `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/coding/{cli,hand-off}.ts`(`codingCli`, `handOff`), `tests/support/app/`(`startTestApp`, `TestApp`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `coding-token-scope`가 만든 `coding_test.ts`의 `Ctx`(`core`, `fake`, `app(name)`, `handOff(app)`)·`ROWS`와 `Started.cli`(`cli.run(command, input)` → `{code, value, stderr}`), `core.ids.newId("rel")`(형식이 맞는 없는 release id), `ticketShow`(user)
  - 내놓는 것: 없음(test file만)

## 할 일

1. 시작 조건: `coding-token-scope`가 merge됐다. `ROWS`에 행 하나를 더한다. 새 core·fake·gateway 준비를 만들지 않는다.
2. 행 하나. 앱 하나(`ctx.app("report-gate")`), 한 session에서 순서대로 본다. 모든 CLI 입력은 `--json` 출력의 `value.error.code`로 판정한다(종료 코드는 `conflict`·`not_found` 모두 4라 가르지 못한다).

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `report-needs-claim-and-release` | `ctx.handOff(app)` → `cli.run("ticket show", {ticket})`(revision) → `cli.run("ticket report", {ticket, base_revision, claim_seq: "1", release: core.ids.newId("rel"), summary: "done"})` → `cli.run("ticket claim", {ticket, base_revision})` → 같은 `ticket report`를 `base_revision`과 `claim_seq` 모두 claim 출력의 `claim_seq`로 한 번 더 → 사람 자격 `ticketShow` | 없음(row 몫). 맡기기 셋은 helper다 | CLI: claim 없는 보고는 `value.error.code`가 `conflict`다 / CLI: claim이 있어도 없는 release면 `not_found`다 / route(user): `ticketShow`의 state가 여전히 `claimed`이고 `completion`이 null이며 claim이 남아 있다(거절된 보고가 claim도 ticket도 건드리지 않았다) | 후보 `coding-report-needs-release`(candidates-docs 9절이 적은 219행). 코드로 읽은 순서: 기준 revision이 맞으면 `claim === null` → `conflict`, claim이 있으면 release 조회 → `not_found`. release가 있고 claim으로 준비된 경우 접수 → `reported`이고 claim이 지워지는 쪽은 `app-release`의 `deliverRelease`가 지난다 |

   `claim_seq`는 claim 전에는 존재하지 않는 값이므로 형식만 맞으면 된다(`"1"`). claim은 ticket의 revision을 올리고 그 값이 `claim_seq`다(`claimTicket`: `seq = nextRevision(...)`). 그래서 둘째 보고의 `base_revision`과 `claim_seq`는 같은 값이다. 단계는 여섯(맡기기, show, 보고, claim, 보고, 사람 show)이다.
3. 접수되는 쪽을 여기서 다시 돌리지 않는 이유를 test 머리 주석에 한 줄 적는다: release가 있으려면 준비(build)와 app test를 지나야 해서 `app-release`가 맡는다. 이 행을 `app-release`로 옮기거나 둘이 겹쳐 시간이 늘면 그 사실을 보고한다.
4. 어긋나면 제품 bug다. 추가 소유 안에서만 고치고 "고치기 전 코드에서 실패"를 보고에 적는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `app-tickets`(완료 보고는 현재 유효한 claim과 그 claim으로 준비된 release가 있어야 접수한다), `coding-agent-cli-interface`.
- 현실적 회귀: claim을 놓친 session이나 다른 session이 보고해 ticket이 `reported`가 되는 것, 준비한 적 없는 release id로 보고가 접수되어 App Engineer가 없는 판을 확인하게 되는 것, 거절된 보고가 claim을 지워 일이 사라지는 것.
- 왜 지금 test가 못 잡나: `tickets_test`는 command를 직접 부르며 CLI의 summary upload → `report_completion` 순서와 claim을 쥔 token의 요청 경로를 지나지 않는다. 지금 E2E에는 coding 길이 없다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/coding_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/coding_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "claim이나 준비된 release가 없는 완료 보고는 거절되고 claim과 ticket은 그대로다"

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
