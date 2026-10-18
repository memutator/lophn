// page favicon을 shell 화면이 그릴 수 있는 data URL로 바꾼다. shell CSP는 img-src data:만 받고,
// shell 화면이 인터넷에 직접 요청하지 않게 main이 그 page의 session으로 받아 온다.
const BODY_MAX = 48 * 1024;
const DATA_URL_MAX = 65536;

type Fetch = (url: string) => Promise<{
  ok: boolean;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** 바꿀 수 없으면(다른 scheme, 실패, 너무 큼, image 아님) null. */
export async function faviconData(
  url: string,
  fetch: Fetch,
): Promise<string | null> {
  if (url.startsWith("data:")) {
    return url.startsWith("data:image/") && url.length <= DATA_URL_MAX
      ? url
      : null;
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
  try {
    const response = await fetch(url);
    const type = response.headers.get("content-type")?.split(";")[0]?.trim();
    if (!response.ok || type === undefined || !type.startsWith("image/")) {
      return null;
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > BODY_MAX) return null;
    const data = `data:${type};base64,${Buffer.from(body).toString("base64")}`;
    return data.length <= DATA_URL_MAX ? data : null;
  } catch {
    return null;
  }
}
