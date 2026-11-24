// pages/webdav-config/webdav-config.ts
// WebDAV 配置与凭据管理；POC-08 前不发起连接、上传或下载。
import type { WebDavConfig } from '../../services/webdav-client'
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

Page({
  data: {
    serverUrl: DEFAULT_SERVER,
    remoteDir: DEFAULT_REMOTE_DIR,
    username: '',
    appPassword: '',
    remember: false,
    hasSavedCredentials: false,
    saving: false,
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
      wx.showToast({ title: '已删除本地保存的凭据', icon: 'none' })
    }
  },

  onSaveTap() {
    if (this.data.saving) return
    const serverUrl = this.data.serverUrl.trim()
    const remoteDir = normalizeRemoteDir(this.data.remoteDir)
    const username = this.data.username.trim()
    const appPassword = this.data.appPassword
    if (!validHttpsUrl(serverUrl)) {
      wx.showToast({ title: '服务器地址必须使用有效 HTTPS URL', icon: 'none' })
      return
    }
    if (!remoteDir || remoteDir.split('/').some((part) => !part || part === '.' || part === '..')) {
      wx.showToast({ title: '请填写有效的预建远程目录', icon: 'none' })
      return
    }
    if (!username || !appPassword) {
      wx.showToast({ title: '请填写账号和应用密码', icon: 'none' })
      return
    }
    this.setData({ saving: true, serverUrl, remoteDir, username })
    try {
      setStorage(STORAGE_KEYS.webdavRemember, this.data.remember)
      if (this.data.remember) {
        const config: WebDavConfig = { serverUrl, remoteDir, username, appPassword }
        setStorage(STORAGE_KEYS.webdavAuth, config)
      } else {
        removeStorage(STORAGE_KEYS.webdavAuth)
      }
      this.setData({ hasSavedCredentials: this.data.remember })
      wx.showToast({
        title: this.data.remember ? '配置与凭据已保存' : '配置仅保留在本页内存',
        icon: 'none',
      })
    } catch {
      wx.showToast({ title: '配置保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
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
        wx.showToast({ title: '授权信息已清除', icon: 'none' })
      },
    })
  },
})
