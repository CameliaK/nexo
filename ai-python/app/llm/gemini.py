from typing import AsyncIterator

from google import genai
from google.genai import types

from .base import LLMProvider


class GeminiProvider(LLMProvider):
    def __init__(self, api_key: str, model: str) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model

    async def complete(self, system: str, user: str) -> str:
        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=user,
            config=types.GenerateContentConfig(
                system_instruction=system,
                temperature=0.2,
            ),
        )
        return response.text or ""

    async def stream(self, system: str, user: str) -> AsyncIterator[str]:
        async for chunk in self._client.aio.models.generate_content_stream(
            model=self._model,
            contents=user,
            config=types.GenerateContentConfig(
                system_instruction=system,
                temperature=0.7,
            ),
        ):
            if chunk.text:
                yield chunk.text
