from __future__ import annotations

import csv
import gzip
import io
import re
import sqlite3
import threading
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE_DIR = ROOT / "data" / "education_catalog_sources"
DEFAULT_DATABASE_PATH = ROOT / "data" / "education_catalog.sqlite3"

_HIGH_SCHOOL_NAME = re.compile(
    r"\b(high|secondary|senior|academy|preparatory|prep|early college|career and technical)\b",
    re.IGNORECASE,
)


def _plain_code(value: str) -> str:
    return str(value or "").strip().removeprefix('="').removesuffix('"')


def _search_expression(query: str) -> str:
    tokens = re.findall(r"[\w]+", query.casefold(), flags=re.UNICODE)
    return " AND ".join(f'"{token}"*' for token in tokens[:8])


class EducationCatalogRepository:
    """Searches a lazily built local SQLite/FTS index of NCES datasets."""

    def __init__(
        self,
        database_path: Path = DEFAULT_DATABASE_PATH,
        source_dir: Path = DEFAULT_SOURCE_DIR,
    ) -> None:
        self.database_path = Path(database_path)
        self.source_dir = Path(source_dir)
        self._build_lock = threading.Lock()

    def ensure_index(self) -> None:
        if self.database_path.exists():
            return
        with self._build_lock:
            if self.database_path.exists():
                return
            self._build_index()

    def _build_index(self) -> None:
        required = [
            self.source_dir / "EDGE_PUBLICSCH_2324.csv.gz",
            self.source_dir / "HD2024.zip",
            self.source_dir / "CIPCode2020.csv.gz",
        ]
        missing = [path.name for path in required if not path.exists()]
        if missing:
            raise RuntimeError(f"Education catalog source files are missing: {', '.join(missing)}")

        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self.database_path.with_suffix(".building.sqlite3")
        temporary_path.unlink(missing_ok=True)
        connection = sqlite3.connect(temporary_path)
        try:
            connection.executescript(
                """
                PRAGMA journal_mode=OFF;
                PRAGMA synchronous=OFF;
                CREATE VIRTUAL TABLE institutions USING fts5(
                    stable_id UNINDEXED,
                    display_name,
                    city,
                    state,
                    institution_type UNINDEXED,
                    aliases,
                    tokenize='unicode61 remove_diacritics 2'
                );
                CREATE VIRTUAL TABLE majors USING fts5(
                    cip_code UNINDEXED,
                    display_name,
                    definition,
                    tokenize='unicode61 remove_diacritics 2'
                );
                """
            )
            self._import_high_schools(connection, required[0])
            self._import_postsecondary(connection, required[1])
            self._import_majors(connection, required[2])
            connection.commit()
        finally:
            connection.close()
        temporary_path.replace(self.database_path)

    @staticmethod
    def _import_high_schools(connection: sqlite3.Connection, path: Path) -> None:
        rows = []
        with gzip.open(path, "rt", encoding="utf-8-sig", errors="replace", newline="") as stream:
            for row in csv.DictReader(stream):
                name = str(row.get("NAME") or "").strip()
                if not name or not _HIGH_SCHOOL_NAME.search(name):
                    continue
                rows.append(
                    (
                        str(row.get("NCESSCH") or "").strip(),
                        name,
                        str(row.get("CITY") or "").strip(),
                        str(row.get("STATE") or "").strip(),
                        "high_school",
                        "",
                    )
                )
        connection.executemany(
            "INSERT INTO institutions(stable_id, display_name, city, state, institution_type, aliases) VALUES (?, ?, ?, ?, ?, ?)",
            rows,
        )

    @staticmethod
    def _import_postsecondary(connection: sqlite3.Connection, path: Path) -> None:
        with zipfile.ZipFile(path) as archive:
            csv_name = next(name for name in archive.namelist() if name.lower().endswith(".csv"))
            with archive.open(csv_name) as raw:
                stream = io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace", newline="")
                rows = []
                for row in csv.DictReader(stream):
                    if str(row.get("CYACTIVE") or "").strip() != "1":
                        continue
                    rows.append(
                        (
                            str(row.get("UNITID") or "").strip(),
                            str(row.get("INSTNM") or "").strip(),
                            str(row.get("CITY") or "").strip(),
                            str(row.get("STABBR") or "").strip(),
                            "postsecondary",
                            str(row.get("IALIAS") or "").strip(),
                        )
                    )
        connection.executemany(
            "INSERT INTO institutions(stable_id, display_name, city, state, institution_type, aliases) VALUES (?, ?, ?, ?, ?, ?)",
            rows,
        )

    @staticmethod
    def _import_majors(connection: sqlite3.Connection, path: Path) -> None:
        rows = []
        with gzip.open(path, "rt", encoding="utf-8-sig", errors="replace", newline="") as stream:
            for row in csv.DictReader(stream):
                code = _plain_code(row.get("CIPCode") or "")
                if not re.fullmatch(r"\d{2}\.\d{4}", code):
                    continue
                if str(row.get("Action") or "").strip().casefold() in {"deleted", "moved from"}:
                    continue
                name = str(row.get("CIPTitle") or "").strip().removesuffix(".")
                if name:
                    rows.append((code, name, str(row.get("CIPDefinition") or "").strip()))
        connection.executemany(
            "INSERT INTO majors(cip_code, display_name, definition) VALUES (?, ?, ?)",
            rows,
        )

    def search_institutions(self, query: str, institution_type: str, limit: int = 10) -> list[dict]:
        expression = _search_expression(query)
        if not expression or institution_type not in {"high_school", "postsecondary"}:
            return []
        self.ensure_index()
        with sqlite3.connect(self.database_path) as connection:
            rows = connection.execute(
                """
                SELECT stable_id, display_name, city, state, institution_type
                FROM institutions
                WHERE institutions MATCH ? AND institution_type = ?
                ORDER BY
                    CASE
                        WHEN lower(trim(display_name)) = lower(trim(?)) THEN 0
                        WHEN lower(display_name) LIKE lower(?) THEN 1
                        ELSE 2
                    END,
                    bm25(institutions, 0.0, 8.0, 1.0, 1.0, 0.0, 3.0),
                    display_name
                LIMIT ?
                """,
                (expression, institution_type, query, f"{query.strip()}%", max(1, min(limit, 10))),
            ).fetchall()
        return [
            {
                "id": stable_id,
                "name": name,
                "institutionType": kind,
                "city": city,
                "state": state,
                "location": ", ".join(part for part in (city, state) if part),
            }
            for stable_id, name, city, state, kind in rows
        ]

    def search_majors(self, query: str, limit: int = 10) -> list[dict]:
        expression = _search_expression(query)
        if not expression:
            return []
        self.ensure_index()
        with sqlite3.connect(self.database_path) as connection:
            rows = connection.execute(
                """
                SELECT cip_code, display_name
                FROM majors
                WHERE majors MATCH ?
                ORDER BY
                    CASE
                        WHEN lower(trim(display_name)) = lower(trim(?)) THEN 0
                        WHEN lower(display_name) LIKE lower(?) THEN 1
                        ELSE 2
                    END,
                    bm25(majors, 0.0, 8.0, 1.0),
                    display_name
                LIMIT ?
                """,
                (expression, query, f"{query.strip()}%", max(1, min(limit, 10))),
            ).fetchall()
        return [{"cipCode": code, "name": name} for code, name in rows]


_catalog = EducationCatalogRepository()


def get_education_catalog() -> EducationCatalogRepository:
    return _catalog
