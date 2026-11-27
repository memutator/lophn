import assert from "node:assert/strict";
import { test } from "node:test";
import headless from "@xterm/headless";
import { OSC52_MAX_BYTES, parseOsc52WriteBytes, Screen } from "./screen.ts";

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

test("폰에 주는 화면은 서식이 같은 칸을 run으로 묶고 폭 2 글자와 자동 줄바꿈을 표시한다", async () => {
  const screen = new Screen(12, 3);
  screen.push("old 1\r\nold 2\r\n");
  screen.push("\x1b[1;31mERR\x1b[0m ok \x1b[38;2;16;32;48m한글\x1b[0m\r\n");
  const last = screen.push("abcdefghijklm\r\n\x1b[44m  \x1b[0m");
  const dump = await screen.screen(1);
  assert.ok(dump && !("unchanged" in dump));
  assert.equal(dump.seq, last);
  assert.deepEqual([dump.columns, dump.rows], [12, 3]);
  // viewport 위 scrollback의 마지막 한 줄만 온다.
  assert.deepEqual(dump.scrollback, [
    {
      runs: [
        { text: "ERR", fg: "p1", bold: true },
        { text: " ok " },
        { text: "한글", fg: "#102030", wide: true },
      ],
      wrapped: false,
    },
  ]);
  assert.deepEqual(dump.lines, [
    { runs: [{ text: "abcdefghijkl" }], wrapped: true },
    { runs: [{ text: "m" }], wrapped: false },
    { runs: [{ text: "  ", bg: "p4" }], wrapped: false },
  ]);
  assert.deepEqual(dump.cursor, { x: 2, y: 2, hidden: false });

  // seq·크기가 같으면 unchanged로 바로 답하고, 출력이 나도 scrollback이 그대로면 scrollback을 생략한다.
  const same = await screen.screen(1, {
    afterSeq: dump.seq,
    columns: 12,
    rows: 3,
    scrollbackKey: dump.scrollback_key,
  });
  assert.deepEqual(same, { unchanged: true });
  const typed = screen.push("!");
  const afterType = await screen.screen(1, {
    afterSeq: dump.seq,
    columns: 12,
    rows: 3,
    scrollbackKey: dump.scrollback_key,
  });
  assert.ok(afterType && !("unchanged" in afterType));
  assert.equal(afterType.seq, typed);
  assert.equal(afterType.scrollback, undefined);
  assert.equal(afterType.scrollback_key, dump.scrollback_key);

  // 줄이 scrollback으로 밀려 올라가면 새 scrollback을 실어 보낸다.
  screen.push("\r\nnext");
  const scrolled = await screen.screen(1, {
    afterSeq: typed,
    columns: 12,
    rows: 3,
    scrollbackKey: afterType.scrollback_key,
  });
  assert.ok(scrolled && !("unchanged" in scrolled));
  assert.notEqual(scrolled.scrollback_key, afterType.scrollback_key);
  assert.ok(scrolled.scrollback !== undefined);

  screen.dispose();
  assert.equal(await screen.screen(0), null);
});

test("Screen은 OSC 52 쓰기(1 MiB 이하)만 감지하고 읽기(?)·1 MiB 초과는 무시한다", async () => {
  const seen: number[] = [];
  const screen = new Screen(80, 24, {
    onClipboard: (bytes) => seen.push(bytes),
  });
  screen.push("\x1b]52;c;?\x07");
  screen.push(`\x1b]52;c;${Buffer.from("copied!").toString("base64")}\x07`);
  screen.push("\x1b]52;c;not-valid!!!\x07");
  await screen.snapshot();
  assert.deepEqual(seen, [7]);

  assert.equal(
    parseOsc52WriteBytes(
      `c;${Buffer.alloc(OSC52_MAX_BYTES).toString("base64")}`,
    ),
    OSC52_MAX_BYTES,
  );
  assert.equal(
    parseOsc52WriteBytes(
      `c;${Buffer.alloc(OSC52_MAX_BYTES + 1).toString("base64")}`,
    ),
    null,
  );
  assert.equal(parseOsc52WriteBytes("c;?"), null);
  screen.dispose();
});

test("Screen은 TerminalModes, VT 질의 회신, 한글 highlight 열 좌표, 32 KiB 하단 보존 절단, visual_hash를 정확히 처리한다", async () => {
  const replies: string[] = [];
  const screen = new Screen(20, 4, {
    onReply: (data) => replies.push(data),
  });
  screen.push("\x1b]0;vim notes.txt\x07");
  screen.push("\x1b[?1h\x1b[?2004h\x1b[?1049h\x1b[?1002h\x1b[?1006h\x1b[?25l");
  screen.push("\x1b[>1u");
  // DA1, DSR 6n, OSC 10/11, Kitty query
  screen.push("\x1b[c\x1b[6n\x1b]10;?\x07\x1b]11;?\x07\x1b[?u");
  // 한글이 섞인 반전 구간: "가나" = 4칸(0..3), 공백 1칸(4), 반전 "한글" = 4칸(5..8)
  screen.push("가나 \x1b[7m한글\x1b[0m\r\nsecond");

  const snap = await screen.tuiSnapshot();
  assert.ok(snap !== null);
  assert.equal(snap.title, "vim notes.txt");
  assert.deepEqual(snap.modes, {
    application_cursor_keys: true,
    bracketed_paste: true,
    alt_screen: true,
    cursor_visible: false,
    mouse_tracking: "button",
    mouse_encoding: "sgr",
    kitty_keyboard_flags: 1,
  });
  assert.deepEqual(snap.highlights, [
    { row: 0, col_start: 5, col_end: 8, text: "한글" },
  ]);
  assert.equal(snap.truncated, false);
  assert.ok(snap.screen.startsWith("가나 한글\nsecond"));
  // 질의 회신 확인: DA1, DSR CPR, OSC 10, OSC 11, Kitty query 모두 답함
  assert.ok(replies.some((r) => r.includes("\x1b[?")));
  assert.ok(replies.some((r) => r.includes("rgb:")));
  assert.ok(replies.some((r) => r === "\x1b[?1u"));

  // 커서만 이동해도 visual_hash가 바뀐다. OSC 제목만 바뀌면 visual_hash가 유지된다.
  const hashBefore = snap.visual_hash;
  screen.push("\x1b]0;new title\x07");
  const afterTitle = await screen.tuiState();
  assert.equal(afterTitle?.visual_hash, hashBefore);
  screen.push("\x1b[1;1H");
  const afterMove = await screen.tuiState();
  assert.notEqual(afterMove?.visual_hash, hashBefore);

  // Kitty pop 및 RIS 리셋 확인
  screen.push("\x1b[<u");
  const afterPop = await screen.tuiState();
  assert.equal(afterPop?.modes.kitty_keyboard_flags, 0);
  screen.push("\x1bc");
  const afterReset = await screen.tuiState();
  assert.equal(afterReset?.modes.application_cursor_keys, false);
  assert.equal(afterReset?.modes.bracketed_paste, false);
  assert.equal(afterReset?.modes.mouse_tracking, "none");
  assert.equal(afterReset?.modes.cursor_visible, true);
  screen.dispose();
});
