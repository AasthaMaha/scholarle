"""Local NCES-backed education catalog search."""

from .repository import EducationCatalogRepository, get_education_catalog

__all__ = ["EducationCatalogRepository", "get_education_catalog"]
