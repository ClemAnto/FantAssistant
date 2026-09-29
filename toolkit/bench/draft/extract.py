"""Extracts the measurable windows a draft bench needs, for ONE declared league.

Per window: the PRICE (the listone's Qt.I in the league's own currency - the only quotation that does not
know the outcome), the VALUE and the SURPLUS the engine predicts (parameters cross-fit on an adjacent
window, exactly as the gate does it), the complete roles, the season's outcome and the FANTAVOTO matchday
by matchday.

This is NOT a gate path: it reads the DB and writes a working file, nothing else. The file it writes is
kept out of git - it carries names, prices and votes of paid fantacalcio.it content - so it is meant to be
regenerated (about two minutes) rather than stored.

    python extract.py windows.json                 # the league's default: EuroLeghe (euro/mantra)
    python extract.py serie-a.json "Leghe Mantra"  # any league declared in config/league_config.json
"""
import json
import sys

from euroleghe_ingest.config import Config
from euroleghe_ingest.db.database import connect
from euroleghe_ingest.engine import evaluate, features
from euroleghe_ingest.matching import club_identity

# Two OPTIONAL rules of a league, off by default so every published window reproduces unchanged:
#   --porte          the keeper unit is a CLUB, not a man (EuroLeghe 2026-27 regulation, 28/09/2026): the
#                    squad buys a club's door, and the door scores whichever of that club's keepers played.
#   --no-italian     players of Serie A clubs are not in the listone (same regulation).
FLAGS = {arg for arg in sys.argv[1:] if arg.startswith("--")}
POSITIONAL = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
OUT = POSITIONAL[0]
LEAGUE = POSITIONAL[1] if len(POSITIONAL) > 1 else "EuroLeghe"
PORTE = "--porte" in FLAGS
NO_ITALIAN = "--no-italian" in FLAGS
unknown = FLAGS - {"--porte", "--no-italian"}
if unknown:
    raise SystemExit(f"unknown option(s): {', '.join(sorted(unknown))}")

# Which windows a platform can actually be measured on. euro: the authenticated votes API turned out to
# serve seasons the Drive datasets never covered, and EuroLeghe 21/22 is empty AT THE SOURCE, which costs
# euro two windows. `default` has the full ten (see CLAUDE.md, «the gate now runs on 10 windows»).
AVAILABLE = {
    "euro": ("Tm4", "Tm3", "T0", "T1", "T2"),
    "default": ("Tm7", "Tm6", "Tm5", "Tm4", "Tm3", "Tm2", "Tm1", "T0", "T1", "T2"),
}

cfg = Config()
conn = connect(cfg.db_path)
setup = cfg.load_league(LEAGUE)
platform, game = setup["platform"], setup["game"]
windows = AVAILABLE[platform]
mantra = game == "mantra"

# The price is the pre-auction quotation IN THE CURRENCY THE GAME IS PLAYED IN. Mixing the two would be
# comparing a bid against an ask from another game: 904 of 916 surplus values differ between them.
price_column = "price_initial_mantra" if mantra else "price_initial"
fvm_column = "fvm_mantra" if mantra else "fvm"

print(f'league "{LEAGUE}": platform={platform} game={game}, windows {", ".join(windows)}'
      f'{" | porte" if PORTE else ""}{" | no Italian clubs" if NO_ITALIAN else ""}', flush=True)
out = {}

