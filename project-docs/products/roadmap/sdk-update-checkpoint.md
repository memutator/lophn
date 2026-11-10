# SDK 업데이트 checkpoint: 검토와 맡긴 일의 상태를 ledger가 안다

상태: 완료(2026-11-11, branch `feat/sdk-update-checkpoint`, change-log `sdk-update-checkpoint`). "사람이 정할 것" 셋은 사람이 추천안으로 정했다(2026-11-11).
배경 문서: `products/roadmap/inbox-history-sdk-migration.md`(지금 구조를 만든 일), `architecture/ui-kit.md`의 "SDK 상태 read"·"SDK 업데이트 감지와 맡기기", `architecture/agent-call.md`의 private 예외, `architecture/agent-definition.md`의 memory.

## 사람의 말 (원문)

2026-11-10, session `ses_01m6zy6y0qahkzwhqzmcf24qnm`(`/update-apps`)을 보고:

> 얘 이전 변경을 다 읽는 거 같은데 약간 checkpoint를 남기고 그런 게 없이 너무 기억에만 의존하는 거 같아 이건 좀 맘에 안 드는 설계인데

## 문제

`/update-apps`의 진행 상태 셋 가운데 program이 아는 것은 하나뿐이다.

| 상태 | 지금 어디에 있나 |
|---|---|
| 앱이 어느 판까지 옮겼나 | 켜진 release의 pin. `app.sdk_status`가 낸다 |
| home이 어느 판까지 검토했고 무엇을 정했나 | home lophn의 memory(`<data root>/home/memory.md`)의 자유 글 |
| 맡긴 일(판 올리기, 고른 기능)이 끝났나 | 없다. memory의 "Handed to lophn at Masup" 한 줄 |

위 session에서 실제로 생긴 일:

- `app.sdk_status`는 pin 다음부터 지금 판까지의 메모를 매번 전부 낸다. Mahas는 `@lophn/app-ui` 2.5.0에 묶여 메모 12개가 나왔다. home은 memory의 "2.10/4.3 round: Mahas leave as is"를 보고 Mahas 메모를 하나도 읽지 않았다.
- 그 결정은 2.6~2.10을 보고 내린 것인데 2.11~2.13의 새 기능(lucide 아이콘, `useProjects`)까지 덮었다. 아이콘 질문에서 Mahas가 말없이 빠졌다. agent도 "newer versions have come out since, so I'm not sure it still covers them"이라고 쓰고 그냥 따랐다. 결정이 어느 판까지인지가 data가 아니라 글이다.
- handoff는 `reply: none`이고 `agent_calls.state`의 `done`은 0.5초 뒤 찍히는 배달 표시다. home은 "pin이 지난 round와 같으니 처리됐겠지"로 짐작했다. 사람이 고른 기능(tray popup, 단축키, 아이콘, Memo의 project별 나누기)이 끝났는지는 어디에도 없다.
- memory에 `## SDK round …` 절이 round마다 붙는다. 한도는 8 KiB이고 매 session의 system prompt에 실린다.
- handoff 글을 agent가 손으로 쓴다. pin, 목표 판, 메모 file 이름을 옮겨 적고, 묻지 않은 것을 "the person agreed to update"라고 적었다. `lophn call send --help`도 매번 읽는다.

## 원칙

1. **진행 상태는 ledger, 사람의 취향은 memory.** "어디까지 봤나, 무엇을 맡겼나, 끝났나"는 program이 적고 program이 돌려준다. memory에는 계산할 수 없는 것만 남는다(Masup의 "새로고침은 Alt+R", "아이콘은 gauge"). `agent-definition.md`의 memory 규칙("계산할 수 있는 것은 담지 않는다")과 같은 말이다.
2. **checkpoint는 agent가 따로 적는 것이 아니라 해야 하는 동작의 결과로 남는다.** "결정을 적어라"를 skill 문장으로 두면 memory를 표로 바꾼 것일 뿐이다. 결정을 내는 command 하나가 기록과 handoff를 같이 한다.
3. **빠뜨리면 보인다.** 기록이 없는 앱은 "아직 안 봄", 결과가 없는 일은 "아직 안 끝남"으로 다음 round에 다시 나온다. 조용히 끝난 것으로 치는 상태가 없다.
4. **program이 아는 것은 program이 쓴다.** pin, 목표 판, 메모 file 이름은 handoff 글에서 program이 채운다. agent는 판단(무엇을 왜)만 쓴다.

## 모델

**review**: home이 앱 하나를 두고 내린 결정 한 번이다. append-only.

