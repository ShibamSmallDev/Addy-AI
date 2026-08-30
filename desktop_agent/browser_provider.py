"""
Browser Provider Abstraction Layer for Addy Desktop Agent.

Provides a unified interface (BrowserProvider) and dispatcher (BrowserRegistry)
inspired by Hermes Agent's browser_provider & browser_registry architecture.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


class BrowserProvider(ABC):
    """Abstract Base Class for all browser backends in Addy (Local Playwright, CDP, Stealth, Cloud)."""

    @abstractmethod
    async def navigate(self, url: str) -> Dict[str, Any]:
        """Navigate to a URL."""
        pass

    @abstractmethod
    async def get_semantic_tree(self) -> Dict[str, Any]:
        """Extract a semantic accessibility tree mapping."""
        pass

    @abstractmethod
    async def click(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """Click an element by ID, role, selector, or text."""
        pass

    @abstractmethod
    async def type_text(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """Type text into an input element."""
        pass

    @abstractmethod
    async def execute_cdp(self, method: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Execute a raw Chrome DevTools Protocol command."""
        pass

    @abstractmethod
    async def handle_dialog(self, action: str = "accept", prompt_text: Optional[str] = None) -> Dict[str, Any]:
        """Configure automated handling for JS dialogs (alert, confirm, prompt)."""
        pass

    @abstractmethod
    async def close(self) -> None:
        """Close browser context/session."""
        pass


class BrowserRegistry:
    """Registry managing active and fallback browser providers."""

    def __init__(self) -> None:
        self._providers: Dict[str, BrowserProvider] = {}
        self._active_provider_name: str = "local_playwright"

    def register_provider(self, name: str, provider: BrowserProvider) -> None:
        self._providers[name] = provider

    def get_provider(self, name: Optional[str] = None) -> Optional[BrowserProvider]:
        provider_name = name or self._active_provider_name
        return self._providers.get(provider_name)

    def set_active(self, name: str) -> None:
        if name in self._providers:
            self._active_provider_name = name
        else:
            raise ValueError(f"Browser provider '{name}' is not registered.")


BROWSER_REGISTRY = BrowserRegistry()
