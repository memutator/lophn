---
kind: defect
modules: [packages/core/lophn-agent]
---

# file tool 상한이 많다

지금: read 300줄·24 KiB·10 MiB, pdf 20쪽·쪽당 6000자, 이미지 5 MiB, glob 200개, grep 100줄·줄당 300자. 각각 이어 읽기 안내 문구가 있다. 이유: model 문맥을 지킨다. spec이 상한을 요구한다.

왜 문제: 상한과 안내 문구가 많다.

고치려면: 바이트 상한 하나와 안내 문구 하나로.
