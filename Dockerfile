FROM node:22-slim

# better-sqlite3 在部分平台需要编译，预装构建工具以防没有预编译包。
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

# 数据库默认写到 /app/data，建议挂载卷持久化。
VOLUME ["/app/data"]

ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/server.js"]
