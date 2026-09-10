import { builtStaticAssets } from './built-static-assets';
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "../server/index";
import { FileBucket, SqliteDatabase } from "../server/node-adapters";
import { hash, secret } from "../server/security";
import type { Bindings } from "../server/types";
test("real SQLite auth, ownership, CAS, private assets, snapshots, BYOK, MCP and OAuth", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "design-studio-test-"));
  const db = new SqliteDatabase(join(dir, "studio.db"));
  for (const migration of (
    await readdir(new URL("../migrations/", import.meta.url))
  )
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(
      await readFile(
        new URL(`../migrations/${migration}`, import.meta.url),
        "utf8",
      ),
    );
  }
  const env: Bindings = { ASSETS: builtStaticAssets,
    DB: db,
    ASSETS_BUCKET: new FileBucket(join(dir, "assets")),
    APP_URL: "https://studio.example",
    ALLOW_REGISTRATION: "true",
    ENCRYPTION_KEY: secret(),
  };
  const request = async (
    path: string,
    method = "GET",
    body?: unknown,
    cookie?: string,
    bearer?: string,
    custom?: Record<string, string>,
  ) =>
    app.request(
      `https://studio.example${path}`,
      {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          Origin: "https://studio.example",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          ...custom,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
    );
  const form = async (
    path: string,
    body: Record<string, string>,
    cookie?: string,
  ) =>
    app.request(
      `https://studio.example${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://studio.example",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: new URLSearchParams(body),
      },
      env,
    );
  try {
    const register = await request("/api/auth/register", "POST", {
      email: "alice@example.com",
      password: "A secure password 1",
      name: "Alice",
    });
    assert.equal(register.status, 201);
    const alice = register.headers.get("set-cookie")!.split(";")[0];
    assert.match(register.headers.get("set-cookie")!, /HttpOnly/i);
    assert.match(register.headers.get("set-cookie")!, /Secure/i);
    const second = await request("/api/auth/register", "POST", {
      email: "bob@example.com",
      password: "B secure password 2",
    });
    assert.equal(second.status, 201);
    const bob = second.headers.get("set-cookie")!.split(";")[0];
    await t.test("credentials and CSRF", async () => {
      assert.equal(
        (
          await request("/api/auth/login", "POST", {
            email: "alice@example.com",
            password: "Incorrect password",
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request(
            "/api/projects",
            "POST",
            { name: "Cross origin" },
            alice,
            undefined,
            { Origin: "https://evil.example" },
          )
        ).status,
        403,
      );
      const user = (await (
        await request("/api/auth/me", "GET", undefined, alice)
      ).json()) as any;
      assert.equal(user.user.email, "alice@example.com");
      const stored = await db
        .prepare("SELECT password FROM users WHERE email=?")
        .bind("alice@example.com")
        .first<{ password: string }>();
      assert.ok(stored?.password.startsWith("pbkdf2:100000:"));
      assert.ok(!stored?.password.includes("A secure"));
    });
    const created = await request(
      "/api/projects",
      "POST",
      { name: "My design", kind: "web" },
      alice,
    );
    assert.equal(created.status, 201);
    const project = ((await created.json()) as any).project;
    await t.test("owner isolation and revision compare-and-swap", async () => {
      assert.equal(
        (await request(`/api/projects/${project.id}`, "GET", undefined, bob))
          .status,
        404,
      );
      assert.equal(
        (await request(`/api/projects/${project.id}`, "DELETE", undefined, bob))
          .status,
        404,
      );
      assert.equal((await request("/api/projects")).status, 401);
      const doc = structuredClone(project.document);
      doc.name = "Saved design";
      const results = await Promise.all([
        request(
          `/api/projects/${project.id}/document`,
          "PUT",
          { document: doc, expectedRevision: 1 },
          alice,
        ),
        request(
          `/api/projects/${project.id}/document`,
          "PUT",
          { document: doc, expectedRevision: 1 },
          alice,
        ),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const latest = (
        (await (
          await request(`/api/projects/${project.id}`, "GET", undefined, alice)
        ).json()) as any
      ).project;
      assert.equal(latest.revision, 2);
      const invalid = structuredClone(doc);
      invalid.pages[0].nodes[0].src = "javascript:alert(1)";
      assert.equal(
        (
          await request(
            `/api/projects/${project.id}/document`,
            "PUT",
            { document: invalid, expectedRevision: 2 },
            alice,
          )
        ).status,
        400,
      );
    });
    await t.test(
      "private binary assets and immutable publications",
      async () => {
        const data = new FormData();
        data.set(
          "file",
          new File(
            [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])],
            "test.png",
            { type: "image/png" },
          ),
        );
        const upload = await app.request(
          `https://studio.example/api/projects/${project.id}/assets`,
          {
            method: "POST",
            headers: { Cookie: alice, Origin: "https://studio.example" },
            body: data,
          },
          env,
        );
        assert.equal(upload.status, 201);
        const asset = ((await upload.json()) as any).asset;
        assert.equal((await request(asset.url)).status, 401);
        assert.equal(
          (await request(asset.url, "GET", undefined, bob)).status,
          404,
        );
        assert.equal(
          (await request(asset.url, "GET", undefined, alice)).status,
          200,
        );
        const latest = (
          (await (
            await request(
              `/api/projects/${project.id}`,
              "GET",
              undefined,
              alice,
            )
          ).json()) as any
        ).project;
        latest.document.assets.push(asset);
        latest.document.pages[0].nodes.push({
          id: "asset-node",
          name: "Upload",
          type: "image",
          x: 1,
          y: 1,
          width: 100,
          height: 100,
          src: asset.url,
        });
        const saved = await request(
          `/api/projects/${project.id}/document`,
          "PUT",
          { document: latest.document, expectedRevision: latest.revision },
          alice,
        );
        assert.equal(saved.status, 200);
        const published = await request(
          `/api/projects/${project.id}/publish`,
          "POST",
          undefined,
          alice,
        );
        assert.equal(published.status, 200);
        const snapshot = (await published.json()) as any;
        const publicPath = new URL(snapshot.url).pathname;
        const preview = await request(
          `/api/projects/${project.id}/preview`,
          "POST",
          undefined,
          alice,
        );
        assert.equal(preview.status, 200);
        const previewPath = new URL((await preview.json() as any).url).pathname;
        const shared = await request(
          `/api/projects/${project.id}/share`,
          "POST",
          undefined,
          alice,
        );
        assert.equal(shared.status, 200);
        const sharePath = new URL((await shared.json() as any).url).pathname;
        assert.equal(
          (await request(`${publicPath}/assets/${asset.id}`)).status,
          200,
        );
        const before = await (await request(publicPath)).text();
        assert.match(before, /Saved design/);
        await request(
          `/api/projects/${project.id}`,
          "PATCH",
          { name: "Private renamed" },
          alice,
        );
        // The immutable document is identical; a fresh CSP nonce is issued per response.
        const normalizeNonce = (html: string) => html.replace(/<script nonce="[^"]+">/g, '<script nonce="CSP_NONCE">');
        assert.equal(normalizeNonce(await (await request(publicPath)).text()), normalizeNonce(before));
        assert.equal(
          (
            await request(
              `/api/projects/${project.id}/publish`,
              "DELETE",
              undefined,
              alice,
            )
          ).status,
          200,
        );
        assert.equal((await request(publicPath)).status, 404);
        assert.equal((await request(previewPath)).status, 404);
        assert.equal((await request(sharePath)).status, 404);
      },
    );
    await t.test(
      "failed generation preserves design and local persistence survives a second connection",
      async () => {
        const before = (await (
          await request(`/api/projects/${project.id}`, "GET", undefined, alice)
        ).json()) as any;
        const response = await request(
          `/api/projects/${project.id}/generate`,
          "POST",
          {
            prompt: "Improve the layout",
            provider: "anthropic",
            expectedRevision: before.project.revision,
          },
          alice,
        );
        assert.equal(response.status, 400);
        assert.equal(
          ((await response.json()) as any).error.code,
          "provider_unconfigured",
        );
        const after = await (
          await request(`/api/projects/${project.id}`, "GET", undefined, alice)
        ).json();
        assert.deepEqual(after, before);
        const reopened = new SqliteDatabase(join(dir, "studio.db"));
        try {
          assert.equal(
            (
              await reopened
                .prepare("SELECT name FROM projects WHERE id=?")
                .bind(project.id)
                .first<{ name: string }>()
            )?.name,
            before.project.name,
          );
        } finally {
          reopened.close();
        }
        await assert.rejects(() => env.ASSETS_BUCKET.get("../outside"));
      },
    );
    let token = "";
    let tokenId = "";
    await t.test("encrypted BYOK and revocable tokens", async () => {
      const saved = await request(
        "/api/providers/openai",
        "PUT",
        { apiKey: "sk-private-test-value" },
        alice,
      );
      assert.equal(saved.status, 200);
      const provider = await db
        .prepare("SELECT encrypted_key FROM providers")
        .first<{ encrypted_key: string }>();
      assert.ok(!provider?.encrypted_key.includes("sk-private"));
      const configs = await (
        await request("/api/providers", "GET", undefined, alice)
      ).text();
      assert.ok(!configs.includes("sk-private"));
      assert.equal(
        (
          await request(
            "/api/providers/openai",
            "PUT",
            { apiKey: "sk-private-value", baseUrl: "http://127.0.0.1:1234/v1" },
            alice,
          )
        ).status,
        400,
      );
      const created = (await (
        await request("/api/tokens", "POST", { name: "Agent" }, alice)
      ).json()) as any;
      token = created.token;
      tokenId = created.id;
      assert.equal(
        (await request("/api/projects", "GET", undefined, undefined, token))
          .status,
        200,
      );
      const stored = await db
        .prepare("SELECT hash FROM api_tokens WHERE id=?")
        .bind(tokenId)
        .first<{ hash: string }>();
      assert.notEqual(stored?.hash, token);
    });
    await t.test("MCP actual SDK initialize and tool calls", async () => {
      const headers = {
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
      };
      assert.equal(
        (
          await request(
            "/mcp",
            "POST",
            {
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2025-11-25",
                capabilities: {},
                clientInfo: { name: "test", version: "1.0" },
              },
            },
            undefined,
            token,
            { ...headers, Origin: "https://evil.example" },
          )
        ).status,
        403,
      );
      const initialize = await request(
        "/mcp",
        "POST",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "test", version: "1.0" },
          },
        },
        undefined,
        token,
        headers,
      );
      assert.equal(initialize.status, 200);
      const initialized = (await initialize.json()) as any;
      assert.equal(initialized.result.serverInfo.name, "design-studio-ai");
      const listed = await request(
        "/mcp",
        "POST",
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        undefined,
        token,
        headers,
      );
      assert.equal(listed.status, 200);
      const listedTools = ((await listed.json()) as any).result.tools as Array<{ name: string }>;
      for (const name of [
        "list_provider_connections",
        "patch_document",
        "preview_project",
        "unpreview_project",
        "share_project",
        "unshare_project",
        "export_project",
      ]) assert.ok(listedTools.some(tool => tool.name === name), name);
      const callTool = (id: number, name: string) => request(
        "/mcp",
        "POST",
        { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: { projectId: project.id } } },
        undefined,
        token,
        headers,
      );
      for (const [id, name] of [[4, "preview_project"], [5, "unpreview_project"], [6, "share_project"], [7, "unshare_project"]] as const) {
        const response = await callTool(id, name);
        assert.equal(response.status, 200, name);
      }
      const invoked = await request(
        "/mcp",
        "POST",
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "get_project", arguments: { projectId: project.id } },
        },
        undefined,
        token,
        headers,
      );
      assert.equal(invoked.status, 200);
      assert.ok(
        ((await invoked.json()) as any).result.content[0].text.includes(
          project.id,
        ),
      );
    });
    await t.test(
      "OAuth consent, PKCE, exact redirect, audience, replay, rotation and revocation",
      async () => {
        const metadata = (await (
          await request("/.well-known/oauth-authorization-server")
        ).json()) as any;
        assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
        const registration = await request("/oauth/register", "POST", {
          client_name: "Integration client",
          redirect_uris: ["http://127.0.0.1:4321/callback"],
        });
        assert.equal(registration.status, 201);
        const client = (await registration.json()) as any;
        const verifier = secret() + "abc";
        const params = {
          client_id: client.client_id,
          redirect_uri: "http://127.0.0.1:4321/callback",
          response_type: "code",
          code_challenge: await hash(verifier),
          code_challenge_method: "S256",
          state: "retained-state",
          resource: "https://studio.example/mcp",
          scope: "studio",
        };
        assert.equal(
          (
            await request(
              `/oauth/authorize?${new URLSearchParams({ ...params, redirect_uri: "https://evil.example" })}`,
              "GET",
              undefined,
              alice,
            )
          ).status,
          400,
        );
        const consent = await request(
          `/oauth/authorize?${new URLSearchParams(params)}`,
          "GET",
          undefined,
          alice,
        );
        assert.equal(consent.status, 200);
        assert.equal(consent.headers.get("content-security-policy"),
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' http://127.0.0.1:4321; frame-ancestors 'none'; base-uri 'none'");
        assert.match(await consent.text(), /Allow access/);
        for (const redirectUri of [
          "https://chatgpt.com/connector/oauth/callback-id",
          "https://chatgpt.com/connector_platform_oauth_redirect",
          "https://host;script-src/callback",
          "https://*.example/callback",
        ]) {
          const registered = await request("/oauth/register", "POST", { redirect_uris: [redirectUri] });
          assert.equal(registered.status, 201);
          const externalClient = await registered.json() as { client_id: string };
          const externalConsent = await request(`/oauth/authorize?${new URLSearchParams({
            ...params, client_id: externalClient.client_id, redirect_uri: redirectUri,
          })}`, "GET", undefined, alice);
          if (redirectUri.startsWith("https://chatgpt.com/")) {
            assert.equal(externalConsent.status, 200);
            assert.equal(externalConsent.headers.get("content-security-policy"),
              "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com; frame-ancestors 'none'; base-uri 'none'");
          } else {
            assert.equal(externalConsent.status, 400);
            assert.equal((await externalConsent.json() as { error: string }).error, "invalid_redirect_uri");
          }
        }
        const approved = await form(
          "/oauth/authorize",
          { ...params, decision: "allow" },
          alice,
        );
        assert.equal(approved.status, 302);
        const redirect = new URL(approved.headers.get("location")!);
        assert.equal(redirect.searchParams.get("state"), "retained-state");
        const tokenArgs = {
          grant_type: "authorization_code",
          client_id: client.client_id,
          redirect_uri: params.redirect_uri,
          resource: params.resource,
          code: redirect.searchParams.get("code")!,
          code_verifier: verifier,
        };
        assert.equal(
          (
            await form("/oauth/token", {
              ...tokenArgs,
              code_verifier: "x".repeat(43),
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await form("/oauth/token", {
              ...tokenArgs,
              resource: "https://evil.example/mcp",
            })
          ).status,
          400,
        );
        const response = await form("/oauth/token", tokenArgs);
        assert.equal(response.status, 200);
        const issued = (await response.json()) as any;
        assert.equal((await form("/oauth/token", tokenArgs)).status, 400);
        assert.equal(
          (
            await request(
              "/api/projects",
              "GET",
              undefined,
              undefined,
              issued.access_token,
            )
          ).status,
          200,
        );
        const refreshArgs = {
          grant_type: "refresh_token",
          client_id: client.client_id,
          resource: params.resource,
          refresh_token: issued.refresh_token,
        };
        const rotated = await form("/oauth/token", refreshArgs);
        assert.equal(rotated.status, 200);
        assert.equal((await form("/oauth/token", refreshArgs)).status, 400);
        assert.equal(
          (
            await request(
              "/api/projects",
              "GET",
              undefined,
              undefined,
              issued.access_token,
            )
          ).status,
          401,
        );
        const renewed = (await rotated.json()) as any;
        assert.equal(
          (
            await form("/oauth/revoke", {
              client_id: client.client_id,
              token: renewed.refresh_token,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request(
              "/api/projects",
              "GET",
              undefined,
              undefined,
              renewed.access_token,
            )
          ).status,
          401,
        );
      },
    );
    await t.test("token revocation and logout", async () => {
      await request(`/api/tokens/${tokenId}`, "DELETE", undefined, alice);
      assert.equal(
        (await request("/api/projects", "GET", undefined, undefined, token))
          .status,
        401,
      );
      await request("/api/auth/logout", "POST", undefined, alice);
      assert.equal(
        (
          (await (
            await request("/api/auth/me", "GET", undefined, alice)
          ).json()) as any
        ).user,
        null,
      );
    });
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
