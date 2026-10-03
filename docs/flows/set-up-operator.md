---
type: flow
concerns: [lophn-agent/roles/context-engineer, lophn-agent/roles/operator, lophn-agent/presets, lophn-agent/instructions, lophn-agent/assignments, lophn-agent/scheduling, lophn-agent/questions, documents/contexts, documents/versions, apps/permissions, platform/approvals, shell/confirmation-window]
---
# 반복해서 맡길 일을 구성한다

사람이 project나 app에서 반복할 판단을 맡기려 할 때 시작한다. Operator는 원하는 만큼 만들며 읽을 context와 일을 맡긴 project/app은 별개다.

## 흐름

1. 사람은 project 또는 app을 고르고 원하는 판단·기대 결과를 말한다. Context Engineer는 기존 자료·출력 문서와 필요한 읽기 범위를 보고 반복할 책임 초안을 제안한다. 안쪽 검토는 사람에게는 보이지 않는다. (lophn-agent/assignments#R2, lophn-agent/presets#R15, documents/contexts#R15)
2. 사람은 Operator 기본 preset을 고치거나 복사·새 preset으로 prompt·context·capability·MCP·skill·provider 계정·model·붙일 지침을 구성한다. agent의 초안은 제안이며 자기 권한을 적용하지 못한다. (lophn-agent/presets#R1, lophn-agent/presets#R9, lophn-agent/presets#R10, lophn-agent/presets#R11)
3. 사람은 project/app 범위·고정 preset 판·반복 판단과 책임 밖·실제 남길 기존 문서 최소 1개·주기·승인된 app read 명령을 확인한다. 출력 문서가 없으면 사람의 선택으로 첫 실제 판을 마련하되 빈 예약을 결과로 표시하지 않는다. (lophn-agent/assignments#R4, lophn-agent/assignments#R5, lophn-agent/assignments#R6, lophn-agent/assignments#R8)
4. 사람은 보호 화면에서 검토한 정확한 전체 구성과 범위를 승인한다. lophn은 preset·문서·app read·현재 revision을 다시 검사하고 한 번에 적용한다. 처리 과정은 사람에게는 보이지 않는다. (lophn-agent/assignments#R4, lophn-agent/assignments#R5, lophn-agent/presets#R11, platform/approvals#R5, shell/confirmation-window#R5)
5. lophn은 정한 주기로 새 run을 접수하고 고정 preset 판·담당 project/app·call별 현재 지침으로 판단하여 지정 기존 문서에 새 version만 쓴다. 자료 watch만으로 run을 만들지 않는다. 사람에게는 보이지 않는다. (lophn-agent/presets#R14, lophn-agent/instructions#R4, lophn-agent/instructions#R8, lophn-agent/scheduling#R1, lophn-agent/assignments#R6)

## 다른 갈래

- 같은 project/app의 다른 Operator는 허용하지만 같은 남길 문서는 거두지 않은 하나만 소유한다. 멈춤도 독점을 유지하고 사람 편집은 CAS로 충돌을 검사한다. (lophn-agent/assignments#R2, lophn-agent/assignments#R8)
- 원본 연결·보관 문서·지침 문서·없는 첫 판·series 동적 이름은 출력으로 허용하지 않는다. 지침은 [Instructions]에서 사람만 고친다. (lophn-agent/assignments#R6, documents/versions#R20, shell/editor#R17)
- 범위·preset·주기·자료·출력이 검토 뒤 바뀌면 이전 approval을 쓰지 않는다. 취소·충돌은 기존 구성을 유지한다. (lophn-agent/assignments#R5, lophn-agent/presets#R12, platform/approvals#R11)

## 끝

사람은 project/app에 무엇을 반복해서 맡겼고 언제·어디에 결과가 남는지 안다. Preset·자료·출력의 세부는 필요할 때 펼치고 run의 실제 진행은 맡긴 책임과 구별한다. (lophn-agent/assignments#R3)
