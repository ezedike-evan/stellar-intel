import { describe, it, expect } from 'vitest';
import { hasDatabaseUrl } from '@/lib/reputation/pool';

describe('unit test environment', () => {
  it('blanks DATABASE_URL so unit tests never hit postgres', () => {
    expect(process.env.DATABASE_URL).toBeFalsy();
    expect(hasDatabaseUrl()).toBe(false);
  });
});
