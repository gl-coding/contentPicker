import { build as viteBuild } from 'vite';
import { copyFile, mkdir, readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';

const ROOT = process.cwd();
const DIST = resolve(ROOT, 'dist');

async function copyManifest() {
  const manifestPath = resolve(ROOT, 'src/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
  await mkdir(DIST, { recursive: true });
  await writeFile(resolve(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  console.log('✓ manifest.json 已复制');
}

async function buildPopup() {
  console.log('⚙ 构建 Popup...');
  await viteBuild({
    configFile: resolve(ROOT, 'vite.config.ts'),
  });
  console.log('✓ Popup 构建完成');
}

async function buildScript(name: string, entry: string) {
  console.log(`⚙ 构建 ${name}...`);
  await viteBuild({
    configFile: false,
    build: {
      outDir: DIST,
      emptyOutDir: false,
      lib: {
        entry: resolve(ROOT, entry),
        name,
        formats: ['iife'],
        fileName: () => `${name}.js`,
      },
      rollupOptions: {
        output: { extend: true },
      },
    },
  });
  console.log(`✓ ${name} 构建完成`);
}

async function copyIcons() {
  const iconSizes = [16, 32, 48, 128];
  const iconsDir = resolve(DIST, 'icons');
  await mkdir(iconsDir, { recursive: true });

  for (const size of iconSizes) {
    const src = resolve(ROOT, `public/icons/icon${size}.png`);
    const dest = resolve(iconsDir, `icon${size}.png`);
    if (existsSync(src)) {
      await copyFile(src, dest);
    }
  }
  console.log('✓ 图标已复制');
}

async function main() {
  console.log('\n🚀 开始构建 Content Picker...\n');
  try {
    await copyManifest();
    await buildPopup();
    await buildScript('content', 'src/content/index.ts');
    await buildScript('background', 'src/background/index.ts');
    await copyIcons();
    console.log('\n✅ 构建完成！输出目录: dist/\n');
  } catch (error) {
    console.error('\n❌ 构建失败:', error);
    process.exit(1);
  }
}

main();
