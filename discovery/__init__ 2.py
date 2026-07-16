"""Canonical scholarship-discovery domain services."""

from .intent_service import generate_intent_options
from .normalization import build_discovery_context, normalize_profile

__all__ = ["build_discovery_context", "generate_intent_options", "normalize_profile"]
