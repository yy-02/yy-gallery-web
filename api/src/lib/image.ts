import sharp from 'sharp'

export interface ImageSize {
  buffer: Buffer
  width: number
  height: number
}

export interface ProcessedImages {
  thumb: ImageSize
  medium: ImageSize
  large: ImageSize
  original: ImageSize
}

const SIZES = {
  thumb: 300,
  medium: 800,
  large: 1920,
}

export async function processImage(buffer: Buffer): Promise<ProcessedImages> {
  const image = sharp(buffer)
  const metadata = await image.metadata()
  const originalWidth = metadata.width || 0
  const originalHeight = metadata.height || 0

  const results: Partial<ProcessedImages> = {}

  for (const [name, maxWidth] of Object.entries(SIZES)) {
    if (originalWidth > maxWidth) {
      const resized = await image
        .clone()
        .resize(maxWidth, null, { withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .toBuffer({ resolveWithObject: true })

      results[name as keyof typeof SIZES] = {
        buffer: resized.data,
        width: resized.info.width,
        height: resized.info.height,
      }
    } else {
      const ratio = originalWidth / maxWidth
      results[name as keyof typeof SIZES] = {
        buffer,
        width: originalWidth,
        height: originalHeight,
      }
    }
  }

  results.original = {
    buffer,
    width: originalWidth,
    height: originalHeight,
  }

  return results as ProcessedImages
}
