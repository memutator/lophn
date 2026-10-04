import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import {
  REVERT_EVENTS,
  REVERT_ROUTES,
  revertChangeSchema,
  revertGroupSchema,
  revertRun,
  revertRunInputSchema,
} from "./reverts.ts";

const suffix = "01arz3ndektsv4rrffq69g5fav";
const hash = "d".repeat(64);
const run = `run_${suffix}`;

const group = {
  ordinal: 0,
  owner: "documents/versions",
  target: `doc_${suffix}`,
  source_seqs: ["2", "4"],
  capability: "reversible",
  reason_blob: null,
  comparison: { revision: 3 },
  before_ref: { version: `ver_${suffix}` },
  dependencies: [],
  app_revert: null,
};

Deno.test("lophn-agent/revert#R1: revert routes and the four named events", () => {
  assertEquals(REVERT_ROUTES.map(routePath), [
    "/v1/reverts/checkpoint",
    "/v1/reverts/finish",
    "/v1/reverts/apply",
    "/v1/reverts/preview",
    "/v1/reverts/list",
  ]);
  assertEquals(REVERT_EVENTS.map((event) => event.type), [
    "RevertStarted",
    "RevertApplied",
    "RevertBlocked",
    "RevertFinished",
  ]);
  assertEquals(revertRun.actors, ["user"]);
  assertEquals(revertRun.confirmation, "required");
  assertEquals(revertRun.display_read, "/v1/reverts/preview");
  assert(
    REVERT_ROUTES.every((route) =>
      route.errors.every((code) => ERROR_CODES.includes(code))
    ),
  );
});

Deno.test("lophn-agent/revert#R3: a preview shows every group with its capability", () => {
  assert(revertGroupSchema.safeParse(group).success);
  assert(
    !revertGroupSchema.safeParse({
      ...group,
      capability: "irreversible",
      reason_blob: null,
    }).success,
  );
  assert(
    revertGroupSchema.safeParse({
      ...group,
      capability: "irreversible",
      reason_blob: hash,
      comparison: null,
      before_ref: null,
    }).success,
  );
  assert(
    revertRunInputSchema.safeParse({
      id: `rvt_${suffix}`,
      run,
      allow_partial: false,
      preview_hash: hash,
      groups: [{
        source_seqs: ["2", "4"],
        comparison: { revision: 3 },
        prepared_ref: null,
      }],
    }).success,
  );
});

const change = {
  ordinal: group.ordinal,
  owner: group.owner,
  target: group.target,
  source_seqs: group.source_seqs,
  capability: group.capability,
  app_revert: null,
};

Deno.test("lophn-agent/revert#R11: a partial result keeps restored and unfinished changes apart", () => {
  assert(
    revertChangeSchema.safeParse({
      ...change,
      result: "restored",
      reason_blob: null,
      restored_seqs: ["8"],
    }).success,
  );
  assert(
    revertChangeSchema.safeParse({
      ...change,
      result: "unchanged",
      reason_blob: hash,
      restored_seqs: [],
    }).success,
  );
  assert(
    !revertChangeSchema.safeParse({
      ...change,
      result: "failure",
      reason_blob: null,
      restored_seqs: [],
    }).success,
  );
  assert(
    !revertChangeSchema.safeParse({
      ...change,
      source_seqs: ["4", "2"],
      result: "restored",
      reason_blob: null,
      restored_seqs: ["8"],
    }).success,
  );
});
