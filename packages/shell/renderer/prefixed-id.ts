// `<prefix>_<ULID>` id를 renderer에서 지을 때 쓴다.

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * `<prefix>_<ULID>` id. 앞 10자는 시각, 뒤 16자는 무작위다. 시각과 무작위는 테스트가
 * 고정한다.
 */
export function newId(
  prefix: string,
  now: number = Date.now(),
  random: (size: number) => Uint8Array = (size) =>
    crypto.getRandomValues(new Uint8Array(size)),
): string {
  let time = "";
  let rest = Math.max(0, Math.floor(now));
  for (let index = 0; index < 10; index += 1) {
    time = CROCKFORD[rest % 32]! + time;
    rest = Math.floor(rest / 32);
  }
  const bytes = random(16);
  let tail = "";
  for (let index = 0; index < 16; index += 1) {
    tail += CROCKFORD[(bytes[index] ?? 0) % 32]!;
  }
  return `${prefix}_${time}${tail}`;
}
