// 크기를 막은 LRU. Map의 삽입 순서로 가장 오래 안 쓴 것을 버린다.
export class Lru<K, V> {
  private readonly map = new Map<K, V>();
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.limit) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
  }

  get size(): number {
    return this.map.size;
  }
}
