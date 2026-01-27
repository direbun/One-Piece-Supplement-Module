/* one-piece-supplement-module | scripts/main.js */
const MODULE_ID = "one-piece-supplement-module";

// Exchange rates in "belly per unit"
const BELLY_PER = { cp: 100, sp: 1000, ep: 5000, gp: 10000, pp: 100000 };
const BELLY_PER_GP = 10000;

function ensureOnePieceStyles() {
  const id = "onepiece-supplement-inline-styles";
  if (document.getElementById(id)) return;

  const css = `
.onepiece-op-root{margin:6px 6px 8px;display:flex;flex-direction:column;gap:8px}
.onepiece-op-root,.onepiece-op-root *{pointer-events:auto}

.onepiece-op-card{
  border-radius:12px;
  padding:10px 10px 9px;
  border:1px solid rgba(255,255,255,.14);
  background:linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.02));
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.35), 0 1px 0 rgba(0,0,0,.35);
}

.onepiece-op-head{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  margin-bottom:6px;
}
.onepiece-op-title{
  display:flex;align-items:center;gap:8px;
  font-size:11px;font-weight:800;letter-spacing:.6px;
  text-transform:uppercase;opacity:.9;
}
.onepiece-op-title i{opacity:.9}

.onepiece-op-btnrow{display:flex;align-items:center;gap:6px}

.onepiece-op-iconbtn{
  width:26px;height:26px;border-radius:8px;
  border:1px solid rgba(255,255,255,.14);
  background:rgba(0,0,0,.18);
  display:inline-flex;align-items:center;justify-content:center;
  cursor:pointer;
}
.onepiece-op-iconbtn i{font-size:13px;opacity:.95}

.onepiece-op-value{
  font-size:26px;font-weight:900;line-height:1.05;
  letter-spacing:.2px;
}
.onepiece-op-sub{
  margin-top:4px;
  font-size:11px;opacity:.75;
}

/* Belly “bank bar” (neutral) */
.onepiece-op-bankbar{
  margin-top:7px;
  height:12px;border-radius:999px;overflow:hidden;
  border:1px solid rgba(255,255,255,.14);
  background:rgba(0,0,0,.25);
}
.onepiece-op-bankfill{
  height:100%;
  background:linear-gradient(90deg, rgba(255,255,255,.22), rgba(255,255,255,.10));
}

.tidy5e-sheet .onepiece-op-card{padding:9px 9px 8px}
`;

  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

function isCharacterActor(actor) {
  return !!actor && actor.type === "character";
}
function getActorFromSheetApp(appOrSheet) {
  return appOrSheet?.actor ?? appOrSheet?.document ?? null;
}
function shouldRunForSheet(appOrSheet) {
  const actor = getActorFromSheetApp(appOrSheet);
  if (!isCharacterActor(actor)) return false;
  if (!actor.testUserPermission(game.user, "OBSERVER")) return false;
  return true;
}

Hooks.once("ready", () => ensureOnePieceStyles());

Hooks.once("init", () => {
  if (game.system.id !== "dnd5e") return;

  // Visual-only cap for Belly bar fill
  try {
    game.settings.register(MODULE_ID, "bellyCap", {
      name: "Belly Bar Cap",
      hint: "Visual-only: the Belly bar appears full at this amount.",
      scope: "world",
      config: true,
      type: Number,
      default: 1000000
    });
  } catch (_) {}

  // Which dnd5e Resource slot is used for Hybrid Points (for Activity Consumption)
  // Default: tertiary (least likely to clash)
  try {
    game.settings.register(MODULE_ID, "hybridResourceSlot", {
      name: "Hybrid Points Resource Slot",
      hint:
        "Hybrid Points will sync into this dnd5e Resource slot so Activities can consume them (Consumption → Type: Resource).",
      scope: "world",
      config: true,
      type: String,
      choices: {
        primary: "Primary Resource",
        secondary: "Secondary Resource",
        tertiary: "Tertiary Resource"
      },
      default: "tertiary"
    });
  } catch (_) {}

  // Roll data injection for formulas:
  // @willpower.level / @willpower.bonus / @willpower.total
  // @hybrid.points.value / @hybrid.points.max
  // (legacy alias) @willpower.charges.value / @willpower.charges.max
  const ActorCls = CONFIG.Actor?.documentClass;
  if (!ActorCls?.prototype?.getRollData) return;

  if (ActorCls.prototype.__onepieceWillpowerWrapped) return;
  ActorCls.prototype.__onepieceWillpowerWrapped = true;

  const original = ActorCls.prototype.getRollData;
  ActorCls.prototype.getRollData = function () {
    const data = original.call(this);
    if (this?.type !== "character") return data;

    const level = getTotalLevel(this);
    const bonus = getWillpowerBonus(this);
    data.willpower = { level, bonus, total: level + bonus };

    if (isHybrid(this)) {
      const max = getHybridPointsMax(this);
      const value = Math.max(0, Math.min(max, getHybridPoints(this)));

      data.hybrid = data.hybrid ?? {};
      data.hybrid.points = { value, max };

      // Legacy alias (old name)
      data.willpower = data.willpower ?? {};
      data.willpower.charges = { value, max };
    }

    return data;
  };
});

function getTotalLevel(actor) {
  const direct = foundry.utils.getProperty(actor, "system.details.level");
  if (Number.isFinite(direct)) return direct;

  const value = foundry.utils.getProperty(actor, "system.details.level.value");
  if (Number.isFinite(value)) return value;

  const classes = foundry.utils.getProperty(actor, "system.classes") ?? {};
  const sum = Object.values(classes).reduce((acc, c) => {
    const lv = c?.levels ?? c?.system?.levels ?? c?.level ?? 0;
    return acc + (Number(lv) || 0);
  }, 0);

  return Number(sum) || 0;
}

function getWillpowerBonus(actor) {
  return Number(actor.getFlag(MODULE_ID, "willpowerBonus") ?? 0) || 0;
}
function getWillpower(actor) {
  return getTotalLevel(actor) + getWillpowerBonus(actor);
}

function isHybrid(actor) {
  if (!actor) return false;

  // Fast path: Midi-QOL exposes identifiedItems map
  try {
    if (actor.identifiedItems?.has?.("hybrid")) return true;
  } catch (_) {}

  // Check class items by name
  try {
    const classes = actor.items?.filter?.((i) => i.type === "class") ?? [];
    if (classes.some((c) => String(c.name ?? "").toLowerCase() === "hybrid")) return true;
  } catch (_) {}

  // Fallback: dnd5e system.classes entries
  try {
    const classesObj = foundry.utils.getProperty(actor, "system.classes") ?? {};
    if (Object.values(classesObj).some((c) => String(c?.name ?? "").toLowerCase() === "hybrid")) return true;
  } catch (_) {}

  return false;
}

// Stored on actor flag: flags.one-piece-supplement-module.hybridCharges
function getHybridPoints(actor) {
  return Number(actor.getFlag(MODULE_ID, "hybridCharges") ?? 0) || 0;
}

async function setHybridPoints(actor, value) {
  const max = getHybridPointsMax(actor);
  const next = Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));
  await actor.setFlag(MODULE_ID, "hybridCharges", next);
  await syncHybridPointsResource(actor); // keep resource in sync for Activity Consumption
}

