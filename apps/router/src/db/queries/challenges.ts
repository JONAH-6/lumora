import { getDb } from '../index.js';

export interface ChallengeInsert {
  requestId: string;
  serviceId: string;
  amount: string;
  expiresAt: number;
}

export interface ChallengeRow {
  requestId: string;
  serviceId: string;
  amount: string;
  expiresAt: number;
  consumed: boolean;
}

interface RawChallengeRow {
  request_id: string;
  service_id: string;
  amount: string;
  expires_at: number;
  consumed: number;
}

function rowToChallenge(row: RawChallengeRow): ChallengeRow {
  return {
    requestId: row.request_id,
    serviceId: row.service_id,
    amount: row.amount,
    expiresAt: row.expires_at,
    consumed: row.consumed === 1,
  };
}

export function insertChallenge(challenge: ChallengeInsert): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO challenges (request_id, service_id, amount, expires_at, consumed, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(
    challenge.requestId,
    challenge.serviceId,
    challenge.amount,
    challenge.expiresAt,
    Date.now(),
  );
}

export function getChallenge(requestId: string): ChallengeRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM challenges WHERE request_id = ?').get(requestId) as
    | RawChallengeRow
    | undefined;
  return row ? rowToChallenge(row) : null;
}

// Atomically marks a challenge as consumed. Only succeeds once per challenge,
// and only while it has not yet expired — callers must check the returned
// boolean rather than reading the row first, to avoid a read-then-write race
// between concurrent requests carrying the same requestId.
export function consumeChallenge(requestId: string, now: number): boolean {
  const db = getDb();
  const result = db
    .prepare('UPDATE challenges SET consumed = 1 WHERE request_id = ? AND consumed = 0 AND expires_at > ?')
    .run(requestId, now);
  return result.changes > 0;
}

// Deletes expired challenges. Safe to call lazily (e.g. before issuing a new
// challenge) or on a timer.
export function deleteExpiredChallenges(now: number): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM challenges WHERE expires_at <= ?').run(now);
  return result.changes;
}
