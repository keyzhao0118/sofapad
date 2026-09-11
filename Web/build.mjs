import { copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
// TypeScript does not remove outputs for deleted source modules.
for (const file of readdirSync('dist')) {
  if (file.endsWith('.js') && !existsSync(`src/${file.slice(0, -3)}.ts`)) rmSync(`dist/${file}`);
}
for (const file of ['index.html', 'style.css']) copyFileSync(`src/${file}`, `dist/${file}`);
