require("dotenv").config();
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const TARGET_URL = process.env.TARGET_URL;

if (!TARGET_URL || TARGET_URL === "https://example.com/jobs") {
  console.error(
    "Please set the actual TARGET_URL in the .env file or environment.",
  );
  process.exit(1);
}

// Read configurations
let configs = [];
try {
  const configData = fs.readFileSync("./config.json", "utf8");
  const parsed = JSON.parse(configData);
  configs = Array.isArray(parsed) ? parsed : [parsed];
} catch (err) {
  console.error("Could not read config.json:", err);
  process.exit(1);
}

let isRunning = false;

// Keep track of notified jobs using a persistent cache file.
const CACHE_FILE = "./cache.json";
let notifiedJobs = new Set();
let lastClearedTime = Date.now();

function saveCache() {
  const payload = {
    lastCleared: lastClearedTime,
    jobs: Array.from(notifiedJobs),
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2));
}

function checkAndClearCache() {
  const oneDayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  if (now - lastClearedTime >= oneDayMs) {
    console.log(
      `\n[${new Date().toISOString()}] 24 hours have passed since last cache clear. Clearing cache...`,
    );
    notifiedJobs.clear();
    lastClearedTime = now;
    saveCache();
  }
}

function loadCache() {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const data = fs.readFileSync(CACHE_FILE, "utf8");
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        lastClearedTime = parsed.lastCleared || Date.now();
        notifiedJobs = new Set(parsed.jobs || []);
      } else if (Array.isArray(parsed)) {
        notifiedJobs = new Set(parsed);
        lastClearedTime = Date.now();
        saveCache(); // Upgrade format immediately
      }
    } catch (err) {
      console.error("Error reading cache.json:", err);
    }
  } else {
    saveCache();
  }
  checkAndClearCache();
}

// Initial load
loadCache();

