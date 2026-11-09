---
name: flows
description: lophn의 flow catalog(`project-docs/flows/`)를 고치거나 쓸 때 쓴다. route·CLI 명령·agent tool·단축키 command·IPC channel·SDK export·내장 skill·control 요청이나 test file을 더하거나 지우거나 이름을 바꿀 때, 기존 동작에 실패 갈래·오류 code가 생기거나 바뀔 때, `npm run check`의 flows 단계가 실패할 때, 계획이 끝나 바뀐 동작을 catalog에 맞출 때, coverage를 보고 무엇을 test할지 고를 때, 여러 area를 다시 조사할 때.
---

# flows

catalog의 꼴과 쪼개는 규칙의 원본은 `project-docs/flows/README.md`다. 이 skill은 언제 무엇을 고치는지의 절차다. 쓰기 전에 README를 읽는다.

## 명령

| 명령 | 쓸 때 |
|---|---|
| `node tools/flows.ts check` | 끝내기 전. `npm run check`의 flows 단계와 같다 |
| `node tools/flows.ts check --file <yaml>` | file 하나를 고치는 중 |
| `node tools/flows.ts entries [--area <a>] [--unaccounted] [--json]` | 입구 목록과 소유자. 어느 area인지 |
| `node tools/flows.ts index [--area <a>]` | flow id·outcome 한 줄씩. 참조할 ID 찾기 |
| `node tools/flows.ts report` | coverage, 덮이지 않은 risk outcome, core E2E 후보 |
| `node tools/flows.ts events` · `frames` | `event:`와 journey `screen`에 쓸 수 있는 이름 |
| `node tools/flows.ts frames --unused` | catalog가 가리키지 않는 wireframe frame을 정의한 file별로. 화면을 더하거나 journey에 `screen`을 달 때 |
| `node tools/flows.ts sample --area <a> --n 5 --seed <s>` | review 표본 |

## 무엇을 바꾸면 무엇을 고치나

| 바꾼 것 | 고칠 것 |
|---|---|
| 함수 안 로직, 리팩터링(입구·끝 갈래 그대로) | 없음 |
| `code` 칸의 file을 옮기거나 지움 | 그 flow의 `code`·`steps` path |
| 입구를 더함 | `entries --area`로 area를 찾아 그 area file에 flow를 쓰거나 기존 flow의 `entries`에 더한다. surface(CLI·단축키·IPC·SDK)가 이미 있는 동작을 부르기만 하면 그 surface file의 `links` |
| 입구를 지우거나 이름을 바꿈 | 소유 flow의 `entries`. 이름이 바뀌면 flow id도 맞추고 `grep -rn "<옛 id>:" project-docs/flows`로 참조를 고친다 |
| route의 `errors` 선언을 바꿈, handler에 실패 갈래가 생기거나 없어짐 | 소유 flow의 outcome. 선언만 있고 내지 않는 code는 `declared_only` |
| 동작 순서·조건이 바뀜 | `steps`, `when`, `observe` |
| test file을 더하거나 지움 | `tests/<group>.yaml` 한 줄과 `covers`. group은 `areas.yaml`의 `test_groups` path로 정한다 |
| 새 journey가 가는 길이 새 종류의 사용자 이야기 | `scenarios/<group>.yaml`의 scenario(없던 사용자면 새로, 있으면 `journeys`에 id 추가). 구현이 아니라 사람의 상황으로 쓴다 |
| 사람이 화면에서 하는 새 동작(입구 없음) | 그 mechanism을 `owns`에 가진 area에 `ui:`·`system:` flow |

입구가 없는 동작(`ui:`·`system:`)과 기존 입구 안의 순서·조건 변화는 check가 못 잡는다. 바꾼 사람이 직접 고친다.

## check 실패 고치기

