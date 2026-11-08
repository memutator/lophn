import assert from "node:assert/strict";
import { test } from "node:test";
import headless from "@xterm/headless";
import { Screen } from "./screen.ts";

// omp처럼 history를 한 번 쓰고 그 뒤로는 맨 아래 줄만 절대 위치로 고쳐 그리는 출력이다. raw ring buffer는
// 이런 frame 10,000개에서 history를 버려 다시 붙은 화면이 비었다.
test("아래 줄만 고쳐 그리는 출력이 오래 쌓여도 다시 붙은 화면에 처음 쓴 history가 남는다", async () => {
  const screen = new Screen(80, 24);
  let history = "";
  for (let i = 1; i <= 60; i++) history += `history ${i}\r\n`;
  screen.push(history);
  let last = 0;
  for (let frame = 1; frame <= 30_000; frame++) {
    last = screen.push(`\x1b[24;1H\x1b[2K working ${frame}`);
  }
  const snap = await screen.snapshot();
  assert.equal(snap.seq, last);

  const fresh = new headless.Terminal({
    cols: 80,
    rows: 24,
    scrollback: 10_000,
    allowProposedApi: true,
  });
  await new Promise<void>((resolve) => fresh.write(snap.text, resolve));
  const buffer = fresh.buffer.active;
  const lines: string[] = [];
  for (let y = 0; y < buffer.length; y++) {
    lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
  }
  assert.equal(lines.filter((line) => line.startsWith("history ")).length, 60);
  assert.equal(lines.at(-1), " working 30000");
  assert.deepEqual([buffer.cursorX, buffer.cursorY], [14, 23]);
  fresh.dispose();
  screen.dispose();
});

// serialize는 mouse tracking만 되살리고 SGR 인코딩을 빠뜨려, 다시 붙은 xterm이 X10(onBinary)으로 보내 TUI가 mouse를
// 하나도 받지 못했다.
test("다시 붙은 화면은 TUI가 고른 mouse 인코딩과 커서 숨김을 되살리고, 끈 것은 되살리지 않는다", async () => {
  const screen = new Screen(80, 24);
  screen.push("\x1b[?1049h\x1b[?1003h\x1b[?1006h\x1b[?25l");
  const on = (await screen.snapshot()).text;
  assert.ok(on.includes("\x1b[?1003h"));
  assert.ok(on.includes("\x1b[?1006h"));
  assert.ok(on.includes("\x1b[?25l"));
  screen.push("\x1b[?1006l\x1b[?25h");
  const off = (await screen.snapshot()).text;
  assert.ok(!off.includes("\x1b[?1006h"));
  assert.ok(!off.includes("\x1b[?25l"));
  screen.dispose();
});
