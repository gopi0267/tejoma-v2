/**
 * Storage abstraction for permanent resume files (Batch 18 domain audit's "File Service" finding:
 * uploads are 100% local disk today, with no existing service boundary - a real blocker for
 * running multiple Kubernetes pods, since a pod-local disk isn't shared or durable across
 * replicas/restarts).
 *
 * This interface exists so that blocker has exactly one place to be resolved later (a real S3
 * adapter, once real AWS infrastructure exists - see MIGRATION_RUNBOOK.md) without touching any
 * calling code. Only LocalDiskStorageAdapter is implemented here - it preserves today's exact
 * behavior and limitation (single-instance local disk), matching what the monolith already does;
 * no S3 adapter is stubbed out, since an untested stub would be exactly the kind of placeholder
 * this migration's own rules forbid. `storageKey` returned by `store()` is the same relative path
 * string the monolith already writes into candidate_accounts.resume_file_path today, so switching
 * adapters later never requires a data migration for already-stored keys' shape.
 */
export interface StorageAdapter {
  /** Moves a temp upload into permanent storage. Returns an opaque storage key (LocalDiskStorageAdapter's is a relative path, same shape already stored in candidate_accounts.resume_file_path). */
  store(tempFilePath: string, candidateId: number, originalFilename: string): Promise<string>;
  /** Deletes a previously-stored file. No-op if it doesn't exist - never throws for a missing file. */
  delete(storageKey: string): Promise<void>;
  /** True if a file exists for this storage key. */
  exists(storageKey: string): boolean;
  /** Resolves a storage key to an absolute filesystem path, for streaming a download response. */
  resolveForDownload(storageKey: string): string;
}
