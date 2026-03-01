from __future__ import annotations

import argparse
import asyncio
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv


DEFAULT_USER_ID = os.getenv("MUMU_USER_ID", "local_cli")


def _repo_paths() -> tuple[Path, Path]:
    """
    Return (repo_root, backend_root) based on this file location.
    """
    # backend/app/cli/main.py -> backend (parents[2]) -> repo (parent)
    backend_root = Path(__file__).resolve().parents[2]
    repo_root = backend_root.parent
    return repo_root, backend_root


def _load_env() -> None:
    """
    Load env vars from common locations.

    We intentionally *do not* rely on pydantic-settings' env_file relative path,
    because CLI may be invoked from arbitrary working directories.
    """
    repo_root, backend_root = _repo_paths()

    # Repo-root .env (commonly used in this repository)
    load_dotenv(repo_root / ".env", override=False)
    # Backend .env (kept for compatibility with existing backend docs)
    load_dotenv(backend_root / ".env", override=False)


@contextmanager
def _pushd(path: Path):
    old = Path.cwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(old)


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="mumu",
        description="MuMuAINovel CLI (no web server required).",
    )
    p.add_argument(
        "--user-id",
        default=DEFAULT_USER_ID,
        help="Logical user id (default: %(default)s).",
    )
    p.add_argument(
        "--database-url",
        default=None,
        help="Override DATABASE_URL (e.g. sqlite+aiosqlite:////abs/path/ai_story.db).",
    )

    sub = p.add_subparsers(dest="command", required=True)

    # init
    sp = sub.add_parser("init", help="Initialize/upgrade local database (Alembic) and create default user/settings.")
    sp.set_defaults(_handler=_cmd_init)

    # project
    sp = sub.add_parser("project", help="Project management.")
    sp_sub = sp.add_subparsers(dest="subcommand", required=True)

    sp_list = sp_sub.add_parser("list", help="List projects.")
    sp_list.set_defaults(_handler=_cmd_project_list)

    sp_create = sp_sub.add_parser("create", help="Create a project.")
    sp_create.add_argument("--title", required=True)
    sp_create.add_argument("--description", default="")
    sp_create.add_argument("--genre", default="")
    sp_create.add_argument("--theme", default="")
    sp_create.add_argument(
        "--outline-mode",
        default="one-to-many",
        choices=("one-to-one", "one-to-many"),
    )
    sp_create.set_defaults(_handler=_cmd_project_create)

    # chapter
    sp = sub.add_parser("chapter", help="Chapter management.")
    sp_sub = sp.add_subparsers(dest="subcommand", required=True)

    sp_list = sp_sub.add_parser("list", help="List chapters of a project.")
    sp_list.add_argument("--project-id", required=True)
    sp_list.set_defaults(_handler=_cmd_chapter_list)

    sp_add = sp_sub.add_parser("add", help="Add a chapter (manual content).")
    sp_add.add_argument("--project-id", required=True)
    sp_add.add_argument("--number", type=int, default=None, help="Chapter number (default: next).")
    sp_add.add_argument("--title", required=True)
    sp_add.add_argument("--content", default=None, help="Chapter content text.")
    sp_add.add_argument("--file", default=None, help="Read chapter content from file.")
    sp_add.set_defaults(_handler=_cmd_chapter_add)

    sp_show = sp_sub.add_parser("show", help="Show chapter content.")
    sp_show.add_argument("--chapter-id", default=None)
    sp_show.add_argument("--project-id", default=None)
    sp_show.add_argument("--number", type=int, default=None)
    sp_show.set_defaults(_handler=_cmd_chapter_show)

    # ai
    sp = sub.add_parser("ai", help="Direct LLM calls (keeps outbound LLM API capability).")
    sp_sub = sp.add_subparsers(dest="subcommand", required=True)

    sp_chat = sp_sub.add_parser("chat", help="Send a prompt and print the response.")
    sp_chat.add_argument("--prompt", default=None, help="Prompt text.")
    sp_chat.add_argument("--file", default=None, help="Read prompt from file.")
    sp_chat.add_argument("--model", default=None, help="Override model name.")
    sp_chat.add_argument("--no-mcp", action="store_true", help="Disable MCP tools for this call.")
    sp_chat.set_defaults(_handler=_cmd_ai_chat)

    return p


