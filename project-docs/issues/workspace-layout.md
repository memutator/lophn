# workspace-layout

workspace 창의 탭 자리(tabs, group, floated, detached)와 layout 저장. architecture: `project-docs/architecture/workspace-layout.md`.

## workflow 폴더 이름을 바꾸면 그 desk가 Main으로 합쳐진다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

- 지금: desk key가 workflow 이름이다. `packages/shell/renderer/workspace/workspace-window.tsx`의 `mergeVanished`가 workflow 목록을 읽을 때마다 목록에 없는 desk를 `mergeDeskIntoDefault`로 Main에 합친다. 이름을 바꾼 workflow는 옛 이름이 목록에서 사라져 합쳐지고, 새 이름은 빈 새 desk가 된다.
- 영향: 그 workflow desk에 늘어놓은 탭 배치(group, floated, detached)가 Main에 섞인다. 탭은 잃지 않는다.
- 고치려면: (중간) desk key로 쓸 바뀌지 않는 workflow id가 있어야 한다. 지금 workflow는 폴더 이름(`name`)으로만 가리킨다(`packages/shell/renderer/workspace/source.ts`의 `WorkflowEntryView`. `key`도 `<project 이름>/<name>`이다). 추천: 이름 바꾸기가 실제로 잦아질 때 한다.

## layout을 읽지 못하면 기본 layout이 저장된 파일을 덮는다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/shell/main]
```

- 지금: `WorkspaceWindow`의 `load`(`packages/shell/renderer/workspace/workspace-window.tsx`)는 `readWorkspaceLayout`이 실패했거나 `layout: null`(없음, 손상, 다른 판 `unsupported_schema`)이면 `freshLayout()`을 쓴다. 그 값은 `latestLayout`에만 들어가고 읽자마자 저장하지는 않지만, 그 뒤 사람이 탭을 열거나 옮기는 첫 `commit`이 `persist`로 전체를 쓴다(`saveWorkspaceLayout` → main의 `writeFileAtomic`). main의 읽기는 다른 판이면 "파일은 그대로 둔다"(`workspace-layout.md` 읽는 순서, `parseWorkspaceLayoutFile`)고 하는데 renderer가 그 약속을 이어 가지 않는다. 읽기가 `unreadable`(권한, 일시 오류)로 실패해도 같다.
- 영향: 새 판에서 쓴 layout을 옛 빌드로 열었다가(dev branch 전환 포함) 탭 하나를 열면, 새 판 layout 전체(desk, group, floated, 탭 배치)가 Main 하나짜리 기본 layout으로 덮인다. 다시 새 판으로 와도 못 돌린다. 일시적 읽기 실패 뒤 첫 조작도 같다. 탭 안의 파일·session 자체는 남는다.
- 고치려면:
  - 읽기가 `ok: false`이거나 `unsupported_schema`·`corrupt`면 renderer가 그 workspace의 저장을 끈다(작음: `load`가 `saveBlocked` ref를 두고 `persist`가 건너뛴다. 사람에게 한 번 toast로 알린다).
  - main의 write가 기존 파일이 읽히지 않는 판이면 거절한다(중간, 읽기와 쓰기 규칙을 main 한 곳에 둔다).
- 추천: 앞의 것. 손상(`corrupt`)은 사람이 잃을 게 없는 쪽이라 덮어도 되지만, 그 경우도 옛 파일을 `.bak`으로 한 번 옮겨 두면 값이 싸다.

## layout 저장이 거절돼도 화면은 그대로이고 사람은 모른다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

- 지금: `workspace-window.tsx`의 `persist`는 `void source.layout.saveWorkspaceLayout(...)`로 결과를 버린다. `saveWorkspaceLayout`(`packages/shell/renderer/shell/layout-source.ts`)은 main의 거절(`invalid_input`, `unwritable`)과 bridge 없음을 모두 `{ ok: false }`로 돌려주지만 부르는 쪽 중 `persist`는 보지 않고, 재시도도 없다. 전역 float의 `flush`(`renderer/shell/global-floats/store.ts`)도 `save(...).catch(() => {})`이고 `{ ok: false }` 응답은 그냥 지나간다(`dirty`가 이미 false라 다음 변화가 있어야 다시 쓴다).
- 영향: 디스크가 가득 차거나 파일을 못 쓰면, 사람이 밤새 늘어놓은 탭 배치가 화면에서는 멀쩡해 보이다가 재시작하면 옛 배치로 돌아간다. 알림이 없다.
- 고치려면: 첫 실패에서 toast 하나를 띄우고 `dirty`를 유지해 다음 변화나 기한에 다시 쓴다(작음). 추천: 이것.
