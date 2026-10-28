import os

# An empty value is already set, so python-dotenv will not load the local key into tests.
os.environ["MODEL_API_KEY"] = ""
os.environ["DRAFTY_AUTH_MODE"] = "disabled"
os.environ["DRAFTY_ENV"] = "test"
os.environ["SUPABASE_URL"] = ""
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = ""
os.environ["SUPABASE_SECRET_KEY"] = ""
os.environ["SUPABASE_PUBLISHABLE_KEY"] = ""
