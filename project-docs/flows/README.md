# flows

lophn이 하는 동작을 빠짐없이 적은 catalog다. 셋을 잇는다: 입구(entry), 동작(flow)과 그 끝 갈래(outcome), 사람이나 agent가 목표 하나를 이루는 길(journey), 그 길을 가는 구체적인 사용자 예(scenario). test가 어느 outcome을 덮는지도 여기 적는다. coverage는 `node tools/flows.ts report`가 잰다.

- 규칙과 이유는 architecture 문서에 있다. flow는 그것을 옮겨 적지 않고 `docs`로 가리킨다.
- coverage 숫자는 test를 늘리라는 뜻이 아니다. 목표는 risk가 붙은 outcome뿐이다(AGENTS.md "속도"의 위험 목록).
- 글은 한국어로 쓰고 개발자 영어 단어는 그대로 쓴다(AGENTS.md "말"). ID와 칸 이름은 영어다.

## 자리

| path | 무엇 |
|---|---|
| `areas.yaml` | area 지도: area마다 entry를 정의하는 path, 맡는 mechanism, 읽을 문서. test 묶음과 journey 묶음 |
| `areas/<area>.yaml` | area 하나의 flow, links, ignore |
| `journeys/<group>.yaml` | journey |
| `scenarios/<group>.yaml` | scenario. 구현과 무관한 사용자 예 |
| `tests/<group>.yaml` | test file 하나마다 덮는 outcome |
| `tools/flows.ts` | `entries`, `index`, `check`, `report`, `sample`, `events`, `frames [--unused]` |

## entry

무엇을 시작하게 하는 입구 하나다. 손으로 쓰지 않고 `node tools/flows.ts entries`가 code에서 뽑는다. `system:`과 `ui:`만 손으로 쓴다.

| ID 꼴 | 어디서 뽑나 |
|---|---|
| `route:<resource>/<method>` | `packages/protocol`, `packages/core`의 `defineRead`·`defineCommand`·`defineMemory` |
| `cli:<name>` | `packages/cli/commands`의 `defineCommand`의 `name`(예: `cli:app.read`) |
| `tool:<name>` | `defineTool`의 `name`. 정적인 것만이다. CLI 명령은 lophn agent의 `lophn` tool로도 불리지만 `cli:`로 센다. 앱 command·MCP·extension tool은 동적이라 entry가 없다 |
| `key:<command>` | `packages/shell/ipc/keybindings.ts`의 `Command` |
| `ipc:<channel>` | `packages/shell/ipc/*.ts`의 `*_CHANNEL` 상수 |
| `sdk:<package>/<export>` | `packages/sdk/<package>/mod.ts`의 runtime export. 다른 package에서 다시 내보낸 것도 sdk area다 |
| `skill:<name>` | `packages/core/agent-workspaces/skills/<name>/` |
| `control:<type>` | core control socket 요청의 `type`(`packages/protocol/supervision/core-control.ts`) |
| `system:<name>` | 손으로. 사람도 agent도 부르지 않고 도는 것: 기동, migration, timer, child crash, file watch |
| `ui:<name>` | 손으로. 위 어느 것도 거치지 않는 사람의 화면 조작 가운데 상태를 남기거나 main·core로 건너가는 것(예: 탭을 다른 group으로 끌기). route를 부르는 버튼은 `ui:`가 아니다. 그 route의 flow다 |

event는 entry가 아니다. outcome의 `observe`에 `event:<name>`(PascalCase, `node tools/flows.ts events`)으로 쓴다.

모든 entry는 정확히 한 번 소유된다: 어느 flow의 `entries`, 어느 area의 `links`, 어느 area의 `ignore` 가운데 한 곳이다. 쓰기만 하는 곳은 `uses`에 쓰고 몇 번이든 된다.

## flow

입구 하나와 의도 하나로 시작해서 밖에서 보이는 상태(disk, ledger, event, 응답, process)로 끝나는 동작 하나다.

