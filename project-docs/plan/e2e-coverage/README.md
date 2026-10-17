# 계획: core E2E를 lophn의 불변식·bug 기록·제품 흐름으로 넓히고 앱 길을 연다

상태: 열었음. brief는 `tasks/`, 상태는 `status.md`(`python3 -I project-docs/plan/tools/status.py e2e-coverage build`). lead는 `project-docs/plan/tools/lead/lead.sh e2e-coverage`가 여는 worktree(branch `plan/e2e-coverage`)에서 돌린다. **계획 `testing`이 land한 뒤 시작한다.** 이 계획은 `testing`이 만든 `tests/support/fake-server`, `tests/support/core`, `tests/e2e/*` 위에 선다.

## 이 계획

- 목표: `testing`의 core E2E 7개(boot, file-write, approval, rewind, stop, restart, secret)를 lophn 자신의 근거(architecture "지키는 것", bug·회귀 기록, 사용자 흐름)에서 뽑은 case로 넓힌다. 그리고 앱 길(test용 앱 → release → activation → 앱 process)을 열어 앱 E2E를 만든다. 찾은 bug는 같은 계획에서 고친다.
- 재료:
  - `research/candidates-invariants.md`(architecture 문서의 불변식에서 뽑은 후보 28개)
  - `research/candidates-bugs.md`(닫은 이슈, changelog, fix commit, 옛 e2e suite에서 뽑은 후보와 의심 N1~N3)
  - `research/candidates-product.md`(role별 사용자 흐름에서 뽑은 후보와 support 묶음 G0~G5)
  - `project-docs/products/roadmap/testing.md`의 case 고르는 규칙 9개, 지켜야 할 것. `testing`이 끝나면 `project-docs/architecture/testing.md`가 그 자리다
  - `project-docs/plan/testing/tasks/e2e-support-{server,core}.md`의 "내놓는 것"(쓰는 계약), main의 `tests/support/`
  - `project-docs/plan/testing/research/facts-main.md`의 7절(앱), 9절(사람 역할 route), 10절(재시작)
