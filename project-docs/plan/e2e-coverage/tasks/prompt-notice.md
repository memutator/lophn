# prompt-notice

사람이 turn 사이에 `LOPHN.md`를 고치면 다음 model 요청의 prefix(system)는 그대로이고 바뀐 지침이 대화 끝에 notice로 붙는지, 그리고 같은 폴더의 `AGENTS.md`는 어느 요청에도 들어가지 않는지를 `tests/e2e/prompt-notice_test.ts` 하나로 본다.

**이 task는 제품 동작을 정해야 할 수 있다(아래 "먼저 알아 둘 것"). 단정이 빨강이면 test를 고쳐 맞추지 말고 보고한다. 이 file을 따로 둔 것은 그 사이 `prompt-blocked`가 막히지 않게 하려는 것이다.**

- 단위: prompt-notice (wave 2)
- 선행: reply-fn. `tests/support/fake-server/probe.ts`의 `systemText`·`lastUserText`를 쓴다(support brief의 이름으로 맞춘다).
- 소유(이 task만 고친다):
  - `tests/e2e/prompt-notice_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 동작이 문서로 정해져 있고 한 module 안일 때만. 이 path가 아닌 곳을 고쳐야 하거나 동작을 새로 정해야 하면 먼저 보고한다):
  - `packages/core/lophn-agent/prompt-assembly/`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 7절 `instructions-change-next-turn`, `agents-md-ignored`
  - architecture: `project-docs/architecture/agent-definition.md`("도는 turn은 시작 때 읽은 판을 끝까지 쓴다", "`AGENTS.md`는 읽지 않는다", "지침 반영: 대화 끝에 덧붙이기")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `run-loop`, `agent-roles`
  - 코드: `packages/core/lophn-agent/prompt-assembly/{turn-prompt,basis}.ts`(`assembleTurnPrompt`, `diffBasis`, `noticesOf`), `packages/core/lophn-agent/run-loop/prepare.ts`(`seenBySession`은 runtime child 메모리의 Map. 지난 turn의 판을 hash로만 쥔다), `packages/core/lophn-agent/instructions/{files,turn}.ts`(지침은 `LOPHN.md` 이름 하나만 읽는다. project 층은 첫 등록 폴더 바로 아래), `packages/protocol/lophn-agent/input-tags.ts`(`lophn-notice`, `instructions_changed`)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/journal`, `Reply`)와 `probe.ts`
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: 위 support. 새 helper를 만들지 않는다.
  - 내놓는 것: 없음(test file만)

## 층을 정한 이유

core E2E다. 지침 file은 core의 reader Worker가 읽고, 판 비교(`seen`)와 prompt 조립은 agent runtime child 안에서 하고, 결과는 model 요청으로 나간다. harness loop의 `context` port는 `notices: []`로 박혀 있어(`tests/support/loop/harness.ts`) 이 길에 닿지 못하고, `assembleTurnPrompt`에는 unit이 없다. 조립 함수만의 경우의 수(층 여럿, tool·context·agent 변화)는 필요하면 `prompt-assembly/turn-prompt_test.ts` unit으로 늘린다(이 task에서 만들지 않는다).

## 먼저 알아 둘 것(planner가 코드를 읽고 찾은 것)

`assembleTurnPrompt`는 system의 지침 block을 **그 turn이 읽은 지금 지침**으로 만들고, `seen`(`SeenBasis`)에는 층별 hash만 있다. 그래서 지침이 바뀐 다음 turn의 system이 바뀐 글이 되고(prefix가 달라진다) notice에도 같은 글이 또 실린다. 문서는 "prefix는 그대로, 바뀐 것은 notice로 대화 끝에"라고 쓴다. 지금 코드로는 아래 단정 1이 빨강일 가능성이 높다. 또 notice는 그 turn 요청에만 붙고 이력에 저장되지 않아(`historyMessages`는 session 기록에서 다시 만든다) 그 다음 turn에는 사라진다.

