// constants/image-prefixes.ts
// 图片 URL 前缀预设：新建/编辑物品填写图片链接时，提供前缀选择（默认 gcore），也可完全自定义。
// 说明：raw 前缀虽可填入，但已实测网络层被阻断（ERR_CONNECTION_REFUSED），首期默认 gcore。

export interface ImagePrefixOption {
  key: string
  label: string
  prefix: string
}

/** 预设前缀：gcore 默认，raw 备选（已实测网络层不可用） */
export const IMAGE_PREFIX_OPTIONS: ImagePrefixOption[] = [
  {
    key: 'gcore',
    label: 'gcore.jsdelivr.net',
    prefix: 'https://gcore.jsdelivr.net/gh/ybs15090/ybs-tuchuang-1@main/',
  },
  {
    key: 'raw',
    label: 'raw.githubusercontent.com',
    prefix: 'https://raw.githubusercontent.com/ybs15090/ybs-tuchuang-1/main/',
  },
]

/** 默认前缀 key */
export const IMAGE_PREFIX_DEFAULT = 'gcore'

/** “完全自定义”前缀的 key（选择后由用户自由输入完整 URL） */
export const IMAGE_PREFIX_CUSTOM = 'custom'
