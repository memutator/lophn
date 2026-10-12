import { assert, assertEquals, assertNotStrictEquals } from "@std/assert";
import { definePort, type Tx } from "../platform/mod.ts";
import {
  type PlaceNameReservation,
  placeNameReservation,
  placeNameSchema,
} from "./places.ts";

Deno.test("documents/addressing#R2: name reservation port is a typed transaction-scoped key", () => {
  assertEquals(placeNameReservation.name, "documents.PlaceNameReservation");
  assertNotStrictEquals(
    placeNameReservation,
    definePort<PlaceNameReservation>(placeNameReservation.name),
  );
  const useInTransaction = (tx: Tx): PlaceNameReservation =>
    tx.port(placeNameReservation);
  assertEquals(typeof useInTransaction, "function");
  const place = {
    slug: "mahas",
    kind: "project",
    target: "prj_01arz3ndektsv4rrffq69g5fav",
    reserved_seq: "1",
  };
  assert(placeNameSchema.safeParse(place).success);
  assert(
    placeNameSchema.safeParse({
      ...place,
      kind: "app",
      target: "app_01arz3ndektsv4rrffq69g5fav",
    }).success,
  );
  assert(!placeNameSchema.safeParse({ ...place, kind: "app" }).success);
  assert(!placeNameSchema.safeParse({ ...place, reserved_seq: 1 }).success);
  assert(!placeNameSchema.safeParse({ ...place, slug: "_inbox" }).success);
});
