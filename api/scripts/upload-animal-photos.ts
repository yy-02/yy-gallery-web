/**
 * 动物照片上传脚本
 * 
 * 使用方法：
 * npx tsx scripts/upload-animal-photos.ts <folder>
 * 
 * 示例：
 * npx tsx scripts/upload-animal-photos.ts "E:\YY_gallery\photos\animal"
 * 
 * 配置文件（必须）：
 * 在照片文件夹中创建 animals.json，格式如下：
 * {
 *   "DSC_1234.jpg": {
 *     "category": "bird",          // bird 或 other
 *     "name_zh": "红嘴蓝鹊",
 *     "name_en": "Red-billed Blue Magpie",
 *     "scientific_name": "Urocissa erythroryncha",  // 可选
 *     "description_zh": "在树枝上休息",             // 可选
 *     "description_en": "Resting on a branch"       // 可选
 *   }
 * }
 * 
 * 分类说明：
 * - bird: 鸟类
 * - other: 其他动物（哺乳动物、昆虫等）
 */

import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import postgres from 'postgres'
import { execSync } from 'child_process'
import os from 'os'
import 'dotenv/config'

const SIZES = {
  thumb: 400,
  medium: 1200,
  large: 3840,   // 4K
}

// AVIF 质量配置（0-100，越高越好）
const AVIF_QUALITY = {
  thumb: 75,
  medium: 82,
  large: 92,     // 4K 使用更高质量
}

// 使用 CPU 编码以支持 10-bit 4:4:4 色度采样（最高质量）
console.log('ℹ 使用 CPU 编码 (libaom-av1, 10-bit 4:4:4)')

const SUPPORTED_FORMATS = /\.(jpg|jpeg|png|webp|avif|heic|heif|tiff|tif)$/i

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

const sql = postgres(process.env.DATABASE_URL!)

// 动物配置类型
interface AnimalConfig {
  category: 'bird' | 'other'
  name_zh: string
  name_en: string
  scientific_name?: string
  description_zh?: string
  description_en?: string
  country?: string
  prefecture?: string
  city?: string
  place?: string
}

interface AnimalsJson {
  [filename: string]: AnimalConfig
}

// 缓存（避免重复查询/插入）
const animalIdCache: Map<string, number> = new Map()
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
 * 使用 exiftool 从 AVIF 文件提取 EXIF 信息
 */
