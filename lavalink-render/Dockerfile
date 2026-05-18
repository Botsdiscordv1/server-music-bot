FROM eclipse-temurin:17-jre

# Install Node.js 20 (needed for WebSocket proxy)
RUN apt-get update && apt-get install -y curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG LAVALINK_VERSION=4.2.2
ARG LAVASRC_VERSION=4.8.1
ARG YT_VERSION=1.18.1

ADD https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar /app/Lavalink.jar

RUN mkdir -p /app/plugins
ADD https://github.com/topi314/LavaSrc/releases/download/${LAVASRC_VERSION}/lavasrc-plugin-${LAVASRC_VERSION}.jar /app/plugins/lavasrc-plugin.jar
ADD https://github.com/lavalink-devs/youtube-source/releases/download/${YT_VERSION}/youtube-plugin-${YT_VERSION}.jar /app/plugins/youtube-plugin.jar

COPY application.yml /app/
COPY proxy.js /app/

EXPOSE 10000 2333

CMD node /app/proxy.js & java -jar Lavalink.jar
