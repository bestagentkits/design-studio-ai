import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './types';
import { projectRow } from './projects';
import { id, now, owner } from './security';
export const conversationRoutes = new Hono<Env>();
conversationRoutes.get('/:id/messages', async c => {
  await projectRow(c, c.req.param('id'));
  const result = await c.env.DB.prepare('SELECT id,role,text,created_at as createdAt FROM messages WHERE project_id=? AND user_id=? ORDER BY created_at DESC LIMIT 200').bind(c.req.param('id'), owner(c)).all();
  return c.json({ messages: result.results.reverse() });
});
conversationRoutes.post('/:id/messages', async c => {
  await projectRow(c, c.req.param('id'));
  const body = z.object({ role: z.enum(['user', 'assistant']), text: z.string().min(1).max(30000) }).parse(await c.req.json());
  const message = { id: id(), ...body, createdAt: now() };
  await c.env.DB.prepare('INSERT INTO messages(id,project_id,user_id,role,text,created_at) VALUES(?,?,?,?,?,?)').bind(message.id, c.req.param('id'), owner(c), body.role, body.text, message.createdAt).run();
  return c.json({ message }, 201);
});
