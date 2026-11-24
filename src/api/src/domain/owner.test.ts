import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryOne } from '../db/pool.js';
import { grantOwnerAccess, isOwnerAddress } from './owner.js';

// The real pool reads DATABASE_URL as it loads, and the job that runs these
// tests has no database. The statement itself was checked by running it.
vi.mock('../db/pool.js', () => ({ queryOne: vi.fn() }));

describe('isOwnerAddress', () => {
  it('matches the owner address whatever its case and surrounding space', () => {
    expect(isOwnerAddress('  Owner@Example.COM ', 'owner@example.com')).toBe(true);
    expect(isOwnerAddress('owner@example.com', ' OWNER@example.com ')).toBe(true);
  });

  it('does not match any other address', () => {
    expect(isOwnerAddress('someone@example.com', 'owner@example.com')).toBe(false);
    expect(isOwnerAddress('owner@example.com.example', 'owner@example.com')).toBe(false);
  });

  // An unset owner must fail closed. A blank setting is what an unset one
  // looks like once trimmed, and must not make a blank address the owner's.
  it('matches nothing when no owner is named', () => {
    expect(isOwnerAddress('owner@example.com', undefined)).toBe(false);
    expect(isOwnerAddress('', '')).toBe(false);
    expect(isOwnerAddress(' ', '  ')).toBe(false);
  });
});

describe('grantOwnerAccess', () => {
  beforeEach(() => {
    vi.mocked(queryOne).mockReset();
  });

  it('promotes the account with that address, and only once it is confirmed', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: 'owner' });

    await expect(grantOwnerAccess('owner@example.com')).resolves.toBe(true);

    const [sql, params] = vi.mocked(queryOne).mock.calls[0]!;
    expect(params?.[0]).toBe('owner@example.com');
    expect(sql).toMatch(/role = 'admin'/);
    expect(sql).toMatch(/tier = 'advanced'/);
    // Until its code is entered, an account could belong to anyone who typed
    // the address in. This condition is what stops them, so its removal has
    // to fail something.
    expect(sql).toContain('email_verified_at IS NOT NULL');
  });

  it('reports when there is no confirmed account to promote', async () => {
    vi.mocked(queryOne).mockResolvedValue(undefined);

    await expect(grantOwnerAccess('owner@example.com')).resolves.toBe(false);
  });
});
