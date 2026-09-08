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
      setProposal(generated);
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
    setProposal(null);
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
    [selected, setSelected] = useState<string | null>(null);
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
  const [showChecks, setShowChecks] = useState(false);
  const designChecks = showChecks ? inspectDesign(doc) : null;
  const [live, setLive] = useState(true);
  const [syncStatus, setSyncStatus] = useState("Live");
  const syncing = useRef(false);
  const syncBlocked = useRef(false);
  syncBlocked.current = !!busy || !!proposal;
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
      id: string;
      x: number;
      y: number;
      original: DesignNode;
      parentRotation: number;
      resize: Handle;
    } | null>(null);
  const dirty = JSON.stringify(doc) !== saved,
    displayed = proposal || doc,
    pageIndex = Math.max(0, Math.min(requestedPageIndex, displayed.pages.length - 1)),
    page = displayed.pages[Math.min(pageIndex, displayed.pages.length - 1)]!,
    baseNode = doc.pages[pageIndex]?.nodes.find((n) => n.id === selected),
    node = baseNode ? interpolateNode(baseNode, doc, time) : undefined,
    scale = fitted * zoom;
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
      remember(); docRef.current = validated; setDoc(validated); setProposal(null);
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
  function update(patch: Partial<DesignNode>) {
    if (!selected) return;
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
    setDoc(last);
    setHistoryCount(history.current.length);
    setRedoCount(future.current.length);
    setProposal(null);
  }
  function redo() {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(clone(docRef.current));
    setDoc(next);
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
    api<{ providers: Provider[] }>("/api/providers")
      .then((result) => {
        setProviders(result.providers);
        const textProvider = result.providers.find((p) => p.provider !== "fal");
        if (textProvider) setProvider(textProvider.provider);
      })
      .catch((e) => setError(message(e)));
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
      const width = viewport.current!.clientWidth - 64,
        height = viewport.current!.clientHeight - 80;
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
    if (!selected) return;
    change((d) => {
      const targetPage = d.pages[pageIndex]!;
      const ids = new Set([selected]);
      let previous = 0;
      while (previous !== ids.size) {
        previous = ids.size;
        targetPage.nodes.forEach((n) => {
          if (n.parentId && ids.has(n.parentId)) ids.add(n.id);
        });
      }
      targetPage.nodes = targetPage.nodes.filter((n) => !ids.has(n.id));
      if (d.timeline)
        d.timeline.tracks = d.timeline.tracks.filter((t) => !ids.has(t.nodeId));
    });
    setSelected(null);
  }
  function duplicateNode() {
    if (!node) return;
    const duplicateId = uid();
    change((d) => {
      Object.assign(d, mutateDocument(d, [{ op: 'duplicate-node', nodeId: node.id, duplicateId }]));
    });
    setSelected(duplicateId);
  }
  function reorder(direction: number) {
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "d"
      ) {
        event.preventDefault();
        duplicateNode();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeNode();
      } else if (event.key === "Escape") {
        setSelected(null);
        setPreview(false);
      } else if (
        node &&
        !node.locked &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        update({
          x:
            node.x +
            (event.key === "ArrowRight"
              ? step
              : event.key === "ArrowLeft"
                ? -step
                : 0),
          y:
            node.y +
            (event.key === "ArrowDown"
              ? step
              : event.key === "ArrowUp"
                ? -step
                : 0),
        });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [node, selected, pageIndex]);
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
    return newNode;
  }
  function pointerDown(
    event: PointerEvent,
    target: DesignNode,
    resize: Handle = 'move',
  ) {
    event.stopPropagation();
    if (target.locked || preview || proposal) {
      setSelected(target.id);
      return;
    }
    event.preventDefault();
    setSelected(target.id);
    remember();
    let parentRotation = 0, parentId = target.parentId;
    while (parentId) {
      const parent = docRef.current.pages[pageIndex].nodes.find(n => n.id === parentId);
      if (!parent) break;
      parentRotation += interpolateNode(parent, docRef.current, time).rotation ?? 0;
      parentId = parent.parentId;
    }
    drag.current = {
      id: target.id,
      x: event.clientX,
      y: event.clientY,
      original: clone(docRef.current.pages[pageIndex].nodes.find(n => n.id === target.id) ?? target),
      parentRotation,
      resize,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent) {
    const active = drag.current;
    if (!active) return;
    const dx = (event.clientX - active.x) / scale,
      dy = (event.clientY - active.y) / scale;
    setDoc((current) => {
      const next = clone(current),
        target = next.pages[pageIndex]!.nodes.find((n) => n.id === active.id)!;
      const angle = active.parentRotation * Math.PI / 180;
      const patch = transformNode(active.original, dx * Math.cos(angle) + dy * Math.sin(angle), -dx * Math.sin(angle) + dy * Math.cos(angle), active.resize, event.shiftKey);
      if (active.resize === 'move') {
        const parent = next.pages[pageIndex].nodes.find(n => n.id === target.parentId);
        const layout = parent?.layout ?? (!target.parentId ? next.pages[pageIndex].layout : undefined);
        if (layout && layout.mode !== 'absolute' && target.position !== 'absolute') return current;
        const ids = subtree(next.pages[pageIndex], target.id);
        if (!target.layout) next.pages[pageIndex].nodes.filter(n => ids.has(n.id) && n.id !== target.id).forEach(n => { n.x += (patch.x ?? target.x) - target.x; n.y += (patch.y ?? target.y) - target.y; });
      }
      setNodePatch(next, target, patch);
      return next;
    });
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
      setProposal(result.document);
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
          setProposal(null);
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
    const canSource = mediaKind !== "audio" || mediaProvider === "fal";
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
      <div className="mobile-editor-nav">
        <button
          className={mobilePanel === "chat" ? "active" : ""}
          onClick={() => setMobilePanel("chat")}
        >
          <MessageSquare size={16} /> Chat & layers
        </button>
        <button
          className={mobilePanel === "canvas" ? "active" : ""}
          onClick={() => setMobilePanel("canvas")}
        >
          <Monitor size={16} /> Canvas
        </button>
        <button
          className={mobilePanel === "inspector" ? "active" : ""}
          onClick={() => setMobilePanel("inspector")}
        >
          <SlidersHorizontal size={16} /> Design
        </button>
      </div>
      <div className="editor-workspace">
        <aside className="left-panel">
          <div className="panel-tabs">
            <button
              className={panel === "chat" ? "active" : ""}
              onClick={() => setPanel("chat")}
            >
              Chat
            </button>
            <button
              className={panel === "layers" ? "active" : ""}
              onClick={() => setPanel("layers")}
            >
              Layers
            </button>
            <button
              className={panel === "assets" ? "active" : ""}
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
                    onChange={(e) => setProvider(e.target.value)}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Gemini</option>
                    <option value="openrouter">OpenRouter</option>
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
              <button className="provider-settings" onClick={onSettings}>
                <Settings2 size={14} />
                {providers.length
                  ? "Manage AI connections"
                  : "Connect your AI provider"}
                <ArrowRight size={14} />
              </button>
            </>
          ) : panel === "layers" ? (
            <LayerTree doc={doc} page={page} measured={usesDom(page) ? domBounds : undefined} selected={selected} select={id => { setSelected(id); setDirectText(null); }} change={change} />
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
                onClick={() => setProposal(null)}
              >
                Discard
              </button>
              <button
                className="button primary small"
                onClick={() => {
                  remember();
                  setDoc(proposal);
                  setProposal(null);
                  setSelected(null);
                  notify("Proposal applied. Save when you are ready.");
                }}
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
          <div
            className="canvas-viewport"
            ref={viewport}
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
                  onSelect={setSelected}
                  doc={displayed} pageIndex={pageIndex} time={time} onUpdate={update}
                  onPage={patch => change(d => Object.assign(d.pages[pageIndex], patch))}
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
                  {usesDom(page) ? <DocumentView doc={displayed} pageIndex={pageIndex} time={time} onBounds={measureDom} onOverlayBounds={measureOverlay} navigate={id => { const next = displayed.pages.findIndex(p => p.id === id); if (next >= 0) setPageIndex(next); }}/> : <div className="canvas-svg" dangerouslySetInnerHTML={{ __html: renderSvg(displayed, pageIndex, time) }}/>}
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
                          className={`node-target ${selected === target.id ? "selected" : ""} ${target.locked ? "locked" : ""}`}
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
                          onFocus={() => setSelected(target.id)}
                          onPointerDown={(e) => pointerDown(e, target)}
                          onPointerMove={pointerMove}
                          onPointerUp={() => {
                            drag.current = null;
                          }}
                          onPointerCancel={() => {
                            drag.current = null;
                          }}
                          onDoubleClick={() => {
                            if (target.type === "text" && !target.locked)
                              setDirectText(target.id);
                          }}
                        >
                          <span className="node-selection-name">
                            {target.name}
                          </span>
                          {selected === target.id && !target.locked && (
                            <>{(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'] as Handle[]).map(handle => <button key={handle} className={`resize-handle handle-${handle}`} aria-label={`Transform ${handle}`} onPointerDown={e => pointerDown(e, target, handle)} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}/>)}</>
                          )}
                        </div>
                      ))}
                  {directText && node && (
                    <textarea
                      className="direct-text-editor"
                      autoFocus
                      aria-label="Edit selected text"
                      style={{
                        left: node.x,
                        top: node.y,
                        width: Math.max(node.width, 200),
                        height: Math.max(node.height, 80),
                        fontSize: Number(node.style?.fontSize || 24),
                      }}
                      value={node.text || ""}
                      onChange={(e) => update({ text: e.target.value })}
                      onBlur={() => setDirectText(null)}
                    />
                  )}
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
            <div className="page-strip">
              {displayed.pages.map((p, index) => (
                <button
                  key={p.id}
                  className={`page-thumbnail ${pageIndex === index ? "selected" : ""}`}
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
          node={node}
          update={update}
          change={change}
          duplicate={duplicateNode}
          remove={removeNode}
          reorder={reorder}
          duplicatePage={duplicatePage}
          removePage={removePage}
        />
      </div>
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
                      setProposal(null);
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
