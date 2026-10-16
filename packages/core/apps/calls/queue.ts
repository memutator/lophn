// 앱마다 write·external을 한 번에 하나씩 돌리는 줄이다. read는 이 줄을 쓰지 않는다.
// 키는 앱이다. 호출이 끝나면 release를 부르고, 줄을 정리하면(reset) 기다리던 쪽은 null을 받는다.
type Release = () => void;

type Lane = { waiters: ((release: Release | null) => void)[] };

export type WriteQueue = {
  acquire(key: string): Promise<Release | null>;
  // 도는 쪽이 돌아오지 않아도 줄이 영영 막히지 않게 한다. 이미 준 release는 효과가 없어진다.
  reset(key: string): void;
};

export function createWriteQueue(): WriteQueue {
  const lanes = new Map<string, Lane>();

  function releaser(key: string, lane: Lane): Release {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      if (lanes.get(key) !== lane) return;
      const next = lane.waiters.shift();
      if (next) next(releaser(key, lane));
      else lanes.delete(key);
    };
  }

  return {
    acquire(key) {
      const lane = lanes.get(key);
      if (!lane) {
        const fresh: Lane = { waiters: [] };
        lanes.set(key, fresh);
        return Promise.resolve(releaser(key, fresh));
      }
      return new Promise((resolve) => lane.waiters.push(resolve));
    },
    reset(key) {
      const lane = lanes.get(key);
      if (!lane) return;
      lanes.delete(key);
      for (const waiter of lane.waiters) waiter(null);
    },
  };
}