- 범위 밖: UI·Electron E2E, coding agent의 PTY 실행(test는 CLI만 부른다), eval, OS matrix. `testing`의 `e2e-*` flow가 찾아 그 계획이 고치는 bug.
- 단위(brief가 확정한다):
  - support (wave 1)
    - `reply-fn`: fake server 대답을 앞 요청과 journal에서 계산하는 함수로 주기(core가 만든 draft·ticket·call id를 tool 인자에 넣는다), session마다 줄 세우기(agent 둘이 동시에 부를 때).
    - `boot-damaged`: `bootCore`의 실패 변형(망가진 ledger로 띄우면 `start_failed` frame을 받고 원본이 남는다).
    - `gateway-client`: test가 shell 역할로 Gateway(`/gateway`, subprotocol `lophn.gateway.1`)에 붙어 `coding_terminal` frame에서 coding token을 받는다.
    - `coding-role`: test가 coding agent 역할로 그 token을 들고 `lophn` CLI(`ticket claim`, `release prepare`)를 부른다. release 준비가 받는 의존은 미리 채운 `DENO_DIR` 하나로 쓴다.
    - `test-app`: 설치된 template(`<root>/templates/app/`)을 `work/<app>`에 복사해 api(쓰기, 읽기, 256KiB 넘는 결과)를 손보고 `git init`·commit하는 helper와, App Engineer의 fake 대답·Gateway·coding 역할을 이어 앱을 activate하는 helper.
  - 행 더하기 (wave 2, 지금 file마다 task 하나)
    - boot: 같은 data root에 둘째 core는 거절, model 요청이 도는 중 끌 때 child가 남지 않음, 망가진 ledger의 원본을 지우지 않음.
    - file-write: Deno 권한 안이지만 scope 밖인 경로(data root의 `secrets.json`, 다른 project, 밖으로 나가는 symlink).
    - approval: `ask` tool 왕복, 기다리는 중 사람이 말하면 질문이 닫힘.
    - rewind: core 재시작 뒤 rewind, 새로 만든 file의 rewind, `accept_remaining: false`.
    - stop: shell이 도는 중 멈춤(shell process가 죽음), 허락 대기 중 멈춤(늦은 허락이 쓰기를 못 일으킴), session archive·delete로 멈춤.
    - restart: 완료 기록이 남음, 재시작 직전에 받은 message(S4).
    - secret: key가 file·shell 출력에 들어도 model 요청과 ledger에서 지워짐, key를 바꾸면 다음 turn은 새 key, 지우면 요청이 안 나감, provider 오류 본문이 key를 되울려도 안 남음.
  - 새 flow (wave 2)
    - `turn-fate`: child가 turn 도중 crash, project 폴더를 더해 child가 다시 뜸, 여러 번 다시 떠도 다음 turn이 열림(S1, S3).
    - `pm-tools`: PM turn 하나에서 shell, skill 읽기, 이미지 읽기, grep이 Deno 권한에 안 걸리고, `operator.create`가 `forbidden` 없이 Gate를 지나고, `web_fetch`는 loopback으로 못 나감.
    - `call-gate`: `call` tool의 Gate. 허락하면 받는 session이 열리고 거절하면 안 열림.
    - `compact`: 긴 이력 → compact → 원본이 남고 다음 요청은 요약을 씀.
    - `steer`: turn 도중 사람이 말하면 다음 model 요청에 실림.
    - `pm-context`: PM이 context 초안을 만들고 쓰고 제출하고 검색함, 잘못된 초안은 적용되지 않음(`reply-fn` 필요).
    - `lophn-app-create`: lophn agent가 `app.create`로 앱을 등록함.
  - 앱 flow (wave 3)
    - `app-release`: 새 data root에서 template 앱이 release 준비를 지나고(file 수 상한 아래) activate된다.
    - `app-call`: agent의 app-api tool → core → 앱 process → 결과, 결과가 256KiB를 넘어도 됨.
    - `app-sandbox`: 앱 process가 선언 밖 file·net을 못 쓴다.
    - `app-data-rewind`: 256KiB를 넘는 여러 write의 앱 data rewind가 한 번에 되돌아감.
    - `app-restart`: core 재시작 때 진행 중인 앱 호출이 unknown으로 닫히고 앱이 다시 뜸.
    - `app-activation-fail`: activation이 실패하면 앱 data가 그대로임.
  - agent 사이 call (wave 3, `reply-fn`의 session별 줄 세우기)
    - `agent-call`: A가 B를 부르고 결과가 A로 옴, B가 끝나면 A가 실패를 받음, core 재시작 때 받은 call이 `lophn_restarted`로 닫힘.
- 순서(초안): wave 1 support 다섯. wave 2 행 더하기 일곱과 새 flow 일곱. wave 3 앱 flow 여섯과 `agent-call`. 같은 file이 나오면 선행으로 묶는다.
- 사람이 정할 것: 아래 "정한 것" 4, 5. 추천으로 brief를 쓴다. 사람이 바꾸면 그 brief만 바꾼다.

## 정한 것

`(agent)`는 사람이 정하지 않고 추천으로 간 것이다.

