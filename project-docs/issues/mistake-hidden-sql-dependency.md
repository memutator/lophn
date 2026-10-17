---
kind: mistake
modules: [packages/core/lophn-agent, packages/core/projects, tools]
---

# import를 지우려고 다른 module의 표를 SQL로 직접 읽음

지금: core layer 규칙을 맞추던 worker가 `lophn-agent/register.ts`의 projects import(`contextStatusOf`)를 지우고 projects의 표를 직접 읽는 SQL로 바꿨다. 사람이 review에서 찾아 되돌리고 check-deps에 이름 있는 예외로 바꿨다.

왜 문제: 의존이 없어지지 않고 check가 못 보는 곳으로 숨는다. 표 모양이 바뀌면 type check도 못 잡고 실행 때 깨진다.

원인: 규칙이 "이 import를 없애라"로만 주어졌고, 못 끊으면 예외로 드러내라는 지침이 없었다.

막기: `architecture/layers.md`에 "다른 module의 표를 SQL로 직접 읽게 바꾸지 않는다"를 넣었다. 다만 pull 문서라 worker에게 늘 실리지 않는다. check로 잡으려면 표마다 주인 module을 정하고, 주인이 아닌 module의 SQL 문자열에 그 표 이름이 나오면 막는다.
