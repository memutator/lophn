# S2. approval과 grant

상태: **확인됨** (2026-10-15). 설계는 `../architecture/approval.md`(사람 확인)에서 왔다. "(제안)"이 붙은 것과 11장은 이 spec을 쓰며 새로 채우거나 다시 따진 것이라 확인을 받는다.

## 1. 범위

lophn에서 "이 동작을 해도 되나"를 정하는 길이다. grant의 모양, Gate의 판정, 사람에게 묻는 request를 정한다. 화면이 request를 받는 길은 S1(8장), 앱 호출 경로와 rewind는 S5, activation의 순서는 S7, agent 정의 안의 grant 칸은 S4가 맡고, 여기는 접점만 적는다.

## 2. 철학

결정은 grant 때 몰아서 하고, 실행 때는 grant를 믿는다. 실수는 묻는 것으로 막지 않고 rewind로 복구한다.

- 선언(blueprint의 효과와 권한, MCP annotation)은 믿는다.
- 이미 grant한 것을 다시 묻지 않는다.
- 실행 전에 "이 일을 해도 되나"를 의미로 판단하지 않는다. program은 grant에 비춰 결정적으로 판정하고, 사람만 결정한다.

## 3. 효과와 대상

모든 동작은 **대상**과 **효과**의 짝이다.

| 효과 | 뜻 | 되돌림 |
|---|---|---|
| read | 바꾸지 않는다 | 필요 없음 |
| write | 앱 자기 DB만 바꾼다 | core가 보장(S5) |
| external | 앱 DB 밖을 바꾼다(바깥 API, 메일, 결제, 앱 밖 파일) | 보장 없음 |

| 대상 | 효과를 어디서 읽나 |
|---|---|
| 앱의 app-api | 활성 release의 blueprint 선언(req-0878) |
| 앱이 쓰는 바깥 자원(network host, secret, 파일) | blueprint의 permission 선언 |
| 다른 앱의 app-api | blueprint의 다른 앱 쓰기 선언(req-0802) |
| 외부 MCP tool | `readOnlyHint`가 참이면 read, 아니면 external |
| 다른 agent(call) | read |
| lophn 쪽 설정(agent 정의, 지침, skill, Settings) | 고치기는 따로 다룬다(4장 기본값) |

## 4. grant

사람이 대상마다 **허락하는지**와 **실행 때 묻는지**를 정해 둔 것이다. 거둘 때까지 유효하다.

| grant | 누가 받나 | 대상 | 생기는 때 | 실행 때 묻나 |
|---|---|---|---|---|
| 앱 grant | 앱 | 바깥 자원, 다른 앱의 app-api | activation. release 선언을 보고 한 번 | 묻지 않음. 앱이 실제로 쓸 수 있는 것은 선언과 앱 grant의 교집합이다(req-0860) |
| agent grant | agent | 앱 app-api, 외부 MCP tool, 다른 agent, lophn 쪽 설정 | 할당. 사람이 agent에게 앱이나 tool을 맡길 때 | 대상마다 정한다(req-1493) |
| reaction grant | program | 새 일을 여는 domain event마다 agent session 열기 | Settings | 끔, 묻지 않음, 물음(req-1494) |

**기본값**

| 대상 | 기본 |
|---|---|
| agent grant: read, write | 묻지 않음 |
| agent grant: external | 물음 |
| agent grant: lophn 쪽 설정 고치기 | 물음. agent가 자기 grant를 넓히지 못하게 한다 |
| reaction grant | 열고 묻지 않음 |

- 새 release가 선언을 넓히면 늘어난 부분만 다시 정한다. 선언이 그대로면 activation에 묻지 않는다. migration이 있는 release에서 data를 잃을 수 있을 때의 처리는 S7.
- 사람이 grant를 거두면 새 호출부터 막힌다. 앱 grant를 거두면 이전 process 종료를 확인한 뒤 새 범위로 다시 시작한다(req-0873).
- **agent grant의 key:** agent ID다. 고정 role agent(lophn, Project Manager, App Engineer)도 ID가 있다. 저장 위치는 refactor session이 정한다.
- **app-api별 override:** release에서 빠진 app-api의 override는 지운다. 같은 이름이 다시 생기면 효과별 기본값으로 들어온다.
- **앱 grant를 보고 거두는 화면:** 앱 상세에 둔다(req-0873).
- **agent grant의 단위:** 앱 하나를 할당하면 그 앱의 app-api 전부가 대상이 된다. 실행 때 묻는지는 효과별 기본값을 따른다. 사람은 app-api마다 자세히 바꿀 수 있다: 빼서 그 agent가 부르지 못하게 하거나, 묻는지를 바꾼다. 새 release가 app-api를 더하면 더한 것은 효과별 기본값으로 들어오고, 사람이 바꿔 둔 것은 그대로다.

## 5. Gate

Gate는 **함수 하나**다. intent와 그때의 grant를 받아 셋 가운데 하나를 돌려준다. IO가 없어 fixture로 시험한다.

```
Gate(intent, grants) → 막음(이유) | 실행 | 물음
```

