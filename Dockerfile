FROM oven/bun:1.3.1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

EXPOSE 8787

CMD ["bun", "run", "start"]
