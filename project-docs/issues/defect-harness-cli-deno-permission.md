---
kind: defect
modules: [packages/coding-agent]
---

# `harness install`·`refresh`의 Deno 권한을 입력 경로 하나로 좁힌다

지금: launcher가 같은 argv를 launch-entry에 주고, 절대 경로이고 `..`·쉼표·개행이 없을 때만 `--allow-read/write`를 더한다. `refresh`는 감지한 실행 파일에만 `--allow-run`. 이유: coding agent가 부르는 CLI라 권한 경계. install engine이 아직 없어 지금은 `unavailable`이다.

왜 문제: 가장 단순한 구현보다 무겁다.

고치려면: 추천: 경계라 남긴다. 이유를 코드 주석으로 옮기고 이 파일을 지운다.
