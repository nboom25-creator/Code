FROM python:3.11-slim

# Gmsh needs GL/X libs even headless; CalculiX provides the FEA solver.
RUN apt-get update && apt-get install -y --no-install-recommends \
    calculix-ccx libglu1-mesa libxrender1 libxcursor1 libxft2 libxinerama1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV PARTFORGE_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
