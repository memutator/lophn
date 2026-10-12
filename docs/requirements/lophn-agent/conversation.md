---
type: requirements
concerns: [lophn-agent/conversation]
---
# lophn-agent/conversation

agent 하나와 자리 하나에 고정된 session과 그 제목·archive·delete·목록·검색, 확정 메시지, 진행 중 수정과 다음 요청의 구분, 입력 접수·반영 표시, toast에서 연 session의 첫 context, session 단위 model 선택, Fork(session 복사)와 Compact(사람이 부르는 요약), rewind가 session에 남기는 숨긴 구간을 맡는다; 요약 생성 방법은 lophn-agent/harness/prompt-assemble, `/` 명령의 목록·이름·실행 조건은 lophn-agent/commands가 맡는다.

## 요구

### 책임과 범위

**[R1]** session은 agent(assignment) 하나와 자리(project 또는 app) 하나에 고정되어 사람이 그 agent를 불러 빈 session으로 시작하며, session 안에서 agent나 role을 바꾸지 않고 다른 agent는 다른 session에서 한다.
- 이유: role마다 쓰는 tool과 prompt 조립이 달라서(사람 지적: "세션 내에서 바꾸는 게 아님") 중간에 바꾸면 지금까지의 대화와 판단 근거가 어느 role의 것인지 섞인다.
- 확인: 한 session 안에서 agent를 바꾸는 입력이 없고, 다른 agent를 부르면 새 session이며 이전 session의 메시지나 요약이 자동으로 들어가지 않는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I4

**[R2]** session은 저장된 확정 메시지·결정·각 메시지 담당 run에서 계속하며 자정·화면 닫기·연결 끊김·재시작 때문에 끝내거나 미처리 말을 다시 입력시키지 않는다.
- 이유: 오래 쓰는 로컬 앱의 대화가 표시 수명에 종속되지 않는다.
- 확인: 재시작 뒤 확정 메시지와 관련 run이 그대로 보이고 실제 복구는 lophn-agent/harness/waiting-and-recovery를 따르는지 본다.
- 의도: lophn-agent#I1

**[R3]** 진행·질문·approval 대기 중에도 새 메시지를 접수하되 메시지 접수와 모델 판단의 최초 반영을 따로 보여 주고 입력 접수만으로 수정·멈춤 완료를 표시하지 않는다.
- 이유: 사람에게 입력이 언제 실제 일에 쓰였는지 알려 준다.
- 확인: 대기 중 보낸 메시지가 접수로 남지만 model call 전에는 반영됨으로 보이지 않으며 멈춤 동작은 lophn-agent/harness/run-loop와 shell/desktop을 따르는지 본다.
- 의도: lophn-agent#I1

**[R4]** 발언과 결과는 사람의 말·역할 판단·machine 확인 사실 및 주체·시각을 구분하고 실제 생성·변경 대상의 링크만 남기며 계획을 산출물 생성으로 표시하지 않는다.
- 이유: 자연어 계획과 실제 저장된 결과는 다르다.
- 확인: 기획만 한 앱에 생성 링크가 없고 실제 문서 version 링크는 열 수 있는지 본다.
- 의도: lophn-agent#I1

### 입력 담당과 반영

**[R5]** 사람은 현재 일의 수정과 별도 다음 일을 구분해 보내며 수정 원문은 접수 순서로 보존해 다음 모델 판단에 모두 반영한다.
- 이유: steering과 새 작업을 임의로 합치지 않는다.
- 확인: 두 수정을 연달아 보내면 순서대로 남고 실제 tool 경계의 반영은 lophn-agent/harness/run-loop를 따르는지 본다.
- 의도: lophn-agent#I1

**[R6]** 다음 요청은 현재 일과 분리해 보존하고 정상 종료 뒤 접수 순서대로 새 run으로 처리하되 실패·멈춤 뒤 자동 시작하지 않는다.
- 이유: 실패한 일 뒤 후속 요청을 자동 실행해 의도를 벗어나지 않는다.
- 확인: follow-up 두 개가 각 run으로 남고 실패 뒤 대기 상태이며 실제 시작 선택은 lophn-agent/harness/run-loop를 따르는지 본다.
- 의도: lophn-agent#I1