def main(argv: Optional[list[str]] = None) -> int:
    _load_env()

    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.database_url:
        os.environ["DATABASE_URL"] = str(args.database_url)

    # Normalize relative SQLite paths (e.g. sqlite:///data/ai_story.db) to an absolute path
    # anchored at backend_root, so CLI works from any working directory.
    try:
        from sqlalchemy.engine.url import make_url

        _, backend_root = _repo_paths()
        db_url = os.getenv("DATABASE_URL", "")
        if db_url:
            url = make_url(db_url)
            if str(url.drivername).startswith("sqlite") and url.database and url.database != ":memory:":
                db_path = Path(url.database)
                if not db_path.is_absolute():
                    abs_path = (backend_root / db_path).resolve()
                    os.environ["DATABASE_URL"] = str(url.set(database=str(abs_path)))
    except Exception:
        # Best-effort; if parsing fails, keep original DATABASE_URL.
        pass

    handler = getattr(args, "_handler", None)
    if not handler:
        parser.print_help()
        return 2

    try:
        return asyncio.run(handler(args))
    except KeyboardInterrupt:
        return 130


# ========================= Helpers =========================


async def _session_scope(user_id: str):
    """
    Async context manager yielding an AsyncSession.
    """
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.database import get_engine

    engine = await get_engine(user_id)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as session:
        yield session


async def _ensure_user_and_settings(db, user_id: str) -> None:
    """
    Ensure a minimal user + settings row exist (CLI default profile).
    """
    from sqlalchemy import select

    from app.models.user import User as UserModel
    from app.models.settings import Settings as SettingsModel

    # User
    res = await db.execute(select(UserModel).where(UserModel.user_id == user_id))
    user = res.scalar_one_or_none()
    if not user:
        user = UserModel(
            user_id=user_id,
            username=user_id,
            display_name="CLI用户",
            avatar_url=None,
            trust_level=0,
            is_admin=True,  # local/cli user is effectively admin in standalone mode
            linuxdo_id=user_id,  # local user id uses local_* naming but not enforced here
        )
        db.add(user)

    # Settings
    res = await db.execute(select(SettingsModel).where(SettingsModel.user_id == user_id))
    st = res.scalar_one_or_none()
    if not st:
        # Avoid importing FastAPI router modules; just mirror env defaults.
        from app.config import settings as app_settings

        st = SettingsModel(
            user_id=user_id,
            api_provider=app_settings.default_ai_provider,
            api_key=app_settings.openai_api_key or app_settings.anthropic_api_key or "",
            api_base_url=app_settings.openai_base_url or app_settings.anthropic_base_url or "",
            llm_model=app_settings.default_model,
            temperature=app_settings.default_temperature,
            max_tokens=app_settings.default_max_tokens,
            system_prompt=None,
            preferences=None,
        )
        db.add(st)

    await db.commit()


def _read_text_from_file(path: str) -> str:
    p = Path(path).expanduser().resolve()
    return p.read_text(encoding="utf-8")


def _print_kv(title: str, value: Any) -> None:
    sys.stdout.write(f"{title}: {value}\n")


# ========================= Commands =========================


