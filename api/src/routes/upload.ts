import { Hono } from 'hono'
import { db, photos, cameras, lenses, manufactures } from '../db'
import { eq } from 'drizzle-orm'
import { success, error } from '../lib/response'
import { uploadToS3, generateKey } from '../lib/s3'
import { extractExif } from '../lib/exif'
import { processImage } from '../lib/image'

const app = new Hono()

// POST /upload - 上传照片
app.post('/', async (c) => {
  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    const title = formData.get('title') as string | null
    const description = formData.get('description') as string | null

    if (!file) {
      return error(c, 'No file provided', 400)
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const filename = file.name

    const [exif, processed] = await Promise.all([
      extractExif(buffer),
      processImage(buffer),
    ])

    const timestamp = Date.now()
    const baseKey = `photos/${timestamp}`

    const [thumbResult, mediumResult, largeResult, originalResult] = await Promise.all([
      uploadToS3(processed.thumb.buffer, `${baseKey}_thumb.jpg`, 'image/jpeg'),
      uploadToS3(processed.medium.buffer, `${baseKey}_medium.jpg`, 'image/jpeg'),
      uploadToS3(processed.large.buffer, `${baseKey}_large.jpg`, 'image/jpeg'),
      uploadToS3(processed.original.buffer, `${baseKey}_original.jpg`, 'image/jpeg'),
    ])

    let cameraId: number | null = null
    let lensId: number | null = null

    if (exif.cameraMake && exif.cameraModel) {
      let manufacture = await db
        .select()
        .from(manufactures)
        .where(eq(manufactures.name, exif.cameraMake))
        .limit(1)

      let manufactureId: number
      if (manufacture.length === 0) {
        const [newManufacture] = await db
          .insert(manufactures)
          .values({ name: exif.cameraMake })
          .returning()
        manufactureId = newManufacture.id
      } else {
        manufactureId = manufacture[0].id
      }

      let camera = await db
        .select()
        .from(cameras)
        .where(eq(cameras.model, exif.cameraModel))
        .limit(1)

      if (camera.length === 0) {
        const [newCamera] = await db
          .insert(cameras)
          .values({
            model: exif.cameraModel,
            manufactureId,
          })
          .returning()
        cameraId = newCamera.id
      } else {
        cameraId = camera[0].id
      }
    }

    if (exif.lensModel) {
      let lensManufactureId: number | null = null
      
      if (exif.lensMake) {
        let manufacture = await db
          .select()
          .from(manufactures)
          .where(eq(manufactures.name, exif.lensMake))
          .limit(1)

        if (manufacture.length === 0) {
          const [newManufacture] = await db
            .insert(manufactures)
            .values({ name: exif.lensMake })
            .returning()
          lensManufactureId = newManufacture.id
        } else {
          lensManufactureId = manufacture[0].id
        }
      }

      let lens = await db
        .select()
        .from(lenses)
        .where(eq(lenses.model, exif.lensModel))
        .limit(1)

      if (lens.length === 0) {
        const [newLens] = await db
          .insert(lenses)
          .values({
            model: exif.lensModel,
            manufactureId: lensManufactureId,
          })
          .returning()
        lensId = newLens.id
      } else {
        lensId = lens[0].id
      }
    }

    const [photo] = await db
      .insert(photos)
      .values({
        title: title || filename,
        description,
        thumbUrl: thumbResult.url,
        thumbWidth: processed.thumb.width,
        thumbHeight: processed.thumb.height,
        mediumUrl: mediumResult.url,
        mediumWidth: processed.medium.width,
        mediumHeight: processed.medium.height,
        largeUrl: largeResult.url,
        largeWidth: processed.large.width,
        largeHeight: processed.large.height,
        hdrUrl: originalResult.url,
        hdrWidth: processed.original.width,
        hdrHeight: processed.original.height,
        cameraId,
        lensId,
        datetime: exif.datetime,
        exposureTime: exif.exposureTime,
        exposureTimeRat: exif.exposureTimeRat,
        fNumber: exif.fNumber,
        photographicSensitivity: exif.iso,
        focalLength: exif.focalLength,
        hasLocation: !!(exif.latitude && exif.longitude),
        longitude: exif.longitude,
        latitude: exif.latitude,
        altitude: exif.altitude,
      })
      .returning()

    return success(c, {
      id: photo.id,
      message: 'Photo uploaded successfully',
    })
  } catch (e) {
    console.error('Upload failed:', e)
    return error(c, 'Failed to upload photo')
  }
})

// POST /upload/batch - 批量上传信息 (不上传文件，只录入已有图片URL)
app.post('/batch', async (c) => {
  try {
    const body = await c.req.json<{
      photos: Array<{
        title?: string
        description?: string
        thumb_url: string
        thumb_width: number
        thumb_height: number
        medium_url?: string
        medium_width?: number
        medium_height?: number
        large_url?: string
        large_width?: number
        large_height?: number
        datetime?: string
        camera_model?: string
        camera_make?: string
        lens_model?: string
        exposure_time?: number
        f_number?: number
        iso?: number
        focal_length?: number
        longitude?: number
        latitude?: number
      }>
    }>()

    const insertedIds: number[] = []

    for (const photoData of body.photos) {
      let cameraId: number | null = null

      if (photoData.camera_make && photoData.camera_model) {
        let manufacture = await db
          .select()
          .from(manufactures)
          .where(eq(manufactures.name, photoData.camera_make))
          .limit(1)

        let manufactureId: number
        if (manufacture.length === 0) {
          const [newManufacture] = await db
            .insert(manufactures)
            .values({ name: photoData.camera_make })
            .returning()
          manufactureId = newManufacture.id
        } else {
          manufactureId = manufacture[0].id
        }

        let camera = await db
          .select()
          .from(cameras)
          .where(eq(cameras.model, photoData.camera_model))
          .limit(1)

        if (camera.length === 0) {
          const [newCamera] = await db
            .insert(cameras)
            .values({
              model: photoData.camera_model,
              manufactureId,
            })
            .returning()
          cameraId = newCamera.id
        } else {
          cameraId = camera[0].id
        }
      }

      const [photo] = await db
        .insert(photos)
        .values({
          title: photoData.title,
          description: photoData.description,
          thumbUrl: photoData.thumb_url,
          thumbWidth: photoData.thumb_width,
          thumbHeight: photoData.thumb_height,
          mediumUrl: photoData.medium_url,
          mediumWidth: photoData.medium_width,
          mediumHeight: photoData.medium_height,
          largeUrl: photoData.large_url,
          largeWidth: photoData.large_width,
          largeHeight: photoData.large_height,
          cameraId,
          datetime: photoData.datetime ? new Date(photoData.datetime) : null,
          exposureTime: photoData.exposure_time,
          fNumber: photoData.f_number,
          photographicSensitivity: photoData.iso,
          focalLength: photoData.focal_length,
          hasLocation: !!(photoData.latitude && photoData.longitude),
          longitude: photoData.longitude,
          latitude: photoData.latitude,
        })
        .returning()

      insertedIds.push(photo.id)
    }

    return success(c, {
      count: insertedIds.length,
      ids: insertedIds,
    })
  } catch (e) {
    console.error('Batch insert failed:', e)
    return error(c, 'Failed to batch insert photos')
  }
})

export { app as uploadRouter }
