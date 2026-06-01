const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log("Navigating to target URL...");
  await page.goto("https://apps.mep.go.cr/formulario?shem=rimspwouoe", { waitUntil: 'domcontentloaded' });
  
  console.log("Waiting for #regionalSelect...");
  await page.waitForSelector("#regionalSelect", { state: "visible", timeout: 15000 });

  // Let Blazor initialize
  await page.waitForTimeout(5000);

  const containerSelector = ".mud-table-container";
  
  const initialHtml = await page.$eval(containerSelector, el => el.innerHTML).catch(() => "No container");
  console.log("Initial table container HTML length:", initialHtml.length);

  console.log("Selecting option 44 (Administracion Regional Del Sist. Educ.)...");
  await page.selectOption('#regionalSelect', '44');

  // Monitor DOM changes every 200ms for 10 seconds
  const monitorDuration = 10000;
  const interval = 200;
  let elapsed = 0;

  while (elapsed < monitorDuration) {
    await page.waitForTimeout(interval);
    elapsed += interval;
    
    const currentHtml = await page.$eval(containerSelector, el => el.innerHTML).catch(() => "No container");
    const hasEmptyRow = currentHtml.includes("mud-table-empty-row");
    const hasRegionText = currentHtml.toLowerCase().includes("administracion regional");
    const trCount = (currentHtml.match(/<tr/g) || []).length;
    
    console.log(`[${elapsed}ms] trCount: ${trCount} | hasEmptyRow: ${hasEmptyRow} | hasRegionText: ${hasRegionText}`);
  }

  await browser.close();
})();