async def _cmd_init(args) -> int:
    repo_root, backend_root = _repo_paths()

    from app.logger import get_logger

    logger = get_logger(__name__)

    # Decide which profile to use based on DATABASE_URL
    db_url = os.getenv("DATABASE_URL", "")
    is_sqlite = "sqlite" in db_url.lower()
    ini_name = "alembic-sqlite.ini" if is_sqlite else "alembic-postgres.ini"
    ini_path = backend_root / ini_name

    if not ini_path.exists():
        raise RuntimeError(f"Alembic ini not found: {ini_path}")

    # NOTE:
    # Alembic SQLite env.py uses asyncio.run() internally.
    # Our CLI runs inside asyncio.run() too, so calling alembic.command.upgrade()
    # directly would trigger "asyncio.run() cannot be called from a running event loop".
    #
    # To keep it robust, run Alembic in a subprocess.
    import subprocess

    logger.info(f"🔧 Running migrations via {ini_name} (DATABASE_URL={'sqlite' if is_sqlite else 'postgres'})")
    with _pushd(backend_root):
        # If SQLite DB already exists and has tables, but alembic_version has no rows,
        # initial migrations will fail with "table ... already exists".
        if is_sqlite:
            try:
                from sqlalchemy.engine.url import make_url
                import sqlite3

                url = make_url(os.getenv("DATABASE_URL", ""))
                db_file = url.database
                if db_file:
                    db_path = Path(db_file)
                    if not db_path.is_absolute():
                        db_path = (backend_root / db_file).resolve()
                    if db_path.exists():
                        conn = sqlite3.connect(str(db_path))
                        try:
                            tables = [
                                r[0]
                                for r in conn.execute(
                                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                                ).fetchall()
                            ]
                            if "alembic_version" in tables and len(tables) > 1:
                                rev_count = conn.execute("SELECT COUNT(*) FROM alembic_version").fetchone()[0]
                                if int(rev_count) == 0:
                                    logger.warning(
                                        "⚠️ SQLite DB has tables but alembic_version is empty. "
                                        "Stamping to head to avoid re-creating existing tables."
                                    )
                                    subprocess.run(
                                        [sys.executable, "-m", "alembic", "-c", str(ini_path), "stamp", "head"],
                                        check=True,
                                    )
                        finally:
                            conn.close()
            except Exception as e:
                logger.warning(f"⚠️ Pre-check alembic_version failed, continuing: {e}")

        cmd_upgrade = [sys.executable, "-m", "alembic", "-c", str(ini_path), "upgrade", "head"]
        r = subprocess.run(cmd_upgrade, capture_output=True, text=True)
        if r.returncode != 0:
            combined = (r.stdout or "") + "\n" + (r.stderr or "")
            sys.stderr.write(combined + "\n")
            raise RuntimeError("Alembic upgrade failed")

    # Ensure default CLI user + settings exist
    async for db in _session_scope(args.user_id):
        await _ensure_user_and_settings(db, args.user_id)

    _print_kv("repo_root", repo_root)
    _print_kv("backend_root", backend_root)
    _print_kv("user_id", args.user_id)
    _print_kv("database_url", os.getenv("DATABASE_URL", ""))
    sys.stdout.write("✅ init done\n")
    return 0


async def _cmd_project_list(args) -> int:
    from sqlalchemy import select

    async for db in _session_scope(args.user_id):
        # Import models *after* app.database is loaded (session_scope imports it),
        # to avoid circular imports caused by app.database importing app.models at import time.
        from app.models import Project

        res = await db.execute(
            select(Project)
            .where(Project.user_id == args.user_id)
            .order_by(Project.created_at.desc())
        )
        rows = res.scalars().all()

    if not rows:
        sys.stdout.write("(no projects)\n")
        return 0

    for p in rows:
        sys.stdout.write(f"{p.id}\t{p.title}\t{p.genre or ''}\t{p.status}\t{p.created_at}\n")
    return 0


async def _cmd_project_create(args) -> int:
    async for db in _session_scope(args.user_id):
        from app.models import Project

        await _ensure_user_and_settings(db, args.user_id)

        project = Project(
            user_id=args.user_id,
            title=args.title,
            description=args.description or "",
            genre=args.genre or "",
            theme=args.theme or "",
            outline_mode=args.outline_mode,
        )
        db.add(project)
        await db.commit()
        await db.refresh(project)

    sys.stdout.write(project.id + "\n")
    return 0


async def _cmd_chapter_list(args) -> int:
    from sqlalchemy import select

    async for db in _session_scope(args.user_id):
        from app.models import Chapter

        res = await db.execute(
            select(Chapter)
            .where(Chapter.project_id == args.project_id)
            .order_by(Chapter.chapter_number.asc(), Chapter.sub_index.asc())
        )
        rows = res.scalars().all()

    if not rows:
        sys.stdout.write("(no chapters)\n")
        return 0

    for ch in rows:
        wc = ch.word_count or (len(ch.content) if ch.content else 0)
        sys.stdout.write(
            f"{ch.id}\t#{ch.chapter_number}\t{ch.title}\t{ch.status}\t{wc}\n"
        )
    return 0


