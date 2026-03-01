import type { Photo, Camera, Lens, City, Place, Manufacture, Prefecture, Country } from '../db/schema'

interface FileInfo {
  url: string
  width: number
  height: number
}

interface TransformedPhoto {
  id: number
  title: string | null
  description: string | null
  author?: { id: number; name: string }
  metadata: {
    camera?: {
      id: number
      model: string
      manufacture: { id: number; name: string }
      general_name?: string | null
    }
    lens?: {
      id: number
      model: string
      manufacture: { id: number; name: string }
      min_focal_length: number | null
      max_focal_length: number | null
      min_f_number_in_min_focal_length: number | null
      min_f_number_in_max_focal_length: number | null
    }
    has_location: boolean
    location?: { longitude: number; latitude: number }
    datetime: string
    exposure_time: number | null
    exposure_time_rat: string | null
    f_number: number | null
    photographic_sensitivity: number | null
    focal_length: number | null
    city?: TransformedCity
    place?: TransformedPlace
    timezone: string | null
    altitude?: number | null
  }
  thumb_file: FileInfo
  medium_file?: FileInfo
  large_file?: FileInfo
  hdr_file?: FileInfo
}

interface TransformedCity {
  id: number
  name: string
  prefecture: TransformedPrefecture
  photos_count: number
}

interface TransformedPrefecture {
  id: number
  name: string
  country: TransformedCountry
  photos_count?: number
  cities: TransformedCity[]
}

interface TransformedCountry {
  id: number
  name: string
  code: string
  center: [number, number]
  extent: [number, number, number, number]
  zoom: [number, number, number]
}

interface TransformedPlace {
  id: number
  name: string
  geom: { longitude: number; latitude: number }
  city?: TransformedCity
}

type PhotoWithRelations = Photo & {
  author?: { id: number; name: string } | null
  camera?: (Camera & { manufacture?: Manufacture | null }) | null
  lens?: (Lens & { manufacture?: Manufacture | null }) | null
  city?: (City & { prefecture?: (Prefecture & { country?: Country | null }) | null }) | null
  place?: (Place & { city?: City | null }) | null
}

export function transformPhoto(photo: PhotoWithRelations): TransformedPhoto {
  const result: TransformedPhoto = {
    id: photo.id,
    title: photo.title,
    description: photo.description,
    metadata: {
      has_location: photo.hasLocation ?? false,
      datetime: photo.datetime?.toISOString() ?? new Date().toISOString(),
      exposure_time: photo.exposureTime,
      exposure_time_rat: photo.exposureTimeRat,
      f_number: photo.fNumber,
      photographic_sensitivity: photo.photographicSensitivity,
      focal_length: photo.focalLength,
      timezone: photo.timezone,
      altitude: photo.altitude,
    },
    thumb_file: {
      url: photo.thumbUrl ?? '',
      width: photo.thumbWidth ?? 0,
      height: photo.thumbHeight ?? 0,
    },
  }

  if (photo.author) {
    result.author = photo.author
  }

  if (photo.camera) {
    result.metadata.camera = {
      id: photo.camera.id,
      model: photo.camera.model,
      manufacture: photo.camera.manufacture
        ? { id: photo.camera.manufacture.id, name: photo.camera.manufacture.name }
        : { id: 0, name: 'Unknown' },
      general_name: photo.camera.generalName,
    }
  }

  if (photo.lens) {
    result.metadata.lens = {
      id: photo.lens.id,
      model: photo.lens.model,
      manufacture: photo.lens.manufacture
        ? { id: photo.lens.manufacture.id, name: photo.lens.manufacture.name }
        : { id: 0, name: 'Unknown' },
      min_focal_length: photo.lens.minFocalLength,
      max_focal_length: photo.lens.maxFocalLength,
      min_f_number_in_min_focal_length: photo.lens.minFNumberInMinFocalLength,
      min_f_number_in_max_focal_length: photo.lens.minFNumberInMaxFocalLength,
    }
  }

  if (photo.hasLocation && photo.longitude && photo.latitude) {
    result.metadata.location = {
      longitude: photo.longitude,
      latitude: photo.latitude,
    }
  }

  if (photo.city?.prefecture?.country) {
    result.metadata.city = {
      id: photo.city.id,
      name: photo.city.name,
      photos_count: 0,
      prefecture: {
        id: photo.city.prefecture.id,
        name: photo.city.prefecture.name,
        country: {
          id: photo.city.prefecture.country.id,
          name: photo.city.prefecture.country.name,
          code: photo.city.prefecture.country.code,
          center: photo.city.prefecture.country.center ?? [0, 0],
          extent: photo.city.prefecture.country.extent ?? [0, 0, 0, 0],
          zoom: photo.city.prefecture.country.zoom ?? [1, 1, 1],
        },
        cities: [],
      },
    }
  }

  if (photo.place) {
    result.metadata.place = {
      id: photo.place.id,
      name: photo.place.name,
      geom: {
        longitude: photo.place.longitude ?? 0,
        latitude: photo.place.latitude ?? 0,
      },
    }
  }

  if (photo.mediumUrl) {
    result.medium_file = {
      url: photo.mediumUrl,
      width: photo.mediumWidth ?? 0,
      height: photo.mediumHeight ?? 0,
    }
  }

  if (photo.largeUrl) {
    result.large_file = {
      url: photo.largeUrl,
      width: photo.largeWidth ?? 0,
      height: photo.largeHeight ?? 0,
    }
  }

  if (photo.hdrUrl) {
    result.hdr_file = {
      url: photo.hdrUrl,
      width: photo.hdrWidth ?? 0,
      height: photo.hdrHeight ?? 0,
    }
  }

  return result
}

export function transformCountry(country: Country): TransformedCountry {
  return {
    id: country.id,
    name: country.name,
    code: country.code,
    center: country.center ?? [0, 0],
    extent: country.extent ?? [0, 0, 0, 0],
    zoom: country.zoom ?? [1, 1, 1],
  }
}