1. **새 계획으로 연다.** `testing`은 따로 돌고 있는 계획이라 거기에 더하지 않는다. 사람이 정했다.
2. **E2E 후보는 lophn에서만 뽑는다.** architecture 문서, lophn의 bug·회귀 기록, lophn의 사용자 흐름이다. 다른 harness의 시나리오에서 가져오지 않는다. 사람이 정했다. 이 계획을 열라고 한 것을 AGENTS.md "E2E는 만들기 전에 사람에게 묻는다"의 답으로 본다.
3. **E2E file 수의 상한(roadmap의 12)은 없앤다.** 대신 새 case는 규칙 9개(세 질문, process 경계를 건너야만 보이는 것, 가장 싼 층)를 통과해야 하고, 지금 file의 행으로 접을 수 있으면 접는다. `deno task e2e` 전체는 지금처럼 file 순서대로 돌고 10분 안에 끝나야 한다. 넘으면 행을 harness로 내리거나 묶는다. 사람이 case가 부족하다고 했다. (agent)
4. **S1: agent runtime child가 다시 떠야 할 때 도는 turn이 있으면, 다시 띄우기를 그 turn이 끝날 때까지 미룬다. child가 crash하면 돌던 turn을 `interrupted`(이유 `restarted`)로 닫는다.** 지금은 둘 다 turn row가 running으로 남아 다음 `turns/start`가 `conflict`다(`run-loop/runtime.ts`의 `onEnd`는 credential만 회수한다). 사람이 정할 것(제품 동작). 추천값으로 brief를 쓴다.
5. **S4: core 재시작 직전에 받아 turn을 열지 못한 사람 message는 재시작 뒤 turn을 연다.** 지금은 접수 기록만 남고 turn이 안 열리는 것으로 읽힌다(`research/candidates-bugs.md`). 사람이 정할 것(제품 동작). 추천값으로 brief를 쓴다.
6. **S3: supervisor의 재기동 횟수는 연속 실패만 센다.** child가 ready 뒤 60초를 버티면 0으로 되돌린다. ready에서 바로 되돌리면 뜨자마자 죽는 child가 끝없이 다시 뜬다(brief 조사). 지금은 늘기만 해서 폴더나 provider를 여러 번 바꾸면 어느 순간 다시 안 뜰 수 있다. (agent)
7. **shell이 data root의 `secrets.json`을 읽을 수 있는 것은 그대로 두고, key가 model 요청과 ledger에 닿기 전에 지워지는지를 E2E로 본다.** agent runtime의 읽기 권한에 data root가 들어 있고, 막는 것은 redaction 한 겹이다. (agent)
8. **찾은 bug는 같은 계획에서 고친다.** 고치는 일이 작으면(한 module, 동작이 문서로 정해져 있음) 그 flow task가 같이 고치거나 lead가 fix task를 더한다. 크거나 제품 동작을 새로 정해야 하면 `issue` skill대로 올리고 사람에게 묻는다. 그동안 그 flow는 merge하지 않는다. 꺼 두지 않는다. 고치기 전 코드에서 실패하는 것을 보고에 적는다. (agent)
9. **test용 앱은 core가 깐 template에서 출발한다.** 사람이 앱을 시작하는 길과 같고, template이 깨지면 그것도 잡힌다(이번 판에 template 앱의 release 준비 bug가 넷). roadmap은 "test용 작은 앱"이라고만 썼다. (agent)
10. **E2E 실행 중 network는 loopback뿐이다.** release 준비가 받는 npm·jsr 의존은 `.dev-data/e2e/deno-dir` 하나에 미리 받아 두고(그 준비 명령에서만 network) 실행마다 같이 쓴다. 준비 명령과 `--cached-only` 같은 막는 방법은 `coding-role` brief가 코드로 정한다. (agent)
11. **fake 대답 3개 상한은 행의 몫만 센다.** 앱 activation(`deliverRelease`)이나 ticket 맡기기(`handOff`)처럼 support helper가 거는 대답은 세지 않는다. 행 몫이 3을 넘어도 되는 것은 session 둘이 서로를 기다려야 하는 `agent-call`과 `session-archive-calls`뿐이다. 이유를 test 머리 주석에 적는다. (agent)

## 지켜야 할 것(worker brief에 그대로 넣는다)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(위 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 돌리기 전에

- `testing`이 land하고 그 계획이 막힌 flow(approval, file-write, restart, rewind, stop)를 고쳐 merge한 뒤 시작한다. 그 flow들이 찾은 bug(`issues/place-session.md`, `issues/event.md`)는 `testing`의 몫이다.
- `testing`의 support 계약이 바뀌었으면 이 README와 brief의 "쓰는 것"을 main의 `tests/support/`에 맞춰 고친 뒤 연다.
- `PLAN-remove-keychain`이 land했으면 secret 행의 secret 이름과 route를 다시 확인한다.

## lead가 할 일

- 새 E2E와 행은 그 file을 10번 연속 돌려 통과한 뒤 merge한다. 돌린 뒤 남은 core process와 `.dev-data/e2e/` 아래 run 폴더가 없는지 본다.
- merge 때마다 관련 이슈 절을 `issue` skill대로 닫는다.
- 모두 merged면 `project-docs/architecture/testing.md`에 앱 길(test용 앱, Gateway·coding 역할, `DENO_DIR`), 동적 대답, 상한 대신 시간 예산을 더하고, registry의 `change_reasons`를 고치고, changelog 열린 판에 항목(동작 변화: S1, S3, S4와 찾아 고친 bug)을 덧붙이고, 이 폴더를 지운 commit까지 land한다.

