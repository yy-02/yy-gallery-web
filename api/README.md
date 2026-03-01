# YY Gallery API

基于 Hono + Drizzle ORM + PostgreSQL 的图片画廊后端 API。

## 技术栈

- **Hono** - 轻量级 Web 框架，支持多平台部署
- **Drizzle ORM** - TypeScript ORM
- **PostgreSQL** - 数据库（推荐 Supabase 新加坡区）
- **Sharp** - 图片处理（本地脚本）
- **AWS S3** - 对象存储（兼容交大 S3）

## 部署方案对比

| 平台 | 国内访问 | 免费额度 | 推荐场景 |
|------|----------|----------|----------|
| **Cloudflare Workers** | ⭐⭐⭐⭐⭐ | 10万次/天 | 国内用户为主 |
| Vercel | ⭐⭐ | 100GB/月 | 海外用户为主 |
| Deno Deploy | ⭐⭐⭐⭐ | 100万次/月 | 备选 |

## 快速开始

### 1. 安装依赖

```bash
cd api
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

```env
# Supabase PostgreSQL（选择新加坡区域！）
DATABASE_URL=postgresql://postgres:password@db.xxx.supabase.co:5432/postgres

# 交大 S3 配置
S3_ENDPOINT=https://s3.example.edu.cn
S3_BUCKET=gallery
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_PUBLIC_URL=https://s3.example.edu.cn/gallery
```

### 3. 初始化数据库

在 Supabase SQL Editor 中运行 `drizzle/0000_init.sql`。

### 4. 本地开发

```bash
npm run dev
```

服务将在 http://localhost:3001 启动。

---

## 部署方案一：Cloudflare Workers（推荐，国内访问快）

### 优点
- 国内有节点，访问速度快
- 免费额度大（10万次请求/天）
- 全球边缘部署

### 部署步骤

```bash
# 1. 安装 Wrangler CLI
npm install -g wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. 设置环境变量（在 Cloudflare Dashboard 或命令行）
wrangler secret put DATABASE_URL
wrangler secret put MAPBOX_TOKEN

# 4. 部署
npm run deploy:cf
```

### 注意事项
- Cloudflare Workers 不支持 Node.js 原生模块（如 sharp）
- 图片处理需要使用本地脚本（见下方）

---

## 部署方案二：Vercel

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录并部署
vercel login
vercel

# 设置环境变量
vercel env add DATABASE_URL
vercel env add S3_ENDPOINT
vercel env add S3_BUCKET
vercel env add S3_ACCESS_KEY
vercel env add S3_SECRET_KEY
vercel env add S3_PUBLIC_URL
```

## API 接口

### 照片

| 接口 | 方法 | 说明 |
|------|------|------|
| `/photos/all` | GET | 获取照片列表 |
| `/photos/get?id=` | GET | 获取单张照片 |
| `/photos/lucky` | GET | 随机一张照片 |
| `/photos/cluster` | GET | 照片聚类数据 |

参数：
- `page` - 页码（默认 1）
- `limit` - 每页数量（默认 20）
- `prefecture_id` - 按都道府县筛选
- `city_id` - 按城市筛选

### 地理

| 接口 | 方法 | 说明 |
|------|------|------|
| `/geo/ip` | GET | 获取用户 IP 所在国家 |
| `/geo/countries` | GET | 国家列表 |
| `/geo/prefectures` | GET | 都道府县列表 |
| `/geo/prefecture?id=` | GET | 都道府县详情 |

### 上传

| 接口 | 方法 | 说明 |
|------|------|------|
| `/upload` | POST | 上传照片（自动提取 EXIF） |
| `/upload/batch` | POST | 批量导入照片数据 |

### 地图 Token

| 接口 | 方法 | 说明 |
|------|------|------|
| `/mapbox/token` | GET | 获取 Mapbox Token |
| `/mapkit-js/token` | GET | 获取 Apple MapKit Token |

## 前端配置

在前端项目中，将 API 地址改为你的 Vercel 部署地址：

```typescript
// 将所有 https://api.gallery.boar.ac.cn 替换为
const API_BASE = 'https://your-api.vercel.app'
```

## 批量导入照片

如果你已经有照片上传到 S3，可以使用批量导入接口：

```bash
curl -X POST https://your-api.vercel.app/upload/batch \
  -H "Content-Type: application/json" \
  -d '{
    "photos": [
      {
        "title": "照片标题",
        "thumb_url": "https://s3.example.edu.cn/gallery/photo1_thumb.jpg",
        "thumb_width": 300,
        "thumb_height": 200,
        "large_url": "https://s3.example.edu.cn/gallery/photo1_large.jpg",
        "large_width": 1920,
        "large_height": 1280,
        "datetime": "2024-01-01T12:00:00Z",
        "camera_make": "Sony",
        "camera_model": "ILCE-7M3"
      }
    ]
  }'
```

## 项目结构

```
api/
├── src/
│   ├── index.ts           # Hono 应用入口
│   ├── server.ts          # 本地开发服务器
│   ├── db/
│   │   ├── index.ts       # 数据库连接
│   │   └── schema.ts      # Drizzle 表定义
│   ├── routes/
│   │   ├── photos.ts      # 照片 API
│   │   ├── geo.ts         # 地理 API
│   │   ├── upload.ts      # 上传 API
│   │   └── maptoken.ts    # 地图 Token API
│   ├── lib/
│   │   ├── response.ts    # 响应格式化
│   │   ├── transform.ts   # 数据转换
│   │   ├── s3.ts          # S3 上传
│   │   ├── exif.ts        # EXIF 提取
│   │   └── image.ts       # 图片处理
│   └── middleware/
│       └── cors.ts        # CORS 中间件
├── api/
│   └── index.ts           # Vercel Serverless 入口
├── drizzle/
│   └── 0000_init.sql      # 数据库初始化 SQL
├── package.json
├── tsconfig.json
├── drizzle.config.ts
└── vercel.json
```
