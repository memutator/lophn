# dev-fake

`deno task dev`와 `deno task dev:core`가 새 fake server를 띄우고 `providers/connect`와 `settings.json`으로 붙게 하고, 옛 `tools/fake-provider/`와 `LOPHN_FAKE_PROVIDER_URL`을 지우고, 새 test 층을 가리키도록 AGENTS.md, `write-test` skill, orchestrate skill, `land.sh`를 맞춘다.

- 단위: dev-fake (wave 3)
- 선행: e2e-support-server, e2e-support-core
- 소유(이 task만 고친다):
  - `tools/dev.ts`
  - `tools/fake-provider/`
  - `AGENTS.md`
  - `.claude/skills/write-test/SKILL.md`
  - `.claude/skills/orchestrate/SKILL.md`
  - `project-docs/plan/tools/lead/land.sh`
  - `project-docs/context-component-registry.yaml`
  - `project-docs/module-catalog.yaml`
- 읽을 것:
  - `project-docs/products/roadmap/testing.md`("폴더"의 `tools/fake-provider/` 항목, "단계" 3, "끝남 기준")
  - `project-docs/plan/testing/research/facts-main.md` 2절(`tools/fake-provider/`와 `tools/dev.ts`가 쓰는 곳), 6절(core 기동과 token)
  - boundary·module: `project-docs/module-catalog.yaml`의 `tools`
  - 코드: `tools/dev.ts`(`runDev`, `planFakeProvider`, `shouldStartFakeProvider`, `removeDataRoot`), 앞 task가 만든 `tests/support/fake-server/`(`startFakeServer({fallback})`)와 `tests/support/core/`(`bootCore`, `connectFakeProvider`, `Core.stop`)
  - `.claude/skills/write-test/SKILL.md`, `.claude/skills/orchestrate/SKILL.md`(54행 근처 "E2E, 브라우저, … 새로 만들지 않는다"), `project-docs/plan/tools/lead/land.sh`
- **`tools/fake-provider/`의 file은 새 fake를 만들 때 열지 않았어야 한다.** 이 task는 그것을 지우는 task다. 지우기 전에 `git grep -n "fake-provider"`로 남은 참조를 모두 찾는다.
- 계약:
  - 쓰는 것: `startFakeServer`(fake-server), `createRun`/`bootCore`/`connectFakeProvider`(core support). dev는 `.dev-data`를 data root로 쓰므로 `createRun`을 쓰지 않고 `bootCore` 앞단이 받을 수 있는 `home` 인자 모양에 맞춘다(필요하면 `bootCore`가 `Run`을 받는 모양에 `{home, dir}`를 만들어 건넨다. support 파일은 이 task의 소유가 아니므로 못 맞추면 "계약 바꾸기 요청").
  - 내놓는 것: `deno task dev`·`deno task dev:core`로 띄운 core에 fake provider가 연결돼 있고 첫 turn이 fake 대답을 받는다. 환경 변수 `LOPHN_FAKE_PROVIDER_URL`은 없다.

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

(사람에게 물을 것 1건이 있다. 아래는 추천안이다. 사람이 다르게 정하면 lead가 이 brief를 고쳐 다시 연다.)

- **문제**: `deno task dev`(Electron)에서는 shell main이 core를 띄우고 user token을 hello frame으로만 받는다. `tools/dev.ts`는 token을 못 받아 `providers/connect`를 부를 수 없다. 제품에 test 전용 flag나 token을 흘리는 길을 더하지 않는다(README "정한 것" 11).
- **추천안**: dev.ts가 앱을 띄우기 **전에** 한 번 core를 직접 띄워 연결을 심고 닫는다. 순서: ① `.dev-data`를 0700으로 만든다 ② `.dev-data/settings.json`에 `lophn-agent.model.catalog_auto_update: false`를 합쳐 쓴다(이미 있으면 그 JSON에 key만 더하고 0600 유지. `bootCore`는 이미 있는 settings.json을 건드리지 않는다) ③ fake server를 고정 port로 띄운다(아래) ④ core를 pipe로 띄워(`bootCore`와 같은 방식, 단 data root는 `.dev-data`) hello의 user token으로 `providers/list`를 읽어 fake provider가 이미 있으면 그대로 두고, 없으면 `providers/connect`(`auth_kind: none`, loopback endpoint)와 `model-default/change`를 부른다 ⑤ core를 정상 종료한다 ⑥ 그 다음 `dev`는 shell main을, `dev:core`는 core를 평소처럼 띄운다. 연결은 ledger에 남아 있으므로 ⑥의 core가 시작할 때부터 그 provider를 쓴다.
- **고정 port**: provider의 `endpoint`가 ledger에 고정되므로 fake server의 port가 실행마다 바뀌면 안 된다. dev의 fake server는 고정 port(기본 `7499`, env `LOPHN_DEV_FAKE_PORT`로 바꿈)다. 이것은 test의 "고정 port 금지"의 예외다(사람이 한 번에 하나만 띄우는 개발 도구). 이미 쓰는 중이면 이유를 말하고 실패한다.
- fake server는 `startFakeServer({fallback: {kind: "text", text: ...}})`다: queue 없이 늘 같은 짧은 대답을 낸다. 대답 글은 "fake model: …" 한 줄이면 된다(지금 dev에서 첫 turn이 이 글을 받는 것이 끝남 기준이다).
- `LOPHN_LIVE_PROVIDER=1`이면 지금처럼 fake를 띄우지도 연결을 심지도 않는다(이 env는 제품의 OAuth gate도 읽는다).
- `dev:mock`은 건드리지 않는다.
- 이 설계가 안 되면(예: `bootCore`를 `.dev-data`에 맞출 수 없음, 연결이 재시작 뒤 사라짐) 고치려 하지 말고 "계약 바꾸기 요청"에 적는다.

