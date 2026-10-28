---
name: wrap-plan
description: lophn에서 계획 하나(project-docs/plan/<계획>/)가 main에 land된 뒤 planner가 쓴다. 계획이 제대로 끝났는지 확인하고, 바뀐 코드에 맞춰 context(architecture 문서, skill, catalog, registry, AGENTS.md)를 고치고, 이슈를 정리하고, 다음 계획으로 넘길 때. lead가 "계획을 닫았다"고 할 때나 사람이 "계획 끝났다"고 할 때.
---

# 계획 마무리

planner의 본업은 plan → implement → changelog → **context 유지보수**의 마지막 고리다. lead는 자기 계획이 바꾼 문서를 고치지만, 그 밖에서 같은 boundary에 기대는 조각은 planner가 찾아 고친다.

## 1. 끝났는지 확인

- main에 그 계획의 commit이 있다(`git log --oneline main`). `npm run check`가 통과한다.
- 계획 폴더(`project-docs/plan/<계획>/`), 계획이 지우기로 한 roadmap 파일, lead worktree(`git worktree list`), branch `plan/<계획>`(`git branch --list 'plan/*'`)이 없다. 남았으면 lead에게 알리거나 사람에게 묻고 지운다(지우기 전에 merge됐는지 본다).
- changelog 열린 판(`project-docs/products/change-log/<판>.md`)의 그 계획 항목을 읽는다. `modules`가 실제 diff와 맞는지 2의 script로 본다. 결정 중 `(agent)`가 붙은 것을 모아 사람에게 보인다. 사람이 정하지 않고 넘어간 결정이다.

## 2. context 유지보수

1. 다시 볼 조각을 뽑는다.
   ```
   node tools/context-review.ts --range <계획 첫 commit의 부모>..main
   ```
   바뀐 file → module-catalog → boundary → registry의 `change_reasons`로 걸린 조각을 낸다. "같은 변경에서 고친 조각"은 lead가 이미 고친 것이다. "다시 볼 조각"이 planner의 목록이다.
2. 목록의 조각을 하나씩 열어 지금 코드와 대조한다. 문서가 말하는 file, 함수, 흐름, 규칙이 그대로인지 본다. 다르면 고친다. 고칠 것이 없으면 changelog 항목의 `checked`에 그 ID를 더한다(append-only라 항목을 새로 덧붙이지 않고, 아직 열린 판의 그 항목 칸만 채운다. 판이 닫혔으면 새 항목으로).
3. script가 못 보는 것을 본다.
   - 새로 생긴 boundary, module, 문서가 catalog와 registry에 올라갔나(`tools/check-modules.ts`가 module 폴더는 잡는다. registry는 잡지 않는다).
   - 지운 file을 가리키는 문장이 남았나: `grep -rn "<지운 path나 이름>" AGENTS.md .claude project-docs`.
   - PRODUCT.md와 products/AGENT.md처럼 코드로 걸지 않은 제품 문서가 계획의 결정과 어긋나지 않나.
4. registry 자체를 맞춘다: 새 조각 더하기, 지운 조각 빼기, path와 `change_reasons` 고치기.

## 3. 이슈와 배운 것

- 그 계획이 올린 이슈를 `issue` skill의 "올릴지"로 다시 거른다. 확인 못 한 메모, 사실 설명, 손해가 구체적이지 않은 무게는 지우거나 kept로 닫는다.
- 고쳐진 이슈가 archived로 갔는지 본다.
- 계획이 남긴 다음 일감(예외 목록, follow-up)이 이슈나 roadmap 하나로 올라갔는지 본다.
- lead 보고와 이슈의 mistake에서 worker가 되풀이한 실수와 lead가 겪은 함정을 찾는다. 그것이 실릴 곳을 고친다: orchestrate skill의 "겪은 함정", `worker-prompt`(`project-docs/plan/tools/lead/prompt.py`), brief-template, AGENTS.md. 같은 mistake가 두 번째면 check로 막는다.

## 4. 다음으로

- 미뤄 둔 이슈 가운데 이제 할 것(예: 계획 때문에 미룬 bug)을 다시 코드와 대조하고 다음 계획으로 묶는다. 계획을 여는 것은 `project-docs/plan/README.md`의 꼴대로다.
- roadmap(`project-docs/products/roadmap/`)에 남은 큰 일을 고친다.
- 열린 판에 들어간 계획이 다 끝났으면 판을 닫고 tag를 달지 사람에게 제안한다. 닫는 때는 사람이 정한다(`project-docs/products/change-log/_template.md`).

## 사람에게

결과는 채팅으로 짧게 보고한다: 끝났는지, 고친 조각과 `checked`, `(agent)` 결정 목록, 이슈 변화, 다음 계획 제안. 사람이 고를 것은 제품 동작, 비용, 되돌리기 비싼 것만 묻는다.
