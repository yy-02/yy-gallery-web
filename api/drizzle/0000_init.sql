-- YY Gallery Database Schema
-- Run this SQL in Supabase SQL Editor to create all tables

-- 相机制造商
CREATE TABLE IF NOT EXISTS manufactures (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL
);

-- 相机
CREATE TABLE IF NOT EXISTS cameras (
  id SERIAL PRIMARY KEY,
  model VARCHAR(200) NOT NULL,
  manufacture_id INTEGER REFERENCES manufactures(id),
  general_name VARCHAR(200)
);

-- 镜头
CREATE TABLE IF NOT EXISTS lenses (
  id SERIAL PRIMARY KEY,
  model VARCHAR(200) NOT NULL,
  manufacture_id INTEGER REFERENCES manufactures(id),
  min_focal_length REAL,
  max_focal_length REAL,
  min_f_number_in_min_focal_length REAL,
  min_f_number_in_max_focal_length REAL
);

-- 国家
CREATE TABLE IF NOT EXISTS countries (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(10) NOT NULL,
  center JSONB,
  extent JSONB,
  zoom JSONB
);

-- 都道府县/省份
CREATE TABLE IF NOT EXISTS prefectures (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  country_id INTEGER REFERENCES countries(id)
);

-- 城市
CREATE TABLE IF NOT EXISTS cities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  prefecture_id INTEGER REFERENCES prefectures(id)
);

-- 地点
CREATE TABLE IF NOT EXISTS places (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  city_id INTEGER REFERENCES cities(id),
  longitude DOUBLE PRECISION,
  latitude DOUBLE PRECISION
);

-- 作者
CREATE TABLE IF NOT EXISTS authors (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL
);

-- 照片
CREATE TABLE IF NOT EXISTS photos (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200),
  description TEXT,
  description_zh TEXT,  -- 照片说明（中文）
  description_en TEXT,  -- 照片说明（英文）
  author_id INTEGER REFERENCES authors(id),
  
  -- 图片文件
  thumb_url VARCHAR(500),
  thumb_width INTEGER,
  thumb_height INTEGER,
  medium_url VARCHAR(500),
  medium_width INTEGER,
  medium_height INTEGER,
  large_url VARCHAR(500),
  large_width INTEGER,
  large_height INTEGER,
  hdr_url VARCHAR(500),
  hdr_width INTEGER,
  hdr_height INTEGER,
  
  -- 元数据
  camera_id INTEGER REFERENCES cameras(id),
  lens_id INTEGER REFERENCES lenses(id),
  datetime TIMESTAMP,
  exposure_time REAL,
  exposure_time_rat VARCHAR(20),
  f_number REAL,
  photographic_sensitivity INTEGER,
  focal_length REAL,
  
  -- 位置信息
  has_location BOOLEAN DEFAULT FALSE,
  longitude DOUBLE PRECISION,
  latitude DOUBLE PRECISION,
  altitude REAL,
  timezone VARCHAR(50),
  city_id INTEGER REFERENCES cities(id),
  place_id INTEGER REFERENCES places(id),
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 动物种类
CREATE TABLE IF NOT EXISTS animals (
  id SERIAL PRIMARY KEY,
  name_zh VARCHAR(100) NOT NULL,   -- 中文名称（如：红嘴蓝鹊）
  name_en VARCHAR(100) NOT NULL,   -- 英文名称（如：Red-billed Blue Magpie）
  scientific_name VARCHAR(200),     -- 学名（如：Urocissa erythroryncha）
  description_zh TEXT,              -- 说明（中文）
  description_en TEXT,              -- 说明（英文）
  category VARCHAR(50) DEFAULT 'bird', -- 分类：bird, mammal, insect 等
  created_at TIMESTAMP DEFAULT NOW()
);

-- 动物照片
CREATE TABLE IF NOT EXISTS animal_photos (
  id SERIAL PRIMARY KEY,
  animal_id INTEGER NOT NULL REFERENCES animals(id),
  
  -- 图片文件
  thumb_url VARCHAR(500),
  thumb_width INTEGER,
  thumb_height INTEGER,
  medium_url VARCHAR(500),
  medium_width INTEGER,
  medium_height INTEGER,
  large_url VARCHAR(500),
  large_width INTEGER,
  large_height INTEGER,
  hdr_url VARCHAR(500),
  hdr_width INTEGER,
  hdr_height INTEGER,
  
  -- 说明（每张照片可以有独立说明）
  description_zh TEXT,
  description_en TEXT,
  
  -- 元数据
  camera_id INTEGER REFERENCES cameras(id),
  lens_id INTEGER REFERENCES lenses(id),
  datetime TIMESTAMP,
  exposure_time REAL,
  exposure_time_rat VARCHAR(20),
  f_number REAL,
  photographic_sensitivity INTEGER,
  focal_length REAL,
  
  -- 位置信息
  has_location BOOLEAN DEFAULT FALSE,
  longitude DOUBLE PRECISION,
  latitude DOUBLE PRECISION,
  altitude REAL,
  timezone VARCHAR(50),
  city_id INTEGER REFERENCES cities(id),
  place_id INTEGER REFERENCES places(id),
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_photos_datetime ON photos(datetime DESC);
CREATE INDEX IF NOT EXISTS idx_photos_city_id ON photos(city_id);
CREATE INDEX IF NOT EXISTS idx_photos_has_location ON photos(has_location);
CREATE INDEX IF NOT EXISTS idx_cities_prefecture_id ON cities(prefecture_id);
CREATE INDEX IF NOT EXISTS idx_prefectures_country_id ON prefectures(country_id);
CREATE INDEX IF NOT EXISTS idx_animal_photos_animal_id ON animal_photos(animal_id);
CREATE INDEX IF NOT EXISTS idx_animal_photos_datetime ON animal_photos(datetime DESC);
CREATE INDEX IF NOT EXISTS idx_animals_category ON animals(category);

-- 插入示例数据（中国）
INSERT INTO countries (name, code, center, extent, zoom) VALUES
('中国', 'CN', '[116.4, 39.9]', '[73.5, 18.2, 135.0, 53.6]', '[3, 5, 10]'),
('日本', 'JP', '[139.7, 35.7]', '[129.5, 31.0, 145.8, 45.5]', '[4, 6, 12]')
ON CONFLICT DO NOTHING;
