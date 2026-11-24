// repositories/category-repository.ts
// 分类仓储：分类 CRUD 与删除时的物品关联级联清理（单次原子写入）。

import type { Category } from '../models/category'
import { generateId } from '../utils/id'
import { now } from '../utils/date'
import { readDatabase, saveDatabase } from '../storage/database-storage'

export interface CategoryRepository {
  list(): Promise<Category[]>
  getById(id: string): Promise<Category | undefined>
  /** 保存（新建或更新）。新建时生成 ID 与时间戳 */
  save(category: Category): Promise<Category>
  /**
   * 删除分类，并原子地清除所有 Item 的 categoryIds 中该分类 ID。
   * 整个操作只发生一次数据库写入。
   */
  removeWithCascade(id: string): Promise<void>
  /** 重算分类 sortOrder（管理页排序用） */
  reorder(ids: string[]): Promise<void>
}

export class CategoryRepositoryImpl implements CategoryRepository {
  async list(): Promise<Category[]> {
    const db = await readDatabase()
    return [...db.categories].sort((a, b) => a.sortOrder - b.sortOrder)
  }

  async getById(id: string): Promise<Category | undefined> {
    const db = await readDatabase()
    return db.categories.find((c) => c.id === id)
  }

  async save(category: Category): Promise<Category> {
    const db = await readDatabase()
    const ts = now()
    const index = db.categories.findIndex((c) => c.id === category.id)
    let saved: Category
    if (index >= 0) {
      saved = { ...category, createdAt: db.categories[index].createdAt, updatedAt: ts }
      db.categories[index] = saved
    } else {
      const maxSort = db.categories.reduce((m, c) => Math.max(m, c.sortOrder), 0)
      saved = {
        ...category,
        id: category.id || generateId('cat_'),
        sortOrder: category.sortOrder ?? maxSort + 1,
        createdAt: ts,
        updatedAt: ts,
      }
      db.categories.push(saved)
    }
    await saveDatabase(db)
    return saved
  }

  async removeWithCascade(id: string): Promise<void> {
    const db = await readDatabase()
    const nextCategories = db.categories.filter((c) => c.id !== id)
    if (nextCategories.length === db.categories.length) return
    // 级联清理所有物品引用，仅一次写入，保证原子性
    const nextItems = db.items.map((it) =>
      it.categoryIds.includes(id)
        ? { ...it, categoryIds: it.categoryIds.filter((cid) => cid !== id), updatedAt: now() }
        : it,
    )
    await saveDatabase({ ...db, categories: nextCategories, items: nextItems })
  }

  async reorder(ids: string[]): Promise<void> {
    const db = await readDatabase()
    const orderMap = new Map(ids.map((id, i) => [id, i + 1]))
    const ts = now()
    const nextCategories = db.categories.map((c) => {
      const order = orderMap.get(c.id)
      return order !== undefined && order !== c.sortOrder ? { ...c, sortOrder: order, updatedAt: ts } : c
    })
    await saveDatabase({ ...db, categories: nextCategories })
  }
}

export const categoryRepository: CategoryRepository = new CategoryRepositoryImpl()
