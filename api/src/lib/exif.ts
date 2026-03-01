import ExifReader from 'exif-reader'

export interface ExifData {
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

export async function extractExif(buffer: Buffer): Promise<ExifData> {
  const result: ExifData = {}

  try {
    const startMarker = buffer.indexOf(Buffer.from([0xff, 0xe1]))
    if (startMarker === -1) return result

    const lengthOffset = startMarker + 2
    const exifLength = buffer.readUInt16BE(lengthOffset)
    const exifBuffer = buffer.slice(lengthOffset + 2, lengthOffset + exifLength)

    const exifIdentifier = exifBuffer.slice(0, 6).toString('ascii')
    if (!exifIdentifier.startsWith('Exif')) return result

    const tiffBuffer = exifBuffer.slice(6)
    const exif = ExifReader(tiffBuffer)

    if (exif.DateTimeOriginal) {
      result.datetime = exif.DateTimeOriginal
    }

    if (exif.ExposureTime) {
      result.exposureTime = exif.ExposureTime
      if (exif.ExposureTime < 1) {
        result.exposureTimeRat = `1/${Math.round(1 / exif.ExposureTime)}`
      } else {
        result.exposureTimeRat = `${exif.ExposureTime}s`
      }
    }

    if (exif.FNumber) {
      result.fNumber = exif.FNumber
    }

    if (exif.ISO || exif.ISOSpeedRatings) {
      result.iso = exif.ISO || exif.ISOSpeedRatings
    }

    if (exif.FocalLength) {
      result.focalLength = exif.FocalLength
    }

    if (exif.Make) {
      result.cameraMake = String(exif.Make).trim()
    }

    if (exif.Model) {
      result.cameraModel = String(exif.Model).trim()
    }

    if (exif.LensMake) {
      result.lensMake = String(exif.LensMake).trim()
    }

    if (exif.LensModel) {
      result.lensModel = String(exif.LensModel).trim()
    }

    if (exif.GPSLatitude && exif.GPSLongitude) {
      const latRef = exif.GPSLatitudeRef || 'N'
      const lonRef = exif.GPSLongitudeRef || 'E'

      let lat = exif.GPSLatitude
      let lon = exif.GPSLongitude

      if (Array.isArray(lat)) {
        lat = lat[0] + lat[1] / 60 + lat[2] / 3600
      }
      if (Array.isArray(lon)) {
        lon = lon[0] + lon[1] / 60 + lon[2] / 3600
      }

      result.latitude = latRef === 'S' ? -lat : lat
      result.longitude = lonRef === 'W' ? -lon : lon
    }

    if (exif.GPSAltitude) {
      result.altitude = exif.GPSAltitude
    }
  } catch (e) {
    console.error('Failed to extract EXIF:', e)
  }

  return result
}
