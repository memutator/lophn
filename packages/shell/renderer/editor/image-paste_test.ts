import assert from "node:assert/strict";
import { test } from "node:test";

import { pastedImageName } from "./image-paste.ts";

const pasted = (name: string, type: string) =>
  new File([new Uint8Array([1])], name, { type });

test("붙여넣은 그림은 MIME에 맞는 확장자로 저장되고, 모르는 형식은 저장하지 않는다", () => {
  const cases = [
    { name: "shot.png", type: "image/png", expected: "shot.png" },
    { name: "shot.png", type: "image/jpeg", expected: "shot.jpg" },
    { name: "screenshot", type: "image/gif", expected: "screenshot.gif" },
    { name: "paste.webp", type: "image/webp", expected: "paste.webp" },
    { name: "scan.bmp", type: "image/bmp", expected: null },
  ];
  for (const { name, type, expected } of cases) {
    assert.equal(
      pastedImageName(pasted(name, type), []),
      expected,
      `${type} ${name}`,
    );
  }
});

test("폴더에 같은 이름이 있으면 image 2.png, image 3.png으로 비켜 간다", () => {
  const image = pasted("image.png", "image/png");
  const taken: string[] = [];
  for (let count = 0; count < 3; count += 1) {
    const name = pastedImageName(image, taken);
    assert.ok(name !== null);
    taken.push(name);
  }
  assert.deepEqual(taken, ["image.png", "image 2.png", "image 3.png"]);
});
