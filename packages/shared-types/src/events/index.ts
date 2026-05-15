/**
 * @aibrains/shared-types — Domain event taxonomy (Sprint C0.c.2).
 *
 * Re-exports the registry, validator, and every concrete schema so
 * consumers can:
 *
 *   import {
 *     EVENT_REGISTRY,
 *     validateEvent,
 *     schoolCreatedSchema,
 *     type SchoolCreatedEvent,
 *     type DomainEvent,
 *     type EventType,
 *   } from '@aibrains/shared-types';
 */

export * from './base';
export * from './school';
export * from './academic-year';
export * from './term';
export * from './enrollment';
export * from './attendance';
export * from './exam';
export * from './result';
export * from './reporting';
export * from './calendar';
export * from './taxonomy';
