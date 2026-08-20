import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, Cell,
} from "recharts";

/* ================================================================== */
/*  FORMATS + PERCENTILE DISTRIBUTIONS                                */
/* ================================================================== */
const FORMATS = {
  T20: {
    label: "T20", parSR: 130, parEcon: 8.0, parRR: 8.0, ballsInnings: 120, oversPerBowler: 4, maxBalls: 42, maxOvers: 4,
    bat: { sr: [130, 26], bnd: [56, 12], dot: [42, 9], bpb: [5.2, 1.6], avg: [28, 9] },
    bowl: { econ: [8.2, 1.6], dot: [38, 9], sr: [18, 6], avg: [26, 8] },
  },
  ODI: {
    label: "ODI", parSR: 88, parEcon: 5.5, parRR: 5.5, ballsInnings: 300, oversPerBowler: 10, maxBalls: 96, maxOvers: 10,
    bat: { sr: [88, 16], bnd: [48, 11], dot: [50, 8], bpb: [8, 2.4], avg: [38, 11] },
    bowl: { econ: [5.5, 1.1], dot: [52, 8], sr: [34, 9], avg: [32, 9] },
  },
  TEST: {
    label: "Test", parSR: 55, parEcon: 3.0, parRR: 3.0, ballsInnings: 540, oversPerBowler: 0, maxBalls: 150, maxOvers: 22,
    bat: { sr: [54, 12], bnd: [58, 12], dot: [68, 7], bpb: [9, 3], avg: [41, 12] },
    bowl: { econ: [3.0, 0.7], dot: [78, 6], sr: [56, 14], avg: [29, 8] },
  },
};

/* ================================================================== */
/*  MATH + PERCENTILES                                                */
/* ================================================================== */
const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);
const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const clampPct = (n) => clamp(n, 0, 100);

function normCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
function pctOf(value, [mean, std], invert = false) {
  let z = (value - mean) / std;
  if (invert) z = -z;
  return Math.round(clampPct(normCDF(z) * 100));
}

function battingMetrics(inn, fmt) {
  const { runs, balls, fours, sixes, dots } = inn;
  const bnd = fours + sixes;
  const boundaryRuns = fours * 4 + sixes * 6;
  const sr = balls ? (runs / balls) * 100 : 0;
  const dotPct = balls ? (dots / balls) * 100 : 0;
  const bpb = bnd ? balls / bnd : balls || 99;
  const boundaryPctRuns = runs ? (boundaryRuns / runs) * 100 : 0;
  const D = fmt.bat;
  const pSR = pctOf(sr, D.sr), pBnd = pctOf(boundaryPctRuns, D.bnd);
  const pRot = pctOf(dotPct, D.dot, true), pFreq = pctOf(bpb, D.bpb, true);
  const impact = Math.round(pSR * 0.34 + pBnd * 0.22 + pRot * 0.24 + pFreq * 0.2);
  const raa = Math.round(runs - (balls * fmt.parSR) / 100);
  const trueSR = fmt.parSR ? Math.round((sr / fmt.parSR) * 100) : 0;
  const scoringPct = Math.round(100 - dotPct);
  return { sr: r2(sr), dotPct: r1(dotPct), bpb: r1(bpb), boundaryRuns, boundaryPctRuns: r1(boundaryPctRuns), pSR, pBnd, pRot, pFreq, impact, raa, trueSR, scoringPct };
}
function bowlingMetrics(sp, fmt) {
  const { balls, runs, wickets, dots } = sp;
  const overs = balls / 6;
  const econ = overs ? runs / overs : 0;
  const dotPct = balls ? (dots / balls) * 100 : 0;
  const srk = wickets ? balls / wickets : balls || 99;
  const avg = wickets ? runs / wickets : runs || 99;
  const D = fmt.bowl;
  const pEcon = pctOf(econ, D.econ, true), pDot = pctOf(dotPct, D.dot);
  const pSR = pctOf(srk, D.sr, true), pAvg = pctOf(avg, D.avg, true);
  const impact = Math.round(pEcon * 0.3 + pDot * 0.22 + pSR * 0.26 + pAvg * 0.22);
  const runsSaved = Math.round(overs * (fmt.parEcon - econ));
  const trueEcon = fmt.parEcon ? Math.round((econ / fmt.parEcon) * 100) : 0;
  return { overs: r1(overs), econ: r2(econ), dotPct: r1(dotPct), sr: wickets ? r1(srk) : 0, avg: wickets ? r2(avg) : 0, pEcon, pDot, pSR, pAvg, impact, runsSaved, trueEcon };
}

const TIERS = [[93, "Elite"], [82, "Excellent"], [66, "Strong"], [45, "Solid"], [28, "Below Par"], [0, "Struggling"]];
const tierOf = (p) => (TIERS.find(([t]) => p >= t) || TIERS[TIERS.length - 1])[1];

