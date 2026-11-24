import { clock } from '../clock.js';
import { queryOne } from '../db/pool.js';

/**
 * The owner's account: the one whose address is ADMIN_EMAIL.
 *
 * Every new account is an ordinary user on the basic tier, and only an
 * administrator can change that. Without this, the only administrator on a
 * deployed instance is the seeded one, and the person who runs the instance
 * is an ordinary user on it like everybody else.
 *
 * The owner's account is made an administrator on the advanced tier in two
 * places: at boot, for an account that already exists, and when its address
 * is confirmed, for one created after the database was replaced. So a fresh
 * database needs nothing more than signing up again.
 *
 * The address is a setting rather than a seeded row because the repository is
 * public. Only a confirmed address counts: until its code is entered, an
 * account could belong to anyone who typed the address in.
 */

/** Whether `email` is the owner's. Never true when no owner is named. */
export function isOwnerAddress(email: string, owner: string | undefined): boolean {
  const wanted = owner?.trim().toLowerCase();
  if (!wanted) return false;
  return email.trim().toLowerCase() === wanted;
}

/**
 * Makes the confirmed account with this address an administrator on the
 * advanced tier. True when there is one, whether or not it already was.
 */
export async function grantOwnerAccess(email: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE users
        SET role = 'admin',
            tier = 'advanced',
            -- Booting is not an edit: only a real change moves updated_at.
            updated_at = CASE WHEN role = 'admin' AND tier = 'advanced'
                              THEN updated_at ELSE $2 END
      WHERE lower(btrim(email)) = lower(btrim($1))
        AND email_verified_at IS NOT NULL
  RETURNING id`,
    [email, clock.now()],
  );
  return row !== undefined;
}
