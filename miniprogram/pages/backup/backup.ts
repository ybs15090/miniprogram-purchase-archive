// pages/backup/backup.ts
// 本地 JSON 导出、导入预览与整库恢复；POC-05 文件交互仍待真机验证。
import { toastInfo, toastSuccess, errorMessage } from '../../utils/toast'
import {
  createShareBackup,
  readBackupContent,
  validateBackupContent,
  restoreFromContent,
  hasPreRestoreSnapshot,
} from '../../services/backup-service'
import type { BackupSummary } from '../../services/backup-service'

function isCancel(error: unknown): boolean {
  return errorMessage(error).toLowerCase().includes('cancel')
}

Page({
  data: {
    exporting: false,
    importing: false,
    restoring: false,
    exportReady: false,
    selectedFileName: '',
    validationStatus: '尚未选择导入文件',
    validationErrors: [] as string[],
    summary: null as BackupSummary | null,
    hasPreRestore: false,
  },

  pendingContent: '',
  preparedBackupPath: '',

  onShow() {
    this.refreshProtectionState()
    this.prepareBackupFile()
  },

  async prepareBackupFile() {
    this.setData({ exportReady: false })
    try {
      const path = await createShareBackup()
      this.preparedBackupPath = path
      this.setData({ exportReady: true })
    } catch {
      this.preparedBackupPath = ''
      toastInfo('备份文件生成失败')
    }
  },

  async refreshProtectionState() {
    try {
      const hasPreRestore = await hasPreRestoreSnapshot()
      this.setData({ hasPreRestore })
    } catch {
      this.setData({ hasPreRestore: false })
    }
  },

  onExportTap() {
    if (this.data.exporting || this.data.importing || this.data.restoring) return
    if (!this.data.exportReady || !this.preparedBackupPath) {
      toastInfo('备份文件生成中，请稍候')
      return
    }
    this.setData({ exporting: true })
    wx.shareFileMessage({
      filePath: this.preparedBackupPath,
      fileName: `purchase-archive-${Date.now()}.json`,
      success: () => {
        this.setData({ exporting: false })
        toastSuccess('备份文件已分享')
      },
      fail: (error: WechatMiniprogram.GeneralCallbackResult) => {
        this.setData({ exporting: false })
        if (!isCancel(error)) {
          wx.showModal({ title: '导出失败', content: errorMessage(error), showCancel: false })
        }
      },
    })
  },

  async onImportTap() {
    if (this.data.exporting || this.data.importing || this.data.restoring) return
    this.setData({ importing: true })
    try {
      const res = await new Promise<WechatMiniprogram.ChooseMessageFileSuccessCallbackResult>((resolve, reject) => {
        wx.chooseMessageFile({
          count: 1,
          type: 'file',
          extension: ['json'],
          success: resolve,
          fail: reject,
        })
      })
      const file = res.tempFiles[0]
      if (!file) throw new Error('未选择文件')
      await this.previewBackup(file.path, file.name)
    } catch (error) {
      if (!isCancel(error)) {
        this.pendingContent = ''
        this.setData({
          selectedFileName: '',
          summary: null,
          validationStatus: '文件读取失败',
          validationErrors: [errorMessage(error)],
        })
      }
    } finally {
      this.setData({ importing: false })
    }
  },

  async previewBackup(path: string, fileName: string) {
    this.pendingContent = ''
    this.setData({
      selectedFileName: fileName,
      summary: null,
      validationErrors: [],
      validationStatus: '正在校验…',
    })
    const text = await readBackupContent(path)
    const result = validateBackupContent(text)
    if (result.valid && result.summary) {
      this.pendingContent = text
      this.setData({
        summary: result.summary,
        validationStatus: '校验通过，请确认影响范围后恢复',
        validationErrors: [],
      })
      return
    }
    this.setData({
      validationStatus: '校验失败，未修改本地数据',
      validationErrors: result.errors.length > 0 ? result.errors : ['文件内容不合法'],
    })
  },

  onRestoreTap() {
    if (!this.pendingContent || !this.data.summary || this.data.restoring) return
    const summary = this.data.summary
    wx.showModal({
      title: '确认整库恢复',
      content: `将覆盖当前全部物品和分类。导入有效物品 ${summary.activeItems} 条、回收站 ${summary.deletedItems} 条、分类 ${summary.categories} 个。恢复前会自动保存当前数据库保护点。`,
      confirmText: '确认恢复',
      confirmColor: '#D54941',
      success: (res) => {
        if (res.confirm) this.restoreSelected()
      },
    })
  },

  async restoreSelected() {
    const content = this.pendingContent
    if (!content) return
    this.setData({ restoring: true })
    try {
      const result = await restoreFromContent(content)
      if (!result.valid) {
        this.setData({ validationStatus: '恢复校验失败，未修改本地数据', validationErrors: result.errors })
        return
      }
      this.pendingContent = ''
      this.setData({
        selectedFileName: '',
        summary: null,
        validationErrors: [],
        validationStatus: '恢复完成，已保留恢复前保护点',
      })
      this.refreshProtectionState()
      this.prepareBackupFile()
      toastSuccess('数据恢复完成')
    } catch (error) {
      this.setData({
        validationStatus: '恢复失败，本地原数据未被覆盖',
        validationErrors: [errorMessage(error)],
      })
    } finally {
      this.setData({ restoring: false })
    }
  },

  onUndoTap() {
    toastInfo(this.data.hasPreRestore ? '撤销入口待接入，保护点已保留' : '暂无恢复保护点')
  },

  onWebDavTap() {
    wx.navigateTo({ url: '/pages/webdav-config/webdav-config' })
  },
})
