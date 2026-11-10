import type { ReadyConnection } from "../../../src/packages/core/index";
import { describe, expect, it } from "vitest";
import { appJwt, blobSha, createGithubClient, pkcs8FromPem } from "../../../src/packages/infra-cloudflare/github/github-client";
import { tarballFiles } from "../../../src/packages/infra-cloudflare/github/tarball";

const enc = new TextEncoder();

/** Minimal ustar tar; `pax` adds a PAX header with the path (as GitHub does for long paths). */
function buildTar(files: { path: string; text: string; pax?: boolean }[]): Uint8Array<ArrayBuffer> {
  const blocks: Uint8Array[] = [];
  const header = (name: string, size: number, type: string) => {
    const h = new Uint8Array(512);
    h.set(enc.encode(name.slice(0, 99)), 0);
    h.set(enc.encode("0000644\0"), 100);
    h.set(enc.encode(`${size.toString(8).padStart(11, "0")}\0`), 124);
    h[156] = type.charCodeAt(0);
    h.set(enc.encode("ustar\0"), 257);
    return h;
  };
  const data = (b: Uint8Array) => {
    const d = new Uint8Array(Math.ceil(b.length / 512) * 512);
    d.set(b);
    return d;
  };
  const global = enc.encode("52 comment=abc\n");
  blocks.push(header("pax_global_header", global.length, "g"), data(global));
  blocks.push(header("ana-tutiendita-abc/", 0, "5"));
  for (const a of files) {
    const content = enc.encode(a.text);
    const path = `ana-tutiendita-abc/${a.path}`;
    if (a.pax) {
      const record = ` path=${path}\n`;
      const line = enc.encode(`${record.length + String(record.length).length}${record}`);
      blocks.push(header("PaxHeader", line.length, "x"), data(line));
      blocks.push(header("short", content.length, "0"), data(content));
    } else {
      blocks.push(header(path, content.length, "0"), data(content));
    }
  }
  blocks.push(new Uint8Array(1024));
  const all = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let i = 0;
  for (const b of blocks) {
    all.set(b, i);
    i += b.length;
  }
  return all;
}

const asStream = (b: Uint8Array<ArrayBuffer>) => new Response(b).body as ReadableStream<Uint8Array>;
const gzip = (b: Uint8Array<ArrayBuffer>) =>
  asStream(b).pipeThrough(
    new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>,
  );

describe("tarball", () => {
  it("returns the files without the root folder, with PAX paths and without the global header", async () => {
    const files = await tarballFiles(
      asStream(
        buildTar([
          { path: "package.json", text: '{"version":"0.2.0"}' },
          { path: `src/${"very-long/".repeat(12)}a.ts`, text: "export {};", pax: true },
        ]),
      ),
    );
    expect(files.map((a) => [a.path, a.mode, new TextDecoder().decode(a.content)])).toEqual([
      ["package.json", "100644", '{"version":"0.2.0"}'],
      [`src/${"very-long/".repeat(12)}a.ts`, "100644", "export {};"],
    ]);
  });
});

describe("app signature", () => {
  it("the blob SHA matches git", async () => {
    expect(await blobSha(new Uint8Array())).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });

  it("converts the GitHub PKCS#1 key to PKCS#8 and signs a verifiable RS256 JWT", async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
    const pkcs1 = pkcs8.slice(26); // 30 82 LL LL | 02 01 00 | AlgorithmIdentifier (15) | 04 82 LL LL
    const pem = (type: string, b: Uint8Array) =>
      `-----BEGIN ${type}-----\n${btoa(String.fromCharCode(...b))}\n-----END ${type}-----\n`;
    expect(pkcs8FromPem(pem("RSA PRIVATE KEY", pkcs1))).toEqual(pkcs8);
    expect(pkcs8FromPem(pem("PRIVATE KEY", pkcs8))).toEqual(pkcs8);

    const jwt = await appJwt(7, pem("RSA PRIVATE KEY", pkcs1), new Date("2026-10-15T12:00:00Z"));
    const [h, p, s] = jwt.split(".") as [string, string, string];
    const fromB64 = (s: string) =>
      Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    expect(JSON.parse(new TextDecoder().decode(fromB64(p)))).toEqual({
      iat: 1792065540,
      exp: 1792066140,
      iss: "7",
    });
    expect(
      await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pair.publicKey, fromB64(s), enc.encode(`${h}.${p}`)),
    ).toBe(true);
  });
});

