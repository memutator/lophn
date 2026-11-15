// 앱 process가 사람의 기준 폰에서 위치를 한 번 읽는다. 폰 앱이 앞에 떠 있을 때만 답하고 폰을 깨우지 않는다.
// 앱 UI view(브라우저 쪽)에서는 부르지 못하고, command·operation·flow·시작 코드에서 부른다.
import { CapabilityError, fromBroker, missingHost } from "./errors.ts";
import { type CapHost, readHost } from "./host.ts";

export const PHONE_REQUEST_PATH = "/_lophn/broker/phone/request";

// protocol/phone/kinds.ts의 location.get 입력·답과 같은 모양이다(SDK는 protocol을 import할 수 없어 사본으로 둔다).
const ACCURACIES = ["low", "balanced", "high"] as const;
export const MAX_AGE_MS_MAX = 300_000;

export type LocationAccuracy = (typeof ACCURACIES)[number];

export type LocationOptions = {
  // 기본은 balanced다(폰이 적용한다).
  accuracy?: LocationAccuracy;
  // 이 시간 안에 잰 위치면 새로 재지 않고 쓴다. 0..300000 정수, 기본은 0(새로 잰다).
  maxAgeMs?: number;
};

export type PhoneLocation = {
  lat: number;
  lon: number;
  accuracyM: number;
  // ISO 8601 UTC 시각이다.
  at: string;
  // live가 아니라 고정 위치를 돌려줬다.
  standIn?: true;
};

export type PhoneClient = {
  getLocation(options?: LocationOptions): Promise<PhoneLocation>;
};

export type PhoneClientDeps = { host?: CapHost };

function invalid(message: string): CapabilityError {
  return new CapabilityError({ code: "invalid_input", message });
}

function check(options: LocationOptions): void {
  if (
    options.accuracy !== undefined &&
    !ACCURACIES.includes(options.accuracy)
  ) {
    throw invalid("accuracy must be low, balanced or high");
  }
  if (
    options.maxAgeMs !== undefined &&
    (!Number.isInteger(options.maxAgeMs) ||
      options.maxAgeMs < 0 ||
      options.maxAgeMs > MAX_AGE_MS_MAX)
  ) {
    throw invalid(`maxAgeMs must be an integer from 0 to ${MAX_AGE_MS_MAX}`);
  }
}

function num(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && value >= min && value <= max;
}

function fromValue(body: unknown): PhoneLocation {
  const value = (body as { value?: Record<string, unknown> } | null)?.value;
  if (
    value &&
    num(value.lat, -90, 90) &&
    num(value.lon, -180, 180) &&
    num(value.accuracy_m, 0, Number.POSITIVE_INFINITY) &&
    typeof value.at === "string"
  ) {
    return {
      lat: value.lat,
      lon: value.lon,
      accuracyM: value.accuracy_m,
      at: value.at,
    };
  }
  throw new CapabilityError({
    code: "internal",
    message: "phone returned a location in an unexpected shape",
  });
}

export function createPhoneClient(deps: PhoneClientDeps = {}): PhoneClient {
  return {
    async getLocation(options = {}) {
      check(options);
      const host = deps.host ?? readHost();
      if (!host) throw missingHost();
      // preview·test는 사람의 폰에 닿지 않는다. 서울시청의 고정 위치다.
      if (host.mode !== "live") {
        return {
          lat: 37.5663,
          lon: 126.9779,
          accuracyM: 50,
          at: new Date().toISOString(),
          standIn: true,
        };
      }
      const requested = {
        permission: "phone.use",
        scope: { capability: "location.get" },
      };
      let response;
      try {
        response = await host.post(PHONE_REQUEST_PATH, {
          capability: "location.get",
          input: {
            ...(options.accuracy === undefined
              ? {}
              : { accuracy: options.accuracy }),
            ...(options.maxAgeMs === undefined
              ? {}
              : { max_age_ms: options.maxAgeMs }),
          },
        });
      } catch {
        throw new CapabilityError({
          code: "unavailable",
          message: "phone could not reach the broker",
        });
      }
      if (response.status !== 200) throw fromBroker(response.body, requested);
      return fromValue(response.body);
    },
  };
}

// 앱 코드가 쓰는 기본 client다. host는 호출할 때 읽는다.
const shared = createPhoneClient();

export function getLocation(options?: LocationOptions): Promise<PhoneLocation> {
  return shared.getLocation(options);
}
