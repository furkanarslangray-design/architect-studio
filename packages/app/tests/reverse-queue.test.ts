import { describe, expect, it } from "vitest";
import { createReverseQueue, ReverseQueueError } from "../src/reverse-queue";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("createReverseQueue", () => {
  it("never runs more than the configured number of jobs", async () => {
    const queue = createReverseQueue({ concurrency: 2, queueTimeoutMs: 0 });
    const gates = [deferred(), deferred(), deferred(), deferred()];
    let active = 0;
    let peak = 0;

    const jobs = gates.map((gate) =>
      queue.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
      }),
    );

    await tick();
    expect(queue.size).toBe(4);

    gates[0].resolve();
    await tick();
    // The third job took the freed slot; the fourth is still waiting.
    expect(active).toBe(2);

    gates[2].resolve();
    await tick();
    gates[1].resolve();
    gates[3].resolve();
    await Promise.all(jobs);
    expect(peak).toBe(2);
    expect(queue.size).toBe(0);
  });

  it("rejects a waiter that exceeds the queue timeout with reverse_busy", async () => {
    const queue = createReverseQueue({ concurrency: 1, queueTimeoutMs: 20 });
    const running = deferred();
    const first = queue.run(async () => {
      await running.promise;
    });

    await tick();
    const queued = queue.run(async () => "unreachable");
    await expect(queued).rejects.toBeInstanceOf(ReverseQueueError);
    await expect(queued).rejects.toMatchObject({ code: "reverse_busy" });

    running.resolve();
    await first;
    expect(queue.size).toBe(0);
  });

  it("rejects a job that exceeds its budget and aborts its signal", async () => {
    const queue = createReverseQueue({ concurrency: 1, timeoutMs: 20 });
    let aborted = false;

    const slow = queue.run(
      (signal) =>
        new Promise<string>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          // Never settles by itself: the queue must enforce the budget.
          setTimeout(() => resolve("late"), 5_000).unref?.();
        }),
    );

    await expect(slow).rejects.toMatchObject({ code: "reverse_timeout" });
    expect(aborted).toBe(true);
    expect(queue.size).toBe(0);
  });

  it("frees the slot when a job throws", async () => {
    const queue = createReverseQueue({ concurrency: 1, queueTimeoutMs: 0 });
    await expect(
      queue.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(queue.run(async () => "next")).resolves.toBe("next");
  });
});
