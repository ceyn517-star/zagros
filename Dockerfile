FROM node:20-alpine

WORKDIR /app

# Memory limit for Node
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy client package files
COPY client/package*.json ./client/
RUN cd client && npm install && cd ..

# Copy all source code
COPY . .

# Build React client (with increased memory)
RUN cd client && NODE_OPTIONS="--max-old-space-size=4096" npm run build && cd ..

# Expose port
EXPOSE 5000

# Start server
CMD ["node", "server.js"]
