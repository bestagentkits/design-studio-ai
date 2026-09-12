import { screenParam, useScreenState, writeScreen } from './screen-state';
import { ProjectThumbnail } from './project-thumbnail';
import { registerVisualInspectionBrowserTools } from './browser-visual-inspection-tools';
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  ArrowUp,
  Box,
  BookOpen,
  Check,
  Code2,
  Copy,
  FileText,
  Film,
  FolderOpen,
  Grid2X2,
  Import,
  Layers3,
  LayoutTemplate,
  List,
  Monitor,
  Plus,
  Presentation,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { DesignDocument, Project } from "../shared/schema";
import { createDocument, templates, themes } from "../shared/catalog";
import { renderSvg } from "../shared/render";
import { api, post, put, message, type User, type Provider } from "./api";
import { Brand, Busy, Empty, Field, Modal } from "./ui";
import { Editor } from "./editor";
import { Settings, GitHubMark } from "./settings";
import { importDesign } from "./file-formats";
import { ThemeToggle } from "./theme-toggle";
import { workspaceTab, workspacePaths, navigateWorkspace, type WorkspaceTab } from "./workspace-navigation";
import { trackClient, resetAnalyticsIdentity } from "./analytics";
import { ObservabilityDashboard } from "./observability-dashboard";
import { CommunitySearchDialog } from './community-search-dialog';
import { useContextualSearch } from './contextual-search';
import { resumeCommunitySignIn } from './community-navigation';
import { CommunityJobStatus } from './community-job-status';
import type { CommunityJob } from '../shared/community';
import { useCommunityEnabled, storedCommunityImport } from './community-client';

type Kind = DesignDocument["kind"];
const kinds: {
  id: Kind;
  name: string;
  icon: typeof Monitor;
  description: string;
}[] = [
  {
    id: "web",
    name: "Website",
    icon: Monitor,
    description: "Give your idea a home",
  },
  {
    id: "slides",
    name: "Presentation",
    icon: Presentation,
    description: "Make your story land",
  },
  {
    id: "report",
    name: "Document",
    icon: FileText,
    description: "Bring clarity to the details",
  },
  {
    id: "wireframe",
    name: "Wireframe",
    icon: LayoutTemplate,
    description: "Find the right structure",
  },
  {
    id: "3d",
    name: "3D scene",
    icon: Box,
    description: "Explore another dimension",
  },
  {
    id: "video",
    name: "Motion",
    icon: Film,
    description: "Set your ideas in motion",
  },
];
type Summary = Omit<Project, "document"> & { document?: DesignDocument };
type Draft = {
  kind: Kind;
  name: string;
  prompt: string;
  audience: string;
  theme: string;
  template?: string;
  document?: DesignDocument;
  importNotice?: string;
};
const oauthBriefKey = "design-studio:github-brief";
const githubErrors: Record<string, string> = {
  cancelled:
    "GitHub sign-in was cancelled. You can try again or sign in with your password.",
  invalid_state:
    "This GitHub sign-in expired or could not be verified. Please start again.",
  github_unavailable:
    "GitHub could not complete sign-in. Please try again in a moment.",
  email_required:
    "GitHub needs a verified email address for sign-in. Add and verify an email in your GitHub settings, then try again.",
  email_exists:
    "An account already uses this email. Sign in with your password, then connect GitHub in Settings → Your account.",
  account_linked:
    "This GitHub account is already connected to another studio account. Use its existing account or choose a different GitHub account.",
  registration_disabled:
    "New accounts are not enabled on this studio. Ask your administrator for access.",
  link_session_changed:
    "Your studio session changed while connecting GitHub. Sign in to the intended account and try again from Settings.",
  configuration_error:
    "GitHub sign-in is not configured correctly on this studio. Please contact your administrator.",
};
function githubError(code: string) {
  return Object.hasOwn(githubErrors, code)
    ? githubErrors[code]!
    : "GitHub sign-in could not finish. Please try again.";
}

