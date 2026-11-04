# fix-gui-intent-argv

lophn이 이미 떠 있을 때 `claude gui`를 치면 GUI 창 대신 기본 창(Home)이 뜬다. 앱을 처음 켤 때는 된다.

- 단위: fix (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/open-intent.ts`
  - `packages/shell/main/desktop/open-intent_test.ts`
  - `packages/cli/commands/gui.ts`
- 읽을 것:
  - `project-docs/architecture/harness-gui.md`("open intent는 모양만 본다")
  - `packages/shell/main/desktop/single-instance.ts`
- 계약: open intent의 꼴을 이 task가 바꾼다(아래). 쓰는 쪽은 `gui.ts` 하나다.

## 지금

`lophn gui`(`gui.ts`)는 `--harness-gui <harness> --cwd <dir> [--resume <id>]`로 앱을 띄우고, `readOpenIntent`(`open-intent.ts`)는 flag 바로 뒤 값을 읽는다. 이미 떠 있는 앱은 second-instance argv로 받는데, Chromium이 그 argv를 스위치 먼저, 값 나중으로 다시 늘어놓고 자기 스위치도 끼운다. lead가 창 없는 Electron(headless, 따로 둔 userData)으로 확인한 second-instance argv:

```
[<electron>, "--no-sandbox", "--ozone-platform=headless", "--harness-gui", "--cwd", "--resume",
 "--allow-file-access-from-files", "<main.cjs>", "claude", "/tmp/a b", "abc"]
```

그래서 `--harness-gui` 바로 뒤가 `--cwd`라 기본 창 요청으로 읽힌다. `--harness-gui=claude`, `--cwd=/tmp/a b=c`, `--resume=abc`처럼 `=`로 붙인 값은 그 자리에 그대로 남는다(같은 방법으로 확인).

## 할 일

1. `gui.ts`가 `--harness-gui=<harness>`, `--cwd=<dir>`, `--resume=<id>`로 넘긴다.
2. `readOpenIntent`가 harness-gui의 세 flag를 `=` 꼴로만 읽는다(각각 정확히 한 번, 값은 첫 `=` 뒤 전부). 모양 규칙(harness 목록, 절대 경로, `-`로 시작하지 않는 resume)은 그대로다. 옛 꼴(`--harness-gui claude`)은 읽지 않는다(쓰는 쪽이 같은 변경에서 바뀐다). `--open-app <app ID>`는 건드리지 않는다(따로 이슈).
3. 주석에 왜 `=` 꼴인지(Chromium이 second-instance argv를 다시 늘어놓는다) 한 줄 적는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: `open-intent_test.ts`에 위 second-instance argv 꼴(스위치가 앞, 끼운 `--allow-file-access-from-files`, 값이 뒤에 흩어짐)에 `=` 꼴 flag를 넣은 case가 harness-gui intent로 읽히는지 더한다. 두 번 고친 경로다(앞 fix 둘이 같은 `claude gui` 길을 고쳤다).
- 남지 않음: `gui.ts`에서 `"--harness-gui",`·`"--cwd",`·`"--resume",` 꼴(값을 따로 넘기는 배열 원소)이 0줄.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. Electron이나 앱을 띄우지 않는다.
