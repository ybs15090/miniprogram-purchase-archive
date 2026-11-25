// services/startup-check-service.ts
// 启动时异步校验数据库可读性，并一次性清理失效分类引用。
import { readDatabase, saveDatabase, DatabaseCorruptedError } from '../storage/database-storage'
import { now } from '../utils/date'

export interface StartupCheckResult {
  healthy: boolean
  corrupted: boolean
  orphanCategoryRefsFixed: number
}

export async function runStartupCheck(): Promise<StartupCheckResult> {
  try {
    const db = await readDatabase()
    const validIds = new Set(db.categories.map((category) => category.id))
    let fixed = 0
    const items = db.items.map((item) => {
      const kept = item.categoryIds.filter((id) => validIds.has(id))
      if (kept.length === item.categoryIds.length) return item
      fixed += item.categoryIds.length - kept.length
      return { ...item, categoryIds: kept }
    })
    if (fixed > 0) {
      await saveDatabase({ ...db, items, updatedAt: now() })
    }
    return { healthy: true, corrupted: false, orphanCategoryRefsFixed: fixed }
  } catch (error) {
    if (error instanceof DatabaseCorruptedError) {
      return { healthy: false, corrupted: true, orphanCategoryRefsFixed: 0 }
    }
    return { healthy: false, corrupted: false, orphanCategoryRefsFixed: 0 }
  }
}
