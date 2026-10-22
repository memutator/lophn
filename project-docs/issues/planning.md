# planning

계획을 열고 brief를 쓰고 lead에게 넘기는 흐름(planner skill, orchestrate skill, `project-docs/plan/tools/`)의 열린 이슈다.

## merge.sh를 rebase 뒤 끊겼다가 다시 돌리면 plan branch의 commit을 다시 올리다 충돌한다

```yaml
kind: bug
modules: [project-docs/plan/tools]
```

- 지금: `project-docs/plan/tools/lead/merge.sh`는 task worktree를 `rebase --onto $BASE $FROM`으로 옮긴다. `FROM`은 launch 때 적은 `branch.<branch>.lophnBase`다. rebase가 끝난 뒤 check:full 도중 session이 끊기면, 다시 돌릴 때 `FROM`이 여전히 launch 때 점이다. 그 사이 rebase로 task branch에 들어온 plan branch commit까지 다시 옮기려다 `status.md`에서 `STOP: rebase conflict`가 났다(`workflow-shell`의 `ws-desk-wireframe`, 2026-10-22).
- 영향: lead가 rebase를 abort하고 `lophnBase`를 손으로 고쳐야 한다. 모르고 충돌을 풀면 plan branch commit이 task commit으로 두 번 올라간다.
- 고치려면: rebase가 성공한 바로 뒤에 `git config branch.$B.lophnBase $(git rev-parse $BASE)`를 적는다(한 줄). 추천.
