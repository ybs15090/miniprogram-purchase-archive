// services/webdav-client.ts
// 坚果云 WebDAV 客户端：仅使用 HEAD/GET/PUT/DELETE（PROPFIND/MKCOL 已被真机确认不可用）。
// 传输与业务校验分离；本文件只负责远程文件操作。
//
// ⚠️ 待验证状态：
// - 单个动词（HEAD/GET/PUT/DELETE + Basic Auth）已在合法域名校验开启的真机 PoC 中通过（POC-06/07）；
// - POC-08（双 manifest、SHA-256 回读、三份轮转、pendingDeletes 重试）端到端尚未验证；
//   阶段 6 仅提供配置与凭据管理，完整备份/恢复编排待验证通过后另行授权接入。

export interface RemoteBackup {
  name: string
  exportedAt: number
  schemaVersion: number
  sourceRevision: number
  size: number
}

export interface WebDavClient {
  testConnection(): Promise<boolean>
  listBackups(): Promise<RemoteBackup[]>
  uploadBackup(localPath: string): Promise<void>
  downloadBackup(name: string): Promise<string>
  deleteBackup(name: string): Promise<void>
}

export interface WebDavConfig {
  /** 服务器地址，如 https://dav.jianguoyun.com/dav/ */
  serverUrl: string
  /** 远程目录名（须由用户在坚果云预先创建），如 PurchaseArchive */
  remoteDir: string
  /** 坚果云账号邮箱 */
  username: string
  /** 应用密码（仅内存，不落盘，除非用户开启"记住应用密码"） */
  appPassword: string
}

function base64Encode(s: string): string {
  // wx.request 的 header 不接受非 ASCII，Basic Auth 凭据按 UTF-8 编码
  const bytes: number[] = []
  for (let i = 0; i < s.length; i++) {
    const code = s.codePointAt(i)
    if (code === undefined) break
    if (code > 0xffff) i++
    // 简易 UTF-8 编码（凭据仅含邮箱/密码常规字符）
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  return wx.arrayBufferToBase64(new Uint8Array(bytes).buffer)
}

interface RequestResult {
  statusCode: number
  data: string
}

class WebDavClientImpl implements WebDavClient {
  private readonly config: WebDavConfig

  constructor(config: WebDavConfig) {
    this.config = config
  }

  private authHeader(): Record<string, string> {
    const token = base64Encode(`${this.config.username}:${this.config.appPassword}`)
    return { Authorization: `Basic ${token}` }
  }

  /** 远程文件完整 URL */
  private fileUrl(name: string): string {
    const base = this.config.serverUrl.endsWith('/') ? this.config.serverUrl : `${this.config.serverUrl}/`
    const dir = this.config.remoteDir.replace(/^\/+|\/+$/g, '')
    return dir ? `${base}${dir}/${name}` : `${base}${name}`
  }

  private request(method: 'HEAD' | 'GET' | 'PUT' | 'DELETE', url: string, data?: string): Promise<RequestResult> {
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method,
        header: {
          ...this.authHeader(),
          ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        data: data as string | undefined,
        success: (res) => {
          const statusCode = res.statusCode
          const body = typeof res.data === 'string' ? res.data : ''
          resolve({ statusCode, data: body })
        },
        fail: (err) => reject(new Error(err.errMsg)),
      })
    })
  }

  /** 连接测试：HEAD 远程目录（405/200 均视为可连接；401/403 为认证失败） */
  async testConnection(): Promise<boolean> {
    const dirUrl = this.fileUrl('').slice(0, -1)
    const res = await this.request('HEAD', dirUrl)
    return res.statusCode === 200 || res.statusCode === 405 || res.statusCode === 404
  }

  /**
   * 读取远程 manifest（A/B 双版本，GET 均失败视为无备份）。
   * 完整的 revision 选择与校验编排属于 POC-08/阶段 6，此处仅提供原语。
   */
  async getManifest(slot: 'a' | 'b'): Promise<string | null> {
    const res = await this.request('GET', this.fileUrl(`manifest-${slot}.json`))
    if (res.statusCode !== 200) return null
    return res.data
  }

  /** PUT 写入远程文件；仅接受 200/201/204 为成功 */
  async putText(name: string, content: string): Promise<void> {
    const res = await this.request('PUT', this.fileUrl(name), content)
    if (res.statusCode !== 200 && res.statusCode !== 201 && res.statusCode !== 204) {
      throw new Error(`上传失败，状态码 ${res.statusCode}`)
    }
  }

  /** GET 读取远程文件文本 */
  async getText(name: string): Promise<string> {
    const res = await this.request('GET', this.fileUrl(name))
    if (res.statusCode !== 200) {
      throw new Error(`下载失败，状态码 ${res.statusCode}`)
    }
    return res.data
  }

  /** DELETE 删除远程文件；仅接受 200/204 为成功 */
  async deleteText(name: string): Promise<void> {
    const res = await this.request('DELETE', this.fileUrl(name))
    if (res.statusCode !== 200 && res.statusCode !== 204) {
      throw new Error(`删除失败，状态码 ${res.statusCode}`)
    }
  }

  /** 以下编排方法为阶段 6 占位：POC-08 端到端验证通过前不实现 */
  async listBackups(): Promise<RemoteBackup[]> {
    throw new Error('待 POC-08 端到端验证后实现（阶段 6）')
  }

  async uploadBackup(_localPath: string): Promise<void> {
    void _localPath
    throw new Error('待 POC-08 端到端验证后实现（阶段 6）')
  }

  async downloadBackup(_name: string): Promise<string> {
    void _name
    throw new Error('待 POC-08 端到端验证后实现（阶段 6）')
  }

  async deleteBackup(_name: string): Promise<void> {
    void _name
    throw new Error('待 POC-08 端到端验证后实现（阶段 6）')
  }
}

/** 创建 WebDAV 客户端（凭据由调用方在页面内存中持有） */
export function createWebDavClient(config: WebDavConfig): WebDavClient {
  return new WebDavClientImpl(config)
}
