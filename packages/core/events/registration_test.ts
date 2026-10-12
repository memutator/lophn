// platform/ledger#R15: 팀 등록이 싣는 event 정의와 공개 정책을 한 registry로 모은다.
// 정책이 없거나 같은 type이 둘이면 숨기거나 거절한다(fail-closed).
import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import { defineEvent } from "../../protocol/server/mod.ts";
import { collectEventRegistrations } from "./visibility.ts";

const noteCreated = defineEvent("NoteCreated", {
  subject: z.string(),
  payload: z.object({}),
});
const noteRemoved = defineEvent("NoteRemoved", {
  subject: z.string(),
  payload: z.object({}),
});
const sameTypeElsewhere = defineEvent("NoteCreated", {
  subject: z.string(),
  payload: z.object({}),
});

const open = <D extends typeof noteCreated>(event: D) => ({
  event,
  handle: () => ok(true),
});

Deno.test("platform/ledger#R15: 여러 팀의 event와 정책을 모으고 정책 없는 event는 숨긴다", () => {
  const registry = collectEventRegistrations([
    { visibility: [open(noteCreated)] },
    // 정책이 가리키는 event는 따로 적지 않아도 등록된다.
    { events: [noteRemoved] },
    undefined,
  ]);
  assert(registry.ok);
  assertEquals(registry.value.has("NoteCreated"), true);
  // 정의만 있고 정책이 없다: 등록돼도 어느 자격에도 숨김이다.
  assertEquals(registry.value.has("NoteRemoved"), false);
  assertEquals(registry.value.has("Missing"), false);
});

Deno.test("platform/ledger#R15: 같은 event 정의 객체를 둘 이상의 등록이 실어도 한 번이다", () => {
  const registry = collectEventRegistrations([
    { events: [noteCreated] },
    { events: [noteCreated], visibility: [open(noteCreated)] },
  ]);
  assert(registry.ok);
  assertEquals(registry.value.has("NoteCreated"), true);
});

Deno.test("platform/ledger#R15: 같은 type의 서로 다른 정의나 정책이 둘이면 거절한다", () => {
  const twoDefinitions = collectEventRegistrations([
    { visibility: [open(noteCreated)] },
    { events: [sameTypeElsewhere] },
  ]);
  assert(!twoDefinitions.ok);
  const twoPolicies = collectEventRegistrations([
    { visibility: [open(noteCreated)] },
    { visibility: [open(noteCreated)] },
  ]);
  assert(!twoPolicies.ok);
});
