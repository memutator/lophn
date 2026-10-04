import { assertEquals } from "@std/assert";

import { windowPlatform } from "./platform.ts";

Deno.test("shell/desktop#R23: 상단 바는 renderer user agent로 비울 창 조작 자리의 OS를 고른다", () => {
  assertEquals(
    windowPlatform(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Electron/44.5.1",
    ),
    "mac",
  );
  assertEquals(
    windowPlatform(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Electron/44.5.1",
    ),
    "windows",
  );
  assertEquals(
    windowPlatform(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Electron/44.5.1",
    ),
    "linux",
  );
});