function githubReturn() {
  const url = new URL(location.href),
    errorCode = url.searchParams.get("auth_error"),
    connected = url.searchParams.get("github") === "connected";
  let saved: {
    prompt: string;
    kind: Kind;
    theme: string;
    draft: Draft | null;
    imported: boolean;
    agents: boolean;
    interview: boolean;
    workspace?: WorkspaceTab;
  } | null = null;
  try {
    const raw = sessionStorage.getItem(oauthBriefKey);
    if (raw) {
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (
        data.version === 1 &&
        typeof data.createdAt === "number" &&
        Date.now() - data.createdAt < 30 * 60 * 1000 &&
        Date.now() >= data.createdAt
      ) {
        const text = (value: unknown, limit = 50000) =>
          typeof value === "string" ? value.slice(0, limit) : "";
        const kind = kinds.some((k) => k.id === data.kind)
          ? (data.kind as Kind)
          : "web";
        const source =
          data.draft && typeof data.draft === "object"
            ? (data.draft as Record<string, unknown>)
            : null;
        const draftKind =
          source && kinds.some((k) => k.id === source.kind)
            ? (source.kind as Kind)
            : kind;
        saved = {
          workspace: typeof data.workspace === 'string' && Object.hasOwn(workspacePaths, data.workspace) ? data.workspace as WorkspaceTab : undefined,
          prompt: text(data.prompt),
          kind,
          theme: text(data.theme, 120),
          imported: data.imported === true,
          agents: data.agents === true,
          interview: data.interview === true,
          draft:
            source && data.imported !== true
              ? {
                  kind: draftKind,
                  name: text(source.name, 200),
                  prompt: text(source.prompt),
                  audience: text(source.audience, 10000),
                  theme: text(source.theme, 120),
                  ...(typeof source.template === "string" &&
                  templates.some((t) => t.id === source.template)
                    ? { template: source.template }
                    : {}),
                }
              : null,
        };
      }
    }
  } catch {
    /* An unavailable browser store must not prevent sign-in. */
  }
  return { errorCode, connected, saved };
}