```yaml
area: app-release            # file 이름과 같다
flows:
  - id: release-activate     # kebab-case, 모든 area에서 하나. area를 이름에 넣지 않는다
    title: 준비한 release를 운영 앱으로 올린다
    actor: agent             # person | agent | coding-agent | app | shell | system
    entries: [route:releases/activate]     # 소유하는 입구
    uses: [route:activations/consents]     # 소유하지 않고 거치거나 부르는 것
    pre: [route:releases/prepare]          # 앞에 있어야 하는 상태. entry ID나 <flow>:<outcome>
    when: ""                 # 같은 입구가 조건에 따라 다른 동작이면 그 조건(선택)
    boundary: [app-releases, app-runtime]  # boundary-catalog ID
    code: [packages/core/apps/activation/] # 주로 읽은 path. 있어야 한다
    steps:                   # 1~7줄. "누가 무엇을 한다" 꼴
      - core가 선언을 앞 release와 견줘 동의가 필요한지 정한다
      - 동의가 필요 없으면 앱 child를 띄우고 running을 기다린다
    outcomes:
      - id: running
        observe: [ledger:releases, event:AppStarted]
      - id: consent-pending
        when: 첫 activation, 선언이 넓어짐, data 손실 migration
        observe: [response]
      - id: start-timeout
        code: unavailable
        when: 120초 안에 running이 되지 않음
        observe: [response, log:app]
    crosses_process: true
    risk: [data-loss, permission]
    refs: [A9, A11]          # project-docs/products/AGENT.md의 줄 ID
    docs: [architecture/activation.md]     # project-docs 기준 path
    unclear: []              # 읽고도 정하지 못한 것. 한 줄씩
    declared_only: []        # 소유한 route가 errors에 선언했지만 handler가 내지 않는 code(선택)
links:                       # 이 area가 정의한 entry인데 다른 area의 flow가 시작하는 것
  - {entry: "cli:release.activate", flow: release-activate}
ignore:                      # flow의 입구가 아닌 entry. 이유를 쓴다
  - {entry: "route:debug/dump", reason: dev 전용, 제품 동작 없음}
```

칸:

- 필수: `id`, `title`, `actor`, `boundary`, `code`, `steps`, `outcomes`, `crosses_process`. `entries`나 `uses` 가운데 하나는 비지 않는다.
- `actor`는 입구를 부르는 쪽이다. 사람이 화면에서 눌러 renderer가 부르는 route는 `person`, shell main이 스스로 부르는 것(harness host, host queue)은 `shell`, CLI나 tool로 agent가 부르는 것은 `agent`, core나 child process만 부르는 내부 route는 `system`이다.
- `pre`는 모두 성립해야 하는 앞 상태다(AND). 둘 중 하나면 흔한 쪽 하나만 쓴다.
- `pre`, `uses`가 다른 area를 가리킬 때 그 area의 flow가 아직 없으면 entry ID로 쓴다. entry는 code에서 뽑으므로 늘 있다.
- `crosses_process`는 부른 쪽의 요청을 받은 process가 일을 끝내려고 다른 lophn process(core daemon, platform/io child, agent runtime, 앱 child, preview·prepare child, flow host, shell main, renderer)를 하나 더 거쳐야 하는지다. core 안의 Worker thread(ledger writer, reader)는 core와 같은 process다. blob 준비는 platform/io child를 거친다. 부르는 쪽에서 받는 쪽으로 한 번 건너는 것(renderer가 core route를 부름, agent가 tool로 core를 부름)만으로는 false다. git, npm 같은 바깥 CLI는 세지 않는다. core E2E 후보를 고를 때 쓴다.
- 소유한 route가 protocol에 선언한 `errors`의 code는 그 flow의 outcome `code`(또는 id)에 있어야 한다. schema 검사의 `invalid_input`과 자격 검사의 `unauthorized`는 모든 route에 같아서 빼도 된다. handler가 실제로 내지 않는 code는 `declared_only`에 두고 이유를 `unclear`에 쓴다. 선언을 고칠 곳이라는 신호다. check가 본다.
- `risk`는 아래 다섯 가운데서만 고른다. 없으면 칸을 두지 않는다.

| risk | 언제 |
|---|---|
| `data-loss` | 사용자 data(사람의 파일, ledger, 앱 DB, 설정, secret)를 잃거나 망가뜨릴 수 있다. 되돌리기(rewind, revert)도 여기다 |
| `permission` | 허락, 할당, 승인, 동의, credential 발급을 판정하는 것이 그 flow의 일이다. scope로 거르기만 하는 read에는 붙이지 않는다 |
| `secret` | secret 값이 새거나 엉뚱한 요청에 붙을 수 있다 |
| `sandbox` | 폴더 밖 쓰기, 앱·agent process의 file·network 경계, 인터넷에서 온 것 |
| `twice-fixed` | 두 번 이상 고친 bug가 있다. 그 이슈나 changelog를 `docs`에 둔다 |

## outcome

부르는 쪽이 구별할 수 있는 끝 상태 하나다.

