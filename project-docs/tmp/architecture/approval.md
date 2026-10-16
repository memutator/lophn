# approval 아키텍처 (2026-10-14)

> **옮겨 감 (2026-10-15):** 이 문서는 `../specs/approval.md`(S2)로 옮겨 갔다. 그 뒤 바뀐 것: fact를 domain event로 부른다. 화면은 renderer가 `PermissionRequested`와 `ApprovalRequested`를 받아 한 대기 목록에 둔다. activation은 ticket 확인됨으로 시작한다. request에 `decided_by`를 두지 않는다. rewind(5장)는 S5로 옮긴다. agent grant는 앱 단위로 할당하고 app-api마다 바꾼다. 이 문서와 S2가 다르면 S2를 따른다.

사람(원문 그대로): "너가 approval architecture 초안을 제시해줘" → "그리고 hermes에서도 approval, permissions 관련해서 직접 조사하고 와봐" → "일단 사실 바이브코딩에엇는 사람들은 결정 피로 때문에 dangerosly-skip-permissions, full-access 를 그냥 쓰는 추세야 그래서 대형 하네스들은 대부분은 LLM judge하는 approve 모드를 도입하는거고 (claude code, codex 등등) 우리는 근데 또 따로 생각해야하는 게 일반적인 coding agnet와는 또 달라 app을 다루는 부분도 있고 그래서 우리는 우리 approval 추상화 계층을 따로 구축하는 게 맞다고 보는데 우리도 역시나 쓸데 없는 결정 피로는 최소화하는 방향으로 가야하는데 너가 한 번 다시 아키텍쳐 초안 짜봐" → "아니 아까 event처럼 추상화가 중요하다니까 여러 종류의 approval들이 있는데 그 event 추상화와 연결해가지고" → "믿고 쓰는 것 자체는 문제가 없지 오히려 믿지 못할거라면 추상화하고 책임 분배 할 이유가 없는거고 마찬가지의 맥락으로 앱 자체에서 api 를 등록할 때 권한을 주고 operator한테 할당을 할 때 이미 approval인데 그걸 이후에 또 해야한다거나 그런 것들은 최소화해야해 왜냐면 그 때 허락한 권한이잖아 … external은 허락은 맡아야겠지만 일반적으로는 rewind를 보장해서 semantic 한 부분을 요구하지 않고 에러를 복구할 수 있도록 그러한 방향으로 가고 싶어" → "근데 external은 rewind가 할 수 없으니까 external 아니야?" → "agent grant에서 묻지 않음을 설정할 수 있어야지 external이거나 agent grant여도 그걸 구분해서 설정하고 이후에 그걸 그냥 믿고 쓰는거지 그니까 결정 피로는 대부분 초기에 몰아두고 그걸 믿고 쓰자는거야 이게 철학이야" → "근데 앱 data 밖을 바꾸는 write 에 rewind handler를 반드시 둔다는 게 가능하긴해? … 그걸 못 하니까 외부 효과라고 하는 거 아니야?" → "근데 데이터는 독립적이지 않고 의존적일건데 분리해서 적용하는 것도 가능해? 가장 최신의 invocation만 바꿀 수 있는 거야?" → "오케이 approval 닫으면 되겠다"

재료: 앞선 초안(지움. docs-review에 있다), `../research/approval-hermes.md`, `event.md`, 지금 코드(`packages/core/approvals`, `packages/core/apps/permissions`, `packages/core/apps/revert`, `packages/sdk/cap-schedule/revert.ts`).

## 1. 철학

**결정은 grant 때 몰아서 하고, 실행 때는 grant를 믿는다. 실수는 묻는 것으로 막지 않고 rewind로 복구한다.**