## 할 일

1. `tools/dev.ts`: `FAKE_URL`, `planFakeProvider`, `fakeProviderReady`, `shouldStartFakeProvider`의 옛 형태, `Purpose`의 `"fake"`, 머리 주석의 `LOPHN_FAKE_PROVIDER_URL` 설명을 지운다. 위 추천안의 ①~⑥으로 바꾼다. `ProcessGroup`, `removeDataRoot`, `runDev`의 나머지 구조는 그대로 둔다. 근거: roadmap "폴더", "단계" 3.
2. `tools/fake-provider/` 폴더 전체를 `git rm`한다. 근거: README "정한 것" 8.
3. `project-docs/context-component-registry.yaml`에서 `tool-fake-provider` 항목(`path: tools/fake-provider/`)을 지운다. `tools/check-docs.ts`가 registry의 path가 있는지 보므로 안 지우면 check가 실패한다. 새 조각(`tests/support`, `deno task e2e`, `deno task test:live`)을 올리는 일은 lead의 몫이다.
4. `project-docs/module-catalog.yaml`: `tools`의 notes에서 "fake provider"를 뺀다(한 줄).
5. `AGENTS.md` "사람에게 묻는 것"의 줄을 "실제 model provider 호출(개발은 `deno task dev`가 띄우는 fake, test는 `tests/support/fake-server`와 녹화 재생)"로 고친다. 그 밖의 줄은 건드리지 않는다.
6. `.claude/skills/write-test/SKILL.md`: 새 층을 반영한다(요점만, 짧게).
   - "모양"의 마지막 줄("model이 끼는 부분은 fake provider의 script나 녹화 응답으로 본다")을 새 fake 셋으로 고친다: loop는 scripted model(`tests/support/loop`), provider wire는 녹화 재생 `fetch`(`tests/support/wire`)와 `tests/fixtures/provider/`, core E2E와 dev는 fake server(`tests/support/fake-server`).
   - 층 표를 짧게 더한다: 코드 옆 `*_test.ts`(unit), `tests/harness`(loop, wire. check), `tests/e2e`(`deno task e2e`. lead가 land 전에), `tests/live`(`deno task test:live`. 사람이 key를 줄 때만).
   - "사람에게 묻는 test"는 유지한다. 새 E2E flow는 여전히 사람에게 묻는다(첫 묶음 6개는 이 계획이 만들었다). E2E 새 flow는 "contract 하나에 test 하나, 가장 싼 층, 세 질문"을 따른다는 한 줄.
   - "check 파이프라인"에 `tests/harness`·`tests/support`가 check에 들고 `tests/e2e`·`tests/live`는 안 든다는 한 줄.
7. `.claude/skills/orchestrate/SKILL.md` 54행의 "E2E, 브라우저, 스크린샷, subprocess·서버 test는 새로 만들지 않는다."를 "…는 새로 만들지 않는다(계획이 brief로 정한 `tests/e2e`의 flow만 예외)"로 고친다.
8. `project-docs/plan/tools/lead/land.sh`: `deno task check:full` 바로 뒤에 `deno task e2e`를 같은 모양(`out=$(...) || { echo "$out" | tail -30; echo "STOP: e2e failed"; exit 1; }`)으로 더한다. (`tests/e2e`가 비어 있는 계획이 `deno task e2e`에서 "No test modules found"로 막히지 않도록, e2e 폴더에 `*_test.ts`가 있을 때만 돈다.)
9. 손 확인(commit하지 않는 임시 스크립트): 위 ①~⑤를 마친 `.dev-data`를 `bootCore`로 다시 띄워 `openSession(lophn)` → `say` → `waitTurnEnd`를 하고, `messages/list`에 fake의 대답 글이 있는 것을 본다. 이것이 "`deno task dev`의 첫 turn이 fake 대답을 받는다"(roadmap 끝남 기준)의 대리 확인이다. 끝나면 `removeDataRoot`로 `.dev-data`를 지운다. 이 환경에서 Electron을 못 띄우면 그렇다고 보고한다(실제 `deno task dev` 확인은 사람에게 부탁한다).

## 세 질문

- contract: 개발 도구라 boundary ID가 없다(module-catalog `tools`). 지키는 것은 "dev의 agent가 fake에 닿는다. 제품에 test 전용 길이 없다"와 "문서가 가리키는 층이 코드와 같다"이다.
- 현실적 회귀: `deno task dev`가 fake를 띄우고 env를 넘기지만 읽는 코드가 처음부터 없어 agent가 fake에 닿지 않았던 것.
- 왜 지금 test로 못 잡나: `tools/`에는 test가 0개이고 dev 도구를 test하지 않는다(AGENTS.md "속도"). 9번의 손 확인으로 갈음한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(개발 도구. 9번을 손으로 확인한다)
- 남지 않음: `grep -rn "LOPHN_FAKE_PROVIDER_URL" tools packages`가 0줄이다. `git grep -n "fake-provider"`가 `project-docs/products/change-log/`, `project-docs/issues/archived/`, `project-docs/plan/`을 뺀 곳에서 0줄이다. `tools/fake-provider/`가 없다.
- `deno task e2e`가 6 flow를 돈다(이 task에서 새로 만든 것이 아니라 앞 task들의 결과를 land 전에 확인한다).

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

