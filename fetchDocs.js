const puppeteer = require("puppeteer-core");
const fs = require("fs").promises;
const path = require("path");
const { sanitizeFilename } = require("./utils");

const OUTPUT_DIR = path.join(__dirname, "docs", "output");
const START_URL = "https://aps.autodesk.com/en/docs/viewer/v7/developers_guide/overview/";
const ROOT_URL = "https://aps.autodesk.com";

const PROXY_LIST = [
  "brd-customer-hl_2d47d2be-zone-autodesk_aps_api_scraper:l7bz23g11vir",
  // Add more proxy credentials here if available
];

let currentProxyIndex = 0;

async function createBrowser(proxyEndpoint) {
  console.log("Connecting to Scraping Browser...");
  const auth = PROXY_LIST[currentProxyIndex];
  currentProxyIndex = (currentProxyIndex + 1) % PROXY_LIST.length;
  return await puppeteer.connect({
    browserWSEndpoint: proxyEndpoint || `wss://${auth}@brd.superproxy.io:9222`,
  });
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Add this function to create the menu bar HTML
function createMenuBarHtml(menuLinks, outputDir) {
  const baseUrl = `file://${outputDir}`;

  let menuHtml = '<ul class="menu-bar">';

  menuLinks.forEach((link) => {
    if (link.href) {
      const href = link.href.replace(/^\//, "").replace(/\/?$/, ".html");
      const fullUrl = `${baseUrl}/${href}`;
      menuHtml += `<li><a href="${fullUrl}">${link.text}</a>`;
    } else {
      menuHtml += `<li>${link.text}`;
    }

    if (link.hasLinks) {
      menuHtml += "<ul>";
      // Recursively add nested links
      menuLinks.forEach((subLink) => {
        if (subLink.selector.startsWith(link.selector) && subLink.selector !== link.selector) {
          if (subLink.href) {
            const href = subLink.href.replace(/^\//, "").replace(/\/?$/, ".html");
            const fullUrl = `${baseUrl}/${href}`;
            menuHtml += `<li><a href="${fullUrl}">${subLink.text}</a></li>`;
          } else {
            menuHtml += `<li>${subLink.text}</li>`;
          }
        }
      });
      menuHtml += "</ul>";
    }

    menuHtml += "</li>";
  });

  menuHtml += "</ul>";
  return menuHtml;
}

async function fetchAndSaveContent(page, link, menuLinks, menuBarHtml) {
  console.log(`\nFetching content for: ${link.text} (${link.selector})`);

  try {
    // Remove the '#' from the selector if it exists
    const cleanSelector = link.selector.startsWith("#") ? link.selector.slice(1) : link.selector;

    // Try to click the selector, but don't wait for it
    await page.evaluate((sel) => {
      const element = document.querySelector(`[id="${sel}"]`);
      if (element) element.click();
    }, cleanSelector);

    // Wait for any navigation to complete
    await Promise.race([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }),
      page.waitForSelector(".api-documentation", { timeout: 10000 }),
    ]).catch(() => {
      console.log("Navigation or content load timed out, proceeding anyway.");
    });

    console.log("Extracting content...");
    let content = await page.evaluate(() => {
      const apiDocumentation = document.querySelector(".api-documentation");
      return apiDocumentation ? apiDocumentation.innerHTML : "";
    });

    if (!content) {
      console.log("Content not found using .api-documentation, trying alternative method...");
      content = await page.evaluate((sel) => {
        const contentElement = document.querySelector(`[id="${sel}"]`);
        return contentElement ? contentElement.innerHTML : "";
      }, cleanSelector);
    }

    if (!content) {
      throw new Error("Content not found");
    }

    // Remove "Show More" text after code blocks
    content = content.replace(/<div class="snippet-toggle js-snippet-toggle">Show More<\/div>/g, "");

    // Wrap code blocks with copy buttons
    function wrapCodeBlocksWithCopyButtons(content) {
      const codeBlockRegex = /<pre><code.*?>([\s\S]*?)<\/code><\/pre>/gi;
      return content.replace(codeBlockRegex, (match, codeContent) => {
        return `
          <div class="highlight">
            <button class="copy-button">Copy</button>
            <pre><code>${codeContent}</code></pre>
          </div>
        `;
      });
    }

    // Apply the wrapping to the content
    content = wrapCodeBlocksWithCopyButtons(content);

    // Handle CodePen iframes
    const iframeSelectors = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe[src*="codepen.io"]');
      return Array.from(iframes).map((iframe) => ({
        selector: `iframe[src="${iframe.src}"]`,
        src: iframe.src,
      }));
    });

    for (const { selector, src } of iframeSelectors) {
      console.log(`Processing CodePen iframe: ${src}`);

      const codePenContent = await page.evaluate((iframeSelector) => {
        const iframe = document.querySelector(iframeSelector);
        if (!iframe) return null;

        // Try to access the iframe content
        let iframeDocument;
        try {
          iframeDocument = iframe.contentDocument || iframe.contentWindow.document;
          console.log("got the iframe document", iframeDocument);
        } catch (e) {
          // If we can't access the iframe content, return null
          return null;
        }

        const htmlContent = iframeDocument.querySelector('.cm-s-default[data-lang="html"]')?.textContent || "";
        const cssContent = iframeDocument.querySelector('.cm-s-default[data-lang="css"]')?.textContent || "";
        const jsContent = iframeDocument.querySelector('.cm-s-default[data-lang="javascript"]')?.textContent || "";
        console.log("htmlContent from iframe: ", htmlContent);
        console.log("htmlContent from iframe: ", cssContent);
        console.log("htmlContent from iframe: ", jsContent);
        return { htmlContent, cssContent, jsContent };
      }, selector);

      if (codePenContent) {
        const codeBlock = `
    <p>CodePen Example:</p>
    <iframe src="${src}" style="width: 100%; height: 300px; border: 0; border-radius: 4px; overflow: hidden;" title="CodePen example" allow="accelerometer; ambient-light-sensor; camera; encrypted-media; geolocation; gyroscope; hid; microphone; midi; payment; usb; vr; xr-spatial-tracking" sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"></iframe>
    <pre><code class="language-html">${codePenContent.htmlContent.trim()}</code></pre>
    <pre><code class="language-css">${codePenContent.cssContent.trim()}</code></pre>
    <pre><code class="language-javascript">${codePenContent.jsContent.trim()}</code></pre>
    `;
        console.log("codePenContent: ", codePenContent);
        content = content.replace(
          new RegExp(`(<iframe[^>]*src="${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>.*?</iframe>)`, "gs"),
          (match) => `${match}\n${codeBlock}`
        );
      } else {
        console.log(`Unable to access content for iframe: ${src}`);
      }
    }

    console.log("Content extracted successfully");

    const title = await page.title();
    console.log(`Page title: ${title}`);

    // Get the current URL
    const currentUrl = await page.url();

    // Use the full URL path as the filename, only replacing the extension
    const filename = currentUrl.replace(ROOT_URL, "").replace(/^\//, "").replace(/\/?$/, ".html");

    const filePath = path.join(OUTPUT_DIR, filename);

    // Ensure the directory structure exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const css = `
body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  line-height: 1.6;
  color: #333;
  margin: 0;
  padding: 0;
  display: flex;
}

#nav-sidebar {
  width: 250px;
  height: 100vh;
  overflow-y: auto;
  background-color: #f5f5f5;
  padding: 20px;
  position: fixed;
  left: 0;
  top: 0;
}

