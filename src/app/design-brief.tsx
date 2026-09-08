import { useEffect, useRef, useState } from "react";
import { ModelPicker } from './model-picker';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  RefreshCw,
  Settings2,
  Sparkles,
  PencilLine,
} from "lucide-react";
import type { DesignBrief, DesignScope, Interview } from "../shared/brief";
import { scopeSchema } from "../shared/brief";
import { themes } from "../shared/catalog";
import { ApiError, api, message, post, put, type Provider } from "./api";
import { Brand, Busy, Field } from "./ui";
import { ThemeToggle } from "./theme-toggle";
import "./design-brief.css";

type Props = {
  projectId: string;
  projectName: string;
  brief: DesignBrief;
  onBrief: (brief: DesignBrief) => void;
  onBack: () => void;
  onManual: () => void;
  onSettings: () => void;
  onGenerate: (
    brief: DesignBrief,
    provider: string,
    model: string,
  ) => Promise<void>;
};
const emptyScope = (request: string): DesignScope => ({
  objective: request,
  audience: "",
  direction: "",
  deliverables: [],
  constraints: [],
  acceptanceCriteria: [],
});
const answerPresent = (value: string | string[] | undefined) =>
  Array.isArray(value)
    ? value.length > 0
    : typeof value === "string" && Boolean(value.trim());
const getAnswer = (answers: DesignBrief["answers"], id: string) =>
  Object.hasOwn(answers, id) ? answers[id] : undefined;

