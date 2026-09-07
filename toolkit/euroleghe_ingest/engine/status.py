"""status - which of six words describes a man's hold on his shirt, for the season that is coming.

THE LADDER IS THE OPERATOR'S, dictated 20/08/2026, and the words are his own vocabulary the way the
mantra slot codes are the rulebook's - `titolarissimo` has no English equivalent anybody uses, so it is
stored as he says it and never translated:

    bandiera        he will play EVERY match (>90%), and at least 75 minutes
    titolarissimo   he will play almost every match (>80%), and at least 75 minutes
    titolare        he will play almost every match (>80%), and at least 65 minutes
    ballottaggio    he will play almost every match (>80%)
    panchina        he will often come on, without certainties
    riserva         he will not come on often - it is not even certain he is on the bench

TWO AXES AND NOT ONE, which is how the six lines above read: a PERCENTAGE of the matches, and a MINUTES
floor. Both already exist and neither is invented here - the appearance share is
`presence.appearance_share` and the minutes are `minutes.per_appearance`, the card's own chip, adopted
+7.5%/+7.6% against showing last season's average unchanged. This module only says where the two of them
put a man, so that one sentence answers what two numbers were already saying separately.

...AND THE PERCENTAGE IS CONDITIONAL, «of the matches he is fit for». That is not a softening, it is what
makes the state agree with the drawn board, which is what the operator asked for: `eleven` is «the side he
fields when everybody is available» and `claim` is `standing` WITHOUT the injury discount for exactly that
reason. A ladder built on `voto_share` would call a man who plays whenever he is fit a `panchina` because
he broke down in March, while the board keeps drawing him - two answers to one question. What he missed is
a fact about his body and the app already draws it as its own mark (`core/player-status.ts`).

THE BOARD IS A GATE AND NOT A DECORATION. A man the typical eleven does not field cannot be called
`titolare`, and a man it does field never falls below `ballottaggio`. That is the operator's coherence
requirement read literally - and it is also, measured, the better classifier: the drawing carries
information the numbers do not. At the SAME claim band, the men the board drew realised a q75 of 0.512
against 0.328 for the men it did not (0.6-0.7 band; 0.362 against 0.242 at 0.5-0.6), because the fit knows
what shape the club plays and who else wants the shirt, and a share of a season does not.

...AND SINCE 08/09/2026 THE GATE HAS A SECOND HALF, DECLARED BY THE OPERATOR: a drawn man whom NOBODY
disputes is `titolare` and not `ballottaggio` - «Ballottaggio con chi???», found on a screen. It waives the
MINUTES floor and only that, it cannot lift anybody above `titolare`, and it never touches a man the board
does not draw (there the man who IS drawn is his contender). The price is measured and stated in
`status_of`: it promotes 76 of 115 drawn ballottaggi on the Serie A board, 56 of them below the 0.80 the
word promises. The measured channel behind it - «how much is a missing deputy worth» - was refused on its
own numbers first (+3.1' paired, +3.8' as a level net of his own past), which is why this is a
DECLARATION and not a term.

MEASURED, on four back-dated pre-season windows (`snapshot --season S --date S-08-15`, the state of an
August auction, two platforms x two seasons), outcome = what the men of each rung really did in the season
that followed: the share of his club's matches he was on the pitch for OUT OF THE ONES HE WAS FIT FOR (a
round inside a dated injury spell comes off the denominator, the same subtraction `contested` makes on the
input side), and the minutes he averaged in a match he played.

    rung             promise      Serie A 25-26   Serie A 24-25   euro 25-26     euro 24-25
    bandiera         >.90 / 75'   .864 / 76'      .925 / 79'      .901 / 80'     .896 / 78'
    titolarissimo    >.80 / 75'   .700 / 62'      .774 / 76'      .802 / 71'     .867 / 77'
    titolare         >.80 / 65'   .846 / 67'      .892 / 68'      .881 / 67'     .898 / 68'
    ballottaggio     >.80         .678 / 57'      .717 / 60'      .789 / 62'     .791 / 61'
    panchina         >.50         .610 / 49'      .645 / 52'      .662 / 55'     .683 / 56'
    riserva          -            .343 / 47'      .386 / 47'      .433 / 49'     .430 / 50'
    men per club                  3.0/0.7/2.2     2.2/0.8/1.8     2.6/1.0/2.9    2.4/1.0/2.9

WHAT THAT TABLE SAYS AND WHAT IT DOES NOT. `bandiera` and `titolare` keep their promise on all four
windows (and `bandiera`'s minutes floor is cleared by four points); `panchina` and `riserva` are ordered
and well apart. `titolarissimo` is the weak rung - it is the RESIDUAL between the other two (over 80% but
not over 90%, with the higher minutes bar) so it is small, 0.7-1.0 men per club, and on one window of four
it delivers 0.700 against its 0.80. `ballottaggio` under-delivers on Serie A because the gate puts every
drawn man into it, including the ones whose numbers do not reach any bar - which is the point of the gate
and the price of it, stated rather than hidden.

WITHOUT THE GATE the same ladder delivers .832 / .871 / .878 / .884 on `bandiera` and .797 / .894 / .862 /
.865 on `titolare`: the gate improves six of those eight and worsens none. It also removes what the
operator would have seen first - 19 men called `titolarissimo` on the 2025 window while the board does not
field them, and 83 drawn men called `panchina` or `riserva`.

THE ROLE SKEW IS IN THE DEFINITION AND IS REPORTED, NOT CURED. A minutes floor in absolute minutes is not
neutral between roles: a start lasts 84.5' for a defender and 78.5' for a forward (`minutes.START_MINUTES`,
measured over 247,825 appearances), so `bandiera` on the 2025 window holds 11 keepers, 33 defenders, 13
midfielders and 4 forwards. That is the operator's own bar doing what it says, and this project's rule is
that a difference between two GROUPS is not a virtue of whoever carries it - so it is written down here
for him to rule on rather than quietly replaced by a per-role floor.

WHAT IT IS NOT. REPORTING: no `engine_*` column moves, no gate owns these thresholds, `backtest --verify`
does not change. The three numbers above the words are the operator's declared vocabulary and the two
inputs are already gated or measured elsewhere; what this module adds is the mapping and the evidence that
it delivers.

Dependency-free, like the rest of `engine/`: the shippable TypeScript engine gets ported from here.
"""