- `app`, 결정한 session, 시각
- `through`: 그때의 지금 판(SDK마다). program이 채운다. 이 앱의 "검토한 마지막 판"이다
- `decision`: `leave`(그대로 둔다) 또는 `update`(판을 올린다. 고른 기능이 있으면 같이)
- `call`: `update`일 때 보낸 handoff의 call ID

**feature**: `update` review에 달린, 사람이 고른 기능 하나다.

- 사람 말로 쓴 제목, 앱 lophn에게 주는 제안 글, 근거 메모 file
- `state`: `open` → `done` | `changed` | `skipped`, 한 줄 사유

판 올리기가 끝났는지는 저장하지 않는다. `through`와 지금 pin을 견주면 나온다.

## 동작

### `app.sdk_status`가 더 내는 것

- SDK마다 `unreviewed`: 마지막 review의 `through` 다음부터 지금 판까지의 메모. review가 없으면 `notes`와 같다. `notes`(pin 다음부터)는 그대로 둔다. 앱 lophn이 판을 올릴 때 읽는 범위다.
- 앱마다 `review`: 마지막 결정(`decision`, 시각, `through`), 판 올리기가 끝났는지(계산), feature 목록과 state.

### 결정 command (home lophn)

`app.sdk_decide {app, decision, features?}` 하나다.

- `leave`: review를 적는다.
- `update`: review와 feature를 적고, 같은 동작에서 그 앱의 lophn에게 handoff를 보낸다. 글은 program이 짠다: pin → 목표 판, 메모 file, "follow the migrate-sdk skill", feature마다 ID와 agent가 쓴 제안 글. 보내는 길은 지금의 call(home session → 앱 lophn, `reply: none`)이라 private 예외와 call 정책이 그대로 걸린다. call이 거절되면 아무것도 적지 않고 거절을 돌려준다.
- `required`인 앱에 `leave`는 `invalid_input`이다.
- 같은 `through`에 `update`를 다시 내면 다시 보낸다(멈춘 handoff 되살리기).

### 결과 command (앱 lophn)

`app.sdk_feature {feature, state, note?}`. 앱 lophn이 migrate-sdk의 report 단계에서 feature마다 낸다. 자기 앱의 feature만 고친다. 판 올리기는 release가 켜지면 pin으로 보이므로 따로 내지 않는다.

### `/update-apps` 한 round

1. `app.sdk_status`를 읽는다.
2. 앱마다 갈린다.
   - `unreviewed`가 없고 `required`도 아니다: 볼 것이 없다. 지난 `update`가 안 끝났으면(pin이 `through`보다 옛것, `open` feature) 그것만 사람에게 말하고 다시 보낼지 정한다.
   - `unreviewed`가 있다: 그 메모만 읽고 판단한다. 지난 결정이 `leave`였어도 새 메모는 새로 본다.
   - `required`: 묻지 않고 `update`.
3. 새 기능 제안만 `ask`로 묻는다.
4. `unreviewed`가 있던 앱마다 `app.sdk_decide`를 낸다. 맞는 것이 없으면 `leave`다.

session이 중간에 끊기면 결정을 낸 앱은 끝났고 안 낸 앱은 `unreviewed`가 그대로다. 다음 `/update-apps`가 남은 앱부터 잇는다.

위 session을 이 모델로 돌리면: Mahas의 `through`는 2.10/4.3이라 `unreviewed`가 2.11~2.13과 4.4로 나온다. home은 Mahas(사용량 dashboard)에 아이콘이 맞는지 판단해 질문에 넣거나 `leave`를 새 `through`로 적는다. Masup의 지난 feature(tray popup, 단축키)는 `done`으로 보이거나 `open`으로 남아 사람에게 보고된다.

### `available`인 앱의 판 올리기

고른 기능이 없고 `required`가 아니면 `leave`다. 판만 올리는 release를 만들지 않는다. 기능을 고르면 `update`이고 판 올리기가 같이 간다. 메모가 "다음 release부터 막힌다"(app-ui 2.12.0의 `title` 검사)고 해도 지금 돌아가는 앱은 두고, 그 앱을 다음에 고칠 때 앱 lophn이 migrate-sdk로 옮긴다.

### Inbox 줄

`sdk_update_needed`의 `available`은 "새 판이 있는 앱"이 아니라 "`unreviewed`가 있는 앱"을 센다. 그대로 두기로 한 앱이 판이 바뀔 때마다 계속 세어지지 않는다.

### skill

