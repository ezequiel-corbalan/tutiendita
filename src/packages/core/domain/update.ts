/** Official repo new versions come from. A fork that publishes its own line changes this constant. */
export const OFFICIAL_REPO = "ezequiel-corbalan/tutiendita";

/** Files in the merchant's repo that an update never overwrites: `wrangler.jsonc` holds their database IDs. */
export const PRESERVED_FILES: readonly string[] = ["wrangler.jsonc"];

/** The store's own GitHub App (created from the panel with the manifest) and where it is installed. */
export type GithubConnection = {
  readonly appId: number;
  readonly slug: string;
  /** PEM private key GitHub returns when the app is created. */
  readonly privateKeyPem: string;
  readonly installationId: number | null;
  /** The store's `owner/repo`. */
  readonly repository: string | null;
};

/** Connection with the app installed on a repo: what is needed to talk to GitHub. */
export type ReadyConnection = GithubConnection & {
  readonly installationId: number;
  readonly repository: string;
};

export const isReady = (c: GithubConnection): c is ReadyConnection =>
  c.installationId !== null && c.repository !== null;

/** How urgent an update is: the panel alerts on `security` and `bugfix`. */
export type UpdateKind = "security" | "bugfix" | "feature";

/** A published release of the official repo: its version, its title and its notes (markdown). */
export type OfficialRelease = { readonly version: string; readonly title: string; readonly notes: string };

export type UpdateStatus =
  | { readonly status: "not-connected" }
  | { readonly status: "not-installed"; readonly slug: string }
  | { readonly status: "up-to-date"; readonly current: string }
  | {
      readonly status: "update-available";
      readonly current: string;
      readonly newVersion: string;
      readonly kind: UpdateKind;
      /** The releases the update brings, newest first: the panel shows their notes. */
      readonly releases: readonly OfficialRelease[];
    }
  /** The app sees the official repo or several repos: it must see only the store's own repo. */
  | {
      readonly status: "wrong-repository";
      readonly installationId: number;
      readonly repositories: readonly string[];
    };

const parts = (v: string) =>
  v
    .replace(/^v/, "")
    .split(/[.-]/)
    .slice(0, 3)
    .map((p) => Number.parseInt(p, 10) || 0);

/** `candidate` is newer than `current`, comparing major, minor and patch (anything after a hyphen is ignored). */
export function isNewer(candidate: string, current: string): boolean {
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

// Markers the maintainer writes in a release's title or notes.
const SECURITY_MARKER = /\[security\]/i;
const FIX_MARKER = /\[fix\]/i;

/** The releases the store would get: newer than `current`, up to `latest`. */
export const pendingReleases = (releases: readonly OfficialRelease[], current: string, latest: string) =>
  releases.filter((r) => isNewer(r.version, current) && !isNewer(r.version, latest));

/**
 * The most urgent kind among `pending` releases: `security` only if one is marked `[security]` in its title
 * or notes (never guessed); `bugfix` if one is marked `[fix]` or is a patch release (x.y.Z with Z > 0);
 * otherwise `feature`.
 */
export function updateKind(pending: readonly OfficialRelease[]): UpdateKind {
  const text = (r: OfficialRelease) => `${r.title}\n${r.notes}`;
  if (pending.some((r) => SECURITY_MARKER.test(text(r)))) return "security";
  if (pending.some((r) => FIX_MARKER.test(text(r)) || (parts(r.version)[2] ?? 0) > 0)) return "bugfix";
  return "feature";
}

/** A release title without the `[security]` / `[fix]` markers, which are for the panel, not for people. */
export const cleanTitle = (title: string) =>
  title.replace(SECURITY_MARKER, "").replace(FIX_MARKER, "").replace(/\s+/g, " ").trim();
