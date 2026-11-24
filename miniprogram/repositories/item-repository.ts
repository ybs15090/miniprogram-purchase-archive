// repositories/item-repository.ts
// 物品仓储：业务实体的查询与持久化接口。页面不得直接访问本层以下。

import type { Item } from '../models/item'
import { generateId } from '../utils/id'
import { now } from '../utils/date'
import { readDatabase, saveDatabase } from '../storage/database-storage'

export interface ItemRepository {
  /** 列出物品；默认仅有效记录（deletedAt === null） */
  list(includeDeleted?: boolean): Promise<Item[]>
  getById(id: string): Promise<Item | undefined>
  /** 保存（新建或更新）。新建时由仓储生成 ID 与时间戳 */
  save(item: Item): Promise<Item>
  /** 软删除：置 deletedAt，不物理移除 */
  softDelete(id: string): Promise<void>
  /** 从回收站恢复 */
  restore(id: string): Promise<void>
  /** 永久删除（物理移除，不可恢复） */
  permanentDelete(id: string): Promise<void>
  /** 创建副本：新 ID、新创建/更新时间，不改变原数据 */
  duplicate(id: string): Promise<Item | undefined>
}

export class ItemRepositoryImpl implements ItemRepository {
  async list(includeDeleted = false): Promise<Item[]> {
    const db = await readDatabase()
    if (includeDeleted) return db.items
    return db.items.filter((it) => it.deletedAt === null)
  }

  async getById(id: string): Promise<Item | undefined> {
    const db = await readDatabase()
    return db.items.find((it) => it.id === id)
  }

  async save(item: Item): Promise<Item> {
    const db = await readDatabase()
    const ts = now()
    const index = db.items.findIndex((it) => it.id === item.id)
    let saved: Item
    if (index >= 0) {
      // 更新：不改 ID 与创建时间
      saved = { ...item, createdAt: db.items[index].createdAt, updatedAt: ts }
      db.items[index] = saved
    } else {
      saved = { ...item, id: item.id || generateId('item_'), createdAt: ts, updatedAt: ts, deletedAt: null }
      db.items.push(saved)
    }
    await saveDatabase(db)
    return saved
  }

  async softDelete(id: string): Promise<void> {
    const db = await readDatabase()
    const index = db.items.findIndex((it) => it.id === id)
    if (index < 0) return
    if (db.items[index].deletedAt !== null) return
    db.items[index] = { ...db.items[index], deletedAt: now(), updatedAt: now() }
    await saveDatabase(db)
  }

  async restore(id: string): Promise<void> {
    const db = await readDatabase()
    const index = db.items.findIndex((it) => it.id === id)
    if (index < 0) return
    if (db.items[index].deletedAt === null) return
    db.items[index] = { ...db.items[index], deletedAt: null, updatedAt: now() }
    await saveDatabase(db)
  }

  async permanentDelete(id: string): Promise<void> {
    const db = await readDatabase()
    const next = db.items.filter((it) => it.id !== id)
    if (next.length === db.items.length) return
    await saveDatabase({ ...db, items: next })
  }

  async duplicate(id: string): Promise<Item | undefined> {
    const db = await readDatabase()
    const source = db.items.find((it) => it.id === id)
    if (!source) return undefined
    const ts = now()
    const copy: Item = {
      ...source,
      id: generateId('item_'),
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    }
    db.items.push(copy)
    await saveDatabase(db)
    return copy
  }
}

export const itemRepository: ItemRepository = new ItemRepositoryImpl()
