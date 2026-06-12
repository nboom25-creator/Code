/**
 * Minimal, dependency-free Entity Component System.
 *
 * - An **Entity** is just a numeric id.
 * - A **Component** is a plain data class instance.
 * - The **World** owns the entities and a column store per component type.
 *
 * Systems (see `../systems`) operate by querying the world for the entities
 * that own a given set of components and mutating those components in place.
 */

export type EntityId = number;

/** Marker base class so component stores can be keyed by constructor. */
export abstract class Component {}

type ComponentClass<T extends Component = Component> = new (...args: any[]) => T;

export class World {
  private nextId: EntityId = 1;
  private readonly living = new Set<EntityId>();
  /** componentConstructor -> (entityId -> componentInstance) */
  private readonly stores = new Map<Function, Map<EntityId, Component>>();

  /** Allocate a fresh entity id. */
  createEntity(): EntityId {
    const id = this.nextId++;
    this.living.add(id);
    return id;
  }

  /** Remove an entity and all of its components. */
  destroyEntity(id: EntityId): void {
    this.living.delete(id);
    for (const store of this.stores.values()) store.delete(id);
  }

  exists(id: EntityId): boolean {
    return this.living.has(id);
  }

  /** Attach (or replace) a component on an entity. Returns the component. */
  add<T extends Component>(id: EntityId, component: T): T {
    this.storeFor(component.constructor as ComponentClass).set(id, component);
    return component;
  }

  /** Fetch a component, or `undefined` if the entity does not own it. */
  get<T extends Component>(id: EntityId, ctor: ComponentClass<T>): T | undefined {
    return this.stores.get(ctor)?.get(id) as T | undefined;
  }

  /** Like {@link get} but throws if missing — use when presence is invariant. */
  require<T extends Component>(id: EntityId, ctor: ComponentClass<T>): T {
    const c = this.get(id, ctor);
    if (!c) throw new Error(`Entity ${id} is missing component ${ctor.name}`);
    return c;
  }

  has<T extends Component>(id: EntityId, ctor: ComponentClass<T>): boolean {
    return this.stores.get(ctor)?.has(id) ?? false;
  }

  remove<T extends Component>(id: EntityId, ctor: ComponentClass<T>): void {
    this.stores.get(ctor)?.delete(id);
  }

  /** All living entity ids. */
  entities(): EntityId[] {
    return [...this.living];
  }

  /** Entities that own *every* listed component type. */
  query(...ctors: ComponentClass[]): EntityId[] {
    if (ctors.length === 0) return this.entities();
    // Iterate the smallest store for efficiency.
    let smallest: Map<EntityId, Component> | undefined;
    for (const ctor of ctors) {
      const store = this.stores.get(ctor);
      if (!store) return [];
      if (!smallest || store.size < smallest.size) smallest = store;
    }
    const result: EntityId[] = [];
    for (const id of smallest!.keys()) {
      if (ctors.every((c) => this.stores.get(c)?.has(id))) result.push(id);
    }
    return result;
  }

  private storeFor(ctor: Function): Map<EntityId, Component> {
    let store = this.stores.get(ctor);
    if (!store) {
      store = new Map();
      this.stores.set(ctor, store);
    }
    return store;
  }
}
