import { assertEquals } from "@std/assert";
import {
  createKnownSecretRegistry,
  REDACTION_REPLACEMENT,
} from "../../../base/redaction/mod.ts";
import type { KnownSecretMatch } from "../../storage/ledger/mod.ts";
import { redactSettled } from "./runtime-redaction.ts";

// 300자가 넘는 opaque 값 L, 값 A, A의 끝 몇 자로 시작하는 값 B.
const L = "L".repeat(320);
const A = "A1b2C3d4E5f6G7h8I9j0K";
const OVERLAP = A.slice(-8);
const B = `${OVERLAP}B-tail9`;

const registry = createKnownSecretRegistry();
registry.register([L, A, B]);

const matcher: KnownSecretMatch = {
  ready: true,
  match: (text) => registry.match(text),
  prefixFrom: (text) => registry.prefixFrom(text),
};

// 앞글과 "그대로" 줄의 끝 글자는 고정 prefix의 첫 글자(s, e, g, A, x, -)가 아니어야 한다.
// 그 글자로 끝나면 그 글자부터 붙잡힌다.
const HEAD = "여기는 앞글.";
const GITHUB = "ghp_" + "a1B2c3D4e5".repeat(3);

const cases: readonly (readonly [string, string])[] = [
  [HEAD + L.slice(0, 160), HEAD],
  [HEAD + L, HEAD],
  [HEAD + L + " 뒤글.", `${HEAD}${REDACTION_REPLACEMENT} 뒤글.`],
  [HEAD + "sk-ant-api03-" + "a".repeat(5), HEAD],
  [HEAD + "eyJ" + "a".repeat(400) + "." + "aaaaa", HEAD],
  [HEAD + "-----BEGIN PRIVATE KEY-----" + "a".repeat(500), HEAD],
  [HEAD + GITHUB, HEAD],
  [HEAD + GITHUB + " 뒤글.", `${HEAD}${REDACTION_REPLACEMENT} 뒤글.`],
  // B는 A의 끝에서 시작하고, 글은 B의 앞부분에서 끝난다.
  [HEAD + A + B.slice(OVERLAP.length, B.length - 2), HEAD],
  [HEAD + "끝이 마침표인 보통 글.", HEAD + "끝이 마침표인 보통 글."],
];

Deno.test("글 끝에 걸친 secret의 앞부분은 redactSettled가 내지 않는다", () => {
  for (const [text, expected] of cases) {
    assertEquals(redactSettled(text, matcher), expected, text);
  }
  // 알려진 값을 다 모르는 matcher면 원문을 내지 않는다(fail-closed).
  assertEquals(redactSettled(HEAD + L, { ...matcher, ready: false }), null);
});
