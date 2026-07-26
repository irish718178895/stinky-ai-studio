import crypto from "node:crypto";

const TERMINAL_STATUSES = new Set(["complete", "complete-with-errors", "cancelled", "error"]);
const DEFAULT_RETENTION_MS = 6 * 60 * 60 * 1000;

class JobManager {
  constructor({ retentionMs = DEFAULT_RETENTION_MS } = {}) {
    this.jobs = new Map();
    this.retentionMs = retentionMs;

    const cleanupInterval = Math.min(Math.max(60_000, Math.floor(retentionMs / 2)), 30 * 60_000);
    this.cleanupTimer = setInterval(() => this.prune(), cleanupInterval);
    this.cleanupTimer.unref?.();
  }

  create(type, fields = {}) {
    const now = new Date().toISOString();
    const job = {
      id: crypto.randomUUID(),
      type,
      status: "queued",
      progress: 0,
      stage: "Queued",
      cancelRequested: false,
      cancelled: false,
      error: null,
      createdAt: now,
      updatedAt: now,
      ...fields
    };

    this.jobs.set(job.id, job);
    return job;
  }

  get(id, type = null) {
    const job = this.jobs.get(id);
    if (!job || (type && job.type !== type)) return null;
    return job;
  }

  patch(jobOrId, patch = {}) {
    const job = typeof jobOrId === "string" ? this.get(jobOrId) : jobOrId;
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    return job;
  }

  requestCancel(jobOrId, stage = "Cancellation requested") {
    const job = typeof jobOrId === "string" ? this.get(jobOrId) : jobOrId;
    if (!job || TERMINAL_STATUSES.has(job.status)) return job;
    return this.patch(job, { cancelRequested: true, stage });
  }

  isTerminal(jobOrStatus) {
    return TERMINAL_STATUSES.has(typeof jobOrStatus === "string" ? jobOrStatus : jobOrStatus?.status);
  }

  snapshot(job, fields = null) {
    if (!job) return null;
    if (!fields) return structuredClone(job);
    return Object.fromEntries(fields.map(field => [field, structuredClone(job[field] ?? null)]));
  }

  prune() {
    const cutoff = Date.now() - this.retentionMs;
    for (const [id, job] of this.jobs) {
      if (!this.isTerminal(job)) continue;
      const timestamp = Date.parse(job.updatedAt || job.createdAt || 0);
      if (Number.isFinite(timestamp) && timestamp < cutoff) this.jobs.delete(id);
    }
  }
}

export const jobs = new JobManager();
export { JobManager, TERMINAL_STATUSES };
