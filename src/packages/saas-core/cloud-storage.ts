import type { StorageDriver } from "../../adapter/types.ts";
import type { RevisionWriteResult } from "./model.ts";

export interface CloudStorageOptions {
  /** Absolute URL of the document endpoint, e.g. https://api.example.com/documents */
  endpoint: string;
  getAccessToken: () => string | null | Promise<string | null>;
  /** Device-side store used offline and until the first cloud sync succeeds. */
  local: StorageDriver;
  /** Prefixed so revision metadata never collides with content keys. */
  revisionKeyPrefix?: string;
  fetch?: typeof globalThis.fetch;
  /** Called when a write could not reach the cloud or lost a revision race. */
  onWriteFallback?: (key: string, reason: "offline" | "conflict") => void;
}

interface DocumentResponse {
  revision: number;
  updatedAt: string;
  value: unknown;
}

/**
 * A StorageDriver backed by the revisioned cloud document endpoint with the
 * local driver as a fallback. Reads prefer the cloud but fall back locally
 * when the value is unknown there or the network fails; writes that fail keep
 * the local value and never clobber a newer cloud revision.
 */
export function createCloudStorageDriver(options: CloudStorageOptions): StorageDriver {
  const revisionPrefix = options.revisionKeyPrefix ?? "oc_cloud_rev:v1:";
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  const requestUrl = (key: string): URL => {
    const url = new URL(options.endpoint, globalThis.location?.origin ?? "http://localhost");
    url.searchParams.set("key", key);
    return url;
  };

  const authorize = async (init: RequestInit = {}): Promise<RequestInit> => {
    const token = await options.getAccessToken();
    if (!token) throw new Error("Cloud storage requires an authenticated session");
    return {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    };
  };

  const readRevision = (key: string): number | null => {
    const raw = options.local.get(revisionPrefix + key);
    if (typeof raw !== "string") return null;
    const revision = Number(raw);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
  };

  const writeRevision = (key: string, revision: number): void => {
    options.local.set(revisionPrefix + key, String(revision));
  };

  return {
    async get(key) {
      try {
        const response = await doFetch(requestUrl(key), await authorize());
        if (response.status === 404) return options.local.get(key);
        if (!response.ok) return options.local.get(key);
        const document = (await response.json()) as DocumentResponse;
        writeRevision(key, document.revision);
        // StorageDriver values are JSON strings, mirroring what the app writes.
        return document.value === null || document.value === undefined
          ? null
          : JSON.stringify(document.value);
      } catch {
        return options.local.get(key);
      }
    },

    async set(key, value) {
      let parsed: unknown = value;
      try {
        parsed = JSON.parse(value) as unknown;
      } catch {
        parsed = value;
      }
      try {
        const revision = readRevision(key);
        const response = await doFetch(
          requestUrl(key),
          await authorize({
            method: "PUT",
            body: JSON.stringify({ expectedRevision: revision ?? 0, value: parsed }),
          }),
        );
        if (response.ok) {
          const document = (await response.json()) as DocumentResponse;
          writeRevision(key, document.revision);
          return;
        }
        // A newer revision exists elsewhere. Keep the local copy and surface
        // the conflict; merging opaque blobs is the caller's decision.
        if (response.status === 409) {
          const conflict = (await response.json()) as RevisionWriteResult<unknown>;
          if (conflict.kind === "revision-conflict") writeRevision(key, conflict.current.revision);
          options.onWriteFallback?.(key, "conflict");
        }
      } catch {
        options.onWriteFallback?.(key, "offline");
      }
      options.local.set(key, value);
    },

    async remove(key) {
      options.local.remove(key);
      options.local.remove(revisionPrefix + key);
      try {
        await doFetch(requestUrl(key), await authorize({ method: "DELETE" }));
      } catch {
        // The local removal already happened; the cloud row is cleaned up on
        // the next write for this key instead.
      }
    },
  };
}
