# Build context is the repo root: the server packages files from shared/ (rules, maps).
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app/server
COPY server/.mvn .mvn
COPY server/mvnw server/pom.xml ./
RUN ./mvnw -B -q dependency:go-offline
COPY server/src src
COPY shared /app/shared
RUN ./mvnw -B -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/server/target/server-*.jar app.jar
# Sized for a small free instance (512 MB RAM, a fraction of a CPU): heap capped below the container limit so
# metaspace, thread stacks and direct buffers fit; serial GC and C1-only JIT avoid background threads and cut the
# startup time. Override with JAVA_TOOL_OPTIONS on bigger hosts.
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:+UseSerialGC -XX:TieredStopAtLevel=1 -Xss512k -XX:ReservedCodeCacheSize=48m"
USER ubuntu
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
