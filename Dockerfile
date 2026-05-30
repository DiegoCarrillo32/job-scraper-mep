FROM node:20-slim

# Install basic tools for key management and downloads
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package configurations
COPY package*.json ./

# Install production dependencies (downloads Puppeteer's Chrome automatically)
RUN npm ci --only=production

# Install Playwright's Chromium browser and all required system OS dependencies
RUN npx playwright install --with-deps chromium

# Copy the rest of the application
COPY . .

# Run the bot
CMD ["node", "index.js"]
