# Real Estate Valuation Engine

An explainable machine learning web application for predicting residential property prices in England.

## Technology
- Frontend: React + Vite
- Backend: Python + FastAPI
- Data processing: pandas
- Machine learning: scikit-learn and candidate boosting/TabPFN models
- Explainability: SHAP
- Database: SQLite
- Development: Jupyter Notebook

## Getting Started
1. Place source CSV files in data/raw/.
2. Create a Python virtual environment.
3. Install dependencies from requirements.txt.
4. Inspect and prepare the datasets in notebooks/.
5. Train and evaluate models before connecting one to FastAPI.
6. Initialise the React application inside frontend/.

All development and inference are intended to run locally.
