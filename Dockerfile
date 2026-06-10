# ── Build stage: compile the React frontend ──────────────
FROM node:18-slim AS frontend-build

WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
# Vite copies client/public/* (manifest, sw.js, icons) into the build output and
# writes the bundle to /app/public (outDir: ../public).
RUN npm run build

# ── Production stage ─────────────────────────────────────
FROM node:18-slim

# Install Python for edge-tts (text-to-speech)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip && \
    pip3 install edge-tts --break-system-packages && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies (reproducible, production-only) (#34)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Pre-bake the embedding model into the image so document indexing (RAG / Feature
# 2) never blocks on a ~50MB cold-start download at runtime. The same TRANSFORMERS_CACHE
# path is used at runtime (server/embeddings.js), so the cached model is reused.
ENV TRANSFORMERS_CACHE=/app/.cache/transformers
RUN node -e "(async()=>{const t=await import('@xenova/transformers');t.env.cacheDir=process.env.TRANSFORMERS_CACHE;await t.pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2');console.log('✅ embedding model baked into image');})().catch(e=>{console.error(e);process.exit(1)})"

# Copy server code
COPY server/ ./server/

# Copy built frontend (bundle + PWA assets) from the build stage. Vite already
# folded client/public/* into here, so the second copy is redundant (#53).
COPY --from=frontend-build /app/public/ ./public/

# Persistent data lives on a mounted volume in production (DB, encryption key,
# VAPID keypair, Google token, backups). Mount a Railway volume at /data.
ENV NODE_ENV=production
ENV DATA_DIR=/data
RUN mkdir -p /data audio logs

EXPOSE 3000

CMD ["node", "server/index.js"]