export function DesignBriefWorkspace({
  projectId,
  projectName,
  brief,
  onBrief,
  onBack,
  onManual,
  onSettings,
  onGenerate,
}: Props) {
  const [request, setRequest] = useState(brief.request),
    [answers, setAnswers] = useState(brief.answers),
    [scope, setScope] = useState<DesignScope | null>(brief.scope);
  const [providers, setProviders] = useState<Provider[]>([]),
    [provider, setProvider] = useState(""),
    [model, setModel] = useState("");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [savedMessage, setSavedMessage] = useState("");
  const running = useRef(false),
    server = useRef(brief);
  const dirty =
    request !== brief.request ||
    JSON.stringify(answers) !== JSON.stringify(brief.answers) ||
    JSON.stringify(scope) !== JSON.stringify(brief.scope);
  const ready = brief.questions.every(
    (q) => !q.required || answerPresent(getAnswer(answers, q.id)),
  );
  const approved = brief.status === "approved" && !dirty;
  const connected = providers.filter(
    (p) => p.configured && p.provider !== "fal",
  );
  useEffect(() => {
    if (server.current.revision === brief.revision) return;
    const previous = server.current;
    const localChanges =
      request !== previous.request ||
      JSON.stringify(answers) !== JSON.stringify(previous.answers) ||
      JSON.stringify(scope) !== JSON.stringify(previous.scope);
    if (localChanges) {
      setError(
        "An agent updated this brief while you were editing. Reload the latest version to continue.",
      );
      setConflict(true);
      return;
    }
    server.current = brief;
    setRequest(brief.request);
    setAnswers(brief.answers);
    setScope(brief.scope);
  }, [brief]);
  useEffect(() => {
    const load = () =>
      api<{ providers: Provider[] }>("/api/providers")
        .then(({ providers: next }) => {
          setProviders(next);
          setProvider((current) =>
            next.some((p) => p.configured && p.provider === current)
              ? current
              : next.find((p) => p.configured && p.provider !== "fal")
                  ?.provider || "",
          );
        })
        .catch((e) => setError(message(e)));
    void load();
    window.addEventListener("focus", load);
    const onConnections = () => void load();
    window.addEventListener("studio-providers-updated", onConnections);
    return () => {
      window.removeEventListener("focus", load);
      window.removeEventListener("studio-providers-updated", onConnections);
    };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function accept(next: DesignBrief) {
    server.current = next;
    setRequest(next.request);
    setAnswers(next.answers);
    setScope(next.scope);
    onBrief(next);
  }
  async function perform(label: string, action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(label);
    setError("");
    setConflict(false);
    setSavedMessage("");
    try {
      await action();
    } catch (e) {
      setError(message(e));
      setConflict(e instanceof ApiError && e.status === 409);
    } finally {
      running.current = false;
      setBusy("");
    }
  }
  async function saveDraft() {
    if (!dirty) return server.current;
    if (!request.trim())
      throw new Error("Describe what you want to make before saving.");
    if (scope) {
      const result = scopeSchema.safeParse(scope);
      if (!result.success)
        throw new Error(
          "Complete the scope: objective, audience, visual direction, at least one deliverable, and one acceptance criterion. Keep list entries under 500 characters.",
        );
    }
    const { brief: next } = await put<{ brief: DesignBrief }>(
      `/api/projects/${projectId}/brief`,
      {
        expectedRevision: server.current.revision,
        request,
        answers,
        ...(scope
          ? {
              scope,
              ...(!server.current.scope && !server.current.questions.length
                ? {
                    interview: {
                      message:
                        "This scope was written manually. Review it before approving the design.",
                      questions: [],
                      scope,
                    } satisfies Interview,
                  }
                : {}),
            }
          : {}),
      },
    );
    accept(next);
    return next;
  }
  async function interview() {
    if (!provider)
      throw new Error(
        "Connect an AI provider in Settings, or write the scope manually below.",
      );
    const current = await saveDraft();
    const { brief: next } = await post<{ brief: DesignBrief }>(
      `/api/projects/${projectId}/brief/interview`,
      {
        expectedRevision: current.revision,
        provider,
        ...(model.trim() ? { model: model.trim() } : {}),
      },
    );
    accept(next);
  }
  const updateScope = (key: keyof DesignScope, value: string) =>
    setScope((current) => ({
      ...(current || emptyScope(request)),
      [key]: ["deliverables", "constraints", "acceptanceCriteria"].includes(key)
        ? value.split("\n")
        : value,
    }));
  const normalScope = () =>
    scope && {
      ...scope,
      deliverables: scope.deliverables.map((s) => s.trim()).filter(Boolean),
      constraints: scope.constraints.map((s) => s.trim()).filter(Boolean),
      acceptanceCriteria: scope.acceptanceCriteria
        .map((s) => s.trim())
        .filter(Boolean),
    };
  return (
    <div className="brief-workspace">
      <header className="brief-header">
        <div>
          <button
            className="icon-button"
            aria-label="Back to workspace"
            disabled={!!busy}
            onClick={() =>
              void perform("Saving", async () => {
                await saveDraft();
                onBack();
              })
            }
          >
            <ArrowLeft size={19} />
          </button>
          <Brand compact />
          <strong>{projectName}</strong>
        </div>
        <div>
          <ThemeToggle />
          <button
            className="button small"
            aria-label="Open editor"
            disabled={!!busy}
            onClick={() =>
              void perform("Saving", async () => {
                await saveDraft();
                onManual();
              })
            }
          >
            <PencilLine size={15} />
            <span>Open editor</span>
          </button>
        </div>
      </header>
      <div className="brief-layout">
        <aside className="brief-conversation">
          <div className="brief-conversation-content">
            <div className="brief-conversation-title">
              <Sparkles size={17} />
              <h1>Let's shape the idea.</h1>
            </div>
            <p className="brief-intro">
              A little direction now makes the design feel like you.
            </p>
            <div className="chat-message user">
              <p>{brief.request}</p>
            </div>
            <div className="chat-message assistant">
              <span className="chat-author">
                <Sparkles size={13} /> Studio
              </span>
              <p>
                {brief.message ||
                  "Your idea is saved. Ask your AI provider to explore the brief, or write your own scope to get started."}
              </p>
            </div>
            {Object.entries(brief.answers).filter(([, value]) =>
              answerPresent(value),
            ).length > 0 && (
              <details className="brief-answer-recap">
                <summary>
                  Saved answers <ChevronDown size={14} />
                </summary>
                {brief.questions
                  .filter((q) => answerPresent(getAnswer(brief.answers, q.id)))
                  .map((q) => (
                    <div key={q.id}>
                      <strong>{q.title}</strong>
                      <p>
                        {Array.isArray(getAnswer(brief.answers, q.id))
                          ? (getAnswer(brief.answers, q.id) as string[]).join(
                              ", ",
                            )
                          : getAnswer(brief.answers, q.id)}
                      </p>
                    </div>
                  ))}
              </details>
            )}
            <div className="brief-state">
              <Check size={14} />
              {dirty
                ? "You have unsaved brief changes"
                : `Brief saved · revision ${brief.revision}`}
            </div>
          </div>
          <div className="brief-provider">
            <Field label="Interview provider">
              <select
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setModel("");
                }}
                disabled={!!busy}
              >
                <option value="">
                  {connected.length
                    ? "Choose a provider"
                    : "No provider connected"}
                </option>
                {connected.map((p) => (
                  <option key={p.provider} value={p.provider}>
                    {p.provider}
                  </option>
                ))}
              </select>
            </Field>
            <details className="model-override">
              <summary>Model options</summary>
              <ModelPicker
                provider={provider}
                label="Interview model"
                disabled={!!busy}
                placeholder={
                  providers.find((p) => p.provider === provider)?.model ||
                  "Use provider default"
                }
                value={model}
                onChange={setModel}
              />
            </details>
            <button className="text-button" onClick={onSettings}>
              <Settings2 size={14} />
              {connected.length
                ? "Manage AI connections"
                : "Connect your AI provider"}
              <ArrowRight size={14} />
            </button>
            <p>
              Uses your provider key. You can also prepare this brief with your
              own agent.
            </p>
          </div>
        </aside>
        <main className="brief-main">
          <div className="brief-main-inner">
            <div className="brief-progress" aria-label="Design progress">
              <span className={!scope ? "current" : "complete"}>
                Explore the brief
              </span>
              <ArrowRight size={14} />
              <span
                className={
                  scope && !approved ? "current" : approved ? "complete" : ""
                }
              >
                Approve the scope
              </span>
              <ArrowRight size={14} />
              <span>Build the design</span>
            </div>
            <div className="brief-section-heading">
              <div>
                <h2>
                  {approved
                    ? "Ready to bring it to life."
                    : scope
                      ? "Here's the plan. Make it yours."
                      : brief.questions.length
                        ? "A few choices. A clearer direction."
                        : "What should we make together?"}
                </h2>
                <p>
                  {approved
                    ? "Your scope is approved. Generate the first design when you're ready."
                    : scope
                      ? "Review the details below. Nothing gets built until you approve."
                      : "Your answers are saved with the project, so you can always pick up here."}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Reload latest brief"
                title="Reload saved brief; unsaved answers will be replaced"
                disabled={!!busy}
                onClick={() =>
                  void perform("Loading", async () => {
                    if (
                      dirty &&
                      !window.confirm(
                        "Replace your unsaved brief changes with the latest saved version?",
                      )
                    )
                      return;
                    accept(
                      (
                        await api<{ brief: DesignBrief }>(
                          `/api/projects/${projectId}/brief`,
                        )
                      ).brief,
                    );
                  })
                }
              >
                <RefreshCw size={17} />
              </button>
            </div>
            {error && (
              <div className="inline-error" role="alert">
                <p>{error}</p>
                {conflict && (
                  <p>
                    The saved brief changed in another session. Use Reload
                    latest brief to review it before retrying. Your local
                    answers remain here until you reload.
                  </p>
                )}
                {!provider && (
                  <button className="text-button" onClick={onSettings}>
                    Connect provider in Settings <ArrowRight size={14} />
                  </button>
                )}
              </div>
            )}
            {savedMessage && (
              <p className="brief-success" role="status">
                <Check size={16} />
                {savedMessage}
              </p>
            )}
            <details className="brief-request-editor">
              <summary>
                Edit original request <ChevronDown size={14} />
              </summary>
              <Field label="Original request">
                <textarea
                  value={request}
                  disabled={!!busy}
                  maxLength={10000}
                  onChange={(e) => setRequest(e.target.value)}
                />
              </Field>
            </details>
            <fieldset className="brief-fields" disabled={!!busy}>
              {brief.questions.map((question, index) => (
                <section className="brief-question" key={question.id}>
                  <div className="brief-question-title">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <h3 id={`question-${question.id}`}>
                        {question.title}
                        {!question.required && <small>Optional</small>}
                      </h3>
                      {question.description && <p>{question.description}</p>}
                    </div>
                  </div>
                  {question.type === "text" ? (
                    <textarea
                      aria-labelledby={`question-${question.id}`}
                      maxLength={4000}
                      value={
                        typeof getAnswer(answers, question.id) === "string"
                          ? (getAnswer(answers, question.id) as string)
                          : ""
                      }
                      placeholder="Tell us a little more…"
                      onChange={(e) =>
                        setAnswers({
                          ...answers,
                          [question.id]: e.target.value,
                        })
                      }
                    />
                  ) : (
                    <>
                      <div
                        className="brief-choices"
                        role="group"
                        aria-labelledby={`question-${question.id}`}
                      >
                        {question.options.map((option) => {
                          const value = getAnswer(answers, question.id),
                            selected = Array.isArray(value)
                              ? value.includes(option)
                              : value === option;
                          return (
                            <button
                              type="button"
                              key={option}
                              aria-pressed={selected}
                              className={selected ? "selected" : ""}
                              onClick={() =>
                                setAnswers({
                                  ...answers,
                                  [question.id]:
                                    question.type === "single"
                                      ? selected
                                        ? ""
                                        : option
                                      : selected
                                        ? (Array.isArray(value)
                                            ? value
                                            : [value as string]
                                          ).filter((v) => v !== option)
                                        : [
                                            ...(Array.isArray(value)
                                              ? value
                                              : []),
                                            option,
                                          ],
                                })
                              }
                            >
                              <span>{option}</span>
                              {selected && <Check size={16} />}
                            </button>
                          );
                        })}
                      </div>
                      <input
                        aria-label={`Custom answer: ${question.title}`}
                        maxLength={question.type === "multiple" ? 160 : 4000}
                        placeholder="Or describe it in your own words…"
                        value={
                          typeof getAnswer(answers, question.id) === "string" &&
                          !question.options.includes(
                            getAnswer(answers, question.id) as string,
                          )
                            ? (getAnswer(answers, question.id) as string)
                            : ""
                        }
                        onChange={(e) =>
                          setAnswers({
                            ...answers,
                            [question.id]: e.target.value,
                          })
                        }
                      />
                      {question.type === "multiple" && (
                        <small className="brief-hint">
                          Choose several options, or use a custom answer.
                        </small>
                      )}
                    </>
                  )}
                </section>
              ))}
              {!scope && !brief.questions.length && (
                <div className="brief-start">
                  <div className="brief-start-mark">
                    <Sparkles size={28} />
                  </div>
                  <h3>Start with a conversation.</h3>
                  <p>
                    Ask AI for questions tailored to your idea, from the
                    audience and main action to the tone, content, and visual
                    direction.
                  </p>
                  <button
                    className="button primary"
                    disabled={!provider || !!busy}
                    onClick={() =>
                      void perform("Preparing questions", interview)
                    }
                  >
                    <Sparkles size={16} />
                    Ask AI to start the interview
                    <ArrowRight size={16} />
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setScope(emptyScope(request))}
                  >
                    <PencilLine size={15} />
                    Write scope manually
                  </button>
                  <a href="/docs#agents" target="_blank" rel="noreferrer">
                    Use your own agent
                  </a>
                </div>
              )}
              {scope && (
                <section className="brief-scope" aria-label="Design scope">
                  <Field label="Objective">
                    <textarea
                      value={scope.objective}
                      maxLength={2000}
                      onChange={(e) => updateScope("objective", e.target.value)}
                    />
                  </Field>
                  <Field label="Audience">
                    <input
                      value={scope.audience}
                      maxLength={1000}
                      onChange={(e) => updateScope("audience", e.target.value)}
                    />
                  </Field>
                  <Field label="Visual direction">
                    <textarea
                      value={scope.direction}
                      maxLength={2000}
                      placeholder="Palette, typography, tone, and composition"
                      onChange={(e) => updateScope("direction", e.target.value)}
                    />
                  </Field>
                  <details className="brief-palette-options">
                    <summary>
                      Explore palette & type directions{" "}
                      <ChevronDown size={14} />
                    </summary>
                    <p>These are starting points for your written direction.</p>
                    <div>
                      {themes.map((theme) => (
                        <button
                          key={theme.id}
                          type="button"
                          onClick={() =>
                            updateScope(
                              "direction",
                              `${scope.direction}${scope.direction ? "\n" : ""}${theme.name}: ${Object.entries(
                                theme.colors,
                              )
                                .map(([key, value]) => `${key} ${value}`)
                                .join(
                                  ", ",
                                )}; headings ${theme.fonts.heading}, body ${theme.fonts.body}.`.slice(
                                0,
                                2000,
                              ),
                            )
                          }
                        >
                          <span className="brief-palette-swatches">
                            {Object.values(theme.colors)
                              .slice(0, 5)
                              .map((color, i) => (
                                <i key={i} style={{ background: color }} />
                              ))}
                          </span>
                          <strong style={{ fontFamily: theme.fonts.heading }}>
                            {theme.name}
                          </strong>
                          <small>
                            {theme.fonts.heading} / {theme.fonts.body}
                          </small>
                        </button>
                      ))}
                    </div>
                  </details>
                  <Field label="Deliverables" hint="One item per line.">
                    <textarea
                      value={scope.deliverables.join("\n")}
                      onChange={(e) =>
                        updateScope("deliverables", e.target.value)
                      }
                      onBlur={() => {
                        const next = normalScope();
                        if (next) setScope(next);
                      }}
                      placeholder="Landing page with hero, features, and contact section"
                    />
                  </Field>
                  <Field
                    label="Constraints"
                    hint="Optional. One item per line."
                  >
                    <textarea
                      value={scope.constraints.join("\n")}
                      onChange={(e) =>
                        updateScope("constraints", e.target.value)
                      }
                      onBlur={() => {
                        const next = normalScope();
                        if (next) setScope(next);
                      }}
                      placeholder="Brand requirements, required content, things to avoid"
                    />
                  </Field>
                  <Field
                    label="Acceptance criteria"
                    hint="How will you know it's ready? One item per line."
                  >
                    <textarea
                      value={scope.acceptanceCriteria.join("\n")}
                      onChange={(e) =>
                        updateScope("acceptanceCriteria", e.target.value)
                      }
                      onBlur={() => {
                        const next = normalScope();
                        if (next) setScope(next);
                      }}
                      placeholder="The primary action is clearly visible"
                    />
                  </Field>
                </section>
              )}
            </fieldset>
            {(brief.questions.length > 0 || scope) && (
              <div className="brief-actions">
                <div>
                  <button
                    className="button"
                    disabled={!!busy || !dirty || conflict}
                    onClick={() =>
                      void perform("Saving answers", async () => {
                        await saveDraft();
                        setSavedMessage("Your brief is saved.");
                      })
                    }
                  >
                    Save {scope ? "scope" : "answers"}
                  </button>
                  {!scope && (
                    <button
                      className="text-button"
                      disabled={!!busy}
                      onClick={() => setScope(emptyScope(request))}
                    >
                      Write scope manually
                    </button>
                  )}
                </div>
                {approved ? (
                  <button
                    className="button primary"
                    disabled={!!busy || !provider || conflict}
                    onClick={() =>
                      void perform("Building your design", async () =>
                        onGenerate(server.current, provider, model),
                      )
                    }
                  >
                    <Sparkles size={17} />
                    Generate design
                    <ArrowRight size={16} />
                  </button>
                ) : scope ? (
                  <button
                    className="button primary"
                    disabled={!!busy || !ready || conflict}
                    onClick={() =>
                      void perform("Approving scope", async () => {
                        const saved = await saveDraft();
                        const { brief: next } = await post<{
                          brief: DesignBrief;
                        }>(`/api/projects/${projectId}/brief/approve`, {
                          expectedRevision: saved.revision,
                        });
                        accept(next);
                        setSavedMessage(
                          "Scope approved. You can now generate your design.",
                        );
                      })
                    }
                  >
                    <Check size={17} />
                    Approve scope
                  </button>
                ) : (
                  <button
                    className="button primary"
                    disabled={!!busy || !provider || !ready || conflict}
                    onClick={() =>
                      void perform("Continuing the interview", interview)
                    }
                  >
                    <Sparkles size={17} />
                    Continue interview
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
            )}
            {scope && !approved && provider && (
              <button
                className="text-button brief-refine"
                disabled={!!busy}
                onClick={() => void perform("Refining the scope", interview)}
              >
                Ask AI to refine this scope <ArrowRight size={14} />
              </button>
            )}
            {!ready && (
              <p className="brief-hint">
                Answer the required questions before continuing or approving.
              </p>
            )}
            {approved && !provider && (
              <p className="brief-hint">
                Connect a provider to generate here, or let your own agent build
                from the approved scope.
              </p>
            )}
            {busy && (
              <div className="brief-working" role="status">
                <Busy label={`${busy}…`} />
                <p>Your saved brief stays available if the request fails.</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