describe("GitHub client against a fake GitHub", () => {
  async function build({ release = true }: { release?: boolean } = {}) {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
    const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----`;
    const same = await blobSha(enc.encode("same"));
    const wrangler = await blobSha(enc.encode("mine"));
    const requests: { method: string; url: string; body?: unknown }[] = [];
    const json = (x: unknown, status = 200) => Response.json(x, { status });
    const fake: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, url, body });
      const path = url.replace("https://api.github.com", "");
      if (path === "/app/installations/99/access_tokens") return json({ token: "t" }, 201);
      if (path === "/repos/ana/tiendita") return json({ default_branch: "main" });
      if (path === "/repos/ana/tiendita/commits/main")
        return json({ sha: "c1", commit: { tree: { sha: "a1" } } });
      if (path === "/repos/ana/tiendita/git/trees/a1?recursive=1")
        return json({
          tree: [
            { path: "same.txt", sha: same, type: "blob" },
            { path: "wrangler.jsonc", sha: wrangler, type: "blob" },
            { path: "own.txt", sha: "x", type: "blob" },
          ],
        });
      if (path === "/repos/oficial/tutiendita/releases?per_page=100")
        return json(
          release
            ? [
                { tag_name: "v0.3.0", name: "draft", body: null, draft: true, prerelease: false },
                { tag_name: "v0.3.0-rc.1", name: null, body: null, draft: false, prerelease: true },
                {
                  tag_name: "v0.2.0",
                  name: "v0.2.0",
                  body: "[security] cookies",
                  draft: false,
                  prerelease: false,
                },
                { tag_name: "v0.1.1", name: null, body: null, draft: false, prerelease: false },
              ]
            : [],
        );
      if (path === "/repos/oficial/tutiendita/tarball/v0.2.0")
        return new Response(
          gzip(
            buildTar([
              { path: "same.txt", text: "same" },
              { path: "wrangler.jsonc", text: "official" },
              { path: "src/new.ts", text: "export const v = 2;" },
              // The official repo's own CI: the store's app can't write workflows, and doesn't need them.
              { path: ".github/workflows/ci.yml", text: "on: push" },
            ]),
          ),
        );
      if (path === "/repos/ana/tiendita/git/trees") return json({ sha: "a2" }, 201);
      if (path === "/repos/ana/tiendita/git/commits") return json({ sha: "c2" }, 201);
      if (path === "/repos/ana/tiendita/git/refs") return json({ message: "Reference already exists" }, 422);
      if (path === "/repos/ana/tiendita/git/refs/heads/tutiendita-0.2.0") return json({}, 200);
      if (path.startsWith("/repos/ana/tiendita/pulls?")) return json([]);
      if (path === "/repos/ana/tiendita/pulls")
        return json({ number: 5, html_url: "https://github.com/ana/tiendita/pull/5" }, 201);
      if (path === "/repos/ana/tiendita/pulls/5/merge") return json({ merged: true });
      if (path === "/repos/ana/tiendita/contents/wrangler.jsonc") {
        if (method === "PUT") return json({ commit: { sha: "c3" } });
        const utf8 = String.fromCharCode(...enc.encode('{ "name": "tiendita-ñandú" }'));
        return json({ content: `${btoa(utf8).slice(0, 10)}\n${btoa(utf8).slice(10)}`, sha: "w1" });
      }
      if (path === "/repos/oficial/tutiendita/contents/package.json?ref=main")
        return json({ content: btoa('{"version":"0.2.0"}') });
      return json({ message: `no route ${path}` }, 404);
    };
    const connection: ReadyConnection = {
      appId: 7,
      slug: "tiendita-ana",
      privateKeyPem,
      installationId: 99,
      repository: "ana/tiendita",
    };
    return { client: createGithubClient({ fetch: fake }), requests, connection };
  }

  it("reads the official version from the latest published release (no drafts or pre-releases) with their notes, or from package.json on main without releases", async () => {
    const withRelease = await build();
    expect(await withRelease.client.officialVersion(withRelease.connection, "oficial/tutiendita")).toEqual({
      version: "0.2.0",
      ref: "v0.2.0",
      releases: [
        { version: "0.2.0", title: "v0.2.0", notes: "[security] cookies" },
        { version: "0.1.1", title: "v0.1.1", notes: "" },
      ],
    });
    const noRelease = await build({ release: false });
    expect(await noRelease.client.officialVersion(noRelease.connection, "oficial/tutiendita")).toEqual({
      version: "0.2.0",
      ref: "main",
      releases: [],
    });
  });

  it("builds the PR only with what changed, without touching wrangler.jsonc, the official .github/ or the store's own files", async () => {
    const { client, connection, requests } = await build();
    const pr = await client.prepareUpdate(connection, {
      officialRepo: "oficial/tutiendita",
      ref: "v0.2.0",
      version: "0.2.0",
      preserve: ["wrangler.jsonc"],
    });
    expect(pr).toEqual({ number: 5, url: "https://github.com/ana/tiendita/pull/5", files: 1 });
    const tree = requests.find((x) => x.url.endsWith("/git/trees") && x.method === "POST");
    expect(tree?.body).toEqual({
      base_tree: "a1",
      tree: [{ path: "src/new.ts", mode: "100644", type: "blob", content: "export const v = 2;" }],
    });
    expect(requests.some((x) => x.method === "PATCH")).toBe(true); // the branch already existed: forced
    const prBody = requests.find((x) => x.url.endsWith("/pulls") && x.method === "POST")?.body as {
      body: string;
      base: string;
    };
    expect(prBody.base).toBe("main");
    expect(prBody.body).toContain("cambió `wrangler.jsonc`"); // PR text is for the merchant (Spanish)
    expect(requests.length).toBeLessThan(15); // far below the free plan's 50 subrequests
  });

  it("reads and commits a UTF-8 file on the default branch; a missing file is null", async () => {
    const { client, connection, requests } = await build();
    expect(await client.readFile(connection, "wrangler.jsonc")).toEqual({
      text: '{ "name": "tiendita-ñandú" }',
      sha: "w1",
    });
    expect(await client.readFile(connection, "missing.jsonc")).toBeNull();
    await client.writeFile(connection, { path: "wrangler.jsonc", text: "ñ", sha: "w1", message: "Conectar" });
    const put = requests.at(-1);
    expect(put).toMatchObject({ method: "PUT", body: { message: "Conectar", sha: "w1" } });
    const content = (put?.body as { content?: string } | undefined)?.content ?? "";
    expect(new TextDecoder().decode(Uint8Array.from(atob(content), (c) => c.charCodeAt(0)))).toBe("ñ");
    expect(put?.body).not.toHaveProperty("branch");
  });

  it("apply squash-merges the PR", async () => {
    const { client, connection, requests } = await build();
    await client.applyUpdate(connection, 5);
    expect(requests.at(-1)).toMatchObject({ method: "PUT", body: { merge_method: "squash" } });
  });
});
