import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { appleStartupSizes } from "../src/lib/splash.ts";

const directory = fileURLToPath(new URL("../public/splash/", import.meta.url));
await mkdir(directory, { recursive: true });
const source = await readFile(new URL("../public/splash/datemap-source.png", import.meta.url));
await sharp(source).webp({ quality: 90, effort: 6 }).toFile(`${directory}/datemap-splash.webp`);
for (const [width, height, ratio] of appleStartupSizes) {
  await sharp(source)
    .resize(width * ratio, height * ratio, { fit: "contain", background: "#f4efdf" })
    .png({ compressionLevel: 9, palette: true, quality: 95, effort: 10 })
    .toFile(`${directory}/ios-${width * ratio}x${height * ratio}.png`);
}
console.log(`Generated app splash and ${appleStartupSizes.length} iPhone launch images.`);
