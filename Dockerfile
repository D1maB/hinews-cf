# Workerd — the local runtime used by `wrangler dev` — is linked against glibc,
# so a musl-only Alpine image cannot run it. This Alpine image adds glibc on top.
FROM frolvlad/alpine-glibc:alpine-3.21

RUN apk add --no-cache nodejs npm

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 8787

CMD ["npm", "run", "dev"]
