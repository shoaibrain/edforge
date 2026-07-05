/**
 * FamiliesService Spec — EPIC-FB Sprint FB-1.3 / FB-1.4 / FB-1.5
 *
 * Focus areas:
 *   - Tenant/school scoping of EVERY query (FB-1.3 AC)
 *   - P1d: response DTOs never include `isActive`
 *   - Single-family invariant: 409 on second family; stale links to
 *     deactivated families don't count
 *   - Conditional-write ConditionalCheckFailedException → 409
 *   - Unlink idempotency
 *   - Student family view: linked / unlinked / deactivated-family /
 *     withdrawn-sibling; exactly ONE batch get for sibling grade levels
 *
 * DDB client is mocked (promotion-rules spec idiom).
 */

import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FamiliesService } from './families.service';
import type { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import {
  FamilyEntity,
  FamilyMemberEntity,
  createFamilyEntity,
  createFamilyMemberEntity,
} from '../common/entities/family.entity';
import { EntityKeyBuilder, RequestContext } from '../common/entities/base.entity';

const TENANT  = '11111111-1111-1111-1111-111111111111';
const SCHOOL  = '22222222-2222-2222-2222-222222222222';
const OTHER_SCHOOL = '99999999-9999-9999-9999-999999999999';
const FAMILY  = '33333333-3333-3333-3333-333333333333';
const OTHER_FAMILY = '55555555-5555-5555-5555-555555555555';
const STUDENT = '44444444-4444-4444-4444-444444444444';
const SIBLING = '66666666-6666-6666-6666-666666666666';
const USER    = 'user-uuid';

const ctx: RequestContext = {
  userId: USER,
  tenantId: TENANT,
  email: 'op@example.com',
  role: 'TenantAdmin',
  jwtToken: 'jwt',
};

function makeFamily(overrides: Partial<FamilyEntity> = {}): FamilyEntity {
  return {
    ...createFamilyEntity(TENANT, FAMILY, SCHOOL, {
      name: 'Adhikari family',
      primaryContact: { name: 'Ram Adhikari' },
      createdBy: USER,
    }),
    ...overrides,
  };
}

function makeMember(overrides: Partial<FamilyMemberEntity> = {}): FamilyMemberEntity {
  return {
    ...createFamilyMemberEntity(TENANT, FAMILY, STUDENT, {
      studentName: 'Sita Adhikari',
      addedBy: USER,
    }),
    ...overrides,
  };
}

interface StudentRow {
  studentId: string;
  firstName: string;
  lastName: string;
  primarySchoolId: string;
  currentGradeLevel?: string;
  status?: string;
}

function makeStudent(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    studentId: STUDENT,
    firstName: 'Sita',
    lastName: 'Adhikari',
    primarySchoolId: SCHOOL,
    currentGradeLevel: '7',
    status: 'active',
    ...overrides,
  };
}

type AnyArgs = unknown[];
type Paged<T> = { items: T[]; hasMore: boolean; lastEvaluatedKey?: string };

interface MockDdb {
  getClient: jest.Mock<(...args: AnyArgs) => Promise<unknown>>;
  getTableName: jest.Mock<() => string>;
  putItem: jest.Mock<(...args: AnyArgs) => Promise<void>>;
  getItem: jest.Mock<(...args: AnyArgs) => Promise<unknown>>;
  query: jest.Mock<(...args: AnyArgs) => Promise<Paged<unknown>>>;
  queryGSIFilled: jest.Mock<(...args: AnyArgs) => Promise<Paged<unknown>>>;
  queryGSI2: jest.Mock<(...args: AnyArgs) => Promise<Paged<unknown>>>;
  batchGetItems: jest.Mock<(...args: AnyArgs) => Promise<unknown[]>>;
  updateItem: jest.Mock<(...args: AnyArgs) => Promise<unknown>>;
  deleteItem: jest.Mock<(...args: AnyArgs) => Promise<void>>;
}

