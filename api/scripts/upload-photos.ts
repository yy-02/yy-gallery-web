/**
 * 本地图片处理和上传脚本
 * 
 * 支持输入格式：JPEG, PNG, WebP, HEIC, TIFF
 * 输出格式：WebP（体积小、质量好）
 * 
 * 使用方法：
 * npx tsx scripts/upload-photos.ts ./photos-folder
 * npx tsx scripts/upload-photos.ts ./single-photo.jpg
 * 
 * 描述文件（可选）：
 * 在照片文件夹中创建 descriptions.json，格式如下：
 * {
 *   "DSC_1234.jpg": { "zh": "中文描述", "en": "English description" },
 *   "DSC_1235.jpg": { "zh": "...", "en": "..." }
 * }
 * 
 * 注意：
 * - NEF/DNG 等 RAW 格式需要先用 Lightroom 导出为 JPEG
 * - HEIC 格式需要系统支持（Windows 可能需要安装 HEIC 编解码器）
 */

import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import postgres from 'postgres'
import 'dotenv/config'

// 输出尺寸配置
const SIZES = {
  thumb: 400,    // 缩略图（瀑布流）
  medium: 1200,  // 中等尺寸（弹窗预览）
  large: 2400,   // 大图（详情页）
}

// WebP 质量配置
const WEBP_QUALITY = {
  thumb: 80,
  medium: 85,
  large: 90,
}

// 支持的输入格式
const SUPPORTED_FORMATS = /\.(jpg|jpeg|png|webp|heic|heif|tiff|tif)$/i

// S3 客户端配置
const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
  forcePathStyle: true,
})

const bucket = process.env.S3_BUCKET || 'yy-gallery'
const publicUrl = process.env.S3_PUBLIC_URL

// 数据库连接
const sql = postgres(process.env.DATABASE_URL!)

// 描述配置类型
interface PhotoConfig {
  zh?: string
  en?: string
  country?: string
  prefecture?: string
  city?: string
  place?: string
}

interface DescriptionConfig {
  [filename: string]: PhotoConfig
}

// 全局描述配置
let descriptions: DescriptionConfig = {}

// 地区 ID 缓存（避免重复查询）
const countryCache: Map<string, number> = new Map()
const prefectureCache: Map<string, number> = new Map()
const cityCache: Map<string, number> = new Map()
const placeCache: Map<string, number> = new Map()

interface ExifData {
  datetime?: Date
  exposureTime?: number
  exposureTimeRat?: string
  fNumber?: number
  iso?: number
  focalLength?: number
  cameraMake?: string
  cameraModel?: string
  lensMake?: string
  lensModel?: string
  longitude?: number
  latitude?: number
  altitude?: number
}

/**
 * 从图片中提取 EXIF 信息
 */
