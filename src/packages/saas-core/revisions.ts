import type {
  RevisionWrite,
  RevisionWriteResult,
  VersionedResource,
} from "./model.ts";

/** Pure optimistic-concurrency transition shared by API handlers and tests. */
export function applyRevisionWrite<T>(
  current: VersionedResource<T>,
  write: RevisionWrite<T>,
  now = new Date().toISOString(),
): RevisionWriteResult<T> {
  if (write.expectedRevision !== current.revision) {
    return {
      kind: "revision-conflict",
      expectedRevision: write.expectedRevision,
      current,
    };
  }
  return {
    kind: "updated",
    resource: {
      revision: current.revision + 1,
      updatedAt: now,
      value: write.value,
    },
  };
}
