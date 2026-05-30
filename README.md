# Costa Rica MEP Job Scraper Bot 🇨🇷🤖

This is an automated web scraper and WhatsApp notification bot designed to monitor the [MEP (Ministerio de Educación Pública) Costa Rica](https://apps.mep.go.cr/formulario?shem=rimspwouoe) job portal. It constantly checks for newly posted job vacancies that match your specific criteria, and instantly alerts you via WhatsApp so you can apply immediately!

## Features
- **Dynamic Scraping:** Uses Playwright to interact with Blazor Server websockets.
- **Advanced Filtering:** Filter by Region, Job Title (Clase de Puesto), Specialty (Especialidad), or any other column.
- **Smart Fallbacks:** Can find regions by their exact ID or fallback to matching text.
- **Anti-Spam Cache:** Keeps a persistent cache (`cache.json`) of notified jobs so you don't get spammed with the same job twice, even if your laptop restarts.
- **WhatsApp Integration:** Can send alerts to your personal WhatsApp or directly to a Group Chat.
- **Docker Support:** Runs seamlessly in the background on system startup.

---

## 🛠 Prerequisites
You can run this bot locally on your machine or inside a Docker container.
- [Node.js](https://nodejs.org/en) (v18+ recommended)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Optional, but highly recommended for background running)

---

## ⚙️ Configuration (`config.json`)
Before running the bot, you must set your target jobs in `config.json`. The file contains an array of objects, meaning you can configure the bot to search multiple different regions at the same time!

### Example Configuration:
```json
[
  {
    "regionalValue": "56",
    "regionalTextValue": "San Carlos",
    "filters": {
      "Especialidad": [
         "Labores Varias De Oficina", 
         "Conserje"
      ]
    },
    "whatsappNumber": "50612345678@c.us"
  }
]
```

### Config Options Explained:
- **`regionalValue`**: The internal HTML value ID of the region dropdown (e.g. `"56"`). Leave this as `""` if you just want to use the text name.
- **`regionalTextValue`**: The text name of the region. If the bot can't find `regionalValue` (because IDs change), it will search the dropdown text for this string instead.
- **`filters`**: An object containing the columns you want to filter by. The key must match the exact table header (e.g., `"Especialidad"`, `"Clase de Puesto"`, `"Institución"`).
  - You can pass a single string: `"Clase de Puesto": "Profesor"`
  - Or an array for "OR" logic: `"Especialidad": ["Conserje", "Oficinista"]`
  - Leave it completely empty `{}` to be alerted of **EVERY** job posted in that region.
- **`whatsappNumber`**: Where to send the alert.
  - **Individual Contact:** Your 8-digit Costa Rican number followed by `@c.us` (e.g. `50688888888@c.us`). No spaces or `+`.
  - **Group Chat:** The internal WhatsApp group ID followed by `@g.us` (e.g. `120363024567890123@g.us`).

> **Tip:** If you need to find a Group Chat ID, run the included `node get-groups.js` script to print out all the groups your WhatsApp account is currently in!

---

## 🚀 Running the Bot (Local / Testing)

1. **Install dependencies:**
   ```bash
   npm install
   npx playwright install
   ```
2. **Set up your environment:**
   Make sure you have a `.env` file with:
   ```env
   TARGET_URL=https://apps.mep.go.cr/formulario?shem=rimspwouoe
   ```
3. **Run the bot:**
   ```bash
   node index.js
   ```
4. **Authenticate WhatsApp:**
   The first time you run the bot, it will print a massive QR code in your terminal. Open WhatsApp on your phone -> Settings -> Linked Devices -> Link a Device, and scan the terminal screen.

---

## 🐳 Running in Background (Docker Production)

Running the bot in Docker is the best way to keep it running 24/7 without terminal windows staying open. It is configured to wake up automatically whenever you turn on your laptop.

1. Ensure Docker Desktop is running.
2. In your terminal, run:
   ```bash
   docker-compose up -d --build
   ```
3. The bot is now running silently in the background! 

### Docker Commands:
- **View Bot Logs:** (Use this if you need to scan a new QR code or check if it found jobs)
  ```bash
  docker logs -f job-scraper-bot
  ```
- **Stop the Bot:**
  ```bash
  docker-compose down
  ```

*Note: Your `config.json` and WhatsApp Session (`.wwebjs_auth`) are shared automatically with Docker. If you change a filter in `config.json` while Docker is running, just restart the container to apply it!*
# job-scraper-mep
