import { DomainError } from "../../../persistence/src/store.js";

// Process-local pilot boundary. Hosting must also cap traffic before application entry.
export class RateLimitService {
  private readonly buckets = new Map<string, { count: number; expires: number }>();
  constructor(private readonly maximum = 60, private readonly windowMs = 60000, private readonly capacity = 10000, private readonly now = Date.now) {}
  check(key: string): void {
    const now = this.now();
    const bucket = this.buckets.get(key);
    if (bucket && bucket.expires > now) {
      if (bucket.count >= this.maximum) throw new DomainError("Rate limited", "RATE_LIMITED");
      bucket.count++; return;
    }
    if (this.buckets.size >= this.capacity) {
      for (const [id, entry] of this.buckets) if (entry.expires <= now) this.buckets.delete(id);
      if (this.buckets.size >= this.capacity && !this.buckets.has(key)) throw new DomainError("Rate limited", "RATE_LIMITED");
    }
    this.buckets.set(key, { count: 1, expires: now + this.windowMs });
  }
}
