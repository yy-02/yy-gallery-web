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
import 'dotenv/config'

const SIZES = {
  thumb: 400,
  medium: 1200,
  large: 2400,
}

const WEBP_QUALITY = {
  thumb: 80,
  medium: 85,
  large: 90,
}

const SUPPORTED_FORMATS = /\.(jpg|jpeg|png|webp|heic|heif|tiff|tif)$/i

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

async function extractExif(buffer: Buffer): Promise<ExifData> {
  const result: ExifData = {}

  try {
    const metadata = await sharp(buffer).metadata()
    
    if (metadata.exif) {
      const ExifReader = (await import('exif-reader')).default
      const exif = ExifReader(metadata.exif)
      
      if (exif.DateTimeOriginal) {
        result.datetime = exif.DateTimeOriginal
      } else if (exif.CreateDate) {
        result.datetime = exif.CreateDate
      }

      if (exif.ExposureTime) {
        result.exposureTime = exif.ExposureTime
        if (exif.ExposureTime < 1) {
          result.exposureTimeRat = `1/${Math.round(1 / exif.ExposureTime)}`
        } else {
          result.exposureTimeRat = `${exif.ExposureTime}s`
        }
      }

      if (exif.FNumber) result.fNumber = exif.FNumber
      if (exif.ISO) result.iso = exif.ISO
      else if (exif.ISOSpeedRatings) {
        result.iso = Array.isArray(exif.ISOSpeedRatings) ? exif.ISOSpeedRatings[0] : exif.ISOSpeedRatings
      }
      if (exif.FocalLength) result.focalLength = exif.FocalLength
      if (exif.Make) result.cameraMake = String(exif.Make).trim().replace(/\u0000/g, '')
      if (exif.Model) result.cameraModel = String(exif.Model).trim().replace(/\u0000/g, '')
      if (exif.LensMake) result.lensMake = String(exif.LensMake).trim().replace(/\u0000/g, '')
      if (exif.LensModel) result.lensModel = String(exif.LensModel).trim().replace(/\u0000/g, '')

      if (exif.GPSLatitude && exif.GPSLongitude) {
        const latRef = exif.GPSLatitudeRef || 'N'
        const lonRef = exif.GPSLongitudeRef || 'E'
        let lat = exif.GPSLatitude
        let lon = exif.GPSLongitude
        if (Array.isArray(lat)) lat = lat[0] + lat[1] / 60 + lat[2] / 3600
        if (Array.isArray(lon)) lon = lon[0] + lon[1] / 60 + lon[2] / 3600
        result.latitude = latRef === 'S' ? -lat : lat
        result.longitude = lonRef === 'W' ? -lon : lon
      }

      if (exif.GPSAltitude) result.altitude = exif.GPSAltitude
    }
  } catch (e) {
    console.warn('  Warning: Failed to extract EXIF:', (e as Error).message)
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
  
  const buffer = fs.readFileSync(filePath)
  const image = sharp(buffer, { failOnError: false })
  const metadata = await image.metadata()
  
  console.log(`  Original: ${metadata.width}x${metadata.height}, format: ${metadata.format}`)

  const exif = await extractExif(buffer)
  if (exif.cameraMake) {
    console.log(`  Camera: ${exif.cameraMake} ${exif.cameraModel || ''}`)
  }

  // 获取或创建动物记录
  const animalId = await getOrCreateAnimal(config)

  const timestamp = Date.now()
  const randomStr = Math.random().toString(36).substring(2, 6)
  const baseKey = `animals/${timestamp}_${randomStr}`

  const results: Record<string, { url: string; width: number; height: number }> = {}

  for (const [sizeName, maxWidth] of Object.entries(SIZES)) {
    const quality = WEBP_QUALITY[sizeName as keyof typeof WEBP_QUALITY]
    
    let processedImage = image.clone()
    
    if ((metadata.width || 0) > maxWidth) {
      processedImage = processedImage.resize(maxWidth, null, { 
        withoutEnlargement: true,
        kernel: 'lanczos3'
      })
    }
    
    const { data, info } = await processedImage
      .webp({ quality, effort: 4 })
      .toBuffer({ resolveWithObject: true })
    
    const key = `${baseKey}_${sizeName}.webp`
    const url = await uploadToS3(data, key, 'image/webp')
    
    results[sizeName] = { url, width: info.width, height: info.height }
    console.log(`  ${sizeName}: ${info.width}x${info.height}, ${(data.length / 1024).toFixed(0)}KB`)
  }

  const originalWebp = await image
    .clone()
    .webp({ quality: 95, effort: 6 })
    .toBuffer({ resolveWithObject: true })
  
  const originalKey = `${baseKey}_original.webp`
  const originalUrl = await uploadToS3(originalWebp.data, originalKey, 'image/webp')
  results.original = { url: originalUrl, width: originalWebp.info.width, height: originalWebp.info.height }
  console.log(`  original: ${originalWebp.info.width}x${originalWebp.info.height}, ${(originalWebp.data.length / 1024).toFixed(0)}KB`)

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

    let camera = await sql`SELECT id FROM cameras WHERE model = ${exif.cameraModel} LIMIT 1`
    if (camera.length === 0) {
      const [newCamera] = await sql`INSERT INTO cameras (model, manufacture_id) VALUES (${exif.cameraModel}, ${manufactureId}) RETURNING id`
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
