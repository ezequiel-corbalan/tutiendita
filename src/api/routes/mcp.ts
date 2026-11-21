import type { DomainError } from "../../packages/core/index";
import { Hono } from "hono";
import { z } from "zod";
import { build } from "../../container";
import { ASSISTANT_GUIDE, SKILL_FOLDER, SKILL_MARKDOWN } from "../../lib/assistant-skill";
import { STORE_VERSION } from "../../version";
import { zip } from "../../lib/zip";
import { parseActions } from "../../lib/action-link";
import { applyAction, guideMarkdown } from "../mcp/guide";
import { savePhotos, ticketFrom } from "../mcp/photos";
import { runTool, TOOLS, type ToolContext } from "../mcp/tools";
import { type ErrorBody, respondDomainError } from "../errors";
import { MAX_UPLOADS } from "../options-schema";
import { validate } from "../validation";
import { bodyCap, readPhotos } from "./products";
import { requireSession } from "../middlewares/session";
import type { ApiEnv } from "../types";
import { sameSecret, timeZone } from "./calendar";

/** MCP revisions this server speaks (Streamable HTTP, JSON answers, no SSE). The first one is offered by default. */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2025-11-25"];

/** What the client model reads once, when it connects: the same guide as the skill (Claude) and the prompt (ChatGPT). */
export const INSTRUCTIONS = `${ASSISTANT_GUIDE}
Answer in the store's language (get_store → language).`;

const rpcRequest = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});

type RpcRequest = z.infer<typeof rpcRequest>;

const callParams = z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).default({}) });

const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({
  jsonrpc: "2.0" as const,
  id: id ?? null,
  error: { code, message },
});

const text = (value: unknown, isError = false) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

const describeError = (e: DomainError) => ({ error: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) });

/** The tool list, built once per isolate: JSON Schema from the same zod schemas that validate the calls. */
let toolList: unknown[] | undefined;
const listTools = () =>
  (toolList ??= TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: z.toJSONSchema(t.input, { io: "input" }),
    annotations: { title: t.title, openWorldHint: false, ...t.annotations },
  })));

async function handle(req: RpcRequest, ctx: ToolContext) {
  switch (req.method) {
    case "initialize": {
      const asked = (req.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      const protocolVersion =
        typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "tutiendita", title: "tutiendita", version: STORE_VERSION },
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: listTools() };
    case "tools/call": {
      const params = callParams.safeParse(req.params);
      if (!params.success) return rpcError(req.id, -32602, "Invalid params");
      if (!TOOLS.some((t) => t.name === params.data.name)) return rpcError(req.id, -32602, `Unknown tool: ${params.data.name}`);
      // Errors, bad arguments included, go back to the model as a tool error, so it can fix them and retry.
      const r = await runTool(params.data.name, params.data.arguments, ctx);
      return r.ok ? text(r.value) : text(describeError(r.error), true);
    }
    default:
      return rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

/**
 * The store's MCP server, for Claude (free plan included: one custom connector), ChatGPT and any MCP client.
 * Like the calendar feed, the unguessable token in the URL is the only key and every miss is a 404.
 * shortcut: a secret URL instead of OAuth, because free plans only take a URL; add OAuth when a client requires it
 */
/** Whether `token` is the assistant's current one (constant time). */
export async function isAssistantToken(container: ReturnType<typeof build>, token: string): Promise<boolean> {
  const current = await container.assistant.token();
  return current !== null && (await sameSecret(token, current));
}

export const mcpRoutes = new Hono<ApiEnv>()
  // The optional skill: a zip with SKILL.md that Claude imports in Settings → Capabilities → Skills.
  .get("/skill.zip", (c) =>
    c.body(zip([{ name: `${SKILL_FOLDER}/SKILL.md`, data: new TextEncoder().encode(SKILL_MARKDOWN) }]), 200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${SKILL_FOLDER}.zip"`,
    }),
  )
  // For AIs without a connector (ChatGPT free…): the owner pastes this link and the AI reads its instructions and
  // the store's data. Read-only: changes go through /confirmar/<token>, which the owner confirms.
  .get("/:token/guide.md", async (c) => {
    const container = build(c.env);
    if (!(await isAssistantToken(container, c.req.param("token")))) return c.notFound();
    const text = await guideMarkdown(container, new URL(c.req.url).origin, c.req.param("token"));
    return c.body(text, 200, {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    });
  })
  .all("/:token", async (c) => {
    const container = build(c.env);
    if (!(await isAssistantToken(container, c.req.param("token")))) return c.notFound();
    // No server-to-client stream: GET (SSE) and DELETE (sessions) aren't offered.
    if (c.req.method !== "POST") return c.body(null, 405, { allow: "POST" });
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(rpcError(null, -32700, "Parse error"), 400);
    }
    const parsed = rpcRequest.safeParse(body);
    if (!parsed.success) return c.json(rpcError(null, -32600, "Invalid request (one JSON-RPC message per POST)"), 400);
    // A notification (no id) gets no answer.
    if (parsed.data.id === undefined) return c.body(null, 202);
    const result = await handle(parsed.data, { container, origin: new URL(c.req.url).origin });
    return c.json("error" in result && "jsonrpc" in result ? result : { jsonrpc: "2.0", id: parsed.data.id, result });
  });

