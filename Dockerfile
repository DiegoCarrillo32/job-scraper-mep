FROM node:20-bookworm

# Install minimal OS dependencies for Chromium/Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package configuration
COPY package*.json ./

# Install JS dependencies
RUN npm install

# Install Playwright browser and its missing OS dependencies
RUN npx playwright install --with-deps chromium

# Copy the rest of the application
COPY . .

# Run the bot
CMD ["node", "index.js"]