const RAMP = [[0, [58, 70, 104]], [30, [62, 99, 176]], [55, [47, 224, 198]], [78, [124, 242, 160]], [100, [255, 194, 75]]];
function pctColor(p) {
  p = clampPct(p);
  let a = RAMP[0], b = RAMP[RAMP.length - 1];
  for (let i = 0; i < RAMP.length - 1; i++) if (p >= RAMP[i][0] && p <= RAMP[i + 1][0]) { a = RAMP[i]; b = RAMP[i + 1]; break; }
  const t = (p - a[0]) / (b[0] - a[0] || 1);
  const c = a[1].map((v, i) => Math.round(v + (b[1][i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/* match-rating color (FotMob-style) */
function ratingColor(r) { return r >= 8 ? "#2FE0C6" : r >= 7 ? "#2FD98A" : r >= 6 ? "#FFC24B" : "#FF3B5C"; }
function ratingText(r) { return r >= 6 && r < 7 ? "#11151a" : "#fff"; }

/* chase win prob + projection */
function chaseWinProb(target, score, wktsDown, ballsBowled, fmt) {
  const need = target - score, ballsLeft = fmt.ballsInnings - ballsBowled, wktsLeft = 10 - wktsDown;
  if (need <= 0) return 100;
  if (ballsLeft <= 0 || wktsLeft <= 0) return 0;
  const reqRR = (need / ballsLeft) * 6, wf = wktsLeft / 10;
  const sustainRR = fmt.parRR * (0.5 + 0.65 * wf);
  const ballAdj = Math.min(1.9, 36 / Math.max(ballsLeft, 6));
  return clampPct(Math.round((1 / (1 + Math.exp(-(sustainRR - reqRR) * 0.42 * ballAdj))) * 100));
}
function projectScore(score, wktsDown, ballsBowled, fmt) {
  const ballsLeft = fmt.ballsInnings - ballsBowled, wktsLeft = 10 - wktsDown;
  if (ballsLeft <= 0) return { proj: score, low: score, high: score, crr: 0 };
  const crr = ballsBowled ? (score / ballsBowled) * 6 : fmt.parRR, wf = wktsLeft / 10;
  let accel = 1 + 0.4 * wf;
  if (ballsLeft <= 30 && wktsLeft >= 4) accel *= 1.15;
  const projRR = crr * accel, proj = Math.round(score + (ballsLeft / 6) * projRR);
  const spread = Math.round((ballsLeft / 6) * projRR * 0.18);
  return { proj, low: proj - spread, high: proj + spread, crr: r2(crr) };
}

/* ================================================================== */
/*  PLAYER POOL (fictional)                                           */
/* ================================================================== */
const POOL = [
  { id: "cas", name: "R. Castellan", role: "bat", bat: 84, bowl: 0, type: null, vP: 82, vS: 70, age: 29, tag: "Anchor opener" },
  { id: "bra", name: "T. Brandt", role: "bat", bat: 80, bowl: 12, type: "pace", vP: 78, vS: 62, age: 27, tag: "Power opener" },
  { id: "oka", name: "M. Okafor", role: "bat", bat: 82, bowl: 0, type: null, vP: 66, vS: 88, age: 31, tag: "Spin destroyer" },
  { id: "var", name: "S. Varga", role: "bat", bat: 79, bowl: 0, type: null, vP: 74, vS: 76, age: 25, tag: "Finisher" },
  { id: "fer", name: "D. Ferreira", role: "bat", bat: 81, bowl: 0, type: null, vP: 80, vS: 72, age: 33, tag: "Accumulator" },
  { id: "nak", name: "K. Nakamura", role: "bat", bat: 76, bowl: 0, type: null, vP: 70, vS: 80, age: 28, tag: "Flexible middle" },
  { id: "van", name: "A. Vance", role: "bat", bat: 78, bowl: 0, type: null, vP: 76, vS: 60, age: 24, tag: "Explosive top" },
  { id: "mwa", name: "J. Mwangi", role: "bat", bat: 77, bowl: 0, type: null, vP: 86, vS: 64, age: 30, tag: "Pace-tamer" },
  { id: "sol", name: "P. Solberg", role: "keeper", bat: 80, bowl: 0, type: null, vP: 78, vS: 76, age: 29, tag: "Keeper-anchor" },
  { id: "cos", name: "E. Costa", role: "keeper", bat: 74, bowl: 0, type: null, vP: 72, vS: 70, age: 26, tag: "Keeper-finisher" },
  { id: "had", name: "L. Haddad", role: "keeper", bat: 71, bowl: 0, type: null, vP: 66, vS: 82, age: 27, tag: "Keeper vs spin" },
  { id: "bau", name: "C. Bauer", role: "ar", bat: 70, bowl: 74, type: "pace", vP: 72, vS: 64, age: 28, tag: "Seam all-rounder" },
  { id: "pet", name: "N. Petrov", role: "ar", bat: 68, bowl: 76, type: "spin", vP: 66, vS: 78, age: 30, tag: "Spin all-rounder" },
  { id: "rey", name: "O. Reyes", role: "ar", bat: 75, bowl: 66, type: "spin", vP: 70, vS: 80, age: 26, tag: "Batting off-spinner" },
  { id: "lin", name: "G. Lindqvist", role: "ar", bat: 66, bowl: 78, type: "pace", vP: 74, vS: 60, age: 32, tag: "Seam all-rounder" },
  { id: "ade", name: "H. Adeyemi", role: "ar", bat: 72, bowl: 70, type: "pace", vP: 70, vS: 66, age: 25, tag: "Power all-rounder" },
  { id: "sor", name: "V. Sørensen", role: "pace", bat: 28, bowl: 88, type: "pace", vP: 35, vS: 30, age: 27, tag: "Express pace" },
  { id: "dan", name: "F. Daniels", role: "pace", bat: 24, bowl: 84, type: "pace", vP: 32, vS: 28, age: 29, tag: "New-ball swing" },
  { id: "ach", name: "B. Achterberg", role: "pace", bat: 35, bowl: 82, type: "pace", vP: 40, vS: 34, age: 31, tag: "Death specialist" },
  { id: "kha", name: "Z. Khan", role: "pace", bat: 22, bowl: 83, type: "pace", vP: 30, vS: 26, age: 24, tag: "Left-arm pace" },
  { id: "lef", name: "M. Lefevre", role: "pace", bat: 30, bowl: 79, type: "pace", vP: 36, vS: 30, age: 28, tag: "Hit-the-deck seam" },
  { id: "sul", name: "I. Suleiman", role: "spin", bat: 26, bowl: 87, type: "spin", vP: 30, vS: 35, age: 30, tag: "Leg-spin striker" },
  { id: "dla", name: "Q. Dlamini", role: "spin", bat: 32, bowl: 80, type: "spin", vP: 34, vS: 36, age: 26, tag: "Off-spin control" },
  { id: "nov", name: "W. Novák", role: "spin", bat: 28, bowl: 82, type: "spin", vP: 30, vS: 34, age: 33, tag: "Left-arm orthodox" },
  { id: "pil", name: "Y. Pillai", role: "spin", bat: 20, bowl: 85, type: "spin", vP: 26, vS: 32, age: 23, tag: "Mystery spin" },
  { id: "eng", name: "T. Engqvist", role: "spin", bat: 30, bowl: 78, type: "spin", vP: 32, vS: 34, age: 29, tag: "Leg-spin economy" },
];
const OVERSEAS = new Set(["cas", "sor", "dan", "sul", "bau", "had", "kha", "ade", "nov"]);
const UNCAPPED = new Set(["van", "cos", "lef", "dla", "eng", "rey"]);
POOL.forEach((p) => {
  p.overseas = OVERSEAS.has(p.id);
  p.uncapped = UNCAPPED.has(p.id) && !p.overseas;
  p.ability = p.role === "ar" ? (p.bat + p.bowl) / 2 + 8 : Math.max(p.bat, p.bowl);
  p.price = Math.max(0.5, Math.round((0.4 + Math.pow(Math.max(0, p.ability - 55) / 40, 1.7) * 17) * 2) / 2);
});
const ROLE_COL = { bat: "var(--clay)", keeper: "var(--gold)", ar: "var(--grass)", pace: "var(--sky)", spin: "var(--cherry)" };
const ROLE_LBL = { bat: "BAT", keeper: "WK", ar: "AR", pace: "PACE", spin: "SPIN" };
const ROLE_TXT = { bat: "#11151a", keeper: "#11151a", ar: "#fff", pace: "#fff", spin: "#fff" };
const ROLE_NAME = { bat: "Batter", keeper: "Wicketkeeper", ar: "All-rounder", pace: "Pace bowler", spin: "Spin bowler" };
const initials = (n) => n.replace(/[^A-Za-z. ]/g, "").split(/[ .]+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/* ================================================================== */
/*  SEEDED SYNTHETIC SEASON ("past games")                            */
/* ================================================================== */
const OPP_NAMES = ["Harborline", "Vale Rovers", "Cape Storm", "Granite CC", "Meridian", "Lowveld Kings", "Saltford", "Ironbark", "Northwind", "Crest United", "Delta Stars", "Bayswater"];
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const SHOTS = [
  { name: "Pull", zone: 6, value: 1.35, risk: 1.1, cat: "power", bias: "late" },
  { name: "Hook", zone: 4, value: 1.4, risk: 1.5, cat: "power", bias: "late" },
  { name: "Cover drive", zone: 1, value: 1.15, risk: 0.8, cat: "tech", bias: "even" },
  { name: "Straight drive", zone: 0, value: 1.1, risk: 0.6, cat: "tech", bias: "even" },
  { name: "On drive", zone: 7, value: 1.1, risk: 0.7, cat: "tech", bias: "even" },
  { name: "Square cut", zone: 2, value: 1.25, risk: 1.0, cat: "tech", bias: "even" },
  { name: "Late cut", zone: 3, value: 1.0, risk: 1.0, cat: "spin", bias: "even" },
  { name: "Sweep", zone: 5, value: 1.1, risk: 0.9, cat: "spin", bias: "even" },
  { name: "Reverse sweep", zone: 2, value: 1.2, risk: 1.4, cat: "spin", bias: "late" },
  { name: "Flick", zone: 4, value: 1.0, risk: 0.7, cat: "tech", bias: "early" },
  { name: "Lofted drive", zone: 7, value: 1.5, risk: 1.4, cat: "power", bias: "late" },
  { name: "Slog", zone: 6, value: 1.5, risk: 1.6, cat: "power", bias: "late" },
];
const SHOT_COL = { power: "var(--cherry)", tech: "var(--clay)", spin: "var(--sky)" };
function styleOf(p) {
  const r = mulberry32(hashStr(p.id + "|style"));
  const a = r(), b = r(), c = r();
  return {
    power: clamp(0.22 + (p.bat - 68) * 0.013 + a * 0.4, 0.08, 0.96),
    spinPref: clamp(0.3 + (p.vS - p.vP) / 110 + b * 0.32, 0.1, 0.92),
    aggression: clamp(0.28 + (p.bat - 66) * 0.011 + c * 0.42, 0.1, 0.96),
  };
}
function phaseSplit(shot, st) {
  let pp, mid, death;
  if (shot.bias === "early") { pp = 0.45; mid = 0.4; death = 0.15; }
  else if (shot.bias === "late") { pp = 0.15; mid = 0.35; death = 0.5; }
  else { pp = 0.3; mid = 0.45; death = 0.25; }
  death += st.aggression * 0.18; pp -= st.aggression * 0.12; mid -= st.aggression * 0.06;
  pp = Math.max(0.04, pp); mid = Math.max(0.04, mid); death = Math.max(0.04, death);
  const s = pp + mid + death;
  return { pp: pp / s, mid: mid / s, death: death / s };
}

function buildSeason(p, fmt) {
  const rnd = mulberry32(hashStr(p.id + "|" + fmt.label));
  const N = 8;
  const expSR = clamp(fmt.parSR * (0.74 + (p.bat - 55) * 0.012), fmt.parSR * 0.5, fmt.parSR * 1.7);
  const expEcon = clamp(fmt.parEcon * (1.16 - (p.bowl - 55) * 0.007), fmt.parEcon * 0.7, fmt.parEcon * 1.5);
  const canBat = p.bat >= 45 || ["bat", "keeper", "ar"].includes(p.role);
  const canBowl = p.bowl >= 50;
  const games = [];
  let tRuns = 0, tBalls = 0, outs = 0, tWk = 0, tConc = 0, tOvers = 0;
  for (let i = 0; i < N; i++) {
    const opp = OPP_NAMES[Math.floor(rnd() * OPP_NAMES.length)];
    let bat = null, bowl = null, rating = 6.0;
    if (canBat) {
      const flop = rnd() < 0.22;
      let balls = flop ? Math.round(2 + rnd() * 8) : Math.round(fmt.maxBalls * 0.2 + rnd() * fmt.maxBalls * 0.78);
      balls = Math.max(1, balls);
      const sr = expSR * (flop ? 0.5 + rnd() * 0.6 : 0.72 + rnd() * 0.85);
      const runs = Math.max(0, Math.round((balls * sr) / 100));
      const out = rnd() < 0.8;
      bat = { runs, balls, sr: Math.round(sr), out };
      tRuns += runs; tBalls += balls; if (out) outs++;
      rating += (runs - 22) * 0.045 + (sr - expSR) * 0.011;
      if (runs >= 50) rating += 0.7; if (runs >= 100) rating += 0.8; if (runs < 8 && out) rating -= 0.9;
    }
    if (canBowl) {
      const overs = fmt.label === "Test" ? Math.round(8 + rnd() * fmt.maxOvers * 0.6) : Math.max(1, Math.round(fmt.maxOvers * (0.72 + rnd() * 0.28)));
      const conc = Math.round(overs * expEcon * (0.7 + rnd() * 0.7));
      const wExp = ((p.bowl - 52) / 16) * (overs / Math.max(fmt.maxOvers, 1));
      const wk = clamp(Math.round(wExp * (0.4 + rnd() * 1.9)), 0, 6);
      bowl = { overs, conc, wk, econ: r1(conc / overs) };
      tWk += wk; tConc += conc; tOvers += overs;
      rating += wk * 0.85 + (expEcon - conc / overs) * 0.32;
      if (wk >= 4) rating += 0.6;
    }
    rating = clamp(Math.round(rating * 10) / 10, 4.0, 9.8);
    games.push({ i, opp, bat, bowl, rating });
  }
  const form = games.map((g) => ({ x: g.i + 1, r: g.rating }));
  games.reverse();
  const batAgg = canBat ? { inns: N, runs: tRuns, sr: tBalls ? r1((tRuns / tBalls) * 100) : 0, avg: outs ? r1(tRuns / outs) : tRuns } : null;
  const bowlAgg = canBowl ? { wk: tWk, econ: tOvers ? r2(tConc / tOvers) : 0, avg: tWk ? r1(tConc / tWk) : 0, sr: tWk ? r1((tOvers * 6) / tWk) : 0 } : null;
  const avgRating = r1(games.reduce((s, g) => s + g.rating, 0) / games.length);

  let shotProfile = null, phases = null, clutch = null;
  if (canBat && tBalls > 0) {
    const st = styleOf(p);
    const w = SHOTS.map((s) => {
      let x = 1;
      if (s.cat === "power") x *= 0.4 + st.power * 1.9;
      if (s.cat === "tech") x *= 0.7 + (1 - st.power) * 1.3;
      if (s.cat === "spin") x *= 0.4 + st.spinPref * 1.7;
      return x;
    });
    const wsum = w.reduce((a, b) => a + b, 0) || 1;
    let shots = SHOTS.map((s, i) => ({ name: s.name, zone: s.zone, cat: s.cat, value: s.value, risk: s.risk, balls: Math.round((tBalls * w[i]) / wsum), ph: phaseSplit(s, st) })).filter((s) => s.balls > 0);
    const rpb = tRuns / tBalls;
    shots.forEach((s) => { s.runs = s.balls * rpb * s.value; });
    const rsum = shots.reduce((a, s) => a + s.runs, 0) || 1;
    shots.forEach((s) => { s.runs = Math.round((s.runs * tRuns) / rsum); s.sr = s.balls ? Math.round((s.runs / s.balls) * 100) : 0; });
    const owsum = shots.reduce((a, s) => a + s.balls * s.risk, 0) || 1;
    shots.forEach((s) => { s.outs = Math.round((outs * s.balls * s.risk) / owsum); });
    const tb = shots.reduce((a, s) => a + s.balls, 0) || 1;
    shots.forEach((s) => {
      s.freq = Math.round((s.balls / tb) * 100);
      s.ppB = Math.round(s.balls * s.ph.pp);
      s.midB = Math.round(s.balls * s.ph.mid);
      s.deathB = Math.max(0, s.balls - s.ppB - s.midB);
    });
    shots.sort((a, b) => b.balls - a.balls);
    shotProfile = shots;
    const phaseAgg = (key) => { let b = 0, rn = 0; shots.forEach((s) => { b += s[key]; rn += (s[key] * s.sr) / 100; }); return { balls: b, runs: Math.round(rn), sr: b ? Math.round((rn / b) * 100) : 0 }; };
    phases = { pp: phaseAgg("ppB"), mid: phaseAgg("midB"), death: phaseAgg("deathB") };
    const overallSR = tBalls ? Math.round((tRuns / tBalls) * 100) : 0;
    const goTo = [...shots].sort((a, b) => b.deathB - a.deathB)[0];
    clutch = { overallSR, deathSR: phases.death.sr, index: overallSR ? Math.round((phases.death.sr / overallSR) * 100) : 100, goTo, goToFreqDeath: phases.death.balls ? Math.round((goTo.deathB / phases.death.balls) * 100) : 0 };
  }

  return { games, form, batAgg, bowlAgg, avgRating, shotProfile, phases, clutch };
}

/* ================================================================== */
/*  CRICSHEET PARSER (real ball-by-ball import)                       */
/* ================================================================== */
const NON_BOWLER_OUT = new Set(["run out", "retired hurt", "retired not out", "obstructing the field", "timed out"]);
function fmtKeyFromType(t) {
  const u = (t || "").toUpperCase();
  if (u.includes("TEST") || u === "MDM") return "TEST";
  if (u.includes("ODI") || u === "ODM") return "ODI";
  return "T20";
}
function resultText(o) {
  if (!o) return "";
  if (o.winner && o.by) {
    const by = o.by;
    const m = by.wickets != null ? `${by.wickets} wkt${by.wickets > 1 ? "s" : ""}` : by.runs != null ? `${by.runs} run${by.runs > 1 ? "s" : ""}` : "";
    return `${o.winner} won by ${m}`;
  }
  if (o.result) return o.result.charAt(0).toUpperCase() + o.result.slice(1);
  return o.winner ? `${o.winner} won` : "";
}
function parseCricsheet(data) {
  const info = data.info || {};
  const totalOvers = info.overs || 20;
  const deathStart = totalOvers <= 20 ? 15 : 40;
  const phaseOf = (o) => (o < 6 ? "pp" : o >= deathStart ? "death" : "mid");
  const bat = new Map(), bowl = new Map(), inningsTotals = [];
  const gB = (n) => { if (!bat.has(n)) bat.set(n, { name: n, runs: 0, balls: 0, fours: 0, sixes: 0, dots: 0, out: false, ph: { pp: [0, 0], mid: [0, 0], death: [0, 0] } }); return bat.get(n); };
  const gW = (n) => { if (!bowl.has(n)) bowl.set(n, { name: n, balls: 0, runs: 0, wickets: 0, dots: 0, deathBalls: 0, deathRuns: 0 }); return bowl.get(n); };
  (data.innings || []).forEach((inn) => {
    let total = 0;
    (inn.overs || []).forEach((ov) => {
      const o = ov.over;
      (ov.deliveries || []).forEach((dl) => {
        const ex = dl.extras || {};
        const brun = dl.runs.batter, tr = dl.runs.total; total += tr;
        const isWide = ex.wides != null, isNoball = ex.noballs != null;
        const notCharged = (ex.legbyes || 0) + (ex.byes || 0);
        const B = gB(dl.batter);
        if (!isWide) {
          B.balls++; B.runs += brun;
          const p = B.ph[phaseOf(o)]; p[0] += brun; p[1]++;
          if (brun === 4) B.fours++; if (brun === 6) B.sixes++; if (tr === 0) B.dots++;
        }
        const W = gW(dl.bowler);
        if (!isWide && !isNoball) W.balls++;
        const charged = tr - notCharged; W.runs += charged; if (tr === 0) W.dots++;
        if (o >= deathStart) { if (!isWide && !isNoball) W.deathBalls++; W.deathRuns += charged; }
        (dl.wickets || []).forEach((wk) => { gB(wk.player_out).out = true; if (!NON_BOWLER_OUT.has(wk.kind)) W.wickets++; });
      });
    });
    inningsTotals.push({ team: inn.team, total });
  });
  const rr = (n) => Math.round(n * 10) / 10;
  const sr = (r, b) => (b ? rr((r / b) * 100) : 0);
  const batting = [...bat.values()].filter((b) => b.balls > 0).map((b) => {
    const oSR = sr(b.runs, b.balls), dSR = sr(b.ph.death[0], b.ph.death[1]);
    return { name: b.name, runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes, dots: b.dots, out: b.out, sr: oSR,
      phases: { pp: sr(b.ph.pp[0], b.ph.pp[1]), mid: sr(b.ph.mid[0], b.ph.mid[1]), death: dSR },
      clutchIndex: oSR && b.ph.death[1] ? Math.round((dSR / oSR) * 100) : null };
  }).sort((a, b) => b.runs - a.runs);
  const bowling = [...bowl.values()].filter((w) => w.balls > 0).map((w) => ({
    name: w.name, wickets: w.wickets, runs: w.runs, balls: w.balls, dots: w.dots,
    overs: `${Math.floor(w.balls / 6)}.${w.balls % 6}`, econ: rr(w.runs / (w.balls / 6)),
    deathEcon: w.deathBalls ? rr(w.deathRuns / (w.deathBalls / 6)) : null,
  })).sort((a, b) => b.wickets - a.wickets || a.econ - b.econ);
  const parRR = totalOvers <= 20 ? 8 : totalOvers <= 50 ? 5.5 : 3;
  const wfmt = { ballsInnings: totalOvers * 6, parRR };
  const wBat = new Map(), wBowl = new Map();
  if (data.innings && data.innings[1] && inningsTotals[0]) {
    const target = inningsTotals[0].total + 1;
    let score = 0, wk = 0, balls = 0;
    (data.innings[1].overs || []).forEach((ov) => {
      (ov.deliveries || []).forEach((dl) => {
        const ex = dl.extras || {};
        const before = chaseWinProb(target, score, wk, balls, wfmt);
        score += dl.runs.total; wk += (dl.wickets || []).length;
        if (!(ex.wides != null) && !(ex.noballs != null)) balls += 1;
        const delta = chaseWinProb(target, score, wk, balls, wfmt) - before;
        wBat.set(dl.batter, (wBat.get(dl.batter) || 0) + delta);
        wBowl.set(dl.bowler, (wBowl.get(dl.bowler) || 0) - delta);
      });
    });
  }
  const topN = (m, sign) => [...m.entries()].map(([name, v]) => ({ name, wpa: Math.round(v * 10) / 10 })).sort((a, b) => sign * (b.wpa - a.wpa)).slice(0, 5);
  const impactBat = topN(wBat, 1);
  const impactBowl = topN(wBowl, 1);

  return { match: { event: info.event ? info.event.name + (info.event.stage ? " · " + info.event.stage : "") : null, teams: info.teams, venue: info.venue, city: info.city, date: (info.dates || [])[0], format: info.match_type, outcome: info.outcome, playerOfMatch: info.player_of_match || [], inningsTotals, impactBat, impactBowl }, batting, bowling };
}

const SAMPLE_MATCH = {"match":{"event":"Indian Premier League · Final","teams":["Gujarat Titans","Royal Challengers Bengaluru"],"venue":"Narendra Modi Stadium, Ahmedabad","city":"Ahmedabad","date":"2026-05-31","format":"T20","outcome":{"winner":"Royal Challengers Bengaluru","by":{"wickets":5}},"playerOfMatch":["V Kohli"],"inningsTotals":[{"team":"Gujarat Titans","total":155},{"team":"Royal Challengers Bengaluru","total":161}],"impactBat":[{"name":"V Kohli","wpa":30},{"name":"JM Sharma","wpa":11},{"name":"TH David","wpa":9},{"name":"VR Iyer","wpa":2},{"name":"RM Patidar","wpa":-1}],"impactBowl":[{"name":"Mohammed Siraj","wpa":-3},{"name":"K Rabada","wpa":-4},{"name":"JO Holder","wpa":-4},{"name":"M Prasidh Krishna","wpa":-8},{"name":"Rashid Khan","wpa":-10}]},"batting":[{"name":"V Kohli","runs":75,"balls":42,"fours":9,"sixes":3,"dots":9,"out":false,"sr":178.6,"phases":{"pp":291.7,"mid":109.5,"death":188.9},"clutchIndex":106},{"name":"Washington Sundar","runs":50,"balls":37,"fours":5,"sixes":0,"dots":7,"out":false,"sr":135.1,"phases":{"pp":0,"mid":109.5,"death":168.8},"clutchIndex":125},{"name":"VR Iyer","runs":32,"balls":16,"fours":4,"sixes":2,"dots":7,"out":true,"sr":200,"phases":{"pp":200,"mid":0,"death":0},"clutchIndex":null},{"name":"TH David","runs":24,"balls":17,"fours":3,"sixes":1,"dots":8,"out":true,"sr":141.2,"phases":{"pp":0,"mid":141.2,"death":0},"clutchIndex":null},{"name":"N Sindhu","runs":20,"balls":18,"fours":3,"sixes":0,"dots":8,"out":true,"sr":111.1,"phases":{"pp":136.4,"mid":71.4,"death":0},"clutchIndex":null},{"name":"JC Buttler","runs":19,"balls":23,"fours":1,"sixes":0,"dots":7,"out":true,"sr":82.6,"phases":{"pp":100,"mid":77.8,"death":0},"clutchIndex":null},{"name":"Arshad Khan","runs":15,"balls":6,"fours":0,"sixes":2,"dots":1,"out":true,"sr":250,"phases":{"pp":0,"mid":250,"death":0},"clutchIndex":null},{"name":"RM Patidar","runs":15,"balls":13,"fours":1,"sixes":1,"dots":7,"out":true,"sr":115.4,"phases":{"pp":25,"mid":155.6,"death":0},"clutchIndex":null},{"name":"B Sai Sudharsan","runs":12,"balls":12,"fours":2,"sixes":0,"dots":7,"out":true,"sr":100,"phases":{"pp":100,"mid":0,"death":0},"clutchIndex":null},{"name":"JM Sharma","runs":11,"balls":14,"fours":1,"sixes":0,"dots":7,"out":false,"sr":78.6,"phases":{"pp":0,"mid":120,"death":55.6},"clutchIndex":71},{"name":"Shubman Gill","runs":10,"balls":8,"fours":2,"sixes":0,"dots":4,"out":true,"sr":125,"phases":{"pp":125,"mid":0,"death":0},"clutchIndex":null},{"name":"R Tewatia","runs":7,"balls":5,"fours":1,"sixes":0,"dots":1,"out":true,"sr":140,"phases":{"pp":0,"mid":100,"death":166.7},"clutchIndex":119},{"name":"JO Holder","runs":7,"balls":5,"fours":1,"sixes":0,"dots":1,"out":true,"sr":140,"phases":{"pp":0,"mid":0,"death":140},"clutchIndex":100},{"name":"Rashid Khan","runs":7,"balls":3,"fours":0,"sixes":1,"dots":1,"out":true,"sr":233.3,"phases":{"pp":0,"mid":0,"death":233.3},"clutchIndex":100},{"name":"K Rabada","runs":3,"balls":3,"fours":0,"sixes":0,"dots":1,"out":false,"sr":100,"phases":{"pp":0,"mid":0,"death":100},"clutchIndex":100},{"name":"D Padikkal","runs":1,"balls":4,"fours":0,"sixes":0,"dots":3,"out":true,"sr":25,"phases":{"pp":25,"mid":0,"death":0},"clutchIndex":null},{"name":"KH Pandya","runs":1,"balls":2,"fours":0,"sixes":0,"dots":1,"out":true,"sr":50,"phases":{"pp":0,"mid":50,"death":0},"clutchIndex":null}],"bowling":[{"name":"Rasikh Salam","wickets":3,"runs":27,"balls":24,"dots":8,"overs":"4.0","econ":6.8,"deathEcon":8},{"name":"Rashid Khan","wickets":2,"runs":25,"balls":24,"dots":9,"overs":"4.0","econ":6.3,"deathEcon":3},{"name":"B Kumar","wickets":2,"runs":29,"balls":24,"dots":11,"overs":"4.0","econ":7.3,"deathEcon":9},{"name":"JR Hazlewood","wickets":2,"runs":37,"balls":24,"dots":7,"overs":"4.0","econ":9.3,"deathEcon":16},{"name":"KH Pandya","wickets":1,"runs":23,"balls":24,"dots":7,"overs":"4.0","econ":5.8,"deathEcon":null},{"name":"Arshad Khan","wickets":1,"runs":32,"balls":24,"dots":9,"overs":"4.0","econ":8,"deathEcon":9.5},{"name":"Mohammed Siraj","wickets":1,"runs":36,"balls":24,"dots":9,"overs":"4.0","econ":9,"deathEcon":null},{"name":"K Rabada","wickets":1,"runs":44,"balls":18,"dots":7,"overs":"3.0","econ":14.7,"deathEcon":null},{"name":"M Prasidh Krishna","wickets":0,"runs":7,"balls":6,"dots":3,"overs":"1.0","econ":7,"deathEcon":null},{"name":"JO Holder","wickets":0,"runs":16,"balls":12,"dots":5,"overs":"2.0","econ":8,"deathEcon":null},{"name":"JA Duffy","wickets":0,"runs":38,"balls":24,"dots":5,"overs":"4.0","econ":9.5,"deathEcon":null}]};

/* ================================================================== */
/*  SELECTOR LOGIC                                                    */
/* ================================================================== */
function deriveOpp(weak, quality, attack) {
  const o = { spinVuln: 50, paceVuln: 50, batStr: 60, bowlStr: 60, attackSpin: 50 };
  if (weak === "spin") { o.spinVuln = 82; o.paceVuln = 42; }
  if (weak === "pace") { o.paceVuln = 84; o.spinVuln = 40; }
  if (quality === "modest") { o.batStr = 48; o.bowlStr = 46; }
  if (quality === "solid") { o.batStr = 64; o.bowlStr = 62; }
  if (quality === "elite") { o.batStr = 86; o.bowlStr = 85; }
  if (attack === "pace") o.attackSpin = 25;
  if (attack === "spin") o.attackSpin = 75;
  return o;
}
function scoreBowler(p, opp, pitch) {
  let s = p.bowl;
  if (p.type === "spin") s += (opp.spinVuln - 50) * 0.5;
  if (p.type === "pace") s += (opp.paceVuln - 50) * 0.5;
  if (pitch === "spin") s += p.type === "spin" ? 12 : -6;
  if (pitch === "pace") s += p.type === "pace" ? 12 : -6;
  if (pitch === "flat") s -= 4;
  s += (p.bowl - 70) * (opp.batStr / 100) * 0.3;
  if (p.role === "ar") s += (p.bat - 45) * 0.18;
  return s;
}
function scoreBatter(p, opp, pitch) {
  let s = p.bat;
  const handle = opp.attackSpin >= 50 ? p.vS * (opp.attackSpin / 100) + p.vP * (1 - opp.attackSpin / 100) : p.vP * (1 - opp.attackSpin / 100) + p.vS * (opp.attackSpin / 100);
  s += (handle - 60) * 0.4 * (opp.bowlStr / 100 + 0.5);
  if (pitch === "flat") s += (p.bat - 70) * 0.12;
  else if (pitch === "spin" || pitch === "pace") s += ((p.vP + p.vS) / 2 - 60) * 0.18;
  return s;
}
function buildXI(opp, pitch, fmt) {
  const used = new Set();
  const take = (p) => { used.add(p.id); return p; };
  const avail = (arr) => arr.filter((p) => !used.has(p.id));
  const keeper = take([...POOL].filter((p) => p.role === "keeper").sort((a, b) => scoreBatter(b, opp, pitch) - scoreBatter(a, opp, pitch))[0]);
  const wSpin = opp.spinVuln + (pitch === "spin" ? 30 : 0), wPace = opp.paceVuln + (pitch === "pace" ? 30 : 0);
  let nSpin = clamp(Math.round(4 * (wSpin / (wSpin + wPace))), 1, 3), nPace = 4 - nSpin;
  const pickN = (c, n) => c.sort((a, b) => scoreBowler(b, opp, pitch) - scoreBowler(a, opp, pitch)).slice(0, n).map(take);
  const spinners = pickN(avail(POOL).filter((p) => p.role === "spin"), nSpin);
  const pacers = pickN(avail(POOL).filter((p) => p.role === "pace"), nPace);
  const allr = avail(POOL).filter((p) => p.role === "ar").sort((a, b) => (scoreBowler(b, opp, pitch) + scoreBatter(b, opp, pitch)) - (scoreBowler(a, opp, pitch) + scoreBatter(a, opp, pitch))).slice(0, 2).map(take);
  const slots = 11 - used.size;
  const batters = avail(POOL).filter((p) => p.role === "bat" || p.role === "keeper").sort((a, b) => scoreBatter(b, opp, pitch) - scoreBatter(a, opp, pitch)).slice(0, slots).map(take);
  const batOptions = [keeper, ...batters].sort((a, b) => b.bat - a.bat);
  const order = [...batOptions, ...[...allr].sort((a, b) => b.bat - a.bat), ...[...spinners, ...pacers].sort((a, b) => b.bat - a.bat)].slice(0, 11);
  const bowlPool = [...spinners, ...pacers, ...allr];
  const bestAR = [...allr].sort((a, b) => scoreBowler(b, opp, pitch) - scoreBowler(a, opp, pitch))[0];
  const overs = {}; const ov = fmt.oversPerBowler;
  [...spinners, ...pacers].forEach((p) => { overs[p.id] = ov; }); if (bestAR) overs[bestAR.id] = ov;
  const composite = (p) => (p.role === "ar" ? (p.bat + p.bowl) / 2 + 8 : Math.max(p.bat, p.bowl));
  const captain = [...order].sort((a, b) => composite(b) - composite(a))[0];
  const top7 = order.slice(0, 7);
  const paceOpts = bowlPool.filter((p) => p.type === "pace"), spinOpts = bowlPool.filter((p) => p.type === "spin");
  const avg = (a, f) => (a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : 0);
  const matchupRaw = avg(bowlPool, (p) => scoreBowler(p, opp, pitch) - p.bowl) + avg(batOptions, (p) => scoreBatter(p, opp, pitch) - p.bat);
  const strengths = {
    batting: Math.round(avg(top7, (p) => p.bat)),
    pace: Math.round(avg(paceOpts, (p) => p.bowl) * (paceOpts.length >= 3 ? 1 : 0.85)),
    spin: Math.round(avg(spinOpts, (p) => p.bowl) * (spinOpts.length >= 2 ? 1 : 0.85)),
    depth: Math.round(avg(order.slice(6, 9), (p) => p.bat)),
    matchup: Math.round(clampPct(50 + matchupRaw * 1.4)),
  };
  const bench = avail(POOL).sort((a, b) => (scoreBatter(b, opp, pitch) + scoreBowler(b, opp, pitch)) - (scoreBatter(a, opp, pitch) + scoreBowler(a, opp, pitch))).slice(0, 3);
  return { order, keeper, captain, overs, strengths, bench, nSpin, nPace, spinOpts: spinOpts.length, paceOpts: paceOpts.length };
}
function pickReason(p, ctx, opp) {
  if (p.id === ctx.captain.id) return "Captain — top all-round impact in the side";
  if (p.id === ctx.keeper.id) return `Keeper — ${p.tag.toLowerCase()}`;
  if (p.role === "spin") return opp.spinVuln > 60 ? "Spin — targets their weakness vs slow bowling" : `Spin — ${p.tag.toLowerCase()}`;
  if (p.role === "pace") return opp.paceVuln > 60 ? "Pace — exploits their trouble against seam" : `Pace — ${p.tag.toLowerCase()}`;
  if (p.role === "ar") return `All-rounder — balance with bat and ${p.type}`;
  if (opp.attackSpin >= 60 && p.vS >= 78) return "Batter — strong against their spin-heavy attack";
  if (opp.attackSpin < 40 && p.vP >= 80) return "Batter — handles their pace battery";
  return `Batter — ${p.tag.toLowerCase()}`;
}

/* ================================================================== */
/*  THEME                                                             */
/* ================================================================== */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap');
.ca-root{--bg:#0A0D14;--panel:#111725;--panel2:#171E2E;--line:#242C3E;--ink:#EAEEF7;--muted:#7A879F;--cherry:#FF3B5C;--clay:#C79A5C;--gold:#FFC24B;--grass:#2FD98A;--sky:#6C7BFF;--accent:#2FE0C6;--accent2:#6C7BFF;--glow:rgba(47,224,198,.32);background:radial-gradient(1200px 620px at 50% -12%, #15203c 0%, var(--bg) 58%) fixed;color:var(--ink);font-family:'Inter',system-ui,sans-serif;min-height:100%;padding:22px 16px 64px;line-height:1.45;}
.ca-wrap{max-width:1120px;margin:0 auto;}
.ca-mono{font-family:'JetBrains Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;}
.ca-head{display:flex;align-items:center;gap:13px;margin-bottom:4px;flex-wrap:wrap;}
.ca-title{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:27px;letter-spacing:1px;text-transform:uppercase;line-height:1;}
.ca-title em{font-style:normal;background:linear-gradient(90deg,var(--accent),var(--sky));-webkit-background-clip:text;background-clip:text;color:transparent;}
.ca-sub{color:var(--muted);font-size:13px;margin:6px 0 20px;}
.ca-fmtrow{display:flex;align-items:center;gap:6px;margin-left:auto;}
.ca-fmtrow .lbl{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);}
.ca-chip{font-family:'Space Grotesk',sans-serif;font-weight:600;letter-spacing:1px;text-transform:uppercase;font-size:12px;padding:6px 13px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.02);color:var(--muted);cursor:pointer;transition:all .15s;}
.ca-chip:hover{border-color:var(--accent);color:var(--ink);}
.ca-chip--on{background:linear-gradient(180deg,var(--accent),#1fb9a3);border-color:transparent;color:#041016;box-shadow:0 0 16px var(--glow);}
.ca-tabs{display:flex;gap:4px;margin:12px 0 22px;flex-wrap:wrap;}
.ca-tab{font-family:'Space Grotesk',sans-serif;font-weight:500;letter-spacing:1px;text-transform:uppercase;font-size:12.5px;padding:8px 14px;background:rgba(255,255,255,.02);border:1px solid transparent;border-radius:10px;color:var(--muted);cursor:pointer;transition:all .15s;}
.ca-tab:hover{color:var(--ink);background:rgba(255,255,255,.05);}
.ca-tab--on{color:#041016;background:linear-gradient(180deg,var(--accent),#1fb9a3);box-shadow:0 0 16px var(--glow);}
.ca-grid{display:grid;gap:16px;}
.ca-row{display:flex;gap:16px;flex-wrap:wrap;}
.ca-col{flex:1;min-width:288px;}
.ca-card{background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,0)),var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px;box-shadow:0 1px 0 rgba(255,255,255,.03) inset,0 12px 34px rgba(0,0,0,.38);}
.ca-card h3{font-family:'Space Grotesk',sans-serif;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;font-size:13px;margin:0 0 15px;display:flex;align-items:center;gap:9px;color:var(--ink);}
.ca-card h3 .dot{width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 10px var(--accent);display:inline-block;}
.ca-label{font-size:10.5px;letter-spacing:1.4px;text-transform:uppercase;color:var(--muted);}
.ca-field{display:flex;flex-direction:column;gap:5px;}
.ca-field label{font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);}
.ca-input{background:rgba(0,0,0,.25);border:1px solid var(--line);border-radius:9px;color:var(--ink);font-family:'JetBrains Mono',monospace;font-size:15px;padding:9px 11px;width:100%;outline:none;transition:border-color .15s,box-shadow .15s;}
.ca-input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--glow);}
.ca-inrow{display:grid;gap:10px;}
.ca-btn{font-family:'Space Grotesk',sans-serif;font-weight:600;letter-spacing:1px;text-transform:uppercase;font-size:12px;padding:9px 15px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);cursor:pointer;transition:all .15s;}
.ca-btn:hover{border-color:var(--accent);box-shadow:0 0 16px var(--glow);}
.ca-btn--ghost{background:rgba(255,255,255,.02);}
.ca-note{color:var(--muted);font-size:11.5px;line-height:1.55;margin-top:14px;}
.ca-statgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden;}
.ca-stat{background:var(--panel2);padding:12px 13px;}
.ca-stat .v{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:22px;line-height:1;font-variant-numeric:tabular-nums;}
.ca-stat .l{margin-top:6px;}
.ca-stat .h{font-size:10px;margin-top:5px;color:var(--muted);}
.pc-head{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:18px;}
.pc-rating{width:86px;height:86px;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;flex:0 0 auto;border:1px solid var(--line);}
.pc-rating .n{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:32px;line-height:1;}
.pc-rating .t{font-size:9px;letter-spacing:1.2px;text-transform:uppercase;margin-top:4px;}
.pc-name input{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:22px;letter-spacing:.5px;background:transparent;border:none;border-bottom:1px solid var(--line);color:var(--ink);padding:2px 0;outline:none;width:200px;}
.pc-badge{display:inline-block;margin-top:8px;font-family:'Space Grotesk',sans-serif;letter-spacing:1px;text-transform:uppercase;font-size:11px;padding:4px 11px;border-radius:999px;background:rgba(255,255,255,.03);border:1px solid var(--line);color:var(--muted);}
.pbar{display:grid;grid-template-columns:118px 1fr 64px 34px;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);}
.pbar:last-child{border-bottom:none;}
.pbar-l{font-size:12px;color:var(--ink);}
.pbar-track{height:8px;border-radius:999px;background:rgba(0,0,0,.35);overflow:hidden;}
.pbar-fill{height:100%;border-radius:999px;box-shadow:0 0 10px rgba(255,255,255,.08);}
.pbar-v{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted);text-align:right;}
.pbar-p{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:14px;text-align:right;}
.ca-board{background:linear-gradient(180deg,#18223a,#0e1424);border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 12px 34px rgba(0,0,0,.4);}
.ca-board-top{display:flex;}
.ca-board-team{padding:16px 18px;flex:1;min-width:0;}
.ca-board-team .nm{font-family:'Space Grotesk',sans-serif;font-weight:600;text-transform:uppercase;letter-spacing:1px;font-size:15px;color:var(--muted);}
.ca-board-team .sc{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:34px;line-height:1.05;margin-top:4px;}
.ca-board-team .sc small{font-size:18px;color:var(--muted);}
.ca-board-team .ov{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted);margin-top:4px;}
.ca-board-meta{display:flex;border-left:1px solid var(--line);}
.ca-board-cell{padding:14px 18px;text-align:center;min-width:74px;border-right:1px solid var(--line);}
.ca-board-cell:last-child{border-right:none;}
.ca-board-cell .v{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:20px;}
.ca-board-cell .l{margin-top:5px;}
.ca-tug{height:34px;display:flex;align-items:center;background:#0E1114;border-top:1px solid var(--line);overflow:hidden;}
.ca-tug-fill{height:100%;display:flex;align-items:center;}
.ca-tug-label{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;padding:0 12px;white-space:nowrap;}
.ca-seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;flex-wrap:wrap;background:rgba(0,0,0,.2);}
.ca-seg button{font-family:'Space Grotesk',sans-serif;letter-spacing:.8px;text-transform:uppercase;font-size:12px;padding:8px 14px;background:transparent;border:none;color:var(--muted);cursor:pointer;transition:all .15s;}
.ca-seg button.on{background:rgba(47,224,198,.14);color:var(--accent);}
.ca-otable{width:100%;border-collapse:collapse;font-family:'JetBrains Mono',monospace;font-size:13px;}
.ca-otable th{font-family:'Space Grotesk',sans-serif;font-weight:500;letter-spacing:.8px;text-transform:uppercase;font-size:10.5px;color:var(--muted);text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);}
.ca-otable td{padding:4px 6px;border-bottom:1px solid #20262C;}
.ca-otable input{width:54px;background:var(--bg);border:1px solid var(--line);border-radius:4px;color:var(--ink);font-family:'JetBrains Mono',monospace;padding:5px 6px;font-size:13px;}
.ca-xbtn{background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;}
.ca-xbtn:hover{color:var(--cherry);}
.cg-label{font-size:10.5px;letter-spacing:1.4px;text-transform:uppercase;color:var(--muted);margin:14px 0 7px;}
.cg-label:first-child{margin-top:0;}
.xi-row{display:grid;grid-template-columns:26px 1fr auto;align-items:center;gap:10px;padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.05);}
.xi-row:hover{background:rgba(255,255,255,.03);}
.xi-pos{font-family:'JetBrains Mono',monospace;font-weight:700;color:var(--muted);font-size:13px;text-align:center;}
.xi-nm{font-family:'Space Grotesk',sans-serif;font-weight:500;font-size:15px;letter-spacing:.3px;display:flex;align-items:center;gap:7px;cursor:pointer;}
.xi-nm:hover{color:var(--accent);}
.xi-why{font-size:11px;color:var(--muted);margin-top:1px;}
.xi-tag{font-size:9px;letter-spacing:1px;text-transform:uppercase;padding:2px 6px;border-radius:3px;font-family:'Space Grotesk',sans-serif;}
.xi-meta{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted);text-align:right;white-space:nowrap;}
.sq-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:10px;}
.sq-card{display:flex;align-items:center;gap:11px;text-align:left;background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,0)),var(--panel2);border:1px solid var(--line);border-radius:12px;padding:11px 12px;cursor:pointer;color:var(--ink);font-family:inherit;width:100%;transition:all .15s;}
.sq-card:hover{border-color:var(--accent);box-shadow:0 0 18px var(--glow);}
.sq-ava{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:14px;flex:0 0 auto;}
.sq-nm{font-family:'Space Grotesk',sans-serif;font-weight:500;font-size:14.5px;letter-spacing:.3px;}
.sq-tag{font-size:10.5px;color:var(--muted);margin-top:1px;}
.sq-rate{margin-left:auto;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:14px;padding:4px 9px;border-radius:6px;align-self:flex-start;}
.sq-sec{font-family:'Space Grotesk',sans-serif;text-transform:uppercase;letter-spacing:1.5px;font-size:12px;color:var(--muted);margin:18px 0 9px;}
.fdots{display:flex;gap:3px;margin-top:5px;}
.fdot{width:9px;height:9px;border-radius:50%;}
/* profile modal */
.pm-back{position:fixed;inset:0;background:#0b0d0fdd;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;z-index:60;overflow:auto;}
.pm-sheet{background:var(--panel);border:1px solid var(--line);border-radius:12px;max-width:660px;width:100%;overflow:hidden;box-shadow:0 24px 60px #0008;}
.pm-head{display:flex;gap:14px;padding:18px;background:linear-gradient(180deg,#1b2026,#16191d);border-bottom:1px solid var(--line);align-items:center;}
.pm-ava{width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:21px;flex:0 0 auto;}
.pm-nm{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:22px;letter-spacing:.4px;line-height:1.05;}
.pm-meta{font-size:12px;color:var(--muted);margin-top:3px;}
.pm-rate{margin-left:auto;text-align:center;flex:0 0 auto;}
.pm-rate .n{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:26px;padding:7px 13px;border-radius:8px;display:inline-block;}
.pm-rate .l{font-size:9px;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);margin-top:5px;}
.pm-x{background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;align-self:flex-start;line-height:1;padding:0 2px;}
.pm-x:hover{color:var(--cherry);}
.pm-body{padding:18px;max-height:72vh;overflow:auto;}
.pm-sec{font-family:'Space Grotesk',sans-serif;text-transform:uppercase;letter-spacing:1.4px;font-size:12px;color:var(--muted);margin:18px 0 9px;}
.pm-sec:first-child{margin-top:0;}
.mg-row{display:grid;grid-template-columns:90px 1fr auto;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #20262c;font-size:13px;}
.mg-opp{font-family:'Space Grotesk',sans-serif;font-size:13px;}
.mg-opp small{display:block;color:var(--muted);font-size:10px;letter-spacing:.5px;text-transform:uppercase;font-family:'Inter';}
.mg-line{font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--ink);}
.mg-line span{color:var(--muted);}
.mg-pill{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;padding:3px 9px;border-radius:6px;min-width:40px;text-align:center;}
@media(max-width:560px){.ca-board-top{flex-direction:column;}.ca-board-meta{border-left:none;border-top:1px solid var(--line);}.ca-title{font-size:24px;}.pbar{grid-template-columns:96px 1fr 52px 30px;}.mg-row{grid-template-columns:78px 1fr auto;}}
`;

/* ================================================================== */
/*  SHARED UI                                                         */
/* ================================================================== */
function Num({ label, value, onChange, step = 1, min = 0 }) {
  return (<div className="ca-field"><label>{label}</label>
    <input className="ca-input ca-mono" type="number" value={value} step={step} min={min}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} /></div>);
}
function PctBar({ label, value, suffix, pct }) {
  const col = pctColor(pct);
  return (<div className="pbar"><div className="pbar-l">{label}</div>
    <div className="pbar-track"><div className="pbar-fill" style={{ width: `${pct}%`, background: col }} /></div>
    <div className="pbar-v">{value}{suffix}</div><div className="pbar-p" style={{ color: col }}>{pct}</div></div>);
}
function RatingBlock({ impact }) {
  const col = pctColor(impact);
  return (<div className="pc-rating" style={{ background: `${col}22`, borderColor: `${col}55` }}>
    <div className="n" style={{ color: col }}>{impact}</div><div className="t" style={{ color: col }}>{tierOf(impact)}</div></div>);
}
const tipStyle = { background: "#101316f2", border: "1px solid var(--line)", borderRadius: 6, fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--ink)", padding: "8px 10px" };
function ChartTip({ active, payload, label, unit = "" }) {
  if (!active || !payload?.length) return null;
  return (<div style={tipStyle}><div style={{ color: "var(--muted)", marginBottom: 4 }}>{label}</div>
    {payload.map((p, i) => <div key={i} style={{ color: p.color || p.stroke }}>{p.name}: {p.value}{unit}</div>)}</div>);
}
function BallMark({ s = 34 }) {
  return (<svg width={s} height={s} viewBox="0 0 40 40" aria-hidden>
    <defs><linearGradient id="spg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2FE0C6" /><stop offset="1" stopColor="#6C7BFF" /></linearGradient></defs>
    <rect x="2" y="2" width="36" height="36" rx="11" fill="#0E1524" stroke="#242C3E" />
    <rect x="2" y="2" width="36" height="36" rx="11" fill="url(#spg)" opacity="0.14" />
    <path d="M10 28 L20 11 L30 28" fill="none" stroke="url(#spg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="20" cy="28" r="1.9" fill="#2FE0C6" />
  </svg>);
}
function Choice({ label, options, value, onChange }) {
  return (<div><div className="cg-label">{label}</div>
    <div className="ca-seg">{options.map((o) => (
      <button key={o.id} className={value === o.id ? "on" : ""} onClick={() => onChange(o.id)}>{o.label}</button>))}
    </div></div>);
}

/* ================================================================== */
/*  PLAYER PROFILE (FotMob-style)                                     */
/* ================================================================== */
function ShotWheel({ shots }) {
  const cx = 160, cy = 160, rx = 132, ry = 132;
  const top = shots.slice(0, 7);
  const maxR = Math.max(1, ...top.map((s) => s.runs));
  const zoneCount = {};
  top.forEach((s) => { zoneCount[s.zone] = (zoneCount[s.zone] || 0) + 1; });
  const zoneIdx = {};
  const pt = (a, fr) => [cx + rx * fr * Math.sin(a), cy - ry * fr * Math.cos(a)];
  return (
    <svg viewBox="0 0 320 320" width="100%" style={{ maxWidth: 320, display: "block", margin: "0 auto" }}>
      <ellipse cx={cx} cy={cy} rx={rx + 6} ry={ry + 6} fill="#101a2e" stroke="#2a3a55" strokeWidth="2" />
      <ellipse cx={cx} cy={cy} rx={rx * 0.62} ry={ry * 0.62} fill="none" stroke="#2a3a55" strokeWidth="1" strokeDasharray="4 5" />
      <rect x={cx - 8} y={cy - 38} width="16" height="76" rx="2" fill="#c9a06b" opacity="0.85" />
      {top.map((s, i) => {
        const cnt = zoneCount[s.zone];
        const k = (zoneIdx[s.zone] = zoneIdx[s.zone] == null ? 0 : zoneIdx[s.zone] + 1);
        const spread = cnt > 1 ? (k - (cnt - 1) / 2) * (Math.PI / 13) : 0;
        const ang = (s.zone * Math.PI) / 4 + spread;
        const fr = 0.32 + 0.6 * (s.runs / maxR);
        const [x, y] = pt(ang, fr);
        const [lx, ly] = pt(ang, Math.min(fr + 0.17, 1.04));
        const col = SHOT_COL[s.cat];
        return (
          <g key={i}>
            <line x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke={col} strokeWidth="2.4" opacity="0.85" />
            <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="3.6" fill={col} />
            <text x={lx.toFixed(1)} y={ly.toFixed(1)} fill={col} fontSize="9" textAnchor="middle" fontFamily="Space Grotesk, sans-serif">{s.name}</text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r="4" fill="var(--ink)" />
    </svg>
  );
}

function PlayerProfile({ player, fmt, onClose }) {
  const season = useMemo(() => buildSeason(player, fmt), [player, fmt]);
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const { games, form, batAgg, bowlAgg, avgRating, shotProfile, phases, clutch } = season;
  const deathPhrase = fmt.label === "T20" ? "last 5 overs" : fmt.label === "ODI" ? "last 10 overs" : "final session";
  const rc = ratingColor(avgRating);
  const aCol = ROLE_COL[player.role];
  const batBars = batAgg ? [
    { l: "Strike rate", v: batAgg.sr, p: pctOf(batAgg.sr, fmt.bat.sr) },
    { l: "Batting average", v: batAgg.avg, p: pctOf(batAgg.avg, fmt.bat.avg) },
    { l: "vs Pace", v: player.vP, p: player.vP },
    { l: "vs Spin", v: player.vS, p: player.vS },
  ] : [];
  const bowlBars = bowlAgg ? [
    { l: "Economy", v: bowlAgg.econ, p: pctOf(bowlAgg.econ, fmt.bowl.econ, true) },
    { l: "Bowling SR", v: bowlAgg.sr, p: pctOf(bowlAgg.sr, fmt.bowl.sr, true) },
    { l: "Bowling avg", v: bowlAgg.avg, p: pctOf(bowlAgg.avg, fmt.bowl.avg, true) },
    { l: "Wicket threat", v: player.bowl, p: player.bowl },
  ] : [];
  return (
    <div className="pm-back" onClick={onClose}>
      <div className="pm-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pm-head">
          <div className="pm-ava" style={{ background: aCol, color: ROLE_TXT[player.role] }}>{initials(player.name)}</div>
          <div>
            <div className="pm-nm">{player.name}</div>
            <div className="pm-meta">{ROLE_NAME[player.role]}{player.type ? ` · ${player.type}` : ""} · age {player.age} · {player.tag}</div>
          </div>
          <div className="pm-rate">
            <div className="n" style={{ background: rc, color: ratingText(avgRating) }}>{avgRating}</div>
            <div className="l">Avg rating</div>
          </div>
          <button className="pm-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="pm-body">
          <div className="pm-sec">Recent form · last {games.length} matches ({fmt.label})</div>
          <div style={{ height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={form} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid stroke="#222a31" vertical={false} />
                <XAxis dataKey="x" tick={{ fill: "#8A929C", fontSize: 10 }} />
                <YAxis domain={[4, 10]} tick={{ fill: "#8A929C", fontSize: 10 }} />
                <Tooltip content={<ChartTip />} />
                <Line type="monotone" dataKey="r" name="Rating" stroke={rc} strokeWidth={2.4} dot={{ r: 3, fill: rc }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {batBars.length > 0 && <><div className="pm-sec">Batting profile · vs {fmt.label} field</div>
            {batBars.map((b) => <PctBar key={b.l} label={b.l} value={b.v} pct={b.p} />)}</>}
          {bowlBars.length > 0 && <><div className="pm-sec">Bowling profile · vs {fmt.label} field</div>
            {bowlBars.map((b) => <PctBar key={b.l} label={b.l} value={b.v} pct={b.p} />)}</>}

          {shotProfile && (
            <>
              <div className="pm-sec">Shot profile · where the runs go</div>
              <div className="ca-row">
                <div className="ca-col" style={{ flex: 1.05, minWidth: 232 }}><ShotWheel shots={shotProfile} /></div>
                <div className="ca-col" style={{ minWidth: 232 }}>
                  {shotProfile.slice(0, 6).map((s) => (
                    <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 0", borderBottom: "1px solid #20262c" }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: SHOT_COL[s.cat], flex: "0 0 auto" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 13.5 }}>{s.name} <span style={{ color: "var(--muted)", fontSize: 11 }}>→ {ZONE_LABELS[s.zone]}</span></div>
                        <div style={{ height: 6, borderRadius: 4, background: "#0e1114", marginTop: 4, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.min(100, s.freq * 2.4)}%`, background: SHOT_COL[s.cat] }} />
                        </div>
                      </div>
                      <div className="ca-mono" style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{s.freq}% · SR {s.sr}</div>
                    </div>
                  ))}
                  <div className="ca-note" style={{ marginTop: 10 }}>Bars show how often each shot is played; colour marks <span style={{ color: "var(--cherry)" }}>power</span>, <span style={{ color: "var(--clay)" }}>orthodox</span> and <span style={{ color: "var(--sky)" }}>spin-shot</span> strokes.</div>
                </div>
              </div>
            </>
          )}
          {clutch && (
            <>
              <div className="pm-sec">Clutch · phase splits</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: "var(--line)", border: "1px solid var(--line)", borderRadius: 7, overflow: "hidden" }}>
                {[["Powerplay SR", phases.pp.sr, "var(--ink)"], ["Middle SR", phases.mid.sr, "var(--ink)"], ["Death SR", phases.death.sr, "var(--gold)"], ["Clutch index", clutch.index, clutch.index >= 110 ? "var(--grass)" : clutch.index >= 95 ? "var(--gold)" : "var(--cherry)"]].map(([l, v, c]) => (
                  <div key={l} style={{ background: "var(--panel2)", padding: "11px 8px", textAlign: "center" }}>
                    <div className="ca-mono" style={{ fontWeight: 700, fontSize: 20, color: c }}>{v}</div>
                    <div className="ca-label" style={{ marginTop: 5 }}>{l}</div>
                  </div>
                ))}
              </div>
              <div className="ca-note" style={{ color: "var(--ink)", marginTop: 12 }}>
                In the {deathPhrase}, {player.name} favours the <b>{clutch.goTo.name.toLowerCase()} to {ZONE_LABELS[clutch.goTo.zone].toLowerCase()}</b> — {clutch.goToFreqDeath}% of death-overs balls, striking at {clutch.deathSR}. {clutch.index >= 110 ? "He lifts a gear under pressure." : clutch.index >= 95 ? "He holds his level at the death." : "His scoring tends to dip at the death."}
              </div>
            </>
          )}
          <div className="pm-sec">Match log</div>
          <div>
            {games.map((g, i) => (
              <div className="mg-row" key={i}>
                <div className="mg-opp">{g.opp}<small>{fmt.label}</small></div>
                <div className="mg-line">
                  {g.bat ? <span style={{ color: "var(--ink)" }}>{g.bat.runs}{g.bat.out ? "" : "*"} <span>({g.bat.balls})</span></span> : <span>DNB</span>}
                  {g.bowl ? <span style={{ color: "var(--ink)" }}>{"  ·  "}{g.bowl.wk}/{g.bowl.conc} <span>({g.bowl.overs} ov)</span></span> : null}
                </div>
                <div className="mg-pill" style={{ background: ratingColor(g.rating), color: ratingText(g.rating) }}>{g.rating}</div>
              </div>
            ))}
          </div>
          <div className="ca-note">Match history is a deterministic synthetic season generated from this fictional player's attributes — consistent every time you open the card, so the profile, ratings, and percentile bars all agree.</div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TAB: PLAYERS (squad browser)                                      */
