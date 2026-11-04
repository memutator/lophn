const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * core가 받는 메시지 id(`msg_` + 26자 ULID)를 만든다. 시각 48bit와 무작위 80bit를 앞 2bit를 0으로 채운 130bit에 담는다.
 * 시각과 무작위는 인자로 받는다.
 */
export function newMessageId(
  now: () => number = Date.now,
  random: (length: number) => Uint8Array = (length) =>
    crypto.getRandomValues(new Uint8Array(length)),
): string {
  let bits = BigInt(now());
  for (const byte of random(10)) {
    bits = (bits << 8n) | BigInt(byte);
  }
  let text = "";
  for (let at = 0; at < 26; at += 1) {
    text = CROCKFORD[Number(bits & 31n)] + text;
    bits >>= 5n;
  }
  return `msg_${text}`;
}