function makeMockDdb(): MockDdb {
  return {
    getClient: jest.fn<(...args: AnyArgs) => Promise<unknown>>().mockResolvedValue({}),
    getTableName: jest.fn<() => string>().mockReturnValue('edforge-academics-test'),
    putItem: jest.fn<(...args: AnyArgs) => Promise<void>>().mockResolvedValue(undefined),
    getItem: jest.fn<(...args: AnyArgs) => Promise<unknown>>().mockResolvedValue(null),
    query: jest
      .fn<(...args: AnyArgs) => Promise<Paged<unknown>>>()
      .mockResolvedValue({ items: [], hasMore: false }),
    queryGSIFilled: jest
      .fn<(...args: AnyArgs) => Promise<Paged<unknown>>>()
      .mockResolvedValue({ items: [], hasMore: false }),
    queryGSI2: jest
      .fn<(...args: AnyArgs) => Promise<Paged<unknown>>>()
      .mockResolvedValue({ items: [], hasMore: false }),
    batchGetItems: jest
      .fn<(...args: AnyArgs) => Promise<unknown[]>>()
      .mockResolvedValue([]),
    updateItem: jest.fn<(...args: AnyArgs) => Promise<unknown>>(),
    deleteItem: jest.fn<(...args: AnyArgs) => Promise<void>>().mockResolvedValue(undefined),
  };
}

/** Route getItem by entityKey so multi-get flows read like fixtures. */
function stubGetItemByKey(ddb: MockDdb, rows: Record<string, unknown>): void {
  ddb.getItem.mockImplementation((...args: AnyArgs) => {
    const entityKey = args[2] as string;
    return Promise.resolve(rows[entityKey] ?? null);
  });
}

function makeService(): { service: FamiliesService; ddb: MockDdb } {
  const ddb = makeMockDdb();
  const service = new FamiliesService(ddb as unknown as DynamoDBClientService);
  return { service, ddb };
}

