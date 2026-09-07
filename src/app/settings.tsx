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
import { ThemeToggle } from "./theme-toggle";

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
// GitHub mark from primer/octicons (MIT): github.com/primer/octicons.
export function GitHubMark({ size = 19 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />
    </svg>
  );
}
export function Settings({
  user,
  onClose,
  onLogout,
  onProviders,
  onBeforeGitHubLink,
  initialTab = "providers",
}: {
  user: User;
  onClose: () => void;
  onLogout: () => Promise<void>;
  onProviders: (providers: Provider[]) => void;
  onBeforeGitHubLink: () => void;
  initialTab?: "providers" | "agents" | "account";
}) {
  const [tab, setTab] = useState<"providers" | "agents" | "account">(
      initialTab,
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
  const [github, setGithub] = useState<{
    enabled: boolean;
    connected: boolean;
    login: string | null;
  } | null>(null);
  const [githubError, setGithubError] = useState("");
  useEffect(() => {
    if (tab !== "account") return;
    let active = true;
    setGithubError("");
    api<{ enabled: boolean; connected: boolean; login: string | null }>(
      "/api/auth/github/status",
    )
      .then((status) => {
        if (active) setGithub(status);
      })
      .catch((e) => {
        if (active)
          setGithubError(
            `GitHub connection status could not load. ${message(e)}`,
          );
      });
    return () => {
      active = false;
    };
  }, [tab]);
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
                  <input
                    aria-label="MCP server URL"
                    readOnly
                    value={`${location.origin}/mcp`}
                  />
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
                    <input
                      aria-label="New token. Save it somewhere private."
                      value={newToken}
                      readOnly
                    />
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
                          setNewToken("");
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
              <section className="appearance-settings">
                <h4>Appearance</h4>
                <p className="small-copy">
                  Choose how the studio looks. Your designs keep their own
                  colors.
                </p>
                <ThemeToggle compact={false} />
              </section>
              <section
                className="github-account"
                aria-label="GitHub connection"
              >
                <div className="github-account-heading">
                  <GitHubMark size={21} aria-hidden="true" />
                  <div>
                    <h4>GitHub</h4>
                    {github?.connected ? (
                      <p>
                        {github.login
                          ? `Connected as @${github.login}`
                          : "GitHub account connected"}
                      </p>
                    ) : (
                      <p>Use your GitHub account to sign in.</p>
                    )}
                  </div>
                  {github?.connected && (
                    <span className="configured">
                      <Check size={14} />
                      Connected
                    </span>
                  )}
                </div>
                {githubError ? (
                  <p className="inline-error" role="alert">
                    {githubError}
                  </p>
                ) : !github ? (
                  <Busy label="Checking connection…" />
                ) : !github.enabled && !github.connected ? (
                  <p className="small-copy">
                    GitHub sign-in is not enabled on this studio.
                  </p>
                ) : !github.connected ? (
                  <button
                    className="button github-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await post<{ url: string }>(
                          "/api/auth/github/link",
                        );
                        const target = new URL(result.url, location.origin);
                        if (
                          target.origin !== location.origin &&
                          !(
                            target.protocol === "https:" &&
                            target.hostname === "github.com" &&
                            target.pathname === "/login/oauth/authorize"
                          )
                        )
                          throw new Error(
                            "GitHub returned an unexpected authorization address. Please contact your administrator.",
                          );
                        onBeforeGitHubLink();
                        location.assign(target.href);
                      })
                    }
                  >
                    <GitHubMark size={17} aria-hidden="true" />
                    Connect GitHub
                  </button>
                ) : (
                  <p className="small-copy">
                    You can now sign in with this GitHub account.
                  </p>
                )}
              </section>
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
