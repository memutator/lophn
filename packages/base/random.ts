export type RandomSource = {
  fill(bytes: Uint8Array): void;
};

export const cryptoRandom: RandomSource = {
  fill(bytes: Uint8Array) {
    // 저장소 전체 형 검사에 npm 형(esbuild 등)이 함께 들면 Uint8Array 기본 buffer가
    // ArrayBufferLike로 넓어진다. getRandomValues는 SharedArrayBuffer를 받지 않는다.
    crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
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
