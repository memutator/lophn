import { err, ok } from "../../../base/mod.ts";
import type { LocationGetInput } from "../../../protocol/phone/capabilities.ts";
import { PHONE_OS_PERMISSION_DENIED } from "../../../protocol/phone/kinds.ts";
import type { CapabilityHandler } from "./capabilities.ts";

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

const SETTINGS_DECLINED = "ERR_LOCATION_SETTINGS_UNSATISFIED";

export const locationGet: CapabilityHandler<"location.get"> = async (
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
  let fix: LocationFix;
  try {
    const cached = input.max_age_ms
      ? await location.lastKnown(input.max_age_ms)
      : null;
    fix = cached ?? (await location.current(input.accuracy ?? "balanced"));
  } catch (thrown) {
    // Google Play services asks to turn on "Location Accuracy"; declining it makes expo-location reject with this code.
    // expo-modules-core infers a Kotlin exception's code from its class name (`LocationSettingsUnsatisfiedException`), so
    // the release build keeps those classes' names and keeps R8 from merging them (`extraProguardRules` in app.json).
    if ((thrown as { code?: unknown } | null)?.code === SETTINGS_DECLINED) {
      return err({
        code: "unavailable",
        message: "location_off",
        details: { reason: "location_off" },
      });
    }
    throw thrown;
  }
  return ok({
    lat: fix.lat,
    lon: fix.lon,
    accuracy_m: fix.accuracyM,
    at: new Date(fix.atMs).toISOString(),
  });
};
