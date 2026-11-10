// A cancelled HTTP request can finish on the client before its browser/process
// cleanup has released the server lease. Only that cleanup may be awaited;
// genuinely concurrent sign-ins must remain rejected.
export class AntigravitySignInGate {
  private active?: { signal: AbortSignal; done: Promise<void> };

  constructor(private readonly cleanupTimeoutMs = 5_000) {}

  async run(signal: AbortSignal, signIn: (signal: AbortSignal) => Promise<void>): Promise<boolean> {
    signal.throwIfAborted();
    const previous = this.active;
    if (previous) {
      if (!previous.signal.aborted || !await this.waitForCleanup(previous.done, signal)) return false;
    }
    signal.throwIfAborted();
    // Multiple retries may have awaited the same cleanup. Claim synchronously
    // and recheck so only one can start a new browser or write credentials.
    if (this.active) return false;
    const entry = { signal, done: Promise.resolve().then(() => signIn(signal)).finally(() => {
      if (this.active === entry) this.active = undefined;
    }) };
    this.active = entry;
    await entry.done;
    return true;
  }

  private waitForCleanup(done: Promise<void>, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const finish = (ready: boolean) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        resolve(ready);
      };
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(signal.reason);
      };
      const timer = setTimeout(() => finish(false), this.cleanupTimeoutMs);
      timer.unref();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      void done.then(() => finish(true), () => finish(true));
    });
  }
}
