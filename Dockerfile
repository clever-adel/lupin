# Builds the back end (the Java API) from the top of the repository.
# Hosts that build from the repository root, such as Railway, pick this file up automatically.
# backend/Dockerfile is the same build for hosts that build from the backend folder (Render, Cloud Run).
# Keep the two in step.

# Build
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY backend/.mvn .mvn
COPY backend/mvnw backend/pom.xml ./
RUN chmod +x mvnw && ./mvnw -B -ntp dependency:go-offline
COPY backend/src src
RUN ./mvnw -B -ntp package -DskipTests && \
    java -Djarmode=tools -jar target/lupin-backend-*.jar extract --layers --destination /layers

# Run (the host sets PORT)
FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 lupin
WORKDIR /app
COPY --from=build /layers/dependencies/ ./
COPY --from=build /layers/spring-boot-loader/ ./
COPY --from=build /layers/snapshot-dependencies/ ./
COPY --from=build /layers/application/ ./
USER 10001

# Non-secret production defaults; any of them can be overridden in the host's variables.
# Memory options are sized for a 512 MB container (measured: about 285-385 MB in use).
ENV SPRING_PROFILES_ACTIVE=production \
    DATABASE_POOL_SIZE=3 \
    LUPIN_PUBLIC_BASE_URL=https://lupinwear.store \
    JAVA_TOOL_OPTIONS="-Xmx200m -XX:MaxMetaspaceSize=140m -XX:ReservedCodeCacheSize=40m -XX:+UseSerialGC -Xss512k -XX:TieredStopAtLevel=1 -XX:+ExitOnOutOfMemoryError"

# Secrets are NOT set here. The host must provide: DATABASE_URL, LUPIN_JWT_SECRET, LUPIN_EDGE_SECRET,
# and for the first start only LUPIN_BOOTSTRAP_OWNER_EMAIL and LUPIN_BOOTSTRAP_OWNER_PASSWORD.
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "lupin-backend-0.1.0-SNAPSHOT.jar"]
