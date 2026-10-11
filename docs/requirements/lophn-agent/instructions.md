---
type: requirements
concerns: [lophn-agent/instructions]
---
# lophn-agent/instructions

사람이 파일로 쓰는 lophn 지침의 층·작업 자리·편집·상한과 agent 설정 화면에서 보이는 방식을 맡는다. agent instructions(agent 정의 본문)의 저장은 lophn-agent/agents, prompt 위치는 lophn-agent/harness/prompt-assemble, coding agent 지침은 coding-agent/guides다.

## 요구

**[R1]** lophn agent 지침은 coding agent의 AGENTS.md와 다른 사람이 쓰는 UTF-8 Markdown 파일 LOPHN.md로 두고 전역(`~/.lophn`)·project 폴더·app 자리 층을 구분하며 agent 정의 본문인 agent instructions를 가장 좁은 층으로 더하고 AGENTS.md는 읽지 않는다.
- 이유: 두 종류 agent의 책임과 지침을 섞지 않고, 사람이 project 폴더에서 바로 보고 고치게 한다.
- 확인: 같은 앱에 LOPHN.md와 AGENTS.md가 있어도 lophn 지침은 LOPHN.md만 읽고 coding 지침은 coding-agent/guides가 맡으며, project 폴더의 LOPHN.md가 그 project의 모든 agent에 같이 적용되는지 본다.
- 의도: lophn-agent#I8

**[R2]** 전역·project·app의 [Instructions]는 해당 LOPHN.md를 문서 editor에서 열고 파일이 없으면 사람의 최초 저장으로 만들며 전체 경로는 기본 화면에서 숨긴다.
- 이유: textarea 사본 대신 사람이 평소 쓰는 파일과 편집기로 관리한다.
- 확인: 세 자리의 선택이 다른 원본 파일을 열고 저장 전 빈 파일이나 새 지침이 자동 적용되지 않는지 본다.
- 의도: lophn-agent#I8

**[R3]** agent는 LOPHN.md와 agent instructions를 직접 만들거나 고치지 않고 question으로 제안만 하며 적용은 사람의 명시 편집·저장이다.
- 이유: 사람의 지속 지시를 agent가 자기 편의로 바꾸지 못한다.
- 확인: agent의 파일·문서 저장 tool로 지침을 고칠 수 없고 사람이 제안을 선택해 저장해야 다음 call부터 바뀐 내용을 읽는지 본다.
- 의도: lophn-agent#I8, lophn-agent#I6

**[R4]** 읽을 전역·project·app 지침은 세션 작업 자리로 고르며 App Engineer와 Operator는 담당 범위로 고정하고 lophn·Context Engineer는 세션을 연 자리로 고정한다(session 안에서 자리를 바꾸지 않는다 — lophn-agent/conversation#R16).
- 이유: 탭을 옮겼다고 지침과 책임이 몰래 바뀌지 않는다.
- 확인: 탭 이동 후에도 같은 지침 층을 읽고, 다른 자리의 지침은 그 자리에서 연 session만 읽는지 본다.
- 의도: lophn-agent#I8

**[R5]** 사람 지침은 전역→project→app→agent instructions 순으로 읽고 뒤의 더 좁은 지침은 제품 규칙과 현재 사람 요청 안에서 앞의 지침을 구체화한다.
- 이유: 좁은 작업의 취향을 넓은 기본 지침 뒤에 둔다.
- 확인: 충돌한 문구가 순서대로 조립되고 agent instructions로 제품 금지나 최신 사람 요청을 무효화하지 못하는지 본다.
- 의도: lophn-agent#I8, lophn-agent#I6

**[R6]** 지침은 권한·approval·제품 금지·읽기와 결과 상한을 넓히지 못하며 읽은 자료의 LOPHN 파일을 현재 작업 자리의 사람 지침으로 자동 승격하지 않는다.
- 이유: 지침 글과 사람의 실제 허락은 다르다.
- 확인: 자료 속 지침과 권한 확대 문구가 tool 판정을 우회하지 못하는지 본다.
- 의도: lophn-agent#I8, lophn-agent#I6

**[R7]** 지침 파일 하나는 32 KiB, 한 call에 넣는 지침 전체는 포장 전 UTF-8 128 KiB까지 허용하고 초과·인코딩 오류·존재하지만 읽을 수 없는 파일은 자동 생략·잘라 읽기 없이 해당 호출을 멈춰 이유를 알린다.
- 이유: 늘 읽는다는 약속을 조용한 부분 읽기로 깨지 않는다.
- 확인: 32 KiB·128 KiB 경계와 초과를 검사하고 model context 한계가 더 작으면 보호 지침을 자르지 않고 호출을 막는지 본다.
- 의도: lophn-agent#I8

**[R8]** 매 model call 직전에 LOPHN.md 파일과 agent instructions를 다시 읽고 작업 자리·층·내용 hash·전송 hash·부재·생략 여부를 조립 근거에 남기며 변경된 지침은 진행 중 run의 다음 call부터 읽는다.
- 이유: 오래된 지침으로 계속 일하거나 전송 근거를 잃지 않는다.
- 확인: run 중 사람 편집 후 다음 call의 지침 hash가 바뀌고 과거 call은 당시 전송한 내용으로 재현되며 읽기 실패에서는 전송하지 않는지 본다.
- 의도: lophn-agent#I8

**[R9]** agent 설정 화면은 그 agent가 있는 project의 LOPHN.md(모든 role·agent 공유)와 그 agent의 instructions를 같이 보이고, project LOPHN.md는 [Edit]로 문서 editor를 열어 고치며 agent instructions는 그 설정 안에서 고친다.
- 이유: agent가 지침을 어떤 순서로 읽는지 한 화면에서 알고 어느 쪽을 고칠지 헷갈리지 않는다.
- 확인: agent 설정에서 project 지침과 agent 지침이 읽는 순서대로 함께 보이고, 같은 project의 다른 agent에서도 같은 project 지침이 보이며, project 지침 [Edit]가 문서 editor로 그 파일을 여는지 본다.
- 의도: lophn-agent#I8, lophn-agent#I5

## 버린 것
- 설정 textarea와 agent의 지침 직접 저장은 파일 정본·사람 편집으로 바꿨다.
- preset에 붙인 지침(문서 id와 순서)은 preset이 없어져 버렸다. 가장 좁은 층은 agent 정의 본문(agent instructions)이다.
- LOPHN.md의 document·version 연결, 이력, 과거 판 복원은 LOPHN.md가 document를 쓰지 않는 그냥 파일이라 버렸다. 파일은 매 call 직전 그대로 읽는다.
