(() => {
  "use strict";

  const STORAGE_KEY = "growth-material-calculator.v1";
  const MIN_TIERS = 2;
  const MAX_TIERS = 6;
  const MAX_VALUE = 999999;
  const MAX_RATE = 999;

  const TIER_COLORS = {
    2: ["#8d97ab", "#e7c27d"],
    3: ["#8d97ab", "#6fa8ff", "#e7c27d"],
    4: ["#8d97ab", "#6fa8ff", "#b18cff", "#e7c27d"],
    5: ["#8d97ab", "#6fd3c0", "#6fa8ff", "#b18cff", "#e7c27d"],
    6: ["#8d97ab", "#6fd3c0", "#6fa8ff", "#b18cff", "#ff9fb2", "#e7c27d"],
  };
  const TIER_NAMES = ["低", "中", "高", "最高", "極", "超"];

  const fmt = new Intl.NumberFormat("ja-JP");

  const els = {
    groups: document.getElementById("groups"),
    addGroupBtn: document.getElementById("addGroupBtn"),
    settingsBtn: document.getElementById("settingsBtn"),
    resetBtn: document.getElementById("resetBtn"),
    dialog: document.getElementById("settingsDialog"),
    settingsForm: document.getElementById("settingsForm"),
    closeSettingsBtn: document.getElementById("closeSettingsBtn"),
    cancelSettingsBtn: document.getElementById("cancelSettingsBtn"),
    addTierBtn: document.getElementById("addTierBtn"),
    tierEditor: document.getElementById("tierEditor"),
    presets: document.getElementById("presets"),
    ratePreview: document.getElementById("ratePreview"),
    toast: document.getElementById("toast"),
  };

  let state = loadState();
  let draftTiers = [];
  let saveTimer = 0;
  let toastTimer = 0;
  const cardMap = new Map();

  init();

  function init() {
    els.addGroupBtn.addEventListener("click", addGroup);
    els.settingsBtn.addEventListener("click", openSettings);
    els.resetBtn.addEventListener("click", resetAll);

    els.settingsForm.addEventListener("submit", saveSettings);
    els.closeSettingsBtn.addEventListener("click", closeSettings);
    els.cancelSettingsBtn.addEventListener("click", closeSettings);
    els.addTierBtn.addEventListener("click", addDraftTier);
    els.presets.addEventListener("click", onPresetClick);
    els.dialog.addEventListener("click", (event) => {
      if (event.target === els.dialog) closeSettings();
    });

    window.addEventListener("pagehide", flushSave);

    render();
  }

  /* ---------- State ---------- */

  function createDefaultState() {
    return {
      tiers: [
        { name: "低", rate: 3 },
        { name: "中", rate: 5 },
        { name: "高", rate: 3 },
        { name: "最高", rate: 3 },
      ],
      groups: [
        {
          id: uid(),
          name: "サンプル：キャラクター突破素材",
          need: [10, 6, 3, 1],
          owned: [30, 15, 2, 0],
        },
      ],
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultState();
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      console.warn("保存データを読み込めませんでした。", error);
      return createDefaultState();
    }
  }

  function normalizeState(raw) {
    if (!raw || !Array.isArray(raw.tiers) || raw.tiers.length < MIN_TIERS) {
      return createDefaultState();
    }

    const tiers = raw.tiers.slice(0, MAX_TIERS).map((tier, index) => ({
      name:
        (typeof tier?.name === "string" ? tier.name.trim() : "") ||
        TIER_NAMES[index] ||
        `段階${index + 1}`,
      rate: clampInt(tier?.rate, 1, MAX_RATE, 3),
    }));
    if (tiers.length < MIN_TIERS) return createDefaultState();
    tiers[tiers.length - 1].rate = 3;

    const seenIds = new Set();
    const groups = (Array.isArray(raw.groups) ? raw.groups : []).map((group, index) => {
      let id =
        typeof group?.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(group.id)
          ? group.id
          : uid();
      if (seenIds.has(id)) id = uid();
      seenIds.add(id);

      return {
        id,
        name:
          typeof group?.name === "string" && group.name.trim()
            ? group.name.trim().slice(0, 40)
            : `素材 ${index + 1}`,
        need: resizeList(group?.need, tiers.length),
        owned: resizeList(group?.owned, tiers.length),
      };
    });

    return { tiers, groups };
  }

  function resizeList(list, length) {
    const source = Array.isArray(list) ? list : [];
    return Array.from({ length }, (_, index) =>
      clampInt(source[index], 0, MAX_VALUE, 0),
    );
  }

  function saveNow() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("保存できませんでした。", error);
    }
  }

  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveNow, 300);
  }

  function flushSave() {
    window.clearTimeout(saveTimer);
    saveNow();
  }

  /* ---------- Calculation ---------- */

  /**
   * 上位段階の不足分を、合成に必要な数として下位段階へ展開する。
   * 戻り値の short[0] が「最下段素材であと何個必要か」になる。
   */
  function calculate(group) {
    const count = state.tiers.length;
    const required = new Array(count).fill(0);
    const short = new Array(count).fill(0);
    const surplus = new Array(count).fill(0);
    let carry = 0;

    for (let index = count - 1; index >= 0; index -= 1) {
      const needed = (group.need[index] || 0) + carry;
      const owned = group.owned[index] || 0;

      required[index] = needed;
      short[index] = Math.max(0, needed - owned);
      surplus[index] = Math.max(0, owned - needed);

      carry =
        index > 0
          ? short[index] * (state.tiers[index - 1].rate || 1)
          : 0;
    }

    return { required, short, surplus, base: short[0] || 0 };
  }

  /* ---------- Rendering ---------- */

  function render() {
    cardMap.clear();
    els.groups.replaceChildren();

    if (state.groups.length === 0) {
      const empty = el("div", "empty-state");
      const glyph = el("div", "empty-glyph");
      glyph.textContent = "◇";
      const title = document.createElement("p");
      title.textContent = "素材グループがまだありません";
      const hint = document.createElement("span");
      hint.textContent = "下のボタンから追加してください";
      empty.append(glyph, title, hint);
      els.groups.appendChild(empty);
    } else {
      state.groups.forEach((group, index) => {
        const card = createCard(group, index);
        cardMap.set(group.id, card);
        els.groups.appendChild(card.root);
      });
    }

    state.groups.forEach(updateGroup);
  }

  function createCard(group, index) {
    const root = el("article", "group-card");

    const head = el("div", "group-head");
    const titleWrap = el("div", "group-title");
    const number = el("span", "group-number");
    number.textContent = String(index + 1).padStart(2, "0");

    const nameInput = el("input", "group-name");
    nameInput.type = "text";
    nameInput.value = group.name;
    nameInput.maxLength = 40;
    nameInput.placeholder = "素材グループ名";
    nameInput.setAttribute("aria-label", "素材グループ名");
    nameInput.addEventListener("input", () => {
      group.name = nameInput.value;
      scheduleSave();
    });
    nameInput.addEventListener("blur", () => {
      if (!nameInput.value.trim()) {
        group.name = "素材";
        nameInput.value = "素材";
        scheduleSave();
      }
    });

    titleWrap.append(number, nameInput);

    const actions = el("div", "group-actions");
    const copyBtn = textButton("コピー", "link-btn");
    copyBtn.addEventListener("click", () => copyResult(group));
    const clearBtn = textButton("クリア", "link-btn");
    clearBtn.addEventListener("click", () => clearGroup(group));
    const deleteBtn = textButton("削除", "link-btn danger");
    deleteBtn.addEventListener("click", () => deleteGroup(group));
    actions.append(copyBtn, clearBtn, deleteBtn);

    head.append(titleWrap, actions);

    const table = el("div", "tier-table");
    const tableHead = el("div", "tier-head");
    ["段階", "必要数", "所持数", "不足"].forEach((label) => {
      const cell = el("span");
      cell.textContent = label;
      tableHead.appendChild(cell);
    });
    table.appendChild(tableHead);

    const shortRefs = [];
    state.tiers.forEach((tier, tierIndex) => {
      const row = el("div", "tier-row");
      row.style.setProperty("--tier-color", tierColor(tierIndex));

      const tierCell = el("div", "tier-cell");
      const pill = el("span", "tier-pill");
      const dot = el("span", "tier-dot");
      const tierName = el("span", "tier-name");
      tierName.textContent = tier.name;
      pill.append(dot, tierName);
      tierCell.appendChild(pill);

      const needCell = inputCell("必要数", "need-cell");
      const needInput = makeNumberInput(
        group.need[tierIndex],
        `${tier.name}の必要数`,
      );
      bindNumberInput(needInput, group, "need", tierIndex);
      needCell.appendChild(needInput);

      const ownedCell = inputCell("所持数", "owned-cell");
      const ownedInput = makeNumberInput(
        group.owned[tierIndex],
        `${tier.name}の所持数`,
      );
      bindNumberInput(ownedInput, group, "owned", tierIndex);
      ownedCell.appendChild(ownedInput);

      const shortCell = el("div", "short-cell");
      const shortLabel = el("span", "cell-label");
      shortLabel.textContent = "不足";
      const shortValue = el("span", "short-value");
      const surplus = el("span", "surplus");
      shortCell.append(shortLabel, shortValue, surplus);

      row.append(tierCell, needCell, ownedCell, shortCell);
      table.appendChild(row);
      shortRefs.push({ shortValue, surplus });
    });

    const result = el("div", "group-result");
    const resultMain = el("div", "result-main");
    const resultLabel = el("span", "result-label");
    const resultValue = el("div", "result-value");
    const resultNum = el("span", "result-num");
    const resultUnit = el("span", "result-unit");
    resultUnit.textContent = "個";
    resultValue.append(resultNum, resultUnit);
    resultMain.append(resultLabel, resultValue);

    const resultSide = el("div", "result-side");
    const resultSideLabel = el("span", "result-label");
    resultSideLabel.textContent = "段階別の不足";
    const chips = el("div", "result-chips");
    resultSide.append(resultSideLabel, chips);

    result.append(resultMain, resultSide);

    root.append(head, table, result, buildChainNote());

    return {
      root,
      shortRefs,
      resultLabel,
      resultNum,
      resultUnit,
      resultSide,
      chips,
    };
  }

  function updateGroup(group) {
    const card = cardMap.get(group.id);
    if (!card) return;

    const calc = calculate(group);
    const hasNeed = group.need.some((value) => value > 0);
    const baseName = state.tiers[0]?.name || "低";

    card.shortRefs.forEach((refs, index) => {
      const { shortValue, surplus } = refs;
      shortValue.className = "short-value";
      surplus.textContent = "";
      surplus.title = "";

      const required = calc.required[index];
      const owned = group.owned[index] || 0;
      const carryIn = required - (group.need[index] || 0);

      if (!hasNeed || (required === 0 && owned === 0)) {
        shortValue.textContent = "—";
        shortValue.classList.add("is-empty");
        return;
      }

      shortValue.textContent = fmt.format(calc.short[index]);

      if (calc.short[index] > 0) {
        if (carryIn > 0) {
          surplus.textContent = `合成用 +${fmt.format(carryIn)}`;
          surplus.title = "上位段階の不足を合成するために追加で必要な数";
        }
      } else {
        shortValue.classList.add("is-zero");
        if (calc.surplus[index] > 0) {
          surplus.textContent = `余剰 ${fmt.format(calc.surplus[index])}`;
          surplus.title = "使い道がなく余っている数（下位素材には変換できません）";
        }
      }
    });

    card.resultNum.classList.remove("is-zero", "is-empty");
    card.resultUnit.hidden = false;
    card.resultSide.hidden = false;

    if (!hasNeed) {
      card.resultLabel.textContent = "必要数を入力してください";
      card.resultNum.textContent = "—";
      card.resultNum.classList.add("is-empty");
      card.resultUnit.hidden = true;
      card.resultSide.hidden = true;
      setChipsMessage(card, "");
      return;
    }

    if (calc.base === 0) {
      card.resultLabel.textContent = `最下段「${baseName}」素材は足りています`;
      card.resultNum.textContent = "0";
      card.resultNum.classList.add("is-zero");
      setChipsMessage(card, "不足なし");
      return;
    }

    card.resultLabel.textContent = `最下段「${baseName}」素材であと`;
    card.resultNum.textContent = fmt.format(calc.base);
    card.chips.replaceChildren();

    for (let index = state.tiers.length - 1; index >= 0; index -= 1) {
      if (calc.short[index] <= 0) continue;

      const chip = el("span", "result-chip");
      chip.style.setProperty("--tier-color", tierColor(index));
      const dot = el("span", "dot");
      const name = el("span");
      name.textContent = state.tiers[index].name;
      const value = el("b");
      value.textContent = fmt.format(calc.short[index]);
      chip.append(dot, name, value);
      card.chips.appendChild(chip);
    }
  }

  function setChipsMessage(card, message) {
    card.chips.replaceChildren();
    if (!message) return;
    const text = el("span", "all-ok");
    text.textContent = message;
    card.chips.appendChild(text);
  }

  function buildChainNote() {
    const note = el("div", "group-note");
    const chain = el("span");
    chain.textContent = `合成: ${state.tiers
      .slice(0, -1)
      .map(
        (tier, index) =>
          `${tier.name} ×${tier.rate} → ${state.tiers[index + 1].name}`,
      )
      .join(" / ")}`;
    note.appendChild(chain);

    const total = state.tiers
      .slice(0, -1)
      .reduce((product, tier) => product * (tier.rate || 1), 1);

    if (state.tiers.length > 1 && total > 1) {
      const separator = el("span", "note-sep");
      separator.textContent = "·";
      const conversion = el("span");
      conversion.textContent = `1 ${state.tiers[state.tiers.length - 1].name} = ${fmt.format(total)} ${state.tiers[0].name}`;
      note.append(separator, conversion);
    }

    return note;
  }

  /* ---------- Group actions ---------- */

  function clearGroup(group) {
    group.need = group.need.map(() => 0);
    group.owned = group.owned.map(() => 0);
    saveNow();
    render();
    toast("数値をクリアしました");
  }

  function deleteGroup(group) {
    const label = group.name.trim() || "素材グループ";
    if (!window.confirm(`「${label}」を削除しますか？`)) return;
    state.groups = state.groups.filter((item) => item.id !== group.id);
    saveNow();
    render();
    toast("素材グループを削除しました");
  }

  function addGroup() {
    const group = {
      id: uid(),
      name: "新しい素材",
      need: state.tiers.map(() => 0),
      owned: state.tiers.map(() => 0),
    };
    state.groups.push(group);
    saveNow();
    render();

    const card = cardMap.get(group.id);
    const input = card?.root.querySelector(".group-name");
    if (input) {
      input.focus();
      input.select();
      card.root.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function copyResult(group) {
    if (!group.need.some((value) => value > 0)) {
      toast("必要数を入力してください");
      return;
    }

    const calc = calculate(group);
    const lines = [`【${group.name.trim() || "素材"}】`];

    state.tiers.forEach((tier, index) => {
      lines.push(
        `${tier.name}: 不足 ${fmt.format(calc.short[index])}個（必要 ${fmt.format(group.need[index])} / 所持 ${fmt.format(group.owned[index])}）`,
      );
    });

    lines.push(
      `最下段（${state.tiers[0].name}）換算: ${fmt.format(calc.base)}個`,
    );

    const text = lines.join("\n");

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(text)
        .then(() => toast("結果をコピーしました"))
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();

    try {
      const ok = document.execCommand("copy");
      toast(ok ? "結果をコピーしました" : "コピーに失敗しました");
    } catch {
      toast("コピーに失敗しました");
    }

    area.remove();
  }

  function resetAll() {
    if (!window.confirm("入力内容と設定を初期状態に戻しますか？")) return;
    state = createDefaultState();
    saveNow();
    render();
    toast("初期状態に戻しました");
  }

  /* ---------- Settings ---------- */

  function openSettings() {
    draftTiers = state.tiers.map((tier) => ({ ...tier }));
    renderTierEditor();
    if (!els.dialog.open) els.dialog.showModal();
    window.requestAnimationFrame(() => {
      const firstInput = els.tierEditor.querySelector(".tier-name-input");
      if (firstInput) firstInput.focus();
    });
  }

  function closeSettings() {
    if (els.dialog.open) els.dialog.close();
  }

  function renderTierEditor() {
    els.tierEditor.replaceChildren();

    draftTiers.forEach((tier, index) => {
      const row = el("div", "tier-edit-row");
      row.style.setProperty("--tier-color", tierColor(index, draftTiers.length));

      const rowNumber = el("span", "tier-edit-index");
      rowNumber.textContent = String(index + 1).padStart(2, "0");

      const nameInput = el("input", "text-input tier-name-input");
      nameInput.type = "text";
      nameInput.maxLength = 12;
      nameInput.value = tier.name;
      nameInput.setAttribute("aria-label", `段階${index + 1}の名前`);
      nameInput.addEventListener("input", () => {
        tier.name = nameInput.value;
        updateRatePreview();
      });

      const rateCell = el("div", "tier-rate-cell");

      if (index < draftTiers.length - 1) {
        const rateInput = el("input", "text-input rate-input");
        rateInput.type = "number";
        rateInput.min = "1";
        rateInput.max = String(MAX_RATE);
        rateInput.step = "1";
        rateInput.inputMode = "numeric";
        rateInput.value = String(tier.rate ?? 3);
        rateInput.setAttribute(
          "aria-label",
          `${tier.name || `段階${index + 1}`}が何個で1つ上になるか`,
        );
        rateInput.addEventListener("input", () => {
          tier.rate = rateInput.value;
          updateRatePreview();
        });
        rateInput.addEventListener("blur", () => {
          tier.rate = clampInt(rateInput.value, 1, MAX_RATE, 3);
          rateInput.value = String(tier.rate);
          updateRatePreview();
        });

        const suffix = el("span", "rate-suffix");
        suffix.textContent = "個 → 上へ";
        rateCell.append(rateInput, suffix);
      } else {
        const topTag = el("span", "top-tag");
        topTag.textContent = "最上位";
        rateCell.appendChild(topTag);
      }

      const removeBtn = el("button", "remove-tier");
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.title = "この段階を削除";
      removeBtn.setAttribute("aria-label", `${tier.name || `段階${index + 1}`}を削除`);
      removeBtn.disabled = draftTiers.length <= MIN_TIERS;
      removeBtn.addEventListener("click", () => {
        if (draftTiers.length <= MIN_TIERS) return;
        draftTiers.splice(index, 1);
        renderTierEditor();
      });

      row.append(rowNumber, nameInput, rateCell, removeBtn);
      els.tierEditor.appendChild(row);
    });

    updateRatePreview();
  }

  function updateRatePreview() {
    const parts = draftTiers.map((tier, index) => {
      const name = tier.name.trim() || `段階${index + 1}`;
      if (index >= draftTiers.length - 1) return name;
      const rate = clampInt(tier.rate, 1, MAX_RATE, 3);
      return `${name} ×${rate} →`;
    });
    els.ratePreview.textContent = parts.join("  ");
  }

  function addDraftTier() {
    if (draftTiers.length >= MAX_TIERS) {
      toast(`段階は最大${MAX_TIERS}個までです`);
      return;
    }

    const nextIndex = draftTiers.length;
    draftTiers.push({
      name: TIER_NAMES[nextIndex] || `段階${nextIndex + 1}`,
      rate: 3,
    });
    renderTierEditor();

    const rows = els.tierEditor.querySelectorAll(".tier-edit-row");
    const lastRow = rows[rows.length - 1];
    const nameInput = lastRow?.querySelector(".tier-name-input");
    if (nameInput) {
      nameInput.focus();
      nameInput.select();
    }
  }

  function onPresetClick(event) {
    const button = event.target.closest("button[data-preset]");
    if (!button) return;

    const [countText, ratesText] = button.dataset.preset.split("-");
    const count = Number(countText);
    if (!Number.isInteger(count) || count < MIN_TIERS || count > MAX_TIERS) {
      return;
    }

    const rates = String(ratesText)
      .split("")
      .map((value) => Number(value));
    draftTiers = Array.from({ length: count }, (_, index) => ({
      name: TIER_NAMES[index] || `段階${index + 1}`,
      rate:
        index < count - 1
          ? Math.min(MAX_RATE, Math.max(1, rates[index] || 3))
          : 3,
    }));

    renderTierEditor();
  }

  function saveSettings(event) {
    event.preventDefault();

    const rows = Array.from(
      els.tierEditor.querySelectorAll(".tier-edit-row"),
    );

    if (rows.length < MIN_TIERS) {
      toast(`段階は${MIN_TIERS}個以上必要です`);
      return;
    }

    const tiers = rows.map((row, index) => {
      const nameInput = row.querySelector(".tier-name-input");
      const rateInput = row.querySelector(".rate-input");
      const name =
        (nameInput?.value || "").trim().slice(0, 12) || `段階${index + 1}`;
      const rate = rateInput
        ? clampInt(rateInput.value, 1, MAX_RATE, 3)
        : 3;
      return { name, rate };
    });

    tiers[tiers.length - 1].rate = 3;
    state.tiers = tiers;
    state.groups.forEach((group) => {
      group.need = resizeList(group.need, tiers.length);
      group.owned = resizeList(group.owned, tiers.length);
    });

    saveNow();
    closeSettings();
    render();
    toast("段階設定を保存しました");
  }

  /* ---------- Helpers ---------- */

  function makeNumberInput(value, ariaLabel) {
    const input = el("input", "num-input");
    input.type = "number";
    input.min = "0";
    input.max = String(MAX_VALUE);
    input.step = "1";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.value = String(value ?? 0);
    input.setAttribute("aria-label", ariaLabel);
    return input;
  }

  function bindNumberInput(input, group, kind, index) {
    input.addEventListener("input", () => {
      group[kind][index] = clampInt(input.value, 0, MAX_VALUE, 0);
      scheduleSave();
      updateGroup(group);
    });

    input.addEventListener("blur", () => {
      input.value = String(group[kind][index]);
    });

    input.addEventListener("focus", () => {
      input.select();
    });
  }

  function inputCell(label, extraClass) {
    const cell = el("label", `input-cell ${extraClass}`);
    const text = el("span", "cell-label");
    text.textContent = label;
    cell.appendChild(text);
    return cell;
  }

  function textButton(label, className) {
    const button = el("button", className);
    button.type = "button";
    button.textContent = label;
    return button;
  }

  function tierColor(index, count = state.tiers.length) {
    const palette = TIER_COLORS[count] || TIER_COLORS[4];
    return palette[index] || palette[palette.length - 1] || "#8d97ab";
  }

  function clampInt(value, min, max, fallback = 0) {
    if (value === "" || value === null || value === undefined) return fallback;
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function uid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function el(tagName, className) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    return node;
  }

  function toast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = window.setTimeout(() => {
      els.toast.classList.remove("show");
    }, 2200);
  }
})();
