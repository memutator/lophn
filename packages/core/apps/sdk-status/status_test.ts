import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type { AppSdkStatus } from "../../../protocol/apps/sdk-status.ts";
import { recordSdkUpdates, SDK_UPDATE_NOTICE_KEY } from "./detect.ts";
import { sdkEntry } from "./status.ts";

// 필수/가능을 가르는 경계다. 틀리면 못 뜨는 앱을 알리지 않거나 멀쩡한 앱에 필수를 띄운다.
test("a pin below the support floor is required, above it but old is available, and notes cover pinned to current", () => {
  const installed = { current: "4.0.0", supportedFrom: "3.0.0" };
  const notes = ["2.0.0", "2.1.0", "3.0.0", "4.0.0", "5.0.0"];
  const at = (version: string) =>
    sdkEntry(
      { name: "@lophn/declaration", version },
      installed,
      notes,
      "declaration",
    );
  assert.deepStrictEqual(
    [at("2.1.0").level, at("3.0.0").level, at("4.0.0").level],
    ["required", "available", "current"],
  );
  assert.deepStrictEqual(at("2.1.0").notes, [
    "declaration-3.0.0.md",
    "declaration-4.0.0.md",
  ]);
  assert.deepStrictEqual(at("4.0.0").notes, []);
});

test("one app-less row counts required and optional apps, and nothing is recorded when no app needs an update", async () => {
  const status = (name: string, level: "required" | "available" | "current") =>
    ({
      app: `app_${name}`,
      name,
      release: "rel_1",
      sdks: [
        {
          sdk: "@lophn/declaration",
          pinned: "3.0.0",
          current: "4.0.0",
          supported_from: "4.0.0",
          level,
          notes: [],
        },
      ],
    }) as unknown as AppSdkStatus;
  const recorded: unknown[] = [];
  const record = (input: unknown) => {
    recorded.push(input);
    return Promise.resolve(ok({ id: "ntc_1" }));
  };
  await recordSdkUpdates(
    [
      status("Old", "required"),
      status("Older", "required"),
      status("Maybe", "available"),
      status("Fine", "current"),
    ],
    record,
  );
  assert.deepStrictEqual(recorded, [
    {
      kind: "sdk_update_needed",
      key: SDK_UPDATE_NOTICE_KEY,
      params: { required: 2, available: 1 },
      action: { kind: "open_home_skill", skill: "update-apps", args: "" },
    },
  ]);
  recorded.length = 0;
  await recordSdkUpdates([status("Fine", "current")], record);
  assert.deepStrictEqual(recorded, []);
});
