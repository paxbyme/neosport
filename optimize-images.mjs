import { statSync } from "node:fs";
import sharp from "sharp";

const images = [
  {
    source: "assets/neosport-hero.png",
    output: "assets/neosport-hero.webp",
    options: { quality: 78, effort: 6, smartSubsample: true },
  },
  {
    source: "assets/neosport-mark.png",
    output: "assets/neosport-mark.webp",
    options: { lossless: true, effort: 6 },
  },
];

for (const image of images) {
  let pipeline = sharp(image.source);
  if (image.width) pipeline = pipeline.resize({ width: image.width, withoutEnlargement: true });
  await pipeline.webp(image.options).toFile(image.output);
}

const originalBytes = images.reduce((total, image) => total + statSync(image.source).size, 0);
const optimizedBytes = images.reduce((total, image) => total + statSync(image.output).size, 0);
const reduction = 1 - optimizedBytes / originalBytes;

if (reduction < 0.6) {
  throw new Error(`WebP image reduction was only ${(reduction * 100).toFixed(1)}%`);
}

console.log(`Optimized displayed images: ${(reduction * 100).toFixed(1)}% fewer bytes than PNG fallbacks`);
