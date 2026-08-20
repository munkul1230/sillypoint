/* eslint-env node, browser */
// cricsheet-parser.js
// Turns a single Cricsheet match JSON into the shapes SillyPoint uses.
// Works in the browser (import) or Node. No dependencies.
//
//   import { parseCricsheet } from "./cricsheet-parser.js";
//   const result = parseCricsheet(matchJson);   // matchJson = JSON.parse(fileText)
//
// NOTE: Cricsheet has no shot-type / placement data, so shot-profile and
// wagon-wheel fields are intentionally absent. Everything else maps cleanly.

const phaseOf = (over, totalOvers = 20) => {
  const death = totalOvers <= 20 ? 15 : 40; // last 5 (T20) / last 10 (ODI)
  if (over < 6) return "pp";
  if (over >= death) return "death";
  return "mid";
};
const NON_BOWLER_DISMISSALS = new Set(["run out", "retired hurt", "retired not out", "obstructing the field", "timed out"]);

export function parseCricsheet(data) {
  const info = data.info || {};
  const totalOvers = info.overs || 20;
  const bat = new Map();
  const bowl = new Map();
  const inningsTotals = [];

  const getBat = (name) => {
    if (!bat.has(name)) bat.set(name, { name, runs: 0, balls: 0, fours: 0, sixes: 0, dots: 0, out: false,
      ph: { pp: [0, 0], mid: [0, 0], death: [0, 0] } });
    return bat.get(name);
  };
  const getBowl = (name) => {
    if (!bowl.has(name)) bowl.set(name, { name, balls: 0, runs: 0, wickets: 0, dots: 0, fours: 0, sixes: 0,
      deathBalls: 0, deathRuns: 0 });
    return bowl.get(name);
  };

  (data.innings || []).forEach((inn) => {
    let total = 0;
    (inn.overs || []).forEach((ov) => {
      const o = ov.over;
      (ov.deliveries || []).forEach((dl) => {
        const ex = dl.extras || {};
        const brun = dl.runs.batter, totalRuns = dl.runs.total;
        total += totalRuns;
        const isWide = ex.wides != null;          // wides: not a ball faced, charged to bowler
        const isNoball = ex.noballs != null;      // no-ball: faced, charged to bowler
        const offBat = brun;
        const notCharged = (ex.legbyes || 0) + (ex.byes || 0); // byes/legbyes not the bowler's fault

        // batting
        const B = getBat(dl.batter);
        if (!isWide) {
          B.balls += 1; B.runs += brun;
          const p = B.ph[phaseOf(o, totalOvers)]; p[0] += brun; p[1] += 1;
          if (brun === 4) B.fours += 1;
          if (brun === 6) B.sixes += 1;
          if (totalRuns === 0) B.dots += 1;
        }

        // bowling
        const W = getBowl(dl.bowler);
        if (!isWide && !isNoball) W.balls += 1;
        const charged = totalRuns - notCharged;
        W.runs += charged;
        if (totalRuns === 0) W.dots += 1;
        if (offBat === 4) W.fours += 1;
        if (offBat === 6) W.sixes += 1;
        if (o >= (totalOvers <= 20 ? 15 : 40)) {
          if (!isWide && !isNoball) W.deathBalls += 1;
          W.deathRuns += charged;
        }

        (dl.wickets || []).forEach((wk) => {
          getBat(wk.player_out).out = true;
          if (!NON_BOWLER_DISMISSALS.has(wk.kind)) W.wickets += 1;
        });
      });
    });
    inningsTotals.push({ team: inn.team, total });
  });

  const r1 = (n) => Math.round(n * 10) / 10;
  const sr = (r, b) => (b ? r1((r / b) * 100) : 0);

  const batting = [...bat.values()].filter((b) => b.balls > 0).map((b) => {
    const boundaryRuns = b.fours * 4 + b.sixes * 6;
    const overallSR = sr(b.runs, b.balls);
    const deathSR = sr(b.ph.death[0], b.ph.death[1]);
    return {
      name: b.name, runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes, dots: b.dots, out: b.out,
      sr: overallSR,
      boundaryPctRuns: b.runs ? Math.round((boundaryRuns / b.runs) * 100) : 0,
      dotPct: Math.round((b.dots / b.balls) * 100),
      phases: { pp: sr(b.ph.pp[0], b.ph.pp[1]), mid: sr(b.ph.mid[0], b.ph.mid[1]), death: deathSR },
      clutchIndex: overallSR && b.ph.death[1] ? Math.round((deathSR / overallSR) * 100) : null,
    };
  }).sort((a, b) => b.runs - a.runs);

  const bowling = [...bowl.values()].filter((w) => w.balls > 0).map((w) => {
    const overs = w.balls / 6;
    return {
      name: w.name, wickets: w.wickets, runs: w.runs, balls: w.balls,
      overs: `${Math.floor(w.balls / 6)}.${w.balls % 6}`,
      econ: r1(w.runs / overs),
      dotPct: Math.round((w.dots / w.balls) * 100),
      avg: w.wickets ? r1(w.runs / w.wickets) : null,
      strikeRate: w.wickets ? r1(w.balls / w.wickets) : null,
      deathEcon: w.deathBalls ? r1(w.deathRuns / (w.deathBalls / 6)) : null,
    };
  }).sort((a, b) => b.wickets - a.wickets || a.econ - b.econ);

  return {
    match: {
      event: info.event ? `${info.event.name}${info.event.stage ? " · " + info.event.stage : ""}` : null,
      teams: info.teams, venue: info.venue, city: info.city, date: (info.dates || [])[0],
      format: info.match_type, outcome: info.outcome, playerOfMatch: info.player_of_match,
      inningsTotals,
    },
    batting,
    bowling,
  };
}

// Node demo:  node cricsheet-parser.js path/to/match.json
if (typeof process !== "undefined" && process.argv && process.argv[2] && typeof require !== "undefined") {
  try {
    const fs = require("fs");
    const out = parseCricsheet(JSON.parse(fs.readFileSync(process.argv[2], "utf8")));
    console.log(JSON.stringify(out, null, 2));
  } catch (e) { /* ignore when imported */ }
}
