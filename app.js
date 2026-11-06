/* 고객 한마디 분류기 — 화면.
 *
 * 흐름: 문장 → 가림(mask.js, 브라우저 안) → AI(api/classify) → 실패하면 규칙(rules.js)
 * 채점: 정답 100건을 규칙으로, 또는 AI로(BATCH 건씩 나눠) 돌려 맞힌 비율을 잰다.
 * 모델: 화면에서 고른다. «서버 기본값»이면 빈 문자열을 보내고, 서버가 GEMINI_MODEL 또는 코드 기본값을 쓴다.
 */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const S = { criteria: null, test: [], practice: [], aiResults: null, defaultModel: null };

  // 채점 때 한 번에 보내는 문장 수. 서버 MAX_TEXTS(20)보다 작게 — 20건이면 느린 모델이 60초를 넘겼다.
  const BATCH = 10;

  // ── 모델 목록 ───────────────────────────────────────
  // 출처: https://aistudio.google.com/docs/pricing (2026-11-06 확인)
  //   Free tier 가 «Free of charge» 인 글쓰기(텍스트) 모델만. 음성·번역·임베딩·TTS·이미지는 뺐다.
  //   gemini-2.5-pro · gemini-2.5-flash 는 가격표에 «deprecated» 라 넣지 않았다.
  // 순서는 «추정»이다 — 무료 한도(하루 요청 수)가 높을 것 같은 순서로 놓았을 뿐 근거 표가 없다.
  //   가격표·rate-limits 문서 어디에도 무료 RPD 표가 없고, 한도는 AI Studio 에 로그인해야 보인다.
  //   (보통 Flash-Lite 가 Flash 보다, 정식이 프리뷰보다 한도가 넉넉했다는 경험에 기댄 추정)
  const MODELS = [
    { id: "gemini-3.5-flash-lite", note: "" },
    { id: "gemini-3.1-flash-lite", note: "" },
    { id: "gemini-3.8-flash", note: "" },
    { id: "gemini-3.6-flash", note: "" },
    { id: "gemini-3-flash-preview", note: "프리뷰 · 가격표에 legacy" },
  ];
  const PICK_SERVER = "";            // «서버 기본값»
  const PICK_CUSTOM = "__custom__";  // «직접 입력…»
  const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._\-]{0,63}$/;  // 서버와 같은 규칙
  const STORE_KEY = "classifier.model";

  // localStorage 는 시크릿 창 등에서 막힐 수 있다 — 못 써도 앱은 돈다
  function loadPick() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function savePick() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ pick: $("#model-select").value, custom: $("#model-custom").value }));
    } catch (e) { /* 기억만 못 할 뿐 */ }
  }

  // 지금 보낼 모델 이름. «서버 기본값»이면 빈 문자열.
  function chosenModel() {
    const pick = $("#model-select").value;
    if (pick === PICK_CUSTOM) return $("#model-custom").value.trim();
    return pick;
  }

  function renderModelNow() {
    const pick = $("#model-select").value;
    const m = chosenModel();
    const now = $("#model-now");
    $("#model-custom").hidden = pick !== PICK_CUSTOM;
    now.classList.remove("bad");
    const def = S.defaultModel ? S.defaultModel : "서버에 물어보지 못함 — 서버 함수가 없으면 정상";
    if (!m) {
      now.textContent = pick === PICK_CUSTOM
        ? `입력칸이 비어 있어 서버 기본값으로 호출합니다 · ${def}`
        : `서버 기본값으로 호출합니다 · ${def}`;
    } else if (!MODEL_RE.test(m)) {
      now.classList.add("bad");
      now.textContent = "모델 이름 형식이 맞지 않습니다 — 글자·숫자·. _ - 만, 64자까지. 이대로면 서버가 거절합니다";
    } else {
      now.textContent = `${m} 로 호출합니다`;
    }
  }

  function setupModel() {
    const sel = $("#model-select");
    sel.innerHTML = [`<option value="${PICK_SERVER}">서버 기본값</option>`]
      .concat(MODELS.map(x => `<option value="${x.id}">${x.id}${x.note ? " (" + x.note + ")" : ""}</option>`))
      .concat([`<option value="${PICK_CUSTOM}">직접 입력…</option>`]).join("");
    const saved = loadPick();
    if (typeof saved.custom === "string") $("#model-custom").value = saved.custom;
    if (typeof saved.pick === "string" && [...sel.options].some(o => o.value === saved.pick)) sel.value = saved.pick;
    sel.addEventListener("change", () => { savePick(); renderModelNow(); });
    $("#model-custom").addEventListener("input", () => { savePick(); renderModelNow(); });
    renderModelNow();
    // 서버 기본 모델 이름 — 키는 오지 않는다. 로컬에는 서버 함수가 없어 실패하는 게 정상.
    fetch("api/classify").then(r => r.ok ? r.json() : null).then(d => {
      if (d && typeof d.default === "string") { S.defaultModel = d.default; renderModelNow(); }
    }).catch(() => {});
  }

  async function load() {
    const [c, t, p] = await Promise.all([
      fetch("criteria.json").then(r => r.json()),
      fetch("data/answer100.json").then(r => r.json()),
      fetch("data/practice200.json").then(r => r.json()),
    ]);
    S.criteria = c; S.test = t; S.practice = p;
    renderCriteria();
  }

  // ── 탭 ──────────────────────────────────────────────
  document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
    ["try", "score", "rules"].forEach(k => { $("#tab-" + k).hidden = k !== b.dataset.tab; });
  }));

  // ── AI 호출 ─────────────────────────────────────────
  async function askAI(maskedTexts, model = chosenModel()) {
    try {
      const r = await fetch("api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: maskedTexts, criteria: S.criteria, model }),
      });
      if (!r.ok) return { results: null, reason: `서버 함수가 없습니다 (${r.status}) — 배포하면 생깁니다` };
      return await r.json();
    } catch (e) {
      return { results: null, reason: "서버 함수에 닿지 못했습니다" };
    }
  }

  function chips(el, res) {
    el.innerHTML = ["category", "sentiment", "urgency"]
      .map(k => `<span class="chip ${res[k]}">${res[k]}</span>`).join("");
  }

  // ── 분류해 보기 ─────────────────────────────────────
  $("#btn-sample").addEventListener("click", () => {
    const r = S.practice[Math.floor(Math.random() * S.practice.length)];
    $("#input").value = r.text;
  });

  $("#btn-classify").addEventListener("click", async () => {
    const text = $("#input").value.trim();
    if (!text) return;
    const btn = $("#btn-classify");
    btn.disabled = true; btn.textContent = "분류 중…";

    const m = Mask.mask(text);
    $("#sent").hidden = false;
    $("#sent-text").textContent = m.masked;
    $("#sent-found").innerHTML = m.found.length
      ? m.found.map(f => `<span class="tag">${f.type} 가림</span>`).join("")
      : `<span class="muted">가린 것 없음</span>`;

    const rule = Rules.classify(m.masked, S.criteria);
    const ai = await askAI([m.masked]);
    const got = ai.results && ai.results[0];

    $("#result").hidden = false;
    if (got) {
      $("#main-by").textContent = "AI · " + (ai.model || "");
      chips($("#main-chips"), got);
      $("#main-reason").textContent = got.reason || "";
      $("#note").hidden = true;
    } else {
      $("#main-by").textContent = "규칙";
      chips($("#main-chips"), rule);
      $("#main-reason").textContent = `분류: ${rule.why.category} · 감정: ${rule.why.sentiment} · 긴급도: ${rule.why.urgency}`;
      $("#note").hidden = false;
      $("#note").textContent = `AI 없이 규칙으로만 분류했습니다 — ${ai.reason || "AI 응답 없음"}`;
    }
    chips($("#rule-chips"), rule);
    $("#rule-reason").textContent = `분류: ${rule.why.category}`;
    $("#card-rule").hidden = !got;

    btn.disabled = false; btn.textContent = "분류하기";
  });

  // ── 채점 ───────────────────────────────────────────
  function pct(x) { return x.toFixed(x % 1 ? 1 : 0) + "%"; }

  function showScore(who, s) {
    $("#score-table").hidden = false;
    for (const k of ["category", "sentiment", "urgency"]) {
      document.querySelector(`[data-k="${who}-${k}"]`).textContent = pct(s.accuracy[k]);
    }
    document.querySelector(`[data-k="${who}-all"]`).textContent = `${s.n - s.wrong.length} / ${s.n}`;
    $("#wrong").hidden = false;
    $("#wrong-who").textContent = (who === "ai" ? "— AI" : "— 규칙") + " · 정답 → 판정";
    $("#wrong-list").innerHTML = s.wrong.slice(0, 15).map(w => {
      const diff = ["category", "sentiment", "urgency"].filter(k => w.got[k] !== w.want[k])
        .map(k => `${w.want[k]}→${w.got[k]}`).join(" · ");
      return `<li><span class="t">${w.text}</span><br><span class="d">${diff}${w.note ? " · " + w.note : ""}</span></li>`;
    }).join("") + (s.wrong.length > 15 ? `<li class="d">… 외 ${s.wrong.length - 15}건</li>` : "");
  }

  $("#btn-score-rule").addEventListener("click", () => {
    const s = Rules.score(S.test, r => Rules.classify(Mask.mask(r.text).masked, S.criteria));
    showScore("rule", s);
    $("#score-msg").hidden = true;
  });

  $("#btn-score-ai").addEventListener("click", async () => {
    const btn = $("#btn-score-ai");
    btn.disabled = true;
    const masked = S.test.map(r => Mask.mask(r.text).masked);
    const model = chosenModel();  // 채점 도중 드롭다운을 바꿔도 이번 채점은 한 모델로
    let used = model;
    const results = [];
    for (let i = 0; i < masked.length; i += BATCH) {
      const chunk = masked.slice(i, i + BATCH);
      btn.textContent = `AI 채점 중… ${i}/${masked.length}`;
      let r = await askAI(chunk, model);
      let retried = false;
      if (!r.results && r.timeout) {  // 느려서 끊긴 것만 그 묶음을 한 번 더
        retried = true;
        btn.textContent = `다시 시도… ${i}/${masked.length}`;
        r = await askAI(chunk, model);
      }
      if (!r.results) {
        $("#score-msg").hidden = false;
        $("#score-msg").textContent = `AI로 채점하지 못했습니다 (${i + 1}~${i + chunk.length}번째 문장)`
          + `${retried ? " · 한 번 더 시도했지만 실패" : ""} — ${r.reason}`;
        btn.disabled = false; btn.textContent = "AI로 채점";
        return;
      }
      if (r.model) used = r.model;
      results.push(...r.results);
    }
    $("#th-ai").textContent = used ? `AI · ${used}` : "AI";
    // 답을 못 받은 문장은 «오답»으로 센다 — 빠진 것을 빼고 세면 점수가 부풀려진다
    const miss = { category: "-", sentiment: "-", urgency: "-" };
    S.aiResults = results;
    const s = Rules.score(S.test, (r, i) => results[i] || miss);
    showScore("ai", s);
    const blank = results.filter(x => !x).length;
    $("#score-msg").hidden = !blank;
    if (blank) $("#score-msg").textContent = `AI가 답하지 않은 문장 ${blank}건은 오답으로 셌습니다.`;
    $("#btn-download").hidden = false;
    btn.disabled = false; btn.textContent = "AI로 채점";
  });

  $("#btn-download").addEventListener("click", () => {
    const rows = S.test.map((r, i) => ({ id: r.id, text: r.text, 정답: r, AI: S.aiResults[i] }));
    const blob = new Blob([JSON.stringify(rows, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "ai_채점결과.json"; a.click();
  });

  // ── 기준 ───────────────────────────────────────────
  function renderCriteria() {
    const c = S.criteria;
    $("#owner").textContent = c.owner;
    $("#crit-cats").innerHTML = c.categories
      .map(x => `<tr><td>${x.name}</td><td>${x.definition}</td></tr>`).join("");
    $("#crit-priority").textContent = c.priority.join(" → ") + " 순서로 먼저 봅니다.";
    $("#crit-priority-reason").textContent = c.priority_reason;
    $("#crit-sent").textContent = c.sentiment.guide;
    $("#crit-urg").textContent = c.urgency.guide;
  }

  setupModel();
  load();
})();