| 판정 | 언제 | 그다음 |
|---|---|---|
| 막음 | grant 밖 | 이유를 부른 쪽에 돌려준다 |
| 실행 | grant 안, 묻지 않음 | 실행한다. 앱 호출이면 invocation이 남는다(S5) |
| 물음 | grant 안, 물음 | request를 만든다(6장) |

**Gate를 부르는 곳**

| 동작 | 부르는 곳 | 보는 grant |
|---|---|---|
| agent의 app-api 호출 | core의 앱 호출 경로(S5) | agent grant |
| 앱의 바깥 자원 사용, 다른 앱 호출 | core의 앱 호출 경로(S5) | 앱 grant |
| lophn agent의 외부 MCP tool 호출 | run-loop의 tool 실행 | agent grant |
| agent call | Router(S3) | 보낸 agent의 agent grant. 열린 session으로 보내도 그 session의 agent로 판정한다 |
| agent의 lophn 쪽 설정 고치기 | 그 tool 실행 | agent grant |
| domain event로 session 열기 | Reactor handler(S1) | reaction grant |
| activation | activation 처리(S7) | 앱 grant와 새 선언의 비교 |

사람이 앱 화면에서 누르거나 직접 메시지를 보내는 것은 Gate를 거치지 않는다. 사람 자신의 동작이다. coding agent의 tool call은 harness의 일이고 Gate를 거치지 않는다(S6).

lophn agent의 file·shell·web tool은 Gate를 거치지 않는다. 다만 file tool로 `LOPHN.md`를 쓰는 것은 설정 고치기로 본다. 설정 고치기로 보는 지침 파일은 `LOPHN.md`뿐이다. agent 정의와 skill은 lophn data에 있어 file tool이 닿지 않는다. place 범위와 그 밖의 규칙은 S4가 정한다.

**intent**

| 칸 | 뜻 |
|---|---|
| `kind` | app-api 호출, MCP tool, agent call, 설정 고치기, reaction, activation |
| `actor` | agent session, 앱, 또는 program과 근거 domain event seq |
| `target` | 대상 |
| `input` | 정규화한 입력(req-0310의 비교 기준) |
| `origin` | turn이면 session, turn, tool call ID. 보류면 domain event seq나 activation |

## 6. request

물음으로 생긴 것이다. **request = intent + 선택지 + 상태**(pending, granted, rejected, cancelled).

**두 길** (기다리는 쪽에 따라)

| | turn 안 request | 보류 request |
|---|---|---|
| 무엇 | agent의 tool call(external app-api, 설정 고치기 등) | activation, 물음인 reaction |
| 기다리는 쪽 | 그 turn이 멈춰 기다린다 | 아무도 멈추지 않는다 |
| 남는 곳 | session snapshot의 대기 권한 요청(메모리) | `approval_requests` 표 |
| 화면이 아는 길 | agent event `PermissionRequested`(S1) | 남지 않는 event `ApprovalRequested`(S1) |
| 결정 뒤 | turn이 이어 간다 | 결정과 domain event `ApprovalDecided`를 한 tx로 쓴다 → Reactor → 그 종류의 handler가 다시 검사하고 실행 |
| 꺼졌다 켜지면 | turn이 interrupted, request는 cancelled | 표에 남는다 |

renderer는 두 길을 한 대기 목록에 둔다(req-1498).

**선택지** (req-0317)

| 대상 | 선택지 |
|---|---|
| app-api, MCP tool | 한 번, 이 session 동안, 항상, 거절(+이유) |
| activation, lophn 쪽 설정 고치기, reaction | 허락, 거절 |

- "항상"은 그 대상의 agent grant를 묻지 않음으로 바꾼다.
- "이 session 동안"은 같은 session에서 같은 대상을 다시 묻지 않는다. session이 닫히거나 archive되거나 지워지면 사라지고, 다시 열어도 되살아나지 않는다(req-0318, 0319).

**결정 규칙**
- 사람 자격의 결정 command로만 결정한다. agent, coding agent, 앱, MCP server는 결정하지 못한다(req-0303).
- 기본 선택이 없다. 침묵이나 카드 닫기는 결정이 아니다. 기한이 없다(req-0305).
- 허락은 그 intent에 한 번만 쓰이고, 실행 직전에 intent(대상, 입력, 활성 release)가 같은지 다시 본다(req-0310).
- 거절 이유는 요청한 agent에게 그대로 간다(req-0307).
- 카드 내용은 program이 intent에서 만든다. agent가 쓴 설명에 기대지 않는다. activation이면 이전 release와의 비교를 보인다(req-0300).
- 원래 일이 끝나면 cancelled로 끝나고, 요청자는 거절과 구별해 받는다(req-0315).
- 허락의 접수와 실제 적용의 성공을 구별해 알린다(req-0312).

## 7. 부품과 소유

| 부품 | 맡는 일 | 지금 코드 |
|---|---|---|
| Grants | grant의 주인. 만들고 거둔다. 앱 grant는 activation에서, agent grant는 할당에서, reaction grant는 Settings에서 온다 | `packages/core/apps/permissions`의 `grants`(범위마다 따로 승인) |
| Gate | 5장의 함수 | `packages/core/approvals`의 범용 적용 엔진 안에 섞여 있다 |
| Approvals | request의 주인. 보류 request 표와 사람의 결정 command | `packages/core/approvals` |

