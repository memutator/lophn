import { err, ok } from "../../../base/mod.ts";
import {
  type LocationGetInput,
  PHONE_OS_PERMISSION_DENIED,
} from "../../../protocol/phone/kinds.ts";
import type { PhoneHandler } from "./answer.ts";

export type LocationFix = {
  lat: number;
  lon: number;
  accuracyM: number;
  atMs: number;
};

// The native calls `location.get` needs. `native.ts` is the real one; tests pass a fake.
export type LocationPort = {
  // True when the OS location permission is granted. Asks the person only if they were never asked.
  permission(): Promise<boolean>;
  servicesEnabled(): Promise<boolean>;
  lastKnown(maxAgeMs: number): Promise<LocationFix | null>;
  current(accuracy: NonNullable<LocationGetInput["accuracy"]>): Promise<LocationFix>;
};

export const locationGet: PhoneHandler<"location.get"> = async (
  input,
  { location },
) => {
  if (!(await location.permission())) {
    return err({
      code: "forbidden",
      message: "location permission is denied on the phone",
      details: { reason: PHONE_OS_PERMISSION_DENIED },
    });
  }
  if (!(await location.servicesEnabled())) {
    return err({
      code: "unavailable",
      message: "location_off",
      details: { reason: "location_off" },
    });
  }
  const cached = input.max_age_ms
    ? await location.lastKnown(input.max_age_ms)
    : null;
  const fix = cached ?? (await location.current(input.accuracy ?? "balanced"));
  return ok({
    lat: fix.lat,
    lon: fix.lon,
    accuracy_m: fix.accuracyM,
    at: new Date(fix.atMs).toISOString(),
  });
};
