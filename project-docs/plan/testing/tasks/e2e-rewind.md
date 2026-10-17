# e2e-rewind

agent가 file을 두 번 고친 뒤 session rewind(`restore_all`)가 file을 첫 상태로 되돌리고, 그 사이 사람이 고친 file은 덮어쓰지 않는 것을 core 전체로 본다.

- 단위: e2e (wave 2)
- 선행: e2e-support-server, e2e-support-core
- 소유(이 task만 고친다):
  - `tests/e2e/rewind_test.ts`
- 읽을 것:
  - `project-docs/products/roadmap/testing.md`("core E2E 후보" 3번: "틀린 되돌리기 막기")
  - architecture: `project-docs/architecture/place-session.md`(rewind의 "지키는 것")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-sessions`, `agent-tools`, `run-loop`
  - 코드: `packages/protocol/lophn-agent/session-rewinds.ts`(`rewind/preview`, `rewind/apply` 입력·출력, `rewindReasonSchema`의 `edited_outside` 등), `packages/protocol/lophn-agent/reverts.ts`(`rewind/list`: 기록된 rewind와 항목 결과), `packages/core/lophn-agent/session/rewind/{files,commands,record}.ts`(`Rewind`는 writer queue 앞 처리기가 파일 관측·복원을 하고 command는 기록만 확정한다. 그래서 client는 `files: []`로 부른다. 코드로 확인한다), `packages/core/agent-roles/hooks.ts`(`aroundWrite`가 쓰기 전 pre-image를 남긴다)
  - 앞 task가 만든 `tests/support/fake-server/`, `tests/support/core/`와 그 brief의 "내놓는 것"
- 계약:
  - 쓰는 것: fake-server, core support(`createRun`, `bootCore`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `waitTurnEnd`, `turnsOf`), route `rewind/preview`(`PreviewRewind`), `rewind/apply`(`Rewind`), `rewind/list`(`ListReverts`, `reverts.ts`의 `rewindList`). checkpoint로 쓰는 message id는 `say`가 돌려준 값이다.
  - 내놓는 것: 없음(test만).

## 지켜야 할 것(계획 공통)

- `~/.lophn`, OS keychain, 사람의 전역 harness 설정을 건드리지 않는다. E2E data root는 `.dev-data/e2e/<run>/home`뿐이다.
- 진짜 model provider는 `deno task test:live`에서만, 사람이 key를 줄 때만 부른다. worker와 lead는 live를 돌리지 않는다(key 없는 실행으로 gate만 확인한다).
- 전역 mutable 상태를 두지 않는다. 고정 port와 고정 path를 쓰지 않는다. 병렬로 돌아야 한다. sanitizer를 끄지 않는다. sleep으로 기다리지 않는다(gate, 가짜 clock, 신호).
- `tests/support`에는 띄우기와 연결만 둔다. flow의 단계는 test file에 그대로 쓴다. 공통 불변식은 함수 하나로 둔다.
- case 하나는 단계 6, fake 대답 3, 단정 3 이하다. 화면 문구는 단정하지 않는다.
- 의심 A~D를 고칠 때는 먼저 그 행이 고치기 전 코드에서 실패하는 것을 확인하고 보고에 적는다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.

## 정한 것

- checkpoint는 되돌릴 turn을 시작한 사람 메시지(`say`가 돌려준 message id)다. 그 시점 *앞*의 상태로 돌아간다.
- `rewind/apply` 입력은 `{id: rwd_*, session, checkpoint, choice: "restore_all", accept_remaining: true, preview_hash(preview 응답의 값), summary_call: null, files: [], apps: []}`다. `files`가 비어도 되는지는 코드(`session/rewind/files.ts`가 Rewind를 가로채 관측·준비한다)로 확인한다. 아니면 "계약 바꾸기 요청"에 적는다.
- 두 행은 한 core·한 project·한 파일 폴더에서 session만 달리 돈다(행마다 `fake.reset()`). 행 2의 "사람이 고친 file"은 test가 disk에서 직접 쓴다.
- 이 flow의 ledger 단정은 `rewind/list`의 항목 결과다. 결과 이름은 코드의 값을 쓴다(test는 값 이름 그대로 비교).

## 할 일

1. 준비: `createRun` → `startFakeServer` → `bootCore` → `connectFakeProvider` → `run.work/proj` 만들기, 안에 `a.md`(내용 `v0`), `b.md`(내용 `v0`)를 둔다 → `openProject`.
2. 행마다(fake 대답 2개):
   - 대답 ① `{kind:"tool", calls:[{id:"t1", name:"file_write", arguments: JSON.stringify({path:"<x>.md", content:"v1"})}, {id:"t2", name:"file_write", arguments: JSON.stringify({path:"<x>.md", content:"v2"})}]}` ② `{kind:"text", text:"done"}`. `<x>`는 행 1이 `a`, 행 2가 `b`다.
   - `openSession(project_manager)` → `const {message} = await say(...)` → `waitTurnEnd` → 이때 `<x>.md`가 `v2`인 것을 확인한다.
3. 행 1(복원): `rewind/preview`({session, checkpoint: message, choice: "restore_all"}) → `rewind/apply`.
   - 단정: disk `a.md`가 `v0` / ledger `rewind/list`에서 그 rewind의 `outcome`이 `applied`이고 `a.md` 항목 결과가 `restored` / preview의 `restore`에 `a.md`가 있고 `skip`·`remain`이 비어 있다.
4. 행 2(사람이 고친 file을 덮어쓰지 않는다): 같은 순서로 `b.md`를 `v2`까지 만든 뒤, test가 disk에서 `b.md`를 `human edit`으로 고치고 `rewind/preview` → `rewind/apply`.
   - 단정: disk `b.md`가 여전히 `human edit`이다 / `rewind/list`에서 `b.md` 항목이 복원되지 않고 이유가 `edited_outside`다 / preview의 `skip`에 `b.md`(이유 `edited_outside`)가 있다. `accept_remaining`은 건너뛴 목록을 확인했다는 뜻이므로 `true`로 부른다.
5. test 머리 주석에 세 질문의 답을 한 줄씩 남긴다.

## 세 질문

- contract: boundary ID `agent-sessions`(rewind로 file이 되돌아간다), `agent-tools`(쓰기 전 pre-image 기록). 사용자 데이터를 잃거나 망가뜨리는 규칙이다.
- 현실적 회귀: pre-image가 안 남아 복원이 비는 것, 되돌릴 때 사람이 그 사이 고친 file을 덮어쓰는 것, 두 번 고친 file이 첫 상태가 아니라 중간 상태로 돌아가는 것.
- 왜 지금 test로 못 잡나: `rewind_test.ts`는 앱 data rewind이고, session rewind는 file tool(child process의 쓰기 기록)과 core의 복원 처리기가 이어져야 보인다.

## 끝남

- `deno task check`가 통과한다.
- `deno fmt --check tests`, `deno lint tests`, `deno check <내가 만든 tests/ file>`이 통과한다(이 worktree에 test-tasks가 아직 없으면 fast check는 `tests/`를 보지 않는다. 그래서 직접 돌린다).
- `deno test --allow-all --no-check tests/e2e/rewind_test.ts`를 **10번 연속** 통과한다(결과를 보고에 적는다). 끝난 뒤 `.dev-data/e2e/`가 비어 있다.
- 위험 test: "session rewind는 agent가 고친 file을 첫 상태로 되돌리고, 사람이 그 사이 고친 file은 덮어쓰지 않는다"
- 남지 않음: `grep -rn "sleep\|setTimeout" tests/e2e/rewind_test.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

