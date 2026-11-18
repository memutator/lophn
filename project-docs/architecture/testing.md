# testing

test는 적게 쓰고, 깨지면 정말 곤란한 것만 가장 싼 층에서 본다. 층은 다섯이고 층마다 무엇이 진짜이고 무엇이 가짜인지가 다르다. model provider는 늘 가짜이고, lophn이 만든 것(core, child process, 앱 process)은 진짜를 쓴다. helper, 명령, 실행 폴더, case 고르는 규칙 같은 운용은 `.claude/skills/write-test/reference.md`에, 쓸지 말지와 모양은 `.claude/skills/write-test/SKILL.md`에 있다.

## 문제

- 옛 test(1,503 file)는 요구 하나에 test 하나로 쌓여 check가 40~60분 걸렸고, 그래서 지웠다. 그 뒤 process를 건너는 동작은 손으로만 확인했고, 그런 곳에서 제품 bug가 났다(성공한 tool call의 ledger 상태, snapshot read 없음, rewind preview의 port, 멈춤이 runtime의 요청을 못 끊음. 처음 만든 core E2E 여섯 가운데 다섯이 찾았다).
- loop test가 provider wire에 묶이면 wire를 바꿀 때 상관없는 test까지 깨진다. 한편 core E2E의 model 호출은 child process 안에서 일어나 `fetch`를 바꿀 수 없다.
- test가 제품에 test 전용 길(flag, env, route)을 더하면 제품이 test에 맞춰 휜다. 사람의 data root(`~/.lophn`)를 건드리면 사람의 data를 잃는다.

## 목표와 비목표

- 목표: 사용자 data를 잃거나 망가뜨리는 규칙, 권한·secret·sandbox 경계, 두 번 이상 고친 bug를 가장 싼 층에서 결정적으로 본다. process 경계를 건너야만 깨지는 것은 core E2E가 본다. 전체 check는 빠르게 유지한다.
- 비목표: 화면, 문구, 내부 구현, 이미 다른 test가 보는 동작은 test하지 않는다. Electron 창 E2E와 coding agent의 실제 PTY는 범위 밖이다. E2E file 수에 상한을 두지 않는다(아래 결정).

## 모델

| 층 | 진짜 | 가짜 | 돌리는 때 |
|---|---|---|---|
| unit | 함수 하나 | 없음 | 작업 중 check |
| harness loop | turn loop, tool 실행, Gate·hook | scripted model | check |
| harness wire | provider adapter, 실패 분류, 호출당 idle | 녹화·손 fixture를 `fetch`로 재생 | check |
| core E2E | core daemon, agent runtime·worker·app child 전부 | HTTP fake server | `npm run e2e`(merge 전, land 전) |
| provider live | 진짜 provider와 model | 없음 | 사람이 key를 주거나 구독 로그인을 저장했을 때만 |

가짜는 셋이고 model이 끼는 자리마다 하나씩이다.

```
 harness loop:  turn loop ─ model port ─▶ scripted model (정규화된 결과를 순서대로)
 harness wire:  model resolver ─ adapter ─ fetch ─▶ 녹화 재생 (fixture 본문)
 core E2E·dev:  core ─ agent runtime child ─ HTTP ─▶ fake server (127.0.0.1, anthropic-messages)
```

- **scripted model**: provider wire를 모르고 answer, tools, partial, failed, hang을 낸다. queue는 엄격해서 남은 step이나 넘친 호출은 실패다. 받은 요청을 깊은 복사로 기록한다. 시간은 수동 clock으로 다루고 실제로 기다리지 않는다.
- **녹화 재생**: fixture를 호출 순서대로 돌려주고 받은 요청을 기록한다. fixture는 provider별 폴더의 `<case>` 본문(SSE나 JSON)과 선택 `<case>.meta.json`(`status`, `headers`, `disconnect`)이다. 요청은 저장하지 않는다. 손으로 쓴 것은 짧은 SSE이고, live가 녹화한 것은 `live-<행>` 이름으로 같은 폴더에 둔다.
- **fake server**: loopback, port 0에 뜨는 HTTP server로 한 protocol(`anthropic-messages`, path `/messages`)만 말한다. 대답은 text, tool(인자 문자열 그대로), error, silent, cut, stall, raw 일곱이다. step의 대답은 값 대신 받은 요청과 journal에서 만드는 함수여도 된다(앞 요청에서 받은 id를 다음 tool 인자에 넣을 때). 요청은 `match`로 줄(lane)에 나눠 session 둘이 같이 model을 부를 때 줄마다 queue가 따로다. 받은 요청은 모두 journal에 남긴다. 기대와 다른 요청이나 빈 queue에는 HTTP 400(`invalid_request_error`)과 차이 설명으로 답한다(500 계열은 제품이 retry해 test가 헷갈린다). 응답 event의 모양은 fixture와 견주는 test가 지킨다.

