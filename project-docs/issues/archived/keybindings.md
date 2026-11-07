# keybindings (닫음)

## 겹친 번호 줄의 Remove가 겹친 번호 하나가 아니라 모든 번호의 키를 뺀다

```yaml
kind: bug
modules: [packages/shell/renderer]
closed: fixed
guard: `packages/shell/renderer/desktop/settings/keyboard/model_test.ts` "번호 줄의 Remove는 겹친 번호의 id만 비운다"
```

지금: Settings › Keyboard에서 겹친 줄에 Remove 단추가 붙는다(`packages/shell/renderer/desktop/settings/keyboard/keyboard-panel.tsx`의 `keyLine`, `clearKeys`). 번호 줄(`tab.nth`, `pane.focus`, `desk.nth`)이면 `numberedKeys(row.ids, row.numbers, null)`로 그 줄 모든 번호의 키를 뺀다. 예: 사람이 `Alt+Digit3`을 다른 일에 달아 "Go to tab N"의 3번과 겹치면, 그 줄의 Remove가 탭 1~9·0의 키를 모두 뺀다.

영향: 사람이 겹침 하나를 풀려다 탭 번호 키 열 개를 잃는다. Reset to default로 되돌릴 수 있어 data는 잃지 않는다.

고치려면:
- 번호 줄의 Remove는 겹친 chord를 가진 번호의 id만 빈 목록으로 한다(`findConflicts`의 `ids` 가운데 그 줄의 id). 작음, `keyLine` 한 곳. 그 뒤 줄의 modifier가 번호마다 달라져 줄이 "번호마다 다름"으로 보인다(`modifier: null`, 이미 있는 모양).
- 번호 줄에는 Remove를 두지 않고 다른 쪽 줄만 고치게 한다. 작음, 번호 줄끼리 겹치면 풀 길이 Reset뿐이다.
- 추천: 앞의 것.

닫음: 번호 줄의 Remove는 `conflictClearKeys`(model.ts)로 `findConflicts`의 `ids`에 든 번호만 빈 목록으로 한다. 다른 번호의 키는 남고 줄은 "번호마다 다름"으로 보인다. key 칸의 Backspace는 그대로 모든 번호를 비운다.
