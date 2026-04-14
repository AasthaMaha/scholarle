# llm/client.py

from langchain_openai import ChatOpenAI
from config import settings


class LLMClient:
    def __init__(self):
        self.client = ChatOpenAI(
            model=settings.model,
            temperature=settings.temperature
        )

    def generate(self, prompt: str) -> str:
        response = self.client.invoke(prompt)
        return response.content


llm = LLMClient()