lophn이 만든 것의 진짜 쓰임:

- core E2E는 새 core를 늘 직접 띄운다(이미 도는 core에 합류하지 않는다). Electron의 Node로 daemon을 자기 pid의 detached process로 띄우고, `ready`를 읽은 뒤 control로 연결해 API 주소와 user token을 받는다. env는 비운 뒤 `LOPHN_HOME`, 빈 `HOME`, `PATH`, 호출자가 준 것만 준다.
- 사람과 shell의 Gateway 역할은 test가 대신한다(Gateway 연결을 열고 event를 읽는 쪽).
- 앱 E2E는 사람이 앱을 시작하는 길만 지난다: `apps/create`(core가 template으로 `<home>/apps/<app>/source`를 깔고 잇는다) → 견본 patch를 source에 commit → 앱 workspace lophn의 `release_prepare`, `preview_*`, `release_activate`(fake 대답) → 첫 activation의 동의(`activations.consents`를 읽어 `activation.consent`). 제품 template에는 견본 업무가 없어서(빈 `tools`, 자리 표시 화면 하나) test 몫의 견본 위에 흐름별 patch(큰 write, crash, migration, 바깥 net·secret 호출)를 얹는다. agent가 앱 tool을 부르는 행은 사람이 앱을 그 agent에 할당해(`assignmentSet`) 부른다. 할당한 앱의 tool만 tool 목록에 뜬다(`project-docs/architecture/approval.md` "할당").
- 허락을 묻는 행(turn request)은 file 쓰기가 아니라 제품 ask 규칙에 걸리는 shell 명령(`rm -r <폴더>`)으로 묻고, 실행 여부는 폴더가 남았나로 disk에서 본다. file 쓰기는 묻지 않는다(`project-docs/architecture/approval.md`).

E2E 실행 폴더는 실행마다 system 임시 폴더(`/tmp/lophn-e2e-<random>/`) 아래 `home`(`LOPHN_HOME`, 0700), `work`(project 폴더와 앱 source, data root 밖, 폴더마다 git 저장소), `user-home`(core의 빈 HOME), `core.log`(core stderr)로 나뉜다.

`npm run dev`도 같은 fake server를 쓴다. 앱 전에 core를 한 번 띄워 고정 port(기본 7499)의 fake server를 `providers/connect`로 심는다(`LOPHN_LIVE_PROVIDER=1`이면 심지 않는다).

## 지키는 것

