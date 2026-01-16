/* one-piece-supplement-module | scripts/main.js */
const MODULE_ID = "one-piece-supplement-module";

// Exchange rates in "belly per unit"
const BELLY_PER = { cp: 100, sp: 1000, ep: 5000, gp: 10000, pp: 100000 };

/* --------------------------------------------- */
/* Inline styles (so it ALWAYS looks like boxes)  */
/* --------------------------------------------- */
function ensureOnePieceStyles() {
  const id = "onepiece-supplement-inline-styles";
  if (document.getElementById(id)) return;

  const css = `
/* --- One Piece Supplement UI --- */
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

/* Tighten inside very narrow sidebars */
.tidy5e-sheet .onepiece-op-card{padding:9px 9px 8px}
`;

  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

/* --------------------------------------------- */
/* init: settings + roll-data (@willpower.*)      */
/* --------------------------------------------- */
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

  // Roll data injection for formulas: @willpower.level / @willpower.bonus / @willpower.total
  const ActorCls = CONFIG.Actor?.documentClass;
  if (!ActorCls?.prototype?.getRollData) return;

  if (ActorCls.prototype.__onepieceWillpowerWrapped) return;
  ActorCls.prototype.__onepieceWillpowerWrapped = true;

  const original = ActorCls.prototype.getRollData;
  ActorCls.prototype.getRollData = function () {
    const data = original.call(this);
    const level = getTotalLevel(this);
    const bonus = getWillpowerBonus(this);
    data.willpower = { level, bonus, total: level + bonus };
    return data;
  };
});

/* --------------------------------------------- */
/* data helpers                                   */
/* --------------------------------------------- */
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

