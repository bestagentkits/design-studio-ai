import { AgentRunActivity } from './agent-run-activity';
import { ProjectConnections } from './project-connections';
import { builtInProviders, isTextProvider, isCustomProvider } from '../shared/providers';
import { trackClient } from './analytics';
import './editor-ergonomics.css';
import { InlineTextEditor } from './inline-text-editor';
import { canMoveNode, isNodeProtected, localMovement, moveNodeTree, selectedRoots, toggleSelection } from './editor-selection';
import { loadDocumentFonts } from '../shared/font-loading';
import { mergeDocuments } from '../shared/document-merge';
import { DocumentView, usesDom } from './document-view';
import { ModelPicker } from './model-picker';
import { SlidePlayer } from './slide-player';
import { useCanvasGestures } from './canvas-gestures';
import { LayerTree } from './layer-tree';
import { TimelineEditor } from './timeline-editor';
import { resolveLayout, subtree } from '../shared/layout';
import { transformNode, type Handle } from '../shared/transform';
import { componentNames } from '../shared/design-capabilities';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Check,
  Circle,
  Code2,
  Copy,
  Diamond,
  Download,
  Eye,
  FileText,
  Film,
  ImagePlus,
  Layers3,
  Group,
  Ungroup,
  Keyboard,
  Trash2,
  Pencil,
  ListChecks,
  LockKeyhole,
  Maximize2,
  MessageSquare,
  Minus,
  Monitor,
  MousePointer2,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  Settings2,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Type,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  documentSchema,
  nodeSchema,
  type DesignDocument,
  type DesignNode,
  type Project,
} from "../shared/schema";
import { blocks, createBlock } from "../shared/catalog";
import { interpolateNode, renderSvg } from "../shared/render";
import {
  api,
  clone,
  download,
  message,
  post,
  put,
  uid,
  type Provider,
} from "./api";
import { Brand, Busy, Field, Modal } from "./ui";
import { Inspector } from "./inspector";
import { ThemeToggle } from "./theme-toggle";
import { navigateButtonGroup } from "./keyboard-navigation";
import { DesignBriefWorkspace } from "./design-brief";
import type { DesignBrief } from "../shared/brief";
import { inspectDesign } from "../shared/design-checks";

import { exportDesign } from "./file-formats";
import { registerDesignTools } from './browser-design-tools';
import { mutateDocument } from '../shared/operations';
const SceneView = lazy(() =>
  import("./scene-view").then((module) => ({ default: module.SceneView })),
);

type ChatMessage = { id?: string; role: "user" | "assistant"; text: string };
type Asset = DesignDocument["assets"][number];
type ToolContext = {
  registerTool: (tool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (args: Record<string, unknown>) => Promise<unknown>;
    annotations?: {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
      openWorldHint?: boolean;
    };
  }) => void;
  unregisterTool?: (name: string) => void;
};