## brief를 쓰며 바뀐 것

brief는 `tasks/`에 26개다. 아래는 코드를 열어 확인한 것과 초안에서 달라진 것이다. "코드로 읽음"은 돌려 보지 않았다는 뜻이다. wave는 barrier다(`status.py ready`는 앞 wave가 모두 merged여야 낸다). 막히는 task가 생기면 lead가 그 brief의 wave를 뒤로 민다.

### task 목록

| id | 단위 | wave | 선행 | 소유 요약 |
|---|---|---|---|---|
| `reply-fn` | reply-fn | 1 | 없음 | `tests/support/fake-server/` |
| `boot-damaged` | boot-damaged | 1 | 없음 | `tests/support/core/`(`tryBootCore`, `bootCore`의 `env`, `until`·`waitQuestion`) |
| `gateway-client` | gateway-client | 1 | 없음 | `tests/support/gateway/`, `tests/e2e/gateway_test.ts` |
| `coding-role` | coding-role | 1 | boot-damaged | `tests/support/coding/`, `deno.json`(`e2e:deps`) |
| `app-cli-finish` | app-cli-finish | 1 | 없음 | CLI 표·`release.preparation` 노출(제품 변경. **사람이 정하기 전에는 띄우지 않는다**) |
| `boot-rows` | boot-rows | 2 | boot-damaged | `tests/e2e/boot_test.ts` |
| `file-write-rows` | file-write-rows | 2 | 없음 | `tests/e2e/file-write_test.ts` |
| `approval-rows` | approval-rows | 2 | boot-damaged | `tests/e2e/approval_test.ts` |
| `rewind-rows` | rewind-rows | 2 | 없음 | `tests/e2e/rewind_test.ts` |
| `secret-rows` | secret-rows | 2 | 없음 | `tests/e2e/secret_test.ts` |
| `pm-tools` | pm-tools | 2 | 없음 | `tests/e2e/pm-tools_test.ts` |
| `call-gate` | call-gate | 2 | 없음 | `tests/e2e/call-gate_test.ts` |
| `compact` | compact | 2 | 없음 | `tests/e2e/compact_test.ts` |
| `steer` | steer | 2 | 없음 | `tests/e2e/steer_test.ts` |
| `pm-context` | pm-context | 2 | reply-fn | `tests/e2e/pm-context_test.ts` |
| `test-app` | test-app | 2 | reply-fn, boot-damaged, gateway-client, coding-role, app-cli-finish | `tests/support/app/`, `tests/e2e/app-release_test.ts` |
| `turn-fate` | turn-fate | 3 | 없음 | `tests/e2e/turn-fate_test.ts` + S1(`run-loop/{runtime,inbox,interrupt,commands,runtime-access}.ts`, `protocol/lophn-agent/turns.ts`, `wiring/lophn-agent-runtime.ts`) + S3(`supervision/responsiveness/{run,slot}.ts`) |
| `stop-rows` | stop-rows | 3 | turn-fate | `tests/e2e/stop_test.ts` |
| `restart-rows` | restart-rows | 3 | 없음 | `tests/e2e/restart_test.ts` + S4(`router/{commands,router}.ts`, `wiring/router.ts`) |
| `agent-call` | agent-call | 3 | reply-fn, call-gate, restart-rows | `tests/e2e/agent-call_test.ts` |
| `app-call` | app-call | 3 | test-app | `tests/e2e/app-call_test.ts` |
| `app-sandbox` | app-sandbox | 3 | test-app | `tests/e2e/app-sandbox_test.ts` |
| `app-data-rewind` | app-data-rewind | 3 | test-app | `tests/e2e/app-data-rewind_test.ts` |
| `app-restart` | app-restart | 3 | test-app | `tests/e2e/app-restart_test.ts` |
| `app-activation` | app-activation | 3 | test-app | `tests/e2e/app-activation_test.ts` |

### 초안에서 바뀐 것

