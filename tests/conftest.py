import os

# An empty value is already set, so python-dotenv will not load the local key into tests.
os.environ["MODEL_API_KEY"] = ""
