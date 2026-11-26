/**
 * Bounded FIFO queue for `/api/reverse`.
 *
 * `rea` runs as a child process, so an unbounded endpoint can spawn one per
 * request. `run()` hands out at most `concurrency` slots, makes the rest wait
 * in arrival order, and rejects waiters that exceed `queueTimeoutMs` with
 * `reverse_busy` instead of letting the backlog grow without limit.
 */

export type ReverseQueueCode = "reverse_busy" | "reverse_timeout";

export class ReverseQueueError extends Error {
  constructor(
    readonly code: ReverseQueueCode,
    message: string,
  ) {
    super(message);
    this.name = "ReverseQueueError";
  }
}

export interface ReverseQueueOptions {
  /** Simultaneous reverse jobs (default 2). */
  concurrency?: number;
  /** How long a request may wait for a slot (default 30s; 0 disables waiting). */
  queueTimeoutMs?: number;
  /** Per-job budget (default 120s; 0 or Infinity disables the timeout). */
  timeoutMs?: number;
}

export interface ReverseQueue {
  readonly concurrency: number;
  readonly queueTimeoutMs: number;
  readonly timeoutMs: number;
  /** Resolves with the task result, or rejects with a `ReverseQueueError`. */
  run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>;
  /** Jobs holding a slot plus jobs waiting for one. */
  readonly size: number;
}

interface Waiter {
  grant: () => void;
  fail: (error: Error) => void;
}

export function createReverseQueue(options: ReverseQueueOptions = {}): ReverseQueue {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 2));
  const queueTimeoutMs = Math.max(0, Math.floor(options.queueTimeoutMs ?? 30_000));
  const timeoutMs = Math.max(0, Math.floor(options.timeoutMs ?? 120_000));

  let active = 0;
  const waiting: Waiter[] = [];

  const acquire = (): Promise<void> =>
    new Promise<void>((grantSlot, failSlot) => {
      if (active < concurrency) {
        active += 1;
        grantSlot();
        return;
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter: Waiter = {
        grant: () => {
          if (timer) clearTimeout(timer);
          grantSlot();
        },
        fail: (error) => {
          if (timer) clearTimeout(timer);
          failSlot(error);
        },
      };

      if (queueTimeoutMs > 0) {
        timer = setTimeout(() => {
          const index = waiting.indexOf(waiter);
          if (index >= 0) waiting.splice(index, 1);
          failSlot(
            new ReverseQueueError(
              "reverse_busy",
              `reverse queue is full; retry in ${Math.ceil(queueTimeoutMs / 1000)}s`,
            ),
          );
        }, queueTimeoutMs);
        // Do not keep the process alive for a waiter.
        timer.unref?.();
      }

      waiting.push(waiter);
    });

  const release = () => {
    active -= 1;
    const next = waiting.shift();
    if (!next) return;
    active += 1;
    next.grant();
  };

  return {
    concurrency,
    queueTimeoutMs,
    timeoutMs,
    get size() {
      return active + waiting.length;
    },
    async run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      await acquire();
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (timeoutMs <= 0) return await task(controller.signal);

        const expired = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new ReverseQueueError(
                "reverse_timeout",
                `reverse engineering exceeded ${Math.ceil(timeoutMs / 1000)}s`,
              ),
            );
          }, timeoutMs);
          timer.unref?.();
        });

        return await Promise.race([task(controller.signal), expired]);
      } finally {
        if (timer) clearTimeout(timer);
        release();
      }
    },
  };
}
