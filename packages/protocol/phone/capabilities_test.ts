import assert from "node:assert/strict";
import { test } from "node:test";
import { APP_FILE_HASH, APP_FILE_MAX_BYTES } from "../apps/app-file-values.ts";
import { PHONE_CAPABILITIES } from "../apps/declaration/types.ts";
import {
  BACKEND_CAPABILITIES,
  BROKER_STAND_IN,
  FILE_HASH as SDK_FILE_HASH,
  FILE_MAX_BYTES as SDK_FILE_MAX_BYTES,
  FILE_PATTERN as SDK_FILE_PATTERN,
  FILE_TYPES_MAX as SDK_FILE_TYPES_MAX,
  HAPTIC_KINDS as SDK_HAPTIC_KINDS,
  PICK_MAX as SDK_PICK_MAX,
  LINK_SCHEMES as SDK_LINK_SCHEMES,
  PHONE_CAPABILITY_NAMES,
} from "../../sdk/cap-phone/phone.ts";
import {
  capabilityFrom,
  HAPTIC_KINDS,
  LINK_SCHEMES,
  PHONE_CAPABILITY_TABLE,
  type PhoneCapabilityTable,
} from "./capabilities.ts";

// The SDK cannot import protocol, so it keeps hand copies of the table's facts. A capability added to the table and not to
// the SDK (or a changed stand-in) would pass every other check and misbehave only in an app.
test("the SDK's copies of the capability table agree with the table", () => {
  assert.deepEqual([...PHONE_CAPABILITY_NAMES], [...PHONE_CAPABILITIES]);
  const names = Object.keys(
    PHONE_CAPABILITY_TABLE,
  ) as (keyof PhoneCapabilityTable)[];
  assert.deepEqual(
    [...BACKEND_CAPABILITIES].sort(),
    names.filter((name) => capabilityFrom(name, "backend")).sort(),
  );
  assert.deepEqual([...SDK_HAPTIC_KINDS], [...HAPTIC_KINDS]);
  assert.deepEqual([...SDK_LINK_SCHEMES], [...LINK_SCHEMES]);
  for (const name of BACKEND_CAPABILITIES) {
    // `at` is the time of the call in the SDK's copy and a fixed time in the table.
    const { at: _a, ...mine } = BROKER_STAND_IN[name]?.() as Record<
      string,
      unknown
    >;
    const { at: _b, ...table } = PHONE_CAPABILITY_TABLE[
      name as keyof PhoneCapabilityTable
    ].stand_in as Record<string, unknown>;
    assert.deepEqual(mine, table, name);
  }
  // The file capabilities' limits, where a copy that drifts refuses what the phone takes or lets through what it refuses.
  assert.equal(SDK_FILE_MAX_BYTES, APP_FILE_MAX_BYTES);
  assert.equal(SDK_FILE_HASH.source, APP_FILE_HASH.source);
  const input = (name: "photos.pick" | "files.pick") =>
    PHONE_CAPABILITY_TABLE[name].input;
  assert.ok(input("photos.pick").safeParse({ max: SDK_PICK_MAX }).success);
  assert.ok(!input("photos.pick").safeParse({ max: SDK_PICK_MAX + 1 }).success);
  const types = (count: number) => ({
    types: Array.from({ length: count }, () => "image/*"),
  });
  assert.ok(input("files.pick").safeParse(types(SDK_FILE_TYPES_MAX)).success);
  assert.ok(
    !input("files.pick").safeParse(types(SDK_FILE_TYPES_MAX + 1)).success,
  );
  for (const [type, accepted] of [
    ["image/*", true],
    ["application/pdf", true],
    ["*/*", false],
    ["pdf", false],
  ] as const) {
    assert.equal(SDK_FILE_PATTERN.test(type), accepted, type);
    assert.equal(
      input("files.pick").safeParse({ types: [type] }).success,
      accepted,
      type,
    );
  }
});
