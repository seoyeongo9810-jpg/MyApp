"""쇼핑리스트 앱 (Streamlit)."""

import re
import uuid
from datetime import datetime

import streamlit as st

from storage import load_items, save_items

st.set_page_config(page_title="쇼핑리스트", page_icon="🛒", layout="centered")

NAME_MAX = 50
MEMO_MAX = 100

# 모바일에서 st.columns가 세로로 쌓이지 않도록 아이템 행만 가로 배치를 유지한다
CSS = """
<style>
div[class*="st-key-row_"] [data-testid="stHorizontalBlock"] {
    flex-wrap: nowrap;
    gap: 0.25rem;
}
div[class*="st-key-row_"] [data-testid="stColumn"] {
    min-width: 0;
}
div[class*="st-key-row_"] [data-testid="stColumn"] p {
    margin-bottom: 0;
    overflow-wrap: anywhere;
}
</style>
"""

_MD_SPECIAL = re.compile(r"([\\`*_{}\[\]()#+\-.!|~<>:$&])")


def md_escape(text: str) -> str:
    """사용자 입력이 마크다운/Streamlit 지시문으로 해석되지 않도록 이스케이프한다."""
    return _MD_SPECIAL.sub(r"\\\1", text)


def init_state() -> None:
    """앱 시작 시 저장된 아이템을 한 번만 불러온다."""
    if "items" not in st.session_state:
        st.session_state["items"] = load_items()
    st.session_state.setdefault("editing_id", None)
    st.session_state.setdefault("confirm_clear", False)
    st.session_state.setdefault("edit_error", None)


def find_item(item_id: str) -> dict | None:
    return next((i for i in st.session_state["items"] if i["id"] == item_id), None)


def persist() -> None:
    save_items(st.session_state["items"])


# ---------- 상태 변경 (콜백) ----------

def add_item(name: str, quantity: int = 1, memo: str = "") -> None:
    st.session_state["items"].append(
        {
            "id": str(uuid.uuid4()),
            "name": name,
            "quantity": quantity,
            "memo": memo,
            "checked": False,
            "created_at": datetime.now().isoformat(timespec="seconds"),
        }
    )
    persist()
    st.toast(f"{md_escape(name)} 추가됨", icon="🛒")


def toggle_item(item_id: str) -> None:
    item = find_item(item_id)
    if item is not None:
        item["checked"] = st.session_state[f"chk_{item_id}"]
        persist()


def start_edit(item_id: str) -> None:
    st.session_state["editing_id"] = item_id
    st.session_state["edit_error"] = None
    item = find_item(item_id)
    if item is not None:
        # 이전 편집에서 남은 입력값 대신 현재 값으로 채운다
        st.session_state[f"edit_name_{item_id}"] = item["name"]
        st.session_state[f"edit_qty_{item_id}"] = item.get("quantity", 1)
        st.session_state[f"edit_memo_{item_id}"] = item.get("memo", "")


def cancel_edit() -> None:
    st.session_state["editing_id"] = None
    st.session_state["edit_error"] = None


def save_edit(item_id: str) -> None:
    name = st.session_state[f"edit_name_{item_id}"].strip()
    if not name:
        st.session_state["edit_error"] = "아이템 이름을 입력해주세요."
        return
    item = find_item(item_id)
    if item is not None:
        item["name"] = name
        item["quantity"] = int(st.session_state[f"edit_qty_{item_id}"])
        item["memo"] = st.session_state[f"edit_memo_{item_id}"].strip()
        persist()
    cancel_edit()


def delete_item(item_id: str) -> None:
    item = find_item(item_id)
    st.session_state["items"] = [i for i in st.session_state["items"] if i["id"] != item_id]
    if st.session_state["editing_id"] == item_id:
        cancel_edit()
    persist()
    if item is not None:
        st.toast(f"{md_escape(item['name'])} 삭제됨", icon="🗑️")


def delete_checked() -> None:
    items = st.session_state["items"]
    if any(i["id"] == st.session_state["editing_id"] and i.get("checked") for i in items):
        cancel_edit()
    remaining = [i for i in items if not i.get("checked")]
    removed = len(items) - len(remaining)
    st.session_state["items"] = remaining
    persist()
    st.toast(f"구매 완료 항목 {removed}개 삭제됨", icon="🧹")


def request_clear() -> None:
    st.session_state["confirm_clear"] = True


def cancel_clear() -> None:
    st.session_state["confirm_clear"] = False


def clear_all() -> None:
    st.session_state["items"] = []
    st.session_state["confirm_clear"] = False
    cancel_edit()
    persist()
    st.toast("전체 삭제됨", icon="🗑️")


# ---------- 화면 ----------

def render_progress() -> None:
    items = st.session_state["items"]
    total = len(items)
    if total == 0:
        return
    done = sum(1 for i in items if i.get("checked"))
    st.progress(done / total, text=f"**{done} / {total}** 구매 완료")
    if done == total:
        st.success("모두 구매했어요!", icon="🎉")


