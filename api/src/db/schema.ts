import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  real,
  doublePrecision,
  json,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// 相机制造商
export const manufactures = pgTable('manufactures', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
})

// 相机
export const cameras = pgTable('cameras', {
  id: serial('id').primaryKey(),
  model: varchar('model', { length: 200 }).notNull(),
  manufactureId: integer('manufacture_id').references(() => manufactures.id),
  generalName: varchar('general_name', { length: 200 }),
})

export const camerasRelations = relations(cameras, ({ one }) => ({
  manufacture: one(manufactures, {
    fields: [cameras.manufactureId],
    references: [manufactures.id],
  }),
}))

// 镜头
export const lenses = pgTable('lenses', {
  id: serial('id').primaryKey(),
  model: varchar('model', { length: 200 }).notNull(),
  manufactureId: integer('manufacture_id').references(() => manufactures.id),
  minFocalLength: real('min_focal_length'),
  maxFocalLength: real('max_focal_length'),
  minFNumberInMinFocalLength: real('min_f_number_in_min_focal_length'),
  minFNumberInMaxFocalLength: real('min_f_number_in_max_focal_length'),
})

export const lensesRelations = relations(lenses, ({ one }) => ({
  manufacture: one(manufactures, {
    fields: [lenses.manufactureId],
    references: [manufactures.id],
  }),
}))

// 国家
export const countries = pgTable('countries', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 10 }).notNull(),
  center: json('center').$type<[number, number]>(),
  extent: json('extent').$type<[number, number, number, number]>(),
  zoom: json('zoom').$type<[number, number, number]>(),
})

// 都道府县/省份
export const prefectures = pgTable('prefectures', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  countryId: integer('country_id').references(() => countries.id),
})

export const prefecturesRelations = relations(prefectures, ({ one, many }) => ({
  country: one(countries, {
    fields: [prefectures.countryId],
    references: [countries.id],
  }),
  cities: many(cities),
}))

// 城市
export const cities = pgTable('cities', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  prefectureId: integer('prefecture_id').references(() => prefectures.id),
})

export const citiesRelations = relations(cities, ({ one, many }) => ({
  prefecture: one(prefectures, {
    fields: [cities.prefectureId],
    references: [prefectures.id],
  }),
  places: many(places),
}))

// 地点
export const places = pgTable('places', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  cityId: integer('city_id').references(() => cities.id),
  longitude: doublePrecision('longitude'),
  latitude: doublePrecision('latitude'),
})

export const placesRelations = relations(places, ({ one }) => ({
  city: one(cities, {
    fields: [places.cityId],
    references: [cities.id],
  }),
}))

// 作者
export const authors = pgTable('authors', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
})

// 照片
export const photos = pgTable('photos', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 200 }),
  description: text('description'),
  authorId: integer('author_id').references(() => authors.id),
  
  // 图片文件
  thumbUrl: varchar('thumb_url', { length: 500 }),
  thumbWidth: integer('thumb_width'),
  thumbHeight: integer('thumb_height'),
  mediumUrl: varchar('medium_url', { length: 500 }),
  mediumWidth: integer('medium_width'),
  mediumHeight: integer('medium_height'),
  largeUrl: varchar('large_url', { length: 500 }),
  largeWidth: integer('large_width'),
  largeHeight: integer('large_height'),
  hdrUrl: varchar('hdr_url', { length: 500 }),
  hdrWidth: integer('hdr_width'),
  hdrHeight: integer('hdr_height'),
  
  // 元数据
  cameraId: integer('camera_id').references(() => cameras.id),
  lensId: integer('lens_id').references(() => lenses.id),
  datetime: timestamp('datetime'),
  exposureTime: real('exposure_time'),
  exposureTimeRat: varchar('exposure_time_rat', { length: 20 }),
  fNumber: real('f_number'),
  photographicSensitivity: integer('photographic_sensitivity'),
  focalLength: real('focal_length'),
  
  // 位置信息
  hasLocation: boolean('has_location').default(false),
  longitude: doublePrecision('longitude'),
  latitude: doublePrecision('latitude'),
  altitude: real('altitude'),
  timezone: varchar('timezone', { length: 50 }),
  cityId: integer('city_id').references(() => cities.id),
  placeId: integer('place_id').references(() => places.id),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const photosRelations = relations(photos, ({ one }) => ({
  author: one(authors, {
    fields: [photos.authorId],
    references: [authors.id],
  }),
  camera: one(cameras, {
    fields: [photos.cameraId],
    references: [cameras.id],
  }),
  lens: one(lenses, {
    fields: [photos.lensId],
    references: [lenses.id],
  }),
  city: one(cities, {
    fields: [photos.cityId],
    references: [cities.id],
  }),
  place: one(places, {
    fields: [photos.placeId],
    references: [places.id],
  }),
}))

// 类型导出
export type Manufacture = typeof manufactures.$inferSelect
export type Camera = typeof cameras.$inferSelect
export type Lens = typeof lenses.$inferSelect
export type Country = typeof countries.$inferSelect
export type Prefecture = typeof prefectures.$inferSelect
export type City = typeof cities.$inferSelect
export type Place = typeof places.$inferSelect
export type Author = typeof authors.$inferSelect
export type Photo = typeof photos.$inferSelect
export type NewPhoto = typeof photos.$inferInsert