**[R7]** enabled assignment에서 끝나는 순간 도착한 수정도 유실하지 않고 현재 run이 아직 종료를 확정하지 않았으면 그 run에, 종료 뒤면 새 담당 run에 정확히 한 번 연결해 반영 여부를 보여 준다.
- 이유: 종료 경합에서 접수한 메시지가 사라지거나 두 번 실행되지 않는다.
- 확인: 종료 직전·직후 메시지가 각각 담당 하나를 가지며 이미 끝난 run을 다시 열지 않는지 본다.
- 의도: lophn-agent#I1

### session 관리

**[R18]** session 제목은 첫 사람 메시지의 앞 60자로 자동으로 정하고 사람이 언제든 rename할 수 있으며, rename한 제목은 자동으로 덮어쓰지 않는다. 번호로 붙이는 이름("Conversation N")은 쓰지 않는다.
- 이유: 목록에서 session을 알아보게 하면서 사람이 붙인 이름을 지키고, 번호 이름이 뜻을 주지 못하는 문제를 없앤다.
- 확인: 첫 메시지 뒤 제목이 그 앞 60자이고, rename 뒤 새 메시지가 와도 제목이 그대로이며, 메시지가 없는 session에는 번호 이름이 붙지 않는지 본다.
- 의도: lophn-agent#I1

**[R19]** archive는 session을 기본 목록에서 숨기기만 하고 메시지·run 기록·진행 중 일은 그대로 두며, archive한 session을 다시 열면 풀린다.
- 이유: 사람이 지우지 않고 목록을 정리하게 한다.
- 확인: archive한 session이 기본 목록에는 없고 Archived 보기에는 있으며, 진행 중 run이 멈추지 않고, 다시 열면 기본 목록으로 돌아오는지 본다.
- 의도: lophn-agent#I1

