-- 迁移脚本：添加动物功能和照片说明字段
-- 在 Supabase SQL Editor 中运行此脚本

-- 1. 为 photos 表添加说明字段
ALTER TABLE photos ADD COLUMN IF NOT EXISTS description_zh TEXT;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS description_en TEXT;

-- 2. 创建动物种类表
CREATE TABLE IF NOT EXISTS animals (
  id SERIAL PRIMARY KEY,
  name_zh VARCHAR(100) NOT NULL,
  name_en VARCHAR(100) NOT NULL,
  scientific_name VARCHAR(200),
  description_zh TEXT,
  description_en TEXT,
  category VARCHAR(50) DEFAULT 'bird',
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. 创建动物照片表
CREATE TABLE IF NOT EXISTS animal_photos (
  id SERIAL PRIMARY KEY,
  animal_id INTEGER NOT NULL REFERENCES animals(id),
  
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
  
  description_zh TEXT,
  description_en TEXT,
  
  camera_id INTEGER REFERENCES cameras(id),
  lens_id INTEGER REFERENCES lenses(id),
  datetime TIMESTAMP,
  exposure_time REAL,
  exposure_time_rat VARCHAR(20),
  f_number REAL,
  photographic_sensitivity INTEGER,
  focal_length REAL,
  
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

-- 4. 创建索引
CREATE INDEX IF NOT EXISTS idx_animal_photos_animal_id ON animal_photos(animal_id);
CREATE INDEX IF NOT EXISTS idx_animal_photos_datetime ON animal_photos(datetime DESC);
CREATE INDEX IF NOT EXISTS idx_animals_category ON animals(category);

-- 5. 关闭 RLS（如果需要公开访问）
ALTER TABLE animals DISABLE ROW LEVEL SECURITY;
ALTER TABLE animal_photos DISABLE ROW LEVEL SECURITY;
