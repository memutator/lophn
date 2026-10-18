# ec-fix-ptywrite

eval driver가 Claude Code 터미널에 입력을 쓰면 매번 `Unhandled pty write error Error: Bad file descriptor (os error 9) at async innerWrite (ext:deno_node/fs.ts)`가 나고 입력이 들어가지 않는다. 출력 읽기는 된다. driver는 데스크톱 shell의 터미널 host 코드와 node-pty를 Deno 위에서 돌린다(`tests/eval/coding/driver/host.ts`의 `nodePtyAdapter`). 데스크톱은 Deno가 아니라 상관없다. 입력이 막혀 folder trust 화면에 답하지 못하고, 완료 뒤 `/exit`도 못 넣는다.

- 단위: ec-fix-ptywrite (wave 5)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/coding/driver/**`
- 읽을 것:
  - `tests/eval/coding/driver/host.ts`(host를 만드는 곳, `nodePtyAdapter`에 node-pty를 넘긴다), `driver.ts`(`answerTrust`, `/exit`)
  - `packages/shell/terminal-host/pty.ts`(`PtyAdapter`, `PtyHandle`. 고치지 않는다), `packages/shell/terminal-host/main.ts`(input은 `session.handle.write(text)` 그대로)
  - node-pty의 unix 구현(`packages/shell/main/node_modules/node-pty/lib/unixTerminal.js`, `terminal.js`): master fd를 어떻게 쓰나
- 확인한 것(lead, 2026-10-19): 같은 키(`ESC [ B` 뒤 `\r`, 150ms 간격)를 Python `pty`로 진짜 Claude Code 2.1.302 trust 화면에 넣으면 trust가 잡히고 `SessionStart` hook이 불린다. driver 길에서는 두 write가 모두 EBADF였고 화면은 "❯ No, exit" 그대로였다.
- 계약: `PtyAdapter`, `PtyHandle`(고정, `packages/shell`). 바꾸지 않는다.

## 할 일

1. Deno에서 node-pty `write`가 왜 EBADF인지 찾는다(Deno node 호환 `fs`는 native addon이 준 OS fd를 자기 resource로 모른다는 가설).
2. driver 안에서만 고친다. 예: `host.ts`에서 `nodePtyAdapter`가 낸 handle을 감싸 `write`를 OS fd에 직접 쓰는 길(Deno FFI로 libc `write`, runner는 `--allow-all`)로 바꾼다. 더 단순한 길이 있으면 그것을 쓴다. `packages/shell`은 고치지 않는다.
3. 확인(commit하지 않는 probe, `.dev-data/ec-fix-ptywrite/`): driver의 host로 `cat`이나 `read` 한 줄을 하는 무해한 script를 PTY로 띄우고 input을 써서 출력에 그 글이 돌아오는지 본다. 진짜 Claude Code는 띄우지 않는다.

## 끝남

- `deno task check:full`이 통과한다.
- 위 probe에서 쓴 글이 돌아온다. EBADF가 없다.
- 위험 test: 없음(PTY를 띄우는 test는 사람 확인 없이 만들지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 원인(확인한 것)과 고친 길
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
