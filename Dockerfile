# JARVIS on Hugging Face Spaces (Docker SDK).
#
# One image: build the React frontend, then run the Node server which serves the
# built frontend + the API on a single port. Runs as the non-root `node` user
# (uid 1000) — the node:22 image already provides it, and uid 1000 is what
# Hugging Face Spaces expects.
FROM node:22

# HF Spaces routes traffic to this port; our server reads process.env.PORT.
ENV PORT=7860
ENV HOME=/home/node

# Own the app dir as the non-root user so it can write the SQLite file and the
# embedding-model cache at runtime.
RUN mkdir -p /app && chown -R node:node /app
USER node
WORKDIR /app

# Copy source (node_modules/dist/data excluded via .dockerignore), then install
# deps and build the frontend. The root `build` script forces dev deps so Vite
# is available even when the platform sets NODE_ENV=production.
COPY --chown=node:node . .
RUN npm run build

EXPOSE 7860
CMD ["npm", "start"]
