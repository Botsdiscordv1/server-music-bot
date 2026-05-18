FROM caddy:alpine AS caddy

FROM eclipse-temurin:17-jre

WORKDIR /app

ARG LAVALINK_VERSION=4.2.2
ARG LAVASRC_VERSION=4.8.1
ARG YT_VERSION=1.18.1

# Download Lavalink
ADD https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar /app/Lavalink.jar

# Download plugins
RUN mkdir -p /app/plugins
ADD https://github.com/topi314/LavaSrc/releases/download/${LAVASRC_VERSION}/lavasrc-plugin-${LAVASRC_VERSION}.jar /app/plugins/lavasrc-plugin.jar
ADD https://github.com/lavalink-devs/youtube-source/releases/download/${YT_VERSION}/youtube-plugin-${YT_VERSION}.jar /app/plugins/youtube-plugin.jar

# Copy config
COPY application.yml /app/

# Copy Caddy from builder
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 10000 2333

CMD caddy run --config /etc/caddy/Caddyfile & java -jar Lavalink.jar
