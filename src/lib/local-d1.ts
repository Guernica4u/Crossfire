import type * as Fs from "node:fs";
import type * as Path from "node:path";
import type * as Sqlite from "node:sqlite";

type Row = Record<string, unknown>;

interface SqliteStatement {
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
  run(...params: unknown[]): { changes: number | bigint };
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
}

export interface LocalD1Statement {
  bind(...values: unknown[]): LocalD1Statement;
  first<T = Row>(): Promise<T | null>;
  all<T = Row>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface LocalD1 {
  prepare(query: string): LocalD1Statement;
  batch(statements: LocalD1Statement[]): Promise<unknown>;
}

class Statement implements LocalD1Statement {
  #params: unknown[] = [];

  constructor(
    private readonly database: SqliteDatabase,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): LocalD1Statement {
    this.#params = values;
    return this;
  }

  async first<T = Row>(): Promise<T | null> {
    const row = this.database.prepare(this.query).get(...this.#params);
    return (row as T | undefined) ?? null;
  }

  async all<T = Row>(): Promise<{ results?: T[] }> {
    return { results: this.database.prepare(this.query).all(...this.#params) as T[] };
  }

  async run(): Promise<{ meta?: { changes?: number } }> {
    const result = this.database.prepare(this.query).run(...this.#params);
    return { meta: { changes: Number(result.changes ?? 0) } };
  }
}

class Database implements LocalD1 {
  constructor(private readonly database: SqliteDatabase) {}

  prepare(query: string): LocalD1Statement {
    return new Statement(this.database, query);
  }

  async batch(statements: LocalD1Statement[]): Promise<unknown> {
    const results: unknown[] = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }
}

/**
 * A tiny D1-shaped adapter over Node's built-in SQLite. It exists so the app
 * still runs on Windows hosts where the Workers runtime cannot create its
 * local disk, and when CROSSFIRE_LOCAL_DB=1 asks for a dependency-free dev DB.
 */
export function createLocalD1(): LocalD1 {
  const sqlite = process.getBuiltinModule("node:sqlite") as typeof Sqlite | undefined;
  const fs = process.getBuiltinModule("node:fs") as typeof Fs | undefined;
  const path = process.getBuiltinModule("node:path") as typeof Path | undefined;

  if (!sqlite || !fs || !path) {
    throw new Error("Local SQLite is not available in this Node runtime.");
  }

  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const database = new sqlite.DatabaseSync(path.join(dataDir, "crossfire.db"));
  database.exec(
    "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
  );
  return new Database(database);
}
