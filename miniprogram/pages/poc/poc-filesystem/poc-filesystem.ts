// pages/poc/poc-filesystem/poc-filesystem.ts
// POC-03 文件系统 + POC-04 双版本数据库验证页。
// 说明：本页验证 USER_DATA_PATH 的目录创建、读写、覆盖、删除、stat、列目录，
//       以及 A/B 双版本数据库的 revision 选择与损坏文件处理。
// 重启持久性、异常中断恢复需在真机重启后人工复核（步骤见交接报告）。

import {
  getUserDataPath,
  joinPath,
  readTextFile,
  writeTextFile,
  exists,
  mkdir,
  removeFile,
  stat,
  readdir,
} from '../../../storage/local-storage'
import { formatDateTime, now } from '../../../utils/date'

type LogStatus = 'ok' | 'fail' | 'info'

interface LogEntry {
  time: string
  title: string
  status: LogStatus
  detail: string
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null) {
    const anyErr = e as { errno?: number; errMsg?: string }
    return [anyErr.errno !== undefined ? `errno=${anyErr.errno}` : '', anyErr.errMsg || '']
      .filter(Boolean)
      .join(' | ')
  }
  return String(e)
}

function makeDb(revision: number) {
  return {
    format: 'purchase-archive-database',
    schemaVersion: 1,
    revision,
    updatedAt: Date.now(),
    items: [],
    categories: [],
  }
}

Page({
  data: {
    userDataPath: '',
    logs: [] as LogEntry[],
  },

  onLoad() {
    this.setData({ userDataPath: getUserDataPath() })
  },

  addLog(title: string, status: LogStatus, detail: string) {
    const entry: LogEntry = { time: formatDateTime(now()), title, status, detail }
    this.setData({ logs: [entry, ...this.data.logs].slice(0, 200) })
  },

  async runDirTest() {
    const base = getUserDataPath()
    try {
      const dataDir = joinPath(base, 'data')
      const cacheDir = joinPath(base, 'image-cache')
      await mkdir(dataDir)
      await mkdir(cacheDir)
      const dOk = await exists(dataDir)
      const cOk = await exists(cacheDir)
      this.addLog('目录创建', dOk && cOk ? 'ok' : 'fail', `data=${dOk}, image-cache=${cOk}`)
    } catch (e) {
      this.addLog('目录创建', 'fail', errText(e))
    }
  },

  async runWriteReadTest() {
    const file = joinPath(getUserDataPath(), 'data', 'poc-write.txt')
    try {
      const content = `hello-${now()}`
      await writeTextFile(file, content)
      const read = await readTextFile(file)
      if (read === content) {
        this.addLog('写入/读取', 'ok', `内容一致：${content}`)
      } else {
        this.addLog('写入/读取', 'fail', `不一致：写=${content} 读=${read}`)
      }

      const content2 = `overwrite-${now()}`
      await writeTextFile(file, content2)
      const read2 = await readTextFile(file)
      this.addLog('覆盖写入', read2 === content2 ? 'ok' : 'fail', `读回：${read2}`)
    } catch (e) {
      this.addLog('写入/读取', 'fail', errText(e))
    }
  },

  async runStatTest() {
    const file = joinPath(getUserDataPath(), 'data', 'poc-write.txt')
    try {
      const s = await stat(file)
      this.addLog('文件信息', 'ok', `size=${s.size}B, mtime=${s.lastModifiedTime}`)
    } catch (e) {
      this.addLog('文件信息', 'fail', errText(e))
    }
  },

  async runDeleteTest() {
    const file = joinPath(getUserDataPath(), 'data', 'poc-write.txt')
    try {
      await removeFile(file)
      const stillExists = await exists(file)
      this.addLog('删除文件', stillExists ? 'fail' : 'ok', stillExists ? '删除后仍存在' : '删除成功')
    } catch (e) {
      this.addLog('删除文件', 'fail', errText(e))
    }
  },

  async runDbAbTest() {
    const dataDir = joinPath(getUserDataPath(), 'data')
    const fileA = joinPath(dataDir, 'database-a.json')
    const fileB = joinPath(dataDir, 'database-b.json')
    try {
      await mkdir(dataDir)
      await writeTextFile(fileA, JSON.stringify(makeDb(1)))
      await writeTextFile(fileB, JSON.stringify(makeDb(2)))

      const a = JSON.parse(await readTextFile(fileA))
      const b = JSON.parse(await readTextFile(fileB))
      const chosen = a.revision >= b.revision ? a : b
      this.addLog(
        'A/B revision 选择',
        'ok',
        `A.rev=${a.revision}, B.rev=${b.revision} -> 选中 revision=${chosen.revision}`,
      )

      // 写入非活动文件，revision + 1
      const next = makeDb(chosen.revision + 1)
      const target = chosen === a ? fileB : fileA
      await writeTextFile(target, JSON.stringify(next))

      const reA = JSON.parse(await readTextFile(fileA))
      const reB = JSON.parse(await readTextFile(fileB))
      const final = reA.revision >= reB.revision ? reA : reB
      this.addLog('交替写入', 'ok', `写后 A.rev=${reA.revision}, B.rev=${reB.revision} -> 最新=${final.revision}`)
    } catch (e) {
      this.addLog('A/B 双版本数据库', 'fail', errText(e))
    }
  },

  async runCorruptTest() {
    const file = joinPath(getUserDataPath(), 'data', 'database-a.json')
    try {
      await writeTextFile(file, '{ invalid json')
      try {
        JSON.parse(await readTextFile(file))
        this.addLog('损坏文件处理', 'fail', '非法 JSON 被成功解析，不符合预期')
      } catch (parseErr) {
        this.addLog('损坏文件处理', 'ok', `损坏 A 解析失败，可回退到 B：${errText(parseErr)}`)
      }
    } catch (e) {
      this.addLog('损坏文件处理', 'fail', errText(e))
    }
  },

  async runListTest() {
    const dir = joinPath(getUserDataPath(), 'data')
    try {
      const files = await readdir(dir)
      this.addLog('列目录', 'ok', `files=[${files.join(', ')}]`)
    } catch (e) {
      this.addLog('列目录', 'fail', errText(e))
    }
  },

  async runClearTest() {
    const dir = joinPath(getUserDataPath(), 'data')
    try {
      for (const name of ['database-a.json', 'database-b.json', 'poc-write.txt']) {
        const f = joinPath(dir, name)
        if (await exists(f)) {
          await removeFile(f)
        }
      }
      this.addLog('清理 PoC 文件', 'ok', '已清理 database-a/b.json 与 poc-write.txt')
    } catch (e) {
      this.addLog('清理 PoC 文件', 'fail', errText(e))
    }
  },
})
