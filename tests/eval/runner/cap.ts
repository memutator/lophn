// 참가자 agent 비용의 합이 상한을 넘으면 새 trial을 띄우지 않는다.
export type Cap = {
  add(usd: number): void;
  exceeded(): boolean;
  total(): number;
};

// log를 주면 더할 때마다 합계를 찍는다.
export function createCap(limitUsd: number, log?: (line: string) => void): Cap {
  let sum = 0;
  return {
    add: (usd) => {
      sum += usd;
      log?.(`[budget] $${sum.toFixed(2)}/${limitUsd.toFixed(2)}`);
    },
    exceeded: () => sum >= limitUsd,
    total: () => sum,
  };
}
