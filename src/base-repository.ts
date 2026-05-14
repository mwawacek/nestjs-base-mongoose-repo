import mongoose, {
  Model,
  HydratedDocument,
  FilterQuery,
  UpdateQuery,
  QueryOptions,
  ClientSession,
  AggregateOptions,
  PipelineStage,
} from 'mongoose';
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import {
  LeanDoc,
  FindOptions,
  FindOneOptions,
  UpdateOptions,
  PaginatedResult,
  PaginationOptions,
  DeleteResult,
  UpdateResult,
  BulkWriteResult,
  DocumentId,
} from './base-repository.types';

/**
 * Opt-in override for how a repository maps MongoDB E11000 (duplicate-key)
 * errors to a `ConflictException`. When supplied, `systemCode` replaces the
 * default `'duplicateKeyError'`; `message` (if omitted) falls back to the
 * generic field-based message.
 */
export interface DuplicateKeyErrorOption {
  systemCode: string;
  message?: string;
}

/**
 * Abstract, generic BaseRepository for Mongoose + NestJS.
 *
 * Provides a full set of type-safe CRUD operations with both
 * **document** (full Mongoose instance) and **lean** (plain object) variants.
 *
 * @typeParam T - The plain schema interface (e.g. `User`, `Product`)
 *
 * @example
 * ```ts
 * @Injectable()
 * export class UserRepository extends BaseMongoRepository<User> {
 *   constructor(@InjectModel(User.name) model: Model<User>) {
 *     super(model, 'User');
 *   }
 * }
 * ```
 */
export abstract class BaseMongoRepository<T> {
  protected readonly logger: Logger;