export function Editor({
  initial,
  initialBriefRequest = "",
  onBack,
  onSettings,
  onProject,
  notify,
}: {
  initial: Project;
  initialBriefRequest?: string;
  onBack: () => void;
  onSettings: () => void;
  onProject: (project: Project) => void;
  notify: (message: string) => void;
}) {
  const [showConnections,setShowConnections]=useState(false),[connectorsEnabled,setConnectorsEnabled]=useState(false);
  useEffect(()=>{let active=true;api<{connectorsEnabled:boolean}>('/api/config').then(c=>{if(active)setConnectorsEnabled(c.connectorsEnabled===true);}).catch(()=>{});return()=>{active=false;};},[]);
  const [brief, setBrief] = useState<DesignBrief | null>(null),
    [briefLoaded, setBriefLoaded] = useState(false),
    [briefManual, setBriefManual] = useState(false),
    [briefError, setBriefError] = useState("");
  const briefProposal = useRef<{
    document: DesignDocument;
    briefRevision: number;
    projectRevision: number;
  } | null>(null);
  async function loadBrief() {
    setBriefError("");
    try {
      let next = (
        await api<{ brief: DesignBrief | null }>(
          `/api/projects/${initial.id}/brief`,
        )
      ).brief;
      if (!next && initialBriefRequest)
        next = (
          await put<{ brief: DesignBrief }>(
            `/api/projects/${initial.id}/brief`,
            { expectedRevision: 0, request: initialBriefRequest },
          )
        ).brief;
      setBrief(next);
      setBriefManual(
        Boolean(
          next?.status === "approved" &&
          initial.document.pages.some((p) => p.nodes.length),
        ),
      );
      setBriefLoaded(true);
    } catch (e) {
      setBriefError(message(e));
    }
  }
  useEffect(() => {
    void loadBrief();
  }, [initial.id]);
  async function buildFromBrief(
    approvedBrief: DesignBrief,
    selectedProvider: string,
    selectedModel: string,
  ) {
    if (approvedBrief.status !== "approved" || !approvedBrief.scope)
      throw new Error("Approve the design scope before generating.");
    if (dirty)
      throw new Error(
        "Save your manual canvas edits before building from this scope.",
      );
    const latest = (
      await api<{ brief: DesignBrief }>(
        `/api/projects/${projectRef.current.id}/brief`,
      )
    ).brief;
    if (
      latest.revision !== approvedBrief.revision ||
      latest.status !== "approved"
    )
      throw new Error(
        "The brief changed. Reload it and approve the latest scope before building.",
      );
    let pending = briefProposal.current;
    if (!pending || pending.briefRevision !== approvedBrief.revision) {
      const response = await post<{ document: DesignDocument }>(
        `/api/projects/${projectRef.current.id}/generate`,
        {
          prompt:
            "Build the design from this approved scope.\n" +
            JSON.stringify({
              request: approvedBrief.request,
              answers: approvedBrief.answers,
              scope: approvedBrief.scope,
            }),
          provider: selectedProvider,
          ...(selectedModel.trim() ? { model: selectedModel.trim() } : {}),
          expectedRevision: projectRef.current.revision,
        },
      );
      const generated = documentSchema.parse(response.document);
      if (
        generated.id !== projectRef.current.id ||
        generated.kind !== projectRef.current.kind
      )
        throw new Error(
          "The generated design changed the project identity or format. Retry with your provider.",
        );
      pending = {
        document: generated,
        briefRevision: approvedBrief.revision,
        projectRevision: projectRef.current.revision,
      };
      briefProposal.current = pending;
      setProposal(generated);setRunProposal(null);
    }
    const { project: next } = await put<{ project: Project }>(
      `/api/projects/${projectRef.current.id}/document`,
      { document: pending.document, expectedRevision: pending.projectRevision },
    );
    remember();
    projectRef.current = next;
    docRef.current = next.document;
    setProject(next);
    setDoc(next.document);
    setSaved(JSON.stringify(next.document));
    onProject(next);
    setProposal(null);setRunProposal(null);
    briefProposal.current = null;
    setPageIndex(0);
    setSelected(null);
    setPrompt("");
    setBriefManual(true);
    notify("Your first design is ready and saved.");
    void appendChat(
      "assistant",
      "Created and saved the first design from your approved scope.",
    ).catch((e) => setError(message(e)));
  }
  const [project, setProject] = useState(initial),
    [doc, setDoc] = useState<DesignDocument>(() => clone(initial.document));
  const [saved, setSaved] = useState(JSON.stringify(initial.document)),
    [requestedPageIndex, setPageIndex] = useState(0),
    [selection, setSelection] = useState<string[]>([]);
  const selected = selection.at(-1) ?? null;
  const selectionRef = useRef(selection); selectionRef.current = selection;
  function setSelected(id: string | null) { setSelection(id ? [id] : []); }
  function selectLayer(id: string, additive = false) {
    setDirectText(null);
    setSelection(previous => additive ? toggleSelection(previous, id) : [id]);
  }
  const [panel, setPanel] = useState("chat"),
    [mobilePanel, setMobilePanel] = useState("canvas"),
    [prompt, setPrompt] = useState(initial.description || "");
  const [chat, setChat] = useState<ChatMessage[]>([]),
    [chatLoaded, setChatLoaded] = useState(false),
    [providers, setProviders] = useState<Provider[]>([]),
    [provider, setProvider] = useState("openai"),
    [model, setModel] = useState("");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [proposal, setProposal] = useState<DesignDocument | null>(null),
    [exportOpen, setExportOpen] = useState(false),
    [shareUrl, setShareUrl] = useState("");
  const [runProposal,setRunProposal]=useState<string|null>(null);
  const proposalRef=useRef(proposal);proposalRef.current=proposal;
  const [showChecks, setShowChecks] = useState(false);
  const designChecks = showChecks ? inspectDesign(doc) : null;
  const [live, setLive] = useState(true);
  const [syncStatus, setSyncStatus] = useState("Live");
  const syncing = useRef(false);
  const syncBlocked = useRef(false);

  const [presenting, setPresenting] = useState(false);
  const [domBounds, setDomBounds] = useState<DesignNode[]>([]);
  const [domOverlayBounds, setDomOverlayBounds] = useState<DesignNode[]>([]);
  const measureDom = useCallback((nodes: DesignNode[]) => setDomBounds(previous => JSON.stringify(previous) === JSON.stringify(nodes) ? previous : nodes), []);
  const measureOverlay = useCallback((nodes: DesignNode[]) => setDomOverlayBounds(previous => JSON.stringify(previous) === JSON.stringify(nodes) ? previous : nodes), []);
  const [showCode, setShowCode] = useState(false),
    [preview, setPreview] = useState(false),
    [zoom, setZoom] = useState(1),
    [fitted, setFitted] = useState(0.55),
    [directText, setDirectText] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  syncBlocked.current = !!busy || !!proposal || !!directText;
  const [historyCount, setHistoryCount] = useState(0),
    [redoCount, setRedoCount] = useState(0),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false);
  const [mediaPrompt, setMediaPrompt] = useState(""),
    [mediaKind, setMediaKind] = useState<"image" | "audio" | "video">("image"),
    [mediaProvider, setMediaProvider] = useState("openai"),
    [mediaJob, setMediaJob] = useState(""),
    [leaving, setLeaving] = useState(false),
    [failedExport, setFailedExport] = useState("");
  const [googleUrl, setGoogleUrl] = useState("");
  const [sourceAsset, setSourceAsset] = useState(""),
    [mediaDuration, setMediaDuration] = useState(5),
    [mediaStrength, setMediaStrength] = useState(0.7),
    [mediaModel, setMediaModel] = useState(""),
    [mediaVoice, setMediaVoice] = useState("alloy");
  const history = useRef<DesignDocument[]>([]),
    future = useRef<DesignDocument[]>([]),
    docRef = useRef(doc),
    projectRef = useRef(project),
    saveRef = useRef<() => Promise<void>>(async () => {});
  const viewport = useRef<HTMLDivElement>(null),
    drag = useRef<{
      ids: string[]; x: number; y: number; original: DesignDocument;
      resize: Handle; started: boolean;
    } | null>(null);
  const pointerSelecting = useRef(false);
  const dirty = JSON.stringify(doc) !== saved,
    displayed = proposal || doc,
    pageIndex = Math.max(0, Math.min(requestedPageIndex, displayed.pages.length - 1)),
    page = displayed.pages[Math.min(pageIndex, displayed.pages.length - 1)]!,
    baseNode = doc.pages[pageIndex]?.nodes.find((n) => n.id === selected),
    node = baseNode ? interpolateNode(baseNode, doc, time) : undefined,
    scale = fitted * zoom;
  useEffect(() => {
    setSelection(ids => {
      const remaining = ids.filter(id => doc.pages[pageIndex]?.nodes.some(item => item.id === id));
      return remaining.length === ids.length ? ids : remaining;
    });
    if (directText && !doc.pages[pageIndex]?.nodes.some(item => item.id === directText)) setDirectText(null);
  }, [doc.pages, pageIndex, directText]);
  useEffect(() => { setSelection([]); setDirectText(null); }, [page.id]);
  function beginText(id: string) {
    const target = docRef.current.pages[pageIndex].nodes.find(item => item.id === id);
    if (!target || target.type !== 'text' || isNodeProtected(docRef.current.pages[pageIndex], target) || busy || preview || proposal) return;
    drag.current = null; setPlaying(false); setSelected(id); setDirectText(id);
  }
  function finishText(text: string | null, restoreFocus: boolean, original: string) {
    const target = docRef.current.pages[pageIndex].nodes.find(item => item.id === directText);
    if (target && text !== null && text !== original) {
      if ((target.text ?? '') !== original) { setError('This text changed remotely. Your draft is still open; copy it before cancelling and reconciling.'); return false; }
      void trackClient({ event: 'editor_action', action: 'text_edit', page: 'editor', projectId: initial.id });
      change(d => { const target = d.pages[pageIndex].nodes.find(item => item.id === directText); if (target) target.text = text; });
    }
    setDirectText(null);
    if (restoreFocus) viewport.current?.focus({ preventScroll: true });
    return true;
  }
  const viewportReady = (briefLoaded || !!briefError) && (!brief || briefManual);
  const { pan, resetPan } = useCanvasGestures(viewport, scale, setZoom, displayed.kind === '3d', viewportReady, () => { drag.current = null; });
  useEffect(() => {
    let active = true;
    void loadDocumentFonts(displayed).catch(error => {
      if (active && viewport.current) viewport.current.dataset.fontError = error instanceof Error ? error.message : 'Font loading failed';
    });
    return () => { active = false; };
  }, [displayed.theme.fonts, displayed.pages]);
  docRef.current = doc;
  projectRef.current = project;
  function remember() {
    history.current.push(clone(docRef.current));
    if (history.current.length > 80) history.current.shift();
    future.current = [];
    setHistoryCount(history.current.length);
    setRedoCount(0);
  }
  const change = useCallback((recipe: (doc: DesignDocument) => void) => {
    try {
      const next = clone(docRef.current);
      recipe(next);
      next.metadata.updatedAt = new Date().toISOString();
      const validated = documentSchema.parse(next);
      remember(); docRef.current = validated; setDoc(validated); setProposal(null);setRunProposal(null);
    } catch (error) { setError(`Edit rejected: ${message(error)}`); }
  }, []);
  function setNodePatch(
    d: DesignDocument,
    target: DesignNode,
    patch: Partial<DesignNode>,
  ) {
    Object.assign(target, patch);
    const track = d.timeline?.tracks.find((t) => t.nodeId === target.id);
    if (!track || track.locked || track.muted) return;
    const animated = Object.fromEntries(
      Object.entries(patch).filter(
        ([key, value]) =>
          ["x", "y", "width", "height", "rotation", "opacity"].includes(key) &&
          typeof value === "number",
      ),
    ) as Record<string, number>;
    if (!Object.keys(animated).length) return;
    const at = Math.round(time * 100) / 100;
    let frame = track.keyframes.find((k) => k.time === at);
    if (!frame) {
      frame = { time: at, values: {} };
      track.keyframes.push(frame);
      track.keyframes.sort((a, b) => a.time - b.time);
    }
    Object.assign(frame.values, animated);
  }
  function translateNode(d: DesignDocument, target: DesignNode, patch: Partial<DesignNode>) {
    const pose = interpolateNode(target, d, time);
    setNodePatch(d, target, { x: pose.x + (patch.x ?? target.x) - target.x, y: pose.y + (patch.y ?? target.y) - target.y });
  }
  function update(patch: Partial<DesignNode>) {
    if (!selected || selection.length !== 1 || !baseNode) return;
    if (isNodeProtected(doc.pages[pageIndex], baseNode) && !Object.keys(patch).every(key => key === 'locked' || key === 'visible')) return;
    change((d) => {
      if (patch.layout) { Object.assign(d, mutateDocument(d, [{ op: 'update-node', nodeId: selected, changes: patch }])); return; }
      const target = d.pages[pageIndex]!.nodes.find((n) => n.id === selected);
      if (target) setNodePatch(d, target, patch);
    });
  }
  function undo() {
    const last = history.current.pop();
    if (!last) return;
    future.current.push(clone(docRef.current));
    docRef.current = last; setDoc(last);
    setHistoryCount(history.current.length);
    setRedoCount(future.current.length);
    setProposal(null);setRunProposal(null);
  }
  function redo() {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(clone(docRef.current));
    docRef.current = next; setDoc(next);
    setHistoryCount(history.current.length);
    setRedoCount(future.current.length);
  }
  async function save() {
    if (busy) return;
    setBusy("Saving");
    setError("");
    try {
      while (syncing.current) await new Promise(resolve => setTimeout(resolve, 50));
      syncing.current = true;
      const sending = clone(docRef.current), base = clone(projectRef.current.document);
      const response = live ? await post<{ project: Project }>(`/api/projects/${project.id}/merge`, {
        base, document: sending, baseRevision: projectRef.current.revision,
      }) : await put<{ project: Project }>(
        `/api/projects/${project.id}/document`,
        { document: sending, expectedRevision: projectRef.current.revision },
      );
      const merged = mergeDocuments(sending, docRef.current, response.project.document);
      let excluded = 0;
      const rebase = (entries: DesignDocument[]) => entries.flatMap(entry => { try { return [mergeDocuments(sending, entry, response.project.document)]; } catch { excluded++; return []; } });
      history.current = rebase(history.current); future.current = rebase(future.current);
      setHistoryCount(history.current.length); setRedoCount(future.current.length);
      projectRef.current = response.project; docRef.current = merged;
      setDoc(merged);
      setProject(response.project);
      onProject(response.project);
      setSaved(JSON.stringify(response.project.document));
      notify(excluded ? `Saved. ${excluded} undo states overlapping remote edits were removed.` : "All changes saved.");
    } catch (e) {
      setError(message(e));
    } finally {
      syncing.current = false;
      setBusy("");
    }
  }
  saveRef.current = save;
  useEffect(() => {
    if (!live) return;
    let stopped = false;
    const synchronize = async () => {
      if (syncing.current || drag.current || syncBlocked.current || stopped) return;
      syncing.current = true;
      const base = clone(projectRef.current.document), sending = clone(docRef.current);
      try {
        const changed = JSON.stringify(sending) !== JSON.stringify(base);
        const result = changed
          ? await post<{ project?: Project }>(`/api/projects/${project.id}/merge`, { base, document: sending, baseRevision: projectRef.current.revision })
          : await api<{ project?: Project }>(`/api/projects/${project.id}/changes?since=${projectRef.current.revision}`);
        if (stopped || !result.project) return;
        const remote = result.project;
        // Edits typed during the request are reconciled, never replaced by its response.
        const merged = mergeDocuments(changed ? sending : base, docRef.current, remote.document);
        let excluded = 0;
        const rebaseHistory = (entries: DesignDocument[]) => entries.flatMap(entry => { try { return [mergeDocuments(changed ? sending : base, entry, remote.document)]; } catch { excluded++; return []; } });
        history.current = rebaseHistory(history.current); future.current = rebaseHistory(future.current);
        setHistoryCount(history.current.length); setRedoCount(future.current.length);
        projectRef.current = remote; docRef.current = merged;
        setProject(remote); setDoc(merged); setSaved(JSON.stringify(remote.document)); onProject(remote); setSyncStatus('Live · synced');
        if (excluded) notify(`${excluded} undo states overlap a remote edit and were removed to protect that edit.`);
      } catch (e) {
        setSyncStatus(message(e));
        if (e instanceof Error && /conflict/i.test(e.message)) { setLive(false); setError(`Live sync paused. ${e.message} Your local edits are preserved. Export JSON before reconciling.`); }
      } finally { syncing.current = false; }
    };
    const timer = window.setInterval(() => { void synchronize(); }, 1200);
    return () => { stopped = true; clearInterval(timer); };
  }, [live, project.id]);
  useEffect(() => {
    let active = true;
    const load = () => api<{ providers: Provider[] }>("/api/providers")
      .then(result => {
        if (!active) return;
        setProviders(result.providers);
        setMediaProvider(current => isCustomProvider(current) && !result.providers.some(p => p.provider === current) ? 'openai' : current);
        setProvider(current => result.providers.some(p => p.provider === current && isTextProvider(p.provider)) ? current : result.providers.find(p => isTextProvider(p.provider))?.provider ?? 'openai');
      }).catch(e => { if (active) setError(message(e)); });
    void load();
    window.addEventListener('studio-providers-updated', load);
    return () => { active = false; window.removeEventListener('studio-providers-updated', load); };
  }, []);
  useEffect(() => {
    let active = true;
    api<{ messages: ChatMessage[] }>(`/api/projects/${project.id}/messages`)
      .then((result) => {
        if (active)
          setChat((current) => (current.length ? current : result.messages));
      })
      .catch((e) => {
        if (active)
          setError(`Conversation history could not load. ${message(e)}`);
      })
      .finally(() => {
        if (active) setChatLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [project.id]);
  useEffect(() => { setModel(''); }, [provider]);
  useEffect(() => { setMediaModel(''); setSourceAsset(''); }, [mediaProvider]);

  async function appendChat(role: ChatMessage["role"], text: string) {
    const optimisticId = uid();
    setChat((current) => [...current, { id: optimisticId, role, text }]);
    const result = await post<{ message: ChatMessage }>(
      `/api/projects/${project.id}/messages`,
      { role, text },
    );
    setChat((current) =>
      current.map((item) => (item.id === optimisticId ? result.message : item)),
    );
  }
  useEffect(() => {
    if (!viewport.current) return;
    const fit = () => {
      // Hidden mobile panels report zero dimensions. Fitting them would mirror
      // the canvas and leave DOM overlays measured with a negative scale.
      if (!viewport.current?.clientWidth || !viewport.current.clientHeight) return;
      const width = Math.max(1, viewport.current.clientWidth - 64),
        height = Math.max(1, viewport.current.clientHeight - 80);
      setFitted(
        Math.min(width / page.width, height / Math.min(page.height, 1100), 1),
      );
    };
    const observer = new ResizeObserver(fit);
    observer.observe(viewport.current);
    fit();
    return () => observer.disconnect();
  }, [page.width, page.height, mobilePanel, viewportReady]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!playing || !doc.timeline) return;
    let frame = 0;
    const start = performance.now() - time * 1000;
    const tick = () => {
      const next = (performance.now() - start) / 1000;
      if (next >= doc.timeline!.duration) {
        setTime(doc.timeline!.duration);
        setPlaying(false);
        return;
      }
      setTime(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, doc.timeline?.duration]);
  function removeNode() {
    void trackClient({ event: 'editor_action', action: 'delete', page: 'editor', projectId: initial.id });
    const roots = selectedRoots(docRef.current.pages[pageIndex], selection);
    if (!roots.length) return;
    change(d => {
      const targetPage = d.pages[pageIndex];
      const ids = new Set(roots.flatMap(root => [...subtree(targetPage, root.id)]));
      targetPage.nodes = targetPage.nodes.filter(item => !ids.has(item.id));
      if (d.timeline) d.timeline.tracks = d.timeline.tracks.filter(track => !ids.has(track.nodeId));
    });
    setSelected(null); viewport.current?.focus({ preventScroll: true });
  }
  function duplicateNode() {
    void trackClient({ event: 'editor_action', action: 'duplicate', page: 'editor', projectId: initial.id });
    const roots = selectedRoots(docRef.current.pages[pageIndex], selection);
    if (!roots.length) return;
    const actions = roots.map(root => ({ op: 'duplicate-node' as const, nodeId: root.id, duplicateId: uid() }));
    change(d => Object.assign(d, mutateDocument(d, actions)));
    setSelection(actions.map(action => action.duplicateId));
    viewport.current?.focus({ preventScroll: true });
  }
  function groupSelection() {
    void trackClient({ event: 'editor_action', action: 'group', page: 'editor', projectId: initial.id });
    const roots = selectedRoots(docRef.current.pages[pageIndex], selection);
    if (roots.length < 2) return;
    const id = uid(), ids = roots.map(root => root.id);
    const bounds = usesDom(page) ? domBounds.filter(item => ids.includes(item.id) || item.id === roots[0].parentId).map(({ id, x, y, width, height }) => ({ id, x, y, width, height })) : undefined;
    try {
      const next = mutateDocument(docRef.current, [{ op: 'group-nodes', pageId: page.id, nodeIds: ids, groupId: id, ...(bounds?.length ? { bounds } : {}) }]);
      change(d => Object.assign(d, next)); setSelected(id);
    } catch (error) { setError(message(error)); }
  }
  function ungroupSelection() {
    void trackClient({ event: 'editor_action', action: 'ungroup', page: 'editor', projectId: initial.id });
    const roots = selectedRoots(docRef.current.pages[pageIndex], selection).filter(item => item.type === 'group');
    if (!roots.length) return;
    const childIds = docRef.current.pages[pageIndex].nodes.filter(item => roots.some(root => root.id === item.parentId)).map(item => item.id);
    try {
      const next = mutateDocument(docRef.current, roots.map(root => ({ op: 'ungroup-node', nodeId: root.id })));
      change(d => Object.assign(d, next)); setSelection(childIds);
    } catch (error) { setError(message(error)); }
  }
  function nudgeSelection(dx: number, dy: number) {
    const roots = selectedRoots(docRef.current.pages[pageIndex], selection).filter(item => canMoveNode(docRef.current.pages[pageIndex], item));
    if (!roots.length) return;
    change(d => {
      for (const root of roots) {
        const target = d.pages[pageIndex].nodes.find(item => item.id === root.id)!;
        const delta = localMovement(d, d.pages[pageIndex], target, time, dx, dy);
        moveNodeTree(d.pages[pageIndex], target, delta.x, delta.y, (item, patch) => translateNode(d, item, patch));
      }
    });
  }
  function reorder(direction: number) {
    if (selection.length !== 1 || !node || isNodeProtected(doc.pages[pageIndex], node)) return;
    change((d) => {
      const nodes = d.pages[pageIndex]!.nodes,
        index = nodes.findIndex((n) => n.id === selected),
        next = Math.max(0, Math.min(nodes.length - 1, index + direction));
      if (index >= 0)
        [nodes[index], nodes[next]] = [nodes[next]!, nodes[index]!];
    });
  }
  function duplicatePage() {
    change((d) => {
      const original = d.pages[pageIndex]!,
        copy = clone(original),
        ids = new Map(original.nodes.map((n) => [n.id, uid()]));
      copy.id = uid();
      copy.name = `${copy.name} copy`;
      copy.nodes.forEach((n) => {
        n.id = ids.get(n.id)!;
        if (n.parentId) n.parentId = ids.get(n.parentId);
        n.interactions = n.interactions?.map(action => ({ ...action, target:
          action.action === 'toggle' ? ids.get(action.target) ?? action.target :
          action.action === 'navigate' && action.target === original.id ? copy.id : action.target }));
      });
      d.pages.splice(pageIndex + 1, 0, copy);
      if (d.timeline)
        d.timeline.tracks.push(
          ...d.timeline.tracks
            .filter((t) => ids.has(t.nodeId))
            .map((t) => ({
              ...clone(t),
              id: uid(),
              nodeId: ids.get(t.nodeId)!,
            })),
        );
    });
    setPageIndex(pageIndex + 1);
    setSelected(null);
  }
  function removePage() {
    if (doc.pages.length < 2) return;
    change((d) => {
      const ids = new Set(d.pages[pageIndex]!.nodes.map((n) => n.id));
      d.pages.splice(pageIndex, 1);
      if (d.timeline)
        d.timeline.tracks = d.timeline.tracks.filter((t) => !ids.has(t.nodeId));
    });
    setPageIndex(Math.max(0, pageIndex - 1));
    setSelected(null);
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      // Local controls and overlays own their keys, even when a canvas node remains selected.
      if (
        event.defaultPrevented || event.isComposing ||
        !document.querySelector(".editor-shell") ||
        document.querySelector("dialog[open], [popover]:popover-open")
      ) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        void saveRef.current();
        return;
      }
      if (target instanceof HTMLInputElement && target.type === 'number' && event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const value = Math.max(target.min === '' ? -Infinity : Number(target.min), Math.min(target.max === '' ? Infinity : Number(target.max), (Number(target.value) || 0) + (event.key === 'ArrowUp' ? 10 : -10)));
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(target, String(value));
        target.dispatchEvent(new Event('input', { bubbles: true })); return;
      }
      if (
        target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      )
        return;
      if (event.key === "Escape") {
        setSelected(null);
        setPreview(false);
        return;
      }
      if (busy || preview || proposal || event.altKey) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }
      if (!target.closest(".node-target, .layer-row, .canvas-viewport")) return;
      const command = event.metaKey || event.ctrlKey;
      const letter = event.key.toLowerCase();
      if (command && letter === 'a') {
        event.preventDefault(); setDirectText(null);
        setSelection(page.nodes.filter(item => !isNodeProtected(page, item)).map(item => item.id)); return;
      }
      if (command && letter === 'g') { event.preventDefault(); event.shiftKey ? ungroupSelection() : groupSelection(); return; }
      if (!command && event.key === '?') { event.preventDefault(); setShortcutsOpen(true); return; }
      if (!command && event.key === 'Enter' && node?.type === 'text' && selection.length === 1) { event.preventDefault(); beginText(node.id); return; }
      if (!command && letter === 'v') { event.preventDefault(); setSelected(null); return; }
      if (!command && letter === 't') { event.preventDefault(); beginText(addNode('text').id); return; }
      if (command && event.key === '0') { event.preventDefault(); setZoom(1); resetPan(); return; }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "d"
      ) {
        event.preventDefault();
        duplicateNode();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeNode();
      } else if (
        !target.closest(".layer-row") &&
        !event.metaKey && !event.ctrlKey &&
        selection.length > 0 &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        nudgeSelection(
          event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0,
          event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0,
        );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [node, selection, pageIndex, busy, preview, proposal, directText]);
  function addNode(type: DesignNode["type"], extra: Partial<DesignNode> = {}) {
    const newNode: DesignNode = {
      id: uid(),
      type,
      name:
        type === "text" ? "Your text" : type[0].toUpperCase() + type.slice(1),
      x: type === "model3d" ? page.width / 2 : 64,
      y: type === "model3d" ? page.height / 2 : 64,
      width: type === "text" ? 480 : 200,
      height: type === "text" ? 100 : 200,
      ...(type === "text"
        ? {
            text: "Make something good.",
            style: { fill: "$text", fontSize: 40, fontFamily: "$heading" },
          }
        : { style: { fill: "$accent", borderRadius: 12 } }),
      ...extra,
    };
    change((d) => {
      d.pages[pageIndex]!.nodes.push(newNode);
    });
    setSelected(newNode.id);
    viewport.current?.focus({ preventScroll: true });
    return newNode;
  }
  function pointerDown(event: PointerEvent, target: DesignNode, resize: Handle = 'move') {
    event.stopPropagation();
    if (event.button !== 0 || directText) return;
    pointerSelecting.current = true;
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus({ preventScroll: true });
    pointerSelecting.current = false;
    event.preventDefault();
    if (event.shiftKey && resize === 'move') { void trackClient({ event: 'editor_action', action: 'multiselect', page: 'editor', projectId: initial.id }); setSelection(ids => toggleSelection(ids, target.id)); return; }
    const ids = selectionRef.current.includes(target.id) && resize === 'move' ? selectionRef.current : [target.id];
    setSelection(ids);
    if (preview || proposal || busy || isNodeProtected(docRef.current.pages[pageIndex], target)) return;
    const roots = selectedRoots(docRef.current.pages[pageIndex], ids).filter(item => resize !== 'move' || canMoveNode(docRef.current.pages[pageIndex], item));
    if (!roots.length || (resize !== 'move' && ids.length !== 1)) return;
    drag.current = { ids: roots.map(item => item.id), x: event.clientX, y: event.clientY, original: clone(docRef.current), resize, started: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent) {
    const active = drag.current;
    if (!active) return;
    const dx = (event.clientX - active.x) / scale, dy = (event.clientY - active.y) / scale;
    if (!active.started) {
      if (Math.hypot(event.clientX - active.x, event.clientY - active.y) < 3) return;
      void trackClient({ event: 'editor_action', action: active.resize === 'move' ? 'move' : active.resize === 'rotate' ? 'rotate' : 'resize', page: 'editor', projectId: initial.id });
      remember(); active.started = true;
    }
    const next = clone(active.original), targetPage = next.pages[pageIndex];
    for (const id of active.ids) {
      const target = targetPage.nodes.find(item => item.id === id)!;
      const delta = localMovement(next, targetPage, target, time, dx, dy);
      if (active.resize === 'move') moveNodeTree(targetPage, target, delta.x, delta.y, (item, patch) => translateNode(next, item, patch));
      else setNodePatch(next, target, transformNode(interpolateNode(target, next, time), delta.x, delta.y, active.resize, event.shiftKey));
    }
    docRef.current = next; setDoc(next);
  }
  async function generate() {
    if (!prompt.trim() || busy) return;
    if (!briefLoaded || (brief && brief.status !== "approved")) {
      setError(
        "Complete and approve the design brief before AI generation. You can keep editing the canvas manually.",
      );
      if (brief) setBriefManual(false);
      return;
    }
    if (dirty) {
      setError(
        "Save your edits before generating so the provider works from the latest design.",
      );
      return;
    }
    const request = prompt;
    setBusy("Generating");
    setError("");
    try {
      await appendChat("user", request);
      const result = await post<{ document: DesignDocument }>(
        `/api/projects/${project.id}/generate`,
        {
          prompt: request,
          provider,
          ...(model ? { model } : {}),
          expectedRevision: project.revision,
        },
      );
      setProposal(result.document);setRunProposal(null);
      setPageIndex(0);
      setPrompt("");
      await appendChat(
        "assistant",
        "Your proposal is ready in the canvas. Review the pages, then apply it or keep your current design.",
      ).catch((e) =>
        setError(
          `Your proposal is ready, but its conversation entry could not be saved. ${message(e)}`,
        ),
      );
    } catch (e) {
      setError(message(e));
      try {
        await appendChat(
          "assistant",
          `Generation could not finish. ${message(e)} Your current design is unchanged.`,
        );
      } catch (historyError) {
        setError(
          `${message(e)} Conversation could not be saved: ${message(historyError)}`,
        );
      }
    } finally {
      setBusy("");
    }
  }
  async function addAsset(asset: Asset) {
    change((d) => {
      if (!d.assets.some((a) => a.id === asset.id)) d.assets.push(asset);
    });
    const type: DesignNode["type"] = asset.mimeType.startsWith("image/")
      ? "image"
      : asset.mimeType.startsWith("audio/")
        ? "audio"
        : asset.mimeType.startsWith("video/")
          ? "video"
          : "model3d";
    addNode(type, {
      name: asset.name,
      src: asset.url,
      width: type === "image" ? 480 : 240,
      height: type === "image" ? 320 : 240,
    });
  }
  async function upload(file: File) {
    setBusy("Uploading");
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const { asset } = await api<{ asset: Asset }>(
        `/api/projects/${project.id}/assets`,
        { method: "POST", body },
      );
      await addAsset(asset);
      notify("Asset imported. Save to keep its placement.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  async function generateMedia() {
    if (!mediaPrompt.trim()) return;
    setBusy("Generating media");
    setError("");
    try {
      const result = await post<{ asset?: Asset; job?: { id: string } }>(
        `/api/projects/${project.id}/media`,
        {
          prompt: mediaPrompt,
          kind: mediaKind,
          provider: mediaProvider,
          ...(sourceAsset ? { sourceAssetId: sourceAsset } : {}),
          ...(mediaModel ? { model: mediaModel } : {}),
          ...(mediaKind === "audio" && mediaProvider === "openai"
            ? { voice: mediaVoice }
            : {}),
          ...(mediaProvider === "fal" &&
          mediaKind !== "image" &&
          !(
            mediaKind === "video" &&
            doc.assets
              .find((a) => a.id === sourceAsset)
              ?.mimeType.startsWith("video/")
          )
            ? { durationSeconds: mediaDuration }
            : {}),
          ...(mediaProvider === "fal" && sourceAsset && mediaKind !== "video"
            ? { strength: mediaStrength }
            : {}),
        },
      );
      if (result.asset) {
        await addAsset(result.asset);
        notify("Generated media added to the canvas.");
      }
      if (result.job) {
        setMediaJob(result.job.id);
        notify("Media generation started. Check its progress in Assets.");
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  async function checkMedia() {
    setBusy("Checking media");
    try {
      const result = await api<{ status: string; asset?: Asset }>(
        `/api/projects/${project.id}/media/${encodeURIComponent(mediaJob)}`,
      );
      if (result.asset) {
        await addAsset(result.asset);
        setMediaJob("");
        notify("Generated media added to your assets.");
      } else
        notify(
          `Media generation is ${result.status}. Check again in a moment.`,
        );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  async function publish() {
    if (dirty) {
      setError("Save your latest edits before publishing a snapshot.");
      return;
    }
    setBusy("Publishing");
    setError("");
    try {
      const result = await post<{ url: string }>(
        `/api/projects/${project.id}/publish`,
      );
      setShareUrl(new URL(result.url, location.origin).href);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }
  async function exportFile(format: string, local = false) {
    local ||= ['react', 'glb', 'gltf'].includes(format);
    setBusy(`Exporting ${format.toUpperCase()}`);
    setError("");
    setFailedExport("");
    try {
      if (local) {
        if (doc.kind === "3d" && format === "png") {
          const canvas =
            document.querySelector<HTMLCanvasElement>(".scene-view canvas");
          if (!canvas)
            throw new Error("Open the 3D viewport before exporting an image.");
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve),
          );
          if (!blob) throw new Error("Could not capture the scene.");
          download(`${doc.name}.png`, blob, "image/png");
        } else await exportDesign(doc, format, pageIndex);
      } else {
        let revision = projectRef.current.revision;
        if (JSON.stringify(docRef.current) !== saved) {
          const sending = clone(docRef.current);
          const result = await put<{ project: Project }>(
            `/api/projects/${project.id}/document`,
            { document: sending, expectedRevision: revision },
          );
          setProject(result.project);
          onProject(result.project);
          setSaved(JSON.stringify(sending));
          revision = result.project.revision;
        }
        if (format === "google") setGoogleUrl(await googleSlides(project.id));
        else {
          const response = await fetch(`/api/projects/${project.id}/export`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              format,
              pageIndex,
              expectedRevision: revision,
            }),
          });
          if (!response.ok) {
            const data = (await response.json().catch(() => null)) as {
              error?: { message?: string };
            } | null;
            throw new Error(
              data?.error?.message ||
                `Export failed (${response.status}). Please try again.`,
            );
          }
          const blob = await response.blob();
          download(
            `${doc.name.replace(/[^a-z0-9 _-]/gi, "") || "design"}.${format}`,
            blob,
            blob.type,
          );
        }
      }
      setExportOpen(false);
      notify(
        local && format === "pdf"
          ? "Choose Save as PDF in the print dialog."
          : "Your export is ready.",
      );
    } catch (e) {
      setError(message(e));
      if (!local && !["google", "mp4"].includes(format))
        setFailedExport(format);
    } finally {
      setBusy("");
    }
  }
  function keyframe() {
    if (!node || !doc.timeline) {
      notify("Select a layer to add a keyframe.");
      return;
    }
    if (doc.timeline.tracks.some(t => t.nodeId === node.id && t.locked)) { notify('Unlock the track before adding a keyframe.'); return; }
    change((d) => {
      let track = d.timeline!.tracks.find((t) => t.nodeId === node.id);
      if (!track) {
        track = { id: uid(), nodeId: node.id, keyframes: [] };
        d.timeline!.tracks.push(track);
      }
      const at = Math.round(time * 100) / 100;
      const previous = track.keyframes.find(k => k.time === at);
      track.keyframes = track.keyframes.filter((k) => k.time !== at);
      track.keyframes.push({
        ...previous,
        time: at,
        values: {
          ...previous?.values,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          rotation: node.rotation || 0,
          opacity: node.opacity ?? 1,
        },
      });
      track.keyframes.sort((a, b) => a.time - b.time);
    });
    notify(`Keyframe added at ${time.toFixed(1)}s.`);
  }
  useEffect(() => {
    const context =
      (document as unknown as { modelContext?: ToolContext }).modelContext ||
      (navigator as unknown as { modelContext?: ToolContext }).modelContext;
    if (!context?.registerTool) return;
    const result = (data: unknown) => ({
      content: [{ type: "text", text: JSON.stringify(data) }],
    });
    const toolNames = [
      "studio_get_design",
      "studio_update_node",
      "studio_save_design",
      "studio_set_design",
      "studio_get_brief",
      "studio_update_brief",
      "studio_approve_brief",
      "studio_inspect_design",
    ];
    let unregisterAdditional: (() => void) | undefined;
    try {
      unregisterAdditional = registerDesignTools(context, () => docRef.current, next => change(d => Object.assign(d, next)));
      context.registerTool({
        name: toolNames[0]!,
        description:
          "Read the current unsaved Design Studio document and saved revision.",
        inputSchema: { type: "object", properties: {} },
        execute: async () =>
          result({
            document: docRef.current,
            revision: projectRef.current.revision,
          }),
      });
      context.registerTool({
        name: toolNames[1]!,
        description:
          "Update one existing node in the open editor. This updates the editor immediately; live mode autosaves.",
        inputSchema: {
          type: "object",
          properties: {
            nodeId: { type: "string" },
            patch: {
              type: "object",
              properties: {
                text: { type: "string" },
                x: { type: "number" },
                y: { type: "number" },
                width: { type: "number" },
                height: { type: "number" },
                opacity: { type: "number" },
                rotation: { type: "number" },
              },
              additionalProperties: false,
            },
          },
          required: ["nodeId", "patch"],
        },
        execute: async (args) => {
          const patch = args.patch as Record<string, unknown>;
          if (!patch || typeof patch !== "object")
            throw new Error("A patch object is required.");
          if (
            !docRef.current.pages.some((p) =>
              p.nodes.some((n) => n.id === args.nodeId),
            )
          )
            throw new Error("Node not found in the current design.");
          const allowed = new Set([
            "text",
            "x",
            "y",
            "width",
            "height",
            "opacity",
            "rotation",
          ]);
          for (const [key, value] of Object.entries(patch)) {
            if (
              !allowed.has(key) ||
              (key === "text"
                ? typeof value !== "string"
                : typeof value !== "number" || !Number.isFinite(value))
            )
              throw new Error(`Invalid patch field: ${key}`);
          }
          const validated = nodeSchema.parse({
            ...docRef.current.pages
              .flatMap((p) => p.nodes)
              .find((n) => n.id === args.nodeId)!,
            ...patch,
          });
          change((d) => {
            const target = d.pages
              .flatMap((p) => p.nodes)
              .find((n) => n.id === args.nodeId)!;
            Object.assign(target, validated);
          });
          return result({ updated: args.nodeId, saved: false });
        },
      });
      context.registerTool({
        name: toolNames[3]!,
        description:
          "Replace the current local design with a complete validated document. Enables editing pages, layers, assets, themes, and timelines. Keep the project ID and kind; save explicitly afterwards.",
        inputSchema: {
          type: "object",
          properties: { document: { type: "object" } },
          required: ["document"],
        },
        execute: async (args) => {
          const next = documentSchema.parse(args.document);
          if (
            next.id !== projectRef.current.id ||
            next.kind !== projectRef.current.kind
          )
            throw new Error(
              "The document must keep the open project's ID and kind.",
            );
          remember();
          docRef.current = next;
          setDoc(next);
          setPageIndex(0);
          setSelected(null);
          setProposal(null);setRunProposal(null);
          return result({ updated: next.id, saved: false });
        },
      });
      context.registerTool({
        name: toolNames[2]!,
        description:
          "Save the current local document with optimistic revision checking.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => {
          const sending = clone(docRef.current);
          const response = await put<{ project: Project }>(
            `/api/projects/${projectRef.current.id}/document`,
            {
              document: sending,
              expectedRevision: projectRef.current.revision,
            },
          );
          setProject(response.project);
          setSaved(JSON.stringify(sending));
          onProject(response.project);
          return result({ revision: response.project.revision });
        },
      });
      context.registerTool({
        name: "studio_get_brief",
        description:
          "Read the saved interview questions, answers, scope and independent brief revision for the open project.",
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
        inputSchema: { type: "object", properties: {} },
        execute: async () =>
          result(await api(`/api/projects/${projectRef.current.id}/brief`)),
      });
      context.registerTool({
        name: "studio_update_brief",
        description:
          "Persist request, interview, answers or scope for the open project. Requires the brief expectedRevision (0 creates). Every update invalidates scope approval. Use only known question IDs; use a string for custom answers.",
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: "object",
          properties: {
            expectedRevision: { type: "integer", minimum: 0 },
            request: { type: "string" },
            interview: { type: "object" },
            answers: { type: "object" },
            scope: { type: "object" },
          },
          required: ["expectedRevision"],
          additionalProperties: false,
        },
        execute: async (args) => {
          const response = await put<{ brief: DesignBrief }>(
            `/api/projects/${projectRef.current.id}/brief`,
            args,
          );
          setBrief(response.brief);
          setBriefManual(false);
          setBriefLoaded(true);
          return result(response);
        },
      });
      context.registerTool({
        name: "studio_approve_brief",
        description:
          "Approve the current saved scope at its exact brief revision. Only invoke after the user explicitly approves this scope. This does not generate a design.",
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: "object",
          properties: { expectedRevision: { type: "integer", minimum: 1 } },
          required: ["expectedRevision"],
          additionalProperties: false,
        },
        execute: async (args) => {
          const response = await post<{ brief: DesignBrief }>(
            `/api/projects/${projectRef.current.id}/brief/approve`,
            args,
          );
          setBrief(response.brief);
          setBriefManual(false);
          return result(response);
        },
      });
      context.registerTool({
        name: "studio_inspect_design",
        description:
          "Inspect the current local document, including unsaved edits, for bounded deterministic geometry, media, text-fitting and contrast hints. These are not an aesthetic score or accessibility certification.",
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
        inputSchema: { type: "object", properties: {} },
        execute: async () => result(inspectDesign(docRef.current)),
      });
    } catch (e) {
      setError(`Browser tool registration failed: ${message(e)}`);
    }
    return () => {
      unregisterAdditional?.();
      toolNames.forEach((name) => context.unregisterTool?.(name));
    };
  }, [project.id]);

  function mediaSettings() {
    const canSource = mediaProvider === "fal" || (mediaProvider === "openai" && mediaKind === "image");
    const eligible = doc.assets.filter((asset) =>
      mediaKind === "image"
        ? asset.mimeType.startsWith("image/")
        : mediaKind === "audio"
          ? asset.mimeType.startsWith("audio/")
          : /^(image|video)\//.test(asset.mimeType),
    );
    return (
      <div className="media-options">
        {canSource && (
          <Field
            label="Source asset"
            hint={
              eligible.length
                ? "Use an imported asset as a starting point."
                : "Upload an asset above to edit or transform it."
            }
          >
            <select
              value={sourceAsset}
              onChange={(e) => setSourceAsset(e.target.value)}
            >
              <option value="">Start from a prompt</option>
              {eligible.map((asset) => (
                <option value={asset.id} key={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {mediaProvider === "fal" &&
          mediaKind !== "image" &&
          !(
            mediaKind === "video" &&
            doc.assets
              .find((a) => a.id === sourceAsset)
              ?.mimeType.startsWith("video/")
          ) && (
            <Field label="Duration (seconds)">
              {mediaKind === "video" ? (
                <select
                  value={mediaDuration}
                  onChange={(e) => setMediaDuration(Number(e.target.value))}
                >
                  <option value={5}>5 seconds</option>
                  <option value={10}>10 seconds</option>
                </select>
              ) : (
                <input
                  type="number"
                  min={1}
                  max={190}
                  value={mediaDuration}
                  onChange={(e) =>
                    setMediaDuration(
                      Math.max(1, Math.min(190, Number(e.target.value))),
                    )
                  }
                />
              )}
            </Field>
          )}
        {mediaProvider === "fal" && sourceAsset && mediaKind !== "video" && (
          <Field
            label={`Transformation strength: ${Math.round(mediaStrength * 100)}%`}
          >
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={mediaStrength}
              onChange={(e) => setMediaStrength(Number(e.target.value))}
            />
          </Field>
        )}
        {mediaKind === "audio" && mediaProvider === "openai" && (
          <Field label="Voice">
            <select
              value={mediaVoice}
              onChange={(e) => setMediaVoice(e.target.value)}
            >
              {[
                "alloy",
                "ash",
                "ballad",
                "coral",
                "echo",
                "fable",
                "nova",
                "onyx",
                "sage",
                "shimmer",
              ].map((voice) => (
                <option key={voice}>{voice}</option>
              ))}
            </select>
          </Field>
        )}
        <details className="model-override">
          <summary>Media model options</summary>
          <Field
            label="Model override"
            hint="Leave blank for the supported default for this operation."
          >
            <input
              placeholder="Use default model"
              value={mediaModel}
              onChange={(e) => setMediaModel(e.target.value)}
            />
          </Field>
        </details>
      </div>
    );
  }
  if (brief && !briefManual)
    return (
      <DesignBriefWorkspace
        projectId={project.id}
        projectName={project.name}
        brief={brief}
        onBrief={setBrief}
        onBack={onBack}
        onManual={() => setBriefManual(true)}
        onSettings={onSettings}
        onGenerate={buildFromBrief}
      />
    );
  if (!briefLoaded && !briefError)
    return (
      <div className="loading-workspace">
        <Busy label="Opening your project…" />
      </div>
    );
  return (
    <div
      className={`editor-shell ${preview ? "preview-mode" : ""} mobile-${mobilePanel}`}
    >
      {showConnections&&<ProjectConnections projectId={project.id} onClose={()=>setShowConnections(false)}/>}
      <header className="editor-header">
        <div className="editor-heading">
          <button
            className="icon-button"
            aria-label="Back to workspace"
            onClick={() => (dirty ? setLeaving(true) : onBack())}
          >
            <ArrowLeft size={19} />
          </button>
          <Brand compact />
          <div className="project-heading">
            <input
              aria-label="Project name"
              value={doc.name}
              onChange={(e) =>
                change((d) => {
                  d.name = e.target.value;
                })
              }
            />
            <span>
              {busy ? (
                <Busy label={busy} />
              ) : dirty ? (
                "Unsaved changes"
              ) : (
                <>
                  <Check size={11} /> Saved
                </>
              )}
            </span>
          </div>
        </div>
        <div className="editor-header-actions">
          {connectorsEnabled&&<button className="button small connector-header-entry" onClick={()=>setShowConnections(true)}>Tools & sources</button>}
          <ThemeToggle />
          <button
            className="icon-button"
            disabled={!historyCount || !!busy}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            onClick={undo}
          >
            <Undo2 size={18} />
          </button>
          <button
            className="icon-button"
            disabled={!redoCount || !!busy}
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
            onClick={redo}
          >
            <Redo2 size={18} />
          </button>
          <span className="toolbar-divider" />
          <button
            className={`button small preview-button ${preview ? "selected" : ""}`}
            onClick={() => setPreview(!preview)}
          >
            <Play size={15} /> {preview ? "Edit" : "Preview"}
          </button>
          <button
            className="button small export-button"
            aria-label="Export"
            onClick={() => setExportOpen(true)}
            disabled={!!busy}
          >
            <Download size={15} />
            <span>Export</span>
          </button>
          <button
            className="button small share-button"
            aria-label="Share"
            onClick={() => void publish()}
            disabled={!!busy}
          >
            <Share2 size={15} />
            <span>Share</span>
          </button>
          <button
            className="button primary small"
            aria-label="Save"
            onClick={() => void save()}
            disabled={!!busy || !dirty}
          >
            <Save size={15} />
            <span>Save</span>
          </button>
        </div>
      </header>
      {connectorsEnabled&&<button className="connector-mobile-entry" onClick={()=>setShowConnections(true)}><Settings2 size={16}/>Tools & sources</button>}
      {brief && (
        <button className="brief-return" onClick={() => setBriefManual(false)}>
          <Sparkles size={14} />
          {brief.status === "approved"
            ? "View approved scope"
            : "Continue design interview"}
          <ArrowRight size={14} />
        </button>
      )}
      {briefError && (
        <div className="inline-error" role="alert">
          Brief could not load: {briefError}{" "}
          <button className="text-button" onClick={() => void loadBrief()}>
            Retry loading brief
          </button>
        </div>
      )}
      <div
        className="mobile-editor-nav"
        onKeyDown={(event) => navigateButtonGroup(event)}
      >
        <button
          className={mobilePanel === "chat" ? "active" : ""}
          aria-pressed={mobilePanel === "chat"}
          onClick={() => setMobilePanel("chat")}
        >
          <MessageSquare size={16} /> Chat & layers
        </button>
        <button
          className={mobilePanel === "canvas" ? "active" : ""}
          aria-pressed={mobilePanel === "canvas"}
          onClick={() => setMobilePanel("canvas")}
        >
          <Monitor size={16} /> Canvas
        </button>
        <button
          className={mobilePanel === "inspector" ? "active" : ""}
          aria-pressed={mobilePanel === "inspector"}
          onClick={() => setMobilePanel("inspector")}
        >
          <SlidersHorizontal size={16} /> Design
        </button>
      </div>
      <div className="editor-workspace">
        <aside className="left-panel">
          <div
            className="panel-tabs"
            onKeyDown={(event) => navigateButtonGroup(event)}
          >
            <button
              className={panel === "chat" ? "active" : ""}
              aria-pressed={panel === "chat"}
              onClick={() => setPanel("chat")}
            >
              Chat
            </button>
            <button
              className={panel === "layers" ? "active" : ""}
              aria-pressed={panel === "layers"}
              onClick={() => setPanel("layers")}
            >
              Layers
            </button>
            <button
              className={panel === "assets" ? "active" : ""}
              aria-pressed={panel === "assets"}
              onClick={() => setPanel("assets")}
            >
              Assets
            </button>
          </div>
          {panel === "chat" ? (
            <>
              <div className="chat-history">
                <div className="studio-greeting">
                  <Brand compact />
                  <h2>Let's make it yours.</h2>
                  <p>
                    Describe a change, explore a direction, or select something
                    on the canvas to fine-tune it.
                  </p>
                </div>
                {chat.length === 0 && (
                  <div className="chat-suggestions">
                    {[
                      "Make the layout more editorial",
                      "Rewrite the copy for my audience",
                      "Add a clear call to action",
                    ].map((text) => (
                      <button key={text} onClick={() => setPrompt(text)}>
                        {text}
                        <ArrowUp size={14} />
                      </button>
                    ))}
                  </div>
                )}
                {chat.map((item, i) => (
                  <div className={`chat-message ${item.role}`} key={i}>
                    {item.role === "assistant" && (
                      <span className="chat-author">
                        <Sparkles size={13} /> Studio
                      </span>
                    )}
                    <p>{item.text}</p>
                  </div>
                ))}
                {busy === "Generating" && (
                  <div className="generation-progress">
                    <Busy label="Shaping your design…" />
                    <p>
                      Your provider is preparing a proposal. Your saved design
                      stays safe.
                    </p>
                  </div>
                )}
              </div>
              <div className="chat-compose">
                <textarea
                  aria-label="Message to AI designer"
                  placeholder="Describe what you'd like to change…"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
                <div className="chat-compose-footer">
                  <select
                    aria-label="Generation provider"
                    value={provider}
                    onChange={(e) => { setProvider(e.target.value); setModel(''); }}
                  >
                    {builtInProviders.filter(p => isTextProvider(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    {providers.filter(p => isCustomProvider(p.provider)).map(p => <option key={p.provider} value={p.provider}>{p.name ?? p.provider}</option>)}
                  </select>
                  <button
                    className="send-button"
                    title="Generate proposal"
                    aria-label="Generate proposal"
                    disabled={!!busy || !chatLoaded || !prompt.trim()}
                    onClick={() => void generate()}
                  >
                    <ArrowUp size={18} />
                  </button>
                </div>
                <details className="model-override">
                  <summary>Model options</summary>
                  <ModelPicker
                    provider={provider}
                    label="Model override"
                    placeholder="Use provider default"
                    value={model}
                    onChange={setModel}
                  />
                </details>
              </div>
              {connectorsEnabled&&<AgentRunActivity projectId={project.id} documentRevision={project.revision} briefRevision={brief?.revision??0} prompt={prompt} provider={provider} model={model}
                disabled={dirty||!!busy||brief?.status!=='approved'} onStarted={()=>{const text=prompt;setPrompt('');void appendChat('user',text).catch(e=>setError(message(e)));}}
                onProposal={async(document,run)=>{
                  if(dirty||projectRef.current.revision!==run.pins[0].versions.documentRevision)throw new Error('Save or reconcile your edits before previewing this proposal.');
                  const latest=await api<{brief:DesignBrief|null}>(`/api/projects/${project.id}/brief`);
                  if(latest.brief?.revision!==run.pins[0].versions.briefRevision||latest.brief.status!=='approved')throw new Error('The approved brief changed. Start a new run.');
                  const verified=await api<{document:DesignDocument}>(`/api/projects/${project.id}/runs/${run.id}/proposal`);
                  setProposal(verified.document);setRunProposal(run.id);setPageIndex(0);
                }}/>}
              <button className="provider-settings" onClick={onSettings}>
                <Settings2 size={14} />
                {providers.length
                  ? "Manage AI connections"
                  : "Connect your AI provider"}
                <ArrowRight size={14} />
              </button>
            </>
          ) : panel === "layers" ? (
            <LayerTree doc={doc} page={page} selection={selection} select={selectLayer} group={groupSelection} ungroup={ungroupSelection} change={change} />

          ) : (
            <div className="assets-panel">
              <h3>Components</h3><div className="component-catalog">{componentNames.map(name => <button key={name} onClick={() => addNode('component', { name, width: ['Table', 'Chart', 'List'].includes(name) ? 420 : 240, height: ['Table', 'Chart', 'List'].includes(name) ? 260 : 48, component: { name, system: 'shadcn', props: { label: name } } })}>{name}</button>)}</div>
              <button className="button" onClick={() => addNode('frame', { name: 'Auto layout', width: 480, height: 320, layout: { mode: 'flex', direction: 'column', gap: 16, padding: 24 } })}>Add layout container</button>
              <label className="asset-upload">
                <Upload size={24} />
                <strong>Bring something in</strong>
                <span>Images, audio, video, or GLB models</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,audio/*,video/*,.glb"
                  aria-label="Upload asset"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                    e.target.value = "";
                  }}
                />
              </label>
              <div className="asset-grid">
                {doc.assets.map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => {
                      const type = asset.mimeType.startsWith("image/")
                        ? "image"
                        : asset.mimeType.startsWith("audio/")
                          ? "audio"
                          : asset.mimeType.startsWith("video/")
                            ? "video"
                            : "model3d";
                      addNode(type, {
                        src: asset.url,
                        name: asset.name,
                        width: 320,
                        height: 240,
                      });
                    }}
                    title={`Insert ${asset.name}`}
                  >
                    {asset.mimeType.startsWith("image/") ? (
                      <img src={asset.url} alt={asset.name} />
                    ) : asset.mimeType.startsWith("audio/") ? (
                      <Music size={24} />
                    ) : (
                      <Film size={24} />
                    )}
                    <span>{asset.name}</span>
                  </button>
                ))}
              </div>
              <div className="media-generator">
                <h3>Generate an asset</h3>
                <Field label="Media type">
                  <select
                    value={mediaKind}
                    onChange={(e) => {
                      const value = e.target.value as typeof mediaKind;
                      setMediaKind(value);
                      setMediaDuration(value === "audio" ? 30 : 5);
                      setMediaProvider(value === "video" ? "fal" : "openai");
                      setSourceAsset("");
                      setMediaModel("");
                    }}
                  >
                    <option value="image">Image</option>
                    <option value="audio">Audio</option>
                    <option value="video">Video</option>
                  </select>
                </Field>
                <Field label="Provider">
                  <select
                    value={mediaProvider}
                    onChange={(e) => {
                      setMediaProvider(e.target.value);
                      setSourceAsset("");
                      setMediaModel("");
                    }}
                  >
                    {mediaKind !== "video" && (
                      <option value="openai">OpenAI</option>
                    )}
                    <option value="fal">fal.ai</option>
                    {mediaKind === 'image' && <>
                      <option value="gemini">Google Gemini</option><option value="leonardo">LeonardoAI</option><option value="grok">Grok (xAI)</option>
                      {providers.filter(p => isCustomProvider(p.provider) && p.protocol !== 'anthropic').map(p => <option key={p.provider} value={p.provider}>{p.name ?? p.provider}</option>)}
                    </>}
                  </select>
                </Field>
                {mediaSettings()}
                <Field
                  label={
                    mediaKind === "audio" && mediaProvider === "openai"
                      ? "Words to speak"
                      : "Describe the asset"
                  }
                >
                  <textarea
                    value={mediaPrompt}
                    onChange={(e) => setMediaPrompt(e.target.value)}
                  />
                </Field>
                <button
                  className="button full"
                  disabled={!!busy || !mediaPrompt.trim()}
                  onClick={() => void generateMedia()}
                >
                  <Sparkles size={15} /> Generate {mediaKind}
                </button>
                {mediaJob && (
                  <button
                    className="button full"
                    disabled={!!busy}
                    onClick={() => void checkMedia()}
                  >
                    Check generation progress
                  </button>
                )}
                <p className="small-copy">
                  Uses your saved provider key. Provider charges apply.
                </p>
              </div>
            </div>
          )}
        </aside>
        <section className="canvas-region">
          <div className="canvas-toolbar">
            <div className="insert-tools">
              <button
                className="icon-button selected"
                title="Select (V)"
                aria-label="Select tool"
                onClick={() => setSelected(null)}
              >
                <MousePointer2 size={17} />
              </button>
              <span className="toolbar-divider" />
              <button
                className="icon-button"
                title="Add text"
                aria-label="Add text"
                onClick={() => addNode("text")}
              >
                <Type size={18} />
              </button>
              <button
                className="icon-button"
                title="Add rectangle"
                aria-label="Add rectangle"
                onClick={() => addNode("shape")}
              >
                <Square size={17} />
              </button>
              <button
                className="icon-button"
                title="Add circle"
                aria-label="Add circle"
                onClick={() =>
                  addNode("shape", {
                    data: { shape: "ellipse" },
                    style: { fill: "$accent", borderRadius: 100 },
                  })
                }
              >
                <Circle size={17} />
              </button>
              <button
                className="icon-button"
                title="Insert an asset"
                aria-label="Insert an asset"
                onClick={() => {
                  setPanel("assets");
                  setMobilePanel("chat");
                }}
              >
                <ImagePlus size={17} />
              </button>
              <button
                className="icon-button"
                title="Add chart"
                aria-label="Add chart"
                onClick={() =>
                  addNode("chart", {
                    data: { values: [35, 60, 45, 80, 70] },
                    width: 400,
                    height: 240,
                  })
                }
              >
                <Layers3 size={17} />
              </button>
              {doc.kind === "3d" && (
                <button
                  className="icon-button"
                  title="Add 3D object"
                  aria-label="Add 3D object"
                  onClick={() =>
                    addNode("model3d", { data: { geometry: "sphere" } })
                  }
                >
                  <Box size={17} />
                </button>
              )}
              <label className="block-select">
                <select
                  aria-label="Insert a reusable block"
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const nodes = createBlock(e.target.value, 64);
                    change((d) => {
                      d.pages[pageIndex]!.nodes.push(...nodes);
                    });
                  }}
                >
                  <option value="">+ Block</option>
                  {blocks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="canvas-toolbar-end">
              <button
                className="icon-button"
                title="Design checks"
                aria-label="Design checks"
                onClick={() => setShowChecks(true)}
              >
                <ListChecks size={17} />
              </button>
              <button
                className="icon-button"
                title="Document JSON"
                aria-label="View document JSON"
                onClick={() => setShowCode(true)}
              >
                <Code2 size={17} />
              </button>
              <button
                className="icon-button"
                title="Fit canvas"
                aria-label="Fit canvas"
                onClick={() => { setZoom(1); resetPan(); }}
              >
                <Maximize2 size={16} />
              </button>
            </div>
          </div>
          {proposal && (
            <div className="proposal-banner">
              <Sparkles size={17} />
              <span>Previewing an AI proposal</span>
              <button
                className="button small"
                onClick={() => {setProposal(null);setRunProposal(null);}}
              >
                Discard
              </button>
              <button
                className="button primary small"
                onClick={() => void (async()=>{
                  try {
                    const before=docRef.current, baseRevision=projectRef.current.revision, selectedProposal=proposal;
                    const next=runProposal?(await api<{document:DesignDocument}>(`/api/projects/${project.id}/runs/${runProposal}/proposal`)).document:proposal;
                    if(docRef.current!==before||projectRef.current.revision!==baseRevision||proposalRef.current!==selectedProposal)throw new Error("The document or proposal changed. Review it again before applying.");
                    remember();docRef.current=next;proposalRef.current=null;setDoc(next);setProposal(null);setRunProposal(null);setSelected(null);
                    notify("Proposal applied. Save when you are ready.");
                  } catch(e){setError(message(e));}
                })()}
              >
                Apply proposal
              </button>
            </div>
          )}
          {error && (
            <div className="editor-error" role="alert">
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
          {!preview && !proposal && <div className="selection-actions">
            <small role="status">{selection.length ? `${selection.length} selected` : 'Shift + click to select multiple layers'}{selection.length > 1 ? ' · Resize one layer at a time' : ''}</small>
            {selection.length > 0 && <>
              <button className="icon-button" aria-label="Duplicate selection" title="Duplicate (⌘/Ctrl+D)" disabled={!!busy || !selectedRoots(page, selection).length} onClick={duplicateNode}><Copy size={16}/></button>
              <button className="icon-button" aria-label="Delete selection" title="Delete selection" disabled={!!busy || !selectedRoots(page, selection).length} onClick={removeNode}><Trash2 size={16}/></button>
              <button className="icon-button" aria-label="Group selection" title="Group (⌘/Ctrl+G)" disabled={!!busy || selectedRoots(page, selection).length < 2} onClick={groupSelection}><Group size={16}/></button>
              <button className="icon-button" aria-label="Ungroup selection" title="Ungroup (⌘/Ctrl+Shift+G)" disabled={!!busy || !selectedRoots(page, selection).some(item => item.type === 'group')} onClick={ungroupSelection}><Ungroup size={16}/></button>
              {selection.length === 1 && node?.type === 'text' && <button className="icon-button" aria-label="Edit text" title="Edit text (Enter)" disabled={!!busy || isNodeProtected(page, node)} onClick={() => beginText(node.id)}><Pencil size={16}/></button>}
            </>}
            <button className="icon-button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={event => {
              // WebKit pointer clicks do not focus buttons. Capture the real
              // dialog opener before Modal records the element to restore.
              event.currentTarget.focus({ preventScroll: true });
              setShortcutsOpen(true);
            }}><Keyboard size={16}/></button>
          </div>}
          <div
            className="canvas-viewport"
            ref={viewport}
            tabIndex={-1}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setSelected(null);
            }}
          >
            {displayed.kind === "3d" ? (
              <Suspense fallback={<Busy label="Opening 3D viewport…" />}>
                <SceneView
                  page={page}
                  theme={displayed.theme}
                  selected={selected}
                  doc={displayed} pageIndex={pageIndex} time={time} onUpdate={update}
                  onPage={patch => change(d => Object.assign(d.pages[pageIndex], patch))}
                  onSelect={(id) => {
                    setSelected(id);
                    viewport.current?.focus({ preventScroll: true });
                  }}
                />
              </Suspense>
            ) : (
              <div
                className="canvas-paper"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px)`,
                  width: page.width * scale,
                  height: page.height * scale,
                }}
              >
                <div
                  className="canvas-scaled"
                  style={{
                    width: page.width,
                    height: page.height,
                    transform: `scale(${scale})`,
                  }}
                >
                  {usesDom(page) ? <DocumentView doc={displayed} pageIndex={pageIndex} time={time} onBounds={measureDom} onOverlayBounds={measureOverlay} editingId={directText} navigate={id => { const next = displayed.pages.findIndex(p => p.id === id); if (next >= 0) setPageIndex(next); }}/> : <div className="canvas-svg" dangerouslySetInnerHTML={{ __html: renderSvg(directText ? { ...displayed, pages: displayed.pages.map((item, index) => index === pageIndex ? { ...item, nodes: item.nodes.map(target => target.id === directText ? { ...target, text: '' } : target) } : item) } : displayed, pageIndex, time) }}/>}
                  {preview &&
                    page.nodes
                      .filter(
                        (n) =>
                          n.visible !== false &&
                          (n.type === "video" || n.type === "audio") &&
                          n.src,
                      )
                      .map((media) => (
                        <div
                          key={media.id}
                          className="media-preview"
                          style={{
                            position: "absolute",
                            left: media.x,
                            top: media.y,
                            width: media.width,
                            height: media.height,
                          }}
                        >
                          {media.type === "video" ? (
                            <video
                              src={media.src}
                              controls
                              playsInline
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "contain",
                              }}
                            />
                          ) : (
                            <audio
                              src={media.src}
                              controls
                              style={{ width: "100%" }}
                            />
                          )}
                        </div>
                      ))}
                  {!preview &&
                    !proposal &&
                    (usesDom(page) && domOverlayBounds.length ? domOverlayBounds : resolveLayout({ ...page, nodes: page.nodes.map(n => interpolateNode(n, displayed, time)) }).nodes)
                      .filter((n) => n.visible !== false)
                      .map((target) => (
                        <div
                          key={target.id}
                          className={`node-target ${selection.includes(target.id) ? "selected" : ""} ${target.locked ? "locked" : ""}`}
                          style={
                            {
                              left: target.x,
                              top: target.y,
                              width: target.width,
                              height: target.height,
                              transform: `rotate(${target.rotation || 0}deg)`,
                              transformOrigin: `${(target.pivot?.[0] ?? .5) * 100}% ${(target.pivot?.[1] ?? .5) * 100}%`,
                              "--inverse-scale": 1 / scale,
                            } as React.CSSProperties
                          }
                          aria-label={`${target.name}, ${target.type}`}
                          tabIndex={0}
                          role="button"
                          aria-pressed={selection.includes(target.id)}
                          onFocus={event => { if (event.target === event.currentTarget && !directText && !pointerSelecting.current && !selection.includes(target.id)) setSelected(target.id); }}
                          onPointerDown={(e) => pointerDown(e, target)}
                          onPointerMove={pointerMove}
                          onPointerUp={() => {
                            drag.current = null;
                          }}
                          onPointerCancel={() => {
                            drag.current = null;
                          }}
                          onDoubleClick={() => {
                            beginText(target.id);
                          }}
                        >
                          <span className="node-selection-name">
                            {target.name}
                          </span>
                          {selection.length === 1 && selected === target.id && !isNodeProtected(page, target) && !directText && (
                            <>{(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'] as Handle[]).map(handle => <button key={handle} className={`resize-handle handle-${handle}`} aria-label={`Transform ${handle}`} onPointerDown={e => pointerDown(e, target, handle)} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}/>)}</>
                          )}
                        </div>
                      ))}
                  {directText && node && (() => {
                    const bounds = (usesDom(page) ? domOverlayBounds : resolveLayout({ ...page, nodes: page.nodes.map(item => interpolateNode(item, displayed, time)) }).nodes).find(item => item.id === directText) ?? node;
                    let opacity = node.opacity ?? 1, parent = page.nodes.find(item => item.id === node.parentId);
                    while (parent) { opacity *= parent.opacity ?? 1; parent = page.nodes.find(item => item.id === parent!.parentId); }
                    return <InlineTextEditor key={directText} node={node} bounds={bounds} theme={doc.theme} opacity={opacity} finish={finishText} save={() => void saveRef.current()}/>;
                  })()}
                </div>
              </div>
            )}
          </div>
          {doc.timeline && <TimelineEditor doc={doc} time={time} seek={value => { setTime(value); setPlaying(false); }} change={change} />}
          {doc.timeline && (
            <div className="timeline">
              <button
                className="icon-button"
                title={playing ? "Pause timeline" : "Play timeline"}
                aria-label={playing ? "Pause timeline" : "Play timeline"}
                onClick={() => {
                  if (time >= doc.timeline!.duration) setTime(0);
                  setPlaying(!playing);
                }}
              >
                {playing ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <span className="timecode">
                {time.toFixed(1)} / {doc.timeline.duration}s
              </span>
              <div className="timeline-scrubber">
                <input
                  type="range"
                  aria-label="Timeline time"
                  min={0}
                  max={doc.timeline.duration}
                  step={1 / doc.timeline.fps}
                  value={time}
                  onChange={(e) => {
                    setPlaying(false);
                    setTime(Number(e.target.value));
                  }}
                />
                <div className="keyframe-markers">
                  {doc.timeline.tracks
                    .filter((t) => !selected || t.nodeId === selected)
                    .flatMap((t) =>
                      t.keyframes.map((k) => (
                        <button
                          key={`${t.id}-${k.time}`}
                          style={{
                            left: `${(k.time / doc.timeline!.duration) * 100}%`,
                          }}
                          title={`Keyframe at ${k.time}s`}
                          aria-label={`Go to keyframe at ${k.time}s`}
                          onClick={() => setTime(k.time)}
                        >
                          <Diamond size={9} fill="currentColor" />
                        </button>
                      )),
                    )}
                </div>
              </div>
              <button
                className="button small"
                disabled={!selected}
                onClick={keyframe}
              >
                <Diamond size={13} /> Keyframe
              </button>
            </div>
          )}
          <div className="canvas-bottom">
            <div
              className="page-strip"
              onKeyDown={(event) => navigateButtonGroup(event, ".page-thumbnail")}
            >
              {displayed.pages.map((p, index) => (
                <button
                  key={p.id}
                  className={`page-thumbnail ${pageIndex === index ? "selected" : ""}`}
                  aria-pressed={pageIndex === index}
                  onClick={() => {
                    setPageIndex(index);
                    setSelected(null);
                    setDirectText(null);
                  }}
                >
                  <span
                    className="page-mini"
                    dangerouslySetInnerHTML={{
                      __html: renderSvg(displayed, index),
                    }}
                  />
                  <span>
                    {index + 1}
                    <span>{p.name}</span>
                  </span>
                </button>
              ))}
              <button
                className="add-page"
                title="Add page"
                aria-label="Add page"
                onClick={() => {
                  const newPage = {
                    ...clone(doc.pages[0]!),
                    id: uid(),
                    name: `Page ${doc.pages.length + 1}`,
                    nodes: [],
                  };
                  change((d) => {
                    d.pages.push(newPage);
                  });
                  setPageIndex(doc.pages.length);
                  setSelected(null);
                }}
              >
                <Plus size={19} />
              </button>
            </div>
            <div className="zoom-controls"><label title={syncStatus}><input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)}/>Live</label>{doc.kind === 'slides' && <button onClick={() => setPresenting(true)}>Present</button>}<button onClick={() => { setZoom(1 / fitted); resetPan(); }} title="Actual size">100%</button><button onClick={() => { setZoom(1); resetPan(); }}>Fit</button>
              <button
                className="icon-button"
                aria-label="Zoom out"
                onClick={() => setZoom(Math.max(0.25, zoom - 0.25))}
              >
                <Minus size={15} />
              </button>
              <button className="zoom-value" onClick={() => { setZoom(1); resetPan(); }}>
                {Math.round(scale * 100)}%
              </button>
              <button
                className="icon-button"
                aria-label="Zoom in"
                onClick={() => setZoom(Math.min(3, zoom + 0.25))}
              >
                <Plus size={15} />
              </button>
            </div>
          </div>
        </section>
        <Inspector
          doc={doc}
          page={doc.pages[pageIndex] || doc.pages[0]!}
          node={selection.length === 1 ? node : undefined}
          update={update}
          change={change}
          duplicate={duplicateNode}
          remove={removeNode}
          reorder={reorder}
          duplicatePage={duplicatePage}
          removePage={removePage}
        />
      </div>
      {shortcutsOpen && <Modal title="Editor shortcuts" onClose={() => setShortcutsOpen(false)}><div className="modal-body shortcut-list">
        {[
          ['Select multiple', 'Shift + click · layer checkboxes'], ['Select all layers', '⌘/Ctrl + A'], ['Duplicate', '⌘/Ctrl + D'], ['Delete selection', 'Delete / Backspace'],
          ['Group / ungroup', '⌘/Ctrl + G / Shift + G'], ['Nudge / larger nudge', 'Arrows / Shift + arrows'], ['Undo / redo', '⌘/Ctrl + Z / Shift + Z'],
          ['Save', '⌘/Ctrl + S'], ['Edit text / add text', 'Enter / T'], ['Finish / cancel text', '⌘/Ctrl + Enter / Escape'], ['Deselect', 'Escape'], ['Fit canvas', '⌘/Ctrl + 0'], ['Pan canvas', 'Space + drag / middle mouse'],
        ].map(([action, keys]) => <div key={action}><span>{action}</span><kbd>{keys}</kbd></div>)}
        <p>Canvas shortcuts apply while the canvas or layers have focus. Locked layers stay unchanged. Flow-layout children move through their container layout.</p>
      </div></Modal>}
      {presenting && <SlidePlayer doc={doc} close={() => setPresenting(false)} notes/>}
      {exportOpen && (
        <Modal
          title="Ready to leave the canvas?"
          onClose={() => !busy && setExportOpen(false)}
        >
          <div className="modal-body">
            <p className="modal-description">
              Export the current design as a document, interactive prototype, or editable source.
            </p>
            <div className="export-grid">
              {[
                ...(['web', 'wireframe'].includes(doc.kind) ? [{ id: 'react', name: 'React prototype', detail: 'Runnable source + assets' }] : []),
                ...(doc.kind === '3d' ? [{ id: 'glb', name: 'GLB model', detail: 'Scene, materials & animation' }, { id: 'gltf', name: 'glTF scene', detail: 'Portable 3D source' }] : []),
                { id: "png", name: "PNG image", detail: "Current page" },
                { id: "svg", name: "SVG vector", detail: "Current page" },
                {
                  id: "pdf",
                  name: "PDF document",
                  detail: "All pages · cloud rendered",
                },
                {
                  id: "pptx",
                  name: "PowerPoint",
                  detail: "All pages · editable content",
                },
                {
                  id: "html",
                  name: "HTML website",
                  detail: "Standalone document",
                },
                {
                  id: "json",
                  name: "Design JSON",
                  detail: "Fully editable source",
                },
                {
                  id: "google",
                  name: "Google Slides",
                  detail: "Connect your Google account",
                },
                ...(doc.timeline
                  ? [
                      {
                        id: "webm",
                        name: "WebM video",
                        detail: "Timeline · cloud rendered",
                      },
                      {
                        id: "mp4",
                        name: "MP4 video",
                        detail: "Timeline · cloud rendered",
                      },
                    ]
                  : []),
              ].map((format) => (
                <button
                  key={format.id}
                  disabled={!!busy}
                  onClick={() => void exportFile(format.id)}
                >
                  <FileText size={20} />
                  <span>
                    <strong>{format.name}</strong>
                    <small>{format.detail}</small>
                  </span>
                  <ArrowDownToLine size={16} />
                </button>
              ))}
            </div>
            {doc.kind === "3d" && (
              <p className="small-copy">
                Scene exports render the actual 3D objects. Design JSON
                preserves the complete editable scene.
              </p>
            )}
            {busy && (
              <p>
                <Busy label={busy} />
              </p>
            )}
            {error && <p className="inline-error">{error}</p>}
            {failedExport && (
              <div className="browser-fallback">
                <p className="small-copy">
                  Browser export is also available. PowerPoint uses rendered
                  slides; PDF opens a print dialog; video is silent WebM. 3D is
                  supported in PNG and JSON.
                </p>
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() => void exportFile(failedExport, true)}
                >
                  Try browser export
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
      {googleUrl && (
        <Modal
          title="Your presentation is ready"
          onClose={() => setGoogleUrl("")}
        >
          <div className="modal-body">
            <p className="modal-description">
              Your presentation was created in your Google account. Manage
              access using Google Slides sharing settings.
            </p>
            <a
              className="button primary full"
              href={googleUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open in Google Slides <ArrowRight size={16} />
            </a>
          </div>
        </Modal>
      )}
      {shareUrl && (
        <Modal
          title="Your design is out in the world"
          onClose={() => setShareUrl("")}
        >
          <div className="modal-body">
            <p className="modal-description">
              Anyone with this link can view this published snapshot. Later
              edits stay private until you publish again.
            </p>
            <Field label="Public link">
              <input readOnly value={shareUrl} />
            </Field>
            <div className="button-row">
              <button
                className="button primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(shareUrl);
                    notify("Public link copied.");
                  } catch {
                    setError(
                      "Select and copy the link above. Clipboard access is unavailable.",
                    );
                  }
                }}
              >
                <Copy size={16} /> Copy link
              </button>
              <a
                className="button"
                href={shareUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open design <ArrowRight size={16} />
              </a>
            </div>
          </div>
        </Modal>
      )}
      {showChecks && designChecks && (
        <Modal title="Design checks" onClose={() => setShowChecks(false)} wide>
          <div className="modal-body design-checks">
            <p className="modal-description">
              Hints for the current canvas, including unsaved edits. These
              checks do not block export or judge visual quality.
            </p>
            <div className="checks-counts">
              <strong>{designChecks.counts.warnings} warnings</strong>
              <span>{designChecks.counts.information} notes</span>
            </div>
            {!designChecks.counts.total && (
              <p className="checks-empty">
                <Check size={18} />
                No issues found by these checks. Preview the design at its
                intended size before sharing.
              </p>
            )}
            <div className="checks-list">
              {designChecks.issues.slice(0, 200).map((issue, index) => (
                <button
                  key={index}
                  disabled={!issue.pageId}
                  className={`check-issue ${issue.severity}`}
                  onClick={() => {
                    const target = doc.pages.findIndex(
                      (p) => p.id === issue.pageId,
                    );
                    if (target >= 0) {
                      setPageIndex(target);
                      setSelected(issue.nodeId || null);
                      setMobilePanel("canvas");
                      setShowChecks(false);
                      setProposal(null);setRunProposal(null);
                    }
                  }}
                >
                  <span className="check-severity">
                    {issue.severity === "warning" ? "Warning" : "Note"}
                    {issue.pageId &&
                      " · " +
                        (doc.pages.find((p) => p.id === issue.pageId)?.name ||
                          "Page")}
                  </span>
                  <strong>{issue.message}</strong>
                  <span>{issue.suggestion}</span>
                  {issue.pageId && (
                    <small>
                      Show on canvas <ArrowRight size={13} />
                    </small>
                  )}
                </button>
              ))}
            </div>
            {designChecks.truncated && (
              <p className="brief-hint">
                Showing the first 200 findings. Counts include all findings.
              </p>
            )}
            <details className="checks-limits" open>
              <summary>What these checks can tell you</summary>
              <ul>
                {designChecks.limitations.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
            </details>
          </div>
        </Modal>
      )}
      {showCode && (
        <Modal
          title="The design, as data"
          onClose={() => setShowCode(false)}
          wide
        >
          <div className="modal-body">
            <p className="modal-description">
              The same document powers the canvas, your exports, and connected
              agents.
            </p>
            <pre className="json-preview">{JSON.stringify(doc, null, 2)}</pre>
            <button className="button" onClick={() => void exportFile("json")}>
              <Download size={16} /> Download JSON
            </button>
          </div>
        </Modal>
      )}
      {leaving && (
        <Modal
          title="Keep your latest changes?"
          onClose={() => setLeaving(false)}
        >
          <div className="modal-body">
            <p>
              You have unsaved edits. Save them before returning to your
              workspace.
            </p>
            <div className="button-row">
              <button className="button" onClick={onBack}>
                Leave without saving
              </button>
              <button
                className="button primary"
                disabled={!!busy}
                onClick={async () => {
                  await save();
                  setLeaving(false);
                }}
              >
                Save changes
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

async function googleSlides(projectId: string) {
  const config = await api<{ googleClientId: string | null }>("/api/config");
  if (!config.googleClientId)
    throw new Error(
      "Google Slides is not configured on this server. Ask your administrator to set GOOGLE_CLIENT_ID, or export PowerPoint.",
    );
  type GoogleWindow = Window & {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (options: {
            client_id: string;
            scope: string;
            callback: (response: {
              access_token?: string;
              error?: string;
            }) => void;
            error_callback: (error: unknown) => void;
          }) => { requestAccessToken: () => void };
        };
      };
    };
  };
  if (!(window as GoogleWindow).google)
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.onload = () => resolve();
      script.onerror = () =>
        reject(
          new Error(
            "Google sign-in could not load. Check your network or content blocker.",
          ),
        );
      document.head.appendChild(script);
    });
  const token = await new Promise<string>((resolve, reject) => {
    (window as GoogleWindow)
      .google!.accounts.oauth2.initTokenClient({
        client_id: config.googleClientId!,
        scope: "https://www.googleapis.com/auth/presentations",
        callback: (response) =>
          response.access_token
            ? resolve(response.access_token)
            : reject(
                new Error(
                  response.error || "Google authorization was not completed.",
                ),
              ),
        error_callback: () =>
          reject(
            new Error(
              "Google sign-in was closed or blocked. Allow popups and try again.",
            ),
          ),
      })
      .requestAccessToken();
  });
  const result = await post<{ url: string }>(
    `/api/projects/${projectId}/google-slides`,
    { accessToken: token },
  );
  return result.url;
}