function getHybridPointsMax(actor) {
  const lvl = getTotalLevel(actor);
  if (lvl <= 1) return 2;
  if (lvl <= 3) return 3;
  if (lvl <= 5) return 4;
  if (lvl <= 7) return 5;
  if (lvl <= 9) return 6;
  if (lvl <= 11) return 7;
  if (lvl <= 13) return 8;
  if (lvl <= 15) return 9;
  return 10;
}

function getChargesFillPct(current, max) {
  const m = Math.max(1, Number(max) || 1);
  const c = Math.max(0, Math.min(m, Number(current) || 0));
  return Math.max(0, Math.min(100, (c / m) * 100));
}

function getHybridResourceSlot() {
  try {
    const slot = String(game.settings.get(MODULE_ID, "hybridResourceSlot") || "tertiary");
    if (slot === "primary" || slot === "secondary" || slot === "tertiary") return slot;
  } catch (_) {}
  return "tertiary";
}

async function syncHybridPointsResource(actor) {
  try {
    if (!isCharacterActor(actor) || !isHybrid(actor)) return;

    const slot = getHybridResourceSlot();
    const max = getHybridPointsMax(actor);
    const value = Math.max(0, Math.min(max, getHybridPoints(actor)));

    // Avoid unnecessary updates
    const cur = foundry.utils.getProperty(actor, `system.resources.${slot}`) ?? {};
    const curLabel = String(cur.label ?? "");
    const curMax = Number(cur.max ?? 0) || 0;
    const curVal = Number(cur.value ?? 0) || 0;

    if (curLabel === "Hybrid Points" && curMax === max && curVal === value) return;

    await actor.update({
      [`system.resources.${slot}.label`]: "Hybrid Points",
      [`system.resources.${slot}.max`]: max,
      [`system.resources.${slot}.value`]: value
    });
  } catch (e) {
    console.warn(`${MODULE_ID} | syncHybridPointsResource failed`, e);
  }
}

