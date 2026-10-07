#!/usr/bin/env node
// 用项目自带的 esbuild 把 node:test 测试打成单文件后执行，无需引入测试框架。
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'node_modules', '.cache', 'domain.test.mjs');

await build({
  entryPoints: [path.join(root, 'tests', 'domain.test.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'warning',
});

const child = spawn(process.execPath, ['--test', outfile], { stdio: 'inherit' });
child.on('exit', async (code) => {
  await rm(outfile, { force: true });
  process.exit(code ?? 1);
});
