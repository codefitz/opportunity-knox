FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY scripts/bundle-embedding.mjs scripts/embedding-model.json ./scripts/
RUN node scripts/bundle-embedding.mjs
COPY index.html vite.config.ts tsconfig*.json ./
COPY server/document-categories.json ./server/
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer poppler-utils tesseract-ocr tesseract-ocr-eng fonts-liberation2 fonts-crosextra-carlito fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:a81478bf74ed431d488f5954ba8bece10b17bdfafc24590a7048b283dcbd40f1 https://deb.debian.org/debian/pool/main/f/fonts-montserrat/fonts-montserrat_7.222-3_all.deb /tmp/montserrat.deb
RUN dpkg -i /tmp/montserrat.deb && rm /tmp/montserrat.deb
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4318 BOARD_DATA_DIR=/data BOARD_FILES_DIR=/files/default
WORKDIR /app
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY server ./server
COPY --from=build /app/models ./models
COPY --from=build /app/dist ./dist
EXPOSE 4318
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 CMD node -e "fetch('http://127.0.0.1:4318/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
