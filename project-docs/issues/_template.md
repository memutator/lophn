<!--
열린 이슈 하나에 파일 하나: <kind>-<영어-kebab-slug>.md. 이 template를 복사해 쓴다.
여기 있는 파일이 지금 열린 이슈 전부다.

kind
- bug: 동작이 틀리거나 아직 안 된다.
- defect: 동작은 맞는데 코드에 결함이 있다(숨은 의존, 중복, 죽은 장치, 가장 단순한 구현보다 무거움).
- mistake: worker가 크게 잘못했다. 코드가 아니라 context(AGENTS.md, skill, architecture 문서)나 check를 고친다.

닫기
- 고치면 같은 변경에서 파일을 지우고 changelog 항목에 남긴다.
- 고치지 않고 남기기로 하면 이유를 그 코드의 주석으로 옮기고 파일을 지운다. 결정은 changelog에 남긴다.

frontmatter
- kind: 위 셋 중 하나. 파일 이름의 앞과 같다
- modules: 걸린 module-catalog path. mistake는 고칠 context나 check의 module(tools 등)도 적는다
- 찾은 날은 git log로 본다
-->
---
kind: bug
modules: [packages/core/apps]
---

# <한 줄>

지금: 무엇이 어떻게 되나. 재현이나 위치(파일, 함수).

왜 문제: 누가 무엇을 잃나. defect면 이대로 두면 무엇이 비싸지나.

고치려면: 추천안. 다른 안이 있으면 한 줄.

<!-- mistake만 -->
원인: 지침이 없었나, 틀렸나, context에 안 실렸나.

막기: check로 잡을 수 있으면 check. 못 하면 바꿀 AGENTS.md, skill, 문서 문장.