describe('FamiliesService — FB-1.3 CRUD', () => {
  let service: FamiliesService;
  let ddb: MockDdb;

  beforeEach(() => {
    ({ service, ddb } = makeService());
  });

  describe('createFamily', () => {
    it('puts a correctly keyed entity with attribute_not_exists', async () => {
      await service.createFamily(
        SCHOOL,
        { schoolId: SCHOOL, name: 'Adhikari family', primaryContact: { name: 'Ram Adhikari' } },
        ctx,
      );

      expect(ddb.putItem).toHaveBeenCalledTimes(1);
      const [, item, condition] = ddb.putItem.mock.calls[0] as [unknown, FamilyEntity, string];
      expect(item.tenantId).toBe(TENANT);
      expect(item.entityKey).toMatch(/^FAMILY#/);
      expect(item.schoolId).toBe(SCHOOL);
      expect(item.gsi1pk).toBe(`TENANT#${TENANT}#SCHOOL#${SCHOOL}`);
      expect(item.gsi1sk).toBe('FAMILY#ADHIKARI FAMILY');
      expect(item.isActive).toBe(true);
      expect(condition).toBe('attribute_not_exists(entityKey)');
    });

    it('P1d: response DTO does not include isActive', async () => {
      const dto = await service.createFamily(
        SCHOOL,
        { schoolId: SCHOOL, name: 'Adhikari family', primaryContact: { name: 'Ram Adhikari' } },
        ctx,
      );
      expect(dto).not.toHaveProperty('isActive');
      expect(dto.name).toBe('Adhikari family');
      expect(dto.schoolId).toBe(SCHOOL);
      expect(dto.id).toBeDefined();
    });

    it('scopes the tenant client to the request tenant', async () => {
      await service.createFamily(
        SCHOOL,
        { schoolId: SCHOOL, name: 'F', primaryContact: { name: 'C' } },
        ctx,
      );
      expect(ddb.getClient).toHaveBeenCalledWith(TENANT, 'jwt');
    });
  });

  describe('getFamily', () => {
    it('returns the DTO for an active family (no isActive leak)', async () => {
      stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });
      const dto = await service.getFamily(FAMILY, SCHOOL, ctx);
      expect(dto.id).toBe(FAMILY);
      expect(dto).not.toHaveProperty('isActive');
      expect(ddb.getItem).toHaveBeenCalledWith({}, TENANT, EntityKeyBuilder.family(FAMILY));
    });

    it('404 on missing family', async () => {
      await expect(service.getFamily(FAMILY, SCHOOL, ctx)).rejects.toThrow(NotFoundException);
    });

    it('404 on deactivated family (excluded from reads)', async () => {
      stubGetItemByKey(ddb, {
        [EntityKeyBuilder.family(FAMILY)]: makeFamily({ isActive: false }),
      });
      await expect(service.getFamily(FAMILY, SCHOOL, ctx)).rejects.toThrow(NotFoundException);
    });

    it('404 on wrong-school family (no cross-school leak)', async () => {
      stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });
      await expect(service.getFamily(FAMILY, OTHER_SCHOOL, ctx)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listFamilies', () => {
    it('queries GSI1 with the tenant+school partition and FAMILY# prefix + isActive filter', async () => {
      ddb.queryGSIFilled.mockResolvedValue({ items: [makeFamily()], hasMore: false });

      const result = await service.listFamilies(SCHOOL, {}, ctx);

      expect(ddb.queryGSIFilled).toHaveBeenCalledTimes(1);
      const [, index, pk, sk, op, filter, values] = ddb.queryGSIFilled.mock.calls[0] as [
        unknown, string, string, string, string, string, Record<string, unknown>,
      ];
      expect(index).toBe('GSI1');
      expect(pk).toBe(`TENANT#${TENANT}#SCHOOL#${SCHOOL}`);
      expect(sk).toBe('FAMILY#');
      expect(op).toBe('begins_with');
      expect(filter).toBe('isActive = :isActive');
      expect(values).toEqual({ ':isActive': true });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).not.toHaveProperty('isActive');
    });

    it('uppercases the name-prefix filter into the sort key', async () => {
      await service.listFamilies(SCHOOL, { namePrefix: 'adh' }, ctx);
      const [, , , sk] = ddb.queryGSIFilled.mock.calls[0] as [unknown, string, string, string];
      expect(sk).toBe('FAMILY#ADH');
    });

    it('rejects an undecodable cursor with 400', async () => {
      await expect(
        service.listFamilies(SCHOOL, { cursor: '!!!not-base64-json!!!' }, ctx),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateFamily', () => {
    it('re-keys gsi1sk when name changes and guards on version', async () => {
      stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });
      ddb.updateItem.mockResolvedValue(makeFamily({ name: 'Shrestha family' }));

      await service.updateFamily(FAMILY, SCHOOL, { name: 'Shrestha family' }, ctx);

      const [, tenantId, entityKey, updateExpr, values, condition, names] =
        ddb.updateItem.mock.calls[0] as [
          unknown, string, string, string, Record<string, unknown>, string, Record<string, string>,
        ];
      expect(tenantId).toBe(TENANT);
      expect(entityKey).toBe(EntityKeyBuilder.family(FAMILY));
      expect(updateExpr).toContain('#name = :name');
      expect(updateExpr).toContain('gsi1sk = :gsi1sk');
      expect(values[':gsi1sk']).toBe('FAMILY#SHRESTHA FAMILY');
      expect(values[':currentVersion']).toBe(1);
      expect(condition).toBe('version = :currentVersion');
      expect(names).toEqual({ '#name': 'name' });
    });

    it('P1d: update response omits isActive', async () => {
      stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });
      ddb.updateItem.mockResolvedValue(makeFamily({ notes: 'x' }));
      const dto = await service.updateFamily(FAMILY, SCHOOL, { notes: 'x' }, ctx);
      expect(dto).not.toHaveProperty('isActive');
    });

    it('400 on empty update body', async () => {
      await expect(service.updateFamily(FAMILY, SCHOOL, {}, ctx)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('404 when updating a deactivated family', async () => {
      stubGetItemByKey(ddb, {
        [EntityKeyBuilder.family(FAMILY)]: makeFamily({ isActive: false }),
      });
      await expect(
        service.updateFamily(FAMILY, SCHOOL, { notes: 'x' }, ctx),
      ).rejects.toThrow(NotFoundException);
    });

    it('review F5 — maps ConditionalCheckFailedException (lost version race) to 409', async () => {
      stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });
      const err = new Error('The conditional request failed');
      err.name = 'ConditionalCheckFailedException';
      ddb.updateItem.mockRejectedValue(err);

      await expect(
        service.updateFamily(FAMILY, SCHOOL, { notes: 'x' }, ctx),
      ).rejects.toThrow(
        new ConflictException('Family was modified concurrently; refresh and retry'),
      );
    });

    it('review F5 — rethrows non-conditional update failures untouched', async () => {
      stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });
      ddb.updateItem.mockRejectedValue(new Error('ProvisionedThroughputExceeded'));

      await expect(
        service.updateFamily(FAMILY, SCHOOL, { notes: 'x' }, ctx),
      ).rejects.toThrow('ProvisionedThroughputExceeded');
    });
  });

  describe('deactivateFamily', () => {
    it('flips isActive=false with a version guard', async () => {
      stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });
      ddb.updateItem.mockResolvedValue(makeFamily({ isActive: false }));

      await service.deactivateFamily(FAMILY, SCHOOL, ctx);

      const [, tenantId, entityKey, updateExpr, values, condition] =
        ddb.updateItem.mock.calls[0] as [
          unknown, string, string, string, Record<string, unknown>, string,
        ];
      expect(tenantId).toBe(TENANT);
      expect(entityKey).toBe(EntityKeyBuilder.family(FAMILY));
      expect(updateExpr).toContain('isActive = :isActive');
      expect(values[':isActive']).toBe(false);
      expect(condition).toBe('version = :currentVersion');
    });

    it('is idempotent: second deactivate is a no-op (no write)', async () => {
      stubGetItemByKey(ddb, {
        [EntityKeyBuilder.family(FAMILY)]: makeFamily({ isActive: false }),
      });
      await service.deactivateFamily(FAMILY, SCHOOL, ctx);
      expect(ddb.updateItem).not.toHaveBeenCalled();
    });

    it('404 on wrong-school family', async () => {
      stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });
      await expect(service.deactivateFamily(FAMILY, OTHER_SCHOOL, ctx)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('review F5 — maps ConditionalCheckFailedException (lost version race) to 409', async () => {
      stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });
      const err = new Error('The conditional request failed');
      err.name = 'ConditionalCheckFailedException';
      ddb.updateItem.mockRejectedValue(err);

      await expect(service.deactivateFamily(FAMILY, SCHOOL, ctx)).rejects.toThrow(
        new ConflictException('Family was modified concurrently; refresh and retry'),
      );
    });

    it('review F5 — rethrows non-conditional deactivate failures untouched', async () => {
      stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });
      ddb.updateItem.mockRejectedValue(new Error('ProvisionedThroughputExceeded'));

      await expect(service.deactivateFamily(FAMILY, SCHOOL, ctx)).rejects.toThrow(
        'ProvisionedThroughputExceeded',
      );
    });
  });
});

