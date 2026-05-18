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

# Health check server on port 10000 so Render doesn't kill us
RUN apt-get update && apt-get install -y netcat-traditional && rm -rf /var/lib/apt/lists/*

EXPOSE 2333 10000

CMD java -jar Lavalink.jar & \
    while true; do \
      echo -e "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK" | nc -l -p 10000 -q 1 > /dev/null 2>&1; \
    done
