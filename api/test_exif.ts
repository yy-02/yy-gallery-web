const sharp = require('sharp');
const fs = require('fs');

(async () => {
  // 建议使用反斜杠转义或正斜杠，Windows 下路径最好加引号
  const filePath = 'E:/YY_gallery/photos/avif/DSC_3020.avif'; 
  const buf = fs.readFileSync(filePath);
  const meta = await sharp(buf).metadata();
  const ExifReader = require('exif-reader');

  // 注意：某些版本的 exif-reader 可能不需要 .default，如果报错请去掉 .default
  const exif = ExifReader(meta.exif);
  console.log(JSON.stringify(exif, null, 2));
})();