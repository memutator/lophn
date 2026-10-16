# S8. place와 session 수명

상태: **확인됨** (2026-10-15). 9장의 결정은 사람이 확인했다(docs-review).

## 1. 범위

lophn agent가 어디에 놓이고(place), session이 언제 열리고 끝나는지다. 그 위에서 session rewind와 앱 rewind를 잇고, fork와 session 허락의 수명을 정한다. 정의의 구성은 S4, call은 S3, 앱 rewind는 S5, coding agent session은 S6이 맡는다.

## 2. place와 agent

| role | 놓이는 곳 | 수 | 생기는 때 | 지침 | file tool 범위 | 근거 |
|---|---|---|---|---|---|---|
| lophn | 없음 | lophn 전체에 하나 | lophn 설치 | 전역, agent 지침. project 지침은 `instructions.read`로 | 등록된 모든 project 폴더를 읽기만. 쓰기와 shell은 없다 | req-0030, 0037 |
| Project Manager | project | project마다 하나 | project 등록. 더하거나 지울 수 없다 | 그 project의 `LOPHN.md` | 그 project의 폴더와, lophn data 안 그 project context의 초안·목차 폴더(S4 4장) | req-0035 |
| App Engineer | 앱 | 앱마다 하나 | 앱 등록. 더하거나 지울 수 없다 | 앱 source가 등록 project 안에 있으면 그 `LOPHN.md` | 앱 source 폴더 | req-1518, 0037 |
| Operator | project 또는 앱 | 여럿 | 사람이 만든다 | project면 그 `LOPHN.md` | project면 그 폴더. 앱이면 사람이 정한 project 폴더(req-0047) | req-0031, 0032 |

- 정의는 project 폴더가 아니라 lophn data 안 project별 폴더에 둔다(req-0034).
- 옛 assignment 상태 machine은 지운다. place에 놓인 agent와 agent grant가 대신한다(S4 9장).

## 3. session 수명

| 상태 | 뜻 | 들어가는 길 |
|---|---|---|
| 열림 | 입력을 받는다. 저절로 끝나지 않는다(AGENT-ROLE T11) | 사람이 연다(sidebar, title bar, toast. req-0084~0087), Router가 call로 연다(S3), Reactor가 reaction으로 연다(S1) |
| archive | 기록만 남고 입력을 받지 않는다 | 사람(req-0045) |
| 지움 | 목록에서 사라진다 | 사람(req-0045) |

- S3의 "닫힘"은 archive나 지움이다.
- role은 열 때 정해지고 바뀌지 않는다(req-0043). place는 그 agent의 place다.
- lophn이 꺼졌다 켜져도 열린 session은 열린 채다. 돌던 turn은 interrupted로 닫히고 대기 권한 요청과 질문은 cancelled다(S1 10장).
- archive를 풀어 다시 여는 것(되살리기)은 나중이다(S3 9장).
- archive하거나 지울 때 도는 turn은 interrupted로 닫고 진행한다(2026-10-15 결정).
- project나 앱을 보관하면 그 place의 session은 열린 채 남지만 reaction과 call의 새 입력을 받지 않는다. 다시 꺼내면 이어서 받는다(req-1522).
- coding agent session은 process로 끝난다(S6 8장).

**archive나 지움이 다른 것에 주는 영향**

| 것 | 영향 | 근거 |
|---|---|---|
| 이 session이 받은 열린 call | failed(`receiver_ended`) | S3 5장 |
| 이 session이 보낸 call의 답 | 받은 session에만 남는다 | S3 5장 |
| 대기 권한 요청, 질문 | cancelled | S2 6장 |
| "이 session 동안" 허락 | 사라진다 | req-0319 |
| coding agent의 메시지와 완료 보고 | 그 앱의 App Engineer 새 session이 받는다 | S3 4장, S6 |

## 4. session rewind와 앱 rewind 잇기

S5 8장에서 두 되돌리기를 나눴다. 여기서 잇는다(req-1519).

- session rewind 화면은 고른 시점으로 대화를 되돌린다. 기본으로 그 session이 file tool로 바꾼 파일도 함께 되돌린다(req-0044).
- 고른 시점 뒤에 이 session이 앱에 write를 했으면 앱마다 보인다(S5가 session·turn별 write invocation 목록을 준다).
- 사람이 앱을 고르면 그 앱을 그 시점으로 되돌린다. 함께 되돌아갈 다른 변경(사람의 화면 조작, 다른 session의 호출)과 되돌아가지 않는 external 효과를 먼저 보인다(S5 7장).
- 고르지 않으면 앱 data는 그대로다.
- checkpoint는 turn을 시작하는 Router 입력(사람 메시지, call, 답)마다 생긴다. steer로 도는 turn에 들어간 메시지는 checkpoint가 아니다(Claude Code checkpointing의 "Messages sent mid-turn not checkpointed"와 같다).
- Claude Code의 rewind 메뉴가 코드와 대화를 따로 고르게 하는 것과 같다(checkpointing 문서).

