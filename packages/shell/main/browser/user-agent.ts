// 인터넷 page에 보이는 UA. Electron을 모르는 순수 함수다.

/**
 * `Electron/x`만 뺀다. Electron을 보고 막는 사이트가 있다. 앱 이름 token(`lophn/x`)은 남긴다.
 * 순수 Chrome처럼 보이는데 Chrome이 아니면 Google 로그인이 "This browser or app may not be secure"로
 * 막는다. Edge·Brave처럼 자기 token을 단 Chromium 브라우저는 받는다.
 */
export function browserUserAgent(userAgent: string): string {
  return userAgent
    .replace(/\sElectron\/[\d.]+/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
