---
type: requirements
concerns: [lophn-agent/revert]
---
# lophn-agent/revert

사람이 session이 살아 있는 동안 자기 메시지 시점(checkpoint)으로 대화와 agent가 바꾼 문서·앱 data를 되돌리는 rewind(선택지 셋, 숨긴 메시지와 redo, 문서 파일 복원 판정, 앱 revert command), 편집 카드 하나를 되돌리는 Undo, 되돌릴 수 없는 영향의 사전 설명, 이를 위한 pre-image 기록과 그 한도·수명을 맡는다.

## 요구

### 책임과 범위

**[R1]** rewind는 session 안에서 사람 메시지(checkpoint)를 고르면 그 시점 이후 agent가 바꾼 문서와 앱 data를 되돌리는 기능이며 session이 살아 있는 동안에만 있고, 이후 run이 끝났든 실패·멈춤이든 확정된 변경은 모두 대상에 든다.
- 이유: 맡긴 일이 마음에 안 들면 그 자리로 돌아가게 하되, 문서 판 이력이나 run 단위 묶음 없이 session 하나로 약속을 좁힌다.
- 확인: failed·stopped run이 바꾼 문서도 대상에 나오고, closed session과 delete한 session에는 rewind 단추가 없는지 본다.
- 의도: lophn-agent#I7

**[R2]** rewind와 Undo는 사람만 요청할 수 있으며 agent가 대신 적용하거나 원래 run을 다시 시작하는 기능으로 쓰지 않는다.
- 이유: 사람의 되돌리기 결정과 agent의 새로운 변경을 구분한다.
- 확인: agent의 rewind 요청은 거절되고 사람이 적용한 뒤 새 agent run이 자동으로 생기지 않는지 본다.
- 의도: lophn-agent#I7

**[R3]** 적용 전에 복원할 것·건너뛰는 것·남는 영향을 이유와 함께 보여 주고 적용 뒤에는 실제 복원·건너뜀·부분 결과를 구별해 보여 준다.
- 이유: 모든 변화가 돌아간다는 오해를 막고 "Restored the documents, but skipped N files"처럼 건너뛴 수를 숨기지 않는다.
- 확인: 건너뛴 파일이나 복원 불가 영향이 있는 rewind에서 그 목록과 이유가 확인 화면과 결과에 나오고 확인 화면은 shell/confirmation-window를 따르는지 본다.
- 의도: lophn-agent#I7

**[R4]** 문서 파일은 파일마다 판정해 복원할 수 없는 파일만 건너뛰고 나머지는 복원하며, 앱 write는 사전 검사에서 현재 revision이 맞지 않으면 그 단계와 같은 앱의 더 앞선 단계를 부르지 않고, 시작 뒤 앱의 새 충돌·실패·효과 불명은 부분 동의로 강제 덮어쓰지 않는다.
- 이유: 사람이 나중에 한 변경은 보호하되 파일 하나가 막혔다고 나머지 복원까지 포기하지 않고, 앱 write는 원래 순서를 어기면 상태가 어긋난다.
- 확인: 파일 둘 중 하나를 사람이 고쳤으면 하나만 복원되고 건너뛴 목록에 오르며, 앱 단계 하나가 사전 검사에서 막히면 그 앱의 더 앞선 단계가 호출되지 않는지 본다.
- 의도: lophn-agent#I7

**[R6]** 실제 외부 영향·activation·secret 사용·receipt 없는 앱 변경·소스 git·이 session 밖의 변경은 되돌렸다고 표시하지 않고 "Changes made outside this session are not restored."를 menu에서 미리 말하며, 복원 가능한 것만 적용해도 전체 복원으로 표시하지 않는다.
- 이유: 문서·앱 data 복원과 외부 세계 복구는 다르다.
- 확인: 이미 보낸 외부 결과나 활성 앱 상태가 남는데 복구 완료라고 쓰지 않으며 menu 아래에 고정 문구가 늘 보이는지 본다.
- 의도: lophn-agent#I7

