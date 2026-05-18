FROM eclipse-temurin:17-jre

WORKDIR /app

ARG LAVALINK_VERSION=4.2.2
ARG LAVASRC_VERSION=4.8.1
ARG YT_VERSION=1.18.1

ADD https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar /app/Lavalink.jar

RUN mkdir -p /app/plugins
ADD https://github.com/topi314/LavaSrc/releases/download/${LAVASRC_VERSION}/lavasrc-plugin-${LAVASRC_VERSION}.jar /app/plugins/lavasrc-plugin.jar
ADD https://github.com/lavalink-devs/youtube-source/releases/download/${YT_VERSION}/youtube-plugin-${YT_VERSION}.jar /app/plugins/youtube-plugin.jar

COPY application.yml /app/

EXPOSE 2333

CMD ["java", "-jar", "Lavalink.jar"]