describe('FamiliesService — FB-1.4 link/unlink', () => {
  let service: FamiliesService;
  let ddb: MockDdb;

  beforeEach(() => {
    ({ service, ddb } = makeService());
  });

  describe('addMember', () => {
    it('links a student: GSI2 pre-check on bare studentId, conditional put, denormalized name', async () => {
      stubGetItemByKey(ddb, {
        [EntityKeyBuilder.family(FAMILY)]: makeFamily(),
        [EntityKeyBuilder.student(STUDENT)]: makeStudent(),
      });

      const dto = await service.addMember(FAMILY, SCHOOL, { studentId: STUDENT }, ctx);

      // Pre-check hits GSI2 with the BARE studentId (epic §4.5 convention).
      expect(ddb.queryGSI2).toHaveBeenCalledWith({}, STUDENT, 'FAMILY#', 'begins_with');

      expect(ddb.putItem).toHaveBeenCalledTimes(1);
      const [, item, condition] = ddb.putItem.mock.calls[0] as [
        unknown, FamilyMemberEntity, string,
      ];
      expect(item.entityKey).toBe(`FAMILY_MEMBER#${FAMILY}#${STUDENT}`);
      expect(item.gsi2pk).toBe(STUDENT);
      expect(item.gsi2sk).toBe(`FAMILY#${FAMILY}`);
      expect(item.studentName).toBe('Sita Adhikari');
      expect(condition).toBe('attribute_not_exists(entityKey)');

      expect(dto.familyId).toBe(FAMILY);
      expect(dto.studentId).toBe(STUDENT);
      expect(dto.studentName).toBe('Sita Adhikari');
      expect(dto.addedBy).toBe(USER);
    });

    it('409 when the student already belongs to a live family', async () => {
      stubGetItemByKey(ddb, {
        [EntityKeyBuilder.family(FAMILY)]: makeFamily(),
        [EntityKeyBuilder.family(OTHER_FAMILY)]: makeFamily({
          familyId: OTHER_FAMILY,
          entityKey: EntityKeyBuilder.family(OTHER_FAMILY),
        }),
        [EntityKeyBuilder.student(STUDENT)]: makeStudent(),
      });
      ddb.queryGSI2.mockResolvedValue({
        items: [makeMember({ familyId: OTHER_FAMILY })],
        hasMore: false,
      });

      await expect(
        service.addMember(FAMILY, SCHOOL, { studentId: STUDENT }, ctx),
      ).rejects.toThrow(ConflictException);
      expect(ddb.putItem).not.toHaveBeenCalled();
    });

    it('allows linking when the only existing member row points at a DEACTIVATED family', async () => {
      stubGetItemByKey(ddb, {
        [EntityKeyBuilder.family(FAMILY)]: makeFamily(),
        [EntityKeyBuilder.family(OTHER_FAMILY)]: makeFamily({
          familyId: OTHER_FAMILY,
          entityKey: EntityKeyBuilder.family(OTHER_FAMILY),
          isActive: false,
        }),
        [EntityKeyBuilder.student(STUDENT)]: makeStudent(),
      });
      ddb.queryGSI2.mockResolvedValue({
        items: [makeMember({ familyId: OTHER_FAMILY })],
        hasMore: false,
      });

      const dto = await service.addMember(FAMILY, SCHOOL, { studentId: STUDENT }, ctx);
      expect(dto.familyId).toBe(FAMILY);
      expect(ddb.putItem).toHaveBeenCalledTimes(1);
    });

    it('maps ConditionalCheckFailedException on the put to 409', async () => {
      stubGetItemByKey(ddb, {
        [EntityKeyBuilder.family(FAMILY)]: makeFamily(),
        [EntityKeyBuilder.student(STUDENT)]: makeStudent(),
      });
      const err = new Error('conditional check failed');
      err.name = 'ConditionalCheckFailedException';
      ddb.putItem.mockRejectedValue(err);

      await expect(
        service.addMember(FAMILY, SCHOOL, { studentId: STUDENT }, ctx),
      ).rejects.toThrow(ConflictException);
    });

    it('rethrows non-conditional put failures untouched', async () => {
      stubGetItemByKey(ddb, {
        [EntityKeyBuilder.family(FAMILY)]: makeFamily(),
        [EntityKeyBuilder.student(STUDENT)]: makeStudent(),
      });
      ddb.putItem.mockRejectedValue(new Error('ProvisionedThroughputExceeded'));

      await expect(
        service.addMember(FAMILY, SCHOOL, { studentId: STUDENT }, ctx),
      ).rejects.toThrow('ProvisionedThroughputExceeded');
    });

    it('404 when the family is deactivated', async () => {
      stubGetItemByKey(ddb, {
        [EntityKeyBuilder.family(FAMILY)]: makeFamily({ isActive: false }),
        [EntityKeyBuilder.student(STUDENT)]: makeStudent(),
      });
      await expect(
        service.addMember(FAMILY, SCHOOL, { studentId: STUDENT }, ctx),
      ).rejects.toThrow(NotFoundException);
    });

    it('404 when the student does not exist', async () => {
      stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });
      await expect(
        service.addMember(FAMILY, SCHOOL, { studentId: STUDENT }, ctx),
      ).rejects.toThrow(NotFoundException);
    });

    it('400 when the student belongs to another school (V1 same-school rule)', async () => {
      stubGetItemByKey(ddb, {
        [EntityKeyBuilder.family(FAMILY)]: makeFamily(),
        [EntityKeyBuilder.student(STUDENT)]: makeStudent({ primarySchoolId: OTHER_SCHOOL }),
      });
      await expect(
        service.addMember(FAMILY, SCHOOL, { studentId: STUDENT }, ctx),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeMember', () => {
    it('deletes the member row (unconditional — idempotent)', async () => {
      stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });

      await service.removeMember(FAMILY, SCHOOL, STUDENT, ctx);

      expect(ddb.deleteItem).toHaveBeenCalledWith(
        {},
        TENANT,
        `FAMILY_MEMBER#${FAMILY}#${STUDENT}`,
      );
      // No ConditionExpression argument — deleting an absent row succeeds.
      expect((ddb.deleteItem.mock.calls[0] as unknown[]).length).toBe(3);
    });

    it('is idempotent: unlinking an already-unlinked student does not throw', async () => {
      stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });
      await service.removeMember(FAMILY, SCHOOL, STUDENT, ctx);
      await expect(service.removeMember(FAMILY, SCHOOL, STUDENT, ctx)).resolves.toBeUndefined();
      expect(ddb.deleteItem).toHaveBeenCalledTimes(2);
    });

    it('works on a deactivated family (membership cleanup)', async () => {
      stubGetItemByKey(ddb, {
        [EntityKeyBuilder.family(FAMILY)]: makeFamily({ isActive: false }),
      });
      await expect(service.removeMember(FAMILY, SCHOOL, STUDENT, ctx)).resolves.toBeUndefined();
    });

    it('404 when the family does not exist', async () => {
      await expect(service.removeMember(FAMILY, SCHOOL, STUDENT, ctx)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

describe('FamiliesService — FB-1.5 getStudentFamily', () => {
  let service: FamiliesService;
  let ddb: MockDdb;

  beforeEach(() => {
    ({ service, ddb } = makeService());
  });

  it('unlinked student → 200 shape { family: null, siblings: [] } (never 404)', async () => {
    const view = await service.getStudentFamily(STUDENT, SCHOOL, ctx);
    expect(view).toEqual({ family: null, siblings: [] });
    expect(ddb.queryGSI2).toHaveBeenCalledWith({}, STUDENT, 'FAMILY#', 'begins_with');
  });

  it('linked student → family + siblings (subject excluded) with gradeLevel from ONE batch get', async () => {
    stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });
    ddb.queryGSI2.mockResolvedValue({ items: [makeMember()], hasMore: false });
    ddb.query.mockResolvedValue({
      items: [
        makeMember(),
        makeMember({
          studentId: SIBLING,
          entityKey: EntityKeyBuilder.familyMember(FAMILY, SIBLING),
          gsi2pk: SIBLING,
          studentName: 'Hari Adhikari',
        }),
      ],
      hasMore: false,
    });
    ddb.batchGetItems.mockResolvedValue([
      makeStudent({ studentId: SIBLING, firstName: 'Hari', currentGradeLevel: '9' }),
    ]);

    const view = await service.getStudentFamily(STUDENT, SCHOOL, ctx);

    expect(view.family?.id).toBe(FAMILY);
    expect(view.family).not.toHaveProperty('isActive');
    expect(view.siblings).toEqual([
      { studentId: SIBLING, studentName: 'Hari Adhikari', gradeLevel: '9', status: 'active' },
    ]);

    // Member rows come from the main table under the tenant partition.
    expect(ddb.query).toHaveBeenCalledWith({}, TENANT, `FAMILY_MEMBER#${FAMILY}#`);
    // Exactly ONE batch get for sibling student rows — no per-sibling queries.
    expect(ddb.batchGetItems).toHaveBeenCalledTimes(1);
    expect(ddb.batchGetItems).toHaveBeenCalledWith({}, [
      { tenantId: TENANT, entityKey: EntityKeyBuilder.student(SIBLING) },
    ]);
  });

  it('deactivated family → { family: null, siblings: [] }', async () => {
    stubGetItemByKey(ddb, {
      [EntityKeyBuilder.family(FAMILY)]: makeFamily({ isActive: false }),
    });
    ddb.queryGSI2.mockResolvedValue({ items: [makeMember()], hasMore: false });

    const view = await service.getStudentFamily(STUDENT, SCHOOL, ctx);
    expect(view).toEqual({ family: null, siblings: [] });
    expect(ddb.query).not.toHaveBeenCalled();
  });

  it('family at another school → { family: null, siblings: [] } (school-bounded view)', async () => {
    stubGetItemByKey(ddb, {
      [EntityKeyBuilder.family(FAMILY)]: makeFamily({ schoolId: OTHER_SCHOOL }),
    });
    ddb.queryGSI2.mockResolvedValue({ items: [makeMember()], hasMore: false });

    const view = await service.getStudentFamily(STUDENT, SCHOOL, ctx);
    expect(view).toEqual({ family: null, siblings: [] });
  });

  it('withdrawn sibling stays in the list with the documented shape', async () => {
    stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });
    ddb.queryGSI2.mockResolvedValue({ items: [makeMember()], hasMore: false });
    ddb.query.mockResolvedValue({
      items: [
        makeMember(),
        makeMember({
          studentId: SIBLING,
          entityKey: EntityKeyBuilder.familyMember(FAMILY, SIBLING),
          gsi2pk: SIBLING,
          studentName: 'Gita Adhikari',
        }),
      ],
      hasMore: false,
    });
    ddb.batchGetItems.mockResolvedValue([
      makeStudent({
        studentId: SIBLING,
        firstName: 'Gita',
        currentGradeLevel: '10',
        status: 'withdrawn',
      }),
    ]);

    const view = await service.getStudentFamily(STUDENT, SCHOOL, ctx);
    expect(view.siblings).toEqual([
      { studentId: SIBLING, studentName: 'Gita Adhikari', gradeLevel: '10', status: 'withdrawn' },
    ]);
  });

  it('sibling status (FB-5.1) comes from the same batch-fetched rows as gradeLevel; a missing row leaves it undefined', async () => {
    const SIBLING_2 = 'sibling-2-uuid';
    stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });
    ddb.queryGSI2.mockResolvedValue({ items: [makeMember()], hasMore: false });
    ddb.query.mockResolvedValue({
      items: [
        makeMember(),
        makeMember({
          studentId: SIBLING,
          entityKey: EntityKeyBuilder.familyMember(FAMILY, SIBLING),
          gsi2pk: SIBLING,
          studentName: 'Hari Adhikari',
        }),
        makeMember({
          studentId: SIBLING_2,
          entityKey: EntityKeyBuilder.familyMember(FAMILY, SIBLING_2),
          gsi2pk: SIBLING_2,
          studentName: 'Gita Adhikari',
        }),
      ],
      hasMore: false,
    });
    // Only one of the two sibling rows resolves — the other degrades to
    // undefined status/grade, never throws (finance counts it NOT active).
    ddb.batchGetItems.mockResolvedValue([
      makeStudent({ studentId: SIBLING, firstName: 'Hari', currentGradeLevel: '9', status: 'active' }),
    ]);

    const view = await service.getStudentFamily(STUDENT, SCHOOL, ctx);

    expect(ddb.batchGetItems).toHaveBeenCalledTimes(1);
    expect(view.siblings).toEqual([
      { studentId: SIBLING, studentName: 'Hari Adhikari', gradeLevel: '9', status: 'active' },
      { studentId: SIBLING_2, studentName: 'Gita Adhikari', gradeLevel: undefined, status: undefined },
    ]);
  });

  it('sibling whose student row is missing from the batch get keeps name, omits gradeLevel', async () => {
    stubGetItemByKey(ddb, { [EntityKeyBuilder.family(FAMILY)]: makeFamily() });
    ddb.queryGSI2.mockResolvedValue({ items: [makeMember()], hasMore: false });
    ddb.query.mockResolvedValue({
      items: [
        makeMember(),
        makeMember({
          studentId: SIBLING,
          entityKey: EntityKeyBuilder.familyMember(FAMILY, SIBLING),
          gsi2pk: SIBLING,
          studentName: 'Hari Adhikari',
        }),
      ],
      hasMore: false,
    });
    ddb.batchGetItems.mockResolvedValue([]);

    const view = await service.getStudentFamily(STUDENT, SCHOOL, ctx);
    expect(view.siblings).toEqual([
      { studentId: SIBLING, studentName: 'Hari Adhikari', gradeLevel: undefined },
    ]);
  });
});