## 5. fork

fork는 지금 session의 대화를 복사해 새 session을 연다(S4 7장).

| 것 | 새 session으로 | 이유 |
|---|---|---|
| 대화 이력 | 복사 | fork의 뜻 |
| role, place, agent | 같음 | req-0043 |
| "이 session 동안" 허락 | 가져오지 않음 | 다른 session으로 넘어가지 않는다(req-0319) |
| 대기 권한 요청, 질문 | 가져오지 않음 | 원래 session의 turn에 묶였다 |
| 열린 call(보낸 것, 받은 것) | 가져오지 않음 | call은 원래 session에 묶였다(S3) |
| rewind 기록 | 가져오지 않음. 새 session은 fork 시점부터 | 같은 파일을 두 session이 되돌리면 부딪친다 |

## 6. "이 session 동안" 허락의 수명

- 요구: 같은 session에서 같은 대상을 다시 묻지 않고, session이 닫히거나 archive되거나 지워지면 사라지며 다시 열어도 되살아나지 않는다(req-0318, 0319).
- lophn이 꺼졌다 켜져도 session은 열린 채다. 허락을 메모리에만 두면 그때 사라진다.
- 정함: 메모리에 둔다(9장 8). 조사(`../research/session-grant-lifetime.md`): Claude Code, Codex, Gemini CLI, Hermes는 모두 session 허락을 process 메모리에 두고, 재시작하거나 resume하면 사라진다. session 기록에 쓰는 harness는 없다. OpenCode, Goose, Cline은 session 범위가 아예 없다. 9장 8.

## 7. 지울 옛 것

- assignment 상태 machine(`packages/core/lophn-agent/assignments`), preset → place에 놓인 agent와 agent grant(S4 9장).

## 8. 다른 spec과 닿는 곳

- S3: 받는 곳의 새 session은 role과 place로 연다. 닫힘의 뜻은 3장.
- S4: place 정보, 지침 층, file tool 범위.
- S5: session·turn별 write 목록과 앱 rewind.
- S2: session 허락(6장).

## 9. 다시 따진 것

1. **정함(사람, 2026-10-15): App Engineer는 앱마다 하나다.** 앱을 등록하면 생기고 더하거나 지울 수 없다. Project Manager와 같은 모양이다. session은 여럿 열 수 있다(req-1518).
2. **정함: 새 앱은 lophn이 등록한다.** 생긴 앱의 App Engineer에게 call로 맡긴다. lophn이 기획을 맡는다(AGENT-ROLE L2, L4). req-0719, 1063을 고쳤다. S4의 `app.create`는 lophn의 쓰기 tool이다.
3. **정함: lophn의 file tool은 등록된 모든 project 폴더를 읽기만 한다.** 쓰기와 shell은 없다. lophn은 call로 맡긴다(S4 4장).
4. **정함: 앱 place의 file 범위.** App Engineer는 앱 source 폴더, 앱 place의 Operator는 사람이 정한 project 폴더(req-0047).
5. **정함: App Engineer의 project 지침.** 앱 source가 등록 project 안에 있으면 그 `LOPHN.md`를 읽고, 없으면 project 지침 없이 돈다(req-0721은 source를 임의 위치에 둘 수 있다). req-0037에 확인 줄을 더했다.
6. **정함: session rewind와 앱 rewind 잇기(4장)를 요구로 썼다.** req-1519.
7. **정함: fork는 5장 표대로다.** 지금 코드의 fork(마지막 확정 메시지까지 복사해 같은 role·place의 새 탭)가 이미 맞다. assignment 참조만 role·place로 바꾼다.
8. **정함(사람, 2026-10-15): "이 session 동안" 허락은 메모리에 둔다(6장).** lophn이 꺼졌다 켜지면 사라지고 한 번 더 묻는다. 조사한 harness(Claude Code, Codex, Gemini CLI, Hermes)가 모두 그렇고, 다시 묻는 것은 안전한 쪽 실패다. lead 실수: 처음에 조사 전에 session 기록을 추천했다.
