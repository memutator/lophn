import assert from "node:assert/strict";
import { test } from "node:test";
import type { TerminalModes } from "../../protocol/lophn-agent/terminal-use.ts";
import {
  encodeMouse,
  encodePaste,
  encodePress,
  encodeType,
} from "./input-encoder.ts";

const DEFAULT_MODES: TerminalModes = {
  application_cursor_keys: false,
  bracketed_paste: false,
  alt_screen: false,
  cursor_visible: true,
  mouse_tracking: "none",
  mouse_encoding: "default",
  kitty_keyboard_flags: 0,
};

test("type은 리터럴 UTF-8을 개행 없이 보내고 제어문자·개행은 거부한다", () => {
  const plain = encodeType("hello 한글 123");
  assert.deepEqual(plain, { ok: true, value: "hello 한글 123" });

  const nl = encodeType("line1\nline2");
  assert.equal(nl.ok, false);
  if (!nl.ok) {
    assert.equal(nl.error.code, "invalid_input");
    assert.match(nl.error.message, /paste|press Enter/i);
  }

  const esc = encodeType("bad\x1b[31m");
  assert.equal(esc.ok, false);
  if (!esc.ok) assert.equal(esc.error.code, "invalid_input");
});

test("paste는 bracketed_paste가 켜졌을 때만 감싸고 내부 ESC[201~와 NUL을 제거한다", () => {
  const on = encodePaste("a\x1b[201~b\x00c\x1b[20\x001~d\nline2", {
    bracketed_paste: true,
  });
  assert.deepEqual(on, {
    ok: true,
    value: "\x1b[200~abcd\nline2\x1b[201~",
  });

  const off = encodePaste("line1\r\nline2\nline3\x1b[201~", {
    bracketed_paste: false,
  });
  assert.deepEqual(off, {
    ok: true,
    value: "line1\rline2\rline3",
  });
});

test("press는 DECCKM, Ctrl/Alt, Web/tmux 키 문법, Kitty keyboard flag를 맞게 인코딩한다", () => {
  // DECCKM off: CSI
  const csi = encodePress(
    ["Up", "ArrowDown", "Left", "Right", "Home", "End"],
    DEFAULT_MODES,
  );
  assert.deepEqual(csi, {
    ok: true,
    value: ["\x1b[A", "\x1b[B", "\x1b[D", "\x1b[C", "\x1b[H", "\x1b[F"],
  });

  // DECCKM on: SS3 for unmodified, CSI 1;<mod> for modified
  const ss3 = encodePress(["Up", "Down", "Home", "End", "Ctrl+Up", "S-Right"], {
    ...DEFAULT_MODES,
    application_cursor_keys: true,
  });
  assert.deepEqual(ss3, {
    ok: true,
    value: ["\x1bOA", "\x1bOB", "\x1bOH", "\x1bOF", "\x1b[1;5A", "\x1b[1;2C"],
  });

  // Web & tmux conventions + Ctrl/Alt/Shift
  const combos = encodePress(
    [
      "Enter",
      "Return",
      "BSpace",
      "Esc",
      "Shift+Tab",
      "C-c",
      "Control+a",
      "M-x",
      "Alt+Enter",
      "C-]",
      "F1",
      "F5",
      "PgDn",
    ],
    DEFAULT_MODES,
  );
  assert.deepEqual(combos, {
    ok: true,
    value: [
      "\r",
      "\r",
      "\x7f",
      "\x1b",
      "\x1b[Z",
      "\x03",
      "\x01",
      "\x1bx",
      "\x1b\r",
      "\x1d",
      "\x1bOP",
      "\x1b[15~",
      "\x1b[6~",
    ],
  });

  // Kitty DISAMBIGUATE_ESC_CODES (bit 0)
  const kitty = encodePress(["Shift+Enter", "Ctrl+Enter", "Ctrl+a"], {
    ...DEFAULT_MODES,
    kitty_keyboard_flags: 1,
  });
  assert.deepEqual(kitty, {
    ok: true,
    value: ["\x1b[13;2u", "\x1b[13;5u", "\x1b[97;5u"],
  });

  // Unknown key fails the entire request with supported key summary
  const bad = encodePress(["Enter", "SuperFakeKey"], DEFAULT_MODES);
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.error.code, "invalid_input");
    assert.match(bad.error.message, /SuperFakeKey/);
    assert.match(bad.error.message, /Enter/);
  }
});

test("mouse는 좌표 범위·mouse_tracking 여부를 검사하고 SGR 1006으로 인코딩한다", () => {
  const disabled = encodeMouse(
    { action: "click", col: 5, row: 3 },
    { columns: 80, rows: 24 },
    DEFAULT_MODES,
  );
  assert.equal(disabled.ok, false);
  if (!disabled.ok) assert.equal(disabled.error.code, "conflict");

  const forced = encodeMouse(
    { action: "click", col: 5, row: 3, force: true },
    { columns: 80, rows: 24 },
    DEFAULT_MODES,
  );
  assert.deepEqual(forced, {
    ok: true,
    value: "\x1b[<0;6;4M\x1b[<0;6;4m",
  });

  const oob = encodeMouse(
    { action: "click", col: 80, row: 0 },
    { columns: 80, rows: 24 },
    { mouse_tracking: "normal", mouse_encoding: "sgr" },
  );
  assert.equal(oob.ok, false);
  if (!oob.ok) assert.equal(oob.error.code, "invalid_input");

  const scroll = encodeMouse(
    { action: "scroll_down", col: 10, row: 2, modifiers: ["ctrl"] },
    { columns: 80, rows: 24 },
    { mouse_tracking: "normal", mouse_encoding: "sgr" },
  );
  assert.deepEqual(scroll, { ok: true, value: "\x1b[<81;11;3M" });
});
