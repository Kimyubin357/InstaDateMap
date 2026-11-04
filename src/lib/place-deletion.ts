import { ConnectionError, requestJson } from "./client-request";
import { verifyDeletedPlace } from "./save-recovery";
import { UnconfirmedWriteError, VerifiedWrite } from "./verified-write";

type DeletedPlace = { ok: boolean; deleted_id: string };

/** A retry checks the original place before replaying its idempotent soft deletion. */
export class PlaceDeletion {
  private write = new VerifiedWrite<DeletedPlace>();
  constructor(private id: string) {}
  get pending() { return this.write.pending; }
  async run(checking: () => void) {
    try {
      return await this.write.run(async () => {
        const result = await requestJson<DeletedPlace>(`/api/places/${this.id}`, { method: "DELETE" });
        if (result.ok !== true || result.deleted_id !== this.id) throw new ConnectionError("삭제 결과를 확인하지 못했어요.");
        return result;
      }, () => verifyDeletedPlace(this.id), checking);
    } catch (error) {
      if (error instanceof UnconfirmedWriteError) throw new UnconfirmedWriteError("삭제 여부를 아직 확인하지 못했어요. 다시 누르면 삭제 여부부터 확인해요.");
      throw error;
    }
  }
}

/** Keep each place's receipt so partial progress and uncertain requests survive a retry. */
export class PlaceDeletionBatch {
  private operations: Map<string, PlaceDeletion>;
  private completed = new Set<string>();
  private flight: Promise<void> | null = null;
  constructor(ids: string[]) { this.operations = new Map([...new Set(ids)].map((id) => [id, new PlaceDeletion(id)])); }
  get completedIds() { return [...this.completed]; }
  get pending() { return [...this.operations.values()].some((operation) => operation.pending); }
  run(onDeleted: (id: string) => void, checking: () => void): Promise<void> {
    if (this.flight) return this.flight;
    const flight = this.execute(onDeleted, checking).finally(() => { if (this.flight === flight) this.flight = null; });
    this.flight = flight;
    return flight;
  }
  private async execute(onDeleted: (id: string) => void, checking: () => void) {
    for (const [id, operation] of this.operations) {
      if (this.completed.has(id)) continue;
      await operation.run(checking);
      this.completed.add(id);
      onDeleted(id);
    }
  }
}
