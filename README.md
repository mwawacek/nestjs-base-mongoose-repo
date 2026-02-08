# nestjs-base-mongoose-repo

A **type-safe**, **generic** BaseRepository for **NestJS + Mongoose** with first-class support for both full Mongoose documents and lean (plain object) queries.

## Features

- 🔒 **Fully type-safe** — generics propagate through every method
- ⚡ **Document vs. Lean** — every read method has a `*Lean` variant returning plain JS objects
- 📄 **Pagination** built in with `PaginatedResult<T>`
- 🔄 **Transaction helper** — `withTransaction()` manages sessions automatically
- 🛡️ **OrFail variants** — throw `NotFoundException` automatically
- 📊 **Typed aggregation** — `aggregate<R>()` with custom return types
- 🔌 **Escape hatch** — `getModel()` for direct Mongoose access
- 🚫 **Duplicate key handling** — auto-throws `ConflictException` (409) on unique constraint violations

## Installation

```bash
npm install nestjs-base-mongoose-repo
```

### Peer Dependencies

```bash
npm install @nestjs/common @nestjs/mongoose mongoose
```

## Quick Start

### 1. Define your Schema

```ts
// user.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
```

### 2. Create your Repository

```ts
// user.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseRepository } from 'nestjs-base-mongoose-repo';
import { User } from './user.schema';

@Injectable()
export class UserRepository extends BaseRepository<User> {
  constructor(@InjectModel(User.name) model: Model<User>) {
    super(model, 'User');
  }

  // Add domain-specific methods here
  async findByEmail(email: string) {
    return this.findOneLean({ filter: { email } });
  }
}
```

### 3. Use in your Service

```ts
// user.service.ts
import { Injectable } from '@nestjs/common';
import { UserRepository } from './user.repository';

@Injectable()
export class UserService {
  constructor(private readonly users: UserRepository) {}

  // Lean — for read-only API responses (fast)
  async getProfile(id: string) {
    return this.users.findByIdLeanOrFail(id, {
      projection: { name: 1, email: 1 },
    });
  }

  // Full document — when you need .save() or hooks
  async deactivate(id: string) {
    const user = await this.users.findByIdOrFail(id);
    user.isActive = false;
    return user.save();
  }

  // Pagination
  async list(page: number, limit: number) {
    return this.users.paginate(
      { page, limit },
      { filter: { isActive: true }, sort: { createdAt: -1 } },
    );
  }
}
```

### 4. Wire up the Module

```ts
// user.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './user.schema';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  providers: [UserRepository, UserService],
  exports: [UserService, UserRepository],
})
export class UserModule {}
```

## API Reference

### Create

| Method | Returns | Description |
|--------|---------|-------------|
| `create(data, options?)` | `HydratedDocument<T>` | Create with save hooks |
| `createLean(data, options?)` | `LeanDoc<T>` | Create and return plain object |
| `createMany(data, options?)` | `HydratedDocument<T>[]` | Bulk insert |

### Read — Documents

| Method | Returns | Description |
|--------|---------|-------------|
| `findById(id, options?)` | `HydratedDocument<T> \| null` | Find by `_id` |
| `findByIdOrFail(id, options?)` | `HydratedDocument<T>` | Find or throw |
| `findOne(opts)` | `HydratedDocument<T> \| null` | Find one by filter |
| `findOneOrFail(opts)` | `HydratedDocument<T>` | Find one or throw |
| `find(opts?)` | `HydratedDocument<T>[]` | Find many |

### Read — Lean

| Method | Returns | Description |
|--------|---------|-------------|
| `findByIdLean(id, options?)` | `LeanDoc<T> \| null` | Lean find by `_id` |
| `findByIdLeanOrFail(id, options?)` | `LeanDoc<T>` | Lean find or throw |
| `findOneLean(opts)` | `LeanDoc<T> \| null` | Lean find one |
| `findOneLeanOrFail(opts)` | `LeanDoc<T>` | Lean find one or throw |
| `findLean(opts?)` | `LeanDoc<T>[]` | Lean find many |

### Pagination

| Method | Returns | Description |
|--------|---------|-------------|
| `paginate(pagination, opts?)` | `PaginatedResult<LeanDoc<T>>` | Paginated lean results |

### Update

| Method | Returns | Description |
|--------|---------|-------------|
| `findByIdAndUpdate(id, update, options?)` | `HydratedDocument<T> \| null` | Update by `_id` |
| `findByIdAndUpdateLean(id, update, options?)` | `LeanDoc<T> \| null` | Update, return lean |
| `findOneAndUpdate(opts)` | `HydratedDocument<T> \| null` | Update by filter |
| `findOneAndUpdateLean(opts)` | `LeanDoc<T> \| null` | Update by filter, lean |
| `updateMany(filter, update, options?)` | `UpdateResult` | Update many |
| `upsert(filter, update, options?)` | `HydratedDocument<T>` | Update or insert |
| `upsertLean(filter, update, options?)` | `LeanDoc<T>` | Upsert, return lean |

### Delete

| Method | Returns | Description |
|--------|---------|-------------|
| `findByIdAndDelete(id)` | `HydratedDocument<T> \| null` | Delete by `_id` |
| `findOneAndDelete(filter)` | `HydratedDocument<T> \| null` | Delete by filter |
| `deleteMany(filter)` | `DeleteResult` | Delete many |

### Aggregation, Count & Utilities

| Method | Returns | Description |
|--------|---------|-------------|
| `aggregate<R>(pipeline, options?)` | `R[]` | Typed aggregation |
| `count(filter?)` | `number` | Count documents |
| `estimatedCount()` | `number` | Fast estimated count |
| `exists(filter)` | `boolean` | Check existence |
| `distinct<R>(field, filter?)` | `R[]` | Distinct values |
| `bulkWrite(ops, options?)` | `BulkWriteResult` | Bulk operations |
| `withTransaction(fn)` | `R` | Transaction wrapper |
| `getModel()` | `Model<T>` | Escape hatch |

## Error Handling

### Duplicate Key (E11000)

`create()` and `createMany()` automatically catch MongoDB duplicate key errors and throw a NestJS `ConflictException` (HTTP 409) with the offending field name:

```json
{
  "statusCode": 409,
  "message": "User with duplicate \"email\" already exists"
}
```

You can override `handleDuplicateKeyError()` in your repository for custom messages:

```ts
@Injectable()
export class UserRepository extends BaseRepository<User> {
  constructor(@InjectModel(User.name) model: Model<User>) {
    super(model, 'User');
  }

  protected handleDuplicateKeyError(error: unknown): never {
    // Custom message for email duplicates
    super.handleDuplicateKeyError(error);
  }
}
```

## When to use Document vs. Lean

| Use Case | Method | Why |
|----------|--------|-----|
| API response (read-only) | `*Lean` | ~3x faster, less memory |
| Need `.save()` with hooks | Document | Triggers pre/post middleware |
| Need virtuals/methods | Document | Lean strips instance methods |
| Pagination / lists | `paginate()` | Always lean (read-only) |
| Write-then-read | `createLean()` | One operation, plain result |

## License

MIT
