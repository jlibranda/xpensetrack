FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm install
COPY src ./src
EXPOSE 3001
COPY start.sh ./
CMD ["sh", "start.sh"]
