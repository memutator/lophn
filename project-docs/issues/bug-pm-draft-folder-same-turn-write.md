---
kind: bug
modules: [packages/core/lophn-agent, packages/core/projects]
---

# PM이 초안 폴더를 연 같은 turn에 쓰면 forbidden이다

지금: `context.draft`로 연 폴더가 그 turn의 file 범위에 아직 없어 `file.write`가 forbidden이다. 다음 turn부터 된다.

왜 문제: PM이 폴더를 열고 바로 쓰지 못한다.

고치려면: 폴더를 연 turn의 file 범위에 바로 더한다.
