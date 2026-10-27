import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import {
  type MessageImageDeps,
  messageImagePathHandler,
  messageImageUploadHandler,
} from "./message-images.ts";

const A = "ses_0aaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "ses_0bbbbbbbbbbbbbbbbbbbbbbbbb";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

const who = (actor: string, session?: string) =>
  ({
    actor,
    conditions: session === undefined ? {} : { session },
  }) as unknown as AuthenticatedContext;

function setup() {
  const stored = new Map<string, Uint8Array>();
  const deps: MessageImageDeps = {
    root: "/data",
    files: {
      read: (path) => Promise.resolve(stored.get(path) ?? null),
      writeAtomic: (path, bytes) => {
        stored.set(path, bytes);
        return Promise.resolve();
      },
      exists: (path) => Promise.resolve(stored.has(path)),
    },
    readers: { read: () => Promise.resolve(ok({})) },
    ids: { newId: (prefix) => `${prefix}_0${"c".repeat(25)}` },
  };
  const body = (bytes: Uint8Array) => ({
    bytes: new Response(bytes.slice()).body!,
    length: bytes.length,
  });
  return { stored, deps, body };
}

test("agent는 자기 session에 붙은 이미지만 풀고 경로 문자는 거절된다", async () => {
  const { stored, deps, body } = setup();
  const uploaded = await messageImageUploadHandler(deps)(
    who("user"),
    { session: A, content_type: "image/png", bytes: PNG.length },
    body(PNG),
  );
  if (!uploaded.ok) throw new Error("upload failed");
  const image = uploaded.value.id;
  assert.deepStrictEqual([...stored.keys()], [
    `/data/message-images/${A}/${image}.png`,
  ]);

  const path = messageImagePathHandler(deps);
  const cases: [string, AuthenticatedContext, unknown, string | "ok"][] = [
    ["own session", who(`agent:${A}`, A), { session: A, image }, "ok"],
    ["other session's credential", who(`agent:${B}`, B), {
      session: A,
      image,
    }, "forbidden"],
    ["credential session differs from actor", who(`agent:${B}`, A), {
      session: B,
      image,
    }, "forbidden"],
    ["same id under another session", who(`agent:${B}`, B), {
      session: B,
      image,
    }, "not_found"],
    ["traversal in id", who(`agent:${A}`, A), {
      session: A,
      image: "../../x",
    }, "invalid_input"],
    ["traversal in session", who(`agent:${A}`, A), {
      session: "../x",
      image,
    }, "invalid_input"],
  ];
  for (const [name, ctx, input, expected] of cases) {
    const got = await path(ctx, input);
    assert.deepStrictEqual(
      got.ok ? "ok" : got.error.code,
      expected,
      name,
    );
  }
});

test("형식이나 길이가 선언과 다른 이미지는 저장되지 않는다", async () => {
  const { stored, deps, body } = setup();
  const upload = messageImageUploadHandler(deps);
  const text = new TextEncoder().encode("<svg/>");
  const wrongType = await upload(
    who("user"),
    { session: A, content_type: "image/png", bytes: text.length },
    body(text),
  );
  const wrongLength = await upload(
    who("user"),
    { session: A, content_type: "image/png", bytes: PNG.length + 1 },
    body(PNG),
  );
  assert.deepStrictEqual([wrongType.ok, wrongLength.ok, stored.size], [
    false,
    false,
    0,
  ]);
});