Hooks.on("preUpdateActor", (actor, update) => {
  try {
    if (game.system.id !== "dnd5e") return;
    if (!isCharacterActor(actor) || !isHybrid(actor)) return;

    const slot = getHybridResourceSlot();

    const vPath = `system.resources.${slot}.value`;
    const newValRaw = foundry.utils.getProperty(update, vPath);
    if (newValRaw === undefined) return;

    const max = getHybridPointsMax(actor);
    const newVal = Math.max(0, Math.min(max, Math.floor(Number(newValRaw) || 0)));

    // Keep the canonical flag updated in the SAME update payload
    foundry.utils.setProperty(update, `flags.${MODULE_ID}.hybridCharges`, newVal);

    // Ensure label/max consistency unless caller is already setting them
    const labelPath = `system.resources.${slot}.label`;
    const maxPath = `system.resources.${slot}.max`;

    if (foundry.utils.getProperty(update, labelPath) === undefined) {
      foundry.utils.setProperty(update, labelPath, "Hybrid Points");
    }
    if (foundry.utils.getProperty(update, maxPath) === undefined) {
      foundry.utils.setProperty(update, maxPath, max);
    }
  } catch (e) {
    console.warn(`${MODULE_ID} | preUpdateActor hybrid sync failed`, e);
  }
});

function getBelly(actor) {
  return Number(actor.getFlag(MODULE_ID, "belly") ?? 0) || 0;
}
async function addBelly(actor, deltaBelly) {
  const cur = getBelly(actor);
  const next = Math.max(0, Math.floor(cur + (Number(deltaBelly) || 0)));
  await actor.setFlag(MODULE_ID, "belly", next);
}

function getActorCurrency(actor) {
  const cur = actor.system?.currency ?? {};
  return {
    pp: Number(cur.pp ?? 0) || 0,
    gp: Number(cur.gp ?? 0) || 0,
    ep: Number(cur.ep ?? 0) || 0,
    sp: Number(cur.sp ?? 0) || 0,
    cp: Number(cur.cp ?? 0) || 0
  };
}

function coinsToBellyValue({ pp, gp, ep, sp, cp }) {
  return pp * BELLY_PER.pp + gp * BELLY_PER.gp + ep * BELLY_PER.ep + sp * BELLY_PER.sp + cp * BELLY_PER.cp;
}

function bellyToCoinsBreakdown(bellyAmount) {
  let remaining = Math.max(0, Number(bellyAmount) || 0);

  const pp = Math.floor(remaining / BELLY_PER.pp); remaining -= pp * BELLY_PER.pp;
  const gp = Math.floor(remaining / BELLY_PER.gp); remaining -= gp * BELLY_PER.gp;
  const ep = Math.floor(remaining / BELLY_PER.ep); remaining -= ep * BELLY_PER.ep;
  const sp = Math.floor(remaining / BELLY_PER.sp); remaining -= sp * BELLY_PER.sp;
  const cp = Math.floor(remaining / BELLY_PER.cp); remaining -= cp * BELLY_PER.cp;

  return { pp, gp, ep, sp, cp, remainderBelly: remaining };
}

async function convertActorCurrencyToBelly(actor, { zeroStandard = true } = {}) {
  const cur = getActorCurrency(actor);
  const existingBelly = getBelly(actor);
  const bellyGained = coinsToBellyValue(cur);

  const updates = { [`flags.${MODULE_ID}.belly`]: existingBelly + bellyGained };

  if (zeroStandard) {
    updates["system.currency.pp"] = 0;
    updates["system.currency.gp"] = 0;
    updates["system.currency.ep"] = 0;
    updates["system.currency.sp"] = 0;
    updates["system.currency.cp"] = 0;
  }
  await actor.update(updates);
}

async function convertActorBellyToCoins(actor, { bellyToConvert } = {}) {
  const existingBelly = getBelly(actor);
  let amount = Number(bellyToConvert);
  if (!Number.isFinite(amount)) amount = existingBelly;
  amount = Math.max(0, Math.min(existingBelly, Math.floor(amount)));

  const breakdown = bellyToCoinsBreakdown(amount);
  const convertible = amount - breakdown.remainderBelly;

  const cur = getActorCurrency(actor);

  await actor.update({
    [`flags.${MODULE_ID}.belly`]: existingBelly - convertible,
    "system.currency.pp": cur.pp + breakdown.pp,
    "system.currency.gp": cur.gp + breakdown.gp,
    "system.currency.ep": cur.ep + breakdown.ep,
    "system.currency.sp": cur.sp + breakdown.sp,
    "system.currency.cp": cur.cp + breakdown.cp
  });
}

function fmt(n) {
  try { return Intl.NumberFormat(game.i18n.lang).format(n); }
  catch { return String(n); }
}

function t(key, fallback) {
  const v = game.i18n.localize(key);
  return v === key ? fallback : v;
}

