import { randomUUID } from "node:crypto";

/**
 * In-memory job store for `POST /api/reverse/jobs` plus the SSE progress
 * stream. Jobs are deliberately ephemeral: the store keeps finished jobs for a
 * few minutes so a late `GET`/reconnect can replay the events, then drops them.
 */

export type ReverseJobEventType = "scan" | "rea" | "merge" | "validate" | "done" | "error";
export type ReverseJobState = "running" | "done" | "error";

export interface ReverseJobEvent {
  seq: number;
  type: ReverseJobEventType;
  at: string;
  message?: string;
  payload?: unknown;
}

export interface ReverseJob {
  id: string;
  createdAt: number;
  state: ReverseJobState;
  events: ReverseJobEvent[];
  finishedAt?: number;
}

export interface JobStoreOptions {
  /** How long finished jobs stay replayable (default 5 minutes). */
  ttlMs?: number;
  /** Hard cap on retained jobs (default 50). */
  maxJobs?: number;
  now?: () => number;
}

export type JobListener = (event: ReverseJobEvent) => void;

export interface JobStore {
  create(): ReverseJob;
  emit(id: string, type: ReverseJobEventType, extra?: { message?: string; payload?: unknown }): ReverseJobEvent | undefined;
  finish(id: string, type: "done" | "error", payload?: unknown): void;
  get(id: string): ReverseJob | undefined;
  subscribe(id: string, listener: JobListener): () => void;
  prune(): void;
  readonly size: number;
}

export function createJobStore(options: JobStoreOptions = {}): JobStore {
  const ttlMs = options.ttlMs ?? 5 * 60 * 1000;
  const maxJobs = options.maxJobs ?? 50;
  const now = options.now ?? Date.now;
  const jobs = new Map<string, ReverseJob>();
  const listeners = new Map<string, Set<JobListener>>();

  const prune = () => {
    const cutoff = now() - ttlMs;
    for (const [id, job] of jobs) {
      if (job.finishedAt !== undefined && job.finishedAt < cutoff) {
        jobs.delete(id);
        listeners.delete(id);
      }
    }
    while (jobs.size > maxJobs) {
      const oldest = jobs.keys().next();
      if (oldest.done) break;
      jobs.delete(oldest.value);
      listeners.delete(oldest.value);
    }
  };

  const store: JobStore = {
    create() {
      prune();
      const job: ReverseJob = {
        id: randomUUID(),
        createdAt: now(),
        state: "running",
        events: [],
      };
      jobs.set(job.id, job);
      return job;
    },

    emit(id, type, extra = {}) {
      const job = jobs.get(id);
      if (!job || job.state !== "running") return undefined;
      const event: ReverseJobEvent = {
        seq: job.events.length + 1,
        type,
        at: new Date(now()).toISOString(),
        ...(extra.message ? { message: extra.message } : {}),
        ...(extra.payload !== undefined ? { payload: extra.payload } : {}),
      };
      job.events.push(event);
      for (const listener of listeners.get(id) ?? []) {
        try {
          listener(event);
        } catch {
          // A broken stream must not break the job.
        }
      }
      return event;
    },

    finish(id, type, payload) {
      const job = jobs.get(id);
      if (!job || job.state !== "running") return;
      store.emit(id, type, payload === undefined ? {} : { payload });
      job.state = type === "done" ? "done" : "error";
      job.finishedAt = now();
      listeners.delete(id);
    },

    get(id) {
      return jobs.get(id);
    },

    subscribe(id, listener) {
      const set = listeners.get(id) ?? new Set<JobListener>();
      set.add(listener);
      listeners.set(id, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(id);
      };
    },

    prune,
    get size() {
      return jobs.size;
    },
  };

  return store;
}
