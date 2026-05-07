import type { APIRoute } from 'astro';

const website = 'https://grizzlygear-site.vercel.app';

// ここにサイト内で公開したいパスを追加する
const paths = [
  '/',
];

function urlEntry(path: string) {
  const loc = `${website.replace(/\/$/, '')}${path}`;
  return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${new Date().toISOString()}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`;
}

export const GET: APIRoute = async () => {
  const entries = paths.map(p => urlEntry(p)).join('\n');
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`;

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
    },
  });
};