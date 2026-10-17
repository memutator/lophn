---
kind: defect
modules: [packages/core/lophn-agent]
---

# `SeenBasis`와 turn 사이 diff notice

지금: 지침 층별 hash, tool 이름 목록, context `{name, version, glossary hash}`, agent 목록을 turn마다 남기고, 바뀌면 Added/Removed notice와 새 전문을 붙인다. `prompt-assembly/{basis,turn-prompt}.ts`. 이유: spec이 "바뀐 것만 알린다"를 요구한다.

왜 문제: 가장 단순한 구현보다 무겁다.

고치려면: 바뀌면 place 블록 전체를 다시 싣고 diff는 없앤다.
