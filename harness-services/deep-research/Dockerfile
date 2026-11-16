FROM node:22-bookworm-slim
WORKDIR /app
COPY server.js package.json ./
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