function getBellyFillPct(belly) {
  let cap = 1000000;
  try { cap = Math.max(1, Number(game.settings.get(MODULE_ID, "bellyCap")) || 1000000); }
  catch (_) {}
  return Math.max(0, Math.min(100, (belly / cap) * 100));
}

function buildSidebarBlock(actor) {
  const wp = getWillpower(actor);
  const wpBonus = getWillpowerBonus(actor);
  const lvl = getTotalLevel(actor);
  const belly = getBelly(actor);
  const fillPct = getBellyFillPct(belly);

  const showHybrid = isHybrid(actor);
  const pointsMax = showHybrid ? getHybridPointsMax(actor) : 0;
  const pointsCur = showHybrid ? Math.max(0, Math.min(pointsMax, getHybridPoints(actor))) : 0;
  const pointsPct = showHybrid ? getChargesFillPct(pointsCur, pointsMax) : 0;

  const canEditWP = game.user.isGM;

  const willpowerLabel = t("ONEPIECE.Willpower", "Willpower");
  const pointsLabel = t("ONEPIECE.HybridPoints", "Hybrid Points");
  const pointsHint = t("ONEPIECE.HybridPointsHint", "Resets on Long Rest");
  const bellyLabel = t("ONEPIECE.Belly", "Belly");
  const bellyHint = t("ONEPIECE.BellyHint", "1 gp = 10,000 belly");
  const editLabel = t("ONEPIECE.Edit", "Edit");
  const convertLabel = t("ONEPIECE.Convert", "Convert");
  const addLabel = t("ONEPIECE.AddBelly", "Add Belly");

  const wpTooltip = `@willpower.total (Level ${lvl} + Bonus ${wpBonus >= 0 ? "+" : ""}${wpBonus})`;

  return `
<section class="onepiece-op-root" data-onepiece-root="1">

  <div class="onepiece-op-card">
    <div class="onepiece-op-head">
      <div class="onepiece-op-title" title="${wpTooltip}">
        <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
        <span>${willpowerLabel}</span>
      </div>

      ${
        canEditWP
          ? `<button type="button" class="onepiece-op-iconbtn" data-onepiece-action="edit-willpower" title="${editLabel}">
               <i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>
             </button>`
          : ""
      }
    </div>

    <div class="onepiece-op-value">${fmt(wp)}</div>
    <div class="onepiece-op-sub">Level ${lvl} • Bonus ${wpBonus >= 0 ? "+" : ""}${wpBonus}</div>
  </div>

  ${
    showHybrid
      ? `
  <div class="onepiece-op-card">
    <div class="onepiece-op-head">
      <div class="onepiece-op-title" title="@hybrid.points.value / @hybrid.points.max">
        <i class="fa-solid fa-bolt" aria-hidden="true"></i>
        <span>${pointsLabel}</span>
      </div>

      <div class="onepiece-op-btnrow">
        <button type="button" class="onepiece-op-iconbtn" data-onepiece-action="points-minus" title="-1">
          <i class="fa-solid fa-minus" aria-hidden="true"></i>
        </button>
        <button type="button" class="onepiece-op-iconbtn" data-onepiece-action="points-plus" title="+1">
          <i class="fa-solid fa-plus" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <div class="onepiece-op-value">${fmt(pointsCur)}<span style="opacity:.65;font-size:18px;font-weight:800;"> / ${fmt(pointsMax)}</span></div>
    <div class="onepiece-op-bankbar" aria-hidden="true">
      <div class="onepiece-op-bankfill" style="width:${pointsPct}%;"></div>
    </div>
    <div class="onepiece-op-sub">${pointsHint}</div>
  </div>
  `
      : ""
  }

  <div class="onepiece-op-card">
    <div class="onepiece-op-head">
      <div class="onepiece-op-title">
        <i class="fa-solid fa-coins" aria-hidden="true"></i>
        <span>${bellyLabel}</span>
      </div>

      <div class="onepiece-op-btnrow">
        <button type="button" class="onepiece-op-iconbtn"
          data-onepiece-action="add-belly" title="${addLabel}">
          <i class="fa-solid fa-plus" aria-hidden="true"></i>
        </button>

        <button type="button" class="onepiece-op-iconbtn"
          data-onepiece-action="open-convert" title="${convertLabel}">
          <i class="fa-solid fa-arrow-right-arrow-left" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <div class="onepiece-op-value">${fmt(belly)}</div>

    <div class="onepiece-op-bankbar" aria-hidden="true">
      <div class="onepiece-op-bankfill" style="width:${fillPct}%;"></div>
    </div>

    <div class="onepiece-op-sub">${bellyHint}</div>
  </div>

</section>
`;
}

function normalizeRoot(el) {
  if (!el) return null;
  if (el instanceof HTMLElement) return el;
  if (el?.[0] instanceof HTMLElement) return el[0];
  return null;
}

