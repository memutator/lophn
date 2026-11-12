import assert from "node:assert/strict";
import { test } from "node:test";

import { imageNameOf, pathsFromText } from "./explorer-paste.ts";

// OS clipboard의 text를 절대 경로로 잘못 나누면 엉뚱한 파일을 복사하거나 경로를 놓친다.
test("pathsFromText keeps only absolute paths and survives CRLF, blank lines and padding", () => {
  assert.deepEqual(
    pathsFromText(
      "/a/one.md\r\n  /b/two words.png  \n\nrelative/x\n /c/three\r\n",
    ),
    ["/a/one.md", "/b/two words.png", "/c/three"],
  );
  assert.deepEqual(pathsFromText(""), []);
  assert.deepEqual(pathsFromText("relative/path\nfile.txt"), []);
});

// 확장자가 MIME과 다르면 편집기·미리보기가 다른 형식으로 읽는다.
test("imageNameOf takes the extension from the MIME and falls back to image.png", () => {
  assert.equal(
    imageNameOf({ name: "shot.png", type: "image/jpeg" }),
    "shot.jpg",
  );
  assert.equal(imageNameOf({ name: "", type: "image/webp" }), "image.webp");
  assert.equal(imageNameOf({ name: "", type: "image/bmp" }), "image.png");
  assert.equal(
    imageNameOf({ name: "pasted", type: "image/png" }),
    "pasted.png",
  );
});
