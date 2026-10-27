"""쇼핑리스트 아이템을 JSON 파일로 저장하고 불러온다."""

import json
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parent / "data" / "shopping_list.json"


def load_items() -> list[dict]:
    """저장된 아이템 목록을 반환한다. 파일이 없거나 손상되었으면 빈 리스트를 반환한다."""
    try:
        with DATA_FILE.open(encoding="utf-8") as f:
            items = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError, OSError):
        return []
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict)]


def save_items(items: list[dict]) -> None:
    """아이템 목록을 JSON 파일에 저장한다."""
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with DATA_FILE.open("w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