async function extractExifWithExiftool(filePath: string): Promise<ExifData> {
  const result: ExifData = {}
  
  try {
    const jsonOutput = execSync(`exiftool -json "${filePath}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    const data = JSON.parse(jsonOutput)[0]
    
    if (data.DateTimeOriginal) {
      const dtStr = data.DateTimeOriginal.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
      result.datetime = new Date(dtStr)
      console.log(`  DateTime: ${result.datetime.toISOString()}`)
    }
    
    if (data.ExposureTime) {
      if (typeof data.ExposureTime === 'string' && data.ExposureTime.includes('/')) {
        const [num, den] = data.ExposureTime.split('/')
        result.exposureTime = parseInt(num) / parseInt(den)
        result.exposureTimeRat = data.ExposureTime
      } else {
        result.exposureTime = parseFloat(data.ExposureTime)
        result.exposureTimeRat = result.exposureTime < 1 ? `1/${Math.round(1 / result.exposureTime)}` : `${result.exposureTime}s`
      }
      console.log(`  Exposure: ${result.exposureTimeRat}`)
    }
    
    if (data.FNumber) {
      result.fNumber = parseFloat(data.FNumber)
      console.log(`  Aperture: f/${result.fNumber}`)
    }
    
    if (data.ISO) {
      result.iso = parseInt(data.ISO)
      console.log(`  ISO: ${result.iso}`)
    }
    
    if (data.FocalLength) {
      result.focalLength = parseFloat(data.FocalLength)
      console.log(`  Focal Length: ${result.focalLength}mm`)
    }
    
    if (data.Make) result.cameraMake = String(data.Make).trim()
    if (data.Model) result.cameraModel = String(data.Model).trim()
    if (result.cameraMake || result.cameraModel) {
      console.log(`  Camera: ${result.cameraMake || ''} ${result.cameraModel || ''}`.trim())
    }
    
    if (data.LensMake) result.lensMake = String(data.LensMake).trim()
    if (data.LensModel) result.lensModel = String(data.LensModel).trim()
    if (result.lensMake || result.lensModel) {
      console.log(`  Lens: ${result.lensMake || ''} ${result.lensModel || ''}`.trim())
    }
    
    if (data.GPSLatitude && data.GPSLongitude) {
      result.latitude = parseGpsCoordinate(data.GPSLatitude, data.GPSLatitudeRef)
      result.longitude = parseGpsCoordinate(data.GPSLongitude, data.GPSLongitudeRef)
      if (result.latitude && result.longitude) {
        console.log(`  GPS: ${result.latitude.toFixed(6)}, ${result.longitude.toFixed(6)}`)
      }
    }
    
    if (data.GPSAltitude) result.altitude = parseFloat(data.GPSAltitude)
  } catch (e) {
    console.warn('  ⚠️ Failed to extract EXIF with exiftool:', (e as Error).message)
  }
  
  return result
}

function parseGpsCoordinate(coord: string | number, ref?: string): number | undefined {
  if (typeof coord === 'number') {
    return ref === 'S' || ref === 'W' ? -coord : coord
  }
  const match = coord.match(/(\d+)\s*deg\s*(\d+)'\s*([\d.]+)"?\s*([NSEW])?/)
  if (match) {
    const deg = parseFloat(match[1])
    const min = parseFloat(match[2])
    const sec = parseFloat(match[3])
    const direction = match[4] || ref
    let decimal = deg + min / 60 + sec / 3600
    if (direction === 'S' || direction === 'W') decimal = -decimal
    return decimal
  }
  const num = parseFloat(coord)
  if (!isNaN(num)) return ref === 'S' || ref === 'W' ? -num : num
  return undefined
}

/**
 * 根据相机型号生成 general_name（用于前端 logo 显示）
 */
function getGeneralCameraName(model: string): string | null {
  // Nikon 相机
  if (model.includes('NIKON Z 5') || model === 'Z 5') return 'Z 5'
  if (model.includes('NIKON Z 8') || model === 'Z 8') return 'Z 8'
  if (model.includes('NIKON Z 6') || model === 'Z 6') return 'Z 6'
  if (model.includes('NIKON Z 7') || model === 'Z 7') return 'Z 7'
  if (model.includes('NIKON Z 9') || model === 'Z 9') return 'Z 9'
  if (model.includes('NIKON Z6') || model === 'Z6') return 'Z 6'
  if (model.includes('NIKON Z7') || model === 'Z7') return 'Z 7'
  if (model.includes('NIKON Z8') || model === 'Z8') return 'Z 8'
  if (model.includes('NIKON Z9') || model === 'Z9') return 'Z 9'
  if (model.includes('NIKON Zf') || model === 'Zf') return 'Zf'
  if (model.includes('NIKON Zfc') || model === 'Zfc') return 'Zfc'
  
  // Canon 相机
  if (model.startsWith('Canon ')) return model
  if (model.startsWith('EOS ')) return `Canon ${model}`
  
  // Sony 相机
  if (model.includes('ILCE-')) {
    const match = model.match(/ILCE-(\d+)/)
    if (match) return `α${match[1]}`
  }
  if (model.includes('α')) return model
  
  // Panasonic Lumix
  if (model.includes('DC-')) {
    const match = model.match(/DC-([A-Z0-9]+)/)
    if (match) return `Lumix ${match[1]}`
  }
  
  return model
}

/**
 * 从图片中提取 EXIF 信息
 */
async function extractExif(buffer: Buffer, filePath?: string): Promise<ExifData> {
  const result: ExifData = {}

  try {
    // 对于 AVIF 文件使用 exiftool
    if (filePath && filePath.toLowerCase().endsWith('.avif')) {
      return await extractExifWithExiftool(filePath)
    }
    
    const metadata = await sharp(buffer).metadata()
    
    if (metadata.exif) {
      const ExifReader = (await import('exif-reader')).default
      const rawExif = ExifReader(metadata.exif)
      
      const image = rawExif.Image || {}
      const photo = rawExif.Photo || {}
      const gps = rawExif.GPSInfo || {}
      
      const datetime = photo.DateTimeOriginal || photo.DateTimeDigitized || image.DateTime
      if (datetime) {
        result.datetime = datetime instanceof Date ? datetime : new Date(datetime)
        console.log(`  DateTime: ${result.datetime.toISOString()}`)
      }

      if (photo.ExposureTime) {
        result.exposureTime = photo.ExposureTime
        result.exposureTimeRat = photo.ExposureTime < 1 ? `1/${Math.round(1 / photo.ExposureTime)}` : `${photo.ExposureTime}s`
        console.log(`  Exposure: ${result.exposureTimeRat}`)
      }

      if (photo.FNumber) {
        result.fNumber = photo.FNumber
        console.log(`  Aperture: f/${result.fNumber}`)
      }

      const iso = photo.ISOSpeedRatings || photo.RecommendedExposureIndex
      if (iso) {
        result.iso = Array.isArray(iso) ? iso[0] : iso
        console.log(`  ISO: ${result.iso}`)
      }

      if (photo.FocalLength) {
        result.focalLength = photo.FocalLength
        console.log(`  Focal Length: ${result.focalLength}mm`)
      }

      if (image.Make) result.cameraMake = String(image.Make).trim().replace(/\u0000/g, '')
      if (image.Model) result.cameraModel = String(image.Model).trim().replace(/\u0000/g, '')
      if (result.cameraMake || result.cameraModel) {
        console.log(`  Camera: ${result.cameraMake || ''} ${result.cameraModel || ''}`.trim())
      }

      if (photo.LensMake) result.lensMake = String(photo.LensMake).trim().replace(/\u0000/g, '')
      if (photo.LensModel) result.lensModel = String(photo.LensModel).trim().replace(/\u0000/g, '')
      if (result.lensMake || result.lensModel) {
        console.log(`  Lens: ${result.lensMake || ''} ${result.lensModel || ''}`.trim())
      }

      const gpsLat = gps.GPSLatitude
      const gpsLon = gps.GPSLongitude
      if (gpsLat && gpsLon) {
        const latRef = gps.GPSLatitudeRef || 'N'
        const lonRef = gps.GPSLongitudeRef || 'E'
        let lat = Array.isArray(gpsLat) ? gpsLat[0] + gpsLat[1] / 60 + (gpsLat[2] || 0) / 3600 : gpsLat
        let lon = Array.isArray(gpsLon) ? gpsLon[0] + gpsLon[1] / 60 + (gpsLon[2] || 0) / 3600 : gpsLon
        result.latitude = latRef === 'S' ? -lat : lat
        result.longitude = lonRef === 'W' ? -lon : lon
        console.log(`  GPS: ${result.latitude.toFixed(6)}, ${result.longitude.toFixed(6)}`)
      }

      if (gps.GPSAltitude) result.altitude = gps.GPSAltitude
    } else {
      console.log('  ⚠️ No EXIF data found in image')
    }
  } catch (e) {
    console.warn('  ⚠️ Failed to extract EXIF:', (e as Error).message)
  }

  return result
}

async function uploadToS3(buffer: Buffer, key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000',
  })

  await s3Client.send(command)
  return `${publicUrl}/${key}`
}

/**
 * 获取或创建国家
 */
async function getOrCreateCountry(name: string): Promise<number> {
  if (countryCache.has(name)) return countryCache.get(name)!
  const existing = await sql`SELECT id FROM countries WHERE name = ${name} LIMIT 1`
  if (existing.length > 0) {
    countryCache.set(name, existing[0].id)
    return existing[0].id
  }
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
  if (prefectureCache.has(cacheKey)) return prefectureCache.get(cacheKey)!
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
  if (cityCache.has(cacheKey)) return cityCache.get(cacheKey)!
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
  if (placeCache.has(cacheKey)) return placeCache.get(cacheKey)!
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
 * 获取或创建动物记录
 */
async function getOrCreateAnimal(config: AnimalConfig): Promise<number> {
  const cacheKey = `${config.name_zh}-${config.name_en}`
  
  if (animalIdCache.has(cacheKey)) {
    return animalIdCache.get(cacheKey)!
  }

  // 查找现有动物
  const existing = await sql`
    SELECT id FROM animals WHERE name_zh = ${config.name_zh} LIMIT 1
  `
  
  if (existing.length > 0) {
    animalIdCache.set(cacheKey, existing[0].id)
    return existing[0].id
  }

  // 创建新动物
  const [newAnimal] = await sql`
    INSERT INTO animals (name_zh, name_en, scientific_name, category)
    VALUES (${config.name_zh}, ${config.name_en}, ${config.scientific_name || null}, ${config.category})
    RETURNING id
  `
  
  console.log(`  Created new animal: ${config.name_zh} (${config.name_en}) [ID: ${newAnimal.id}]`)
  animalIdCache.set(cacheKey, newAnimal.id)
  return newAnimal.id
}

async function processAndUpload(filePath: string, config: AnimalConfig) {
  const filename = path.basename(filePath, path.extname(filePath))
  console.log(`\nProcessing: ${filename}`)
  console.log(`  Animal: ${config.name_zh} (${config.name_en})`)
  if (config.city) {
    console.log(`  Location: ${config.country || ''} > ${config.prefecture || ''} > ${config.city}`)
  }
  
  // 获取图片尺寸（使用 ffprobe）
  // 注意：高端相机的 AVIF 文件包含多个流，需要找到主图（分辨率最大的流）
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
  const exif = await extractExifWithExiftool(filePath)
  if (exif.cameraMake) {
    console.log(`  Camera: ${exif.cameraMake} ${exif.cameraModel || ''}`)
  }

  // 获取或创建动物记录
  const animalId = await getOrCreateAnimal(config)

  const timestamp = Date.now()
  const randomStr = Math.random().toString(36).substring(2, 6)
  const baseKey = `animals/${timestamp}_${randomStr}`

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
      const crf = Math.max(8, Math.round(30 - quality * 0.22))
      
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
    results.original = { url: originalUrl, width: originalWidth, height: originalHeight }
    console.log(`  original: ${originalWidth}x${originalHeight}, ${(originalData.length / 1024 / 1024).toFixed(2)}MB (原始文件)`)
  } catch (e) {
    console.error(`  ✗ Failed to upload original:`, (e as Error).message)
    throw e
  }

  // 处理相机信息
  let cameraId: number | null = null
  if (exif.cameraMake && exif.cameraModel) {
    let manufacture = await sql`SELECT id FROM manufactures WHERE name = ${exif.cameraMake} LIMIT 1`
    let manufactureId: number
    if (manufacture.length === 0) {
      const [newManufacture] = await sql`INSERT INTO manufactures (name) VALUES (${exif.cameraMake}) RETURNING id`
      manufactureId = newManufacture.id
    } else {
      manufactureId = manufacture[0].id
    }

    // 生成 general_name（用于前端 logo 显示）
    const generalName = getGeneralCameraName(exif.cameraModel)

    let camera = await sql`SELECT id FROM cameras WHERE model = ${exif.cameraModel} LIMIT 1`
    if (camera.length === 0) {
      const [newCamera] = await sql`INSERT INTO cameras (model, manufacture_id, general_name) VALUES (${exif.cameraModel}, ${manufactureId}, ${generalName}) RETURNING id`
      cameraId = newCamera.id
    } else {
      cameraId = camera[0].id
      // 如果已存在但没有 general_name，更新它
      if (generalName) {
        await sql`UPDATE cameras SET general_name = ${generalName} WHERE id = ${cameraId} AND general_name IS NULL`
      }
    }
  }

  // 处理镜头信息
  let lensId: number | null = null
  if (exif.lensModel) {
    let lensManufactureId: number | null = null
    if (exif.lensMake) {
      let manufacture = await sql`SELECT id FROM manufactures WHERE name = ${exif.lensMake} LIMIT 1`
      if (manufacture.length === 0) {
        const [newManufacture] = await sql`INSERT INTO manufactures (name) VALUES (${exif.lensMake}) RETURNING id`
        lensManufactureId = newManufacture.id
      } else {
        lensManufactureId = manufacture[0].id
      }
    }

    let lens = await sql`SELECT id FROM lenses WHERE model = ${exif.lensModel} LIMIT 1`
    if (lens.length === 0) {
      const [newLens] = await sql`INSERT INTO lenses (model, manufacture_id) VALUES (${exif.lensModel}, ${lensManufactureId}) RETURNING id`
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

  const [photo] = await sql`
    INSERT INTO animal_photos (
      animal_id, description_zh, description_en,
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
      ${animalId}, ${config.description_zh || null}, ${config.description_en || null},
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

async function main() {
  console.log('='.repeat(50))
  console.log('YY Gallery Animal Photo Uploader')
  console.log('='.repeat(50))
  
  const requiredEnvVars = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_PUBLIC_URL', 'DATABASE_URL']
  const missingVars = requiredEnvVars.filter(v => !process.env[v])
  if (missingVars.length > 0) {
    console.error(`\nError: Missing environment variables: ${missingVars.join(', ')}`)
    process.exit(1)
  }

  const inputPath = process.argv[2]
  
  if (!inputPath) {
    console.log('\nUsage:')
    console.log('  npx tsx scripts/upload-animal-photos.ts <folder>')
    console.log('\nExample:')
    console.log('  npx tsx scripts/upload-animal-photos.ts "E:\\YY_gallery\\photos\\animal"')
    console.log('\nThe folder must contain an animals.json file with photo configurations.')
    process.exit(1)
  }

  const stat = fs.statSync(inputPath)
  if (!stat.isDirectory()) {
    console.error('\nError: Input must be a directory containing animals.json')
    process.exit(1)
  }

  // 加载配置文件
  const configPath = path.join(inputPath, 'animals.json')
  if (!fs.existsSync(configPath)) {
    console.error(`\nError: animals.json not found in ${inputPath}`)
    console.log('\nCreate animals.json with format:')
    console.log(JSON.stringify({
      "DSC_XXXX.jpg": {
        "category": "bird",
        "name_zh": "红嘴蓝鹊",
        "name_en": "Red-billed Blue Magpie",
        "scientific_name": "Urocissa erythroryncha",
        "description_zh": "",
        "description_en": ""
      }
    }, null, 2))
    process.exit(1)
  }

  let animalsConfig: AnimalsJson
  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    animalsConfig = JSON.parse(content)
  } catch (e) {
    console.error(`\nError: Failed to parse animals.json: ${(e as Error).message}`)
    process.exit(1)
  }

  // 过滤掉注释字段
  const photoEntries = Object.entries(animalsConfig).filter(([key]) => !key.startsWith('_'))
  
  // 验证配置
  const invalidEntries = photoEntries.filter(([, config]) => !config.name_zh || !config.name_en || !config.category)
  if (invalidEntries.length > 0) {
    console.error('\nError: Some entries are missing required fields (name_zh, name_en, category):')
    invalidEntries.forEach(([filename]) => console.error(`  - ${filename}`))
    process.exit(1)
  }

  // 获取文件列表
  const entries = fs.readdirSync(inputPath)
  const imageFiles = entries.filter(f => SUPPORTED_FORMATS.test(f))

  // 检查配置与文件是否匹配
  const configuredFiles = photoEntries.map(([filename]) => filename)
  const unconfiguredFiles = imageFiles.filter(f => !configuredFiles.includes(f))
  const missingFiles = configuredFiles.filter(f => !imageFiles.includes(f))

  if (unconfiguredFiles.length > 0) {
    console.warn('\nWarning: Some images are not configured in animals.json:')
    unconfiguredFiles.forEach(f => console.warn(`  - ${f}`))
  }

  if (missingFiles.length > 0) {
    console.warn('\nWarning: Some configured files are missing:')
    missingFiles.forEach(f => console.warn(`  - ${f}`))
  }

  // 只处理有配置的文件
  const filesToProcess = imageFiles.filter(f => configuredFiles.includes(f))

  if (filesToProcess.length === 0) {
    console.log('\nNo configured images to process')
    process.exit(0)
  }

  console.log(`\nFound ${filesToProcess.length} configured image(s) to process`)
  console.log(`Bucket: ${bucket}`)

  // 统计动物种类
  const uniqueAnimals = new Set(photoEntries.map(([, config]) => config.name_zh))
  console.log(`Animal species: ${uniqueAnimals.size} (${[...uniqueAnimals].join(', ')})`)

  let successCount = 0
  let failCount = 0

  for (let i = 0; i < filesToProcess.length; i++) {
    const filename = filesToProcess[i]
    const filePath = path.join(inputPath, filename)
    const config = animalsConfig[filename]
    
    console.log(`\n[${i + 1}/${filesToProcess.length}] ${filename}`)
    
    try {
      await processAndUpload(filePath, config)
      successCount++
    } catch (e) {
      console.error(`  ✗ Failed:`, (e as Error).message)
      failCount++
    }
  }

  console.log('\n' + '='.repeat(50))
  console.log(`Done! Success: ${successCount}, Failed: ${failCount}`)
  console.log('='.repeat(50))

  await sql.end()
}

main().catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
