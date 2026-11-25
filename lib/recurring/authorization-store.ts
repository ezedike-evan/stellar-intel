import type { SignedStandingAuthorization, StandingAuthorizationStatus } from '@/types/recurring';

export interface StandingAuthorizationRecord {
  id: string;
  termsHash: string;
  authorization: SignedStandingAuthorization;
  status: StandingAuthorizationStatus;
  createdAt: string;
  updatedAt: string;
}

export type StandingExecutionStatus = 'confirmed' | 'rejected';

export interface StandingExecutionRecord {
  id: string;
  authorizationId: string;
  cycleNumber: number;
  periodIndex: number;
  amount: string;
  anchorId: string;
  intentHash: string;
  transactionId: string | null;
  status: StandingExecutionStatus;
  rejectCode: string | null;
  createdAt: string;
}

export interface StandingAuthorizationStore {
  create(
    record: StandingAuthorizationRecord
  ): Promise<{ ok: true } | { ok: false; code: 'duplicate' }>;
  get(id: string): Promise<StandingAuthorizationRecord | null>;
  setStatus(
    id: string,
    status: StandingAuthorizationStatus,
    updatedAt: string
  ): Promise<StandingAuthorizationRecord | null>;
  appendExecution(
    exec: StandingExecutionRecord
  ): Promise<{ ok: true } | { ok: false; code: 'duplicate_cycle' }>;
  listExecutions(authorizationId: string): Promise<StandingExecutionRecord[]>;
}

export class InMemoryStandingAuthorizationStore implements StandingAuthorizationStore {
  private authorizations = new Map<string, StandingAuthorizationRecord>();
  private termsHashes = new Set<string>();
  private executions = new Map<string, StandingExecutionRecord[]>();

  async create(
    record: StandingAuthorizationRecord
  ): Promise<{ ok: true } | { ok: false; code: 'duplicate' }> {
    if (this.authorizations.has(record.id) || this.termsHashes.has(record.termsHash)) {
      return { ok: false, code: 'duplicate' };
    }
    this.authorizations.set(record.id, structuredClone(record));
    this.termsHashes.add(record.termsHash);
    return { ok: true };
  }

  async get(id: string): Promise<StandingAuthorizationRecord | null> {
    const rec = this.authorizations.get(id);
    return rec ? structuredClone(rec) : null;
  }

  async setStatus(
    id: string,
    status: StandingAuthorizationStatus,
    updatedAt: string
  ): Promise<StandingAuthorizationRecord | null> {
    const rec = this.authorizations.get(id);
    if (!rec) return null;
    rec.status = status;
    rec.updatedAt = updatedAt;
    return structuredClone(rec);
  }

  async appendExecution(
    exec: StandingExecutionRecord
  ): Promise<{ ok: true } | { ok: false; code: 'duplicate_cycle' }> {
    const list = this.executions.get(exec.authorizationId) ?? [];
    if (
      exec.status === 'confirmed' &&
      list.some((e) => e.status === 'confirmed' && e.cycleNumber === exec.cycleNumber)
    ) {
      return { ok: false, code: 'duplicate_cycle' };
    }
    list.push(structuredClone(exec));
    this.executions.set(exec.authorizationId, list);
    return { ok: true };
  }

  async listExecutions(authorizationId: string): Promise<StandingExecutionRecord[]> {
    const list = this.executions.get(authorizationId) ?? [];
    return structuredClone(
      [...list].sort((a, b) => {
        if (a.cycleNumber !== b.cycleNumber) return a.cycleNumber - b.cycleNumber;
        return a.createdAt.localeCompare(b.createdAt);
      })
    );
  }
}

let storeInstance: StandingAuthorizationStore | null = null;

export function getStandingAuthorizationStore(): StandingAuthorizationStore {
  if (!storeInstance) {
    storeInstance = new InMemoryStandingAuthorizationStore();
  }
  return storeInstance;
}

export function _setStandingAuthorizationStore(store: StandingAuthorizationStore | null): void {
  storeInstance = store;
}