- `id`는 flow 안에서 하나다. 성공은 상태 이름(`running`, `queued`)이나 `ok`, 실패는 공통 오류 code(`not_found`, `conflict` 등)나 그 갈래 이름이다. route가 오류로 돌려주면 `code`에 일곱 가운데 하나를 쓴다. ok로 돌려주고 출력의 상태로 실패를 알리면(release 준비의 `failed`) 갈래 이름만 쓰고 `code`를 두지 않는다.
- 오류 문구가 달라도 부르는 쪽이 같게 다루면 같은 outcome이다. handler가 돌려주는 code와 상태가 다르면 나눈다.
- `invalid_input`처럼 schema가 막는 것은 그 flow가 따로 다루는 갈래일 때만 쓴다.
- outcome은 handler가 실제로 낼 수 있는 것만 둔다. schema enum에 있어도 code가 만들지 않으면 outcome이 아니라 `unclear`에 쓴다.
- step에 쓴 판정은 모두 outcome이 있어야 한다. 앞 read나 port가 실패해 그대로 돌려주는 오류, 이른 return, `preventDefault` 같은 방어 갈래도 갈래다.
- 기계 전용 route의 `requireMachine` 같은 검사도 똑같이 outcome으로 둔다(actor가 `system`이어도).
- route마다 handler 맨 앞의 부르는 쪽 검사(`gate()`, `requireUser`, `requireMachine`, desktop 창 sender 검사)가 내는 `forbidden`도 outcome이다. wrapper가 부르는 안쪽 command의 실패도 그 flow의 갈래다. 두 방향 channel이면 두 방향을 다 쓴다.
- 같은 code를 내는 원인이 여럿이면 `when`에 모두 쓴다. handler 묶음이 같은 guard(예: `requireUser`)로 시작하면 그 묶음의 flow마다 그 guard를 `when`에 쓴다.
- `observe`는 test가 단정할 자리다. 앞머리는 `disk:`, `ledger:<표>`, `event:<name>`, `response`, `request:<받는 쪽>`(fake model, 바깥 server), `process:`, `screen:<frame id>`, `log:` 가운데 하나다.
- 창으로 밀어 보내는 상태는 `screen:<frame id>`나 `event:`다. 부른 쪽이 받는 답만 `response`다. 거절되어 밖에서 아무 일도 없으면 거절을 받은 쪽(`response`, `log:`)을 쓴다.
- outcome의 참조 꼴은 `<flow id>:<outcome id>`다.

## 쪼개는 기준

1. 상태를 바꾸거나, 경계를 넘거나, 판정이 있을 때만 flow다. 다른 flow 안의 한 단계는 그 flow의 `steps`에 쓴다.
2. 부수효과 없는 read route는 resource와 부르는 쪽(actor)이 같으면 flow 하나로 묶는다(`entries`에 여럿). outcome은 `ok`와 handler가 실제로 돌려주는 실패만 둔다.
3. 같은 일을 하는 다른 입구(route와 그것을 부르는 CLI 명령과 tool)는 flow 하나다. surface area는 `links`로 잇는다. CLI나 IPC에만 있는 동작(core가 없으면 띄우기, 창 조작)은 그 surface area의 flow다.
4. core나 child process만 부르는 내부 route(activation 기록, report 같은)도 entry라 소유가 필요하다. 그 route가 자기 판정(거절, 상태)을 가지면 작은 flow 하나(actor `system`)로 두고 부모 flow가 `uses`로 가리킨다. 판정 없이 값만 읽는 내부 read는 부모 flow의 `entries`에 같이 둔다.
5. 같은 입구가 조건에 따라 아예 다른 일을 하면 flow를 나눈다. 하나는 그 입구를 소유하고 나머지는 `uses`와 `when`으로 쓴다(예: turn이 도는 중의 메시지 보내기는 steer).
6. 화면의 모양, 문구, 배치는 flow가 아니다. 화면은 journey와 `observe`의 `screen:`에 쓴다.
7. agent가 의미로 판단하는 일(AGENT.md의 L·A 줄)은 flow가 아니다. journey가 줄 ID로 가리킨다.

## journey

```yaml
group: app
journeys:
  - id: first-app
    title: 처음 앱을 만들어 쓴다
    actor: person            # person | agent | coding-agent
    goal: 말로 설명한 앱을 화면에서 쓴다
    refs: [L4, A1, A7, A8, A9, A11]
    steps:
      - {do: Home에서 New session을 연다, screen: home-session, flow: session-open:ok}
      - {flow: release-activate:consent-pending}
      - {do: 첫 activation의 동의를 허락한다, screen: new-waiting-first-activation, flow: activation-consent:ok}
    gaps:                    # 이 journey에 필요한데 catalog에 없는 동작. journey에서 flow를 만들지 않는다
      - 앱 화면을 처음 여는 동작
```

- `flow`는 있는 `<flow>:<outcome>`이다. `screen`은 wireframe page id(`?frame=<id>`, `node tools/flows.ts frames`)다.
- journey는 사람(또는 agent)이 실제로 그 순서로 가는 길이다. 같은 길의 갈래(동의 거절)는 따로 journey로 둔다.