- 빨강이면: test를 고치지 말고 `issue` skill로 올리고(문서와 코드의 어긋남) lead에게 "사람 결정 필요"로 보고한다. 고치기 전 코드에서 실패하는 출력 한 줄을 적는다. 이 시점에서 이 task를 merge하지 않는다.
- planner 추천(사람이 정한다): 문서를 코드에 맞춘다. 지침은 거의 안 바뀌고 한 번 cache miss가 나도 싸다. system은 항상 지금 지침이고, 바뀐 turn에 notice는 "바뀌었다"는 알림으로만 둔다. 이 경우 단정 1은 "둘째 요청의 system에 새 글이 있고 첫 요청의 옛 글은 없다"로 바뀌고 `architecture/agent-definition.md`의 해당 두 문장을 같은 변경에서 고친다. 대안(prefix 고정)은 notice를 session 기록에 저장해야 해서 크다.
- 사람이 정하기 전에는 위 "문서가 말하는 쪽"으로 단정을 쓴다.

## 할 일

1. 새 file이다. `Deno.test` 하나. 준비: `bootCore` → `connectFakeProvider` → project 폴더 `proj`를 만들고 `proj/LOPHN.md`(마커 `RULE-ONE-<id>`)와 `proj/AGENTS.md`(마커 `DECOY-<id>`)를 둔 뒤 `openProject` → `openSession(PM)`. 마커는 `core.ids`로 만든 고유 글이다. 지침은 `proj` 바로 아래의 `LOPHN.md`만 읽는다(첫 등록 폴더).
2. 행 하나(표). 사람이 file을 고치는 것은 disk 쓰기이고 route 단계가 아니다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `instructions-change-next-turn` | `say`("one") → `waitTurnEnd`(0) → disk: `proj/LOPHN.md`를 `RULE-TWO-<id>`로 덮어씀 → `say`("two") → `waitTurnEnd`(1) | ① text ② text | fake(1): 둘째 요청의 `systemText`가 첫 요청의 `systemText`와 같다(prefix 그대로) / fake(2): 둘째 요청의 `lastUserText`에 `lophn-notice`와 `instructions_changed`와 `RULE-TWO-<id>`가 있고, 두 요청 어디에도 `DECOY-<id>`가 없고 첫 요청의 system에는 `RULE-ONE-<id>`가 있다 / ledger: `turnsOf`의 두 turn이 모두 `completed`다 | `agent-definition.md` "도는 turn은 시작 때 읽은 판을 끝까지 쓴다"·"`AGENTS.md`는 읽지 않는다". 두 후보(`instructions-change-next-turn`, `agents-md-ignored`)를 한 행에 접었다: `AGENTS.md`는 같은 폴더에 둔 미끼다 |

3. 둘째 `say` 전에 첫 turn이 끝났는지 `waitTurnEnd`로 확인한다(`seen`은 turn이 끝날 때 쌓인다). 중간에 provider나 project 폴더를 바꾸지 않는다: 그러면 runtime child가 다시 떠 `seen`(child 메모리)이 사라지고 notice가 안 붙는 것이 정상이다.
4. notice 문구는 단정하지 않는다. tag 이름과 kind(`lophn-notice`, `instructions_changed`)와 새 글의 마커만 본다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `run-loop`(prompt 조립: 지침 층은 `LOPHN.md`뿐이고, 바뀐 판은 다음 turn 시작에 notice로 알린다), `agent-roles`(project 층 지침의 자리).
- 현실적 회귀: 지침을 고칠 때마다 prefix가 달라져 이력 전체가 cache miss가 나는 것, 바뀐 지침이 도는 session에 영영 안 닿는 것, `AGENTS.md`를 fallback으로 읽는 수정이 들어가 사람이 모르는 글이 prompt에 섞이는 것.
- 왜 지금 test로 못 잡나: `assembleTurnPrompt`에 unit이 없고, harness loop의 `context` port는 notice를 비워 둔다. file 읽기(core)와 판 기억(runtime child 메모리)과 model 요청이 이어지는 길은 process를 건너야 보인다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/prompt-notice_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/prompt-notice_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "사람이 고친 지침이 도는 session의 다음 turn에 닿되 prefix(cache)를 깨지 않고, `AGENTS.md`는 prompt에 섞이지 않는다"(사람 결정에 따라 단정 1이 바뀐다)

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