def porte(conn, win, platform, rows, others, votes, base, rounds, rep_keeper):
    """Replace every keeper with his club's DOOR.

    A door is bought by CALLING THE CLUB'S STARTING KEEPER (the operator, 28/09/2026: «si chiama il
    portiere titolare e non le riserve»), and the starter is THE DEAREST keeper («prendi come portiere
    titolare il più caro come FVM»). Here «dearest» reads the bench's own price, the pre-auction Qt.I,
    because the archived FVM of a past season is its LAST read and already knows who played; the app reads
    the FVM. In a draft that price is also what moves you down the next round's order. Its
    prediction is the operator's own definition, the keepers' fantamedia weighted on their expected
    appearances, with the appearances summed up to the calendar. Its OUTCOME is read from the votes of the
    club's keepers by TEAM, not from the listone's roster: a keeper who changed club mid-season scored for
    the club he played for, and the door belongs to the club.
    """
    keeper_slot = "por" if mantra else "p"
    keepers = [r for r in rows + others if r["slot"] == keeper_slot]
    rows = [r for r in rows if r["slot"] != keeper_slot]
    others = [r for r in others if r["slot"] != keeper_slot]
    by_club = {}
    for man in keepers:
        if man.get("club"):
            by_club.setdefault(club_identity(man["club"]), []).append(man)
    # The door's votes, matchday by matchday: the mean of that club's keepers who got one (nearly always one).
    door_votes, door_base = {}, {}
    for team, md, fv, mv in conn.execute(
        "select team, matchday, fantavoto, mv from match_ratings"
        " where season=? and platform=? and role='P' and fantavoto is not null",
        (win.target_season, platform),
    ):
        key = club_identity(team)
        if key in by_club:
            door_votes.setdefault(key, {}).setdefault(str(md), []).append(float(fv))
            if mv is not None:
                door_base.setdefault(key, {}).setdefault(str(md), []).append(float(mv))
    made = 0
    for index, (key, men) in enumerate(sorted(by_club.items())):
        ident = -(index + 1)
        priced = [m for m in men if m.get("fm_pred") is not None and m.get("pv_pred") is not None
                  and m["pv_pred"] > 0]
        apps = sum(m["pv_pred"] for m in priced)
        fm = sum(m["fm_pred"] * m["pv_pred"] for m in priced) / apps if apps else None
        pv = min(float(rounds), apps) if apps else None
        steady_men = [m for m in priced if m.get("steady") is not None]
        steady_apps = sum(m["pv_pred"] for m in steady_men)
        mean = lambda xs: round(sum(xs) / len(xs), 2)
        starter = max(men, key=lambda m: m["price"])
        per_md = {md: mean(v) for md, v in door_votes.get(key, {}).items()}
        per_md_base = {md: mean(v) for md, v in door_base.get(key, {}).items()}
        if per_md:
            votes[str(ident)] = per_md
        if per_md_base:
            base[str(ident)] = per_md_base
        fm_act = sum(per_md.values()) / len(per_md) if per_md else None
        pv_act = float(len(per_md)) if per_md else None
        door = {
            "club": men[0]["club"], "league": men[0].get("league"), "id": ident,
            "name": f"Porta {men[0]['club']}", "slot": keeper_slot, "roles": [keeper_slot],
            "price": starter["price"], "keepers": [m["id"] for m in men], "starter": starter["id"],
            "steady": (round(sum(m["steady"] * m["pv_pred"] for m in steady_men) / steady_apps, 4)
                       if steady_apps else None),
            "fm_pred": fm, "pv_pred": pv, "fm_act": fm_act, "pv_act": pv_act,
        }
        if fm is None or pv is None or fm_act is None or rep_keeper is None:
            others.append(door)
            continue
        door.update({
            "fvm": None, "fm_prev": None,
            "surplus": (fm - rep_keeper) * pv, "value": fm * pv, "actual": fm_act * pv_act,
        })
        rows.append(door)
        made += 1
    # A door with no votes is either a club outside this season's platform perimeter or a spelling the
    # identity does not reconcile; the two look the same to a count, so the names are printed.
    silent = sorted(men[0]["club"] for key, men in by_club.items() if key not in door_votes)
    print(f"    porte: {len(by_club)} clubs, {made} priced doors, {len(keepers)} keepers folded"
          + (f"; no keeper votes for: {', '.join(silent)}" if silent else ""), flush=True)
    return rows, others


