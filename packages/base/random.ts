export type RandomSource = {
  fill(bytes: Uint8Array): void;
};

export const cryptoRandom: RandomSource = {
  fill(bytes: Uint8Array) {
    crypto.getRandomValues(bytes);
  },
};

// 테스트가 매번 같은 값을 받게 하는 결정적 source(mulberry32).
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return {
    fill(bytes: Uint8Array) {
      for (let i = 0; i < bytes.length; i++) {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        bytes[i] = (t ^ (t >>> 14)) >>> 0;
      }
    },
  };
}
