import { assert, assertFalse } from "@std/assert";
import { isStorageUnavailable } from "./sqlite.ts";

// architecture/platform 2.3·platform/ledger#R6: 분류는 primary code 하위 8bit와
// SQLITE_* 이름 둘 다로 한다. 여기 없는 코드·이름은 unavailable이 아니다.
const PRIMARY_NAMES: Record<number, string> = {
  5: "SQLITE_BUSY",
  6: "SQLITE_LOCKED",
  8: "SQLITE_READONLY",
  10: "SQLITE_IOERR",
  11: "SQLITE_CORRUPT",
  13: "SQLITE_FULL",
  14: "SQLITE_CANTOPEN",
  15: "SQLITE_PROTOCOL",
  26: "SQLITE_NOTADB",
};

Deno.test("platform/ledger#R6: primary errcode 표의 각 코드는 unavailable이다", () => {
  for (const code of Object.keys(PRIMARY_NAMES).map(Number)) {
    assert(
      isStorageUnavailable({ errcode: code }),
      `primary errcode ${code}는 unavailable이어야 한다`,
    );
  }
});

Deno.test("platform/ledger#R6: extended errcode(하위 8bit)도 같은 primary로 분류한다", () => {
  for (const code of Object.keys(PRIMARY_NAMES).map(Number)) {
    const extended = code | (3 << 8);
    assert(
      isStorageUnavailable({ errcode: extended }),
      `extended errcode ${extended}도 primary ${code}로 unavailable이어야 한다`,
    );
  }
});

Deno.test("platform/ledger#R6: SQLITE_* 이름(기본·확장 변형)도 unavailable이다", () => {
  for (const name of Object.values(PRIMARY_NAMES)) {
    assert(
      isStorageUnavailable({ code: name }),
      `이름 ${name}은 unavailable이어야 한다`,
    );
    assert(
      isStorageUnavailable({ code: `${name}_VARIANT` }),
      `확장 이름 ${name}_VARIANT도 unavailable이어야 한다`,
    );
  }
});

Deno.test("platform/ledger#R6: 표 밖의 errcode·이름·오류는 unavailable이 아니다", () => {
  const negatives: unknown[] = [
    { errcode: 1 }, // SQLITE_ERROR
    { errcode: 19 }, // SQLITE_CONSTRAINT
    { code: "SQLITE_ERROR" },
    { code: "SQLITE_MISMATCH" },
    { code: "SQLITE_BUSYISH" }, // 접두 일치만으로 속지 않는다
    new Error("some unrelated failure"),
    new TypeError("not storage related"),
    null,
    undefined,
    "plain string",
    42,
  ];
  for (const thrown of negatives) {
    assertFalse(
      isStorageUnavailable(thrown),
      `${JSON.stringify(thrown)}는 unavailable이 아니어야 한다`,
    );
  }
});

Deno.test("platform/ledger#R6: 메시지 marker(disk i/o 등)로도 unavailable을 분류한다", () => {
  const markers = [
    "disk I/O error",
    "database or disk is full",
    "database is locked",
    "unable to open database file",
    "disk image is malformed",
    "attempt to write a readonly database",
  ];
  for (const message of markers) {
    assert(
      isStorageUnavailable(new Error(message)),
      `메시지 "${message}"는 unavailable이어야 한다`,
    );
  }
  assertFalse(isStorageUnavailable(new Error("no marker here")));
});

Deno.test("platform/ledger#R6: errcode·code가 있어도 숫자·문자열이 아니면 분류하지 않는다", () => {
  assertFalse(isStorageUnavailable({ errcode: "5" }));
  assertFalse(isStorageUnavailable({ code: 5 }));
  assertFalse(isStorageUnavailable({ errcode: null, code: null }));
});