async function extractExif(buffer: Buffer): Promise<ExifData> {
  const result: ExifData = {}

  try {
    const metadata = await sharp(buffer).metadata()
    
    if (metadata.exif) {
      // 动态导入 exif-reader
      const ExifReader = (await import('exif-reader')).default
      const exif = ExifReader(metadata.exif) as Record<string, any>
      
      // 拍摄时间
      if (exif.DateTimeOriginal) {
        result.datetime = exif.DateTimeOriginal
      } else if (exif.CreateDate) {
        result.datetime = exif.CreateDate
      }

      // 曝光时间
      if (exif.ExposureTime) {
        result.exposureTime = exif.ExposureTime
        if (exif.ExposureTime < 1) {
          result.exposureTimeRat = `1/${Math.round(1 / exif.ExposureTime)}`
        } else {
          result.exposureTimeRat = `${exif.ExposureTime}s`
        }
      }

      // 光圈
      if (exif.FNumber) {
        result.fNumber = exif.FNumber
      }

      // ISO
      if (exif.ISO) {
        result.iso = exif.ISO
      } else if (exif.ISOSpeedRatings) {
        result.iso = Array.isArray(exif.ISOSpeedRatings) 
          ? exif.ISOSpeedRatings[0] 
          : exif.ISOSpeedRatings
      }

      // 焦距
      if (exif.FocalLength) {
        result.focalLength = exif.FocalLength
      }

      // 相机信息
      if (exif.Make) {
        result.cameraMake = String(exif.Make).trim().replace(/\u0000/g, '')
      }
      if (exif.Model) {
        result.cameraModel = String(exif.Model).trim().replace(/\u0000/g, '')
      }

      // 镜头信息
      if (exif.LensMake) {
        result.lensMake = String(exif.LensMake).trim().replace(/\u0000/g, '')
      }
      if (exif.LensModel) {
        result.lensModel = String(exif.LensModel).trim().replace(/\u0000/g, '')
      }

      // GPS 信息
      if (exif.GPSLatitude && exif.GPSLongitude) {
        const latRef = exif.GPSLatitudeRef || 'N'
        const lonRef = exif.GPSLongitudeRef || 'E'
        
        let lat = exif.GPSLatitude
        let lon = exif.GPSLongitude

        // 转换度分秒为十进制
        if (Array.isArray(lat)) {
          lat = lat[0] + lat[1] / 60 + lat[2] / 3600
        }
        if (Array.isArray(lon)) {
          lon = lon[0] + lon[1] / 60 + lon[2] / 3600
        }

        result.latitude = latRef === 'S' ? -lat : lat
        result.longitude = lonRef === 'W' ? -lon : lon
      }

      // 海拔
      if (exif.GPSAltitude) {
        result.altitude = exif.GPSAltitude
      }
    }
  } catch (e) {
    console.warn('  Warning: Failed to extract EXIF:', (e as Error).message)
  }

  return result
}

/**
 * 获取或创建国家
 */
async function getOrCreateCountry(name: string): Promise<number> {
  if (countryCache.has(name)) {
    return countryCache.get(name)!
  }

  const existing = await sql`SELECT id FROM countries WHERE name = ${name} LIMIT 1`
  if (existing.length > 0) {
    countryCache.set(name, existing[0].id)
    return existing[0].id
  }

  // 生成国家代码（简单取前两个字母大写）
  const code = name.substring(0, 2).toUpperCase()
  const [newCountry] = await sql`
    INSERT INTO countries (name, code, center, extent, zoom)
    VALUES (${name}, ${code}, '[0,0]', '[0,0,0,0]', '[1,1,1]')
    RETURNING id
  `
  console.log(`    Created country: ${name} [ID: ${newCountry.id}]`)
  countryCache.set(name, newCountry.id)
  return newCountry.id
}

/**
 * 获取或创建省/州
 */
async function getOrCreatePrefecture(name: string, countryId: number): Promise<number> {
  const cacheKey = `${countryId}-${name}`
  if (prefectureCache.has(cacheKey)) {
    return prefectureCache.get(cacheKey)!
  }

  const existing = await sql`
    SELECT id FROM prefectures WHERE name = ${name} AND country_id = ${countryId} LIMIT 1
  `
  if (existing.length > 0) {
    prefectureCache.set(cacheKey, existing[0].id)
    return existing[0].id
  }

  const [newPref] = await sql`
    INSERT INTO prefectures (name, country_id) VALUES (${name}, ${countryId}) RETURNING id
  `
  console.log(`    Created prefecture: ${name} [ID: ${newPref.id}]`)
  prefectureCache.set(cacheKey, newPref.id)
  return newPref.id
}

/**
 * 获取或创建城市
 */
async function getOrCreateCity(name: string, prefectureId: number): Promise<number> {
  const cacheKey = `${prefectureId}-${name}`
  if (cityCache.has(cacheKey)) {
    return cityCache.get(cacheKey)!
  }

  const existing = await sql`
    SELECT id FROM cities WHERE name = ${name} AND prefecture_id = ${prefectureId} LIMIT 1
  `
  if (existing.length > 0) {
    cityCache.set(cacheKey, existing[0].id)
    return existing[0].id
  }

  const [newCity] = await sql`
    INSERT INTO cities (name, prefecture_id) VALUES (${name}, ${prefectureId}) RETURNING id
  `
  console.log(`    Created city: ${name} [ID: ${newCity.id}]`)
  cityCache.set(cacheKey, newCity.id)
  return newCity.id
}

