# coding-token-not-stored

coding token의 원문은 어디에도 저장되지 않는다: ledger(SQLite와 WAL), blob, 다른 data root file, core.log 어디에도 없다. token은 commit 뒤 만들어 Gateway `coding_terminal` frame의 env에만 담긴다. `tests/e2e/coding_test.ts`의 다른 행들이 쓴 token을 모아 두었다가, 마지막에 core를 정상 종료한 뒤 data root 전체와 log를 byte로 훑는다. 앞 여섯 task가 만든 session마다 token이 있으므로 이 task는 행이 아니라 file 끝의 마지막 단계 하나다.

- 단위: coding-token-not-stored (wave 3)
- 선행: coding-cancel-keeps-ticket. 같은 `tests/e2e/coding_test.ts`의 마지막 행까지 모인 뒤에 token을 훑는다.
- 소유(이 task만 고친다):
  - `tests/e2e/coding_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/apps/tickets/coding/`
  - `packages/core/server/identity/`
  - `packages/core/main/daemon/wiring/coding-sessions.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 9절 `coding-token-not-stored`; `candidates-product.md` 후보 `coding-token-lifecycle`의 단정 (1); `candidates-invariants.md` 후보 28의 "disk: `run.home` 전체에 token 원문 없음"
  - architecture: `project-docs/architecture/coding-agent.md`("token 원문은 저장하지 않는다. commit 뒤에 만들어 실행 계획의 env에만 담는다. 표, 오류, log에 넣지 않고, 그래서 shell main은 이 frame을 renderer로 중계하지 않는다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-tickets`, `external-coding-agent`, `secrets`
  - 코드: `packages/core/apps/tickets/coding/relay.ts`(`apply`: `open` 요청을 보낼 때 token을 만들어 `plan.env`에 넣는다), `packages/core/server/identity/{coding-token,registry}.ts`(token은 registry 메모리에만 있다. 저장은 digest), `packages/core/apps/tickets/coding/store.ts`(session 행에 무엇을 적는가), `packages/coding-agent/cli/output.ts`(CLI 출력에서 token을 지운다)
  - main의 `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `Core.logPath`, `Run.home`
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `coding-token-scope`가 만든 `coding_test.ts`의 `Ctx.tokens`(`ctx.handOff`와 `coding-one-per-app`의 행이 쌓은 token), `Core.stop()`(stdin을 닫는 정상 종료. WAL이 본 file에 접힌 뒤에 훑으려는 것), `Core.run.home`, `Core.logPath`
  - 내놓는 것: 없음(test file만)

## 할 일

1. 시작 조건: `coding-cancel-keeps-ticket`가 merge됐다. `ROWS` 루프가 끝난 뒤, `finally` 앞에 단계 하나를 더한다. 행으로 만들지 않는다(행은 서로 앱이 달라 막 끝난 session의 token만 안다. 이 단계는 모든 행의 token이 필요하다).
2. 단계:
   - `await core.stop()`(정상 종료. 끝난 core의 file을 훑는다. `finally`의 `kill()`은 이미 끝났으면 아무 일도 하지 않는다).
   - `ctx.tokens`에 token이 하나 이상 있고 서로 다르다(비어 있는 훑기로 통과하지 않게).
   - `run.home` 아래 모든 일반 file을 재귀로 읽어(sdk·template 사본 포함. 읽기 전용이어도 읽을 수 있다) 각 token의 byte열이 있는지 훑는다. 그리고 `core.logPath`(core.log)도 훑는다. 찾으면 어느 token(앞 6글자만)이 어느 file에 있는지만 담아 실패한다. 실패 메시지에 token 전체를 쓰지 않는다.
   - file 읽기는 `Deno.readFile`, 찾기는 byte 검색(`Uint8Array`에서 부분 열 찾기)다. 문자열로 디코드하지 않는다(SQLite·blob은 binary다).

| 항목 | 내용 |
|---|---|
| case | 앞 행들이 session을 열고 닫는 동안 받은 token 전부가 ledger·blob·log 어디에도 없다 |
| route 순서 | (앞 행 전부) → `core.stop()` → `run.home` 재귀 훑기 → `core.logPath` 훑기 |
| fake 대답 | 없음(이 단계의 몫) |
| 단정(서로 다른 곳) | guard: `ctx.tokens`가 2개 이상이고 모두 다르다 / disk: `run.home` 아래 어느 file에도 token 원문이 없다 / disk: `core.logPath`에 token 원문이 없다 |
| 근거 | 후보 `coding-token-not-stored`(candidates-docs 9절이 적은 211행). 앞 행이 token을 열어 둔 채로(session을 끝내지 않은 행도 있다) core가 끝난 것도 훑는다 |

3. 훑기 시간이 늘면(sdk 사본 파일 수가 많다) 한 번 도는 시간을 보고에 적는다. 줄이려고 폴더를 빼지 않는다. 큰 file만 못 읽으면 이유를 보고한다.
4. 어긋나면 제품 bug다(token 원문이 표·log에 들어갔다). 추가 소유 안에서만 고치고 "고치기 전 코드에서 실패"를 보고에 적는다. token이 어디 있는지(file 이름)가 단서다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `app-tickets`·`external-coding-agent`·`secrets`(token 원문은 저장하지 않는다. 새면 그 앱 하나가 열린다).
- 현실적 회귀: 디버깅하려고 plan이나 오류에 token을 넣어 ledger·log에 남는 것, session 행에 env를 통째로 저장하는 것, 오류 본문에 요청 header가 되울리는 것.
- 왜 지금 test가 못 잡나: unit은 그 module이 만든 값만 본다. 실제 core가 돌며 token을 만들고 지나간 뒤 data root 전체(SQLite, WAL, blob)와 log에서 원문을 찾는 test가 없다. token은 registry 메모리에만 있으므로 이 훑기가 유일한 방어다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/coding_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/coding_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "coding token 원문은 ledger, blob, data root file, log 어디에도 저장되지 않는다"

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- 훑은 file 수와 걸린 시간
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
