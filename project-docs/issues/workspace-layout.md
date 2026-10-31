# workspace-layout

place 창의 탭 자리(tabs, group, floated, detached)와 layout 저장. architecture: `project-docs/architecture/workspace-layout.md`.

## workflow 폴더 이름을 바꾸면 그 desk가 Main으로 합쳐진다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

- 지금: desk key가 workflow 이름이다. `packages/shell/renderer/workspace/place-window.tsx`의 `mergeVanished`가 workflow 목록을 읽을 때마다 목록에 없는 desk를 `mergeDeskIntoDefault`로 Main에 합친다. 이름을 바꾼 workflow는 옛 이름이 목록에서 사라져 합쳐지고, 새 이름은 빈 새 desk가 된다.
- 영향: 그 workflow desk에 늘어놓은 탭 배치(group, floated, detached)가 Main에 섞인다. 탭은 잃지 않는다.
- 고치려면: (중간) desk key로 쓸 바뀌지 않는 workflow id가 있어야 한다. 지금 workflow는 폴더 이름(`name`)으로만 가리킨다(`packages/shell/renderer/workspace/source.ts`의 `WorkflowEntryView`. `key`도 `<project 이름>/<name>`이다). 추천: 이름 바꾸기가 실제로 잦아질 때 한다.
