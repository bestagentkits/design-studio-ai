import { Hono } from "hono";
import { z } from "zod";
import { projectRow } from "./projects";
import { fail } from "./security";
import { limitedBytes, upstream } from "./providers";
import { documentSchema } from "../src/shared/schema";
import { googleSlidesRequests,createdGooglePresentation } from './google-slides-content';
import type { Env } from "./types";
export const googleRoutes = new Hono<Env>();
googleRoutes.post("/:id/google-slides", async (c) => {
  const row = await projectRow(c, c.req.param("id"));
  const body = z
    .object({ accessToken: z.string().min(20).max(4096) })
    .parse(await c.req.json());
  const doc = documentSchema.parse(JSON.parse(row.document));
  const requests=googleSlidesRequests(doc);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${body.accessToken}`,
  };
  const create = await upstream(
    "https://slides.googleapis.com/v1/presentations?fields=presentationId,slides(objectId)",
    { method: "POST", headers, body: JSON.stringify({ title: doc.name }) },
  );
  const presentation = JSON.parse(
    new TextDecoder().decode(await limitedBytes(create, 1024 * 1024)),
  );
  const {presentationId,cleanupRequests}=createdGooglePresentation(presentation);
  try {
    await upstream(
      `https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`,
      { method: "POST", headers, body: JSON.stringify({ requests:[...cleanupRequests,...requests] }) },
    );
  } catch {
    fail(
      502,
      "google_export_failed",
      `Google created presentation ${presentationId}, but adding content failed. Check image URLs and Google permissions; remove the incomplete presentation before retrying.`,
    );
  }
  return c.json({
    presentationId,
    url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
  });
});
