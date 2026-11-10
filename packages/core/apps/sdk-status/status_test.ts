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
  // 결정이 없으면 unreviewed는 notes와 같고, 마지막 결정의 through 다음부터만 남는다. through가 고정 판보다 낮으면 고정 판이 이긴다.
  assert.deepStrictEqual(at("2.1.0").unreviewed, at("2.1.0").notes);
  const reviewed = (version: string, through: string) =>
    sdkEntry(
      { name: "@lophn/declaration", version },
      installed,
      notes,
      "declaration",
      through,
    );
  assert.deepStrictEqual(reviewed("2.1.0", "3.0.0").unreviewed, [
    "declaration-4.0.0.md",
  ]);
  assert.deepStrictEqual(reviewed("3.0.0", "2.0.0").unreviewed, [
    "declaration-4.0.0.md",
  ]);
  assert.deepStrictEqual(reviewed("2.1.0", "4.0.0").unreviewed, []);
});

test("one app-less row counts required apps and apps with unreviewed notes, and nothing is recorded when no app needs an update", async () => {
  const status = (
    name: string,
    level: "required" | "available" | "current",
    unreviewed: string[] = level === "current" ? [] : ["declaration-4.0.0.md"],
  ) =>
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
          unreviewed,
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
      // 그대로 두기로 해서 새 메모가 없는 앱은 새 판이 있어도 세지 않는다.
      status("Left", "available", []),
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
