FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
  "flask>=3.0" \
  "python-dotenv>=1.0" \
  "numpy>=1.24" \
  "pandas>=2.0" \
  "scikit-learn>=1.3" \
  "xgboost>=2.0" \
  "shap>=0.43"

COPY . /app/ml

EXPOSE 8002
CMD ["python", "-m", "ml.api.app"]
