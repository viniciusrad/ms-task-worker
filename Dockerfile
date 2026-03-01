# ==================================
# ESTÁGIO 1: Build (TypeScript -> JS) 
# ==================================
FROM node:20-alpine AS builder
WORKDIR /app

# Copia dependências e instala
COPY package.json package-lock.json* ./
RUN npm install

# Copia código-fonte TS e compila
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ==================================
# ESTÁGIO 2: Produção (Apenas JS)
# ==================================
FROM node:20-alpine AS runner
WORKDIR /app

# Em produção, apenas NODE_ENV=production para instalar e rodar mais leve
ENV NODE_ENV=production

# Instala apenas as dependências requeridas em prod (ignora ts-node, etc)
COPY package.json package-lock.json* ./
RUN npm install --production

# Traz apenas o código transpilado do estágio 1 pra manter container pequeno (< 150mb)
COPY --from=builder /app/dist ./dist

# [HARDCODE SECRETS] Copia as senhas reais para a imagem oca (A pedido do usuário para não manter arquivos no sistema)
COPY .env ./

# Inicia o worker ouvindo eternamente a fila do Rabbit
CMD ["node", "dist/index.js"]