- **wave를 위험 기준으로 다시 나눴다.** 초안은 행·새 flow가 wave 2, 앱·`agent-call`이 wave 3이었다. 지금 코드에서는 앱 길이 끝까지 안 되고(아래) 제품을 같이 고치는 task(S1, S3, S4, 멈춤)는 막힐 가능성이 크다(`testing`은 flow 7개 중 5개가 제품 bug로 막혔다). 그래서 wave 3에는 앱 flow와 막힐 가능성이 큰 flow를 같이 두고, wave 2에는 나머지와 `test-app`을 둔다. 앱 길이 막혀도 wave 2의 나머지는 merge된다.
- `app-release`를 `test-app`에 합쳤다. helper(`tests/support/app/`)의 자기 점검이 곧 그 E2E다(process를 띄우는 점검은 `tests/e2e/`에만 둘 수 있다). `app-release` 단위는 없다.
- `app-activation-fail`을 `app-activation`으로 넓혔다(candidates-docs 2절의 일곱 행을 접었다). 같은 앱·같은 file의 행이라 task를 늘리지 않았다.
- `app-cli-finish`(제품 변경)를 새로 더했다. 이유는 아래 "코드에서 찾은 사실" 1.
- `gateway-client`가 E2E 하나를 가진다(`gateway_test.ts`: Gateway 늦게 붙기. `candidates-invariants.md` 후보 16, `candidates-product.md` `gateway-pending-visible`). support를 flow가 쓰기 전에 혼자 검증할 자리가 없어서다. README 단위에는 없던 E2E 파일 하나다.
- `boot-damaged`가 `tryBootCore`만이 아니라 `bootCore`의 `env` 옵션, `until` export, `waitQuestion`도 갖는다(`tests/support/core/`를 한 task가 소유해 파일 충돌을 피했다).
- `coding-role`은 CLI runner와 `DENO_DIR` 준비 명령만 갖는다. release 준비·test·report 단계는 `test-app`이 한 길로 이어야만 돌아가 `test-app`의 `tests/support/app/`에 있다. CLI는 새 process가 아니라 in-process `cliMain`으로 부른다(`brief`에 이유).
- `agent-call`을 wave 3에 두고 `restart-rows`, `call-gate`를 선행으로 묶었다(같은 Router를 고칠 수 있다). `stop-rows`는 `turn-fate` 뒤(같은 `run-loop` file).
- 넣지 않은 후보(README 단위에 없음): `boot-children`(invariants 6), `token-not-on-disk`(14), `idempotent-retry-after-restart`(15), `mcp-*`, `model-choice-layers`, `skill-folder-read`, `provider-disconnect-aborts-turn`, `project-archive-revokes`, `context-violation-reaction`, `app-crash-problem-reaction`, `agent-app-api-gate`, `operator-reads-app`(docs 1절 `operator-app-api*`와 겹침).
- candidates-docs에서 더한 행(새 task 없음):
  - `test-app`: `activation-needs-verify`, `activation-first-asks`(허락이 helper의 `approveActivation` 단계), `first-activation-rejected`. `app-project-scope`용 `projectScopePatch`.
  - `app-activation`: `activation-widened-asks`, `activation-holds-calls`, `activation-restart-resume`, `activation-supersedes-pending`, `release-rollback`, `rewind-not-across-release`, `allow-reapplied-after-restart`.
  - `app-call`: `app-call-from-screen`, `app-big-result-changeset-dropped`, `app-input-too-large`, `app-project-scope`, `allow-session-scope`.
  - `app-data-rewind`: `app-write-serialized`, `session-rewind-with-app`.
  - `app-restart`: `app-call-unknown`, `app-rewind-blocked-by-unknown`.
  - `approval-rows`: `allow-once-consumed`. `rewind-rows`: `rewind-needs-idle`.
  - `agent-call`: `call-not-found`, `call-closed-session`, `call-none-no-reply`, `call-cancel-late-reply`, `call-sender-archived`, `call-dedup`, `inbox-order`.
  - 이 task들에 없는 docs 후보(1·6의 나머지·7~11절)는 다른 worker가 새 task로 쓴다. task id 앞머리 `operator-`, `coding-`, `annotation-`, `session-`, `registration-`, `prompt-`, `reaction-`을 그들이 쓴다. 단 이미 있는 `coding-role`(support)은 그대로이고 그들이 같은 id를 만들지 않는다. 내가 쓴 id는 그 앞머리를 쓰지 않는다(`coding-role` 제외).