function removeExisting(sidebar) {
  sidebar.querySelectorAll("[data-onepiece-root]").forEach((el) => el.remove());
}

function findTextEl(scope, regex) {
  const nodes = scope.querySelectorAll("div,span,label,small,header,h2,h3,h4,button,a,p");
  for (const el of nodes) {
    const txt = (el.textContent ?? "").trim();
    if (!txt) continue;
    if (txt.length > 40) continue;
    if (regex.test(txt)) return el;
  }
  return null;
}

function findSidebarColumnFromHitDice(root) {
  const hitDiceLabel = findTextEl(root, /^hit\s*dice$/i) || findTextEl(root, /hit\s*dice/i);
  if (!hitDiceLabel) return null;

  let el = hitDiceLabel.parentElement;
  while (el && el !== root) {
    const fav = findTextEl(el, /^favorites$/i) || findTextEl(el, /favorites/i);
    if (fav) return el;
    el = el.parentElement;
  }
  return null;
}

function injectBetweenHitDiceAndFavorites(sheet, rootRaw) {
  const root = normalizeRoot(rootRaw);
  if (!root || !sheet?.actor) return;

  const actor = getActorFromSheetApp(sheet);
  if (!isCharacterActor(actor)) return;

  ensureOnePieceStyles();

  const sidebar =
    findSidebarColumnFromHitDice(root) ||
    root.querySelector(".sidebar, .sheet-sidebar, aside, .left, .column.left, .actor-sidebar") ||
    root;

  removeExisting(sidebar);

  const html = buildSidebarBlock(actor);

  const favEl = findTextEl(sidebar, /^favorites$/i) || findTextEl(sidebar, /favorites/i);
  if (favEl?.insertAdjacentHTML) {
    favEl.insertAdjacentHTML("beforebegin", html);
    return;
  }

  const hdEl = findTextEl(sidebar, /^hit\s*dice$/i) || findTextEl(sidebar, /hit\s*dice/i);
  if (hdEl?.insertAdjacentHTML) {
    hdEl.insertAdjacentHTML("afterend", html);
    return;
  }

  sidebar.insertAdjacentHTML("afterbegin", html);
}

function openAddBellyDialog(sheet) {
  const actor = getActorFromSheetApp(sheet);
  if (!actor || !isCharacterActor(actor)) return;

  if (!actor.testUserPermission(game.user, "OWNER")) {
    ui.notifications?.warn("You don't have permission to edit this actor's Belly.");
    return;
  }

  const cur = getBelly(actor);

  const title = t("ONEPIECE.AddBellyTitle", "Add Belly");
  const labelAmount = t("ONEPIECE.Amount", "Amount");
  const labelUnits = t("ONEPIECE.Units", "Units");
  const unitsBelly = t("ONEPIECE.UnitsBelly", "Belly");
  const unitsGp = t("ONEPIECE.UnitsGP", "GP (convert to Belly)");
  const applyLabel = t("ONEPIECE.Apply", "Apply");
  const cancelLabel = t("ONEPIECE.Cancel", "Cancel");

  const content = `
<form class="onepiece-addbelly-form">
  <div class="form-group">
    <label>${labelAmount}</label>
    <input type="number" name="amount" step="1" value="0" />
    <p class="notes">Current: <b>${fmt(cur)}</b> Belly</p>
  </div>

  <div class="form-group">
    <label>${labelUnits}</label>
    <select name="units">
      <option value="belly">${unitsBelly}</option>
      <option value="gp">${unitsGp}</option>
    </select>
    <p class="notes">If you choose GP, it converts using 1 gp = 10,000 belly.</p>
  </div>

  <hr/>
  <div class="form-group">
    <label>Preview</label>
    <div class="onepiece-addbelly-preview" style="opacity:.85;"></div>
  </div>
</form>`;

  function renderPreview($html) {
    let amt = Number($html.find("input[name='amount']").val() ?? 0);
    if (!Number.isFinite(amt)) amt = 0;
    const units = String($html.find("select[name='units']").val() ?? "belly");
    const delta = units === "gp" ? Math.floor(amt * BELLY_PER_GP) : Math.floor(amt);
    const next = Math.max(0, cur + delta);

    $html.find(".onepiece-addbelly-preview").html(
      `<p>Change: <b>${delta >= 0 ? "+" : ""}${fmt(delta)}</b> Belly</p>
       <p>Result: <b>${fmt(next)}</b> Belly</p>`
    );
  }

  new Dialog({
    title,
    content,
    buttons: {
      apply: {
        label: applyLabel,
        callback: async ($html) => {
          let amt = Number($html.find("input[name='amount']").val() ?? 0);
          if (!Number.isFinite(amt)) amt = 0;
          const units = String($html.find("select[name='units']").val() ?? "belly");
          const delta = units === "gp" ? Math.floor(amt * BELLY_PER_GP) : Math.floor(amt);
          await addBelly(actor, delta);
          sheet.render?.(false);
        }
      },
      cancel: { label: cancelLabel }
    },
    default: "apply",
    render: ($html) => {
      const trigger = () => renderPreview($html);
      $html.on("input", "input[name='amount']", trigger);
      $html.on("change", "select[name='units']", trigger);
      trigger();
    }
  }).render(true);
}

