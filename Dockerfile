# Use Node.js LTS version
FROM node:18-slim

# Install build dependencies required for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install dependencies (including build tools for native modules)
RUN npm ci --only=production && npm cache clean --force

# Copy application files
COPY . .

# Create directory for database
RUN mkdir -p /app/data

# Expose port
EXPOSE 5050

# Set environment variable for port
ENV PORT=5050
ENV NODE_ENV=production

# Start the application
CMD ["node", "server.js"]
