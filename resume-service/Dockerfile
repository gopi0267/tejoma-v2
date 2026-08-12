FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including devDeps since tsx is needed for runtime)
RUN npm install

# Copy source code
COPY . .

# Create empty .env.local so dotenv doesn't fail; docker-compose's env_file will override
RUN touch .env.local

# Expose port
EXPOSE 4031

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4031/health || exit 1

# Start service
CMD ["npm", "start"]
