import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Devin Desktop (the Windsurf-based editor) keeps its sign-in in the Electron
 * state database, not in the CLI store (`~/.local/share/devin/credentials.toml`).
 * A Desktop-only sign-in therefore looks like "Not logged in" to the CLI, and
 * `/login devin` opens a browser even though the machine already holds a valid
 * session token.
 *
 * This module reads that token so the CLI store can be seeded from it.
 * It is strictly read-only: nothing here writes to Devin Desktop's data.
 */

const AUTH_KEY = "windsurfAuthStatus";
const API_KEY_PATTERN = /"apiKey"\s*:\s*"((?:[^"\\]|\\.)*)"/;

export interface DesktopCredential {
  apiKey: string;
  source: string;
}

/** Devin Desktop state databases, most specific first. */
export function desktopStateDbPaths(): string[] {
  const override = process.env.DEVIN_DESKTOP_STATE_DB;
  if (override) return [override];
  const home = homedir();
  const fallback =
    process.platform === "darwin"
      ? join(home, "Library/Application Support/Devin/User/globalStorage/state.vscdb")
      : process.platform === "win32"
        ? join(
            process.env.APPDATA ?? join(home, "AppData/Roaming"),
            "Devin/User/globalStorage/state.vscdb",
          )
        : join(home, ".config/Devin/User/globalStorage/state.vscdb");
  return [fallback];
}

function normalizeApiKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const apiKey = value.trim();
  // Real keys look like `devin-session-token$…` / `wspkce$…`; never contain spaces.
  if (apiKey.length < 16 || /\s/.test(apiKey)) return null;
  return apiKey;
}

function apiKeyFromStatusValue(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as { apiKey?: unknown };
    return normalizeApiKey(parsed?.apiKey);
  } catch {
    return null;
  }
}

interface SqliteDatabase {
  prepare(sql: string): { get(...params: unknown[]): unknown };
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;
}

/**
 * Preferred path: `node:sqlite` (Node 22.5+) reads the row properly, so stale
 * copies left behind by earlier writes can never win.
 */
async function apiKeyFromSqlite(dbPath: string): Promise<string | null> {
  try {
    const sqlite = (await import("node:sqlite")) as unknown as SqliteModule;
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(AUTH_KEY) as
        | { value?: unknown }
        | undefined;
      return apiKeyFromStatusValue(row?.value);
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Fallback for Node < 22.5: the row is small enough that SQLite keeps it inline
 * in a leaf page, so the key name and the JSON value sit next to each other.
 * Best effort only — a stale copy can win when the row was rewritten.
 */
function apiKeyFromRawScan(dbPath: string): string | null {
  try {
    const buffer = readFileSync(dbPath);
    const needle = Buffer.from(AUTH_KEY, "utf8");
    let found: string | null = null;
    let index = buffer.indexOf(needle);
    while (index !== -1) {
      const window = buffer
        .subarray(index, Math.min(index + 4096, buffer.length))
        .toString("latin1");
      const match = window.match(API_KEY_PATTERN);
      const candidate = match?.[1] ? normalizeApiKey(match[1].replace(/\\(["\\])/g, "$1")) : null;
      if (candidate) found = candidate;
      index = buffer.indexOf(needle, index + 1);
    }
    return found;
  } catch {
    return null;
  }
}

/** Session token of a signed-in Devin Desktop, or null when there is none. */
export async function readDevinDesktopApiKey(): Promise<DesktopCredential | null> {
  for (const dbPath of desktopStateDbPaths()) {
    if (!existsSync(dbPath)) continue;
    const apiKey = (await apiKeyFromSqlite(dbPath)) ?? apiKeyFromRawScan(dbPath);
    if (apiKey) return { apiKey, source: dbPath };
  }
  return null;
}