- 선언(blueprint의 효과와 권한, MCP annotation)은 믿는다. 믿지 못하면 선언으로 책임을 나눌 이유가 없다.
- 이미 grant한 것을 다시 묻지 않는다.
- 의미 판단(이 일을 해도 되나)을 실행 전에 하지 않는다.
- program이 하는 판정은 결정적이다. 사람만 결정한다(LLM judge는 나중에 끼울 자리만 둔다, 7장).

## 2. 할 수 있는 일의 말

모든 동작은 **대상**과 **효과**의 짝이다.

| 효과 | 뜻 | rewind |
|---|---|---|
| read | 바꾸지 않음 | 필요 없음 |
| write | 앱 자기 DB만 바꿈 | core가 보장(5장) |
| external | 앱 DB 밖을 바꿈(바깥 API, 메일, 결제, 앱 밖 파일). 되돌림을 보장할 수 없음 | 없음 |

대상: 앱의 app-api, 앱이 쓰는 바깥 자원(OAuth, network host, secret, 파일), 다른 앱의 app-api, 외부 MCP tool(`readOnlyHint`면 read, 아니면 external), 부를 수 있는 agent(read), lophn 쪽 설정(agent 정의, 지침, skill, Settings).

## 3. grant

사람이 대상마다 **허락하는지**와 **실행 때 묻는지**를 정해 둔 것이다. 거둘 때까지 유효하다.

| grant | 누가 무엇을 받나 | 생기는 때 |
|---|---|---|
| 앱 grant | 앱이 바깥 자원과 다른 앱의 app-api를 씀 | release activation. release 선언을 보고 한 번 |
| agent grant | agent가 app-api, 외부 MCP tool, 다른 agent, lophn 쪽 설정을 씀 | 할당. 사람이 agent에게 앱이나 tool을 맡길 때 |
| reaction grant | program이 domain event로 agent session을 엶 | Settings. domain event마다 |

- "실행 때"의 기본은 효과에서 나온다: read와 write는 묻지 않음, external은 물음. lophn 쪽 설정 고치기는 물음(agent가 자기 grant를 넓히지 못하게). reaction은 묻지 않음. 사람은 grant 때 바꾼다.
- 새 release가 선언을 넓히면 늘어난 부분만 다시 정한다. 선언이 그대로면 activation에 묻지 않는다.
- migration이 있는 release(목표 schema 번호가 지금과 다름)에서 data를 잃을 수 있으면 activation에서 묻는다. 그것을 어떻게 알아낼지(DB 사본에서 잴지, 복구본을 남겨 두고 묻지 않을지)는 S7(`../specs/index.md`)에서 정한다. migration이 없는 release는 선언 비교만 한다.
- activation은 그 release를 이은 ticket이 확인됨이 되면 시작한다(req-1507). release 준비만으로는 시작하지 않는다.
- 사람은 grant를 거둘 수 있다. 새 호출부터 막힌다(req-0873).

## 4. Gate와 request

```
 intent ──▶ Gate(결정적) ──┬─ 막음: grant 밖. 이유를 돌려줌
                          ├─ 실행: grant 안, 묻지 않음. invocation 영수증을 남김
                          └─ 물음: grant 안, 물음 ──▶ request ──▶ 사람 ──▶ 다시 검사 ──▶ 실행
```

**intent 봉투**: `kind`, `actor`(agent session이나 program과 근거 domain event seq), `target`, `input`(정규화), `origin`(turn이면 session·turn·tool call ID, 보류면 domain event seq).

**request** = intent + `options` + `status`(pending, granted, rejected, cancelled) + `decided_by`(grant, human).

- 선택지(app-api, MCP tool): 한 번, 이 session 동안, 항상, 거절(+이유). "항상"은 그 grant를 묻지 않음으로 바꾼다. 같은 동작인지는 대상이 같은지로 본다.
- 선택지(activation, lophn 쪽 설정): 허락, 거절.
- 침묵은 결정이 아니다. 기한은 없다. 원래 일이 끝나면 cancelled다.
- 허락은 한 번만 쓰고, 실행 직전에 intent가 같은지 다시 본다.
- 거절 이유는 agent에게 그대로 간다.
- 카드 내용은 program이 intent에서 만든다. agent가 쓴 설명에 기대지 않는다.

