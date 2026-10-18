// 대상 model과 judge 비용의 합이 상한을 넘으면 새 trial을 띄우지 않는다.
export type Cap = {
  add(usd: number): void;
  exceeded(): boolean;
  total(): number;
};

export function createCap(limitUsd: number): Cap {
  let sum = 0;
  return {
    add: (usd) => {
      sum += usd;
    },
    exceeded: () => sum >= limitUsd,
    total: () => sum,
  };
}
