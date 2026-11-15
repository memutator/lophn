// 기기가 달라도 겹치지 않는 text id다. ULID 꼴(시각 48bit + random 80bit를 소문자 Crockford base32로)이라
// 만든 시각 순으로 정렬된다. 같은 밀리초 안의 순서는 보장하지 않는다.
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

export function newId(prefix?: string): string {
  let time = Date.now();
  let head = "";
  for (let i = 0; i < 10; i++) {
    head = CROCKFORD[time % 32] + head;
    time = Math.floor(time / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let tail = "";
  for (const byte of bytes) tail += CROCKFORD[byte % 32];
  const ulid = head + tail;
  return prefix === undefined || prefix === "" ? ulid : `${prefix}_${ulid}`;
}
