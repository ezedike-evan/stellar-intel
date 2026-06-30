import { getLogger } from '@/lib/logger';

export function generateRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function logStructured(data: Record<string, unknown>): void {
  getLogger('structured').info(data);
}
