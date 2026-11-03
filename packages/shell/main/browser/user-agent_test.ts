import assert from "node:assert/strict";
import { test } from "node:test";

import { rewriteBrandHeaders, userAgentMetadata } from "./user-agent.ts";

const ua = (version: string) =>
  `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;

test("brand header가 그 판의 진짜 Google Chrome과 같고 page JS 값과 어긋나지 않는다", () => {
  // 131은 진짜 Chrome이 보낸 header다. 152는 Electron 44 page JS의 GREASE brand(Not?A_Brand, 24)와 맞춘다.
  const cases = [
    [
      "131.0.6778.85",
      '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    ],
    [
      "152.0.7977.130",
      '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
    ],
  ] as const;
  for (const [version, expected] of cases) {
    const headers: Record<string, string> = {
      "sec-ch-ua": '"Not?A_Brand";v="24", "Chromium";v="152"',
    };
    rewriteBrandHeaders(headers, ua(version));
    assert.equal(headers["sec-ch-ua"], expected);

    const metadata = userAgentMetadata({
      userAgent: ua(version),
      platform: "linux",
      arch: "x64",
      systemVersion: "7.0.0-38-generic",
    });
    assert.equal(
      metadata?.brands.map((b) => `"${b.brand}";v="${b.version}"`).join(", "),
      expected,
    );
  }
});

test("Chromium이 싣지 않은 brand header는 더하지 않는다", () => {
  const headers: Record<string, string> = { Accept: "*/*" };
  rewriteBrandHeaders(headers, ua("152.0.7977.130"));
  assert.deepEqual(headers, { Accept: "*/*" });
});
