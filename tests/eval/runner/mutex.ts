// registry 같은 file을 trial 여럿이 동시에 쓰면 표가 깨진다. 호출을 줄 세워 하나씩 돌린다.
let tail: Promise<unknown> = Promise.resolve();

export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch(() => {});
  return run;
}