## 8. 경우별 길

| 경우 | 길 |
|---|---|
| agent가 read, write app-api를 부름 | Gate: agent grant 안, 묻지 않음 → 실행 |
| agent가 external app-api를 부름 | Gate: 물음(기본) → turn 안 request. grant가 묻지 않음이면 실행 |
| 앱이 바깥 자원을 씀, 다른 앱을 부름 | 앱 grant 안이면 실행, 밖이면 막음 |
| 사람이 앱 화면에서 누름 | Gate 없음 |
| activation | ticket 확인됨으로 시작(req-1507). 선언이 넓어졌으면 보류 request. 아니면 바로(S7) |
| domain event로 session 열기 | reaction grant: 끔이면 안 열고, 묻지 않음이면 Router, 물음이면 보류 request |
| agent call | agent grant(기본 묻지 않음) → Router. 받은 agent는 자기 grant로만 일한다. 받은 메시지는 허락이 아니다(S3) |
| 사람이 문제를 해결됨·무시로 둠 | Gate 없음. 사람 자신의 동작이고 다시 열 수 있다 |
| approval 밖의 사람 결정(문제 결정, 앱 rewind, 파일 지움, provider 연결, 질문 선택지 action) | 각 기능의 화면 안에서 받는다. 사람 자격 확인 handle은 화면을 누를 때 shell main이 발급한다. 따로 확인 창을 두지 않는다 |
| secret 값 입력 | renderer 밖(shell main)이 띄우는 보호 입력에서만 받는다. 원문은 renderer와 대화에 보이지 않는다 |
| agent가 agent 정의, 지침, skill, Settings를 고침 | agent grant 물음(기본) → turn 안 request |
| coding agent의 tool call | harness의 일. lophn은 harness가 알려 주는 물음을 agent event로 보일 뿐이다(S6) |
| 사람에게 올림(escalate) | approval이 아니다. session 안에서 묻는다 |

## 9. 지울 옛 것

- `packages/core/approvals`(약 7.7k줄)의 범용 "concern + command + 대상 + 입력" 적용 엔진 → 5장의 Gate 함수, 6장의 request 두 길, 결정 command. blobs, lineage, erase, expiry는 대부분 빠진다.
- `packages/core/apps/permissions`의 `grants`: 범위마다 따로 승인 → activation 한 번(앱 grant). 옛 kind(`document.save`, `agent.commands`, `automation.run`)를 지운다. agent grant와 reaction grant를 새로 둔다.
- blueprint의 `confirm` 칸과 app-api의 confirm marker. 확인은 effect와 grant로만 한다.
- 종류마다 따로 있던 approval 모델(tool call 확인, 외부 접근 따로 승인, 앱 쌍 허락, 앱별 agent 승인).

## 10. 하지 않는 것

- 종류마다 다른 approval 모델. Gate 하나로 합친다.
- 앱 선언을 믿지 못해 invocation마다 강제하는 장치.
- 바깥을 되돌리는 handler 강제. 바깥은 external이다.
- 기한, approval 이력과 감사.
- agent끼리 계속 넘기는 것을 막는 장치. 사람이 화면에서 본다.
- LLM judge(지금은). 나중에 auto mode가 필요해지면 "물음"에서 갈라진다. Gate 안에 넣지 않고 grant 자체를 정하지 않는다.

## 11. 다시 따진 것

1. 정함: request에 `decided_by` 칸을 두지 않는다. request는 물음일 때만 생기고 결정은 늘 사람이 한다. LLM judge를 넣을 때 더한다.
2. 정함: rewind(invocation, changeset, 시점 단위)는 S5로 옮긴다. S2는 "write는 되돌릴 수 있어서 묻지 않는다"는 근거로만 가리킨다.
3. **정함(2026-10-15, S8 9장 8):** "이 session 동안" 허락은 메모리에 둔다. lophn이 꺼졌다 켜지면 사라지고 다시 묻는다. 조사한 harness(Claude Code, Codex, Gemini CLI, Hermes)가 모두 그렇고, 다시 묻는 것은 안전한 쪽 실패다(`../research/session-grant-lifetime.md`).
4. 정함: req-0315를 "더 새 release의 activation 시작"으로 고쳤다(release 준비만으로는 이전 activation request를 취소하지 않는다).
5. 정함: agent grant는 앱 단위로 할당하고 app-api마다 자세히 바꿀 수 있다(4장).
6. 정함(2026-10-15): lophn agent의 file·shell·web tool은 Gate를 거치지 않고 sandbox도 따로 두지 않는다(5장). 효과를 "lophn이 되돌릴 수 있나"로 다시 정의하고 shell을 범위로 판정하는 안을 따졌으나 거뒀다. lophn agent는 coding agent보다 직접 하는 일이 적고 place가 범위를 정한다. 조사한 harness 여덟 가운데 경계를 기본으로 켜는 것은 Codex 하나다(`../research/sandbox-harnesses.md`).
