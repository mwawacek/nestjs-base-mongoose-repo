import {
  ClientSession,
  FilterQuery,
  ProjectionType,
  QueryOptions,
  UpdateQuery,
  SortOrder,
  PopulateOptions,
  Require_id,
  FlattenMaps,
  Types,
} from 'mongoose';

// ─── Common Types ───────────────────────────────────────────────────────────
/** Accepted types for `_id` lookups — plain string or Mongoose ObjectId. */
export type DocumentId = string | Types.ObjectId;

// ─── Lean Document Type ─────────────────────────────────────────────────────
/**
 * Represents a lean (plain JS object) version of a Mongoose document.
 * Strips all Mongoose instance methods and keeps only the data shape.
 */
export type LeanDoc<T> = Require_id<FlattenMaps<T>>;

// ─── Pagination ─────────────────────────────────────────────────────────────
export interface PaginationOptions {
  /** Page number (1-based) */
  page: number;
  /** Number of items per page */
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

// ─── Query Options ──────────────────────────────────────────────────────────
export interface FindOptions<T> {
  filter?: FilterQuery<T>;
  projection?: ProjectionType<T>;
  sort?: Record<string, SortOrder>;
  skip?: number;
  limit?: number;
  populate?: PopulateOptions | PopulateOptions[];
  /** Bypass Mongoose pre-find hooks (e.g. soft-delete filters). */
  bypassPreHooks?: boolean;
  session?: ClientSession;
}

export interface FindOneOptions<T> {
  filter: FilterQuery<T>;
  projection?: ProjectionType<T>;
  populate?: PopulateOptions | PopulateOptions[];
  /** Bypass Mongoose pre-find hooks (e.g. soft-delete filters). */
  bypassPreHooks?: boolean;
}

export interface UpdateOptions<T> {
  filter: FilterQuery<T>;
  update: UpdateQuery<T>;
  options?: QueryOptions<T>;
}

// ─── Operation Results ──────────────────────────────────────────────────────
export interface DeleteResult {
  acknowledged: boolean;
  deletedCount: number;
}

export interface UpdateResult {
  acknowledged: boolean;
  modifiedCount: number;
  matchedCount: number;
  upsertedCount: number;
  upsertedId: string | null;
}

export interface BulkWriteResult {
  insertedCount: number;
  matchedCount: number;
  modifiedCount: number;
  deletedCount: number;
  upsertedCount: number;
}
