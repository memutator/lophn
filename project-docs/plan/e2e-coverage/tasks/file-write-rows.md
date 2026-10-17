# file-write-rows

`tests/e2e/file-write_test.ts`에 "Deno 권한은 열려 있지만 scope가 막는 경로" 행을 더한다: data root의 `secrets.json` 읽기, `settings.json` 쓰기, `derived/lophn-agent/` 쓰기, 등록한 다른 project 쓰기, 밖으로 나가는 symlink 쓰기. 모두 `forbidden`이고 file이 그대로여야 한다.

- 단위: file-write-rows (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/file-write_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/lophn-agent/tools/file/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-invariants.md` 후보 13(`data-root-file-tool-escape`); `candidates-product.md` 후보 `project-isolation`의 행 1
  - architecture: `project-docs/architecture/place-session.md`("file tool의 범위", "`extensions.json` 설정 file은 scope가 막는다"), `project-docs/architecture/agent-definition.md`("agent 정의와 skill은 lophn data에 있어 file tool이 닿지 않는다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tools`, `run-loop`
  - 코드: `packages/core/lophn-agent/tools/file/scope.ts`(`Deno.realPath`로 풀어 폴더 안인지 본다), `packages/core/lophn-agent/tools/runtime-permissions.ts`(`allow_read` = data root, `allow_write` = `derived/lophn-agent` + place 폴더 합집합이라 막는 것은 scope 하나)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), `toolCallList`(`packages/protocol/lophn-agent/mod.ts`).
  - 내놓는 것: 없음(test file만)

## 할 일

1. 시작 조건: `tests/e2e/file-write_test.ts`가 main에 있어야 한다(계획 `testing`의 `e2e-file-write`가 land한 뒤). 없으면 시작하지 말고 보고한다. 이 brief의 "지금 모양"은 branch `e2e/e2e-file-write`에서 본 것이므로 main의 file을 먼저 읽고 어긋나면 main을 따른다. 지금 모양은 PM 한 session의 turn 하나에 `file_write` 둘(`note.md`는 성공, project 밖 절대 경로는 `forbidden`)이다. 이 task는 그 호출 table에 행을 더한다. 호출 둘이 값으로 박혀 있으면 `{id, name, arguments, expect}` table로 바꾸고 단정이 table을 도는 모양으로 한 번만 고친다(그 file이 소유다).
2. 준비를 이 행들에 맞게 더한다(새 helper를 만들지 않는다): `connectFakeProvider`에 `key`를 줘서 `secrets.json`이 생기게 하고, project 폴더 둘(`proj`, `other`)을 `openProject`로 등록하고(둘째 등록 때 runtime이 다시 뜨므로 `session`을 열기 전에 끝낸다), `proj/link`를 `run.work/outside`로 가는 symlink로 만든다.
3. 호출 table. 한 turn의 한 reply(tool call 여럿)로 낸다.

| 행(id) | tool 호출 | 기대 결과(ledger `toolCallList`의 outcome) | 막는 층 |
|---|---|---|---|
| `t-secrets-read` | `file_read {path: <home>/secrets.json}` | `{kind: "failure", code: "forbidden"}` | scope(Deno `allow_read`는 열려 있다) |
| `t-settings-write` | `file_write {path: <home>/settings.json, content: "{}"}` | `forbidden` | scope |
| `t-derived-write` | `file_write {path: <home>/derived/lophn-agent/x, content: "x"}` | `forbidden` | scope(Deno `allow_write`가 이 폴더를 연다) |
| `t-other-project` | `file_write {path: <other>/x.md, content: "x"}` | `forbidden` | scope(Deno 쓰기 권한은 모든 project 폴더의 합집합) |
| `t-definition-write` | `file_write {path: <PM 정의 file 경로(agent-roles/place/instruction-rules.ts의 agentFilePathOf)>, content: "x"}`, 같은 file `file_read` | `forbidden` | scope. agent가 자기 정의를 file tool로 고쳐 grant를 우회하지 못한다(agent-definition "agent 정의와 skill은 lophn data에 있어 file tool이 닿지 않는다"). 정의 file 바이트가 그대로다 |
| `t-symlink-out` | `file_write {path: "link/leak.md", content: "x"}` | `forbidden` | scope(`realPath`) |

4. case 하나: ① 위 다섯 호출을 한 reply로 ② text. 기존 `note.md` 호출은 같은 reply에 두고 `success`로 남긴다(양성 대조).
5. 단정 셋(서로 다른 곳): disk: `secrets.json`·`settings.json` 바이트가 그대로(sha256 앞뒤 비교), `derived/lophn-agent/x`·`other/x.md`·`outside/leak.md`가 없다 / ledger: 위 table대로 outcome(양성 대조 `note.md`는 `success`, 나머지는 `forbidden`) / fake가 받은 요청: 둘째 요청의 `tool_result`가 여섯 call id 전부에 있다(같은 reply의 호출이 하나도 빠지지 않았다).
6. 어긋나면 test를 고치지 말고 제품 bug로 본다. 예: `derived/lophn-agent/x`가 쓰이면 scope와 Deno 권한이 둘 다 열린 것이다(위험).

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `agent-tools`(file tool의 범위는 place 폴더 안이고 data root는 닿지 않는다), `run-loop`(runtime Deno 권한은 data root 읽기와 `derived/lophn-agent` 쓰기를 열어 둔다).
- 현실적 회귀: `scope.ts` 수정으로 절대 경로·symlink·`..` 검사가 풀리는 것, runtime 권한이 넓어진 상태에서 scope가 유일한 방어라는 것을 잊고 scope를 느슨하게 하는 것(폴더 규칙 사본이 세 번 어긋난 전례).
- 왜 지금 test가 못 잡나: `scope_test`는 함수 입력만 본다. 어느 경로가 Deno 권한은 열렸는데 scope만 막는지는 runtime 권한 목록과 scope 둘을 함께 보아야 하고, 이 file의 지금 행은 "등록 안 된 폴더 밖"뿐이다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/file-write_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/file-write_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "scope 밖 경로(data root의 비밀·설정, derived, 다른 project, 밖으로 나가는 symlink)는 Deno 권한이 열려 있어도 쓰이거나 읽히지 않는다"

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
