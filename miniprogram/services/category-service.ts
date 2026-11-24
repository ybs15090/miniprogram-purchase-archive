// services/category-service.ts
// 分类业务服务：名称校验、唯一性、删除影响评估与级联清理。

import type { Category } from '../models/category'
import { categoryRepository } from '../repositories/category-repository'
import { itemRepository } from '../repositories/item-repository'
import { queryItems } from './item-service'

export interface CategoryService {
  list(): Promise<Category[]>
  getById(id: string): Promise<Category | undefined>
  /** 新建分类（名称 trim 非空且不与现有重复） */
  create(name: string): Promise<Category>
  /** 改名（同样校验） */
  rename(id: string, name: string): Promise<Category>
  /** 删除前影响评估：返回受影响（引用该分类）的有效与全部物品数 */
  getRemoveImpact(id: string): Promise<{ activeItems: number; totalItems: number }>
  /** 删除并级联清理所有物品引用（原子操作） */
  removeWithCascade(id: string): Promise<void>
  /** 按给定顺序重排 */
  reorder(ids: string[]): Promise<void>
}

export class CategoryServiceImpl implements CategoryService {
  async list(): Promise<Category[]> {
    return categoryRepository.list()
  }

  async getById(id: string): Promise<Category | undefined> {
    return categoryRepository.getById(id)
  }

  private async validateName(raw: string, excludeId?: string): Promise<string> {
    const name = raw.trim()
    if (!name) {
      throw new Error('分类名称不能为空')
    }
    const all = await categoryRepository.list()
    const conflict = all.find((c) => c.name === name && c.id !== excludeId)
    if (conflict) {
      throw new Error('已存在同名分类')
    }
    return name
  }

  async create(name: string): Promise<Category> {
    const validName = await this.validateName(name)
    return categoryRepository.save({
      id: '',
      name: validName,
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0,
    })
  }

  async rename(id: string, name: string): Promise<Category> {
    const existing = await categoryRepository.getById(id)
    if (!existing) {
      throw new Error('分类不存在')
    }
    const validName = await this.validateName(name, id)
    return categoryRepository.save({ ...existing, name: validName })
  }

  async getRemoveImpact(id: string): Promise<{ activeItems: number; totalItems: number }> {
    const [valid, all] = await Promise.all([itemRepository.list(false), itemRepository.list(true)])
    const count = (list: typeof all) => list.filter((it) => it.categoryIds.includes(id)).length
    return { activeItems: count(valid), totalItems: count(all) }
  }

  async removeWithCascade(id: string): Promise<void> {
    await categoryRepository.removeWithCascade(id)
  }

  async reorder(ids: string[]): Promise<void> {
    await categoryRepository.reorder(ids)
  }

  /** 分类页数据装配：分类列表 + 各分类命中数量（复用查询管道保证口径一致） */
  async listWithCounts(): Promise<Array<Category & { itemCount: number }>> {
    const [categories, items] = await Promise.all([categoryRepository.list(), itemRepository.list(false)])
    const active = queryItems(items, {})
    return categories.map((c) => ({
      ...c,
      itemCount: active.filter((it) => it.categoryIds.includes(c.id)).length,
    }))
  }
}

export const categoryService = new CategoryServiceImpl()
