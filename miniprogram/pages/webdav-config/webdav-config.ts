// pages/webdav-config/webdav-config.ts
// WebDAV 配置、凭据管理、连接测试、云端备份与恢复。
import { toastInfo, toastSuccess, errorMessage } from '../../utils/toast'
import type { WebDavConfig } from '../../services/webdav-client'
import {
  checkWebDavConnection,
  uploadWebDavBackup,
  restoreLatestWebDavBackup,
} from '../../services/webdav-backup-service'
import { getStorage, setStorage, removeStorage } from '../../storage/local-storage'
import { STORAGE_KEYS } from '../../constants/storage-keys'

const DEFAULT_SERVER = 'https://dav.jianguoyun.com/dav/'
const DEFAULT_REMOTE_DIR = 'PurchaseArchive/'

function validHttpsUrl(value: string): boolean {
  return /^https:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/i.test(value)
}

function normalizeRemoteDir(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

Page({
  data: {
    serverUrl: DEFAULT_SERVER,
    remoteDir: DEFAULT_REMOTE_DIR,
    username: '',
    appPassword: '',
    remember: false,
    hasSavedCredentials: false,
    saving: false,
    testing: false,
    uploading: false,
    restoring: false,
    cloudStatus: '',
    cloudStatusOk: false,
    lastBackupText: '',
  },

  onLoad() {
    const remember = getStorage<boolean>(STORAGE_KEYS.webdavRemember) === true
    if (!remember) {
      removeStorage(STORAGE_KEYS.webdavAuth)
      return
    }
    const saved = getStorage<Partial<WebDavConfig>>(STORAGE_KEYS.webdavAuth)
    if (!saved) {
      setStorage(STORAGE_KEYS.webdavRemember, false)
      return
    }
    this.setData({
      remember: true,
      hasSavedCredentials: true,
      serverUrl: typeof saved.serverUrl === 'string' ? saved.serverUrl : DEFAULT_SERVER,
      remoteDir: typeof saved.remoteDir === 'string' ? saved.remoteDir : DEFAULT_REMOTE_DIR,
      username: typeof saved.username === 'string' ? saved.username : '',
      appPassword: typeof saved.appPassword === 'string' ? saved.appPassword : '',
    })
  },

  onServerChange(e: WechatMiniprogram.CustomEvent) {
    this.setData({ serverUrl: (e.detail.value as string) ?? '' })
  },

  onRemoteDirChange(e: WechatMiniprogram.CustomEvent) {
    this.setData({ remoteDir: (e.detail.value as string) ?? '' })
  },

  onUsernameChange(e: WechatMiniprogram.CustomEvent) {
    this.setData({ username: (e.detail.value as string) ?? '' })
  },

  onPasswordChange(e: WechatMiniprogram.CustomEvent) {
    this.setData({ appPassword: (e.detail.value as string) ?? '' })
  },

  onRememberChange(e: WechatMiniprogram.CustomEvent) {
    const remember = e.detail.value === true
    this.setData({ remember })
    setStorage(STORAGE_KEYS.webdavRemember, remember)
    if (!remember) {
      removeStorage(STORAGE_KEYS.webdavAuth)
      this.setData({ hasSavedCredentials: false })
      toastInfo('已删除本地保存的凭据')
    }
  },

  buildConfig(): WebDavConfig | null {
    const serverUrl = this.data.serverUrl.trim()
    const remoteDir = normalizeRemoteDir(this.data.remoteDir)
    const username = this.data.username.trim()
    const appPassword = this.data.appPassword
    if (!validHttpsUrl(serverUrl)) {
      toastInfo('服务器地址必须使用有效 HTTPS URL')
      return null
    }
    if (!remoteDir || remoteDir.split('/').some((part) => !part || part === '.' || part === '..')) {
      toastInfo('请填写有效的预建远程目录')
      return null
    }
    if (!username || !appPassword) {
      toastInfo('请填写账号和应用密码')
      return null
    }
    this.setData({ serverUrl, remoteDir, username })
    return { serverUrl, remoteDir, username, appPassword }
  },

  onSaveTap() {
    if (this.data.saving) return
    const config = this.buildConfig()
    if (!config) return
    this.setData({ saving: true })
    try {
      setStorage(STORAGE_KEYS.webdavRemember, this.data.remember)
      if (this.data.remember) {
        setStorage(STORAGE_KEYS.webdavAuth, config)
      } else {
        removeStorage(STORAGE_KEYS.webdavAuth)
      }
      this.setData({ hasSavedCredentials: this.data.remember })
      toastInfo(this.data.remember ? '配置与凭据已保存' : '配置仅保留在本页内存')
    } catch {
      toastInfo('配置保存失败')
    } finally {
      this.setData({ saving: false })
    }
  },

  async onTestConnectionTap() {
    if (this.isBusy()) return
    const config = this.buildConfig()
    if (!config) return
    this.setData({ testing: true, cloudStatus: '正在测试连接…', cloudStatusOk: false })
    try {
      const result = await checkWebDavConnection(config)
      this.setData({
        cloudStatus: result.message,
        cloudStatusOk: result.ok,
      })
    } catch (error) {
      this.setData({
        cloudStatus: errorMessage(error),
        cloudStatusOk: false,
      })
    } finally {
      this.setData({ testing: false })
    }
  },

  async onUploadTap() {
    if (this.isBusy()) return
    const config = this.buildConfig()
    if (!config) return
    this.setData({ uploading: true, cloudStatus: '正在上传云端备份…', cloudStatusOk: false })
    try {
      const result = await uploadWebDavBackup(config)
      this.setData({
        cloudStatus: `云端备份完成，SHA-256 校验一致，${formatBytes(result.size)}`,
        cloudStatusOk: true,
        lastBackupText: `有效 ${result.activeItems} 条 / 回收站 ${result.deletedItems} 条 / 分类 ${result.categories} 个`,
      })
      toastSuccess('云端备份完成')
    } catch (error) {
      this.setData({
        cloudStatus: errorMessage(error),
        cloudStatusOk: false,
      })
    } finally {
      this.setData({ uploading: false })
    }
  },

  async onRestoreTap() {
    if (this.isBusy()) return
    const config = this.buildConfig()
    if (!config) return
    wx.showModal({
      title: '恢复云端备份',
      content: '将下载最新云端备份并整库覆盖当前本地数据，恢复前会自动创建本地保护点。',
      confirmText: '恢复',
      confirmColor: '#D54941',
      success: (res) => {
        if (res.confirm) this.doRestore(config)
      },
    })
  },

  async doRestore(config: WebDavConfig) {
    this.setData({ restoring: true, cloudStatus: '正在下载并校验云端备份…', cloudStatusOk: false })
    try {
      const entry = await restoreLatestWebDavBackup(config)
      this.setData({
        cloudStatus: `已恢复云端备份：${entry.fileName}`,
        cloudStatusOk: true,
        lastBackupText: `有效 ${entry.activeItems} 条 / 回收站 ${entry.deletedItems} 条 / 分类 ${entry.categories} 个`,
      })
      toastSuccess('云端恢复完成')
    } catch (error) {
      this.setData({
        cloudStatus: errorMessage(error),
        cloudStatusOk: false,
      })
    } finally {
      this.setData({ restoring: false })
    }
  },

  isBusy(): boolean {
    return this.data.saving || this.data.testing || this.data.uploading || this.data.restoring
  },

  onClearTap() {
    wx.showModal({
      title: '清除授权信息',
      content: '将清空本页账号和应用密码，并删除本地保存的凭据。服务器和远程目录保留。',
      confirmText: '清除',
      confirmColor: '#D54941',
      success: (res) => {
        if (!res.confirm) return
        removeStorage(STORAGE_KEYS.webdavAuth)
        setStorage(STORAGE_KEYS.webdavRemember, false)
        this.setData({
          username: '',
          appPassword: '',
          remember: false,
          hasSavedCredentials: false,
        })
        toastInfo('授权信息已清除')
      },
    })
  },
})
