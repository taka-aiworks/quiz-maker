(() => {
  "use strict";

  // ------- ユーティリティ -------
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const uid = () => `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  const clamp = (n,min,max)=> Math.max(min, Math.min(max, n));
  const deepCopy = (obj) => typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));

  // ------- 永続化 -------
  const LS_KEY = "quiz_maker_state_v1";
  const saveState = () => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ bank: state.bank, settings: state.settings }));
      updateStorageStatus("保存済み");
    } catch(e){ console.warn(e); updateStorageStatus("保存失敗"); }
  };
  const loadState = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if(!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.bank)) state.bank = parsed.bank;
      if (parsed.settings && typeof parsed.settings === "object") state.settings = { ...state.settings, ...parsed.settings };
    } catch(e){ console.warn(e); }
  };

  // ------- 状態 -------
  const state = {
    bank: /** @type {Question[]} */ ([]),
    quiz: /** @type {Question[]} */ ([]),
    play: { index: 0, correct: 0, shuffledChoices: [] },
    settings: { theme: "auto" }
  };

  /**
   * @typedef {{ id:string, category:string, difficulty:"easy"|"normal"|"hard", text:string, choices:[string,string,string,string], answerIndex:0|1|2|3, tags:string[] }} Question
   */

  // ------- タブ制御 -------
  const tabs = $$(".tab");
  const panels = {
    bank: $("#panel-bank"),
    generate: $("#panel-generate"),
    play: $("#panel-play"),
    settings: $("#panel-settings")
  };
  const initialized = { bank:false, generate:false, play:false, settings:false };

  function switchTab(name){
    tabs.forEach(btn => {
      const active = btn.dataset.tab === name;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    Object.entries(panels).forEach(([key, el]) => el.classList.toggle("active", key===name));
    if(!initialized[name]) {
      init[name]();
      initialized[name] = true;
    }
    render[name]();
  }

  // ------- init / render -------
  const init = {
    bank(){
      // フォーム要素
      const form = $("#bank-form");
      $("#btn-reset").addEventListener("click", () => fillForm()); // 空で上書き
      form.addEventListener("submit", (e)=>{
        e.preventDefault();
        const q = collectForm();
        const err = validateQuestion(q);
        if (err.length) { alert("入力エラー:\n- " + err.join("\n- ")); return; }
        if ($("#q-id").value) {
          // 更新
          const idx = state.bank.findIndex(v => v.id === $("#q-id").value);
          if (idx >= 0) state.bank[idx] = q;
        } else {
          // 追加
          q.id = genSafeId();
          state.bank.push(q);
        }
        dispatch("bank:updated");
        fillForm(); // クリア
      });

      // 検索・フィルタ
      $("#bank-search").addEventListener("input", render.bank);
      $("#bank-filter-cat").addEventListener("input", render.bank);
      $("#bank-filter-diff").addEventListener("change", render.bank);
    },
    generate(){
      $("#gen-form").addEventListener("submit", (e)=>{
        e.preventDefault();
        const cats = $("#gen-cats").value.split(",").map(s=>s.trim()).filter(Boolean);
        const diffs = $("#gen-diffs").value.split(",").map(s=>s.trim()).filter(Boolean);
        const count = clamp(parseInt($("#gen-count").value||"5",10) || 5, 1, 999);
        const shuffle = $("#gen-shuffle").checked;

        const filtered = state.bank.filter(q => {
          const okCat = cats.length ? cats.includes(q.category) : true;
          const okDiff = diffs.length ? diffs.includes(q.difficulty) : true;
          return okCat && okDiff;
        });
        const picked = pickRandom(filtered, count).map(q => deepCopy(q));
        if (shuffle) picked.forEach(q => q.choices = shuffleArray(q.choices));
        state.quiz = picked;
        state.play = { index: 0, correct: 0, shuffledChoices: [] };
        dispatch("quiz:generated");
      });
    },
    play(){
      $("#btn-answer").addEventListener("click", onAnswer);
      $("#btn-next").addEventListener("click", nextQuestion);
    },
    settings(){
      // テーマ
      const sel = $("#theme-select");
      sel.value = state.settings.theme;
      sel.addEventListener("change", ()=>{
        state.settings.theme = sel.value;
        applyTheme();
        dispatch("settings:changed");
      });
      // エクスポート
      $("#btn-export").addEventListener("click", ()=>{
        $("#export-json").value = JSON.stringify({ bank: state.bank, settings: state.settings }, null, 2);
      });
      // コピー
      $("#btn-copy").addEventListener("click", async ()=>{
        try {
          await navigator.clipboard.writeText($("#export-json").value);
          alert("コピーしました");
        } catch { alert("コピーに失敗しました"); }
      });
      // インポート
      $("#btn-import").addEventListener("click", ()=>{
        try{
          const parsed = JSON.parse($("#import-json").value);
          if (!parsed || !Array.isArray(parsed.bank)) throw new Error("bankが見つかりません");
          // バリデーション・id再発行
          const next = [];
          for (const item of parsed.bank) {
            const q = coerceQuestion(item);
            const err = validateQuestion(q);
            if (err.length) throw new Error("不正な問題があります: " + err.join(", "));
            q.id = genSafeId(); // 衝突防止
            next.push(q);
          }
          state.bank = next;
          dispatch("bank:updated");
          alert("インポートしました");
        } catch(e){
          alert("インポート失敗: " + e.message);
        }
      });
      updateStorageStatus(""); // 初期表示
    }
  };

  const render = {
    bank(){
      // 一覧
      const tbody = $("#bank-table tbody");
      tbody.innerHTML = "";
      const kw = $("#bank-search").value.trim().toLowerCase();
      const cat = $("#bank-filter-cat").value.trim();
      const diff = $("#bank-filter-diff").value;
      const list = state.bank.filter(q=>{
        const hitKw = !kw || (q.text.toLowerCase().includes(kw) || q.choices.some(c=>c.toLowerCase().includes(kw)));
        const hitCat = !cat || q.category === cat;
        const hitDiff = !diff || q.difficulty === diff;
        return hitKw && hitCat && hitDiff;
      });

      for (const q of list) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(q.id)}</td>
          <td>${escapeHtml(q.category)}</td>
          <td>${escapeHtml(q.difficulty)}</td>
          <td title="${escapeHtml(q.text)}">${escapeHtml(q.text.slice(0,40))}${q.text.length>40?"…":""}</td>
          <td>
            <button data-act="edit" data-id="${q.id}">編集</button>
            <button class="secondary" data-act="del" data-id="${q.id}">削除</button>
          </td>`;
        tbody.appendChild(tr);
      }

      // 操作
      tbody.querySelectorAll("button[data-act]").forEach(btn=>{
        const id = btn.dataset.id;
        btn.addEventListener("click", ()=>{
          const act = btn.dataset.act;
          const idx = state.bank.findIndex(x=>x.id===id);
          if (idx<0) return;
          if (act==="edit") fillForm(state.bank[idx]);
          if (act==="del") {
            if (confirm("削除しますか？")) {
              state.bank.splice(idx,1);
              dispatch("bank:updated");
            }
          }
        });
      });
    },
    generate(){
      $("#gen-current-count").textContent = String(state.quiz.length);
    },
    play(){
      const card = $("#play-content");
      const actions = $("#play-actions");
      if (!state.quiz.length) {
        card.innerHTML = `<p class="muted">まずは「クイズ生成」で問題を用意してください。</p>`;
        actions.hidden = true;
        return;
      }
      const i = state.play.index;
      if (i >= state.quiz.length) {
        card.innerHTML = `<h3>結果</h3><p>正解：${state.play.correct} / ${state.quiz.length}</p>`;
        actions.hidden = true;
        return;
      }
      const q = state.quiz[i];
      // 表示用に選択肢をシャッフルし、正解位置を埋め込む
      const choices = q.choices.map((text, idx) => ({ text, idx }));
      const shuffled = shuffleArray(choices);
      state.play.shuffledChoices = shuffled;

      card.innerHTML = `
        <p><strong>${i+1}. ${escapeHtml(q.text)}</strong></p>
        <div role="radiogroup" aria-label="選択肢">
          ${shuffled.map((c, j)=>`
            <label style="display:block;margin:6px 0;">
              <input type="radio" name="choice" value="${j}"> ${escapeHtml(c.text)}
            </label>
          `).join("")}
        </div>
      `;
      $("#btn-answer").hidden = false;
      $("#btn-next").hidden = true;
      actions.hidden = false;
    },
    settings(){
      applyTheme();
    }
  };

  // ------- 監視イベント -------
  function dispatch(name){
    document.dispatchEvent(new CustomEvent(name));
  }
  document.addEventListener("bank:updated", () => { render.bank(); render.generate(); saveState(); });
  document.addEventListener("quiz:generated", () => { render.generate(); render.play(); saveState(); });
  document.addEventListener("settings:changed", () => { render.settings(); saveState(); });

  // ------- フォーム収集/表示 -------
  function collectForm(){
    /** @type {Question} */
    const q = {
      id: $("#q-id").value || "",
      category: $("#q-category").value.trim(),
      difficulty: /** @type any */ ($("#q-difficulty").value || "normal"),
      text: $("#q-text").value.trim(),
      choices: [$("#q-c0").value, $("#q-c1").value, $("#q-c2").value, $("#q-c3").value].map(v=>v.trim()),
      answerIndex: /** @type any */ (parseInt($("#q-answer").value,10) || 0),
      tags: $("#q-tags").value.split(",").map(s=>s.trim()).filter(Boolean)
    };
    return q;
  }
  function fillForm(q){
    const blank = !q;
    $("#q-id").value = blank ? "" : q.id;
    $("#q-category").value = blank ? "" : q.category;
    $("#q-difficulty").value = blank ? "normal" : q.difficulty;
    $("#q-text").value = blank ? "" : q.text;
    $("#q-c0").value = blank ? "" : q.choices[0];
    $("#q-c1").value = blank ? "" : q.choices[1];
    $("#q-c2").value = blank ? "" : q.choices[2];
    $("#q-c3").value = blank ? "" : q.choices[3];
    $("#q-answer").value = String(blank ? 0 : q.answerIndex);
    $("#q-tags").value = blank ? "" : q.tags.join(", ");
  }

  // ------- 検証/整形 -------
  function validateQuestion(q){
    const errors = [];
    if (!q.category) errors.push("カテゴリが空");
    if (!q.text) errors.push("問題文が空");
    if (!Array.isArray(q.choices) || q.choices.length !== 4) errors.push("選択肢は4つ必要");
    if (q.choices.some(c => !c)) errors.push("空の選択肢があります");
    if (![0,1,2,3].includes(/** @type any */ (q.answerIndex))) errors.push("answerIndexが不正");
    const uniq = new Set(q.choices.map(s=>s.toLowerCase()));
    if (uniq.size !== 4) errors.push("選択肢が重複しています");
    if (!["easy","normal","hard"].includes(q.difficulty)) errors.push("難易度が不正");
    return errors;
  }
  function coerceQuestion(x){
    const q = {
      id: typeof x.id==="string" ? x.id : "",
      category: String(x.category ?? ""),
      difficulty: ["easy","normal","hard"].includes(x.difficulty) ? x.difficulty : "normal",
      text: String(x.text ?? ""),
      choices: Array.isArray(x.choices) ? [0,1,2,3].map(i => String(x.choices[i] ?? "")) : ["","","",""],
      answerIndex: [0,1,2,3].includes(x.answerIndex) ? x.answerIndex : 0,
      tags: Array.isArray(x.tags) ? x.tags.map(String) : []
    };
    return /** @type {Question} */ (q);
  }
  function genSafeId(){
    let i=0, id="";
    do { id = uid(); i++; } while (state.bank.some(q=>q.id===id) && i<5);
    return id;
  }

  // ------- プレイ処理 -------
  function onAnswer(){
    const picked = $("input[name='choice']:checked");
    if (!picked) { alert("選択してください"); return; }
    const choiceIdx = parseInt(picked.value,10);
    const i = state.play.index;
    const q = state.quiz[i];
    const correctChoice = state.play.shuffledChoices.findIndex(c => c.idx === q.answerIndex);
    const correct = choiceIdx === correctChoice;
    if (correct) state.play.correct++;

    // 結果表示
    const radios = $$("input[name='choice']");
    radios.forEach((r, idx) => {
      const label = r.closest("label");
      if (!label) return;
      if (idx === correctChoice) label.style.outline = "2px solid #10b981"; // green
      if (idx === choiceIdx && !correct) label.style.outline = "2px solid #ef4444"; // red
    });

    $("#btn-answer").hidden = true;
    $("#btn-next").hidden = false;
  }
  function nextQuestion(){
    state.play.index++;
    render.play();
  }

  // ------- 小道具 -------
  function shuffleArray(arr){
    const a = arr.slice();
    for(let i=a.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i],a[j]] = [a[j],a[i]];
    }
    return a;
  }
  function pickRandom(arr, n){
    const a = shuffleArray(arr); return a.slice(0, Math.min(arr.length, n));
  }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
  }
  function updateStorageStatus(text){
    const el = $("#storage-status");
    if(!el) return;
    const now = new Date();
    el.value = text ? `${text} (${now.toLocaleTimeString()})` : "";
  }
  function applyTheme(){
    const root = document.documentElement;
    const t = state.settings.theme;
    if (t === "auto") { root.removeAttribute("data-theme"); }
    else { root.setAttribute("data-theme", t); }
  }

  // ------- 初期化 -------
  function seed(){
    if (state.bank.length) return;
    state.bank = [
      { id: genSafeId(), category:"一般", difficulty:"easy", text:"富士山の標高に最も近いのは？", choices:["3,776m","2,776m","4,176m","3,176m"], answerIndex:0, tags:["地理"] },
      { id: genSafeId(), category:"一般", difficulty:"normal", text:"水の化学式は？", choices:["H2O","CO2","O2","NaCl"], answerIndex:0, tags:["理科"] },
      { id: genSafeId(), category:"IT", difficulty:"normal", text:"HTMLで最も適切な見出しタグは？", choices:["<h1>","<div>","<p>","<span>"], answerIndex:0, tags:["IT"] }
    ];
  }

  function bindTabs(){
    tabs.forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
  }

  function boot(){
    loadState();
    seed();
    bindTabs();
    // 最初のタブ
    switchTab("bank");
  }

  window.addEventListener("DOMContentLoaded", boot);
})();
