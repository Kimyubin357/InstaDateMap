import { RequestError, uncertainResponse } from "./client-request";

export const CHECKING_SAVE = "응답이 늦어지고 있어요. 저장 여부를 확인할게요.";
export class UnconfirmedWriteError extends Error {
  constructor(message = "저장 여부를 아직 확인하지 못했어요. 입력한 내용은 유지했어요. 다시 누르면 저장 여부부터 확인해요.") { super(message); }
}

/** Keep the original operation after a lost response. A user retry reads first, then replays the same idempotent write. */
export class VerifiedWrite<T> {
  private operation: { send: () => Promise<T>; verify: () => Promise<T | null> } | null = null;
  private flight: Promise<T> | null = null;
  get pending() { return this.operation !== null; }
  run(send: () => Promise<T>, verify: () => Promise<T | null>, checking: () => void): Promise<T> {
    if (this.flight) return this.flight;
    const flight = this.execute(send, verify, checking).finally(() => { if (this.flight === flight) this.flight = null; });
    this.flight = flight;
    return flight;
  }
  private async execute(send: () => Promise<T>, verify: () => Promise<T | null>, checking: () => void): Promise<T> {
    if (this.operation) {
      const previous = this.operation;
      // Never issue another write if the readback is unavailable or still processing.
      let result: T | null;
      try { result = await previous.verify(); }
      catch (error) { if (error instanceof RequestError && [401, 404, 409].includes(error.status)) this.operation = null; throw error; }
      if (result !== null) { this.operation = null; return result; }
      send = previous.send; verify = previous.verify;
    }
    try { const result = await send(); this.operation = null; return result; }
    catch (error) {
      if (!uncertainResponse(error)) { this.operation = null; throw error; }
      this.operation = { send, verify }; checking();
      try {
        const result = await verify();
        if (result !== null) { this.operation = null; return result; }
      } catch (verificationError) {
        // A definite missing-place response must reach the deletion UI.
        if (verificationError instanceof RequestError && [401, 404, 409].includes(verificationError.status)) { this.operation = null; throw verificationError; }
      }
      throw new UnconfirmedWriteError();
    }
  }
}
