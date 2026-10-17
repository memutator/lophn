# rewind-rows

`tests/e2e/rewind_test.ts`에 행 넷을 더한다: core 재시작 뒤에도 rewind가 file을 되돌린다, agent가 새로 만든 file은 되돌리면 지워지고 그 사이 사람이 고쳤으면 남는다, 건너뛸 file이 있는데 `accept_remaining: false`이면 거절되고 아무것도 안 바뀐다, turn이 도는 중에는 rewind를 시작하지 않는다.

- 단위: rewind-rows (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/rewind_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/lophn-agent/session/rewind/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-bugs.md` 후보 `rewind-after-restart`, `rewind-extra-rows`(a)(c); `candidates-docs.md` 6절 `rewind-needs-idle`
  - architecture: `project-docs/architecture/place-session.md`("session rewind는 도는 turn이 없을 때만", pre-image 판정과 skip 사유)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-sessions`, `agent-tools`
  - 코드: `packages/core/lophn-agent/session/rewind/{commands,judge,settle,restore,prepare}.ts`(`needsAccept`: 건너뜀·남는 영향이 있는데 `accept_remaining`이 아니면 `blocked`), `packages/protocol/lophn-agent/session-rewinds.ts`(`REWIND_REASON_CODES`: `edited_outside`, `created_edited`, ...)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), `sessionRewind`·`sessionRewindPreview`·`rewindList`(`packages/protocol/lophn-agent/mod.ts`).
  - 내놓는 것: 없음(test file만)

## 할 일

1. 시작 조건: `tests/e2e/rewind_test.ts`가 main에 있어야 한다(계획 `testing`의 `e2e-rewind`가 land한 뒤). 없으면 시작하지 말고 보고한다. 이 brief의 "지금 모양"은 branch `e2e/e2e-rewind`에서 본 것이므로 main의 file을 먼저 읽고 어긋나면 main을 따른다. 지금 file에는 `writeTwice`와 `rewindToBefore` helper가 있다. `rewindToBefore`가 `accept_remaining: true`로 굳어 있으므로 인자로 받게 한 번 고친다(이 file이 소유). 이 task는 `Deno.test` 하나를 더 둔다(core 한 번, 행마다 새 session과 새 file).
2. 행 표.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `after-restart` | `writeTwice(a.md)` → `core.kill()` → `bootCore(같은 run)` → `settle` → `rewindToBefore(accept: true)` | ① tool `file_write` ×2(v1, v2) ② text | disk: `a.md`가 `v0` / ledger: `rewindList`의 revert가 `applied`, 항목이 `a.md`의 `restored` / preview: `restore`가 `a.md`뿐이고 `skip`·`remain`이 빔 | `rewind-after-restart`. pre-image 기록이 메모리에만 있으면 재시작 뒤 복원이 빈다 |
| `created-file` | 한 turn에서 `new.md`와 `new2.md`를 `file_write`로 만든다(둘 다 처음엔 없다) → 사람이 `new2.md`를 고친다 → `rewindToBefore(accept: true)` | ① tool `file_write` ×2 ② text | disk: `new.md`가 없고 `new2.md`는 사람이 고친 내용 그대로 / ledger: revert 항목에서 `new2.md`가 `skipped`이고 이유가 `created_edited`이며 `new.md`는 복원(삭제) 항목이다 / preview: `skip`에 `new2.md`(`created_edited`) | `rewind-extra-rows`(a) |
| `accept-remaining-false` | 한 turn에서 `a.md`, `b.md`를 각각 두 번 쓴다 → 사람이 `b.md`를 고친다 → `rewindToBefore(accept: false)` | ① tool `file_write` ×4 ② text | ledger: header의 `outcome`이 `blocked`이고 항목이 없다 / disk: `a.md`가 `v2` 그대로(복원이 하나도 안 일어남), `b.md`는 사람이 고친 내용 / preview: `skip`에 `b.md`(`edited_outside`)가 있다 | `rewind-extra-rows`(c) |

   넷째 행 `rewind-needs-idle`(`candidates-docs.md` 6절, place-session.md 38행. 같은 `Deno.test` 안, 앞 행들 뒤):

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `rewind-needs-idle` | `openSession(PM)` → `say`(#1) → `waitPermission`(turn이 `LOPHN.md` 쓰기 허락을 기다리며 돈다) → `core.tryCall(sessionRewind, {... checkpoint: #1, choice: "messages_only", accept_remaining: true, files: [], apps: []}, {session_state: "open", active_turn: null, applying_rewind: null})` → `decide(allow)` → `waitTurnEnd` | ① tool `file_write LOPHN.md` ② text | route: rewind가 거절된다(`conflict`. 도는 turn이 있다) / ledger: `rewindList`가 비어 있고 turn은 이어서 `completed`다 / fake: journal이 2개(rewind가 turn을 건드리지 않았다) | `rewind-needs-idle`. 도는 turn이 있으면 rewind를 시작하지 않는다 |

3. 항목의 `result` 문자열과 이유 코드는 추측하지 말고 `settle.ts`·`restore.ts`와 `REWIND_REASON_CODES`에서 읽어 단정한다. 기존 두 행이 이미 쓰는 `[target, result, reason]` 모양을 따른다.
4. 시작할 때 `rewind/preview`의 `restore_all`이 `internal`로 실패하는 bug(`issues/place-session.md`)가 고쳐져 있어야 한다. 아니면 시작하지 말고 보고한다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `agent-sessions`(session rewind는 agent가 고친 file을 되돌리되 사람이 그 사이 고친 file은 덮지 않고, 확인 없는 영향이 있으면 거절한다), `agent-tools`(쓰기 전 pre-image를 기록한다).
- 현실적 회귀: pre-image가 core 메모리에만 있어 재시작 뒤 복원이 비는 것, 새로 만든 file의 되돌림이 사람 편집을 지우는 것, `accept_remaining: false`인데 일부만 복원되는 것("틀린 되돌리기"가 사용자 data를 망가뜨린다).
- 왜 지금 test가 못 잡나: 지금 두 행은 재시작 없이 기존 file의 중간 상태와 `edited_outside`만 본다. 재시작은 `e2e-restart`가, rewind는 `e2e-rewind`가 서로 안 본다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/rewind_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/rewind_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "재시작 뒤에도 rewind가 되돌리고, 사람이 고친 file은 덮지 않으며, 거절 조건이면 아무것도 바꾸지 않는다"

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