### 코드에서 찾은 사실(README·후보 file과 다른 것)

1. **앱 길이 지금 코드로 끝까지 안 된다(코드로 읽음, 돌려 확인하지 않음).** coding agent의 CLI 표(`CODING_CLI_COMMANDS`)에는 `release prepare`(접수만)만 있다. release 확정(`finalizer.observe`)은 `releases/preparation` memory route가 불릴 때만 일어나는데 그 route는 표에 없어 coding token 범위(`core/server/identity/coding-token.ts`: 표에서 계산)에 없고, user token은 actor가 아니다. 확정은 "같은 bundle hash로 통과한 app test"를 요구하는데 `app test`(`RequestTest`)의 `test`(고정 시험 hash)를 CLI가 만들어 주지 못하고(runner가 봉인 bundle에서 `deriveAppTest`로 만든 값과 다르면 실행하지 않는다), test 결과를 읽는 CLI 명령(`GetTestRequest`, `GetVerification`)도 없으며, `ticket report`가 입력으로 받는 `release` id를 얻을 길도 없다. 그래서 `app-cli-finish`가 CLI에 `release status`·`app test status`·`app test result`를 여는 것을 추천한다(제품 변경이라 사람이 정한다).
2. **app test는 `systemd-run --user --scope`가 필요하다.** `core/supervision/security/memory-limit.ts`가 cgroup(`hard`)을 못 걸면 Deno 자식을 띄우지 않는다(`soft` prlimit은 Deno에 안 쓴다). 그런데 `tests/support/core/process.ts`는 `XDG_RUNTIME_DIR`·`DBUS_SESSION_BUS_ADDRESS`를 일부러 안 준다. 이 머신에서 `XDG_RUNTIME_DIR`만 줘도 `systemd-run --user --scope`가 되는 것은 확인했다(없으면 "bus not defined"로 실패). 앱 E2E는 `XDG_RUNTIME_DIR`을 core env에 줘야 한다(`boot-damaged`의 `env` 옵션, `coding-role`의 `appCoreEnv`). 사람의 session bus에 닿으므로 keychain 길이 없는 것을 `PLAN-remove-keychain` 뒤에 확인한다. user systemd가 없는 환경(CI)에서는 앱 E2E가 실패한다(skip하지 않는다).
3. **S3의 닿는 길이 다르다.** README는 "폴더나 provider를 여러 번 바꾸면 다시 안 뜰 수 있다"고 썼지만 `updateSpec`은 `install`→`makeSlot`으로 새 slot(`failures: 0`)을 만든다. 누적되는 것은 같은 slot의 crash다(`RESTART_DELAYS_MS` 3번, 넷째 crash에서 `restart limit reached`). 그래서 `turn-fate`의 S3 행은 SIGKILL 4번이다. 또 `ready`에서 0으로 되돌리면 ready 직후 되풀이해 죽는 child는 영원히 재기동된다(아래 사람에게 물을 것 3).
4. **S1 deferral은 시간 경쟁이라 E2E만으로 "고치기 전 실패"를 보장 못 한다.** 그래서 미룸(도는 turn이 있으면 `updateSpec`을 안 부른다)은 `runtime_test.ts` unit(deferred 신호, sleep 없음)이 지키고 E2E 행 `b`는 회귀 가드다. 행 `a`(crash)는 고치기 전에 확실히 실패한다.
5. **`ask` 질문의 실패 이유·compact 실패 이유를 사람이 읽는 route가 없다.** `compact`의 실패 행은 `model_failed`를 단정하지 못하고 "compaction이 null이고 원문이 그대로"만 본다.
6. 앱 template 설치본에는 `{{APP}}`·`{{TITLE}}` 치환 전 파일이 있고(`scaffoldApp`을 부르는 제품 route는 없다) 두 app-api(`list_items` read, `add_item` write)가 이미 있다. 큰 changeset·sandbox·slow·충돌·마이그레이션 실패·project 범위·external api는 flow별 patch file(`tests/support/app/patch-*.ts`, `patches.ts`)로 얹는다.
7. `deno.json`의 `e2e` task는 `--parallel` 없이 돈다(`deno test --allow-all --no-check tests/e2e`). README 정한 것 3의 "병렬로 5분"은 지금 task로는 직렬이다. 앱 flow 여섯이 각각 release 준비·app test·activation(수십 초 이상)을 하므로 lead가 시간을 재고 `--parallel` 추가나 앱 flow 합치기를 정한다.
8. `releases/preparation`은 `defineCommand`로 정의됐지만 core에서는 memory handler로 연결된다(`apps/control.ts`). `release.preparation`을 token 표에 올리면 되는지는 `app-cli-finish`가 확인한다.
9. `restart-rows`의 S4 수정 위치는 `RecoverCalls`(`router/commands.ts`)와 `wiring/router.ts`의 `createInboxApplier`로 짚었다. `messages`에 `turn`이 null인 사람 message가 "아직 안 가져간" 표시다(`receivedMessageList.turn`).