function getBelly(actor) {
  return Number(actor.getFlag(MODULE_ID, "belly") ?? 0) || 0;
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

/* --------------------------------------------- */
/* UI block (boxed like your training cards)      */
/* --------------------------------------------- */
function buildSidebarBlock(actor) {
  const wp = getWillpower(actor);
  const wpBonus = getWillpowerBonus(actor);
  const lvl = getTotalLevel(actor);
  const belly = getBelly(actor);
  const fillPct = getBellyFillPct(belly);

  const canEditWP = game.user.isGM;

  const willpowerLabel = t("ONEPIECE.Willpower", "Willpower");
  const bellyLabel = t("ONEPIECE.Belly", "Belly");
  const bellyHint = t("ONEPIECE.BellyHint", "1 gp = 10,000 belly");
  const editLabel = t("ONEPIECE.Edit", "Edit");
  const convertLabel = t("ONEPIECE.Convert", "Convert");

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

  <div class="onepiece-op-card">
    <div class="onepiece-op-head">
      <div class="onepiece-op-title">
        <i class="fa-solid fa-coins" aria-hidden="true"></i>
        <span>${bellyLabel}</span>
      </div>

      <button type="button" class="onepiece-op-iconbtn" data-onepiece-action="open-convert" title="${convertLabel}">
        <i class="fa-solid fa-arrow-right-arrow-left" aria-hidden="true"></i>
      </button>
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

/* --------------------------------------------- */
/* Placement: EXACTLY between Hit Dice & Favorites */
/* (locks to the same sidebar column)             */
/* --------------------------------------------- */
function normalizeRoot(el) {
  if (!el) return null;
  if (el instanceof HTMLElement) return el;
  if (el?.[0] instanceof HTMLElement) return el[0]; // jQuery
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
  // Find "Hit Dice" label anywhere, then walk up until we find an ancestor containing "Favorites"
  const hitDiceLabel = findTextEl(root, /^hit\s*dice$/i) || findTextEl(root, /hit\s*dice/i);
  if (!hitDiceLabel) return null;

  let el = hitDiceLabel.parentElement;
  while (el && el !== root) {
    const fav = findTextEl(el, /^favorites$/i) || findTextEl(el, /favorites/i);
    if (fav) return el; // this is the tight column containing both
    el = el.parentElement;
  }
  return null;
}

function injectBetweenHitDiceAndFavorites(sheet, rootRaw) {
  const root = normalizeRoot(rootRaw);
  if (!root || !sheet?.actor) return;

  ensureOnePieceStyles();

  // Tight sidebar column (the one that actually has Hit Dice + Favorites)
  const sidebar = findSidebarColumnFromHitDice(root)
    || root.querySelector(".sidebar, .sheet-sidebar, aside, .left, .column.left, .actor-sidebar")
    || root;

  removeExisting(sidebar);

  const html = buildSidebarBlock(sheet.actor);

  // Insert before the Favorites header inside that SAME sidebar
  const favEl = findTextEl(sidebar, /^favorites$/i) || findTextEl(sidebar, /favorites/i);
  if (favEl?.insertAdjacentHTML) {
    favEl.insertAdjacentHTML("beforebegin", html);
    return;
  }

  // Fallback: after Hit Dice label/section
  const hdEl = findTextEl(sidebar, /^hit\s*dice$/i) || findTextEl(sidebar, /hit\s*dice/i);
  if (hdEl?.insertAdjacentHTML) {
    hdEl.insertAdjacentHTML("afterend", html);
    return;
  }

  // Last resort
  sidebar.insertAdjacentHTML("afterbegin", html);
}

/* --------------------------------------------- */
/* Convert dialog (live preview)                  */
/* --------------------------------------------- */
function openConvertDialog(sheet) {
  const actor = sheet.actor;
  if (!actor) return;

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
    <h3 style="margin:0 0 6px 0;">${game.i18n.localize("ONEPIECE.Preview")}</h3>
    <div class="onepiece-preview"></div>
  </div>
</form>`;

  const updatePreview = (dlgHtml) => {
    const dir = String(dlgHtml.find("select[name='direction']").val() ?? "coinsToBelly");
    const coinsOpt = dlgHtml.find(".onepiece-opt-coins");
    const bellyOpt = dlgHtml.find(".onepiece-opt-belly");

    if (dir === "coinsToBelly") { coinsOpt.show(); bellyOpt.hide(); }
    else { coinsOpt.hide(); bellyOpt.show(); }

    const existingBelly = getBelly(actor);
    const cur = getActorCurrency(actor);

    let previewHtml = "";
    if (dir === "coinsToBelly") {
      const zeroCoins = !!dlgHtml.find("input[name='zeroCoins']").prop("checked");
      const bellyGained = coinsToBellyValue(cur);
      const newBelly = existingBelly + bellyGained;

      const newCoins = zeroCoins ? { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 } : cur;

      previewHtml = `
<p><b>${game.i18n.localize("ONEPIECE.Current")}</b> — Belly: ${fmt(existingBelly)} | pp:${cur.pp} gp:${cur.gp} ep:${cur.ep} sp:${cur.sp} cp:${cur.cp}</p>
<p><b>${game.i18n.localize("ONEPIECE.Change")}</b> — +${fmt(bellyGained)} Belly</p>
<p><b>${game.i18n.localize("ONEPIECE.Result")}</b> — Belly: ${fmt(newBelly)} | pp:${newCoins.pp} gp:${newCoins.gp} ep:${newCoins.ep} sp:${newCoins.sp} cp:${newCoins.cp}</p>`;
    } else {
      let amount = dlgHtml.find("input[name='bellyAmount']").val();
      amount = amount === "" || amount === null ? existingBelly : Number(amount);
      if (!Number.isFinite(amount)) amount = existingBelly;
      amount = Math.max(0, Math.min(existingBelly, Math.floor(amount)));

      const breakdown = bellyToCoinsBreakdown(amount);
      const convertible = amount - breakdown.remainderBelly;

      const newBelly = existingBelly - convertible;
      const newCoins = {
        pp: cur.pp + breakdown.pp,
        gp: cur.gp + breakdown.gp,
        ep: cur.ep + breakdown.ep,
        sp: cur.sp + breakdown.sp,
        cp: cur.cp + breakdown.cp
      };

      previewHtml = `
<p><b>${game.i18n.localize("ONEPIECE.Current")}</b> — Belly: ${fmt(existingBelly)} | pp:${cur.pp} gp:${cur.gp} ep:${cur.ep} sp:${cur.sp} cp:${cur.cp}</p>
<p><b>${game.i18n.localize("ONEPIECE.ConvertedBelly")}</b> — ${fmt(convertible)} Belly ${
        breakdown.remainderBelly
          ? `(${fmt(breakdown.remainderBelly)} ${game.i18n.localize("ONEPIECE.RemainderStays")})`
          : ""
      }</p>
<p><b>${game.i18n.localize("ONEPIECE.CoinsGained")}</b> — pp:+${breakdown.pp} gp:+${breakdown.gp} ep:+${breakdown.ep} sp:+${breakdown.sp} cp:+${breakdown.cp}</p>
<p><b>${game.i18n.localize("ONEPIECE.Result")}</b> — Belly: ${fmt(newBelly)} | pp:${newCoins.pp} gp:${newCoins.gp} ep:${newCoins.ep} sp:${newCoins.sp} cp:${newCoins.cp}</p>`;
    }

    dlgHtml.find(".onepiece-preview").html(previewHtml);
  };

  new Dialog({
    title: game.i18n.localize("ONEPIECE.ConvertTitle"),
    content,
    buttons: {
      apply: {
        label: game.i18n.localize("ONEPIECE.Apply"),
        callback: async (dlgHtml) => {
          const dir = String(dlgHtml.find("select[name='direction']").val() ?? "coinsToBelly");

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

/* --------------------------------------------- */
/* Click handler                                  */
/* --------------------------------------------- */
function bindDelegatedClicks(sheet, rootRaw) {
  const root = normalizeRoot(rootRaw);
  if (!root || root.dataset.onepieceBound === "1") return;
  root.dataset.onepieceBound = "1";

  root.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-onepiece-action]");
    if (!btn) return;

    ev.preventDefault();
    ev.stopPropagation();

    const actor = sheet.actor;
    if (!actor) return;

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

    if (action === "open-convert") {
      openConvertDialog(sheet);
    }
  });
}

/* --------------------------------------------- */
/* Hooks (covers whatever sheet you’re on)        */
/* --------------------------------------------- */
function renderOnePiece(sheet, root) {
  try {
    bindDelegatedClicks(sheet, root);
    injectBetweenHitDiceAndFavorites(sheet, root);
  } catch (e) {
    console.error(`${MODULE_ID} | render failed`, e);
  }
}

// Legacy dnd5e
Hooks.on("renderActorSheet5eCharacter", (app, html) => renderOnePiece(app, html));
Hooks.on("renderActorSheet5e", (app, html) => renderOnePiece(app, html));

// AppV2
Hooks.on("renderActorSheetV2", (sheet, element) => renderOnePiece(sheet, element));

// Tidy
Hooks.on("tidy5e-sheet.renderActorSheet", (sheet, element) => renderOnePiece(sheet, element));

// Generic fallback
Hooks.on("renderActorSheet", (app, html) => {
  if (game.system.id !== "dnd5e") return;
  if (app?.actor?.type !== "character") return;
  renderOnePiece(app, html);
});

