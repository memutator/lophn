# release-cold-cache

빈 `DENO_DIR`(새 기계)에서 첫 앱 release 준비가 `ui_build_failed`로 끝난다. `coding-role` worker가 찾았다. 그 task는 E2E 준비 명령(`deno task e2e:deps`)에서 build를 한 번 미리 돌려 피했다. 사람이 새 기계에서 처음 앱을 낼 때 같은 실패가 난다.

- 단위: fix (wave 3)
- 선행: test-app
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/prepare/from-source.ts`
  - `packages/core/apps/releases/prepare/ui-build/`
  - `packages/core/main/app-supervisor/release-runner.ts`
  - `tests/support/coding/prepare-deps.ts`(고친 뒤 build 미리 돌리기가 필요 없으면 지운다)
- 읽을 것:
  - `tests/support/coding/prepare-deps.ts`의 주석(원인 둘: build 앞에서 `esbuildBinaries(denoDir)`로 `--allow-run`을 정하는데 그때 esbuild가 아직 없다. build 권한이 `--allow-write=staging`뿐이라 `DENO_DIR/deno_esbuild`를 못 만든다)
  - `project-docs/architecture/activation.md`(release 준비의 권한), `project-docs/plan/e2e-coverage/README.md` "정한 것" 10(E2E 실행 중 network는 loopback뿐)
- 계약:
  - 쓰는 것: release 준비 흐름. 내놓는 것: 없음.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 정한 것

- build 자식의 권한을 넓히는 쪽보다, build 전에 esbuild 실행 파일이 준비되는 쪽(예: 준비 단계의 `deno cache`가 esbuild를 받는 단계까지 하고 그 뒤 `--allow-run` 목록을 정한다)을 먼저 본다. 권한을 넓혀야 하면 넓히는 범위(`DENO_DIR/deno_esbuild` 하나)와 이유를 보고에 적는다. 앱 build 자식이 data root나 사람의 HOME에 쓰게 되면 안 된다.
- 재현은 빈 `DENO_DIR`로 `prepareFromSource`(또는 앱 E2E에서 `e2e:deps`의 build 미리 돌리기를 뺀 것). 고치기 전 실패 출력 한 줄을 보고에 적는다.

## 할 일

1. 재현한다. 2. 고친다. 3. `prepare-deps.ts`의 build 미리 돌리기를 지우고 `deno task e2e:deps`를 빈 deno-dir에서 다시 돌려 앱 flow가 통과하는지 본다.

## 끝남

- `deno task check:full`이 통과한다. 빈 `DENO_DIR`에서 template 앱의 release 준비가 된다. `deno task e2e`의 앱 flow가 통과한다.

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