**[R7]** 복원 불가 영향이 섞여 있으면 확인 화면이 그 영향을 따로 보이고, 사람이 남는 영향을 확인한 결정이 있을 때만 복원 가능한 것을 적용한다.
- 이유: 일부만 돌아가는 rewind를 암묵적 성공으로 만들지 않는다.
- 확인: 남는 영향 확인 전에는 문서·앱·대화 어느 것도 바뀌지 않고 확인 뒤에도 복원 가능한 것만 바뀌는지 본다.
- 의도: lophn-agent#I7

**[R8]** 같은 rewind 요청을 반복해도 복원은 한 번만 적용하며 원래 질문 답·승인 결정·호출 결과·관측 사실과 사용량은 실제 사실로 남기고 숨긴 구간 안에 있다고만 표시한다.
- 이유: 복원으로 과거 결과를 거짓으로 지우거나 중복 복원하지 않는다.
- 확인: 같은 요청을 다시 보내도 파일과 앱이 한 번만 되돌려지고 숨긴 구간의 답·승인·호출 결과·사용량이 그대로 읽히는지 본다.
- 의도: lophn-agent#I7

**[R9]** 앱 대상의 복원 가능성과 충돌은 그 앱의 선언된 revert command와 현재 revision 검사를 따르며 분류되지 않은 영향을 목록에서 누락하거나 안전하다고 가정하지 않는다.
- 이유: rewind가 앱의 안전 규칙을 대신 정하지 않는다.
- 확인: 앱 write는 apps/blueprint의 선언과 apps/invocations의 receipt로 판정하고 판정 근거가 없는 write는 목록에 "되돌릴 수 없음"으로 남는지 본다.
- 의도: lophn-agent#I7

**[R10]** checkpoint 이후 되돌리기 지원 앱 write가 성공했으면 저장한 invocation·receipt·현재 revision을 검증하여 앱의 선언된 revert command를 원래 호출 역순으로 직접 부르고, 문서 파일 복원보다 앞서 하며 실제 복원 결과를 rewind에 포함한다.
- 이유: 앱이 제공한 되돌리기를 쓰고, 외부 효과가 있어 실패할 수 있는 앱을 먼저 해서 실패해도 문서가 그대로 남아 사람이 판단하게 한다.
- 확인: 앱 write 두 번 뒤의 checkpoint로 되돌리면 receipt 두 개가 역순으로 한 번씩 호출되고 그 결과가 문서 복원 전에 나오며 문서 복원과 구별되는지 본다.
- 의도: lophn-agent#I7

**[R11]** 앱 revert와 문서 파일 복원은 하나의 transaction으로 보장하지 않으며 호출 중 실패·충돌·응답 유실이 생기면 실제 복원·미시작·불명확을 보존하고 전체 복원 완료나 전체 미실행으로 표시하지 않는다.
- 이유: 앱에 이미 전달된 효과를 문서 상태로 덮을 수 없다.
- 확인: 첫 앱 복원 성공 뒤 두 번째 실패·응답 유실을 넣고 첫 복원과 남은 변경·미적용 문서를 각각 확인한다.
- 의도: lophn-agent#I7

### checkpoint와 pre-image 기록

**[R12]** checkpoint는 run을 시작하는 사람 메시지마다 하나 만들고, 진행 중 수정(correction) 메시지는 자기 checkpoint가 없어 그 메시지로는 대화만 되돌린다.
- 이유: 파일 변경은 그 turn을 시작한 메시지 기준으로만 이어 붙일 수 있다.
- 확인: 새 일을 시작한 메시지에서는 세 선택지가 모두 보이고, 진행 중 보낸 수정 메시지에서는 문서 복원이 없고 "messages only"만 되는지 본다.
- 의도: lophn-agent#I7