/**
 * 获取或创建地点
 */
async function getOrCreatePlace(name: string, cityId: number, longitude?: number, latitude?: number): Promise<number> {
  const cacheKey = `${cityId}-${name}`
  if (placeCache.has(cacheKey)) {
    return placeCache.get(cacheKey)!
  }

  const existing = await sql`
    SELECT id FROM places WHERE name = ${name} AND city_id = ${cityId} LIMIT 1
  `
  if (existing.length > 0) {
    placeCache.set(cacheKey, existing[0].id)
    return existing[0].id
  }

  const [newPlace] = await sql`
    INSERT INTO places (name, city_id, longitude, latitude) 
    VALUES (${name}, ${cityId}, ${longitude || null}, ${latitude || null}) 
    RETURNING id
  `
  console.log(`    Created place: ${name} [ID: ${newPlace.id}]`)
  placeCache.set(cacheKey, newPlace.id)
  return newPlace.id
}

/**
 * 上传文件到 S3/R2
 */
async function uploadToS3(buffer: Buffer, key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000', // 缓存一年
  })

  await s3Client.send(command)
  return `${publicUrl}/${key}`
}

/**
 * 处理并上传单张图片
 */
async function processAndUpload(filePath: string) {
  const filenameWithExt = path.basename(filePath)
  const filename = path.basename(filePath, path.extname(filePath))
  console.log(`\nProcessing: ${filename}`)
  
  // 获取配置
  const config = descriptions[filenameWithExt] || {}
  if (config.zh || config.en) {
    console.log(`  Description: ${config.zh || config.en}`)
  }
  if (config.city) {
    console.log(`  Location: ${config.country || ''} > ${config.prefecture || ''} > ${config.city}`)
  }
  
  // 读取文件
  const buffer = fs.readFileSync(filePath)
  
  // 使用 sharp 加载图片（自动处理 HEIC 等格式）
  const image = sharp(buffer, { failOnError: false })
  const metadata = await image.metadata()
  
  console.log(`  Original: ${metadata.width}x${metadata.height}, format: ${metadata.format}`)

  // 提取 EXIF
  const exif = await extractExif(buffer)
  if (exif.cameraMake) {
    console.log(`  Camera: ${exif.cameraMake} ${exif.cameraModel || ''}`)
  }
  if (exif.datetime) {
    console.log(`  Date: ${exif.datetime.toISOString()}`)
  }
  if (exif.latitude && exif.longitude) {
    console.log(`  GPS: ${exif.latitude.toFixed(4)}, ${exif.longitude.toFixed(4)}`)
  }

  // 生成唯一文件名
  const timestamp = Date.now()
  const randomStr = Math.random().toString(36).substring(2, 6)
  const baseKey = `photos/${timestamp}_${randomStr}`

  const results: Record<string, { url: string; width: number; height: number }> = {}

  // 生成各尺寸的 WebP
  for (const [sizeName, maxWidth] of Object.entries(SIZES)) {
    const quality = WEBP_QUALITY[sizeName as keyof typeof WEBP_QUALITY]
    
    let processedImage = image.clone()
    
    // 如果原图比目标尺寸大，则缩放
    if ((metadata.width || 0) > maxWidth) {
      processedImage = processedImage.resize(maxWidth, null, { 
        withoutEnlargement: true,
        kernel: 'lanczos3' // 高质量缩放算法
      })
    }
    
    // 转换为 WebP
    const { data, info } = await processedImage
      .webp({ quality, effort: 4 })
      .toBuffer({ resolveWithObject: true })
    
    // 上传
    const key = `${baseKey}_${sizeName}.webp`
    const url = await uploadToS3(data, key, 'image/webp')
    
    results[sizeName] = { 
      url, 
      width: info.width, 
      height: info.height 
    }
    
    console.log(`  ${sizeName}: ${info.width}x${info.height}, ${(data.length / 1024).toFixed(0)}KB`)
  }

  // 上传原图（保留最高质量，用于 HDR 显示或下载）
  const originalWebp = await image
    .clone()
    .webp({ quality: 95, effort: 6 })
    .toBuffer({ resolveWithObject: true })
  
  const originalKey = `${baseKey}_original.webp`
  const originalUrl = await uploadToS3(originalWebp.data, originalKey, 'image/webp')
  results.original = { 
    url: originalUrl, 
    width: originalWebp.info.width, 
    height: originalWebp.info.height 
  }
  console.log(`  original: ${originalWebp.info.width}x${originalWebp.info.height}, ${(originalWebp.data.length / 1024).toFixed(0)}KB`)

  // 处理相机信息
  let cameraId: number | null = null
  if (exif.cameraMake && exif.cameraModel) {
    // 查找或创建制造商
    let manufacture = await sql`
      SELECT id FROM manufactures WHERE name = ${exif.cameraMake} LIMIT 1
    `
    
    let manufactureId: number
    if (manufacture.length === 0) {
      const [newManufacture] = await sql`
        INSERT INTO manufactures (name) VALUES (${exif.cameraMake}) RETURNING id
      `
      manufactureId = newManufacture.id
    } else {
      manufactureId = manufacture[0].id
    }

    // 查找或创建相机
    let camera = await sql`
      SELECT id FROM cameras WHERE model = ${exif.cameraModel} LIMIT 1
    `
    
    if (camera.length === 0) {
      const [newCamera] = await sql`
        INSERT INTO cameras (model, manufacture_id) VALUES (${exif.cameraModel}, ${manufactureId}) RETURNING id
      `
      cameraId = newCamera.id
    } else {
      cameraId = camera[0].id
    }
  }

  // 处理镜头信息
  let lensId: number | null = null
  if (exif.lensModel) {
    let lensManufactureId: number | null = null
    
    if (exif.lensMake) {
      let manufacture = await sql`
        SELECT id FROM manufactures WHERE name = ${exif.lensMake} LIMIT 1
      `
      if (manufacture.length === 0) {
        const [newManufacture] = await sql`
          INSERT INTO manufactures (name) VALUES (${exif.lensMake}) RETURNING id
        `
        lensManufactureId = newManufacture.id
      } else {
        lensManufactureId = manufacture[0].id
      }
    }

    let lens = await sql`
      SELECT id FROM lenses WHERE model = ${exif.lensModel} LIMIT 1
    `
    
    if (lens.length === 0) {
      const [newLens] = await sql`
        INSERT INTO lenses (model, manufacture_id) VALUES (${exif.lensModel}, ${lensManufactureId}) RETURNING id
      `
      lensId = newLens.id
    } else {
      lensId = lens[0].id
    }
  }

  // 处理地区信息
  let cityId: number | null = null
  let placeId: number | null = null
  
  if (config.country && config.prefecture && config.city) {
    const countryId = await getOrCreateCountry(config.country)
    const prefectureId = await getOrCreatePrefecture(config.prefecture, countryId)
    cityId = await getOrCreateCity(config.city, prefectureId)
    
    if (config.place) {
      placeId = await getOrCreatePlace(config.place, cityId, exif.longitude, exif.latitude)
    }
  }

  // 写入数据库
  const [photo] = await sql`
    INSERT INTO photos (
      title, description_zh, description_en,
      thumb_url, thumb_width, thumb_height,
      medium_url, medium_width, medium_height,
      large_url, large_width, large_height,
      hdr_url, hdr_width, hdr_height,
      camera_id, lens_id, datetime, exposure_time, exposure_time_rat,
      f_number, photographic_sensitivity, focal_length,
      has_location, longitude, latitude, altitude,
      city_id, place_id,
      timezone
    ) VALUES (
      ${filename}, ${config.zh || null}, ${config.en || null},
      ${results.thumb.url}, ${results.thumb.width}, ${results.thumb.height},
      ${results.medium.url}, ${results.medium.width}, ${results.medium.height},
      ${results.large.url}, ${results.large.width}, ${results.large.height},
      ${results.original.url}, ${results.original.width}, ${results.original.height},
      ${cameraId}, ${lensId}, ${exif.datetime || null}, ${exif.exposureTime || null}, ${exif.exposureTimeRat || null},
      ${exif.fNumber || null}, ${exif.iso || null}, ${exif.focalLength || null},
      ${!!(exif.latitude && exif.longitude)}, ${exif.longitude || null}, ${exif.latitude || null}, ${exif.altitude || null},
      ${cityId}, ${placeId},
      'GMT+8'
    ) RETURNING id
  `

  console.log(`  ✓ Saved to database with ID: ${photo.id}`)
  return photo.id
}