#content {
  margin-left: 270px; /* 250px sidebar width + 20px padding */
  padding: 20px;
  max-width: calc(100% - 270px);
}

#breadCrumbs {
  background-color: #f5f5f5;
  padding: 10px;
  margin-bottom: 20px;
  border-radius: 5px;
}

#breadCrumbs a {
  color: #0696D7;
  text-decoration: none;
}

#breadCrumbs a:hover {
  text-decoration: underline;
}

.highlight {
  background-color: #f8f8f8;
  border: 1px solid #ddd;
  border-radius: 5px;
  padding: 15px;
  margin: 15px 0;
  position: relative;
}

.highlight pre {
  margin: 0;
  padding: 10px;
  white-space: pre-wrap;
  word-wrap: break-word;
  background-color: #f8f8f8;
}

.highlight code {
  font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace;
  font-size: 14px;
  line-height: 1.5;
}

.copy-button {
  position: absolute;
  top: 5px;
  right: 5px;
  background-color: #0696D7;
  color: white;
  border: none;
  border-radius: 3px;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 12px;
}

.copy-button:hover {
  background-color: #0570a3;
}

table {
  border-collapse: collapse;
  width: 100%;
  margin: 15px 0;
}

th, td {
  border: 1px solid #ddd;
  padding: 8px;
  text-align: left;
}

th {
  background-color: #f2f2f2;
}

img {
  max-width: 100%;
  height: auto;
}

.breadcrumb-container {
  display: flex;
  align-items: center;
}

.breadcrumb {
  display: inline;
}

.breadcrumb-url {
  color: #0696D7;
  text-decoration: none;
}

.breadcrumb-separator {
  margin: 0 5px;
  color: #6A6A6A;
}

.title-category {
  color: #6A6A6A;
  font-size: 14px;
  margin-bottom: 10px;
}

h1 {
  font-size: 28px;
  margin-bottom: 20px;
}

h2 {
  font-size: 22px;
  margin-top: 30px;
  margin-bottom: 15px;
}

h3 {
  font-size: 18px;
  margin-top: 25px;
  margin-bottom: 10px;
}

p {
  line-height: 1.6;
  margin-bottom: 15px;
}

