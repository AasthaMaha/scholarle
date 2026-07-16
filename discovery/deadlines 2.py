from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any


MONTHS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}

MONTH_PATTERN = "|".join(sorted(MONTHS, key=len, reverse=True))
DEADLINE_CUE = re.compile(
    r"\b(?:application deadline|deadline|apply by|applications? (?:close|closes|due)|"
    r"submissions? (?:close|closes|due)|due date)\b",
    re.I,
)
OPENING_CUE = re.compile(
    r"\b(?:applications? (?:open|opens|begin|begins)|application opening|opening date)\b",
    re.I,
)
OPEN_NOW = re.compile(
    r"\b(?:applications? (?:are |is )?(?:now |currently )?open|currently accepting applications|"
    r"accepting applications now|apply now)\b",
    re.I,
)
CLOSED_NOW = re.compile(
    r"\b(?:applications? (?:are |is )?(?:now )?closed|no longer accepting applications|"
    r"application period has (?:closed|ended)|deadline has passed)\b",
    re.I,
)


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _dates(text: str) -> list[tuple[date, int, int]]:
    found: list[tuple[date, int, int]] = []
    patterns = (
        re.compile(
            rf"\b(?P<month>{MONTH_PATTERN})\.?\s+(?P<day>\d{{1,2}})(?:st|nd|rd|th)?(?:,)?\s+(?P<year>20\d{{2}})\b",
            re.I,
        ),
        re.compile(
            rf"\b(?P<day>\d{{1,2}})(?:st|nd|rd|th)?\s+(?P<month>{MONTH_PATTERN})\.?(?:,)?\s+(?P<year>20\d{{2}})\b",
            re.I,
        ),
        re.compile(r"\b(?P<year>20\d{2})-(?P<month>0?[1-9]|1[0-2])-(?P<day>0?[1-9]|[12]\d|3[01])\b"),
        re.compile(r"\b(?P<month>0?[1-9]|1[0-2])/(?P<day>0?[1-9]|[12]\d|3[01])/(?P<year>20\d{2})\b"),
    )
    seen: set[tuple[date, int]] = set()
    for pattern in patterns:
        for match in pattern.finditer(text):
            raw_month = match.group("month").lower().rstrip(".")
            month = MONTHS.get(raw_month, int(raw_month) if raw_month.isdigit() else 0)
            parsed = _safe_date(int(match.group("year")), month, int(match.group("day")))
            if parsed and (parsed, match.start()) not in seen:
                seen.add((parsed, match.start()))
                found.append((parsed, match.start(), match.end()))
    return sorted(found, key=lambda item: item[1])


def _context_dates(text: str, cue: re.Pattern[str]) -> list[tuple[date, int, int]]:
    matches: list[tuple[date, int, int]] = []
    for cue_match in cue.finditer(text):
        start = max(0, cue_match.start() - 30)
        end = min(len(text), cue_match.end() + 180)
        for parsed, relative_start, relative_end in _dates(text[start:end]):
            absolute = (parsed, start + relative_start, start + relative_end)
            if absolute not in matches:
                matches.append(absolute)
    return matches


def _evidence(text: str, start: int | None = None) -> str:
    if start is None:
        return text[:280]
    return text[max(0, start - 90):min(len(text), start + 190)].strip()


def assess_deadline(page_text: str, *, today: date | None = None) -> dict[str, Any]:
    """Determine current application status from explicit official-page language.

    Dates without a four-digit year are intentionally ignored: an annual month/day
    copied from an old cycle is not enough to prove that an opportunity is current.
    """
    checked_on = today or datetime.now(timezone.utc).date()
    text = _clean(page_text)
    deadlines = _context_dates(text, DEADLINE_CUE)
    openings = _context_dates(text, OPENING_CUE)
    plausible_deadlines = [item for item in deadlines if item[0].year <= checked_on.year + 2]
    future_deadlines = [item for item in plausible_deadlines if item[0] >= checked_on]
    chosen_deadline = min(future_deadlines, key=lambda item: item[0]) if future_deadlines else (
        max(plausible_deadlines, key=lambda item: item[0]) if plausible_deadlines else None
    )
    future_openings = [item for item in openings if item[0] > checked_on and item[0].year <= checked_on.year + 2]
    chosen_opening = min(future_openings, key=lambda item: item[0]) if future_openings else None

    status = "unknown"
    evidence_start: int | None = None
    if chosen_deadline and chosen_deadline[0] >= checked_on:
        evidence_start = chosen_deadline[1]
        status = "upcoming" if chosen_opening and chosen_opening[0] > checked_on else "open"
    elif chosen_deadline and chosen_deadline[0] < checked_on:
        evidence_start = chosen_deadline[1]
        status = "closed"
    elif CLOSED_NOW.search(text):
        match = CLOSED_NOW.search(text)
        evidence_start = match.start() if match else None
        status = "closed"
    elif OPEN_NOW.search(text):
        match = OPEN_NOW.search(text)
        evidence_start = match.start() if match else None
        status = "open"

    return {
        "deadline_status": status,
        "deadline_verified": status != "unknown",
        "application_deadline": chosen_deadline[0].isoformat() if chosen_deadline else "",
        "application_opens": chosen_opening[0].isoformat() if chosen_opening else "",
        "deadline_evidence": _evidence(text, evidence_start) if status != "unknown" else "",
        "deadline_checked_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }


def is_currently_open(candidate: dict[str, Any]) -> bool:
    return bool(candidate.get("deadline_verified")) and candidate.get("deadline_status") == "open"