/**
 * 主函数
 */
async function main() {
  console.log('='.repeat(50))
  console.log('YY Gallery Photo Uploader')
  console.log('='.repeat(50))
  
  // 检查环境变量
  const requiredEnvVars = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_PUBLIC_URL', 'DATABASE_URL']
  const missingVars = requiredEnvVars.filter(v => !process.env[v])
  if (missingVars.length > 0) {
    console.error(`\nError: Missing environment variables: ${missingVars.join(', ')}`)
    console.error('Please check your .env file')
    process.exit(1)
  }

  const inputPath = process.argv[2]
  
  if (!inputPath) {
    console.log('\nUsage:')
    console.log('  npx tsx scripts/upload-photos.ts <folder-or-file>')
    console.log('\nExamples:')
    console.log('  npx tsx scripts/upload-photos.ts ./my-photos')
    console.log('  npx tsx scripts/upload-photos.ts "D:\\Photos\\vacation.jpg"')
    console.log('\nSupported formats: JPEG, PNG, WebP, HEIC, TIFF')
    console.log('Note: RAW files (NEF, DNG) should be exported from Lightroom first')
    process.exit(1)
  }

  // 获取文件列表
  const stat = fs.statSync(inputPath)
  let files: string[] = []

  if (stat.isDirectory()) {
    const entries = fs.readdirSync(inputPath)
    files = entries
      .filter(f => SUPPORTED_FORMATS.test(f))
      .map(f => path.join(inputPath, f))
      .sort()
  } else {
    if (!SUPPORTED_FORMATS.test(inputPath)) {
      console.error(`\nError: Unsupported file format: ${path.extname(inputPath)}`)
      console.error('Supported formats: JPEG, PNG, WebP, HEIC, TIFF')
      process.exit(1)
    }
    files = [inputPath]
  }

  if (files.length === 0) {
    console.log('\nNo supported image files found')
    process.exit(0)
  }

  // 尝试加载描述文件
  const descriptionsPath = stat.isDirectory() 
    ? path.join(inputPath, 'descriptions.json')
    : path.join(path.dirname(inputPath), 'descriptions.json')
  
  if (fs.existsSync(descriptionsPath)) {
    try {
      const content = fs.readFileSync(descriptionsPath, 'utf-8')
      descriptions = JSON.parse(content)
      const descCount = Object.keys(descriptions).filter(k => !k.startsWith('_')).length
      console.log(`\nLoaded descriptions for ${descCount} photos from descriptions.json`)
    } catch (e) {
      console.warn(`Warning: Failed to parse descriptions.json: ${(e as Error).message}`)
    }
  } else {
    console.log('\nNo descriptions.json found (optional)')
  }

  console.log(`\nFound ${files.length} image(s) to process`)
  console.log(`Bucket: ${bucket}`)
  console.log(`Public URL: ${publicUrl}`)

  // 处理每张图片
  let successCount = 0
  let failCount = 0

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    console.log(`\n[${i + 1}/${files.length}] ${path.basename(file)}`)
    
    try {
      await processAndUpload(file)
      successCount++
    } catch (e) {
      console.error(`  ✗ Failed:`, (e as Error).message)
      failCount++
    }
  }

  // 总结
  console.log('\n' + '='.repeat(50))
  console.log(`Done! Success: ${successCount}, Failed: ${failCount}`)
  console.log('='.repeat(50))

  await sql.end()
}

main().catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
