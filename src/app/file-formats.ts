import { publicCreativeProjection } from '../shared/public-creative-projection';
import { upgradeDocument } from '../shared/document-upgrade';
import {documentSchema} from '../shared/schema';
import type { DesignDocument, DesignNode } from "../shared/schema";
import { renderHtml, renderSvg } from "../shared/render";
import { createDocument } from "../shared/catalog";
import { download, uid } from "./api";

export async function rasterize(
  svg: string,
  width: number,
  height: number,
): Promise<HTMLCanvasElement> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(
          new Error(
            "This page contains an image the browser cannot export. Import the image as an asset, then try again.",
          ),
        );
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function portableDocument(input: DesignDocument, allMedia = false) {
  const doc = structuredClone(input);
  await Promise.all(
    doc.pages.flatMap((page) =>
      page.nodes
        .filter(
          (node) =>
            (allMedia || node.type === "image" || node.component) && node.src && !node.src.startsWith("data:"),
        )
        .map(async (node) => {
          const response = await fetch(node.src!, {
            credentials: "same-origin",
          });
          if (!response.ok)
            throw new Error(
              `Could not load image “${node.name}”. Re-import it before exporting.`,
            );
          const blob = await response.blob();
          node.src = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }),
    ),
  );
  if (allMedia) for (const asset of doc.assets) {
    const matching = input.pages.flatMap(p => p.nodes).find(n => n.src === asset.url);
    const embedded = matching && doc.pages.flatMap(p => p.nodes).find(n => n.id === matching.id)?.src;
    if (embedded) { asset.url = embedded; continue; }
    if (asset.url.startsWith('data:')) continue;
    const response = await fetch(asset.url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Could not load asset “${asset.name}”.`);
    const blob = await response.blob();
    asset.url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
  }
  return doc;
}
export async function exportDesign(
  input: DesignDocument,
  format: string,
  pageIndex = 0,
) {
  const name = input.name.replace(/[^a-z0-9 _-]/gi, "").trim() || "design";
  if (format === "json") {
    download(
      `${name}.json`,
      JSON.stringify(input, null, 2),
      "application/json",
    );
    return;
  }
  const doc = await portableDocument(publicCreativeProjection(upgradeDocument(input)), ['react', 'glb', 'gltf', 'html'].includes(format)),
    page = doc.pages[pageIndex]!;
  if (format === 'react') {
    const [{ createReactArchive }, response] = await Promise.all([import('../shared/react-export'), fetch('/studio-react-runtime.json')]);
    if (!response.ok) throw new Error('Build the React runtime before exporting source.');
    download(`${name}-react.zip`, new Blob([new Uint8Array(await createReactArchive(doc, await response.json()))]), 'application/zip'); return;
  }
  if (format === 'glb' || format === 'gltf') {
    if(page.nodes.some(n=>n.character))throw new Error('Use the native motion package to preserve 2D characters; GLB/glTF cannot represent them.');
    const { exportScene } = await import('../shared/scene-runtime');
    const output = await exportScene(doc, pageIndex, format === 'glb');
    download(`${name}.${format}`, output instanceof ArrayBuffer ? new Blob([output]) : JSON.stringify(output, null, 2), format === 'glb' ? 'model/gltf-binary' : 'model/gltf+json'); return;
  }
  const { captureExportPage } = await import('./export-page');
  const { usesDom } = await import('./document-view');
  const capture = async (index: number, time = 0) => usesDom(doc.pages[index]) || doc.pages[index].scene || doc.pages[index].nodes.some(n => n.scene)
    ? captureExportPage(doc, index, time) : rasterize(renderSvg(doc, index, time), doc.pages[index].width, doc.pages[index].height);
  if (format === "html") {
    const interactive = doc.kind === 'slides' || doc.timeline || doc.pages.some(p => usesDom(p) || p.scene || p.nodes.some(n => n.type === 'model3d'));
    const response = interactive ? await fetch('/studio-viewer.js') : undefined;
    if (response && !response.ok) throw new Error('Build the viewer before exporting interactive HTML.');
    download(`${name}.html`, renderHtml(doc, response ? { script: await response.text() } : undefined), "text/html");
    return;
  }
  if (format === "svg") {
    download(`${name}.svg`, renderSvg(doc, pageIndex), "image/svg+xml");
    return;
  }
  if (format === "png") {
    const canvas = await capture(pageIndex);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(new Error("The browser could not encode this image.")),
        "image/png",
      ),
    );
    download(`${name}.png`, blob, "image/png");
    return;
  }
  if (format === "pdf") {
    const pages = await Promise.all(
      doc.pages.map(async (p, i) =>
        (await capture(i)).toDataURL(
          "image/png",
        ),
      ),
    );
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;inset:0;width:0;height:0;border:0";
    document.body.appendChild(frame);
    const target = frame.contentDocument!;
    target.open();
    target.write(
      `<!doctype html><html><head><title>${name.replace(/[<>&]/g, "")}</title><style>@page{size:${page.width}px ${page.height}px;margin:0}body{margin:0}img{display:block;width:100%;height:100%;object-fit:contain;break-after:page}</style></head><body>${pages.map((src) => `<img src="${src}"/>`).join("")}</body></html>`,
    );
    target.close();
    await Promise.all(Array.from(target.images).map((img) => img.decode()));
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 60000);
    return;
  }
  if (format === "pptx") {
    const { default: PptxGenJS } = await import("pptxgenjs");
    const pptx = new PptxGenJS();
    pptx.defineLayout({
      name: "STUDIO",
      width: page.width / 96,
      height: page.height / 96,
    });
    pptx.layout = "STUDIO";
    pptx.title = doc.name;
    pptx.author = "Design Studio AI";
    for (let index = 0; index < doc.pages.length; index++) {
      const p = doc.pages[index]!,
        slide = pptx.addSlide();
      // Browser-generated PNG is the only image format passed to the presentation encoder.
      const canvas = await capture(index);
      slide.addImage({
        data: canvas.toDataURL("image/png"),
        x: 0,
        y: 0,
        w: page.width / 96,
        h: page.height / 96,
      });
      slide.addNotes(
        `Created in Design Studio AI. Page: ${p.name}. The slide is a faithful rendered image; edit the source document for changes.`,
      );
    }
    await pptx.writeFile({ fileName: `${name}.pptx` });
    return;
  }
  if (format === "webm") {
    if (!doc.timeline)
      throw new Error("Add a timeline before exporting video.");
    if (typeof MediaRecorder === "undefined")
      throw new Error(
        "Video recording is unavailable in this browser. Use current Chrome or Edge.",
      );
    const mimeType = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ].find((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType)
      throw new Error(
        "This browser cannot encode WebM. Use current Chrome or Edge.",
      );
    const canvas = document.createElement("canvas");
    canvas.width = page.width;
    canvas.height = page.height;
    const context = canvas.getContext("2d")!,
      stream = canvas.captureStream(doc.timeline.fps),
      recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const done = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("Video encoding failed."));
    });
    try {
      const first = await capture(pageIndex, 0);
      context.drawImage(first, 0, 0);
      recorder.start();
      const start = performance.now();
      while ((performance.now() - start) / 1000 < doc.timeline.duration) {
        const time = Math.min(
          doc.timeline.duration,
          (performance.now() - start) / 1000,
        );
        const frame = await capture(pageIndex, time);
        context.clearRect(0, 0, page.width, page.height);
        context.drawImage(frame, 0, 0);
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 / doc.timeline!.fps),
        );
      }
      recorder.stop();
      await done;
      download(`${name}.webm`, new Blob(chunks, { type: mimeType }), mimeType);
    } finally {
      if (recorder.state !== "inactive") recorder.stop();
      stream.getTracks().forEach((track) => track.stop());
    }
    return;
  }
  throw new Error(`Unsupported export format: ${format}`);
}

export async function importDesign(
  file: File,
): Promise<{ document: DesignDocument; notice: string }> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Design imports must be smaller than 10 MB.");
  const text = await file.text(),
    name = file.name.replace(/\.[^.]+$/, "");
  if (/\.json$/i.test(file.name)) {
    const doc = documentSchema.parse(JSON.parse(text));
    return {
      document: doc,
      notice:
        "Design document imported. All supported document data is preserved.",
    };
  }
  const doc = createDocument("web", name),
    page = doc.pages[0]!;
  page.nodes = [];
  const parsed = new DOMParser().parseFromString(
    text,
    /\.svg$/i.test(file.name) ? "image/svg+xml" : "text/html",
  );
  if (parsed.querySelector("parsererror"))
    throw new Error(
      "The file could not be parsed. Check that it is valid SVG or HTML.",
    );
  parsed
    .querySelectorAll(
      "script,style,iframe,object,embed,foreignObject,link,meta",
    )
    .forEach((el) => el.remove());
  const safeSrc = (value: string) =>
    /^(https:\/\/|data:image\/(png|jpeg|webp);base64,|\/api\/assets\/)/i.test(
      value,
    )
      ? value
      : "";
  if (/\.svg$/i.test(file.name)) {
    const root = parsed.documentElement,
      viewBox = root.getAttribute("viewBox")?.split(/[ ,]+/).map(Number);
    page.width = Math.max(
      1,
      Number(root.getAttribute("width")?.replace("px", "")) ||
        viewBox?.[2] ||
        1200,
    );
    page.height = Math.max(
      1,
      Number(root.getAttribute("height")?.replace("px", "")) ||
        viewBox?.[3] ||
        800,
    );
    for (const el of Array.from(root.querySelectorAll("text,rect,image"))) {
      const attr = (key: string, fallback: number) =>
        Number(el.getAttribute(key)) || fallback;
      const type =
        el.tagName === "text"
          ? "text"
          : el.tagName === "image"
            ? "image"
            : "shape";
      const node: DesignNode = {
        id: uid(),
        type,
        name: el.getAttribute("id") || type,
        x: attr("x", 0),
        y: attr("y", 0),
        width: attr("width", type === "text" ? 480 : 160),
        height: attr("height", type === "text" ? 64 : 100),
        style: {
          fill: el.getAttribute("fill") || "#242322",
          fontSize: attr("font-size", 32),
        },
      };
      if (type === "text") {
        node.text = el.textContent || "";
        node.y -= attr("font-size", 32);
      }
      if (type === "image") {
        const src = safeSrc(
          el.getAttribute("href") || el.getAttribute("xlink:href") || "",
        );
        if (!src) continue;
        node.src = src;
      }
      page.nodes.push(node);
    }
    return {
      document: doc,
      notice: `Imported ${page.nodes.length} editable text, rectangle, and image layers. SVG paths, groups, transforms, filters, and CSS are not converted. Compare with the original before saving.`,
    };
  }
  let y = 64;
  for (const el of Array.from(
    parsed.body.querySelectorAll("h1,h2,h3,p,li,img"),
  ).slice(0, 200)) {
    const isImage = el.tagName === "IMG",
      heading = /^H[1-3]$/.test(el.tagName),
      content = el.textContent?.trim();
    if (!isImage && !content) continue;
    if (isImage && !safeSrc(el.getAttribute("src") || "")) continue;
    const height = isImage
      ? 300
      : heading
        ? 84
        : Math.max(48, Math.ceil((content?.length || 0) / 70) * 28);
    page.nodes.push({
      id: uid(),
      type: isImage ? "image" : "text",
      name: isImage
        ? el.getAttribute("alt") || "Imported image"
        : content!.slice(0, 32),
      x: 64,
      y,
      width: page.width - 128,
      height,
      text: isImage ? undefined : content,
      src: isImage ? safeSrc(el.getAttribute("src") || "") : undefined,
      style: {
        fontSize: heading ? 48 : 22,
        fill: "#242322",
        fontWeight: heading ? 700 : 400,
      },
    });
    y += height + 24;
  }
  page.height = Math.max(page.height, y + 64);
  if (!page.nodes.length)
    throw new Error("No supported text or images were found in this document.");
  return {
    document: doc,
    notice:
      "HTML text and images imported as editable layers. CSS layout, scripts, forms, and interactions are not converted.",
  };
}