**[R20]** delete는 확인을 거쳐 session·메시지·그 session의 run 기록을 지우고 되돌릴 수 없으며, 진행 중이거나 사람을 기다리는 run이 있는 session은 먼저 멈추기 전에는 지우지 않고, 그 run이 만든 문서·앱 변경은 지우지 않는다.
- 이유: 사람이 원하지 않는 기록을 없앨 수 있어야 하지만, 지운다는 말이 이미 생긴 문서와 앱의 변경까지 없앤 것처럼 보이면 안 된다. 되돌리기(rewind)는 session이 살아 있는 동안만 하는 약속(lophn-agent#I7)이라 delete 뒤에는 없다.
- 확인: delete 뒤 session·메시지·run 기록이 어디서도 열리지 않고, 진행 중 session의 delete는 거절되며, 그 run이 만든 문서 version은 그대로인지 본다. 실제 지움 방식은 platform/ledger를 따른다.
- 의도: lophn-agent#I1, lophn-agent#I7

**[R21]** session 목록은 agent와 자리별로 그 agent·자리의 session만 보여 주고, 검색은 제목만 대상으로 하며 메시지 본문은 보지 않는다.
- 이유: 한 session은 agent 하나와 자리 하나에 고정되므로(R1) 목록도 같은 단위로 보면 되고, 본문 검색은 secret이 섞인 원문을 훑는 일이 된다.
- 확인: 다른 agent나 다른 자리의 session이 목록에 섞이지 않고, 본문에만 있는 말로는 찾아지지 않으며, 제목의 일부로는 찾아지는지 본다.
- 의도: lophn-agent#I1

**[R22]** toast에서 연 session은 그 toast가 가리킨 사건의 대상을 첫 context로 가지고 시작하며, 이는 session을 열 때만 정해져 바뀌지 않고, 그 안의 글은 자료로만 쓰고 지시로 따르지 않는다. 어떤 사건이 agent를 부르는지는 platform/notifications가 정한다.
- 이유: 사람이 사건을 다시 설명하지 않고 바로 일을 시킨다. 프로그램은 문서 내용을 판단하지 못하므로 사건의 종류와 대상만 넘긴다.
- 확인: toast에서 연 session의 첫 context가 사건 대상을 가리키고 session을 다시 열어도 같으며, 다른 길로 연 session에는 없고, 그 대상의 글에 든 지시가 실행되지 않는지 본다.
- 의도: lophn-agent#I1, lophn-agent#I6

**[R23]** composer에서 고른 model과 option(effort·speed 등)은 그 session에만 저장하며 agent 기본값과 다른 session을 바꾸지 않고, 진행 중 run에는 적용하지 않고 다음 run부터 쓴다. 고를 수 있는 model과 option, 맞지 않는 값의 처리는 lophn-agent/harness/model이 정한다.
- 이유: 한 대화에서만 더 강한 model을 쓰고 싶을 때 기본값을 건드리지 않는다. 진행 중 run은 시작할 때 고정한 판으로 끝까지 간다.
- 확인: session A에서 model을 바꿔도 session B와 agent 기본값이 그대로이고, 진행 중 run의 호출은 이전 model이며 다음 run부터 새 model인지 본다.
- 의도: lophn-agent#I1

**[R24]** `/` 명령 가운데 session에 남는 것(Rename·Archive·Fork·Compact)은 R18·R19·R9·R10과 같은 동작이며, 명령 목록·이름·진행 중 실행 가능 여부는 lophn-agent/commands가 정한다.
- 이유: 같은 동작을 메뉴와 명령이 다르게 하지 않는다.
- 확인: `/`의 Rename·Archive·Fork·Compact 결과가 popover의 같은 동작과 같은 기록을 남기는지 본다.
- 의도: lophn-agent#I1

### 종료와 복사·요약

**[R8]** session은 담당 assignment가 회수(withdrawn)되어 미완료 run·대기 요청을 정리한 때만 닫혀 읽기 전용이 되고, assignment 일시 멈춤(paused — 대상 보관)·archive·화면 닫기는 닫지 않으며, paused에서는 원문을 읽을 수 있고 새 입력은 받지 않는다.
- 이유: 유휴 30일이나 일시 장애로 대화를 없애지 않고, 사람이 목록을 정리하는 일(archive·delete)과 담당 회수를 구별한다. 일할 수 없는 대상에 입력을 받아 쌓지 않는다.
- 확인: 30일 유휴·paused·archive에서도 원문을 계속 읽고, withdrawn 뒤와 paused에서는 새 입력을 거절하는지 본다.
- 의도: lophn-agent#I1

**[R9]** Fork는 같은 agent·같은 자리의 새 session을 만들어 사람이 고른 지점까지의 확정 메시지를 복사하고 출처 session을 가리키며, 진행 중 일·미답 질문·approval request·이미 생긴 효과·run 기록은 복사하지 않는다.
- 이유: 같은 대화에서 다른 방향을 시험하되 새 판단에 과거 결정이나 효과를 재사용하지 않는다.
- 확인: fork한 session에 메시지만 있고 run·질문·approval request가 없으며 기존 승인이 새 동작에 적용되지 않고, 원래 session을 delete해도 복사본이 남는지 본다.
- 의도: lophn-agent#I1

**[R10]** Compact는 사람이 부를 때만 같은 session의 앞 구간을 lophn-agent/harness/prompt-assemble의 요약 규칙으로 요약해 이후 call의 조립에 쓰고, 출처를 표시해 일반 agent 답과 구별하며, 원문 메시지는 지우지 않고 요약이 실패해도 session과 원문은 그대로다.
- 이유: 긴 대화가 model 한계에 닿기 전에 사람이 직접 줄이게 하되, organizing model 장애가 session을 못 쓰게 만들지 않는다.
- 확인: 요약 성공 뒤 원문이 모두 남고 요약이 구간·출처와 함께 표시되며, 실패하면 session 상태·원문·입력 접수가 변하지 않는지 본다.
- 의도: lophn-agent#I1

**[R11]** archive했거나 닫은 session을 늦은 notification·tool 결과로 다시 활성화하거나 효과를 재실행하지 않고, Fork로 복사한 session에서 이후 변화는 원래 시각의 이미 생긴 사실로 구분한다.
- 이유: 변화를 새 답이나 새 적용처럼 보이지 않는다.
- 확인: 늦은 변화 뒤 session이 archive·닫힘 그대로이고 notification 선정·보존은 platform/notifications를 따르는지 본다.
- 의도: lophn-agent#I1

**[R25]** rewind한 session은 고른 메시지 뒤의 메시지를 지우지 않고 숨긴 구간으로 표시해 이후 model 입력에서 빼고 그 메시지의 원문을 입력창에 채우며, 숨긴 구간은 다음 사람 메시지를 보내기 전까지만 redo로 다시 보이고, closed session에서는 rewind하지 않으며 Fork는 숨긴 메시지를 복사하지 않는다. 무엇을 되돌리고 어떻게 복원하는지는 lophn-agent/revert가 정한다.
- 이유: 되돌려도 대화 기록은 사실로 남고, 마음이 바뀌면 다음 말을 하기 전까지는 되돌릴 수 있다.
- 확인: rewind 뒤 숨긴 구간 표시가 보이고 숨긴 메시지가 이후 call의 입력에 들지 않으며, 새 메시지를 보내면 redo가 사라지고, 숨긴 메시지는 Fork 복사본에 없으며 closed session에는 rewind가 없는지 본다.
- 의도: lophn-agent#I7

### 새 기능

**[R12]** 확정 agent 메시지는 본문 사이에 lophn-agent/visuals의 시각 블록을 순서대로 담아 재시작과 Fork 뒤에도 같은 명세·출처로 보여 준다.
- 이유: 글과 그림이 같은 답의 기록으로 남아야 한다.
- 확인: 본문·표·본문·앱 카드 순서의 답을 저장하고 재시작 뒤 순서·출처가 유지되는지 본다.
- 의도: lophn-agent#I9

**[R13]** 시각 블록은 확정 메시지와 함께 저장하고 미완성 model 응답·stream 조각을 확정 블록으로 만들거나 renderer 실패를 메시지 실패로 바꾸지 않는다.
- 이유: 임시 표시와 저장된 답을 구별한다.
- 확인: partial 응답에는 확정 블록이 없고 renderer 실패 뒤 텍스트 설명이 남는지 본다.
- 의도: lophn-agent#I9

**[R16]** session의 자리는 project 또는 app 하나로 열 때 정해 고정한다. App Engineer는 담당 app, Operator는 담당 project 또는 app이고 lophn은 연 project 또는 app, Context Engineer는 연 project이며, 탭 이동·재시작·handoff로 바뀌지 않고 Lophn Workspace에는 session이 없다.
- 이유: 지침 층을 고르는 자리와 지금 보는 화면을 구분하고, 자리를 session 중간에 바꿔 일의 범위가 흐려지지 않게 한다.
- 확인: 다른 project 탭으로 이동해도 지침은 같고 같은 session을 다시 열어도 자리가 유지되며, Lophn Workspace에서 연 session이 없는지 본다.
- 의도: lophn-agent#I8, lophn-agent#I4

## 열린 질문

## 버린 것
- assignment당 열린 세션 최대 8개·아홉 번째 자동 종료는 현재 열린 세션 상한이 없으므로 제거했다.
- 확정 발언에서 갈래 세션을 만들면서 복제·revert 규칙을 따로 두던 방식은 쓰지 않는다. Fork(R9)는 사람이 고른 지점까지 확정 메시지만 복사한다.
- 8개 상한의 자동 종료 때 요약 실패를 처리하는 경로는 해당 상한·자동 종료가 없어 제거했다.
- 일반 메시지를 질문 답·승인으로 쓰지 않는 중복 문장은 lophn-agent/questions와 platform/approvals의 명시 결정 계약으로 모았다.
- 마지막 발언 뒤 30일 자동 만료와 종료 시 필수 요약 생성은 assignment 회수만 session을 닫는 계약(R8)과 사람이 부를 때만 요약하는 Compact(R10)로 바꿨다.
- 사람이 session을 끝내는 기능(옛 R8의 사람 종료)과 끝난 session에서 새 session으로 이어가는 기능(옛 R9~R10의 이어가기·요약): 사람이 session을 치우는 길은 archive·delete(R19·R20)로, 새 session으로 가는 길은 Fork(R9)로, 요약은 같은 session의 Compact(R10)로 바꿨다. 새 화면에 Close가 없다.
- 옛 R14 paused assignment의 열린 session에서 다음 요청을 run 없이 보존하고 사람이 재개한 뒤 실행을 선택하는 경로: 사람의 Pause·Resume을 없애 paused가 대상 보관만 남으므로(lophn-agent/assignments#Q4) 보존·명시 실행 화면이 없다. paused에서는 새 입력을 받지 않는다(R8).
- 옛 R17 lophn·Context Engineer의 작업 자리를 사람이 명시 변경하는 기능: session의 자리는 열 때 고정한다(R16). 다른 자리의 일은 그 자리에서 새 session으로 한다.
- Lophn Workspace의 전역 session(work_place `global`): agent는 project 또는 app에서만 부르고 Lophn Workspace에는 agent가 없다(설정만).
- session 이름을 "Conversation N" 번호로 붙이는 규칙: 첫 사람 메시지 앞 60자 제목(R18)으로 바꿨다.
