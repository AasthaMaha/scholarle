"""Persistence helpers for Scholar-E.

The current app can run without a configured database. When DATABASE_URL is set,
the services in this package provide the PostgreSQL-backed path for durable
profiles, agent runs, knowledge items, and future RAG memory.
"""