**기다리는 쪽에 따라 두 길** (event 구조의 두 길과 같다)

| | turn gate | 보류 gate |
|---|---|---|
| 무엇 | agent의 tool call(external app-api, lophn 쪽 설정 고치기 등) | release activation, reaction(물음일 때) |
| request 위치 | session snapshot의 대기 권한 요청(메모리) | `approval_requests` 표 |
| 화면 | agent event `PermissionRequested`, `PermissionResolved`. renderer는 모든 session의 물음을 구독해 대기 목록에 넣고 toast를 띄운다(`../specs/event.md` 8장). 사람이 보고 있지 않은 session(program이 연 session, headless)의 물음도 놓치지 않게 하려는 것이다 | 남지 않는 event `ApprovalRequested`. renderer가 같은 대기 목록에 넣고 toast를 띄운다(req-1498) |
| 결정 뒤 | turn이 이어 감 | 결정과 domain event `ApprovalDecided`를 같은 tx에 씀 → Reactor → 그 종류의 handler가 다시 검사하고 실행 |
| 꺼졌다 켜지면 | turn이 interrupted → cancelled | 표에 남음. Reactor가 cursor 뒤부터 이어 감 |

**부품**

| 부품 | 맡는 일 |
|---|---|
| Grants | grant의 주인. 만들고 거둠 |
| Gate | grant를 보고 막음, 실행, 물음을 냄. program이 하는 판정은 여기 하나 |
| Approvals | 물음으로 생긴 request의 주인. 사람의 결정 command(사람 자격으로만 부름) |

## 5. rewind

> S5(`../specs/app-call.md`)로 옮겨 감. 앱 DB는 그 앱의 process만 열어서(req-0950) SQLite session은 core가 아니라 앱 process의 SDK가 건다.

- **invocation**: 앱 app-api 호출 하나의 기록(apps가 주인, req-0893). 쓰는 단위이자 되돌리는 단위다.
- **write의 되돌림**: core가 write invocation이 도는 동안 앱 DB에 SQLite session을 걸어 changeset을 남기고, rewind 때 반대로 적용한다. 앱은 revert API를 두지 않는다.
- **앱 data는 앱 DB 하나다.** 파일로 쓴 data는 되돌리지 못하므로 DB(필요하면 blob 표)에 둔다.
- **rewind는 시점 단위다.** invocation k를 되돌리면 그 앱에서 k 뒤의 invocation을 최신부터 모두 되돌린다. 결과는 언제나 k 직전의 앱 data와 같다. 하나만 빼내는 되돌림은 읽기 의존을 알 수 없어서 하지 않는다.
  - 되돌리기 전에 함께 되돌아갈 목록(사람이 앱 화면에서 한 변경 포함)을 보인다.
  - 그 사이의 external 호출은 되돌아가지 않는다고 표시한다.
- release를 넘어서는 rewind는 하지 않는다(표 모양이 바뀜). release 되돌림(req-0821)이 맡는다.
- changeset은 rewind할 수 있는 범위만큼 둔다.
- lophn 쪽(context 문서, ticket, 설정)은 각자의 판으로 되돌린다.

## 6. 종류별로 보면

