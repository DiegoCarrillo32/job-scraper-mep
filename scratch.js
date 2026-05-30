const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log("Navigating...");
  await page.goto("https://apps.mep.go.cr/formulario?shem=rimspwouoe", { waitUntil: 'domcontentloaded' });
  
  console.log("Waiting 5 seconds for Blazor SignalR connection...");
  await page.waitForTimeout(5000);
  
  const regionalSelect = await page.$('#regionalSelect');
  if (regionalSelect) {
      console.log("Selecting option 56 on the first select...");
      await regionalSelect.selectOption('56');
      
      console.log("Selected 56, waiting for table to populate...");
      
      // Wait for table to change (we can wait for the empty row to disappear)
      try {
         await page.waitForFunction(() => !document.querySelector('.mud-table-empty-row'), { timeout: 10000 });
         console.log("Table populated!");
      } catch (e) {
         console.log("Table did not populate within 10s.");
      }
      
      const tableHtml = await page.$eval('table', el => el.outerHTML).catch(() => "No table found");
      require('fs').writeFileSync('table.html', tableHtml);
      console.log("Wrote table HTML to table.html");
  } else {
      console.log("No select found!");
  }

  await browser.close();
})();
