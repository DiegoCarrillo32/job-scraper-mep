require("dotenv").config();
const { chromium } = require("playwright");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");

const TARGET_URL = process.env.TARGET_URL;

if (!TARGET_URL || TARGET_URL === "https://example.com/jobs") {
  console.error("Please set the actual TARGET_URL in the .env file.");
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

// Clean up leftover Chromium locks (e.g. from Docker restarts/crashes)
// SingletonLock is a symlink, so we use lstatSync to detect it even if it is broken.
const lockFiles = ["SingletonLock", "SingletonSocket", "SingletonCookie"];
for (const file of lockFiles) {
  const filePath = path.join(__dirname, ".wwebjs_auth", "session", file);
  try {
    fs.lstatSync(filePath);
    fs.unlinkSync(filePath);
    console.log(`Cleaned up leftover Chromium file: ${file}`);
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn(
        `Could not delete leftover Chromium file ${file}:`,
        err.message,
      );
    }
  }
}

// Initialize WhatsApp Client
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr) => {
  // Generate and scan this code with your phone
  console.log("Please scan the QR code below with your WhatsApp app:");
  qrcode.generate(qr, { small: true });
});

let isRunning = false;

client.on("ready", () => {
  console.log("WhatsApp Client is ready!");
  // Start the scraping loop every 5 minutes (300000 ms)
  setInterval(runBots, 5 * 60 * 1000);
  // Run immediately on start
  runBots();
});

console.log(
  "Starting WhatsApp client... This can take 15-30 seconds to restore the session.",
);
client.initialize();

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

async function runBots() {
  checkAndClearCache();
  if (isRunning) {
    console.log(
      `\n[${new Date().toISOString()}] Scrape cycle already in progress, skipping.`,
    );
    return;
  }
  isRunning = true;
  console.log(`\n[${new Date().toISOString()}] Running job scrape bots...`);

  // Launch browser
  const launchOptions = { headless: true };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const browser = await chromium.launch(launchOptions);

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

    const page = await browser.newPage();

    // Navigate to target URL
    console.log(`-> Navigating to target URL: ${TARGET_URL}`);
    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

    // Wait for Blazor WebSocket to initialize
    console.log("   Waiting 5 seconds for Blazor to initialize...");
    await page.waitForTimeout(5000);

    // Extract all valid region options from the dropdown
    const regions = await page.evaluate(() => {
      const select = document.querySelector("#regionalSelect");
      if (!select) return [];
      return Array.from(select.options)
        .map((opt) => ({ value: opt.value, text: opt.innerText.trim() }))
        .filter((opt) => opt.value !== ""); // Exclude placeholder option
    });

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
                whatsappNumber: config.whatsappNumber,
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
              whatsappNumber,
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

              const message =
                `🚨 *¡Nueva Vacante Encontrada!*\n\n` +
                `📍 *Región:* ${regionalText}\n` +
                `💼 *Clase de Puesto:* ${clasePuestoText || "N/A"}\n` +
                `🎯 *Especialidad:* ${specialtyText || "N/A"}\n\n` +
                `📝 *Detalles:*\n${rowText}\n\n` +
                `🔗 *Enlace:* ${TARGET_URL}`;

              console.log(
                `      Sending WhatsApp message to ${whatsappNumber}...`,
              );
              try {
                await client.sendMessage(whatsappNumber, message);
                console.log(`      Message sent successfully.`);
              } catch (sendErr) {
                console.error(
                  `      Failed to send message to ${whatsappNumber}:`,
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

    await page.close();
  } catch (error) {
    console.error("Error during scraping cycle:", error.message);
  } finally {
    await browser.close();
    isRunning = false;
    console.log(`[${new Date().toISOString()}] Scrape cycle complete.`);
  }
}
