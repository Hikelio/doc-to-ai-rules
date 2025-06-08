FROM node:18-slim

# Install git, curl, fd and other dependencies
RUN apt-get update && \
    apt-get install -y git curl fd-find && \
    ln -s $(which fdfind) /usr/local/bin/fd && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY scripts/package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY scripts/ ./

# Create entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Set entrypoint
ENTRYPOINT ["/entrypoint.sh"] 