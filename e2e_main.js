// 쇼핑리스트 앱 E2E 검증 (Playwright MCP browser_run_code_unsafe 용)
// 전제: http://localhost:8501 실행 중, data/shopping_list.json = []
async (page) => {
  const URL = 'http://localhost:8501';
  const ROW = 'div[class*="st-key-row_"]';
  const EDITROW = 'div[class*="st-key-editrow_"]';
  const results = [];
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });

  const snapshot = () => page.evaluate(({ ROW, EDITROW }) => {
    const rows = [...document.querySelectorAll(ROW)].map((r) => {
      // 첫 마크다운 컨테이너는 체크박스의 숨김 라벨이므로 이름(<strong>) 기준으로 찾는다
      const strong = r.querySelector('strong');
      const md = strong && strong.closest('[data-testid="stMarkdownContainer"]');
      const cap = r.querySelector('[data-testid="stCaptionContainer"]');
      return {
        name: strong ? strong.innerText : null,
        text: md ? md.innerText : null,
        memo: cap ? cap.innerText : null,
        checked: !!(r.querySelector('input[type="checkbox"]') || {}).checked,
        strike: !!r.querySelector('del, s'),
      };
    });
    const q = (s) => [...document.querySelectorAll(s)].map((e) => e.innerText.trim());
    const prog = document.querySelector('[data-testid="stProgress"]');
    return {
      rows,
      names: rows.map((r) => r.name),
      editing: document.querySelectorAll(EDITROW).length,
      headers: q('h3'),
      progress: prog ? prog.innerText.trim() : null,
      alerts: q('[data-testid="stAlert"]'),
      toasts: q('[data-testid="stToast"]'),
      exception: document.querySelectorAll('[data-testid="stException"]').length,
      running: !!document.querySelector('[data-testid="stStatusWidgetRunningIcon"]'),
      buttons: [...document.querySelectorAll('button')].map((b) => ({ t: b.innerText.trim(), d: b.disabled })),
    };
  }, { ROW, EDITROW });

  // 조건이 참이고 화면이 안정될 때까지 폴링 (고정 sleep 대신)
  // Streamlit은 재실행 중 이전 요소와 새 요소가 잠시 공존하고, 짧은 실행에서는
  // 실행 중 아이콘이 뜨지 않으므로 "연속 3회 동일한 화면"을 완료 신호로 쓴다.
  const until = async (pred, timeout = 8000) => {
    const start = Date.now();
    let s, prev = null, stable = 0;
    while (Date.now() - start < timeout) {
      s = await snapshot();
      const sig = JSON.stringify({ ...s, toasts: null });
      stable = sig === prev ? stable + 1 : 0;
      prev = sig;
      if (!s.running && stable >= 2 && pred(s)) return { ok: true, s, ms: Date.now() - start };
      await page.waitForTimeout(150);
    }
    return { ok: false, s, ms: timeout };
  };
  const idle = () => until(() => true);

  const record = (id, scenario, expected, ok, actual) =>
    results.push({ id, scenario, expected, actual, result: ok ? 'PASS' : 'FAIL' });
  const run = async (id, scenario, expected, fn) => {
    try {
      const { ok, actual } = await fn();
      record(id, scenario, expected, ok, actual);
    } catch (e) {
      record(id, scenario, expected, false, 'ERROR: ' + String(e.message || e).split('\n')[0]);
    }
  };

  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const form = () => page.locator('[data-testid="stForm"]');
  const row = (name) => page.locator(ROW).filter({
    has: page.locator('strong', { hasText: new RegExp('^' + reEsc(name) + '$') }),
  }).first();
  const editRow = () => page.locator(EDITROW).first();

  const add = async (name, qty, memo, { enter = false } = {}) => {
    const f = form();
    await f.getByLabel('아이템 이름').fill(name);
    if (qty !== undefined) await f.getByLabel('수량').fill(String(qty));
    if (memo !== undefined) await f.getByLabel('메모').fill(memo);
    if (enter) await f.getByLabel('아이템 이름').press('Enter');
    else await f.getByRole('button', { name: /추가/ }).click();
  };
  const toggle = (name) => row(name).locator('[data-testid="stCheckbox"] label').click();
  const editBtn = (name) => row(name).getByRole('button', { name: '✏️' }).click();
  const delBtn = (name) => row(name).getByRole('button', { name: '🗑️' }).click();
  const bulk = (label) => page.getByRole('button', { name: new RegExp(label) }).click();

  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(URL);
  await page.locator('h1').waitFor();
  await idle();

  // ---------------- A. 추가 ----------------
  await run('A1', '빈 상태 화면', '빈 상태 안내 표시, 진행바·일괄 삭제 버튼 없음', async () => {
    const s = (await idle()).s;
    const ok = s.rows.length === 0 && s.alerts.some((a) => a.includes('아직 추가된 아이템이 없어요'))
      && s.progress === null && !s.buttons.some((b) => b.t.includes('전체 삭제'));
    return { ok, actual: `rows=${s.rows.length}, alerts=${JSON.stringify(s.alerts)}, progress=${s.progress}` };
  });

  await run('A2', '공백만 입력 후 추가', '경고 표시, 추가 안 됨', async () => {
    await add('   ');
    const r = await until((s) => s.alerts.some((a) => a.includes('아이템 이름을 입력해주세요')));
    return { ok: r.ok && r.s.rows.length === 0, actual: `rows=${r.s.rows.length}, alerts=${JSON.stringify(r.s.alerts)}` };
  });

  await run('A3', '"우유" 수량2 메모"저지방" 추가', '목록 표시, 0/1 진행, 토스트, 입력 필드 초기화', async () => {
    await add('우유', 2, '저지방');
    const r = await until((s) => s.names.includes('우유'));
    const f = form();
    const vals = [await f.getByLabel('아이템 이름').inputValue(), await f.getByLabel('수량').inputValue(), await f.getByLabel('메모').inputValue()];
    const it = r.s.rows.find((x) => x.name === '우유') || {};
    const ok = r.ok && it.text === '우유 × 2' && it.memo === '저지방' && /0 \/ 1/.test(r.s.progress || '')
      && r.s.toasts.some((t) => t.includes('우유 추가됨')) && vals.join('|') === '|1|';
    return { ok, actual: `text="${it.text}", memo="${it.memo}", progress="${r.s.progress}", toasts=${JSON.stringify(r.s.toasts)}, 입력값=${JSON.stringify(vals)}` };
  });

  await run('A4', 'Enter 키로 "계란" 추가', 'Enter로 제출되어 목록에 추가', async () => {
    await add('계란', undefined, undefined, { enter: true });
    const r = await until((s) => s.names.includes('계란'));
    return { ok: r.ok, actual: `names=${JSON.stringify(r.s.names)}` };
  });

  await run('A5', '같은 이름 "우유" 중복 추가', '안내 메시지 표시 후 추가는 허용', async () => {
    await add('우유');
    const r = await until((s) => s.names.filter((n) => n === '우유').length === 2);
    const ok = r.ok && r.s.alerts.some((a) => a.includes('이미 살 것 목록에 있어요'));
    // 정리: 두 번째 우유 삭제
    await page.locator(ROW).filter({ has: page.locator('strong', { hasText: /^우유$/ }) }).nth(1)
      .getByRole('button', { name: '🗑️' }).click();
    const r2 = await until((s) => s.names.filter((n) => n === '우유').length === 1);
    const first = r2.s.rows.find((x) => x.name === '우유') || {};
    return { ok: ok && r2.ok && first.memo === '저지방', actual: `alerts=${JSON.stringify(r.s.alerts)}, 정리 후 남은 우유 memo="${first.memo}"` };
  });

  await run('A6', '이름 60자 / 메모 120자 타이핑', '이름 50자, 메모 100자로 제한', async () => {
    const f = form();
    await f.getByLabel('아이템 이름').pressSequentially('A'.repeat(60));
    await f.getByLabel('메모').pressSequentially('M'.repeat(120));
    await f.getByRole('button', { name: /추가/ }).click();
    const r = await until((s) => s.names.some((n) => n && n.startsWith('AAAA')));
    const it = r.s.rows.find((x) => x.name && x.name.startsWith('AAAA')) || {};
    const ok = r.ok && it.name.length === 50 && (it.memo || '').length === 100;
    if (r.ok) { await delBtn(it.name); await until((s) => !s.names.includes(it.name)); }
    return { ok, actual: `name.length=${(it.name || '').length}, memo.length=${(it.memo || '').length}` };
  });

  await run('A7', '특수문자/HTML/마크다운 입력', '<script>, **, :red[], ~~, $ 등이 텍스트 그대로 표시, 스크립트 실행 없음', async () => {
    const name = '<script>alert(1)</script>';
    const memo = '**굵게** :red[빨강] ~~x~~ $x^2$';
    await add(name, 1, memo);
    const r = await until((s) => s.names.includes(name));
    const it = r.s.rows.find((x) => x.name === name) || {};
    const toast = r.s.toasts.find((t) => t.includes('추가됨')) || '';
    const ok = r.ok && it.memo === memo && dialogs.length === 0 && toast.endsWith(`\n${name} 추가됨`);
    return { ok, actual: `name="${it.name}", memo="${it.memo}", toast="${toast}", dialogs=${dialogs.length}` };
  });

  await run('A8', '이모지 이름 "🍎 사과" 수량 5', '이모지 포함 이름 정상 표시', async () => {
    await add('🍎 사과', 5);
    const r = await until((s) => s.names.includes('🍎 사과'));
    const it = r.s.rows.find((x) => x.name === '🍎 사과') || {};
    return { ok: r.ok && it.text === '🍎 사과 × 5', actual: `text="${it.text}"` };
  });

  await run('A9', '수량에 0 입력 후 추가', '1 미만은 허용되지 않음 (1로 보정 또는 차단)', async () => {
    await add('바나나', 0);
    const r = await until((s) => s.names.includes('바나나'), 4000);
    const it = (r.s.rows.find((x) => x.name === '바나나')) || {};
    const ok = !r.ok || it.text === '바나나';  // 차단되었거나 수량 1
    if (r.ok) { await delBtn('바나나'); await until((s) => !s.names.includes('바나나')); }
    return { ok, actual: r.ok ? `추가됨, text="${it.text}"` : '추가되지 않음' };
  });

  // ---------------- B. 체크 ----------------
  await run('B1', '"계란" 체크', '구매 완료 섹션 이동 + 취소선 + 진행 1/4', async () => {
    await toggle('계란');
    const r = await until((s) => (s.rows.find((x) => x.name === '계란') || {}).checked);
    const it = r.s.rows.find((x) => x.name === '계란') || {};
    const last = r.s.names[r.s.names.length - 1];
    const ok = r.ok && it.strike && last === '계란' && /1 \/ 4/.test(r.s.progress || '')
      && r.s.headers.includes('🟢 살 것 (3)') && r.s.headers.includes('✅ 구매 완료 (1)');
    return { ok, actual: `strike=${it.strike}, 순서=${JSON.stringify(r.s.names)}, headers=${JSON.stringify(r.s.headers)}, progress="${r.s.progress}"` };
  });

  await run('B2', '"계란" 체크 해제', '살 것 섹션으로 복귀, 구매 완료 섹션 사라짐', async () => {
    await toggle('계란');
    const r = await until((s) => !(s.rows.find((x) => x.name === '계란') || { checked: true }).checked);
    const it = r.s.rows.find((x) => x.name === '계란') || {};
    const ok = r.ok && !it.strike && r.s.headers.includes('🟢 살 것 (4)') && !r.s.headers.some((h) => h.includes('구매 완료'));
    return { ok, actual: `strike=${it.strike}, headers=${JSON.stringify(r.s.headers)}` };
  });

  await run('B3', '전부 체크', '4/4 + "모두 구매했어요!" 표시', async () => {
    for (const n of ['우유', '계란', '<script>alert(1)</script>', '🍎 사과']) {
      await toggle(n);
      await until((s) => (s.rows.find((x) => x.name === n) || {}).checked);
    }
    const r = await until((s) => s.alerts.some((a) => a.includes('모두 구매했어요')));
    return { ok: r.ok && /4 \/ 4/.test(r.s.progress || ''), actual: `progress="${r.s.progress}", alerts=${JSON.stringify(r.s.alerts)}` };
  });

  await run('B4', '"우유", "<script>" 체크 해제', '혼합 상태: 살 것 2 / 구매 완료 2, 완료 메시지 사라짐', async () => {
    for (const n of ['우유', '<script>alert(1)</script>']) {
      await toggle(n);
      await until((s) => !(s.rows.find((x) => x.name === n) || { checked: true }).checked);
    }
    const r = await until((s) => /2 \/ 4/.test(s.progress || ''));
    const ok = r.ok && !r.s.alerts.some((a) => a.includes('모두 구매했어요'))
      && JSON.stringify(r.s.names) === JSON.stringify(['우유', '<script>alert(1)</script>', '계란', '🍎 사과']);
    return { ok, actual: `순서=${JSON.stringify(r.s.names)}, progress="${r.s.progress}"` };
  });

  await page.screenshot({ path: 'screenshots/01_desktop_list.png', fullPage: false });
  await page.setViewportSize({ width: 375, height: 1100 });
  await idle();
  await run('F1', '모바일 375px 레이아웃', '가로 스크롤 없음, 각 행이 한 줄(체크박스·이름·버튼 같은 줄)', async () => {
    const m = await page.evaluate((ROW) => {
      const overflow = document.documentElement.scrollWidth > window.innerWidth;
      const rows = [...document.querySelectorAll(ROW)].map((r) => {
        const cols = [...r.querySelectorAll('[data-testid="stColumn"]')].map((c) => c.getBoundingClientRect());
        // 세로로 쌓이면 다음 칸의 left가 앞 칸의 right보다 작아진다
        const sideBySide = cols.every((c, i) => i === 0 || c.left >= cols[i - 1].right - 1);
        return { n: cols.length, sideBySide, right: Math.round(Math.max(...cols.map((c) => c.right))) };
      });
      return { overflow, rows, w: window.innerWidth };
    }, ROW);
    const ok = !m.overflow && m.rows.every((r) => r.n === 4 && r.sideBySide && r.right <= m.w);
    return { ok, actual: JSON.stringify(m) };
  });
  await page.screenshot({ path: 'screenshots/02_mobile_list.png', fullPage: false });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await idle();

  // ---------------- C. 수정 ----------------
  await run('C1', '"우유" 수정 → "저지방 우유" × 3, 메모 "1L" 저장', '기존 값이 채워진 편집 모드 → 저장 후 반영', async () => {
    await editBtn('우유');
    await until((s) => s.editing === 1);
    const e = editRow();
    const pre = [await e.getByLabel('아이템 이름').inputValue(), await e.getByLabel('수량').inputValue(), await e.getByLabel('메모').inputValue()];
    await e.getByLabel('아이템 이름').fill('저지방 우유');
    await e.getByLabel('수량').fill('3');
    await e.getByLabel('메모').fill('1L');
    await e.getByRole('button', { name: '저장' }).click();
    const r = await until((s) => s.editing === 0 && s.names.includes('저지방 우유'));
    const it = r.s.rows.find((x) => x.name === '저지방 우유') || {};
    const ok = r.ok && pre.join('|') === '우유|2|저지방' && it.text === '저지방 우유 × 3' && it.memo === '1L';
    return { ok, actual: `편집 초기값=${JSON.stringify(pre)}, 저장 후 text="${it.text}", memo="${it.memo}", editing=${r.s.editing}` };
  });

  await run('C2', '수정 후 취소', '원래 값 유지', async () => {
    await editBtn('저지방 우유');
    await until((s) => s.editing === 1);
    await editRow().getByLabel('아이템 이름').fill('바뀌면안됨');
    await editRow().getByRole('button', { name: '취소' }).click();
    const r = await until((s) => s.editing === 0);
    return { ok: r.ok && r.s.names.includes('저지방 우유') && !r.s.names.includes('바뀌면안됨'), actual: `names=${JSON.stringify(r.s.names)}` };
  });

  await run('C3', '빈 이름으로 저장', '경고 표시, 편집 모드 유지, 값 변경 없음', async () => {
    await editBtn('저지방 우유');
    await until((s) => s.editing === 1);
    await editRow().getByLabel('아이템 이름').fill('');
    await editRow().getByRole('button', { name: '저장' }).click();
    const r = await until((s) => s.alerts.some((a) => a.includes('아이템 이름을 입력해주세요')));
    const ok = r.ok && r.s.editing === 1;
    await editRow().getByRole('button', { name: '취소' }).click();
    const r2 = await until((s) => s.editing === 0);
    return { ok: ok && r2.s.names.includes('저지방 우유'), actual: `editing=${r.s.editing}, alerts=${JSON.stringify(r.s.alerts)}, 취소 후 names=${JSON.stringify(r2.s.names)}` };
  });

  await run('C4', '편집 중 다른 아이템 ✏️ 클릭', '편집 대상이 전환, 이전 아이템은 변경 없음, 재진입 시 저장된 값으로 채워짐', async () => {
    await editBtn('저지방 우유');
    await until((s) => s.editing === 1);
    await editRow().getByLabel('아이템 이름').fill('X임시');
    await editBtn('계란');
    const r = await until((s) => s.editing === 1 && s.names.includes('저지방 우유'));
    const nowName = await editRow().getByLabel('아이템 이름').inputValue();
    await editRow().getByRole('button', { name: '취소' }).click();
    await until((s) => s.editing === 0);
    await editBtn('저지방 우유');
    await until((s) => s.editing === 1);
    const reName = await editRow().getByLabel('아이템 이름').inputValue();
    await editRow().getByRole('button', { name: '취소' }).click();
    await until((s) => s.editing === 0);
    const ok = r.ok && nowName === '계란' && reName === '저지방 우유';
    return { ok, actual: `전환 후 편집 대상="${nowName}", 재진입 초기값="${reName}"` };
  });

  await run('C5', '체크된 "계란"을 "  달걀  "로 수정', '앞뒤 공백 제거, 체크 상태 유지', async () => {
    await editBtn('계란');
    await until((s) => s.editing === 1);
    await editRow().getByLabel('아이템 이름').fill('  달걀  ');
    await editRow().getByRole('button', { name: '저장' }).click();
    const r = await until((s) => s.editing === 0 && s.names.includes('달걀'));
    const it = r.s.rows.find((x) => x.name === '달걀') || {};
    return { ok: r.ok && it.checked && it.strike, actual: `name="${it.name}", checked=${it.checked}` };
  });

  // 모바일 편집 화면 스크린샷
  await page.setViewportSize({ width: 375, height: 1100 });
  await editBtn('저지방 우유');
  await until((s) => s.editing === 1);
  await page.screenshot({ path: 'screenshots/03_mobile_edit.png', fullPage: false });
  await editRow().getByRole('button', { name: '취소' }).click();
  await until((s) => s.editing === 0);
  await page.setViewportSize({ width: 1280, height: 1000 });

  // ---------------- D. 삭제 ----------------
  await run('D1', '맨 앞 아이템 "저지방 우유" 삭제', '해당 아이템만 삭제, 나머지 체크 상태 그대로', async () => {
    const before = (await idle()).s.rows.filter((x) => x.name !== '저지방 우유').map((x) => `${x.name}:${x.checked}`);
    await delBtn('저지방 우유');
    const r = await until((s) => !s.names.includes('저지방 우유'));
    const after = r.s.rows.map((x) => `${x.name}:${x.checked}`);
    return { ok: r.ok && JSON.stringify(before) === JSON.stringify(after) && r.s.toasts.some((t) => t.includes('저지방 우유 삭제됨')), actual: `before=${JSON.stringify(before)}, after=${JSON.stringify(after)}` };
  });

  await run('D2', '"체크된 항목 삭제"', '체크된 항목만 삭제, 이후 버튼 비활성화', async () => {
    await bulk('체크된 항목 삭제');
    const r = await until((s) => s.rows.every((x) => !x.checked));
    const btn = r.s.buttons.find((b) => b.t.includes('체크된 항목 삭제')) || {};
    return { ok: r.ok && JSON.stringify(r.s.names) === JSON.stringify(['<script>alert(1)</script>']) && btn.d === true, actual: `names=${JSON.stringify(r.s.names)}, 버튼 disabled=${btn.d}` };
  });

  await run('D3', '"전체 삭제" → 취소 → 다시 → 확인', '확인 전 삭제 안 됨, 취소 시 유지, 확인 시 전체 삭제', async () => {
    await bulk('전체 삭제');
    const r1 = await until((s) => s.alerts.some((a) => a.includes('모두 삭제할까요')));
    const keep1 = r1.s.rows.length;
    await page.getByRole('button', { name: '취소', exact: true }).click();
    const r2 = await until((s) => !s.alerts.some((a) => a.includes('모두 삭제할까요')));
    await bulk('전체 삭제');
    await until((s) => s.alerts.some((a) => a.includes('모두 삭제할까요')));
    await page.setViewportSize({ width: 375, height: 900 });
    await page.screenshot({ path: 'screenshots/04_mobile_confirm_clear.png', fullPage: false });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.getByRole('button', { name: '삭제', exact: true }).click();
    const r3 = await until((s) => s.rows.length === 0);
    const ok = r1.ok && keep1 === 1 && r2.s.rows.length === 1 && r3.ok && r3.s.alerts.some((a) => a.includes('아직 추가된'));
    return { ok, actual: `확인창 표시 중 rows=${keep1}, 취소 후 rows=${r2.s.rows.length}, 확인 후 rows=${r3.s.rows.length}` };
  });

  await run('D4', '전체 삭제 확인창을 띄운 채 개별 삭제로 목록을 비운 뒤 새 아이템 추가', '확인창이 다시 나타나지 않음', async () => {
    await add('임시A');
    await until((s) => s.names.includes('임시A'));
    await bulk('전체 삭제');
    await until((s) => s.alerts.some((a) => a.includes('모두 삭제할까요')));
    await delBtn('임시A');
    await until((s) => s.rows.length === 0);
    await add('임시B');
    const r = await until((s) => s.names.includes('임시B'));
    const stale = r.s.alerts.some((a) => a.includes('모두 삭제할까요'));
    // 정리
    if (stale) await page.getByRole('button', { name: '삭제', exact: true }).click();
    else { await bulk('전체 삭제'); await until((s) => s.alerts.some((a) => a.includes('모두 삭제할까요'))); await page.getByRole('button', { name: '삭제', exact: true }).click(); }
    await until((s) => s.rows.length === 0);
    return { ok: r.ok && !stale, actual: stale ? `새 아이템 추가 직후 확인창 표시됨: ${JSON.stringify(r.s.alerts)}` : '확인창 없음' };
  });

  // ---------------- E. 데이터 유지 ----------------
  await run('E1', '새로고침 후 목록·체크 상태 유지', '새로고침 전후 동일', async () => {
    await add('우유', 2, '저지방'); await until((s) => s.names.includes('우유'));
    await add('계란'); await until((s) => s.names.includes('계란'));
    await toggle('계란'); await until((s) => (s.rows.find((x) => x.name === '계란') || {}).checked);
    const before = (await idle()).s.rows;
    await page.reload(); await page.locator('h1').waitFor();
    const r = await until((s) => s.rows.length === before.length);
    return { ok: r.ok && JSON.stringify(before) === JSON.stringify(r.s.rows), actual: `before=${JSON.stringify(before.map((x) => x.name + ':' + x.checked))}, after=${JSON.stringify(r.s.rows.map((x) => x.name + ':' + x.checked))}` };
  });

  // ---------------- G. 연타 ----------------
  await run('G1', '"추가" 버튼 더블클릭', '아이템 1개만 추가, 오류 없음', async () => {
    const f = form();
    await f.getByLabel('아이템 이름').fill('연타');
    await f.getByRole('button', { name: /추가/ }).dblclick();
    await until((s) => s.names.includes('연타'), 3000);
    await page.waitForTimeout(800);
    const s = (await idle()).s;
    const n = s.names.filter((x) => x === '연타').length;
    if (n === 0) { await add('연타'); await until((x) => x.names.includes('연타')); }  // 다음 시나리오용
    return { ok: n === 1 && s.exception === 0, actual: `연타 개수=${n}, alerts=${JSON.stringify(s.alerts)}, exception=${s.exception}` };
  });

  await run('G2', '체크박스 5회 빠르게 연타', '최종 체크 상태(체크됨)가 화면·저장 데이터 모두 일치', async () => {
    const cb = row('연타').locator('[data-testid="stCheckbox"] label');
    for (let i = 0; i < 5; i++) await cb.click({ delay: 0 });
    await page.waitForTimeout(800);
    const s = (await idle()).s;
    const it = s.rows.find((x) => x.name === '연타') || {};
    await page.reload(); await page.locator('h1').waitFor();
    const s2 = (await until((x) => x.names.includes('연타'))).s;
    const it2 = s2.rows.find((x) => x.name === '연타') || {};
    return { ok: it.checked === true && it2.checked === true && s.exception === 0, actual: `화면 checked=${it.checked}, 새로고침 후(저장값) checked=${it2.checked}` };
  });

  await run('G3', '"우유" 체크박스 연타 직후 다른 아이템 삭제', '데이터 꼬임 없음', async () => {
    const cb = row('우유').locator('[data-testid="stCheckbox"] label');
    await cb.click(); await cb.click(); await cb.click();
    await delBtn('연타');
    await page.waitForTimeout(800);
    const s = (await idle()).s;
    const it = s.rows.find((x) => x.name === '우유') || {};
    return { ok: !s.names.includes('연타') && it.checked === true && s.exception === 0, actual: `names=${JSON.stringify(s.names)}, 우유 checked=${it.checked}` };
  });

  await page.screenshot({ path: 'screenshots/05_desktop_final.png', fullPage: false });
  return { results, dialogs };
}
