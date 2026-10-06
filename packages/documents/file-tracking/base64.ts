// 파일 바이트를 JSON 응답에 싣는 base64. 한 응답 frame(1 MiB)에 들어가는 읽기에 쓴다.
export function toBase64(bytes: Uint8Array): string {
  let text = "";
  const step = 0x8000;
  for (let at = 0; at < bytes.length; at += step) {
    text += String.fromCharCode(...bytes.subarray(at, at + step));
  }
  return btoa(text);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return bytes;
}
