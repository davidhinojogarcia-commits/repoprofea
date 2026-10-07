// Short-lived, memory-only cache. Never stores failed reads or mutation results.
export class ReadResponseCache {
  private entries = new Map<string, { value: any; until: number; bytes: number }>();
  private generation = 0;
  private bytes = 0;
  constructor(private now = () => Date.now(), private maxBytes = 4 * 1024 * 1024) {}

  clear() {
    this.generation++;
    this.entries.clear();
    this.bytes = 0;
  }

  async read<T>(key: string, load: () => Promise<T>, ttl = 15_000): Promise<T> {
    const entry = this.entries.get(key);
    if (ttl > 0 && entry && entry.until > this.now()) return structuredClone(entry.value);
    if (entry) { this.entries.delete(key); this.bytes -= entry.bytes; }
    const generation = this.generation;
    const value = await load();
    if (ttl <= 0 || generation !== this.generation) return value;
    const encoded = JSON.stringify(value);
    const bytes = encoded ? new TextEncoder().encode(encoded).byteLength : 0;
    // Large documents and signature payloads must not fill the read cache.
    if (bytes > 2 * 1024 * 1024 || bytes > this.maxBytes) return value;
    const previous = this.entries.get(key);
    if (previous) { this.entries.delete(key); this.bytes -= previous.bytes; }
    for (const [oldKey, old] of this.entries) {
      if (old.until <= this.now() || this.entries.size >= 80 || this.bytes + bytes > this.maxBytes) {
        this.entries.delete(oldKey); this.bytes -= old.bytes;
      }
    }
    this.entries.set(key, { value: structuredClone(value), until: this.now() + ttl, bytes });
    this.bytes += bytes;
    return value;
  }
}
