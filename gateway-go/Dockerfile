FROM golang:1.26-alpine AS build
RUN apk add --no-cache git
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /gateway ./cmd/gateway

FROM alpine:3.21
RUN apk add --no-cache ca-certificates curl
COPY --from=build /gateway /gateway
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://127.0.0.1:8080/health || exit 1
EXPOSE 8080
ENTRYPOINT ["/gateway"]