**[R13]** 문서 tool은 문서 파일을 쓰기 직전에 그 파일의 이전 내용(pre-image)과 쓴 뒤 내용의 hash를 tool call마다 같은 session의 기록(RewindFile)에 남기고, 이름 변경은 옛 경로와 새 경로를 함께 남기며 같은 내용은 하나로 저장한다.
- 이유: agent가 파일을 바꾸는 길은 문서 tool 하나뿐이라(lophn-agent/harness/tools#R1) 쓰기 직전에 남기면 빠짐이 없고, 사람이 고쳤는지는 hash 하나로 가른다.
- 확인: 문서를 만들기·고치기·삭제·이름 바꾸기로 쓰면 각 tool call에 이전 내용(없었음 포함)과 쓴 뒤 hash가 남고 같은 내용은 한 번만 저장되는지 본다.
- 의도: lophn-agent#I7

**[R14]** pre-image는 최근 checkpoint 100개, 파일당 10 MB, session당 200 MB까지만 두고, 넘는 쓰기는 막지 않고 허용하되 그 checkpoint를 "파일 복원 불가"로 표시하며 총량이 넘으면 가장 오래된 checkpoint부터 같은 표시로 낮춘다.
- 이유: 저장 한도가 agent의 일을 조용히 막으면 안 되고, 복원이 안 되는 것은 사람이 미리 알아야 한다.
- 확인: 10 MB를 넘는 파일을 쓰면 쓰기는 성공하고 그 checkpoint에서 "Restore messages and documents"가 비활성이며 이유가 보이고, 101번째 checkpoint가 생기면 가장 오래된 것이 "파일 복원 불가"가 되는지 본다.
- 의도: lophn-agent#I7

### 선택지와 숨긴 메시지

**[R15]** rewind menu는 "Restore messages and documents"(대화와 문서·앱 data), "Restore messages only"(대화만), "Summarize from here"(그 뒤를 요약으로 접고 문서·앱은 그대로) 셋이며, 실행 중인 run이 있으면 먼저 멈춘 뒤에만 시작하고 되돌린 구간에서 기다리던 질문·approval은 취소한다.
- 이유: 대화와 파일을 따로 되돌릴 수 있게 하되 일하는 중에 바닥이 바뀌지 않게 한다.
- 확인: run 진행 중에는 menu가 먼저 멈추라고 안내하고, 셋 중 하나를 고르면 그 범위만 바뀌며, 기다리던 질문이 남지 않는지 본다.
- 의도: lophn-agent#I7

**[R16]** "Restore messages and documents"와 "Restore messages only"는 고른 메시지 뒤의 메시지를 지우지 않고 숨기며 고른 메시지의 원문을 입력창에 채우고, 다음 사람 메시지를 보내기 전까지만 redo로 되돌릴 수 있으며, 앱 write를 되돌린 rewind에는 redo가 없고 이를 미리 말한다.
- 이유: 되돌린 뒤 마음이 바뀌어도 아무것도 잃지 않게 하되, 이미 앱에 보낸 되돌림을 다시 되돌릴 수는 없다.
- 확인: rewind 뒤 숨긴 구간 표시와 redo가 보이고 redo가 대화와 문서를 되돌리기 전으로 돌리며, 새 메시지를 보내면 redo가 사라지고, 앱 write를 되돌린 rewind에는 redo가 없음이 menu에 미리 보이는지 본다.
- 의도: lophn-agent#I7

### 문서 파일 복원

**[R17]** 문서 파일은 지금 hash가 agent가 마지막으로 쓴 내용(`after`)과 같을 때만 복원하고, 사람이 그 뒤에 고친 파일·그 파일을 쓴 중간 기록이 끊긴 파일·pre-image가 없는 파일·symlink와 hard link는 건너뛰고 목록으로 알리며, 복원 쓰기는 사람이 시작한 동작으로 lophn이 쓰기 직전에 hash를 다시 비교하고 원자 교체로 그 파일을 쓴다(문서 판·파일 추적 없음).
- 이유: 사람이 고친 내용을 덮는 일이 가장 해롭고, 건너뛰어 목록으로 알리면 사람이 판단할 수 있다. 문서 판과 파일 추적은 없어졌으므로(사람 결정) 쓰기 직전 hash 재비교와 원자 교체만으로 사람의 변경을 덮지 않는다.
- 확인: agent가 쓴 파일을 사람이 고친 뒤 rewind하면 그 파일은 그대로이고 건너뜀 목록에 "Changes made outside this session are not restored." 아래 나오며, agent가 만든 새 파일을 사람이 고쳤으면 지우지 않는지 본다.
- 의도: lophn-agent#I7

**[R18]** receipt가 없어 되돌릴 수 없는 앱 write는 rewind 전에 "되돌릴 수 없음"과 이유로 미리 보이고, 앱이 선언한 revert command가 없는 write는 되돌렸다고 표시하지 않는다.
- 이유: 되돌릴 수 없는 것은 사람이 이미 한 번 승인한 것이라도 rewind 때 다시 분명히 말한다.
- 확인: revert command를 선언하지 않은 앱의 write가 낀 구간을 고르면 확인 화면 "남는 영향"에 그 write가 이유와 함께 나오고 결과에도 되돌려졌다고 쓰이지 않는지 본다.
- 의도: lophn-agent#I7

### 편집 카드 Undo

**[R19]** 편집 카드의 Undo는 tool call 하나가 쓴 문서 파일 하나를 같은 pre-image 기록으로 되돌리고, 그 파일의 지금 hash가 그 call이 쓴 내용과 같을 때만 눌리며 아니면 이유와 함께 비활성이다. 대화는 숨기지 않고 "Undid edit to <경로>"를 session에 사실로 남겨 agent의 다음 판단에 전한다.
- 이유: 한 건만 되돌리고 싶을 때 대화를 되돌리지 않아도 되고, agent가 파일 상태를 오해하지 않게 한다.
- 확인: 최신 편집의 Undo는 파일을 이전 내용으로 돌리고 대화는 그대로이며 session에 사실이 남고, 같은 파일의 더 최근 편집이 있으면 비활성 이유가 보이고, Undo한 call은 이후 rewind에서 이미 되돌려진 것으로 다뤄지는지 본다.
- 의도: lophn-agent#I7

### 수명

**[R20]** pre-image 기록은 session 저장소에 두어 앱을 껐다 켜도 이어지고, session을 delete하면 같은 transaction과 이어 정리로 기록과 저장된 내용을 모두 지우며(conversation#R20), 닫힌 session은 되돌릴 수 없으므로 닫을 때 지우고, archive는 남기며, Fork 복사본에는 옮기지 않는다.
- 이유: 되돌리기는 session이 살아 있는 동안의 약속이라 시간 기준으로 쌓아 두지 않고 session 수명에 묶는다.
- 확인: 재시작 뒤 같은 session에서 rewind가 되고, delete 뒤 기록·저장 내용이 남지 않으며, archive한 session에서는 그대로이고, Fork한 session에는 Rewind 기록이 없는지 본다.
- 의도: lophn-agent#I7

## 버린 것
- run 하나 단위 revert(끝난 run의 확정 변경 전체를 대상으로 하고 후속 변경이 있으면 아무것도 시작하지 않는 all-or-nothing): 단위를 session 안의 사람 메시지 checkpoint로 바꾸고, 문서 파일은 파일별로 건너뛰도록 R1·R4·R7을 고쳤다.
- 옛 R5 복원을 새 version으로 남기는 규칙과 documents/versions 이전 내용 계약: 문서 판(version)을 두지 않으므로 pre-image 기록(R13)과 hash 비교 복원(R17)으로 바꿨다.
- 문서·context·용어집·ticket·assignment/agent 정의·report·approval 등 영역별 owner 판정과 감사 event owner: 문서 판 이력과 run 단위 event 묶음에 기대던 구조였고, context·용어집은 이미 이 revert의 owner에서 뺐다. rewind는 문서 파일과 앱 data만 되돌리고 나머지 과거 사실(질문 답·승인·호출 결과·사용량·report·test result)은 지우지 않고 숨긴 구간에 남긴다(R8).
- 옛 binding_hash 체인과 run별 Commit 사본: preview와 적용 사이의 변화는 R3의 사전 설명과 적용 때의 재검사로 막는다.
- "documents만" 선택지(대화는 두고 문서만 복원): menu에 두지 않는다. 한 건만 되돌릴 때는 편집 카드 Undo(R19)를 쓴다.
- 사람이 건너뛴 파일을 "그래도 복원"으로 덮는 선택지: 두지 않는다.
- 옛 R9의 "문서는 documents/versions와 documents/addressing, 티켓은 coding-agent/tickets의 판정" 위임: 앱 대상만 남겼다(R9).
