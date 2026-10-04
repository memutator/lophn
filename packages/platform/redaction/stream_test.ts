import { assert, assertEquals } from "@std/assert";
import { REDACTION_REPLACEMENT } from "../../contracts/platform/mod.ts";
import { createRedactionStream } from "./mod.ts";
import { createKnownSecretRegistry } from "./registry.ts";

Deno.test("R5 stream은 알려진 값의 최장 길이만큼 보류하고 조각 경계의 secret을 지운 prefix만 내보낸다", () => {
  const registry = createKnownSecretRegistry();
  registry.register(["boundary-secret"]);
  const stream = createRedactionStream(registry);

  const first = stream.push("hello boundary-sec");
  assert(!first.includes("boundary-sec"));
  assert(
    stream.held >= "boundary-secret".length - 1 || first.length === 0 ||
      !first.includes("boundary"),
  );
  const second = stream.push("ret tail");
  const done = stream.finish();
  const all = first + second + done;
  assert(!all.includes("boundary-secret"));
  assert(all.includes("hello"));
  assert(all.includes("tail"));
  assert(all.includes(REDACTION_REPLACEMENT));
  assertEquals(stream.held, 0);
});

Deno.test("R5 stream은 값 없는 본문을 보류 없이 끝까지 내보내고 패턴도 조각 경계에서 지운다", () => {
  const registry = createKnownSecretRegistry();
  const stream = createRedactionStream(registry);
  const token = "ghp_githubKeyValue1234567890abcd";
  const split = Math.floor(token.length / 2);
  const first = stream.push(`before ${token.slice(0, split)}`);
  const second = stream.push(`${token.slice(split)} after`);
  const done = stream.finish();
  const all = first + second + done;
  assert(!all.includes(token));
  assert(!all.includes("ghp_github"));
  assert(all.includes("before"));
  assert(all.includes("after"));
  assertEquals(stream.held, 0);
});