async def _cmd_chapter_add(args) -> int:
    from sqlalchemy import select, func

    if bool(args.content) and bool(args.file):
        raise SystemExit("Please provide only one of --content or --file")

    content = args.content
    if args.file:
        content = _read_text_from_file(args.file)

    async for db in _session_scope(args.user_id):
        from app.models import Chapter, Project

        # Ensure project exists
        res = await db.execute(select(Project).where(Project.id == args.project_id))
        project = res.scalar_one_or_none()
        if not project:
            raise SystemExit(f"Project not found: {args.project_id}")

        # Auto chapter number
        chapter_number = args.number
        if chapter_number is None:
            res = await db.execute(
                select(func.max(Chapter.chapter_number)).where(Chapter.project_id == args.project_id)
            )
            max_no = res.scalar_one_or_none() or 0
            chapter_number = int(max_no) + 1

        wc = len(content) if content else 0
        ch = Chapter(
            project_id=args.project_id,
            chapter_number=chapter_number,
            title=args.title,
            content=content,
            summary=None,
            word_count=wc,
            status="completed" if content else "draft",
        )
        db.add(ch)

        # Update project words
        if content:
            project.current_words = int(project.current_words or 0) + wc

        await db.commit()
        await db.refresh(ch)

    sys.stdout.write(ch.id + "\n")
    return 0


async def _cmd_chapter_show(args) -> int:
    from sqlalchemy import select

    if args.chapter_id:
        # Build query after models are imported in a safe order
        query_builder = ("id", args.chapter_id)
    else:
        if not args.project_id or args.number is None:
            raise SystemExit("Need --chapter-id OR (--project-id AND --number)")
        query_builder = ("number", args.project_id, int(args.number))

    async for db in _session_scope(args.user_id):
        from app.models import Chapter

        if query_builder[0] == "id":
            query = select(Chapter).where(Chapter.id == query_builder[1])
        else:
            _, project_id, number = query_builder
            query = select(Chapter).where(
                Chapter.project_id == project_id,
                Chapter.chapter_number == int(number),
            )

        res = await db.execute(query)
        ch = res.scalar_one_or_none()

    if not ch:
        raise SystemExit("Chapter not found")

    sys.stdout.write(ch.content or "")
    if ch.content and not ch.content.endswith("\n"):
        sys.stdout.write("\n")
    return 0


async def _cmd_ai_chat(args) -> int:
    if not args.prompt and not args.file:
        raise SystemExit("Need --prompt or --file")

    prompt = args.prompt or ""
    if args.file:
        prompt = _read_text_from_file(args.file)

    async for db in _session_scope(args.user_id):
        from sqlalchemy import select

        from app.models import Settings
        from app.services.ai_service import create_user_ai_service_with_mcp

        await _ensure_user_and_settings(db, args.user_id)

        res = await db.execute(select(Settings).where(Settings.user_id == args.user_id))
        st = res.scalar_one()

        # In CLI, MCP is opt-in by default. Users can pass --no-mcp to force off.
        enable_mcp = not bool(args.no_mcp)

        ai = create_user_ai_service_with_mcp(
            api_provider=st.api_provider,
            api_key=st.api_key or "",
            api_base_url=st.api_base_url or "",
            model_name=args.model or st.llm_model,
            temperature=float(st.temperature or 0.7),
            max_tokens=int(st.max_tokens or 2000),
            user_id=args.user_id,
            db_session=db,
            system_prompt=st.system_prompt,
            enable_mcp=enable_mcp,
        )

        resp = await ai.generate_text(
            prompt=prompt,
            model=args.model,
            auto_mcp=enable_mcp,
            handle_tool_calls=True,
        )

    sys.stdout.write((resp.get("content") or "") + ("\n" if resp.get("content") else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
