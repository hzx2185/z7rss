import fs from "node:fs";
import Database from "better-sqlite3";

export class SqliteHealthError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SqliteHealthError";
    this.code = "sqlite_health_check_failed";
    this.details = details;
  }
}

function normalizeResult(result) {
  if (Array.isArray(result)) {
    return String(result[0]?.quick_check || result[0]?.integrity_check || "").trim();
  }
  return String(result || "").trim();
}

export function assertSqliteHealthy(db, options = {}) {
  const label = options.label || "database";
  const pragma = options.full ? "integrity_check" : "quick_check";
  let result = "";

  try {
    result = normalizeResult(db.pragma(pragma, { simple: true }));
  } catch (error) {
    throw new SqliteHealthError(`${label} health check failed: ${error.message}`, {
      label,
      pragma,
      cause: error.message
    });
  }

  if (result.toLowerCase() !== "ok") {
    throw new SqliteHealthError(`${label} health check failed: ${result || "unknown"}`, {
      label,
      pragma,
      result
    });
  }

  return result;
}

export function checkSqliteFile(filePath, options = {}) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return assertSqliteHealthy(db, {
      ...options,
      label: options.label || filePath
    });
  } finally {
    db.close();
    if (options.cleanupSidecars) {
      for (const suffix of ["-wal", "-shm"]) {
        try {
          fs.rmSync(`${filePath}${suffix}`, { force: true });
        } catch {
          // Sidecar cleanup is best-effort; health check results are the important signal.
        }
      }
    }
  }
}
