from abc import ABC, abstractmethod
from typing import AsyncIterator


class LLMProvider(ABC):
    @abstractmethod
    async def complete(self, system: str, user: str) -> str: ...

    @abstractmethod
    async def stream(self, system: str, user: str) -> AsyncIterator[str]: ...
