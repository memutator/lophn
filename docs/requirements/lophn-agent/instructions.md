---
type: requirements
concerns: [lophn-agent/instructions]
---
# lophn-agent/instructions

사람이 파일로 쓰는 lophn 지침의 층·작업 자리·편집·이력·상한을 맡는다. prompt 위치는 lophn-agent/harness/prompt-assemble, coding agent 지침은 coding-agent/guides다.

## 요구

**[R1]** lophn agent 지침은 coding agent의 AGENTS.md와 다른 사람이 쓰는 UTF-8 Markdown 파일로 두고 전역·project·app 층을 구분한다.
- 이유: 두 종류 agent의 책임과 지침을 섞지 않는다.
- 확인: 같은 앱에 두 파일이 있어도 lophn 지침은 LOPHN 파일만 읽고 coding 지침은 coding-agent/guides가 맡는지 본다.
- 의도: lophn-agent#I8

**[R2]** 전역·project·app의 [Instructions]는 해당 파일을 lophn 편집기에서 열고 파일이 없으면 사람의 최초 저장으로 만들며 경로와 안쪽 version 식별자는 기본 화면에서 숨긴다.
- 이유: textarea 사본 대신 사람이 평소 쓰는 파일과 편집기로 관리한다.
- 확인: 세 자리의 선택이 다른 원본 파일을 열고 저장 전 빈 파일이나 새 지침이 자동 적용되지 않는지 본다.
- 의도: lophn-agent#I8

**[R3]** 지침 저장과 과거 내용 복원은 documents의 파일 연결·version 계약으로 이력을 얻고 agent는 파일 생성·내용 저장·연결 변경을 직접 하지 않고 question으로 제안한다.
- 이유: 사람의 지속 지시를 agent가 자기 편의로 바꾸지 못한다.
- 확인: agent 문서 저장 tool로 지침을 고칠 수 없고 사람이 제안을 선택해 저장한 뒤 새 version과 복원 이력이 남는지 본다.
- 의도: lophn-agent#I8, lophn-agent#I6

**[R4]** 읽을 전역·project·app 지침은 세션 작업 자리로 고르며 App Engineer와 Operator는 담당 범위로 고정하고 lophn·Context Engineer는 세션을 연 곳을 사람이 명시적으로 바꿀 때만 바꾼다.
- 이유: 탭을 옮겼다고 지침과 책임이 몰래 바뀌지 않는다.
- 확인: 탭 이동 후 같은 지침 층을 읽고 명시 작업 자리 변경 뒤 다음 call만 새 층을 읽는지 본다.
- 의도: lophn-agent#I8

**[R5]** 사람 지침은 전역→project→app→preset에 붙인 지침 순으로 읽고 같은 층 안에서는 연결 순서를 지키며 뒤의 더 좁은 지침은 제품 규칙과 현재 사람 요청 안에서 앞의 지침을 구체화한다.
- 이유: 좁은 작업의 취향을 넓은 기본 지침 뒤에 둔다.
- 확인: 충돌한 문구가 순서대로 조립되고 preset 지침으로 제품 금지나 최신 사람 요청을 무효화하지 못하는지 본다.
- 의도: lophn-agent#I8, lophn-agent#I6

**[R6]** 지침은 권한·approval·제품 금지·읽기와 결과 상한을 넓히지 못하며 읽은 자료의 LOPHN 파일을 현재 작업 자리의 사람 지침으로 자동 승격하지 않는다.
- 이유: 지침 글과 사람의 실제 허락은 다르다.
- 확인: 자료 속 지침과 권한 확대 문구가 tool 판정을 우회하지 못하는지 본다.
- 의도: lophn-agent#I8, lophn-agent#I6

**[R7]** 지침 파일 하나는 32 KiB, 한 call에 넣는 지침 전체는 포장 전 UTF-8 128 KiB까지 허용하고 초과·인코딩 오류·존재하지만 읽을 수 없는 파일은 자동 생략·잘라 읽기 없이 해당 호출을 멈춰 이유를 알린다.
- 이유: 늘 읽는다는 약속을 조용한 부분 읽기로 깨지 않는다.
- 확인: 32 KiB·128 KiB 경계와 초과를 검사하고 model context 한계가 더 작으면 보호 지침을 자르지 않고 호출을 막는지 본다.
- 의도: lophn-agent#I8

**[R8]** 매 call 직전에 현재 지침의 확정 version을 다시 확인하고 작업 자리·층·원본과 전송 hash·부재·생략 여부를 조립 근거에 남기며 변경된 지침은 진행 중 run의 다음 call부터 읽는다.
- 이유: 오래된 지침으로 계속 일하거나 전송 근거를 잃지 않는다.
- 확인: run 중 사람 편집 후 다음 call의 지침 hash가 바뀌고 과거 call은 당시 version으로 재현되며 읽기 실패에서는 전송하지 않는지 본다.
- 의도: lophn-agent#I8

## 버린 것
- 설정 textarea와 agent의 지침 직접 저장은 파일 정본·사람 편집으로 바꿨다.
