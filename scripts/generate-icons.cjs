#!/usr/bin/env node
// Generate build/icon.png (1024x1024) and build/icon.ico (multi-size) from
// src/client/public/logo-icon.svg. electron-builder picks these up by
// convention to embed the brand icon into the .exe / installer / window.
//
// Skip-if-exists: a hand-crafted build/icon.png|ico is preserved on rerun.
// Delete the file you want regenerated to refresh it.

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SRC_SVG = path.join(ROOT, 'src', 'client', 'public', 'logo-icon.svg');
const OUT_DIR = path.join(ROOT, 'build');
const OUT_PNG = path.join(OUT_DIR, 'icon.png');
const OUT_ICO = path.join(OUT_DIR, 'icon.ico');

const ICO_SIZES = [16, 32, 48, 64, 128, 256];

async function main() {
  if (!fs.existsSync(SRC_SVG)) {
    console.error(`Icon source not found: ${SRC_SVG}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const svgBuf = fs.readFileSync(SRC_SVG);

  if (fs.existsSync(OUT_PNG)) {
    console.log(`  build/icon.png exists — skipping (delete to regenerate)`);
  } else {
    await sharp(svgBuf, { density: 384 })
      .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(OUT_PNG);
    console.log(`  Wrote build/icon.png (1024x1024)`);
  }

  if (fs.existsSync(OUT_ICO)) {
    console.log(`  build/icon.ico exists — skipping (delete to regenerate)`);
  } else {
    const { default: pngToIco } = await import('png-to-ico');
    const buffers = await Promise.all(
      ICO_SIZES.map((size) =>
        sharp(svgBuf, { density: Math.max(96, size * 4) })
          .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer()
      )
    );
    const ico = await pngToIco(buffers);
    fs.writeFileSync(OUT_ICO, ico);
    console.log(`  Wrote build/icon.ico (${ICO_SIZES.join('/')})`);
  }
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
