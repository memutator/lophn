# app-socket-root

같은 사람 계정에서 lophn이 둘 뜨면(사람의 실제 lophn과 `deno task dev`, 또는 E2E core 여럿) 서로의 앱 socket을 지운다. app-activation worker가 앱 E2E를 동시에 돌리다 찾았다(실패 뒤 다시 뜬 앱이 계속 `app_unavailable`).

- 단위: fix (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/runtime/processes/socket-dir.ts`
  - `packages/core/main/app-supervisor/main.ts`
  - `packages/core/apps/control.ts`(`appSocketRoot`, `appSupervisorSpec`의 socket 폴더 허락)
- 읽을 것:
  - `packages/core/apps/runtime/processes/socket-dir.ts`(`createSocketDirectory`: `$XDG_RUNTIME_DIR/lophn` 또는 `/tmp/lophn-<uid>`, 경로 104 byte 상한), `packages/core/main/app-supervisor/main.ts`(`randomName: () => "slot"`로 slot마다 고정 이름, `socketPathsOf`가 새 자식 전에 그 경로를 지운다), `packages/core/apps/control.ts`(`appSocketRoot`: supervisor의 write 허락이 이 폴더다)
  - `project-docs/architecture/app-call.md`, `activation.md`(앱 process와 socket)
- 계약: 쓰는 것 없음. 내놓는 것 없음(socket 경로는 core 안에서만 쓴다).

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 정한 것

- 지금: socket 폴더가 data root와 상관없이 `$XDG_RUNTIME_DIR/lophn`이고 이름이 slot 번호로 고정이라(`a0.sock`, `b0.sock`), 다른 data root의 supervisor가 새 자식을 띄울 때 남의 socket file을 지운다.
- 고친다(agent): socket 폴더를 data root마다 나눈다. `<지금 폴더>/<data root 절대 경로의 짧은 hash>/`(sha256 hex 앞 12자 정도). 104 byte 상한은 그대로 지키고, 넘으면 지금처럼 거절한다. supervisor의 write 허락(`appSupervisorSpec`)도 그 하위 폴더 하나로 좁힌다. 지울 때도 자기 폴더 안만 지운다.
- hash에는 Web Crypto를 쓴다(동기 API가 필요하면 이미 있는 hash helper를 grep해 쓴다).

## 할 일

1. 고치기 전 재현: 같은 기계에서 data root 둘로 core를 띄워 각자 앱을 하나씩 activate하면(`tests/support/app`의 `activateTestApp` 둘, 서로 다른 `createRun`) 나중 것이 먼저 것의 `a0.sock`을 지워 먼저 것의 앱 호출이 `app_unavailable`이 된다. 임시 스크립트(commit하지 않음)로 보이고 출력 한 줄을 보고에 적는다. 재현이 안 되면 코드로 짚은 근거를 적는다.
2. 고친다. 3. 같은 재현이 통과한다. `tests/e2e/app-release_test.ts` 10번 연속.

## 끝남

- `deno task check:full`이 통과한다. core 기동 두 번. `deno task e2e`의 앱 E2E가 통과한다.
- 위험 test: 새 E2E는 만들지 않는다. `socket-dir.ts`에 unit이 있으면 "data root가 다르면 폴더가 다르다" 행 하나를 더한다.

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
