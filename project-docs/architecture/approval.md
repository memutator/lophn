# approval

agent, 앱, program이 하는 동작마다 "해도 되나"를 정하는 장치다. 매번 사람에게 물으면 결정 피로로 사람들이 모든 확인을 끄게 되고(skip-permissions), 묻지 않으면 되돌릴 수 없는 일이 새 나간다. 그래서 결정은 grant를 줄 때 몰아서 하고, 실행 때는 grant를 믿고, 실수는 묻는 것이 아니라 rewind로 복구한다. 이 문서는 판정(Gate), 사람에게 묻는 request의 두 길, 결정이 실행으로 이어지는 약속을 다룬다.

## 흐름

```
 intent를 만드는 곳                                       approvals (core)
 run-loop ─ tool-gate ───────────────┐
 앱 호출 경로 (agent, 앱이 부름) ─────┤
 Reactor 새 일 handler ──────────────┼─▶ judge ─▶ Gate(intent, grants) ─┬ 막음 ─▶ 이유를 부른 쪽에
 app-releases activation handler ────┘           ▲ 순수 함수           ├ 실행
                                       grants: 앱 grant, agent grant,   └ 물음 ─┬─ turn 안 request
                                               reaction grant                  │   메모리. turn이 멈춰 기다린다
                                                                               │   PermissionRequested ─▶ 사람 ─▶ turn 이어 감
                                                                               └─ 보류 request
                                                                                   approval_requests 표. 아무도 안 기다린다
                                                                                   ApprovalRequested ─▶ 사람이 결정 command
                                                                                   ─▶ applier(소유 module이 등록)가 다시 검사하고 실행
                                                                                   ─▶ 결과 기록과 ApprovalDecided(domain event)
 shell: 두 길을 한 대기 목록에 둔다
```

- grant는 사람이 정한다. 앱 grant는 activation 때, agent grant는 agent에게 앱이나 tool을 맡길 때, reaction grant는 Settings에서 온다.
- 효과는 read, write, external이다. 기본 묻기는 효과에서 나온다(read, write는 묻지 않음, external은 물음). 사람이 grant 때 바꾼다.
- 사람이 앱 화면에서 누르거나 직접 메시지를 보내는 것은 Gate를 거치지 않는다. coding agent의 tool call은 harness의 일이다.
- lophn agent의 file, shell, web tool도 Gate가 없다. place가 범위다. 지침 파일(`LOPHN.md`) 쓰기만 "설정 고치기"로 본다.

## 지키는 것

판정
- Gate는 IO 없는 함수다. 시각, 상태, 전역을 읽지 않고 intent와 grant만 본다. 판정이 결정적이어야 fixture로 시험할 수 있다.
- program은 판정만 하고 결정은 사람만 한다. 결정 command는 사람 자격만 받는다. agent, coding agent, 앱, MCP server가 스스로 허락하면 grant가 의미 없다.
- 선언(blueprint의 효과, MCP annotation)은 믿는다. 믿지 못하면 선언으로 책임을 나눈 이유가 없고 invocation마다 강제할 장치가 든다.
- 이미 grant한 것은 다시 묻지 않는다. 새 release가 선언을 넓힐 때 늘어난 부분만 다시 정한다.
- agent는 자기 grant를 넓히지 못한다. grant 고치기는 사람만, agent의 설정 고치기는 기본 물음이다. "항상"을 골라도 이미 목록에 있는 대상을 묻지 않음으로 바꿀 뿐 새 대상을 열지 못한다.
- agent call은 call tool이 turn 안에서 먼저 묻고, Router는 tx 안에서 한 번 더 판정만 한다. deny는 늘 거절하고, 물음은 turn에서 허락받았다는 표시가 있을 때만 통과한다. tx 안에서는 사람에게 물을 수 없고, Gate가 순수 함수라 tx 안에서 부를 수 있다.