for key in windows:
    win = features.WINDOWS[key]
    data = features.prepare(conn, win, platform, game, league=setup)
    source = features.cross_fit_source(key, windows)
    params = evaluate.fit_params(
        features.prepare(conn, features.WINDOWS[source], platform, game),
        ("R0", *evaluate.CANDIDATES),
    )
    preds = evaluate.predict_window(data, ("R0", *evaluate.ADOPTED[platform]), None, params)
    # THE STEADINESS, and it must be AUCTION-SAFE: the share of matches he closed with at least 6 of BASE
    # vote over the seasons up to the input one, never the target. It is the currency of both classic
    # modifiers - the R-Factor counts who is under the pass mark and the defence modifier averages base
    # votes - and neither the surplus nor the value contains it, because both are built on the fantavoto.
    # Below `MIN_STEADY_VOTES` matches it stays ABSENT rather than computed on noise.
    MIN_STEADY_VOTES = 15
    steady = {}
    for fc, votes, rate in conn.execute(
        "select fc_id, count(*), avg(case when mv >= 6 then 1.0 else 0.0 end) from match_ratings"
        " where platform=? and season <= ? and mv is not null group by fc_id",
        (platform, win.input_season),
    ):
        if votes >= MIN_STEADY_VOTES:
            steady[fc] = round(float(rate), 4)

    quotes = {
        fc: (qi, fvm)
        for fc, qi, fvm in conn.execute(
            f"select fc_id, {price_column}, {fvm_column} from listone_quotes"
            f" where season=? and platform=? and {price_column} is not null",
            (win.target_season, platform),
        )
    }
    rows, others = [], []
    for pred in preds:
        obs = pred.obs
        if NO_ITALIAN and obs.league == "serie_a":
            continue
        # The SLOT is in the vocabulary the game is played with, because that is the vocabulary the
        # replacement levels come back in: `por`..`pc` on mantra, `P`/`D`/`C`/`A` on classic. Lowercasing the
        # classic one made `replacement.get('p')` miss on every row and the extraction wrote 0 players in all
        # ten windows - the project's own «an asymmetry between two artifacts is a key that does not match».
        if mantra:
            roles = [r.lower() for r in (obs.roles_mantra or ()) if r]
            slot = roles[0] if roles else (obs.role_classic or "").lower()
        else:
            slot = obs.role_classic or ""
            roles = [slot.lower()] if slot else []
        rep = (data.replacement or {}).get(slot)
        pair = quotes.get(obs.fc_id)
        price = pair[0] if pair else None
        # THE OTHER QUOTED MEN, whom an AUCTION bench must be able to buy: the ones the engine does not
        # price (below `MIN_PV_PREV` it refuses to predict, and saying so is the point) and the ones who
        # never played. The draft dropped them rightly - there a RANKING is what is measured - but in an
        # auction they are half the listone, and they are the two ways a purchase turns out wrong:
        # buying a man nobody has measured, and buying one who then never takes the pitch. Leaving them
        # out would build an auction in which flops cannot exist. The outcome stays ABSENT and never
        # zero where there is none: a man who did not play has no average.
        if (not price or rep is None or pred.fm_pred is None or pred.pv_pred is None
                or obs.fm_act is None or obs.pv_act is None):
            if price:
                others.append({
                    "club": obs.club_target or obs.club_prev,
                    "league": obs.league,
                    "steady": steady.get(obs.fc_id),
                    "id": obs.fc_id, "name": obs.name, "slot": slot.lower(),
                    "roles": roles or [slot.lower()], "price": float(price),
                    "fm_pred": float(pred.fm_pred) if pred.fm_pred is not None else None,
                    "pv_pred": float(pred.pv_pred) if pred.pv_pred is not None else None,
                    "fm_act": float(obs.fm_act) if obs.fm_act is not None else None,
                    "pv_act": float(obs.pv_act) if obs.pv_act is not None else None,
                })
            continue
        rows.append({
            # THE REAL CLUB, which an auction bench needs and a draft one does not: five men of one club
            # that has a bad season sink a squad together, so DIVERSIFYING is a decision a bidder makes.
            # The TARGET season's club - the shirt he will actually wear - falling back on the input one
            # for a man the target roster does not place yet.
            "club": obs.club_target or obs.club_prev,
            "league": obs.league,
            "steady": steady.get(obs.fc_id),
            # `slot` lowercase for the bench (its module files spell places in either case and `placesOf`
            # lowercases them), `roles` complete - on classic that is one macro-role and that IS the legality.
            "id": obs.fc_id, "name": obs.name, "slot": slot.lower(), "roles": roles or [slot.lower()],
            "price": float(price),
            "fvm": float(pair[1]) if pair[1] else None,      # ARCHIVED: it has already seen the season
            "fm_prev": float(obs.fm_prev) if obs.fm_prev is not None else None,
            "surplus": (pred.fm_pred - rep) * pred.pv_pred,
            "value": pred.fm_pred * pred.pv_pred,
            # The two halves separately, because «which of the two is the bottleneck» is a question about
            # them and not about their product (todolist item 2.1, whose answer rested on ONE window).
            "fm_pred": float(pred.fm_pred),
            "pv_pred": float(pred.pv_pred),
            "fm_act": float(obs.fm_act),
            "pv_act": float(obs.pv_act),
            "actual": float(obs.fm_act) * float(obs.pv_act),
        })
    ids = {r["id"] for r in rows} | {r["id"] for r in others}
    votes, base = {}, {}
    rounds = 0
    # THE BASE VOTE beside the fantavoto, because the two classic modifiers are paid on THAT and not on
    # the fantavoto: the R-Factor counts who is below 6 of pure vote, the defence modifier averages the
    # three best defenders. A forward on 5.5 plus a goal carries 7.5 of fantavoto and an INSUFFICIENT
    # base vote, so reading the fantavoto in its place would state the opposite of the regulation.
    # The draft bench does not read it - modifiers do not enter there - and it does not disturb it.
    for fc, md, fv, mv in conn.execute(
        "select fc_id, matchday, fantavoto, mv from match_ratings"
        " where season=? and platform=? and fantavoto is not null",
        (win.target_season, platform),
    ):
        rounds = max(rounds, int(md))
        if fc in ids:
            votes.setdefault(str(fc), {})[str(md)] = round(float(fv), 2)
            if mv is not None:
                base.setdefault(str(fc), {})[str(md)] = round(float(mv), 2)
    if PORTE:
        rows, others = porte(conn, win, platform, rows, others, votes, base, rounds, rep_keeper=(
            (data.replacement or {}).get("por" if mantra else "P")))
    out[key] = {
        "league": LEAGUE, "platform": platform, "game": game,
        "input": win.input_season, "target": win.target_season, "cross_fit": source,
        "rounds": rounds, "players": rows, "others": others, "votes": votes, "base": base,
    }
    print(f"{key}: {win.input_season} -> {win.target_season}, cross-fit on {source},"
          f" {len(rows)} players, {rounds} matchdays, {len(votes)} with votes,"
          f" {len(base)} with base votes, {len(others)} unpriced/unplayed", flush=True)

# UTF-8 explicitly: without it Windows writes cp1252 and every accented name comes back mangled
# to a UTF-8 reader (the scratchpad version had this defect - harmless for the numbers, and it
# still means the file cannot be re-read by the script that wrote it).
with open(OUT, "w", encoding="utf-8") as handle:
    json.dump(out, handle, ensure_ascii=False)
print(f"written {OUT}")
