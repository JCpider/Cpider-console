from .session import init_database


def initialize_database(database_url: str | None = None):
    from ..config.settings import init_default_settings, load_settings

    manager = init_database(database_url)
    init_default_settings()
    load_settings(force_reload=True)
    return manager
