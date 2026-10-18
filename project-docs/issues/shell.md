# shell

데스크톱 앱(packages/shell)의 화면과 그 source. architecture 문서는 아직 없다.

## app panel이나 browser 탭 page에 focus가 있으면 작업대 단축키가 듣지 않는다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/ipc]
```

지금: 두 갈래다.
- browser 탭(`<webview>` guest): `packages/shell/main/desktop/wiring/desktop.ts`의 `web-contents-created`가 키를 보낼 창을 `window.webContents`와 `contentView`의 `WebContentsView` 자식에서만 찾는다. guest는 둘 다 아니라서 창을 못 찾고 `listenShortcuts`가 false를 낸다. palette·launcher chord, macOS `Cmd+W`까지 아무 단축키도 shell에 오지 않는다.
- app panel(native view): 키는 `packages/shell/main/desktop/wiring/desktop.ts`의 `web-contents-created`가 건 `listenShortcuts`(`packages/shell/main/desktop/shortcuts.ts`)만 본다. 이 함수의 `windowShortcut`은 palette·launcher chord(`WINDOW_SHORTCUTS`)와 작업대 단축키 표(`packages/shell/ipc/keybindings.ts`)에서 `main`이 적힌 것만 본다. 그 표에서 `main`이 적힌 것은 `tab.close`의 macOS `Cmd+KeyW` 하나다. 그래서 page에 focus가 있으면 Linux·Windows의 `Ctrl+W`·`Ctrl+F4`(`tab.close`), `Ctrl+Tab`·`Ctrl+Shift+Tab`(`tab.next`·`tab.prev`), `Ctrl+Shift+T`(`tab.reopen`) 같은 renderer 몫 단축키가 page로 가고 shell renderer에 오지 않는다.

영향: browser 탭을 보다가 키보드로 palette를 열거나 탭을 닫거나 넘기지 못한다. app panel에서는 탭을 닫거나 넘기지 못한다. 먼저 탭 줄을 눌러 focus를 shell로 옮겨야 한다. browser 탭이 생기면서 page에 focus가 오래 머무는 일이 많아진다.

고치려면:
- (browser, 작음, 먼저) 창을 찾을 때 guest면 `contents.hostWebContents`로 그 창을 찾는다.
- (추천, 작음) 작업대 단축키 표의 탭 이동·닫기·다시 열기 줄에 `main`을 모든 OS로 넓힌다. `listenShortcuts`가 그 키를 삼키고 shell renderer로 보낸다. page가 그 키를 못 받게 되는 것을 잃는다(Chrome과 같다).
- (중간) native view의 키를 모두 shell renderer에 보내 renderer의 matcher가 고르게 한다. 키마다 IPC가 생기고 page가 받을 키를 renderer가 다시 돌려줘야 한다.