/* ================================================================== */
function Players({ fmt, onOpen }) {
  const rows = useMemo(() => POOL.map((p) => ({ p, s: buildSeason(p, fmt) })), [fmt]);
  const groups = [["bat", "Batters"], ["keeper", "Wicketkeepers"], ["ar", "All-rounders"], ["pace", "Pace bowlers"], ["spin", "Spin bowlers"]];
  return (
    <div className="ca-grid">
      <div className="ca-card">
        <h3><span className="dot" />Squad · {POOL.length} players</h3>
        {groups.map(([role, title]) => (
          <div key={role}>
            <div className="sq-sec">{title}</div>
            <div className="sq-grid">
              {rows.filter((r) => r.p.role === role).sort((a, b) => b.s.avgRating - a.s.avgRating).map(({ p, s }) => {
                const last5 = s.games.slice(0, 5);
                return (
                  <button key={p.id} className="sq-card" onClick={() => onOpen(p)}>
                    <div className="sq-ava" style={{ background: ROLE_COL[p.role], color: ROLE_TXT[p.role] }}>{initials(p.name)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="sq-nm">{p.name}</div>
                      <div className="sq-tag">{p.tag}</div>
                      <div className="fdots">{last5.map((g, i) => <span key={i} className="fdot" style={{ background: ratingColor(g.rating) }} title={`${g.rating}`} />)}</div>
                      {s.clutch && <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, marginTop: 4, color: s.clutch.index >= 110 ? "var(--grass)" : "var(--muted)" }}>Clutch {s.clutch.index}</div>}
                    </div>
                    <div className="sq-rate" style={{ background: ratingColor(s.avgRating), color: ratingText(s.avgRating) }}>{s.avgRating}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="ca-note">Tap any player for a full profile — recent-form line, percentile breakdown, and match-by-match log. The colored chip is their average match rating; the dots are their last five.</div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TAB: THE SELECTOR                                                 */
/* ================================================================== */
function Selector({ fmt, onOpen }) {
  const [weak, setWeak] = useState("spin");
  const [quality, setQuality] = useState("solid");
  const [attack, setAttack] = useState("mixed");
  const [pitch, setPitch] = useState("spin");
  const opp = useMemo(() => deriveOpp(weak, quality, attack), [weak, quality, attack]);
  const xi = useMemo(() => buildXI(opp, pitch, fmt), [opp, pitch, fmt]);
  const strengthRows = [["Top-order batting", xi.strengths.batting], ["Pace threat", xi.strengths.pace], ["Spin threat", xi.strengths.spin], ["Lower-order depth", xi.strengths.depth], ["Matchup edge", xi.strengths.matchup]];
  const summary = `On a ${pitch} surface against a side that ${weak === "spin" ? "struggles against spin" : weak === "pace" ? "is troubled by pace" : "has no glaring weakness"}, the model fields ${xi.nSpin} frontline spinner${xi.nSpin > 1 ? "s" : ""} and ${xi.nPace} seamer${xi.nPace > 1 ? "s" : ""}, plus all-rounders for ${xi.spinOpts + xi.paceOpts} bowling options. ` + (quality === "elite" ? "Their elite batting is met with wicket-takers, and extra depth guards against a potent attack." : "");
  return (
    <div className="ca-grid">
      <div className="ca-row">
        <div className="ca-col">
          <div className="ca-card">
            <h3><span className="dot" />Opponent scouting</h3>
            <Choice label="Their weakness" value={weak} onChange={setWeak}
              options={[{ id: "spin", label: "vs Spin" }, { id: "pace", label: "vs Pace" }, { id: "none", label: "None" }]} />
            <Choice label="Their overall quality" value={quality} onChange={setQuality}
              options={[{ id: "modest", label: "Modest" }, { id: "solid", label: "Solid" }, { id: "elite", label: "Elite" }]} />
            <Choice label="Their attack make-up" value={attack} onChange={setAttack}
              options={[{ id: "pace", label: "Pace-heavy" }, { id: "mixed", label: "Mixed" }, { id: "spin", label: "Spin-heavy" }]} />
            <Choice label="Pitch" value={pitch} onChange={setPitch}
              options={[{ id: "pace", label: "Pace" }, { id: "balanced", label: "Balanced" }, { id: "spin", label: "Spin" }, { id: "flat", label: "Flat" }]} />
          </div>
          <div className="ca-card" style={{ marginTop: 14 }}>
            <h3><span className="dot" />Side strengths</h3>
            {strengthRows.map(([l, v]) => <PctBar key={l} label={l} value={v} pct={v} />)}
          </div>
        </div>
        <div className="ca-col" style={{ flex: 1.35 }}>
          <div className="ca-card">
            <h3><span className="dot" />Suggested XI · {fmt.label}</h3>
            <div style={{ border: "1px solid var(--line)", borderRadius: 7, overflow: "hidden" }}>
              {xi.order.map((p, i) => {
                const isC = p.id === xi.captain.id, isK = p.id === xi.keeper.id, ov = xi.overs[p.id];
                return (
                  <div className="xi-row" key={p.id}>
                    <div className="xi-pos">{i + 1}</div>
                    <div>
                      <div className="xi-nm" onClick={() => onOpen(p)}>{p.name}
                        {isC && <span className="xi-tag" style={{ background: "var(--cherry)", color: "#fff" }}>C</span>}
                        {isK && <span className="xi-tag" style={{ background: "var(--gold)", color: "#1a1a1a" }}>WK</span>}
                      </div>
                      <div className="xi-why">{pickReason(p, xi, opp)}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {ov ? <span className="xi-meta">{ov} ov</span> : null}
                      <span className="xi-tag" style={{ background: `${ROLE_COL[p.role]}22`, color: ROLE_COL[p.role], border: `1px solid ${ROLE_COL[p.role]}55` }}>{ROLE_LBL[p.role]}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="ca-note" style={{ marginTop: 14, color: "var(--ink)" }}>{summary}</div>
            <div style={{ marginTop: 14 }}>
              <div className="ca-label" style={{ marginBottom: 8 }}>Next in line — tap to scout</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {xi.bench.map((p) => (
                  <button key={p.id} className="pc-badge" style={{ marginTop: 0, cursor: "pointer" }} onClick={() => onOpen(p)}>{p.name} · {ROLE_LBL[p.role]}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="ca-note">Pick the opponent's traits and pitch above — no fiddly sliders. The Selector scores all 26 players on ability plus a matchup bonus, then builds a balanced XI. Tap any name to open their profile.</div>
    </div>
  );
}

/* ================================================================== */
/*  TAB: BATTING / BOWLING / COMPARE                                  */
/* ================================================================== */
const ZONE_LABELS = ["Straight", "Cover", "Point", "Third Man", "Fine Leg", "Sq. Leg", "Mid-wkt", "Long-on"];
function WagonWheel({ zones }) {
  const cx = 160, cy = 160, rx = 138, ry = 138;
  const max = Math.max(1, ...zones);
  const colorFor = (v) => pctColor((v / max) * 100);
  const pt = (a, fr = 1) => [cx + rx * fr * Math.sin(a), cy - ry * fr * Math.cos(a)];
  return (
    <svg viewBox="0 0 320 320" width="100%" style={{ maxWidth: 330, display: "block", margin: "0 auto" }}>
      <ellipse cx={cx} cy={cy} rx={rx + 6} ry={ry + 6} fill="#101a2e" stroke="#2a3a55" strokeWidth="2" />
      <ellipse cx={cx} cy={cy} rx={rx * 0.62} ry={ry * 0.62} fill="none" stroke="#2a3a55" strokeWidth="1" strokeDasharray="4 5" />
      <rect x={cx - 9} y={cy - 40} width="18" height="80" rx="2" fill="#c9a06b" opacity="0.85" />
      {zones.map((v, i) => {
        const ang = (i * Math.PI) / 4, fr = 0.18 + 0.82 * (v / max);
        const [x0, y0] = pt(ang - Math.PI / 8, fr), [x1, y1] = pt(ang + Math.PI / 8, fr);
        const path = `M ${cx} ${cy} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${(rx * fr).toFixed(1)} ${(ry * fr).toFixed(1)} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
        const [lx, ly] = pt(ang, 1.02), [vx, vy] = pt(ang, fr * 0.62);
        return (<g key={i}>
          {v > 0 && <path d={path} fill={colorFor(v)} opacity="0.5" stroke={colorFor(v)} strokeWidth="1" />}
          <text x={lx} y={ly} fill="var(--muted)" fontSize="9.5" textAnchor="middle" fontFamily="Space Grotesk, sans-serif">{ZONE_LABELS[i]}</text>
          {v > 0 && <text x={vx} y={vy + 4} fill="#fff" fontSize="12" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontWeight="700">{v}</text>}
        </g>);
      })}
      <circle cx={cx} cy={cy} r="4" fill="var(--ink)" />
    </svg>
  );
}
function Batting({ fmt }) {
  const [name, setName] = useState("Batter A");
  const [inn, setInn] = useState({ runs: 84, balls: 51, fours: 7, sixes: 4, dots: 18 });
  const [zones, setZones] = useState([14, 12, 6, 4, 5, 18, 20, 5]);
  const m = battingMetrics(inn, fmt);
  const set = (k, v) => setInn((s) => ({ ...s, [k]: v }));
  const role = m.pBnd > 70 && m.sr > fmt.parSR ? "Power Striker" : m.pRot > 68 ? "Accumulator" : m.pSR > 60 ? "Aggressor" : "Anchor";
  return (
    <div className="ca-grid">
      <div className="ca-card">
        <div className="pc-head">
          <RatingBlock impact={m.impact} />
          <div className="pc-name"><input value={name} onChange={(e) => setName(e.target.value)} />
            <div><span className="pc-badge">{role}</span> <span className="pc-badge">{fmt.label} batting</span></div></div>
        </div>
        <div className="ca-row">
          <div className="ca-col" style={{ flex: 1.3 }}>
            <div className="ca-label" style={{ marginBottom: 8 }}>Percentile profile · vs {fmt.label} field</div>
            <PctBar label="Strike rate" value={m.sr} pct={m.pSR} />
            <PctBar label="Boundary %" value={m.boundaryPctRuns} suffix="%" pct={m.pBnd} />
            <PctBar label="Strike rotation" value={`${m.dotPct}% dot`} pct={m.pRot} />
            <PctBar label="Boundary rate" value={`${m.bpb}/bnd`} pct={m.pFreq} />
            <PctBar label="Crafted Impact" value={tierOf(m.impact)} pct={m.impact} />
            <div className="ca-statgrid" style={{ marginTop: 12 }}>
              <div className="ca-stat"><div className="v" style={{ color: m.raa >= 0 ? "var(--grass)" : "var(--cherry)" }}>{m.raa > 0 ? "+" : ""}{m.raa}</div><div className="l ca-label">Runs vs par</div><div className="h">RAA</div></div>
              <div className="ca-stat"><div className="v" style={{ color: pctColor(clampPct(m.trueSR - 40)) }}>{m.trueSR}</div><div className="l ca-label">True SR</div><div className="h">100 = par</div></div>
              <div className="ca-stat"><div className="v">{m.scoringPct}%</div><div className="l ca-label">Scoring shots</div></div>
            </div>
          </div>
          <div className="ca-col">
            <div className="ca-inrow" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Num label="Runs" value={inn.runs} onChange={(v) => set("runs", v)} />
              <Num label="Balls" value={inn.balls} onChange={(v) => set("balls", v)} />
              <Num label="Fours" value={inn.fours} onChange={(v) => set("fours", v)} />
              <Num label="Sixes" value={inn.sixes} onChange={(v) => set("sixes", v)} />
              <Num label="Dot balls" value={inn.dots} onChange={(v) => set("dots", v)} />
            </div>
          </div>
        </div>
      </div>
      <div className="ca-card">
        <h3><span className="dot" />Wagon wheel — runs by region</h3>
        <div className="ca-row">
          <div className="ca-col" style={{ flex: 1.2 }}><WagonWheel zones={zones} /></div>
          <div className="ca-col">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {ZONE_LABELS.map((z, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="ca-label" style={{ flex: 1 }}>{z}</span>
                  <input className="ca-input ca-mono" style={{ width: 56, padding: "5px 7px", fontSize: 13 }} type="number"
                    value={zones[i]} onChange={(e) => setZones((arr) => arr.map((x, j) => j === i ? Math.max(0, Number(e.target.value) || 0) : x))} />
                </div>))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function Bowling({ fmt }) {
  const [name, setName] = useState("Bowler A");
  const [sp, setSp] = useState({ balls: 24, runs: 29, wickets: 3, dots: 11, fours: 2, sixes: 1 });
  const m = bowlingMetrics(sp, fmt);
  const set = (k, v) => setSp((s) => ({ ...s, [k]: v }));
  const role = m.pSR > 72 ? "Strike Bowler" : m.pEcon > 70 ? "Containment Specialist" : m.pDot > 65 ? "Pressure Builder" : "Workhorse";
  const breakdown = [
    { name: "Dots", v: sp.dots, fill: "var(--grass)" },
    { name: "1s/2s", v: Math.max(0, sp.balls - sp.dots - sp.fours - sp.sixes), fill: "var(--clay)" },
    { name: "Fours", v: sp.fours, fill: "var(--gold)" },
    { name: "Sixes", v: sp.sixes, fill: "var(--cherry)" },
  ];
  return (
    <div className="ca-grid">
      <div className="ca-card">
        <div className="pc-head">
          <RatingBlock impact={m.impact} />
          <div className="pc-name"><input value={name} onChange={(e) => setName(e.target.value)} />
            <div><span className="pc-badge">{role}</span> <span className="pc-badge">{fmt.label} bowling</span></div></div>
        </div>
        <div className="ca-row">
          <div className="ca-col" style={{ flex: 1.3 }}>
            <div className="ca-label" style={{ marginBottom: 8 }}>Percentile profile · vs {fmt.label} field</div>
            <PctBar label="Economy" value={m.econ} pct={m.pEcon} />
            <PctBar label="Dot pressure" value={`${m.dotPct}%`} pct={m.pDot} />
            <PctBar label="Wicket-taking" value={m.sr ? `SR ${m.sr}` : "—"} pct={m.pSR} />
            <PctBar label="Average" value={m.avg ? m.avg : "—"} pct={m.pAvg} />
            <PctBar label="Crafted Impact" value={tierOf(m.impact)} pct={m.impact} />
            <div className="ca-statgrid" style={{ marginTop: 12 }}>
              <div className="ca-stat"><div className="v" style={{ color: m.runsSaved >= 0 ? "var(--grass)" : "var(--cherry)" }}>{m.runsSaved > 0 ? "+" : ""}{m.runsSaved}</div><div className="l ca-label">Runs saved</div><div className="h">vs par econ</div></div>
              <div className="ca-stat"><div className="v" style={{ color: pctColor(clampPct(160 - m.trueEcon)) }}>{m.trueEcon}</div><div className="l ca-label">True econ</div><div className="h">100 = par</div></div>
              <div className="ca-stat"><div className="v">{sp.balls ? Math.round(((sp.fours + sp.sixes) / sp.balls) * 100) : 0}%</div><div className="l ca-label">Boundary balls</div></div>
            </div>
          </div>
          <div className="ca-col">
            <div className="ca-inrow" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Num label="Balls" value={sp.balls} onChange={(v) => set("balls", v)} />
              <Num label="Runs" value={sp.runs} onChange={(v) => set("runs", v)} />
              <Num label="Wickets" value={sp.wickets} onChange={(v) => set("wickets", v)} />
              <Num label="Dots" value={sp.dots} onChange={(v) => set("dots", v)} />
              <Num label="Fours" value={sp.fours} onChange={(v) => set("fours", v)} />
              <Num label="Sixes" value={sp.sixes} onChange={(v) => set("sixes", v)} />
            </div>
          </div>
        </div>
      </div>
      <div className="ca-card">
        <h3><span className="dot" />Delivery outcomes</h3>
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={breakdown} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#222a31" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#8A929C", fontSize: 11 }} />
              <YAxis tick={{ fill: "#8A929C", fontSize: 11 }} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="v" name="Balls" radius={[3, 3, 0, 0]}>{breakdown.map((d, i) => <Cell key={i} fill={d.fill} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
function Compare({ fmt }) {
  const [pA, setPA] = useState({ name: "Player A", runs: 84, balls: 51, fours: 7, sixes: 4, dots: 18 });
  const [pB, setPB] = useState({ name: "Player B", runs: 61, balls: 49, fours: 5, sixes: 2, dots: 22 });
  const A = battingMetrics(pA, fmt), B = battingMetrics(pB, fmt);
  const axes = [
    { axis: "Strike rate", A: A.pSR, B: B.pSR }, { axis: "Boundary %", A: A.pBnd, B: B.pBnd },
    { axis: "Rotation", A: A.pRot, B: B.pRot }, { axis: "Boundary rate", A: A.pFreq, B: B.pFreq }, { axis: "Impact", A: A.impact, B: B.impact },
  ];
  const editor = (p, setP, color, m) => (
    <div className="ca-card">
      <h3><span className="dot" style={{ background: color }} />
        <input className="ca-input ca-mono" style={{ width: 150, padding: "4px 8px", fontSize: 14 }} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></h3>
      <div className="ca-inrow" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {["runs", "balls", "fours", "sixes", "dots"].map((k) => <Num key={k} label={k} value={p[k]} onChange={(v) => setP({ ...p, [k]: v })} />)}
      </div>
      <div style={{ marginTop: 12 }}><PctBar label="Strike rate" value={m.sr} pct={m.pSR} /><PctBar label="Impact" value={tierOf(m.impact)} pct={m.impact} /></div>
    </div>
  );
  return (
    <div className="ca-grid">
      <div className="ca-row"><div className="ca-col">{editor(pA, setPA, "var(--cherry)", A)}</div><div className="ca-col">{editor(pB, setPB, "var(--sky)", B)}</div></div>
      <div className="ca-card">
        <h3><span className="dot" />Head-to-head percentile profile</h3>
        <div style={{ height: 340 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={axes} outerRadius="74%">
              <PolarGrid stroke="#2b333a" />
              <PolarAngleAxis dataKey="axis" tick={{ fill: "#8A929C", fontSize: 12 }} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar name={pA.name} dataKey="A" stroke="var(--cherry)" fill="var(--cherry)" fillOpacity={0.32} strokeWidth={2} />
              <Radar name={pB.name} dataKey="B" stroke="var(--sky)" fill="var(--sky)" fillOpacity={0.22} strokeWidth={2} />
              <Legend wrapperStyle={{ fontFamily: "Space Grotesk, sans-serif", textTransform: "uppercase", letterSpacing: "1px", fontSize: 12 }} />
              <Tooltip content={<ChartTip />} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="ca-note">Every axis is a percentile (0–100) vs the {fmt.label} field, so a bigger shape means a more complete batter.</div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TAB: MATCH CENTER                                                 */
/* ================================================================== */
function MatchCenter({ fmt }) {
  const [mode, setMode] = useState("chase");
  const [target, setTarget] = useState(178);
  const [score, setScore] = useState(96);
  const [wkts, setWkts] = useState(3);
  const [overs, setOvers] = useState(11);
  const [ballsInOver, setBallsInOver] = useState(2);
  const [overData, setOverData] = useState([9, 14, 6, 11, 8, 13, 7, 10, 6, 15, 11].map((r, i) => ({ o: i + 1, r, w: [1, 6, 10].includes(i) ? 1 : 0 })));
  const ballsBowled = overs * 6 + ballsInOver;
  const win = chaseWinProb(target, score, wkts, ballsBowled, fmt);
  const proj = projectScore(score, wkts, ballsBowled, fmt);
  const runsNeeded = target - score, ballsLeft = fmt.ballsInnings - ballsBowled;
  const reqRR = ballsLeft > 0 ? r2((runsNeeded / ballsLeft) * 6) : 0, crr = ballsBowled ? r2((score / ballsBowled) * 6) : 0;
  const chartData = useMemo(() => { let cum = 0; return overData.map((d) => { cum += d.r; return { name: `${d.o}`, runs: d.r, cum, wkt: d.w, par: mode === "chase" ? Math.round((target / fmt.ballsInnings) * 6 * d.o) : null }; }); }, [overData, mode, target, fmt]);
  const setOver = (i, key, val) => setOverData((a) => a.map((d, j) => j === i ? { ...d, [key]: Number(val) || 0 } : d));
  const addOver = () => setOverData((a) => [...a, { o: a.length + 1, r: 0, w: 0 }]);
  const delOver = (i) => setOverData((a) => a.filter((_, j) => j !== i).map((d, j) => ({ ...d, o: j + 1 })));
  return (
    <div className="ca-grid">
      <div className="ca-board">
        <div className="ca-board-top">
          <div className="ca-board-team">
            <div className="nm">{mode === "chase" ? "Chasing XI" : "Batting XI"}</div>
            <div className="sc ca-mono">{score}<small>/{wkts}</small></div>
            <div className="ov">{overs}.{ballsInOver} ov · {mode === "chase" ? `target ${target}` : `${fmt.label} innings`}</div>
          </div>
          <div className="ca-board-meta">
            <div className="ca-board-cell"><div className="v ca-mono">{crr}</div><div className="l ca-label">CRR</div></div>
            {mode === "chase"
              ? <><div className="ca-board-cell"><div className="v ca-mono" style={{ color: reqRR > crr ? "var(--cherry)" : "var(--grass)" }}>{reqRR}</div><div className="l ca-label">Req RR</div></div>
                  <div className="ca-board-cell"><div className="v ca-mono">{Math.max(0, runsNeeded)}</div><div className="l ca-label">Need</div></div>
                  <div className="ca-board-cell"><div className="v ca-mono">{Math.max(0, ballsLeft)}</div><div className="l ca-label">Balls</div></div></>
              : <><div className="ca-board-cell"><div className="v ca-mono" style={{ color: "var(--gold)" }}>{proj.proj}</div><div className="l ca-label">Projected</div></div>
                  <div className="ca-board-cell"><div className="v ca-mono">{proj.low}–{proj.high}</div><div className="l ca-label">Range</div></div></>}
          </div>
        </div>
        {mode === "chase" && (
          <div className="ca-tug">
            <div className="ca-tug-fill" style={{ width: `${win}%`, background: "var(--cherry)" }}><span className="ca-tug-label" style={{ color: "#fff" }}>Chasing {win}%</span></div>
            <div className="ca-tug-fill" style={{ width: `${100 - win}%`, background: "var(--sky)", justifyContent: "flex-end", marginLeft: "auto" }}><span className="ca-tug-label" style={{ color: "#fff" }}>{100 - win}% Defending</span></div>
          </div>
        )}
      </div>
      <div className="ca-row">
        <div className="ca-col">
          <div className="ca-card">
            <h3><span className="dot" />Match state</h3>
            <div style={{ marginBottom: 14 }}><div className="ca-seg">
              <button className={mode === "chase" ? "on" : ""} onClick={() => setMode("chase")}>Chasing</button>
              <button className={mode === "set" ? "on" : ""} onClick={() => setMode("set")}>Setting</button>
            </div></div>
            <div className="ca-inrow" style={{ gridTemplateColumns: "1fr 1fr" }}>
              {mode === "chase" && <Num label="Target" value={target} onChange={setTarget} />}
              <Num label="Score" value={score} onChange={setScore} />
              <Num label="Wkts down" value={wkts} onChange={setWkts} />
              <Num label="Overs done" value={overs} onChange={setOvers} />
              <Num label="Balls this over" value={ballsInOver} onChange={setBallsInOver} />
            </div>
          </div>
        </div>
        <div className="ca-col" style={{ flex: 1.4 }}>
          <div className="ca-card">
            <h3><span className="dot" />Worm — cumulative runs</h3>
            <div style={{ height: 190 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#222a31" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#8A929C", fontSize: 11 }} /><YAxis tick={{ fill: "#8A929C", fontSize: 11 }} />
                  <Tooltip content={<ChartTip />} />
                  <Line type="monotone" dataKey="cum" name="Runs" stroke="var(--cherry)" strokeWidth={2.4} dot={false} />
                  {mode === "chase" && <Line type="monotone" dataKey="par" name="Target pace" stroke="var(--sky)" strokeWidth={1.6} strokeDasharray="5 5" dot={false} />}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="ca-card" style={{ marginTop: 14 }}>
            <h3><span className="dot" />Manhattan — runs per over</h3>
            <div style={{ height: 170 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#222a31" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#8A929C", fontSize: 11 }} /><YAxis tick={{ fill: "#8A929C", fontSize: 11 }} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="runs" name="Runs" radius={[2, 2, 0, 0]}>{chartData.map((d, i) => <Cell key={i} fill={d.wkt > 0 ? "var(--gold)" : "var(--clay)"} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="ca-note">Bars turn <span style={{ color: "var(--gold)" }}>gold</span> on wicket overs.</div>
          </div>
        </div>
      </div>
      <div className="ca-card">
        <h3><span className="dot" />Over-by-over editor</h3>
        <div style={{ overflowX: "auto" }}>
          <table className="ca-otable">
            <thead><tr><th>Over</th><th>Runs</th><th>Wkts</th><th></th></tr></thead>
            <tbody>{overData.map((d, i) => (
              <tr key={i}><td>{d.o}</td>
                <td><input type="number" value={d.r} onChange={(e) => setOver(i, "r", e.target.value)} /></td>
                <td><input type="number" value={d.w} onChange={(e) => setOver(i, "w", e.target.value)} /></td>
                <td><button className="ca-xbtn" onClick={() => delOver(i)}>×</button></td></tr>))}
            </tbody>
          </table>
        </div>
        <button className="ca-btn ca-btn--ghost" style={{ marginTop: 12 }} onClick={addOver}>+ Add over</button>
      </div>
      <div className="ca-note">Win probability and projections are transparent heuristics based on required rate, wickets in hand, and balls left — for reading momentum, not betting-grade prediction.</div>
    </div>
  );
}

/* ================================================================== */
/*  TAB: ASK (StatMuse-style natural-language Q&A)                    */
/* ================================================================== */
function callMessages(userContent, web, maxTokens) {
  const body = { model: "claude-sonnet-4-6", max_tokens: maxTokens || 1000, messages: [{ role: "user", content: userContent }] };
  if (web) body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  return fetch("/api/claude", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json());
}

/* ================================================================== */
/*  TAB: IMPORT (real Cricsheet match)                                */
/* ================================================================== */
function RealPlayerProfile({ player, fmt, onClose }) {
  useEffect(() => { const h = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  const { bat, bowl, name } = player;
  const role = bat && bowl ? "All-rounder" : bowl ? "Bowler" : "Batter";
  const aCol = bat && bowl ? "var(--grass)" : bowl ? "var(--sky)" : "var(--clay)";
  const aTxt = bowl && !bat ? "#fff" : bat && bowl ? "#fff" : "#11151a";
  const bm = bat ? battingMetrics(bat, fmt) : null;
  const wm = bowl ? bowlingMetrics({ balls: bowl.balls, runs: bowl.runs, wickets: bowl.wickets, dots: bowl.dots }, fmt) : null;
  const impact = bm ? bm.impact : wm.impact;
  const ic = pctColor(impact);
  const icTxt = impact >= 45 && impact < 76 ? "#11151a" : "#fff";
  const deathPhrase = fmt.label === "T20" ? "last 5 overs" : fmt.label === "ODI" ? "last 10 overs" : "final session";
  return (
    <div className="pm-back" onClick={onClose}>
      <div className="pm-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="pm-head">
          <div className="pm-ava" style={{ background: aCol, color: aTxt }}>{initials(name)}</div>
          <div><div className="pm-nm">{name}</div><div className="pm-meta">{role} · this match</div></div>
          <div className="pm-rate"><div className="n" style={{ background: ic, color: icTxt }}>{impact}</div><div className="l">Impact</div></div>
          <button className="pm-x" onClick={onClose}>×</button>
        </div>
        <div className="pm-body">
          <div className="pm-sec">This match</div>
          <div className="ca-mono" style={{ fontSize: 15 }}>
            {bat ? <span>{bat.runs}{bat.out ? "" : "*"} ({bat.balls}) · SR {bat.sr}{bat.fours || bat.sixes ? ` · ${bat.fours}×4 ${bat.sixes}×6` : ""}</span> : null}
            {bat && bowl ? <span style={{ color: "var(--muted)" }}>{"   ·   "}</span> : null}
            {bowl ? <span>{bowl.wickets}/{bowl.runs} ({bowl.overs} ov) · econ {bowl.econ}</span> : null}
          </div>
          {bm && (<><div className="pm-sec">Batting · vs {fmt.label} field</div>
            <PctBar label="Strike rate" value={bm.sr} pct={bm.pSR} />
            <PctBar label="Boundary %" value={bm.boundaryPctRuns} suffix="%" pct={bm.pBnd} />
            <PctBar label="Strike rotation" value={`${bm.dotPct}% dot`} pct={bm.pRot} />
            <PctBar label="Boundary rate" value={`${bm.bpb}/bnd`} pct={bm.pFreq} />
            <PctBar label="Match Impact" value={tierOf(bm.impact)} pct={bm.impact} /></>)}
          {bat && (<><div className="pm-sec">Clutch · phase splits</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: "var(--line)", border: "1px solid var(--line)", borderRadius: 7, overflow: "hidden" }}>
              {[["Powerplay SR", bat.phases.pp, "var(--ink)"], ["Middle SR", bat.phases.mid, "var(--ink)"], ["Death SR", bat.phases.death, "var(--gold)"], ["Clutch index", bat.clutchIndex == null ? "–" : bat.clutchIndex, bat.clutchIndex == null ? "var(--muted)" : bat.clutchIndex >= 110 ? "var(--grass)" : bat.clutchIndex >= 95 ? "var(--gold)" : "var(--cherry)"]].map(([l, v, c]) => (
                <div key={l} style={{ background: "var(--panel2)", padding: "11px 8px", textAlign: "center" }}><div className="ca-mono" style={{ fontWeight: 700, fontSize: 20, color: c }}>{v}</div><div className="ca-label" style={{ marginTop: 5 }}>{l}</div></div>))}
            </div>
            {bat.clutchIndex != null && <div className="ca-note" style={{ color: "var(--ink)", marginTop: 12 }}>In the {deathPhrase}, {name} struck at {bat.phases.death} (clutch index {bat.clutchIndex}). {bat.clutchIndex >= 110 ? "Lifted a gear under pressure." : bat.clutchIndex >= 95 ? "Held level at the death." : "Tailed off at the death."}</div>}</>)}
          {wm && (<><div className="pm-sec">Bowling · vs {fmt.label} field</div>
            <PctBar label="Economy" value={wm.econ} pct={wm.pEcon} />
            <PctBar label="Dot pressure" value={`${wm.dotPct}%`} pct={wm.pDot} />
            <PctBar label="Wicket-taking" value={wm.sr ? `SR ${wm.sr}` : "—"} pct={wm.pSR} />
            <PctBar label="Average" value={wm.avg ? wm.avg : "—"} pct={wm.pAvg} />
            <PctBar label="Match Impact" value={tierOf(wm.impact)} pct={wm.impact} />
            {bowl.deathEcon != null && <div className="ca-note" style={{ marginTop: 8 }}>Death-overs economy: <b style={{ color: "var(--ink)" }}>{bowl.deathEcon}</b></div>}</>)}
          <div className="ca-note">Real Cricsheet data. Shot profile isn't shown — ball-tracking (shot type/placement) isn't part of this source.</div>
        </div>
      </div>
    </div>
  );
}
function ImportTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [sel, setSel] = useState(null);
  const [report, setReport] = useState(null);
  const [rLoad, setRLoad] = useState(false);
  const fmt = data ? FORMATS[fmtKeyFromType(data.match.format)] : FORMATS.T20;
  const players = useMemo(() => {
    const m = new Map();
    if (data) {
      data.batting.forEach((b) => { const e = m.get(b.name) || { name: b.name }; e.bat = b; m.set(b.name, e); });
      data.bowling.forEach((b) => { const e = m.get(b.name) || { name: b.name }; e.bowl = b; m.set(b.name, e); });
    }
    return m;
  }, [data]);
  function onFile(e) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      try { const res = parseCricsheet(JSON.parse(reader.result)); if (!res.batting.length) throw new Error("empty"); setData(res); setError(null); setSel(null); setReport(null); }
      catch (err) { setData(null); setError("Couldn't read that as a Cricsheet match file. Grab match JSONs from cricsheet.org."); }
    };
    reader.readAsText(f);
  }
  async function genReport() {
    if (!data) return;
    setRLoad(true); setReport(null);
    try {
      const dataset = {
        match: { event: data.match.event, teams: data.match.teams, venue: data.match.venue, result: data.match.outcome, potm: data.match.playerOfMatch, innings: data.match.inningsTotals, target: (data.match.inningsTotals[0] ? data.match.inningsTotals[0].total + 1 : null) },
        batting: data.batting.map((b) => ({ name: b.name, runs: b.runs, balls: b.balls, sr: b.sr, fours: b.fours, sixes: b.sixes, dots: b.dots, out: b.out, phaseSR: b.phases, clutchIndex: b.clutchIndex })),
        bowling: data.bowling.map((b) => ({ name: b.name, figures: `${b.wickets}/${b.runs}`, overs: b.overs, econ: b.econ, dotPct: b.dotPct, deathEcon: b.deathEcon })),
        wpa: { batting: data.match.impactBat, bowling: data.match.impactBowl },
      };
      const prompt = `You are a senior cricket analyst producing a DATA-DRIVEN META-ANALYSIS of a completed match — not a summary. Interrogate the numbers below to explain WHY the result happened. Use phase strike rates (powerplay/middle/death), Win-Probability-Added (WPA, in win% each player swung), economy, dot%, death economy and clutch index. Quantify decisive contributions, compare the two innings phase by phase, identify the single biggest turning point, and note a matchup or tactic that mattered. Cite specific numbers throughout.

Return ONLY JSON, no markdown:
{"title":"a sharp one-line verdict","sections":[{"heading":"How it was won","body":"..."},{"heading":"The phase battle","body":"powerplay vs middle vs death for both innings, with numbers"},{"heading":"Win-probability swing","body":"who moved the match most, per WPA, and when"},{"heading":"Turning point","body":"the decisive passage"},{"heading":"Tactical read","body":"one forward-looking takeaway"}]}

DATA:\n${JSON.stringify(dataset)}`;
      const res = await callMessages(prompt, false, 1600);
      const text = (res && res.content ? res.content.filter((x) => x.type === "text").map((x) => x.text).join("\n") : "").trim();
      let parsed; try { parsed = JSON.parse(text.replace(/```json|```/g, "").trim()); } catch (e) { parsed = { title: "", sections: [{ heading: "Analysis", body: text || "No report returned." }] }; }
      setReport(parsed);
    } catch (e) { setReport({ title: "", sections: [{ heading: "Unavailable", body: "Couldn't reach the model to run the analysis (in-product AI may be off in this preview)." }] }); }
    finally { setRLoad(false); }
  }
  function loadSample() { setData(SAMPLE_MATCH); setFileName("IPL 2026 Final · Gujarat Titans v RCB"); setError(null); setSel(null); setReport(null); }
  return (
    <div className="ca-grid">
      <div className="ca-card">
        <h3><span className="dot" />Import a real match</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <input id="cric-file" type="file" accept=".json,application/json" onChange={onFile} style={{ display: "none" }} />
          <button className="ca-btn" style={{ background: "linear-gradient(180deg,var(--accent),#1fb9a3)", borderColor: "transparent", color: "#041016" }} onClick={loadSample}>Load IPL 2026 Final</button>
          <label htmlFor="cric-file" className="ca-btn" style={{ cursor: "pointer" }}>Or choose a Cricsheet file</label>
          {fileName && <span className="ca-mono" style={{ fontSize: 12, color: "var(--muted)" }}>{fileName}</span>}
        </div>
        {error && <div className="ca-note" style={{ color: "var(--cherry)" }}>{error}</div>}
        {!data && !error && <div className="ca-note">Real IPL 2026 final is built in — tap <b>Load IPL 2026 Final</b> to see Kohli's chase analysed. Or grab any match JSON from cricsheet.org (Tests, ODIs, T20s, IPL, BBL, The Hundred…). Everything is parsed in your browser.</div>}
      </div>
      {data && (
        <>
          <div className="ca-board">
            <div className="ca-board-top">
              <div className="ca-board-team" style={{ flex: 2 }}>
                <div className="nm">{data.match.event || "Match"}</div>
                <div className="sc ca-mono" style={{ fontSize: 21 }}>{data.match.teams ? data.match.teams.join("  v  ") : ""}</div>
                <div className="ov">{[data.match.venue, data.match.date].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="ca-board-meta">
                {data.match.inningsTotals.map((t, i) => (
                  <div className="ca-board-cell" key={i}><div className="v ca-mono">{t.total}</div><div className="l ca-label">{t.team.split(" ").slice(-1)[0]}</div></div>
                ))}
              </div>
            </div>
            <div className="ca-tug" style={{ padding: "0 16px", justifyContent: "space-between" }}>
              <span className="ca-tug-label" style={{ color: "var(--ink)" }}>{resultText(data.match.outcome)}</span>
              {data.match.playerOfMatch.length ? <span className="ca-tug-label" style={{ color: "var(--gold)" }}>POTM · {data.match.playerOfMatch.join(", ")}</span> : null}
            </div>
          </div>
          <div className="ca-row">
            <div className="ca-col">
              <div className="ca-card">
                <h3><span className="dot" />Batting · tap a player</h3>
                {data.batting.map((b, i) => {
                  const bm = battingMetrics(b, fmt); const c = pctColor(bm.impact);
                  return (
                    <div key={b.name} className="xi-row" style={{ gridTemplateColumns: "20px 1fr auto", cursor: "pointer" }} onClick={() => setSel(players.get(b.name))}>
                      <div className="xi-pos">{i + 1}</div>
                      <div><div className="xi-nm">{b.name}</div><div className="xi-why ca-mono">{b.runs}{b.out ? "" : "*"} ({b.balls}) · SR {b.sr}{b.clutchIndex != null ? ` · clutch ${b.clutchIndex}` : ""}</div></div>
                      <span className="xi-tag" style={{ background: `${c}22`, color: c, border: `1px solid ${c}55` }}>{bm.impact}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="ca-col">
              <div className="ca-card">
                <h3><span className="dot" />Bowling · tap a player</h3>
                {data.bowling.map((b) => {
                  const wm = bowlingMetrics({ balls: b.balls, runs: b.runs, wickets: b.wickets, dots: b.dots }, fmt); const c = pctColor(wm.impact);
                  return (
                    <div key={b.name} className="xi-row" style={{ gridTemplateColumns: "1fr auto", cursor: "pointer" }} onClick={() => setSel(players.get(b.name))}>
                      <div><div className="xi-nm">{b.name}</div><div className="xi-why ca-mono">{b.wickets}/{b.runs} ({b.overs}) · econ {b.econ}{b.deathEcon != null ? ` · death ${b.deathEcon}` : ""}</div></div>
                      <span className="xi-tag" style={{ background: `${c}22`, color: c, border: `1px solid ${c}55` }}>{wm.impact}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {data.match.impactBat.length > 0 && (
            <div className="ca-card">
              <h3><span className="dot" />Match impact · win probability added</h3>
              <div className="ca-row">
                <div className="ca-col">
                  <div className="ca-label" style={{ marginBottom: 8 }}>Batting (WPA, win% added)</div>
                  {data.match.impactBat.map((x) => <div key={x.name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #20262c" }}><span style={{ fontFamily: "Space Grotesk, sans-serif" }}>{x.name}</span><span className="ca-mono" style={{ color: x.wpa >= 0 ? "var(--grass)" : "var(--cherry)" }}>{x.wpa > 0 ? "+" : ""}{x.wpa}</span></div>)}
                </div>
                <div className="ca-col">
                  <div className="ca-label" style={{ marginBottom: 8 }}>Bowling (WPA, win% added)</div>
                  {data.match.impactBowl.map((x) => <div key={x.name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #20262c" }}><span style={{ fontFamily: "Space Grotesk, sans-serif" }}>{x.name}</span><span className="ca-mono" style={{ color: x.wpa >= 0 ? "var(--grass)" : "var(--cherry)" }}>{x.wpa > 0 ? "+" : ""}{x.wpa}</span></div>)}
                </div>
              </div>
              <div className="ca-note">Win-Probability-Added sums each player's swing in the chasing side's win chance ball by ball — crediting runs and wickets by how much they actually moved the match, not raw volume.</div>
            </div>
          )}
          <div className="ca-card">
            <h3><span className="dot" />AI match meta-analysis</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="ca-btn" style={{ background: "linear-gradient(180deg,var(--accent),#1fb9a3)", borderColor: "transparent", color: "#041016" }} onClick={genReport} disabled={rLoad}>{rLoad ? "Analysing…" : "Run meta-analysis"}</button>
              <button className="ca-btn ca-btn--ghost" onClick={() => window.print()}>Print / save as PDF</button>
            </div>
            {report && (
              <div style={{ marginTop: 16 }}>
                {report.title && <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 17, lineHeight: 1.3, marginBottom: 14, color: "var(--ink)" }}>{report.title}</div>}
                {(report.sections || []).map((s, i) => (
                  <div key={i} style={{ marginBottom: 14, paddingLeft: 12, borderLeft: "2px solid rgba(47,224,198,.35)" }}>
                    <div className="ca-label" style={{ color: "var(--accent)", marginBottom: 5 }}>{s.heading}</div>
                    <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{s.body}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="ca-note">A data-driven breakdown — not a summary — reasoning over phase strike rates, WPA, economy and clutch to explain why the match went the way it did.</div>
          </div>
          <div className="ca-note">Every stat is computed live from the file through the same percentile engine as the rest of SillyPoint. The chip is each player's Impact (0–100) for this match; tap a name for the full card.</div>
        </>
      )}
      {sel && <RealPlayerProfile player={sel} fmt={fmt} onClose={() => setSel(null)} />}
    </div>
  );
}

/* ================================================================== */
/*  TAB: VISION (AI image analysis + on-device pose)                  */
/* ================================================================== */
function callVision(base64, mediaType, prompt) {
  const body = { model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } }, { type: "text", text: prompt }] }] };
  return fetch("/api/claude", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
}
function callVisionMulti(frames, prompt) {
  const content = frames.map((f) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f } }));
  content.push({ type: "text", text: prompt });
  const body = { model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content }] };
  return fetch("/api/claude", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
}
function loadScript(src) {
  return new Promise((res, rej) => { if ([...document.scripts].some((s) => s.src === src)) return res(); const s = document.createElement("script"); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error("load fail")); document.body.appendChild(s); });
}
const VERDICT_COL = { good: "var(--grass)", watch: "var(--gold)", issue: "var(--cherry)" };
const VISION_MODES = [
  { id: "technique", label: "Batting technique" },
  { id: "shot", label: "Shot ID" },
  { id: "extract", label: "Extract data" },
  { id: "field", label: "Field setup" },
  { id: "scorecard", label: "Read scorecard" },
  { id: "general", label: "Coach's eye" },
];
const VISION_PROMPTS = {
  technique: `You are a professional batting coach analysing a still image of a cricketer. Assess stance, head position, base and balance, backlift and grip where visible. Return ONLY JSON, no markdown: {"summary":"1-2 sentences","observations":[{"label":"e.g. Head position","note":"...","verdict":"good|watch|issue"}],"drills":["..."]}. If it is not a cricket image, say so in summary and return empty arrays.`,
  shot: `You are a cricket analyst. Identify the shot being played in this image and its likely scoring region. Return ONLY JSON: {"summary":"...","shot":{"type":"e.g. Pull","region":"e.g. Mid-wicket"},"observations":[{"label":"...","note":"...","verdict":"good|watch|issue"}],"drills":[]}.`,
  extract: `You are a ball-tracking data extractor for cricket. From this frame, infer the delivery and shot and return structured data. Return ONLY JSON, no markdown: {"summary":"1 sentence","shot":{"type":"e.g. Pull","region":"e.g. Mid-wicket"},"line":"e.g. outside off / middle / leg / down leg / wide","length":"e.g. yorker / full / good length / back of a length / short","foot":"front|back|n/a","outcome":"e.g. 4 runs / dot / wicket / defended","observations":[{"label":"...","note":"...","verdict":"good|watch|issue"}]}. If you cannot tell a field, use "unknown".`,
  field: `You are a cricket tactician. Describe the field placements visible and what they are defending. Return ONLY JSON: {"summary":"...","observations":[{"label":"...","note":"...","verdict":"good|watch|issue"}],"drills":["tactical suggestion"]}.`,
  scorecard: `Read this cricket scorecard or screenshot. Return ONLY JSON: {"summary":"the key result in 1-2 sentences","observations":[{"label":"player or stat","note":"the numbers","verdict":"good|watch|issue"}],"drills":[]}.`,
  general: `You are an expert cricket analyst. Give a coach's-eye read of this cricket image. Return ONLY JSON: {"summary":"...","observations":[{"label":"...","note":"...","verdict":"good|watch|issue"}],"drills":["..."]}.`,
};
function lineX(s) { s = (s || "").toLowerCase(); if (s.includes("wide")) return s.includes("leg") ? 0.12 : 0.9; if (s.includes("outside off") || s.includes("fourth") || s.includes("fifth") || s.includes("channel")) return 0.76; if (s.includes("off")) return 0.62; if (s.includes("middle")) return 0.5; if (s.includes("down leg")) return 0.18; if (s.includes("leg") || s.includes("pad")) return 0.34; return 0.5; }
function lengthY(s) { s = (s || "").toLowerCase(); if (s.includes("yorker") || s.includes("full toss")) return 0.9; if (s.includes("half volley") || s.includes("full")) return 0.74; if (s.includes("good") || s.includes("length")) return 0.56; if (s.includes("back of") || s.includes("short of")) return 0.42; if (s.includes("short") || s.includes("bounc")) return 0.26; return 0.56; }
function regionToZone(s) { s = (s || "").toLowerCase(); if (!s) return -1; if (s.includes("cover")) return 1; if (s.includes("point") || s.includes("gully")) return 2; if (s.includes("third") || s.includes("slip") || s.includes("keeper")) return 3; if (s.includes("fine leg") || s.includes("fine-leg")) return 4; if (s.includes("square")) return 5; if (s.includes("wicket")) return 6; if (s.includes("long-on") || s.includes("long on") || s.includes("mid-on") || s.includes("mid on")) return 7; if (s.includes("straight") || s.includes("long off") || s.includes("long-off") || s.includes("mid off") || s.includes("mid-off") || s.includes("down the ground")) return 0; return -1; }
function PitchMap({ line, length }) {
  const W = 170, H = 230, x = lineX(line) * W, y = lengthY(length) * H;
  return (<svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 180, display: "block" }}>
    <rect x="0" y="0" width={W} height={H} rx="8" fill="#101a2e" />
    <rect x={W * 0.28} y="8" width={W * 0.44} height={H - 16} rx="4" fill="#c9a06b" opacity="0.9" />
    {[0.28, 0.56, 0.72].map((f, i) => <line key={i} x1={W * 0.3} y1={H * f} x2={W * 0.7} y2={H * f} stroke="#00000022" strokeWidth="1" />)}
    {[0.36, 0.5, 0.64].map((f, i) => <line key={i} x1={W * f} y1="14" x2={W * f} y2="30" stroke="#1a1a1a" strokeWidth="2" />)}
    <circle cx={x} cy={y} r="7" fill="var(--cherry)" stroke="#fff" strokeWidth="1.5" />
    <text x={W / 2} y={H - 6} textAnchor="middle" fill="#EFEADF99" fontSize="9" fontFamily="Space Grotesk, sans-serif">batter's end</text>
  </svg>);
}
function VisionTab() {
  const [mediaUrl, setMediaUrl] = useState(null);
  const [isVideo, setIsVideo] = useState(false);
  const [b64, setB64] = useState(null);
  const [mtype, setMtype] = useState("image/jpeg");
  const [mode, setMode] = useState("technique");
  const [loading, setLoading] = useState(false);
  const [seqLoading, setSeqLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [pose, setPose] = useState({ status: "idle", err: null, score: null });
  const [log, setLog] = useState([]);
  const mediaRef = useRef(null); const canvasRef = useRef(null); const workRef = useRef(null);

  function clearOverlay() { const cv = canvasRef.current; if (cv) { const c = cv.getContext("2d"); c && c.clearRect(0, 0, cv.width, cv.height); } }
  function onFile(e) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const video = (f.type || "").startsWith("video");
    setIsVideo(video); setMtype(video ? "image/jpeg" : (f.type || "image/jpeg"));
    setResult(null); setError(null); setPose({ status: "idle", err: null, score: null }); clearOverlay();
    if (video) { setMediaUrl(URL.createObjectURL(f)); setB64(null); }
    else { const rd = new FileReader(); rd.onload = () => { setMediaUrl(rd.result); setB64(String(rd.result).split(",")[1]); }; rd.readAsDataURL(f); }
  }
  function grabFrame() {
    const v = mediaRef.current, w = workRef.current; if (!v || !w) return null;
    const vw = v.videoWidth || v.naturalWidth, vh = v.videoHeight || v.naturalHeight; if (!vw) return null;
    w.width = vw; w.height = vh; w.getContext("2d").drawImage(v, 0, 0, vw, vh);
    return w.toDataURL("image/jpeg", 0.85).split(",")[1];
  }
  function seekGrab(t) {
    return new Promise((res) => { const v = mediaRef.current; const on = () => { v.removeEventListener("seeked", on); res(grabFrame()); }; v.addEventListener("seeked", on); v.currentTime = t; });
  }
  async function analyze() {
    const frame = isVideo ? grabFrame() : b64;
    if (!frame) { setError("Load an image, or a video and scrub to a frame first."); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const data = await callVision(frame, "image/jpeg", VISION_PROMPTS[mode]);
      if (!data || !data.content) throw new Error("no content");
      const text = data.content.filter((x) => x.type === "text").map((x) => x.text).join("\n");
      let parsed; try { parsed = JSON.parse(text.replace(/```json|```/g, "").trim()); } catch (e) { parsed = { summary: text.trim() || "No analysis.", observations: [] }; }
      setResult(parsed);
      if (mode === "extract" && (parsed.line || parsed.length || (parsed.shot && parsed.shot.region))) setLog((l) => [{ ...parsed, t: Date.now() }, ...l].slice(0, 24));
    } catch (e) { setError("Couldn't run the vision model here. This uses in-product AI access, which may be off in this preview."); }
    finally { setLoading(false); }
  }
  async function analyzeSequence() {
    const v = mediaRef.current; if (!v || !isVideo) return;
    setSeqLoading(true); setError(null); setResult(null);
    const wasPaused = v.paused, t0 = v.currentTime; v.pause();
    try {
      const dur = v.duration || 0;
      const times = dur ? [0.15, 0.38, 0.6, 0.82].map((r) => r * dur) : [t0];
      const frames = [];
      for (const t of times) { const f = await seekGrab(t); if (f) frames.push(f); }
      v.currentTime = t0; if (!wasPaused) v.play();
      if (!frames.length) throw new Error("no frames");
      const prompt = `These are ${frames.length} still frames in time order from a single cricket delivery or shot. Analyse the batter's or bowler's movement and technique across the sequence — trigger and setup, load, contact or release, and follow-through. Return ONLY JSON: {"summary":"...","observations":[{"label":"phase or aspect","note":"...","verdict":"good|watch|issue"}],"drills":["..."]}.`;
      const data = await callVisionMulti(frames, prompt);
      if (!data || !data.content) throw new Error("no content");
      const text = data.content.filter((x) => x.type === "text").map((x) => x.text).join("\n");
      let parsed; try { parsed = JSON.parse(text.replace(/```json|```/g, "").trim()); } catch (e) { parsed = { summary: text.trim() || "No analysis.", observations: [] }; }
      setResult(parsed);
    } catch (e) { setError("Couldn't analyse the sequence (in-product AI may be off, or the video can't be sampled in this preview)."); }
    finally { setSeqLoading(false); }
  }
  function drawPose(p) {
    const el = mediaRef.current, cv = canvasRef.current; if (!el || !cv) return;
    const nw = el.videoWidth || el.naturalWidth, nh = el.videoHeight || el.naturalHeight;
    const sx = el.clientWidth / nw, sy = el.clientHeight / nh;
    cv.width = el.clientWidth; cv.height = el.clientHeight;
    const ctx = cv.getContext("2d"); ctx.clearRect(0, 0, cv.width, cv.height);
    const kp = {}; p.keypoints.forEach((k) => (kp[k.part] = k));
    const line = (a, b) => { const A = kp[a], B = kp[b]; if (A && B && A.score > 0.3 && B.score > 0.3) { ctx.beginPath(); ctx.moveTo(A.position.x * sx, A.position.y * sy); ctx.lineTo(B.position.x * sx, B.position.y * sy); ctx.strokeStyle = "#D44B3A"; ctx.lineWidth = 2.5; ctx.stroke(); } };
    [["leftShoulder", "rightShoulder"], ["leftShoulder", "leftElbow"], ["leftElbow", "leftWrist"], ["rightShoulder", "rightElbow"], ["rightElbow", "rightWrist"], ["leftShoulder", "leftHip"], ["rightShoulder", "rightHip"], ["leftHip", "rightHip"], ["leftHip", "leftKnee"], ["leftKnee", "leftAnkle"], ["rightHip", "rightKnee"], ["rightKnee", "rightAnkle"]].forEach(([a, b]) => line(a, b));
    p.keypoints.forEach((k) => { if (k.score > 0.3) { ctx.beginPath(); ctx.arc(k.position.x * sx, k.position.y * sy, 3.6, 0, 7); ctx.fillStyle = "#E7B24A"; ctx.fill(); } });
  }
  async function detectPose() {
    if (!mediaRef.current) return;
    setPose({ status: "loading", err: null, score: null });
    try {
      if (!window.tf) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/tensorflow/4.22.0/tf.min.js");
      if (!window.posenet) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/tensorflow-models-posenet/2.2.2/posenet.min.js");
      const net = await window.posenet.load({ architecture: "MobileNetV1", outputStride: 16, inputResolution: { width: 353, height: 257 }, multiplier: 0.75 });
      let src = mediaRef.current;
      if (isVideo) { const w = workRef.current; const vw = src.videoWidth, vh = src.videoHeight; w.width = vw; w.height = vh; w.getContext("2d").drawImage(src, 0, 0, vw, vh); src = w; }
      const p = await net.estimateSinglePose(src, { flipHorizontal: false });
      drawPose(p);
      setPose({ status: "done", err: null, score: Math.round((p.score || 0) * 100) });
    } catch (e) { setPose({ status: "error", err: "On-device pose estimation isn't available in this sandbox (the model host is blocked). The AI analysis still works.", score: null }); }
  }
  const logZones = (() => { const z = [0, 0, 0, 0, 0, 0, 0, 0]; log.forEach((e) => { const zi = regionToZone((e.shot && e.shot.region) || e.region); if (zi >= 0) z[zi] += 1; }); return z; })();
  const busy = loading || seqLoading;
  return (
    <div className="ca-grid">
      <div className="ca-card">
        <h3><span className="dot" />Vision · AI video &amp; image analysis</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <input id="vis-file" type="file" accept="image/*,video/*" onChange={onFile} style={{ display: "none" }} />
          <label htmlFor="vis-file" className="ca-btn" style={{ cursor: "pointer" }}>Upload video or image</label>
          <div className="ca-seg" style={{ flexWrap: "wrap" }}>
            {VISION_MODES.map((m) => <button key={m.id} className={mode === m.id ? "on" : ""} onClick={() => setMode(m.id)}>{m.label}</button>)}
          </div>
        </div>
        {!mediaUrl && <div className="ca-note">Upload a clip or photo — a batting stance, a shot in play, a bowling action, a field setup, or a scorecard — and a vision-capable model returns a coach's-eye breakdown. For video, scrub to a moment and analyze that frame, or analyze the whole action as a sequence. Media is sent only to the AI for analysis.</div>}
        {mediaUrl && (
          <div className="ca-row">
            <div className="ca-col" style={{ flex: "0 0 auto" }}>
              <div style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
                {isVideo
                  ? <video ref={mediaRef} src={mediaUrl} controls playsInline onSeeked={clearOverlay} onPlay={clearOverlay} style={{ maxWidth: "100%", maxHeight: 340, display: "block", borderRadius: 8, border: "1px solid var(--line)" }} />
                  : <img ref={mediaRef} src={mediaUrl} alt="upload" style={{ maxWidth: "100%", maxHeight: 340, display: "block", borderRadius: 8, border: "1px solid var(--line)" }} />}
                <canvas ref={canvasRef} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }} />
              </div>
              <canvas ref={workRef} style={{ display: "none" }} />
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button className="ca-btn" style={{ background: "var(--cherry)", borderColor: "var(--cherry)", color: "#fff" }} onClick={analyze} disabled={busy}>{loading ? "Analysing…" : isVideo ? "Analyze frame" : "Analyze"}</button>
                {isVideo && <button className="ca-btn ca-btn--ghost" onClick={analyzeSequence} disabled={busy}>{seqLoading ? "Analysing…" : "Analyze sequence"}</button>}
                <button className="ca-btn ca-btn--ghost" onClick={detectPose} disabled={pose.status === "loading"}>{pose.status === "loading" ? "Loading model…" : "Detect pose"}</button>
                {pose.status === "done" && <span className="ca-mono" style={{ fontSize: 12, color: "var(--grass)" }}>pose {pose.score}%</span>}
              </div>
              {isVideo && <div className="ca-note" style={{ marginTop: 6 }}>Scrub to a moment, then Analyze frame — or Analyze sequence to read the whole action.</div>}
              {pose.err && <div className="ca-note" style={{ color: "var(--muted)" }}>{pose.err}</div>}
            </div>
            <div className="ca-col">
              {busy && <div className="ca-note" style={{ color: "var(--clay)" }}>Reading the footage…</div>}
              {error && <div className="ca-note" style={{ color: "var(--cherry)" }}>{error}</div>}
              {result && (
                <div>
                  <div style={{ fontSize: 15, lineHeight: 1.5, marginBottom: 12 }}>{result.summary}</div>
                  {result.shot && <div style={{ marginBottom: 12 }}><span className="pc-badge" style={{ marginTop: 0, borderColor: "var(--cherry)66" }}>{result.shot.type} → {result.shot.region}</span></div>}
                  {(result.observations || []).map((o, i) => (
                    <div key={i} style={{ display: "flex", gap: 9, padding: "7px 0", borderBottom: "1px solid #20262c" }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 5, flex: "0 0 auto", background: VERDICT_COL[o.verdict] || "var(--muted)" }} />
                      <div><b style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 13.5 }}>{o.label}</b><div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 1 }}>{o.note}</div></div>
                    </div>
                  ))}
                  {(result.drills || []).length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div className="ca-label" style={{ marginBottom: 6 }}>Suggestions</div>
                      {result.drills.map((d, i) => <div key={i} style={{ fontSize: 13, color: "var(--ink)", padding: "3px 0" }}>· {d}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        {mode === "extract" && (result || log.length > 0) && (
          <div className="ca-row" style={{ marginTop: 8 }}>
            <div className="ca-col">
              <div className="ca-label" style={{ marginBottom: 6 }}>Ball map · line × length</div>
              {result && <PitchMap line={result.line} length={result.length} />}
              {result && <div className="ca-note">{[result.length, result.line, result.foot && `${result.foot} foot`, result.outcome].filter(Boolean).join(" · ") || "No line/length detected."}</div>}
            </div>
            <div className="ca-col">
              <div className="ca-label" style={{ marginBottom: 6 }}>Extracted this session · {log.length} balls</div>
              {logZones.some((z) => z > 0) ? <WagonWheel zones={logZones} /> : <div className="ca-note">Analyze frames in Extract-data mode to build a shot map from the footage.</div>}
              {log.length > 0 && <button className="ca-btn ca-btn--ghost" style={{ marginTop: 8 }} onClick={() => setLog([])}>Clear session</button>}
            </div>
          </div>
        )}
        <div className="ca-note">The written analysis comes from a vision-capable AI model reading the frame(s) you send. "Detect pose" runs a TensorFlow.js skeleton model on-device — genuine computer vision, but it needs the model host reachable, so it may be unavailable in some previews.</div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TAB: AUCTION OPTIMIZER                                             */
/* ================================================================== */
const RETAIN_SLAB_CAPPED = [18, 14, 11, 18, 14];
const RETAIN_SLAB_UNCAPPED = 4;
const SQUAD_OS_CAP = 8;
function retentionCost(retainedIds) {
  const ret = [...retainedIds].map((id) => POOL.find((p) => p.id === id)).filter(Boolean);
  const capped = ret.filter((p) => !p.uncapped);
  const uncapped = ret.filter((p) => p.uncapped);
  let cost = 0, lines = [];
  capped.slice(0, 5).forEach((p, i) => { const c = RETAIN_SLAB_CAPPED[i] || 14; cost += c; lines.push({ p, c }); });
  uncapped.slice(0, 2).forEach((p) => { cost += RETAIN_SLAB_UNCAPPED; lines.push({ p, c: RETAIN_SLAB_UNCAPPED }); });
  const rtm = Math.max(0, 6 - ret.length);
  return { cost, capped: capped.length, uncapped: uncapped.length, total: ret.length, lines, rtm };
}
function deriveXI(squad) {
  const pick = [], used = new Set(); let osx = 0;
  const take = (p) => { pick.push(p); used.add(p.id); if (p.overseas) osx++; };
  const kp = squad.filter((p) => p.role === "keeper" && !used.has(p.id)).sort((a, b) => b.ability - a.ability)[0];
  if (kp) take(kp);
  const fill = (r, n) => {
    let c = 0;
    squad.filter((p) => p.role === r && !used.has(p.id)).sort((a, b) => b.ability - a.ability).forEach((p) => {
      if (pick.length >= 11 || c >= n) return; if (osx >= 4 && p.overseas) return; take(p); c++;
    });
  };
  fill("bat", 4); fill("ar", 2); fill("spin", 2); fill("pace", 2);
  squad.filter((p) => !used.has(p.id)).sort((a, b) => b.ability - a.ability).forEach((p) => { if (pick.length >= 11 || (osx >= 4 && p.overseas)) return; take(p); });
  return pick.sort((a, b) => b.ability - a.ability);
}
function buildSquad(budget, retainedIds, squadTarget) {
  retainedIds = retainedIds || new Set();
  const retInfo = retentionCost(retainedIds);
  const purse = budget - retInfo.cost;
  const retained = [...retainedIds].map((id) => POOL.find((p) => p.id === id)).filter(Boolean);
  const squad = [...retained];
  let spend = 0, os = squad.filter((p) => p.overseas).length;
  const canAdd = (p) => !squad.includes(p) && spend + p.price <= purse && !(p.overseas && os >= SQUAD_OS_CAP);
  const byValue = (arr) => arr.sort((a, b) => (b.ability / b.price) - (a.ability / a.price));
  const add = (p) => { squad.push(p); spend += p.price; if (p.overseas) os++; };
  const has = (r) => squad.filter((p) => p.role === r).length;
  const roleMin = { keeper: 2, bat: 5, ar: 3, pace: 4, spin: 3 };
  Object.entries(roleMin).forEach(([r, min]) => {
    while (has(r) < min) { const c = byValue(POOL.filter((p) => p.role === r && canAdd(p)))[0]; if (!c) break; add(c); }
  });
  while (squad.length < squadTarget) { const c = byValue(POOL.filter((p) => canAdd(p)))[0]; if (!c) break; add(c); }
  const xi = deriveXI(squad);
  const impactPick = squad.filter((p) => !xi.includes(p)).sort((a, b) => b.ability - a.ability)[0];
  const board = [...POOL].map((p) => ({ id: p.id, name: p.name, role: p.role, price: p.price, overseas: p.overseas, uncapped: p.uncapped, ability: p.ability, value: Math.round((p.ability / p.price) * 10) / 10 })).sort((a, b) => b.value - a.value);
  const grouped = ["keeper", "bat", "ar", "pace", "spin"].map((r) => ({ role: r, players: squad.filter((p) => p.role === r).sort((a, b) => b.ability - a.ability) }));
  return {
    squad, xi, grouped, retained, retInfo, board, impactPick,
    purse: Math.round(purse * 10) / 10, spend: Math.round(spend * 10) / 10,
    leftover: Math.round((purse - spend) * 10) / 10, overseas: os, size: squad.length,
    over: spend > purse, short: squad.length < squadTarget,
  };
}
function AuctionTab({ onOpen }) {
  const [budget, setBudget] = useState(120);
  const [squadTarget, setSquadTarget] = useState(18);
  const [ret, setRet] = useState(new Set());
  const res = useMemo(() => buildSquad(budget, ret, squadTarget), [budget, ret, squadTarget]);
  const purseUse = res.purse > 0 ? Math.min(100, (res.spend / res.purse) * 100) : 100;
  const xiSet = new Set(res.xi.map((p) => p.id));
  const slabCost = Object.fromEntries(res.retInfo.lines.map((l) => [l.p.id, l.c]));
  const toggleRet = (id) => setRet((s) => {
    const n = new Set(s);
    if (n.has(id)) { n.delete(id); return n; }
    if (n.size >= 6) return n;
    const p = POOL.find((x) => x.id === id);
    const capped = [...n].map((i) => POOL.find((x) => x.id === i)).filter((x) => x && !x.uncapped).length;
    const uncap = [...n].map((i) => POOL.find((x) => x.id === i)).filter((x) => x && x.uncapped).length;
    if (p.uncapped && uncap >= 2) return n;
    if (!p.uncapped && capped >= 5) return n;
    n.add(id); return n;
  });
  const rowFor = (p, idx, isXI) => (
    <div className="xi-row" key={p.id}>
      <div className="xi-pos" style={{ fontSize: idx != null ? 13 : 10 }}>{idx != null ? idx + 1 : (ret.has(p.id) ? "R" : "")}</div>
      <div>
        <div className="xi-nm" onClick={() => onOpen(p)}>{p.name}
          {p.overseas && <span className="xi-tag" style={{ background: "#6c7bff22", color: "var(--sky)", border: "1px solid #6c7bff55" }}>OS</span>}
          {p.uncapped && <span className="xi-tag" style={{ background: "#2fd98a22", color: "var(--grass)", border: "1px solid #2fd98a55" }}>U</span>}
          {ret.has(p.id) && <span className="xi-tag" style={{ background: "#ffc24b22", color: "var(--gold)", border: "1px solid #ffc24b55" }}>RET</span>}
          {isXI && <span className="xi-tag" style={{ background: "rgba(47,224,198,.14)", color: "var(--accent)", border: "1px solid rgba(47,224,198,.4)" }}>XI</span>}
        </div>
        <div className="xi-why">{p.tag}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="ca-mono" style={{ fontSize: 13, color: ret.has(p.id) ? "var(--gold)" : "var(--muted)" }}>₹{ret.has(p.id) ? (slabCost[p.id] ?? p.price) : p.price}</span>
        <span className="xi-tag" style={{ background: `${ROLE_COL[p.role]}22`, color: ROLE_COL[p.role], border: `1px solid ${ROLE_COL[p.role]}55` }}>{ROLE_LBL[p.role]}</span>
      </div>
    </div>
  );
  return (
    <div className="ca-grid">
      <div className="ca-row">
        <div className="ca-col">
          <div className="ca-card">
            <h3><span className="dot" />Auction settings</h3>
            <Choice label="Purse (₹ cr)" value={budget} onChange={setBudget} options={[{ id: 120, label: "₹120" }, { id: 100, label: "₹100" }]} />
            <Choice label="Squad target" value={squadTarget} onChange={setSquadTarget} options={[{ id: 18, label: "18" }, { id: 20, label: "20" }, { id: 22, label: "22" }, { id: 25, label: "25" }]} />
            <div className="ca-note">IPL rules: 18–25-man squad, max 8 overseas, ₹120 cr purse, up to 6 retentions (max 5 capped, 2 uncapped). Impact Player permitted.</div>
          </div>
          <div className="ca-card" style={{ marginTop: 14 }}>
            <h3><span className="dot" />Purse</h3>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "JetBrains Mono, monospace", fontSize: 12.5, marginBottom: 4, color: "var(--muted)" }}><span>Retentions ₹{res.retInfo.cost}</span><span>Auction ₹{res.spend}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "JetBrains Mono, monospace", fontSize: 13, marginBottom: 6 }}><span style={{ color: "var(--ink)" }}>Purse ₹{res.purse}</span><span style={{ color: res.over ? "var(--cherry)" : "var(--grass)" }}>₹{res.leftover} left</span></div>
            <div style={{ height: 9, borderRadius: 999, background: "rgba(0,0,0,.35)", overflow: "hidden" }}><div style={{ height: "100%", width: `${purseUse}%`, background: res.over ? "var(--cherry)" : "linear-gradient(90deg,var(--accent),var(--sky))" }} /></div>
            <div className="ca-statgrid" style={{ marginTop: 12 }}>
              <div className="ca-stat"><div className="v" style={{ color: res.overseas > 8 ? "var(--cherry)" : "var(--ink)" }}>{res.overseas}/8</div><div className="l ca-label">Overseas</div></div>
              <div className="ca-stat"><div className="v" style={{ color: res.short ? "var(--gold)" : "var(--grass)" }}>{res.size}/{squadTarget}</div><div className="l ca-label">Squad</div></div>
              <div className="ca-stat"><div className="v">{res.retInfo.total}/6</div><div className="l ca-label">Retained</div><div className="h">{res.retInfo.capped}c · {res.retInfo.uncapped}u</div></div>
              <div className="ca-stat"><div className="v">{res.retInfo.rtm}</div><div className="l ca-label">RTM cards</div></div>
            </div>
            {res.impactPick && <div style={{ marginTop: 12 }}><div className="ca-label" style={{ marginBottom: 6 }}>Impact Player option</div><button className="pc-badge" style={{ marginTop: 0, cursor: "pointer" }} onClick={() => onOpen(res.impactPick)}>{res.impactPick.name} · {ROLE_LBL[res.impactPick.role]} · ₹{res.impactPick.price}</button></div>}
          </div>
          <div className="ca-card" style={{ marginTop: 14 }}>
            <h3><span className="dot" />Retentions <span style={{ color: "var(--muted)", fontFamily: "Inter", textTransform: "none", letterSpacing: 0, fontWeight: 400, fontSize: 11 }}>· max 5 capped · 2 uncapped</span></h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 176, overflowY: "auto" }}>
              {[...POOL].sort((a, b) => b.ability - a.ability).map((p) => (
                <button key={p.id} className={`ca-chip ${ret.has(p.id) ? "ca-chip--on" : ""}`} style={{ fontSize: 10.5 }} onClick={() => toggleRet(p.id)}>{p.name}{p.uncapped ? " ·U" : p.overseas ? " ·OS" : ""}</button>
              ))}
            </div>
            {res.retInfo.lines.length > 0 && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                {res.retInfo.lines.map((l) => <div key={l.p.id} style={{ display: "flex", justifyContent: "space-between", fontFamily: "JetBrains Mono, monospace", fontSize: 12, padding: "3px 0", color: "var(--muted)" }}><span>{l.p.name}{l.p.uncapped ? " (unc)" : ""}</span><span style={{ color: "var(--gold)" }}>₹{l.c} cr</span></div>)}
              </div>
            )}
          </div>
        </div>
        <div className="ca-col" style={{ flex: 1.35 }}>
          <div className="ca-card">
            <h3><span className="dot" />Projected best XI <span style={{ color: "var(--muted)", fontFamily: "Inter", textTransform: "none", letterSpacing: 0, fontWeight: 400, fontSize: 11 }}>· from the squad, max 4 overseas</span></h3>
            <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>{res.xi.map((p, i) => rowFor(p, i, false))}</div>
          </div>
          <div className="ca-card" style={{ marginTop: 14 }}>
            <h3><span className="dot" />Full squad · {res.size} players {res.short ? <span style={{ color: "var(--gold)", fontFamily: "Inter", textTransform: "none", letterSpacing: 0, fontWeight: 400, fontSize: 11 }}>· pool-limited</span> : null}</h3>
            {res.grouped.map((g) => g.players.length ? (
              <div key={g.role}>
                <div className="cg-label">{ROLE_NAME[g.role]} · {g.players.length}</div>
                <div style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>{g.players.map((p) => rowFor(p, null, xiSet.has(p.id)))}</div>
              </div>
            ) : null)}
            <div className="ca-note">A real franchise buys a full 18–25-man squad, not an XI — depth for injuries, form and the Impact Player. Retained players cost from the ₹18/14/11/18/14 cr capped slab (₹4 cr uncapped), deducted from the ₹120 cr purse before bidding. This demo pool of 26 caps how deep the squad can go.</div>
          </div>
        </div>
      </div>
      <div className="ca-card">
        <h3><span className="dot" />Value board · ability per crore</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 8 }}>
          {res.board.slice(0, 12).map((p, i) => (
            <button key={p.id} className="sq-card" style={{ padding: "9px 11px" }} onClick={() => onOpen(POOL.find((x) => x.id === p.id))}>
              <span className="sq-ava" style={{ width: 30, height: 30, fontSize: 11, background: ROLE_COL[p.role], color: ROLE_TXT[p.role] }}>{i + 1}</span>
              <div style={{ minWidth: 0 }}><div className="sq-nm" style={{ fontSize: 13 }}>{p.name}</div><div className="sq-tag">₹{p.price} · {ROLE_LBL[p.role]}{p.overseas ? " · OS" : p.uncapped ? " · U" : ""}</div></div>
              <span className="sq-rate" style={{ background: pctColor(Math.min(100, p.value * 5)), color: "#0a0d14" }}>{p.value}</span>
            </button>
          ))}
        </div>
        <div className="ca-note">Value = ability ÷ price. The top of this board is where a franchise finds edge — high-ability players going cheap.</div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TAB: MATCHUP ENGINE                                                */
/* ================================================================== */
function matchupSR(p, type, phase, fmt) {
  const st = styleOf(p);
  const handle = type === "spin" ? p.vS : p.vP;
  const phaseMult = phase === "pp" ? 1.0 + st.aggression * 0.15 : phase === "death" ? 1.05 + st.aggression * 0.5 : 0.9 + st.aggression * 0.1;
  return Math.round(fmt.parSR * (0.6 + (p.bat - 55) * 0.008) * (handle / 70) * phaseMult);
}
function MatchupTab({ fmt, onOpen }) {
  const bats = POOL.filter((p) => ["bat", "keeper", "ar"].includes(p.role));
  const [id, setId] = useState(bats[0].id);
  const p = POOL.find((x) => x.id === id);
  const phases = [["pp", "Powerplay"], ["mid", "Middle"], ["death", "Death"]];
  let weakest = { sr: 1e9, type: "", phase: "" };
  ["pace", "spin"].forEach((t) => phases.forEach(([ph, lbl]) => { const sr = matchupSR(p, t, ph, fmt); if (sr < weakest.sr) weakest = { sr, type: t, phase: lbl }; }));
  const rank = (key) => [...bats].sort((a, b) => b[key] - a[key]).slice(0, 4);
  const bowlers = POOL.filter((b) => ["pace", "spin", "ar"].includes(b.role) && b.bowl >= 55);
  const [bid, setBid] = useState(bowlers[0].id);
  const bw = POOL.find((x) => x.id === bid);
  const handle = bw.type === "spin" ? p.vS : p.vP;
  const h2hSR = Math.max(40, Math.round(matchupSR(p, bw.type, "mid", fmt) * (1 - (bw.bowl - 70) * 0.006)));
  const threat = clampPct(Math.round(bw.bowl - handle + 45));
  const edge = h2hSR >= fmt.parSR ? "batter" : "bowler";
  return (
    <div className="ca-grid">
      <div className="ca-card">
        <h3><span className="dot" />Matchup engine · pick a batter</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {bats.map((b) => <button key={b.id} className={`ca-chip ${id === b.id ? "ca-chip--on" : ""}`} style={{ fontSize: 11 }} onClick={() => setId(b.id)}>{b.name}</button>)}
        </div>
      </div>
      <div className="ca-row">
        <div className="ca-col" style={{ flex: 1.3 }}>
          <div className="ca-card">
            <h3><span className="dot" />{p.name} · projected strike rate by matchup</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={{ textAlign: "left", padding: "6px 8px", fontSize: 11, color: "var(--muted)", fontFamily: "Space Grotesk, sans-serif", letterSpacing: ".5px" }}>vs</th>
                  {phases.map(([ph, lbl]) => <th key={ph} style={{ padding: "6px 8px", fontSize: 11, color: "var(--muted)", fontFamily: "Space Grotesk, sans-serif", letterSpacing: ".5px" }}>{lbl}</th>)}</tr></thead>
                <tbody>
                  {["pace", "spin"].map((t) => (
                    <tr key={t}>
                      <td style={{ padding: "6px 8px", fontFamily: "Space Grotesk, sans-serif", textTransform: "capitalize", fontSize: 14 }}>{t}</td>
                      {phases.map(([ph]) => { const sr = matchupSR(p, t, ph, fmt); const pc = pctOf(sr, fmt.bat.sr); const c = pctColor(pc); return (
                        <td key={ph} style={{ padding: 6, textAlign: "center" }}>
                          <div style={{ background: `${c}22`, border: `1px solid ${c}55`, borderRadius: 6, padding: "8px 4px" }}>
                            <div className="ca-mono" style={{ fontWeight: 700, fontSize: 17, color: c }}>{sr}</div>
                            <div className="ca-label" style={{ marginTop: 3 }}>{pc} pct</div>
                          </div>
                        </td>); })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ca-note" style={{ color: "var(--ink)", marginTop: 12 }}>Bowl to exploit: attack {p.name} with <b>{weakest.type} in the {weakest.phase.toLowerCase()}</b>, his weakest projected matchup (SR {weakest.sr}). <button className="pc-badge" style={{ marginTop: 0, cursor: "pointer" }} onClick={() => onOpen(p)}>Full profile</button></div>
          </div>
          <div className="ca-card" style={{ marginTop: 14 }}>
            <h3><span className="dot" />Head-to-head · pick a bowler</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {bowlers.map((b) => <button key={b.id} className={`ca-chip ${bid === b.id ? "ca-chip--on" : ""}`} style={{ fontSize: 11 }} onClick={() => setBid(b.id)}>{b.name}</button>)}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ textAlign: "center" }}><div className="ca-mono" style={{ fontWeight: 700, fontSize: 30, color: pctColor(pctOf(h2hSR, fmt.bat.sr)) }}>{h2hSR}</div><div className="ca-label">Proj. SR</div></div>
              <div style={{ textAlign: "center" }}><div className="ca-mono" style={{ fontWeight: 700, fontSize: 30, color: pctColor(threat) }}>{threat}</div><div className="ca-label">Bowler threat</div></div>
              <div style={{ flex: 1, minWidth: 170 }}>
                <div style={{ fontSize: 14, lineHeight: 1.5 }}>{p.name} vs {bw.name} <span style={{ color: "var(--muted)" }}>({bw.type})</span> — edge to <b style={{ color: edge === "batter" ? "var(--grass)" : "var(--cherry)" }}>{edge === "batter" ? p.name : bw.name}</b>.</div>
                <div className="ca-note" style={{ marginTop: 6 }}>Projected from the batter's handling of {bw.type} and the bowler's skill. Threat blends bowler quality against the batter's competence.</div>
              </div>
            </div>
          </div>
        </div>
        <div className="ca-col">
          <div className="ca-card">
            <h3><span className="dot" />Best against spin</h3>
            {rank("vS").map((b) => <div key={b.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #20262c", cursor: "pointer" }} onClick={() => setId(b.id)}><span style={{ fontFamily: "Space Grotesk, sans-serif" }}>{b.name}</span><span className="ca-mono" style={{ color: pctColor(b.vS) }}>{b.vS}</span></div>)}
          </div>
          <div className="ca-card" style={{ marginTop: 14 }}>
            <h3><span className="dot" />Best against pace</h3>
            {rank("vP").map((b) => <div key={b.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #20262c", cursor: "pointer" }} onClick={() => setId(b.id)}><span style={{ fontFamily: "Space Grotesk, sans-serif" }}>{b.name}</span><span className="ca-mono" style={{ color: pctColor(b.vP) }}>{b.vP}</span></div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TAB: SEASON (multi-match aggregation + workload)                  */
/* ================================================================== */
function AggProfile({ pl, fmt, onClose }) {
  useEffect(() => { const h = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  const { name, B, W } = pl;
  const role = B && W ? "All-rounder" : W ? "Bowler" : "Batter";
  const aCol = B && W ? "var(--grass)" : W ? "var(--sky)" : "var(--clay)";
  const aTxt = B && W ? "#fff" : W ? "#fff" : "#11151a";
  const bm = B ? battingMetrics({ runs: B.runs, balls: B.balls, fours: B.fours, sixes: B.sixes, dots: B.dots }, fmt) : null;
  const wm = W ? bowlingMetrics({ balls: W.balls, runs: W.runs, wickets: W.wickets, dots: W.dots }, fmt) : null;
  const impact = bm ? bm.impact : wm.impact; const ic = pctColor(impact); const icTxt = impact >= 45 && impact < 76 ? "#11151a" : "#fff";
  return (<div className="pm-back" onClick={onClose}><div className="pm-sheet" onClick={(e) => e.stopPropagation()}>
    <div className="pm-head">
      <div className="pm-ava" style={{ background: aCol, color: aTxt }}>{initials(name)}</div>
      <div><div className="pm-nm">{name}</div><div className="pm-meta">{role} · {(B ? B.matches : W.matches)} matches</div></div>
      <div className="pm-rate"><div className="n" style={{ background: ic, color: icTxt }}>{impact}</div><div className="l">Impact</div></div>
      <button className="pm-x" onClick={onClose}>×</button>
    </div>
    <div className="pm-body">
      <div className="pm-sec">Season totals</div>
      <div className="ca-mono" style={{ fontSize: 14 }}>
        {B ? <span>{B.runs} runs ({B.balls}b) · SR {pl.sr} · avg {pl.avg}</span> : null}
        {B && W ? <span style={{ color: "var(--muted)" }}>{"   ·   "}</span> : null}
        {W ? <span>{W.wickets} wkts · econ {pl.econ} · {Math.floor(W.balls / 6)}.{W.balls % 6} ov</span> : null}
      </div>
      {bm && (<><div className="pm-sec">Batting · vs {fmt.label} field</div>
        <PctBar label="Strike rate" value={bm.sr} pct={bm.pSR} />
        <PctBar label="Boundary %" value={bm.boundaryPctRuns} suffix="%" pct={bm.pBnd} />
        <PctBar label="Strike rotation" value={`${bm.dotPct}% dot`} pct={bm.pRot} />
        <PctBar label="Impact" value={tierOf(bm.impact)} pct={bm.impact} /></>)}
      {wm && (<><div className="pm-sec">Bowling · vs {fmt.label} field</div>
        <PctBar label="Economy" value={wm.econ} pct={wm.pEcon} />
        <PctBar label="Wicket-taking" value={wm.sr ? `SR ${wm.sr}` : "—"} pct={wm.pSR} />
        <PctBar label="Average" value={wm.avg ? wm.avg : "—"} pct={wm.pAvg} />
        <PctBar label="Impact" value={tierOf(wm.impact)} pct={wm.impact} /></>)}
      <div className="ca-note">Aggregated across the loaded matches by player name. Phase/clutch splits aren't aggregated here — use single-match Import for those.</div>
    </div>
  </div></div>);
}
function SeasonTab() {
  const [agg, setAgg] = useState(null);
  const [fmt, setFmt] = useState(FORMATS.T20);
  const [count, setCount] = useState(0);
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState(null);
  function onFiles(e) {
    const files = [...(e.target.files || [])]; if (!files.length) return;
    Promise.all(files.map((f) => f.text().then((t) => { try { return parseCricsheet(JSON.parse(t)); } catch (x) { return null; } }))).then((res) => {
      const good = res.filter(Boolean);
      if (!good.length) { setErr("No valid Cricsheet files found."); setAgg(null); return; }
      const f = FORMATS[fmtKeyFromType(good[0].match.format)];
      const bmap = new Map(), wmap = new Map();
      good.forEach((m) => {
        m.batting.forEach((b) => { const e = bmap.get(b.name) || { matches: 0, runs: 0, balls: 0, fours: 0, sixes: 0, dots: 0, outs: 0 }; e.matches++; e.runs += b.runs; e.balls += b.balls; e.fours += b.fours; e.sixes += b.sixes; e.dots += b.dots; if (b.out) e.outs++; bmap.set(b.name, e); });
        m.bowling.forEach((b) => { const e = wmap.get(b.name) || { matches: 0, balls: 0, runs: 0, wickets: 0, dots: 0 }; e.matches++; e.balls += b.balls; e.runs += b.runs; e.wickets += b.wickets; e.dots += b.dots; wmap.set(b.name, e); });
      });
      const names = new Set([...bmap.keys(), ...wmap.keys()]);
      const players = [...names].map((n) => { const B = bmap.get(n), W = wmap.get(n); return {
        name: n, B: B && B.balls > 0 ? B : null, W: W && W.balls > 0 ? W : null,
        runs: B ? B.runs : 0, balls: B ? B.balls : 0, sr: B && B.balls ? Math.round((B.runs / B.balls) * 1000) / 10 : 0, avg: B && B.outs ? Math.round((B.runs / B.outs) * 10) / 10 : (B ? B.runs : 0),
        wickets: W ? W.wickets : 0, oversBalls: W ? W.balls : 0, econ: W && W.balls ? Math.round((W.runs / (W.balls / 6)) * 100) / 100 : 0 };
      });
      setFmt(f); setAgg(players); setCount(good.length); setErr(null); setSel(null);
    });
  }
  const board = (title, list, fmtVal) => (
    <div className="ca-card"><h3><span className="dot" />{title}</h3>
      {list.map((p, i) => <div key={p.name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #20262c", cursor: "pointer" }} onClick={() => setSel(p)}><span style={{ fontFamily: "Space Grotesk, sans-serif" }}>{i + 1}. {p.name}</span><span className="ca-mono">{fmtVal(p)}</span></div>)}
    </div>
  );
  return (
    <div className="ca-grid">
      <div className="ca-card">
        <h3><span className="dot" />Season · aggregate multiple matches</h3>
        <input id="season-files" type="file" accept=".json,application/json" multiple onChange={onFiles} style={{ display: "none" }} />
        <label htmlFor="season-files" className="ca-btn" style={{ background: "var(--cherry)", borderColor: "var(--cherry)", color: "#fff", cursor: "pointer" }}>Choose Cricsheet files</label>
        {count > 0 && <span className="ca-mono" style={{ marginLeft: 12, fontSize: 12, color: "var(--muted)" }}>{count} matches loaded</span>}
        {err && <div className="ca-note" style={{ color: "var(--cherry)" }}>{err}</div>}
        {!agg && !err && <div className="ca-note">Select several match JSONs at once (a whole tournament, or a team's season) — they're aggregated per player into career-style cards keyed by name, parsed entirely in your browser.</div>}
      </div>
      {agg && (<>
        <div className="ca-row">
          <div className="ca-col">{board("Most runs", [...agg].sort((a, b) => b.runs - a.runs).slice(0, 6), (p) => `${p.runs} (${p.balls})`)}</div>
          <div className="ca-col">{board("Best strike rate · min 30 balls", agg.filter((p) => p.balls >= 30).sort((a, b) => b.sr - a.sr).slice(0, 6), (p) => `${p.sr}`)}</div>
        </div>
        <div className="ca-row">
          <div className="ca-col">{board("Most wickets", [...agg].sort((a, b) => b.wickets - a.wickets).slice(0, 6), (p) => `${p.wickets}`)}</div>
          <div className="ca-col">{board("Best economy · min 30 balls", agg.filter((p) => p.oversBalls >= 30).sort((a, b) => a.econ - b.econ).slice(0, 6), (p) => `${p.econ}`)}</div>
        </div>
        <div className="ca-row">
          <div className="ca-col">{board("Workload · overs bowled", [...agg].sort((a, b) => b.oversBalls - a.oversBalls).slice(0, 6), (p) => `${Math.floor(p.oversBalls / 6)}.${p.oversBalls % 6} ov`)}</div>
          <div className="ca-col"></div>
        </div>
        <div className="ca-note">Leaderboards aggregate every loaded match by player name. Overs bowled is the base signal for bowler workload management. Tap any player for an aggregated card.</div>
      </>)}
      {sel && <AggProfile pl={sel} fmt={fmt} onClose={() => setSel(null)} />}
    </div>
  );
}

/* ================================================================== */
/*  TAB: VENUE / CONDITIONS                                           */
/* ================================================================== */
function VenueTab({ fmt }) {
  const [pitch, setPitch] = useState("balanced");
  const [size, setSize] = useState("standard");
  const base = fmt.label === "T20" ? 165 : fmt.label === "ODI" ? 270 : 330;
  const mult = fmt.label === "T20" ? 1 : 1.6;
  const par = Math.round(base + ({ pace: -8, balanced: 0, spin: -12, flat: 28 }[pitch]) * mult + ({ small: 14, standard: 0, large: -14 }[size]) * mult);
  const chase = clampPct(50 + ({ flat: 8, balanced: 2, pace: -4, spin: -8 }[pitch]) + ({ small: 5, standard: 0, large: -5 }[size]));
  const paceVal = clampPct(55 + ({ pace: 22, balanced: 2, spin: -18, flat: -6 }[pitch]));
  const spinVal = clampPct(55 + ({ spin: 24, balanced: 2, pace: -16, flat: -8 }[pitch]));
  const toss = chase >= 54 ? "Bowl first — chasing is favoured" : chase <= 46 ? "Bat first — defending is favoured" : "Marginal — lean bat first";
  return (
    <div className="ca-grid">
      <div className="ca-row">
        <div className="ca-col">
          <div className="ca-card">
            <h3><span className="dot" />Conditions</h3>
            <Choice label="Pitch" value={pitch} onChange={setPitch} options={[{ id: "pace", label: "Pace" }, { id: "balanced", label: "Balanced" }, { id: "spin", label: "Spin" }, { id: "flat", label: "Flat" }]} />
            <Choice label="Ground size" value={size} onChange={setSize} options={[{ id: "small", label: "Small" }, { id: "standard", label: "Standard" }, { id: "large", label: "Large" }]} />
          </div>
          <div className="ca-card" style={{ marginTop: 14, textAlign: "center" }}>
            <div className="ca-label">Par first-innings score</div>
            <div className="ca-mono" style={{ fontWeight: 700, fontSize: 46, color: "var(--gold)", lineHeight: 1.1, marginTop: 6 }}>{par}</div>
            <div className="ca-note" style={{ marginTop: 4 }}>{fmt.label} · {pitch} pitch · {size} ground</div>
          </div>
        </div>
        <div className="ca-col" style={{ flex: 1.2 }}>
          <div className="ca-card">
            <h3><span className="dot" />Chase vs defend</h3>
            <div className="ca-tug" style={{ borderRadius: 6, border: "1px solid var(--line)" }}>
              <div className="ca-tug-fill" style={{ width: `${chase}%`, background: "var(--cherry)" }}><span className="ca-tug-label" style={{ color: "#fff" }}>Chasing {chase}%</span></div>
              <div className="ca-tug-fill" style={{ width: `${100 - chase}%`, background: "var(--sky)", justifyContent: "flex-end", marginLeft: "auto" }}><span className="ca-tug-label" style={{ color: "#fff" }}>{100 - chase}% Defending</span></div>
            </div>
            <div style={{ marginTop: 16 }}>
              <PctBar label="Pace value" value={paceVal} pct={paceVal} />
              <PctBar label="Spin value" value={spinVal} pct={spinVal} />
            </div>
            <div className="ca-note" style={{ color: "var(--ink)", marginTop: 12 }}>Toss call: <b>{toss}</b>. On this surface, {paceVal >= spinVal ? "seamers hold the edge" : "spinners hold the edge"} — weight your attack and your Selector settings accordingly.</div>
          </div>
        </div>
      </div>
      <div className="ca-note">Par, chase bias and bowling value are heuristic models of how conditions shift the game — a planning aid you'd calibrate against a venue's real history in production (Cricsheet gives you every past match at a ground to fit these curves).</div>
    </div>
  );
}

/* ================================================================== */
/*  TAB: HOME                                                         */
/* ================================================================== */
function HomeTab({ onNav }) {
  const feats = [
    ["selector", "The Selector", "Opponent-aware XI builder. Set the opposition's weakness, quality, attack make-up and pitch, and it scores all 26 players on ability plus a matchup bonus to assemble a balanced side with rationale for every pick.", ["Matchup scoring", "Balance & roles", "Pitch-aware"]],
    ["auction", "Auction Hub", "A full IPL-rules auction: ₹120 cr purse, an 18–25-man squad, max 8 overseas, and up to 6 retentions on the real ₹18/14/11 cr slab with RTM cards. Projects your best XI and a value board of who's going cheap.", ["Retentions + RTM", "Full squad", "Value board"]],
    ["matchup", "Matchups", "How a batter fares by phase against pace and spin, colour-graded on percentile, with the shot-to-exploit called out — plus a head-to-head projection against any specific bowler in the pool.", ["Phase splits", "vs Pace / Spin", "Head-to-head"]],
    ["venue", "Venue & Conditions", "Model how a ground plays: par first-innings score, chase-versus-defend bias, the value of pace against spin, and a toss recommendation — all driven by pitch type and ground size.", ["Par score", "Chase bias", "Toss call"]],
    ["players", "Players", "Browse the squad grouped by role, each with an average match rating and a last-five form strip. Tap anyone for a full FotMob-style profile.", ["Squad browser", "Form strips", "Profiles"]],
    ["import", "Import (Cricsheet)", "The real IPL 2026 final is built in — one tap loads it. Or drop any ball-by-ball match file and it's parsed in your browser into percentile cards, phase and clutch splits, Win-Probability-Added for every player, and a printable AI scouting report.", ["IPL final built in", "WPA impact", "AI report"]],
    ["season", "Season", "Select many match files at once and aggregate them per player into career-style leaderboards — runs, strike rate, wickets, economy and bowler workload (overs bowled).", ["Multi-match", "Leaderboards", "Workload"]],
    ["vision", "Vision (AI + CV)", "Upload video or a still and a vision model returns a coach's-eye read: technique, shot ID, field setup or a scorecard. Scrub to a frame or analyse a whole action, run on-device pose, or extract shot data onto a pitch map.", ["Video analysis", "Pose overlay", "Video → data"]],
    ["bat", "Batting card", "Turn an innings into a percentile profile versus the format field — strike rate, boundary %, strike rotation and boundary rate — with advanced context stats (Runs Above Par, True SR, scoring-shot %) and a wagon wheel.", ["Percentiles", "RAA / True SR", "Wagon wheel"]],
    ["bowl", "Bowling card", "A spell as a percentile profile — economy, dot pressure, wicket-taking and average — plus Runs Saved vs par, a True Economy index and a delivery-outcome breakdown.", ["Percentiles", "Runs saved", "Outcomes"]],
    ["compare", "Compare", "Put two batters head-to-head on a percentile radar so a bigger shape means a more complete player.", ["Radar", "Percentile axes"]],
    ["match", "Match Center", "A live broadcast scoreboard with a win-probability tug-of-war, projected score, and worm and Manhattan charts driven by an editable over-by-over table.", ["Win prob", "Worm / Manhattan", "Projection"]],
  ];
  return (
    <div className="ca-grid">
      <div className="ca-card" style={{ textAlign: "center", padding: "38px 20px" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><BallMark s={58} /></div>
        <div className="ca-title" style={{ fontSize: 42 }}>Silly<em>Point</em></div>
        <div style={{ color: "var(--muted)", maxWidth: 600, margin: "12px auto 0", fontSize: 15, lineHeight: 1.55 }}>A percentile-first cricket analytics suite — IPL-rules auction strategy, opponent and venue planning, real ball-by-ball ingestion with win-probability impact, and AI video analysis, in one place.</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 26, marginTop: 22, flexWrap: "wrap", fontFamily: "JetBrains Mono, monospace" }}>
          <div><div style={{ fontWeight: 700, fontSize: 22 }}>12</div><div className="ca-label">tools</div></div>
          <div><div style={{ fontWeight: 700, fontSize: 22 }}>3</div><div className="ca-label">formats</div></div>
          <div><div style={{ fontWeight: 700, fontSize: 22 }}>26</div><div className="ca-label">players</div></div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
        {feats.map(([id, title, desc, tags]) => (
          <button key={id} className="ca-card" style={{ textAlign: "left", cursor: "pointer", color: "var(--ink)", fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 10 }} onClick={() => onNav(id)}>
            <h3 style={{ margin: 0 }}><span className="dot" />{title}</h3>
            <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55, flex: 1 }}>{desc}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {tags.map((t) => <span key={t} style={{ fontSize: 9.5, letterSpacing: ".5px", textTransform: "uppercase", fontFamily: "'Space Grotesk',sans-serif", padding: "3px 8px", borderRadius: 999, background: "rgba(47,224,198,.1)", color: "var(--accent)", border: "1px solid rgba(47,224,198,.25)" }}>{t}</span>)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  APP                                                               */
/* ================================================================== */
const TABS = [
  { id: "home", label: "Home" },
  { id: "selector", label: "The Selector" },
  { id: "auction", label: "Auction" },
  { id: "matchup", label: "Matchups" },
  { id: "venue", label: "Venue" },
  { id: "players", label: "Players" },
  { id: "import", label: "Import" },
  { id: "season", label: "Season" },
  { id: "vision", label: "Vision" },
  { id: "bat", label: "Batting" },
  { id: "bowl", label: "Bowling" },
  { id: "compare", label: "Compare" },
  { id: "match", label: "Match Center" },
];
export default function CricketAnalytics() {
  const [tab, setTab] = useState("home");
  const [fmtKey, setFmtKey] = useState("T20");
  const [profileId, setProfileId] = useState(null);
  const fmt = FORMATS[fmtKey];
  const openProfile = (p) => setProfileId(p.id);
  const profilePlayer = profileId ? POOL.find((p) => p.id === profileId) : null;
  return (
    <div className="ca-root">
      <style>{CSS}</style>
      <div className="ca-wrap">
        <div className="ca-head">
          <BallMark />
          <div className="ca-title">Silly<em>Point</em></div>
          <div className="ca-fmtrow">
            <span className="lbl">Format</span>
            {Object.keys(FORMATS).map((k) => (
              <button key={k} className={`ca-chip ${fmtKey === k ? "ca-chip--on" : ""}`} onClick={() => setFmtKey(k)}>{FORMATS[k].label}</button>))}
          </div>
        </div>
        <div className="ca-sub">Percentile-based cricket analytics — clickable player profiles, opponent-aware XI selection, and live match modelling.</div>
        <div className="ca-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`ca-tab ${tab === t.id ? "ca-tab--on" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>))}
        </div>
        {tab === "home" && <HomeTab onNav={setTab} />}
        {tab === "selector" && <Selector fmt={fmt} onOpen={openProfile} />}
        {tab === "auction" && <AuctionTab onOpen={openProfile} />}
        {tab === "matchup" && <MatchupTab fmt={fmt} onOpen={openProfile} />}
        {tab === "venue" && <VenueTab fmt={fmt} />}
        {tab === "players" && <Players fmt={fmt} onOpen={openProfile} />}
        {tab === "import" && <ImportTab />}
        {tab === "season" && <SeasonTab />}
        {tab === "vision" && <VisionTab />}
        {tab === "bat" && <Batting fmt={fmt} />}
        {tab === "bowl" && <Bowling fmt={fmt} />}
        {tab === "compare" && <Compare fmt={fmt} />}
        {tab === "match" && <MatchCenter fmt={fmt} />}
      </div>
      {profilePlayer && <PlayerProfile player={profilePlayer} fmt={fmt} onClose={() => setProfileId(null)} />}
    </div>
  );
}
