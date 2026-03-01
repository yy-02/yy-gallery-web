-- 更新 Nikon 相机的 general_name
UPDATE cameras SET general_name = 'Z 5' WHERE model LIKE '%NIKON Z 5%' OR model = 'Z 5';
UPDATE cameras SET general_name = 'Z 8' WHERE model LIKE '%NIKON Z 8%' OR model = 'Z 8';
UPDATE cameras SET general_name = 'Z 6' WHERE model LIKE '%NIKON Z 6%' OR model = 'Z 6';
UPDATE cameras SET general_name = 'Z 7' WHERE model LIKE '%NIKON Z 7%' OR model = 'Z 7';
UPDATE cameras SET general_name = 'Z 9' WHERE model LIKE '%NIKON Z 9%' OR model = 'Z 9';
UPDATE cameras SET general_name = 'Zf' WHERE model LIKE '%NIKON Zf%' OR model = 'Zf';
UPDATE cameras SET general_name = 'Zfc' WHERE model LIKE '%NIKON Zfc%' OR model = 'Zfc';

-- 更新 Canon 相机的 general_name（保留完整型号）
UPDATE cameras SET general_name = model WHERE model LIKE 'Canon %' AND general_name IS NULL;
UPDATE cameras SET general_name = CONCAT('Canon ', model) WHERE model LIKE 'EOS %' AND general_name IS NULL;

-- 查看更新结果
SELECT id, model, general_name FROM cameras;
