import type { PlaceStatus } from "./types";
import { UnconfirmedWriteError } from "./verified-write";

/** Show the latest choice immediately; serialize writes so an older request cannot win. */
export class StatusSelection {
  private state: { status: PlaceStatus; pending: boolean };
  private confirmed: PlaceStatus;
  private wanted: PlaceStatus;
  private running = false;
  private listeners = new Set<() => void>();
  constructor(initial: PlaceStatus, private save: (status: PlaceStatus) => Promise<void>,
    private saved: () => void, private failed: (error: unknown) => void) {
    this.confirmed = this.wanted = initial; this.state = { status: initial, pending: false };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private publish(status: PlaceStatus, pending: boolean) {
    if (this.state.status === status && this.state.pending === pending) return;
    this.state = { status, pending }; for (const listener of this.listeners) listener();
  }
  receive(status: PlaceStatus) {
    if (this.running) return;
    this.confirmed = this.wanted = status; this.publish(status, false);
  }
  select(status: PlaceStatus) {
    this.wanted = status; this.publish(status, this.running || status !== this.confirmed);
    if (!this.running && status !== this.confirmed) void this.flush();
  }
  private async flush() {
    this.running = true; let changed = false, lastError: unknown = null;
    while (this.wanted !== this.confirmed) {
      const target = this.wanted;
      try { await this.save(target); this.confirmed = target; changed = true; lastError = null; }
      catch (error) {
        lastError = error;
        if (error instanceof UnconfirmedWriteError) { this.wanted = this.confirmed; break; }
        if (this.wanted === target) this.wanted = this.confirmed;
      }
      this.publish(this.wanted, true);
    }
    this.running = false; this.publish(this.wanted, false);
    if (lastError) this.failed(lastError); else if (changed) this.saved();
  }
}
