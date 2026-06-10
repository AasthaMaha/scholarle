# llm/client.py

from langchain_openai import ChatOpenAI

from config import settings


class LLMClient:
    def __init__(self):
        self.client = None

    def _get_client(self):
        if not settings.openai_api_key:
            raise RuntimeError(
                "Missing OPENAI_API_KEY. Add it to a .env file in the project root."
            )
        if self.client is None:
            self.client = ChatOpenAI(
                model=settings.model,
                temperature=settings.temperature,
                api_key=settings.openai_api_key,
            )
        return self.client

    def generate(self, prompt: str) -> str:
        response = self._get_client().invoke(prompt)
        return response.content


llm = LLMClient()
