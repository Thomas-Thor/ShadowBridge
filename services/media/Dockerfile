# Build uses the session/enterprise CA only as a BuildKit secret; no TLS bypass.
FROM python:3.12-slim-bookworm
WORKDIR /service
COPY services/media/requirements.txt ./
RUN --mount=type=secret,id=build-ca,required=false \
    if [ -f /run/secrets/build-ca ]; then export PIP_CERT=/run/secrets/build-ca; fi; \
    pip install --no-cache-dir --requirement requirements.txt
COPY services/media/worker.py ./worker.py
RUN useradd --uid 10001 --no-create-home media
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MEDIA_HOST=0.0.0.0
USER 10001:10001
EXPOSE 8091
CMD ["python", "worker.py"]