export function App() {
  const communityEnabled = useCommunityEnabled();
  const [oauthReturn] = useState(githubReturn);
  const [callbackError, setCallbackError] = useState(() =>
    oauthReturn.errorCode ? githubError(oauthReturn.errorCode) : "",
  );
  const [agentsRequested, setAgentsRequested] = useState(
    () =>
      new URL(location.href).searchParams.get("settings") === "agents" ||
      oauthReturn.saved?.agents === true,
  );
  const [settingsTab, setSettingsTab] = useState<
    "providers" | "agents" | "account"
  >(() => ["providers", "agents", "account"].includes(screenParam("settings")) ? screenParam("settings") as "providers" | "agents" | "account" : "providers");
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [projects, setProjects] = useState<Summary[]>([]);
  const [project, setProject] = useState<Project | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const contextualSearch = useContextualSearch(!project);
  useEffect(() => {
    if (!user || project) return;
    type ToolContext = Parameters<typeof registerVisualInspectionBrowserTools>[0];
    const context = (document as unknown as { modelContext?: ToolContext }).modelContext ?? (navigator as unknown as { modelContext?: ToolContext }).modelContext;
    if (context?.registerTool) return registerVisualInspectionBrowserTools(context);
  }, [user?.id, project?.id]);
  const [communityImport, setCommunityImport] = useState<string | null>(null);
  useEffect(() => { if (user && !screenParam('project')) setCommunityImport(storedCommunityImport(user.id)); else setCommunityImport(null); }, [user?.id]);
  const [authScreen, setAuthScreen] = useScreenState("auth", "", ["", "signin"]);
  const auth = authScreen === "signin";
  const setAuth = (value: boolean) => setAuthScreen(value ? "signin" : "");
  const
    [settings, setSettingsState] = useState(false),
    [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState(""),
    [kind, setKind] = useState<Kind>("web"),
    [theme, setTheme] = useScreenState("theme", "", ["", ...themes.map(t => t.id)]),
    [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("updated"),
    [view, setView] = useState<"grid" | "list">("grid"),
    [tab, setTabState] = useState<WorkspaceTab>(() => workspaceTab(location.pathname));
  const openingProject = useRef(0);
  const lastLocation = useRef(location.href);
  function setSettings(value: boolean) { setSettingsState(value); writeScreen({ settings: value ? settingsTab : null }); }
  function setTab(next: WorkspaceTab) {
    navigateWorkspace(next);
    setTabState(next);
    setProject(null);
  }
  useEffect(() => {
    const restore = () => {
      const id = screenParam('project');
      if (project && id !== project.id && !window.dispatchEvent(new Event('studio:leave-project', { cancelable: true }))) {
        history.pushState(history.state, '', lastLocation.current); window.dispatchEvent(new PopStateEvent('popstate')); return;
      }
      lastLocation.current = location.href;
      openingProject.current++;
      setTabState(workspaceTab(location.pathname));
      if (!id) setProject(null);
      else if (id !== project?.id && user) void open(id, false);
      const settings = screenParam('settings');
      setSettingsState(['providers', 'agents', 'account'].includes(settings) && !!user);
      if (['providers', 'agents', 'account'].includes(settings)) setSettingsTab(settings as typeof settingsTab);
    };
    const rememberLocation = () => { lastLocation.current = location.href; };
    window.addEventListener('studio:navigation', rememberLocation);
    window.addEventListener("popstate", restore);
    return () => { window.removeEventListener("popstate", restore); window.removeEventListener("studio:navigation", rememberLocation); };
  }, [project?.id, user]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => document.querySelector('.main-header nav [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [tab, project?.id]);
  const [draft, setDraft] = useState<Draft | null>(null),
    [providers, setProviders] = useState<Provider[]>([]),
    [provider, setProvider] = useState("openai");
  const [pendingInterview, setPendingInterview] = useState(
    oauthReturn.saved?.interview === true,
  );
  const [openingBriefRequest, setOpeningBriefRequest] = useState("");
  const creationRunning = useRef(false),
    resumeStarted = useRef(false);
  const [remove, setRemove] = useState<Summary | null>(null);
  useEffect(() => { resetAnalyticsIdentity(); }, [user?.id]);
  useEffect(() => {
    if (!ready) return;
    void trackClient({ event: 'page_view', page: project ? 'editor' : tab === 'themes' ? 'design-systems' : tab === 'activity' ? 'observability' : tab, ...(project ? { projectId: project.id } : {}) });
    if (tab === 'templates' && !project) void trackClient({ event: 'template_open', page: 'templates' });
    if (tab === 'themes' && !project) void trackClient({ event: 'design_system_open', page: 'design-systems' });
  }, [ready, user?.id, tab, project?.id]);
  async function refresh() {
    const data = await api<{ projects: Summary[] }>("/api/projects");
    setProjects(data.projects);
  }
  useEffect(() => {
    api<{ user: User | null }>("/api/auth/me")
      .then((data) => {
        setUser(data.user);
        if (data.user) resumeCommunitySignIn();
      })
      .catch((e) => setError(message(e)))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.has("auth_error") || url.searchParams.has("github")) {
      url.searchParams.delete("auth_error");
      url.searchParams.delete("github");
      history.replaceState(
        history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
    try {
      sessionStorage.removeItem(oauthBriefKey);
    } catch {
      /* Recovery is optional. */
    }
    if (oauthReturn.saved) {
      if (oauthReturn.saved.workspace && location.pathname === '/') {
        setTabState(oauthReturn.saved.workspace);
        const target = new URL(location.href); target.pathname = workspacePaths[oauthReturn.saved.workspace];
        history.replaceState(history.state, '', target.pathname + target.search + target.hash);
      }
      setPrompt(oauthReturn.saved.prompt);
      setKind(oauthReturn.saved.kind);
      setTheme(oauthReturn.saved.theme);
      setDraft(oauthReturn.saved.draft);
    }
    if (oauthReturn.errorCode) {
      setAuth(true);
    } else if (oauthReturn.connected) {
      setNotice(
        oauthReturn.saved?.imported
          ? "GitHub connected. Re-import your design file to continue its import."
          : "GitHub connected. Welcome to your workspace.",
      );
    }
  }, [oauthReturn]);
  function preserveBrief() {
    try {
      sessionStorage.setItem(
        oauthBriefKey,
        JSON.stringify({
          version: 1,
          createdAt: Date.now(),
          workspace: tab,
          prompt,
          kind,
          theme,
          imported: Boolean(draft?.document),
          agents: agentsRequested,
          interview: pendingInterview,
          draft: draft
            ? {
                kind: draft.kind,
                name: draft.name,
                prompt: draft.prompt,
                audience: draft.audience,
                theme: draft.theme,
                template: draft.template,
              }
            : null,
        }),
      );
    } catch {
      /* Sign-in still works when browser storage is unavailable. */
    }
  }
  function continueWithGitHub() {
    preserveBrief();
    location.assign("/api/auth/github");
  }
  useEffect(() => {
    if (user) {
      refresh().catch((e) => setError(message(e)));
      api<{ providers: Provider[] }>("/api/providers")
        .then((d) => setProviders(d.providers))
        .catch((e) => setError(message(e)));
      if (['providers', 'agents', 'account'].includes(screenParam('settings'))) setSettingsState(true);
    } else setProjects([]);
  }, [user]);
  useEffect(() => {
    if (!agentsRequested || !ready) return;
    const url = new URL(location.href);
    url.searchParams.set("settings", "agents");
    history.replaceState(
      history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    if (!user) {
      setAuth(true);
      return;
    }
    setSettingsTab("agents");
    setAuth(false);
    setSettings(true);
    setAgentsRequested(false);
  }, [agentsRequested, ready, user]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 9000);
    return () => clearTimeout(timer);
  }, [notice]);
  const filtered = useMemo(
    () =>
      projects
        .filter(
          (p) =>
            (filter === "all" || p.kind === filter) &&
            `${p.name} ${p.description}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name)
            : new Date(
                sort === "created" ? b.createdAt : b.updatedAt,
              ).getTime() -
              new Date(
                sort === "created" ? a.createdAt : a.updatedAt,
              ).getTime(),
        ),
    [projects, search, filter, sort],
  );
  const galleryItems =
    tab === "templates"
      ? templates
          .filter((t) => filter === "all" || t.kind === filter)
          .map((template) => ({
            ...kinds.find((k) => k.id === template.kind)!,
            template,
          }))
      : kinds.map((k) => ({
          ...k,
          template: templates.find((t) => t.kind === k.id),
        }));
  function begin(selectedKind = kind, template?: string) {
    setError("");
    if (prompt.trim() && !template) {
      setKind(selectedKind);
      setPendingInterview(true);
      if (!user) setAuth(true);
      return;
    }
    writeScreen({ template: template || selectedKind });
    setDraft({
      kind: selectedKind,
      name: "",
      prompt,
      audience: "",
      theme:
        theme ||
        templates.find((t) => t.id === template)?.themeId ||
        themes[0]?.id ||
        "",
      template,
    });
  }
  useEffect(() => {
    const restore = () => {
      const id = screenParam("template");
      if (!id) { setDraft(null); return; }
      const preset = templates.find(t => t.id === id);
      const selectedKind = preset?.kind || kinds.find(k => k.id === id)?.id;
      if (selectedKind) setDraft(current => current?.template === preset?.id && current?.kind === selectedKind ? current : { kind: selectedKind, name: "", prompt: "", audience: "", theme: preset?.themeId || themes[0].id, template: preset?.id });
    };
    if (screenParam("template")) restore(); window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  function showProject(next: Project, push = true) {
    setProject(next);
    void trackClient({ event: 'project_open', page: 'editor', projectId: next.id });
    if (push) writeScreen({ project: next.id, page: null, panel: null, mode: null, inspector: null, settings: null, slide: null, view: null, pane: null, brief: null, dialog: null, template: null, auth: null, library: null });
  }
  useEffect(() => {
    if (!ready || resumeStarted.current) return;
    const id = new URL(location.href).searchParams.get("project");
    if (!id) return;
    if (!user) {
      setAuth(true);
      return;
    }
    resumeStarted.current = true;
    void open(id, false);
  }, [ready, user]);
  useEffect(() => {
    if (!pendingInterview || !user || creationRunning.current || !prompt.trim())
      return;
    creationRunning.current = true;
    setPendingInterview(false);
    setAuth(false);
    setBusy(true);
    setError("");
    const request = prompt.trim();
    void (async () => {
      let created: Project | undefined;
      try {
        const document = createDocument(
          kind,
          request.split("\n")[0]!.slice(0, 72),
          theme || undefined,
        );
        document.pages = [{ ...document.pages[0]!, nodes: [] }];
        if (document.timeline) document.timeline.tracks = [];
        created = (
          await post<{ project: Project }>("/api/projects", {
            name: document.name,
            kind,
            description: request,
            document,
          })
        ).project;
        setOpeningBriefRequest(request);
        await put(`/api/projects/${created.id}/brief`, {
          expectedRevision: 0,
          request,
        });
        showProject(created);
        setPrompt("");
        await refresh();
      } catch (e) {
        if (created) showProject(created);
        setError(message(e));
      } finally {
        creationRunning.current = false;
        setBusy(false);
      }
    })();
  }, [pendingInterview, user, prompt, kind, theme]);
  async function create(blank = false) {
    if (!draft) return;
    if (!user) {
      setAuth(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const document =
        draft.document ||
        createDocument(
          draft.kind,
          draft.name.trim() || "Untitled design",
          draft.theme,
          draft.template,
        );
      if (blank && !draft.document) {
        document.pages = [{ ...document.pages[0]!, nodes: [] }];
        if (document.timeline) document.timeline.tracks = [];
      }
      const { project: created } = await post<{ project: Project }>(
        "/api/projects",
        {
          name: document.name,
          kind: draft.kind,
          description: [
            draft.prompt,
            draft.audience && `Audience: ${draft.audience}`,
          ]
            .filter(Boolean)
            .join("\n"),
          document,
        },
      );
      showProject(created);
      setDraft(null);
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string, push = true) {
    const request = ++openingProject.current;
    setBusy(true);
    setError("");
    try {
      const response = await api<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}`);
      if (request !== openingProject.current) return;
      showProject(response.project, push);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function duplicate(item: Summary) {
    setBusy(true);
    try {
      const source = (
        await api<{ project: Project }>(`/api/projects/${item.id}`)
      ).project;
      const document = structuredClone(source.document);
      document.name = `${source.name} copy`;
      const result = await post<{ project: Project }>("/api/projects", {
        name: document.name,
        kind: source.kind,
        description: source.description,
        document,
      });
      await refresh();
      setNotice(`Created “${result.project.name}”.`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function importFile(file: File) {
    setBusy(true);
    setError("");
    try {
      if (/\.zip$/i.test(file.name)) {
        if (!user) { setAuth(true); setNotice('Sign in, then choose the Studio package again to import.'); return; }
        const operationId = crypto.randomUUID(); storedCommunityImport(user.id, operationId); setCommunityImport(operationId);
        const body = new FormData(); body.append('file', file); body.append('operationId', operationId);
        const { job } = await api<{ job: CommunityJob }>('/api/community/imports', { method: 'POST', body });
        setCommunityImport(job.operationId); return;
      }
      const result = await importDesign(file);
      setDraft({
        kind: result.document.kind,
        name: result.document.name,
        prompt: "",
        audience: "",
        theme: result.document.theme.id,
        document: result.document,
        importNotice: result.notice,
      });
      setNotice(result.notice);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {project ? (
        <Editor
          accountId={user?.id}
          key={project.id}
          initial={project}
          initialBriefRequest={openingBriefRequest}
          onBack={() => {
            setProject(null);
            setOpeningBriefRequest("");
            writeScreen({ project: null, page: null, panel: null, mode: null, inspector: null, slide: null, view: null, pane: null, brief: null, dialog: null });
            refresh().catch((e) => setError(message(e)));
          }}
          onSettings={() => {
            setSettingsTab("providers");
            setSettings(true);
          }}
          onProject={setProject}
          notify={setNotice}
        />
      ) : (
        <div className="home-shell">
          <header className="main-header">
            <a
              className="brand-link"
              href="/"
              onClick={(e) => {
                e.preventDefault();
                setTab("projects");
              }}
            >
              <Brand />
            </a>
            <nav aria-label="Main navigation">
              {([['projects', 'Workspace'], ['templates', 'Templates'], ['themes', 'Design systems']] as const).map(([key, label]) => (
                <a key={key} href={workspacePaths[key]} className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined}
                  onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); setTab(key); } }}>
                  {label}
                </a>
              ))}
              {communityEnabled && <a href="/community">Community</a>}
              <a href="/activity" className={tab === 'activity' ? 'active' : ''} aria-current={tab === 'activity' ? 'page' : undefined}
                onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); setTab('activity'); } }}>
                <Activity size={16} aria-hidden="true" /> Activity
              </a>
              <a className="header-docs-link" href="/docs">
                Documentation
              </a>
              <a className="header-docs-link" href="/guide">
                Guide
              </a>
            </nav>
            <div className="header-end">
              <button className="icon-button" aria-label="Search My projects" title="Search My projects (Ctrl+K)" onClick={() => contextualSearch.setOpen(true)}><Search size={19}/></button>
              <ThemeToggle />
              <a
                className="icon-button documentation-shortcut"
                href="/docs"
                aria-label="Documentation"
                title="Documentation"
              >
                <BookOpen size={19} />
              </a>
              <button
                className="icon-button"
                title="Settings and connections"
                aria-label="Settings and connections"
                onClick={() => (user ? setSettings(true) : setAuth(true))}
              >
                <Settings2 size={19} />
              </button>
              {user ? (
                <button
                  className="avatar"
                  aria-label="Your account and settings"
                  onClick={() => setSettings(true)}
                  title={user.email}
                >
                  {(user.name || user.email).slice(0, 1).toUpperCase()}
                </button>
              ) : (
                <button className="button small" onClick={() => setAuth(true)}>
                  {ready ? "Sign in" : "Connecting…"}
                </button>
              )}
            </div>
          </header>
          <main className="home-main"><div className="home-atmosphere" aria-hidden="true"><i/><i/><i/><span>+</span><span>◌</span></div>
            {tab !== "themes" && tab !== "activity" && (
              <section className="creation-section">
                <div className="intro-label">
                  <span className="tiny-star">✳</span> A space for your next
                  idea
                </div>
                <h1>
                  What should we <em>create?</em>
                </h1>
                <p className="intro-copy">
                  From a first thought to something worth sharing.
                </p>
                <div className="composer">
                  <textarea
                    aria-label="Describe your design"
                    placeholder="A pitch deck for a big idea, a website for a small business…"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <div className="composer-footer">
                    <div className="composer-controls">
                      <label
                        className="icon-button import-button"
                        title="Import a design"
                      >
                        <Import size={19} />
                        <input
                          type="file"
                          accept=".json,.svg,.html,.htm,.zip"
                          aria-label="Import a design"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void importFile(file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <label className="composer-select">
                        <Layers3 size={16} />
                        <select
                          aria-label="Design system"
                          value={theme}
                          onChange={(e) => setTheme(e.target.value)}
                        >
                          <option value="">Design system</option>
                          {themes.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <button
                      className="button primary"
                      aria-label="Let's create"
                      disabled={busy}
                      onClick={() => begin()}
                    >
                      {busy ? (
                        <Busy label="Opening…" />
                      ) : (
                        <>
                          <span>Let's create</span>
                          <ArrowUp size={18} />
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <div
                  className="kind-picker"
                  role="group"
                  aria-label="Design type"
                >
                  {kinds.map((k) => (
                    <button
                      key={k.id}
                      className={kind === k.id ? "selected" : ""}
                      onClick={() => {
                        setKind(k.id);
                        if (tab === "templates") setFilter(k.id);
                      }}
                    >
                      <k.icon size={17} />
                      {k.name}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {tab === "activity" ? (
              <ObservabilityDashboard key={user?.id ?? "anonymous"} user={user} onSignIn={() => setAuth(true)} />
            ) : tab === "themes" ? (
              <section className="systems-section">
                <div className="section-title">
                  <div>
                    <h1>Your design, in character.</h1>
                    <p>
                      Choose a system. Every color and type choice travels with
                      your design.
                    </p>
                  </div>
                </div>
                <div className="theme-gallery">
                  {themes.map((t) => (
                    <button
                      className={`theme-card ${theme === t.id ? "selected" : ""}`}
                      key={t.id}
                      onClick={() => {
                        setTheme(t.id);
                        setNotice(`${t.name} selected for your next project.`);
                      }}
                    >
                      <div
                        className="theme-type"
                        style={{
                          color: t.colors.text || t.colors.foreground,
                          background: t.colors.background,
                          fontFamily: t.fonts.heading,
                        }}
                      >
                        Aa
                        <span style={{ fontFamily: t.fonts.body }}>
                          Good design feels like you.
                        </span>
                      </div>
                      <div className="theme-meta">
                        <strong>{t.name}</strong>
                        <span>{theme === t.id && <Check size={16} />}</span>
                      </div>
                      <div className="color-strip">
                        {Object.entries(t.colors)
                          .slice(0, 6)
                          .map(([name, color]) => (
                            <span
                              key={name}
                              title={`${name}: ${color}`}
                              style={{ background: color }}
                            />
                          ))}
                      </div>
                    </button>
                  ))}
                </div>
                <p className="quiet-note">
                  Open any design to edit its color palette, fonts, and corner
                  radius in the Theme inspector. Inspired presets adapt selected visual foundations to the studio’s Ant/shadcn components; they are not official framework implementations.
                </p>
              </section>
            ) : (
              <>
                <section className="template-section">
                  <div className="section-title">
                    <div>
                      <h2>
                        {tab === "templates"
                          ? "Find your starting point"
                          : "A head start, beautifully made"}
                      </h2>
                      <p>Thoughtful templates. Yours to make your own.</p>
                    </div>
                    {tab !== "templates" ? (
                      <button
                        className="text-button"
                        onClick={() => {
                          setTab("templates");
                          setFilter("all");
                        }}
                      >
                        Explore templates <ArrowRight size={16} />
                      </button>
                    ) : (
                      <label className="inline-select">
                        <select
                          aria-label="Filter templates"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">All templates</option>
                          {kinds.map((k) => (
                            <option key={k.id} value={k.id}>
                              {k.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <div className="template-gallery">
                    {galleryItems.map((k, i) => {
                      const template = k.template;
                      const doc = createDocument(
                        k.id,
                        template?.name || k.name,
                        undefined,
                        template?.id,
                      );
                      return (
                        <button
                          className={`template-card template-${k.id}`}
                          key={template?.id || k.id}
                          onClick={() => begin(k.id, template?.id)}
                        >
                          <div className={`template-preview preview-${i % 6}`}>
                            <div
                              className="template-art"
                              dangerouslySetInnerHTML={{
                                __html: renderSvg(doc, 0, 2),
                              }}
                            />
                            <span className="template-use">
                              Use template <ArrowUp size={15} />
                            </span>
                          </div>
                          <div className="template-caption">
                            <k.icon size={16} />
                            <span>
                              <strong>
                                {tab === "templates"
                                  ? template?.name || k.name
                                  : k.name}
                              </strong>
                              <small>{tab === "templates" ? template?.description || k.description : k.description}</small>
                            </span>
                            <ArrowRight size={15} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
                {tab === "projects" && (
                  <section className="projects-section">
                    <div className="section-title">
                      <div className="title-with-count">
                        <h2>Your projects</h2>
                        <span className="count">{projects.length}</span>
                      </div>
                      <button className="text-button" onClick={() => begin()}>
                        <Plus size={17} /> New project
                      </button><button className="button-secondary" onClick={() => begin('wireframe', 'creative-board')}>New Board</button>
                    </div>
                    <div className="project-controls">
                      <label className="search-box">
                        <Search size={17} />
                        <input
                          placeholder="Search your projects"
                          aria-label="Search your projects"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && (
                          <button
                            className="icon-button"
                            aria-label="Clear search"
                            onClick={() => setSearch("")}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </label>
                      <div className="filter-controls">
                        <label className="inline-select">
                          <SlidersHorizontal size={15} />
                          <select
                            aria-label="Filter project type"
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                          >
                            <option value="all">All types</option>
                            {kinds.map((k) => (
                              <option key={k.id} value={k.id}>
                                {k.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="inline-select">
                          <ArrowDownUp size={15} />
                          <select
                            aria-label="Sort projects"
                            value={sort}
                            onChange={(e) => setSort(e.target.value)}
                          >
                            <option value="updated">Last edited</option>
                            <option value="created">Date created</option>
                            <option value="name">Name</option>
                          </select>
                        </label>
                        <div className="view-toggle">
                          <button
                            className={view === "grid" ? "selected" : ""}
                            title="Grid view"
                            aria-label="Grid view"
                            onClick={() => setView("grid")}
                          >
                            <Grid2X2 size={16} />
                          </button>
                          <button
                            className={view === "list" ? "selected" : ""}
                            title="List view"
                            aria-label="List view"
                            onClick={() => setView("list")}
                          >
                            <List size={17} />
                          </button>
                        </div>
                      </div>
                    </div>
                    {!user ? (
                      <div className="welcome-projects">
                        <div className="welcome-mark">
                          <FolderOpen size={26} />
                        </div>
                        <div>
                          <h3>A home for everything you make</h3>
                          <p>
                            Sign in to save your ideas, pick up where you left
                            off, and share your work.
                          </p>
                        </div>
                        <button
                          className="button"
                          onClick={() => setAuth(true)}
                        >
                          Create your workspace <ArrowRight size={16} />
                        </button>
                      </div>
                    ) : filtered.length === 0 ? (
                      <Empty
                        icon={<FolderOpen size={28} />}
                        title={
                          search || filter !== "all"
                            ? "No matching projects"
                            : "Your next project starts here"
                        }
                      >
                        {search || filter !== "all"
                          ? "Try a different search or select all project types."
                          : "Choose a template above or tell us what you have in mind."}
                      </Empty>
                    ) : (
                      <div className={`project-list ${view}`}>
                        {filtered.map((item) => {
                          const Icon =
                            kinds.find((k) => k.id === item.kind)?.icon ||
                            FileText;
                          return (
                            <article className="project-card" key={item.id}>
                              <button
                                className="project-open"
                                onClick={() => void open(item.id)}
                              >
                                <div
                                  className={`project-thumbnail thumb-${item.kind}`}
                                >
                                  <ProjectThumbnail id={item.id} revision={item.revision} thumbnailRevision={item.thumbnailRevision} name={item.name} />
                                </div>
                                <div className="project-detail">
                                  <strong>{item.name}</strong>
                                  <span>
                                    {
                                      kinds.find((k) => k.id === item.kind)
                                        ?.name
                                    }{" "}
                                    <span aria-hidden="true">·</span>{" "}
                                    {new Date(
                                      item.updatedAt,
                                    ).toLocaleDateString(undefined, {
                                      month: "short",
                                      day: "numeric",
                                    })}
                                  </span>
                                </div>
                              </button>
                              <div className="project-actions">
                                <button
                                  className="icon-button"
                                  aria-label={`Duplicate ${item.name}`}
                                  onClick={() => void duplicate(item)}
                                >
                                  <Copy size={16} />
                                </button>
                                <button
                                  className="icon-button"
                                  aria-label={`Delete ${item.name}`}
                                  onClick={() => setRemove(item)}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
          </main>
          <footer className="home-footer">
            <span>Made for people. Open to agents.</span>
            <div className="footer-links">
              <a className="text-button" href="/guide">
                Guide <ArrowRight size={14} />
              </a>
              <a className="text-button" href="/docs">
                <BookOpen size={16} />
                Documentation
              </a>
              <button
                className="text-button"
                onClick={() => {
                  setSettingsTab("agents");
                  user
                    ? setSettings(true)
                    : (setAgentsRequested(true), setAuth(true));
                }}
              >
                <Code2 size={16} /> Connect your tools <ArrowRight size={14} />
              </button>
            </div>
          </footer>
        </div>
      )}
      {error && (
        <div className="toast error" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {draft && (
        <Modal
          title={
            draft.document
              ? "Import your design"
              : "Give your idea a little direction"
          }
          onClose={() => { if (!busy) { setDraft(null); writeScreen({ template: null }); } }}
        >
          <div className="modal-body brief-form">
            <p className="modal-description">
              A few details make a better starting point. You can change
              everything in the editor.
            </p>
            {draft.importNotice && (
              <p className="import-summary">{draft.importNotice}</p>
            )}
            <div className="brief-kind">
              <span>{kinds.find((k) => k.id === draft.kind)?.name}</span>
              <span>
                {draft.document ? "Imported document" : "Editable template"}
              </span>
            </div>
            <Field label="Project name">
              <input
                autoFocus
                value={draft.name}
                placeholder="A name for your next idea"
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    name: e.target.value,
                    document: draft.document
                      ? { ...draft.document, name: e.target.value }
                      : undefined,
                  })
                }
              />
            </Field>
            <Field label="What are we making?">
              <textarea
                value={draft.prompt}
                placeholder="The outcome, the story, the feeling…"
                onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              />
            </Field>
            <Field label="Who is it for?">
              <input
                value={draft.audience}
                placeholder="Investors, your customers, your team…"
                onChange={(e) =>
                  setDraft({ ...draft, audience: e.target.value })
                }
              />
            </Field>
            <Field label="Design system">
              <select
                value={draft.theme}
                onChange={(e) => setDraft({ ...draft, theme: e.target.value })}
              >
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="brief-note">
              <Sparkles size={18} />
              <p>
                Start with a template, then ask AI to shape it. AI generation
                uses your own provider key.
              </p>
            </div>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button primary full"
              disabled={busy}
              onClick={() => void create(false)}
            >
              {busy ? (
                <Busy label="Creating…" />
              ) : (
                <>
                  {user
                    ? draft.document
                      ? "Import into workspace"
                      : "Start from template"
                    : "Sign in to create"}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
            {!draft.document && (
              <button
                className="text-button full"
                disabled={busy}
                onClick={() => void create(true)}
              >
                Start with a blank canvas
              </button>
            )}
          </div>
        </Modal>
      )}
      {auth && (
        <Auth
          onGitHub={continueWithGitHub}
          initialError={callbackError}
          onClose={() => {
            setAuth(false);
            setCallbackError("");
          }}
          onUser={(value) => {
            setUser(value);
            if (resumeCommunitySignIn()) return;
            setAuth(false);
            setCallbackError("");
            if (oauthReturn.saved?.imported)
              setNotice(
                "Your brief was restored. Re-import your design file to continue its import.",
              );
          }}
        />
      )}{" "}
      {settings && user && (
        <Settings
          initialTab={settingsTab}
          onBeforeGitHubLink={preserveBrief}
          user={user}
          onClose={() => setSettings(false)}
          onLogout={async () => {
            await post("/api/auth/logout");
            setUser(null);
            setProject(null);
            setSettings(false);
          }}
          onProviders={(next) => {
            setProviders(next);
            window.dispatchEvent(new Event("studio-providers-updated"));
          }}
        />
      )}
      {contextualSearch.open && <CommunitySearchDialog initialScope="projects" accountId={user?.id} onClose={() => contextualSearch.setOpen(false)}/>}
      {communityImport && <Modal title="Import Studio project package" onClose={() => { setCommunityImport(null); if(user) storedCommunityImport(user.id, ''); }}><div className="modal-body"><CommunityJobStatus operationId={communityImport}/></div></Modal>}
      {remove && (
        <Modal title="Delete this project?" onClose={() => setRemove(null)}>
          <div className="modal-body">
            <p>
              “{remove.name}” and its saved design will be deleted. This cannot
              be undone. Any Community listing for this project will be unlisted. Existing private remixes and downloaded files remain with their recipients.
            </p>
            <div className="button-row">
              <button className="button" onClick={() => setRemove(null)}>
                Keep project
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`/api/projects/${remove.id}`, {
                      method: "DELETE",
                    });
                    setRemove(null);
                    await refresh();
                  } catch (e) {
                    setError(message(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete project
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function Auth({
  onClose,
  onUser,
  onGitHub,
  initialError,
}: {
  onClose: () => void;
  onUser: (user: User) => void;
  onGitHub: () => void;
  initialError: string;
}) {
  const [register, setRegister] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError),
    [githubEnabled, setGithubEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    api<{ githubEnabled: boolean }>("/api/config")
      .then((config) => {
        if (active) setGithubEnabled(config.githubEnabled === true);
      })
      .catch(() => {
        if (active)
          setError(
            (current) =>
              current ||
              "Sign-in options could not load. You can still use your email and password.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <Modal
      title={register ? "Make yourself at home" : "Welcome back to the studio"}
      onClose={onClose}
    >
      <form
        className="modal-body auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const result = await post<{ user: User }>(
              `/api/auth/${register ? "register" : "login"}`,
              { email, password, ...(register ? { name } : {}) },
            );
            onUser(result.user);
          } catch (err) {
            setError(message(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="modal-description">
          Your ideas, saved in one place. Your provider keys, kept private.
        </p>
        {githubEnabled && (
          <>
            <button
              type="button"
              className="button github-button full"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                onGitHub();
              }}
            >
              <GitHubMark size={19} aria-hidden="true" />
              Continue with GitHub
            </button>
            <div className="auth-divider">
              <span>or continue with email</span>
            </div>
          </>
        )}
        {register && (
          <Field label="Your name">
            <input
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
        )}
        <Field label="Email address">
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field
          label="Password"
          hint={register ? "At least 12 characters." : undefined}
        >
          <input
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            minLength={register ? 12 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? (
            <Busy />
          ) : (
            <>
              {register ? "Create account" : "Sign in"}
              <ArrowRight size={17} />
            </>
          )}
        </button>
        <p className="auth-switch">
          {register ? "Already have a workspace?" : "New around here?"}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setRegister(!register);
              setError("");
            }}
          >
            {register ? "Sign in" : "Create an account"}
          </button>
        </p>
      </form>
    </Modal>
  );
}