1. 제품에 test 전용 flag, env, route, actor를 두지 않는다. fake로 가는 길은 제품의 길뿐이다: `providers/connect`(key 없는 loopback provider, `auth_kind: "none"`)와 기동 전 `<data root>/settings.json`(`lophn-agent.model.catalog_auto_update: false`). 앱 E2E도 data root에 release를 직접 깔지 않고, agent만 부르는 route(`release.prepare`, `release.activate`)는 test가 직접 부르지 않고 가짜 model이 앱 workspace의 lophn session으로 부른다.
2. test는 사람의 `~/.lophn`을 읽지도 쓰지도 않는다. 임시 data root와 빈 HOME을 쓰고, 고정 port와 고정 path를 쓰지 않는다(dev의 fake server만 예외). E2E 중 network는 loopback뿐이다.
3. 기다림은 신호를 읽는 poll(맞으면 바로 돌아옴)이나 fake server의 도착·끊김 신호다. 고정 sleep과 실제 timer 대기를 쓰지 않는다.
4. E2E가 끝나면 그 run의 임시 폴더와 core process(자손 child 포함)가 남지 않는다. core를 끄는 것(정상 stop, SIGKILL)은 그 pid가 끝나고 그 data root를 환경에 가진 process가 없어질 때까지 기다린다. child가 남으면 그 test가 실패한다.
5. flaky한 case는 꺼 두지 않는다. 고치거나, 더 싼 층(harness)으로 내리거나, 지운다. 제품 bug를 찾은 E2E는 test를 맞추지 않고 bug를 고친 뒤 넣는다.
6. 새 E2E는 10번 연속 통과한 뒤 넣는다. 회귀는 그 contract의 table에 한 행으로 더하고, 고치기 전 코드에서 실패하는 것을 확인한다.
7. core E2E에는 process 경계를 건너야만 깨지는 것만 둔다. 경우의 수는 harness에서 늘린다. case 하나는 작게(단계 6, fake 대답 3, 단정 3 이하) 두고, 단정은 서로 다른 곳(disk, ledger·event, fake가 받은 요청)에서 한다. 화면 문구는 단정하지 않는다.
8. scripted model과 fake server는 엄격하다. 남은 step, 넘친 호출, 기대와 다른 요청은 조용히 넘기지 않고 실패(fake server는 400과 차이 설명)로 답한다.
9. loop의 요청 불변식(tool_use와 tool_result의 짝, 대화 접두)은 모든 loop test가 같이 쓰는 한 검사로 본다. 앞부분에서 바뀌어도 되는 것은 context에 맞추려고 오래된 tool 결과 본문을 고정 문장으로 바꾼 것뿐이다.
10. test는 Electron의 Node(`ELECTRON_RUN_AS_NODE=1`)의 `--test` 하나로 돈다(plain node에는 core가 쓰는 `Temporal`이 없다). 따로 묶는 runner와 두 번째 check를 두지 않는다.
11. check는 `tests`를 package 하나로 본다. 어느 package가 바뀌어도 `tests`의 fmt, lint, type check, harness와 support의 test가 같이 돈다. E2E와 live는 type check에는 들고 check의 test 실행에는 들지 않는다.
12. 앱 socket 폴더는 data root마다 나뉜다. 같은 사용자의 core가 여럿 떠도 서로의 socket을 지우지 않는다. 그래서 E2E run을 저장소 안(worktree 안)에 두지 않는다. Unix socket 경로가 길이 한도(108 byte)를 넘기기 때문이다.
13. live는 사람이 key를 주거나 live 전용 root에 구독 로그인을 저장했을 때만 돌고, 돌 것이 없으면 이유를 찍고 0으로 끝난다. 쓸 수 없는 credential이면 조용히 넘기지 않고 실패한다(만료를 숨기지 않으려고). live가 녹화하는 fixture는 응답만이고 key와 계정 id를 지운다. 사람이 diff를 보고 commit한다. 한 file의 호출은 10번 이하, 호출당 90초다.
14. live 구독 root는 복사하지 않고(refresh token이 갱신 때마다 회전한다), core 하나만 띄운다. 코드가 지우지 않는다. 사람의 root가 아니라 `.dev-data/live/` 아래에 있다.
15. 렌더 오류로 화면이 비는 회귀는 gallery smoke(offscreen Electron으로 모든 wireframe page를 그린다)가 본다. uncaught error나 console error(React key 중복 같은 dev 경고 포함), 빈 root가 있으면 실패한다. 20초 안에 그려지지 않는 page(끝나지 않는 render)도 그 page 이름을 찍고 실패한다. 모양은 보지 않는다.

## 경계와 계약

- 층의 자리: unit은 대상 코드 옆, 나머지 층은 `tests` 아래 층 이름의 폴더(자리는 write-test reference). helper와 가짜는 `tests`의 support 아래 하위 폴더 하나에 주인 하나씩 둔다. support에는 띄우기와 연결만 두고 flow의 단계는 test file에 그대로 쓴다.
- 제품으로 가는 공개 계약만 쓴다: control `identify`·`connect {client: cli}`·`stop`, API route, Gateway event, `providers/connect`, `apps/create`, `activations.consents`·`activation.consent`, `assignmentSet`, 앱 workspace lophn의 `release_prepare`·`preview_*`·`release_activate`.
- Gateway 연결은 principal마다 한도가 있어서 event가 필요한 test만 연결을 스스로 열고 닫는다.
- 앱 workspace session의 tool 호출 하나에는 시간 한도가 없다(한도 timer는 model 호출만 끊는다). 상한은 core 쪽이다: release 준비는 360초 뒤 `failed {stage: "build"}`, activation은 120초 뒤 `running`. 이 둘을 합친 480초가 helper의 turn 하나 대기 상한이다.
- release 준비가 받는 npm 의존은 `npm run e2e:deps`가 `.dev-data/e2e/npm-cache` 하나에 미리 받는다. 앱 E2E의 core는 그 cache를 offline으로 쓴다.
- test file을 더하거나 지우면 `project-docs/flows/tests/`에 그 file과 단정하는 outcome을 고친다(`project-docs/flows/README.md`).
- 파일 목록은 git이 아는 file에서 고른다.