function openConvertDialog(sheet) {
  const actor = getActorFromSheetApp(sheet);
  if (!actor || !isCharacterActor(actor)) return;

  const content = `
<form class="onepiece-convert-form">
  <div class="form-group">
    <label>${game.i18n.localize("ONEPIECE.ConvertDirection")}</label>
    <select name="direction">
      <option value="coinsToBelly">${game.i18n.localize("ONEPIECE.CoinsToBelly")}</option>
      <option value="bellyToCoins">${game.i18n.localize("ONEPIECE.BellyToCoins")}</option>
    </select>
  </div>

  <div class="form-group onepiece-opt onepiece-opt-coins">
    <label>
      <input type="checkbox" name="zeroCoins" checked />
      ${game.i18n.localize("ONEPIECE.ZeroCoinsAfter")}
    </label>
  </div>

  <div class="form-group onepiece-opt onepiece-opt-belly" style="display:none;">
    <label>${game.i18n.localize("ONEPIECE.BellyAmount")}</label>
    <input type="number" name="bellyAmount" min="0" step="1"
      placeholder="${game.i18n.localize("ONEPIECE.BellyAmountPlaceholder")}" />
    <p class="notes">${game.i18n.localize("ONEPIECE.BellyAmountHint")}</p>
  </div>

  <hr/>

  <div class="onepiece-preview-block">
    <div class="form-group">
      <label>${game.i18n.localize("ONEPIECE.Preview")}</label>
      <div class="onepiece-preview"></div>
    </div>
  </div>
</form>`;

  function updatePreview($dlg) {
    const actor = getActorFromSheetApp(sheet);
    const dir = $dlg.find("select[name='direction']").val();

    const curCoins = getActorCurrency(actor);
    const curBelly = getBelly(actor);

    if (dir === "coinsToBelly") {
      $dlg.find(".onepiece-opt-coins").show();
      $dlg.find(".onepiece-opt-belly").hide();

      const zeroCoins = !!$dlg.find("input[name='zeroCoins']").prop("checked");
      const bellyGained = coinsToBellyValue(curCoins);
      const afterBelly = curBelly + bellyGained;

      $dlg.find(".onepiece-preview").html(`
        <p>${game.i18n.localize("ONEPIECE.Current")}: Belly <b>${fmt(curBelly)}</b></p>
        <p>${game.i18n.localize("ONEPIECE.Change")}: +<b>${fmt(bellyGained)}</b> Belly</p>
        <p>${game.i18n.localize("ONEPIECE.Result")}: Belly <b>${fmt(afterBelly)}</b></p>
        ${zeroCoins ? `<p class="notes">Coins will be set to 0 after converting.</p>` : ""}
      `);
    } else {
      $dlg.find(".onepiece-opt-coins").hide();
      $dlg.find(".onepiece-opt-belly").show();

      let amount = $dlg.find("input[name='bellyAmount']").val();
      amount = amount === "" || amount === null ? curBelly : Number(amount);
      if (!Number.isFinite(amount)) amount = curBelly;

      amount = Math.max(0, Math.min(curBelly, Math.floor(amount)));

      const breakdown = bellyToCoinsBreakdown(amount);
      const convertible = amount - breakdown.remainderBelly;
      const afterBelly = curBelly - convertible;

      $dlg.find(".onepiece-preview").html(`
        <p>${game.i18n.localize("ONEPIECE.Current")}: Belly <b>${fmt(curBelly)}</b></p>
        <p>${game.i18n.localize("ONEPIECE.ConvertedBelly")}: <b>${fmt(convertible)}</b> Belly <span class="notes">(${game.i18n.localize("ONEPIECE.RemainderStays")}: ${fmt(breakdown.remainderBelly)})</span></p>
        <p>${game.i18n.localize("ONEPIECE.CoinsGained")}: pp ${fmt(breakdown.pp)} gp ${fmt(breakdown.gp)} ep ${fmt(breakdown.ep)} sp ${fmt(breakdown.sp)} cp ${fmt(breakdown.cp)}</p>
        <p>${game.i18n.localize("ONEPIECE.Result")}: Belly <b>${fmt(afterBelly)}</b></p>
      `);
    }
  }

  new Dialog({
    title: game.i18n.localize("ONEPIECE.ConvertTitle"),
    content,
    buttons: {
      apply: {
        label: game.i18n.localize("ONEPIECE.Apply"),
        callback: async (dlgHtml) => {
          const actor = getActorFromSheetApp(sheet);
          const dir = dlgHtml.find("select[name='direction']").val();

          if (dir === "coinsToBelly") {
            const zeroCoins = !!dlgHtml.find("input[name='zeroCoins']").prop("checked");
            await convertActorCurrencyToBelly(actor, { zeroStandard: zeroCoins });
          } else {
            let amount = dlgHtml.find("input[name='bellyAmount']").val();
            amount = amount === "" || amount === null ? getBelly(actor) : Number(amount);
            await convertActorBellyToCoins(actor, { bellyToConvert: amount });
          }

          sheet.render?.(false);
          sheet.render?.({ force: false });
        }
      },
      cancel: { label: game.i18n.localize("ONEPIECE.Cancel") }
    },
    default: "apply",
    render: (dlgHtml) => {
      const $dlg = dlgHtml;
      const trigger = () => updatePreview($dlg);
      $dlg.on("change", "select[name='direction']", trigger);
      $dlg.on("change", "input[name='zeroCoins']", trigger);
      $dlg.on("input", "input[name='bellyAmount']", trigger);
      trigger();
    }
  }).render(true);
}