| 문구 | 할 일 |
|---|---|
| `<entry>: 소유되지 않음` | 위 표의 "입구를 더함" |
| `없는 entry: <id>` | 입구가 지워졌거나 이름이 바뀌었다. `entries`로 새 이름을 찾는다 |
| `<route>가 선언한 <code>가 outcome code에 없음` | handler(그리고 `packages/core/server/dispatch.ts`)를 열어 그 code가 나는지 본다. 나면 outcome, 안 나면 `declared_only`와 `unclear` 한 줄 |
| `없는 outcome: <flow>:<outcome>` | outcome id가 바뀌었다. flow를 읽고 맞는 id로 다시 가리키거나, 더는 갈래가 아니면 참조를 지운다 |
| `어느 tests file에도 오르지 않음` | test file을 group file에 올린다 |
| `없는 path` | file이 옮겨졌다. `code`·`docs`를 고친다 |
| `id가 겹침` | 늦게 만든 쪽 id를 바꾼다. 참조가 있으면 같이 |

## flow와 outcome을 쓸 때

README "outcome"과 "쪼개는 기준"을 따른다. 조사 review에서 반복해서 틀린 것:

- outcome은 handler가 실제로 내는 것만. schema enum이나 주석에서 옮기지 않는다. 의심은 `unclear`에.
- handler 맨 앞의 부르는 쪽 검사(`requireUser`, `requireMachine`, `gate()`, IPC sender 검사)가 내는 `forbidden`을 빠뜨린다. 같은 guard로 시작하는 형제 flow에도 다 쓴다.
- `if (!x.ok) return x`로 그대로 올라오는 앞 read·port·안쪽 command의 실패를 빠뜨린다.
- step에 "거절한다"고 쓰고 outcome이 없다. step의 판정마다 outcome이 있어야 한다.
- 같은 code를 내는 원인이 여럿인데 `when`에 하나만 쓴다.
- 창으로 밀어 보내는 상태를 `response`로 쓴다. 그것은 `screen:`이나 `event:`다.
- step에 쓴 port가 production wiring에서 no-op인지 보지 않는다(wiring site를 연다).
- `crosses_process`: 받은 process가 다른 lophn process를 하나 더 거쳐야 할 때만 true. core 안 ledger writer·reader는 Worker thread라 같은 process, blob 준비는 platform/io child라 다른 process.

## scenario를 쓸 때

README "scenario"를 따른다. 구현(route, 화면 이름)이 아니라 사람의 상황을 쓴다. `has`는 mock data의 근거라 숫자와 이름을 구체적으로 적는다. 그 data를 wireframe에서 쓰게 되면 `tools/wireframes/mock/scenarios/<id>.ts`로 두고(file 이름이 id), scenario의 `has`와 맞춘다. 순수 component 견본의 data는 scenario가 아니다. eval과 잇지 않는다.

## test를 고를 때

`report`의 "Uncovered risk outcomes"와 "E2E candidates"에서 고른다. 목표치는 risk outcome뿐이다. 다른 숫자는 test를 늘리라는 뜻이 아니다. 쓸지 말지와 모양은 `write-test` skill. 쓴 test는 `tests/<group>.yaml`에 그 test가 단정하는 outcome으로 올린다(판정 함수를 단정하는 unit test도 그 outcome을 덮는다).

## 계획이 끝났을 때

`wrap-plan` 중에 한다.

1. `git diff <계획 시작>..HEAD -- packages`에서 바뀐 handler·화면을 보고, 그 code를 `code`에 가진 flow(`grep -rln "<path>" project-docs/flows/areas`)의 steps·outcome이 맞는지 본다.
2. 계획이 만든 `ui:`·`system:` 동작이 flow에 있는지 본다.
3. `check`와 `report`를 돌려 coverage가 줄었으면 이유를 change-log 항목의 `change`에 적는다.

## 여럿을 다시 조사할 때

area 여러 개를 처음부터 다시 쓰거나 크게 고칠 때는 `survey.md`의 절차(worker 나누기, brief, review 기준, fix pass, gap fill)를 따른다.

## 하지 않는 것

- 생성되는 entry(`route:` 등)를 손으로 지어내지 않는다. 손으로 쓰는 것은 `system:`·`ui:`뿐이다.
- test code에 flow 표시를 넣지 않는다. 연결은 `tests/*.yaml`에만 둔다.
- check를 통과시키려고 없는 outcome을 만들지 않는다. 내지 않는 code는 `declared_only`다.
