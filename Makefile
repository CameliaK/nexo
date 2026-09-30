.PHONY: dev down gen-key

dev:
	docker compose up --build

down:
	docker compose down

gen-key:
	@if grep -q '^PASETO_LOCAL_KEY=' .env 2>/dev/null; then \
		echo "PASETO_LOCAL_KEY ya existe en .env — borra la línea manualmente si quieres regenerarla"; \
	else \
		python3 -c "import secrets; print('PASETO_LOCAL_KEY=' + secrets.token_hex(32))" >> .env; \
		echo "PASETO_LOCAL_KEY escrita en .env"; \
	fi
