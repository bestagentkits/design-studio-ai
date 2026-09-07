import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve, dirname, extname, sep } from "node:path";
import type { Database, Statement, Bucket } from "./types";
class SqliteStatement implements Statement {
  constructor(
    readonly database: DatabaseSync,
    readonly sql: string,
    readonly values: unknown[] = [],
  ) {}
  bind(...values: unknown[]) {
    return new SqliteStatement(this.database, this.sql, values);
  }
  async first<T>() {
    return (
      (this.database.prepare(this.sql).get(...(this.values as any[])) as
        T | undefined) ?? null
    );
  }
  async all<T>() {
    return {
      results: this.database
        .prepare(this.sql)
        .all(...(this.values as any[])) as T[],
    };
  }
  async run() {
    const result = this.database
      .prepare(this.sql)
      .run(...(this.values as any[]));
    return { meta: { changes: Number(result.changes) } };
  }
}
export class SqliteDatabase implements Database {
  readonly native: DatabaseSync;
  constructor(path: string) {
    this.native = new DatabaseSync(path);
    this.native.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
  }
  prepare(sql: string) {
    return new SqliteStatement(this.native, sql);
  }
  async exec(sql: string) {
    this.native.exec(sql);
  }
  async batch(statements: Statement[]) {
    this.native.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) {
        if (!(statement instanceof SqliteStatement))
          throw new Error("Unsupported statement");
        const result = this.native
          .prepare(statement.sql)
          .run(...(statement.values as any[]));
        results.push({ meta: { changes: Number(result.changes) } });
      }
      this.native.exec("COMMIT");
      return results;
    } catch (error) {
      this.native.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.native.close();
  }
}
export class FileBucket implements Bucket {
  constructor(readonly root: string) {}
  private path(key: string) {
    if (!/^[a-zA-Z0-9/_-]+$/.test(key)) throw new Error("Invalid storage key");
    const path = resolve(this.root, key);
    if (!path.startsWith(resolve(this.root) + sep))
      throw new Error("Storage path escapes root");
    return path;
  }
  async put(
    key: string,
    data: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType: string } },
  ) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      new Uint8Array(data instanceof Uint8Array ? data : data),
    );
    await writeFile(
      `${path}.metadata.json`,
      JSON.stringify(options?.httpMetadata ?? {}),
    );
  }
  async get(key: string) {
    const path = this.path(key);
    try {
      const data = await readFile(path);
      const metadata = JSON.parse(
        await readFile(`${path}.metadata.json`, "utf8"),
      );
      const bytes = new Uint8Array(data);
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        httpMetadata: metadata,
        arrayBuffer: async () => bytes.buffer,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async delete(key: string) {
    const path = this.path(key);
    for (const name of [path, `${path}.metadata.json`])
      try {
        await unlink(name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
  }
}
export function staticAssets(root: string) {
  return {
    async fetch(request: Request) {
      let path: string;
      try {
        path = decodeURIComponent(new URL(request.url).pathname);
      } catch {
        return new Response("Bad path", { status: 400 });
      }
      const relative = path.replace(/^\/+/, "");
      if (relative.split(/[\\/]/).includes(".."))
        return new Response("Not found", { status: 404 });
      let file = resolve(root, relative || "index.html");
      if (file !== resolve(root) && !file.startsWith(resolve(root) + sep))
        return new Response("Not found", { status: 404 });
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
        ".json": "application/json",
        ".md": "text/markdown; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
        ".xml": "application/xml; charset=utf-8",
        ".woff2": "font/woff2",
      };
      try {
        let data;
        try {
          data = await readFile(file);
        } catch (error) {
          if (extname(file)) throw error;
          try {
            file = resolve(file, 'index.html');
            data = await readFile(file);
          } catch {
            return new Response('Not found', {status:404});
          }
        }
        return new Response(data, {
          headers: {
            "Content-Type": mime[extname(file)] ?? "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
          },
        });
      } catch {
        return new Response("Frontend not built. Run npm run build.", {
          status: 404,
        });
      }
    },
  };
}
