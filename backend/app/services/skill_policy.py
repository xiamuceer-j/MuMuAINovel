from __future__ import annotations

from typing import Optional, Set


def parse_allowed_tools_csv(text: Optional[str]) -> Optional[Set[str]]:
    if not text:
        return None
    items = [x.strip() for x in text.split(",")]
    names = {x for x in items if x}
    return names or None
