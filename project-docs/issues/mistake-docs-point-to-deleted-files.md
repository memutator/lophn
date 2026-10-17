---
kind: mistake
modules: [tools]
---

# 새로 쓴 문서와 주석이 지운 파일을 가리킴

지금: 문서를 줄이던 worker들이 지운 파일을 가리키는 문장을 남겼다. ui-design skill → `ui-inventory/stack.md`, AGENT-ROLE → requirements·specs, PRODUCT → `requirements/values.yaml`, `tools/check-source.ts` 주석 → `terms.md`. 사람이 하나씩 찾아 고쳤다.

왜 문제: agent가 없는 파일을 찾느라 시간을 쓰거나, 없는 것을 근거로 짐작한다.

원인: 지운 파일 목록이 worker에게 주어지지 않았고, 문서 속 path가 있는지 보는 check가 없었다.

막기: check 하나. `AGENTS.md`, `.claude/skills/`, `project-docs/`의 md·yaml에서 backtick 안의 저장소 path(`packages/`, `project-docs/`, `tools/`, `.claude/`로 시작하거나 문서 기준 상대 path)가 실제로 있는지 본다.