| 경우 | 길 |
|---|---|
| agent가 read, write app-api를 부름 | Gate: agent grant 안, 묻지 않음 → 실행 |
| agent가 external app-api를 부름 | Gate: 물음(기본) → turn gate. grant가 묻지 않음이면 실행 |
| 앱이 바깥 자원(OAuth 등)을 씀 | 앱 grant 안이면 묻지 않음 |
| 앱이 다른 앱 app-api를 부름 | 앱 grant 안이면 묻지 않음 |
| 사람이 앱 화면에서 누름 | 사람 자신의 동작. 묻지 않음 |
| release activation | 그 release를 이은 ticket이 확인됨이 되면 시작. 선언이 넓어졌거나 data 손실 가능 → 보류 gate. 아니면 바로 activate |
| domain event로 agent session을 엶 | reaction grant(기본 묻지 않음) → Router |
| agent가 agent를 부름(agent call) | agent grant의 대상. 열린 session으로 보내도 그 session의 agent로 판정한다. 기본 묻지 않음 → Router. 받은 agent는 자기 grant로만 일한다. 답은 Router로 돌아온다(`agent-call.md`) |
| agent가 agent 정의, 지침, skill, Settings를 고침 | agent grant 기본 물음 → turn gate |
| coding agent의 tool call | harness의 일. lophn은 hook의 `PermissionRequested`로 대기만 보인다. permission mode는 Settings 기본 실행 옵션. headless(나중)로 띄우면 물음에 답할 화면이 없으니 미리 허락 모드로 띄운다(`agent-call.md` 정할 것 5) |
| 사람에게 올림(escalate) | approval이 아니다. session 안에서 묻고 toast로 알린다 |

## 7. 나중에 끼울 자리: LLM judge

auto mode가 필요해지면 "물음"에서 갈라진다. grant의 "실행 때"에 judge에게 맡김을 더하거나, Settings 한 칸으로 물음을 judge가 먼저 보게 한다. judge는 허락하거나 사람에게 넘기고, 실패하면 사람에게 넘긴다. Gate 안에 넣지 않고, grant 자체는 정하지 않는다. `decided_by`에 judge가 는다.

## 8. 일부러 하지 않는 것

- 종류마다 다른 approval 모델(tool call 확인, confirm marker, 외부 접근 따로 승인, 앱 쌍 허락, 앱별 agent 승인, session grant). Gate 하나로 합친다.
- 앱 선언을 믿지 못해 invocation마다 강제하는 장치, 직접 통로, 서명 연결권.
- 바깥을 되돌리는 handler 강제. 바깥은 external이다.
- 하나만 빼내는 rewind.
- 기한, approval 이력과 감사, LLM judge(지금은).
- agent끼리 계속 넘기는 것을 막는 장치(사람이 화면에서 본다).

## 9. event 아키텍처에서 바뀌는 곳

- 5장 domain event에 `ApprovalDecided`(보류 gate의 결정만)가 더해진다.
- 10장 "Reactor handler와 approval"이 채워진다. Reactor handler는 intent를 만들어 Gate에 넣는다.
- 8장 invocation에 changeset이 붙고 rewind는 시점 단위다.

## 10. 지금 코드와 달라지는 것 (리팩터링 session 몫)

- `packages/core/approvals`(약 7.7k줄): 범용 "concern + command + 대상 + 입력" 적용 엔진을 Gate, request 두 길, 결정 command로 줄인다. blobs, lineage, erase, expiry는 대부분 빠진다.
- `packages/core/apps/permissions` `grants`: 범위마다 따로 승인 → activation 한 번(앱 grant). 옛 kind(`document.save`, `agent.commands`, `automation.run`)를 지운다. agent grant(할당, 실행 때 묻나)를 새로 둔다.
- blueprint: command의 `revert`와 `confirm` 칸을 지운다. 효과는 read, write, external.
- SDK `withRevert`, `packages/core/apps/revert`(worker, 직접 통로로 revert command 부르기)를 지우고 core의 changeset 저장과 역적용으로 바꾼다. Deno `node:sqlite`에 `createSession`, `changeset`은 있고 invert는 없다(2.9.7에서 확인). 뒤집기는 직접 구현한다.
- app-api의 confirm marker와 직접 통로를 지운다.
- Reactor에 reaction grant 판정을 둔다. activation의 계기(ticket 확인됨)와 순서(선언 비교, migration이 있을 때의 처리, drain)는 S7에서 정한다.