## 결정

- 가짜를 셋으로 나눈다(scripted model, 녹화 재생 `fetch`, fake server). 이유: loop test가 provider wire에 묶이지 않게, core E2E의 model 호출은 child process 안이라 `fetch`를 바꿀 수 없어서. OpenAI Agents SDK, Vercel AI SDK, OpenCode가 같은 분리다. (agent)
- 옛 test는 지우고 처음부터 다시 세운다. 층마다 시작 크기를 작게 잡는다(harness 20~40개, core E2E 6~10개). 이유: 옛 test가 요구 하나에 test 하나로 쌓여 check가 40~60분 걸렸다. (agent)
- core E2E 첫 묶음은 boot, file-write, approval, rewind, stop, restart(secret 포함)이다. (사람)
- E2E file 수 상한(12)을 없애고 전체 10분 예산과 case 규칙으로 고른다. 이유: 사람이 case가 부족하다고 했고, 새 case가 규칙을 통과하면 file 수보다 실행 시간이 비용이다. 넘으면 행을 harness로 내리거나 같은 준비를 쓰는 file로 묶는다. (사람이 case 확대를 정했고, 상한 대신 시간 예산은 agent)
- E2E 후보는 lophn의 문서·bug·사용자 흐름에서만 뽑고, E2E가 찾은 bug는 같은 계획에서 고친다. (사람)
- 제품에 test 전용 flag나 지름길을 두지 않는다. fake로 가는 길은 `providers/connect`와 기동 전 `settings.json`뿐이다. 앱 E2E의 가짜 model이 앱 workspace session으로 agent 전용 route를 부른다. 이유: test만을 위한 actor를 제품 route에 더하면 제품이 test에 맞춰 휘고 public tool 장치 같은 것을 끌어들인다. (agent)
- E2E run은 `.dev-data/e2e/<run>`이 아니라 system 임시 폴더에 둔다. 이유: worktree 안 경로에서 앱 process의 Unix socket 경로가 한도를 넘는다. (agent)
- E2E의 core는 `XDG_RUNTIME_DIR`을 받고(앱 test가 `systemd-run --user`를 쓴다), test 앱은 core가 깐 template에서 출발한다. 의존은 `e2e:deps`가 미리 받고 E2E 중 network는 loopback뿐이다. (agent)
- CLI를 부르는 E2E는 in-process로 부른다. (agent)
- fake 대답 3개 상한은 행의 몫만 센다. support helper가 거는 앱 workspace lophn 대답은 세지 않는다. 넘어도 되는 것은 session 둘이 서로를 기다리는 행(agent call, session archive의 call)뿐이고 이유를 test 머리 주석에 적는다. (agent)
- dev의 user token 문제는 `npm run dev`가 앱 전에 core를 한 번 띄워 연결을 심는 것으로 푼다. dev의 fake server만 고정 port다. (agent)
- fake server는 기대와 다른 요청에 500 계열이 아니라 400으로 답한다. 이유: 500 계열은 제품이 retry해서 test가 헷갈린다. (agent)
- live 대상은 Anthropic과 OpenAI다(Anthropic `claude-haiku-5-5`, OpenAI `gpt-4.1-nano`, 잘림 행만 `gpt-5-nano`). 한 file 10번, 호출당 90초는 추천값이다. (live 대상은 사람, 나머지 값은 agent)
- ChatGPT 구독 live는 쓸 수 없는 credential이면 실패한다. 이유: 조용히 넘기면 만료를 숨긴다. (agent)
- test 선택은 check에서 `--ignore` 대신 git이 아는 file 목록과 `NOT_IN_CHECK` 폴더 제외로 한다. 이유: 설정 파일의 exclude를 `--ignore`가 대체해 목록을 같이 줘야 했다. (agent)
- 소스나 문서를 글로 읽는 test는 쓰지 않는다. 구조 규칙은 lint와 deps check가 맡는다. (AGENTS.md)

## 열린 것

- Electron 창 E2E와 coding agent의 실제 PTY는 하지 않는다.
- 사람이 live 응답을 녹화해 `live-*` fixture로 commit하는 일, fake server의 모양 test를 그 녹화본과 견주는 일은 사람이 key를 줄 때 한다.
- 이 문서가 다루는 이슈는 열려 있지 않다.
