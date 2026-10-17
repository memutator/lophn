---
kind: defect
modules: [packages/core/projects]
---

# 위반 키 집합 비교용 새 표 `context_violation_keys`

지금: context마다 JSON 한 행. 이전에 없던 키 `[kind, rule, path, section]`가 생길 때만 `ContextViolationFound`를 낸다. `core/projects/contexts/ledger/rows-violations.ts`, `api/commands-violations.ts`. 이유: 같은 위반으로 PM을 반복해서 깨우지 않는다(spec).

왜 문제: 새 표가 하나 늘었다.

고치려면: 위반 수가 늘 때만 event를 낸다(새 표 없이 `violation_mark` 열 하나).
