---
type: flow
concerns: [lophn-agent/extensions, lophn-agent/agents, lophn-agent/assignments, lophn-agent/harness/tools, lophn-agent/harness/tool-judgment, platform/settings, platform/identity, platform/secrets, platform/approvals, shell/confirmation-window]
---
# agent가 쓸 skill과 MCP를 고른다

사람이 네 역할의 preset에 skill이나 외부 MCP를 추가하려 할 때 시작한다. 확장 발견·인증·선택·실제 사용은 서로 다른 단계다.

## 흐름

1. 사람은 준비한 로컬 skill 폴더를 등록한다. lophn은 정한 폴더와 바로 아래 꾸러미만 검사하고 형식·이름·중복·출처를 구별한다. 검색 과정은 사람에게는 보이지 않는다. 원격 검색·자동 다운로드는 하지 않는다. (lophn-agent/extensions#R1, lophn-agent/extensions#R2, lophn-agent/extensions#R3, lophn-agent/extensions#R10)
2. 외부 MCP를 쓰려면 사람은 server 이름·stdio 또는 Streamable HTTP·enabled·정확한 실행/목적지와 인증 방식을 정한다. 원문 credential은 보호 입력과 keychain에서만 처리한다. skill이나 응답에서 설정을 수입하지 않는다. (lophn-agent/extensions#R11, lophn-agent/extensions#R12, lophn-agent/extensions#R13, platform/secrets#R11)
3. 사람은 lophn·App Engineer·Context Engineer·Operator의 기본 preset 개인화·복사·새 preset에서 쓸 정확한 skill 이름·MCP server와 현재 개별 tool을 고른다. read/write/external 분류와 금지·상한은 현재 product 규칙으로 검사한다. (lophn-agent/presets#R1, lophn-agent/presets#R7, lophn-agent/presets#R8, lophn-agent/presets#R9, lophn-agent/extensions#R4, lophn-agent/extensions#R27)
4. lophn은 유효 확장·정확한 tool·역할 상한을 확인하고 preset 전체 새 판을 저장한다. Operator에 붙이는 변경은 project/app·출력·주기를 포함한 보호된 승인으로 적용하며 다른 역할도 명시 적용한 판만 다음 run에서 쓴다. 안쪽 검사는 사람에게는 보이지 않는다. (lophn-agent/presets#R11, lophn-agent/presets#R12, lophn-agent/presets#R14, lophn-agent/assignments#R5)
5. 다음 run은 고정된 skill 이름·설명과 개별 tool을 사용하고 skill 본문은 선택한 때만 읽는다. 실제 호출은 현재 scope·approval·제품 금지를 다시 검사한다. 사람은 결과·필요한 다음 행동만 본다. (lophn-agent/extensions#R5, lophn-agent/extensions#R6, lophn-agent/extensions#R8, lophn-agent/presets#R8)

## 다른 갈래

- skill 본문·보조 자료·MCP server 응답은 tool 추가·권한·사람 결정의 근거가 아니다. 밖 symlink·실행 파일은 읽기/실행 허락으로 승격하지 않는다. (lophn-agent/extensions#R7, lophn-agent/extensions#R9, lophn-agent/presets#R8)
- 선택 skill 누락·변경·server 연결 실패는 알려 주고 다른 skill/tool로 조용히 대신하지 않는다. 기존 판의 미래 tool이 자동으로 늘지도 않는다. (lophn-agent/extensions#R4, lophn-agent/extensions#R8, lophn-agent/presets#R7)
- 인증 실패·keychain 잠김은 원문 파일 fallback 없이 해당 연결을 못 쓰는 상태로 남긴다. secret은 model에 보내지 않는다. (platform/secrets#R8, platform/secrets#R11)

## 끝

사람은 어떤 preset이 어떤 skill/MCP를 쓰는지와 현재 실패·필요한 행동을 안다. 확장을 넣어도 제품 금지·읽기 상한·approval은 넓어지지 않는다. (lophn-agent/presets#R8)