def render_add_form() -> None:
    with st.form("add_form", clear_on_submit=True, border=True):
        name = st.text_input("아이템 이름", max_chars=NAME_MAX, placeholder="예: 우유")
        col_qty, col_memo = st.columns([1, 3])
        quantity = col_qty.number_input("수량", min_value=1, value=1, step=1)
        memo = col_memo.text_input("메모", max_chars=MEMO_MAX, placeholder="선택 입력")
        submitted = st.form_submit_button("추가", type="primary", icon="➕", width="stretch")

    if not submitted:
        return
    name = name.strip()
    if not name:
        st.warning("아이템 이름을 입력해주세요.", icon="⚠️")
        return
    if any(
        not i.get("checked") and i["name"].casefold() == name.casefold()
        for i in st.session_state["items"]
    ):
        st.info(f"'{md_escape(name)}'은(는) 이미 살 것 목록에 있어요. 그래도 추가했어요.", icon="ℹ️")
    add_item(name, int(quantity), memo.strip())


def render_item_view(item: dict) -> None:
    item_id = item["id"]
    checked = item.get("checked", False)
    col_chk, col_text, col_edit, col_del = st.columns(
        [0.1, 0.66, 0.12, 0.12], vertical_alignment="center"
    )
    col_chk.checkbox(
        "구매 완료",
        value=checked,
        key=f"chk_{item_id}",
        on_change=toggle_item,
        args=(item_id,),
        label_visibility="collapsed",
    )

    label = f"**{md_escape(item['name'])}**"
    if item.get("quantity", 1) > 1:
        label += f" × {item['quantity']}"
    if checked:
        label = f":gray[~~{label}~~]"
    col_text.markdown(label)
    if item.get("memo"):
        col_text.caption(md_escape(item["memo"]))

    col_edit.button(
        "✏️", key=f"edit_{item_id}", type="tertiary", help="수정",
        on_click=start_edit, args=(item_id,),
    )
    col_del.button(
        "🗑️", key=f"del_{item_id}", type="tertiary", help="삭제",
        on_click=delete_item, args=(item_id,),
    )


def render_item_edit(item: dict) -> None:
    item_id = item["id"]
    st.text_input("아이템 이름", key=f"edit_name_{item_id}", max_chars=NAME_MAX)
    col_qty, col_memo = st.columns([1, 3])
    col_qty.number_input("수량", key=f"edit_qty_{item_id}", min_value=1, step=1)
    col_memo.text_input("메모", key=f"edit_memo_{item_id}", max_chars=MEMO_MAX)
    if st.session_state["edit_error"]:
        st.warning(st.session_state["edit_error"], icon="⚠️")
    col_save, col_cancel = st.columns(2)
    col_save.button(
        "저장", key=f"save_{item_id}", type="primary", width="stretch",
        on_click=save_edit, args=(item_id,),
    )
    col_cancel.button("취소", key=f"cancel_{item_id}", width="stretch", on_click=cancel_edit)


def render_item(item: dict) -> None:
    editing = st.session_state["editing_id"] == item["id"]
    # 편집 중인 행은 key를 달리해 모바일용 가로 배치 CSS가 적용되지 않게 한다
    key = f"editrow_{item['id']}" if editing else f"row_{item['id']}"
    with st.container(border=True, key=key):
        if editing:
            render_item_edit(item)
        else:
            render_item_view(item)


def render_item_list() -> None:
    items = st.session_state["items"]
    if not items:
        st.info("아직 추가된 아이템이 없어요. 위에서 살 물건을 추가해보세요!", icon="🛍️")
        return

    to_buy = [i for i in items if not i.get("checked")]
    done = [i for i in items if i.get("checked")]

    st.subheader(f"🟢 살 것 ({len(to_buy)})", divider="green")
    if not to_buy:
        st.caption("살 것이 없어요.")
    for item in to_buy:
        render_item(item)

    if done:
        st.subheader(f"✅ 구매 완료 ({len(done)})", divider="gray")
        for item in done:
            render_item(item)


def render_bulk_actions() -> None:
    items = st.session_state["items"]
    if not items:
        return
    has_checked = any(i.get("checked") for i in items)

    st.divider()
    if st.session_state["confirm_clear"]:
        st.warning(f"아이템 {len(items)}개를 모두 삭제할까요? 되돌릴 수 없어요.", icon="⚠️")
        col_yes, col_no = st.columns(2)
        col_yes.button("삭제", key="clear_yes", type="primary", width="stretch", on_click=clear_all)
        col_no.button("취소", key="clear_no", width="stretch", on_click=cancel_clear)
        return

    col_checked, col_all = st.columns(2)
    col_checked.button(
        "체크된 항목 삭제",
        icon="🧹",
        disabled=not has_checked,
        on_click=delete_checked,
        width="stretch",
    )
    col_all.button(
        "전체 삭제",
        icon="🗑️",
        on_click=request_clear,
        width="stretch",
    )


def main() -> None:
    init_state()
    st.markdown(CSS, unsafe_allow_html=True)
    st.title("🛒 쇼핑리스트")
    # 폼에서 추가된 아이템까지 반영하도록 진행 현황은 폼 처리 후에 채운다
    progress_slot = st.container()
    render_add_form()
    with progress_slot:
        render_progress()
    render_item_list()
    render_bulk_actions()


main()
