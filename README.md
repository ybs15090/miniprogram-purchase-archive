# 购买产品图文展示小程序

一个基于 **微信原生小程序 + TypeScript + TDesign** 的物品图文档案管理应用，用于记录购买物品的封面/详情图片、金额、购买信息与多级分类，并支持数据统计、图片缓存以及本地 / WebDAV 云端备份。

![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![TDesign](https://img.shields.io/badge/TDesign%20MiniProgram-1.18-0052D9)
![微信小程序](https://img.shields.io/badge/微信小程序-原生-07C160?logo=wechat&logoColor=white)

## 界面预览

| 首页 | 分类 |
|:---:|:---:|
| ![首页预览](docs/img/首页预览图-1.webp) | ![分类预览](docs/img/分类预览图-1.webp) |

## 功能特性

- **物品档案管理**：新建、编辑、详情、复制，以及软删除（回收站可恢复）。
- **图文展示**：封面图 + 多张详情图，点击即可大图预览；图片本地缓存、按需加载。
- **购买信息记录**：实际支付金额、数量、单件均价、购买时间、购买平台、订单编号、商品链接。
- **多级分类**：物品与分类多对多关联，支持分类管理（增删改）。
- **数据统计**：有效物品数、累计支出、平均单件支出、各分类计数与金额，口径全站统一。
- **图片缓存**：URL 经 FNV-1a 哈希派生文件名，按需下载、并发受限、可手动清空。
- **数据备份**：本地备份 / 导出 JSON / 整库恢复，支持 WebDAV（坚果云）云端备份与三份轮转。
- **数据安全**：A/B 双版本本地数据库交替写入，revision 版本控制，损坏自动回退。

## 技术栈

- 微信原生小程序（`glass-easel` 组件框架，基础库 3.18.0）
- TypeScript 5.9
- TDesign MiniProgram 组件库
- 自定义 tabBar
- 本地文件系统存储（`wx.env.USER_DATA_PATH`，非云开发）

## 目录结构

```
miniprogram-3/
├── miniprogram/              # 小程序源码
│   ├── app.ts / app.json / app.wxss
│   ├── pages/                # 页面
│   │   ├── home/             #   首页（物品列表 + 统计）
│   │   ├── category/         #   分类浏览
│   │   ├── create/           #   新建物品
│   │   ├── mine/             #   我的（备份 / 缓存 / 配置入口）
│   │   ├── item-detail/      #   物品详情
│   │   ├── item-edit/        #   物品编辑
│   │   ├── category-manage/  #   分类管理
│   │   ├── recycle-bin/      #   回收站
│   │   ├── image-cache/      #   图片缓存
│   │   ├── backup/           #   备份与恢复
│   │   └── webdav-config/    #   WebDAV 配置
│   ├── components/           # 通用组件（item-card / item-form / empty-state 等）
│   ├── services/             # 服务层（物品 / 分类 / 统计 / 备份 / WebDAV / 图片缓存）
│   ├── repositories/         # 仓储层（数据访问）
│   ├── storage/              # 存储层（文件系统 + Storage 封装、A/B 双库）
│   ├── models/               # 数据模型
│   ├── utils/                # 工具（金额 / 日期 / 哈希 / 校验 / 提示）
│   ├── constants/            # 常量（路由 / 存储键 / 图片前缀）
│   └── custom-tab-bar/       # 自定义底部导航
├── docs/img/                 # 文档预览图
├── typings/                  # 全局类型定义
├── package.json
├── project.config.json
└── tsconfig.json
```

## 快速开始

### 环境要求

- [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
- Node.js（用于安装依赖）

### 运行步骤

1. 克隆并安装依赖：

   ```bash
   git clone <repository-url>
   cd miniprogram-3
   npm install
   ```

2. 用微信开发者工具导入项目根目录，在「详情 → 本地设置」中填入你自己的 AppID。

3. 构建 npm 依赖（工具 → 构建 npm），使 `tdesign-miniprogram` 生效。

4. 编译运行即可。TypeScript 由微信开发者工具的编译器插件（`useCompilerPlugins: typescript`）自动编译。

> 也可直接运行 `npm run tsc:check` 做类型检查。

## 数据存储与备份

- **本地存储**：业务数据写入用户文件系统（`USER_DATA_PATH`），采用 A/B 双副本 JSON 数据库交替安全写入，写入后回读校验，任一副本损坏自动回退另一副本，双库损坏时停止写入以保护数据。
- **备份**：支持导出 / 导入本地 JSON 备份文件；支持配置 WebDAV（如坚果云）进行云端备份，云端以双 manifest + SHA-256 回读校验 + 三份轮转保证一致性。

## 分层架构

```
Page（页面/交互）
   └── Service（业务逻辑与校验）
         ├── Repository（数据读写）
         │      └── Storage（文件系统 / Storage 封装）
         └── Model（类型定义）
```

页面不直接操作文件系统或 Storage，统一经 Repository / Storage 层实现，保证数据一致性与可测试性。

## License

待定
