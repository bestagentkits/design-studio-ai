import { useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  Code2,
  Copy,
  KeyRound,
  LogOut,
  Plus,
  Trash2,
} from "lucide-react";
import { api, post, put, message, type Provider, type User } from "./api";
import { Busy, Field, Modal } from "./ui";

const providerOptions = [
  {
    id: "openai",
    name: "OpenAI",
    detail: "Design generation, images & speech",
    model: "gpt-4.1",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    detail: "Design generation with Claude",
    model: "claude-sonnet-4-20250514",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    detail: "Design generation with Gemini",
    model: "gemini-2.5-flash",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    detail: "Your choice of language model",
    model: "openai/gpt-4.1",
  },
  {
    id: "fal",
    name: "fal.ai",
    detail: "Image and video generation",
    model: "fal-ai/flux/schnell",
  },
];
type Token = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
};
export function Settings({
  user,
  onClose,
  onLogout,
  onProviders,
}: {
  user: User;
  onClose: () => void;
  onLogout: () => Promise<void>;
  onProviders: (providers: Provider[]) => void;
}) {
  const [tab, setTab] = useState<"providers" | "agents" | "account">(
      "providers",
    ),
    [providers, setProviders] = useState<Provider[]>([]),
    [tokens, setTokens] = useState<Token[]>([]);
  const [selected, setSelected] = useState("openai"),
    [key, setKey] = useState(""),
    [model, setModel] = useState(""),
    [tokenName, setTokenName] = useState(""),
    [newToken, setNewToken] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  async function load() {
    const [p, t] = await Promise.all([
      api<{ providers: Provider[] }>("/api/providers"),
      api<{ tokens: Token[] }>("/api/tokens"),
    ]);
    setProviders(p.providers);
    onProviders(p.providers);
    setTokens(t.tokens);
  }
  useEffect(() => {
    load().catch((e) => setError(message(e)));
  }, []);
  const current = providerOptions.find((p) => p.id === selected)!;
  const support = Boolean(
    (document as unknown as { modelContext?: unknown }).modelContext ||
    (navigator as unknown as { modelContext?: unknown }).modelContext,
  );
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setSuccess("Copied to clipboard.");
    } catch {
      setError(
        "Clipboard access is unavailable. Select and copy the text directly.",
      );
    }
  }
  return (
    <Modal title="Make the studio yours" onClose={onClose} wide>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings">
          <button
            className={tab === "providers" ? "selected" : ""}
            onClick={() => setTab("providers")}
          >
            <KeyRound size={17} /> AI providers
          </button>
          <button
            className={tab === "agents" ? "selected" : ""}
            onClick={() => setTab("agents")}
          >
            <Code2 size={17} /> Agent connections
          </button>
          <button
            className={tab === "account" ? "selected" : ""}
            onClick={() => setTab("account")}
          >
            <span className="mini-avatar">{user.name.slice(0, 1)}</span> Your
            account
          </button>
        </nav>
        <div className="settings-content">
          {tab === "providers" && (
            <>
              <h3>Your keys. Your choice.</h3>
              <p className="modal-description">
                Connect a provider to generate designs and media. Keys are
                encrypted on the server and never included in designs.
              </p>
              <div className="provider-list">
                {providerOptions.map((item) => (
                  <button
                    key={item.id}
                    className={selected === item.id ? "selected" : ""}
                    onClick={() => {
                      setSelected(item.id);
                      setKey("");
                      setModel(
                        providers.find((p) => p.provider === item.id)?.model ||
                          "",
                      );
                      setSuccess("");
                    }}
                  >
                    <span className="provider-letter">{item.name[0]}</span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.detail}</small>
                    </span>
                    {providers.some(
                      (p) => p.provider === item.id && p.configured,
                    ) ? (
                      <span className="configured">
                        <Check size={14} /> Connected
                      </span>
                    ) : (
                      <ChevronRight size={16} />
                    )}
                  </button>
                ))}
              </div>
              <form
                className="provider-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await put(`/api/providers/${selected}`, {
                      apiKey: key,
                      ...(model.trim() ? { model: model.trim() } : {}),
                    });
                    setKey("");
                    await load();
                    setSuccess(`${current.name} connected.`);
                  });
                }}
              >
                <h4>Connect {current.name}</h4>
                <Field label="API key">
                  <input
                    type="password"
                    autoComplete="off"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="Paste your provider API key"
                    required
                  />
                </Field>
                <Field
                  label="Default model"
                  hint="Optional. Leave blank to use the server default."
                >
                  <input
                    value={model}
                    placeholder={current.model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                </Field>
                <div className="button-row">
                  <button
                    className="button primary"
                    disabled={busy || !key.trim()}
                  >
                    {busy ? <Busy /> : "Save connection"}
                  </button>
                  {providers.some((p) => p.provider === selected) && (
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(`/api/providers/${selected}`, {
                            method: "DELETE",
                          });
                          await load();
                          setSuccess("Provider disconnected.");
                        })
                      }
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              </form>
            </>
          )}
          {tab === "agents" && (
            <>
              <h3>A workspace your agents can use.</h3>
              <p className="modal-description">
                Connect an MCP client with this address. OAuth clients can
                request access directly; API tokens work for scripts and the
                CLI.
              </p>
              <Field label="MCP server URL">
                <div className="copy-field">
                  <input readOnly value={`${location.origin}/mcp`} />
                  <button
                    className="icon-button"
                    aria-label="Copy MCP URL"
                    onClick={() => void copy(`${location.origin}/mcp`)}
                  >
                    <Copy size={17} />
                  </button>
                </div>
              </Field>
              <div className="integration-note">
                <Code2 size={20} />
                <div>
                  <strong>Browser tools (WebMCP)</strong>
                  <p>
                    {support
                      ? "Available in this browser. Open a project to register editor tools."
                      : "This browser does not expose WebMCP yet. Network MCP and the complete editor remain available."}
                  </p>
                </div>
              </div>
              <h4>Personal API tokens</h4>
              <p className="small-copy">
                Tokens can access your designs. Copy a new token now; it is only
                shown once.
              </p>
              <form
                className="token-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const result = await post<{ token: string }>(
                      "/api/tokens",
                      { name: tokenName },
                    );
                    setNewToken(result.token);
                    setTokenName("");
                    await load();
                  });
                }}
              >
                <input
                  aria-label="Token name"
                  placeholder="e.g. My coding agent"
                  required
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                />
                <button className="button" disabled={busy || !tokenName.trim()}>
                  <Plus size={16} /> Create token
                </button>
              </form>
              {newToken && (
                <Field label="New token. Save it somewhere private.">
                  <div className="copy-field">
                    <input value={newToken} readOnly />
                    <button
                      className="icon-button"
                      aria-label="Copy new token"
                      onClick={() => void copy(newToken)}
                    >
                      <Copy size={17} />
                    </button>
                  </div>
                </Field>
              )}
              <div className="token-list">
                {tokens.map((token) => (
                  <div key={token.id}>
                    <KeyRound size={17} />
                    <span>
                      <strong>{token.name}</strong>
                      <small>
                        Created {new Date(token.createdAt).toLocaleDateString()}
                      </small>
                    </span>
                    <button
                      className="icon-button"
                      aria-label={`Revoke ${token.name}`}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(`/api/tokens/${token.id}`, {
                            method: "DELETE",
                          });
                          await load();
                          setSuccess("Token revoked.");
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <details className="agent-example">
                <summary>How to use an API token</summary>
                <pre>{`curl ${location.origin}/api/projects \\\n  -H "Authorization: Bearer YOUR_TOKEN"`}</pre>
                <p>
                  Use the same bearer token with the MCP endpoint. Keep tokens
                  out of public repositories and shared documents.
                </p>
              </details>
            </>
          )}
          {tab === "account" && (
            <>
              <h3>{user.name || "Your workspace"}</h3>
              <p className="modal-description">{user.email}</p>
              <div className="account-copy">
                <p>
                  Your projects are private until you publish a snapshot.
                  Provider connections and API tokens belong to this account.
                </p>
              </div>
              <button
                className="button"
                disabled={busy}
                onClick={() => void run(onLogout)}
              >
                <LogOut size={17} /> Sign out
              </button>
            </>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="inline-success" role="status">
              <Check size={16} />
              {success}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
