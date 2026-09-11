import { z } from 'zod';
import { fail } from "./security";
import type { DesignDocument } from "../src/shared/schema";
import { resolveColor, resolveFont } from '../src/shared/render';
function color(value: unknown) {
  const match =
    typeof value === "string" ? value.match(/^#([a-f\d]{6})$/i) : null;
  if (!match) return undefined;
  const n = parseInt(match[1], 16);
  return {
    red: ((n >> 16) & 255) / 255,
    green: ((n >> 8) & 255) / 255,
    blue: (n & 255) / 255,
  };
}

/** Validate representability before creating any remote presentation. */
export function googleSlidesRequests(doc:DesignDocument){
  for (const page of doc.pages)
    for (const node of page.nodes) {
      if (node.visible === false) continue;
      if (node.type === "image" && node.src && !node.src.startsWith("https://"))
        fail(
          400,
          "private_google_image",
          "Google Slides needs publicly reachable HTTPS image URLs. Choose PDF or PPTX to keep private images private.",
        );
      if (["chart", "model3d", "video", "audio", "icon"].includes(node.type))
        fail(
          400,
          "unsupported_google_node",
          `Google Slides native export cannot represent ${node.type} nodes. Choose PDF or PPTX for this design.`,
        );
    }
  const requests: unknown[] = [];
  for (let p = 0; p < doc.pages.length; p++) {
    const page = doc.pages[p];
    const slideId = `studio_page_${p}`;
    requests.push({
      createSlide: {
        objectId: slideId,
        slideLayoutReference: { predefinedLayout: "BLANK" },
      },
    });
    const background = color(resolveColor(page.background, doc.theme));
    if (background)
      requests.push({
        updatePageProperties: {
          objectId: slideId,
          pageProperties: {
            pageBackgroundFill: {
              solidFill: { color: { rgbColor: background }, alpha: 1 },
            },
          },
          fields: "pageBackgroundFill",
        },
      });
    const scaleX = 720 / page.width;
    const scaleY = 405 / page.height;
    let i = 0;
    for (const node of page.nodes) {
      if (node.visible === false || node.width === 0 || node.height === 0)
        continue;
      const objectId = `studio_node_${p}_${i++}`;
      const angle = ((node.rotation ?? 0) * Math.PI) / 180;
      const props = {
        pageObjectId: slideId,
        size: {
          width: { magnitude: node.width * scaleX, unit: "PT" },
          height: { magnitude: node.height * scaleY, unit: "PT" },
        },
        transform: {
          scaleX: Math.cos(angle),
          scaleY: Math.cos(angle),
          shearX: -Math.sin(angle),
          shearY: Math.sin(angle),
          translateX: node.x * scaleX,
          translateY: node.y * scaleY,
          unit: "PT",
        },
      };
      if (node.type === "image" && node.src) {
        requests.push({
          createImage: { objectId, url: node.src, elementProperties: props },
        });
        continue;
      }
      requests.push({
        createShape: {
          objectId,
          shapeType: node.type === "text" ? "TEXT_BOX" : "RECTANGLE",
          elementProperties: props,
        },
      });
      const fill = node.type === 'text' ? undefined : color(resolveColor(node.style?.fill ?? '$surface', doc.theme));
      requests.push({
        updateShapeProperties: {
          objectId,
          shapeProperties: {
            outline: { propertyState: "NOT_RENDERED" },
            ...(fill
              ? {
                  shapeBackgroundFill: {
                    solidFill: {
                      color: { rgbColor: fill },
                      alpha: node.opacity ?? 1,
                    },
                  },
                }
              : { shapeBackgroundFill: { propertyState: "NOT_RENDERED" } }),
          },
          fields: "outline,shapeBackgroundFill",
        },
      });
      if (node.text) {
        requests.push({
          insertText: { objectId, text: node.text, insertionIndex: 0 },
        });
        const foreground = color(
          resolveColor(node.style?.fill ?? '$text', doc.theme),
        );
        requests.push({
          updateTextStyle: {
            objectId,
            textRange: { type: "ALL" },
            style: {
              fontFamily: resolveFont(node.style?.fontFamily, doc.theme),
              fontSize: {
                magnitude: Math.max(
                  1,
                  Number(node.style?.fontSize ?? 24) * scaleY,
                ),
                unit: "PT",
              },
              bold: Number(node.style?.fontWeight ?? 400) >= 600,
              ...(foreground
                ? { foregroundColor: { opaqueColor: { rgbColor: foreground } } }
                : {}),
            },
            fields:
              "fontFamily,fontSize,bold" +
              (foreground ? ",foregroundColor" : ""),
          },
        });
      }
    }
  }
  return requests;
}

/** Remove only default slides returned by the just-created presentation. */
export function createdGooglePresentation(value:unknown){
  const created=z.object({presentationId:z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),slides:z.array(z.object({objectId:z.string().regex(/^[a-zA-Z0-9_:-]{1,128}$/)})).max(100).default([])}).parse(value);
  return {presentationId:created.presentationId,cleanupRequests:created.slides.map(slide=>({deleteObject:{objectId:slide.objectId}}))};
}
