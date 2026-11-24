import type { DrawingDocument } from "../drawing-engine/model.ts";
import type { RevisionWriteResult, VersionedResource } from "./model.ts";

export interface ChartDocumentClientOptions {
  endpoint: string;
  getAccessToken: () => string | null | Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}

export interface ChartDocumentClient {
  get(workspaceId: string, symbolId: string): Promise<VersionedResource<DrawingDocument> | null>;
  save(
    workspaceId: string,
    symbolId: string,
    expectedRevision: number,
    document: DrawingDocument,
  ): Promise<RevisionWriteResult<DrawingDocument>>;
}

export function createChartDocumentClient(options: ChartDocumentClientOptions): ChartDocumentClient {
  const request = async (workspaceId: string, symbolId: string, init?: RequestInit) => {
    const token = await options.getAccessToken();
    if (!token) throw new Error("Cloud chart storage requires an authenticated session");
    const url = new URL(options.endpoint, globalThis.location?.origin ?? "http://localhost");
    url.searchParams.set("workspaceId", workspaceId);
    url.searchParams.set("symbolId", symbolId);
    return (options.fetch ?? globalThis.fetch)(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...init?.headers,
      },
    });
  };

  return {
    async get(workspaceId, symbolId) {
      const response = await request(workspaceId, symbolId);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Cloud chart read failed (${response.status})`);
      return response.json() as Promise<VersionedResource<DrawingDocument>>;
    },

    async save(workspaceId, symbolId, expectedRevision, document) {
      const response = await request(workspaceId, symbolId, {
        method: "PUT",
        body: JSON.stringify({ expectedRevision, document }),
      });
      if (response.status !== 409 && !response.ok) {
        throw new Error(`Cloud chart write failed (${response.status})`);
      }
      return response.status === 409
        ? (response.json() as Promise<RevisionWriteResult<DrawingDocument>>)
        : {
            kind: "updated",
            resource: (await response.json()) as VersionedResource<DrawingDocument>,
          };
    },
  };
}
