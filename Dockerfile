FROM node:20-slim

# Prevent Puppeteer and Playwright from downloading their own browsers during npm install
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install system Chromium (automatically pulls all required OS libraries)
RUN apt-get update && apt-get install -y \
    chromium \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package configurations
COPY package*.json ./

# Install only production dependencies using clean install
RUN npm ci --only=production

# Copy the rest of the application
COPY . .

# Run the bot
CMD ["node", "index.js"]
