// 인터넷 page에 보이는 UA. Electron과 앱 이름 token이 남으면 사이트가 shell을 알아보고 막는다.
// Electron을 모르는 순수 함수다.

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

function platformName(platform: string): string {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  return "Linux";
}

/**
 * client hints는 UA와 맞아야 한다. 어긋나면 `sec-ch-ua`와 UA를 견주어 shell을 알아본다.
 * `Google Chrome` brand는 Google 로그인이 막히지 않게 넣는다. Chromium major를 못 읽으면 빈 객체다.
 */
export function clientHintHeaders(
  userAgent: string,
  platform: string,
): Record<string, string> {
  const major = /\b(?:Chrome|Chromium)\/(\d+)\./.exec(userAgent)?.[1];
  if (major === undefined) return {};
  return {
    "sec-ch-ua": `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not=A?Brand";v="24"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"${platformName(platform)}"`,
  };
}
