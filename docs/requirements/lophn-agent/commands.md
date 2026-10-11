---
type: requirements
concerns: [lophn-agent/commands]
---
# lophn-agent/commands

Agent composer의 `/` 명령을 맡는다. `/`를 치면 뜨는 것은 전역 built-in, role별 built-in, skill 세 종류이고, 한 registry에서 나온다. 목록과 built-in 이름 예약, 같은 이름 skill의 구분, 작업 중 사용 가능 여부, 실행을 정한다. skill을 찾고 읽는 일은 lophn-agent/extensions가, 명령이 부르는 session 동작은 lophn-agent/conversation이, 메뉴의 모양과 배치는 shell/desktop이 맡는다.

## 요구

### 세 종류와 첫 목록

**[R1]** Agent composer에서 `/`를 치면 메뉴에 전역 built-in, 그 agent의 role별 built-in, 그 agent가 쓸 수 있는 skill 세 종류만 Commands · <agent 이름> · Skills 세 묶음으로 이 순서로 뜨고, 이어서 치는 글자가 이름·설명과 맞는 명령만 남기며 맞는 명령이 없는 묶음은 숨긴다.
- 이유: 사람이 정한 세 종류(전역 built-in, 롤별 built-in, skills)를 한 메뉴에서 찾게 하고, 그 밖의 것(model tier, plugin 명령 등)을 끼워 넣지 않는다.
- 확인: lophn Agent 탭에서 `/`를 치면 세 묶음이 정한 순서로 뜨고 `/co`를 치면 이름이나 설명이 맞는 명령만 남으며 App Engineer와 Operator 탭에서는 가운데 묶음이 없다.
- 의도: lophn-agent#I1

**[R2]** 전역 built-in은 모든 agent에 공통으로 New session · Rename · Archive · Compact · Fork · MCP · Skills · Permissions 여덟 개이고 Feedback은 보낼 곳이 없어 두지 않으며, registry에 정한 고정 순서로 보이고 알파벳순으로 다시 정렬하지 않는다.
- 이유: 어느 agent에서 열어도 session을 다루는 명령이 같아야 배우지 않고 쓴다.
- 확인: lophn·Context Engineer·App Engineer·Operator 탭의 첫 묶음이 같은 여덟 개를 같은 순서로 보이고 Feedback·model 속도 명령은 없다.
- 의도: lophn-agent#I1

**[R3]** role별 built-in은 lophn에 New app · Repair app, Context Engineer에 Check contracts · New context이고 App Engineer와 Operator에는 없으며, 그 role의 agent 탭에서만 보이고 다른 role에서는 보이지도 불리지도 않는다.
- 이유: role마다 하는 일이 다르니 그 일을 바로 시키는 입구도 role마다 다르다.
- 확인: lophn 탭에서 Check contracts를 쳐도 맞는 명령이 없고, Context Engineer 탭에서는 New app이 없으며 둘째 묶음의 이름이 그 agent의 이름이다.
- 의도: lophn-agent#I2

**[R4]** 메뉴·자동완성·이름 검사는 한 registry 목록에서 나오며, 항목마다 이름·설명·출처(built-in·role·skill)·작업 중 사용 가능 여부(바로 실행·끝난 뒤 실행·못 씀)·실행 방식을 가진다.
- 이유: 메뉴에 보이는 것과 실제로 실행되는 것이 어긋나지 않게 하고, 새 명령을 더하는 자리를 하나로 한다.
- 확인: registry에 명령 하나를 더하면 메뉴와 자동완성에 함께 나타나고, registry에 없는 이름은 어느 쪽에서도 실행되지 않는다.
- 의도: lophn-agent#I1

### 이름

**[R5]** built-in 이름(전역과 그 agent의 role별)은 예약되어 skill이 덮지 못하며, skill 이름이 예약된 이름과 같으면 `/`로는 그 built-in만 불리고 그 skill은 `/`로 부를 수 없다는 사실을 사람에게 알린다.
- 이유: skill 하나 때문에 Compact나 Fork 같은 기본 동작이 바뀌면 이름이 믿을 수 없게 된다. Codex와 Hermes는 built-in을 먼저 두고, built-in을 덮을 수 있게 둔 Claude Code는 alias 버그가 났다.
- 확인: 이름이 `compact`인 skill을 켜 놓고 `/compact`를 치면 Compact만 실행되고 skill 묶음의 그 항목에는 부를 수 없는 이유가 붙으며 skill 자체는 읽을 수 있다.
- 의도: lophn-agent#I1, lophn-agent#I6