describe('FamiliesService — listMembers (FB-4.6 companion read)', () => {
  it('returns member DTOs for an active family', async () => {
    const { service, ddb } = makeService();
    const fam = makeFamily();
    stubGetItemByKey(ddb, { [`FAMILY#${fam.familyId}`]: fam });
    ddb.query.mockResolvedValue({
      items: [
        makeMember({ studentId: 'stu-1', studentName: 'Priya Adhikari' }),
        makeMember({ studentId: 'stu-2', studentName: 'Rohan Adhikari' }),
      ],
      hasMore: false,
    });

    const out = await service.listMembers(fam.familyId, fam.schoolId, ctx);

    expect(ddb.query).toHaveBeenCalledWith(
      expect.anything(),
      ctx.tenantId,
      `FAMILY_MEMBER#${fam.familyId}#`,
    );
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toMatchObject({ studentId: 'stu-1', studentName: 'Priya Adhikari' });
    expect(out.items[0]).not.toHaveProperty('isActive');
  });

  it('404s for a wrong-school family (no cross-school leak)', async () => {
    const { service, ddb } = makeService();
    const fam = makeFamily();
    stubGetItemByKey(ddb, { [`FAMILY#${fam.familyId}`]: fam });

    await expect(
      service.listMembers(fam.familyId, 'other-school', ctx),
    ).rejects.toThrow(NotFoundException);
    expect(ddb.query).not.toHaveBeenCalled();
  });

  it('404s for a deactivated family', async () => {
    const { service, ddb } = makeService();
    const fam = makeFamily({ isActive: false });
    stubGetItemByKey(ddb, { [`FAMILY#${fam.familyId}`]: fam });

    await expect(
      service.listMembers(fam.familyId, fam.schoolId, ctx),
    ).rejects.toThrow(NotFoundException);
  });
});