// Helper to escape special HTML characters for Telegram message parsing
function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function runBots() {
  loadCache();
  if (isRunning) {
    console.log(
      `\n[${new Date().toISOString()}] Scrape cycle already in progress, skipping.`,
    );
    return;
  }
  isRunning = true;
  console.log(`\n[${new Date().toISOString()}] Running job scrape bots...`);

  // Launch browser
  const launchOptions = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  };
  const browser = await chromium.launch(launchOptions);
  let context = null;
  let page = null;

  try {
    // Reload configs dynamically to pick up any manual changes to config.json
    let currentConfigs = [];
    try {
      const configData = fs.readFileSync("./config.json", "utf8");
      const parsed = JSON.parse(configData);
      currentConfigs = Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
      console.warn(
        "Could not read config.json during run, using startup config:",
        err.message,
      );
      currentConfigs = configs;
    }

    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
      extraHTTPHeaders: {
        "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
      },
    });
    page = await context.newPage();

    // Bypass basic headless browser detection
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    });

    // Navigate to target URL
    console.log(`-> Navigating to target URL: ${TARGET_URL}`);
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

    // Wait for Blazor WebSocket to initialize and render the regional select dropdown
    console.log("   Waiting for regional select element to be visible...");
    await page.waitForSelector("#regionalSelect", { state: "visible", timeout: 15000 });

    // Wait until the select has loaded real options (more than just the placeholder)
    await page.waitForFunction(() => {
      const select = document.querySelector("#regionalSelect");
      return select && select.options.length > 1;
    }, { timeout: 15000 });

    // Extract all valid region options from the dropdown
    const regions = await page.evaluate(() => {
      const select = document.querySelector("#regionalSelect");
      if (!select) return [];
      return Array.from(select.options)
        .map((opt) => ({ value: opt.value, text: opt.innerText.trim() }))
        .filter((opt) => opt.value !== ""); // Exclude placeholder option
    });

    if (regions.length === 0) {
      throw new Error("No regional options found in the select dropdown. The page may have failed to load or initialize correctly.");
    }

    console.log(
      `   Found ${regions.length} region(s) in dropdown:`,
      regions.map((r) => r.text).join(", "),
    );

    for (const region of regions) {
      console.log(
        `\n   -> Processing Region: "${region.text}" (ID: ${region.value})`,
      );

      try {
        // Select option
        await page.selectOption("#regionalSelect", region.value);

        // Wait a moment for table to begin update
        await page.waitForTimeout(1500);

        // Wait for empty row to disappear (signaling table populated)
        try {
          await page.waitForFunction(
            () => !document.querySelector(".mud-table-empty-row"),
            { timeout: 6000 },
          );
        } catch (e) {
          console.log(
            `      [Info] Waiting for empty row to disappear timed out. Proceeding...`,
          );
        }

        // Look for rows that match our criteria
        const rows = await page.$$("tr");
        console.log(
          `      Found ${rows.length} rows on the page. Inspecting data...`,
        );
        let foundJobs = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const tds = await row.$$("td");

          if (tds.length === 0) continue; // Skip headers

          // Log row contents for debugging
          let rowData = [];
          for (let j = 0; j < tds.length; j++) {
            const text = await tds[j].innerText();
            rowData.push(`td[${j + 1}]: "${text.trim()}"`);
          }
          console.log(`      [Row ${i}] -> ${rowData.join(" | ")}`);

          // Get the specialty, region, and clase de puesto cells
          const especialidadTd = await row.$('td[data-label="Especialidad"]');
          if (!especialidadTd) continue;

          const specialtyText = (await especialidadTd.innerText()).trim();

          const regionalTd = await row.$('td[data-label="Dirección Regional"]');
          const regionalText = regionalTd
            ? (await regionalTd.innerText()).trim()
            : region.text;

          const clasePuestoTd = await row.$('td[data-label="Clase de Puesto"]');
          const clasePuestoText = clasePuestoTd
            ? (await clasePuestoTd.innerText()).trim()
            : "";

          // Check if it matches any configuration list
          for (const config of currentConfigs) {
            const targetSpecs =
              config.especialidades ||
              (config.filters && config.filters.Especialidad) ||
              [];
            const targetClases = config.clasesPuesto || [];

            const matchedSpecialty = targetSpecs.find((spec) =>
              specialtyText.toLowerCase().includes(spec.toLowerCase()),
            );

            const matchedClase = targetClases.find((clase) =>
              clasePuestoText.toLowerCase().includes(clase.toLowerCase()),
            );

            const hasSpecMatch = targetSpecs.length > 0 && matchedSpecialty;
            const hasClaseMatch = targetClases.length > 0 && matchedClase;

            if (hasSpecMatch || hasClaseMatch) {
              const vacanteTd = await row.$('td[data-label="Vacante"]');
              const vacanteId = vacanteTd
                ? (await vacanteTd.innerText()).trim()
                : null;
              const rowText = await row.innerText();

              foundJobs.push({
                vacanteId,
                rowText: rowText.trim(),
                telegramBotToken: config.telegramBotToken,
                telegramChatId: config.telegramChatId,
                regionalText,
                specialtyText,
                clasePuestoText,
              });
            }
          }
        }

        if (foundJobs.length > 0) {
          console.log(
            `      Found ${foundJobs.length} matching job(s) in region "${region.text}"!`,
          );
          for (const job of foundJobs) {
            const {
              vacanteId,
              rowText,
              telegramBotToken,
              telegramChatId,
              regionalText,
              specialtyText,
              clasePuestoText,
            } = job;

            const cleanRegion = regionalText
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "-")
              .replace(/-+/g, "-")
              .trim();
            const cleanSpecialty = specialtyText
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "-")
              .replace(/-+/g, "-")
              .trim();
            const cleanClase = clasePuestoText
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "-")
              .replace(/-+/g, "-")
              .trim();
            const cleanVacante = (vacanteId || "no_id").trim();
            const jobId = `vacante-${cleanVacante}-${cleanRegion}-${cleanClase}-${cleanSpecialty}`;

            if (!notifiedJobs.has(jobId)) {
              notifiedJobs.add(jobId);
              saveCache();

              // Build Telegram message in safe HTML format
              const htmlMessage =
                `🚨 <b>¡Nueva Vacante Encontrada!</b>\n\n` +
                `📍 <b>Región:</b> ${escapeHtml(regionalText)}\n` +
                `💼 <b>Clase de Puesto:</b> ${escapeHtml(clasePuestoText || "N/A")}\n` +
                `🎯 <b>Especialidad:</b> ${escapeHtml(specialtyText || "N/A")}\n\n` +
                `📝 <b>Detalles:</b>\n${escapeHtml(rowText)}\n\n` +
                `🔗 <b>Enlace:</b> <a href="${escapeHtml(TARGET_URL)}">${escapeHtml(TARGET_URL)}</a>`;

              console.log(
                `      Sending Telegram message to chat ${telegramChatId}...`,
              );
              try {
                const response = await fetch(
                  `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      chat_id: telegramChatId,
                      text: htmlMessage,
                      parse_mode: "HTML",
                    }),
                    signal: AbortSignal.timeout(10000), // Timeout after 10 seconds
                  },
                );

                if (!response.ok) {
                  const errText = await response.text();
                  throw new Error(
                    `Telegram API returned status ${response.status}: ${errText}`,
                  );
                }
                console.log(`      Telegram message sent successfully.`);
              } catch (sendErr) {
                console.error(
                  `      Failed to send Telegram message:`,
                  sendErr.message,
                );
              }
            }
          }
        } else {
          console.log(`      No new jobs found in region "${region.text}".`);
        }
      } catch (regionError) {
        console.error(
          `      Error processing region "${region.text}":`,
          regionError.message,
        );
      }
    }

    if (page) await page.close();
  } catch (error) {
    console.error("Error during scraping cycle:", error.message);
    if (page && !page.isClosed()) {
      try {
        const screenshotPath = path.join(__dirname, "error-screenshot.png");
        const htmlPath = path.join(__dirname, "error-page.html");
        await page.screenshot({ path: screenshotPath, fullPage: true });
        const html = await page.content();
        fs.writeFileSync(htmlPath, html);
        console.log(`Saved debug files: ${screenshotPath} and ${htmlPath}`);
      } catch (err) {
        console.error(
          "Failed to capture error page screenshot/content:",
          err.message,
        );
      }
    }
  } finally {
    await browser.close();
    isRunning = false;
    console.log(`[${new Date().toISOString()}] Scrape cycle complete.`);
  }
}

// Start bot loop
console.log("Starting Telegram Job Scraper Bot...");
runBots();
setInterval(runBots, 1 * 60 * 1000);
