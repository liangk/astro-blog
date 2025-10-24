// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import mermaid from 'astro-mermaid';
import fs from 'node:fs';
import path from 'node:path';

// Build a lookup of docs-lite filenames (case-safe)
const docsLiteIds = (() => {
  try {
    const dir = path.resolve('src/content/docs-lite');
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'));
    return new Map(files.map((f) => [f.slice(0, -3).toLowerCase(), f.slice(0, -3)]));
  } catch {
    return new Map();
  }
})();

// Remark plugin: rewrite ./foo.md -> /docs/foo for docs-lite only
function rewriteDocsMdLinks() {
  return (tree, file) => {
    const p = String(file?.path || '');
    const norm = p.replace(/\\/g, '/');
    if (!norm.includes('/src/content/docs-lite/')) return;

    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'link' && typeof node.url === 'string') {
        const url = node.url;
        if (/^[a-z]+:\/\//i.test(url) || url.startsWith('#') || url.startsWith('//')) {
          // external or anchor link: leave as-is
        } else {
          const [pathPart, hash] = url.split('#');
          if (/\.md$/i.test(pathPart)) {
            let name = pathPart.replace(/^\.\/?|^\/?/, '').replace(/\.md$/i, '');
            const base = name.split('/').pop() || name;
            const mapped = docsLiteIds.get(base.toLowerCase()) ?? base;
            node.url = `/docs/${mapped}${hash ? '#' + hash : ''}`;
          }
        }
      }
      if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(tree);
  };
}

// https://astro.build/config
export default defineConfig({
  site: 'https://stackinsight.dev',
  markdown: { remarkPlugins: [rewriteDocsMdLinks] },
  integrations: [mdx(), sitemap(), mermaid()],
});