function bindDelegatedClicks(sheet, rootRaw) {
  const root = normalizeRoot(rootRaw);
  if (!root || root.dataset.onepieceBound === "1") return;
  root.dataset.onepieceBound = "1";

  root.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-onepiece-action]");
    if (!btn) return;

    const actor = getActorFromSheetApp(sheet);
    if (!isCharacterActor(actor)) return;

    ev.preventDefault();
    ev.stopPropagation();

    const action = btn.dataset.onepieceAction;

    if (action === "edit-willpower") {
      if (!game.user.isGM) return;

      const current = getWillpowerBonus(actor);

      new Dialog({
        title: game.i18n.localize("ONEPIECE.EditWillpower"),
        content: `
<form>
  <div class="form-group">
    <label>${game.i18n.localize("ONEPIECE.WillpowerBonus")}</label>
    <input type="number" name="bonus" value="${current}" step="1"/>
    <p class="notes">${game.i18n.localize("ONEPIECE.WillpowerBonusHint")}</p>
  </div>
</form>`,
        buttons: {
          save: {
            label: game.i18n.localize("ONEPIECE.Save"),
            callback: async (dlgHtml) => {
              const bonus = Number(dlgHtml.find("input[name='bonus']").val() ?? 0) || 0;
              await actor.setFlag(MODULE_ID, "willpowerBonus", bonus);
              sheet.render?.(false);
              sheet.render?.({ force: false });
            }
          },
          cancel: { label: game.i18n.localize("ONEPIECE.Cancel") }
        },
        default: "save"
      }).render(true);
    }

    if (action === "open-convert") openConvertDialog(sheet);
    if (action === "add-belly") openAddBellyDialog(sheet);

    // Hybrid Points controls
    if (action === "points-plus" || action === "points-minus") {
      if (!isHybrid(actor)) return;
      if (!actor.testUserPermission(game.user, "OWNER")) {
        ui.notifications?.warn("You don't have permission to edit this actor's Hybrid Points.");
        return;
      }
      const cur = getHybridPoints(actor);
      const next = cur + (action === "points-plus" ? 1 : -1);
      await setHybridPoints(actor, next);
      sheet.render?.(false);
      sheet.render?.({ force: false });
    }
  });
}

async function renderOnePiece(sheet, root) {
  if (!shouldRunForSheet(sheet)) return;

  try {
    bindDelegatedClicks(sheet, root);
    injectBetweenHitDiceAndFavorites(sheet, root);

    // Keep resource slot synced so Activity Consumption works.
    const actor = getActorFromSheetApp(sheet);
    if (isCharacterActor(actor) && isHybrid(actor)) {
      await syncHybridPointsResource(actor);
    }
  } catch (e) {
    console.error(`${MODULE_ID} | render failed`, e);
  }
}

Hooks.on("renderActorSheet5eCharacter", (app, html) => renderOnePiece(app, html));
Hooks.on("renderActorSheet5e", (app, html) => renderOnePiece(app, html));
Hooks.on("renderActorSheetV2", (sheet, element) => renderOnePiece(sheet, element));
Hooks.on("tidy5e-sheet.renderActorSheet", (sheet, element) => renderOnePiece(sheet, element));

Hooks.on("renderActorSheet", (app, html) => {
  if (game.system.id !== "dnd5e") return;
  renderOnePiece(app, html);
});

function isLongRestResult(result) {
  if (!result) return false;
  if (result.longRest === true) return true;
  const t = String(result.type ?? result.restType ?? result.kind ?? "").toLowerCase();
  if (t.includes("long")) return true;
  return false;
}

