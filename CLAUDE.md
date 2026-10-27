# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A lightweight shopping list web app (add / edit / delete / check items) built with Python **Streamlit**, intended for **Streamlit Community Cloud**. `PRD.md` is the source of truth for requirements (data model §5, UI §6, acceptance criteria §10). `PROMPTS.md` holds the four-stage plan (skeleton → features → UI → Playwright verification); all four stages are done.

## Commands

```bash
pip install -r requirements.txt          # streamlit>=1.46 (uses width="stretch", container key=)
streamlit run app.py                      # http://localhost:8501
streamlit run app.py --server.headless true --server.port 8501   # for E2E runs
```

There is no unit-test suite or linter. Verification is end-to-end:

- **E2E (Playwright)**: `tests/e2e_main.js` is a single `async (page) => {...}` function meant for the Playwright MCP `browser_run_code_unsafe` tool (`filename: tests/e2e_main.js`). Preconditions: app running on :8501 and `data/shopping_list.json` set to `[]`. It returns a PASS/FAIL table and writes screenshots to `screenshots/`. A full run takes 2+ minutes.
- **Quick logic checks**: `streamlit.testing.v1.AppTest.from_file("app.py")` works for callback/state logic, but does not reproduce client-side behavior (e.g. `clear_on_submit` clearing inputs).
- Before any test that writes data, back up `data/shopping_list.json` and restore it afterwards — it holds the user's real list.

## Architecture

- `storage.py` — `load_items()` / `save_items()` over `data/shopping_list.json` (path resolved relative to `storage.py`). A missing/corrupt/non-list file yields `[]`.
- `app.py` — single-page Streamlit app:
  - State: `st.session_state["items"]` (loaded once per browser session), `editing_id` (one item in edit mode at a time), `confirm_clear` (delete-all confirmation), `edit_error`.
  - All mutations are widget callbacks (`on_click` / `on_change`) that modify `items` and call `persist()`, so no `st.rerun()` is needed. The add form is the exception: it is processed inline after `st.form` returns.
  - The progress bar is rendered into a container created *above* the form but filled *after* the form is processed, so a just-added item is counted in the same run.
  - Each item row is `st.container(key="row_<id>")`; while editing the key becomes `editrow_<id>`. The CSS in `CSS` targets `st-key-row_*` to keep row columns side-by-side on mobile (Streamlit otherwise stacks columns below ~640px) — renaming these keys breaks the mobile layout and the E2E selectors.
- `.streamlit/config.toml` — green theme.

## Conventions / gotchas

- Widget keys are derived from item `id` (`chk_<id>`, `edit_<id>`, `del_<id>`, `edit_name_<id>`…), never list index.
- Any user text rendered through Markdown (item names, memos, toasts, info messages) must go through `md_escape()`; checked items use `:gray[~~**name**~~]`. Never use `unsafe_allow_html` for user input.
- `start_edit` pre-fills `edit_*_<id>` session keys from the item so stale input from an earlier edit doesn't reappear.
- E2E selectors: the first `stMarkdownContainer` in a row is the checkbox's hidden label — locate the item name via `strong`. Short Streamlit reruns don't show the running icon, and old/new elements briefly coexist during a rerun, so wait for the DOM to be stable rather than for the status widget.

## Known open bugs (found in stage 4, intentionally left unfixed)

1. **High — multi-tab/multi-device data loss**: items are loaded once per session (`init_state`) and `persist()` overwrites the whole file with that session's list, so a stale tab erases another tab's changes. On Streamlit Cloud all visitors share one file.
2. **Medium — double-clicking "추가" drops the item**: `clear_on_submit=True` clears inputs client-side on the first click; the second click submits empty values, which supersede the first.
3. **Low — stale delete-all confirmation**: if the list becomes empty while `confirm_clear` is True, `render_bulk_actions` returns early without resetting it, so the confirmation reappears after the next add.

Don't fix these unless asked. Persistent storage (Google Sheets / Supabase) is a v1.1 item in the PRD.
