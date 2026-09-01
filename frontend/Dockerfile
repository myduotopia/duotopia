# 多階段建置
FROM node:18-alpine AS builder

# Cache buster for production deployments
ARG BUILD_TIMESTAMP
RUN echo "Build timestamp: $BUILD_TIMESTAMP"

WORKDIR /app

# 複製 package files
COPY package*.json ./

# 安裝依賴
RUN npm ci

# 複製原始碼
COPY . .

# 建置時設定 API URL（使用 build argument）
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

# Environment（決定是否顯示測試帳號）
ARG VITE_ENVIRONMENT=development
ENV VITE_ENVIRONMENT=$VITE_ENVIRONMENT

# TapPay 配置 - 支援 production 和 sandbox 兩種模式
ARG VITE_TAPPAY_SERVER_TYPE
ARG VITE_TAPPAY_PRODUCTION_APP_ID
ARG VITE_TAPPAY_PRODUCTION_APP_KEY
ARG VITE_TAPPAY_SANDBOX_APP_ID
ARG VITE_TAPPAY_SANDBOX_APP_KEY

ENV VITE_TAPPAY_SERVER_TYPE=$VITE_TAPPAY_SERVER_TYPE
ENV VITE_TAPPAY_PRODUCTION_APP_ID=$VITE_TAPPAY_PRODUCTION_APP_ID
ENV VITE_TAPPAY_PRODUCTION_APP_KEY=$VITE_TAPPAY_PRODUCTION_APP_KEY
ENV VITE_TAPPAY_SANDBOX_APP_ID=$VITE_TAPPAY_SANDBOX_APP_ID
ENV VITE_TAPPAY_SANDBOX_APP_KEY=$VITE_TAPPAY_SANDBOX_APP_KEY

# Google Analytics 4
ARG VITE_GA_MEASUREMENT_ID
ENV VITE_GA_MEASUREMENT_ID=$VITE_GA_MEASUREMENT_ID

# Meta (Facebook) Pixel
ARG VITE_META_PIXEL_ID
ENV VITE_META_PIXEL_ID=$VITE_META_PIXEL_ID

# Issue #768 group-buy entry-point gate (see Dockerfile.staging).
ARG VITE_ENABLE_GROUP_BUY=true
ENV VITE_ENABLE_GROUP_BUY=$VITE_ENABLE_GROUP_BUY

# 建置
RUN npm run build

# Production stage
FROM nginx:alpine

# Cache buster for production - ensure fresh files are copied
ARG BUILD_TIMESTAMP
RUN echo "Copying dist files built at: $BUILD_TIMESTAMP"

# 複製建置結果
COPY --from=builder /app/dist /usr/share/nginx/html

# 複製 nginx 配置模板
COPY nginx.conf.template /etc/nginx/conf.d/nginx.conf.template

# 共用 security headers 片段（Issue #940）— nginx.conf.template include 它。
# 放 snippets/ 而非 conf.d/：conf.d/*.conf 會被主設定自動載入成 http-level 設定。
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf

# 複製啟動腳本
COPY start.sh /start.sh
RUN chmod +x /start.sh

# 移除預設的 nginx 配置
RUN rm -f /etc/nginx/conf.d/default.conf

# 暴露端口
EXPOSE 80

# 使用 ENTRYPOINT 確保腳本一定會執行
ENTRYPOINT ["/start.sh"]