code {
  background-color: #f0f0f0;
  padding: 2px 4px;
  border-radius: 3px;
  font-family: monospace;
}

.table-section {
  margin-bottom: 20px;
}

td {
  padding: 10px;
  border: 1px solid #e0e0e0;
}

.name {
  font-weight: bold;
}

.required {
  color: #ff0000;
}

.type {
  color: #0696D7;
}

.text-required {
  font-size: 12px;
  color: #6A6A6A;
  margin-top: 5px;
}
    `;
    const js = `
    document.addEventListener("DOMContentLoaded", () => {
      document.querySelectorAll(".copy-button").forEach((button) => {
        button.addEventListener("click", function() {
          copyToClipboard(this);
        });
      });
    });

    async function copyToClipboard(button) {
      const pre = button.closest('.highlight').querySelector('pre');
      const code = pre.querySelector("code");
      try {
        await navigator.clipboard.writeText(code.textContent);
        button.textContent = "Copied!";
        setTimeout(() => {
          button.textContent = "Copy";
        }, 2000);
      } catch (err) {
        console.error('Error in copying text: ', err);
        button.textContent = "Error";
      }
    }
    `;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    ${css}
  </style>
</head>
<body>
  <div id="nav-sidebar">${menuBarHtml}</div>
  <div id="content">
    ${content}
  </div>
  <script>
    ${js}
  </script>
</body>
</html>
`;

    await fs.writeFile(filePath, html);
    console.log(`Saved content to ${filePath}`);

    return true;
  } catch (error) {
    console.error(`Error fetching content for ${link.text} (${link.selector}): ${error.message}`);
    return false;
  }
}

async function getMenuLinks(page) {
  console.log("Getting menu links...");
  const links = await page.evaluate(() => {
    function getNestedLinks(element) {
      const nestedLinks = [];
      const subItems = element.querySelectorAll(":scope > ul > li > a");
      subItems.forEach((item) => {
        nestedLinks.push({
          selector: `#${item.id}`,
          text: item.textContent.trim(),
          href: item.getAttribute("href"),
          class: item.className,
          hasLinks: item.classList.contains("has-links"),
        });
        if (item.classList.contains("has-links")) {
          nestedLinks.push(...getNestedLinks(item.parentElement));
        }
      });
      return nestedLinks;
    }

    const links = [];
    const topLevelItems = document.querySelectorAll(".adskf__sidebar-menu > li > a");

    topLevelItems.forEach((item) => {
      links.push({
        selector: `#${item.id}`,
        text: item.textContent.trim(),
        href: item.getAttribute("href"),
        class: item.className,
        hasLinks: item.classList.contains("has-links"),
      });
      if (item.classList.contains("has-links")) {
        links.push(...getNestedLinks(item.parentElement));
      }
    });
    return links;
  });

  console.log(`Retrieved ${links.length} menu links`);
  return links;
}

async function expandAllMenuItems(page) {
  console.log("Expanding all menu items...");
  await page.evaluate(() => {
    const expandableItems = document.querySelectorAll(".adskf__sidebar-link.has-links:not(.open)");
    console.log(`Found ${expandableItems.length} expandable items`);
    expandableItems.forEach((item) => item.click());
  });

  // Wait for all expandable items to be fully expanded
  await page.waitForFunction(
    () => {
      const expandableItems = document.querySelectorAll(".adskf__sidebar-link.has-links");
      const openItems = document.querySelectorAll(".adskf__sidebar-link.has-links.open");
      console.log(`Expandable items: ${expandableItems.length}, Open items: ${openItems.length}`);
      return expandableItems.length === openItems.length;
    },
    { timeout: 30000 }
  );
  console.log("All menu items expanded");
}

async function main() {
  const browser = await createBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    // Ensure the output directory exists
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    console.log(`Navigating to the start page: ${START_URL}`);
    await page.goto(START_URL, { waitUntil: "networkidle2", timeout: 60000 });

    // Expand all menu items
    await expandAllMenuItems(page);

    // Get all menu links
    const menuLinks = await getMenuLinks(page);
    console.log("menuLinks: ", menuLinks);

    // Create the menu bar HTML
    const menuBarHtml = createMenuBarHtml(menuLinks, OUTPUT_DIR);

    for (const link of menuLinks) {
      console.log(`Processing: ${link.text} (${link.selector})`);

      let success = false;
      let retries = 3;

      while (!success && retries > 0) {
        success = await fetchAndSaveContent(page, link, menuLinks, menuBarHtml);
        if (!success) {
          console.log(`Retrying... (${retries} attempts left)`);
          retries--;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      if (!success) {
        console.log(`Failed to fetch content for ${link.text} after all retries`);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log("All documents have been processed.");
  } catch (error) {
    console.error("An error occurred:", error);
  } finally {
    await browser.close();
  }
}

main();
