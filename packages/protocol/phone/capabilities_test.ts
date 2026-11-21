import assert from "node:assert/strict";
import { test } from "node:test";
import { PHONE_CAPABILITIES } from "../apps/declaration/types.ts";
import {
  BACKEND_CAPABILITIES,
  BROKER_STAND_IN,
  HAPTIC_KINDS as SDK_HAPTIC_KINDS,
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
});
