// src/hitl/index.ts
// Public HITL exports used by the daemon and CLI commands.

export { gateOne }                      from './plan-approval.js';
export { gateTwo }                      from './merge-approval.js';
export { enqueueGate, reQueuePendingGates } from './gate-queue.js';
