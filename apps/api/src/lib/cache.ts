/** Tiny in-process TTL cache for hot, small lookups (membership checks, shop by slug). */
export class TtlCache<V> {
  private map = new Map<string, { v: V; exp: number }>();
  constructor(
    private ttlMs: number,
    private max = 5000,
  ) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.exp < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.v;
  }
  set(key: string, v: V) {
    if (this.map.size >= this.max) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
    this.map.set(key, { v, exp: Date.now() + this.ttlMs });
  }
  delete(key: string) {
    this.map.delete(key);
  }
  deleteByPrefix(prefix: string) {
    for (const key of this.map.keys()) if (key.startsWith(prefix)) this.map.delete(key);
  }
}
