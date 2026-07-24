# llm/client.py

from langchain_openai import ChatOpenAI

from config import settings


class LLMClient:
    def __init__(self):
        self.client = None
        self._clients_by_temperature = {}

    def _get_client(self, temperature: float | None = None):
        if not settings.openai_api_key:
            raise RuntimeError(
                "Missing OPENAI_API_KEY. Add it to a .env file in the project root."
            )
        selected_temperature = (
            settings.temperature if temperature is None else float(temperature)
        )
        if selected_temperature not in self._clients_by_temperature:
            self._clients_by_temperature[selected_temperature] = ChatOpenAI(
                model=settings.model,
                temperature=selected_temperature,
                api_key=settings.openai_api_key,
            )
        selected = self._clients_by_temperature[selected_temperature]
        if selected_temperature == settings.temperature:
            # Preserve the public attribute used by existing integrations.
            self.client = selected
        return selected

    def generate(self, prompt: str) -> str:
        response = self._get_client().invoke(prompt)
        return response.content


llm = LLMClient()