request
- 침묵이나 카드 닫기는 결정이 아니고 기한도 없다. 원래 일이 끝나면 cancelled로 닫고 요청자는 이를 거절과 구별해 받는다. 거절 이유는 agent에게 그대로 간다.
- 허락은 그 intent에 한 번만 쓰고, 실행 직전에 intent의 지문을 다시 비교한다. 다른 intent로 부른 시도도 허락을 쓴 것으로 친다. 허락 뒤 입력을 바꿔치기하지 못하게 한다.
- 카드 내용은 program이 intent에서 만든다. agent가 쓴 설명은 믿지 않는다.
- "이 session 동안" 허락은 메모리에만 두고 session이 닫히거나 lophn이 꺼지면 사라진다. 되살림이나 fork가 가져가지 않는다. 다시 묻는 쪽이 안전한 실패다.
- turn 안 request는 재시작 때 cancelled가 된다. turn은 process 메모리에서 기다리던 것이라 이어 갈 수 없다. 보류 request는 표에 남는다.
- 같은 intent가 이미 pending이면 새 request도 ApprovalRequested도 만들지 않는다. Reactor가 같은 event를 다시 처리해도 카드가 불어나지 않는다.
- 더 새 release의 activation이 시작되면 이전 release의 보류 request는 cancelled다. 낡은 허락이 새 release에 쓰이면 안 된다.

보류 request의 적용
- 허락의 접수(allow)와 적용 성공(applied)은 따로 기록한다. 사람에게 "허락했는데 실패했다"를 구별해 알리려는 것이다.
- 적용은 결정 command가 commit된 뒤에 하고, 결과가 기록되지 않은 허락은 시작할 때 다시 적용한다. 그래서 applier는 두 번 불려도 효과가 한 번이어야 한다. 꺼진 사이 낀 허락을 잃지 않는다.
- ApprovalDecided는 허락이면 적용 결과를 싣고 난 뒤에, 거절이면 결정과 같은 tx에서 난다. 이 event를 받는 handler는 적용이 끝난 사실만 본다.
- applier는 실행 전에 소유 module이 상태를 다시 본다. activation은 release가 아직 prepared인지, reaction은 근거 event가 있고 아직 꺼지지 않았는지다. 묻는 사이 세상이 바뀐다.

## 왜 이 모양인가

- 옛 approval은 종류마다 모델이 따로였고(tool call 확인, 외부 접근 승인, 앱 쌍 허락, 앱별 agent 승인, confirm marker) 범용 적용 엔진이 7천 줄을 넘었다. Gate 하나, request 두 길, 결정 command로 합쳤다.
- write를 묻지 않는 근거는 앱 호출 경로의 rewind다. write는 core가 되돌릴 수 있고 external만 되돌릴 수 없다. 바깥을 되돌리는 handler를 앱에 강제하는 안은 못 지킬 약속이라 버렸다.
- LLM judge는 넣지 않았다. Claude Code와 Codex가 auto mode를 두지만, 결정적 판정은 program이 하고 결정은 사람이 한다는 쪽을 골랐다. Hermes 문서도 LLM 분류는 사람 결정을 대신하지 못한다고 적는다. 필요해지면 "물음"에서 갈라지고 Gate 안에는 넣지 않는다.
- Hermes는 묻는 범위가 좁고(위험 shell, 지침 파일 쓰기 등) 기한 300초를 둔다. 기한은 막힌 thread 때문이다. lophn은 대기가 목록에 남으니 기한이 없고, cancelled와 거절을 구별하는 것만 가져왔다.
- 두 길로 나눈 기준은 기다리는 쪽이 있는가다. turn은 메모리에서 멈춰 있으니 재시작이 끊고, 보류는 아무도 안 기다리니 표에 남아 Reactor가 이어 간다.
- request에 `decided_by` 칸을 두지 않았다. 물음일 때만 request가 생기고 결정은 늘 사람이다. LLM judge가 들어오면 더한다.
- "이 session 동안"의 수명은 Claude Code, Codex, Gemini CLI, Hermes를 보고 정했다. 모두 메모리이고 resume이나 재시작에서 되살리지 않는다.
- 경계(sandbox)는 따로 두지 않는다. 조사한 harness 여덟 가운데 기본으로 켜는 것은 Codex 하나다. lophn agent는 coding agent보다 직접 하는 일이 적고 place가 범위다. 효과를 "되돌릴 수 있나"로 다시 정의하고 shell을 범위로 판정하는 안은 검토 뒤 거뒀다.
- 결과 본문을 믿는 문제는 grant와 따로다. web 검색과 읽기 결과만 바깥 글로 감싸고, app-api와 외부 MCP 결과는 감싸지 않는다. 조사한 harness 일곱 가운데 다섯이 감싸지 않고, 신뢰 표시는 모두 call 승인에만 쓴다.
