const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const outputDir = path.join(__dirname, "docs", "output");
const sitemapFile = path.join(__dirname, "docs", "sitemap.xml");

function generateSitemap() {
  let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
  sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  function processDirectory(dir) {
    const files = fs.readdirSync(dir);

    files.forEach((file) => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        processDirectory(filePath);
      } else if (path.extname(file) === ".html") {
        const content = fs.readFileSync(filePath, "utf-8");
        const $ = cheerio.load(content);

        const title = $("title").text();
        const relativePath = path.relative(outputDir, filePath);
        const url = `file://${path.join(__dirname, "docs", "output", relativePath)}`;

        sitemap += "  <url>\n";
        sitemap += `    <loc>${url}</loc>\n`;
        sitemap += `    <title>${title}</title>\n`;
        sitemap += "  </url>\n";
      }
    });
  }

  processDirectory(outputDir);

  sitemap += "</urlset>";

  fs.writeFileSync(sitemapFile, sitemap);
  console.log("Sitemap generated successfully!");
}

generateSitemap();
