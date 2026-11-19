import { createHash, createHmac, randomBytes } from "node:crypto";
import postgres from "postgres";
import type { Group } from "./ledger.ts";

export const MAX_GROUPS_PER_HOUR = 100;
const MAX_GROUPS_PER_CALLER_PER_HOUR = 8;

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Le stockage des groupes n’est pas configuré sur ce serveur.");
    this.name = "DatabaseUnavailableError";
  }
}

export interface GroupStore {
  create(group: Group, caller: string | null): Promise<{ token: string; group: Group } | null>;
  get(token: string): Promise<Group | null>;
  compareAndSwap(token: string, version: Group["version"], group: Group): Promise<boolean>;
}

export function issueGroupToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashGroupToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function initialize(sql: postgres.Sql): Promise<void> {
  const [tables] = await sql<{ ready: boolean }[]>`
    SELECT to_regclass('ocompte_groups') IS NOT NULL
       AND to_regclass('ocompte_creation_quota') IS NOT NULL
       AND to_regclass('ocompte_caller_quota') IS NOT NULL
       AND to_regclass('ocompte_quota_secret') IS NOT NULL AS ready
  `;
  if (tables.ready) return;

  await sql.begin(async (tx) => {
    // "ocom" namespace; transaction-scoped so it also works with a pooled URL.
    // postgres 3.4.8's TransactionSql type omits the tag's call signature.
    await tx.unsafe("SELECT pg_advisory_xact_lock(1868787565, 1)");
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS ocompte_groups (
        token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
        version bigint NOT NULL CHECK (version >= 0),
        state jsonb NOT NULL
      )
    `);
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS ocompte_creation_quota (
        id smallint PRIMARY KEY CHECK (id = 1),
        bucket bigint NOT NULL,
        creations integer NOT NULL CHECK (creations > 0)
      )
    `);
    await tx.unsafe(`CREATE TABLE IF NOT EXISTS ocompte_caller_quota (
      bucket bigint NOT NULL, caller text NOT NULL, creations integer NOT NULL,
      PRIMARY KEY (bucket, caller)
    )`);
    await tx.unsafe(`CREATE TABLE IF NOT EXISTS ocompte_quota_secret (
      id smallint PRIMARY KEY CHECK (id = 1), salt text NOT NULL
    )`);
    await tx.unsafe('INSERT INTO ocompte_quota_secret (id, salt) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [randomBytes(32).toString('hex')]);
  });
}

export function databaseConnectionUrl(value: string): string {
  const url = new URL(value);
  if (!url.hostname.toLowerCase().endsWith(".neon.tech")) return value;

  // Postgres.js 3.x does not implement SCRAM channel binding. Use verified TLS
  // instead and do not pass the libpq-only flag as a server startup parameter.
  url.searchParams.delete("channel_binding");
  url.searchParams.set("sslmode", "verify-full");
  url.searchParams.delete("ssl");
  return url.toString();
}

async function openGroupStore(url: string): Promise<GroupStore> {
  const sql = postgres(databaseConnectionUrl(url), {
    max: 3,
    idle_timeout: 10,
    connect_timeout: 5,
    prepare: false,
    onnotice: () => {},
  });
  let salt: string;
  try {
    await initialize(sql);
    [{ salt }] = await sql<{ salt: string }[]>`SELECT salt FROM ocompte_quota_secret WHERE id = 1`;
  } catch (error) {
    await sql.end({ timeout: 0 }).catch(() => {});
    throw error;
  }

  return {
    async create(group, caller) {
      const token = issueGroupToken();
      const key = caller === null ? null : createHmac('sha256', salt).update(caller).digest('hex');
      // No raw IPs are stored. Claim the caller quota before taking a slot from
      // the shared backstop. Expired rows are purged on the next creation.
      const created = await sql`
        WITH quota_hour AS (SELECT floor(extract(epoch FROM statement_timestamp()) / 3600)::bigint AS bucket),
        expired AS (DELETE FROM ocompte_caller_quota WHERE bucket < (SELECT bucket FROM quota_hour)),
        caller_claim AS (
          INSERT INTO ocompte_caller_quota AS quota (bucket, caller, creations)
          SELECT bucket, ${key}::text, 1 FROM quota_hour WHERE ${key}::text IS NOT NULL
          ON CONFLICT (bucket, caller) DO UPDATE SET creations = quota.creations + 1
            WHERE quota.creations < ${MAX_GROUPS_PER_CALLER_PER_HOUR}
          RETURNING 1
        ), claimed AS (
          INSERT INTO ocompte_creation_quota AS quota (id, bucket, creations)
          SELECT 1, bucket, 1 FROM quota_hour WHERE ${key}::text IS NULL OR EXISTS (SELECT 1 FROM caller_claim)
          ON CONFLICT (id) DO UPDATE SET
            bucket = greatest(quota.bucket, excluded.bucket),
            creations = CASE WHEN quota.bucket < excluded.bucket THEN 1 ELSE quota.creations + 1 END
          WHERE quota.bucket < excluded.bucket OR quota.creations < ${MAX_GROUPS_PER_HOUR}
          RETURNING id
        )
        INSERT INTO ocompte_groups (token_hash, version, state)
        SELECT ${hashGroupToken(token)}, ${group.version}::bigint, ${sql.json(group)} FROM claimed
        RETURNING token_hash
      `;
      return created.length === 0 ? null : { token, group };
    },
    async get(token) {
      const [row] = await sql<{ state: Group }[]>`
        SELECT state FROM ocompte_groups WHERE token_hash = ${hashGroupToken(token)}
      `;
      return row?.state ?? null;
    },
    async compareAndSwap(token, version, group) {
      const updated = await sql`
        UPDATE ocompte_groups
        SET version = ${group.version}, state = ${sql.json(group)}
        WHERE token_hash = ${hashGroupToken(token)} AND version = ${version}
        RETURNING version
      `;
      return updated.length === 1;
    },
  };
}

let store: Promise<GroupStore> | undefined;

export async function getGroupStore(): Promise<GroupStore> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new DatabaseUnavailableError();
  store ??= openGroupStore(url).catch((error: unknown) => {
    store = undefined;
    throw error;
  });
  return store;
}
