# 🛒 쇼핑리스트

아이템 추가 · 수정 · 삭제 · 체크 기능이 있는 가벼운 Streamlit 쇼핑리스트 앱입니다.
요구사항은 [PRD.md](PRD.md)를 참고하세요.

## 실행 방법

```bash
pip install -r requirements.txt
streamlit run app.py
```

브라우저에서 http://localhost:8501 이 열립니다.

## 데이터 저장

아이템은 `data/shopping_list.json`에 저장됩니다(없으면 자동 생성).
Streamlit Community Cloud에서는 앱이 재시작되면 이 파일이 초기화됩니다.