/** The upload page's files: image_0 … image_7 (shrunk in the browser first). */
const photosSchema = z.object(
  Object.fromEntries(
    Array.from({ length: MAX_UPLOADS }, (_, i) => [`image_${i}`, z.instanceof(File, { message: "Must be a file" }).optional()]),
  ),
);

/**
 * The owner turns the assistant on (a new URL, the old one dies) or off from the panel. Photo uploads come from
 * /subir-fotos/<ticket> without a session: the signed ticket the assistant handed out is the key (the app
 * already required the store's Origin, so another site can't post here).
 */
export const assistantRoutes = new Hono<ApiEnv>()
  // The owner confirmed a change link an AI wrote (/confirmar/<token>?…). The query is parsed again here: what the
  // page showed is never trusted. No session (the owner may be on another device): the token is the key.
  .post(
    "/actions/:token",
    validate("json", z.object({ query: z.string().max(10_000) })),
    async (c) => {
      const container = build(c.env);
      if (!(await isAssistantToken(container, c.req.param("token")))) {
        return c.json<ErrorBody>({ error: { code: "NOT_AUTHENTICATED", message: "The assistant link changed" } }, 401);
      }
      const { actions } = parseActions(new URLSearchParams(c.req.valid("json").query));
      const ctx = { container, origin: new URL(c.req.url).origin };
      const results = [];
      for (const action of actions) {
        const r = await applyAction(action, ctx);
        results.push({ ...action, ok: r.ok, ...(r.ok ? {} : { error: r.error.code }) });
      }
      return c.json({ applied: results.filter((r) => r.ok).length, results });
    },
  )
  .post("/photos/:ticket", bodyCap, validate("form", photosSchema, "Invalid photos"), async (c) => {
    const container = build(c.env);
    const ticket = await ticketFrom(container, c.req.param("ticket"));
    if (ticket === null) {
      return c.json<ErrorBody>({ error: { code: "PHOTO_LINK_EXPIRED", message: "This upload link expired" } }, 410);
    }
    const photos = await readPhotos(c.req.valid("form") as Record<`image_${number}`, File | undefined>);
    if (!photos.ok) return respondDomainError(c, photos.error);
    const r = await savePhotos(container, ticket.target, photos.value.uploads ?? []);
    if (!r.ok) return respondDomainError(c, r.error);
    return c.json(r.value);
  })
  .post("/token", requireSession("completa"), validate("json", z.object({ time_zone: timeZone.optional() })), async (c) => {
    const container = build(c.env);
    // The owner's browser zone is the shop's: "today" and "this week" for the assistant.
    const zone = c.req.valid("json").time_zone;
    if (zone) await container.calendar.setTimeZone(zone);
    const token = await container.assistant.rotate();
    return c.json({ url: new URL(`/mcp/${token}`, c.req.url).href });
  })
  .delete("/token", requireSession("completa"), async (c) => {
    await build(c.env).assistant.disconnect();
    return c.json({ connected: false });
  });
