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
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
