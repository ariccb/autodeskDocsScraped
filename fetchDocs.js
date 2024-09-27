const puppeteer = require("puppeteer-core");
const fs = require("fs").promises;
const path = require("path");
const { sanitizeFilename } = require("./utils");
const { css, js } = require("./pageStyles");

const OUTPUT_DIR = path.join(__dirname, "docs", "output");
const SCREENSHOTS_DIR = path.join(__dirname, "screenshots");
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

async function fetchAndSaveContent(page, selector, text) {
  console.log(`\nFetching content for: ${text} (${selector})`);

  try {
    // Remove the '#' from the selector if it exists
    const cleanSelector = selector.startsWith("#") ? selector.slice(1) : selector;

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
        } catch (e) {
          // If we can't access the iframe content, return null
          return null;
        }

        const htmlContent = iframeDocument.querySelector('.cm-s-default[data-lang="html"]')?.textContent || "";
        const cssContent = iframeDocument.querySelector('.cm-s-default[data-lang="css"]')?.textContent || "";
        const jsContent = iframeDocument.querySelector('.cm-s-default[data-lang="javascript"]')?.textContent || "";

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

    // Extract the path from the URL and create the filename
    const urlPath = new URL(currentUrl).pathname;
    const filename =
      urlPath
        .split("/")
        .filter((segment) => segment)
        .slice(1) // Remove only the first segment (en)
        .join("_")
        .toLowerCase() + ".html";

    const filePath = path.join(OUTPUT_DIR, filename);

    // Ensure the output directory exists
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    await fs.writeFile(
      filePath,
      `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="../../styles.css">
</head>
<body>
  <div id="nav-sidebar"></div>
  <div id="content">
    ${content}
  </div>
  <script src="../../script.js"></script>
</body>
</html>
`
    );
    console.log(`Saved content to ${filePath}`);

    return true;
  } catch (error) {
    console.error(`Error fetching content for ${text} (${selector}): ${error.message}`);
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
          selector: createUniqueSelector(item),
          text: item.textContent.trim(),
          hasLinks: item.classList.contains("has-links"),
        });
        if (item.classList.contains("has-links")) {
          nestedLinks.push(...getNestedLinks(item.parentElement));
        }
      });
      return nestedLinks;
    }

    function createUniqueSelector(element) {
      if (element.id) {
        return `#${element.id}`;
      }
      let selector = element.tagName.toLowerCase();
      if (element.className) {
        selector += `.${element.className.split(" ").join(".")}`;
      }
      const sameTagSiblings = Array.from(element.parentNode.children).filter((e) => e.tagName === element.tagName);
      if (sameTagSiblings.length > 1) {
        selector += `:nth-of-type(${Array.from(sameTagSiblings).indexOf(element) + 1})`;
      }
      return `${createUniqueSelector(element.parentElement)} > ${selector}`;
    }

    const links = [];
    const topLevelItems = document.querySelectorAll(".adskf__sidebar-menu > li > a");

    topLevelItems.forEach((item) => {
      links.push({
        selector: createUniqueSelector(item),
        text: item.textContent.trim(),
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

    // Create styles.css file in the docs folder if it doesn't exist
    const stylesPath = path.join(__dirname, "docs", "styles.css");
    if (
      !(await fs
        .access(stylesPath)
        .then(() => true)
        .catch(() => false))
    ) {
      await fs.writeFile(stylesPath, css);
      console.log("Created styles.css file");
    }

    // Create script.js file in the docs folder if it doesn't exist
    const scriptPath = path.join(__dirname, "docs", "script.js");
    if (
      !(await fs
        .access(scriptPath)
        .then(() => true)
        .catch(() => false))
    ) {
      await fs.writeFile(scriptPath, js);
      console.log("Created script.js file");
    }

    console.log(`Navigating to the start page: ${START_URL}`);
    await page.goto(START_URL, { waitUntil: "networkidle2", timeout: 60000 });

    // Expand all menu items
    await expandAllMenuItems(page);

    // Get all menu links
    const menuLinks = await getMenuLinks(page);

    for (const link of menuLinks) {
      console.log(`Processing: ${link.text} (${link.selector})`);

      let success = false;
      let retries = 3;

      while (!success && retries > 0) {
        success = await fetchAndSaveContent(page, link.selector, link.text);
        if (!success) {
          console.log(`Retrying... (${retries} attempts left)`);
          retries--;
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds before retrying
        }
      }

      if (!success) {
        console.log(`Failed to fetch content for ${link.text} after all retries`);
      }

      // Optional: Add a small delay between requests
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