### 사람에게 물을 것

1. **앱 길의 CLI를 연다(`app-cli-finish`).** 추천: `release status`(= `release.preparation`, 확정과 `release` id, 준비가 끝나면 `test` hash), `app test status`(= `GetTestRequest`), `app test result`(= `GetVerification`) 세 명령. 사람이 다른 모양을 정하면 그 brief의 "내놓는 것"만 바꾼다. 정하기 전에는 `test-app`과 앱 flow 다섯이 시작하지 못한다.
2. **앱 E2E의 core env에 `XDG_RUNTIME_DIR`을 준다.** app test가 `systemd-run --user`를 쓰기 때문이다. 사람의 session bus에 닿는다. 대안: 앱 길을 E2E에서 접고 harness로 대체(앱 process를 안 거치게 된다). 추천: 준다(MCP를 안 쓰면 keychain은 안 불린다고 코드 주석에 있다. `PLAN-remove-keychain` land 뒤 재확인).
3. **S3: ready에서 `failures`를 0으로 되돌리면 ready 직후 되풀이해 죽는 child가 끝없이 재기동된다.** 추천: "ready 뒤 N초(예 60초)를 버틴 뒤에만 0으로" — 시계 주입이 필요하다. README 정한 것 6의 (agent) 값 그대로(ready에서 0)로 brief를 썼고, worker가 위험을 보고에 적게 했다.
4. **CLI를 in-process(`cliMain`)로 부르는 것(`coding-role`).** 대안은 `deno run packages/coding-agent/cli/main.ts`를 새 process로 부르는 것(AGENTS.md "subprocess는 사람에게 묻는다"). 추천: in-process.
5. **E2E를 `--parallel`로 돌릴지.** 위 7.
6. **`turn-fate` 행 `b`의 미룸 단정은 unit이 지킨다.** E2E에서 "미룸이 일어나지 않음"을 시간으로 단정하는 것은 하지 않았다(sleep 금지). 괜찮은지.
7. `docs` 후보 중 시간 경쟁이 크거나 문서가 상태 이름을 안 정한 행(`holds-calls`, `restart-resume`, `allow-reapplied-after-restart`, `call-dedup`, `call-sender-archived`, `inbox-order`)은 brief에 "못 만들면 접고 보고"를 적었다. 접어도 되는지.

## planner 검토

brief는 다섯 손이 병렬로 썼다: 위 26개(README 단위와 `research/candidates-docs.md`의 activation·앱 호출·approval·agent call·rewind 행), `operator-*` 4, `coding-*` 7과 `annotation-*` 2, `session-*` 3과 `registration-rows`, `prompt-*` 2와 `reaction-*` 3. 합치며 정한 것이다.