  protected constructor(
    protected readonly model: Model<T>,
    protected readonly entityName: string,
  ) {
    this.logger = new Logger(`${entityName}Repository`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ERROR HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  /** Rethrows MongoDB duplicate-key errors (E11000) as NestJS ConflictException. */
  protected handleDuplicateKeyError(
    error: unknown,
    duplicateKeyError?: DuplicateKeyErrorOption,
  ): never {
    if (error instanceof Error && 'code' in error && (error as { code: number }).code === 11000) {
      const field = this.extractDuplicateField(error);
      this.logger.warn(`Duplicate ${field} in ${this.entityName}: ${error.message}`);

      const defaultMessage = `A resource with this ${field} already exists`;

      throw new ConflictException({
        systemCode: duplicateKeyError?.systemCode ?? 'duplicateKeyError',
        message: duplicateKeyError?.message ?? defaultMessage,
      });
    }
    throw error;
  }

  /** Extracts the duplicate field name from a MongoDB E11000 error. */
  private extractDuplicateField(error: Error): string {
    // MongoServerError (save/create/updateOne) has keyPattern directly
    const keyPattern = (error as { keyPattern?: Record<string, unknown> }).keyPattern;
    if (keyPattern) {
      const keys = Object.keys(keyPattern);
      return keys[keys.length - 1];
    }

    // MongoBulkWriteError (insertMany): parse from dup key in error message.
    // Anchor on segment start (^ or ,) so colons inside values (URLs, ISO
    // dates, etc.) don't get picked up as field names.
    const dupKeyMatch = error.message.match(/dup key: \{(.+)\}/)?.[1];
    if (dupKeyMatch) {
      const fields = [...dupKeyMatch.matchAll(/(?:^|,)\s*(\w+)\s*:/g)].map((m) => m[1]);
      return fields[fields.length - 1] ?? 'unknown';
    }

    return 'unknown';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CREATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Create and return a full Mongoose document (triggers save hooks). */
  async create(
    data: Partial<T>,
    options?: { session?: ClientSession; duplicateKeyError?: DuplicateKeyErrorOption },
  ): Promise<HydratedDocument<T>> {
    try {
      const [doc] = await this.model.create([data], { session: options?.session });
      return doc as HydratedDocument<T>;
    } catch (error) {
      this.handleDuplicateKeyError(error, options?.duplicateKeyError);
    }
  }

  /** Create and return a plain object (uses `.toObject()`). */
  async createPlain(
    data: Partial<T>,
    options?: { session?: ClientSession; duplicateKeyError?: DuplicateKeyErrorOption },
  ): Promise<LeanDoc<T>> {
    const doc = await this.create(data, options);
    return doc.toObject<LeanDoc<T>>();
  }

  /** Insert multiple documents in one operation. */
  async createMany(
    data: Partial<T>[],
    options?: { session?: ClientSession; duplicateKeyError?: DuplicateKeyErrorOption },
  ): Promise<HydratedDocument<T>[]> {
    try {
      const docs = await this.model.insertMany(data, {
        session: options?.session,
      });
      return docs as unknown as HydratedDocument<T>[];
    } catch (error) {
      this.handleDuplicateKeyError(error, options?.duplicateKeyError);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  READ — Full Documents (HydratedDocument<T>)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Find a document by its `_id`. Returns `null` if not found. */
  async findById(
    id: DocumentId,
    options?: {
      projection?: Record<string, unknown>;
      populate?: FindOneOptions<T>['populate'];
    },
  ): Promise<HydratedDocument<T> | null> {
    let query = this.model.findById(id, options?.projection);
    if (options?.populate) query = query.populate(options.populate);
    return query.exec();
  }

  /** Find a document by `_id` or throw `NotFoundException`. */
  async findByIdOrFail(
    id: DocumentId,
    options?: {
      projection?: Record<string, unknown>;
      populate?: FindOneOptions<T>['populate'];
    },
  ): Promise<HydratedDocument<T>> {
    const doc = await this.findById(id, options);
    if (!doc) {
      throw new NotFoundException(
        `${this.entityName} with id "${id}" not found`,
      );
    }
    return doc;
  }

  /** Find a single document matching the filter. */
  async findOne(opts: FindOneOptions<T>): Promise<HydratedDocument<T> | null> {
    let query = this.model.findOne(opts.filter, opts.projection);
    if (opts.bypassPreHooks) query = query.setOptions({ bypassPreHooks: true });
    if (opts.populate) query = query.populate(opts.populate);
    return query.exec();
  }

  /** Find a single document or throw `NotFoundException`. */
  async findOneOrFail(opts: FindOneOptions<T>): Promise<HydratedDocument<T>> {
    const doc = await this.findOne(opts);
    if (!doc) {
      throw new NotFoundException(`${this.entityName} not found`);
    }
    return doc;
  }

  /** Find multiple documents with optional sort, skip, limit, populate. */
  async find(opts: FindOptions<T> = {}): Promise<HydratedDocument<T>[]> {
    let query = this.model.find(opts.filter ?? {}, opts.projection);
    if (opts.bypassPreHooks) query = query.setOptions({ bypassPreHooks: true });
    if (opts.sort) query = query.sort(opts.sort);
    if (opts.skip != null) query = query.skip(opts.skip);
    if (opts.limit != null) query = query.limit(opts.limit);
    if (opts.populate) query = query.populate(opts.populate);
    return query.exec();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  READ — Lean (LeanDoc<T> — plain JS objects, no Mongoose overhead)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Find by `_id` and return a lean plain object. */
  async findByIdLean(
    id: DocumentId,
    options?: {
      projection?: Record<string, unknown>;
      populate?: FindOneOptions<T>['populate'];
    },
  ): Promise<LeanDoc<T> | null> {
    let query = this.model
      .findById(id, options?.projection)
      .lean<LeanDoc<T>>();
    if (options?.populate)
      query = query.populate(options.populate) as typeof query;
    return query.exec();
  }

  /** Find by `_id` lean or throw `NotFoundException`. */
  async findByIdLeanOrFail(
    id: DocumentId,
    options?: {
      projection?: Record<string, unknown>;
      populate?: FindOneOptions<T>['populate'];
    },
  ): Promise<LeanDoc<T>> {
    const doc = await this.findByIdLean(id, options);
    if (!doc) {
      throw new NotFoundException(
        `${this.entityName} with id "${id}" not found`,
      );
    }
    return doc;
  }

  /** Find one lean document matching the filter. */
  async findOneLean(opts: FindOneOptions<T>): Promise<LeanDoc<T> | null> {
    let query = this.model.findOne(opts.filter, opts.projection).lean<LeanDoc<T>>();
    if (opts.bypassPreHooks) query = query.setOptions({ bypassPreHooks: true }) as typeof query;
    if (opts.populate) query = query.populate(opts.populate) as typeof query;
    return query.exec();
  }

  /** Find one lean document or throw `NotFoundException`. */
  async findOneLeanOrFail(opts: FindOneOptions<T>): Promise<LeanDoc<T>> {
    const doc = await this.findOneLean(opts);
    if (!doc) {
      throw new NotFoundException(`${this.entityName} not found`);
    }
    return doc;
  }

  /** Find multiple lean documents. */
  async findLean(opts: FindOptions<T> = {}): Promise<LeanDoc<T>[]> {
    let query = this.model.find(opts.filter ?? {}, opts.projection).lean<LeanDoc<T>[]>();
    if (opts.bypassPreHooks) query = query.setOptions({ bypassPreHooks: true }) as typeof query;
    if (opts.session) query = query.session(opts.session) as typeof query;
    if (opts.sort) query = query.sort(opts.sort) as typeof query;
    if (opts.skip != null) query = query.skip(opts.skip) as typeof query;
    if (opts.limit != null) query = query.limit(opts.limit) as typeof query;
    if (opts.populate) query = query.populate(opts.populate) as typeof query;
    return query.exec();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PAGINATION (always lean — pagination is for reading)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Paginate results. Always returns lean objects. */
  async paginate(
    pagination: PaginationOptions,
    opts: Omit<FindOptions<T>, 'skip' | 'limit'> = {},
  ): Promise<PaginatedResult<LeanDoc<T>>> {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;
    const filter = opts.filter ?? {};

    const [data, total] = await Promise.all([
      this.findLean({ ...opts, skip, limit }),
      this.model.countDocuments(filter).exec(),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  UPDATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Find by `_id`, update, and return the updated document. */
  async findByIdAndUpdate(
    id: DocumentId,
    update: UpdateQuery<T>,
    options?: QueryOptions<T>,
  ): Promise<HydratedDocument<T> | null> {
    return this.model
      .findByIdAndUpdate(id, update, { new: true, ...options })
      .exec();
  }

  /** Find by `_id`, update, and return a lean object. */
  async findByIdAndUpdateLean(
    id: DocumentId,
    update: UpdateQuery<T>,
    options?: QueryOptions<T>,
  ): Promise<LeanDoc<T> | null> {
    return this.model
      .findByIdAndUpdate(id, update, { new: true, ...options })
      .lean<LeanDoc<T>>()
      .exec();
  }

  /** Find one by filter, update, and return the updated document. */
  async findOneAndUpdate(
    opts: UpdateOptions<T>,
  ): Promise<HydratedDocument<T> | null> {
    return this.model
      .findOneAndUpdate(opts.filter, opts.update, {
        new: true,
        ...opts.options,
      })
      .exec();
  }

  /** Find one by filter, update, and return a lean object. */
  async findOneAndUpdateLean(
    opts: UpdateOptions<T>,
  ): Promise<LeanDoc<T> | null> {
    return this.model
      .findOneAndUpdate(opts.filter, opts.update, {
        new: true,
        ...opts.options,
      })
      .lean<LeanDoc<T>>()
      .exec();
  }

  /** Update all documents matching the filter. */
  async updateMany(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
    options?: mongoose.mongo.UpdateOptions,
  ): Promise<UpdateResult> {
    const result = await this.model
      .updateMany(filter, update, options)
      .exec();
    return {
      acknowledged: result.acknowledged,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
      upsertedCount: result.upsertedCount,
      upsertedId: result.upsertedId?.toString() ?? null,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  UPSERT
  // ═══════════════════════════════════════════════════════════════════════════

  /** Find one and update, or insert if not found. Returns document. */
  async upsert(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
    options?: QueryOptions<T>,
  ): Promise<HydratedDocument<T>> {
    const doc = await this.model
      .findOneAndUpdate(filter, update, {
        new: true,
        upsert: true,
        ...options,
      })
      .exec();
    return doc as HydratedDocument<T>;
  }

  /** Find one and update, or insert if not found. Returns lean object. */
  async upsertLean(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
    options?: QueryOptions<T>,
  ): Promise<LeanDoc<T>> {
    const doc = await this.model
      .findOneAndUpdate(filter, update, {
        new: true,
        upsert: true,
        lean: true,
        ...options,
      })
      .lean<LeanDoc<T>>()
      .exec();
    return doc as LeanDoc<T>;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DELETE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Delete a document by `_id`. Returns the deleted document or `null`. */
  async findByIdAndDelete(
    id: DocumentId,
  ): Promise<HydratedDocument<T> | null> {
    return this.model.findByIdAndDelete(id).exec();
  }

  /** Delete the first document matching the filter. */
  async findOneAndDelete(
    filter: FilterQuery<T>,
  ): Promise<HydratedDocument<T> | null> {
    return this.model.findOneAndDelete(filter).exec();
  }

  /** Delete all documents matching the filter. */
  async deleteMany(
    filter: FilterQuery<T>,
    options?: { session?: ClientSession },
  ): Promise<DeleteResult> {
    return this.model.deleteMany(filter, options).exec();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  AGGREGATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Run a typed aggregation pipeline.
   * @typeParam R - Expected shape of each result document.
   */
  async aggregate<R = unknown>(
    pipeline: PipelineStage[],
    options?: AggregateOptions,
  ): Promise<R[]> {
    return this.model.aggregate<R>(pipeline, options).exec();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  COUNT & EXISTS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Count documents matching the filter. */
  async count(filter: FilterQuery<T> = {}): Promise<number> {
    return this.model.countDocuments(filter).exec();
  }

  /** Estimated total document count (uses collection metadata, very fast). */
  async estimatedCount(): Promise<number> {
    return this.model.estimatedDocumentCount().exec();
  }

  /** Check if at least one document matches the filter. */
  async exists(filter: FilterQuery<T>): Promise<boolean> {
    const result = await this.model.exists(filter).exec();
    return result !== null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DISTINCT
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get distinct values for a field. */
  async distinct<R = unknown>(
    field: string,
    filter?: FilterQuery<T>,
  ): Promise<R[]> {
    return this.model.distinct(field, filter).exec() as Promise<R[]>;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  BULK OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Execute multiple write operations in a single command. */
  async bulkWrite(
    operations: Parameters<Model<T>['bulkWrite']>[0],
    options?: { session?: ClientSession; duplicateKeyError?: DuplicateKeyErrorOption },
  ): Promise<BulkWriteResult> {
    try {
      const result = await this.model.bulkWrite(operations, {
        session: options?.session,
      });
      return {
        insertedCount: result.insertedCount,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        deletedCount: result.deletedCount,
        upsertedCount: result.upsertedCount,
      };
    } catch (error) {
      this.handleDuplicateKeyError(error, options?.duplicateKeyError);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  TRANSACTION HELPER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a callback within a MongoDB transaction.
   * Automatically starts a session, commits on success, aborts on error.
   *
   * @example
   * ```ts
   * await userRepo.withTransaction(async (session) => {
   *   await userRepo.create({ name: 'Alice' }, { session });
   *   await walletRepo.create({ userId: '...', balance: 0 }, { session });
   * });
   * ```
   */
  async withTransaction<R>(
    fn: (session: ClientSession) => Promise<R>,
  ): Promise<R> {
    const session = await this.model.db.startSession();
    try {
      let result: R;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result!;
    } finally {
      await session.endSession();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  MODEL ACCESS (escape hatch)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Access the underlying Mongoose model directly for edge cases. */
  getModel(): Model<T> {
    return this.model;
  }
}
