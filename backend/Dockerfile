# Build
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN chmod +x mvnw && ./mvnw -B -ntp dependency:go-offline
COPY src src
RUN ./mvnw -B -ntp package -DskipTests && \
    java -Djarmode=tools -jar target/lupin-backend-*.jar extract --layers --destination /layers

# Run (Cloud Run sets PORT)
FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 lupin
WORKDIR /app
COPY --from=build /layers/dependencies/ ./
COPY --from=build /layers/spring-boot-loader/ ./
COPY --from=build /layers/snapshot-dependencies/ ./
COPY --from=build /layers/application/ ./
USER 10001
# Same defaults as the top-level Dockerfile, so a host that builds from this folder without
# render.yaml (a service created by hand on Render) still gets the measured 512 MB settings.
ENV SPRING_PROFILES_ACTIVE=production \
    DATABASE_POOL_SIZE=3 \
    LUPIN_PUBLIC_BASE_URL=https://lupinwear.store \
    JAVA_TOOL_OPTIONS="-Xmx200m -XX:MaxMetaspaceSize=140m -XX:ReservedCodeCacheSize=40m -XX:+UseSerialGC -Xss512k -XX:TieredStopAtLevel=1 -XX:+ExitOnOutOfMemoryError"
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "lupin-backend-0.1.0-SNAPSHOT.jar"]
