---
type: flow
concerns: [lophn-agent/instructions, lophn-agent/agents, lophn-agent/conversation, documents/file-tracking, documents/versions, shell/editor]
---
# agent가 읽을 지침을 쓰고 고친다

사람이 lophn agent의 말·판단에 적용할 지침을 쓰거나 고치려 할 때 시작한다. coding agent의 AGENTS.md와 lophn 전용 LOPHN.md는 별개다.

## 흐름

1. 사람은 전역·project·app의 [Instructions]를 고른다. lophn은 해당 exact 파일을 편집기로 열고 없으면 빈 편집 초안만 보여 준다. 파일·안쪽 version ID는 기본 화면에서 숨긴다. (lophn-agent/instructions#R1, lophn-agent/instructions#R2, shell/editor#R17)
2. 사람은 Markdown을 쓰고 저장한다. lophn은 원본 존재/hash·document base version을 검사해 파일 작업하고 안정된 바이트를 새 Version으로 확정한다. 전역 지침 단일 파일 등록이 data root 전체 추적을 열지는 않는다. 처리 과정은 사람에게는 보이지 않는다. (documents/file-tracking#R19, documents/file-tracking#R20, documents/versions#R19)
3. 사람은 저장 결과·충돌을 보고 필요하면 과거 판을 비교·복원한다. 복원도 현재 원본을 검사한 새 판이며 외부 편집을 조용히 덮지 않는다. agent가 제안한 글은 사람이 선택·편집·저장하기 전 적용되지 않는다. (shell/editor#R17, documents/versions#R19, documents/versions#R20, lophn-agent/instructions#R3)
4. lophn은 각 call 직전 현재 작업 자리의 전역→project→app→preset 연결 순서로 확정 판을 다시 읽는다. Preset 첨부 변경은 구성 새 판이고 파일 내용 변경은 진행 run의 다음 call부터 읽는다. snapshot 조립은 사람에게는 보이지 않는다. (lophn-agent/instructions#R4, lophn-agent/instructions#R5, lophn-agent/instructions#R8)

## 다른 갈래

- App Engineer는 담당 app, Operator는 붙은 project/app이 작업 자리다. lophn·Context Engineer는 세션을 연 곳을 유지하며 보는 탭 전환은 작업 자리 변경이 아니다. (lophn-agent/instructions#R4)
- 파일당 32 KiB·call 전체 128 KiB를 넘거나 인코딩/읽기 오류가 있으면 그 call을 차단해 고칠 행동을 알린다. 부재와 읽기 실패를 섞거나 잘라 보내지 않는다. (lophn-agent/instructions#R7)
- 지침은 제품 금지·scope·approval·읽기 상한을 넓히지 않는다. 지침 문서를 다른 출력으로 선택해도 agent의 직접 저장·source 변경은 거절한다. (lophn-agent/instructions#R6, documents/versions#R20)
- 등록 경로 밖 symlink·실제 외부 수정 충돌은 실패로 남기고 새 파일·옛 판으로 자동 대체하지 않는다. (documents/file-tracking#R19, documents/file-tracking#R20)

## 끝

사람은 파일 저장·version 확정 여부와 다음 call이 읽을 현재 지침을 안다. 지침과 Preset을 바꿔도 별도 권한·사람 결정의 경계는 그대로다. (lophn-agent/instructions#R6, lophn-agent/instructions#R8)
