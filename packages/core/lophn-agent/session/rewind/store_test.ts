import { assert, assertEquals, assertRejects } from "@std/assert";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRewindStore } from "./store.ts";
import { OTHER_SES, SES, sha256, tempDir } from "./testing/mod.ts";

// session 저장소(agent-RW3a). 임시 폴더의 실제 파일만 쓰고 시각·무작위·네트워크에 기대지 않는다.

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function dirOf(dataRoot: string, session: string): string {
  return join(dataRoot, "rewind", session);
}

Deno.test("lophn-agent/revert#R13 [agent-RW3a]: the store is addressed by sha256 and keeps equal content once", async () => {
  const dataRoot = tempDir("store");
  const store = createRewindStore(dataRoot);
  const first = await store.put(SES, encode("hello"));
  assertEquals(first.key, sha256("hello"));
  assertEquals(first.size, 5);
  assertEquals(first.created, true);
  const again = await store.put(SES, encode("hello"));
  assertEquals(again, { key: first.key, size: 5, created: false });
  assertEquals(readdirSync(dirOf(dataRoot, SES)), [first.key]);
  assertEquals(decode(await store.read(SES, first.key)), "hello");
  assertEquals(await store.has(SES, first.key), true);
  assertEquals(await store.has(SES, sha256("other")), false);
  // 저장소는 session마다 따로다.
  assertEquals(await store.has(OTHER_SES, first.key), false);
});

Deno.test("lophn-agent/revert#R14 [agent-RW3a]: the session total counts each distinct blob once", async () => {
  const store = createRewindStore(tempDir("store"));
  assertEquals(await store.totalBytes(SES), 0);
  await store.put(SES, encode("12345"));
  await store.put(SES, encode("12345"));
  await store.put(SES, encode("abc"));
  assertEquals(await store.totalBytes(SES), 8);
  assertEquals(await store.totalBytes(OTHER_SES), 0);
});

Deno.test("lophn-agent/revert#R20 [agent-RW3a]: a put installs atomically, leaves no temp file, and survives a restart", async () => {
  const dataRoot = tempDir("store");
  const key = (await createRewindStore(dataRoot).put(SES, encode("kept"))).key;
  // 임시 파일은 남지 않는다: 디렉터리에는 저장물 하나뿐이다.
  assertEquals(readdirSync(dirOf(dataRoot, SES)), [key]);
  // 앱을 껐다 켜도(새 store 인스턴스) 같은 저장물이 읽힌다.
  const reopened = createRewindStore(dataRoot);
  assertEquals(decode(await reopened.read(SES, key)), "kept");
  assertEquals(await reopened.totalBytes(SES), 4);
});

Deno.test("lophn-agent/revert#R17 [agent-RW3a]: a missing blob and a blob whose content no longer matches its key are rejected", async () => {
  const dataRoot = tempDir("store");
  const store = createRewindStore(dataRoot);
  await assertRejects(() => store.read(SES, sha256("never stored")));
  const key = (await store.put(SES, encode("original"))).key;
  writeFileSync(join(dirOf(dataRoot, SES), key), "tampered");
  await assertRejects(() => store.read(SES, key));
});

Deno.test("lophn-agent/revert#R20 [agent-RW3a]: sweep removes orphans and stale temp files but keeps what a row still points at", async () => {
  const dataRoot = tempDir("store");
  const store = createRewindStore(dataRoot);
  const live = (await store.put(SES, encode("live"))).key;
  const orphan = (await store.put(SES, encode("orphan"))).key;
  writeFileSync(join(dirOf(dataRoot, SES), "leftover.tmp"), "partial");
  const removed = await store.sweep(SES, new Set([live]));
  assertEquals(removed, [orphan]);
  assertEquals(readdirSync(dirOf(dataRoot, SES)), [live]);
  assertEquals(await store.totalBytes(SES), 4);
  // 쓸 것이 없으면 아무것도 지우지 않는다.
  assertEquals(await store.sweep(SES, new Set([live])), []);
});

Deno.test("lophn-agent/revert#R20 [agent-RW3a]: removing a session deletes its directory and no other session's", async () => {
  const dataRoot = tempDir("store");
  const store = createRewindStore(dataRoot);
  await store.put(SES, encode("one"));
  const kept = (await store.put(OTHER_SES, encode("two"))).key;
  await store.removeSession(SES);
  assert(!existsSync(dirOf(dataRoot, SES)));
  assertEquals(decode(await store.read(OTHER_SES, kept)), "two");
  // 없는 session을 지워도 성공이다.
  await store.removeSession(SES);
});
