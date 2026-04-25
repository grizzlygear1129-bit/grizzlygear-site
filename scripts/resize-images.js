#!/usr/bin/env node
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff']);

function printHelp() {
  console.log(`
Usage: node scripts/resize-images.js <target-dir> [options]

Options:
  --dir=PATH           Target directory (positional arg allowed)
  --max-width=NUM      Max width in pixels (default: 1600)
  --quality=NUM        Quality for lossy formats (default: 75)
  --concurrency=NUM    Parallel workers (default: 4)
  --dry-run            Do not write, just report
  --backup             Keep a `.bak` copy when a file is replaced
  --help               Show this help
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { dir: null, maxWidth: 1600, quality: 75, concurrency: 4, dryRun: false, backup: false };

  for (const arg of args) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--backup') opts.backup = true;
    else if (arg.startsWith('--dir=')) opts.dir = arg.split('=')[1];
    else if (arg.startsWith('--max-width=')) opts.maxWidth = Number(arg.split('=')[1]) || opts.maxWidth;
    else if (arg.startsWith('--quality=')) opts.quality = Number(arg.split('=')[1]) || opts.quality;
    else if (arg.startsWith('--concurrency=')) opts.concurrency = Math.max(1, Number(arg.split('=')[1]) || opts.concurrency);
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
    else if (!opts.dir) opts.dir = arg;
    else console.warn('Unknown arg:', arg);
  }

  if (!opts.dir) { printHelp(); process.exit(1); }
  opts.dir = path.resolve(process.cwd(), opts.dir);
  return opts;
}

async function collectFiles(dir, out) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await collectFiles(full, out);
    } else if (ent.isFile()) {
      out.push(full);
    }
  }
}

async function processFile(file, opts) {
  const ext = path.extname(file).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) return { skipped: true, reason: 'unsupported-ext' };

  const stat = await fs.stat(file);
  const origSize = stat.size;

  let metadata;
  try {
    metadata = await sharp(file).metadata();
  } catch (err) {
    return { error: `metadata-failed: ${err.message}` };
  }

  const format = (metadata.format || ext.replace('.', '')).toLowerCase();

  // Build pipeline
  let pipeline = sharp(file, { failOnError: false });
  if (metadata.width && metadata.width > opts.maxWidth) {
    pipeline = pipeline.resize({ width: opts.maxWidth });
  }

  // Encoding options depending on format (we keep same extension)
  switch (format) {
    case 'jpeg':
    case 'jpg':
      pipeline = pipeline.jpeg({ quality: opts.quality, mozjpeg: true });
      break;
    case 'png':
      pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality: opts.quality });
      break;
    case 'avif':
      pipeline = pipeline.avif({ quality: Math.max(30, Math.round(opts.quality * 0.8)) });
      break;
    case 'tiff':
    case 'tif':
      pipeline = pipeline.tiff({ quality: opts.quality });
      break;
    default:
      return { skipped: true, reason: 'unsupported-format' };
  }

  if (opts.dryRun) {
    return { dryRun: true, path: file, origSize, willResize: metadata.width > opts.maxWidth };
  }

  const tmpPath = file + '.sharp-tmp';
  try {
    await pipeline.toFile(tmpPath);
    const newStat = await fs.stat(tmpPath);
    const newSize = newStat.size;

    if (newSize < origSize) {
      if (opts.backup) {
        await fs.copyFile(file, file + '.bak');
      }
      await fs.rename(tmpPath, file);
      return { processed: true, path: file, origSize, newSize };
    } else {
      // If not smaller, remove tmp and skip replacing
      try { await fs.unlink(tmpPath); } catch (e) {}
      return { skipped: true, reason: 'no-size-gain', origSize, newSize };
    }
  } catch (err) {
    try { if (fsSync.existsSync(tmpPath)) await fs.unlink(tmpPath); } catch (e) {}
    return { error: `process-failed: ${err.message}` };
  }
}

async function run() {
  const opts = parseArgs();
  if (!fsSync.existsSync(opts.dir) || !fsSync.statSync(opts.dir).isDirectory()) {
    console.error('Target directory not found or not a directory:', opts.dir);
    process.exit(1);
  }

  console.log(`Scanning: ${opts.dir}`);
  const all = [];
  await collectFiles(opts.dir, all);

  const images = all.filter(f => SUPPORTED_EXTS.has(path.extname(f).toLowerCase()));
  console.log(`Found ${images.length} supported image files.`);
  if (images.length === 0) return;

  if (opts.dryRun) {
    console.log('Dry-run mode — showing candidates:');
    for (const file of images) {
      const stat = await fs.stat(file);
      const md = await sharp(file).metadata().catch(()=>({width:null}));
      console.log(`- ${path.relative(process.cwd(), file)}  ${(stat.size/1024).toFixed(1)} KB  width:${md.width||'-'}`);
    }
    return;
  }

  let index = 0;
  const concurrency = opts.concurrency || 4;
  const results = [];

  async function worker() {
    while (true) {
      const i = index++;
      if (i >= images.length) break;
      const file = images[i];
      process.stdout.write(`Processing ${i+1}/${images.length}: ${path.basename(file)}\r`);
      const r = await processFile(file, opts);
      results.push({ file, r });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, images.length) }, () => worker());
  await Promise.all(workers);

  // Summarize
  let processed = 0, skipped = 0, errors = 0, before = 0, after = 0;
  for (const item of results) {
    const r = item.r;
    if (r && r.processed) {
      processed++;
      before += r.origSize || 0;
      after += r.newSize || 0;
    } else if (r && r.skipped) {
      skipped++;
    } else if (r && r.error) {
      errors++;
      console.error('Error:', item.file, r.error);
    }
  }

  console.log('\nDone. Summary:');
  console.log(`- processed: ${processed}`);
  console.log(`- skipped:   ${skipped}`);
  console.log(`- errors:    ${errors}`);
  if (before > 0) {
    const saved = before - after;
    console.log(`- total before: ${(before/1024).toFixed(1)} KB`);
    console.log(`- total after:  ${(after/1024).toFixed(1)} KB`);
    console.log(`- total saved:  ${(saved/1024).toFixed(1)} KB`);
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
