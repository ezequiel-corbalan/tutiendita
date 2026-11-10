import type { GithubClient, GithubConnection, ReadyConnection } from "../../core/index";
import { tarballFiles } from "./tarball";

const API = "https://api.github.com";

type Fetch = typeof fetch;

/** GitHub error with its status: the use cases turn it into a notice for the panel. */
export class GithubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`GitHub ${status}: ${message}`);
  }
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let x = n; x > 0; x >>= 8) bytes.unshift(x & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

/** GitHub hands out the key as PKCS#1 (`BEGIN RSA PRIVATE KEY`); WebCrypto only imports PKCS#8. */
export function pkcs8FromPem(pem: string): Uint8Array<ArrayBuffer> {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  if (!pem.includes("BEGIN RSA PRIVATE KEY")) return der;
  const version = [0x02, 0x01, 0x00];
  const rsa = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octets = [0x04, ...derLength(der.length), ...der];
  const body = [...version, ...rsa, ...octets];
  return Uint8Array.from([0x30, ...derLength(body.length), ...body]);
}

/** The app's RS256 JWT (valid 10 minutes; backdated 60 s for clock skew, as GitHub asks). */
export async function appJwt(appId: number, pem: string, now: Date): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8FromPem(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const iat = Math.floor(now.getTime() / 1000) - 60;
  const data = `${b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64urlText(
    JSON.stringify({ iat, exp: iat + 600, iss: String(appId) }),
  )}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(signature))}`;
}

/** Git SHA-1 of a blob: the same content has the same SHA in any repo. */
export async function blobSha(content: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${content.length}\0`);
  const all = new Uint8Array(header.length + content.length);
  all.set(header);
  all.set(content, header.length);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", all));
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const utf8Text = (bytes: Uint8Array): string | null => {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

export function createGithubClient(options: { fetch?: Fetch; clock?: () => Date } = {}): GithubClient {
  const f: Fetch = options.fetch ?? fetch;
  const now = options.clock ?? (() => new Date());

  async function request<T>(method: string, path: string, auth: string | null, body?: unknown): Promise<T> {
    const r = await f(path.startsWith("http") ? path : `${API}${path}`, {
      method: method,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "tiendita",
        ...(auth ? { authorization: auth } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!r.ok) throw new GithubError(r.status, `${method} ${path}: ${(await r.text()).slice(0, 300)}`);
    return (r.status === 204 ? undefined : await r.json()) as T;
  }

  async function installationToken(c: GithubConnection & { installationId: number }): Promise<string> {
    const jwt = await appJwt(c.appId, c.privateKeyPem, now());
    const { token } = await request<{ token: string }>(
      "POST",
      `/app/installations/${c.installationId}/access_tokens`,
      `Bearer ${jwt}`,
    );
    return `token ${token}`;
  }

  return {
    async exchangeManifest(code) {
      const app = await request<{ id: number; slug: string; pem: string }>(
        "POST",
        `/app-manifests/${encodeURIComponent(code)}/conversions`,
        null,
      );
      return { appId: app.id, slug: app.slug, privateKeyPem: app.pem };
    },

    async installationRepositories(c) {
      const token = await installationToken(c);
      const r = await request<{ repositories: { full_name: string }[] }>(
        "GET",
        "/installation/repositories?per_page=100",
        token,
      );
      return r.repositories.map((x) => x.full_name);
    },

    async officialVersion(c, officialRepo) {
      const token = await installationToken(c);
      // Newest first. shortcut: only the last 100 releases are classified, page through if a store falls further behind.
      const list = await request<
        { tag_name: string; name: string | null; body: string | null; draft: boolean; prerelease: boolean }[]
      >("GET", `/repos/${officialRepo}/releases?per_page=100`, token);
      const published = list.filter((r) => !r.draft && !r.prerelease);
      const latest = published[0];
      if (latest) {
        return {
          version: latest.tag_name.replace(/^v/, ""),
          ref: latest.tag_name,
          releases: published.map((r) => ({
            version: r.tag_name.replace(/^v/, ""),
            title: r.name || r.tag_name,
            notes: r.body ?? "",
          })),
        };
      }
      // No release published yet: fall back to the version on main.
      const r = await request<{ content: string }>(
        "GET",
        `/repos/${officialRepo}/contents/package.json?ref=main`,
        token,
      );
      const json = new TextDecoder().decode(
        Uint8Array.from(atob(r.content.replace(/\s/g, "")), (x) => x.charCodeAt(0)),
      );
      return {
        version: String((JSON.parse(json) as { version?: string }).version ?? "0.0.0"),
        ref: "main",
        releases: [],
      };
    },

    async prepareUpdate(c: ReadyConnection, p) {
      const token = await installationToken(c);
      const repo = c.repository;
      const { default_branch: branch } = await request<{ default_branch: string }>(
        "GET",
        `/repos/${repo}`,
        token,
      );
      const head = await request<{ sha: string; commit: { tree: { sha: string } } }>(
        "GET",
        `/repos/${repo}/commits/${encodeURIComponent(branch)}`,
        token,
      );
      const current = await request<{ tree: { path: string; sha: string; type: string }[] }>(
        "GET",
        `/repos/${repo}/git/trees/${head.commit.tree.sha}?recursive=1`,
        token,
      );
      const currentSha = new Map(current.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));

      // A single request for the whole official repo (the free plan allows 50 subrequests per request).
      const tar = await f(`${API}/repos/${p.officialRepo}/tarball/${encodeURIComponent(p.ref)}`, {
        headers: { authorization: token, "user-agent": "tiendita", accept: "application/vnd.github+json" },
      });
      if (!tar.ok || !tar.body) throw new GithubError(tar.status, "official repo tarball");
      const official = await tarballFiles(tar.body.pipeThrough(new DecompressionStream("gzip")));

      const entries: { path: string; mode: string; type: "blob"; sha?: string; content?: string }[] = [];
      let wranglerChanged = false;
      for (const a of official) {
        // The official repo's CI isn't the store's, and GitHub refuses workflow files from an app without `workflows`.
        if (a.path.startsWith(".github/")) continue;
        const sha = await blobSha(a.content);
        if (currentSha.get(a.path) === sha) continue;
        if (p.preserve.includes(a.path)) {
          wranglerChanged = true;
          continue;
        }
        const text = utf8Text(a.content);
        if (text !== null) {
          entries.push({ path: a.path, mode: a.mode, type: "blob", content: text });
        } else {
          let binary = "";
          for (const b of a.content) binary += String.fromCharCode(b);
          const blob = await request<{ sha: string }>("POST", `/repos/${repo}/git/blobs`, token, {
            content: btoa(binary),
            encoding: "base64",
          });
          entries.push({ path: a.path, mode: a.mode, type: "blob", sha: blob.sha });
        }
      }
      // shortcut: does not delete what the official repo removed (they could be the store's own files); improve if it gets in the way.
      if (entries.length === 0) return null;

      const tree = await request<{ sha: string }>("POST", `/repos/${repo}/git/trees`, token, {
        base_tree: head.commit.tree.sha,
        tree: entries,
      });
      // Commit and PR texts are for the merchant: they stay in Spanish.
      const commit = await request<{ sha: string }>("POST", `/repos/${repo}/git/commits`, token, {
        message: `Actualizar tutiendita a la versión ${p.version}`,
        tree: tree.sha,
        parents: [head.sha],
      });
      const newBranch = `tutiendita-${p.version}`;
      try {
        await request("POST", `/repos/${repo}/git/refs`, token, {
          ref: `refs/heads/${newBranch}`,
          sha: commit.sha,
        });
      } catch (e) {
        if (!(e instanceof GithubError) || e.status !== 422) throw e;
        await request("PATCH", `/repos/${repo}/git/refs/heads/${newBranch}`, token, {
          sha: commit.sha,
          force: true,
        });
      }
      const owner = repo.split("/")[0];
      const opened = await request<{ number: number; html_url: string }[]>(
        "GET",
        `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${newBranch}`)}`,
        token,
      );
      const pr =
        opened[0] ??
        (await request<{ number: number; html_url: string }>("POST", `/repos/${repo}/pulls`, token, {
          title: `Actualizar tutiendita a la versión ${p.version}`,
          head: newBranch,
          base: branch,
          body: [
            `Trae la versión ${p.version} de [${p.officialRepo}](https://github.com/${p.officialRepo}). Cambian ${entries.length} archivos.`,
            "",
            `Se conservan sin tocar: ${p.preserve.map((x) => `\`${x}\``).join(", ")}.`,
            wranglerChanged
              ? "**Atención:** el repo oficial cambió `wrangler.jsonc`; revisá esos cambios a mano antes de aplicar."
              : "",
            "Si cambiaste el código de tu tienda, revisá el diff: esta actualización pisa los archivos que cambiaron en la versión oficial.",
            "",
            "Al aplicarlo (merge), Cloudflare vuelve a publicar la tienda y aplica las migraciones de la base.",
          ]
            .filter((l, i, a) => l !== "" || a[i - 1] !== "")
            .join("\n"),
        }));
      return { number: pr.number, url: pr.html_url, files: entries.length };
    },

    async applyUpdate(c, number) {
      const token = await installationToken(c);
      await request("PUT", `/repos/${c.repository}/pulls/${number}/merge`, token, { merge_method: "squash" });
    },

    async readFile(c, path) {
      const token = await installationToken(c);
      try {
        const r = await request<{ content: string; sha: string }>(
          "GET",
          `/repos/${c.repository}/contents/${path}`,
          token,
        );
        const bytes = Uint8Array.from(atob(r.content.replace(/\s/g, "")), (x) => x.charCodeAt(0));
        return { text: new TextDecoder().decode(bytes), sha: r.sha };
      } catch (e) {
        if (e instanceof GithubError && e.status === 404) return null;
        throw e;
      }
    },

    async writeFile(c, f) {
      const token = await installationToken(c);
      let binary = "";
      for (const b of new TextEncoder().encode(f.text)) binary += String.fromCharCode(b);
      // Without `branch`, GitHub commits to the default branch, which is the one Cloudflare deploys.
      await request("PUT", `/repos/${c.repository}/contents/${f.path}`, token, {
        message: f.message,
        content: btoa(binary),
        sha: f.sha,
      });
    },
  };
}
