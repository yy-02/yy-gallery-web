/**
 * 本地图片处理和上传脚本
 * 
 * 支持输入格式：JPEG, PNG, WebP, AVIF, HEIC, TIFF
 * 输出格式：AVIF（体积小、质量好）
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
 * - AVIF 输入需要系统安装 ffmpeg
 * - HEIC 格式需要系统支持
 */

import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import postgres from 'postgres'
import { execSync } from 'child_process'
import os from 'os'
import 'dotenv/config'

// 输出尺寸配置
const SIZES = {
  thumb: 400,    // 缩略图（瀑布流）
  medium: 1200,  // 中等尺寸（弹窗预览）
  large: 3840,   // 大图（详情页，4K）
}

// AVIF 质量配置（0-100，越高越好）
const AVIF_QUALITY = {
  thumb: 75,
  medium: 82,
  large: 92,     // 4K 使用更高质量
}

// 使用 CPU 编码以支持 10-bit 4:4:4 色度采样（最高质量）
console.log('ℹ 使用 CPU 编码 (libaom-av1, 10-bit 4:4:4)')

// 支持的输入格式
const SUPPORTED_FORMATS = /\.(jpg|jpeg|png|webp|avif|heic|heif|tiff|tif)$/i

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
 * 使用 ffprobe 从 AVIF 文件提取 EXIF 信息
 */
