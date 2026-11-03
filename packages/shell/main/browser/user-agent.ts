// 인터넷 page에 보이는 브라우저 식별. Electron과 앱 이름 token이 남거나, header와 page JS가 다른
// brand를 말하면 Google 로그인 같은 사이트가 shell을 알아보고 막는다. Electron을 모르는 순수 함수다.

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeUserAgent(userAgent: string, product: string): string {
  let result = userAgent.replace(/\sElectron\/[\d.]+/i, "");
  if (product.length > 0) {
    result = result.replace(
      new RegExp(`\\s${escapeRegExp(product)}\\/[\\d.]+`, "i"),
      "",
    );
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

export interface BrandVersion {
  brand: string;
  version: string;
}

const GREASE_CHARS = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"];
const GREASE_VERSIONS = ["8", "99", "24"];
const BRAND_ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
] as const;

/**
 * 이 Chromium 판의 Google Chrome이 내는 brand 목록. GREASE brand와 순서는 major가 seed인 Chromium의
 * `GenerateBrandVersionList`를 그대로 따른다. 다르게 지으면 진짜 Chrome과 어긋나 알아보인다.
 * `full`이면 version이 full version이다(`fullVersionList`, `sec-ch-ua-full-version-list`).
 * UA에서 Chrome 판을 못 읽으면 undefined다.
 */
export function chromeBrands(
  userAgent: string,
  full: boolean,
): BrandVersion[] | undefined {
  const version = /\b(?:Chrome|Chromium)\/(\d+)(\.[\d.]+)?/.exec(userAgent);
  if (version === null) return undefined;
  const seed = Number(version[1]);
  const chrome = full ? `${version[1]}${version[2] ?? ""}` : version[1]!;
  const grease = GREASE_VERSIONS[seed % GREASE_VERSIONS.length]!;
  const list: BrandVersion[] = [];
  const order = BRAND_ORDERS[seed % BRAND_ORDERS.length]!;
  list[order[0]] = {
    brand: `Not${GREASE_CHARS[seed % GREASE_CHARS.length]}A${GREASE_CHARS[(seed + 1) % GREASE_CHARS.length]}Brand`,
    version: full ? `${grease}.0.0.0` : grease,
  };
  list[order[1]] = { brand: "Chromium", version: chrome };
  list[order[2]] = { brand: "Google Chrome", version: chrome };
  return list;
}

function brandHeader(list: BrandVersion[]): string {
  return list
    .map(({ brand, version }) => `"${brand}";v="${version}"`)
    .join(", ");
}

/**
 * page 요청에 이미 실린 brand header를 Chrome 값으로 바꾼다. Chromium이 싣지 않은 header는 더하지
 * 않는다(http page처럼 Chrome도 보내지 않는 곳에 생기면 그것이 표가 된다).
 */
export function rewriteBrandHeaders(
  headers: Record<string, string>,
  userAgent: string,
): void {
  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase();
    if (lower !== "sec-ch-ua" && lower !== "sec-ch-ua-full-version-list")
      continue;
    const list = chromeBrands(userAgent, lower !== "sec-ch-ua");
    if (list !== undefined) headers[name] = brandHeader(list);
  }
}

export interface UserAgentMetadata {
  brands: BrandVersion[];
  fullVersionList: BrandVersion[];
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  mobile: boolean;
  bitness: string;
  wow64: boolean;
  formFactors: string[];
}

/**
 * CDP `Emulation.setUserAgentOverride`의 `userAgentMetadata`. header만 바꾸면 page JS의
 * `navigator.userAgentData`는 Electron 값(Google Chrome brand 없음)이라, page 쪽도 같은 값으로 맞춘다.
 * `systemVersion`은 Electron의 `process.getSystemVersion()`이다.
 */
export function userAgentMetadata(input: {
  userAgent: string;
  platform: string;
  arch: string;
  systemVersion: string;
}): UserAgentMetadata | undefined {
  const brands = chromeBrands(input.userAgent, false);
  const fullVersionList = chromeBrands(input.userAgent, true);
  if (brands === undefined || fullVersionList === undefined) return undefined;
  const [major = "0", minor = "0", patch = "0"] =
    input.systemVersion.match(/\d+/g) ?? [];
  return {
    brands,
    fullVersionList,
    platform:
      input.platform === "darwin"
        ? "macOS"
        : input.platform === "win32"
          ? "Windows"
          : "Linux",
    // Windows Chrome은 OS 판 대신 UniversalApiContract 판을 낸다. Windows 11은 13 이상이다.
    platformVersion:
      input.platform === "win32"
        ? Number(patch) >= 22000
          ? "15.0.0"
          : "10.0.0"
        : `${major}.${minor}.${patch}`,
    architecture: input.arch.startsWith("arm") ? "arm" : "x86",
    model: "",
    mobile: false,
    bitness: input.arch === "ia32" || input.arch === "arm" ? "32" : "64",
    wow64: false,
    formFactors: ["Desktop"],
  };
}
