const puppeteer = require("puppeteer-core");
const fs = require("fs").promises;
const path = require("path");
const { sanitizeFilename } = require("./utils");
const { css, js } = require("./pageStyles");
const Bottleneck = require("bottleneck");

const OUTPUT_DIR = path.join(__dirname, "docs");
const SCREENSHOTS_DIR = path.join(__dirname, "screenshots");
const START_URL = "https://aps.autodesk.com/en/docs/viewer/v7/developers_guide/overview/";
const ROOT_URL = "https://aps.autodesk.com";

const PROXY_LIST = [
  "brd-customer-hl_2d47d2be-zone-autodesk_aps_api_scraper:l7bz23g11vir",
  // Add more proxy credentials here if available
];

let currentProxyIndex = 0;

const limiter = new Bottleneck({
  minTime: 2000, // Minimum time between requests (2 seconds)
});

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

async function fetchAndSaveContent(page, selector) {
  console.log(`\nFetching content for selector: ${selector}`);

  try {
    console.log(`Clicking selector: ${selector}`);
    await page.click(selector);
    await page.waitForNavigation({ waitUntil: "networkidle2" });

    console.log("Extracting content...");
    let content = await page.evaluate(() => {
      const apiDocumentation = document.querySelector("#api-documentation");
      return apiDocumentation ? apiDocumentation.innerHTML : document.body.innerHTML;
    });

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
        const iframeDocument = iframe.contentDocument || iframe.contentWindow.document;

        const htmlContent = iframeDocument.querySelector('.cm-s-default[data-lang="html"]')?.textContent || "";
        const cssContent = iframeDocument.querySelector('.cm-s-default[data-lang="css"]')?.textContent || "";
        const jsContent = iframeDocument.querySelector("#actual-js-code")?.textContent || "";

        return { htmlContent, cssContent, jsContent };
      }, selector);

      const codeBlock = `
<p>CodePen Example:</p>
<pre><code class="language-html">${codePenContent.htmlContent.trim()}</code></pre>
<pre><code class="language-css">${codePenContent.cssContent.trim()}</code></pre>
<pre><code class="language-javascript">${codePenContent.jsContent.trim()}</code></pre>
`;

      content = content.replace(
        new RegExp(`<iframe[^>]*src="${src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>.*?</iframe>`, "gs"),
        codeBlock
      );
    }

    console.log("Content extracted successfully");

    const title = await page.title();
    console.log(`Page title: ${title}`);

    // Save content (implement this part as before)
    // ...

    return true;
  } catch (error) {
    console.error(`Error fetching content for selector ${selector}: ${error.message}`);
    return false;
  }
}

async function getMenuLinks(page) {
  console.log("Getting menu links...");
  return await page.evaluate(() => {
    const links = [];
    const menuItems = document.querySelectorAll(".adskf__sidebar-menu a.adskf__sidebar-link");

    console.log(`Found ${menuItems.length} menu items`);
    menuItems.forEach((item, index) => {
      links.push({
        selector: `.adskf__sidebar-menu a.adskf__sidebar-link:nth-child(${index + 1})`,
        text: item.textContent.trim(),
        hasLinks: item.classList.contains("has-links"),
      });
    });
    return links;
  });
}

async function expandAllMenuItems(page) {
  await page.evaluate(() => {
    const expandableItems = document.querySelectorAll("adskf__sidebar-link");
    expandableItems.forEach((item) => item.click());
    console.log("expandableItems", expandableItems);
    return expandableItems;
  });

  // Wait for the last expandable item to be fully expanded
  await page.waitForFunction(
    () => {
      const lastExpandableItem = document.querySelector(".adskf_sidebar-link.has-links:not(.open)");
      return !lastExpandableItem;
    },
    { timeout: 30000 }
  );
}

async function main() {
  const browser = await createBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    console.log(`Navigating to the start page: ${START_URL}`);
    await page.goto(START_URL, { waitUntil: "networkidle2" });

    // Expand all menu items
    await expandAllMenuItems(page);

    // Get all menu links
    const menuLinks = await getMenuLinks(page);

    for (const link of menuLinks) {
      console.log(`Processing: ${link.text} (${link.selector})`);

      const success = await limiter.schedule(() => fetchAndSaveContent(page, link.selector));

      if (!success) {
        console.log(`Failed to fetch content for ${link.text}, moving to next item`);
      }

      // Check if we've processed all links
      const lastLiElement = await page.$eval(".adskf__sidebar-menu li:last-child a", (el) => el.classList.contains("active"));
      if (lastLiElement) {
        console.log("Reached the last menu item. Stopping the process.");
        break;
      }
    }

    console.log("All documents have been processed.");
  } catch (error) {
    console.error("An error occurred:", error);
  } finally {
    await browser.close();
  }
}

main();