**[R6]** registry에 같은 이름의 skill이 둘 이상 올라오면 모두 메뉴에 보이되 서로 구분되는 출처를 붙이고, 이름만 쳐서 제출하면 그 이름의 skill이 하나일 때만 실행하며 둘 이상이면 실행하지 않고 어느 것인지 고르게 한다.
- 이유: 같은 이름이 둘이면 어느 절차가 도는지 이름만으로는 알 수 없고, 하나를 조용히 고르면 엉뚱한 skill이 실행된다. Codex는 둘 다 보이고 구분한다.
- 확인: 이름은 같고 본문이 다른 skill 둘을 올리면 메뉴에 둘이 출처와 함께 나오고, 이름만 제출하면 실행되지 않고 선택을 묻는다.
- 의도: lophn-agent#I1

**[R7]** skill 묶음은 그 agent가 쓸 수 있는 skill 전부를 전역인지 그 agent 전용인지 구분하지 않고 한 목록으로 보이며 출처 badge를 달지 않고(R6의 같은 이름 구분은 예외), 끈 skill과 목록에서 제외된 skill은 보이지 않으며 이름의 영문 사전순으로 놓는다.
- 이유: 사람이 정했다: 전역과 해당 agent 전용을 구분하지 않는다. 구분하는 일은 이름이 겹칠 때만 필요하다.
- 확인: 전역에 등록한 skill과 그 agent 자리에만 둔 skill이 같은 목록에 구분 없이 나오고, agent 정의에서 끈 skill은 `/`에도 없다.
- 의도: lophn-agent#I5

### 실행

**[R8]** 명령마다 작업 중(run이 돌거나 질문·승인을 기다리는 중) 사용 가능 여부를 가진다: Fork는 못 쓰고, Compact와 role별 built-in과 skill은 이번 일이 끝난 뒤 실행하며, 나머지는 바로 실행한다. 못 쓰는 명령은 흐리게 보이고 이유를 말한다.
- 이유: 돌고 있는 session을 복사하면 복사본이 어느 시점인지 정할 수 없고, 요약이나 prompt는 이번 일 도중에 끼면 안 된다. Codex와 Claude Code도 명령마다 이 구분을 둔다.
- 확인: 작업 중 Fork 항목은 흐리고 "작업 중에는 쓸 수 없다"는 이유가 보이며, Compact를 고르면 대기하다가 이번 run이 끝난 뒤 실행되고 Rename은 즉시 적용된다.
- 의도: lophn-agent#I1

**[R9]** 전역 built-in은 해당 동작(session 새로 열기·이름 바꾸기·보관·요약·복사, MCP 상태 보기, skill 켜고 끄기, 권한 보기)을 사람이 직접 한 것으로 하며, role별 built-in은 정한 prompt를 사람이 보낸 메시지로 접수하거나 정한 tool 하나를 실행하고, skill 명령은 그 skill을 이번 요청에 쓰라는 사람의 메시지로 접수한다.
- 이유: 명령은 사람이 입력창에서 시키는 일이므로 사람의 행동으로 남고, agent가 몰래 시키는 경로가 되지 않는다.
- 확인: New app을 고르면 정한 prompt가 사람의 메시지로 session에 남고, Rename·Archive는 session에 사람의 변경으로 남으며, skill 명령은 그 skill의 이름이 든 사람의 메시지로 남는다.
- 의도: lophn-agent#I1, lophn-agent#I6

**[R10]** 명령은 agent의 권한·승인·제품 금지·읽기와 결과 상한을 넓히지 못하며, 명령이 부르는 tool과 prompt가 시키는 일은 일반 입력과 똑같이 lophn-agent/harness/tool-judgment의 현재 판정을 받는다.
- 이유: 편하게 부르는 입구가 권한을 넓히는 통로가 되어서는 안 된다.
- 확인: Operator의 상한 밖 일을 시키는 skill 명령을 골라도 거절되고, Permissions 명령은 권한을 보고 바꾸는 사람의 화면을 열 뿐 명령 자체로 허락을 늘리지 않는다.
- 의도: lophn-agent#I6

**[R11]** 맞는 명령이 없는 `/…` 입력은 명령으로 실행하지 않고 알 수 없는 명령이라고 알리며 일반 메시지로 보내지 않는다.
- 이유: 오타 난 명령이 그대로 agent에게 말로 가면 사람이 뜻하지 않은 일이 시작된다.
- 확인: `/compcat`을 제출하면 session에 메시지가 생기지 않고 알 수 없는 명령이라는 알림만 나온다.
- 의도: lophn-agent#I1

## 열린 질문

## 버린 것

첫 목록에 넣지 않은 것과 그 이유.

- Feedback — 보낼 곳이 없다.
- model·속도(fast) 명령 — model과 option은 model picker가 맡고 같은 것을 두 군데 두지 않는다(lophn-agent/harness/model).
- plugin·MCP prompt 명령, 사람이 만드는 사용자 정의 명령 파일 — 사람이 정한 세 종류에 없다. 필요해지면 registry 출처를 늘린다.
- status·diff·copy·export·review 같은 다른 harness의 built-in — lophn 사람이 쓸 자리가 아직 없다.