Hooks.on("dnd5e.restCompleted", async (actor, result) => {
  try {
    if (!isCharacterActor(actor) || !isHybrid(actor)) return;
    if (!isLongRestResult(result)) return;
    await setHybridPoints(actor, 0);
  } catch (e) {
    console.error(`${MODULE_ID} | failed to reset hybrid points on restCompleted`, e);
  }
});

Hooks.on("dnd5e.longRest", async (actor, result) => {
  try {
    if (!isCharacterActor(actor) || !isHybrid(actor)) return;
    await setHybridPoints(actor, 0);
  } catch (e) {
    console.error(`${MODULE_ID} | failed to reset hybrid points on longRest`, e);
  }
});

const ONEPIECE_HYBRID_ON_HIT = {
  ENABLED: true,
  AMOUNT_ON_HIT: 1,
  CRIT_DOUBLES: false,
  REQUIRE_MELEE: true,
  REQUIRE_WEAPON: true,
  SHOW_TOASTS: false,
  DEBUG: false
};

function opToast(type, msg) {
  if (!ONEPIECE_HYBRID_ON_HIT.SHOW_TOASTS) return;
  ui.notifications?.[type]?.(msg);
}

function opIsCrit(workflow) {
  return Boolean(
    workflow?.isCritical ||
    workflow?.critical ||
    workflow?.attackRoll?.isCritical ||
    workflow?.attackRoll?.terms?.some?.(t => t?.isCritical)
  );
}

function opBestEffortIsMelee(workflow) {
  const item = workflow?.item;
  if (!item) return false;

  const actionType = String(item?.system?.actionType ?? "").toLowerCase();
  if (actionType === "mwak") return true;
  if (actionType === "rwak") return false;

  const rangeVal =
    item?.system?.range?.value ??
    item?.system?.range?.reach ??
    null;

  const r = Number(rangeVal);
  if (Number.isFinite(r)) return r <= 5;

  const name = String(item?.name ?? "").toLowerCase();
  if (name.includes("ranged")) return false;
  if (name.includes("melee")) return true;

  return true;
}

function opIsWeaponAttack(workflow) {
  const item = workflow?.item;
  if (!item) return false;

  const type = String(item.type ?? "").toLowerCase();
  if (type === "weapon") return true;

  const actionType = String(item?.system?.actionType ?? "").toLowerCase();
  if (actionType === "mwak" || actionType === "rwak") return true;

  return false;
}

function opGetHitInfo(workflow) {
  const hitTargetsSize = workflow?.hitTargets?.size ?? 0;
  const dmgCount = Array.isArray(workflow?.damageList) ? workflow.damageList.length : 0;
  const hitCount = Math.max(hitTargetsSize, dmgCount);
  return { hit: hitCount > 0, hitCount };
}

function opAlreadyApplied(workflow) {
  if (!workflow) return true;
  if (workflow.__onepieceHybridGainApplied) return true;
  workflow.__onepieceHybridGainApplied = true;
  return false;
}

async function opAwardHybridPoints(actor, amount) {
  const max = getHybridPointsMax(actor);
  const cur = getHybridPoints(actor);
  const next = Math.max(0, Math.min(max, cur + amount));
  if (next === cur) return;
  await setHybridPoints(actor, next);
}

Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  try {
    if (!ONEPIECE_HYBRID_ON_HIT.ENABLED) return;
    if (!workflow) return;
    if (!globalThis.MidiQOL) return;

    const actor = workflow?.actor;
    if (!isCharacterActor(actor) || !isHybrid(actor)) return;

    if (ONEPIECE_HYBRID_ON_HIT.REQUIRE_WEAPON && !opIsWeaponAttack(workflow)) return;
    if (ONEPIECE_HYBRID_ON_HIT.REQUIRE_MELEE && !opBestEffortIsMelee(workflow)) return;

    const { hit, hitCount } = opGetHitInfo(workflow);
    if (!hit) return;

    if (opAlreadyApplied(workflow)) return;

    const crit = opIsCrit(workflow);
    const base = ONEPIECE_HYBRID_ON_HIT.AMOUNT_ON_HIT;
    const amount = (crit && ONEPIECE_HYBRID_ON_HIT.CRIT_DOUBLES) ? (base * 2) : base;

    await opAwardHybridPoints(actor, amount);

    if (ONEPIECE_HYBRID_ON_HIT.SHOW_TOASTS) {
      opToast("info", `${actor.name}: +${amount} Hybrid Point${amount === 1 ? "" : "s"} (hit ${hitCount}${crit ? ", crit" : ""})`);
    }
  } catch (e) {
    console.error(`${MODULE_ID} | hybrid on-hit award failed`, e);
  }
});