## scenario

journey가 추상적인 길이라면 scenario는 그 길을 가는 구체적인 사용자 한 사람이다. 누가 어떤 상황에서 무엇을 말하고 어떤 data를 갖고 무엇을 기대하는지를 자연어로 쓴다. 구현을 모르고 쓴다. wireframe의 mock data는 여기서 나오고, 위험한 규칙의 test가 edge case를 필요로 할 때만 여기서 가져간다.

```yaml
group: app                   # file 이름과 같다. journey_groups와 무관하다
scenarios:
  - id: bakery-reservations  # kebab-case, 모든 scenario file에서 하나
    who: 개발을 모르는 동네 빵집 사장
    situation: 전화와 카톡으로 받던 예약을 한곳에 모으고 싶다
    says: ["예약 받는 앱 만들어줘", "토요일 예약만 보여줘"]   # 선택. 글자 그대로의 말
    has: 손님 40명, 한 주 예약 30건, 같은 이름 손님 둘        # 가져온 data
    expects: 앱 화면에서 날짜별 예약을 보고 고친다
    journeys: [app-plan-from-home]    # 있는 journey id. 하나 이상
    edges: [예약 0건, 같은 이름 손님]  # 선택
```

- 필수: `id`, `who`, `situation`, `has`, `expects`, `journeys`. journey의 step을 되풀이하지 않는다. 길은 journey가 말한다.
- mock data와는 file 이름으로 잇는다: `tools/wireframes/mock/scenarios/<scenario id>.ts`(또는 `.tsx`)가 그 scenario의 고정 data다. text를 훑어 찾지 않는다. `check`는 scenario가 없는 이름의 file을 거절한다. mock이 없는 scenario는 괜찮다(`report`가 센다).
- 사람이 쓴 글이지 data가 아니다. `has`의 숫자와 이름이 mock과 어긋나면 mock을 scenario에 맞춘다.

## screen과 frame

wireframe gallery의 page 하나(`{id, title, description, render}`)는 화면의 한 상태(screen state)다. catalog는 그 page를 id로 가리킨다(journey의 `screen`, outcome의 `observe: [screen:<id>]`). 가리키는 쪽은 catalog뿐이고 page는 catalog를 모른다.

- `node tools/flows.ts frames --unused`는 어느 journey step이나 outcome observe도 가리키지 않는 frame을 정의한 file별로 보인다. `check`는 막지 않는다. 화면을 다듬을 때 참고하는 목록이다.
- kit page(`tools/wireframes/pages/kit/`)는 component 견본이지 화면이 아니라서 `report`가 따로 센다. frame coverage 숫자는 screens만의 것이다.

## test 연결

```yaml
group: e2e
files:
  - path: tests/e2e/app-activation_test.ts
    covers: [release-activate:consent-pending, activation-consent:ok]
  - path: packages/shell/renderer/shell/group-geometry_test.ts
    covers: []               # flow를 보지 않는 내부 test
    note: 나눔 tree 계산
```

- git이 아는 `*_test.ts` 하나가 어느 group에 꼭 한 번 오른다.
- `covers`에는 그 test가 그 outcome이 일어난 것을 단정할 때만 쓴다. 준비 단계로 거쳐 가기만 하는 outcome은 쓰지 않는다.
- route를 부르지 않아도 그 outcome을 가르는 판정 함수(선언 비교, Gate 판정, 검사, 상태 전이)를 단정하는 unit test는 그 outcome을 덮는다. parser, 형식, 계산 helper처럼 outcome을 가르지 않는 것만 보는 test가 `covers: []`다.
- 층은 path로 정한다: `tests/e2e/` core-e2e, `tests/harness/loop/` harness-loop, `tests/harness/wire/` harness-wire, `tests/live/` live, 나머지 unit.

## 고칠 때

- route, CLI 명령, tool, 단축키 command, IPC channel, SDK export, 내장 skill, control 요청을 더하거나 지우면 같은 변경에서 그것을 소유하는 flow(또는 `links`, `ignore`)를 고친다. 어느 area인지는 `areas.yaml`의 `entries` path가 정한다.
- test file을 더하거나 지우면 `tests/<group>.yaml`을 고친다.
- `npm run check`가 `node tools/flows.ts check`를 돌린다. 소유되지 않거나 두 번 소유된 entry, 없는 ID를 가리키는 참조, 오르지 않은 test file, route가 선언했는데 소유 flow의 outcome에 없는 오류 code가 있으면 실패한다.
- 기존 입구 안의 순서·조건 변화와 `ui:`·`system:` 동작은 check가 못 잡는다. 절차는 `.claude/skills/flows/SKILL.md`.
