import { Model } from 'mongoose';
import { BaseMongoRepository } from './base-repository';

interface TestDoc {
  name: string;
}

class TestRepository extends BaseMongoRepository<TestDoc> {
  constructor(model: Model<TestDoc>) {
    super(model, 'TestDoc');
  }
}

function makeDuplicateKeyError(): Error & { code: number; keyPattern: Record<string, number> } {
  const err = new Error('E11000 duplicate key error') as Error & {
    code: number;
    keyPattern: Record<string, number>;
  };
  err.code = 11000;
  err.keyPattern = { name: 1 };
  return err;
}

function makeModelMock(): jest.Mocked<Pick<Model<TestDoc>, 'create' | 'insertMany' | 'bulkWrite'>> {
  return {
    create: jest.fn(),
    insertMany: jest.fn(),
    bulkWrite: jest.fn(),
  } as unknown as jest.Mocked<Pick<Model<TestDoc>, 'create' | 'insertMany' | 'bulkWrite'>>;
}

describe('BaseMongoRepository duplicate-key error handling', () => {
  let model: ReturnType<typeof makeModelMock>;
  let repo: TestRepository;

  beforeEach(() => {
    model = makeModelMock();
    repo = new TestRepository(model as unknown as Model<TestDoc>);
  });

  describe('createMany', () => {
    it('throws default ConflictException when no option is provided (regression guard)', async () => {
      (model.insertMany as jest.Mock).mockRejectedValueOnce(makeDuplicateKeyError());

      await expect(repo.createMany([{ name: 'a' }])).rejects.toMatchObject({
        response: {
          systemCode: 'duplicateKeyError',
          message: 'A resource with this name already exists',
        },
      });
    });

    it('uses custom systemCode and falls back to default message when message omitted', async () => {
      (model.insertMany as jest.Mock).mockRejectedValueOnce(makeDuplicateKeyError());

      await expect(
        repo.createMany([{ name: 'a' }], {
          duplicateKeyError: { systemCode: 'userGroupAlreadyExists' },
        }),
      ).rejects.toMatchObject({
        response: {
          systemCode: 'userGroupAlreadyExists',
          message: 'A resource with this name already exists',
        },
      });
    });

    it('uses both custom systemCode and custom message when provided', async () => {
      (model.insertMany as jest.Mock).mockRejectedValueOnce(makeDuplicateKeyError());

      await expect(
        repo.createMany([{ name: 'a' }], {
          duplicateKeyError: {
            systemCode: 'userGroupAlreadyExists',
            message: 'A user group with this name or extId already exists',
          },
        }),
      ).rejects.toMatchObject({
        response: {
          systemCode: 'userGroupAlreadyExists',
          message: 'A user group with this name or extId already exists',
        },
      });
    });

    it('rethrows non-E11000 errors untouched even when duplicateKeyError option is set', async () => {
      const other = new Error('some other failure');
      (model.insertMany as jest.Mock).mockRejectedValueOnce(other);

      await expect(
        repo.createMany([{ name: 'a' }], {
          duplicateKeyError: { systemCode: 'userGroupAlreadyExists' },
        }),
      ).rejects.toBe(other);
    });
  });

  describe('create', () => {
    it('uses custom systemCode on E11000', async () => {
      (model.create as jest.Mock).mockRejectedValueOnce(makeDuplicateKeyError());

      await expect(
        repo.create({ name: 'a' }, { duplicateKeyError: { systemCode: 'customCode' } }),
      ).rejects.toMatchObject({ response: { systemCode: 'customCode' } });
    });
  });

  describe('bulkWrite', () => {
    it('uses custom systemCode on E11000', async () => {
      (model.bulkWrite as jest.Mock).mockRejectedValueOnce(makeDuplicateKeyError());

      await expect(
        repo.bulkWrite([], { duplicateKeyError: { systemCode: 'bulkCustom' } }),
      ).rejects.toMatchObject({
        response: { systemCode: 'bulkCustom' },
      });
    });
  });
});
