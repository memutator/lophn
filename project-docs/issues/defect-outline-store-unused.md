---
kind: defect
modules: [packages/core/projects]
---

# 저장 목차와 outline kind가 아직 쓰이지 않는다

지금: 저장 목차(`outlines/<sha256(path)>.json`, revision으로 낙관적 잠금)와 outline kind를 둔다. md 아닌 문서의 목차를 사람이 적는 길인데 아직 worker에 닿지 않아 쓰이지 않는다.

왜 문제: 쓰이지 않는 장치다.

고치려면: 저장 목차 전체를 빼고 md 목차만.
