import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  LockKeyhole,
  Trash2,
  UnlockKeyhole,
} from "lucide-react";
import type { DesignDocument, DesignNode, DesignPage } from "../shared/schema";
import { themes } from "../shared/catalog";
import { resolveColor } from "../shared/render";
import { Field } from "./ui";
import { navigateButtonGroup } from "./keyboard-navigation";

type Props = {
  doc: DesignDocument;
  page: DesignPage;
  node?: DesignNode;
  update: (patch: Partial<DesignNode>) => void;
  change: (recipe: (doc: DesignDocument) => void) => void;
  duplicate: () => void;
  remove: () => void;
  reorder: (direction: number) => void;
  duplicatePage: () => void;
  removePage: () => void;
};
export function Inspector({
  doc,
  page,
  node,
  update,
  change,
  duplicate,
  remove,
  reorder,
  duplicatePage,
  removePage,
}: Props) {
  const [tab, setTab] = useState("design");
  function style(key: string, value: string | number) {
    if (node) update({ style: { ...node.style, [key]: value } });
  }
  function data(key: string, value: string | number) {
    if (node) update({ data: { ...node.data, [key]: value } });
  }
  function pageUpdate(patch: Partial<DesignPage>) {
    change((d) => {
      Object.assign(
        d.pages.find((p) => p.id === page.id)!,
        patch,
      );
    });
  }
  return (
    <aside className="inspector">
      <div
        className="panel-tabs"
        onKeyDown={(event) => navigateButtonGroup(event)}
      >
        <button
          className={tab === "design" ? "active" : ""}
          aria-pressed={tab === "design"}
          onClick={() => setTab("design")}
        >
          Design
        </button>
        <button
          className={tab === "theme" ? "active" : ""}
          aria-pressed={tab === "theme"}
          onClick={() => setTab("theme")}
        >
          Theme
        </button>
        <button
          className={tab === "page" ? "active" : ""}
          aria-pressed={tab === "page"}
          onClick={() => setTab("page")}
        >
          Page
        </button>
      </div>
      {tab === "theme" ? (
        <div className="inspector-body">
          <section>
            <h3>Design system</h3>
            <Field label="Preset">
              <select
                value={
                  themes.some((t) => t.id === doc.theme.id) ? doc.theme.id : ""
                }
                onChange={(e) => {
                  const theme = themes.find((t) => t.id === e.target.value);
                  if (theme)
                    change((d) => {
                      d.theme = structuredClone(theme);
                    });
                }}
              >
                <option value="">Custom</option>
                {themes.map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          </section>
          <section>
            <h3>Color palette</h3>
            {Object.entries(doc.theme.colors).map(([key, value]) => (
              <label className="color-field" key={key}>
                <input
                  type="color"
                  value={/^#[\da-f]{6}$/i.test(value) ? value : "#242322"}
                  onChange={(e) =>
                    change((d) => {
                      d.theme.colors[key] = e.target.value;
                    })
                  }
                />
                <span>{key}</span>
                <input
                  aria-label={`${key} color`}
                  value={value}
                  onChange={(e) =>
                    change((d) => {
                      d.theme.colors[key] = e.target.value;
                    })
                  }
                />
              </label>
            ))}
          </section>
          <section>
            <h3>Typography</h3>
            <Field label="Heading font">
              <input
                value={doc.theme.fonts.heading}
                onChange={(e) =>
                  change((d) => {
                    d.theme.fonts.heading = e.target.value;
                  })
                }
              />
            </Field>
            <Field label="Body font">
              <input
                value={doc.theme.fonts.body}
                onChange={(e) =>
                  change((d) => {
                    d.theme.fonts.body = e.target.value;
                  })
                }
              />
            </Field>
          </section>
          <section>
            <NumberField
              label="Corner radius"
              value={doc.theme.radius}
              min={0}
              max={128}
              onChange={(value) =>
                change((d) => {
                  d.theme.radius = value;
                })
              }
            />
            <Field label="Spacing scale" hint="Comma-separated pixel values.">
              <input
                value={doc.theme.spacing.join(", ")}
                onChange={(e) => {
                  const values = e.target.value.split(",").map(Number);
                  if (values.every((n) => Number.isFinite(n) && n >= 0))
                    change((d) => {
                      d.theme.spacing = values;
                    });
                }}
              />
            </Field>
          </section>
        </div>
      ) : tab === "page" ? (
        <div className="inspector-body">
          <section>
            <h3>Canvas</h3>
            <Field label="Page name">
              <input
                value={page.name}
                onChange={(e) => pageUpdate({ name: e.target.value })}
              />
            </Field>
            <div className="property-grid">
              <NumberField
                label="Width"
                min={64}
                max={10000}
                value={page.width}
                onChange={(width) => pageUpdate({ width })}
              />
              <NumberField
                label="Height"
                min={64}
                max={10000}
                value={page.height}
                onChange={(height) => pageUpdate({ height })}
              />
            </div>
            <Field label="Background">
              <input
                value={page.background}
                onChange={(e) => pageUpdate({ background: e.target.value })}
              />
            </Field>
            <div className="preset-sizes">
              <button onClick={() => pageUpdate({ width: 1440, height: 900 })}>
                Desktop
              </button>
              <button onClick={() => pageUpdate({ width: 390, height: 844 })}>
                Mobile
              </button>
              <button onClick={() => pageUpdate({ width: 1280, height: 720 })}>
                16:9
              </button>
              <button onClick={() => pageUpdate({ width: 794, height: 1123 })}>
                A4
              </button>
            </div>
            <div className="button-row">
              <button className="button small" onClick={duplicatePage}>
                <Copy size={14} /> Copy page
              </button>
              <button
                className="button small danger-text"
                disabled={doc.pages.length < 2}
                onClick={removePage}
              >
                <Trash2 size={14} /> Delete page
              </button>
            </div>
          </section>
          {doc.timeline && (
            <section>
              <h3>Motion settings</h3>
              <NumberField
                label="Duration (seconds)"
                value={doc.timeline.duration}
                min={1}
                max={120}
                onChange={(duration) =>
                  change((d) => {
                    d.timeline!.duration = duration;
                    d.timeline!.tracks.forEach((t) => {
                      t.keyframes = t.keyframes.filter(
                        (k) => k.time <= duration,
                      );
                    });
                  })
                }
              />
              <NumberField
                label="Frames per second"
                value={doc.timeline.fps}
                min={1}
                max={60}
                onChange={(fps) =>
                  change((d) => {
                    d.timeline!.fps = fps;
                  })
                }
              />
            </section>
          )}
        </div>
      ) : node ? (
        <div className="inspector-body">
          <section>
            <div className="inspector-title">
              <h3>
                {node.type === "model3d"
                  ? "3D object"
                  : node.type[0].toUpperCase() + node.type.slice(1)}
              </h3>
              <div className="inline-actions">
                <button
                  className="icon-button"
                  title={node.locked ? "Unlock layer" : "Lock layer"}
                  aria-label={node.locked ? "Unlock layer" : "Lock layer"}
                  onClick={() => update({ locked: !node.locked })}
                >
                  {node.locked ? (
                    <LockKeyhole size={15} />
                  ) : (
                    <UnlockKeyhole size={15} />
                  )}
                </button>
                <button
                  className="icon-button"
                  title="Toggle visibility"
                  aria-label="Toggle visibility"
                  onClick={() => update({ visible: node.visible === false })}
                >
                  {node.visible === false ? (
                    <EyeOff size={15} />
                  ) : (
                    <Eye size={15} />
                  )}
                </button>
              </div>
            </div>
            <Field label="Layer name">
              <input
                value={node.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </Field>
          </section>
          <section>
            <h3>Position & size</h3>
            <div className="property-grid">
              <NumberField
                label="X"
                value={node.x}
                onChange={(x) => update({ x })}
              />
              <NumberField
                label="Y"
                value={node.y}
                onChange={(y) => update({ y })}
              />
              <NumberField
                label="W"
                min={1}
                value={node.width}
                onChange={(width) => update({ width })}
              />
              <NumberField
                label="H"
                min={1}
                value={node.height}
                onChange={(height) => update({ height })}
              />
              <NumberField
                label="Rotation"
                value={node.rotation || 0}
                onChange={(rotation) => update({ rotation })}
              />
              <NumberField
                label="Opacity %"
                min={0}
                max={100}
                value={Math.round((node.opacity ?? 1) * 100)}
                onChange={(opacity) => update({ opacity: opacity / 100 })}
              />
            </div>
            <div className="button-row">
              <button
                className="button small"
                onClick={() => reorder(-1)}
                title="Send backward"
              >
                <ArrowDown size={14} /> Back
              </button>
              <button
                className="button small"
                onClick={() => reorder(1)}
                title="Bring forward"
              >
                <ArrowUp size={14} /> Front
              </button>
            </div>
          </section>
          {node.type === "text" && (
            <section>
              <h3>Content</h3>
              <Field label="Text">
                <textarea
                  className="text-content"
                  value={node.text || ""}
                  onChange={(e) => update({ text: e.target.value })}
                />
              </Field>
              <div className="property-grid">
                <NumberField
                  label="Font size"
                  min={1}
                  max={400}
                  value={Number(node.style?.fontSize || 24)}
                  onChange={(value) => style("fontSize", value)}
                />
                <Field label="Weight">
                  <select
                    value={String(node.style?.fontWeight || 400)}
                    onChange={(e) =>
                      style("fontWeight", Number(e.target.value))
                    }
                  >
                    <option value="300">Light</option>
                    <option value="400">Regular</option>
                    <option value="500">Medium</option>
                    <option value="600">Semibold</option>
                    <option value="700">Bold</option>
                  </select>
                </Field>
              </div>
              <Field label="Font family">
                <input
                  value={String(node.style?.fontFamily || "$body")}
                  onChange={(e) => style("fontFamily", e.target.value)}
                />
              </Field>
              <Field label="Alignment">
                <select
                  value={String(node.style?.textAlign || "left")}
                  onChange={(e) => style("textAlign", e.target.value)}
                >
                  <option>left</option>
                  <option>center</option>
                  <option>right</option>
                </select>
              </Field>
            </section>
          )}
          <section>
            <h3>Appearance</h3>
            <Field label="Fill color or theme token">
              <div className="copy-field">
                <input
                  type="color"
                  aria-label="Pick fill color"
                  value={
                    /^#[\da-f]{6}$/i.test(
                      resolveColor(
                        String(node.style?.fill || "$text"),
                        doc.theme,
                      ),
                    )
                      ? resolveColor(
                          String(node.style?.fill || "$text"),
                          doc.theme,
                        )
                      : "#242322"
                  }
                  onChange={(e) => style("fill", e.target.value)}
                />
                <input
                  value={String(node.style?.fill || "$text")}
                  onChange={(e) => style("fill", e.target.value)}
                />
              </div>
            </Field>
            <div className="property-grid">
              <NumberField
                label="Radius"
                min={0}
                value={Number(node.style?.borderRadius || 0)}
                onChange={(value) => style("borderRadius", value)}
              />
              <NumberField
                label="Stroke width"
                min={0}
                value={Number(node.style?.strokeWidth || 0)}
                onChange={(value) => style("strokeWidth", value)}
              />
            </div>
            <Field label="Stroke">
              <input
                value={String(node.style?.stroke || "")}
                placeholder="$border or #hex"
                onChange={(e) => style("stroke", e.target.value)}
              />
            </Field>
          </section>
          {["image", "video", "audio"].includes(node.type) && (
            <section>
              <Field label="Asset URL">
                <input
                  value={node.src || ""}
                  onChange={(e) => update({ src: e.target.value })}
                />
              </Field>
            </section>
          )}
          {node.type === "chart" && (
            <section>
              <Field label="Chart values" hint="Comma-separated numbers">
                <input
                  value={
                    Array.isArray(node.data?.values)
                      ? node.data.values.join(", ")
                      : ""
                  }
                  onChange={(e) => {
                    const values = e.target.value.split(",").map(Number);
                    if (values.every(Number.isFinite))
                      update({ data: { ...node.data, values } });
                  }}
                />
              </Field>
            </section>
          )}
          {node.type === "model3d" && (
            <section>
              <h3>Scene properties</h3>
              <Field label="Geometry">
                <select
                  value={String(node.data?.geometry || "box")}
                  onChange={(e) => data("geometry", e.target.value)}
                >
                  <option>box</option>
                  <option>sphere</option>
                  <option>torus</option>
                  <option>torusKnot</option>
                  <option>cylinder</option>
                  <option>cone</option>
                </select>
              </Field>
              <div className="property-grid">
                <NumberField
                  label="Z"
                  value={Number(node.data?.z || 0)}
                  step={0.1}
                  onChange={(value) => data("z", value)}
                />
                <NumberField
                  label="Depth"
                  value={Number(node.data?.depth || node.width)}
                  min={1}
                  onChange={(value) => data("depth", value)}
                />
                <NumberField
                  label="Rotate X"
                  value={Number(node.data?.rotationX || 0)}
                  onChange={(value) => data("rotationX", value)}
                />
                <NumberField
                  label="Rotate Y"
                  value={Number(node.data?.rotationY || 0)}
                  onChange={(value) => data("rotationY", value)}
                />
                <NumberField
                  label="Metalness"
                  value={Number(node.data?.metalness ?? 0.15)}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(value) => data("metalness", value)}
                />
                <NumberField
                  label="Roughness"
                  value={Number(node.data?.roughness ?? 0.35)}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(value) => data("roughness", value)}
                />
              </div>
            </section>
          )}
          <section>
            <div className="button-row">
              <button className="button small" onClick={duplicate}>
                <Copy size={14} /> Duplicate
              </button>
              <button className="button small danger-text" onClick={remove}>
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </section>
        </div>
      ) : (
        <div className="inspector-empty">
          <div className="selection-mark" />
          <h3>Make it yours</h3>
          <p>
            Select a layer on the canvas to edit its content, position, and
            style.
          </p>
          <small>Tip: double-click text to edit it directly.</small>
        </div>
      )}
    </aside>
  );
}
function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          if (e.target.value === "") return;
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed))
            onChange(Math.max(min ?? -100000, Math.min(max ?? 100000, parsed)));
        }}
      />
    </Field>
  );
}