- **지운 task 둘.** `lophn-app-create`는 `registration-rows`의 lophn 행으로 접었다(둘 다 lophn의 `app_create`를 본다. contract 하나에 test 하나). `operator-calls-app-engineer`는 `agent-call`의 `operator-to-ae` 행으로 접었다(왕복 장치는 `roundtrip` 행이 이미 본다). `operator-project-write`의 선행은 `operator-grants`가 됐다. (agent)
- **session 도중 grant를 더하면 notice가 "Now available"이라 하는데 그 session에서 부를 수 없다.** architecture가 tool 목록을 session 시작 때 고정한다고 정했으므로 notice 문구가 틀린 것이다. `operator-grants`가 `prepare.ts`의 notice를 "새 session부터"로 고친다. (agent)
- **`handOff`는 `test-app`이 내놓는다.** `deliverRelease`와 coding 행이 같은 맡기기 단계를 두 벌 만들지 않게 한다. `coding-token-scope`는 줄에 서는 경우(`handOffQueued`)만 따로 둔다. (agent)
- **annotation 둘은 wave 2다.** 의존이 `reply-fn`뿐이고 release를 쓰지 않는다. (agent)
- **행을 더했다.** `file-write-rows`에 agent 정의 file 쓰기·읽기 거절(`t-definition-write`), `secret-rows`의 `key-in-content`에 shell 출력에 user token 값이 없다는 단정. (agent)
- **앱 E2E의 core에는 `XDG_RUNTIME_DIR`을 준다.** app test가 `systemd-run --user --scope`를 쓴다. 사람의 실제 환경과 같다. user systemd가 없는 환경에서는 앱 E2E가 실패한다(skip하지 않는다). (agent)
- **CLI는 in-process `cliMain`으로 부른다.** coding token env를 넘겨 부르는 것은 같고, 띄우는 process가 준다. (agent)
- **S1의 "다시 띄우기 미룸"은 unit이 지킨다.** 시간 경쟁이라 E2E로는 고치기 전 실패를 보장하지 못한다. E2E는 crash 행이 지킨다. (agent)
- **시간 경쟁이 큰 행**(`holds-calls`, `restart-resume`, `allow-reapplied-after-restart`, `call-dedup`, `call-sender-archived`, `inbox-order`)은 만들지 못하면 접고 보고한다. 접으면 그 규칙을 지키는 unit이 있는지 보고에 적는다. (agent)
- **"role에 맞지 않는 place" 규칙은 unit(`places_test.ts`)이다.** route 입력 schema가 core 앞에서 먼저 걸러 E2E로는 닿지 않는다. E2E에는 닿는 행(보관된 project, 없는 앱·Operator)만 둔다. (agent)
- **지침·tool 결과 후보 일곱은 새 test 없이 접었다.** 이미 있는 unit(`shell/run_test.ts`, `run-loop/history_test.ts`, `skills_test.ts`, `reactor_test.ts`)이나 다른 task의 행(`secret-rows`, `approval-rows`, `gateway-client`, `app-activation`)이 같은 것을 본다. (agent)

### 사람이 정할 것

1. **coding agent가 CLI로 release 완료를 보고할 길**(`issues/coding-agent.md`). 추천: `app-cli-finish`가 CLI에 `release status`, `app test status`, `app test result`를 연다. 다른 안은 `release prepare`가 끝날 때까지 기다려 release id를 돌려주는 것이다(준비가 300초까지 걸려 CLI가 막힌다). 정해지기 전에는 `app-cli-finish`와 그 뒤의 앱 task를 띄우지 않는다.
2. **앱 place Operator가 앱 data를 project 폴더에 쓰는 기능**(`issues/place-session.md`, AGENT-ROLE O2·O3). `operator-project-write`는 이슈의 추천(기능을 줄이고 O2·O3·Operator prompt의 약속을 지운다)으로 썼다. "만든다"를 고르면 그 brief를 다시 쓴다.
3. **지침이 바뀐 다음 turn의 prompt.** 지금 코드(`prompt-assembly/turn-prompt.ts`)는 system의 지침 block을 그 turn의 지금 지침으로 다시 만들고 notice도 붙인다. `architecture/agent-definition.md`는 "prefix는 그대로, notice로만"이라 쓰고, "편집 한 번이 이력 전체의 cache miss"라 버린 방식을 이유로 적었다. 추천: 문서를 코드에 맞춘다(지침은 드물게 바뀌어 cache miss 한 번이 싸다). 정하기 전에는 `prompt-notice`를 merge하지 않는다.

