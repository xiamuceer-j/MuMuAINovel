from __future__ import annotations

from contextvars import ContextVar
from typing import Optional, Set


allowed_tools_var: ContextVar[Optional[Set[str]]] = ContextVar("mcp_allowed_tools", default=None)


def normalize_tool_name(name: str) -> str:
    return (name or "").strip()


def expand_allowed_tool_names(names: Set[str]) -> Set[str]:
    expanded: Set[str] = set()
    for raw in names:
        n = normalize_tool_name(raw)
        if not n:
            continue
        expanded.add(n)
        if "_" in n:
            plugin, tool = n.split("_", 1)
            if plugin and tool:
                expanded.add(f"{plugin}.{tool}")
        if "." in n:
            plugin, tool = n.split(".", 1)
            if plugin and tool:
                expanded.add(f"{plugin}_{tool}")
    return expanded


def set_allowed_tools(allowed: Optional[Set[str]]):
    if allowed is None:
        return allowed_tools_var.set(None)
    expanded = expand_allowed_tool_names(allowed)
    return allowed_tools_var.set(expanded)


def get_allowed_tools() -> Optional[Set[str]]:
    return allowed_tools_var.get()