from __future__ import annotations

#: The six words, strongest first. Their INDEX is the ladder, so `LADDER.index(...)` compares two men.
LADDER: tuple[str, ...] = ("bandiera", "titolarissimo", "titolare", "ballottaggio",
                           "panchina", "riserva")

#: «ogni partita» and «quasi ogni partita», as the operator wrote them: shares of the matches he is fit
#: for. Strictly greater, also as he wrote them.
PLAY_EVERY = 0.90
PLAY_ALMOST_EVERY = 0.80
#: The line between `panchina` («spesso entrerà in campo») and `riserva` («non entrerà spesso»). It is the
#: one number the operator did not give and it is DECLARED rather than fitted: «often» is more often than
#: not. What it delivers is measured (0.610-0.683 against 0.343-0.433 below it), which is the honest way
#: round - a floor chosen to make its own class look good would be fitting.
PLAY_OFTEN = 0.50

#: The two minutes floors, in minutes of a match. Absolute and not per role: see the module docstring.
FULL_MATCH = 75.0
MOST_OF_THE_MATCH = 65.0


def status_of(play_share: float | None, minutes: float | None, in_eleven: bool,
              contended: bool | None = None) -> str | None:
    """One of `LADDER`, or None when nothing is known about how often he plays.

    `play_share` is the share of the matches he is FIT FOR that he is expected to get a voto in
    (`presence.appearance_share`), `minutes` the minutes he is expected to play in a match he plays
    (`minutes.per_appearance`), and `in_eleven` whether the club's typical eleven draws him.

    `contended` IS THE OPERATOR'S RULE OF 08/09/2026 and it is DECLARED, not measured: «se la titolarita'
    e' BALLOTTAGGIO ma non c'e' nessuno con cui fare il ballottaggio, in automatico diventa titolare». It
    is his ladder and his word - the six rungs are his vocabulary and no gate owns these thresholds - and
    he took the decision with the price in front of him, which is written in `docs/model/gate-motore-v1.md`
    §7-quinquinquagies (ter). Three states and never two: True somebody disputes the shirt, False nobody
    does, **None UNKNOWN** - and unknown does not promote, because a starter whose granular real role is
    missing has no duel the sheet can express and «vuoto = ignoto, mai zero». It defaults to None so a
    caller who has not thought about it gets the ladder as it was.

    THE PRICE, MEASURED BEFORE THE RULE WAS WRITTEN AND STATED HERE RATHER THAN HIDDEN: on the Serie A
    board of 07/09/2026 it promotes **76 of the 115 drawn ballottaggi**, and **56 of those 76 have a
    play share BELOW the 0.80 that `titolare` promises** - the lowest is 0.274. So on those rows the word
    says «gioca quasi ogni partita» about a man the number beside it puts at a quarter of them. Two
    alternatives were measured and REFUSED BY HIM, and they are recorded so nobody re-opens the question
    by accident: a floor at 0.80 (the word's own bar) promotes 20 and leaves out 76% of the ARRIVALS,
    whose share is discounted by `ARRIVAL_DISCOUNT` and whose median is 0.710 against 0.909 - i.e. it
    would exclude exactly the population the rule is for; a floor at 0.75 promotes 34 and is a constant
    nobody measured.

    And the channel the rule stands in for was measured first and refused on its own numbers
    (§7-quinquinquagies and bis): «no alternative» is worth **+3.1' paired within the man** and **+3.8'
    (t +1.7) as a level net of what he already played**, against the ten minutes it would take to move a
    man across the minutes floor. The rule is therefore a DECLARATION and not a fitted term, which is
    what this project does with a judgement the model cannot reach - `board_rulings.json` and
    `player_notes.json` are the other two.

    None in, None out: a man whose appearances nobody can forecast is unknown and not a `riserva` - the
    same rule the empty SURPLUS obeys, and it is the caller that owes the distinction. `riserva` reads
    «non entrerà spesso», which is a claim about football; a man nobody has measured has not earned it,
    and on the first sheet that carried this ladder exactly one row proved it (a keeper with no season on
    file whom the engine expects in 29 giornate of 38 - `SnapshotView.play_share`). UNKNOWN MINUTES ARE NOT ZERO MINUTES either, and the difference is
    visible in what it costs him: he cannot reach a rung whose promise is a minutes floor, because no
    floor can be promised for him, but he keeps every rung that does not ask for one. That is why the
    argument is optional rather than defaulted - 102 rows of a Serie A sheet have no measured season to
    build it from.
    """
    if play_share is None:
        return None
    if in_eleven:
        if minutes is not None:
            if play_share > PLAY_EVERY and minutes >= FULL_MATCH:
                return LADDER[0]
            if play_share > PLAY_ALMOST_EVERY and minutes >= FULL_MATCH:
                return LADDER[1]
            if play_share > PLAY_ALMOST_EVERY and minutes >= MOST_OF_THE_MATCH:
                return LADDER[2]
        # ...AND IF NOBODY DISPUTES THE SHIRT, `ballottaggio` is a word that names a duel with an empty
        # chair. The operator's own reading, and the one he found on a screen: «Ballottaggio con chi???».
        # It waives the MINUTES floor and nothing else - it cannot lift a man above `titolare`, because the
        # two rungs above ask for more than «he plays and nobody takes his place».
        if contended is False:
            return LADDER[2]
        # ...and a man the board fields never falls below `ballottaggio`, whatever the two numbers say.
        # The eleven is a claim about him too, and the one the operator reads first: a row that says
        # «riserva» beside a shirt on the pitch is the panel contradicting itself in two places.
        return LADDER[3]
    # He is not in the eleven, so `ballottaggio` is the CEILING and the rungs above it are unreachable by
    # arithmetic alone: «titolare» about a man nobody draws would be the same contradiction the other way
    # round. What is left to decide is how often he comes on.
    # `contended` is deliberately NOT read here. «Nobody disputes his shirt» is a statement about a PLACE
    # on the pitch, and a man the board does not draw holds no place: the man who does IS his contender.
    # Promoting him would also break the other half of the gate the rule leaves standing - «chi la board
    # non schiera non puo' essere titolare».
    if play_share > PLAY_ALMOST_EVERY:
        return LADDER[3]
    if play_share > PLAY_OFTEN:
        return LADDER[4]
    return LADDER[5]


def rank_of(status: str | None) -> int | None:
    """Where a word sits on the ladder, 0 = `bandiera`. None for an unknown state, never a number.

    One definition, because sorting by titolarita is a thing three screens will want to do and three
    orderings of six words would eventually disagree about one of them.
    """
    if status is None:
        return None
    try:
        return LADDER.index(status)
    except ValueError:
        return None
