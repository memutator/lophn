# shell

데스크톱 앱(packages/shell)의 화면과 그 source. architecture 문서는 아직 없다.

## 데스크톱이 CLI의 `--json` 결과를 `data` 칸에서 찾아 harness 감지가 늘 실패한다

```yaml
kind: bug
modules: [packages/shell/main, packages/coding-agent]
```

지금:
- `packages/shell/main/desktop/coding-connection.ts`의 `childCliRunner`는 `lophn ... --json`의 stdout을 `{ data?, error? }`로 읽고 성공이면 `body.data`를 돌려준다.
- CLI는 성공하면 data를 감싸지 않고 `JSON.stringify(data)` 한 줄을 쓴다(`packages/coding-agent/cli/output.ts`의 `result`). 실패만 `{ error }`로 감싼다.
- 그래서 성공한 `harness detect`의 결과가 늘 `undefined`이고, `run`은 "Detection gave an unknown result."로 모든 harness를 unknown으로 둔다. `harness install`의 결과도 같은 길로 읽는다.

영향: 데스크톱 앱에서 coding agent 감지와 hook·skill 설치가 결과를 읽지 못한다. 감지된 harness가 없으면 App Engineer가 ticket을 coding agent에게 맡기지 못한다.

고치려면: `childCliRunner`가 성공 출력을 그대로 data로 받는다(`body?.error`가 없으면 `body` 전체가 data)(작음). 이 runner에 CLI 출력 꼴 하나로 test를 둔다. 추천.

## app panel이나 browser 탭 page에 focus가 있으면 작업대 단축키(Ctrl+W, Ctrl+Tab)가 듣지 않는다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/ipc]
```

지금: native view(app panel의 앱 view, browser 탭의 view)의 키는 `packages/shell/main/desktop/wiring/desktop.ts`의 `web-contents-created`가 건 `listenShortcuts`(`packages/shell/main/desktop/shortcuts.ts`)만 본다. 이 함수의 `windowShortcut`은 palette·launcher chord(`WINDOW_SHORTCUTS`)와 작업대 단축키 표(`packages/shell/ipc/keybindings.ts`)에서 `main`이 적힌 것만 본다. 그 표에서 `main`이 적힌 것은 `tab.close`의 macOS `Cmd+KeyW` 하나다. 그래서 page에 focus가 있으면 Linux·Windows의 `Ctrl+W`·`Ctrl+F4`(`tab.close`), `Ctrl+Tab`·`Ctrl+Shift+Tab`(`tab.next`·`tab.prev`), `Ctrl+Shift+T`(`tab.reopen`) 같은 renderer 몫 단축키가 page로 가고 shell renderer에 오지 않는다.

영향: app panel이나 browser 탭을 보다가 키보드로 탭을 닫거나 넘기지 못한다. 먼저 탭 줄을 눌러 focus를 shell로 옮겨야 한다. browser 탭이 생기면서 page에 focus가 오래 머무는 일이 많아진다.

고치려면:
- (추천, 작음) 작업대 단축키 표의 탭 이동·닫기·다시 열기 줄에 `main`을 모든 OS로 넓힌다. `listenShortcuts`가 그 키를 삼키고 shell renderer로 보낸다. page가 그 키를 못 받게 되는 것을 잃는다(Chrome과 같다).
- (중간) native view의 키를 모두 shell renderer에 보내 renderer의 matcher가 고르게 한다. 키마다 IPC가 생기고 page가 받을 키를 renderer가 다시 돌려줘야 한다.