- `update-apps`: 위 round로 다시 쓴다. memory를 보는 줄, memory에 적는 줄, `lophn call send`로 글을 짜는 단계를 뺀다.
- `migrate-sdk`: handoff의 feature ID로 결과를 내는 줄을 report 단계에 넣는다. 사람이 그 앱에서 고른 세부(임계값, 단축키)를 memory에 적는 것은 그대로 둔다. 그것은 취향이다.
- 앱 agent가 읽는 지침이 바뀌므로 `sdk-note` skill대로 메모와 Instruction diff를 쓴다.

## 지키는 것

- review는 고치지 않고 덧붙인다. 앱의 checkpoint는 마지막 review다.
- `through`와 handoff의 판·메모 목록은 program이 쓴다. agent 입력으로 받지 않는다.
- review를 적는 것과 handoff를 보내는 것은 한 동작이다. 하나만 남지 않는다.
- feature의 처음 state는 `open`이다. 결과를 안 내면 끝난 것으로 보이지 않는다.
- home이 private 앱에서 받는 것은 feature의 state와 한 줄 사유뿐이다. call의 답·결과는 여전히 나오지 않는다.
- archived 앱은 지금처럼 status에도 결정 대상에도 없다. review 행은 남는다.

## 옮기기

- ledger: 새 schema step으로 표 둘(review, feature)을 더한다. 기존 data는 없다.
- 지난 두 round의 결정은 memory의 자유 글이라 표로 옮기지 않는다. 결과로 첫 round에 모든 앱이 review 없이 시작한다: Mahas는 메모 12개를 한 번 다시 검토받고, 이미 옮긴 네 앱은 `current`라 볼 것이 없다.
- home memory의 `## SDK …` 두 절은 쓸모가 없어진다. data step으로 사람의 memory 글을 자르지 않는다(자유 글을 program이 고치면 틀리게 자를 수 있다). 사람에게 지워도 되는지 한 번 묻고 지운다.

## 범위 밖

- 앱 lophn의 일이 멈췄을 때 program이 스스로 다시 깨우는 것. `event.md`가 program이 agent session을 여는 것을 지웠다. 다음 `/update-apps`가 보고한다.
- 거절한 제안의 기록. `through`가 지나가면 같은 메모에서 다시 제안되지 않는다.
- model이 skill을 실제로 잘 따르는지의 eval.

## 사람이 정할 것

1. **그대로 두기로 한 앱에 새 판이 나오면.** 추천: 새 메모만 다시 보고, 그 앱에 맞는 기능이 있을 때만 묻는다. 얻는 것: 옛 결정이 새 기능을 가리지 않는다. 잃는 것: "이 앱은 건드리지 마"라고 한 앱도 가끔 질문에 오른다. 다른 안: `leave`를 영구로 두고 사람이 풀 때까지 묻지 않는다(조용하지만 위 Mahas 일이 그대로다).
2. **private 앱의 결과가 home에 보이는 것.** 추천: feature의 state와 한 줄 사유는 보인다. home은 이미 그 앱의 status와 log를 읽는다. 잃는 것: private 앱에서 home으로 나가는 글이 한 줄 생긴다. 다른 안: private 앱은 판 올리기(pin)만 보이고 feature는 늘 "알 수 없음"이다.
3. **사람이 보는 곳.** 추천: 이번에는 화면을 만들지 않고 home lophn이 round마다 말한다. 써 보고 필요하면 앱 상세 Version 탭에 "마지막 업데이트 결정과 기능 상태" 줄을 더한다. 다른 안: 지금 Version 탭까지 같이 만든다(화면 일 하나가 더 든다).

## 일의 모양

"한 줄"이다. 표 → read·command → skill → 문서 순으로 앞의 결과 위에 서고 같은 file(`packages/core/apps/sdk-status/`, `packages/protocol/apps/sdk-status.ts`, skill 둘)을 고친다. 계획 폴더를 열지 않고 branch 하나에서 worker 하나가 잇는다.

| 순서 | 할 일 |
|---|---|
| 1 | ledger 표 둘과 store, `app.sdk_status`의 `unreviewed`·`review` |
| 2 | `app.sdk_decide`(기록 + handoff 한 동작), `app.sdk_feature`, CLI |
| 3 | `sdk_update_needed`가 `unreviewed`로 세기 |
| 4 | skill 둘 다시 쓰기, `sdk-note` 메모 |
| 5 | `architecture/ui-kit.md`·`app-notice.md`·`agent-call.md`·`agent-definition.md`, flows, change-log |

위험 test는 둘이면 된다: `update`가 call 거절 때 review를 남기지 않는 것, 앱 lophn이 남의 앱 feature를 못 고치는 것.