async function extractExifWithFfprobe(filePath: string): Promise<ExifData> {
  const result: ExifData = {}
  
  try {
    // 使用 exiftool 提取（比 ffprobe 更完整）
    // 如果没有 exiftool，回退到 ffprobe
    let jsonOutput: string
    
    try {
      jsonOutput = execSync(`exiftool -json "${filePath}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    } catch {
      // exiftool 不可用，使用 ffprobe
      console.log('  Using ffprobe for EXIF (install exiftool for better results)')
      const ffprobeOutput = execSync(`ffprobe -v quiet -print_format json -show_format "${filePath}"`, { encoding: 'utf-8' })
      const data = JSON.parse(ffprobeOutput)
      // ffprobe 的 EXIF 信息较有限，返回空结果让调用方处理
      return result
    }
    
    const data = JSON.parse(jsonOutput)[0]
    
    // 拍摄时间
    if (data.DateTimeOriginal) {
      // exiftool 格式: "2025:11:23 16:45:35"
      const dtStr = data.DateTimeOriginal.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
      result.datetime = new Date(dtStr)
      console.log(`  DateTime: ${result.datetime.toISOString()}`)
    }
    
    // 曝光时间
    if (data.ExposureTime) {
      // 可能是 "1/50" 或 "0.02"
      if (typeof data.ExposureTime === 'string' && data.ExposureTime.includes('/')) {
        const [num, den] = data.ExposureTime.split('/')
        result.exposureTime = parseInt(num) / parseInt(den)
        result.exposureTimeRat = data.ExposureTime
      } else {
        result.exposureTime = parseFloat(data.ExposureTime)
        if (result.exposureTime < 1) {
          result.exposureTimeRat = `1/${Math.round(1 / result.exposureTime)}`
        } else {
          result.exposureTimeRat = `${result.exposureTime}s`
        }
      }
      console.log(`  Exposure: ${result.exposureTimeRat}`)
    }
    
    // 光圈
    if (data.FNumber) {
      result.fNumber = parseFloat(data.FNumber)
      console.log(`  Aperture: f/${result.fNumber}`)
    }
    
    // ISO
    if (data.ISO) {
      result.iso = parseInt(data.ISO)
      console.log(`  ISO: ${result.iso}`)
    }
    
    // 焦距
    if (data.FocalLength) {
      // 格式可能是 "57 mm" 或 "57"
      result.focalLength = parseFloat(data.FocalLength)
      console.log(`  Focal Length: ${result.focalLength}mm`)
    }
    
    // 相机信息
    if (data.Make) {
      result.cameraMake = String(data.Make).trim()
    }
    if (data.Model) {
      result.cameraModel = String(data.Model).trim()
    }
    if (result.cameraMake || result.cameraModel) {
      console.log(`  Camera: ${result.cameraMake || ''} ${result.cameraModel || ''}`.trim())
    }
    
    // 镜头信息
    if (data.LensMake) {
      result.lensMake = String(data.LensMake).trim()
    }
    if (data.LensModel) {
      result.lensModel = String(data.LensModel).trim()
    }
    if (result.lensMake || result.lensModel) {
      console.log(`  Lens: ${result.lensMake || ''} ${result.lensModel || ''}`.trim())
    }
    
    // GPS 信息
    if (data.GPSLatitude && data.GPSLongitude) {
      // exiftool 格式: "36 deg 32' 39.72\" N" 或直接数值
      result.latitude = parseGpsCoordinate(data.GPSLatitude, data.GPSLatitudeRef)
      result.longitude = parseGpsCoordinate(data.GPSLongitude, data.GPSLongitudeRef)
      console.log(`  GPS: ${result.latitude?.toFixed(6)}, ${result.longitude?.toFixed(6)}`)
    }
    
    // 海拔
    if (data.GPSAltitude) {
      result.altitude = parseFloat(data.GPSAltitude)
    }
  } catch (e) {
    console.warn('  ⚠️ Failed to extract EXIF with exiftool:', (e as Error).message)
  }
  
  return result
}

/**
 * 解析 GPS 坐标字符串
 */
function parseGpsCoordinate(coord: string | number, ref?: string): number | undefined {
  if (typeof coord === 'number') {
    return ref === 'S' || ref === 'W' ? -coord : coord
  }
  
  // 格式: "36 deg 32' 39.72\" N" 或 "118 deg 45' 55.51\" W"
  const match = coord.match(/(\d+)\s*deg\s*(\d+)'\s*([\d.]+)"?\s*([NSEW])?/)
  if (match) {
    const deg = parseFloat(match[1])
    const min = parseFloat(match[2])
    const sec = parseFloat(match[3])
    const direction = match[4] || ref
    let decimal = deg + min / 60 + sec / 3600
    if (direction === 'S' || direction === 'W') {
      decimal = -decimal
    }
    return decimal
  }
  
  // 尝试直接解析为数值
  const num = parseFloat(coord)
  if (!isNaN(num)) {
    return ref === 'S' || ref === 'W' ? -num : num
  }
  
  return undefined
}

/**
 * 从图片中提取 EXIF 信息
 * 
 * exif-reader 返回嵌套结构：
 * - Image: Make, Model, Software, DateTime, etc.
 * - Photo: ExposureTime, FNumber, ISOSpeedRatings, DateTimeOriginal, LensMake, LensModel, FocalLength, etc.
 * - GPSInfo: GPSLatitude, GPSLongitude, GPSLatitudeRef, GPSLongitudeRef, etc.
 */
async function extractExif(buffer: Buffer, filePath?: string): Promise<ExifData> {
  const result: ExifData = {}

  try {
    // 对于 AVIF 文件，使用 ffprobe 提取 EXIF（sharp 可能无法读取）
    if (filePath && filePath.toLowerCase().endsWith('.avif')) {
      return await extractExifWithFfprobe(filePath)
    }
    
    const metadata = await sharp(buffer).metadata()
    
    if (metadata.exif) {
      const ExifReader = (await import('exif-reader')).default
      const rawExif = ExifReader(metadata.exif)
      
      // 分别获取各部分
      const image = rawExif.Image || {}
      const photo = rawExif.Photo || {}
      const gps = rawExif.GPSInfo || {}
      
      // Debug: 输出原始 EXIF 结构
      // console.log('  Raw EXIF:', JSON.stringify(rawExif, null, 2))
      
      // ========== 拍摄时间 ==========
      // 优先使用 DateTimeOriginal（实际拍摄时间）
      const datetime = photo.DateTimeOriginal || photo.DateTimeDigitized || image.DateTime
      if (datetime) {
        result.datetime = datetime instanceof Date ? datetime : new Date(datetime)
        console.log(`  DateTime: ${result.datetime.toISOString()}`)
      }

      // ========== 曝光参数 ==========
      // 曝光时间
      if (photo.ExposureTime) {
        result.exposureTime = photo.ExposureTime
        if (photo.ExposureTime < 1) {
          result.exposureTimeRat = `1/${Math.round(1 / photo.ExposureTime)}`
        } else {
          result.exposureTimeRat = `${photo.ExposureTime}s`
        }
        console.log(`  Exposure: ${result.exposureTimeRat}`)
      }

      // 光圈
      if (photo.FNumber) {
        result.fNumber = photo.FNumber
        console.log(`  Aperture: f/${result.fNumber}`)
      }

      // ISO
      const iso = photo.ISOSpeedRatings || photo.RecommendedExposureIndex
      if (iso) {
        result.iso = Array.isArray(iso) ? iso[0] : iso
        console.log(`  ISO: ${result.iso}`)
      }

      // 焦距
      if (photo.FocalLength) {
        result.focalLength = photo.FocalLength
        console.log(`  Focal Length: ${result.focalLength}mm`)
      }

      // ========== 相机信息 ==========
      if (image.Make) {
        result.cameraMake = String(image.Make).trim().replace(/\u0000/g, '')
      }
      if (image.Model) {
        result.cameraModel = String(image.Model).trim().replace(/\u0000/g, '')
      }
      if (result.cameraMake || result.cameraModel) {
        console.log(`  Camera: ${result.cameraMake || ''} ${result.cameraModel || ''}`.trim())
      }

      // ========== 镜头信息 ==========
      if (photo.LensMake) {
        result.lensMake = String(photo.LensMake).trim().replace(/\u0000/g, '')
      }
      if (photo.LensModel) {
        result.lensModel = String(photo.LensModel).trim().replace(/\u0000/g, '')
      }
      if (result.lensMake || result.lensModel) {
        console.log(`  Lens: ${result.lensMake || ''} ${result.lensModel || ''}`.trim())
      }

      // ========== GPS 信息 ==========
      const gpsLat = gps.GPSLatitude
      const gpsLon = gps.GPSLongitude
      if (gpsLat && gpsLon) {
        const latRef = gps.GPSLatitudeRef || 'N'
        const lonRef = gps.GPSLongitudeRef || 'E'
        
        let lat: number
        let lon: number

        // GPS 坐标可能是多种格式：
        // 1. [度, 分, 秒] - 传统格式
        // 2. [度, 分.小数, 0] - Lightroom 格式（秒为0，分带小数）
        // 3. 直接十进制数
        if (Array.isArray(gpsLat)) {
          // 度 + 分/60 + 秒/3600
          lat = gpsLat[0] + gpsLat[1] / 60 + (gpsLat[2] || 0) / 3600
        } else {
          lat = gpsLat
        }
        
        if (Array.isArray(gpsLon)) {
          lon = gpsLon[0] + gpsLon[1] / 60 + (gpsLon[2] || 0) / 3600
        } else {
          lon = gpsLon
        }

        result.latitude = latRef === 'S' ? -lat : lat
        result.longitude = lonRef === 'W' ? -lon : lon
        console.log(`  GPS: ${result.latitude.toFixed(6)}, ${result.longitude.toFixed(6)}`)
      }

      // 海拔
      if (gps.GPSAltitude) {
        result.altitude = gps.GPSAltitude
      }
    } else {
      console.log('  ⚠️ No EXIF data found in image')
    }
  } catch (e) {
    console.warn('  ⚠️ Failed to extract EXIF:', (e as Error).message)
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
  
  // 获取图片尺寸（使用 ffprobe）
  // 注意：高端相机（如 Nikon Z8/Z9）的 AVIF 文件包含多个流（缩略图、预览图、主图）
  // 需要找到分辨率最大的流（主图），而不是默认的第一个流（通常是缩略图）
  const ext = path.extname(filePath).toLowerCase()
  let metadata: { width: number; height: number; streamIndex: number }
  
  try {
    const probeOutput = execSync(
      `ffprobe -v error -select_streams v -show_entries stream=width,height,index -of json "${filePath}"`,
      { encoding: 'utf-8' }
    )
    const probeData = JSON.parse(probeOutput)
    
    // 找到像素面积最大的流（即主图）
    const streams = probeData.streams as Array<{ width: number; height: number; index: number }>
    const mainStream = streams.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]
    
    metadata = {
      width: mainStream.width,
      height: mainStream.height,
      streamIndex: mainStream.index
    }
    
    if (streams.length > 1) {
      console.log(`  Found ${streams.length} streams, using stream #${mainStream.index} (largest: ${mainStream.width}x${mainStream.height})`)
    }
  } catch (e) {
    console.error(`  ✗ Failed to get image dimensions. Make sure ffmpeg/ffprobe is installed.`)
    throw e
  }
  
  console.log(`  Original: ${metadata.width}x${metadata.height}, format: ${ext.slice(1)}`)

  // 提取 EXIF（使用 exiftool）
  const exif = await extractExifWithFfprobe(filePath)
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

  // 第一步：使用 ImageMagick 将原图解码为 16-bit TIFF（只解码一次）
  // ImageMagick 对 AVIF 瓦片合并的支持比 ffmpeg 更可靠
  const tempDecoded = path.join(os.tmpdir(), `decoded_${Date.now()}.tiff`)
  try {
    console.log(`  Decoding with ImageMagick...`)
    execSync(
      `magick "${filePath}[0]" -depth 16 "${tempDecoded}"`,
      { stdio: 'pipe' }
    )
  } catch (e) {
    console.error(`  ✗ ImageMagick decode failed. Make sure ImageMagick is installed:`)
    console.error(`    winget install ImageMagick.ImageMagick`)
    throw e
  }
  
  // 关键：从解码后的 TIFF 获取真实尺寸（而非 ffprobe 可能取到的预览流尺寸）
  let originalWidth = 0
  let originalHeight = 0
  try {
    const identifyOutput = execSync(
      `magick identify -format "%w %h" "${tempDecoded}"`,
      { encoding: 'utf-8' }
    ).trim()
    const [decW, decH] = identifyOutput.split(' ').map(Number)
    originalWidth = decW
    originalHeight = decH
    console.log(`  Decoded: ${originalWidth}x${originalHeight} TIFF (16-bit)`)
  } catch (e) {
    console.error(`  ✗ Failed to get decoded image dimensions`)
    throw e
  }
  
  // 第二步：从解码后的 TIFF 生成各尺寸 AVIF
  for (const [sizeName, maxWidth] of Object.entries(SIZES)) {
    const quality = AVIF_QUALITY[sizeName as keyof typeof AVIF_QUALITY]
    
    let targetWidth = originalWidth
    let targetHeight = originalHeight
    if (originalWidth > maxWidth) {
      targetWidth = maxWidth
      targetHeight = Math.round(originalHeight * maxWidth / originalWidth)
      if (targetHeight % 2 !== 0) targetHeight += 1
    }
    
    const tempAvif = path.join(os.tmpdir(), `avif_${sizeName}_${Date.now()}.avif`)
    
    try {
      let vfFilters: string[] = []
      if (originalWidth > maxWidth) {
        vfFilters.push(`scale=${targetWidth}:${targetHeight}:flags=lanczos+accurate_rnd+full_chroma_int`)
      }
      vfFilters.push('format=yuv444p10le')
      const vfParam = `-vf "${vfFilters.join(',')}"`
      
      // CPU 编码（libaom-av1）- 最高质量
      const crf = Math.max(8, Math.round(30 - quality * 0.22)) // quality 75→13, 82→12, 92→10
      
      execSync(
        `ffmpeg -i "${tempDecoded}" ${vfParam} -c:v libaom-av1 -crf ${crf} -cpu-used 0 -still-picture 1 -aq-mode 1 -tune ssim -y "${tempAvif}"`,
        { stdio: 'pipe' }
      )
      
      const avifData = fs.readFileSync(tempAvif)
      fs.unlinkSync(tempAvif)
      
      const key = `${baseKey}_${sizeName}.avif`
      const url = await uploadToS3(avifData, key, 'image/avif')
      
      const outputWidth = originalWidth > maxWidth ? targetWidth : originalWidth
      const outputHeight = originalWidth > maxWidth ? targetHeight : originalHeight
      
      results[sizeName] = { url, width: outputWidth, height: outputHeight }
      console.log(`  ${sizeName}: ${outputWidth}x${outputHeight}, ${(avifData.length / 1024).toFixed(0)}KB (10-bit)`)
    } catch (e) {
      console.error(`  ✗ Failed to generate ${sizeName}:`, (e as Error).message)
      throw e
    }
  }
  
  // 清理解码后的临时文件
  fs.unlinkSync(tempDecoded)

  // 上传原图（直接使用原始文件，不重新编码，保留完整质量）
  try {
    const originalData = fs.readFileSync(filePath)
    const originalKey = `${baseKey}_original.avif`
    const originalUrl = await uploadToS3(originalData, originalKey, 'image/avif')
    results.original = { 
      url: originalUrl, 
      width: originalWidth, 
      height: originalHeight 
    }
    console.log(`  original: ${originalWidth}x${originalHeight}, ${(originalData.length / 1024 / 1024).toFixed(2)}MB (原始文件)`)
  } catch (e) {
    console.error(`  ✗ Failed to upload original:`, (e as Error).message)
    throw e
  }

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
