# ui-kit

`packages/design`의 kit component(앱 화면, 세션 시각 블록, artifact가 쓰는 것). `project-docs/architecture/ui-kit.md`.

## GraphDiagram에서 층 둘 이상을 되돌아가는 edge가 사이 node 뒤로 지나간다

```yaml
kind: bug
modules: [packages/design]
```

지금: `packages/design/components/data/chart/graph-layout.ts`의 `layoutGraph`가 되돌아가는 edge(`to.layer <= from.layer`)를 출발 node의 왼쪽 면 가운데에서 도착 node의 오른쪽 면 가운데로 잇는 수평 bezier(`link`) 하나로 그린다. 두 node 사이에 층이 있으면 그 층의 node를 피하지 않고 그 뒤를 지난다. gallery `tools/wireframes/pages/kit/data/page.tsx`의 GraphDiagram `status` 줄(`report → spec`)이 그 모양이다.

영향: workflow artifact가 이 component로 step을 그린다(PM skill `packages/core/agent-roles/skills/guide-workflows/SKILL.md`의 예가 `next`마다 edge를 낸다). eval loop처럼 끝 step이 첫 step으로 돌아가는 workflow(`report → spec`)에서 사람은 그 edge가 사이 step(`run`)으로 가는지 첫 step으로 가는지 화면으로 가르지 못한다.

고치려면:
- 되돌아가는 edge를 node 줄 위(또는 아래)로 돌려 그린다. 출발 node 위쪽에서 나가 도표 위 여백을 지나 도착 node 위쪽으로 들어간다(작음). 도표 높이에 여백 한 줄이 늘고 edge label 자리를 다시 정한다. 추천.
- 층 배치에서 되돌아가는 edge가 지나는 층에 빈 자리를 두어 그 높이로 지나게 한다(중간). layout 규칙이 늘고 node 위치가 바뀐다.
